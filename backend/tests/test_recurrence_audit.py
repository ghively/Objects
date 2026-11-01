"""Audit 2026-11-01 B8: fixed-interval rules jump arithmetically instead of stepping day by
day from an old task's date. The results must equal the stepped ones, so every case here
is checked against `recurrence` with the jump disabled.
"""

from __future__ import annotations

import itertools
import time
from datetime import UTC, date, datetime, timedelta, timezone

import pytest
from objectapp import recurrence
from objectapp.recurrence import next_date, occurrences, scheduled_between
from objectapp.taskmodel import parse_repeat

UTC2 = timezone(timedelta(hours=2))
TODAY = date(2026, 10, 27)
NOW = datetime(2026, 10, 27, 10, tzinfo=UTC)

RULES = [
    "every day", "every 3 days", "every week", "every 2 weeks", "every weekday",
    "every month", "every 2 months", "every year", "every day until 2026-10-20",
    "every 3 days until 2026-10-29", "every weekday until 2026-10-23",
    "every week on mon, fri", "every month on the 31st",
]
CURRENTS = [
    date(2026, 10, 27), date(2026, 10, 24), date(2026, 10, 1), date(2026, 1, 31), date(2025, 2, 28),
    date(2021, 3, 14), date(2020, 2, 29), datetime(2026, 10, 3, 7, 30, tzinfo=UTC),
    datetime(2021, 6, 1, 22, 15, tzinfo=UTC),
]
RANGES = [
    (date(2026, 10, 1), date(2026, 10, 31)), (date(2026, 10, 27), date(2026, 11, 30)),
    (date(2026, 11, 1), date(2026, 11, 30)), (date(2027, 2, 1), date(2027, 3, 1)),
    (date(2026, 10, 30), date(2026, 10, 30)), (date(2026, 10, 20), date(2026, 10, 19)),
    (date(2026, 9, 1), date(2026, 9, 30)), (date(2021, 1, 1), date(2021, 1, 31)),
    (date(2026, 10, 24), date(2026, 10, 26)),
]


@pytest.fixture
def stepped(monkeypatch: pytest.MonkeyPatch):
    """The old behaviour: no jump, every occurrence stepped."""
    monkeypatch.setattr(recurrence, "_jump_to_before", lambda rule, current, *_a: current)


def _cases():
    for text, current, (start, end) in itertools.product(RULES, CURRENTS, RANGES):
        yield parse_repeat(text), current, start, end


def _run(rule, current, start, end, tz):
    return (
        occurrences(rule, current, start, end, tz),
        scheduled_between(rule, current, start, end, tz),
        scheduled_between(rule, current, start, end, tz, limit=3),
        scheduled_between(rule, current, start, end, tz, limit=3, newest=True),
        next_date(rule, current, NOW, TODAY, tz),
        next_date(rule, current, NOW, start, tz),
    )


@pytest.mark.parametrize("tz", [UTC, UTC2])
def test_jump_matches_stepping(tz, stepped, monkeypatch: pytest.MonkeyPatch):
    expected = [_run(*case, tz) for case in _cases()]
    monkeypatch.undo()  # the jump back on
    got = [_run(*case, tz) for case in _cases()]
    for case, want, have in zip(_cases(), expected, got, strict=True):
        assert have == want, case


def test_newest_is_the_tail_of_the_schedule():
    daily = parse_repeat("every day")
    full = scheduled_between(daily, date(2026, 1, 1), date(2026, 1, 1), TODAY - timedelta(days=1), UTC)
    newest = scheduled_between(
        daily, date(2026, 1, 1), date(2026, 1, 1), TODAY - timedelta(days=1), UTC, limit=99, newest=True
    )
    assert newest == full[-99:]
    assert newest[-1] == date(2026, 10, 26) and len(newest) == 99
    weekday = parse_repeat("every weekday")
    full = scheduled_between(weekday, date(2000, 1, 3), date(2000, 1, 3), TODAY, UTC, limit=100_000)
    assert scheduled_between(weekday, date(2000, 1, 3), date(2000, 1, 3), TODAY, UTC, limit=10, newest=True) == full[-10:]
    # Fewer dates than the cap: all of them, as without `newest`.
    short = scheduled_between(daily, date(2026, 10, 20), date(2026, 10, 20), date(2026, 10, 26), UTC)
    assert scheduled_between(daily, date(2026, 10, 20), date(2026, 10, 20), date(2026, 10, 26), UTC, limit=99, newest=True) == short
    # A rule with no fixed pattern walks the whole range and keeps the tail.
    monthly = parse_repeat("every month on the 31st")
    full = scheduled_between(monthly, date(2020, 1, 31), date(2020, 1, 1), TODAY, UTC)
    assert scheduled_between(monthly, date(2020, 1, 31), date(2020, 1, 1), TODAY, UTC, limit=4, newest=True) == full[-4:]


def test_far_dates_are_fast_and_right():
    daily = parse_repeat("every day")
    t0 = time.perf_counter()
    got = occurrences(daily, date(1800, 1, 1), date(2300, 11, 1), date(2300, 11, 3), UTC)
    assert got == [date(2300, 11, 1), date(2300, 11, 2), date(2300, 11, 3)]
    assert next_date(daily, date(1800, 1, 1), NOW, TODAY, UTC) == TODAY
    assert next_date(daily, date(1800, 1, 1), NOW, date(9999, 12, 31), UTC) == date(9999, 12, 31)
    timed = datetime(1800, 1, 1, 9, tzinfo=UTC)
    assert occurrences(daily, timed, date(2026, 11, 1), date(2026, 11, 2), UTC) == [
        datetime(2026, 11, 1, 9, tzinfo=UTC), datetime(2026, 11, 2, 9, tzinfo=UTC),
    ]
    weekday = parse_repeat("every weekday")
    assert occurrences(weekday, date(2000, 1, 3), date(2026, 10, 31), date(2026, 11, 3), UTC) == [
        date(2026, 11, 2), date(2026, 11, 3),
    ]
    three = parse_repeat("every 3 days")
    assert occurrences(three, date(1800, 1, 1), date(2026, 11, 1), date(2026, 11, 9), UTC) == [
        d for d in (date(2026, 11, 1) + timedelta(days=i) for i in range(9)) if (d - date(1800, 1, 1)).days % 3 == 0
    ]
    assert scheduled_between(daily, date(1800, 1, 1), date(1800, 1, 1), TODAY, UTC, limit=5, newest=True) == [
        TODAY - timedelta(days=i) for i in range(4, -1, -1)
    ]
    # Backward from a far-future date to a range long before it (`task_stats` on a task
    # dated 9999-12-31 walked 100,000 days back).
    far = date(9999, 12, 31)
    assert scheduled_between(daily, far, date(2026, 10, 1), date(2026, 10, 3), UTC) == [
        date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 3),
    ]
    assert scheduled_between(three, far, date(2026, 10, 1), date(2026, 10, 9), UTC) == [
        d for d in (date(2026, 10, 1) + timedelta(days=i) for i in range(9)) if (far - d).days % 3 == 0
    ]
    assert scheduled_between(weekday, far, date(2026, 10, 23), date(2026, 10, 27), UTC) == [
        date(2026, 10, 23), date(2026, 10, 26), date(2026, 10, 27),
    ]
    assert time.perf_counter() - t0 < 0.5
