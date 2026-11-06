"""``.docx``: headings, paragraphs, lists, tables, links and embedded images, in body order."""

from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

from .model import ExtractedImage, ReadResult
from .util import cell_text, iso, table_md

_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/bmp": "bmp", "image/tiff": "tif"}
_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def read(path: Path) -> ReadResult:
    doc = Document(str(path))
    images: list[ExtractedImage] = []
    notes: list[str] = []
    by_rid: dict[str, str] = {}
    lines: list[str] = []
    flattened = False

    def image_for(rid: str) -> str | None:
        if rid in by_rid:
            return by_rid[rid]
        part = doc.part.related_parts.get(rid)
        if part is None:
            return None
        ctype = part.content_type
        name = f"{path.stem}-image{len(images) + 1}.{_EXT.get(ctype, ctype.split('/')[-1])}"
        images.append(ExtractedImage(name, part.blob, ctype))
        by_rid[rid] = name
        return name

    def para_text(p: Paragraph) -> str:
        out: list[str] = []
        for child in p._p.iterchildren():
            if child.tag == f"{_W}hyperlink":
                from docx.text.hyperlink import Hyperlink

                link = Hyperlink(child, p)
                text = link.text
                out.append(f"[{text}]({link.url})" if link.url and text else text)
            elif child.tag == f"{_W}r":
                from docx.text.run import Run

                run = Run(child, p)
                for blip in child.iter(f"{_A}blip"):
                    name = image_for(blip.get(f"{_R}embed") or "")
                    if name:
                        out.append(f"![]({name})")
                t = run.text
                if t.strip():
                    if run.bold and run.italic:
                        t = f"***{t.strip()}*** "
                    elif run.bold:
                        t = f"**{t.strip()}** "
                    elif run.italic:
                        t = f"*{t.strip()}* "
                out.append(t)
        return re.sub(r"\*\* \*\*|  +", lambda m: " ", "".join(out)).strip()

    def table(t: Table) -> None:
        nonlocal flattened
        rows: list[list[str]] = []
        for tr in t._tbl.tr_lst:
            row: list[str] = []
            for tc in tr.tc_lst:
                pr = tc.tcPr
                if pr is not None and (pr.find(f"{_W}gridSpan") is not None or pr.find(f"{_W}vMerge") is not None):
                    flattened = True
                row.append(cell_text(" ".join(Paragraph(p, None).text for p in tc.iterchildren(f"{_W}p"))))
            rows.append(row)
        if rows:
            lines.append(table_md(rows))
            lines.append("")

    for child in doc.element.body.iterchildren():
        if child.tag == f"{_W}p":
            p = Paragraph(child, doc)
            text = para_text(p)
            style = (p.style.name if p.style is not None else "") or ""
            if not text:
                continue
            m = re.match(r"Heading (\d)", style)
            if style == "Title":
                lines += [f"# {text}", ""]
            elif m:
                lines += [f"{'#' * min(int(m.group(1)), 6)} {text}", ""]
            elif style.startswith("List Bullet"):
                lines.append(f"- {text}")
            elif style.startswith("List Number"):
                lines.append(f"1. {text}")
            else:
                lines += [text, ""]
        elif child.tag == f"{_W}tbl":
            table(Table(child, doc))
    if flattened:
        notes.append("Merged cells flattened")
    cp = doc.core_properties
    title = (cp.title or "").strip() or path.stem
    md = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip() + "\n"
    return ReadResult(
        title=title,
        markdown=md,
        images=images,
        notes=notes,
        created=iso(cp.created),
        modified=iso(cp.modified),
        author=(cp.author or "").strip() or None,
    )
