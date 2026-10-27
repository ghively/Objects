"""The calendar range query (M4): what each local day of a range holds.

One pass over a `Space`'s in-memory objects; no file is read or written.
`calendar_range(space, from_day, to_day)` answers ``GET /api/calendar`` with
the API contract's ``CalendarRange``:

- ``dailyNote``: the day's daily note (``Space.daily_notes``, first by path
  wins; the others are listed under ``warnings``).
- ``tasks``: Tasks whose ``date`` covers the day (``date``), whose
  ``deadline`` is the day (``deadline``), virtual future occurrences of open
  recurring by-due-date Tasks (``occurrence``), and on today only the open
  Tasks dated before today (``overdue``, ``day`` = their own date).
- ``dated``: every other date property value that covers the day, except
  hidden properties, ``hideCalendarEvents`` properties, types with
  ``hideFromCalendarSidebar``, the system stamps, DailyNote's own ``date`` and
  the Task ``date``/``deadline``.
- ``created`` / ``updated``: objects (not templates, not daily notes) created
  / last updated on the day; ``updated`` leaves out objects created that day.
- M8 ``backlinks``: objects linking ``[[YYYY-MM-DD]]`` to the day, whether or
  not its daily note exists (our choice), plus the daily note's own backlinks;
  the day's daily notes are left out. Sorted by title then path.
- M8 ``references``: objects holding date tokens (``<time datetime="…">``) for
  the day, with the count, sorted by title then path.
- M8 ``timeline``: the day's timed items sorted by time: creations
  (``created``, the ``createdAt`` instant), time-resolution date values
  (``dated``, with ``key``) and time-resolution Task dates (``task``), each on
  the local day it starts (our reading of "Timeline").

Instants (``createdAt``, ``lastUpdated``, time-resolution dates) become local
days per instant through ``Space.tz``; day-resolution dates are days as written.
"""

from __future__ import annotations

from dataclasses import fields
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any

from .dailynotes import parse_day
from .localtime import to_local
from .propvalues import InvalidValue, decode_value
from .recurrence import occurrences
from .taskhook import DONE, _category, status_key_of
from .taskmodel import parse_repeat
from .typemodel import PropertyDefinition, TypeDefinition, is_task_type

if TYPE_CHECKING:  # pragma: no cover
    from .space import Space

__all__ = ["MAX_DAYS", "calendar_range"]

MAX_DAYS = 100
_DATE_KINDS = frozenset({"datetime", "datetimeSimple"})
_SYSTEM_DATE_KEYS = frozenset({"createdAt", "lastUpdated"})
_TRUE_TEXTS = frozenset({"true", "yes", "1"})
_ONE_DAY = timedelta(days=1)


def _parse_range(from_day: Any, to_day: Any) -> tuple[date, date]:
    start = parse_day(from_day) if isinstance(from_day, str) else None
    end = parse_day(to_day) if isinstance(to_day, str) else None
    if start is None or start != from_day.strip():
        raise InvalidValue(f"Not a day (YYYY-MM-DD): {from_day!r}")
    if end is None or end != to_day.strip():
        raise InvalidValue(f"Not a day (YYYY-MM-DD): {to_day!r}")
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    if a > b:
        raise InvalidValue("The range starts after it ends.")
    if (b - a).days + 1 > MAX_DAYS:
        raise InvalidValue(f"A calendar range is at most {MAX_DAYS} days.")
    return a, b


class _Query:
    def __init__(self, space: Space, start: date, end: date) -> None:
        self.space = space
        self.start = start
        self.end = end
        self.tz = space.tz
        self.today = to_local(space.clock(), space.tz).date()
        self.days: dict[str, dict[str, Any]] = {}
        d = start
        while d <= end:
            self.days[d.isoformat()] = {
                "dailyNote": None,
                "tasks": [],
                "dated": [],
                "created": [],
                "updated": [],
                "backlinks": [],
                "references": [],
                "timeline": [],
            }
            d += _ONE_DAY
        self.mentioned: set[str] = set()
        self._instant_days: dict[str, date | None] = {}
        self._day_offsets: dict[date, timedelta | None] = {}
        self._timeline: list[tuple[datetime, int, str, str, dict[str, Any]]] = []

    # -- day arithmetic ----------------------------------------------------------

    def _local_day(self, dt: datetime) -> date:
        """The local day of an instant, with the zone asked per instant.

        A UTC day whose offset is the same at its start and its end has one
        offset throughout (zones change at most once a day), so that offset is
        asked once per UTC day; a transition day converts each instant.
        """
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        utc = dt.astimezone(UTC)
        key = utc.date()
        if key not in self._day_offsets:
            midnight = datetime(key.year, key.month, key.day, tzinfo=UTC)
            a = to_local(midnight, self.tz).utcoffset()
            b = to_local(midnight + _ONE_DAY, self.tz).utcoffset()
            self._day_offsets[key] = a if a == b else None
        offset = self._day_offsets[key]
        if offset is None:
            return to_local(utc, self.tz).date()
        return (utc.replace(tzinfo=None) + offset).date()

    def instant_day(self, text: Any) -> date | None:
        """The local day of a stamp (``…Z``), or the day of a bare ``YYYY-MM-DD``."""
        if isinstance(text, datetime):
            return self._local_day(text)
        if isinstance(text, date):
            return text
        if not isinstance(text, str) or not text.strip():
            return None
        cached = self._instant_days.get(text)
        if cached is not None or text in self._instant_days:
            return cached
        day: date | None
        bare = parse_day(text)
        if bare is not None:
            day = date.fromisoformat(bare)
        else:
            try:
                day = self._local_day(datetime.fromisoformat(text.strip()))
            except ValueError:
                day = None
        self._instant_days[text] = day
        return day

    def covered(self, value: dict[str, Any] | None) -> list[date]:
        """The local days a decoded date value covers, clipped to the range."""
        if not value or not isinstance(value.get("start"), str):
            return []
        first, last = self.span(value)
        if first is None:
            return []
        lo, hi = max(first, self.start), min(last or first, self.end)
        out: list[date] = []
        d = lo
        while d <= hi:
            out.append(d)
            d += _ONE_DAY
        return out

    def span(self, value: dict[str, Any]) -> tuple[date | None, date | None]:
        """(first day, last day) of a decoded date value (the rules of "Calendar semantics")."""
        start, end = value.get("start"), value.get("end")
        if value.get("resolution") == "day":
            a = parse_day(start)
            if a is None:
                return None, None
            first = date.fromisoformat(a)
            b = parse_day(end) if isinstance(end, str) else None
            last = date.fromisoformat(b) if b else first
            return first, max(last, first)
        try:
            s = datetime.fromisoformat(start)
        except ValueError:
            return None, None
        if s.tzinfo is None:
            s = s.replace(tzinfo=UTC)
        first = self._local_day(s)
        if not isinstance(end, str):
            return first, first
        try:
            e = datetime.fromisoformat(end)
        except ValueError:
            return first, first
        if e.tzinfo is None:
            e = e.replace(tzinfo=UTC)
        if e < s:
            return first, first
        local_end = to_local(e, self.tz)
        last = local_end.date()
        if e > s and local_end.time().replace(tzinfo=None) == datetime.min.time():
            last -= _ONE_DAY  # an end at exactly 00:00 local excludes that day
        return first, max(first, last)

    def in_range(self, d: date) -> bool:
        return self.start <= d <= self.end

    # -- entries -----------------------------------------------------------------

    def add(self, d: date, section: str, entry: Any) -> None:
        self.days[d.isoformat()][section].append(entry)

    def daily_notes(self) -> list[dict[str, Any]]:
        index, duplicates = self.space.daily_notes()
        raws = self.space._raw
        for day, path in index.items():
            if day in self.days and path in raws:
                self.days[day]["dailyNote"] = {
                    "path": path,
                    "reviewed": _is_true(raws[path].fm.get("reviewed")),
                }
                self.mentioned.add(path)
        warnings = []
        for day, paths in duplicates:
            if day in self.days and paths:
                warnings.append({"day": day, "paths": list(paths)})
                self.mentioned.update(paths)
        return warnings

    def timed(self, path: str, kind: str, start: Any, key: str | None = None) -> None:
        """Put an instant on the timeline of the local day it falls on (when in range)."""
        dt = _instant(start)
        if dt is None:
            return
        d = self._local_day(dt)
        if not self.in_range(d):
            return
        entry: dict[str, Any] = {"path": path, "at": _utc_text(dt), "kind": kind}
        if key is not None:
            entry["key"] = key
        self._timeline.append((dt, _KIND_ORDER[kind], path, key or "", entry))
        self.mentioned.add(path)

    def finish_timeline(self) -> None:
        for dt, _k, _p, _key, entry in sorted(self._timeline, key=lambda t: t[:4]):
            self.add(self._local_day(dt), "timeline", entry)

    def stamps(self, path: str, fm: dict[str, Any]) -> None:
        self.timed(path, "created", fm.get("createdAt"))
        created = self.instant_day(fm.get("createdAt"))
        updated = self.instant_day(fm.get("lastUpdated"))
        if created is not None and self.in_range(created):
            self.add(created, "created", path)
            self.mentioned.add(path)
        if updated is not None and updated != created and self.in_range(updated):
            self.add(updated, "updated", path)
            self.mentioned.add(path)

    def dated_properties(self, t: TypeDefinition, daily: bool) -> list[PropertyDefinition]:
        """The date properties of ``t`` that put objects under "Objects with this date"."""
        if t.extra.get("hideFromCalendarSidebar") is True:
            return []
        task = is_task_type(t)
        return [p for p in t.propertyDefinitions if _dated_property(p, task, daily)]

    def dated(self, path: str, props: list[PropertyDefinition], fm: dict[str, Any]) -> None:
        for pdef in props:
            raw = fm.get(pdef.key)
            if raw is None:
                continue
            value = decode_value(pdef, raw, fm)
            days = self.covered(value)
            if not days:
                continue
            entry: dict[str, Any] = {"path": path, "key": pdef.key, "start": value["start"]}
            if "end" in value:
                entry["end"] = value["end"]
            entry["resolution"] = value["resolution"]
            if value["resolution"] != "day":
                self.timed(path, "dated", value["start"], pdef.key)
            for d in days:
                self.add(d, "dated", dict(entry))
            self.mentioned.add(path)

    def task(self, path: str, t: TypeDefinition, fm: dict[str, Any]) -> None:
        sdef = status_key_of(t)
        done = False
        if sdef is not None:
            status = decode_value(sdef, fm.get(sdef.key), fm)
            done = _category(sdef, status[0] if status else None) == DONE
        date_def, deadline_def = t.prop("date"), t.prop("deadline")
        value = decode_value(date_def, fm.get("date"), fm) if date_def else None
        mentioned = False
        if value and isinstance(value.get("start"), str):
            first, last = self.span(value)
            if first is not None:
                if value.get("resolution") != "day":
                    self.timed(path, "task", value["start"])
                real_days = set()
                for d in self.covered(value):
                    self.add(d, "tasks", _task_entry(path, "date", d, done))
                    real_days.add(d)
                    mentioned = True
                last = last or first
                if not done and last < self.today and self.in_range(self.today):
                    self.add(self.today, "tasks", _task_entry(path, "overdue", first, False))
                    mentioned = True
                if not done:
                    mentioned |= self.occurrences(path, fm, value, first, last)
        if deadline_def is not None:
            dl = decode_value(deadline_def, fm.get("deadline"), fm)
            if dl and isinstance(dl.get("start"), str):
                d, _ = self.span(dl)
                if d is not None and self.in_range(d):
                    self.add(d, "tasks", _task_entry(path, "deadline", d, done))
                    mentioned = True
        if mentioned:
            self.mentioned.add(path)

    def occurrences(
        self, path: str, fm: dict[str, Any], value: dict[str, Any], first: date, last: date
    ) -> bool:
        repeat = fm.get("repeat")
        rule = parse_repeat(repeat) if isinstance(repeat, str) else None
        if rule is None or rule.mode != "dueDate":
            return False
        lo = max(self.start, self.today + _ONE_DAY, last + _ONE_DAY)
        if lo > self.end:
            return False
        current: date | datetime
        if value.get("resolution") == "day":
            current = first
        else:
            try:
                current = datetime.fromisoformat(value["start"])
            except ValueError:
                return False
            if current.tzinfo is None:
                current = current.replace(tzinfo=UTC)
        added = False
        for occ in occurrences(rule, current, lo, self.end, self.tz):
            d = self._local_day(occ) if isinstance(occ, datetime) else occ
            if first <= d <= last:
                continue  # never duplicate the real date
            self.add(d, "tasks", _task_entry(path, "occurrence", d, False))
            added = True
        return added


_KIND_ORDER = {"created": 0, "dated": 1, "task": 2}


def _instant(text: Any) -> datetime | None:
    """A stamp (``…Z`` or with an offset) as an aware instant; a bare day is not one."""
    if isinstance(text, datetime):
        return text if text.tzinfo is not None else text.replace(tzinfo=UTC)
    if not isinstance(text, str) or parse_day(text) is not None:
        return None
    try:
        dt = datetime.fromisoformat(text.strip())
    except ValueError:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def _utc_text(dt: datetime) -> str:
    utc = dt.astimezone(UTC)
    if utc.microsecond:
        return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"
    return utc.strftime("%Y-%m-%dT%H:%M:%SZ")


def _day_links(q: _Query, space: Space) -> None:
    """Fill each day's ``backlinks`` and ``references`` from the link index."""
    links = space.links
    index, duplicates = space.daily_notes()
    notes: dict[str, set[str]] = {}
    for day, path in index.items():
        notes.setdefault(day, set()).add(path)
    for day, paths in duplicates:
        notes.setdefault(day, set()).update(paths)
    summaries = space._summaries

    def order(p: str) -> tuple[str, str, str]:
        s = summaries.get(p)
        title = s.title if s is not None else p
        return (title.casefold(), title, p)

    for day, entry in q.days.items():
        own = notes.get(day, set())
        sources = links.day_link_sources(day)
        if day in index:
            sources.update(links.backlinks(index[day]))
        backlinks = sorted((p for p in sources - own if p in summaries), key=order)
        entry["backlinks"] = backlinks
        refs = links.date_references(day)
        entry["references"] = [
            {"path": p, "count": refs[p]} for p in sorted(refs, key=order) if p in summaries
        ]
        q.mentioned.update(backlinks)
        q.mentioned.update(r["path"] for r in entry["references"])


def _summary_dict(summary: Any) -> dict[str, Any]:
    """`dataclasses.asdict` for an `ObjectSummary` (flat: strings, bools and string lists)."""
    return {
        f.name: list(v) if isinstance(v := getattr(summary, f.name), list) else v
        for f in fields(summary)
    }


def _task_entry(path: str, kind: str, day: date, done: bool) -> dict[str, Any]:
    return {"path": path, "kind": kind, "day": day.isoformat(), "done": done}


def _is_true(raw: Any) -> bool:
    if isinstance(raw, bool):
        return raw
    return isinstance(raw, str) and raw.strip().lower() in _TRUE_TEXTS


def _dated_property(pdef: PropertyDefinition, task: bool, daily: bool) -> bool:
    if pdef.type not in _DATE_KINDS or pdef.key in _SYSTEM_DATE_KEYS:
        return False
    if pdef.visibility == "hidden" or pdef.options.get("hideCalendarEvents") is True:
        return False
    if task and pdef.key in ("date", "deadline"):
        return False
    return not (daily and pdef.key == "date")


def calendar_range(space: Space, from_day: Any, to_day: Any) -> dict[str, Any]:
    """The ``CalendarRange`` for the local days ``from_day`` through ``to_day`` (inclusive).

    Raises `InvalidValue` for a malformed day, ``from_day > to_day`` or more
    than `MAX_DAYS` days. Reads only memory.
    """
    start, end = _parse_range(from_day, to_day)
    with space._lock:
        q = _Query(space, start, end)
        warnings = q.daily_notes()
        daily_type = space.daily_note_type()
        daily_id = daily_type.id if daily_type is not None else None
        types: dict[str, TypeDefinition | None] = {}
        dated_props: dict[str, list[PropertyDefinition]] = {}
        for path in sorted(space._raw):
            summary = space._summaries.get(path)
            if summary is None or summary.template is not None:
                continue
            fm = space._raw[path].fm
            daily = daily_id is not None and summary.type == daily_id
            if summary.type not in types:
                t = types[summary.type] = space.type_by_id(summary.type)
                dated_props[summary.type] = q.dated_properties(t, daily) if t else []
            t = types[summary.type]
            if not daily:
                q.stamps(path, fm)
            if t is None:
                continue
            q.dated(path, dated_props[summary.type], fm)
            if is_task_type(t):
                q.task(path, t, fm)
        q.finish_timeline()
        _day_links(q, space)
        summaries = {
            p: _summary_dict(space._summaries[p])
            for p in sorted(q.mentioned)
            if p in space._summaries
        }
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "today": q.today.isoformat(),
        "days": q.days,
        "summaries": summaries,
        "warnings": warnings,
    }
