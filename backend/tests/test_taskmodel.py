"""The Task `repeat` and `remind` text forms (M4 Task 2).

The vectors are the shared table from the M4 plan's Global Constraints,
copied row for row (the frontend's Task 8 tests use the same table).
"""

import pytest

from objectapp.taskmodel import (
    ReminderRule,
    RepeatRule,
    format_remind,
    format_repeat,
    parse_remind,
    parse_repeat,
)

REPEAT_VALID = [
    ("every day", {"every": 1, "unit": "day", "mode": "dueDate"}, "every day"),
    ("Every  2 Weeks", {"every": 2, "unit": "week", "mode": "dueDate"}, "every 2 weeks"),
    ("every weekday", {"every": 1, "unit": "weekday", "mode": "dueDate"}, "every weekday"),
    (
        "every month after completion",
        {"every": 1, "unit": "month", "mode": "completionDate"},
        "every month after completion",
    ),
    (
        "every 3 months until 2027-06-30",
        {"every": 3, "unit": "month", "mode": "dueDate", "until": "2027-06-30"},
        "every 3 months until 2027-06-30",
    ),
]

REPEAT_INVALID = [
    "every 0 days",
    "every -1 week",
    "weekly",
    "every 2 fortnights",
    "every 2 weekdays",
    "every weekday after completion",
    "every day until 2027-13-01",
]

# (text, resolution, parsed, canonical)
REMIND_VALID = [
    ("at time", "time", {"minutesBefore": 0, "daysBefore": 0}, "at time"),
    ("15 minutes before", "time", {"minutesBefore": 15, "daysBefore": 0}, "15 minutes before"),
    ("1 hour before", "time", {"minutesBefore": 60, "daysBefore": 0}, "1 hour before"),
    (
        "on the day at 09:00",
        "day",
        {"minutesBefore": 0, "daysBefore": 0, "timeOfDay": "09:00"},
        "on the day at 09:00",
    ),
    (
        "1 day before at 18:30",
        "day",
        {"minutesBefore": 0, "daysBefore": 1, "timeOfDay": "18:30"},
        "1 day before at 18:30",
    ),
    (
        "3 days before at 08:00",
        "day",
        {"minutesBefore": 0, "daysBefore": 3, "timeOfDay": "08:00"},
        "3 days before at 08:00",
    ),
]

REMIND_INVALID = [
    "on the day",
    "2 days before",
    "at 9:00",
    "15 minutes before at 09:00",
    "0 minutes before",
    "on the day at 25:00",
]


@pytest.mark.parametrize(("text", "parsed", "canonical"), REPEAT_VALID)
def test_parse_repeat_vectors(text, parsed, canonical):
    rule = parse_repeat(text)
    assert rule is not None
    assert rule.to_dict() == parsed
    assert rule == parsed
    assert format_repeat(rule) == canonical
    assert parse_repeat(format_repeat(rule)) == rule


@pytest.mark.parametrize("text", REPEAT_INVALID)
def test_parse_repeat_invalid(text):
    assert parse_repeat(text) is None


def test_parse_repeat_never_raises():
    for value in (None, 3, "", "   ", "every", "every 99999999999999999999 days", ["every day"]):
        assert parse_repeat(value) is None or isinstance(parse_repeat(value), RepeatRule)
    assert parse_repeat(None) is None
    assert parse_repeat("") is None


def test_format_repeat_round_trip_canonical():
    assert format_repeat(parse_repeat("Every  2 Weeks")) == "every 2 weeks"
    assert format_repeat(parse_repeat("EVERY 3 days after   completion")) == "every 3 days after completion"
    assert format_repeat(RepeatRule(every=1, unit="year")) == "every year"


@pytest.mark.parametrize(("text", "resolution", "parsed", "canonical"), REMIND_VALID)
def test_parse_remind_vectors(text, resolution, parsed, canonical):
    rule = parse_remind(text, resolution)
    assert rule is not None
    assert rule.to_dict() == parsed
    assert format_remind(rule, resolution) == canonical
    assert parse_remind(format_remind(rule, resolution), resolution) == rule


@pytest.mark.parametrize("text", REMIND_INVALID)
def test_parse_remind_invalid(text):
    assert parse_remind(text, "time") is None
    assert parse_remind(text, "day") is None


def test_remind_resolution_mismatch_is_none():
    assert parse_remind("on the day at 09:00", "time") is None
    assert parse_remind("15 minutes before", "day") is None
    assert parse_remind("at time", "day") is None


def test_remind_canonical_minutes_and_hours():
    assert format_remind(ReminderRule(minutesBefore=60), "time") == "1 hour before"
    assert format_remind(ReminderRule(minutesBefore=120), "time") == "2 hours before"
    assert format_remind(ReminderRule(minutesBefore=90), "time") == "90 minutes before"
    assert format_remind(ReminderRule(minutesBefore=45), "time") == "45 minutes before"
    assert parse_remind("2 hours before", "time") == {"minutesBefore": 120, "daysBefore": 0}
    assert parse_remind("60 minutes before", "time") == {"minutesBefore": 60, "daysBefore": 0}
    assert parse_remind("  15   Minutes  BEFORE ", "time") == {"minutesBefore": 15, "daysBefore": 0}


def test_parse_remind_never_raises():
    for value in (None, 7, "", "at", "99999999999999999999 days before at 09:00"):
        parse_remind(value, "day")
        parse_remind(value, "time")
    assert parse_remind("at time", "week") is None  # type: ignore[arg-type]
