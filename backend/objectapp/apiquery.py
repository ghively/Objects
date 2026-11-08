"""Helpers for the local API (M11): the AI exclusion rule, a server-side filter engine,
and heading sections of a Markdown body.

**Exclusion.** An object is invisible to the local API (and so to agents) when its
frontmatter has ``excludeFromAI: true`` or one of its tags is named "Exclude from AI"
(any case). Templates are never shown either.

**Filters.** `matches` evaluates the app's filter-group JSON (``{type: 'filterGroup',
operator, elements}`` with ``{type: 'filter', propertyId, option, referenceValue}``)
over a row's decoded values. It covers the text, number, checkbox, list (labels,
relations, tags) and plain date operators of ``frontend/src/views/filter.ts``. An
operator it doesn't know is reported in ``unsupported`` and the filter is skipped
(the app's own rule for an invalid filter: it passes). A saved query's label, tag and
relation filters hold ids (an option id, a Tag object's id, an object id) where the rows
carry texts: `resolve_saved_filters` turns them into the texts first, as the app's
engine does, and names the ids that resolve to nothing.

**Sections.** A section is a heading line and everything after it up to the next
heading of the same or a higher level. Fenced code is not scanned for headings.
Edits splice text into the body and keep every other line's bytes, including the
body's line endings.
"""

from __future__ import annotations

import calendar
import copy
import re
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from typing import Any

__all__ = [
    "EXCLUDE_TAG",
    "Matcher",
    "append_to_section",
    "is_excluded",
    "outline",
    "parse_since",
    "read_section",
    "replace_section",
    "resolve_saved_filters",
    "sort_rows",
]

EXCLUDE_TAG = "exclude from ai"
EXCLUDE_KEY = "excludeFromAI"


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("true", "yes", "1")
    return False


def is_excluded(fm: dict | None, tags: list[str] | None) -> bool:
    """Whether an object with this frontmatter and these tag names is kept from the API."""
    if fm and _truthy(fm.get(EXCLUDE_KEY)):
        return True
    for t in tags or []:
        name = str(t).strip()
        if name.startswith("[[") and name.endswith("]]"):
            name = name[2:-2]
        if name.strip().casefold() == EXCLUDE_TAG:
            return True
    return False


# -- filters -------------------------------------------------------------------------


_WIKI_RE = re.compile(r"^\[\[([^\[\]|]*)(?:\|[^\[\]]*)?\]\]$")


def _text_of(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        if "start" in value:
            return str(value.get("start") or "")
        if "target" in value or "path" in value:
            return str(value.get("target") or value.get("path") or "")
        return ""
    if isinstance(value, list):
        return ", ".join(_text_of(v) for v in value)
    text = str(value)
    # A tag or relation stored as a wiki link (``[[Urgent]]``) is the title it names.
    m = _WIKI_RE.match(text.strip())
    return m.group(1).strip() if m else text


def _items(value: Any) -> list[str]:
    """The texts a list value can be matched by: a relation's target title and its path both."""
    if value is None or value == "":
        return []
    if not isinstance(value, list):
        return [_text_of(value).casefold()]
    out: list[str] = []
    for v in value:
        text = _text_of(v)
        if text != "":
            out.append(text.casefold())
        if isinstance(v, dict) and isinstance(v.get("path"), str) and v["path"]:
            out.append(v["path"].casefold())
    return out


def _ref_items(ref: Any) -> list[str]:
    if ref is None:
        return []
    if isinstance(ref, list):
        return [str(x).casefold() for x in ref]
    return [str(ref).casefold()]


def _empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, dict)):
        return len(value) == 0
    return False


def _as_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value))
    except ValueError:
        return None


def _day(text: str | None) -> date | None:
    if not text:
        return None
    try:
        return date.fromisoformat(str(text)[:10])
    except ValueError:
        return None


def _add_months(d: date, n: int) -> date:
    """Calendar-month arithmetic that clamps the day (Mar 31 minus one month is Feb 28),
    as ``views/dates.ts`` ``addMonths`` does."""
    month0 = d.year * 12 + (d.month - 1) + n
    year, month = divmod(month0, 12)
    month += 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


class Matcher:
    """Matches rows against one filter group, relative to `today`."""

    def __init__(self, group: dict | None, today: date) -> None:
        self.group = group if isinstance(group, dict) else None
        self.today = today
        self.unsupported: set[str] = set()

    def matches(self, values: dict[str, Any]) -> bool:
        return self.group is None or self._group(self.group, values)

    def _group(self, group: dict, values: dict[str, Any]) -> bool:
        elements = [e for e in group.get("elements") or [] if isinstance(e, dict)]
        if not elements:
            return True
        results = (
            self._group(e, values) if e.get("type") == "filterGroup" else self._filter(e, values)
            for e in elements
        )
        if group.get("operator") == "or":
            return any(results)
        return all(results)

    def _reference_day(self, ref: Any) -> tuple[date, date] | None:
        """The (first, last) day a date filter compares with."""
        t = self.today
        if isinstance(ref, dict):
            if "exactDate" in ref:
                d = _day(ref.get("exactDate"))
                return (d, d) if d else None
            rel = ref.get("relative")
            if rel == "today":
                return t, t
            if rel == "yesterday":
                return t - timedelta(days=1), t - timedelta(days=1)
            if rel == "tomorrow":
                return t + timedelta(days=1), t + timedelta(days=1)
            if rel == "oneWeekAgo":
                return t - timedelta(days=7), t - timedelta(days=7)
            if rel in ("inOneWeek", "oneWeekFromNow"):  # the app's name, and this API's older one
                return t + timedelta(days=7), t + timedelta(days=7)
            if rel == "oneMonthAgo":
                return _add_months(t, -1), _add_months(t, -1)
            if rel == "inOneMonth":
                return _add_months(t, 1), _add_months(t, 1)
            if rel == "thisWeek":
                start = t - timedelta(days=t.weekday())
                return start, start + timedelta(days=6)
            if rel == "thisMonth":
                start = t.replace(day=1)
                nxt = (start + timedelta(days=32)).replace(day=1)
                return start, nxt - timedelta(days=1)
            if rel == "thisYear":
                return t.replace(month=1, day=1), t.replace(month=12, day=31)
            return None
        d = _day(ref) if isinstance(ref, str) else None
        return (d, d) if d else None

    def _filter(self, f: dict, values: dict[str, Any]) -> bool:
        key = f.get("propertyId")
        option = f.get("option")
        ref = f.get("referenceValue")
        if not isinstance(key, str) or not isinstance(option, str):
            return True
        value = values.get(key)
        if option == "isEmpty":
            return _empty(value)
        if option == "isNotEmpty":
            return not _empty(value)
        if option == "isChecked":
            return value is True
        if option == "isNotChecked":
            return value is not True
        if option in ("contains", "notContains"):
            if isinstance(value, list) or isinstance(ref, list):
                have = set(_items(value))
                want = _ref_items(ref)
                hit = any(w in have for w in want) if want else True
                if not isinstance(ref, list) and isinstance(value, list):
                    needle = str(ref or "").casefold()
                    hit = any(needle in h for h in have)
            else:
                hit = str(ref or "").casefold() in _text_of(value).casefold()
            return hit if option == "contains" else not hit
        if option in ("is", "isNot") and not isinstance(value, dict):
            hit = _text_of(value).strip().casefold() == str(ref or "").strip().casefold()
            return hit if option == "is" else not hit
        if option == "startsWith":
            return _text_of(value).casefold().startswith(str(ref or "").casefold())
        if option == "endsWith":
            return _text_of(value).casefold().endswith(str(ref or "").casefold())
        if option in ("equal", "notEqual", "greater", "greaterEqual", "smaller", "smallerEqual"):
            a, b = _as_number(value), _as_number(ref)
            if b is None:
                return True
            if a is None:
                return option == "notEqual"
            return {
                "equal": a == b,
                "notEqual": a != b,
                "greater": a > b,
                "greaterEqual": a >= b,
                "smaller": a < b,
                "smallerEqual": a <= b,
            }[option]
        if option in ("is", "isBefore", "isAfter", "isOnOrBefore", "isOnOrAfter"):
            span = self._reference_day(ref)
            if span is None:
                if not (isinstance(ref, dict) and ref.get("relative") == "overdue"):
                    self.unsupported.add(option)
                    return True
                d = _day(_text_of(value))
                return d is not None and d < self.today
            d = _day(_text_of(value))
            if d is None:
                return False
            first, last = span
            return {
                "is": first <= d <= last,
                "isBefore": d < first,
                "isAfter": d > last,
                "isOnOrBefore": d <= last,
                "isOnOrAfter": d >= first,
            }[option]
        self.unsupported.add(option)
        return True


_ID_KINDS = frozenset({"label", "entity", "entity_backlinks", "entity_tags"})


def _property_of(types: list[Any], key: str) -> Any | None:
    """The first definition (over the query's types) whose id, then key, is `key`."""
    for by_key in (False, True):
        for t in types:
            for p in getattr(t, "propertyDefinitions", None) or []:
                if (p.key if by_key else p.id) == key:
                    return p
    return None


def resolve_saved_filters(
    group: dict | None,
    types: list[Any],
    tag_titles: Mapping[str, str],
    paths_by_id: Mapping[str, str],
) -> tuple[dict | None, list[str]]:
    """A saved query's filter group with its reference ids turned into the texts the rows
    carry: a label option id into the option's text, a Tag object's id into the tag's
    title, an object id into its path (``views/filter.ts`` does the same with
    ``options.set``, ``ctx.tagIdsToTitles`` and ``ctx.pathsById``).

    Returns the resolved copy and the filters whose ids name nothing (``"status is o9"``):
    those keep their ids, so they match no row, and the caller lists them as unsupported.
    """
    if not isinstance(group, dict):
        return group, []
    out = copy.deepcopy(group)
    unresolved: list[str] = []

    def lookup(p: Any) -> Mapping[str, str]:
        if p.type == "label":
            options = p.options.get("set") if isinstance(p.options, dict) else None
            return {
                str(o["id"]): str(o.get("text") or "")
                for o in (options or [])
                if isinstance(o, dict) and o.get("id") is not None
            }
        if p.type == "entity_tags":
            return tag_titles
        return paths_by_id

    def walk(g: dict) -> None:
        for e in g.get("elements") or []:
            if not isinstance(e, dict):
                continue
            if e.get("type") == "filterGroup":
                walk(e)
                continue
            key, ref = e.get("propertyId"), e.get("referenceValue")
            if not isinstance(key, str) or ref is None or isinstance(ref, (dict, bool)):
                continue
            p = _property_of(types, key)
            if p is None or p.type not in _ID_KINDS:
                continue
            table = lookup(p)
            ids = ref if isinstance(ref, list) else [ref]
            found = [table[str(i)] for i in ids if str(i) in table]
            if not found:
                if ids:
                    unresolved.append(f"{key} {e.get('option')} {', '.join(str(i) for i in ids)}")
                continue
            e["referenceValue"] = found if isinstance(ref, list) else found[0]

    walk(out)
    return out, unresolved


def sort_rows(rows: list[Any], key: str | None, descending: bool) -> list[Any]:
    """Rows sorted by one value (empty values last), then by title."""
    if not key:
        return rows

    def k(r: Any) -> tuple:
        v = r.values.get(key)
        n = _as_number(v)
        text = _text_of(v).casefold()
        return (1 if _empty(v) else 0, n if n is not None else float("inf"), text)

    filled = [r for r in rows if not _empty(r.values.get(key))]
    blank = [r for r in rows if _empty(r.values.get(key))]
    filled.sort(key=k, reverse=descending)
    return filled + blank


def parse_since(text: str | None) -> str | None:
    """An ISO instant or day as a comparable ``YYYY-MM-DDTHH:MM:SS`` prefix, else None."""
    if not text:
        return None
    try:
        if len(text) == 10:
            return date.fromisoformat(text).isoformat()
        return datetime.fromisoformat(text.replace("Z", "+00:00")).strftime("%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None


# -- sections ------------------------------------------------------------------------

_HEADING = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$")
_FENCE = re.compile(r"^ {0,3}(```|~~~)")


def _lines(body: str) -> list[str]:
    return body.splitlines(keepends=True)


def _headings(lines: list[str]) -> list[tuple[int, int, str]]:
    """(line index, level, text) of each heading outside fenced code."""
    out = []
    fence: str | None = None
    for i, line in enumerate(lines):
        bare = line.rstrip("\r\n")
        m = _FENCE.match(bare)
        if m:
            if fence is None:
                fence = m.group(1)
            elif m.group(1) == fence:
                fence = None
            continue
        if fence is not None:
            continue
        h = _HEADING.match(bare)
        if h:
            out.append((i, len(h.group(1)), h.group(2).strip()))
    return out


def outline(body: str) -> list[dict[str, Any]]:
    return [{"level": lvl, "text": text} for _i, lvl, text in _headings(_lines(body))]


def _find(lines: list[str], heading: str) -> tuple[int, int] | None:
    """(heading line, end line exclusive) of the first heading matching `heading`."""
    want = heading.strip().lstrip("#").strip().casefold()
    hs = _headings(lines)
    for n, (i, lvl, text) in enumerate(hs):
        if text.casefold() == want:
            end = len(lines)
            for j, lvl2, _t in hs[n + 1 :]:
                if lvl2 <= lvl:
                    end = j
                    break
            return i, end
    return None


def _newline(body: str) -> str:
    return "\r\n" if "\r\n" in body else "\n"


def _with_newlines(text: str, nl: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.endswith("\n"):
        text += "\n"
    return text.replace("\n", nl)


def read_section(body: str, heading: str) -> str | None:
    lines = _lines(body)
    span = _find(lines, heading)
    if span is None:
        return None
    return "".join(lines[span[0] : span[1]])


def replace_section(body: str, heading: str, text: str) -> str | None:
    """`body` with the section's content (not its heading line) replaced by `text`."""
    lines = _lines(body)
    span = _find(lines, heading)
    if span is None:
        return None
    nl = _newline(body)
    start, end = span
    head = lines[start]
    if not head.endswith(("\n", "\r")):
        head += nl
    content = _with_newlines(text, nl) if text.strip() else ""
    tail = lines[end:]
    sep = nl if tail and content and not content.endswith(nl + nl) else ""
    return "".join(lines[:start]) + head + content + sep + "".join(tail)


def append_to_section(body: str, heading: str | None, text: str) -> str | None:
    """`body` with `text` added at the end of the section (or of the body when `heading`
    is None), before the section's trailing blank lines."""
    nl = _newline(body) if body else "\n"
    addition = _with_newlines(text, nl)
    lines = _lines(body)
    if heading is None:
        if not body:
            return addition
        if not body.endswith(("\n", "\r")):
            body += nl
        if not body.endswith(nl + nl):
            body += nl
        return body + addition
    span = _find(lines, heading)
    if span is None:
        return None
    start, end = span
    insert = end
    while insert > start + 1 and lines[insert - 1].strip() == "":
        insert -= 1
    before = lines[:insert]
    if before and not before[-1].endswith(("\n", "\r")):
        before[-1] += nl
    needs_gap = insert > start + 1
    gap = nl if needs_gap else ""
    rest = lines[insert:]
    trailing = nl if rest and rest[0].strip() != "" else ""
    return "".join(before) + gap + addition + trailing + "".join(rest)
