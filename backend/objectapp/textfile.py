"""Read and write text files without disturbing their bytes.

`read_text` normalises line endings to ``\n`` and strips a UTF-8 BOM, recording
both so that `encode` can reproduce the original bytes exactly. Whether the file
ends with a newline is carried by the text itself.
"""

from __future__ import annotations

import difflib
import os
import tempfile
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
    eol: Eol = "\r\n" if "\r\n" in text else "\n"
    if eol == "\r\n":
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
    old_norm = [line.decode("utf-8", errors=_ERRORS) for line in old_raw]
    if tf.eol == "\r\n":
        old_norm = [line.replace("\r\n", "\n") for line in old_norm]
    # Split on \n only (str.splitlines would also break on \r,   and others).
    new_lines = [p + "\n" for p in new_text.split("\n")[:-1]]
    tail = new_text.split("\n")[-1]
    if tail:
        new_lines.append(tail)

    out: list[bytes] = []
    matcher = difflib.SequenceMatcher(None, old_norm, new_lines, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            out.extend(old_raw[i1:i2])
        elif op in ("insert", "replace"):
            for line in new_lines[j1:j2]:
                if tf.eol == "\r\n":
                    line = line.replace("\n", "\r\n")
                out.append(line.encode("utf-8", errors=_ERRORS))
    data = b"".join(out)
    return BOM + data if tf.bom else data


def atomic_write(path: Path, data: bytes, check: Callable[[], None] | None = None) -> None:
    """Write `data` to `path` via a temp file in the same folder and `os.replace`.

    `check`, when given, runs right before the replace; if it raises, the temp
    file is removed, `path` is left as it was and the exception propagates.
    """
    path = Path(path)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        if check is not None:
            check()
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise
