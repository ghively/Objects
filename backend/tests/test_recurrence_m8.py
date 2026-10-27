"""Custom recurrence rules (M8 Task 10): the `on` part of `repeat`."""

from datetime import UTC, date, datetime, timedelta, timezone

import pytest

from objectapp.recurrence import next_date, occurrences, scheduled_between, step, week_start_of
from objectapp.taskmodel import RepeatRule, format_repeat, parse_repeat

TODAY = date(2026, 10, 27)  # a Tuesday
UTC2 = timezone(timedelta(hours=2))


def at(day: date, hour: int = 12) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=UTC)


def berlin():
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo("Europe/Berlin")
    except Exception:  # ZoneInfoNotFoundError, missing tzdata
        pytest.skip("tzdata for Europe/Berlin is not installed (zoneinfo cannot load it)")


# The plan's shared test vectors (Global Constraints, "repeat grammar, extended"):
# (text, parsed or None, canonical or None, (current, expected next) or None)
VECTORS = [
    (
        "every week on mon, fri",
        {"every": 1, "unit": "week", "on": {"weekdays": ["mon", "fri"]}},
        "every week on mon, fri",
        (date(2026, 10, 23), date(2026, 10, 30)),
    ),
    (
        "Every 2 Weeks On Friday, Monday",
        {"every": 2, "unit": "week", "on": {"weekdays": ["mon", "fri"]}},
        "every 2 weeks on mon, fri",
        None,
    ),
    (
        "every month on the 31st",
        {"every": 1, "unit": "month", "on": {"monthDay": 31}},
        "every month on the 31st",
        (date(2026, 8, 31), date(2026, 10, 31)),
    ),
    (
        "every month on the last day",
        {"every": 1, "unit": "month", "on": {"monthDay": "last"}},
        "every month on the last day",
        (date(2026, 9, 30), date(2026, 10, 31)),
    ),
    (
        "every month on the 2nd tuesday",
        {"every": 1, "unit": "month", "on": {"weekdayPos": 2, "weekday": "tue"}},
        "every month on the 2nd tuesday",
        (date(2026, 10, 13), date(2026, 11, 10)),
    ),
    (
        "every month on the last friday",
        {"every": 1, "unit": "month", "on": {"weekdayPos": "last", "weekday": "fri"}},
        "every month on the last friday",
        (date(2026, 9, 25), date(2026, 10, 30)),
    ),
    (
        "every year on march 15",
        {"every": 1, "unit": "year", "on": {"month": 3, "monthDay": 15}},
        "every year on march 15",
        (date(2026, 3, 15), date(2027, 3, 15)),
    ),
    (
        "every year on the 2nd tuesday of march",
        {"every": 1, "unit": "year", "on": {"month": 3, "weekdayPos": 2, "weekday": "tue"}},
        "every year on the 2nd tuesday of march",
        (date(2026, 3, 10), date(2027, 3, 9)),
    ),
]

INVALID = [
    "every week on mon after completion",
    "every month on the 5th tuesday",
    "every month on the 32nd",
    "every day on mon",
    "every year on february 30",
    "every week on",
    "every weekday on mon",
    "every month on march 15",
    "every year on the 15th",
    "every week on mon,, fri",
    "every week on funday",
]


@pytest.mark.parametrize(("text", "parsed", "canonical", "nxt"), VECTORS)
def test_custom_rule_vectors(text, parsed, canonical, nxt):
    rule = parse_repeat(text)
    assert rule is not None
    assert rule.to_dict() == {**parsed, "mode": "dueDate"}
    assert format_repeat(rule) == canonical
    assert parse_repeat(format_repeat(rule)) == rule
    if nxt is not None:
        current, expected = nxt
        assert next_date(rule, current, at(TODAY), TODAY, UTC) == expected


@pytest.mark.parametrize("text", INVALID)
def test_custom_rule_invalid(text):
    assert parse_repeat(text) is None


def test_custom_rule_forgives_case_spacing_and_names():
    rule = parse_repeat("  EVERY   month ON the  Last   Friday ")
    assert format_repeat(rule) == "every month on the last friday"
    assert format_repeat(parse_repeat("every week on sunday, wed, Wednesday")) == "every week on wed, sun"
    assert format_repeat(parse_repeat("every year on Mar 15")) == "every year on march 15"
    assert format_repeat(parse_repeat("every year on the last day of february")) == (
        "every year on the last day of february"
    )
    assert format_repeat(parse_repeat("every 3 months on the 22nd until 2027-12-31")) == (
        "every 3 months on the 22nd until 2027-12-31"
    )
    assert hash(rule) == hash(parse_repeat("every month on the last friday"))


def test_month_day_31_skips_short_months():
    rule = parse_repeat("every month on the 31st")
    d, got = date(2026, 1, 31), []
    for _ in range(6):
        d = step(rule, d, UTC)
        got.append(d)
    assert got == [
        date(2026, 3, 31), date(2026, 5, 31), date(2026, 7, 31),
        date(2026, 8, 31), date(2026, 10, 31), date(2026, 12, 31),
    ]
    # every 2 months: periods count from the current month, a short one is skipped, not clamped
    two = parse_repeat("every 2 months on the 31st")
    assert step(two, date(2026, 1, 31), UTC) == date(2026, 3, 31)
    assert step(two, date(2026, 3, 31), UTC) == date(2026, 5, 31)
    assert step(two, date(2026, 7, 31), UTC) == date(2027, 1, 31)  # September and November skipped
    # February 29 only in leap years
    leap = parse_repeat("every year on february 29")
    assert step(leap, date(2024, 2, 29), UTC) == date(2028, 2, 29)
    # a rule that never matches ends instead of looping
    never = parse_repeat("every 12 months on the 31st")
    assert next_date(never, date(2026, 2, 10), at(TODAY), TODAY, UTC) is None
    assert occurrences(never, date(2026, 2, 10), date(2026, 1, 1), date(2030, 1, 1), UTC) == []


def test_last_day_and_last_weekday():
    last = parse_repeat("every month on the last day")
    d, got = date(2026, 1, 31), []
    for _ in range(3):
        d = step(last, d, UTC)
        got.append(d)
    assert got == [date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]
    assert step(last, date(2028, 1, 31), UTC) == date(2028, 2, 29)
    # from mid-month, the same month's last day comes first
    assert step(last, date(2026, 10, 5), UTC) == date(2026, 10, 31)

    last_fri = parse_repeat("every month on the last friday")
    assert step(last_fri, date(2026, 10, 30), UTC) == date(2026, 11, 27)
    assert step(last_fri, date(2026, 10, 1), UTC) == date(2026, 10, 30)

    feb_last = parse_repeat("every year on the last day of february")
    assert step(feb_last, date(2027, 2, 28), UTC) == date(2028, 2, 29)
    assert step(feb_last, date(2028, 2, 29), UTC) == date(2029, 2, 28)
    last_sun_march = parse_repeat("every year on the last sunday of march")
    assert step(last_sun_march, date(2026, 3, 29), UTC) == date(2027, 3, 28)


def test_weekly_on_list_respects_week_start():
    rule = parse_repeat("every 2 weeks on mon, sun")
    # Monday week start: the week of Mon 2026-10-26 holds Mon 26 and Sun Nov 1
    assert step(rule, date(2026, 10, 26), UTC, "monday") == date(2026, 11, 1)
    assert step(rule, date(2026, 11, 1), UTC, "monday") == date(2026, 11, 9)
    # Sunday week start: Sun 2026-10-25 .. Sat 10-31 holds Sun 25 and Mon 26;
    # after Mon 26 the next is two weeks on: Sun Nov 8
    assert step(rule, date(2026, 10, 26), UTC, "sunday") == date(2026, 11, 8)
    assert step(rule, date(2026, 11, 8), UTC, "sunday") == date(2026, 11, 9)
    # next_date and occurrences pass the week start through
    assert next_date(rule, date(2026, 10, 26), at(TODAY), date(2026, 10, 26), UTC, "sunday") == date(2026, 11, 8)
    assert occurrences(rule, date(2026, 10, 26), date(2026, 10, 1), date(2026, 11, 30), UTC,
                       week_start="sunday") == [date(2026, 11, 8), date(2026, 11, 9), date(2026, 11, 22),
                                                date(2026, 11, 23)]
    # a date not on the list moves to the next listed day
    weekly = parse_repeat("every week on mon, fri")
    assert step(weekly, date(2026, 10, 27), UTC) == date(2026, 10, 30)
    assert step(weekly, date(2026, 10, 30), UTC) == date(2026, 11, 2)


def test_week_start_of_reads_ui_json(tmp_path):
    assert week_start_of(tmp_path) == "monday"  # no .capacities at all
    cap = tmp_path / ".capacities"
    cap.mkdir()
    ui = cap / "ui.json"
    ui.write_text('{"calendar": {"weekStart": "sunday"}}', encoding="utf-8")
    before = ui.read_bytes()
    assert week_start_of(tmp_path) == "sunday"
    assert ui.read_bytes() == before
    ui.write_text("not json", encoding="utf-8")
    assert week_start_of(tmp_path) == "monday"
    assert sorted(p.name for p in cap.iterdir()) == ["ui.json"]


def test_until_ends_custom_rules():
    rule = parse_repeat("every month on the last day until 2026-11-30")
    assert next_date(rule, date(2026, 10, 31), at(TODAY), TODAY, UTC) == date(2026, 11, 30)
    assert next_date(rule, date(2026, 11, 30), at(TODAY), TODAY, UTC) is None
    weekly = parse_repeat("every week on mon, fri until 2026-11-02")
    assert occurrences(weekly, date(2026, 10, 23), date(2026, 10, 1), date(2026, 12, 1), UTC) == [
        date(2026, 10, 26), date(2026, 10, 30), date(2026, 11, 2),
    ]
    assert scheduled_between(weekly, date(2026, 10, 30), date(2026, 10, 1), date(2026, 12, 31), UTC)[-1] == (
        date(2026, 11, 2)
    )


def test_time_resolution_keeps_wall_clock_with_on():
    tz = berlin()
    rule = parse_repeat("every month on the last friday")
    current = datetime(2026, 9, 25, 7, 0, tzinfo=UTC)  # Fri 09:00 CEST
    got = next_date(rule, current, current, date(2026, 9, 26), tz)
    assert got == datetime(2026, 10, 30, 8, 0, tzinfo=UTC)  # Fri 09:00 CET (after the DST change)
    assert got.astimezone(tz).hour == 9
    assert got.utcoffset() == timedelta(0)
    # the local day decides the weekday: 23:30 UTC on Thursday is Friday in UTC+2
    weekly = parse_repeat("every week on fri")
    thu_late = datetime(2026, 10, 22, 23, 30, tzinfo=UTC)  # local Fri 10-23 01:30
    assert step(weekly, thu_late, UTC2) == datetime(2026, 10, 29, 23, 30, tzinfo=UTC)


def test_scheduled_between():
    daily = parse_repeat("every day")
    assert scheduled_between(daily, date(2026, 10, 24), date(2026, 10, 24), date(2026, 10, 26), UTC) == [
        date(2026, 10, 24), date(2026, 10, 25), date(2026, 10, 26),
    ]
    # backward and forward around the current date, current included
    weekly = parse_repeat("every week on mon, fri")
    assert scheduled_between(weekly, date(2026, 10, 23), date(2026, 10, 12), date(2026, 11, 3), UTC) == [
        date(2026, 10, 12), date(2026, 10, 16), date(2026, 10, 19), date(2026, 10, 23),
        date(2026, 10, 26), date(2026, 10, 30), date(2026, 11, 2),
    ]
    # a range entirely before or after the current date
    assert scheduled_between(weekly, date(2026, 10, 23), date(2026, 10, 1), date(2026, 10, 7), UTC) == [
        date(2026, 10, 2), date(2026, 10, 5),
    ]
    assert scheduled_between(weekly, date(2026, 10, 23), date(2026, 11, 5), date(2026, 11, 10), UTC) == [
        date(2026, 11, 6), date(2026, 11, 9),
    ]
    # forward part equals successive steps (M4's month clamp drift), backward counts from current
    monthly = parse_repeat("every month")
    assert scheduled_between(monthly, date(2026, 1, 31), date(2025, 11, 1), date(2026, 3, 31), UTC) == [
        date(2025, 11, 30), date(2025, 12, 31), date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 28),
    ]
    weekdays = parse_repeat("every weekday")
    assert scheduled_between(weekdays, date(2026, 10, 27), date(2026, 10, 23), date(2026, 10, 27), UTC) == [
        date(2026, 10, 23), date(2026, 10, 26), date(2026, 10, 27),
    ]
    # time-resolution dates keep their wall clock both ways
    current = datetime(2026, 10, 27, 7, 0, tzinfo=UTC)
    assert scheduled_between(daily, current, date(2026, 10, 26), date(2026, 10, 28), UTC) == [
        datetime(2026, 10, 26, 7, 0, tzinfo=UTC), current, datetime(2026, 10, 28, 7, 0, tzinfo=UTC),
    ]
    # limit keeps the oldest; an empty range is empty
    assert scheduled_between(daily, date(2026, 10, 27), date(2026, 10, 1), date(2026, 10, 31), UTC, limit=2) == [
        date(2026, 10, 1), date(2026, 10, 2),
    ]
    assert scheduled_between(daily, date(2026, 10, 27), date(2026, 10, 5), date(2026, 10, 1), UTC) == []
    # the Water plants case: date 2026-10-24, today the 27th, missed = scheduled up to yesterday
    assert len(scheduled_between(daily, date(2026, 10, 24), date(2026, 10, 24), TODAY - timedelta(days=1),
                                 UTC)) == 3


# M4's vectors (test_taskmodel.py / test_recurrence.py), repeated as a regression guard
M4_REPEAT = [
    ("every day", {"every": 1, "unit": "day", "mode": "dueDate"}, "every day"),
    ("Every  2 Weeks", {"every": 2, "unit": "week", "mode": "dueDate"}, "every 2 weeks"),
    ("every weekday", {"every": 1, "unit": "weekday", "mode": "dueDate"}, "every weekday"),
    ("every month after completion", {"every": 1, "unit": "month", "mode": "completionDate"},
     "every month after completion"),
    ("every 3 months until 2027-06-30", {"every": 3, "unit": "month", "mode": "dueDate", "until": "2027-06-30"},
     "every 3 months until 2027-06-30"),
]


def test_m4_vectors_unchanged():
    for text, parsed, canonical in M4_REPEAT:
        rule = parse_repeat(text)
        assert rule == parsed
        assert "on" not in rule.to_dict()
        assert format_repeat(rule) == canonical
    for text in ["every 0 days", "weekly", "every 2 fortnights", "every 2 weekdays",
                 "every weekday after completion", "every day until 2027-13-01"]:
        assert parse_repeat(text) is None
    assert RepeatRule(every=1, unit="year") == {"every": 1, "unit": "year", "mode": "dueDate"}
    week = parse_repeat("every week")
    assert next_date(week, date(2026, 10, 14), at(date(2026, 10, 23)), date(2026, 10, 23), UTC2) == date(2026, 10, 28)
    assert step(parse_repeat("every month"), date(2026, 1, 31), UTC) == date(2026, 2, 28)
    assert step(parse_repeat("every 13 months"), date(2026, 1, 31), UTC) == date(2027, 2, 28)
    assert step(parse_repeat("every weekday"), date(2026, 10, 23), UTC) == date(2026, 10, 26)
    done = parse_repeat("every 3 days after completion")
    assert next_date(done, date(2026, 10, 10), at(date(2026, 10, 23)), date(2026, 10, 23), UTC) == date(2026, 10, 26)
