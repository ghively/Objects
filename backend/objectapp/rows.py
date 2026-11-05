"""Bulk rows for the views: every object's decoded property values, links and a body preview.

Built from the space's in-memory scan (no file is read or written here), so a
view over the whole space costs one pass over memory. The client's view engine
(filter, sort, group, calculate) runs on these rows.
"""

from __future__ import annotations

import re
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from .computed import COMPUTED_KINDS, Computer, Obj, has_computed
from .propvalues import InvalidValue, decode_value
from .typedefs import RawObject

if TYPE_CHECKING:
    from .space import ObjectSummary, Space
    from .typemodel import PropertyDefinition

__all__ = [
    "MAX_TERMS",
    "MIN_TERM",
    "SEARCH_MODES",
    "Row",
    "body_preview",
    "build_rows",
    "cached_preview",
    "cached_word_count",
    "word_count",
]

MIN_TERM = 2
MAX_TERMS = 5
SEARCH_MODES = frozenset({"auto", "fullText", "semantic", "title"})


@dataclass
class Row:
    summary: ObjectSummary
    version: str
    values: dict[str, Any]
    links: dict[str, list[str | None]]
    preview: str
    #: Words in the body (the table's "Content" column), with or without the preview.
    words: int = 0


# -- body preview ---------------------------------------------------------------------

_FENCE_RE = re.compile(r"^\s*(```|~~~)")
_TAG_RE = re.compile(r"<[^>\n]*>")
# A line that is only an HTML comment (M7's block annotations among them) and a math
# block's ``$$`` fence line: neither contributes text to a preview or the search index.
_COMMENT_LINE_RE = re.compile(r"^ {0,3}<!--.*-->[ \t]*$")
_MATH_FENCE_RE = re.compile(r"^ {0,3}\$\$[ \t]*$")
_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+")
_H1_RE = re.compile(r"^\s{0,3}#\s+\S")
_QUOTE_RE = re.compile(r"^\s*(?:>\s?)+")
_LIST_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
_TASK_RE = re.compile(r"^\[[ xX]\]\s+")
_RULE_RE = re.compile(r"^\s*(?:[-*_]\s*){3,}$")
_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_MDLINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_WIKI_RE = re.compile(r"!?\[\[([^\[\]|]*?)(?:\|([^\[\]]*))?\]\]")
_STRONG_RE = re.compile(r"(\*\*|__)(.+?)\1")
_EM_STAR_RE = re.compile(r"\*(.+?)\*")
_EM_UNDER_RE = re.compile(r"(?<!\w)_(.+?)_(?!\w)")
_STRIKE_RE = re.compile(r"~~(.+?)~~")
_CODE_RE = re.compile(r"`+([^`]*)`+")
_SPACE_RE = re.compile(r"\s+")
# M8: a block id (`` ^<id>``, six ``[a-z0-9]``) at the end of a line is not text.
_BLOCK_ID_RE = re.compile(r" \^[a-z0-9]{6}[ \t]*$")


def _wiki(m: re.Match[str]) -> str:
    alias = m.group(2)
    return alias if alias is not None and alias.strip() else m.group(1)


def _preview_line(line: str) -> str:
    """One body line as plain text (block markers, links and emphasis stripped)."""
    line = _BLOCK_ID_RE.sub("", line)
    line = _HEADING_RE.sub("", line)
    line = _QUOTE_RE.sub("", line)
    line = _LIST_RE.sub("", line)
    line = _TASK_RE.sub("", line)
    line = _TAG_RE.sub("", line)
    line = _IMAGE_RE.sub(r"\1", line)
    line = _MDLINK_RE.sub(r"\1", line)
    line = _WIKI_RE.sub(_wiki, line)
    line = _STRONG_RE.sub(r"\2", line)
    line = _EM_STAR_RE.sub(r"\1", line)
    line = _EM_UNDER_RE.sub(r"\1", line)
    line = _STRIKE_RE.sub(r"\1", line)
    return _CODE_RE.sub(r"\1", line)


def body_preview(body: str, limit: int = 280) -> str:
    """Plain text of a Markdown body, at most `limit` characters ('' when empty).

    Only as much of the body as the preview can show is cleaned: the line loop
    stops once about three times `limit` characters are collected and resumes only
    if whitespace collapsing left fewer than the preview needs (audit 2026-11-01
    P2: it ran over whole 50 KB bodies, 2.0 of the 2.7 s of a 1,753-row request).
    """
    lines = body.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines) and _H1_RE.match(lines[i]):
        i += 1
    out: list[str] = []
    fenced = False
    enough = 3 * limit + 1
    collected = 0
    text = ""
    n = len(lines)
    while True:
        while i < n and collected < enough:
            line = lines[i]
            i += 1
            if _FENCE_RE.match(line):
                fenced = not fenced
                continue
            if fenced or line.lstrip().startswith("|") or _RULE_RE.match(line):
                continue
            if _COMMENT_LINE_RE.match(line) or _MATH_FENCE_RE.match(line):
                continue
            line = _preview_line(line)
            out.append(line)
            collected += len(line) + 1
        text = _SPACE_RE.sub(" ", " ".join(out)).strip()
        if i >= n or len(text) > limit:
            break
        collected = 0  # the collapsed text is still short: read on
    if len(text) <= limit:
        return text
    cut = text[: max(limit - 1, 0)]
    if text[len(cut)] != " " and " " in cut:
        cut = cut[: cut.rindex(" ")]
    return cut.rstrip() + "…"


# -- word count -------------------------------------------------------------------------
#
# The table's "Content" column shows "N words" for every row, so this runs over whole
# bodies: a few whole-string substitutions and one findall, no per-line loop. Code is
# counted (a code block's text counts); comments, math, fence lines, link
# targets, HTML tags and M8 block ids are not.

_WC_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_WC_MATH_RE = re.compile(r"^[ \t]*\$\$.*?\$\$[ \t]*$", re.S | re.M)
_WC_FENCE_RE = re.compile(r"^[ \t]*(?:```|~~~).*$", re.M)
_WC_LINK_TARGET_RE = re.compile(r"\]\([^)]*\)")
_WC_WIKI_TARGET_RE = re.compile(r"\[\[[^\[\]|]*\|")
_WC_BLOCK_ID_RE = re.compile(r" \^[a-z0-9]{6}[ \t]*$", re.M)
# A word: letters or digits, joined by hyphens or apostrophes ("well-known", "don't").
_WC_WORD_RE = re.compile(r"\w+(?:[-‐‑'’]\w+)*")


def word_count(body: str) -> int:
    """The words of a Markdown body, Markdown syntax left out (our approximation of
    a word-segment count; the page's Text stats count with `Intl.Segmenter`)."""
    if not body:
        return 0
    s = _WC_COMMENT_RE.sub(" ", body)
    s = _WC_MATH_RE.sub(" ", s)
    s = _WC_FENCE_RE.sub(" ", s)
    s = _WC_LINK_TARGET_RE.sub("] ", s)
    s = _WC_WIKI_TARGET_RE.sub("[[", s)
    s = _WC_BLOCK_ID_RE.sub("", s)
    s = _TAG_RE.sub(" ", s)
    return len(_WC_WORD_RE.findall(s))


_words_cache: OrderedDict[tuple[str, str], int] = OrderedDict()


def cached_word_count(path: str, version: str, body: str) -> int:
    """`word_count(body)`, remembered per ``(path, version)`` like `cached_preview`."""
    key = (path, version)
    with _preview_lock:
        hit = _words_cache.get(key)
        if hit is not None:
            _words_cache.move_to_end(key)
            return hit
    n = word_count(body)
    with _preview_lock:
        _words_cache[key] = n
        if len(_words_cache) > _PREVIEW_CACHE_MAX:
            _words_cache.popitem(last=False)
    return n


_PREVIEW_CACHE_MAX = 20_000
_preview_cache: OrderedDict[tuple[str, str], str] = OrderedDict()
_preview_lock = threading.Lock()


def cached_preview(path: str, version: str, body: str) -> str:
    """`body_preview(body)`, remembered per ``(path, version)``.

    The version is the file's content hash, so an entry can never go stale; the
    oldest entries leave once the cache holds `_PREVIEW_CACHE_MAX`.
    """
    key = (path, version)
    with _preview_lock:
        hit = _preview_cache.get(key)
        if hit is not None:
            _preview_cache.move_to_end(key)
            return hit
    preview = body_preview(body)
    with _preview_lock:
        _preview_cache[key] = preview
        if len(_preview_cache) > _PREVIEW_CACHE_MAX:
            _preview_cache.popitem(last=False)
    return preview


# -- scope and search ---------------------------------------------------------------------


def check_search(terms: list[str], mode: str) -> list[str]:
    """The cleaned terms, or `InvalidValue` (the API answers 422)."""
    if mode not in SEARCH_MODES:
        raise InvalidValue(f"Unknown search mode {mode!r}")
    cleaned = [t.strip() for t in terms]
    if len(cleaned) > MAX_TERMS:
        raise InvalidValue(f"At most {MAX_TERMS} search terms")
    if any(len(t) < MIN_TERM for t in cleaned):
        raise InvalidValue(f"A search term needs at least {MIN_TERM} characters")
    return cleaned


def _matches(raw: RawObject, summary: ObjectSummary, terms: list[str], mode: str) -> bool:
    haystacks = [summary.title, *summary.aliases]
    if mode != "title":
        haystacks += [summary.description or "", raw.of.body]
    folded = [h.casefold() for h in haystacks]
    return any(t.casefold() in h for t in terms for h in folded)


def member_of(
    collection_names: list[str], by_name: dict[str, str], by_former: dict[str, str]
) -> set[str]:
    """The ids of the collections the `collections:` names resolve to (name, then former name)."""
    found: set[str] = set()
    for name in collection_names:
        key = name.strip().casefold()
        cid = by_name.get(key) or by_former.get(key)
        if cid:
            found.add(cid)
    return found


def build_rows(
    space: Space,
    type_ids: list[str] | None = None,
    collection_ids: list[str] | None = None,
    paths: list[str] | None = None,
    search: tuple[list[str], str] | None = None,
    preview: bool = True,
) -> list[Row]:
    """The rows of the space's objects in scope, sorted by path (templates excluded).

    ``preview=False`` leaves ``Row.preview`` empty: a view loads its rows that way and
    fetches the previews of the rows it shows (audit 2026-11-01 P2).
    """
    terms: list[str] = []
    mode = "auto"
    if search is not None:
        mode = search[1]
        terms = check_search(search[0], mode)
    wanted_paths: set[str] | None = None
    if paths is not None:
        wanted_paths = set()
        for p in paths:
            try:
                wanted_paths.add(space._rel(p))
            except ValueError:
                continue
    names = space._collection_names()
    by_name: dict[str, str] = {}
    by_former: dict[str, str] = {}
    for cid, all_names in names.items():
        if not all_names:
            continue
        by_name.setdefault(all_names[0].strip().casefold(), cid)
        for f in all_names[1:]:
            by_former.setdefault(f.strip().casefold(), cid)
    wanted_collections = set(collection_ids) if collection_ids is not None else None

    with space._lock:
        items = [
            (space._raw[s.path], s)
            for s in space._summaries.values()
            if s.template is None and s.path in space._raw
        ]
    items.sort(key=lambda it: it[1].path)

    rows: list[Row] = []
    computer = None
    for raw, summary in items:
        if type_ids is not None and summary.type not in type_ids:
            continue
        if wanted_paths is not None and summary.path not in wanted_paths:
            continue
        if wanted_collections is not None and not (
            member_of(summary.collections, by_name, by_former) & wanted_collections
        ):
            continue
        if terms and not _matches(raw, summary, terms, mode):
            continue
        t = space.type_by_id(summary.type)
        if computer is None and has_computed(t):
            # M12: one per request, so "now" is one instant and each value is computed once.
            computer = Computer(space)
        rows.append(_row(space, raw, summary, preview, computer))
    return rows


def _row(
    space: Space,
    raw: RawObject,
    summary: ObjectSummary,
    preview: bool = True,
    computer: Computer | None = None,
) -> Row:
    from .space import version_of

    t = space.type_by_id(summary.type)
    version = version_of(raw.data)
    values: dict[str, Any] = {}
    links: dict[str, list[str | None]] = {}
    computed: list[PropertyDefinition] = []
    for p in t.propertyDefinitions if t is not None else []:
        if p.type == "entity_collections":
            values[p.key] = list(summary.collections)
            continue
        if p.type == "entity_backlinks":
            values[p.key] = space.backlinks(summary.path)
            continue
        if p.type in COMPUTED_KINDS:
            computed.append(p)  # after the loop, once every relation is resolved
            values[p.key] = None
            continue
        value = decode_value(p, raw.fm.get(p.key), raw.fm)
        if p.type == "entity":
            paths = [space.resolve(r["target"], summary.path) for r in value]
            for ref, path in zip(value, paths, strict=True):
                ref["path"] = path
            links[p.key] = paths
        elif p.type == "entity_title" and value is None:
            value = summary.title
        values[p.key] = value
    if computed:
        # M12: formula and rollup values (`ComputedValue`s), computed here and never stored.
        if computer is None:
            computer = Computer(space)
        obj = Obj(summary.path, raw.fm, summary, t, links)
        for p in computed:
            values[p.key] = computer.computed_value(obj, p)
    if "backlinks" not in values:
        # Backlinks are a system property of every object (`systemPropertyTypeToIdMap`:
        # entity_backlinks -> 'backlinks'), so rows carry them under that id even when the
        # type hasn't added the definition: the "No backlinks" section, the Task "Context"
        # section and backlinks filters/groups read them (M5 Task 13).
        values["backlinks"] = space.backlinks(summary.path)
    return Row(
        summary=summary,
        version=version,
        values=values,
        links=links,
        preview=cached_preview(raw.path, version, raw.of.body) if preview else "",
        words=cached_word_count(raw.path, version, raw.of.body),
    )
