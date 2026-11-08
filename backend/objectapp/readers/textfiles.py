"""``.md``, ``.txt`` and ``.html``/``.htm`` (HTML becomes Markdown)."""

from __future__ import annotations

import re
from pathlib import Path

from .model import ReadResult
from .util import link_kind


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


def _safe_links(soup) -> None:
    """Keep only http(s), mailto and relative links; an image from the web becomes a plain link
    (its alt text, or "Image"), so the page never fetches it, and one with any other scheme keeps
    only its alt text. A relative image stays (it never leaves the app)."""
    for a in soup.find_all("a"):
        if a.has_attr("href") and link_kind(a["href"]) is None:
            del a["href"]
    for img in soup.find_all("img"):
        src = img.get("src")
        alt = (img.get("alt") or "").strip()
        kind = link_kind(src)
        if kind == "local" and src and not src.strip().lower().startswith("mailto:"):
            continue
        if kind == "remote":
            link = soup.new_tag("a", href=src)
            link.string = alt or "Image"
            img.replace_with(link)
        elif alt:
            img.replace_with(alt)
        else:
            img.decompose()


def read_html(path: Path) -> ReadResult:
    from bs4 import BeautifulSoup
    from markdownify import markdownify

    soup = BeautifulSoup(decode(path.read_bytes()), "html.parser")
    title = soup.title.get_text(strip=True) if soup.title else ""
    notes: list[str] = []
    for tag in soup(["script", "style", "head"]):
        tag.decompose()
    _safe_links(soup)
    body = soup.body or soup
    md = markdownify(str(body), heading_style="ATX", bullets="-")
    md = re.sub(r"\n{3,}", "\n\n", md).strip() + "\n"
    if soup.find("img"):
        notes.append("HTML images are not copied")
    return ReadResult(title=title or path.stem, markdown=md, notes=notes)
