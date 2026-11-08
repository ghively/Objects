"""``.pptx``: a section per slide (title, text, images); speaker notes in a toggle."""

from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from .model import ExtractedImage, ReadResult
from .util import cell_text, check_unpacked_size, iso, table_md


def read(path: Path) -> ReadResult:
    check_unpacked_size(path)
    prs = Presentation(str(path))
    images: list[ExtractedImage] = []
    notes: list[str] = []
    out: list[str] = []
    skipped = False

    def walk(shapes, lines: list[str], title_shape):
        nonlocal skipped
        for sh in shapes:
            if sh is title_shape:
                continue
            if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
                walk(sh.shapes, lines, title_shape)
            elif sh.shape_type == MSO_SHAPE_TYPE.PICTURE:
                img = sh.image
                name = f"{path.stem}-image{len(images) + 1}.{img.ext}"
                images.append(ExtractedImage(name, img.blob, img.content_type))
                lines += [f"![]({name})", ""]
            elif sh.has_text_frame:
                for para in sh.text_frame.paragraphs:
                    t = "".join(r.text for r in para.runs).strip()
                    if t:
                        lines.append(f"{'  ' * para.level}- {t}" if para.level or len(sh.text_frame.paragraphs) > 1 else t)
                lines.append("")
            elif getattr(sh, "has_table", False) and sh.has_table:
                rows = [[cell_text(c.text) for c in r.cells] for r in sh.table.rows]
                if rows:
                    lines += [table_md(rows), ""]
            elif sh.shape_type in (MSO_SHAPE_TYPE.CHART, MSO_SHAPE_TYPE.EMBEDDED_OLE_OBJECT, MSO_SHAPE_TYPE.MEDIA):
                skipped = True

    for n, slide in enumerate(prs.slides, 1):
        ts = slide.shapes.title
        title = ts.text_frame.text.strip() if ts is not None and ts.has_text_frame else ""
        out += [f"## Slide {n}" + (f": {title}" if title else ""), ""]
        walk(slide.shapes, out, ts)
        if slide.has_notes_slide:
            nt = slide.notes_slide.notes_text_frame.text.strip() if slide.notes_slide.notes_text_frame else ""
            if nt:
                out += ["<!-- toggle -->", "Speaker notes", ""] + [f"  {l}" if l else "" for l in nt.splitlines()]
                out += ["<!-- /toggle -->", ""]
    if skipped:
        notes.append("Charts, embedded objects and media on slides are not shown")
    cp = prs.core_properties
    return ReadResult(
        title=(cp.title or "").strip() or path.stem,
        markdown="\n".join(out).strip() + "\n",
        images=images,
        notes=notes,
        created=iso(cp.created),
        modified=iso(cp.modified),
        author=(cp.author or "").strip() or None,
    )
