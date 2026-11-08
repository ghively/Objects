"""``.xlsx`` and ``.csv``: sheets up to 200 rows x 20 columns become tables; larger ones link to the original."""

from __future__ import annotations

import csv
import io
import re
import zipfile
from pathlib import Path

from .model import TABLE_MAX_ROWS, ReadResult
from .textfiles import decode
from .util import cell_text, check_unpacked_size, fits, iso, table_md


def _sheet_md(name: str | None, rows: list[list[str]], notes: list[str], label: str,
              size: tuple[int, int] | None = None) -> list[str]:
    """``size``: (rows, columns) of the whole sheet when ``rows`` holds only its first rows."""
    head = [f"## {name}", ""] if name else []
    while rows and not any(rows[-1]):
        rows.pop()
    if not rows:
        return head + ["(empty sheet)", ""]
    n_rows, cols = size or (len(rows), max(len(r) for r in rows))
    if not fits(n_rows, cols):
        notes.append(f"{label} is larger than 200 rows x 20 columns: see the original")
        return head + [f"{label} has {n_rows} rows x {cols} columns, too large to show here. See the original file.", ""]
    return head + [table_md(rows), ""]


def _stream_rows(ws) -> tuple[list[list[str]], tuple[int, int]]:
    """The first rows a table can show (one more, to tell a larger sheet), and the sheet's size up
    to its last non-blank row, read row by row."""
    kept: list[list[str]] = []
    n_rows = width = cols = 0
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        cells = [cell_text(c) for c in r]
        width = max(width, len(cells))
        if any(cells):
            n_rows, cols = i + 1, width
        if i <= TABLE_MAX_ROWS:
            kept.append(cells)
    return kept[:n_rows], (n_rows, cols)


_MERGE = re.compile(rb"<(?:[\w.-]+:)?mergeCell\b")


def _has_merged_cells(path: Path) -> bool:
    """A read-only workbook doesn't load merged ranges: look for them in the sheet parts, a chunk
    at a time."""
    with zipfile.ZipFile(path) as zf:
        for name in zf.namelist():
            if not (name.startswith("xl/worksheets/") and name.endswith(".xml")):
                continue
            tail = b""
            with zf.open(name) as f:
                while chunk := f.read(1 << 20):
                    if _MERGE.search(tail + chunk):
                        return True
                    tail = chunk[-64:]
    return False


def read_xlsx(path: Path) -> ReadResult:
    from openpyxl import load_workbook

    check_unpacked_size(path)
    wb = load_workbook(str(path), data_only=True, read_only=True)
    notes: list[str] = []
    out: list[str] = []
    try:
        for ws in wb.worksheets:
            rows, size = _stream_rows(ws)
            out += _sheet_md(ws.title if len(wb.worksheets) > 1 else None, rows, notes, f"Sheet {ws.title!r}", size)
        p = wb.properties
    finally:
        wb.close()
    if _has_merged_cells(path):
        notes.append("Merged cells flattened")
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
