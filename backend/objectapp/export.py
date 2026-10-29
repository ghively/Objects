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
the first attachment with that file name. Exporting reads only; the
zip is built in memory.
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING
from urllib.parse import quote, unquote

from .media import Attachment, NotServed, attachment_path, list_attachments
from .relink import code_ranges, wikilink_targets
from .typedefs import read_raw

if TYPE_CHECKING:
    from .space import Space

__all__ = ["Export", "content_disposition", "export_object", "referenced_media"]

# ``![alt](path "title")`` / ``[text](<path with spaces>)``: the destination only.
_MD_LINK_RE = re.compile(r"!?\[[^\]\n]*\]\(\s*(?:<([^>\n]*)>|([^)\s]+))[^)\n]*\)")
_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


class Export:
    """A download: its bytes, file name and media type."""

    def __init__(self, data: bytes, filename: str, media_type: str) -> None:
        self.data = data
        self.filename = filename
        self.media_type = media_type


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


def export_object(space: Space, path: str, media: bool) -> Export:
    """The export of the object at ``path``. Writes nothing.

    Raises `ValueError` (not an object path, 400) and `KeyError` (no such file, 404).
    """
    rel = space._rel(path)
    full = space.root / rel
    if not full.is_file():
        raise KeyError(rel)
    stem = PurePosixPath(rel).stem
    if not media:
        return Export(full.read_bytes(), f"{stem}.md", "text/markdown; charset=utf-8")
    raw = read_raw(space.root, rel)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, strict_timestamps=False) as zf:
        zf.writestr(f"{stem}.md", raw.data)
        for item in referenced_media(space.root, rel, raw.fm, raw.of.body):
            try:
                zf.write(space.root / item, item)
            except OSError:
                continue  # gone or unreadable since it was found: skipped like a missing one
    return Export(buf.getvalue(), f"{stem}.zip", "application/zip")


def content_disposition(filename: str) -> str:
    """An ``attachment`` header naming ``filename`` (RFC 6266, with an ASCII fallback)."""
    if filename.isascii() and filename.isprintable() and not re.search(r'["\\]', filename):
        return f'attachment; filename="{filename}"'
    fallback = "".join(
        c if c.isascii() and c.isprintable() and c not in '"\\' else "_" for c in filename
    )
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"
