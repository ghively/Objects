"""``.pdf``: the text layer, page by page. A page with no (or a negligible) text layer that holds an
image is a scanned page: "Needs OCR", read with a local ``tesseract`` when one is installed and merged
in page order, so a mixed PDF (text pages and scanned pages) keeps every page's text. English only:
``tesseract`` is called without ``-l``.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from pypdf import PdfReader

from .model import ReadResult
from .util import iso

# A page whose text layer has fewer non-space characters than this, and holds an image, is scanned
# (a scanner's stamp such as "Scanned by ..." is no text layer).
NEGLIGIBLE_TEXT = 32


def ocr_engine() -> str | None:
    """The path of a local OCR engine (``tesseract``), or None. Nothing is ever sent anywhere."""
    return shutil.which("tesseract")


def _ocr_image(engine: str, name: str, data: bytes, tmp: Path, n: int) -> str | None:
    """One image's OCR text ("" when it has none), or None when the engine failed."""
    f = tmp / f"i{n}{Path(name).suffix or '.png'}"
    f.write_bytes(data)
    try:
        r = subprocess.run([engine, str(f), "stdout"], capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    return (r.stdout or "").strip()


def _page_images(page) -> list:
    try:
        return list(page.images)
    except Exception:  # an image filter pypdf can't decode: nothing to OCR on this page
        return []


def _ocr_page(page, engine: str, tmp: Path, counter: list[int]) -> str:
    out: list[str] = []
    for img in _page_images(page):
        counter[0] += 1
        text = _ocr_image(engine, img.name, img.data, tmp, counter[0])
        if text:
            out.append(text)
    return "\n\n".join(out)


def _negligible(text: str) -> bool:
    return sum(1 for c in text if not c.isspace()) < NEGLIGIBLE_TEXT


def _pages_label(pages: list[int]) -> str:
    return ("page " if len(pages) == 1 else "pages ") + ", ".join(str(n) for n in pages)


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
    no_text_layer = not any(pages)
    # The scanned pages: every page when the PDF has no text layer at all (as before), else each page
    # with a negligible text layer that holds an image (a mixed PDF).
    scanned = [i for i, t in enumerate(pages) if no_text_layer or (_negligible(t) and _page_images(reader.pages[i]))]
    engine = ocr_engine() if scanned else None
    read_pages: list[int] = []
    if engine:
        counter = [0]
        with tempfile.TemporaryDirectory() as tmp:
            for i in scanned:
                ocr = _ocr_page(reader.pages[i], engine, Path(tmp), counter)
                if ocr:
                    pages[i] = ocr
                    read_pages.append(i + 1)
    text = "\n\n".join(p for p in pages if p)
    if no_text_layer:
        notes.append("Needs OCR: read with the local OCR engine" if engine and text else "Needs OCR")
    elif scanned:
        unread = [i + 1 for i in scanned if i + 1 not in read_pages]
        if read_pages:
            notes.append(f"Needs OCR: {_pages_label(read_pages)} read with the local OCR engine")
        if unread:
            verb = "has" if len(unread) == 1 else "have"
            notes.append(f"Needs OCR: {_pages_label(unread)} {verb} no text layer")
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
