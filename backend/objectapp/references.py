"""The references section of an object (M5): backlinks in context, unlinked mentions,
related content and related tags, and linking an unlinked mention.

Everything here reads the space's in-memory scan (`Space._raw`, `Space._summaries`),
its link index (`Space.links`) and the search index; nothing is written except by
`link_mention`, which makes one stamped `Space._write` of the mentioning object.

- **Tabs** (``ReferencesSectionTab`` order): none unless the object's role has a
  references section (`roles.HAS_REFERENCES_SECTION`); otherwise ``all``,
  ``backlinks``, ``related``, then ``mentions`` when the role has unlinked
  mentions, then ``relatedTags`` when the object has tags.
- **Backlinks**: per distinct linking object, every body link to this object with
  its block (the source line, list/heading markers and emphasis stripped, links
  shown by their label, at most `CONTEXT_MAX` characters around the link) and the
  link label's span inside it, plus the property keys that link. A context
  inside nested blocks also carries ``ancestors`` (M8): the cleaned first lines
  of the enclosing toggle titles, ``indent`` parents and list items, outermost
  first; the key is absent for a top-level block.
- **Unlinked mentions**: the object's title or aliases (each at least
  `MIN_NAME_LENGTH` characters) in the body of another object whose role can be an
  unlinked mention, case-insensitive, on Unicode word boundaries, longest name
  first, non-overlapping, outside wikilinks, Markdown links and code; never in a
  template or the object itself. Candidates come from the search index's phrase
  query when it is ready, else from a scan of every object.
- **Related content**: our lexical stand-in (`SearchIndex.similar`).
- **Related tags** (our rule): the tags that appear together with this object's
  tags on other objects, by how many objects carry them, excluding its own tags.
"""

from __future__ import annotations

import re
import threading
from collections import OrderedDict
from dataclasses import asdict, replace
from typing import TYPE_CHECKING, Any

from .propvalues import InvalidValue
from .relink import _LINK_RE, code_ranges, wikilink_spans
from .roles import (
    CAN_BE_UNLINKED_MENTION,
    HAS_REFERENCES_SECTION,
    HAS_UNLINKED_MENTIONS,
    role_of,
)
from .space import version_of

if TYPE_CHECKING:
    from .objfile import ObjectFile
    from .searchindex import SearchIndex
    from .space import ObjectSummary, Space

__all__ = [
    "CONTEXT_MAX",
    "MIN_NAME_LENGTH",
    "TEXT_CHANGED",
    "backlink_entries",
    "link_mention",
    "references",
    "related",
    "related_tags",
    "tabs_for",
    "unlinked_mentions",
]

CONTEXT_MAX = 280
"""At most this many characters of context around a link or a mention."""
MIN_NAME_LENGTH = 3
"""A title or alias shorter than this is never an unlinked mention (our threshold)."""
TEXT_CHANGED = "The text has changed. Reload and try again."
NOT_A_MENTION = "That text is not an unlinked mention of the object."

_MD_LINK_RE = re.compile(r"!?\[[^\]\n]*\]\([^)\n]*\)|<[a-zA-Z][a-zA-Z0-9+.-]*:[^>\s]*>")
"""Markdown links and images (``[text](url)``, ``![alt](src)``) and autolinks (``<url>``)."""
_PREFIX_RE = re.compile(
    r"[ \t]*(?:>\s*)*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?"
)
"""A line's block markers: blockquote, heading, list item (with a task checkbox)."""
_EMPHASIS_RE = re.compile(
    r"\*\*|__|~~|=="
    r"|(?<!\S)\*(?=\S)|(?<=\S)\*(?!\S)"
    r"|(?<!\w)_(?=\S)|(?<=\S)_(?!\w)"
)
"""Emphasis delimiters: bold, strike, highlight, and single ``*``/``_`` at word edges."""
_LINK_BREAKING = re.compile(r"[\[\]\n]")
_CONTAINER_RE = re.compile(r"[ \t]*<!--\s*(/?)(toggle|group|columns|indent)\b[^>]*?-->[ \t]*\r?$")
"""An M7/M8 container comment line (``<!-- toggle open -->``, ``<!-- /indent -->``)."""
_ANNOTATION_RE = re.compile(r"[ \t]*<!--\s*(?:block:|column\b)[^>]*-->[ \t]*\r?$")
"""A block-options or column-break comment line: never a block's first line."""
_LIST_ITEM_RE = re.compile(r"([ \t]*)(?:>\s*)*(?:[-*+]|\d+[.)])(?:\s|$)")
_HAS_FIRST_LINE = ("toggle", "indent")
"""Containers whose first block is the parent of the rest (toggle title, indent parent)."""


# -- helpers -------------------------------------------------------------------


def _role(space: Space, summary: ObjectSummary) -> str:
    return role_of(space.type_by_id(summary.type))


def _line_bounds(body: str, start: int, end: int) -> tuple[int, int]:
    ls = body.rfind("\n", 0, start) + 1
    le = body.find("\n", end)
    return ls, len(body) if le == -1 else le


def _window(
    text: str, start: int, end: int, ellipsis: bool = True
) -> tuple[str, int, int, int]:
    """``text`` cut to at most `CONTEXT_MAX` characters around ``[start, end)``.

    Returns (context, start, end, offset in ``text`` of the first kept character).
    With ``ellipsis`` a cut end is marked with ``…`` (counted in the limit);
    without, the context is an exact slice of ``text``.
    """
    if len(text) <= CONTEXT_MAX:
        return text, start, end, 0
    marks = 2 if ellipsis else 0
    keep = CONTEXT_MAX - marks
    room = max(keep - (end - start), 0)
    lo = max(0, start - room // 2)
    hi = min(len(text), max(end, lo + keep))
    lo = max(0, min(lo, hi - keep))
    head = "…" if ellipsis and lo > 0 else ""
    tail = "…" if ellipsis and hi < len(text) else ""
    return head + text[lo:hi] + tail, start - lo + len(head), end - lo + len(head), lo


def _in_any(start: int, end: int, ranges: list[tuple[int, int]]) -> bool:
    return any(s < end and start < e for s, e in ranges)


def _names(summary: ObjectSummary) -> list[str]:
    """The object's title and aliases that can be mentioned, longest first, distinct."""
    seen: dict[str, str] = {}
    for name in (summary.title, *summary.aliases):
        n = name.strip() if isinstance(name, str) else ""
        if len(n) >= MIN_NAME_LENGTH and n.casefold() not in seen:
            seen[n.casefold()] = n
    return sorted(seen.values(), key=lambda n: (-len(n), n))


def _mention_re(names: list[str]) -> re.Pattern[str] | None:
    if not names:
        return None
    alts = "|".join(re.escape(n) for n in names)
    return re.compile(rf"(?<!\w)(?:{alts})(?!\w)", re.IGNORECASE)


_SCAN_CACHE_MAX = 4_000
_scan_cache: OrderedDict[tuple[str, str], tuple[list[tuple[str, int, int]], list[tuple[int, int]]]]
_scan_cache = OrderedDict()
_scan_lock = threading.Lock()


def _scan_body(
    path: str, version: str, body: str
) -> tuple[list[tuple[str, int, int]], list[tuple[int, int]]]:
    """``(wikilink_spans(body), code_ranges(body))``, remembered per ``(path, version)``.

    Both walk `relink._segments` over the whole body; a hub with 214 referrers had each
    referrer's body re-parsed per link and again for its mentions (audit 2026-11-01 B6,
    420 passes). The version is the file's content hash, so entries never go stale.
    """
    key = (path, version)
    with _scan_lock:
        hit = _scan_cache.get(key)
        if hit is not None:
            _scan_cache.move_to_end(key)
            return hit
    scan = (wikilink_spans(body), code_ranges(body))
    with _scan_lock:
        _scan_cache[key] = scan
        if len(_scan_cache) > _SCAN_CACHE_MAX:
            _scan_cache.popitem(last=False)
    return scan


def _excluded_ranges(
    body: str, scan: tuple[list[tuple[str, int, int]], list[tuple[int, int]]] | None = None
) -> list[tuple[int, int]]:
    """Where a mention can't be: wikilinks, Markdown links and code (`scan`: `_scan_body`)."""
    spans, code = scan if scan is not None else (wikilink_spans(body), code_ranges(body))
    ranges = [(s, e) for _t, s, e in spans]
    ranges.extend(code)
    if "](" in body or "<" in body:
        ranges.extend((m.start(), m.end()) for m in _MD_LINK_RE.finditer(body))
    return ranges


def _summary_dict(summary: ObjectSummary) -> dict[str, Any]:
    return asdict(summary)


# -- tabs ----------------------------------------------------------------------


def tabs_for(space: Space, summary: ObjectSummary) -> list[str]:
    """The references tabs ``summary``'s object offers, in display order."""
    if summary.template is not None:
        return []
    role = _role(space, summary)
    if role not in HAS_REFERENCES_SECTION:
        return []
    tabs = ["all", "backlinks", "related"]
    if role in HAS_UNLINKED_MENTIONS:
        tabs.append("mentions")
    if summary.tags:
        tabs.append("relatedTags")
    return tabs


# -- backlinks -----------------------------------------------------------------


def _backlink_context(
    body: str, spans: list[tuple[str, int, int]], link: int
) -> dict[str, Any]:
    """The cleaned block around ``spans[link]`` and the span of its label inside it."""
    _t, s, e = spans[link]
    ls, le = _line_bounds(body, s, e)
    line_spans = [
        (i, a, b) for i, (_x, a, b) in enumerate(spans) if a >= ls and b <= le
    ]
    prefix = _PREFIX_RE.match(body, ls, le)
    pos = prefix.end() if prefix else ls
    out: list[str] = []
    length = 0
    span = (0, 0)

    def emit(text: str) -> None:
        nonlocal length
        out.append(text)
        length += len(text)

    def plain(a: int, b: int) -> None:
        if a < b:
            emit(_EMPHASIS_RE.sub("", body[a:b]))

    for i, a, b in line_spans:
        if a < pos:
            continue
        plain(pos, a)
        raw = body[a:b]
        m = _LINK_RE.search(raw)
        label = raw
        if m is not None:
            suffix = m.group(2)
            if "|" in suffix:
                label = suffix.split("|", 1)[1]
            else:
                label = m.group(1) + suffix
        if i == link:
            span = (length, length + len(label))
        emit(label)
        pos = b
    plain(pos, le)
    text = "".join(out)
    stripped = text.lstrip()
    lead = len(text) - len(stripped)
    text = stripped.rstrip()
    start, end = span[0] - lead, span[1] - lead
    ctx, start, end, _off = _window(text, start, end)
    return {"context": ctx, "start": start, "end": end}


def _clean_line(body: str, ls: int, le: int) -> str:
    """The line ``body[ls:le]`` as a backlink shows it: markers, emphasis and link syntax gone."""
    prefix = _PREFIX_RE.match(body, ls, le)
    pos = prefix.end() if prefix else ls
    line = body[pos:le].rstrip("\r")

    def label(m: re.Match[str]) -> str:
        suffix = m.group(2)
        if "|" in suffix:
            return suffix.split("|", 1)[1]
        return m.group(1) + suffix

    text = _EMPHASIS_RE.sub("", _LINK_RE.sub(label, line)).strip()
    if text.startswith("!"):
        text = text[1:]
    ctx, _s, _e, _o = _window(text, 0, 0)
    return ctx


def _indent_width(prefix: str) -> int:
    return len(prefix.expandtabs(4))


def _ancestors(body: str, offset: int, code: list[tuple[int, int]] | None = None) -> list[str]:
    """The first lines of the blocks enclosing the line at ``offset``, outermost first.

    Enclosing blocks are open ``toggle`` and ``indent`` containers (their first
    block is the parent; a ``group`` or ``columns`` is no parent) and, inside the
    innermost container, the list items with less indentation above the line.
    Container comments inside code are ignored (`code`: the body's `code_ranges`).
    """
    if code is None:
        code = code_ranges(body)
    link_ls = body.rfind("\n", 0, offset) + 1
    # (name, first line bounds or None, region start) of each open container.
    stack: list[list[Any]] = []
    region = 0
    pos = 0
    while pos < link_ls:
        le = body.find("\n", pos)
        le = len(body) if le == -1 else le
        if not _in_any(pos, le, code):
            m = _CONTAINER_RE.match(body, pos, le)
            if m is not None:
                closing, name = m.group(1) == "/", m.group(2)
                if closing:
                    for i in range(len(stack) - 1, -1, -1):
                        if stack[i][0] == name:
                            del stack[i:]
                            break
                else:
                    stack.append([name, None])
                region = le + 1
                pos = le + 1
                continue
            if (
                stack
                and stack[-1][0] in _HAS_FIRST_LINE
                and stack[-1][1] is None
                and body[pos:le].strip()
                and not _ANNOTATION_RE.match(body, pos, le)
            ):
                stack[-1][1] = (pos, le)
                # The first block's own children begin after it.
                region = le + 1
        pos = le + 1
    out = [
        _clean_line(body, *entry[1])
        for entry in stack
        if entry[0] in _HAS_FIRST_LINE and entry[1] is not None
    ]
    out = [t for t in out if t]
    # List parents: items above the line, inside its container, with less indentation.
    link_le = body.find("\n", link_ls)
    link_le = len(body) if link_le == -1 else link_le
    lead = re.match(r"[ \t]*", body[link_ls:link_le])
    width = _indent_width(lead.group(0) if lead else "")
    lists: list[str] = []
    lines: list[tuple[int, int]] = []
    pos = region
    while pos < link_ls:
        le = body.find("\n", pos)
        le = len(body) if le == -1 else le
        lines.append((pos, le))
        pos = le + 1
    for ls, le in reversed(lines):
        if width == 0:
            break
        line = body[ls:le]
        if not line.strip() or _in_any(ls, le, code):
            continue
        if _CONTAINER_RE.match(line) or _ANNOTATION_RE.match(line):
            break
        item = _LIST_ITEM_RE.match(line)
        if item is not None:
            w = _indent_width(item.group(1))
            if w < width:
                lists.append(_clean_line(body, ls, le))
                width = w
        elif _indent_width(re.match(r"[ \t]*", line).group(0)) == 0:
            break
    out.extend(t for t in reversed(lists) if t)
    return out


def backlink_entries(space: Space, path: str) -> list[dict[str, Any]]:
    """``BacklinkEntry`` per distinct linking object (title then path)."""
    entries: list[dict[str, Any]] = []
    resolve = space.resolve
    for src in space.links.backlinks(path):
        has_body, keys = space.links.link_keys(src, path)
        contexts: list[dict[str, Any]] = []
        if has_body:
            with space._lock:
                raw = space._raw.get(src)
            if raw is not None:
                body = raw.of.body
                spans, code = _scan_body(src, version_of(raw.data), body)
                for i, (target, _s, _e) in enumerate(spans):
                    if resolve(target, src) == path:
                        ctx = _backlink_context(body, spans, i)
                        ancestors = _ancestors(body, spans[i][1], code)
                        if ancestors:
                            ctx["ancestors"] = ancestors
                        contexts.append(ctx)
        entries.append({"path": src, "contexts": contexts, "properties": keys})
    return entries


# -- unlinked mentions -----------------------------------------------------------


def _occurrences(
    body: str, pattern: re.Pattern[str], path: str | None = None, version: str | None = None
) -> list[dict[str, Any]]:
    found = list(pattern.finditer(body))
    if not found:
        return []
    scan = _scan_body(path, version, body) if path is not None and version is not None else None
    excluded = _excluded_ranges(body, scan)
    out: list[dict[str, Any]] = []
    for m in found:
        start, end = m.start(), m.end()
        if _in_any(start, end, excluded):
            continue
        ls, le = _line_bounds(body, start, end)
        # An exact slice of the body, so ``start - contextStart`` indexes the context.
        ctx, _cs, _ce, off = _window(body[ls:le], start - ls, end - ls, ellipsis=False)
        out.append(
            {
                "start": start,
                "end": end,
                "text": m.group(0),
                "context": ctx,
                "contextStart": ls + off,
            }
        )
    return out


def unlinked_mentions(
    space: Space, index: SearchIndex | None, path: str
) -> list[dict[str, Any]]:
    """``MentionEntry`` per object mentioning ``path`` by name without a link (title then path)."""
    with space._lock:
        summary = space._summaries.get(path)
        if summary is None:
            return []
        names = _names(summary)
        pattern = _mention_re(names)
        if pattern is None:
            return []
    candidates: set[str] | None = None
    if index is not None:
        for name in names:
            got = index.phrase_candidates(name)
            if got is None:
                candidates = None
                break
            candidates = (candidates or set()) | got
    with space._lock:
        raws = dict(space._raw)
        summaries = dict(space._summaries)
    if candidates is None:
        sources = list(raws.items())
    else:
        # The index trails the scan by its debounce: also scan every object whose change
        # it hasn't applied yet, so a fresh edit is never missed. (Hashing every object
        # to compare versions cost 40 ms per request at 5,000 objects, audit 2026-11-01 B6.)
        pending = index.pending_paths() if index is not None else set()
        sources = [(p, raw) for p, raw in raws.items() if p in candidates or p in pending]
    entries: list[tuple[tuple[str, str, str], dict[str, Any]]] = []
    for src, raw in sources:
        if src == path:
            continue
        s = summaries.get(src)
        if s is None or s.template is not None:
            continue
        if _role(space, s) not in CAN_BE_UNLINKED_MENTION:
            continue
        body = raw.of.body
        if pattern.search(body) is None:
            continue
        version = version_of(raw.data)
        occ = _occurrences(body, pattern, src, version)
        if occ:
            key = (s.title.casefold(), s.title, src)
            entries.append((key, {"path": src, "version": version, "occurrences": occ}))
    entries.sort(key=lambda e: e[0])
    return [e for _k, e in entries]


# -- related content and related tags --------------------------------------------


def related(
    space: Space, index: SearchIndex | None, path: str, limit: int
) -> list[dict[str, Any]]:
    """``RelatedEntry`` list: objects sharing ``path``'s strongest terms, best first."""
    if index is None or limit <= 0:
        return []
    with space._lock:
        summaries = dict(space._summaries)
    out: list[dict[str, Any]] = []
    for p, score in index.similar(path, limit):
        s = summaries.get(p)
        if p == path or s is None or s.template is not None:
            continue
        out.append({"path": p, "score": score})
    return out


def _fold(name: str) -> str:
    return " ".join(name.split()).casefold()


def related_tags(space: Space, path: str) -> list[dict[str, Any]]:
    """``RelatedTagEntry`` list: tags co-occurring with ``path``'s tags on other objects."""
    with space._lock:
        summary = space._summaries.get(path)
        if summary is None or not summary.tags:
            return []
        summaries = list(space._summaries.values())
    own = {_fold(t) for t in summary.tags if isinstance(t, str) and t.strip()}
    tag_objects: dict[str, ObjectSummary] = {}
    for s in sorted(summaries, key=lambda s: s.path):
        if s.type == "tag" and s.template is None:
            tag_objects.setdefault(_fold(s.title), s)
    counts: dict[str, int] = {}
    spelling: dict[str, str] = {}
    for s in summaries:
        if s.path == path or s.template is not None or not s.tags:
            continue
        folded = {}
        for t in s.tags:
            if isinstance(t, str) and t.strip():
                folded.setdefault(_fold(t), t.strip())
        if not own & folded.keys():
            continue
        for f, name in folded.items():
            if f in own:
                continue
            counts[f] = counts.get(f, 0) + 1
            spelling.setdefault(f, name)
    out = []
    for f, n in counts.items():
        tag = tag_objects.get(f)
        out.append(
            {
                "name": tag.title if tag is not None else spelling[f],
                "path": tag.path if tag is not None else None,
                "count": n,
            }
        )
    out.sort(key=lambda e: (-e["count"], e["name"].casefold(), e["name"]))
    return out


# -- the whole section -----------------------------------------------------------


def references(
    space: Space, index: SearchIndex | None, path: str, related_limit: int = 20
) -> dict[str, Any]:
    """The ``References`` of the object at ``path`` (raises KeyError when there is none)."""
    with space._lock:
        summary = space._summaries.get(path)
    if summary is None:
        raise KeyError(path)
    tabs = tabs_for(space, summary)
    result: dict[str, Any] = {
        "tabs": tabs,
        "backlinks": [],
        "mentions": [],
        "related": [],
        "relatedTags": [],
        "summaries": {},
    }
    if not tabs:
        return result
    result["backlinks"] = backlink_entries(space, path)
    result["related"] = related(space, index, path, related_limit)
    if "mentions" in tabs:
        result["mentions"] = unlinked_mentions(space, index, path)
    if "relatedTags" in tabs:
        result["relatedTags"] = related_tags(space, path)
    paths = {path}
    paths.update(e["path"] for e in result["backlinks"])
    paths.update(e["path"] for e in result["mentions"])
    paths.update(e["path"] for e in result["related"])
    paths.update(e["path"] for e in result["relatedTags"] if e["path"])
    with space._lock:
        result["summaries"] = {
            p: _summary_dict(space._summaries[p])
            for p in sorted(paths)
            if p in space._summaries
        }
    return result


# -- linking a mention -----------------------------------------------------------


def link_mention(
    space: Space,
    path: str,
    target: str,
    start: int,
    end: int,
    text: str,
    base_version: str,
) -> str:
    """Link the unlinked mention ``body[start:end] == text`` in ``path`` to ``target``.

    One stamped write of ``path`` that replaces just those characters with
    ``[[text]]`` when ``text`` is the target's exact title or alias and resolves to
    it from ``path``, else ``[[<link text of target>|text]]``. Raises `Conflict`
    (stale ``base_version``), `ReadOnly`, KeyError (no such object) and
    `InvalidValue` (the text moved, an unknown target, or not a mention).
    Returns the new version.
    """
    rel = space._rel(path)
    try:
        trg = space._rel(target)
    except ValueError as exc:
        raise InvalidValue(f'There is no object at "{target}".') from exc
    with space._lock:
        if rel not in space._summaries:
            raise KeyError(rel)
        tsum = space._summaries.get(trg)
    if tsum is None or tsum.template is not None:
        raise InvalidValue(f'There is no object at "{target}".')
    if trg == rel:
        raise InvalidValue(NOT_A_MENTION)
    if not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end:
        raise InvalidValue(NOT_A_MENTION)
    names = _names(tsum)
    pattern = _mention_re(names)
    if (
        pattern is None
        or pattern.fullmatch(text) is None
        or _LINK_BREAKING.search(text)
    ):
        raise InvalidValue(NOT_A_MENTION)
    exact = text in (tsum.title, *tsum.aliases)
    if exact and space.resolve(text, rel) == trg:
        link = f"[[{text}]]"
    else:
        link = f"[[{space._link_text(trg, rel)}|{text}]]"

    def edit(of: ObjectFile, _fm: dict) -> ObjectFile | None:
        body = of.body
        if end > len(body) or body[start:end] != text:
            raise InvalidValue(TEXT_CHANGED)
        if pattern.fullmatch(body, start, end) is None or (
            (start > 0 and re.match(r"\w", body[start - 1]))
            or (end < len(body) and re.match(r"\w", body[end]))
        ):
            raise InvalidValue(NOT_A_MENTION)
        if _in_any(start, end, _excluded_ranges(body)):
            raise InvalidValue(NOT_A_MENTION)
        return replace(of, body=body[:start] + link + body[end:])

    return space._write(rel, base_version, edit)
