"""Exporting one object as a document: PDF (printable HTML), Microsoft Word (.docx) and LaTeX.

Object's Export dialog offers PDF, Markdown, Microsoft Word and Latex
(`entity.settings.{pdf,md,docx,latex}.description`). Markdown is `export.py`'s; the other
three are built here from one small reading of the object's Markdown body:

- `parse_blocks` reads the body into blocks (headings, paragraphs, lists and to-dos, quotes,
  code, math, tables, horizontal lines, images and object embeds); annotation comments
  (``<!-- block: ... -->``) are dropped. `parse_inline` reads a line into styled runs.
- `render_html` is the PDF: a self-contained page in one of Object's three styles
  (`entity.settings.typesetPdf.mode.*`: Notes, Essay, Academic, all available) that the
  dialog prints with the browser's "Save as PDF" (our choice: no PDF library, no network).
- `render_docx` writes a minimal WordprocessingML package with `zipfile` (no new dependency).
- `render_latex` writes an ``article`` ``.tex`` file.

Images become ``/api/file`` links in the HTML; Word and LaTeX keep their alt text only
(our choice: the export stays one file). Nothing here writes to the space.
"""

from __future__ import annotations

import html
import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Callable
from urllib.parse import quote
from xml.sax.saxutils import escape as _xml_escape

__all__ = [
    "Block",
    "Doc",
    "Run",
    "parse_blocks",
    "parse_inline",
    "render_docx",
    "render_html",
    "render_latex",
]


# ---------------------------------------------------------------------------
# The document model


@dataclass
class Run:
    text: str
    bold: bool = False
    italic: bool = False
    code: bool = False
    strike: bool = False
    math: bool = False
    href: str | None = None
    """An external link's URL; ``wiki:<target>`` for a wikilink."""


@dataclass
class Block:
    kind: str
    """heading, para, item, quote, code, math, table, hr, image, embed"""
    text: str = ""
    level: int = 0
    """Heading level; list depth for an item."""
    ordered: bool = False
    number: int = 0
    checked: bool | None = None
    lang: str = ""
    rows: list[list[str]] = field(default_factory=list)
    src: str = ""
    """An image's resolved ``/api/file`` path (empty when missing); an embed's target."""
    children: list[Block] = field(default_factory=list)
    """An embed's own blocks, when embedded content is included."""
    title: str = ""
    """An embed's title."""


@dataclass
class Doc:
    title: str
    type_name: str = ""
    properties: list[tuple[str, str]] = field(default_factory=list)
    blocks: list[Block] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Reading Markdown

_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)")
_HEADING = re.compile(r"^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$")
_HR = re.compile(r"^ {0,3}([-*_])(?:\s*\1){2,}\s*$")
_COMMENT = re.compile(r"^ {0,3}<!--.*-->\s*$")
_ITEM = re.compile(r"^([ \t]*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$")
_QUOTE = re.compile(r"^ {0,3}>\s?(.*)$")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
_EMBED = re.compile(r"^\s*!\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]\s*$")
_IMAGE = re.compile(r"^\s*!\[([^\]\n]*)\]\(\s*(?:<([^>\n]*)>|([^)\s]+))[^)\n]*\)\s*$")
_EXT = re.compile(r"\.([A-Za-z0-9]{1,8})$")


def _cells(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", s)]


def _indent(ws: str) -> int:
    return len(ws.replace("\t", "    ")) // 2


def parse_blocks(body: str, media: Callable[[str], str | None] | None = None) -> list[Block]:
    """The blocks of a Markdown body. ``media(path)`` gives an image's servable path or None."""
    lines = body.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: list[Block] = []
    para: list[str] = []
    counters: dict[int, tuple[bool, int]] = {}  # list depth -> (ordered, last number)

    def flush() -> None:
        if para:
            out.append(Block("para", text=" ".join(p.strip() for p in para)))
            para.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            flush()
            counters.clear()
            i += 1
            continue
        m = _FENCE.match(line)
        if m:
            flush()
            fence, code = m.group(1), []
            i += 1
            while i < len(lines):
                c = re.match(r"^ {0,3}(`{3,}|~{3,})\s*$", lines[i])
                if c and c.group(1)[0] == fence[0] and len(c.group(1)) >= len(fence):
                    break
                code.append(lines[i])
                i += 1
            out.append(Block("code", text="\n".join(code), lang=m.group(2)))
            i += 1
            continue
        if line.strip() == "$$":
            flush()
            tex = []
            i += 1
            while i < len(lines) and lines[i].strip() != "$$":
                tex.append(lines[i])
                i += 1
            out.append(Block("math", text="\n".join(tex).strip()))
            i += 1
            continue
        if _COMMENT.match(line):
            flush()
            i += 1
            continue
        m = _HEADING.match(line)
        if m:
            flush()
            out.append(Block("heading", text=m.group(2), level=len(m.group(1))))
            i += 1
            continue
        if _HR.match(line) and not para:
            out.append(Block("hr"))
            i += 1
            continue
        if line.lstrip().startswith("|") and i + 1 < len(lines) and _TABLE_SEP.match(lines[i + 1]):
            flush()
            rows = [_cells(line)]
            i += 2
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                rows.append(_cells(lines[i]))
                i += 1
            out.append(Block("table", rows=rows))
            continue
        m = _QUOTE.match(line)
        if m:
            flush()
            quoted = [m.group(1)]
            i += 1
            while i < len(lines) and (q := _QUOTE.match(lines[i])):
                quoted.append(q.group(1))
                i += 1
            out.append(Block("quote", text=" ".join(s.strip() for s in quoted if s.strip())))
            continue
        m = _ITEM.match(line)
        if m:
            flush()
            depth = _indent(m.group(1))
            ordered = m.group(2)[0].isdigit()
            for d in [d for d in counters if d > depth]:
                del counters[d]
            prev = counters.get(depth)
            if prev is not None and prev[0] == ordered:
                number = prev[1] + 1
            else:
                number = int(m.group(2)[:-1]) if ordered else 1
            counters[depth] = (ordered, number)
            checked = None if m.group(3) is None else m.group(3) != " "
            out.append(Block("item", text=m.group(4), level=depth, ordered=ordered, number=number, checked=checked))
            i += 1
            continue
        m = _EMBED.match(line)
        if m:
            flush()
            target = m.group(1).strip()
            ext = _EXT.search(target)
            if ext and ext.group(1).lower() != "md":
                src = media(target) if media else None
                out.append(Block("image", text=(m.group(2) or "").strip(), src=src or ""))
            elif not re.match(r"^(collection|query):", target):
                out.append(Block("embed", src=target, title=(m.group(2) or "").strip() or _link_title(target)))
            i += 1
            continue
        m = _IMAGE.match(line)
        if m:
            flush()
            target = (m.group(2) if m.group(2) is not None else m.group(3)).strip()
            src = media(target) if media else None
            out.append(Block("image", text=m.group(1), src=src or ""))
            i += 1
            continue
        para.append(line)
        i += 1
    flush()
    return out


def _link_title(target: str) -> str:
    name = target.rsplit("/", 1)[-1]
    return name[:-3] if name.lower().endswith(".md") else name


_INLINE = re.compile(
    r"(?P<esc>\\[\\`*_{}\[\]()#+\-.!|~$])"
    r"|(?P<code>`+)"
    r"|(?P<wiki>!?\[\[(?P<wt>[^\[\]|#\n]+)(?:#[^\[\]|\n]*)?(?:\|(?P<wa>[^\[\]\n]*))?\]\])"
    r"|(?P<img>!\[(?P<ia>[^\]\n]*)\]\([^)\n]*\))"
    r"|(?P<link>\[(?P<lt>[^\]\n]*)\]\(\s*<?(?P<lh>[^)\s>]*)>?[^)\n]*\))"
    r"|(?P<auto><(?P<au>https?://[^>\s]+)>)"
    r"|(?P<math>\$(?P<mt>[^$\n]+)\$)"
    r"|(?P<mark>\*\*|__|~~|\*|_)"
)


def parse_inline(text: str) -> list[Run]:
    """Styled runs of one line of Markdown (bold, italic, strike, code, math, links)."""
    runs: list[Run] = []
    state = {"bold": False, "italic": False, "strike": False}
    buf: list[str] = []

    def push(s: str, **kw) -> None:
        if not s:
            return
        style = dict(state, **{k: v for k, v in kw.items() if k in state})
        extra = {k: v for k, v in kw.items() if k not in state}
        last = runs[-1] if runs else None
        if (
            last is not None
            and not extra
            and last.href is None
            and not last.code
            and not last.math
            and (last.bold, last.italic, last.strike) == (style["bold"], style["italic"], style["strike"])
        ):
            last.text += s
        else:
            runs.append(Run(s, **style, **extra))

    def flush() -> None:
        push("".join(buf))
        buf.clear()

    pos = 0
    while pos < len(text):
        m = _INLINE.search(text, pos)
        if m is None:
            buf.append(text[pos:])
            break
        buf.append(text[pos : m.start()])
        pos = m.end()
        if m.group("esc"):
            buf.append(m.group("esc")[1])
        elif m.group("code"):
            ticks = m.group("code")
            close = re.compile(r"(?<!`)" + re.escape(ticks) + r"(?!`)").search(text, pos)
            if close is None:
                buf.append(ticks)
                continue
            flush()
            push(text[pos : close.start()].strip(" ") or text[pos : close.start()], code=True)
            pos = close.end()
        elif m.group("wiki"):
            flush()
            target = m.group("wt").strip()
            push((m.group("wa") or "").strip() or _link_title(target), href=f"wiki:{target}")
        elif m.group("img"):
            buf.append(m.group("ia"))
        elif m.group("link"):
            flush()
            href = m.group("lh")
            push(m.group("lt") or href, href=href or None)
        elif m.group("auto"):
            flush()
            push(m.group("au"), href=m.group("au"))
        elif m.group("math"):
            flush()
            push(m.group("mt"), math=True)
        elif m.group("mark"):
            mark = m.group("mark")
            if mark == "_" and _intraword(text, m.start(), m.end()):
                buf.append(mark)
                continue
            flush()
            key = {"**": "bold", "__": "bold", "~~": "strike"}.get(mark, "italic")
            state[key] = not state[key]
    flush()
    return runs


def _intraword(text: str, start: int, end: int) -> bool:
    before = text[start - 1] if start > 0 else " "
    after = text[end] if end < len(text) else " "
    return before.isalnum() and after.isalnum()


def _list_kind(b: Block) -> str:
    return "tasks" if b.checked is not None else ("ol" if b.ordered else "ul")


def headings(blocks: list[Block]) -> list[Block]:
    return [b for b in blocks if b.kind == "heading"]


def plain(text: str) -> str:
    return "".join(r.text for r in parse_inline(text))


# ---------------------------------------------------------------------------
# HTML (printed to PDF)

_STYLE_CSS = {
    # "A PDF that matches the styling of the current page, including colors and embeds."
    "notes": """
body{font-family:var(--font);font-size:15px;line-height:1.6;color:#1f2328}
h1.title{font-size:34px;line-height:1.2;margin:0 0 4px}
h1{font-size:26px}h2{font-size:21px}h3{font-size:18px}h4,h5,h6{font-size:16px}
a,.link{color:#2563eb;text-decoration:none}
.embed{border:1px solid #d9dce1;border-radius:8px;padding:8px 14px;margin:10px 0}
blockquote{border-left:3px solid #d0d4da;margin:8px 0;padding:2px 12px;color:#555}
""",
    # "A single-column typeset PDF for reading and sharing."
    "essay": """
body{font-family:Georgia,'Times New Roman',serif;font-size:12pt;line-height:1.55;color:#111;text-align:justify}
h1.title{font-size:24pt;text-align:center;margin:0 0 6pt;font-weight:normal}
.typelabel,.props{text-align:center}
h1{font-size:16pt}h2{font-size:13.5pt}h3,h4,h5,h6{font-size:12pt;font-style:italic}
a,.link{color:inherit}
.embed{margin:10pt 0 10pt 1.5em}
blockquote{margin:8pt 2em;font-style:italic}
""",
    # "A compact two-column typeset PDF with numbered headings."
    "academic": """
body{font-family:'Times New Roman',Times,serif;font-size:10pt;line-height:1.35;color:#000;text-align:justify}
h1.title{font-size:17pt;text-align:center;margin:0 0 4pt}
.typelabel,.props{text-align:center}
.content{column-count:2;column-gap:7mm;counter-reset:h1}
h1,h2,h3,h4,h5,h6{font-size:10.5pt;margin:8pt 0 3pt}
.content h1{counter-reset:h2}.content h1::before{counter-increment:h1;content:counter(h1) ". "}
.content h2{counter-reset:h3}.content h2::before{counter-increment:h2;content:counter(h1) "." counter(h2) " "}
.content h3::before{counter-increment:h3;content:counter(h1) "." counter(h2) "." counter(h3) " "}
a,.link{color:inherit}
.embed{margin:6pt 0;padding-left:8pt;border-left:1px solid #999}
blockquote{margin:4pt 1.5em}
""",
}

_BASE_CSS = """
@page{size:%(paper)s;margin:18mm}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0 auto;max-width:180mm;background:#fff;--font:%(font)s}
.typelabel{font-size:.8em;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:0 0 2px}
table.props{border-collapse:collapse;margin:6px 0 14px;font-size:.92em}
table.props td{padding:2px 14px 2px 0;vertical-align:top}table.props td:first-child{color:#6b7280}
.outline{border:1px solid #e3e5e8;border-radius:6px;padding:6px 14px;margin:0 0 14px;font-size:.92em}
.outline ul{margin:2px 0;padding-left:18px}
pre{background:#f3f4f6;border-radius:6px;padding:8px 10px;white-space:pre-wrap;font-size:.88em;break-inside:avoid}
code{font-family:Consolas,'Courier New',monospace;background:#f3f4f6;border-radius:3px;padding:0 3px}
pre code{background:none;padding:0}
img{max-width:100%%;break-inside:avoid}
table.md{border-collapse:collapse;margin:8px 0}table.md td,table.md th{border:1px solid #d0d4da;padding:3px 8px}
ul.tasks{list-style:none;padding-left:4px}
hr{border:0;border-top:1px solid #d0d4da}
"""

_FONTS = {
    "serif": "Georgia,'Times New Roman',serif",
    "monospace": "Consolas,'Courier New',monospace",
}


def _esc(s: str) -> str:
    return html.escape(s, quote=True)


def _html_runs(text: str) -> str:
    out = []
    for r in parse_inline(text):
        s = _esc(r.text)
        if r.code or r.math:
            s = f"<code>{s}</code>"
        if r.bold:
            s = f"<strong>{s}</strong>"
        if r.italic:
            s = f"<em>{s}</em>"
        if r.strike:
            s = f"<s>{s}</s>"
        if r.href and r.href.startswith("wiki:"):
            s = f'<span class="link">{s}</span>'
        elif r.href and re.match(r"^(https?:|mailto:)", r.href, re.I):
            s = f'<a href="{_esc(r.href)}">{s}</a>'
        out.append(s)
    return "".join(out)


def _html_blocks(blocks: list[Block]) -> str:
    out: list[str] = []
    open_lists: list[str] = []  # the list kind open at each depth, innermost last

    def close_to(depth: int) -> None:
        while len(open_lists) > depth:
            out.append("</ol>" if open_lists.pop() == "ol" else "</ul>")

    for b in blocks:
        if b.kind != "item":
            close_to(0)
        if b.kind == "heading":
            out.append(f"<h{b.level}>{_html_runs(b.text)}</h{b.level}>")
        elif b.kind == "para":
            out.append(f"<p>{_html_runs(b.text)}</p>")
        elif b.kind == "item":
            kind = _list_kind(b)
            close_to(b.level + 1)
            if len(open_lists) == b.level + 1 and open_lists[-1] != kind:
                close_to(b.level)
            while len(open_lists) <= b.level:
                if b.checked is not None:
                    out.append('<ul class="tasks">')
                elif b.ordered:
                    out.append(f'<ol start="{b.number}">')
                else:
                    out.append("<ul>")
                open_lists.append(kind)
            box = "" if b.checked is None else ("\u2611 " if b.checked else "\u2610 ")
            out.append(f"<li>{box}{_html_runs(b.text)}</li>")
        elif b.kind == "quote":
            out.append(f"<blockquote>{_html_runs(b.text)}</blockquote>")
        elif b.kind == "code":
            out.append(f"<pre><code>{_esc(b.text)}</code></pre>")
        elif b.kind == "math":
            out.append(f'<pre class="math"><code>{_esc(b.text)}</code></pre>')
        elif b.kind == "hr":
            out.append("<hr>")
        elif b.kind == "table":
            rows = []
            for n, row in enumerate(b.rows):
                tag = "th" if n == 0 else "td"
                rows.append("<tr>" + "".join(f"<{tag}>{_html_runs(c)}</{tag}>" for c in row) + "</tr>")
            out.append('<table class="md">' + "".join(rows) + "</table>")
        elif b.kind == "image":
            if b.src:
                out.append(f'<p><img src="/api/file?path={quote(b.src, safe="")}" alt="{_esc(b.text)}"></p>')
            elif b.text:
                out.append(f"<p><em>{_esc(b.text)}</em></p>")
        elif b.kind == "embed":
            if b.children:
                out.append(
                    f'<div class="embed"><p><strong>{_esc(b.title)}</strong></p>{_html_blocks(b.children)}</div>'
                )
            else:
                out.append(f'<p><span class="link">{_esc(b.title)}</span></p>')
    close_to(0)
    return "\n".join(out)


def render_html(
    doc: Doc,
    style: str = "notes",
    paper: str = "A4",
    outline: bool = False,
    type_label: bool = False,
    font: str = "sans-serif",
) -> str:
    """The printable page of ``doc`` (``style``: notes, essay or academic; ``paper``: A4 or Letter)."""
    css = _BASE_CSS % {
        "paper": "letter" if paper.lower() == "letter" else "A4",
        "font": _FONTS.get(font, "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"),
    } + _STYLE_CSS.get(style, _STYLE_CSS["notes"])
    parts = [
        "<!doctype html>",
        '<html><head><meta charset="utf-8">',
        f"<title>{_esc(doc.title)}</title>",
        f"<style>{css}</style></head><body>",
    ]
    if type_label and doc.type_name:
        parts.append(f'<p class="typelabel">{_esc(doc.type_name)}</p>')
    parts.append(f'<h1 class="title">{_esc(doc.title)}</h1>')
    if doc.properties:
        rows = "".join(f"<tr><td>{_esc(k)}</td><td>{_html_runs(v)}</td></tr>" for k, v in doc.properties)
        parts.append(f'<table class="props">{rows}</table>')
    if outline:
        hs = headings(doc.blocks)
        if hs:
            items = "".join(
                f'<li style="margin-left:{(h.level - 1) * 14}px">{_esc(plain(h.text))}</li>' for h in hs
            )
            parts.append(f'<nav class="outline"><ul>{items}</ul></nav>')
    parts.append(f'<div class="content">{_html_blocks(doc.blocks)}</div>')
    parts.append("</body></html>")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Microsoft Word (.docx)

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

_CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '<Override PartName="/word/styles.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    "</Types>"
)

_ROOT_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    'Target="word/document.xml"/>'
    "</Relationships>"
)


def _style(sid: str, name: str, ppr: str = "", rpr: str = "", based: str = "Normal") -> str:
    base = f'<w:basedOn w:val="{based}"/>' if based and sid != based else ""
    return (
        f'<w:style w:type="paragraph" w:styleId="{sid}"><w:name w:val="{name}"/>{base}'
        f'<w:qFormat/><w:pPr>{ppr}</w:pPr><w:rPr>{rpr}</w:rPr></w:style>'
    )


def _styles_xml() -> str:
    heads = "".join(
        _style(
            f"Heading{n}",
            f"heading {n}",
            f'<w:keepNext/><w:spacing w:before="{280 - n * 30}" w:after="80"/><w:outlineLvl w:val="{n - 1}"/>',
            f'<w:b/><w:sz w:val="{size}"/>',
        )
        for n, size in ((1, 36), (2, 30), (3, 26), (4, 24), (5, 22), (6, 22))
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:styles xmlns:w="{_W_NS}">'
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" '
        'w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>'
        '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr>'
        "</w:pPrDefault></w:docDefaults>"
        + _style("Normal", "Normal", based="")
        + _style("Title", "Title", '<w:spacing w:after="200"/>', '<w:b/><w:sz w:val="48"/>')
        + _style("Subtitle", "Subtitle", "", '<w:caps/><w:color w:val="6B7280"/><w:sz w:val="18"/>')
        + heads
        + _style("Quote", "Quote", '<w:ind w:left="567"/>', '<w:i/><w:color w:val="555555"/>')
        + _style(
            "Code",
            "Code",
            '<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>',
            '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/>',
        )
        + _style("ListParagraph", "List Paragraph", '<w:spacing w:after="40"/>')
        + "</w:styles>"
    )


def _wt(text: str) -> str:
    return f'<w:t xml:space="preserve">{_xml_escape(text)}</w:t>'


class _Docx:
    def __init__(self) -> None:
        self.body: list[str] = []
        self.links: list[str] = []

    def rel(self, url: str) -> str:
        self.links.append(url)
        return f"rIdL{len(self.links)}"

    def runs(self, text: str, bold: bool = False) -> str:
        out = []
        for r in parse_inline(text):
            # Children in the schema's order (rFonts, b, i, strike, color, u): Word is strict.
            rpr = ""
            if r.code or r.math:
                rpr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>'
            if r.bold or bold:
                rpr += "<w:b/>"
            if r.italic:
                rpr += "<w:i/>"
            if r.strike:
                rpr += "<w:strike/>"
            if r.href:
                rpr += '<w:color w:val="2563EB"/>'
                if not r.href.startswith("wiki:"):
                    rpr += '<w:u w:val="single"/>'
            run = f"<w:r><w:rPr>{rpr}</w:rPr>{_wt(r.text)}</w:r>"
            if r.href and re.match(r"^(https?:|mailto:)", r.href, re.I):
                run = f'<w:hyperlink r:id="{self.rel(r.href)}">{run}</w:hyperlink>'
            out.append(run)
        return "".join(out)

    def para(self, content: str, style: str = "", ppr: str = "") -> None:
        st = f'<w:pStyle w:val="{style}"/>' if style else ""
        self.body.append(f"<w:p><w:pPr>{st}{ppr}</w:pPr>{content}</w:p>")

    def table(self, rows: list[list[str]], header: bool, borders: bool = True) -> None:
        if not rows:
            return
        cols = max(len(r) for r in rows)
        line = "single" if borders else "nil"
        tblpr = (
            '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'
            + "".join(
                f'<w:{s} w:val="{line}" w:sz="4" w:space="0" w:color="D0D4DA"/>'
                for s in ("top", "left", "bottom", "right", "insideH", "insideV")
            )
            + "</w:tblBorders></w:tblPr>"
        )
        grid = "<w:tblGrid>" + '<w:gridCol w:w="2400"/>' * cols + "</w:tblGrid>"
        trs = []
        for n, row in enumerate(rows):
            tcs = []
            for c in row + [""] * (cols - len(row)):
                runs = self.runs(c, bold=header and n == 0)
                tcs.append(f'<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p>{runs}</w:p></w:tc>')
            trs.append("<w:tr>" + "".join(tcs) + "</w:tr>")
        self.body.append(f"<w:tbl>{tblpr}{grid}{''.join(trs)}</w:tbl>")
        self.body.append("<w:p/>")

    def blocks(self, blocks: list[Block]) -> None:
        for b in blocks:
            if b.kind == "heading":
                self.para(self.runs(b.text), f"Heading{min(b.level, 6)}")
            elif b.kind == "para":
                self.para(self.runs(b.text))
            elif b.kind == "item":
                mark = (
                    ("\u2611 " if b.checked else "\u2610 ")
                    if b.checked is not None
                    else (f"{b.number}. " if b.ordered else "\u2022 ")
                )
                ind = 360 + 360 * b.level
                self.para(
                    f"<w:r>{_wt(mark)}</w:r>" + self.runs(b.text),
                    "ListParagraph",
                    f'<w:ind w:left="{ind}" w:hanging="280"/>',
                )
            elif b.kind == "quote":
                self.para(self.runs(b.text), "Quote")
            elif b.kind in ("code", "math"):
                for ln in b.text.split("\n") or [""]:
                    self.para(f"<w:r>{_wt(ln)}</w:r>", "Code")
                self.para("")
            elif b.kind == "hr":
                self.para(
                    "",
                    ppr='<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D0D4DA"/></w:pBdr>',
                )
            elif b.kind == "table":
                self.table(b.rows, header=True)
            elif b.kind == "image":
                if b.text:
                    self.para(f"<w:r><w:rPr><w:i/></w:rPr>{_wt(b.text)}</w:r>")
            elif b.kind == "embed":
                self.para(f'<w:r><w:rPr><w:b/><w:color w:val="2563EB"/></w:rPr>{_wt(b.title)}</w:r>')
                if b.children:
                    self.blocks(b.children)

    def document_xml(self) -> str:
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:document xmlns:w="{_W_NS}" xmlns:r="{_R_NS}"><w:body>'
            + "".join(self.body)
            + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" '
            'w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>'
            "</w:body></w:document>"
        )

    def rels_xml(self) -> str:
        rels = "".join(
            f'<Relationship Id="rIdL{n}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
            f'Target="{_xml_escape(url, {chr(34): "&quot;"})}" TargetMode="External"/>'
            for n, url in enumerate(self.links, 1)
        )
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rIdS" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
            'Target="styles.xml"/>' + rels + "</Relationships>"
        )


def render_docx(doc: Doc, type_label: bool = False) -> bytes:
    """``doc`` as a Microsoft Word file: a minimal WordprocessingML package."""
    w = _Docx()
    if type_label and doc.type_name:
        w.para(f"<w:r>{_wt(doc.type_name)}</w:r>", "Subtitle")
    w.para(f"<w:r>{_wt(doc.title)}</w:r>", "Title")
    if doc.properties:
        w.table([[k, v] for k, v in doc.properties], header=False, borders=False)
    w.blocks(doc.blocks)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", _CONTENT_TYPES)
        zf.writestr("_rels/.rels", _ROOT_RELS)
        zf.writestr("word/document.xml", w.document_xml())
        zf.writestr("word/styles.xml", _styles_xml())
        zf.writestr("word/_rels/document.xml.rels", w.rels_xml())
    return buf.getvalue()


# ---------------------------------------------------------------------------
# LaTeX

_TEX_ESC = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}


def tex_escape(s: str) -> str:
    return "".join(_TEX_ESC.get(c, c) for c in s)


# TeX commands that read or write files: a note's math must not do that when the .tex is compiled.
_TEX_FILE_CMDS = re.compile(r"\\(input|include|includeonly|openin|openout|read|write|immediate|special)(?![A-Za-z])")


def _tex_math(text: str) -> str:
    """Math text for the .tex, with file-reading or -writing commands made harmless (our choice)."""
    return _TEX_FILE_CMDS.sub(lambda m: "\\backslash " + m.group(1), text)


def _tex_runs(text: str) -> str:
    out = []
    for r in parse_inline(text):
        if r.math:
            out.append(f"${_tex_math(r.text)}$")
            continue
        s = tex_escape(r.text)
        if r.code:
            s = rf"\texttt{{{s}}}"
        if r.bold:
            s = rf"\textbf{{{s}}}"
        if r.italic:
            s = rf"\emph{{{s}}}"
        if r.strike:
            s = rf"\sout{{{s}}}"
        if r.href and re.match(r"^(https?:|mailto:)", r.href, re.I):
            url = r.href.replace("\\", "/").replace("%", r"\%").replace("#", r"\#")
            s = rf"\href{{{url}}}{{{s}}}"
        out.append(s)
    return "".join(out)


_TEX_HEADS = ("section", "subsection", "subsubsection", "paragraph", "subparagraph", "subparagraph")


def _tex_blocks(blocks: list[Block]) -> list[str]:
    out: list[str] = []
    envs: list[str] = []

    def close_to(depth: int) -> None:
        while len(envs) > depth:
            out.append(rf"\end{{{envs.pop()}}}")

    for b in blocks:
        if b.kind != "item":
            close_to(0)
        if b.kind == "heading":
            out.append(rf"\{_TEX_HEADS[min(b.level, 6) - 1]}*{{{_tex_runs(b.text)}}}")
        elif b.kind == "para":
            out.append(_tex_runs(b.text) + "\n")
        elif b.kind == "item":
            env = "enumerate" if _list_kind(b) == "ol" else "itemize"
            close_to(b.level + 1)
            if len(envs) == b.level + 1 and envs[-1] != env:
                close_to(b.level)
            while len(envs) <= b.level:
                out.append(rf"\begin{{{env}}}")
                envs.append(env)
            label = "" if b.checked is None else ("[$\\boxtimes$]" if b.checked else "[$\\square$]")
            out.append(rf"\item{label} {_tex_runs(b.text)}")
        elif b.kind == "quote":
            out.append("\\begin{quote}\n" + _tex_runs(b.text) + "\n\\end{quote}")
        elif b.kind == "code":
            out.append("\\begin{verbatim}\n" + b.text.replace("\\end{verbatim}", "\\end {verbatim}") + "\n\\end{verbatim}")
        elif b.kind == "math":
            out.append("\\[\n" + _tex_math(b.text) + "\n\\]")
        elif b.kind == "hr":
            out.append("\\noindent\\rule{\\linewidth}{0.4pt}\n")
        elif b.kind == "table" and b.rows:
            cols = max(len(r) for r in b.rows)
            lines = ["\\begin{tabular}{|" + "l|" * cols + "}", "\\hline"]
            for n, row in enumerate(b.rows):
                cells = [_tex_runs(c) for c in row + [""] * (cols - len(row))]
                if n == 0:
                    cells = [rf"\textbf{{{c}}}" if c else c for c in cells]
                lines.append(" & ".join(cells) + r" \\ \hline")
            lines.append("\\end{tabular}\n")
            out.append("\n".join(lines))
        elif b.kind == "image":
            note = f"% image: {b.src}" if b.src else "% image"
            out.append(note + ("\n\\emph{" + tex_escape(b.text) + "}\n" if b.text else ""))
        elif b.kind == "embed":
            out.append(rf"\noindent\textbf{{{tex_escape(b.title)}}}" + "\n")
            if b.children:
                out.extend(_tex_blocks(b.children))
    close_to(0)
    return out


def render_latex(doc: Doc, type_label: bool = False) -> str:
    """``doc`` as a LaTeX ``article``."""
    lines = [
        r"\documentclass[11pt]{article}",
        r"\usepackage[utf8]{inputenc}",
        r"\usepackage[T1]{fontenc}",
        r"\usepackage{amssymb}",
        r"\usepackage[normalem]{ulem}",
        r"\usepackage{hyperref}",
        "",
        rf"\title{{{tex_escape(doc.title)}}}",
        r"\date{}",
        "",
        r"\begin{document}",
        r"\maketitle",
        "",
    ]
    if type_label and doc.type_name:
        lines.insert(-1, rf"\begin{{center}}\textsc{{{tex_escape(doc.type_name)}}}\end{{center}}")
    if doc.properties:
        lines.append(r"\begin{description}")
        lines.extend(rf"\item[{tex_escape(k)}] {_tex_runs(v)}" for k, v in doc.properties)
        lines.append(r"\end{description}")
        lines.append("")
    lines.extend(_tex_blocks(doc.blocks))
    lines += ["", r"\end{document}", ""]
    return "\n".join(lines)
