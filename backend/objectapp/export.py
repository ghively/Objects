"""Exporting one object (M9): its ``.md`` as it is, or a zip with the media it references.

Object's entity "Export" offers Markdown with the option "Include media" ("Adds files and
images to the zip."). An Object file already is Markdown with wikilinks, so the export is the
file's own bytes; with media it is a zip of ``<stem>.md`` plus every image and attachment the
file references, each at its space-relative path (so the file's links still resolve inside
the zip). Its other formats and options are not offered (our choice).

A referenced file is one named by ``coverImage``, a Markdown image or link
(``![alt](path)``, ``[text](path)``) or a wikilink (``![[path]]``) outside code. Each is
checked with `media.attachment_path`: missing files, paths outside the space or in a
dot-folder, whiteboard sidecars and ``.md`` objects are skipped. A path that isn't a file
there is looked up as the editor does (`findAttachment` in ``editor/media/upload.ts``,
Obsidian's short form): the attachment at that path ignoring case, else (a bare file name)
the first attachment with that file name. Exporting reads only the space: the zip is
written to a temporary file in the system temp folder (``<temp>/object-exports``, never
in the space or the app's state dir) and streamed from there (`export_object_to_file`), so a 100 MB attachment is
never held in memory; the file is removed once sent (`Export.cleanup`), and files older
than an hour that a crash left behind are removed by the next export.
"""

from __future__ import annotations

import io
import os
import re
import tempfile
import time
import zipfile
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING
from urllib.parse import quote, unquote

from .media import Attachment, NotServed, attachment_path, list_attachments
from .relink import code_ranges, wikilink_targets
from .typedefs import read_raw

if TYPE_CHECKING:
    from .space import Space

__all__ = [
    "Export",
    "content_disposition",
    "export_dir",
    "export_object",
    "export_object_to_file",
    "referenced_media",
]

# ``![alt](path "title")`` / ``[text](<path with spaces>)``: the destination only.
_MD_LINK_RE = re.compile(r"!?\[[^\]\n]*\]\(\s*(?:<([^>\n]*)>|([^)\s]+))[^)\n]*\)")
_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


_STALE_SECONDS = 3600


class Export:
    """A download: its bytes (or the temporary ``file`` holding them), file name and media type."""

    def __init__(
        self, data: bytes, filename: str, media_type: str, file: Path | None = None
    ) -> None:
        self.data = data
        self.filename = filename
        self.media_type = media_type
        self.file = file
        """A temporary file to send instead of ``data`` (then ``data`` is empty); see `cleanup`."""

    def cleanup(self) -> None:
        """Remove the temporary ``file`` (call it once the response is sent). Idempotent."""
        if self.file is not None:
            try:
                self.file.unlink()
            except FileNotFoundError:
                pass
            except OSError:  # still open elsewhere (Windows): the next export's sweep removes it
                pass


def export_dir() -> Path:
    """Where media exports are assembled: the system temp folder's ``object-exports``.

    Outside every space and outside the app's state dir, which reads must leave unchanged
    (the M9 acceptance checks that an export adds nothing there).
    """
    return Path(tempfile.gettempdir()) / "object-exports"


def _sweep(folder: Path, now: float) -> None:
    """Remove export files a crash or an aborted download left behind (older than an hour)."""
    try:
        entries = list(os.scandir(folder))
    except OSError:
        return
    for entry in entries:
        try:
            if entry.is_file() and now - entry.stat().st_mtime > _STALE_SECONDS:
                os.unlink(entry.path)
        except OSError:
            continue


def _outside_code(text: str) -> str:
    """``text`` with fenced code blocks and inline code spans blanked out."""
    out = list(text)
    for start, end in code_ranges(text):
        out[start:end] = " " * (end - start)
    return "".join(out)


def _candidates(rel: str, fm: dict, body: str) -> list[str]:
    """The paths the object names, in order of appearance (the cover first)."""
    found: list[str] = []
    cover = fm.get("coverImage")
    if isinstance(cover, str) and cover.strip():
        found.append(cover.strip())
    plain = _outside_code(body)
    for m in _MD_LINK_RE.finditer(plain):
        target = (m.group(1) if m.group(1) is not None else m.group(2)).strip()
        if target and not target.startswith("#") and not _SCHEME_RE.match(target):
            found.append(unquote(target))
    found.extend(sorted(wikilink_targets(body)))
    folder = PurePosixPath(rel).parent.as_posix()
    if folder != ".":
        # A path relative to the object's own folder, after the space-relative reading.
        found.extend(f"{folder}/{p}" for p in list(found) if not p.startswith("/"))
    return found


def _find_attachment(attachments: list[Attachment], path: str) -> str | None:
    """The attachment ``path`` names, ignoring case, else by bare file name (as the editor)."""
    lower = path.replace("\\", "/").lower()
    for a in attachments:
        if a["path"].lower() == lower:
            return a["path"]
    if "/" in lower:
        return None
    for a in attachments:
        if a["path"].rsplit("/", 1)[-1].lower() == lower:
            return a["path"]
    return None


def referenced_media(root: Path, rel: str, fm: dict, body: str) -> list[str]:
    """The existing, servable files ``rel`` references, as space-relative POSIX paths."""
    root = Path(root).resolve()
    out: list[str] = []
    attachments: list[Attachment] | None = None
    for candidate in _candidates(rel, fm, body):
        try:
            full = attachment_path(root, candidate)
        except FileNotFoundError:
            if attachments is None:
                attachments = list_attachments(root)
            found = _find_attachment(attachments, candidate)
            if found is None:
                continue
            try:
                full = attachment_path(root, found)
            except (FileNotFoundError, NotServed, OSError, ValueError):
                continue
        except (NotServed, OSError, ValueError):
            continue
        real = full.relative_to(root).as_posix()
        if real not in out:
            out.append(real)
    return out


def _write_zip(space: Space, rel: str, stem: str, out) -> None:
    """The media zip of ``rel`` into the binary file object ``out`` (attachments streamed)."""
    raw = read_raw(space.root, rel)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, strict_timestamps=False) as zf:
        zf.writestr(f"{stem}.md", raw.data)
        for item in referenced_media(space.root, rel, raw.fm, raw.of.body):
            try:
                zf.write(space.root / item, item)
            except OSError:
                continue  # gone or unreadable since it was found: skipped like a missing one


def _object_rel(space: Space, path: str) -> str:
    rel = space._rel(path)
    if not (space.root / rel).is_file():
        raise KeyError(rel)
    return rel


def export_object(space: Space, path: str, media: bool) -> Export:
    """The export of the object at ``path``, in memory. Writes nothing.

    Raises `ValueError` (not an object path, 400) and `KeyError` (no such file, 404).
    The route uses `export_object_to_file`, which never holds the zip in memory.
    """
    rel = _object_rel(space, path)
    stem = PurePosixPath(rel).stem
    if not media:
        return Export((space.root / rel).read_bytes(), f"{stem}.md", "text/markdown; charset=utf-8")
    buf = io.BytesIO()
    _write_zip(space, rel, stem, buf)
    return Export(buf.getvalue(), f"{stem}.zip", "application/zip")


def export_object_to_file(space: Space, path: str, media: bool) -> Export:
    """The export of the object at ``path``; with ``media``, as a temporary zip ``file``.

    Without ``media`` it is the ``.md`` bytes (``data``), as `export_object`. With it, the
    zip is written to a new file in `export_dir` and returned as ``Export.file`` (``data``
    empty): the caller sends that file and then calls `Export.cleanup`. Writes nothing in
    the space. Raises `ValueError` (400) and `KeyError` (404), as `export_object`.
    """
    if not media:
        return export_object(space, path, False)
    rel = _object_rel(space, path)
    stem = PurePosixPath(rel).stem
    folder = export_dir()
    folder.mkdir(parents=True, exist_ok=True)
    _sweep(folder, time.time())
    fd, name = tempfile.mkstemp(prefix="export-", suffix=".zip", dir=folder)
    out = Export(b"", f"{stem}.zip", "application/zip", file=Path(name))
    try:
        with os.fdopen(fd, "wb") as f:
            _write_zip(space, rel, stem, f)
    except BaseException:
        out.cleanup()
        raise
    return out


def content_disposition(filename: str) -> str:
    """An ``attachment`` header naming ``filename`` (RFC 6266, with an ASCII fallback)."""
    if filename.isascii() and filename.isprintable() and not re.search(r'["\\]', filename):
        return f'attachment; filename="{filename}"'
    fallback = "".join(
        c if c.isascii() and c.isprintable() and c not in '"\\' else "_" for c in filename
    )
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"
