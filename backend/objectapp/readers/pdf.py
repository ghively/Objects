"""``.pdf``: the text layer, page by page. A page with no (or a negligible) text layer that holds an
image is a scanned page: "Needs OCR", read with a local ``tesseract`` when one is installed and merged
in page order, so a mixed PDF (text pages and scanned pages) keeps every page's text.

Languages: the engine is asked once per process which languages it has (``tesseract --list-langs``,
cached; ``osd`` is no language) and every one goes into ``-l eng+deu+...``, so a scan in any installed
language is read. The ``ocrLanguages`` device setting (``eng+deu``) names the languages instead when it
is set. When the list can't be read and the setting is empty, ``tesseract`` is called without ``-l``
(its own default, English).

OCR text is cached in memory by the sha256 of each image's bytes (bounded, never written anywhere), so
the import wizard's sensitive-content scan, the import's own scan and the import's reader read each
scanned page once.
"""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import tempfile
import threading
from collections import OrderedDict
from pathlib import Path

from pypdf import PdfReader

from .model import ReadResult
from .util import iso

# A page whose text layer has fewer non-space characters than this, and holds an image, is scanned
# (a scanner's stamp such as "Scanned by ..." is no text layer).
NEGLIGIBLE_TEXT = 32
OCR_CACHE_MAX = 1024  # images; a page's text is a few kB at most
_OCR_CACHE: OrderedDict[str, str] = OrderedDict()
_OCR_LOCK = threading.Lock()
# Per engine path: its installed languages, or None when ``--list-langs`` could not be read.
_LANGS_CACHE: dict[str, list[str] | None] = {}
# A Tesseract language code: ``eng``, ``deu``, ``chi_sim`` (the ``ocrLanguages`` setting's rule too).
_LANG_CODE = re.compile(r"[a-z_]{3,}")


def ocr_engine() -> str | None:
    """The path of a local OCR engine (``tesseract``), or None. Nothing is ever sent anywhere."""
    return shutil.which("tesseract")


def clear_ocr_cache() -> None:
    """Forget the OCR text and the installed-languages answer (tests)."""
    with _OCR_LOCK:
        _OCR_CACHE.clear()
        _LANGS_CACHE.clear()


def parse_list_langs(output: str) -> list[str]:
    """The language codes in ``tesseract --list-langs`` output: a header line ("List of available
    languages (3):") then one code per line. ``osd`` (orientation and script detection) is no
    language, and a line that is no code (an error, a ``script/`` name) is left out."""
    out: list[str] = []
    for line in output.splitlines():
        code = line.strip()
        if code and code != "osd" and _LANG_CODE.fullmatch(code) and code not in out:
            out.append(code)
    return out


def installed_languages(engine: str) -> list[str] | None:
    """The engine's installed languages, asked once per process; None when the list can't be
    read (the engine failed or printed no code)."""
    with _OCR_LOCK:
        if engine in _LANGS_CACHE:
            return _LANGS_CACHE[engine]
    langs: list[str] | None
    try:
        r = subprocess.run([engine, "--list-langs"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        langs = None
    else:
        # Older engines print the list to stderr.
        langs = parse_list_langs((r.stdout or "") + "\n" + (r.stderr or "")) if r.returncode == 0 else None
        if not langs:
            langs = None
    with _OCR_LOCK:
        _LANGS_CACHE[engine] = langs
    return langs


def language_arg(installed: list[str] | None, setting: str | None) -> list[str]:
    """The ``-l`` arguments of an OCR call: the ``ocrLanguages`` setting as given when it is set,
    else every installed language joined with ``+``; nothing when neither is known."""
    chosen = setting.strip() if isinstance(setting, str) else ""
    if not chosen and installed:
        chosen = "+".join(installed)
    return ["-l", chosen] if chosen else []


def configured_languages() -> str:
    """The ``ocrLanguages`` device setting; "" when it is unset or the settings file can't be read
    (a reader never stops an import over it)."""
    from .. import settings

    try:
        value = settings.read()[0].get("ocrLanguages")
    except Exception:  # `ReadOnly` (a damaged settings.json) or an unreadable state dir
        return ""
    return value if isinstance(value, str) else ""


def ocr_languages(engine: str) -> list[str]:
    """The ``-l`` arguments for `engine` (see `language_arg`)."""
    return language_arg(installed_languages(engine), configured_languages())


def _ocr_image(engine: str, name: str, data: bytes, tmp: Path, n: int, langs: list[str]) -> str | None:
    """One image's OCR text ("" when it has none), or None when the engine failed (not cached).
    `langs`: the ``-l`` arguments (`ocr_languages`); the cache is per engine and language set."""
    key = hashlib.sha256(engine.encode("utf-8") + b"\0" + "+".join(langs).encode("utf-8") + b"\0" + data).hexdigest()
    with _OCR_LOCK:
        hit = _OCR_CACHE.get(key)
        if hit is not None:
            _OCR_CACHE.move_to_end(key)
            return hit
    f = tmp / f"i{n}{Path(name).suffix or '.png'}"
    f.write_bytes(data)
    try:
        r = subprocess.run([engine, str(f), "stdout", *langs], capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    text = (r.stdout or "").strip()
    with _OCR_LOCK:
        _OCR_CACHE[key] = text
        while len(_OCR_CACHE) > OCR_CACHE_MAX:
            _OCR_CACHE.popitem(last=False)
    return text


def _page_images(page) -> list:
    try:
        return list(page.images)
    except Exception:  # an image filter pypdf can't decode: nothing to OCR on this page
        return []


def _ocr_page(page, engine: str, tmp: Path, counter: list[int], langs: list[str]) -> str:
    out: list[str] = []
    for img in _page_images(page):
        counter[0] += 1
        text = _ocr_image(engine, img.name, img.data, tmp, counter[0], langs)
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
        langs = ocr_languages(engine)
        with tempfile.TemporaryDirectory() as tmp:
            for i in scanned:
                ocr = _ocr_page(reader.pages[i], engine, Path(tmp), counter, langs)
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
