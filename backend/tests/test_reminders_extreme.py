"""Out-of-range reminders and dates never stop the others (audit 2026-10-28 #16).

``remind: 99999999 days before`` or a ``date`` of ``9999-12-31`` used to raise in
`ReminderScheduler.tick`, so no reminder in the space fired, and made
``GET /api/calendar`` answer 500 for every range.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, tzinfo
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.localtime import SystemTz
from objectapp.reminders import Ledger, ReminderScheduler
from objectapp.server import create_app
from objectapp.space import Space

NOW = datetime(2026, 10, 23, 9, 0, 30, tzinfo=UTC)


class FakeNotifier:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send(self, title: str, body: str) -> None:
        self.sent.append((title, body))


def _task(root: Path, name: str, extra: str) -> None:
    text = f"---\ntype: 'Task'\ntitle: {name}\nstatus: Not Started\n{extra}---\n"
    (root / "Tasks" / f"{name}.md").write_bytes(text.encode("utf-8"))


def _write_tasks(root: Path) -> None:
    _task(root, "Good", "date: 2026-10-23\nremind: on the day at 09:00\n")
    _task(root, "Far back", "date: 2026-10-24\nremind: 99999999 days before at 09:00\n")
    _task(root, "Last day", "date: 9999-12-31\nremind: on the day at 09:00\n")
    _task(root, "Last minute", "date: 9999-12-31T23:59:00Z\nremind: 1 minute before\n")
    _task(root, "First day", "date: 0001-01-01\nremind: 1 day before at 09:00\n")


ZONES: list[tzinfo] = [UTC, SystemTz()]


@pytest.mark.parametrize("tz", ZONES, ids=["utc", "system"])
def test_bad_reminder_does_not_stop_the_others(calendar_space_dir: Path, tmp_path: Path, tz: tzinfo):
    root = calendar_space_dir
    _write_tasks(root)
    space = Space(root)
    space.tz = tz
    space.clock = lambda: NOW
    notifier = FakeNotifier()
    scheduler = ReminderScheduler(space, notifier, ledger=Ledger(tmp_path / "ledger.json"))
    local_nine = datetime(2026, 10, 23, 9, 0).replace(tzinfo=tz).astimezone(UTC)
    scheduler.tick(local_nine - timedelta(seconds=30))
    fired = scheduler.tick(local_nine + timedelta(seconds=30))
    assert [d.title for d in fired] == ["Good"]
    assert ("Good", "Due today") in notifier.sent


@pytest.mark.parametrize("tz", ZONES, ids=["utc", "system"])
def test_calendar_survives_extreme_dates(calendar_space_dir: Path, tz: tzinfo):
    root = calendar_space_dir
    _write_tasks(root)
    _task(root, "Every year", "date: 9999-12-31\nrepeat: every year\n")
    _task(root, "Every day", "date: 9999-12-31\nrepeat: every day\nremind: on the day at 23:59\n")
    _task(root, "Ancient", "date: 0001-01-01\nrepeat: every year\n")
    space = Space(root)
    space.tz = tz
    space.clock = lambda: NOW
    client = TestClient(create_app(space, None, watch=False), raise_server_exceptions=False)
    for start, end in [("2026-10-01", "2026-10-31"), ("9999-09-30", "9999-12-31"), ("0001-01-01", "0001-02-01")]:
        res = client.get("/api/calendar", params={"from": start, "to": end})
        assert res.status_code == 200, (start, end, res.text[:300])
    titles = str(client.get("/api/calendar", params={"from": "2026-10-01", "to": "2026-10-31"}).json())
    assert "Good" in titles
