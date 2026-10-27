"""The occurrence log text (M8 Task 11): parse, format and append."""

from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

from objectapp.frontmatter import parse_fm, set_keys
from objectapp.space import Space
from objectapp.tasklog import (
    LOG_KEY,
    LogEntry,
    append_entries,
    entry_day,
    format_entry,
    log_value,
    parse_entry,
    parse_log,
)

NOW = datetime(2026, 10, 27, 10, 0, 0, 456000, tzinfo=UTC)

LOG = (
    "2026-10-24 completed 2026-10-24T07:55:10Z\n"
    "2026-10-25 skipped 2026-10-26T06:30:00Z\n"
    "2026-10-26 excused 2026-10-26T06:30:04Z"
)


def test_parse_and_format_round_trip():
    entries = parse_log(LOG)
    assert entries == [
        LogEntry("2026-10-24", "completed", "2026-10-24T07:55:10Z"),
        LogEntry("2026-10-25", "skipped", "2026-10-26T06:30:00Z"),
        LogEntry("2026-10-26", "excused", "2026-10-26T06:30:04Z"),
    ]
    assert "\n".join(format_entry(e.scheduled, e.action, e.at) for e in entries) == LOG
    # Dates and instants format as the log writes them (UTC, whole seconds).
    from datetime import date

    assert format_entry(date(2026, 10, 27), "completed", NOW) == (
        "2026-10-27 completed 2026-10-27T10:00:00Z"
    )
    instant = datetime(2026, 10, 27, 13, 30, tzinfo=timezone(timedelta(hours=2)))
    line = format_entry(instant, "skipped", NOW)
    assert line == "2026-10-27T11:30:00Z skipped 2026-10-27T10:00:00Z"
    e = parse_entry(line)
    assert e is not None and e.scheduled == "2026-10-27T11:30:00Z"
    assert e.to_api() == {
        "scheduled": {"start": "2026-10-27T11:30:00Z", "resolution": "time"},
        "action": "skipped",
        "at": "2026-10-27T10:00:00Z",
    }
    # A time-resolution entry's day is its local day.
    assert entry_day("2026-10-27T23:30:00Z", timezone(timedelta(hours=2))).isoformat() == "2026-10-28"
    # Case and spacing on read: surrounding whitespace is forgiven.
    assert parse_entry("  2026-10-24   completed  2026-10-24T07:55:10Z  ") is not None


def test_garbage_line_kept_and_ignored():
    raw = "2026-10-25 completed 2026-10-25T09:00:00Z\nnot a log line at all\n2026-10-26 completed 2026-10-26T09:00:00Z"
    assert [e.scheduled for e in parse_log(raw)] == ["2026-10-25", "2026-10-26"]
    for bad in (
        "2026-13-01 completed 2026-10-25T09:00:00Z",  # no month 13
        "2026-10-25 finished 2026-10-25T09:00:00Z",  # unknown action
        "2026-10-25 completed",  # no instant
        "2026-10-25 completed 2026-10-25T09:00:00",  # instant not UTC
    ):
        assert parse_entry(bad) is None
    out = append_entries(raw, ["2026-10-27 completed 2026-10-27T10:00:00Z"])
    assert out.split("\n") == [*raw.split("\n"), "2026-10-27 completed 2026-10-27T10:00:00Z"]
    assert parse_log(None) == [] and append_entries(None, ["x"]) == "x"


def test_append_changes_only_the_block():
    src = (
        "title: Water plants\n"
        "repeat: every day\n"
        "occurrenceLog: |-\n"
        "  2026-10-24 completed 2026-10-24T07:55:10Z\n"
        "  not a log line\n"
        "status: Not Started\n"
    )
    fm = parse_fm(src)
    line = "2026-10-27 completed 2026-10-27T10:00:00Z"
    out = set_keys(src, {LOG_KEY: log_value(fm[LOG_KEY], [line])})
    before, after = src.splitlines(keepends=True), out.splitlines(keepends=True)
    assert after == [*before[:5], f"  {line}\n", *before[5:]]  # one line inserted, no other change
    assert parse_fm(out)[LOG_KEY].split("\n")[-1] == line

    # A task without a log gains the block at the end of its frontmatter.
    src2 = "title: Weekly review\nrepeat: every week\n"
    out2 = set_keys(src2, {LOG_KEY: log_value(None, [line])})
    assert out2 == src2 + f"occurrenceLog: |-\n  {line}\n"


def test_crlf_log_keeps_crlf(m8_space_dir: Path):
    rel = "Tasks/Crlf habit.md"
    text = (
        "﻿---\r\n"
        "id: 01JC8M8000000000000000CRLF\r\n"
        "type: 'Task'\r\n"
        "title: Crlf habit\r\n"
        "createdAt: 2026-10-01T08:00:00.000Z\r\n"
        "lastUpdated: 2026-10-01T08:00:00.000Z\r\n"
        "status: Not Started\r\n"
        "date: 2026-10-27\r\n"
        "repeat: every day\r\n"
        "occurrenceLog: |-\r\n"
        "  2026-10-26 completed 2026-10-26T09:00:00Z\r\n"
        "---\r\n"
        "\r\n"
        "Windows line endings and a BOM.\r\n"
    )
    (m8_space_dir / rel).write_bytes(text.encode("utf-8"))
    space = Space(m8_space_dir)
    space.clock = lambda: NOW
    space.tz = UTC
    _of, _fm, version = space.read(rel)
    space.update_properties(rel, {"status": ["Done"]}, version)
    raw = (m8_space_dir / rel).read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf")
    assert raw.count(b"\n") == raw.count(b"\r\n")
    assert (
        b"occurrenceLog: |-\r\n"
        b"  2026-10-26 completed 2026-10-26T09:00:00Z\r\n"
        b"  2026-10-27 completed 2026-10-27T10:00:00Z\r\n"
    ) in raw
