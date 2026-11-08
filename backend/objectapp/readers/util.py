from __future__ import annotations

import zipfile
from datetime import datetime, timezone
from pathlib import Path

from .model import TABLE_MAX_COLS, TABLE_MAX_ROWS


MAX_OFFICE_UNPACKED_BYTES = 100 * 1024 * 1024
"""The most a .docx, .pptx or .xlsx may unpack to (all its parts) before it is parsed; a larger one
(a small file can inflate to hundreds of MB) is kept as Original only."""


class TooLarge(Exception):
    """The file unpacks to more than ``MAX_OFFICE_UNPACKED_BYTES``."""


def check_unpacked_size(path: Path) -> None:
    """Raise ``TooLarge`` when the Office file's parts unpack to more than the cap. A file that
    isn't a zip is left to its reader, which reports it as before."""
    try:
        with zipfile.ZipFile(path) as zf:
            total = sum(info.file_size for info in zf.infolist())
    except zipfile.BadZipFile:
        return
    if total > MAX_OFFICE_UNPACKED_BYTES:
        raise TooLarge(path.name)


def iso(value: object) -> str | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return None


def cell_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d" if value.time() == datetime.min.time() else "%Y-%m-%d %H:%M")
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    return text.replace("|", "\\|").replace("\n", "<br>").strip()


def table_md(rows: list[list[str]]) -> str:
    """A pipe table whose first row is the header."""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    out = ["| " + " | ".join(rows[0]) + " |", "|" + " --- |" * width]
    out += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(out)


def fits(rows: int, cols: int) -> bool:
    return rows <= TABLE_MAX_ROWS and cols <= TABLE_MAX_COLS
