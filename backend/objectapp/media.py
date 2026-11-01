"""Attachments in a space: listing, importing (into ``Attachments/``), serving and opening.

M2's image functions (`list_images`, `image_path`, `import_image`) serve the cover-image
picker unchanged. M7 adds attachments of every kind (`kind_of`): `list_attachments`,
`attachment_path`, `import_attachment`, `serve_headers` and `open_with_system`.

Only files inside the space and outside dot-folders are listed or served (404 for a path
outside the space or in a dot-folder; 415 for an object's ``.md``). A whiteboard's sidecar
files (``<stem>.ink.svg`` and ``<stem>.whiteboard.json`` beside ``<stem>.md``, M6) are
neither listed nor served: the whiteboard routes own them.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path, PurePosixPath
from typing import Literal, TypedDict
from urllib.parse import quote

from .space import safe_filename
from .textfile import create_new
from .whiteboardfile import INK_SUFFIX, sidecar_owner

__all__ = [
    "ATTACHMENTS",
    "IMAGE_EXTENSIONS",
    "MAX_ATTACHMENT_BYTES",
    "MARKDOWN_UPLOAD_DETAIL",
    "OPENABLE_EXTENSIONS",
    "REFUSED_OPEN_DETAIL",
    "Attachment",
    "AttachmentKind",
    "MarkdownUpload",
    "NotAnImage",
    "NotServed",
    "RefusedToOpen",
    "TooLarge",
    "attachment_media_type",
    "attachment_path",
    "image_media_type",
    "image_path",
    "import_attachment",
    "import_image",
    "is_image_name",
    "kind_of",
    "list_attachments",
    "list_images",
    "open_with_system",
    "serve_headers",
]

ATTACHMENTS = "Attachments"

IMAGE_EXTENSIONS: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}


class NotAnImage(ValueError):
    """The name or path doesn't have an image extension (415)."""


def is_image_name(name: str) -> bool:
    return PurePosixPath(name).suffix.lower() in IMAGE_EXTENSIONS


def image_media_type(name: str) -> str:
    return IMAGE_EXTENSIONS[PurePosixPath(name).suffix.lower()]


def _hidden(parts: tuple[str, ...]) -> bool:
    return any(p.startswith(".") for p in parts)


def _is_ink_sidecar(root: Path, rel: str) -> bool:
    """True for ``<stem>.ink.svg`` with a ``<stem>.md`` beside it (a whiteboard's ink)."""
    if not rel.lower().endswith(INK_SUFFIX):
        return False
    stem = rel[: -len(INK_SUFFIX)]
    if not stem or stem.endswith("/"):
        return False
    try:
        return (Path(root) / f"{stem}.md").is_file()
    except OSError:
        return False


def _ext(name: str) -> str:
    """``PurePosixPath(name).suffix.lower()`` without building a path (listing walks call
    it per file; audit 2026-11-01 B7)."""
    base = str(name or "").rstrip("/").rsplit("/", 1)[-1]
    i = base.rfind(".")
    if i <= 0 or i == len(base) - 1:
        return ""
    return base[i:].lower()


def _walk(root: Path) -> Iterator[tuple[str, os.DirEntry[str]]]:
    """``(space-relative POSIX path, entry)`` of every file under `root` outside dot-folders.

    Dot-folders (``.git``, ``.trash``, ``.capacities-cache``) are pruned before they are
    read, not filtered after (`rglob` walked 20,000 ``.git`` files per listing, audit
    2026-11-01 B7); dot-files are skipped; symlinked folders are not followed and a folder
    that can't be read is skipped, as with `rglob`.
    """
    stack = [(str(root), "")]
    while stack:
        folder, prefix = stack.pop()
        try:
            with os.scandir(folder) as it:
                entries = list(it)
        except OSError:
            continue
        for entry in entries:
            name = entry.name
            if name.startswith("."):
                continue
            try:
                if entry.is_dir(follow_symlinks=False):
                    stack.append((entry.path, f"{prefix}{name}/"))
                    continue
                if not entry.is_file():
                    continue
            except OSError:
                continue
            yield f"{prefix}{name}", entry


def list_images(root: Path) -> list[dict[str, str]]:
    """``[{path}]`` for every image file in the space outside dot-folders, sorted by path."""
    root = Path(root)
    out: list[str] = []
    for rel, _entry in _walk(root):
        if _ext(rel) not in IMAGE_EXTENSIONS:
            continue
        if rel.lower().endswith(INK_SUFFIX) and _is_ink_sidecar(root, rel):
            continue
        out.append(rel)
    return [{"path": p} for p in sorted(out)]


def image_path(root: Path, path: str) -> Path:
    """The file an image request names, checked to be inside the space.

    Raises `NotAnImage` for another extension and `FileNotFoundError` for a path
    outside the space, inside a dot-folder, or missing.
    """
    root = Path(root).resolve()
    text = str(path or "").replace("\\", "/")
    rel = PurePosixPath(text)
    if not text or "\x00" in text or rel.is_absolute() or ".." in rel.parts:
        raise FileNotFoundError(path)
    if re.match(r"^[A-Za-z]:", text):
        raise FileNotFoundError(path)
    if _hidden(rel.parts):
        raise FileNotFoundError(path)
    if not is_image_name(rel.name):
        raise NotAnImage(path)
    full = (root / rel).resolve()
    if not full.is_relative_to(root) or not full.is_file():
        raise FileNotFoundError(path)
    if _is_ink_sidecar(root, full.relative_to(root).as_posix()):
        raise FileNotFoundError(path)
    return full


def _safe_image_name(name: str) -> tuple[str, str]:
    """(stem, extension) of an uploaded file name, made safe for the file system."""
    base = re.split(r"[\\/]", str(name or ""))[-1]
    p = PurePosixPath(base)
    ext = p.suffix.lower()
    if ext not in IMAGE_EXTENSIONS:
        raise NotAnImage(name)
    return safe_filename(base[: -len(p.suffix)]), ext


def import_image(root: Path, name: str, data: bytes) -> str:
    """Write ``data`` to ``Attachments/<safe name>`` (`` (2)``... when taken); return the path.

    Raises `NotAnImage` when ``name`` has no image extension, `TooLarge` over
    `MAX_ATTACHMENT_BYTES` and `ValueError` for an empty upload (as `import_attachment`).
    """
    stem, ext = _safe_image_name(name)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise TooLarge(name)
    if not data:
        raise ValueError("The file is empty")
    folder = Path(root) / ATTACHMENTS
    folder.mkdir(parents=True, exist_ok=True)
    n = 1
    while True:
        file_name = f"{stem}{ext}" if n == 1 else f"{stem} ({n}){ext}"
        full = folder / file_name
        taken = {p.name.lower() for p in folder.iterdir()}

        if file_name.lower() not in taken:
            try:
                create_new(full, data)
            except FileExistsError:
                pass
            else:
                return f"{ATTACHMENTS}/{file_name}"
        n += 1


# --- M7: attachments of every kind ---------------------------------------------------------

AttachmentKind = Literal["image", "pdf", "audio", "video", "file"]


class Attachment(TypedDict):
    path: str
    kind: AttachmentKind
    size: int


MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
"""Capacities' upload limit (``EntityPicker.uploadLimitSize``: 100 MiB)."""

UPLOAD_LIMIT_DETAIL = (
    "You can only upload files up to 100 MiB in size. "
    "If your file is bigger than that, it will fail."
)

PDF_MEDIA_TYPES = {".pdf": "application/pdf"}
AUDIO_MEDIA_TYPES = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".opus": "audio/opus",
    ".weba": "audio/webm",  # M8: audio recordings (WebM audio)
}
VIDEO_MEDIA_TYPES = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".ogv": "video/ogg",
}

# Document and archive extensions `open_with_system` may hand to the OS, beside the
# image, PDF, audio and video kinds `kind_of` knows. A whitelist (audit 2026-11-01
# #5, Gene's call): anything else, in particular whatever the OS might run
# (`.exe`, `.py`, `.desktop`, `.appimage`...), is refused, so a space received from
# someone else can't launch a program through Object.
DOCUMENT_OPEN_EXTENSIONS = frozenset({
    "txt", "rtf", "csv", "tsv", "json", "xml", "yaml", "yml", "log",
    "doc", "docx", "dot", "dotx", "odt", "ott", "pages",
    "xls", "xlsx", "xlsm", "ods", "ots", "numbers",
    "ppt", "pptx", "pps", "ppsx", "odp", "otp", "key",
    "epub", "mobi", "azw", "azw3", "djvu", "xps", "oxps", "tex", "bib",
})
ARCHIVE_OPEN_EXTENSIONS = frozenset({
    "zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "tbz2", "xz", "txz", "zst", "lz", "lzma",
})


def _openable_extensions() -> frozenset[str]:
    media = (IMAGE_EXTENSIONS, PDF_MEDIA_TYPES, AUDIO_MEDIA_TYPES, VIDEO_MEDIA_TYPES)
    return frozenset(
        {ext.lstrip(".") for table in media for ext in table}
        | DOCUMENT_OPEN_EXTENSIONS
        | ARCHIVE_OPEN_EXTENSIONS
    )


OPENABLE_EXTENSIONS = _openable_extensions()

REFUSED_OPEN_DETAIL = (  # our string
    "Object only opens documents, images, audio, video, PDFs and archives. "
    "Open it from the file manager instead."
)

_IMAGE_SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
_EXT_RE = re.compile(r"[a-z0-9]{1,10}")


class NotServed(ValueError):
    """An object's ``.md`` file: objects are opened, not served (415)."""


class MarkdownUpload(ValueError):
    """An upload named ``*.md``: in the space it would be an object, not a file (415)."""


MARKDOWN_UPLOAD_DETAIL = "A Markdown file can't be added as an attachment: it would become an object."


class TooLarge(ValueError):
    """An upload over `MAX_ATTACHMENT_BYTES` (413)."""


class RefusedToOpen(ValueError):
    """An executable or script the app won't hand to the OS (415)."""


_KIND_BY_EXT: dict[str, AttachmentKind] = {
    **dict.fromkeys(IMAGE_EXTENSIONS, "image"),
    **dict.fromkeys(PDF_MEDIA_TYPES, "pdf"),
    **dict.fromkeys(AUDIO_MEDIA_TYPES, "audio"),
    **dict.fromkeys(VIDEO_MEDIA_TYPES, "video"),
}
_MEDIA_TYPE_BY_EXT = {**IMAGE_EXTENSIONS, **PDF_MEDIA_TYPES, **AUDIO_MEDIA_TYPES, **VIDEO_MEDIA_TYPES}


def kind_of(name: str) -> AttachmentKind:
    """The attachment kind of a file name, by its (case-insensitive) extension."""
    return _KIND_BY_EXT.get(_ext(name), "file")


def attachment_media_type(name: str) -> str:
    """The ``Content-Type`` a file is served with (``application/octet-stream`` for a `file`)."""
    return _MEDIA_TYPE_BY_EXT.get(_ext(name), "application/octet-stream")


def _is_sidecar(root: Path, rel: str) -> bool:
    """True for a whiteboard sidecar (``.ink.svg`` / ``.whiteboard.json``) whose ``.md`` exists."""
    owner = sidecar_owner(rel)
    if owner is None:
        return False
    try:
        return (Path(root) / owner).is_file()
    except OSError:
        return False


def attachment_path(root: Path, path: str) -> Path:
    """The file an attachment request names, checked to be inside the space.

    Raises `FileNotFoundError` for a path that is empty, absolute, has a drive letter or
    ``..``, lies in a dot-folder or outside the space, is missing, or is a whiteboard
    sidecar; raises `NotServed` for a ``.md`` file.
    """
    root = Path(root).resolve()
    text = str(path or "").replace("\\", "/")
    rel = PurePosixPath(text)
    if not text or "\x00" in text or rel.is_absolute() or ".." in rel.parts:
        raise FileNotFoundError(path)
    if re.match(r"^[A-Za-z]:", text):
        raise FileNotFoundError(path)
    if _hidden(rel.parts):
        raise FileNotFoundError(path)
    full = (root / rel).resolve()
    if not full.is_relative_to(root) or not full.is_file():
        raise FileNotFoundError(path)
    real_rel = full.relative_to(root)
    if _hidden(real_rel.parts) or _is_sidecar(root, real_rel.as_posix()):
        raise FileNotFoundError(path)
    if full.suffix.lower() == ".md":
        raise NotServed(path)
    return full


def list_attachments(root: Path) -> list[Attachment]:
    """Every attachment in the space, sorted by path.

    A file outside dot-folders whose kind isn't ``file``, plus every file under
    ``Attachments/``. Objects (``.md``) and whiteboard sidecars are never listed; a file
    that can't be read (stat fails) is skipped.
    """
    root = Path(root)
    out: list[Attachment] = []
    for rel, entry in _walk(root):
        ext = _ext(rel)
        kind = _KIND_BY_EXT.get(ext, "file")
        if kind == "file" and rel.split("/", 1)[0] != ATTACHMENTS:
            continue
        if ext == ".md":
            continue
        if (ext == ".json" or ext == ".svg") and _is_sidecar(root, rel):
            continue  # sidecar names end in .whiteboard.json / .ink.svg
        try:
            size = entry.stat().st_size
        except OSError:
            continue
        out.append({"path": rel, "kind": kind, "size": size})
    out.sort(key=lambda a: a["path"])
    return out


def _safe_attachment_name(name: str) -> tuple[str, str]:
    """(stem, extension with its dot or ``""``) of an uploaded file name, made safe."""
    base = re.split(r"[\\/]", str(name or ""))[-1]
    p = PurePosixPath(base)
    suffix = p.suffix
    ext = suffix[1:].lower()
    if suffix and not _EXT_RE.fullmatch(ext):
        # Not a usable extension: the whole name is the stem and none is added.
        suffix, ext = "", ""
    stem_text = base[: -len(suffix)] if suffix else base
    if not stem_text.strip(" ."):
        raise ValueError(f"No usable file name in {name!r}")
    return safe_filename(stem_text), (f".{ext}" if ext else "")


def import_attachment(root: Path, name: str, data: bytes) -> tuple[str, AttachmentKind]:
    """Write ``data`` to ``Attachments/<safe name>.<ext>`` (`` (2)``... when taken).

    Never overwrites (case-insensitive name check, then an atomic create). Returns
    ``(path, kind)``. Raises `TooLarge` over `MAX_ATTACHMENT_BYTES` and `ValueError` for
    an empty upload or a name with no usable stem, and `MarkdownUpload` for a ``.md`` name.
    """
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise TooLarge(name)
    if not data:
        raise ValueError("The file is empty")
    stem, ext = _safe_attachment_name(name)
    if f"{stem}{ext}".lower().endswith(".md"):
        raise MarkdownUpload(name)
    folder = Path(root) / ATTACHMENTS
    folder.mkdir(parents=True, exist_ok=True)
    n = 1
    while True:
        file_name = f"{stem}{ext}" if n == 1 else f"{stem} ({n}){ext}"
        taken = {p.name.lower() for p in folder.iterdir()}
        if file_name.lower() not in taken:
            try:
                create_new(folder / file_name, data)
            except FileExistsError:
                pass
            else:
                return f"{ATTACHMENTS}/{file_name}", kind_of(file_name)
        n += 1


def serve_headers(kind: AttachmentKind, name: str = "") -> dict[str, str]:
    """The response headers for serving a file of ``kind`` (``name`` names a download)."""
    headers = {"X-Content-Type-Options": "nosniff"}
    if kind == "image":
        # An SVG can carry script: never let a served image run anything.
        headers["Content-Security-Policy"] = _IMAGE_SANDBOX_CSP
    elif kind in ("pdf", "audio", "video"):
        headers["Content-Disposition"] = "inline"
    else:
        filename = quote(name or "download", safe="")
        headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{filename}"
    return headers


def open_with_system(full: Path) -> None:
    """Open ``full`` with the OS default app (a list of arguments, never a shell).

    Raises `RefusedToOpen` for anything but a document, image, audio, video, PDF or
    archive extension (`OPENABLE_EXTENSIONS`; no extension counts as refused). With
    ``OBJECT_FAKE_OPEN_FILE`` set (a test hook) the absolute path is appended to that
    file instead.
    """
    full = Path(full)
    if full.suffix.lower().lstrip(".") not in OPENABLE_EXTENSIONS:
        raise RefusedToOpen(str(full))
    fake = os.environ.get("OBJECT_FAKE_OPEN_FILE")
    if fake:
        with open(fake, "a", encoding="utf-8") as f:
            f.write(f"{full.resolve()}\n")
        return
    if sys.platform == "win32":
        os.startfile(os.path.normpath(full))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(full)])
    else:
        subprocess.Popen(["xdg-open", str(full)])
