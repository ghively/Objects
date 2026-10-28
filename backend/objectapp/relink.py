"""Find and rewrite ``[[wikilinks]]`` in object files, changing only the link text.

`replace_wikilinks` rewrites the target of qualifying links in Markdown text,
keeping any ``#heading`` and ``|alias`` suffix and leaving fenced code blocks
and inline code spans alone. `relink_frontmatter` does the same inside
frontmatter values through `frontmatter.replace_in_value`, so only the affected
scalar (a list item, or one line of a literal block) changes and every other
byte, quote style included, is kept. `rewrite_tag_lists` renames one item of
a ``tags:`` list the same way. `wikilink_targets` lists the link targets
a text holds (outside code), to decide which files a rename must touch.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator
from typing import Any

from .frontmatter import replace_in_value

__all__ = [
    "code_ranges",
    "relink_frontmatter",
    "replace_wikilinks",
    "rewrite_tag_lists",
    "wikilink_spans",
    "wikilink_targets",
]

# [[target]], [[target#heading]], [[target|alias]], [[target#heading|alias]]
_LINK_RE = re.compile(r"\[\[([^\[\]|#\n]+)((?:#[^\[\]|\n]*)?(?:\|[^\[\]\n]*)?)\]\]")
_FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_TICKS_RE = re.compile(r"`+")


def _segments(text: str) -> Iterator[tuple[int, int, bool]]:
    """``(start, end, is_code)`` spans covering ``text`` in order.

    Code is a fenced block (from its opening fence line to the closing one, or
    to the end) or an inline code span (a run of backticks up to the next run
    of the same length on the same line).
    """
    pos = 0
    fence: str | None = None
    code_start = 0
    for line in text.splitlines(keepends=True):
        start, end = pos, pos + len(line)
        pos = end
        m = _FENCE_RE.match(line)
        if fence is not None:
            closes = m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence)
            if closes and not line[m.end() :].strip():
                yield code_start, end, True
                fence = None
            continue
        if m and not (m.group(1)[0] == "`" and "`" in line[m.end() :]):
            fence = m.group(1)
            code_start = start
            continue
        yield from _inline_segments(line, start)
    if fence is not None:
        yield code_start, pos, True


def _inline_segments(line: str, offset: int) -> Iterator[tuple[int, int, bool]]:
    i = 0
    plain = 0
    while True:
        m = _TICKS_RE.search(line, i)
        if m is None:
            break
        run = m.group(0)
        close = re.compile(r"(?<!`)" + re.escape(run) + r"(?!`)").search(line, m.end())
        if close is None:
            i = m.end()
            continue
        if m.start() > plain:
            yield offset + plain, offset + m.start(), False
        yield offset + m.start(), offset + close.end(), True
        plain = i = close.end()
    if plain < len(line):
        yield offset + plain, offset + len(line), False


def wikilink_targets(text: str) -> set[str]:
    """The target texts (without ``#heading`` / ``|alias``) of the links outside code."""
    out: set[str] = set()
    for s, e, code in _segments(text):
        if not code:
            out.update(m.group(1) for m in _LINK_RE.finditer(text, s, e))
    return out


def wikilink_spans(text: str) -> list[tuple[str, int, int]]:
    """``(target, start, end)`` of each link outside code, in order.

    ``target`` is the text before any ``#`` or ``|``, as written; the span covers
    the whole ``[[…]]``, or ``![[…]]`` for an embed.
    """
    out: list[tuple[str, int, int]] = []
    if "[[" not in text:
        return out
    for s, e, code in _segments(text):
        if code:
            continue
        for m in _LINK_RE.finditer(text, s, e):
            start = m.start()
            if start > s and text[start - 1] == "!":
                start -= 1
            out.append((m.group(1), start, m.end()))
    return out


def code_ranges(text: str) -> list[tuple[int, int]]:
    """``(start, end)`` of each fenced code block and inline code span, in order."""
    return [(s, e) for s, e, code in _segments(text) if code]


def replace_wikilinks(text: str, should_rewrite: Callable[[str], bool], new_target: str) -> str:
    """``text`` with each qualifying link's target replaced by ``new_target``.

    ``should_rewrite(target)`` decides per link (``target`` is the text before
    any ``#`` or ``|``, as written). Suffixes are kept; code is skipped.
    Returns ``text`` itself when nothing changes.
    """
    if "[[" not in text:
        return text
    parts: list[str] = []
    changed = False
    for s, e, code in _segments(text):
        chunk = text[s:e]
        if code or "[[" not in chunk:
            parts.append(chunk)
            continue

        def sub(m: re.Match[str]) -> str:
            nonlocal changed
            if not should_rewrite(m.group(1)):
                return m.group(0)
            changed = True
            return f"[[{new_target}{m.group(2)}]]"

        parts.append(_LINK_RE.sub(sub, chunk))
    return "".join(parts) if changed else text


def _has_link(value: Any, should_rewrite: Callable[[str], bool]) -> bool:
    if isinstance(value, str):
        return "[[" in value and any(should_rewrite(t) for t in wikilink_targets(value))
    if isinstance(value, list):
        return any(_has_link(v, should_rewrite) for v in value)
    return False


def relink_frontmatter(
    src: str, fm: dict, should_rewrite: Callable[[str], bool], new_target: str
) -> str:
    """Frontmatter source with qualifying links replaced, value by value.

    Each top-level value holding such a link (a scalar, a flow or block list of
    scalars, or a literal block) is rewritten in place with `replace_in_value`;
    other items, quotes and lines keep their bytes. Returns ``src`` itself
    when nothing changes.
    """
    out = src
    for key, value in fm.items():
        if not _has_link(value, should_rewrite):
            continue
        out = replace_in_value(out, key, lambda s: replace_wikilinks(s, should_rewrite, new_target))
    return out


def _fold(text: str) -> str:
    return " ".join(text.split()).casefold()


def rewrite_tag_lists(src: str, fm: dict, old: str, new: str) -> str:
    """Frontmatter source with the ``tags:`` item ``old`` (case-insensitively) renamed to ``new``.

    Works on a flow or block list (or a single scalar) through `replace_in_value`:
    other items, quote styles and lines keep their bytes. Returns ``src`` itself
    when the object has no such tag.
    """
    tags = fm.get("tags")
    items = tags if isinstance(tags, list) else [tags]
    target = _fold(old)
    if not any(isinstance(i, str) and _fold(i) == target for i in items):
        return src
    return replace_in_value(src, "tags", lambda s: new if _fold(s) == target else s)
