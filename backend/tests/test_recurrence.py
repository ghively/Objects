"""Recurrence arithmetic (M4 Task 2)."""

from datetime import UTC, date, datetime, timedelta, timezone

import pytest

from objectapp.recurrence import next_date, occurrences, step
from objectapp.taskmodel import parse_repeat

UTC2 = timezone(timedelta(hours=2))


def berlin():
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo("Europe/Berlin")
    except Exception:  # ZoneInfoNotFoundError, missing tzdata
        pytest.skip("tzdata for Europe/Berlin is not installed (zoneinfo cannot load it)")


def at(day: date, hour: int = 12) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=UTC)


def test_next_by_due_date():
    rule = parse_repeat("every week")
    got = next_date(rule, date(2026, 10, 14), at(date(2026, 10, 23)), date(2026, 10, 23), UTC2)
    assert got == date(2026, 10, 28)


def test_next_by_due_date_on_today_is_kept():
    rule = parse_repeat("every week")
    got = next_date(rule, date(2026, 10, 16), at(date(2026, 10, 23)), date(2026, 10, 23), UTC2)
    assert got == date(2026, 10, 23)


def test_next_by_due_date_future_task_completed_early():
    rule = parse_repeat("every week")
    got = next_date(rule, date(2026, 11, 4), at(date(2026, 10, 23)), date(2026, 10, 23), UTC2)
    assert got == date(2026, 11, 11)


def test_month_end_clamp():
    monthly = parse_repeat("every month")
    yearly = parse_repeat("every year")
    assert step(monthly, date(2026, 1, 31), UTC) == date(2026, 2, 28)
    assert step(monthly, date(2028, 1, 31), UTC) == date(2028, 2, 29)
    assert step(yearly, date(2024, 2, 29), UTC) == date(2025, 2, 28)
    assert step(parse_repeat("every 13 months"), date(2026, 1, 31), UTC) == date(2027, 2, 28)
    got = next_date(monthly, date(2026, 1, 31), at(date(2026, 1, 31)), date(2026, 1, 31), UTC)
    assert got == date(2026, 2, 28)


def test_weekday_skips_weekend():
    rule = parse_repeat("every weekday")
    fri, sat = date(2026, 10, 23), date(2026, 10, 24)
    assert next_date(rule, fri, at(fri), fri, UTC) == date(2026, 10, 26)
    assert next_date(rule, sat, at(sat), sat, UTC) == date(2026, 10, 26)
    assert step(rule, date(2026, 10, 26), UTC) == date(2026, 10, 27)


def test_weekday_missed_lands_on_or_after_today():
    rule = parse_repeat("every weekday")
    # due Monday 10-19, completed on Saturday 10-24: next weekday on/after today is Monday 10-26
    got = next_date(rule, date(2026, 10, 19), at(date(2026, 10, 24)), date(2026, 10, 24), UTC)
    assert got == date(2026, 10, 26)


def test_completion_mode_from_completion_day():
    rule = parse_repeat("every 3 days after completion")
    done = datetime(2026, 10, 23, 10, tzinfo=UTC)
    for current in (date(2026, 10, 1), date(2026, 10, 23), date(2026, 12, 1)):
        assert next_date(rule, current, done, date(2026, 10, 23), UTC2) == date(2026, 10, 26)


def test_completion_mode_uses_local_completion_day():
    rule = parse_repeat("every day after completion")
    done = datetime(2026, 10, 23, 22, 30, tzinfo=UTC)  # the 24th at 00:30 in +02:00
    assert next_date(rule, date(2026, 10, 20), done, date(2026, 10, 24), UTC2) == date(2026, 10, 25)


def test_completion_mode_keeps_time_of_day():
    rule = parse_repeat("every 2 days after completion")
    current = datetime(2026, 10, 20, 6, 30, tzinfo=UTC)  # 08:30 local
    done = datetime(2026, 10, 23, 15, tzinfo=UTC)
    got = next_date(rule, current, done, date(2026, 10, 23), UTC2)
    assert got == datetime(2026, 10, 25, 6, 30, tzinfo=UTC)


def test_until_ends_recurrence():
    rule = parse_repeat("every week until 2026-10-30")
    d = date(2026, 10, 28)
    assert next_date(rule, d, at(d), d, UTC) is None
    inclusive = parse_repeat("every week until 2026-11-04")
    assert next_date(inclusive, d, at(d), d, UTC) == date(2026, 11, 4)


def test_until_applies_to_completion_mode():
    rule = parse_repeat("every 3 days after completion until 2026-10-25")
    done = at(date(2026, 10, 23))
    assert next_date(rule, date(2026, 10, 23), done, date(2026, 10, 23), UTC) is None


def test_time_keeps_local_wall_clock_across_dst():
    tz = berlin()
    rule = parse_repeat("every day")
    current = datetime(2026, 10, 24, 7, 0, tzinfo=UTC)  # 09:00 CEST
    got = next_date(rule, current, current, date(2026, 10, 24), tz)
    assert got == datetime(2026, 10, 25, 8, 0, tzinfo=UTC)  # 09:00 CET
    assert got.astimezone(tz).hour == 9
    assert step(rule, got, tz) == datetime(2026, 10, 26, 8, 0, tzinfo=UTC)


def test_time_resolution_returns_utc_datetime():
    rule = parse_repeat("every week")
    current = datetime(2026, 10, 23, 8, 30, tzinfo=UTC)
    got = next_date(rule, current, current, date(2026, 10, 23), UTC2)
    assert isinstance(got, datetime)
    assert got.utcoffset() == timedelta(0)
    assert got == datetime(2026, 10, 30, 8, 30, tzinfo=UTC)


def test_time_resolution_today_compares_local_day():
    rule = parse_repeat("every day")
    current = datetime(2026, 10, 20, 22, 30, tzinfo=UTC)  # local 10-21 00:30
    got = next_date(rule, current, current, date(2026, 10, 24), UTC2)
    # local days 10-22, 10-23 are before today; 10-24 00:30 local is the first on/after today
    assert got == datetime(2026, 10, 23, 22, 30, tzinfo=UTC)


def test_occurrences_window():
    rule = parse_repeat("every week")
    got = occurrences(rule, date(2026, 10, 14), date(2026, 10, 19), date(2026, 11, 15), UTC)
    assert got == [date(2026, 10, 21), date(2026, 10, 28), date(2026, 11, 4), date(2026, 11, 11)]
    # never the real date itself
    assert occurrences(rule, date(2026, 10, 14), date(2026, 10, 14), date(2026, 10, 14), UTC) == []
    assert occurrences(parse_repeat("every week after completion"), date(2026, 10, 14),
                       date(2026, 10, 1), date(2026, 12, 1), UTC) == []
    capped = occurrences(parse_repeat("every day"), date(2026, 1, 1), date(2026, 1, 1),
                         date(2026, 12, 31), UTC, limit=5)
    assert capped == [date(2026, 1, d) for d in range(2, 7)]


def test_occurrences_stop_at_until():
    rule = parse_repeat("every week until 2026-11-01")
    got = occurrences(rule, date(2026, 10, 14), date(2026, 10, 1), date(2026, 12, 1), UTC)
    assert got == [date(2026, 10, 21), date(2026, 10, 28)]


def test_occurrences_match_successive_completions():
    monthly = parse_repeat("every month")
    start = date(2026, 1, 31)
    series = occurrences(monthly, start, date(2026, 2, 1), date(2026, 4, 30), UTC)
    assert series == [date(2026, 2, 28), date(2026, 3, 28), date(2026, 4, 28)]
    completed, d = [], start
    for _ in range(3):
        d = next_date(monthly, d, at(d), d, UTC)
        completed.append(d)
    assert completed == series

    yearly = parse_repeat("every year")
    leap = date(2024, 2, 29)
    series = occurrences(yearly, leap, date(2025, 1, 1), date(2028, 12, 31), UTC)
    assert series == [date(2025, 2, 28), date(2026, 2, 28), date(2027, 2, 28), date(2028, 2, 28)]
    completed, d = [], leap
    for _ in range(4):
        d = next_date(yearly, d, at(d), d, UTC)
        completed.append(d)
    assert completed == series


def test_out_of_range_step_ends_series_without_raising():
    huge = parse_repeat("every 99999999 days")
    assert next_date(huge, date(2026, 1, 1), at(date(2026, 1, 1)), date(2026, 1, 1), UTC) is None
    assert occurrences(huge, date(2026, 1, 1), date(2026, 1, 1), date(2026, 12, 31), UTC) == []
    end = date(9999, 12, 30)
    assert next_date(parse_repeat("every week"), end, at(end), end, UTC) is None
