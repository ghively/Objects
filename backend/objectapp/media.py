"""Image files in a space: listing, importing (into ``Attachments/``) and serving.

Only image files (`IMAGE_EXTENSIONS`) inside the space and outside dot-folders
are listed or served; anything else is refused by the route (415 for another
extension, 404 for a path outside the space or in a dot-folder).
"""

from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

from .space import safe_filename
from .textfile import create_new

__all__ = [
    "ATTACHMENTS",
    "IMAGE_EXTENSIONS",
    "NotAnImage",
    "image_media_type",
    "image_path",
    "import_image",
    "is_image_name",
    "list_images",
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


def list_images(root: Path) -> list[dict[str, str]]:
    """``[{path}]`` for every image file in the space outside dot-folders, sorted by path."""
    root = Path(root)
    out: list[str] = []
    for p in root.rglob("*"):
        rel = p.relative_to(root)
        if _hidden(rel.parts) or not is_image_name(p.name):
            continue
        try:
            if p.is_file():
                out.append(rel.as_posix())
        except OSError:
            continue
    return [{"path": p} for p in sorted(out)]


def image_path(root: Path, path: str) -> Path:
    """The file an image request names, checked to be inside the space.

    Raises `NotAnImage` for another extension and `FileNotFoundError` for a path
    outside the space, inside a dot-folder, or missing.
    """
    root = Path(root).resolve()
    text = str(path or "").replace("\\", "/")
    rel = PurePosixPath(text)
    if not text or rel.is_absolute() or ".." in rel.parts or re.match(r"^[A-Za-z]:", text):
        raise FileNotFoundError(path)
    if _hidden(rel.parts):
        raise FileNotFoundError(path)
    if not is_image_name(rel.name):
        raise NotAnImage(path)
    full = (root / rel).resolve()
    if not full.is_relative_to(root) or not full.is_file():
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

    Raises `NotAnImage` when ``name`` has no image extension.
    """
    stem, ext = _safe_image_name(name)
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
