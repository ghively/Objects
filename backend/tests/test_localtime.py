"""Local time zones (M4 Task 2)."""

import os
import time
from datetime import UTC, datetime, timedelta, timezone

import pytest

from objectapp.localtime import SystemTz, from_local, to_local

H1, H2 = timedelta(hours=1), timedelta(hours=2)


def fake_dst_rule(naive: datetime, fold: int) -> timedelta:
    """+02:00 from April through September, else +01:00 (no gaps tested)."""
    return H2 if 4 <= naive.month <= 9 else H1


def berlin():
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo("Europe/Berlin")
    except Exception:
        pytest.skip("tzdata for Europe/Berlin is not installed (zoneinfo cannot load it)")


def test_system_tz_delegates_per_instant():
    tz = SystemTz(offset_at=fake_dst_rule)
    jan = to_local(datetime(2026, 1, 15, 23, 30, tzinfo=UTC), tz)
    jul = to_local(datetime(2026, 7, 15, 22, 30, tzinfo=UTC), tz)
    assert jan.utcoffset() == H1 and jan.replace(tzinfo=None) == datetime(2026, 1, 16, 0, 30)
    assert jul.utcoffset() == H2 and jul.replace(tzinfo=None) == datetime(2026, 7, 16, 0, 30)
    assert jan.tzinfo is tz and jul.tzinfo is tz
    assert from_local(datetime(2026, 1, 16, 0, 30), tz) == datetime(2026, 1, 15, 23, 30, tzinfo=UTC)
    assert from_local(datetime(2026, 7, 16, 0, 30), tz) == datetime(2026, 7, 15, 22, 30, tzinfo=UTC)
    assert tz.dst(datetime(2026, 7, 1, tzinfo=tz)) == H1
    assert tz.dst(datetime(2026, 1, 1, tzinfo=tz)) == timedelta(0)


def test_system_tz_default_matches_os_offset():
    tz = SystemTz()
    for instant in (datetime(2026, 1, 15, 12, tzinfo=UTC), datetime(2026, 7, 15, 12, tzinfo=UTC)):
        expected = instant.astimezone()  # the OS's own reading of the instant
        local = to_local(instant, tz)
        assert local.utcoffset() == expected.utcoffset()
        assert local.replace(tzinfo=None) == expected.replace(tzinfo=None)
        assert from_local(local.replace(tzinfo=None), tz) == instant


def test_system_tz_real_os_dst():
    if not hasattr(time, "tzset"):
        pytest.skip("time.tzset does not exist on this OS (Windows); covered by the fake-rule test")
    old = os.environ.get("TZ")
    os.environ["TZ"] = "Europe/Berlin"
    time.tzset()
    try:
        if time.tzname[0] in ("UTC", "Europe") or time.timezone == 0:
            pytest.skip("the OS zone database lacks Europe/Berlin")
        tz = SystemTz()
        jan = to_local(datetime(2026, 1, 15, 12, tzinfo=UTC), tz)
        jul = to_local(datetime(2026, 7, 15, 12, tzinfo=UTC), tz)
        assert jan.utcoffset() == H1
        assert jul.utcoffset() == H2
        assert from_local(datetime(2026, 7, 15, 14), tz) == datetime(2026, 7, 15, 12, tzinfo=UTC)
    finally:
        if old is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = old
        time.tzset()


def test_from_local_gap_shifts_forward():
    tz = berlin()
    got = from_local(datetime(2026, 3, 29, 2, 30), tz)
    assert got == datetime(2026, 3, 29, 1, 30, tzinfo=UTC)
    assert to_local(got, tz).replace(tzinfo=None) == datetime(2026, 3, 29, 3, 30)


def test_from_local_ambiguous_takes_first():
    tz = berlin()
    got = from_local(datetime(2026, 10, 25, 2, 30), tz)
    assert got == datetime(2026, 10, 25, 0, 30, tzinfo=UTC)


def test_fixed_offset_zone_accepted():
    tz = timezone(H2)
    assert from_local(datetime(2026, 10, 24, 0, 30), tz) == datetime(2026, 10, 23, 22, 30, tzinfo=UTC)
    assert to_local(datetime(2026, 10, 23, 22, 30, tzinfo=UTC), tz).day == 24


def test_system_tz_gap_and_fold_with_fake_rule():
    """A fake rule with a spring gap and an autumn overlap behaves like zoneinfo."""

    def rule(naive: datetime, fold: int) -> timedelta:
        spring = datetime(2026, 3, 29, 2)  # 02:00 -> 03:00
        autumn = datetime(2026, 10, 25, 2)  # 03:00 -> 02:00
        if naive < spring:
            return H1
        if naive < spring + H1:  # in the gap: fold=0 uses the offset before
            return H1 if fold == 0 else H2
        if naive < autumn:
            return H2
        if naive < autumn + H1:  # ambiguous: fold=0 is the first (summer) reading
            return H2 if fold == 0 else H1
        return H1

    tz = SystemTz(offset_at=rule)
    assert from_local(datetime(2026, 3, 29, 2, 30), tz) == datetime(2026, 3, 29, 1, 30, tzinfo=UTC)
    assert from_local(datetime(2026, 10, 25, 2, 30), tz) == datetime(2026, 10, 25, 0, 30, tzinfo=UTC)
    first = to_local(datetime(2026, 10, 25, 0, 30, tzinfo=UTC), tz)
    second = to_local(datetime(2026, 10, 25, 1, 30, tzinfo=UTC), tz)
    assert first.replace(tzinfo=None) == second.replace(tzinfo=None) == datetime(2026, 10, 25, 2, 30)
    assert (first.fold, second.fold) == (0, 1)
    assert first.utcoffset() == H2 and second.utcoffset() == H1
