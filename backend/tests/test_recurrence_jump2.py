"""Audit 2026-11-01, second pass: month, year and anchored (`on`) rules jump too.

A Dec 9999 calendar view with old monthly/yearly tasks stepped one month or year at
a time (1.45 s). The jump lands on a date of the stepped series, so every result
must equal stepping's: each case is checked against `recurrence` with the jump off.
"""

from __future__ import annotations

import random
import time
from datetime import UTC, date, datetime, timedelta, timezone

import pytest
from objectapp import recurrence
from objectapp.recurrence import next_date, occurrences, scheduled_between
from objectapp.taskmodel import parse_repeat

UTC2 = timezone(timedelta(hours=2))
NOW = datetime(2026, 10, 27, 10, tzinfo=UTC)

RULES = [
    "every month", "every 2 months", "every 3 months", "every 13 months", "every 48 months",
    "every year", "every 4 years", "every 5 years", "every 400 years", "every month until 2030-05-31",
    "every week on mon, fri", "every 2 weeks on mon, sun", "every 3 weeks on wed",
    "every month on the 31st", "every 2 months on the 31st", "every 12 months on the 31st",
    "every month on the 29th", "every 3 months on the 22nd until 2027-12-31",
    "every month on the last day", "every month on the last friday", "every 5 months on the last friday",
    "every year on february 29", "every 4 years on february 29", "every year on march 15",
    "every year on the last day of february", "every year on the last sunday of march",
    "every 2 years on february 29", "every 48 months on the 29th",
]
ANCHORS = [
    date(2026, 1, 31), date(2024, 2, 29), date(2026, 3, 30), date(2025, 12, 31), date(2026, 10, 27),
    date(1800, 1, 31), date(1896, 2, 29), date(2000, 2, 29), date(2097, 2, 28), date(2026, 8, 15),
]


@pytest.fixture
def stepped(monkeypatch: pytest.MonkeyPatch):
    """The old behaviour: no jump, every occurrence stepped."""
    monkeypatch.setattr(recurrence, "_jump_to_before", lambda rule, current, *_a: current)


def _cases(seed: int, n: int):
    rng = random.Random(seed)
    for _ in range(n):
        rule = parse_repeat(rng.choice(RULES))
        current: date | datetime = rng.choice(ANCHORS) + timedelta(days=rng.choice([0, 0, 0, 1, -1, 17]))
        if rng.random() < 0.3:
            current = datetime(current.year, current.month, current.day, rng.randrange(24), 30, tzinfo=UTC)
        start = current.date() if isinstance(current, datetime) else current
        start += timedelta(days=rng.choice([-400, -40, -1, 0, 1, 30, 400, 3000, 20000, 40000]))
        start = min(max(start, date(1700, 1, 1)), date(9999, 11, 1))
        end = min(start + timedelta(days=rng.choice([0, 6, 30, 99])), date(9999, 12, 31))
        yield rule, current, start, end, rng.choice(["monday", "sunday"])


def _run(rule, current, start, end, ws, tz):
    return (
        occurrences(rule, current, start, end, tz, week_start=ws),
        scheduled_between(rule, current, start, end, tz, ws),
        scheduled_between(rule, current, start, end, tz, ws, limit=3),
        scheduled_between(rule, current, start, end, tz, ws, limit=3, newest=True),
        next_date(rule, current, NOW, start, tz, ws),
        next_date(rule, current, NOW, end, tz, ws),
    )


@pytest.mark.parametrize("tz", [UTC, UTC2])
def test_month_year_and_anchored_jumps_match_stepping(tz, stepped, monkeypatch: pytest.MonkeyPatch):
    cases = list(_cases(20261101, 700))
    expected = [_run(*case, tz) for case in cases]
    monkeypatch.undo()  # the jump back on
    for case, want in zip(cases, expected, strict=True):
        assert _run(*case, tz) == want, case


def test_dec_9999_with_old_monthly_and_yearly_tasks_is_fast():
    t0 = time.perf_counter()
    lo, hi = date(9999, 12, 1), date(9999, 12, 31)
    assert occurrences(parse_repeat("every month on the 31st"), date(2026, 1, 31), lo, hi, UTC) == [
        date(9999, 12, 31)
    ]
    assert occurrences(parse_repeat("every year on february 29"), date(2028, 2, 29), date(9996, 1, 1), hi, UTC) == [
        date(9996, 2, 29)
    ]
    assert occurrences(parse_repeat("every month"), date(2026, 1, 31), lo, hi, UTC) == [date(9999, 12, 28)]
    assert occurrences(parse_repeat("every year"), date(1, 1, 1), lo, hi, UTC) == []
    assert occurrences(parse_repeat("every year"), date(1, 12, 31), lo, hi, UTC) == [date(9999, 12, 31)]
    assert occurrences(parse_repeat("every year"), date(2028, 2, 29), date(9999, 2, 1), hi, UTC) == [
        date(9999, 2, 28)
    ]
    weekly = parse_repeat("every week on mon, fri")
    assert occurrences(weekly, date(1800, 1, 6), lo, date(9999, 12, 6), UTC) == [
        date(9999, 12, 3), date(9999, 12, 6)
    ]
    timed = datetime(1800, 1, 31, 9, tzinfo=UTC)
    assert occurrences(parse_repeat("every month on the last day"), timed, lo, hi, UTC) == [
        datetime(9999, 12, 31, 9, tzinfo=UTC)
    ]
    assert time.perf_counter() - t0 < 0.3
