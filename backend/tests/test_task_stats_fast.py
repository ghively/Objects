"""Audit 2026-11-01, second pass: `task_stats` of an old daily task builds days, not dates.

A timed daily task dated 1800 built 82,000 instants (each converted to and from
the local zone) for 26 grid cells: 0.98 s. The history's days now come from the
rule's pattern (`recurrence.scheduled_days`) and only the last cells' instants are
built; every answer must equal the one built from `scheduled_between` alone.
"""

from __future__ import annotations

import random
import time
from datetime import UTC, date, datetime, timedelta, timezone

import pytest
from objectapp import recurrence
from objectapp.api_tasks import task_stats
from objectapp.recurrence import scheduled_between, scheduled_days
from objectapp.tasklog import LogEntry, format_scheduled
from objectapp.taskmodel import parse_repeat

UTC2 = timezone(timedelta(hours=2))
NOW = datetime(2026, 10, 27, 10, tzinfo=UTC)
RULES = [
    "every day", "every 3 days", "every week", "every 2 weeks", "every weekday",
    "every day until 2026-10-20", "every weekday until 2026-09-01", "every 3 days until 2030-01-01",
    "every month", "every week on mon, fri",
]


def _random_case(rng: random.Random):
    rule = parse_repeat(rng.choice(RULES))
    day = date(2026, 10, 27) + timedelta(days=rng.choice([0, 1, -1, -3, -30, -400, -5000, 9, 40, 3000]))
    current: date | datetime = day
    if rng.random() < 0.4:
        current = datetime(day.year, day.month, day.day, rng.randrange(24), 15, tzinfo=UTC)
    entries = []
    for _ in range(rng.choice([0, 0, 1, 3, 12])):
        d = date(2026, 10, 27) + timedelta(days=rng.randrange(-600, 20))
        if rng.random() < 0.3:
            d += timedelta(days=-rng.randrange(6000))
        entries.append(LogEntry(format_scheduled(d), rng.choice(["complete", "skip", "excuse"]), "2026-10-01T00:00:00Z"))
    created = rng.choice([None, date(2026, 10, 1), date(2020, 1, 1), date(2000, 1, 1)])
    return rule, current, entries, created, rng.choice(["monday", "sunday"])


@pytest.mark.parametrize("tz", [UTC, UTC2])
def test_stats_equal_the_stepped_history(tz, monkeypatch: pytest.MonkeyPatch):
    rng = random.Random(1101)
    cases = [_random_case(rng) for _ in range(250)]
    got = [task_stats(rule, cur, e, created, NOW, tz, ws) for rule, cur, e, created, ws in cases]
    monkeypatch.setattr("objectapp.api_tasks.scheduled_days", lambda *a, **k: None)
    for case, have in zip(cases, got, strict=True):
        rule, cur, e, created, ws = case
        assert have == task_stats(rule, cur, e, created, NOW, tz, ws), case


@pytest.mark.parametrize("tz", [UTC, UTC2])
def test_scheduled_days_are_the_schedule_days(tz):
    rng = random.Random(7)
    for _ in range(600):
        rule = parse_repeat(rng.choice(RULES[:8]))
        cur = date(2026, 10, 27) + timedelta(days=rng.randrange(-3000, 3000))
        current = cur if rng.random() < 0.5 else datetime(cur.year, cur.month, cur.day, 23, 30, tzinfo=UTC)
        start = date(2026, 10, 27) + timedelta(days=rng.randrange(-4000, 4000))
        end = start + timedelta(days=rng.choice([-1, 0, 5, 60, 900]))
        days = scheduled_days(rule, current, start, end, tz)
        want = [
            recurrence._local_day(d, tz)
            for d in scheduled_between(rule, current, start, end, tz, limit=100_000)
        ]
        assert days == want, (rule, current, start, end)
    assert scheduled_days(parse_repeat("every month"), date(2026, 1, 1), date(2026, 1, 1), date(2026, 2, 1), tz) is None


def test_stats_of_an_ancient_timed_daily_task_are_fast():
    daily = parse_repeat("every day")
    t0 = time.perf_counter()
    stats = task_stats(daily, datetime(1800, 1, 1, 9, tzinfo=UTC), [], date(2026, 10, 1), NOW, UTC, "monday")
    assert time.perf_counter() - t0 < 0.35
    assert stats["completionRate"] == 0.0
    cells = stats["cells"]
    assert cells[-5]["scheduled"] == "2026-10-27T09:00:00Z" and cells[-5]["state"] == "future"
    assert cells[0]["scheduled"] == "2026-10-02T09:00:00Z"
