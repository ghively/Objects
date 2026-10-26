"""Recurrence arithmetic for Task `repeat` rules (pure, stdlib only).

Day-resolution dates are `date`s; time-resolution dates are UTC-aware
`datetime`s whose arithmetic happens on the local wall clock (09:00 stays
09:00 across a DST change) and are converted back with `localtime.from_local`.
Month and year steps clamp to the month's last day and always step from the
previous result, so `occurrences` equals what successive completions produce.
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, tzinfo

from .localtime import from_local, to_local
from .taskmodel import RepeatRule

DateLike = date | datetime

_MAX_STEPS = 100_000


def _add_months(d: date, months: int) -> date:
    total = d.year * 12 + (d.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _step_day(rule: RepeatRule, d: date) -> date:
    unit = rule.unit
    if unit == "day":
        return d + timedelta(days=rule.every)
    if unit == "week":
        return d + timedelta(weeks=rule.every)
    if unit == "month":
        return _add_months(d, rule.every)
    if unit == "year":
        return _add_months(d, 12 * rule.every)
    if unit == "weekday":
        n = d + timedelta(days=1)
        while n.weekday() >= 5:
            n += timedelta(days=1)
        return n
    raise ValueError(f"unknown unit {unit!r}")


def _local_day(d: DateLike, tz: tzinfo) -> date:
    if isinstance(d, datetime):
        return to_local(d, tz).date()
    return d


def _on_day(d: DateLike, new_day: date, tz: tzinfo) -> DateLike:
    """`new_day` in the same kind as `d` (a datetime keeps its local time)."""
    if isinstance(d, datetime):
        local = to_local(d, tz)
        naive = datetime.combine(new_day, local.time().replace(tzinfo=None, fold=0))
        return from_local(naive, tz)
    return new_day


def step(rule: RepeatRule, d: DateLike, tz: tzinfo) -> DateLike:
    """One interval after `d` (same kind as `d`)."""
    if isinstance(d, datetime):
        return _on_day(d, _step_day(rule, _local_day(d, tz)), tz)
    return _step_day(rule, d)


def _ended(rule: RepeatRule, d: DateLike, tz: tzinfo) -> bool:
    until = rule.until_date
    return until is not None and _local_day(d, tz) > until


def next_date(
    rule: RepeatRule,
    current: DateLike,
    completed_at: datetime,
    today: date,
    tz: tzinfo,
) -> DateLike | None:
    """The next occurrence after a completion, or None when `until` ends it.

    A step past the calendar's range (year 9999, an absurd N) also ends it.
    """
    try:
        return _next_date(rule, current, completed_at, today, tz)
    except (OverflowError, ValueError):
        return None


def _next_date(
    rule: RepeatRule,
    current: DateLike,
    completed_at: datetime,
    today: date,
    tz: tzinfo,
) -> DateLike | None:
    if rule.mode == "completionDate":
        base = _local_day(completed_at, tz)
        nxt: DateLike = _on_day(current, _step_day(rule, base), tz)
    else:
        nxt = step(rule, current, tz)
        steps = 1
        while _local_day(nxt, tz) < today and steps < _MAX_STEPS:
            nxt = step(rule, nxt, tz)
            steps += 1
    if _ended(rule, nxt, tz):
        return None
    return nxt


def occurrences(
    rule: RepeatRule,
    current: DateLike,
    start: date,
    end: date,
    tz: tzinfo,
    limit: int = 366,
) -> list[DateLike]:
    """By-due-date occurrences after `current` whose local day is in [start, end]."""
    if rule.mode != "dueDate" or limit <= 0:
        return []
    out: list[DateLike] = []
    d = current
    for _ in range(_MAX_STEPS):
        try:
            d = step(rule, d, tz)
        except (OverflowError, ValueError):
            break
        day = _local_day(d, tz)
        if day > end or _ended(rule, d, tz):
            break
        if day >= start:
            out.append(d)
            if len(out) >= limit:
                break
    return out
