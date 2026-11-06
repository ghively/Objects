"""M23: today's meetings for the Work section (plan ``2026-11-05-m23-work-section.md``).

`meetings_on` lists the meetings starting on a local day: objects of a type whose template is
``meeting`` (or whose id is ``meeting``) with a ``date`` datetime value that has a time and
starts on that day (`Space.tz`); a meeting without an end lasts `MEETING_DEFAULT_MINUTES`
(ours). Templates are left out. `today` is ``GET /api/work/today``'s ``WorkToday``.
Reads only memory; nothing is written.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from .dailynotes import parse_day
from .localtime import to_local
from .propvalues import InvalidValue, decode_value
from .space import Space
from .typemodel import TypeDefinition
from .typetemplates import template_for
from .workrules import iso_instant

__all__ = ["MEETING_DEFAULT_MINUTES", "meetings_on", "today"]

MEETING_DEFAULT_MINUTES = 30
_DATE_KINDS = frozenset({"datetime", "datetimeSimple"})


def _check_day(day: Any) -> str:
    parsed = parse_day(day) if isinstance(day, str) else None
    if parsed is None or parsed != day.strip():
        raise InvalidValue(f"Not a day (YYYY-MM-DD): {day!r}")
    return parsed


def _is_meeting(t: TypeDefinition) -> bool:
    return t.id == "meeting" or template_for(t) == "meeting"


def _instant(text: Any) -> datetime | None:
    if not isinstance(text, str) or len(text) <= 10:
        return None
    try:
        moment = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else None


def _hhmm(moment: datetime, space: Space) -> str:
    return to_local(moment, space.tz).strftime("%H:%M")


def meetings_on(space: Space, day: str) -> list[dict]:
    """The ``MeetingSlot``s of the meetings starting on local ``day``, by start."""
    day = _check_day(day)
    with space._lock:
        meeting_types: dict[str, TypeDefinition] = {}
        for t in space.types:
            if t.id not in meeting_types and _is_meeting(t):
                meeting_types[t.id] = t
        objects = [
            (path, summary, space._raw[path].fm)
            for path, summary in space._summaries.items()
            if summary.template is None and summary.type in meeting_types and path in space._raw
        ]
    found: list[tuple[datetime, str, str, dict]] = []
    for path, summary, fm in objects:
        p = meeting_types[summary.type].prop("date")
        if p is None or p.type not in _DATE_KINDS:
            continue
        value = decode_value(p, fm.get(p.key), fm)
        if isinstance(value, list):
            value = value[0] if value else None
        if not isinstance(value, dict) or value.get("resolution") != "time":
            continue
        start = _instant(value.get("start"))
        if start is None:
            continue
        try:
            if to_local(start, space.tz).date().isoformat() != day:
                continue
            end = _instant(value.get("end"))
            if end is None or end < start:
                end = start + timedelta(minutes=MEETING_DEFAULT_MINUTES)
            slot = {
                "path": path,
                "title": summary.title,
                "start": iso_instant(start),
                "end": iso_instant(end),
                "startLocal": _hhmm(start, space),
                "endLocal": _hhmm(end, space),
            }
        except (OverflowError, OSError, ValueError):
            continue  # a date at the edge of what datetime can hold
        found.append((start, summary.title, path, slot))
    found.sort(key=lambda x: x[:3])
    return [slot for *_k, slot in found]


def today(space: Space, day: str | None) -> dict:
    """The ``WorkToday`` of ``day`` (default: today in `Space.tz`)."""
    now = space.clock()
    local_now = to_local(now, space.tz)
    day = local_now.date().isoformat() if day is None else _check_day(day)
    return {
        "day": day,
        "now": iso_instant(now),
        "nowLocal": local_now.strftime("%H:%M"),
        "meetings": meetings_on(space, day),
    }
