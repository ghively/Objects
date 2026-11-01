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
import math
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


def _newest_window(rule: RepeatRule, end: date, limit: int) -> date | None:
    """A day such that [day, end] holds at least `limit` scheduled dates of a fixed-pattern
    rule (when the schedule has that many), or None when the rule has no fixed pattern."""
    interval = _plain_interval_days(rule)
    if interval is not None:
        days = interval * limit
    elif rule.on is None and rule.unit == "weekday":
        days = 7 * ((limit + 4) // 5) + 7
    else:
        return None
    try:
        return end - timedelta(days=days)
    except OverflowError:
        return date.min


def _ended(rule: RepeatRule, d: DateLike, tz: tzinfo) -> bool:
    until = rule.until_date
    return until is not None and _local_day(d, tz) > until


def _plain_interval_days(rule: RepeatRule) -> int | None:
    """The fixed day interval of a plain ``every N days/weeks`` rule, else None."""
    if rule.on is not None or rule.every < 1:
        return None
    if rule.unit == "day":
        return rule.every
    if rule.unit == "week":
        return 7 * rule.every
    return None


def _jump_to_before(
    rule: RepeatRule, current: DateLike, target: date, tz: tzinfo, week_start: WeekStart
) -> DateLike:
    """The latest date of `current`'s forward series whose local day is before `target`.

    Arithmetic for the rules whose series is a fixed pattern of days (``every N
    days``, ``every N weeks``, ``every weekday``): the same date successive `step`s
    would reach, found in O(1) instead of a step per day (audit 2026-11-01 B8: a
    daily task dated 2021 made every calendar month 229 ms; one dated 1800, 1.6 s).
    Other rules (months and years clamp from the previous result, ``on`` rules are
    anchored) return `current`, and the caller steps as before. `until` is not
    consulted: the caller's first step past the result checks it, as it would have
    at the first ended date (every later one is ended too).
    """
    cur_day = _local_day(current, tz)
    if target <= cur_day:
        return current
    interval = _plain_interval_days(rule)
    if interval is not None:
        k = (target - cur_day - timedelta(days=1)).days // interval
        if k <= 0:
            return current
        return _on_day(current, cur_day + timedelta(days=k * interval), tz)
    if rule.on is None and rule.unit == "weekday":
        last = target - timedelta(days=1)
        while last.weekday() >= 5:
            last -= timedelta(days=1)
        if last <= cur_day:
            return current
        return _on_day(current, last, tz)
    found: date | None = None
    if rule.every >= 1 and rule.on is not None:
        found = _anchored_jump(rule, cur_day, target, week_start)
    elif rule.every >= 1 and rule.unit in ("month", "year"):
        found = _clamped_jump(rule, cur_day, target)
    if found is not None and cur_day < found < target:
        return _on_day(current, found, tz)
    return current


def _anchored_jump(rule: RepeatRule, cur_day: date, target: date, week_start: WeekStart) -> date | None:
    """The last date of an anchored rule's series from `cur_day` before `target`, or None.

    The series is every matching date after `cur_day` in the periods ``k * every``
    from `cur_day`'s (each step counts from a date in such a period), so the periods
    are searched back from the one `target` falls in. None when none of the last
    `_MAX_PERIODS` periods matches: the caller steps (and fails) as before.
    """
    if rule.unit == "week":
        units = (_week_anchor(target, week_start) - _week_anchor(cur_day, week_start)).days // 7
    elif rule.unit == "month":
        units = (target.year * 12 + target.month) - (cur_day.year * 12 + cur_day.month)
    elif rule.unit == "year":
        units = target.year - cur_day.year
    else:
        return None
    top = units // rule.every
    for k in range(top, max(top - _MAX_PERIODS, -1), -1):
        for cand in reversed(_period(rule, cur_day, k, week_start)):
            if cand < target:
                return cand if cand > cur_day else None
    return None


def _clamped_jump(rule: RepeatRule, cur_day: date, target: date) -> date | None:
    """A date of a plain month/year rule's series from `cur_day`, in a month before `target`'s.

    Each step clamps to the new month's last day from the previous result, so the
    day after ``k`` steps is the smallest of `cur_day`'s day and every visited
    month's length (`_clamped_day`).
    """
    n = rule.every * (12 if rule.unit == "year" else 1)
    base = cur_day.year * 12 + cur_day.month - 1
    k = (target.year * 12 + target.month - 1 - base) // n - 1
    if k <= 0:
        return None
    year, month = divmod(base + k * n, 12)
    day = _clamped_day(cur_day, n, k) if cur_day.day > 28 else cur_day.day
    return date(year, month + 1, day)


def _clamped_day(start: date, n: int, k: int) -> int:
    """The day of month after `k` steps of `n` months from `start`, each clamped."""
    day = start.day
    base = start.year * 12 + start.month - 1
    cycle = 12 // math.gcd(n, 12)  # steps until the month of the year comes round again
    for j in range(1, min(k, cycle) + 1):
        year, month = divmod(base + j * n, 12)
        if month + 1 != 2:
            day = min(day, calendar.monthrange(year, month + 1)[1])  # the same every year
            continue
        # February: 29 days in leap years only, so walk its visits to the first common year.
        while j <= k and day > 28:
            day = min(day, 29 if calendar.isleap((base + j * n) // 12) else 28)
            j += cycle
    return day


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
        nxt = step(rule, _jump_to_before(rule, current, today, tz, week_start), tz, week_start)
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
    d = _jump_to_before(rule, current, start, tz, week_start)
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


def scheduled_days(
    rule: RepeatRule,
    current: DateLike,
    start: date,
    end: date,
    tz: tzinfo,
    limit: int = 100_000,
) -> list[date] | None:
    """The local days of ``scheduled_between(rule, current, start, end, tz, limit=limit)``
    for a fixed-pattern rule (every N days or weeks, every weekday), counted without
    building a date per step; None for any other rule, and for a history reaching more
    than `_MAX_STEPS` // 2 days back from `current` (where the walk back stops early).

    A timed date's day is taken to stay the same day at each step, as `_jump_to_before` does.
    """
    interval = _plain_interval_days(rule)
    weekday = rule.on is None and rule.unit == "weekday"
    if interval is None and not weekday:
        return None
    if end < start or limit <= 0:
        return []
    cur = _local_day(current, tz).toordinal()
    if cur - start.toordinal() > _MAX_STEPS // 2:
        return None
    until = rule.until_date
    hi = min(end, until).toordinal() if until is not None else end.toordinal()
    lo = start.toordinal()
    if interval is not None:
        first = cur + -((cur - lo) // interval) * interval  # the first day >= lo on the grid
        ords: range | list[int] = range(first, hi + 1, interval)
    else:
        # date.fromordinal(n).weekday() == (n + 6) % 7; the current day counts on a weekend.
        ords = [n for n in range(lo, hi + 1) if (n + 6) % 7 < 5 or n == cur]
    return [date.fromordinal(n) for n in ords[:limit]]


def scheduled_between(
    rule: RepeatRule,
    current: DateLike,
    start: date,
    end: date,
    tz: tzinfo,
    week_start: WeekStart = "monday",
    limit: int = 10_000,
    newest: bool = False,
) -> list[DateLike]:
    """Every scheduled date whose local day is in [start, end], oldest first.

    The schedule runs through `current` (included when in range): forward by
    `step` (so it matches successive completions and `occurrences`) and
    backward by the rule's pattern (an `on` rule's matching dates; a plain
    rule's interval counted back from `current`, month and year steps
    clamped, our choice). `until` ends the schedule; the rule's mode is not
    consulted (the caller decides whether a completion-mode rule has a
    schedule). At most the oldest `limit` dates, or the newest with `newest`
    (the catch-up log's cap; for a fixed-interval rule only the tail of the
    range is walked).
    """
    if end < start or limit <= 0:
        return []
    if newest:
        window = _newest_window(rule, end, limit)
        if window is not None and window > start:
            start = window
        return scheduled_between(rule, current, start, end, tz, week_start, _MAX_STEPS)[-limit:]
    cur_day = _local_day(current, tz)
    before: list[DateLike] = []
    if cur_day > start:
        d_day, k = cur_day, 0
        if cur_day > end:
            # Skip the dates after the range: a fixed-interval rule counts the steps,
            # a weekday rule walks back from the day after `end` (audit 2026-11-01 B8).
            interval = _plain_interval_days(rule)
            if interval is not None:
                k = max(0, -((end - cur_day).days // interval) - 1)  # ceil(gap / interval) - 1
            elif rule.on is None and rule.unit == "weekday":
                d_day = end + timedelta(days=1)
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
        d: DateLike = _jump_to_before(rule, current, start, tz, week_start)
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
