"""The text the search index stores for an object (M5).

`plain_body` turns a Markdown body into plain text: headings, list and quote
markers, emphasis and link brackets go; link labels and targets, table cells
and code text stay. `property_text` is the indexed ``props`` column: one
``Name: value`` line per searchable property.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from .propvalues import TABLE_KIND, decode_value, table_plain
from .rows import (
    _BLOCK_ID_RE,
    _COMMENT_LINE_RE,
    _EM_STAR_RE,
    _EM_UNDER_RE,
    _FENCE_RE,
    _HEADING_RE,
    _LIST_RE,
    _MATH_FENCE_RE,
    _QUOTE_RE,
    _STRIKE_RE,
    _STRONG_RE,
    _TAG_RE,
    _TASK_RE,
)
from .synced import is_synced
from .typedefs import has_undecodable

if TYPE_CHECKING:
    from .typemodel import TypeDefinition

__all__ = ["SEARCHABLE_KINDS", "display_safe", "plain_body", "property_text"]

SEARCHABLE_KINDS = frozenset(
    {"text", "textBlock", "url", "number", "label", "entity", TABLE_KIND}
)
"""Property kinds the ``props`` column holds (dates, checkboxes and system kinds don't).
M31: a simple table's cells, header row included."""

_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$")
_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]*)[^)]*\)")
_MDLINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]*)[^)]*\)")
_WIKI_RE = re.compile(r"!?\[\[([^\[\]|]*?)(?:\|([^\[\]]*))?\]\]")
_CODE_RE = re.compile(r"(`+)(.+?)\1")
_RULE_RE = re.compile(r"^\s*(?:[-*_]\s*){3,}$")
_SPACE_RE = re.compile(r"[ \t]+")


def display_safe(text: str) -> str:
    """``text`` with undecodable bytes (surrogate escapes) as U+FFFD, so SQLite can store it."""
    if has_undecodable(text):
        return text.encode("utf-8", errors="surrogateescape").decode(
            "utf-8", errors="replace"
        )
    return text


def _wiki(m: re.Match[str]) -> str:
    target = m.group(1).strip()
    label = (m.group(2) or "").strip()
    return f"{target} {label}" if label and label != target else target


def _link(m: re.Match[str]) -> str:
    label, url = m.group(1).strip(), m.group(2).strip()
    return f"{label} {url}" if url else label


def _inline(line: str) -> str:
    # Each pattern runs only when the line holds the text it can't match without
    # (audit 2026-11-01: every regex on every line cost 12.9 ms per 50 KB body).
    if "`" in line:
        line = _CODE_RE.sub(lambda m: m.group(2).strip(), line)
    if "<" in line:
        line = _TAG_RE.sub("", line)
    if "[" in line:
        if "![" in line:
            line = _IMAGE_RE.sub(_link, line)
        if "[[" in line:
            line = _WIKI_RE.sub(_wiki, line)
        if "](" in line:
            line = _MDLINK_RE.sub(_link, line)
    if "*" in line or "_" in line:
        if "**" in line or "__" in line:
            line = _STRONG_RE.sub(r"\2", line)
        if "*" in line:
            line = _EM_STAR_RE.sub(r"\1", line)
        if "_" in line:
            line = _EM_UNDER_RE.sub(r"\1", line)
    if "~~" in line:
        line = _STRIKE_RE.sub(r"\1", line)
    return line


def plain_body(body: str) -> str:
    """Plain text of a Markdown body, one line per non-empty source line."""
    out: list[str] = []
    fenced = False
    fences = "```" in body or "~~~" in body
    for line in body.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if fences and _FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced:
            if line.strip():
                out.append(line.strip())
            continue
        stripped = line.lstrip()  # the same whitespace as the patterns' ``\s``
        first = stripped[:1]
        if first in _RULE_START and _RULE_RE.match(line):
            continue
        if "|" in line and "-" in line and _TABLE_SEP_RE.match(line):
            continue
        if "<!--" in line and _COMMENT_LINE_RE.match(line):
            continue
        if "$$" in line and _MATH_FENCE_RE.match(line):
            continue
        if " ^" in line:
            line = _BLOCK_ID_RE.sub("", line)
        stripped = line.strip()
        if stripped.startswith("|"):
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            line = " ".join(c for c in cells if c)
        elif first:
            if "#" in line:
                line = _HEADING_RE.sub("", line)
            if ">" in line:
                line = _QUOTE_RE.sub("", line)
            first = line.lstrip()[:1]
            if first in _LIST_START or first.isdigit():
                line = _LIST_RE.sub("", line)
            if line.startswith("["):
                line = _TASK_RE.sub("", line)
        line = _inline(line)
        if "\t" in line or "  " in line:
            line = _SPACE_RE.sub(" ", line)
        line = line.strip()
        if line:
            out.append(line)
    return display_safe("\n".join(out))


_RULE_START = frozenset("-*_")
_LIST_START = frozenset("-*+")


def _value_text(kind: str, value: Any, link_title: Callable[[str], str]) -> str:
    if value is None:
        return ""
    if kind == "entity":
        titles = [
            link_title(v["target"])
            for v in value
            if isinstance(v, dict) and v.get("target")
        ]
        return ", ".join(t for t in titles if t)
    if kind == "label":
        return ", ".join(str(v) for v in value if v)
    if kind == TABLE_KIND:
        return table_plain(value)
    if isinstance(value, bool):
        return ""
    return str(value)


def property_text(
    t: TypeDefinition | None, fm: dict[str, Any], link_title: Callable[[str], str]
) -> str:
    """The ``props`` column: ``Name: value`` per searchable property with a value.

    A property counts when its kind is text, URL, number, label (option texts),
    simple table (its cells, M31) or relation (``link_title`` turns each target
    into a title), and it is not
    marked ``isNotSearchable``. Dates, checkboxes and system properties don't, nor do
    synced ones (M29): their values live in the synced store and a sync must not rewrite
    the index, so a hand-typed value under a synced key is never indexed either.
    """
    if t is None:
        return ""
    lines: list[str] = []
    for pdef in t.propertyDefinitions:
        if (
            pdef.type not in SEARCHABLE_KINDS
            or pdef.extra.get("isNotSearchable") is True
            or is_synced(pdef)
        ):
            continue
        if pdef.key not in fm:
            continue
        try:
            value = decode_value(pdef, fm[pdef.key], fm)
        except Exception:  # noqa: BLE001, S112 - a malformed value must not stop indexing
            continue
        text = _value_text(pdef.type, value, link_title)
        text = _SPACE_RE.sub(" ", text.replace("\r", " ").replace("\n", " ")).strip()
        if text:
            lines.append(f"{pdef.name}: {text}")
    return display_safe("\n".join(lines))
