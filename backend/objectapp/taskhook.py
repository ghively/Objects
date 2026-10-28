"""The Task status hook: completing, reopening and recurring, inside one property write.

`on_status_change` runs inside `Space._apply_values` on the `update_properties`
path only, after the generic encoding built ``sets``/``removals`` and before
they are written, so a completion (and a recurring advance) is the one stamped
write M2 already makes. It is the only place that completes, reopens or
advances a task.

M8: completing a recurring Task with a date also appends ``<old date>
completed <now>`` to its `occurrenceLog` (unless the caller's update writes
the log itself, as ``POST /api/tasks/occurrence`` does); reopening never
removes a line.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, tzinfo
from typing import Any

from .localtime import to_local
from .propvalues import decode_value, encode_value, label_lookup
from .recurrence import next_date
from .tasklog import LOG_KEY, format_entry, log_value
from .taskmodel import parse_repeat
from .typemodel import PropertyDefinition, TypeDefinition, is_task_type, status_category

__all__ = ["TaskResult", "on_status_change", "stamp", "status_key_of"]

DONE = "done"
NOT_STARTED = "not-started"


@dataclass
class TaskResult:
    completed: bool
    advanced: bool
    date: dict[str, Any] | None = None
    """The new ``date`` value (API form) after a recurring advance."""

    def to_api(self) -> dict[str, Any]:
        out: dict[str, Any] = {"completed": self.completed, "advanced": self.advanced}
        if self.date is not None:
            out["date"] = self.date
        return out


def stamp(instant: datetime) -> str:
    """``instant`` (aware) as UTC ``YYYY-MM-DDTHH:MM:SS.sssZ``."""
    now = instant.astimezone(UTC)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def status_key_of(t: TypeDefinition) -> PropertyDefinition | None:
    """The Task type's status label (``isStatus``), else its ``status`` label."""
    labels = [p for p in t.propertyDefinitions if p.type == "label"]
    return next((p for p in labels if p.options.get("isStatus")), None) or next(
        (p for p in labels if p.key == "status"), None
    )


def _category(pdef: PropertyDefinition, text: str | None) -> str:
    """The status category of an option text; no status or an unknown text is not-started."""
    if not text:
        return NOT_STARTED
    opt = label_lookup(pdef, text)
    if opt is None:
        return NOT_STARTED
    return opt.statusCategory or status_category(opt.text)


def _first_text(raw: Any) -> str | None:
    if isinstance(raw, (list, tuple)):
        raw = raw[0] if raw else None
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def _first_not_started(pdef: PropertyDefinition) -> str | None:
    for opt in pdef.options.get("set") or []:
        if isinstance(opt, dict) and _category(pdef, str(opt.get("text", ""))) == NOT_STARTED:
            return str(opt.get("text"))
    return None


def _current_date(value: dict[str, Any] | None) -> date | datetime | None:
    if not value or not isinstance(value.get("start"), str):
        return None
    start = value["start"]
    if value.get("resolution") == "day":
        return date.fromisoformat(start)
    dt = datetime.fromisoformat(start)
    return dt.astimezone(UTC)


def _date_api(d: date | datetime) -> dict[str, Any]:
    if isinstance(d, datetime):
        return {"start": stamp(d), "resolution": "time"}
    return {"start": d.isoformat(), "resolution": "day"}


def on_status_change(
    t: TypeDefinition | None,
    fm: dict[str, Any],
    sets: dict[str, Any],
    removals: list[str],
    clock: Callable[[], datetime] | datetime,
    tz: tzinfo,
    explicit: frozenset[str] | set[str] = frozenset(),
    week_start: str = "monday",
) -> TaskResult | None:
    """Complete, reopen or advance a Task whose status ``sets`` changes; edit ``sets``/``removals``.

    ``fm`` is the frontmatter before the write and ``explicit`` the keys the
    caller's update itself sets or removes (those keep the caller's value).
    ``clock`` is the write's instant (or a callable giving it). Returns None
    when the type is not the basic Task type, the status isn't in ``sets`` or
    the change stays in the same done/not-done side. ``week_start`` is
    ``ui.json``'s ``calendar.weekStart`` (M8: weekly ``on`` rules count weeks from it).
    """
    if not is_task_type(t):
        return None
    sdef = status_key_of(t)
    if sdef is None or sdef.key not in sets:
        return None
    before = decode_value(sdef, fm.get(sdef.key), fm)
    was_done = _category(sdef, before[0] if before else None) == DONE
    now_done = _category(sdef, _first_text(sets[sdef.key])) == DONE
    if was_done == now_done:
        return None
    now = clock() if callable(clock) else clock

    if not now_done:  # reopened: clear `completed`, never rewind a recurrence
        if "completed" not in explicit and "completed" in fm:
            removals.append("completed")
        return TaskResult(completed=False, advanced=False)

    if "completed" not in explicit:
        sets["completed"] = stamp(now)
    result = TaskResult(completed=True, advanced=False)
    date_def = t.prop("date")
    repeat_raw = sets["repeat"] if "repeat" in sets else fm.get("repeat")
    rule = parse_repeat(repeat_raw) if isinstance(repeat_raw, str) else None
    if date_def is None or rule is None:
        return result
    current = _current_date(decode_value(date_def, fm.get("date"), fm))
    if current is None:
        return result
    if LOG_KEY not in explicit:  # M8: one `<old date> completed <now>` line per completion
        line = format_entry(current, "completed", now)
        sets[LOG_KEY] = log_value(fm.get(LOG_KEY), [line])
    if "date" in explicit:
        return result
    reset = _first_not_started(sdef)
    if reset is None:
        return result
    nxt = next_date(rule, current, now, to_local(now, tz).date(), tz, week_start)
    if nxt is None:  # `until` ended the series: the task completes normally
        return result
    value = _date_api(nxt)
    sets["date"] = encode_value(date_def, value, fm.get("date"))
    sets[sdef.key] = encode_value(sdef, [reset], fm.get(sdef.key))
    return TaskResult(completed=True, advanced=True, date=value)
