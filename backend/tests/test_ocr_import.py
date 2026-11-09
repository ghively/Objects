"""M26 OCR and \"Original only\" through a real Files import (real readers, synthetic files).

The OCR test needs a local ``tesseract`` with English data and is skipped without one.
"""

from __future__ import annotations

import shutil
import subprocess
import time

import pytest
from fastapi.testclient import TestClient
from m15_helpers import wait_job
from PIL import Image, ImageDraw, ImageFont

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


def test_image_original_only_is_reported_once(client, tmp_path):
    """An image has no readable page: the report says "Original only" once, not three times
    (the reader's note, the Files page's note and the writer's line)."""
    src = tmp_path / "Photos"
    src.mkdir()
    _page(["Hello"]).save(src / "photo.png")
    res = run(client, src)
    report = (client.space_root / res["reportPath"]).read_text(encoding="utf-8")
    lines = [ln for ln in report.splitlines() if "`photo.png`" in ln]
    assert lines == ["- [[photo]] (`photo.png`): `Original only: no readable page could be made`"], lines


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
