"""Rewriting an imported page's Markdown: links, embeds, attachments and callouts.

`convert` is run twice on every body with the same hooks: once by the reader (the preview),
which keeps only the links it found, and once by the writer, which keeps the text. It is
deterministic, so the preview's counts are what gets written. Code (fenced blocks and inline
spans, as `relink.segments` finds them) is never touched.

Rules (contract "Per-source rules"; the choices marked there are ours):

- ``[text](Relative%20Path.md)`` (decoded, relative to the page) -> ``[[Title]]``, or
  ``[[Title|text]]`` when the text differs; a link to a ``.csv`` (a Notion database) and a link
  to a page not in the source become their text. Web links stay.
- ``![alt](file.png)`` -> ``![alt](Attachments/file.png)`` (the path escaped as
  ``encodeMarkdownPath`` does); a link to another local file -> ``![[Attachments/file.pdf]]``
  when it is alone on its line, else ``[text](Attachments/file.pdf)``. A missing file leaves
  the link's text.
- ``[[Note]]``, ``[[Note|alias]]``, ``[[Note#Heading]]`` -> the target's link text with the
  ``#…`` and ``|alias`` parts kept; unresolved ones stay as written.
- ``![[Note]]`` -> ``![[Title]]``; ``![[image.png|300]]`` -> ``![](Attachments/image.png)``
  with ``<!-- block: width=300 -->`` before it when alone on its line; ``![[file.pdf]]`` ->
  ``![[Attachments/file.pdf]]``.
- Callouts: Notion's ``<aside>`` block and Obsidian's ``> [!type] Title`` become a standout
  quote (``<!-- block: quote=standout -->`` before the ``>`` lines); the marker is dropped and
  the title kept in bold (the type's name when there is no title).
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from urllib.parse import unquote

from ..media import IMAGE_EXTENSIONS
from ..relink import code_ranges
from .model import PlanLink

__all__ = ["Converted", "Hooks", "convert", "encode_markdown_path", "inline_tags", "is_image"]

STANDOUT = "<!-- block: quote=standout -->"

_LINK_RE = re.compile(
    r"(?P<wiki>(?P<wbang>!?)\[\[(?P<winner>[^\[\]\n]+)\]\])"
    r"|(?P<md>(?P<mbang>!?)\[(?P<mtext>[^\[\]\n]*)\]\(\s*(?:<(?P<mangle>[^>\n]*)>|(?P<mdest>[^)\s]+))"
    r"(?:\s+\"[^\"\n]*\")?\s*\))"
)
_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
_FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_CALLOUT_RE = re.compile(r"^(?P<ws>[ \t]*)>[ \t]?\[!(?P<type>[^\]\s]+)\][+-]?[ \t]*(?P<title>.*)$")
_HTML_RE = re.compile(r"<(?:details|summary|table|div|span)\b", re.IGNORECASE)
_WIDTH_RE = re.compile(r"^(\d+)(?:x(\d+))?$")
_TAG_RE = re.compile(r"(?:(?<=[\s(,])|^)#([^\s#!\"$%&'()*+,.:;<=>?@\[\]^`{|}~\\]+)", re.MULTILINE)


def encode_markdown_path(path: str) -> str:
    """``encodeMarkdownPath``: spaces and parentheses escaped, so ``![…](…)`` stays one token."""
    return path.replace("%", "%25").replace(" ", "%20").replace("(", "%28").replace(")", "%29")


def is_image(path: str) -> bool:
    return PurePosixPath(path).suffix.lower() in IMAGE_EXTENSIONS


# What a hook answers: (kind, source path). kind is 'object', 'attachment', 'database',
# 'unresolved' (a page not in the source) or 'missing' (a file not in the source).
Resolved = tuple[str, str | None]


@dataclass
class Hooks:
    resolve_href: Callable[[str, str], Resolved]
    """A Markdown link destination (decoded, no ``#anchor``) from a page: what it names."""
    resolve_wiki: Callable[[str, str], Resolved]
    """A wikilink target (no ``#…`` or ``|…``) from a page."""
    object_link: Callable[[str, str], tuple[str, str]] = lambda target, _from: (target, target)
    """(link text, title) of the object at source path ``target`` from the page ``_from``."""
    attachment_path: Callable[[str], str | None] = lambda target: f"Attachments/{PurePosixPath(target).name}"
    """The space path the attachment at source path ``target`` is written to (None: not copied)."""


@dataclass
class Converted:
    text: str
    links: list[PlanLink] = field(default_factory=list)
    html: bool = False
    """The body holds HTML the import keeps as written (listed once in the warnings)."""


def _alone(text: str, start: int, end: int) -> tuple[bool, str]:
    """Whether ``text[start:end]`` is alone on its line, and the line's leading whitespace."""
    ls = text.rfind("\n", 0, start) + 1
    le = text.find("\n", end)
    le = len(text) if le == -1 else le
    before, after = text[ls:start], text[end:le]
    return (not before.strip() and not after.strip()), before


def _in_ranges(start: int, end: int, ranges: list[tuple[int, int]], idx: list[int]) -> bool:
    """Whether [start, end) touches a code range (``ranges`` sorted; ``idx`` a moving cursor)."""
    i = idx[0]
    while i < len(ranges) and ranges[i][1] <= start:
        i += 1
    idx[0] = i
    return i < len(ranges) and ranges[i][0] < end


def _callouts(text: str, notion: bool) -> tuple[str, bool]:
    """Callouts as standout quotes (outside fenced code); also whether other HTML is present."""
    lines = text.split("\n")
    out: list[str] = []
    fence: str | None = None
    html = False
    i = 0
    in_quote = False
    while i < len(lines):
        line = lines[i]
        m = _FENCE_RE.match(line)
        if fence is not None:
            out.append(line)
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence):
                fence = None
            i += 1
            continue
        if m:
            fence = m.group(1)
            out.append(line)
            in_quote = False
            i += 1
            continue
        stripped = line.strip()
        if notion and stripped.lower().startswith("<aside>"):
            end = next((j for j in range(i, len(lines)) if "</aside>" in lines[j].lower()), None)
            if end is not None:
                inner = "\n".join(lines[i : end + 1])
                a = inner.lower().find("<aside>") + len("<aside>")
                b = inner.lower().rfind("</aside>")
                body = inner[a:b].strip("\n").split("\n")
                while body and not body[0].strip():
                    body.pop(0)
                while body and not body[-1].strip():
                    body.pop()
                out.append(STANDOUT)
                out.extend(f"> {b_.strip()}" if b_.strip() else ">" for b_ in body or [""])
                i = end + 1
                in_quote = True
                continue
        cm = _CALLOUT_RE.match(line)
        if cm and not in_quote:
            title = cm.group("title").strip() or cm.group("type").capitalize()
            ws = cm.group("ws")
            out.append(f"{ws}{STANDOUT}")
            out.append(f"{ws}> **{title}**")
            in_quote = True
            i += 1
            continue
        if _HTML_RE.search(line):
            html = True
        in_quote = stripped.startswith(">")
        out.append(line)
        i += 1
    return "\n".join(out), html


def _split_wiki(inner: str) -> tuple[str, str | None, str | None]:
    """(target, ``#heading`` part or None, alias or None) of a wikilink's inner text."""
    target, _, alias = inner.partition("|")
    has_alias = "|" in inner
    target, hash_, heading = target.partition("#")
    return target.strip(), (f"#{heading}" if hash_ else None), (alias if has_alias else None)


def _decode_dest(dest: str) -> str:
    try:
        return unquote(dest)
    except Exception:  # noqa: BLE001 - a bad escape: use the text as written
        return dest


def convert(body: str, page: str, hooks: Hooks, *, notion_callouts: bool = False) -> Converted:
    """``body`` (``\\n`` line endings) of the page at source path ``page``, rewritten."""
    text, html = _callouts(body, notion_callouts)
    links: list[PlanLink] = []
    if "[" not in text:
        return Converted(text, links, html)
    ranges = code_ranges(text)
    cursor = [0]
    out: list[str] = []
    last = 0
    for m in _LINK_RE.finditer(text):
        start, end = m.span()
        if _in_ranges(start, end, ranges, cursor):
            continue
        raw = m.group(0)
        if m.group("wiki"):
            new = _wiki(m, text, page, hooks, links)
        else:
            new = _markdown(m, text, page, hooks, links)
        if new is None or new == raw:
            continue
        out.append(text[last:start])
        out.append(new)
        last = end
    out.append(text[last:])
    return Converted("".join(out), links, html)


def _wiki(m: re.Match[str], text: str, page: str, hooks: Hooks, links: list[PlanLink]) -> str | None:
    raw = m.group(0)
    embed = bool(m.group("wbang"))
    target, heading, alias = _split_wiki(m.group("winner"))
    if not target:
        return None
    kind, found = hooks.resolve_wiki(target, page)
    if kind == "object" and found is not None:
        links.append(PlanLink(page, raw, found, "object", alias, heading, embed))
        link_text, _title = hooks.object_link(found, page)
        suffix = (heading or "") + (f"|{alias}" if alias is not None else "")
        return f"{'!' if embed else ''}[[{link_text}{suffix}]]"
    if kind == "attachment" and found is not None:
        links.append(PlanLink(page, raw, found, "attachment", alias, heading, embed))
        path = hooks.attachment_path(found)
        if path is None:
            return alias if alias and not embed else raw
        alone, ws = _alone(text, m.start(), m.end())
        if embed and is_image(path):
            image = f"![]({encode_markdown_path(path)})"
            size = _WIDTH_RE.match((alias or "").strip())
            if size and alone:
                opts = f"width={size.group(1)}" + (f" height={size.group(2)}" if size.group(2) else "")
                return f"<!-- block: {opts} -->\n{ws}{image}"
            return image
        if embed:
            return f"![[{path}]]"
        label = alias if alias is not None else PurePosixPath(found).name
        return f"[{label}]({encode_markdown_path(path)})"
    # Unresolved: stays as written (the app shows it as missing).
    is_file = "." in PurePosixPath(target).name and not target.lower().endswith(".md")
    links.append(
        PlanLink(page, raw, None, "attachment" if (is_file and embed) else "unresolved", alias, heading, embed)
    )
    return None


def _markdown(m: re.Match[str], text: str, page: str, hooks: Hooks, links: list[PlanLink]) -> str | None:
    raw = m.group(0)
    dest = m.group("mangle") if m.group("mangle") is not None else m.group("mdest")
    label = m.group("mtext")
    bang = bool(m.group("mbang"))
    if not dest or _SCHEME_RE.match(dest) or dest.startswith("#") or dest.startswith("//"):
        return None
    path = _decode_dest(dest.split("#", 1)[0])
    if not path:
        return None
    kind, found = hooks.resolve_href(path, page)
    shown = label.strip()
    if kind == "object" and found is not None:
        links.append(PlanLink(page, raw, found, "object", shown or None, None, bang))
        link_text, title = hooks.object_link(found, page)
        if not shown or shown == title:
            return f"[[{link_text}]]"
        safe = shown.replace("|", "-").replace("[", "(").replace("]", ")")
        return f"[[{link_text}|{safe}]]"
    if kind == "database":
        links.append(PlanLink(page, raw, found, "database", shown or None, None, bang))
        return shown
    if kind == "unresolved":
        links.append(PlanLink(page, raw, None, "unresolved", shown or None, None, bang))
        return shown
    if kind == "attachment" and found is not None:
        links.append(PlanLink(page, raw, found, "attachment", shown or None, None, bang))
        out_path = hooks.attachment_path(found)
        if out_path is None:
            return shown
        enc = encode_markdown_path(out_path)
        if bang and is_image(out_path):
            return f"![{label}]({enc})"
        alone, _ws = _alone(text, m.start(), m.end())
        if alone:
            return f"![[{out_path}]]"
        return f"[{shown or PurePosixPath(out_path).name}]({enc})"
    if kind == "missing":
        links.append(PlanLink(page, raw, None, "attachment", shown or None, None, bang))
        return shown
    return None


def inline_tags(body: str) -> list[str]:
    """Obsidian's inline ``#tags`` outside code (a tag needs a character that isn't a digit)."""
    if "#" not in body:
        return []
    blanked = list(body)
    for s, e in code_ranges(body):
        blanked[s:e] = " " * (e - s)
    text = "".join(blanked)
    out: list[str] = []
    for m in _TAG_RE.finditer(text):
        tag = m.group(1).strip("/")
        if not tag or tag.isdigit() or all(c.isdigit() or c in "-_/" for c in tag):
            continue
        if tag not in out:
            out.append(tag)
    return out
