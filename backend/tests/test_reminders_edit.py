"""Editing a task just after its reminder time keeps the reminder (audit 2026-10-28 #17).

The scheduler checks every 30 s. A body edit between the trigger and the next
check bumps ``lastUpdated`` past the trigger, and ``due()`` used to read that as
"set in the past", so the reminder never fired. A reminder the running scheduler
already saw pending is due whatever ``lastUpdated`` says; one first seen after its
trigger (set in the past) still never fires.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from objectapp.reminders import Ledger, ReminderScheduler
from objectapp.space import Space

DENTIST = "Tasks/Call dentist.md"
TRIGGER = datetime(2026, 10, 23, 8, 15, tzinfo=UTC)  # 15 minutes before 08:30


class FakeNotifier:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send(self, title: str, body: str) -> None:
        self.sent.append((title, body))


def _setup(root: Path, tmp_path: Path):
    space = Space(root)
    space.tz = UTC
    clock = [TRIGGER - timedelta(seconds=20)]
    space.clock = lambda: clock[0]
    notifier = FakeNotifier()
    scheduler = ReminderScheduler(space, notifier, ledger=Ledger(tmp_path / "ledger.json"))
    return space, clock, notifier, scheduler


def test_body_edit_after_trigger_keeps_the_reminder(calendar_space_dir: Path, tmp_path: Path):
    space, clock, notifier, scheduler = _setup(calendar_space_dir, tmp_path)
    scheduler.tick(clock[0])
    clock[0] = TRIGGER + timedelta(seconds=5)
    _, _fm, version = space.read(DENTIST)
    space.save_body(DENTIST, "\nnotes while waiting\n", version)
    assert space.read(DENTIST)[1]["lastUpdated"] > TRIGGER.strftime("%Y-%m-%dT%H:%M:%S")
    clock[0] = TRIGGER + timedelta(seconds=10)
    fired = scheduler.tick(clock[0])
    assert [d.path for d in fired] == [DENTIST]
    assert ("Call dentist", "Due today") in notifier.sent


def test_reminder_set_in_the_past_still_never_fires(calendar_space_dir: Path, tmp_path: Path):
    space, clock, notifier, scheduler = _setup(calendar_space_dir, tmp_path)
    # The scheduler first sees the task after its trigger, and lastUpdated says it
    # was set then: it was in the past when set.
    text = (calendar_space_dir / DENTIST).read_text(encoding="utf-8")
    text = text.replace("lastUpdated: 2026-10-19T12:00:00.000Z", "lastUpdated: 2026-10-23T08:15:05.000Z")
    (calendar_space_dir / DENTIST).write_bytes(text.encode("utf-8"))
    space = Space(calendar_space_dir)
    space.tz = UTC
    scheduler.space = space
    fired = scheduler.tick(TRIGGER + timedelta(seconds=10))
    assert DENTIST not in [d.path for d in fired]
