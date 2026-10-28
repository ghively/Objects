"""M4 Task 6: local reminders, the fired-reminder ledger and the OS notifier."""

from __future__ import annotations

import ast
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

from objectapp import notify, reminders
from objectapp.notify import WINDOWS_TOAST_SCRIPT, SystemNotifier, command_for
from objectapp.reminders import (
    Ledger,
    ReminderScheduler,
    TaskInfo,
    due,
    ledger_path_for,
    trigger_time,
)
from objectapp.space import Space
from objectapp.taskmodel import ReminderRule

PLUS2 = timezone(timedelta(hours=2))
DENTIST = "Tasks/Call dentist.md"  # date 2026-10-23T08:30Z, "15 minutes before"
DENTIST_TRIGGER = datetime(2026, 10, 23, 8, 15, tzinfo=UTC)
WEEKLY = "Tasks/Weekly review.md"  # date 2026-10-14, "1 day before at 09:00", every week
WEEKLY_TRIGGER = datetime(2026, 10, 13, 7, 0, tzinfo=UTC)  # 09:00 at +02:00


class FakeNotifier:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send(self, title: str, body: str) -> None:
        self.sent.append((title, body))


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def _space(root: Path, now: datetime = DENTIST_TRIGGER) -> Space:
    space = Space(root)
    space.clock = Clock(now)
    space.tz = PLUS2
    return space


def _state() -> Path:
    return Path(os.environ["OBJECT_STATE_DIR"])


def _scheduler(space: Space, notifier=None) -> ReminderScheduler:
    return ReminderScheduler(space, notifier or FakeNotifier(), interval=0.05)


def _write(root: Path, rel: str, fm: str, body: str = "") -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"---\n{fm.strip()}\n---\n{body}", encoding="utf-8", newline="\n")


def _tree(root: Path) -> dict[str, str]:
    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            out[p.relative_to(root).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def _set_last_running(space: Space, when: datetime) -> None:
    path = ledger_path_for(space.root)
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"fired": {}}
    data["lastRunning"] = when.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def _titles(notifier: FakeNotifier) -> list[str]:
    return [t for t, _b in notifier.sent]


# -- trigger times ------------------------------------------------------------------


def test_trigger_time_time_and_day_dates(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    infos = {t.path: t for t in reminders.task_infos(space)}
    assert trigger_time(infos[DENTIST], infos[DENTIST].remind, PLUS2) == DENTIST_TRIGGER
    assert trigger_time(infos[WEEKLY], infos[WEEKLY].remind, PLUS2) == WEEKLY_TRIGGER
    # a parsed rule works too, and "at time" is the date itself
    assert trigger_time(infos[DENTIST], ReminderRule(), PLUS2) == datetime(2026, 10, 23, 8, 30, tzinfo=UTC)
    assert trigger_time(infos[WEEKLY], "on the day at 18:30", PLUS2) == datetime(2026, 10, 14, 16, 30, tzinfo=UTC)


def test_done_task_never_fires(calendar_space_dir: Path):
    _write(
        calendar_space_dir,
        "Tasks/Done call.md",
        """
id: 01JBQ4Z7S3N8V2K5D9X6T19001
type: 'Task'
title: Done call
lastUpdated: 2026-10-19T12:00:00.000Z
status: Done
date: 2026-10-23T08:30:00.000Z
remind: 15 minutes before
""",
    )
    space = _space(calendar_space_dir, DENTIST_TRIGGER + timedelta(seconds=10))
    info = next(t for t in reminders.task_infos(space) if t.path == "Tasks/Done call.md")
    assert info.done and trigger_time(info, info.remind, PLUS2) is None
    notifier = FakeNotifier()
    _scheduler(space, notifier).tick()
    assert _titles(notifier) == ["Call dentist"]


def test_invalid_or_mismatched_remind_ignored(calendar_space_dir: Path):
    time_date = TaskInfo("a.md", None, "A", {"start": "2026-10-23T08:30:00.000Z", "resolution": "time"}, False, None, None)
    day_date = TaskInfo("b.md", None, "B", {"start": "2026-10-23", "resolution": "day"}, False, None, None)
    no_date = TaskInfo("c.md", None, "C", None, False, None, None)
    assert trigger_time(time_date, "1 day before at 09:00", PLUS2) is None  # day reminder on a time date
    assert trigger_time(day_date, "15 minutes before", PLUS2) is None  # time reminder on a day date
    assert trigger_time(day_date, ReminderRule(minutesBefore=15), PLUS2) is None
    assert trigger_time(time_date, "soon", PLUS2) is None
    assert trigger_time(no_date, "at time", PLUS2) is None
    _write(
        calendar_space_dir,
        "Tasks/Bad remind.md",
        """
id: 01JBQ4Z7S3N8V2K5D9X6T19002
type: 'Task'
title: Bad remind
lastUpdated: 2026-10-19T12:00:00.000Z
status: Not Started
date: 2026-10-23T08:30:00.000Z
remind: 1 day before at 09:00
""",
    )
    notifier = FakeNotifier()
    _scheduler(_space(calendar_space_dir, DENTIST_TRIGGER + timedelta(minutes=1)), notifier).tick()
    assert _titles(notifier) == ["Call dentist"]


# -- firing once ----------------------------------------------------------------------


def test_fires_once_across_restart(calendar_space_dir: Path):
    notifier = FakeNotifier()
    first = _scheduler(_space(calendar_space_dir, DENTIST_TRIGGER + timedelta(seconds=10)), notifier)
    first.tick()
    first.tick(DENTIST_TRIGGER + timedelta(seconds=40))
    assert notifier.sent == [("Call dentist", "Due today")]
    second = _scheduler(_space(calendar_space_dir, DENTIST_TRIGGER + timedelta(minutes=5)), notifier)
    second.tick()
    assert len(notifier.sent) == 1


def test_catch_up_since_last_running(calendar_space_dir: Path):
    space = _space(calendar_space_dir, DENTIST_TRIGGER + timedelta(hours=1))
    _set_last_running(space, DENTIST_TRIGGER - timedelta(hours=2))
    notifier = FakeNotifier()
    _scheduler(space, notifier).tick()
    assert _titles(notifier) == ["Call dentist"]

    shutil.rmtree(_state())
    space = _space(calendar_space_dir, DENTIST_TRIGGER + timedelta(hours=1))
    _set_last_running(space, DENTIST_TRIGGER + timedelta(minutes=10))
    notifier = FakeNotifier()
    _scheduler(space, notifier).tick()
    assert notifier.sent == []


def test_catch_up_window_12h_without_ledger(calendar_space_dir: Path):
    notifier = FakeNotifier()
    _scheduler(_space(calendar_space_dir, DENTIST_TRIGGER + timedelta(hours=3)), notifier).tick()
    assert _titles(notifier) == ["Call dentist"]

    shutil.rmtree(_state())
    notifier = FakeNotifier()
    _scheduler(_space(calendar_space_dir, DENTIST_TRIGGER + timedelta(hours=13)), notifier).tick()
    assert notifier.sent == []


def test_trigger_already_past_when_set_does_not_fire_on_restart(calendar_space_dir: Path):
    # A task due tomorrow (2026-10-24); at 09:30 local today it gets
    # "1 day before at 09:00": the trigger (09:00 local = 07:00Z) is already past.
    rel = "Tasks/Plan trip.md"
    _write(
        calendar_space_dir,
        rel,
        """
id: 01JBQ4Z7S3N8V2K5D9X6T19003
type: 'Task'
title: Plan trip
lastUpdated: 2026-10-20T12:00:00.000Z
status: Not Started
date: 2026-10-24
""",
    )
    trigger = datetime(2026, 10, 23, 7, 0, tzinfo=UTC)
    space = _space(calendar_space_dir, trigger + timedelta(minutes=20))
    notifier = FakeNotifier()
    sched = _scheduler(space, notifier)
    sched.tick()  # 07:20Z, before the reminder is set
    space.clock.now = trigger + timedelta(minutes=30)  # 09:30 local
    _of, _fm, version = space.read(rel)
    space.update_properties(rel, {"remind": "1 day before at 09:00"}, version)
    sched.tick(trigger + timedelta(minutes=30, seconds=30))
    sched.tick(trigger + timedelta(minutes=31))
    assert "Plan trip" not in _titles(notifier)
    # restart within 12 h, with and without a ledger
    for keep_ledger in (False, True):
        if not keep_ledger:
            shutil.rmtree(_state(), ignore_errors=True)
        else:
            _set_last_running(space, trigger - timedelta(hours=1))
        again = FakeNotifier()
        _scheduler(_space(calendar_space_dir, trigger + timedelta(hours=1)), again).tick()
        assert "Plan trip" not in _titles(again)


def test_corrupt_ledger_no_catchup(calendar_space_dir: Path):
    _write(
        calendar_space_dir,
        "Tasks/Later call.md",
        """
id: 01JBQ4Z7S3N8V2K5D9X6T19004
type: 'Task'
title: Later call
lastUpdated: 2026-10-20T12:00:00.000Z
status: Not Started
date: 2026-10-23T09:10:00.000Z
remind: 10 minutes before
""",
    )
    space = _space(calendar_space_dir, DENTIST_TRIGGER + timedelta(minutes=15))
    ledger = ledger_path_for(space.root)
    ledger.parent.mkdir(parents=True, exist_ok=True)
    ledger.write_bytes(b"{not json")
    notifier = FakeNotifier()
    sched = _scheduler(space, notifier)
    assert sched.ledger.status == "unknown"
    sched.tick()  # 08:30Z: the 08:15Z trigger was missed; no catch-up
    assert notifier.sent == []
    sched.tick(datetime(2026, 10, 23, 9, 0, 20, tzinfo=UTC))  # Later call's 09:00Z trigger
    assert _titles(notifier) == ["Later call"]
    data = json.loads(ledger.read_text(encoding="utf-8"))
    assert set(data) == {"lastRunning", "fired"} and len(data["fired"]) == 1


def test_rename_does_not_refire(calendar_space_dir: Path):
    notifier = FakeNotifier()
    _scheduler(_space(calendar_space_dir, DENTIST_TRIGGER + timedelta(seconds=10)), notifier).tick()
    assert _titles(notifier) == ["Call dentist"]
    # move and rename the file outside the app (same `id`); rewind lastRunning so
    # only the ledger's id-keyed entry can stop a second notification
    dest = calendar_space_dir / "Archive" / "Call the dentist.md"
    dest.parent.mkdir()
    os.replace(calendar_space_dir / DENTIST, dest)
    space = _space(calendar_space_dir, DENTIST_TRIGGER + timedelta(minutes=5))
    _set_last_running(space, DENTIST_TRIGGER - timedelta(hours=1))
    sched = _scheduler(space, notifier)
    sched.tick()
    assert len(notifier.sent) == 1
    # control: without the fired entry the moved task would fire
    empty = Ledger(space.root.parent / "empty-ledger.json")
    empty.last_running = DENTIST_TRIGGER - timedelta(hours=1)
    empty.status = "ok"
    assert [d.path for d in due(space, None, space.clock(), empty)] == ["Archive/Call the dentist.md"]


def test_ledger_entry_written_before_send(calendar_space_dir: Path):
    calls = []

    class Raising:
        def send(self, title: str, body: str) -> None:
            calls.append(title)
            raise RuntimeError("toast failed")

    space = _space(calendar_space_dir, DENTIST_TRIGGER + timedelta(seconds=10))
    _scheduler(space, Raising()).tick()  # the failure is swallowed
    assert calls == ["Call dentist"]
    data = json.loads(ledger_path_for(space.root).read_text(encoding="utf-8"))
    assert any(k.startswith("01JBQ4Z7S3N8V2K5D9X6T10015|") for k in data["fired"])
    _set_last_running(space, DENTIST_TRIGGER - timedelta(hours=1))
    _scheduler(_space(calendar_space_dir, DENTIST_TRIGGER + timedelta(minutes=1)), Raising()).tick()
    assert calls == ["Call dentist"]


def test_recurring_rearms_after_completion(calendar_space_dir: Path):
    notifier = FakeNotifier()
    space = _space(calendar_space_dir, WEEKLY_TRIGGER + timedelta(seconds=5))
    sched = _scheduler(space, notifier)
    sched.tick()
    assert notifier.sent == [("Weekly review", "Due 2026-10-14")]
    # complete it on 2026-10-23 (the Task 3 hook moves `date` to 2026-10-28)
    space.clock.now = datetime(2026, 10, 23, 10, 0, tzinfo=UTC)
    _of, _fm, version = space.read(WEEKLY)
    result = space.update_properties(WEEKLY, {"status": ["Done"]}, version)
    assert result.task is not None and result.task.advanced
    new_trigger = datetime(2026, 10, 27, 7, 0, tzinfo=UTC)  # 2026-10-27 09:00 local
    sched.tick(new_trigger - timedelta(minutes=1))
    weekly = [n for n in notifier.sent if n[0] == "Weekly review"]
    assert len(weekly) == 1
    sched.tick(new_trigger + timedelta(seconds=10))
    weekly = [n for n in notifier.sent if n[0] == "Weekly review"]
    assert weekly == [("Weekly review", "Due 2026-10-14"), ("Weekly review", "Due 2026-10-28")]


# -- what it writes -----------------------------------------------------------------


def test_idle_tick_writes_nothing(calendar_space_dir: Path):
    space = _space(calendar_space_dir, datetime(2026, 10, 20, 0, 0, tzinfo=UTC))
    before = _tree(calendar_space_dir)
    sched = _scheduler(space)
    sched.tick()
    sched.tick(datetime(2026, 10, 20, 0, 0, 30, tzinfo=UTC))
    sched.tick(datetime(2026, 10, 20, 0, 1, tzinfo=UTC))
    assert _tree(calendar_space_dir) == before
    assert list(_state().rglob("*")) == []


def test_firing_writes_only_ledger(calendar_space_dir: Path):
    before = _tree(calendar_space_dir)
    notifier = FakeNotifier()
    _scheduler(_space(calendar_space_dir, DENTIST_TRIGGER + timedelta(seconds=10)), notifier).tick()
    assert len(notifier.sent) == 1
    assert _tree(calendar_space_dir) == before  # no object, .capacities/, cache or .gitignore change
    ledger = ledger_path_for(calendar_space_dir)
    assert [p for p in _state().rglob("*") if p.is_file()] == [ledger]
    assert calendar_space_dir.resolve() not in ledger.resolve().parents


def test_disabled_by_ui_flag(calendar_space_dir: Path):
    (calendar_space_dir / ".capacities" / "ui.json").write_text(
        json.dumps({"reminders": {"enabled": False}}), encoding="utf-8"
    )
    notifier = FakeNotifier()
    sched = _scheduler(_space(calendar_space_dir, DENTIST_TRIGGER + timedelta(seconds=10)), notifier)
    sched.tick()
    assert notifier.sent == []
    assert not ledger_path_for(calendar_space_dir).exists()
    (calendar_space_dir / ".capacities" / "ui.json").write_text(
        json.dumps({"reminders": {"enabled": True}}), encoding="utf-8"
    )
    sched.tick(DENTIST_TRIGGER + timedelta(seconds=40))  # the trigger passed while switched off
    assert notifier.sent == []


def test_ledger_pruned_after_30_days(tmp_path: Path):
    path = tmp_path / "ledger.json"
    now = datetime(2026, 10, 23, 8, 0, tzinfo=UTC)
    path.write_text(
        json.dumps(
            {
                "lastRunning": "2026-10-22T08:00:00.000Z",
                "fired": {
                    "old|2026-09-01|x": "2026-09-01T08:00:00.000Z",
                    "recent|2026-10-01|y": "2026-10-01T08:00:00.000Z",
                },
            }
        ),
        encoding="utf-8",
    )
    ledger = Ledger(path)
    assert ledger.status == "ok"
    ledger.record("new|2026-10-23|z", now)
    data = json.loads(path.read_text(encoding="utf-8"))
    assert set(data["fired"]) == {"recent|2026-10-01|y", "new|2026-10-23|z"}
    assert data["lastRunning"] == "2026-10-23T08:00:00.000Z"


def test_ledger_location_outside_space_keyed_by_space_path(tmp_path: Path, monkeypatch):
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir()
    b.mkdir()
    pa, pb = ledger_path_for(a), ledger_path_for(b)
    assert pa != pb and pa == ledger_path_for(a)
    assert pa.parent == _state() and pa.name.startswith("reminders-") and pa.suffix == ".json"
    assert a.resolve() not in pa.resolve().parents
    monkeypatch.delenv("OBJECT_STATE_DIR")
    monkeypatch.delenv("XDG_STATE_HOME", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    expected = (
        tmp_path / "local" / "object"
        if os.name == "nt"
        else tmp_path / "home" / ".local" / "state" / "object"
    )
    assert ledger_path_for(a).parent == expected


# -- the notifier and the network ---------------------------------------------------


def test_notifier_arguments_not_in_script():
    evil = "Pay \"rent\" ' $(Remove-Item C:\\) `whoami`"
    argv, env = command_for("win32", evil, "Due today")
    assert argv[1:4] == ["-NoProfile", "-NonInteractive", "-Command"]
    assert argv[4] == WINDOWS_TOAST_SCRIPT and len(argv) == 5
    assert all(evil not in part for part in argv)
    assert env == {"OBJECT_NOTIFY_TITLE": evil, "OBJECT_NOTIFY_BODY": "Due today"}
    argv2, _ = command_for("win32", "other", "Due 2026-10-24")
    assert argv2 == argv  # the script text is constant
    for platform in ("darwin", "linux"):
        argv, env = command_for(platform, evil, "Due today")
        assert env is None and argv[-2:] == [evil, "Due today"]
        assert all(evil not in part for part in argv[:-2])
    launched = []
    SystemNotifier("linux", launcher=lambda a, e: launched.append((a, e))).send(evil, "Due today")
    assert launched == [(["notify-send", "--app-name=Object", "--", evil, "Due today"], None)]
    # a launch failure is logged once and never raised
    def broken(_a, _e):
        raise FileNotFoundError("notify-send")

    quiet = SystemNotifier("linux", launcher=broken)
    quiet.send("a", "b")
    quiet.send("a", "b")
    SystemNotifier("plan9").send("a", "b")


def test_no_network_import():
    # import both modules fresh in a child interpreter whose socket connects fail
    probe = (
        "import socket, sys\n"
        "def refuse(*a, **k):\n"
        "    raise SystemExit('a socket connection was attempted')\n"
        "socket.socket.connect = refuse\n"
        "socket.socket.connect_ex = refuse\n"
        "socket.create_connection = refuse\n"
        "import objectapp.notify, objectapp.reminders\n"
        "print('ok')\n"
    )
    env = {**os.environ, "PYTHONPATH": str(Path(reminders.__file__).parents[1])}
    out = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, env=env, timeout=60, check=False)
    assert out.returncode == 0 and out.stdout.strip() == "ok", out.stderr
    banned = {"socket", "http", "urllib", "requests", "httpx", "aiohttp", "ssl", "asyncio", "smtplib"}
    for module in (notify, reminders):
        tree = ast.parse(Path(module.__file__).read_text(encoding="utf-8"))
        names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                names.add(node.module.split(".")[0])
        assert not names & banned, (module.__name__, names & banned)


def test_stop_joins_thread(calendar_space_dir: Path):
    space = _space(calendar_space_dir, datetime(2026, 10, 20, 0, 0, tzinfo=UTC))
    sched = _scheduler(space)
    sched.start()
    thread = sched._thread
    assert thread is not None and thread.is_alive() and sched.running
    space.clock.now = datetime(2026, 10, 20, 0, 5, tzinfo=UTC)
    sched.stop()
    assert not thread.is_alive() and not sched.running
    data = json.loads(ledger_path_for(space.root).read_text(encoding="utf-8"))
    assert data["lastRunning"] == "2026-10-20T00:05:00.000Z"
