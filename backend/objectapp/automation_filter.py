"""The view filter engine on the back end (M14 automation conditions).

A port of ``frontend/src/views/filter.ts`` (``matchGroup`` / ``matchFilter`` and the operator
table ``FILTER_OPTIONS`` / ``filterOptionsFor``), so a rule's conditions mean what the same
filter group means in a view. Nested AND/OR groups; an empty group passes; an invalid filter
(an unknown property or operator, a ``typeId`` naming no type) is ignored, and a group
with nothing effective left passes.

Everything works on the API's JSON shapes: a row is ``{summary, values, links}`` as
``GET /api/rows`` serves it, a type is ``{id, propertyDefinitions: [{id, key, type,
options}]}``, a collection ``{id, name, formerNames}``. Relative dates ("today", "this
week"...) resolve against ``ctx.now`` in ``ctx.tz``; a week starts on the space's "Start of the
week" setting (``ctx.week_start``, ``ui.json`` ``calendar.weekStart``, Monday by default), as
``views/dates.ts`` resolves it, so a rule's "this week" is the one the views and the calendar
show. Tag references are Tag object ids (``ctx.tag_titles``), entity references object ids
(``ctx.paths_by_id``).

Parity with ``filter.ts`` is tested: ``frontend/src/views/__fixtures__/filter-cases.json``
is run by ``test_m14_filter_parity.py`` and by ``views/filter.parity.test.ts``.
"""

from __future__ import annotations

import calendar
import math
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, tzinfo
from typing import Any

from .taskmodel import parse_remind, parse_repeat

__all__ = [
    "FILTER_OPTIONS",
    "TASK_DATE_OPTIONS",
    "FilterCtx",
    "filter_is_valid",
    "filter_options_for",
    "match_filter",
    "match_group",
    "type_json",
]

_EMPTY = ["isEmpty", "isNotEmpty"]
_TEXT = [*_EMPTY, "contains", "notContains", "is", "isNot", "startsWith", "endsWith"]
_NUMBER = ["equal", "notEqual", "greaterEqual", "greater", "smallerEqual", "smaller"]
_BOOLEAN = ["isChecked", "isNotChecked"]
_MANY = [*_EMPTY, "contains", "notContains"]
_DATE = [
    "isNotEmpty", "isEmpty", "startIsNotEmpty", "endIsEmpty", "endIsNotEmpty",
    "is", "isBefore", "isAfter", "isOnOrBefore", "isOnOrAfter",
    "startIs", "startIsBefore", "startIsAfter", "startIsOnOrBefore", "startIsOnOrAfter",
    "endIs", "endIsBefore", "endIsAfter", "endIsOnOrBefore", "endIsOnOrAfter",
]  # fmt: skip
TASK_DATE_OPTIONS = ["isRecurring", "isNotRecurring", "hasReminder", "hasNoReminder"]
_TASK_DATE_KEYS = frozenset(TASK_DATE_OPTIONS)
_RANGE_ONLY = frozenset(k for k in _DATE if k.startswith(("start", "end")))
_SIMPLE_DATE = [k for k in _DATE if k not in _RANGE_ONLY]
_BLOCKS = ["isNotEmpty", "isEmpty"]

FILTER_OPTIONS: dict[str, list[str]] = {
    "text": _TEXT,
    "url": _TEXT,
    "color": _TEXT,
    "textBlock": _TEXT,
    "entity_title": _TEXT,
    "entity_description": _TEXT,
    "number": _NUMBER,
    "boolean": _BOOLEAN,
    "label": _MANY,
    "entity": _MANY,
    "entity_tags": _MANY,
    "entity_aliases": ["contains", "notContains", *_EMPTY],
    "entity_type": ["contains", "notContains"],
    "entity_icon": [*_EMPTY, "is", "isNot"],
    "entity_collections": ["contains"],
    "entity_backlinks": ["contains"],
    "datetime": _DATE,
    "datetimeSimple": _SIMPLE_DATE,
    "entity_createdAt": _SIMPLE_DATE,
    "entity_lastUpdated": _SIMPLE_DATE,
    "blocks": _BLOCKS,
    "simpleTableBlock": _BLOCKS,
    "coverImage": _BLOCKS,
    "button": [],
    # M22: a list matches as Aliases do; steps and floor items are only empty or not.
    "textList": ["contains", "notContains", *_EMPTY],
    "steps": _EMPTY,
    "floorItems": _EMPTY,
}
"""Every operator per property kind (``filter.ts`` ``FILTER_OPTIONS``, keys only)."""

# Operators a saved filter may hold beyond the ones offered (``filter.ts`` ``ACCEPTED_EXTRA``).
_ACCEPTED_EXTRA: dict[str, list[str]] = {"entity_backlinks": ["notContains"]}

_BUILTIN_KINDS = {
    "title": "entity_title",
    "description": "entity_description",
    "tags": "entity_tags",
    "icon": "entity_icon",
    "aliases": "entity_aliases",
    "type": "entity_type",
    "collections": "entity_collections",
    "createdAt": "entity_createdAt",
    "lastUpdated": "entity_lastUpdated",
    "backlinks": "entity_backlinks",
    # M25: import provenance, read from the row's values (`rows._row`)
    "importedFrom": "text",
    "importBatch": "text",
    "sourceModified": "text",
}
_DATE_KINDS = frozenset({"datetime", "datetimeSimple", "entity_createdAt", "entity_lastUpdated"})
_UNTITLED = "Untitled"
_DAY_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")
_PARAGRAPH_RE = re.compile(r"\n\s*\n")


@dataclass
class FilterCtx:
    """What a pass needs besides the row (``filter.ts`` ``FilterCtx``)."""

    types: list[dict[str, Any]]
    collections: list[dict[str, Any]] = field(default_factory=list)
    tag_titles: Mapping[str, str] = field(default_factory=dict)
    """Tag object id -> title (tag values are titles)."""
    now: datetime = field(default_factory=lambda: datetime.now(UTC))
    tz: tzinfo = UTC
    paths_by_id: Mapping[str, str] = field(default_factory=dict)
    """Object id -> path, for entity filters' object ids."""
    view_type_ids: list[str] | None = None
    """The types first searched for a key two types share (the view's; here the scope's)."""
    week_start: str = "monday"
    """'monday' or 'sunday': the "Start of the week" setting (``recurrence.week_start_of``)."""


def type_json(t: Any) -> dict[str, Any]:
    """A `typemodel.TypeDefinition` in the API shape the matchers read."""
    return {
        "id": t.id,
        "propertyDefinitions": [
            {"id": p.id, "key": p.key, "type": p.type, "options": p.options or {}}
            for p in t.propertyDefinitions
        ],
    }


# -- definitions ------------------------------------------------------------------------


def _options(d: Mapping[str, Any]) -> Mapping[str, Any]:
    o = d.get("options")
    return o if isinstance(o, Mapping) else {}


def filter_options_for(d: Mapping[str, Any]) -> list[str]:
    """The operators a property offers (``filterOptionsFor``)."""
    kind = d.get("type")
    out = list(FILTER_OPTIONS.get(kind, []) if isinstance(kind, str) else [])
    constraints = _options(d).get("constraints")
    constraints = constraints if isinstance(constraints, Mapping) else {}
    if kind == "datetime" and constraints.get("endTimeSettings") == "notAllowed":
        out = [k for k in out if k not in _RANGE_ONLY]
    if kind in ("datetime", "datetimeSimple") and constraints.get("supportsReminders"):
        out = [*out, *TASK_DATE_OPTIONS]
    return out


def _def_in(t: Mapping[str, Any] | None, pid: str) -> dict[str, Any] | None:
    if t is None:
        return None
    for p in t.get("propertyDefinitions") or []:
        if p.get("key") == pid or p.get("id") == pid:
            return p
    kind = _BUILTIN_KINDS.get(pid)
    return {"type": kind, "options": {}} if kind else None


def _find_def(
    types: list[dict[str, Any]], pid: str, type_id: str | None, prefer: list[str] | None
) -> dict[str, Any] | None:
    if type_id:
        return _def_in(next((t for t in types if t.get("id") == type_id), None), pid)
    ordered = types
    if prefer:
        ordered = [t for t in types if t.get("id") in prefer] + [
            t for t in types if t.get("id") not in prefer
        ]
    for t in ordered:
        d = _def_in(t, pid)
        if d is not None:
            return d
    kind = _BUILTIN_KINDS.get(pid)
    return {"type": kind, "options": {}} if kind else None


def filter_is_valid(
    f: Mapping[str, Any], by_id: Mapping[str, Mapping[str, Any]], view_type_ids: list[str] | None
) -> bool:
    """Whether the filter names a property and an operator that still exist."""
    sid = f.get("typeId")
    if sid and sid not in by_id:
        return False
    pid = f.get("propertyId")
    if not isinstance(pid, str):
        return False
    d = _find_def(list(by_id.values()), pid, sid or None, view_type_ids)
    if d is None:
        return False
    option = f.get("option")
    return option in filter_options_for(d) or option in _ACCEPTED_EXTRA.get(d.get("type"), [])


# -- values -----------------------------------------------------------------------------


def _summary(row: Mapping[str, Any]) -> Mapping[str, Any]:
    s = row.get("summary")
    return s if isinstance(s, Mapping) else {}


def _values(row: Mapping[str, Any]) -> Mapping[str, Any]:
    v = row.get("values")
    return v if isinstance(v, Mapping) else {}


def _row_value(row: Mapping[str, Any], pid: str) -> Any:
    s = _summary(row)
    if pid in ("collections", "tags", "aliases"):
        v = s.get(pid)
        return v if v is not None else []
    if pid in ("title", "type", "description", "icon", "createdAt", "lastUpdated", "color",
               "coverImage"):  # fmt: skip
        return s.get(pid)
    return _values(row).get(pid)


def _display_title(row: Mapping[str, Any]) -> str:
    title = _summary(row).get("title")
    return title if isinstance(title, str) and title.strip() else _UNTITLED


def _is_number(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool) and not math.isnan(v)


def _blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "") or (isinstance(v, list) and not v)


def _text_value(kind: str, v: Any) -> str:
    s = v if isinstance(v, str) else ""
    return _PARAGRAPH_RE.split(s)[0] if kind == "textBlock" else s


def _match_text(kind: str, value: Any, f: Mapping[str, Any], title: str | None = None) -> bool:
    text = title if title is not None else _text_value(kind, value)
    option = f.get("option")
    if option == "isEmpty":
        return text.strip() == ""
    if option == "isNotEmpty":
        return text.strip() != ""
    ref = f.get("referenceValue")
    ref = ref if isinstance(ref, str) else ""
    if ref == "":
        return True
    a, b = text.lower(), ref.lower()
    match option:
        case "contains":
            return b in a
        case "notContains":
            return b not in a
        case "is":
            return a == b
        case "isNot":
            return a != b
        case "startsWith":
            return a.startswith(b)
        case "endsWith":
            return a.endswith(b)
    return True


def _match_number(value: Any, f: Mapping[str, Any]) -> bool:
    ref = f.get("referenceValue")
    if not _is_number(ref):
        return True  # a filter with no value yet is inactive
    if not _is_number(value):
        return f.get("option") == "notEqual"
    match f.get("option"):
        case "equal":
            return value == ref
        case "notEqual":
            return value != ref
        case "greaterEqual":
            return value >= ref
        case "greater":
            return value > ref
        case "smallerEqual":
            return value <= ref
        case "smaller":
            return value < ref
    return True


def _match_set(have: list[Any], want: list[Any], f: Mapping[str, Any]) -> bool:
    option = f.get("option")
    if option == "isEmpty":
        return not have
    if option == "isNotEmpty":
        return bool(have)
    if not want:
        return True
    hit = any(w in have for w in want)
    return not hit if option == "notContains" else hit


def _ref_ids(f: Mapping[str, Any]) -> list[str]:
    ref = f.get("referenceValue")
    return [x for x in ref if isinstance(x, str)] if isinstance(ref, list) else []


def _entity_paths(row: Mapping[str, Any], pid: str) -> list[str]:
    links = row.get("links")
    links = links.get(pid) if isinstance(links, Mapping) else None
    if links is not None:
        return [p for p in links if isinstance(p, str) and p]
    v = _values(row).get(pid)
    if not isinstance(v, list):
        return []
    return [r["path"] for r in v if isinstance(r, Mapping) and isinstance(r.get("path"), str) and r["path"]]


def _entity_count(row: Mapping[str, Any], pid: str) -> int:
    v = _values(row).get(pid)
    if isinstance(v, list):
        return len(v)
    links = row.get("links")
    found = links.get(pid) if isinstance(links, Mapping) else None
    return len(found) if isinstance(found, list) else 0


def _collection_ids(row: Mapping[str, Any], collections: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    for name in _summary(row).get("collections") or []:
        if not isinstance(name, str):
            continue
        n = name.lower()
        c = next((x for x in collections if str(x.get("name", "")).lower() == n), None)
        if c is None:
            c = next(
                (
                    x
                    for x in collections
                    if any(str(fn).lower() == n for fn in x.get("formerNames") or [])
                ),
                None,
            )
        if c is not None and c.get("id") not in out:
            out.append(c["id"])
    return out


# -- dates ------------------------------------------------------------------------------


def _js_day(y: int, m: int, d: int) -> date:
    """The day ``new Date(y, m - 1, d)`` names (an out-of-range month or day rolls over)."""
    first = date(y + (m - 1) // 12, (m - 1) % 12 + 1, 1)
    return first + timedelta(days=d - 1)


def _add_months(d: date, n: int) -> date:
    """Calendar-month arithmetic that clamps the day (``dates.ts`` ``addMonths``)."""
    month0 = d.month - 1 + n
    y, m = d.year + month0 // 12, month0 % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def week_start_day(d: date, week_start: str = "monday") -> date:
    """The first day of ``d``'s week: the Sunday or Monday on or before it (``dates.ts`` ``weekStartOf``)."""
    back = (d.weekday() + 1) % 7 if week_start == "sunday" else d.weekday()
    return d - timedelta(days=back)


def _relative_range(rel: str, now: datetime, tz: tzinfo, week_start: str = "monday") -> tuple[str, str] | None:
    """``resolveRelative`` as an inclusive range of ``YYYY-MM-DD`` days (``''``: no start).

    Weeks start on ``week_start`` ('monday' or 'sunday'), as ``views/dates.ts`` has them."""
    today = now.astimezone(tz).date()

    def day(d: date) -> tuple[str, str]:
        return d.isoformat(), d.isoformat()

    match rel:
        case "overdue":
            return "", (today - timedelta(days=1)).isoformat()
        case "today":
            return day(today)
        case "yesterday":
            return day(today - timedelta(days=1))
        case "tomorrow":
            return day(today + timedelta(days=1))
        case "thisWeek":
            start = week_start_day(today, week_start)
            return start.isoformat(), (start + timedelta(days=6)).isoformat()
        case "thisMonth":
            last = calendar.monthrange(today.year, today.month)[1]
            return today.replace(day=1).isoformat(), today.replace(day=last).isoformat()
        case "thisYear":
            return date(today.year, 1, 1).isoformat(), date(today.year, 12, 31).isoformat()
        case "oneWeekAgo":
            return day(today - timedelta(days=7))
        case "inOneWeek":
            return day(today + timedelta(days=7))
        case "oneMonthAgo":
            return day(_add_months(today, -1))
        case "inOneMonth":
            return day(_add_months(today, 1))
    return None


def _reference_range(f: Mapping[str, Any], ctx: FilterCtx) -> tuple[str, str] | None:
    ref = f.get("referenceValue")
    if not isinstance(ref, Mapping):
        return None
    rel = ref.get("relative")
    if rel:
        return _relative_range(str(rel), ctx.now, ctx.tz, ctx.week_start)
    exact = ref.get("exactDate")
    if exact:
        m = _DAY_RE.match(str(exact))
        if not m:
            return None
        try:
            d = _js_day(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except (ValueError, OverflowError):
            return None
        return d, d
    return None


def _day_of_instant(iso: str, tz: tzinfo) -> str | None:
    try:
        dt = datetime.fromisoformat(iso.strip())
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(tz).date().isoformat()


def _day_point(iso: Any, resolution: str, tz: tzinfo) -> str | None:
    if not isinstance(iso, str) or not iso:
        return None
    if resolution == "day":
        m = _DAY_RE.match(iso)
        return m[0] if m else None
    return _day_of_instant(iso, tz)


def _day_span(v: Any, tz: tzinfo) -> tuple[str, str | None] | None:
    if not isinstance(v, Mapping):
        return None
    resolution = "time" if v.get("resolution") == "time" else "day"
    start = _day_point(v.get("start"), resolution, tz)
    if not start:
        return None
    return start, _day_point(v.get("end"), resolution, tz)


def _date_of(row: Mapping[str, Any], pid: str) -> Mapping[str, Any] | None:
    v = _row_value(row, pid)
    if isinstance(v, str):
        return {"start": v, "resolution": "time"} if v else None
    return v if isinstance(v, Mapping) else None


def _match_date(
    value: Mapping[str, Any] | None,
    f: Mapping[str, Any],
    rng: tuple[str, str] | None,
    tz: tzinfo,
) -> bool:
    span = _day_span(value, tz)
    opt = f.get("option")
    if opt == "isEmpty":
        return span is None
    if opt == "isNotEmpty":
        return span is not None
    if span is None:
        return False
    if opt == "startIsNotEmpty":
        return True
    if opt == "endIsEmpty":
        return span[1] is None
    if opt == "endIsNotEmpty":
        return span[1] is not None
    if rng is None:
        return False
    v_start, v_end = span[0], span[1] or span[0]
    rs, re_ = rng
    point = v_start if isinstance(opt, str) and opt.startswith("start") else v_end
    match opt:
        case "is":
            return v_start <= re_ and v_end >= rs
        case "isBefore":
            return v_end < rs
        case "isAfter":
            return v_start > re_
        case "isOnOrBefore":
            return v_end <= re_
        case "isOnOrAfter":
            return v_start >= rs
        case "startIs" | "endIs":
            return rs <= point <= re_
        case "startIsBefore" | "endIsBefore":
            return point < rs
        case "startIsAfter" | "endIsAfter":
            return point > re_
        case "startIsOnOrBefore" | "endIsOnOrBefore":
            return point <= re_
        case "startIsOnOrAfter" | "endIsOnOrAfter":
            return point >= rs
    return False


def _match_task_date(row: Mapping[str, Any], f: Mapping[str, Any], has: bool) -> bool:
    d = _date_of(row, f["propertyId"]) if has else None
    values = _values(row)
    recurring = d is not None and parse_repeat(values.get("repeat")) is not None
    resolution = d.get("resolution") if d is not None else None
    reminder = (
        d is not None
        and isinstance(resolution, str)
        and parse_remind(values.get("remind"), resolution) is not None  # type: ignore[arg-type]
    )
    match f.get("option"):
        case "isRecurring":
            return recurring
        case "isNotRecurring":
            return not recurring
        case "hasReminder":
            return reminder
    return not reminder


# -- matching ---------------------------------------------------------------------------

Test = Callable[[Mapping[str, Any]], bool]


def _match_kind(
    row: Mapping[str, Any], f: Mapping[str, Any], d: Mapping[str, Any], has: bool, ctx: FilterCtx
) -> bool:
    kind = d.get("type")
    pid = f["propertyId"]
    value = _row_value(row, pid) if has else None
    s = _summary(row)
    match kind:
        case "entity_title":
            return _match_text(kind, None, f, _display_title(row))
        case "text" | "url" | "color" | "textBlock" | "entity_description":
            return _match_text(kind, value, f)
        case "number":
            return _match_number(value, f)
        case "boolean":
            return value is True if f.get("option") == "isChecked" else value is not True
        case "label":
            label_set = _options(d).get("set") or []
            have = value if isinstance(value, list) else []
            by_id: dict[Any, Any] = {}
            for o in label_set:
                if isinstance(o, Mapping):
                    by_id.setdefault(o.get("id"), o.get("text"))  # the first wins, as `find`
            want = [t for t in (by_id.get(i) for i in _ref_ids(f)) if t]
            return _match_set(have, want, f)
        case "entity" | "entity_backlinks":
            option = f.get("option")
            if option == "isEmpty":
                return not has or _entity_count(row, pid) == 0
            if option == "isNotEmpty":
                return has and _entity_count(row, pid) > 0
            paths = _entity_paths(row, pid) if has else []
            want = [p for p in (ctx.paths_by_id.get(i) for i in _ref_ids(f)) if p]
            return _match_set(paths, want, f)
        case "entity_tags":
            want = [t for t in (ctx.tag_titles.get(i) for i in _ref_ids(f)) if t]
            return _match_set(list(s.get("tags") or []), want, f)
        case "entity_collections":
            return _match_set(_collection_ids(row, ctx.collections), _ref_ids(f), f)
        case "entity_type":
            return _match_set([s.get("type")], _ref_ids(f), f)
        case "entity_aliases":
            have = [a for a in s.get("aliases") or [] if isinstance(a, str)]
            option = f.get("option")
            if option == "isEmpty":
                return not have
            if option == "isNotEmpty":
                return bool(have)
            ref = f.get("referenceValue")
            ref = ref.lower() if isinstance(ref, str) else ""
            if ref == "":
                return True
            hit = any(ref in a.lower() for a in have)
            return not hit if option == "notContains" else hit
        case "textList":
            # M22: as Aliases, on the row's value: a case-insensitive substring of any item.
            have = [a for a in value if isinstance(a, str)] if isinstance(value, list) else []
            option = f.get("option")
            if option == "isEmpty":
                return not have
            if option == "isNotEmpty":
                return bool(have)
            ref = f.get("referenceValue")
            ref = ref.lower() if isinstance(ref, str) else ""
            if ref == "":
                return True
            hit = any(ref in a.lower() for a in have)
            return not hit if option == "notContains" else hit
        case "entity_icon":
            icon = s.get("icon")
            option = f.get("option")
            if option == "isEmpty":
                return _blank(icon)
            if option == "isNotEmpty":
                return not _blank(icon)
            ref = f.get("referenceValue")
            ref = ref if isinstance(ref, str) else ""
            return icon != ref if option == "isNot" else icon == ref
    return _blank(value) if f.get("option") == "isEmpty" else not _blank(value)


def _compile_filter(
    f: Mapping[str, Any], ctx: FilterCtx, by_id: Mapping[str, Mapping[str, Any]]
) -> Test | None:
    if not filter_is_valid(f, by_id, ctx.view_type_ids):
        return None
    pid = f["propertyId"]
    sid = f.get("typeId") or None
    fallback = _find_def(ctx.types, pid, sid, ctx.view_type_ids)
    owns: dict[str, dict[str, Any] | None] = {}
    rng: list[tuple[str, str] | None] = []

    def test(row: Mapping[str, Any]) -> bool:
        row_type = _summary(row).get("type")
        if sid and row_type != sid:
            return True
        key = row_type if isinstance(row_type, str) else ""
        if key not in owns:
            owns[key] = _def_in(by_id.get(key), pid)
        own = owns[key]
        d = own if own is not None else fallback
        if d is None:
            return True
        if d.get("type") in _DATE_KINDS:
            if f.get("option") in _TASK_DATE_KEYS:
                return _match_task_date(row, f, own is not None)
            if not rng:
                rng.append(_reference_range(f, ctx))
            return _match_date(_date_of(row, pid) if own is not None else None, f, rng[0], ctx.tz)
        return _match_kind(row, f, d, own is not None, ctx)

    return test


def _compile_group(
    group: Mapping[str, Any], ctx: FilterCtx, by_id: Mapping[str, Mapping[str, Any]]
) -> Test | None:
    tests: list[Test] = []
    for e in group.get("elements") or []:
        if not isinstance(e, Mapping):
            continue
        t = (
            _compile_filter(e, ctx, by_id)
            if e.get("type") == "filter"
            else _compile_group(e, ctx, by_id)
        )
        if t is not None:
            tests.append(t)
    if not tests:
        return None
    if group.get("operator") == "or":
        return lambda row: any(t(row) for t in tests)
    return lambda row: all(t(row) for t in tests)


def _by_id(ctx: FilterCtx) -> dict[str, dict[str, Any]]:
    return {t["id"]: t for t in ctx.types if isinstance(t.get("id"), str)}


def match_filter(row: Mapping[str, Any], f: Mapping[str, Any], ctx: FilterCtx) -> bool:
    """Whether a row passes one filter (an invalid filter passes)."""
    test = _compile_filter(f, ctx, _by_id(ctx))
    return True if test is None else test(row)


def match_group(row: Mapping[str, Any], group: Mapping[str, Any] | None, ctx: FilterCtx) -> bool:
    """Whether a row passes a group; invalid filters and empty groups are skipped."""
    if not group:
        return True
    test = _compile_group(group, ctx, _by_id(ctx))
    return True if test is None else test(row)
