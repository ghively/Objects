"""``.md``, ``.txt`` and ``.html``/``.htm`` (HTML becomes Markdown)."""

from __future__ import annotations

import re
from pathlib import Path

from .model import ReadResult


def decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16"):
        try:
            if enc == "utf-16" and not data.startswith((b"\xff\xfe", b"\xfe\xff")):
                continue
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    return data.decode("cp1252", errors="replace")


def read_text(path: Path) -> ReadResult:
    return ReadResult(title=path.stem, markdown=decode(path.read_bytes()))


def read_html(path: Path) -> ReadResult:
    from bs4 import BeautifulSoup
    from markdownify import markdownify

    soup = BeautifulSoup(decode(path.read_bytes()), "html.parser")
    title = soup.title.get_text(strip=True) if soup.title else ""
    notes: list[str] = []
    for tag in soup(["script", "style", "head"]):
        tag.decompose()
    body = soup.body or soup
    md = markdownify(str(body), heading_style="ATX", bullets="-")
    md = re.sub(r"\n{3,}", "\n\n", md).strip() + "\n"
    if soup.find("img"):
        notes.append("HTML images are not copied")
    return ReadResult(title=title or path.stem, markdown=md, notes=notes)
