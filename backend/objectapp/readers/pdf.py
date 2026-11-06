"""``.pdf``: the text layer. A PDF with none is "Needs OCR"; a local ``tesseract`` is used when installed."""

from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
from pathlib import Path

from pypdf import PdfReader

from .model import ReadResult
from .util import iso


def ocr_engine() -> str | None:
    """The path of a local OCR engine (``tesseract``), or None. Nothing is ever sent anywhere."""
    return shutil.which("tesseract")


def _ocr_images(reader: PdfReader, engine: str) -> str:
    out: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        for n, page in enumerate(reader.pages, 1):
            for k, img in enumerate(page.images):
                f = Path(tmp) / f"p{n}-{k}{Path(img.name).suffix or '.png'}"
                f.write_bytes(img.data)
                try:
                    r = subprocess.run([engine, str(f), "stdout"], capture_output=True, text=True, timeout=120)
                except (OSError, subprocess.TimeoutExpired):
                    continue
                if r.returncode == 0 and r.stdout.strip():
                    out.append(r.stdout.strip())
    return "\n\n".join(out)


def read(path: Path) -> ReadResult:
    notes: list[str] = []
    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                pass
        pages = [(p.extract_text() or "").strip() for p in reader.pages]
    except Exception as e:  # damaged or encrypted: keep the original only
        return ReadResult(title=path.stem, original_only=True, notes=[f"Could not read the PDF ({type(e).__name__})", "Original only"])
    meta = reader.metadata
    text = "\n\n".join(p for p in pages if p)
    if not text:
        engine = ocr_engine()
        if engine:
            text = _ocr_images(reader, engine)
            notes.append("Needs OCR: read with the local OCR engine" if text else "Needs OCR")
        else:
            notes.append("Needs OCR")
    title = ((meta.title if meta else None) or "").strip() or path.stem
    created = None
    modified = None
    try:
        created = iso(meta.creation_date) if meta else None
        modified = iso(meta.modification_date) if meta else None
    except Exception:
        pass
    return ReadResult(
        title=title,
        markdown=(text + "\n") if text else "",
        notes=notes,
        created=created,
        modified=modified,
        author=((meta.author if meta else None) or "").strip() or None,
    )
