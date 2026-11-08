"""M26 readers: synthetic documents built in tmp_path with the libraries."""

import io
import zipfile
from pathlib import Path

import pytest
from docx import Document
from docx.shared import Inches
from openpyxl import Workbook
from PIL import Image
from pptx import Presentation
from pptx.util import Inches as PInches
from pypdf import PdfWriter

from objectapp import readers


def png(path_or_buf, color="red"):
    Image.new("RGB", (8, 8), color).save(path_or_buf, "PNG")


def test_docx(tmp_path):
    p = tmp_path / "Runbook.docx"
    d = Document()
    d.core_properties.author = "Ada"
    d.add_heading("DNS runbook", 1)
    d.add_paragraph("Intro text")
    d.add_paragraph("one", style="List Bullet")
    d.add_paragraph("two", style="List Bullet")
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text = "A"
    t.cell(0, 1).text = "B"
    t.cell(1, 0).text = "1"
    t.cell(1, 1).text = "2"
    img = tmp_path / "x.png"
    png(img)
    d.add_picture(str(img), width=Inches(1))
    d.save(p)
    r = readers.read_file(p)
    assert "# DNS runbook" in r.markdown and "- one" in r.markdown and "| A | B |" in r.markdown
    assert len(r.images) == 1 and f"![]({r.images[0].name})" in r.markdown
    assert r.images[0].content_type == "image/png" and r.images[0].data[:4] == b"\x89PNG"
    assert r.author == "Ada" and r.notes == [] and not r.original_only


def test_docx_merged_cells_note(tmp_path):
    p = tmp_path / "m.docx"
    d = Document()
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).merge(t.cell(0, 1))
    d.save(p)
    assert "Merged cells flattened" in readers.read_file(p).notes


def test_xlsx_and_limits(tmp_path):
    p = tmp_path / "b.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.title = "Small"
    ws.append(["Name", "Qty"])
    ws.append(["a|b", 3])
    ws["C1"] = "=1+1"
    big = wb.create_sheet("Big")
    for i in range(201):
        big.append([i, 1])
    wb.save(p)
    r = readers.read_file(p)
    assert "## Small" in r.markdown and "| Name | Qty |" in r.markdown and "a\\|b" in r.markdown
    assert "## Big" in r.markdown and "| 100 |" not in r.markdown
    assert any("Big" in n and "200 rows x 20 columns" in n for n in r.notes)


def test_xlsx_exact_limit_is_a_table(tmp_path):
    p = tmp_path / "c.xlsx"
    wb = Workbook()
    for i in range(200):
        wb.active.append(list(range(20)))
    wb.save(p)
    r = readers.read_file(p)
    assert r.notes == [] and r.markdown.count("\n") >= 200


def test_csv(tmp_path):
    p = tmp_path / "d.csv"
    p.write_text("a;b\n1;2\n", encoding="utf-8")
    assert "| a | b |" in readers.read_file(p).markdown
    q = tmp_path / "wide.csv"
    q.write_text(",".join(f"c{i}" for i in range(21)) + "\n", encoding="utf-8")
    assert readers.read_file(q).notes


def test_pptx_with_notes_and_image(tmp_path):
    p = tmp_path / "deck.pptx"
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "Plan"
    s.placeholders[1].text = "Point one"
    img = tmp_path / "i.png"
    png(img)
    s.shapes.add_picture(str(img), PInches(1), PInches(1))
    s.notes_slide.notes_text_frame.text = "Say hello"
    prs.save(p)
    r = readers.read_file(p)
    assert "## Slide 1: Plan" in r.markdown and "Point one" in r.markdown
    assert "<!-- toggle -->" in r.markdown and "Say hello" in r.markdown and "<!-- /toggle -->" in r.markdown
    assert len(r.images) == 1 and f"![]({r.images[0].name})" in r.markdown


def pdf_blank(path):
    w = PdfWriter()
    w.add_blank_page(72, 72)
    with open(path, "wb") as f:
        w.write(f)


def test_pdf_needs_ocr(tmp_path, monkeypatch):
    p = tmp_path / "scan.pdf"
    pdf_blank(p)
    monkeypatch.setattr("objectapp.readers.pdf.ocr_engine", lambda: None)
    r = readers.read_file(p)
    assert r.notes == ["Needs OCR"] and r.markdown == ""


def test_pdf_with_text(tmp_path):
    p = tmp_path / "t.pdf"
    stream = b"BT /F1 12 Tf 10 40 Td (Hello PDF) Tj ET"
    objs = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
        b"<</Length %d>>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    out = io.BytesIO(b"%PDF-1.4\n")
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(out.tell())
        out.write(b"%d 0 obj\n" % i + o + b"\nendobj\n")
    x = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for o in offs:
        out.write(b"%010d 00000 n \n" % o)
    out.write(b"trailer\n<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, x))
    p.write_bytes(out.getvalue())
    r = readers.read_file(p)
    assert "Hello PDF" in r.markdown and r.notes == []


def test_html(tmp_path):
    p = tmp_path / "p.html"
    p.write_text("<html><head><title>T</title><script>x=1</script></head><body><h2>Hi</h2><p>a <b>b</b> <a href='http://e.x'>l</a></p></body></html>")
    r = readers.read_file(p)
    assert r.title == "T" and "## Hi" in r.markdown and "**b**" in r.markdown and "(http://e.x)" in r.markdown and "x=1" not in r.markdown


def test_image_exif_and_original_only(tmp_path):
    p = tmp_path / "photo.jpg"
    im = Image.new("RGB", (4, 4))
    ex = Image.Exif()
    ex[0x0132] = "2024:03:02 10:11:12"
    im.save(p, exif=ex)
    r = readers.read_file(p)
    assert r.original_only and r.created == "2024-03-02T10:11:12"
    v = tmp_path / "flow.vsdx"
    v.write_bytes(b"PK")
    rv = readers.read_file(v)
    assert rv.original_only and "Original only" in rv.notes
    assert readers.read_file(tmp_path / "m.mp3" if (tmp_path / "m.mp3").write_bytes(b"x") else None).original_only


def test_broken_file_does_not_raise(tmp_path):
    p = tmp_path / "bad.docx"
    p.write_bytes(b"not a zip")
    r = readers.read_file(p)
    assert r.original_only and "Original only" in r.notes


def test_supported_suffixes_and_no_write(tmp_path):
    assert {".docx", ".pdf", ".xlsx", ".csv", ".pptx", ".html", ".md", ".png"} <= readers.supported_suffixes()
    p = tmp_path / "a.txt"
    p.write_text("hi")
    before = (p.stat().st_mtime_ns, sorted(tmp_path.iterdir()))
    readers.read_file(p)
    assert before == (p.stat().st_mtime_ns, sorted(tmp_path.iterdir()))


def test_office_files_over_the_unpacked_size_cap_are_not_parsed(tmp_path, monkeypatch):
    """Audit 30: a small docx/pptx/xlsx can inflate to hundreds of MB; its parts' unpacked size is
    checked before any parser opens it, and it is kept as Original only."""
    import docx as docx_lib
    import openpyxl
    import pptx as pptx_lib

    from objectapp.readers import docx as docx_reader
    from objectapp.readers import pptx as pptx_reader
    from objectapp.readers import util

    d = tmp_path / "bomb.docx"
    Document().save(d)
    s = tmp_path / "bomb.pptx"
    Presentation().save(s)
    x = tmp_path / "bomb.xlsx"
    Workbook().save(x)
    sizes = {p: sum(i.file_size for i in zipfile.ZipFile(p).infolist()) for p in (d, s, x)}
    monkeypatch.setattr(util, "MAX_OFFICE_UNPACKED_BYTES", min(sizes.values()) - 1)

    def boom(*_a, **_k):
        raise AssertionError("parsed a file over the cap")

    monkeypatch.setattr(docx_reader, "Document", boom)
    monkeypatch.setattr(pptx_reader, "Presentation", boom)
    monkeypatch.setattr(openpyxl, "load_workbook", boom)
    for p in (d, s, x):
        r = readers.read_file(p)
        assert r.original_only and r.markdown == "" and r.notes == ["Too large to read", "Original only"]
    assert docx_lib and pptx_lib


def test_xlsx_is_read_streaming(tmp_path, monkeypatch):
    """Audit 30: xlsx is opened read-only (streamed) and keeps only the rows a table can show, while
    a too-large sheet is still found past trailing blank rows and merged cells are still noted."""
    import openpyxl

    p = tmp_path / "s.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.title = "Gap"
    for i in range(150):
        ws.append([i, 1])
    ws.cell(row=300, column=1, value="late")  # rows 151-299 blank: still 300 rows
    m = wb.create_sheet("Merged")
    m.append(["a", "b"])
    m.merge_cells("A1:B1")
    wb.save(p)
    seen: list[dict] = []
    real = openpyxl.load_workbook

    def spy(*a, **k):
        seen.append(k)
        return real(*a, **k)

    monkeypatch.setattr(openpyxl, "load_workbook", spy)
    r = readers.read_file(p)
    assert seen and all(k.get("read_only") for k in seen)
    assert "Sheet 'Gap' has 300 rows x 2 columns" in r.markdown and "| 100 |" not in r.markdown
    assert "## Merged" in r.markdown and "Merged cells flattened" in r.notes


def test_html_drops_unsafe_links_and_never_keeps_a_remote_image(tmp_path):
    """Audit 31: only http(s), mailto and relative links are kept; a javascript:, file: or data:
    link becomes its text. A remote image becomes a plain link (its alt text, or "Image"), so the
    page never fetches it; a data: or file: image keeps only its alt text."""
    p = tmp_path / "x.html"
    p.write_text(
        "<html><body>"
        "<p><a href='javascript:alert(1)'>js</a> <a href=' JaVa\tScript:alert(1)'>js2</a> "
        "<a href='file:///etc/passwd'>pw</a> <a href='data:text/html,hi'>dt</a> "
        "<a href='https://ok.example/a'>web</a> <a href='mailto:a@b.example'>mail</a> "
        "<a href='other.html'>rel</a> <a href='//cdn.example/x'>proto</a></p>"
        "<p><img src='https://evil.example/pixel.png?u=1' alt='Chart'> <img src='http://evil.example/b.png'> "
        "<img src='data:image/png;base64,AAAA' alt='Inline'> <img src='file:///c/x.png'> "
        "<img src='pics/local.png' alt='Local'></p>"
        "</body></html>",
        encoding="utf-8",
    )
    md = readers.read_file(p).markdown
    for bad in ("javascript", "JaVa", "file:", "data:", "//cdn.example", "![Chart]", "![](http"):
        assert bad not in md, (bad, md)
    for text in ("js", "js2", "pw", "dt", "proto", "Inline"):
        assert text in md
    assert "[web](https://ok.example/a)" in md and "[mail](mailto:a@b.example)" in md and "[rel](other.html)" in md
    assert "[Chart](https://evil.example/pixel.png?u=1)" in md and "[Image](http://evil.example/b.png)" in md
    assert "![Local](pics/local.png)" in md


def test_docx_drops_unsafe_hyperlinks(tmp_path):
    """Audit 31: a docx hyperlink to javascript: or file: keeps only its text."""
    from docx.opc.constants import RELATIONSHIP_TYPE as RT
    from docx.oxml.ns import qn
    from docx.oxml.parser import OxmlElement

    p = tmp_path / "links.docx"
    d = Document()
    para = d.add_paragraph("See ")
    for url, text in (("javascript:alert(1)", "js"), ("file:///etc/passwd", "pw"), ("https://ok.example/", "web")):
        rid = d.part.relate_to(url, RT.HYPERLINK, is_external=True)
        h = OxmlElement("w:hyperlink")
        h.set(qn("r:id"), rid)
        r = OxmlElement("w:r")
        t = OxmlElement("w:t")
        t.text = text
        r.append(t)
        h.append(r)
        para._p.append(h)
    d.save(p)
    md = readers.read_file(p).markdown
    assert "javascript" not in md and "file:" not in md
    assert "js" in md and "pw" in md and "[web](https://ok.example/)" in md
