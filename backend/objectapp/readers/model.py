"""The result of reading one file (M26 contract; the M25 importer consumes it)."""

from __future__ import annotations

from dataclasses import dataclass, field

__all__ = ["ExtractedImage", "ReadResult", "TABLE_MAX_COLS", "TABLE_MAX_ROWS"]

TABLE_MAX_ROWS = 200
TABLE_MAX_COLS = 20


@dataclass
class ExtractedImage:
    """An image found inside a document; ``markdown`` refers to it as ``![](name)``."""

    name: str
    data: bytes
    content_type: str


@dataclass
class ReadResult:
    title: str
    markdown: str = ""
    images: list[ExtractedImage] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)  # conversion losses, listed in the report
    original_only: bool = False
    created: str | None = None  # ISO 8601
    modified: str | None = None
    author: str | None = None
