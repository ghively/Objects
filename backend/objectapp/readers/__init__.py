"""M26 readers: one local reader per file format (no cloud). ``read_file`` never writes anything.

Contract used by the importer: ``read_file(path) -> ReadResult``. ``original_only`` is true for
formats with no readable page (images, audio, video, ``.vsdx`` and other binaries); the importer
keeps the original and, for those, makes an Image or File object. Every other format also gets its
original kept by the importer.
"""

from __future__ import annotations

from pathlib import Path

from . import docx, media, pdf, pptx, sheets, textfiles
from .model import TABLE_MAX_COLS, TABLE_MAX_ROWS, ExtractedImage, ReadResult

__all__ = ["ExtractedImage", "ReadResult", "TABLE_MAX_COLS", "TABLE_MAX_ROWS", "ocr_engine", "read_file", "supported_suffixes"]

ocr_engine = pdf.ocr_engine

_READERS = {
    ".docx": docx.read,
    ".pdf": pdf.read,
    ".xlsx": sheets.read_xlsx,
    ".xlsm": sheets.read_xlsx,
    ".csv": sheets.read_csv,
    ".pptx": pptx.read,
    ".html": textfiles.read_html,
    ".htm": textfiles.read_html,
    ".md": textfiles.read_text,
    ".markdown": textfiles.read_text,
    ".txt": textfiles.read_text,
}
for _s in media.IMAGE:
    _READERS[_s] = media.read_image
for _s in media.AUDIO | media.VIDEO:
    _READERS[_s] = media.read_binary


def supported_suffixes() -> frozenset[str]:
    """Suffixes with a reader; anything else is read as "Original only"."""
    return frozenset(_READERS)


def read_file(path: Path) -> ReadResult:
    """Read one file into a page. Unknown or broken files come back ``original_only``, never raise on content."""
    path = Path(path)
    reader = _READERS.get(path.suffix.lower(), media.read_binary)
    try:
        result = reader(path)
    except Exception as e:  # a damaged document must not stop an import
        return ReadResult(title=path.stem, notes=[f"Could not read ({type(e).__name__})", "Original only"], original_only=True)
    if result.created is None or result.modified is None:
        try:
            st = path.stat()
            from datetime import datetime, timezone

            if result.modified is None:
                result.modified = datetime.fromtimestamp(st.st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except OSError:
            pass
    return result
