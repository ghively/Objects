"""Images (EXIF date), audio and video, and the "Original only" binaries."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from .model import ReadResult

IMAGE = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".svg"}
AUDIO = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac"}
VIDEO = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}


def read_image(path: Path) -> ReadResult:
    created = None
    notes: list[str] = []
    try:
        from PIL import Image

        with Image.open(path) as im:
            exif = im.getexif()
            raw = exif.get_ifd(0x8769).get(0x9003) or exif.get(0x0132)  # DateTimeOriginal, else DateTime
            if raw:
                created = datetime.strptime(str(raw).strip(), "%Y:%m:%d %H:%M:%S").strftime("%Y-%m-%dT%H:%M:%S")
    except Exception:
        pass
    notes.append("Original only")
    return ReadResult(title=path.stem, markdown="", notes=notes, original_only=True, created=created)


def read_binary(path: Path) -> ReadResult:
    return ReadResult(title=path.stem, markdown="", notes=["Original only"], original_only=True)
