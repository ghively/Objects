from __future__ import annotations

import re
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


_URL_NOISE = re.compile(r"[\x00-\x20\x7f]")
_SCHEME = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.-]*):")


def link_kind(url: str | None) -> str | None:
    """``"remote"`` for an http(s) URL, ``"local"`` for a mailto or a relative link, None for
    anything else (``javascript:``, ``file:``, ``data:``, a protocol-relative ``//host``), which an
    imported page never keeps: Object promises no network access and no script from note content.
    Spaces and control characters are ignored the way a browser ignores them."""
    if not url:
        return None
    bare = _URL_NOISE.sub("", url)
    if bare.startswith(("//", "\\\\", "/\\", "\\/")):
        return None
    m = _SCHEME.match(bare)
    if m is None:
        return "local"
    scheme = m.group(1).lower()
    if scheme in ("http", "https"):
        return "remote"
    return "local" if scheme == "mailto" else None


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
