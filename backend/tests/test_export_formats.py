"""Polish item 23: the Export dialog's formats and options (catalog section 10).

``GET /api/object/export`` takes ``format`` (``md`` default, ``html`` for the PDF the dialog
prints, ``docx``, ``latex``) and the dialog's options: Markdown ``subpages``, ``media``,
``titleH1`` and ``wikilinks``; PDF ``style`` (notes, essay, academic), ``paper`` (A4, Letter),
``embedded``, ``outline``, ``hideEmpty``, ``typeLabels`` and ``hide`` (deselected properties).
``GET /api/object/export/properties`` lists the properties the dialog offers. Nothing is written.
"""

from __future__ import annotations

import hashlib
import io
import re
import zipfile
from pathlib import Path
from xml.dom import minidom

import pytest
from fastapi.testclient import TestClient
from objectapp.exportdoc import parse_blocks, parse_inline
from objectapp.server import create_app
from objectapp.space import Space

PAGE = "Pages/Report.md"
PAGE_TEXT = (
    "---\r\n"
    "type: 'Page'\r\n"
    "title: Report\r\n"
    "---\r\n"
    "Intro with **bold**, *italic*, `code` & [[Ada Lovelace|Ada]] and [site](https://example.org).\r\n"
    "\r\n"
    "## Findings\r\n"
    "\r\n"
    "- one\r\n"
    "  - nested\r\n"
    "1. first\r\n"
    "- [x] done task\r\n"
    "\r\n"
    "<!-- block: color=bg-blue -->\r\n"
    "> quoted 50% $x$\r\n"
    "\r\n"
    "| A | B |\r\n"
    "|---|---|\r\n"
    "| 1 | 2 |\r\n"
    "\r\n"
    "![[Embedded target]]\r\n"
    "\r\n"
    "![pixel](Attachments/pixel.png)\r\n"
    "\r\n"
    "```\r\n"
    "x <y> & {z}\r\n"
    "```\r\n"
)
PAGE_BYTES = b"\xef\xbb\xbf" + PAGE_TEXT.encode()

PERSON = "People/Ada Lovelace.md"


@pytest.fixture
def root(blocks_space_dir: Path) -> Path:
    (blocks_space_dir / "Pages" / "Report.md").write_bytes(PAGE_BYTES)
    return blocks_space_dir


def _client(root: Path) -> TestClient:
    app = create_app(Space(root), None, watch=False)
    app.state.hub.publish = lambda _e: None
    return TestClient(app)


def _tree(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _get(c: TestClient, **params):
    return c.get("/api/object/export", params=params)


# -- reading Markdown ------------------------------------------------------------------


def test_parse_blocks_reads_every_block_kind():
    kinds = [b.kind for b in parse_blocks(PAGE_TEXT.split("---\r\n", 2)[2])]
    assert kinds == ["para", "heading", "item", "item", "item", "item", "quote", "table", "embed", "image", "code"]
    items = [b for b in parse_blocks("- a\n  - b\n1. c\n2. d\n- [ ] e\n") if b.kind == "item"]
    assert [(b.level, b.ordered, b.number, b.checked) for b in items] == [
        (0, False, 1, None), (1, False, 1, None), (0, True, 1, None), (0, True, 2, None), (0, False, 1, False)
    ]


def test_parse_inline_styles_and_links():
    runs = parse_inline("a **b** *c* `d*e` ~~f~~ [[T|g]] [h](https://x.y) snake_case_name")
    by_text = {r.text: r for r in runs}
    assert by_text["b"].bold and by_text["c"].italic and by_text["d*e"].code and by_text["f"].strike
    assert by_text["g"].href == "wiki:T" and by_text["h"].href == "https://x.y"
    assert runs[-1].text.endswith("snake_case_name") and not runs[-1].italic


# -- Markdown options ------------------------------------------------------------------


def test_markdown_defaults_stay_byte_identical(root: Path):
    with _client(root) as c:
        r = _get(c, path=PAGE)
    assert r.status_code == 200 and r.content == PAGE_BYTES


def test_markdown_title_as_heading_1(root: Path):
    with _client(root) as c:
        body = _get(c, path=PAGE, titleH1="1").content
    assert body.startswith(b"\xef\xbb\xbf---\r\n")
    assert b"---\r\n# Report\r\n\r\nIntro with" in body


def test_markdown_title_heading_not_doubled(root: Path):
    (root / "Pages" / "Report.md").write_bytes(b"---\ntitle: Report\n---\n# Report\n\nText\n")
    with _client(root) as c:
        assert _get(c, path=PAGE, titleH1="1").content == b"---\ntitle: Report\n---\n# Report\n\nText\n"


def test_markdown_links_as_paths_without_wikilinks(root: Path):
    with _client(root) as c:
        text = _get(c, path=PAGE, wikilinks="0").content.decode("utf-8-sig")
    assert "[Ada](People/Ada%20Lovelace.md)" in text
    assert "[Embedded target](Pages/Embedded%20target.md)" in text
    assert "[[" not in text


def test_markdown_subpages_zip_holds_embedded_objects(root: Path):
    with _client(root) as c:
        r = _get(c, path=PAGE, subpages="1")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert 'filename="Report.zip"' in r.headers["content-disposition"]
    names = set(zipfile.ZipFile(io.BytesIO(r.content)).namelist())
    assert names == {"Report.md", "Pages/Embedded target.md"}


def test_markdown_subpages_with_media(root: Path):
    with _client(root) as c:
        r = _get(c, path=PAGE, subpages="1", media="1")
    names = set(zipfile.ZipFile(io.BytesIO(r.content)).namelist())
    assert names == {"Report.md", "Pages/Embedded target.md", "Attachments/pixel.png"}


# -- PDF (printable HTML) --------------------------------------------------------------


def test_pdf_html_has_style_paper_and_content(root: Path):
    with _client(root) as c:
        r = _get(c, path=PAGE, format="html", style="academic", paper="letter")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert "attachment" not in r.headers.get("content-disposition", "")
    assert "script-src" not in r.headers["content-security-policy"] or "'none'" in r.headers["content-security-policy"]
    h = r.text
    assert "size:letter" in h and "column-count:2" in h
    assert '<h1 class="title">Report</h1>' in h
    assert "<strong>bold</strong>" in h and "<code>code</code>" in h and "&amp;" in h
    assert '<a href="https://example.org">site</a>' in h
    assert "<h2>Findings</h2>" in h and '<ul class="tasks">' in h and "<table" in h
    assert "/api/file?path=Attachments%2Fpixel.png" in h
    assert "x &lt;y&gt; &amp; {z}" in h
    assert "bg-blue" not in h  # annotation comments are dropped


@pytest.mark.parametrize("style,mark", [("notes", "--font"), ("essay", "Georgia"), ("academic", "counter(h1)")])
def test_pdf_styles_are_all_available(root: Path, style: str, mark: str):
    with _client(root) as c:
        assert mark in _get(c, path=PAGE, format="html", style=style).text


def test_pdf_embedded_content_and_outline(root: Path):
    with _client(root) as c:
        on = _get(c, path=PAGE, format="html", embedded="1", outline="1").text
        off = _get(c, path=PAGE, format="html", embedded="0").text
    assert '<div class="embed">' in on and "A page that other pages embed." in on
    assert 'class="outline"' in on and "Findings" in on.split('class="outline"')[1]
    assert "A page that other pages embed." not in off and "Embedded target" in off


def test_pdf_properties_type_label_and_hiding(root: Path):
    with _client(root) as c:
        shown = _get(c, path=PERSON, format="html", typeLabels="1").text
        all_props = _get(c, path=PERSON, format="html", hideEmpty="0").text
        hidden = _get(c, path=PERSON, format="html", hide="bio").text
        props = c.get("/api/object/export/properties", params={"path": PERSON}).json()
    assert '<p class="typelabel">Person</p>' in shown
    assert "<td>Bio</td><td>Invented person for the blocks fixture.</td>" in shown
    assert "<td>Manager</td>" not in shown and "<td>Manager</td>" in all_props
    assert "<td>Bio</td>" not in hidden
    keys = [p["key"] for p in props]
    assert "bio" in keys and "manager" in keys and "title" not in keys and "backlinks" not in keys
    assert next(p for p in props if p["key"] == "manager")["empty"] is True
    assert next(p for p in props if p["key"] == "bio")["name"] == "Bio"


# -- Word and LaTeX --------------------------------------------------------------------


def test_word_export_is_a_valid_docx(root: Path):
    with _client(root) as c:
        r = _get(c, path=PAGE, format="docx")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert 'filename="Report.docx"' in r.headers["content-disposition"]
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    assert {"[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml",
            "word/_rels/document.xml.rels"} <= set(zf.namelist())
    for name in zf.namelist():
        if name.endswith((".xml", ".rels")):
            minidom.parseString(zf.read(name))  # well-formed
    doc = zf.read("word/document.xml").decode()
    assert "Report" in doc and 'w:val="Heading2"' in doc and "<w:tbl>" in doc and "<w:b/>" in doc
    assert "x &lt;y&gt; &amp; {z}" in doc and "<w:hyperlink" in doc
    assert "https://example.org" in zf.read("word/_rels/document.xml.rels").decode()


def test_latex_export(root: Path):
    with _client(root) as c:
        r = _get(c, path=PAGE, format="latex")
    assert r.status_code == 200 and 'filename="Report.tex"' in r.headers["content-disposition"]
    tex = r.text
    assert tex.startswith("\\documentclass") and tex.rstrip().endswith("\\end{document}")
    assert "\\title{Report}" in tex and "\\subsection*{Findings}" in tex
    assert "\\textbf{bold}" in tex and "\\emph{italic}" in tex and "\\texttt{code}" in tex and "\\&" in tex
    assert "\\href{https://example.org}{site}" in tex and "50\\%" in tex and "$x$" in tex
    assert "\\begin{itemize}" in tex and "\\begin{enumerate}" in tex and "\\begin{tabular}" in tex
    assert "\\begin{verbatim}\nx <y> & {z}\n\\end{verbatim}" in tex
    assert tex.count("\\begin{") == tex.count("\\end{")


# -- safety ----------------------------------------------------------------------------


def test_every_format_writes_nothing(root: Path):
    before = _tree(root)
    with _client(root) as c:
        for params in (
            {"format": "html", "embedded": "1"},
            {"format": "docx"},
            {"format": "latex"},
            {"subpages": "1", "media": "1", "titleH1": "1", "wikilinks": "0"},
        ):
            assert _get(c, path=PAGE, **params).status_code == 200
    assert _tree(root) == before


def test_bad_format_and_missing_object(root: Path):
    with _client(root) as c:
        assert _get(c, path=PAGE, format="rtf").status_code == 400
        assert _get(c, path="Pages/Nope.md", format="docx").status_code == 404
        assert c.get("/api/object/export/properties", params={"path": "Pages/Nope.md"}).status_code == 404


def test_html_escapes_markup_in_content(root: Path):
    (root / "Pages" / "Report.md").write_text("---\ntitle: <b>x</b>\n---\n<script>alert(1)</script>\n", encoding="utf-8")
    with _client(root) as c:
        h = _get(c, path=PAGE, format="html").text
    assert "<script>" not in h and "&lt;script&gt;" in h
    assert re.search(r"<title>&lt;b&gt;x&lt;/b&gt;</title>", h)
