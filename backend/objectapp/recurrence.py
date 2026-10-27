"""Recurrence arithmetic for Task `repeat` rules (pure, stdlib only).

Day-resolution dates are `date`s; time-resolution dates are UTC-aware
`datetime`s whose arithmetic happens on the local wall clock (09:00 stays
09:00 across a DST change) and are converted back with `localtime.from_local`.
Month and year steps clamp to the month's last day and always step from the
previous result, so `occurrences` equals what successive completions produce.

M8 custom rules (`rule.on`) are anchored instead (RFC 5545 BYDAY / BYMONTHDAY,
as Capacities' `rrule` does): the next occurrence is the first date matching
the rule strictly after the current one. Periods (weeks, months, years) count
from the current date's period in steps of `every`; a period with no matching
date (no 31st, no February 29) is skipped, not clamped. Weekly lists step
through the listed weekdays inside each Nth week, weeks starting on the
space's week start (`week_start`, 'monday' or 'sunday'; `week_start_of`
reads it from `ui.json`).
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, tzinfo

from pathlib import Path

from .localtime import from_local, to_local
from .taskmodel import WEEKDAYS, RepeatOn, RepeatRule

DateLike = date | datetime
WeekStart = str  # 'monday' | 'sunday' (ui.json calendar.weekStart)

_MAX_STEPS = 100_000
# periods searched for one match of an anchored rule ("every 12 months on the
# 31st" from February never matches); past this a step raises ValueError
_MAX_PERIODS = 2_000


def week_start_of(root: Path | str) -> WeekStart:
    """`ui.json` `calendar.weekStart` ('monday' by default). Reads, never writes."""
    from .uistate import load_ui  # lazy: uistate is not needed by pure callers

    try:
        cal = load_ui(Path(root)).get("calendar")
    except OSError:
        return "monday"
    if isinstance(cal, dict) and cal.get("weekStart") in ("monday", "sunday"):
        return cal["weekStart"]
    return "monday"


def _week_anchor(d: date, week_start: WeekStart) -> date:
    first = 6 if week_start == "sunday" else 0  # date.weekday() of the week's first day
    return d - timedelta(days=(d.weekday() - first) % 7)


def _nth_weekday(year: int, month: int, pos: int | str, weekday: str) -> date | None:
    wd = WEEKDAYS.index(weekday)
    last = calendar.monthrange(year, month)[1]
    if pos == "last":
        d = date(year, month, last)
        return d - timedelta(days=(d.weekday() - wd) % 7)
    first = date(year, month, 1)
    d = first + timedelta(days=(wd - first.weekday()) % 7 + 7 * (int(pos) - 1))
    return d if d.month == month else None


def _in_month(on: RepeatOn, year: int, month: int) -> list[date]:
    if on.weekdayPos is not None and on.weekday is not None:
        d = _nth_weekday(year, month, on.weekdayPos, on.weekday)
        return [d] if d else []
    last = calendar.monthrange(year, month)[1]
    if on.monthDay == "last":
        return [date(year, month, last)]
    day = int(on.monthDay or 0)
    return [date(year, month, day)] if 1 <= day <= last else []  # RFC 5545: skip, no clamp


def _period(rule: RepeatRule, anchor: date, k: int, week_start: WeekStart) -> list[date]:
    """Matching dates of the period `k * every` periods from `anchor`'s, sorted."""
    on = rule.on
    assert on is not None
    if rule.unit == "week":
        base = _week_anchor(anchor, week_start) + timedelta(weeks=k * rule.every)
        first = 6 if week_start == "sunday" else 0
        offsets = sorted((WEEKDAYS.index(w) - first) % 7 for w in on.weekdays or ())
        return [base + timedelta(days=o) for o in offsets]
    if rule.unit == "month":
        total = anchor.year * 12 + (anchor.month - 1) + k * rule.every
        year, month = divmod(total, 12)
        return _in_month(on, year, month + 1)
    if rule.unit == "year":
        year = anchor.year + k * rule.every
        if not 1 <= year <= 9999:
            raise OverflowError("year out of range")
        return _in_month(on, year, on.month or anchor.month)
    raise ValueError(f"unit {rule.unit!r} takes no 'on'")


def _anchored_after(rule: RepeatRule, d: date, week_start: WeekStart) -> date:
    for k in range(_MAX_PERIODS):
        for cand in _period(rule, d, k, week_start):
            if cand > d:
                return cand
    raise ValueError("no matching date")


def _anchored_before(rule: RepeatRule, d: date, week_start: WeekStart) -> date:
    for k in range(_MAX_PERIODS):
        for cand in reversed(_period(rule, d, -k, week_start)):
            if cand < d:
                return cand
    raise ValueError("no matching date")


def _add_months(d: date, months: int) -> date:
    total = d.year * 12 + (d.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _step_day(rule: RepeatRule, d: date, week_start: WeekStart = "monday") -> date:
    if rule.on is not None:
        return _anchored_after(rule, d, week_start)
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


def step(rule: RepeatRule, d: DateLike, tz: tzinfo, week_start: WeekStart = "monday") -> DateLike:
    """One interval after `d` (same kind as `d`); for an `on` rule the next matching date."""
    if isinstance(d, datetime):
        return _on_day(d, _step_day(rule, _local_day(d, tz), week_start), tz)
    return _step_day(rule, d, week_start)


def _back_day(rule: RepeatRule, anchor: date, d: date, k: int, week_start: WeekStart) -> date:
    """The scheduled day before `d`; `k` counts plain steps back from `anchor`."""
    if rule.on is not None:
        return _anchored_before(rule, d, week_start)
    unit = rule.unit
    if unit == "day":
        return anchor - timedelta(days=rule.every * k)
    if unit == "week":
        return anchor - timedelta(weeks=rule.every * k)
    if unit == "month":
        return _add_months(anchor, -rule.every * k)
    if unit == "year":
        return _add_months(anchor, -12 * rule.every * k)
    if unit == "weekday":
        p = d - timedelta(days=1)
        while p.weekday() >= 5:
            p -= timedelta(days=1)
        return p
    raise ValueError(f"unknown unit {unit!r}")


def _ended(rule: RepeatRule, d: DateLike, tz: tzinfo) -> bool:
    until = rule.until_date
    return until is not None and _local_day(d, tz) > until


def next_date(
    rule: RepeatRule,
    current: DateLike,
    completed_at: datetime,
    today: date,
    tz: tzinfo,
    week_start: WeekStart = "monday",
) -> DateLike | None:
    """The next occurrence after a completion, or None when `until` ends it.

    A step past the calendar's range (year 9999, an absurd N) also ends it,
    as does an `on` rule that matches no date.
    """
    try:
        return _next_date(rule, current, completed_at, today, tz, week_start)
    except (OverflowError, ValueError):
        return None


def _next_date(
    rule: RepeatRule,
    current: DateLike,
    completed_at: datetime,
    today: date,
    tz: tzinfo,
    week_start: WeekStart,
) -> DateLike | None:
    if rule.mode == "completionDate":
        base = _local_day(completed_at, tz)
        nxt: DateLike = _on_day(current, _step_day(rule, base, week_start), tz)
    else:
        nxt = step(rule, current, tz, week_start)
        steps = 1
        while _local_day(nxt, tz) < today and steps < _MAX_STEPS:
            nxt = step(rule, nxt, tz, week_start)
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
    week_start: WeekStart = "monday",
) -> list[DateLike]:
    """By-due-date occurrences after `current` whose local day is in [start, end]."""
    if rule.mode != "dueDate" or limit <= 0:
        return []
    out: list[DateLike] = []
    d = current
    for _ in range(_MAX_STEPS):
        try:
            d = step(rule, d, tz, week_start)
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


def scheduled_between(
    rule: RepeatRule,
    current: DateLike,
    start: date,
    end: date,
    tz: tzinfo,
    week_start: WeekStart = "monday",
    limit: int = 10_000,
) -> list[DateLike]:
    """Every scheduled date whose local day is in [start, end], oldest first.

    The schedule runs through `current` (included when in range): forward by
    `step` (so it matches successive completions and `occurrences`) and
    backward by the rule's pattern (an `on` rule's matching dates; a plain
    rule's interval counted back from `current`, month and year steps
    clamped, our choice). `until` ends the schedule; the rule's mode is not
    consulted (the caller decides whether a completion-mode rule has a
    schedule). At most the oldest `limit` dates.
    """
    if end < start or limit <= 0:
        return []
    cur_day = _local_day(current, tz)
    before: list[DateLike] = []
    if cur_day > start:
        d_day, k = cur_day, 0
        for _ in range(_MAX_STEPS):
            k += 1
            try:
                d_day = _back_day(rule, cur_day, d_day, k, week_start)
            except (OverflowError, ValueError):
                break
            if d_day < start:
                break
            if d_day <= end and not (rule.until_date and d_day > rule.until_date):
                before.append(_on_day(current, d_day, tz))
        before.reverse()
    out = before
    if start <= cur_day <= end and not _ended(rule, current, tz):
        out.append(current)
    if cur_day < end:
        d: DateLike = current
        for _ in range(_MAX_STEPS):
            if len(out) >= limit:
                break
            try:
                d = step(rule, d, tz, week_start)
            except (OverflowError, ValueError):
                break
            day = _local_day(d, tz)
            if day > end or _ended(rule, d, tz):
                break
            if day >= start:
                out.append(d)
    return out[:limit]
