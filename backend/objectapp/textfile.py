"""Read and write text files without disturbing their bytes.

`read_text` normalises line endings to ``\n`` and strips a UTF-8 BOM, recording
both (the ending is the file's majority one) so that `encode` can reproduce the
original bytes of a file with one kind of ending exactly; `encode_like` keeps a
mixed file's per-line endings. Whether the file ends with a newline is carried
by the text itself.
"""

from __future__ import annotations

import difflib
import os
import secrets
import stat
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

BOM = b"\xef\xbb\xbf"
# surrogateescape lets undecodable bytes survive a read/encode round trip.
_ERRORS = "surrogateescape"

Eol = Literal["\n", "\r\n"]


@dataclass(frozen=True)
class TextFile:
    text: str
    eol: Eol
    bom: bool


def decode(data: bytes) -> TextFile:
    bom = data.startswith(BOM)
    if bom:
        data = data[len(BOM) :]
    text = data.decode("utf-8", errors=_ERRORS)
    # The majority ending wins: one stray CRLF line doesn't make a file CRLF.
    crlf = text.count("\r\n")
    eol: Eol = "\r\n" if crlf and crlf >= text.count("\n") - crlf else "\n"
    text = text.replace("\r\n", "\n")
    return TextFile(text=text, eol=eol, bom=bom)


def read_text(path: Path) -> TextFile:
    return decode(Path(path).read_bytes())


def encode(tf: TextFile) -> bytes:
    text = tf.text.replace("\n", "\r\n") if tf.eol == "\r\n" else tf.text
    data = text.encode("utf-8", errors=_ERRORS)
    return BOM + data if tf.bom else data


def _raw_lines(data: bytes) -> list[bytes]:
    """`data` split after each ``\\n`` (the last piece has no newline, and may be empty)."""
    parts = data.split(b"\n")
    lines = [p + b"\n" for p in parts[:-1]]
    if parts[-1]:
        lines.append(parts[-1])
    return lines


def encode_like(original: bytes, new_text: str) -> bytes:
    """Encode `new_text` (``\\n`` endings) the way `original` was written, line by line.

    Lines of `new_text` that match a line of the original (after line-ending
    normalisation) are emitted with the original's own bytes, so a file with
    mixed line endings keeps every untouched line's ending. Inserted or changed
    lines take the file's dominant ending (see `decode`). The BOM is kept.
    """
    tf = decode(original)
    body = original[len(BOM) :] if tf.bom else original
    old_raw = _raw_lines(body)
    old_norm = [line.decode("utf-8", errors=_ERRORS).replace("\r\n", "\n") for line in old_raw]
    # Split on \n only (str.splitlines would also break on \r,   and others).
    new_lines = [p + "\n" for p in new_text.split("\n")[:-1]]
    tail = new_text.split("\n")[-1]
    if tail:
        new_lines.append(tail)

    # The lines unchanged at both ends (a property edit leaves the whole body alone, a
    # body edit the frontmatter) are copied as they are; only the middle is diffed.
    n_old, n_new = len(old_norm), len(new_lines)
    limit = min(n_old, n_new)
    head = 0
    while head < limit and old_norm[head] == new_lines[head]:
        head += 1
    tail = 0
    while tail < limit - head and old_norm[n_old - 1 - tail] == new_lines[n_new - 1 - tail]:
        tail += 1

    out: list[bytes] = list(old_raw[:head])
    if head < n_old - tail or head < n_new - tail:
        matcher = difflib.SequenceMatcher(
            None, old_norm[head : n_old - tail], new_lines[head : n_new - tail], autojunk=False
        )
        for op, i1, i2, j1, j2 in matcher.get_opcodes():
            if op == "equal":
                out.extend(old_raw[head + i1 : head + i2])
            elif op in ("insert", "replace"):
                for line in new_lines[head + j1 : head + j2]:
                    if tf.eol == "\r\n":
                        line = line.replace("\n", "\r\n")
                    out.append(line.encode("utf-8", errors=_ERRORS))
    out.extend(old_raw[n_old - tail :])
    data = b"".join(out)
    return BOM + data if tf.bom else data


# Windows refuses to replace or rename a file another handle has open without
# FILE_SHARE_DELETE (a virus scanner, an indexer, a reader thread). Such locks
# are brief, so a few short retries ride them out.
RETRY_DELAYS = (0.02, 0.03, 0.05, 0.08, 0.12)


def retry_os(fn: Callable[[], None]) -> None:
    """Run `fn` (a replace or rename), retrying a few times on `PermissionError`."""
    for delay in RETRY_DELAYS:
        try:
            fn()
            return
        except PermissionError:
            time.sleep(delay)
    fn()


# A file name may be 255 bytes (Linux, macOS) or 255 UTF-16 units (Windows); a temp
# name adds a dot, a dot, 8 random characters and ".tmp" to the file's own name.
_TEMP_NAME_ROOM = 200


def _temp_prefix(path: Path) -> str:
    """``.<name>.``, with ``name`` shortened so the temp name stays a legal length.

    UTF-8 bytes bound UTF-16 units too, so one byte cap serves every platform.
    """
    name = path.name
    raw = name.encode("utf-8", errors=_ERRORS)
    if len(raw) > _TEMP_NAME_ROOM:
        name = raw[:_TEMP_NAME_ROOM].decode("utf-8", errors="ignore")
    return f".{name}."


_OPEN_FLAGS = (
    os.O_WRONLY
    | os.O_CREAT
    | os.O_EXCL
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_BINARY", 0)
)


def _open_temp(path: Path) -> tuple[int, str]:
    """A new temp file beside `path`, created with mode ``0o666`` (the umask applies).

    `tempfile.mkstemp` would make it 0600, and `os.replace` carries the temp file's
    bits over to `path`: a 0644 file saved by the app would lose group/other read.
    """
    prefix = _temp_prefix(path)
    for _attempt in range(100):
        tmp_name = str(path.parent / f"{prefix}{secrets.token_hex(4)}.tmp")
        try:
            return os.open(tmp_name, _OPEN_FLAGS, 0o666), tmp_name
        except FileExistsError:
            continue
    raise FileExistsError(f"No free temp name beside {path}")


def _keep_mode(fd: int, tmp_name: str, path: Path) -> None:
    """Give the temp file the permission bits `path` has now, when it exists."""
    try:
        mode = stat.S_IMODE(os.stat(path).st_mode)
    except OSError:
        return  # a new file keeps the default bits
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(fd, mode)
        else:
            os.chmod(tmp_name, mode)
    except OSError:
        pass  # a file system without permission bits


def _write_temp(path: Path, data: bytes, keep_mode: bool = False) -> str:
    """Write `data` to a new temp file beside `path` (fsynced); return its name."""
    fd, tmp_name = _open_temp(path)
    try:
        with os.fdopen(fd, "wb") as fh:
            if keep_mode:
                _keep_mode(fh.fileno(), tmp_name, path)
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
    except BaseException:
        os.unlink(tmp_name)
        raise
    return tmp_name


def atomic_write(path: Path, data: bytes, check: Callable[[], None] | None = None) -> None:
    """Write `data` to `path` via a temp file in the same folder and `os.replace`.

    An existing file keeps its permission bits; a new one gets ``0o666 & ~umask``.
    `check`, when given, runs right before the replace; if it raises, the temp
    file is removed, `path` is left as it was and the exception propagates.
    """
    path = Path(path)
    tmp_name = _write_temp(path, data, keep_mode=True)
    try:
        if check is not None:
            check()
        retry_os(lambda: os.replace(tmp_name, path))
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def create_new(path: Path, data: bytes) -> None:
    """Write `data` as a new file at `path`; raise `FileExistsError` if anything is there.

    The file is written to a temp name first and then hard-linked into place,
    which fails atomically when `path` exists (a check-then-replace would
    overwrite a file created in between). Where hard links are unsupported,
    Windows' ``os.rename`` (which never overwrites) is used instead.
    """
    path = Path(path)
    tmp_name = _write_temp(path, data)
    try:
        try:
            os.link(tmp_name, path)
        except FileExistsError:
            raise
        except OSError:
            if os.name == "nt":
                retry_os(lambda: os.rename(tmp_name, path))
                return
            if path.exists():
                raise FileExistsError(str(path)) from None
            os.replace(tmp_name, path)
            return
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise
    try:
        retry_os(lambda: os.unlink(tmp_name))
    except OSError:
        pass  # a stray temp dot-file is harmless; the new file is in place


def move_no_overwrite(src: Path, dest: Path) -> None:
    """Move `src` to `dest`, raising `FileExistsError` rather than replace anything there.

    On Windows ``os.rename`` already refuses to overwrite (retried on a brief
    sharing lock). Elsewhere ``os.rename`` would replace `dest`, so the file
    is hard-linked to `dest` (atomic, fails if it exists) and `src` unlinked.
    """
    src, dest = Path(src), Path(dest)
    if os.name == "nt":
        retry_os(lambda: os.rename(src, dest))
        return
    try:
        os.link(src, dest)
    except FileExistsError:
        raise
    except OSError:
        if dest.exists():
            raise FileExistsError(str(dest)) from None
        os.rename(src, dest)
        return
    try:
        os.unlink(src)
    except BaseException:
        os.unlink(dest)
        raise
