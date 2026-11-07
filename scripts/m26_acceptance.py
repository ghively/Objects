"""Milestone 26 acceptance (readers and the scan).

Usage: ``uv run python scripts/m26_acceptance.py [--keep]``

Builds a synthetic mixed folder in a temporary directory (docx, xlsx, csv, pptx, pdf, html, md, png,
vsdx, a fake-secret file and a "Credentials" folder), then checks: every reader's output and notes,
the 200 x 20 table limit, the scan (kinds and lines, never values), "Leave out" never read, the
``POST /api/import/scan`` route, and that nothing in the folder changed (no write on read).
Ends with ``RESULT: PASS`` or exits non-zero.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from docx import Document
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook
from PIL import Image
from pptx import Presentation
from pypdf import PdfWriter

from objectapp import importscan, readers
from objectapp.api_importscan import router

FAILS: list[str] = []


def check(name: str, ok: bool) -> None:
    print(("[ok]   " if ok else "[FAIL] ") + name)
    if not ok:
        FAILS.append(name)


def snapshot(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob("*")) if p.is_file()}


def build(root: Path) -> None:
    (root / "Credentials").mkdir(parents=True)
    (root / "Credentials" / "keys.txt").write_text("AKIA" + "FAKEFAKEFAKEFAKE")
    Image.new("RGB", (8, 8), "red").save(root / "pic.png")
    d = Document()
    d.add_heading("Runbook", 1)
    d.add_paragraph("Step one")
    d.add_picture(str(root / "pic.png"))
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).merge(t.cell(0, 1))
    d.add_paragraph("token " + "ghp_" + "a" * 36)
    d.save(root / "Runbook.docx")
    wb = Workbook()
    wb.active.title = "Small"
    wb.active.append(["a", "b"])
    big = wb.create_sheet("Big")
    for i in range(201):
        big.append([i])
    wb.save(root / "sheet.xlsx")
    (root / "t.csv").write_text("x,y\n1,2\n")
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "Plan"
    s.notes_slide.notes_text_frame.text = "Notes here"
    prs.save(root / "deck.pptx")
    w = PdfWriter()
    w.add_blank_page(72, 72)
    with open(root / "scan.pdf", "wb") as f:
        w.write(f)
    (root / "page.html").write_text("<html><title>P</title><body><h1>Hi</h1><p>text</p></body></html>")
    (root / "note.md").write_text("# Note\npassword = hunter2hunter\ncard 4111 1111 1111 1111\n")
    (root / "flow.vsdx").write_bytes(b"PK\x03\x04")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true")
    keep = ap.parse_args().keep
    tmp = Path(tempfile.mkdtemp(prefix="m26-"))
    root = tmp / "src"
    build(root)
    before = snapshot(root)
    try:
        r = {p.name: readers.read_file(p) for p in root.iterdir() if p.is_file()}
        check("docx: heading, image placed, merged cells noted", "# Runbook" in r["Runbook.docx"].markdown and len(r["Runbook.docx"].images) == 1 and "Merged cells flattened" in r["Runbook.docx"].notes)
        check("xlsx: small sheet is a table, big sheet is linked to the original", "| a | b |" in r["sheet.xlsx"].markdown and any("200 rows x 20 columns" in n for n in r["sheet.xlsx"].notes))
        check("csv table", "| x | y |" in r["t.csv"].markdown)
        check("pptx: slide section and notes toggle", "## Slide 1: Plan" in r["deck.pptx"].markdown and "<!-- toggle -->" in r["deck.pptx"].markdown)
        check("pdf without a text layer: Needs OCR (or read by a local engine)", any(n.startswith("Needs OCR") for n in r["scan.pdf"].notes))
        check("html to markdown", "# Hi" in r["page.html"].markdown)
        check("png and vsdx: original only", r["pic.png"].original_only and r["flow.vsdx"].original_only and "Original only" in r["flow.vsdx"].notes)

        rep = importscan.scan_tree(root, ["Credentials"])
        check("scan: leave out is listed and not scanned", rep.left_out == ["Credentials/keys.txt"] and "Credentials/keys.txt" not in rep.findings)
        found = {k: [(f.kind, f.line) for f in v] for k, v in rep.findings.items()}
        check("scan: note.md password line 2 and card line 3", found.get("note.md") == [("password", 2), ("card-number", 3)])
        check("scan: docx token found", ("api-key", 5) in found.get("Runbook.docx", []) or any(k == "api-key" for k, _ in found.get("Runbook.docx", [])))

        app = FastAPI()
        app.include_router(router(None), prefix="/api")
        resp = TestClient(app).post("/api/import/scan", json={"path": str(root), "leaveOut": ["Credentials"]})
        body = resp.json()
        text = json.dumps(body)
        check("route: 200 with the report", resp.status_code == 200 and body["counts"]["flagged"] == len(found))
        check("route: no secret value in the answer", "hunter2" not in text and "4111" not in text and "ghp_" not in text and "AKIA" not in text)
        check("no write on read", snapshot(root) == before)
    finally:
        if keep:
            print("kept", tmp)
        else:
            shutil.rmtree(tmp, ignore_errors=True)
    if FAILS:
        print("RESULT: FAIL", FAILS)
        return 1
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
