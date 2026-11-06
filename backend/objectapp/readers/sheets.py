"""``.xlsx`` and ``.csv``: sheets up to 200 rows x 20 columns become tables; larger ones link to the original."""

from __future__ import annotations

import csv
import io
from pathlib import Path

from .model import ReadResult
from .textfiles import decode
from .util import cell_text, fits, iso, table_md


def _sheet_md(name: str | None, rows: list[list[str]], notes: list[str], label: str) -> list[str]:
    head = [f"## {name}", ""] if name else []
    while rows and not any(rows[-1]):
        rows.pop()
    if not rows:
        return head + ["(empty sheet)", ""]
    cols = max(len(r) for r in rows)
    if not fits(len(rows), cols):
        notes.append(f"{label} is larger than 200 rows x 20 columns: see the original")
        return head + [f"{label} has {len(rows)} rows x {cols} columns, too large to show here. See the original file.", ""]
    return head + [table_md(rows), ""]


def read_xlsx(path: Path) -> ReadResult:
    from openpyxl import load_workbook

    wb = load_workbook(str(path), data_only=True)
    notes: list[str] = []
    out: list[str] = []
    merged = False
    for ws in wb.worksheets:
        if ws.merged_cells.ranges:
            merged = True
        rows = [[cell_text(c) for c in r] for r in ws.iter_rows(values_only=True)]
        out += _sheet_md(ws.title if len(wb.worksheets) > 1 else None, rows, notes, f"Sheet {ws.title!r}")
    if merged:
        notes.append("Merged cells flattened")
    p = wb.properties
    return ReadResult(
        title=(p.title or "").strip() or path.stem,
        markdown="\n".join(out).strip() + "\n",
        notes=notes,
        created=iso(p.created),
        modified=iso(p.modified),
        author=(p.creator or "").strip() or None,
    )


def read_csv(path: Path) -> ReadResult:
    text = decode(path.read_bytes())
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = [[cell_text(c) for c in r] for r in csv.reader(io.StringIO(text), dialect)]
    notes: list[str] = []
    md = "\n".join(_sheet_md(None, rows, notes, "The table")).strip() + "\n"
    return ReadResult(title=path.stem, markdown=md, notes=notes)
