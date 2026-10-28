"""M4 Task 6: the server's test hooks (clock file, fake notifier, tick route) and the scheduler's lifespan."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.notify import FileNotifier, SystemNotifier
from objectapp.reminders import ReminderScheduler, ledger_path_for
from objectapp.server import create_app
from objectapp.space import Space

PLUS2 = timezone(timedelta(hours=2))


def test_hooks_ignored_unless_set(calendar_space_dir: Path):
    space = Space(calendar_space_dir)
    app = create_app(space, watch=False)
    scheduler = app.state.reminders
    assert isinstance(scheduler, ReminderScheduler)
    assert isinstance(scheduler.notifier, SystemNotifier)
    assert abs(space.clock() - datetime.now(UTC)) < timedelta(seconds=5)
    client = TestClient(app)
    assert client.post("/api/_test/tick").status_code in (404, 405)


def test_clock_file_is_reread_each_call(calendar_space_dir: Path, tmp_path: Path, monkeypatch):
    clock_file = tmp_path / "clock.txt"
    fake = tmp_path / "notified.jsonl"
    clock_file.write_text("2026-10-23T08:00:00.000Z", encoding="utf-8")
    monkeypatch.setenv("OBJECT_CLOCK_FILE", str(clock_file))
    monkeypatch.setenv("OBJECT_FAKE_NOTIFY_FILE", str(fake))
    space = Space(calendar_space_dir)
    space.tz = PLUS2
    app = create_app(space, watch=False)
    assert space.clock() == datetime(2026, 10, 23, 8, 0, tzinfo=UTC)
    clock_file.write_text("2026-10-23T08:15:30Z\n", encoding="utf-8")
    assert space.clock() == datetime(2026, 10, 23, 8, 15, 30, tzinfo=UTC)
    assert isinstance(app.state.reminders.notifier, FileNotifier)
    client = TestClient(app)
    res = client.post("/api/_test/tick")
    assert res.status_code == 200
    assert [f["path"] for f in res.json()["fired"]] == ["Tasks/Call dentist.md"]
    lines = [json.loads(x) for x in fake.read_text(encoding="utf-8").splitlines()]
    assert lines == [{"title": "Call dentist", "body": "Due today"}]
    assert client.post("/api/_test/tick").json()["fired"] == []  # once only
    assert len(fake.read_text(encoding="utf-8").splitlines()) == 1


def test_scheduler_runs_for_app_lifespan(calendar_space_dir: Path):
    for watch in (False, True):
        space = Space(calendar_space_dir)
        app = create_app(space, watch=watch)
        with TestClient(app):
            assert app.state.reminders.running
        assert not app.state.reminders.running
        assert ledger_path_for(calendar_space_dir).exists()  # lastRunning recorded on stop
        ledger_path_for(calendar_space_dir).unlink()
