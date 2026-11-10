"""A saved query evaluated on the server exactly as the app evaluates it (M31).

The app runs a saved query in two steps: it asks ``POST /api/rows`` for the query's scope
(``queries/runQuery.ts`` ``queryScope``: the query's types, or every type but the excluded
ones, and its search terms, which `rows.build_rows` matches as a case-folded substring of the
title, aliases, description and text, or the title alone in Title mode), then it runs
``runQuery`` over those rows: each type entry's collection rules (in any, in no, these, not
these), the included tags (any of / all of), the left-out tags, the property filters and sorts
(paused while a search term is set), and the limit (first N or N at random, not with grouping).
This module is the server's port of both, so the local API (``POST /v1/queries/{id}/run``) and
MCP's ``run_saved_query`` hand an agent the objects the app's query page lists, in its order.

- `query_scope`, `search_terms_of`, `is_query_ready` and `run_query` port ``runQuery.ts``;
  `apply_sorts` ports ``views/sort.ts`` ``applySorts`` (sorts in order, stable, empties last,
  then the newest ``createdAt`` first).
- Filters use the view filter engine's port (`automation_filter`), the one engine automation
  conditions use too: it filters every kind ``views/filter.ts`` filters (formula and rollup values
  by their result type, IDs, emails, phones and files, and M28's counterpart rows, a type's
  computed other sides, which filter and sort as relations).
- Text sorts compare as ``localeCompare(..., {numeric: true, sensitivity: 'base'})`` does: case
  and accents ignored, digit runs by their number, spaces and punctuation before digits before
  letters. It is a close reading of the browser's collation, not ICU itself.

Rows are the API's JSON shapes (``{summary, values, links}`` as ``/api/rows`` serves them).
Parity with the front end is tested: ``frontend/src/queries/__fixtures__/query-cases.json`` is
run by ``backend/tests/test_m31_query_parity.py`` and by ``queries/runQuery.parity.test.ts``.
"""

from __future__ import annotations

import math
import random
import re
import unicodedata
from collections.abc import Callable, Collection, Mapping
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from functools import cmp_to_key
from typing import TYPE_CHECKING, Any

from . import automation_filter as af
from .automation_filter import FilterCtx, type_json

if TYPE_CHECKING:
    from .rows import Row
    from .space import Space

__all__ = [
    "MAX_TERMS",
    "MIN_TERM",
    "QueryCtx",
    "QueryRun",
    "apply_sorts",
    "engine_type",
    "evaluate",
    "is_query_ready",
    "is_searching",
    "match_group",
    "query_ctx",
    "query_scope",
    "row_collection_ids",
    "run_query",
    "search_terms_of",
    "seeded_rng",
    "visible_rows",
]

MIN_TERM = 2
MAX_TERMS = 5


@dataclass
class QueryCtx(FilterCtx):
    """`FilterCtx` plus what sorts read: object path -> title (a relation sorts by its target's title)."""

    entity_titles: Mapping[str, str] = field(default_factory=dict)


# -- the definition ---------------------------------------------------------------------


def _dict(v: Any) -> Mapping[str, Any]:
    return v if isinstance(v, Mapping) else {}


def _list(v: Any) -> list[Any]:
    return v if isinstance(v, list) else []


def search_terms_of(d: Mapping[str, Any]) -> list[str]:
    """The usable search terms: trimmed, at least two characters, at most five (``searchTermsOf``)."""
    terms = [
        str(t.get("text") or "").strip()
        for t in _list(_dict(d.get("search")).get("searchTerms"))
        if isinstance(t, Mapping)
    ]
    return [t for t in terms if len(t) >= MIN_TERM][:MAX_TERMS]


def is_searching(d: Mapping[str, Any]) -> bool:
    return bool(search_terms_of(d))


def _has_tags(d: Mapping[str, Any]) -> bool:
    return bool(_list(_dict(d.get("tags")).get("ids")))


def _type_entries(d: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return [s for s in _list(d.get("types")) if isinstance(s, Mapping)]


def is_query_ready(d: Mapping[str, Any]) -> bool:
    """A query lists something only with a search term, a tag or a type (``isQueryReady``)."""
    return is_searching(d) or _has_tags(d) or bool(_type_entries(d))


def _exclusion_applies(d: Mapping[str, Any]) -> bool:
    """The "exclude" controls count only with a search term or an included tag."""
    return is_searching(d) or _has_tags(d)


def query_scope(d: Mapping[str, Any], all_type_ids: list[str]) -> dict[str, Any]:
    """What the app asks ``POST /api/rows`` for (``queryScope``); a query that isn't ready asks
    for no type at all (``QueryPage``), so it lists nothing."""
    if not is_query_ready(d):
        return {"typeIds": []}
    scope: dict[str, Any] = {}
    entries = _type_entries(d)
    excluded = [x for x in _list(d.get("excludeTypeIds")) if isinstance(x, str)]
    if entries:
        scope["typeIds"] = [s.get("id") for s in entries]
    elif excluded and _exclusion_applies(d) and all_type_ids:
        out = set(excluded)
        scope["typeIds"] = [i for i in all_type_ids if i not in out]
    terms = search_terms_of(d)
    if terms:
        mode = _dict(d.get("search")).get("searchMode")
        scope["search"] = {"terms": terms, "mode": mode if isinstance(mode, str) else "auto"}
    return scope


# -- collections ------------------------------------------------------------------------


def row_collection_ids(row: Mapping[str, Any], collections: list[Mapping[str, Any]]) -> list[str]:
    """The ids the row's ``collections:`` names resolve to, by name, then former name (``rowCollectionIds``)."""
    out: list[str] = []
    for n in _list(af._summary(row).get("collections")):
        if not isinstance(n, str):
            continue
        name = n.strip().lower()
        c = next((x for x in collections if str(x.get("name") or "").lower() == name), None)
        if c is None:
            c = next(
                (x for x in collections if any(str(f).lower() == name for f in _list(x.get("formerNames")))),
                None,
            )
        if c is not None and c.get("id") not in out:
            out.append(c["id"])
    return out


def _passes_type(row: Mapping[str, Any], s: Mapping[str, Any], collections: list[Mapping[str, Any]]) -> bool:
    have = row_collection_ids(row, collections)
    if s.get("inNoCollection") and have:
        return False
    if s.get("inAnyCollection") and not have:
        return False
    wanted = _list(s.get("collectionIds"))
    if wanted and not any(i in have for i in wanted):
        return False
    left_out = _list(s.get("excludeCollectionIds"))
    return not (left_out and any(i in have for i in left_out))


# -- filters: the view filter engine (`automation_filter`), which filters every kind filter.ts does

match_group = af.match_group
"""Whether a row passes a filter group (``matchGroup``): invalid filters are skipped."""

_COMPUTED_KINDS = af._COMPUTED_KINDS
_DATE_KINDS = af._DATE_KINDS
_as_computed = af._as_computed
_computed_is_empty = af._computed_is_empty
_computed_text = af._computed_text
_finite = af._finite
_js_string = af._js_string
_resolution_of = af._resolution_of


def _is_num(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool)


def _apply_filters(rows: list[Mapping[str, Any]], group: Any, ctx: FilterCtx) -> list[Mapping[str, Any]]:
    if not isinstance(group, Mapping) or not _list(group.get("elements")):
        return rows
    test = af._compile_group(group, ctx, af._by_id(ctx))
    return rows if test is None else [r for r in rows if test(r)]


# -- sorts ------------------------------------------------------------------------------

_UNSORTABLE = frozenset({"entity_type", "steps", "floorItems"})
_DAY_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")
_DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DIGITS_RE = re.compile(r"\d+")


@dataclass
class _Key:
    empty: bool
    value: Any = None
    label_order: list[int] | None = None


_EMPTY_KEY = _Key(True)


def _text_key(s: str) -> _Key:
    return _EMPTY_KEY if s.strip() == "" else _Key(False, s)


def _js_date_ms(iso: str, ctx: FilterCtx) -> float | None:
    """``new Date(iso).getTime()``: a day alone is UTC midnight, a time without an offset is
    local time (the time-zone setting here), and anything else is its own instant."""
    text = iso.strip()
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC) if _DATE_ONLY_RE.match(text) else dt.replace(tzinfo=ctx.tz)
    return dt.timestamp() * 1000


def _zoned_day_ms(iso: str, ctx: FilterCtx) -> float | None:
    """``parseDay``: the first instant of the day in the time-zone setting."""
    m = _DAY_RE.match(iso)
    if not m:
        return None
    try:
        day = af._js_day(int(m[1]), int(m[2]), int(m[3]))
    except (ValueError, OverflowError):
        return None
    return datetime(day.year, day.month, day.day, tzinfo=ctx.tz).timestamp() * 1000


def _date_start_ms(v: Any, ctx: FilterCtx) -> float | None:
    """``dateSpan(v).start`` as milliseconds, or None without a usable start."""
    if isinstance(v, str):
        v = {"start": v, "resolution": "time"} if v else None
    if not isinstance(v, Mapping):
        return None
    start = v.get("start")
    if not isinstance(start, str) or not start:
        return None
    return _js_date_ms(start, ctx) if v.get("resolution") == "time" else _zoned_day_ms(start, ctx)


def _computed_key(v: Any, ctx: FilterCtx) -> _Key:
    c = _as_computed(v)
    if c is None or _computed_is_empty(c):
        return _EMPTY_KEY
    t = c.get("type")
    if t == "number":
        return _Key(False, c["value"])
    if t == "boolean":
        return _Key(False, 1 if c.get("value") is True else 0)
    if t == "date":
        iso = c["value"]
        ms = _date_start_ms({"start": iso, "resolution": _resolution_of(iso)}, ctx)
        return _EMPTY_KEY if ms is None else _Key(False, ms)
    return _text_key(_computed_text(c))


def _id_key(v: Any) -> _Key:
    """An ID by its trailing number (``TASK-9`` before ``TASK-10``), else as text."""
    if _finite(v):
        return _Key(False, v)
    if not isinstance(v, str) or v.strip() == "":
        return _EMPTY_KEY
    m = re.search(r"(\d+)\s*$", v)
    return _Key(False, int(m[1])) if m else _text_key(v)


def _file_name(path: str) -> str:
    return re.split(r"[\\/]", path)[-1] or path


def _first_text(items: Any) -> str:
    return items[0] if isinstance(items, list) and items and isinstance(items[0], str) else ""


def _sort_key(row: Mapping[str, Any], sort: Mapping[str, Any], ctx: QueryCtx) -> _Key:
    s = af._summary(row)
    row_type = s.get("type")
    if sort.get("typeId") and row_type != sort.get("typeId"):
        return _EMPTY_KEY  # a sort scoped to one type sees every other type's rows as empty
    pid = sort["propertyId"]
    d = af._find_def(ctx.types, pid, row_type if isinstance(row_type, str) else None, None)
    if d is None:
        d = af._find_def(ctx.types, pid, None, None)
    if d is None:
        return _EMPTY_KEY
    v = af._row_value(row, pid)
    kind = d.get("type")
    if kind == "entity_title":
        return _text_key(af._display_title(row))
    if kind == "number":
        return _Key(False, v) if af._is_number(v) else _EMPTY_KEY
    if kind == "boolean":
        return _Key(False, 1 if v is True else 0)
    if kind in _DATE_KINDS:
        ms = _date_start_ms(v, ctx)
        return _EMPTY_KEY if ms is None else _Key(False, ms)
    if kind == "label":
        options = af._options(d).get("set")
        texts = [o.get("text") if isinstance(o, Mapping) else None for o in _list(options)]
        order = [texts.index(t) if t in texts else 2**53 - 1 for t in _list(v)]
        return _Key(False, 0, order) if order else _EMPTY_KEY
    if kind == "entity":
        first = v[0] if isinstance(v, list) and v else None
        path = None
        if isinstance(first, Mapping):
            path = first.get("path")
            if path is None:
                links = _list(_dict(row.get("links")).get(pid))
                path = links[0] if links else None
        title = ctx.entity_titles.get(path) if path else None
        target = first.get("target") if isinstance(first, Mapping) else None
        return _text_key(title or (target if isinstance(target, str) else "") or "")
    if kind == "entity_tags":
        return _text_key(_first_text(s.get("tags")))
    if kind == "entity_collections":
        return _text_key(_first_text(s.get("collections")))
    if kind == "entity_aliases":
        return _text_key(_first_text(s.get("aliases")))
    if kind in _COMPUTED_KINDS:
        return _computed_key(v, ctx)
    if kind == "uniqueId":
        return _id_key(v)
    if kind == "files":
        first = _first_text(v)
        return _text_key(_file_name(first) if first else "")
    if kind == "textList":
        return _text_key(_first_text(v))
    return _text_key(v) if isinstance(v, str) else _EMPTY_KEY


def _collation_key(s: str) -> list[tuple[int, Any]]:
    """``localeCompare`` with ``{numeric: true, sensitivity: 'base'}``, read closely: accents and
    case ignored, a digit run by its number, spaces and punctuation before digits before letters."""
    bare = "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch)).casefold()
    out: list[tuple[int, Any]] = []
    i = 0
    while i < len(bare):
        m = _DIGITS_RE.match(bare, i)
        if m:
            out.append((1, int(m[0])))
            i = m.end()
            continue
        ch = bare[i]
        out.append((2 if ch.isalpha() else 0, ch))
        i += 1
    return out


def _compare_values(a: _Key, b: _Key) -> int:
    if a.label_order is not None or b.label_order is not None:
        x, y = a.label_order or [], b.label_order or []
        for i in range(max(len(x), len(y))):
            if i >= len(x):
                return 1
            if i >= len(y):
                return -1
            if x[i] != y[i]:
                return x[i] - y[i]
        return 0
    if _is_num(a.value) and _is_num(b.value):
        return (a.value > b.value) - (a.value < b.value)
    ka, kb = _collation_key(_js_string(a.value)), _collation_key(_js_string(b.value))
    return (ka > kb) - (ka < kb)


def _created_ms(row: Mapping[str, Any], ctx: FilterCtx) -> float | None:
    created = af._summary(row).get("createdAt")
    return _js_date_ms(created, ctx) if isinstance(created, str) and created else None


def apply_sorts(rows: list[Mapping[str, Any]], sorts: Any, ctx: QueryCtx) -> list[Mapping[str, Any]]:
    """``applySorts``: by `sorts` in order (stable), falling back to ``createdAt`` newest first.
    Empty values go last; "is empty first" / "is empty last" order by emptiness only."""
    active = []
    for s in _list(sorts):
        if not isinstance(s, Mapping) or not isinstance(s.get("propertyId"), str):
            continue
        d = af._find_def(ctx.types, s["propertyId"], s.get("typeId") or None, ctx.view_type_ids)
        kind = d.get("type") if d is not None else None
        if kind and kind not in _UNSORTABLE:
            active.append(s)
    keyed = [
        (i, row, [_sort_key(row, s, ctx) for s in active], _created_ms(row, ctx)) for i, row in enumerate(rows)
    ]

    def cmp(p: tuple, q: tuple) -> int:
        for n, s in enumerate(active):
            a, b = p[2][n], q[2][n]
            opt = s.get("option")
            if opt == "ascendingExists":
                c = (0 if a.empty else 1) - (0 if b.empty else 1)
            elif opt == "descendingExists":
                c = (1 if a.empty else 0) - (1 if b.empty else 0)
            elif a.empty and b.empty:
                c = 0
            elif a.empty:
                c = 1
            elif b.empty:
                c = -1
            else:
                c = _compare_values(a, b)
                if opt == "descending":
                    c = -c
            if c != 0:
                return c
        ca, cb = p[3], q[3]
        if ca != cb:
            if ca is None:
                return 1
            if cb is None:
                return -1
            return (cb > ca) - (cb < ca)
        return p[0] - q[0]

    return [k[1] for k in sorted(keyed, key=cmp_to_key(cmp))]


# -- grouping: the rows the app lists under a grouping with hidden groups -----------------
# A port of the group ids ``views/group.ts`` ``groupRows`` gives a row (``rowBuckets``), enough to
# tell which rows sit only in hidden groups (labels, order and sizes are the app's alone).

_OTHER_ID = "other"
_TEXT_ID, _ALIAS_ID, _LINK_ID, _TAG_ID = "text:", "alias:", "link:", "tag:"
_VALUE_PREFIXES = (_TEXT_ID, _ALIAS_ID, _LINK_ID, _TAG_ID)
_STATUS_CATEGORY_OPTION = "statusCategory"
_SCHEDULED_OPTION = "scheduled"
_LINK_RE = re.compile(r"\[\[([^\]|#]+)")
_PARAGRAPH_RE = re.compile(r"\n\s*\n")


def _text_ids(s: str) -> list[str]:
    t = s.strip()
    return [_TEXT_ID + t] if t else []


def _js_text(v: Any) -> str:
    """``${v}`` for a value a template literal reads (`undefined` aside)."""
    if v is None:
        return "null"
    return _js_string(v)


def _clean(x: float) -> float:
    """``Number(x.toPrecision(12))``: the float noise of a decimal step rounded away."""
    return float(f"{x:.12g}")


def _wall(v: Any, ctx: FilterCtx) -> datetime | None:
    """``wallStart``: a date value's start on the wall clock of the time-zone setting (a day
    alone is that day's midnight there)."""
    if isinstance(v, str):
        v = {"start": v, "resolution": "time"} if v else None
    if not isinstance(v, Mapping):
        return None
    start = v.get("start")
    if not isinstance(start, str) or not start:
        return None
    if v.get("resolution") == "time":
        try:
            dt = datetime.fromisoformat(start.strip())
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ctx.tz)
        return dt.astimezone(ctx.tz)
    m = _DAY_RE.match(start)
    if not m:
        return None
    try:
        day = af._js_day(int(m[1]), int(m[2]), int(m[3]))
    except (ValueError, OverflowError):
        return None
    return datetime(day.year, day.month, day.day, tzinfo=ctx.tz)


def _day_id(d: date) -> str:
    return f"{d.year}-{d.month:02}-{d.day:02}"


def _date_id(at: datetime, option: Any, now: datetime, week_start: str) -> str:
    """``dateBucket``'s id."""
    if option == "hour":
        return f"{_day_id(at.date())}T{at.hour:02}"
    if option == "week":
        return _day_id(af.week_start_day(at.date(), week_start))
    if option == "month":
        return f"{at.year}-{at.month:02}"
    if option == "year":
        return str(at.year)
    if option in ("relative", _SCHEDULED_OPTION):
        days = (at.date() - now.date()).days
        weeks = (af.week_start_day(at.date(), week_start) - af.week_start_day(now.date(), week_start)).days // 7
        if option == _SCHEDULED_OPTION:
            if days < 0:
                return "overdue"
            if days in (0, 1):
                return "today" if days == 0 else "tomorrow"
            return "thisWeek" if weeks == 0 else "nextWeek" if weeks == 1 else "later"
        named = {0: "today", -1: "yesterday", 1: "tomorrow", -2: "theDayBeforeYesterday", 2: "theDayAfterTomorrow"}
        if days in named:
            return named[days]
        if weeks in (-1, 0, 1):
            return {-1: "lastWeek", 0: "thisWeek", 1: "nextWeek"}[weeks]
        return "earlier" if weeks < 0 else "later"
    return _day_id(at.date())


def _computed_ids(v: Any) -> list[str]:
    """``computedBuckets``' ids."""
    c = _as_computed(v)
    if c is None or _computed_is_empty(c):
        return []
    t = c.get("type")
    if t == "number":
        return [_TEXT_ID + _js_string(c["value"])]
    if t == "boolean":
        return [_TEXT_ID + ("true" if c.get("value") is True else "false")]
    if t == "date":
        return [_TEXT_ID + c["value"]]
    if t == "list":
        out: list[str] = []
        for item in af._computed_list(c) or []:
            for i in _text_ids(item):
                if i not in out:
                    out.append(i)
        return out
    return _text_ids(_computed_text(c))


@dataclass
class _GroupScratch:
    tags_by_title: dict[str, str]
    now: datetime
    week_start: str


def _row_group_ids(
    row: Mapping[str, Any], entry: Mapping[str, Any], d: Mapping[str, Any], ctx: FilterCtx, scratch: _GroupScratch
) -> list[str] | None:
    """``rowBuckets``' ids: [] is Other, None is no group at all (a number outside its range)."""
    pid = entry["propertyId"]
    v = af._row_value(row, pid)
    kind = d.get("type")
    s = af._summary(row)
    if kind == "boolean":
        return ["true" if v is True else "false"]
    if kind == "label":
        options = [o for o in _list(af._options(d).get("set")) if isinstance(o, Mapping)]
        if entry.get("option") == _STATUS_CATEGORY_OPTION and af._options(d).get("isStatus"):
            first = v[0] if isinstance(v, list) and v else None
            opt = next((o for o in options if o.get("text") == first), None)
            return [(opt.get("statusCategory") or "not-started") if opt is not None else "not-started"]
        out: list[str] = []
        for t in v if isinstance(v, list) else []:
            opt = next((o for o in options if o.get("text") == t), None)
            if opt is not None and opt.get("id") not in out:
                out.append(opt.get("id"))
        return out
    if kind in ("entity", "entity_backlinks"):
        links = _list(_dict(row.get("links")).get(pid))
        out = []
        for i, r in enumerate(v if isinstance(v, list) else []):
            if not r:
                continue
            path = r.get("path") if isinstance(r, Mapping) else None
            if path is None:
                path = links[i] if i < len(links) else None
            if path is not None:
                gid = str(path)
            else:
                target = r.get("target", "undefined") if isinstance(r, Mapping) else "undefined"
                gid = "target:" + (target if target == "undefined" else _js_text(target))
            if gid not in out:
                out.append(gid)
        return out
    if kind == "entity_tags":
        return [scratch.tags_by_title.get(t, _TAG_ID + t) for t in _list(s.get("tags")) if isinstance(t, str)]
    if kind == "entity_collections":
        return af._collection_ids(row, ctx.collections)
    if kind == "entity_type":
        return [s["type"]] if any(t.get("id") == s.get("type") for t in ctx.types) else []
    if kind == "entity_aliases":
        return [_ALIAS_ID + a for a in _list(s.get("aliases")) if isinstance(a, str)]
    if kind == "number":
        if not af._is_number(v):
            return []
        if entry.get("option") != "range":
            return [_js_string(v)]
        cfg = _dict(entry.get("numberRangeConfig"))
        step = cfg.get("step") if _finite(cfg.get("step")) and cfg["step"] > 0 else 1
        low = cfg.get("min") if _finite(cfg.get("min")) else 0
        high = cfg.get("max") if _finite(cfg.get("max")) else None
        if v < low or (high is not None and v > high):
            return None
        q = _clean((v - low) / step)
        i = math.floor(q)
        if high is not None and v == high and i > 0 and q == i:
            i -= 1
        return [f"{_js_string(_clean(low + i * step))}-{_js_string(_clean(low + (i + 1) * step))}"]
    if kind in _DATE_KINDS:
        at = _wall(af._date_of(row, pid), ctx)
        return [_date_id(at, entry.get("option"), scratch.now, scratch.week_start)] if at is not None else []
    if kind == "entity_title":
        return _text_ids(af._display_title(row))
    if kind == "textBlock":
        text = v if isinstance(v, str) else ""
        if entry.get("option") == "entity":
            out = []
            for m in _LINK_RE.finditer(text):
                t = m[1].strip()
                if t and _LINK_ID + t not in out:
                    out.append(_LINK_ID + t)
            return out
        return _text_ids(_PARAGRAPH_RE.split(text)[0])
    if kind in _COMPUTED_KINDS:
        return _computed_ids(v)
    if kind == "uniqueId":
        return _text_ids(_js_string(v) if _is_num(v) else v if isinstance(v, str) else "")
    return _text_ids(v if isinstance(v, str) else "")


def _same_group_id(saved: Any, gid: str) -> bool:
    if saved == gid:
        return True
    prefix = next((p for p in _VALUE_PREFIXES if gid.startswith(p)), None)
    return prefix is not None and saved == gid[len(prefix) :]


def _group_hidden(gid: str, config: Mapping[str, Any]) -> bool:
    """``findGroupConfig``: the group's saved entry (exact id first), else "hide by default"."""
    saved = [g for g in _list(config.get("groups")) if isinstance(g, Mapping)]
    c = next((g for g in saved if g.get("id") == gid), None)
    if c is None:
        c = next((g for g in saved if _same_group_id(g.get("id"), gid)), None)
    return bool(c.get("isHidden")) if c is not None else bool(config.get("hideByDefault"))


def visible_rows(
    rows: list[Mapping[str, Any]], group_by: Any, config: Any, ctx: FilterCtx
) -> list[Mapping[str, Any]]:
    """The rows a grouped view lists: those in at least one group its config (``groupByConfig``)
    doesn't hide. A row in no group (a number outside its range) is never listed; without a
    grouping, or one on no known property, every row is."""
    entry = next(iter(_list(_dict(group_by).get("groups"))), None)
    if not isinstance(entry, Mapping) or not isinstance(entry.get("propertyId"), str):
        return rows
    pid = entry["propertyId"]
    d = af._find_def(ctx.types, pid, entry.get("typeId") or None, ctx.view_type_ids)
    if d is None:
        return rows
    config = _dict(config)
    by_id = af._by_id(ctx)
    now = ctx.now.astimezone(ctx.tz)
    scratch = _GroupScratch({title: i for i, title in ctx.tag_titles.items()}, now, ctx.week_start)
    out = []
    for row in rows:
        row_type = af._summary(row).get("type")
        own = af._def_in(by_id.get(row_type) if isinstance(row_type, str) else None, pid)
        same = not (entry.get("typeId") and row_type != entry.get("typeId")) and (
            own is None or own.get("type") == d.get("type")
        )
        ids = _row_group_ids(row, entry, d, ctx, scratch) if same else []
        if ids is None:
            continue
        if not any(not _group_hidden(i, config) for i in ids or [_OTHER_ID]):
            continue
        out.append(row)
    return out


def seeded_rng(query_id: str, revision: str) -> Callable[[], float]:
    """A random limit's draw for one version of a query: the same each run until the query
    changes, so paging (``limit``/``offset``) walks one draw (our call: the app redraws on load)."""
    return random.Random(f"{query_id}\n{revision}").random


# -- the query --------------------------------------------------------------------------


@dataclass
class QueryRun:
    rows: list[Mapping[str, Any]]
    paused: bool
    """The stored property filters and sorts are paused because a search term is set."""


def _tag_filter(tag_id: Any, option: str) -> dict[str, Any]:
    return {"type": "filter", "propertyId": "tags", "option": option, "referenceValue": [tag_id]}


def run_query(
    d: Mapping[str, Any],
    rows: list[Mapping[str, Any]],
    ctx: QueryCtx,
    rng: Callable[[], float] = random.random,
) -> QueryRun:
    """``runQuery`` steps 1-5 over the rows the scope fetched (grouping only arranges them)."""
    searching = is_searching(d)
    tagged = _has_tags(d)
    kept = list(rows)
    entries = _type_entries(d)
    excluded = [x for x in _list(d.get("excludeTypeIds")) if isinstance(x, str)]

    # 1. Per type entry: its collection constraints. With no type entry, the excluded types go.
    if entries:
        by: dict[Any, Mapping[str, Any]] = {}
        for s in entries:
            by[s.get("id")] = s  # the last entry for an id wins, as `new Map` does
        kept = [
            r for r in kept
            if (s := by.get(af._summary(r).get("type"))) is not None and _passes_type(r, s, ctx.collections)
        ]  # fmt: skip
    elif excluded and _exclusion_applies(d):
        out = set(excluded)
        kept = [r for r in kept if af._summary(r).get("type") not in out]

    # 2. Included tags: any of (OR) or all of (AND).
    if tagged:
        tags = _dict(d.get("tags"))
        group = {
            "type": "filterGroup",
            "operator": "and" if tags.get("operator") == "and" else "or",
            "elements": [_tag_filter(i, "contains") for i in _list(tags.get("ids"))],
        }
        kept = [r for r in kept if match_group(r, group, ctx)]

    # 3. Excluded tags, only with a search term or an included tag.
    left_out = _list(_dict(d.get("excludeTags")).get("ids"))
    if left_out and _exclusion_applies(d):
        group = {"type": "filterGroup", "operator": "and", "elements": [_tag_filter(i, "notContains") for i in left_out]}
        kept = [r for r in kept if match_group(r, group, ctx)]

    # 4. Property filters and sorts, paused while searching (the stored ones stay unchanged).
    if searching:
        kept = apply_sorts(kept, [], ctx)
    else:
        kept = apply_sorts(_apply_filters(kept, d.get("filterGroup"), ctx), d.get("sorts"), ctx)

    # 5. Limit (not with grouping), the first N or N random ones.
    limit = _dict(d.get("limit"))
    size = limit.get("size")
    grouped = bool(_list(_dict(d.get("groupBy")).get("groups")))
    if not grouped and _finite(size) and size > 0:
        if limit.get("random"):
            pool = list(kept)
            picked: list[Mapping[str, Any]] = []
            while len(picked) < size and pool:
                picked.append(pool.pop(math.floor(rng() * len(pool))))
            kept = picked
        else:
            kept = kept[: int(size)]
    return QueryRun(kept, searching)


# -- on a space -------------------------------------------------------------------------


def engine_type(t: Mapping[str, Any]) -> dict[str, Any]:
    """A type as the window gets it (``{id, propertyDefinitions, counterparts?}``) in the shape
    the filter port reads. ``defIn`` reads a type's definitions, then its counterpart rows (M28)
    by key: so the counterparts go after the definitions, keyed by their key alone."""
    defs = [d for d in _list(t.get("propertyDefinitions")) if isinstance(d, Mapping)]
    extra = [
        {"key": c["key"], "type": c.get("type"), "options": c.get("options") or {}}
        for c in _list(t.get("counterparts"))
        if isinstance(c, Mapping) and isinstance(c.get("key"), str)
    ]
    return {"id": t.get("id"), "propertyDefinitions": [*defs, *extra]}


def query_ctx(space: Space, view_type_ids: list[str] | None = None) -> QueryCtx:
    """The context the app's data view builds (``DataView``): the space's types (with their
    counterpart rows), collections, Tag ids, object ids and titles, now, the zone and week start."""
    from .recurrence import week_start_of

    types = [type_json(t, space.counterpart_defs(t.id)) for t in space.types]
    summaries = space.list()  # templates excluded
    return QueryCtx(
        types=types,
        collections=[
            {"id": c.id, "name": c.name, "formerNames": list(c.formerNames)} for c in space.list_collections()
        ],
        tag_titles={s.id: s.title for s in summaries if s.id and s.type == "tag"},
        now=space.clock(),
        tz=space.tz,
        paths_by_id={s.id: s.path for s in summaries if s.id},
        view_type_ids=view_type_ids,
        week_start=week_start_of(space.root),
        entity_titles={s.path: s.title for s in summaries},
    )


def _row_json(r: Row) -> dict[str, Any]:
    return {"summary": asdict(r.summary), "values": r.values, "links": r.links}


@dataclass
class Evaluated:
    rows: list[Row]
    paused: bool


def evaluate(
    space: Space,
    d: Mapping[str, Any],
    rng: Callable[[], float] = random.random,
    *,
    hidden: Collection[str] = frozenset(),
    group_config: Any = None,
) -> Evaluated:
    """The rows a saved query's definition lists in the app, in its order: the scope fetched as
    ``POST /api/rows`` fetches it, then `run_query`, then the rows the view's grouping shows
    (`visible_rows`, ``group_config`` being the view's ``groupByConfig``). ``hidden`` paths (the
    objects excluded from AI) are left out first, so the query's own limit counts only the rest.
    An unknown search mode raises `InvalidValue`."""
    d = _dict(d)
    known = [t.id for t in space.types]
    scope = query_scope(d, known)
    search = scope.get("search")
    rows = space.rows(
        scope.get("typeIds"), None, None, (search["terms"], search["mode"]) if search else None, False
    )
    # The view's types: the scope's, else its rows' (`DataView` `viewTypes`), else every type.
    ids = scope.get("typeIds") or list(dict.fromkeys(r.summary.type for r in rows))
    view = [i for i in ids if i in set(known)] or known
    rows = [r for r in rows if r.summary.path not in hidden]
    ctx = query_ctx(space, view)
    by_path = {r.summary.path: r for r in rows}
    run = run_query(d, [_row_json(r) for r in rows], ctx, rng)
    listed = visible_rows(run.rows, d.get("groupBy"), group_config, ctx)
    return Evaluated([by_path[af._summary(x)["path"]] for x in listed], run.paused)
