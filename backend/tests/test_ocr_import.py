"""M26 OCR and \"Original only\" through a real Files import (real readers, synthetic files).

The OCR test needs a local ``tesseract`` with English data and is skipped without one.
"""

from __future__ import annotations

import io
import shutil
import subprocess
import time

import pytest
from fastapi.testclient import TestClient
from m15_helpers import wait_job
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter

from objectapp.server import create_app
from objectapp.space import Space


@pytest.fixture
def client(space_dir):
    app = create_app(Space(space_dir), watch=False)
    with TestClient(app) as c:
        c.space_root = space_dir  # type: ignore[attr-defined]
        yield c


def run(client, source) -> dict:
    r = client.post("/api/import/preview", json={"source": {"path": str(source), "kind": "files"}, "target": "currentSpace"})
    assert r.status_code == 200, r.text
    preview = r.json()
    r = client.post("/api/import/start", json={"previewId": preview["previewId"], "mapping": preview["mapping"],
                                               "target": {"kind": "currentSpace"}})
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"], timeout=120)
    assert job["phase"] == "done", job
    return job["result"]


def _font(size: int):
    for p in ("/usr/share/fonts/TTF/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
              "/Library/Fonts/Arial.ttf", "C:/Windows/Fonts/arial.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _page(lines: list[str]) -> Image.Image:
    im = Image.new("L", (1700, 1100), 255)
    d = ImageDraw.Draw(im)
    for i, line in enumerate(lines):
        d.text((150, 200 + 110 * i), line, fill=0, font=_font(56))
    return im


def test_original_only_is_reported_once(client, tmp_path):
    """A file with no readable page: the report says "Original only" once, not three times
    (the reader's note, the Files page's note and the writer's line). An image is an Image
    object (AC-2), never "Original only"."""
    src = tmp_path / "Media"
    src.mkdir()
    (src / "clip.mp3").write_bytes(b"ID3 synthetic audio bytes")
    _page(["Hello"]).save(src / "photo.png")
    res = run(client, src)
    report = (client.space_root / res["reportPath"]).read_text(encoding="utf-8")
    lines = [ln for ln in report.splitlines() if "`clip.mp3`" in ln]
    assert lines == ["- [[clip]] (`clip.mp3`): `Original only: no readable page could be made`"], lines
    assert not [ln for ln in report.splitlines() if "`photo.png`" in ln]


def _has_eng() -> bool:
    exe = shutil.which("tesseract")
    if not exe:
        return False
    try:
        out = subprocess.run([exe, "--list-langs"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return "eng" in (out.stdout + out.stderr).split()


@pytest.mark.skipif(not _has_eng(), reason="needs a local tesseract with English data")
def test_scanned_pdf_is_ocrd_and_searchable(client, tmp_path):
    src = tmp_path / "Scans"
    src.mkdir()
    p1 = _page(["Synthetic Scan Report", "Zebrafish counter reads 4217"])
    p2 = _page(["Second page", "Marmalade protocol checklist"])
    p1.save(src / "scan.pdf", save_all=True, append_images=[p2], resolution=200)  # images only, no text layer
    res = run(client, src)
    page = (client.space_root / "Pages" / "scan.md").read_text(encoding="utf-8")
    assert "![[Attachments/Originals/scan.pdf]]" in page
    assert "Zebrafish" in page and "Marmalade" in page
    report = (client.space_root / res["reportPath"]).read_text(encoding="utf-8")
    assert "`Needs OCR: read with the local OCR engine`" in report
    deadline = time.monotonic() + 30
    while True:  # the import's reindex runs in the background; "partial" until it is done
        hits = client.get("/api/search", params={"q": "Marmalade"}).json()
        if not hits.get("partial") or time.monotonic() > deadline:
            break
        time.sleep(0.1)
    assert any(h.get("path") == "Pages/scan.md" for h in hits["results"]), hits


# -- mixed PDFs and OCR once per page (decisions memo 2026-11-08, OCR) ------------------------------


def _text_pdf(text: str) -> bytes:
    """A one-page PDF with a real text layer (Helvetica), written by hand."""
    stream = b"BT /F1 14 Tf 20 60 Td (" + text.encode("latin-1") + b") Tj ET"
    objs = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 600 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
        b"<</Length %d>>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")  # BytesIO(initial) would start writing at 0, over the header
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(out.tell())
        out.write(b"%d 0 obj\n" % i + o + b"\nendobj\n")
    x = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for o in offs:
        out.write(b"%010d 00000 n \n" % o)
    out.write(b"trailer\n<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, x))
    return out.getvalue()


def _scan_pdf(lines: list[str]) -> bytes:
    buf = io.BytesIO()
    _page(lines).save(buf, format="PDF", resolution=200)
    return buf.getvalue()


def mixed_pdf(path, scanned_lines: list[str]) -> None:
    """Three pages: text, scanned (an image, no text layer), text."""
    w = PdfWriter()
    for part in (_text_pdf("Alpha text layer page one about kestrels"), _scan_pdf(scanned_lines),
                 _text_pdf("Gamma text layer page three about otters")):
        w.append(PdfReader(io.BytesIO(part)))
    with open(path, "wb") as f:
        w.write(f)


class FakeTesseract:
    """Stands in for ``tesseract`` (``subprocess.run`` in the PDF reader): counts calls."""

    def __init__(self, text: str):
        self.text = text
        self.calls = 0

    def __call__(self, args, **_kw):
        self.calls += 1
        return subprocess.CompletedProcess(args, 0, stdout=self.text + "\n", stderr="")


@pytest.fixture
def fake_ocr(monkeypatch):
    from objectapp.readers import pdf

    fake = FakeTesseract("Beta scanned page about herons")
    monkeypatch.setattr(pdf, "ocr_engine", lambda: "/fake/tesseract")
    monkeypatch.setattr(pdf.subprocess, "run", fake)
    if hasattr(pdf, "clear_ocr_cache"):
        pdf.clear_ocr_cache()
    yield fake
    if hasattr(pdf, "clear_ocr_cache"):
        pdf.clear_ocr_cache()


def test_mixed_pdf_ocrs_the_scanned_page_in_order(tmp_path, fake_ocr):
    from objectapp import readers

    p = tmp_path / "mixed.pdf"
    mixed_pdf(p, ["Beta"])
    r = readers.read_file(p)
    md = r.markdown
    assert "Alpha" in md and "herons" in md and "Gamma" in md, md
    assert md.index("Alpha") < md.index("herons") < md.index("Gamma")
    assert fake_ocr.calls == 1  # only the scanned page; text pages are never OCR'd
    assert r.notes == ["Needs OCR: page 2 read with the local OCR engine"]


def test_mixed_pdf_without_an_engine_says_which_page(tmp_path, monkeypatch):
    from objectapp import readers
    from objectapp.readers import pdf

    monkeypatch.setattr(pdf, "ocr_engine", lambda: None)
    p = tmp_path / "mixed.pdf"
    mixed_pdf(p, ["Beta"])
    r = readers.read_file(p)
    assert "Alpha" in r.markdown and "Gamma" in r.markdown
    assert r.notes == ["Needs OCR: page 2 has no text layer"]


@pytest.mark.skipif(not _has_eng(), reason="needs a local tesseract with English data")
def test_mixed_pdf_import_with_real_tesseract(client, tmp_path):
    from objectapp.readers import pdf

    if hasattr(pdf, "clear_ocr_cache"):
        pdf.clear_ocr_cache()
    src = tmp_path / "Mixed"
    src.mkdir()
    mixed_pdf(src / "mixed.pdf", ["Scanned middle page", "Marmalade protocol checklist"])
    res = run(client, src)
    page = (client.space_root / "Pages" / "mixed.md").read_text(encoding="utf-8")
    assert page.index("Alpha") < page.index("Marmalade") < page.index("Gamma"), page
    report = (client.space_root / res["reportPath"]).read_text(encoding="utf-8")
    assert "`Needs OCR: page 2 read with the local OCR engine`" in report


def test_scan_then_import_ocrs_each_page_once(client, tmp_path, fake_ocr):
    """The wizard's sensitive-content scan reads the PDF (with OCR); the import reuses that OCR text."""
    src = tmp_path / "Scans"
    src.mkdir()
    p1 = _page(["First scanned page"])
    p2 = _page(["Second scanned page"])
    p1.save(src / "scan.pdf", save_all=True, append_images=[p2], resolution=200)
    r = client.post("/api/import/scan", json={"path": str(src), "leaveOut": []})
    assert r.status_code == 200, r.text
    assert fake_ocr.calls == 2
    run(client, src)
    assert fake_ocr.calls == 2, "the import OCR'd the pages again"
    page = (client.space_root / "Pages" / "scan.md").read_text(encoding="utf-8")
    assert "herons" in page
    # The cache is in memory: nothing about it lands in the space.
    assert not [p for p in client.space_root.rglob("*") if "ocr" in p.name.lower()]


def test_failed_ocr_is_not_cached(tmp_path, fake_ocr, monkeypatch):
    from objectapp import readers
    from objectapp.readers import pdf

    p = tmp_path / "scan.pdf"
    _page(["Only page"]).save(p, resolution=200)
    monkeypatch.setattr(pdf.subprocess, "run", lambda args, **_kw: subprocess.CompletedProcess(args, 1, "", "boom"))
    assert readers.read_file(p).notes == ["Needs OCR"]
    monkeypatch.setattr(pdf.subprocess, "run", fake_ocr)
    r = readers.read_file(p)
    assert "herons" in r.markdown and fake_ocr.calls == 1
