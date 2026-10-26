"""Local Task reminders: a small scheduler thread and its fired-reminder ledger.

A reminder belongs to a Task's ``date`` and its ``remind`` text (see
`taskmodel.parse_remind`). The scheduler checks every 30 s and fires one OS
notification (through an injected `notify.Notifier`) for each trigger time in
``(last check, now]``.

Catch-up after the app was closed covers only triggers later than the last
time the scheduler was known to be running (the ledger's ``lastRunning``,
written on a clean `ReminderScheduler.stop` and whenever a reminder fires);
with no ledger file the fallback is the last 12 hours, and a corrupt ledger
means no catch-up for that start-up. A trigger must also be later than the
task's ``lastUpdated``, so a reminder that was already in the past when it was
set or moved never fires.

The ledger lives outside the space (per-user app data, or ``OBJECT_STATE_DIR``)
so a git-tracked or synced space is never dirtied. An entry is recorded before
the notification is sent: at most once, never twice. Nothing here opens a
socket or writes inside the space.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from pathlib import Path
from typing import Any

from .localtime import from_local, to_local
from .notify import Notifier
from .propvalues import decode_value, label_lookup
from .taskhook import status_key_of
from .taskmodel import ReminderRule, parse_remind
from .textfile import atomic_write
from .typemodel import is_task_type, status_category
from .uistate import load_ui

__all__ = [
    "CATCH_UP_FALLBACK",
    "LEDGER_RETENTION",
    "Due",
    "Ledger",
    "ReminderScheduler",
    "TaskInfo",
    "due",
    "file_clock",
    "ledger_path_for",
    "reminders_enabled",
    "task_infos",
    "trigger_time",
]

log = logging.getLogger(__name__)

CATCH_UP_FALLBACK = timedelta(hours=12)
LEDGER_RETENTION = timedelta(days=30)
STATE_DIR_ENV = "OBJECT_STATE_DIR"


def _parse_instant(text: object) -> datetime | None:
    if not isinstance(text, str) or not text.strip():
        return None
    try:
        dt = datetime.fromisoformat(text.strip())
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=UTC)).astimezone(UTC)


def _stamp(instant: datetime) -> str:
    now = instant.astimezone(UTC)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


# -- tasks and triggers ---------------------------------------------------------


@dataclass(frozen=True)
class TaskInfo:
    """What the scheduler needs from one Task object."""

    path: str
    id: str | None
    title: str
    date: dict[str, Any] | None
    """The decoded ``date`` value (API form: ``{start, end?, resolution}``), else None."""
    done: bool
    remind: str | None
    lastUpdated: datetime | None

    @property
    def key_id(self) -> str:
        """The frontmatter ``id`` (so rename and move don't re-fire), else the path."""
        return self.id or self.path


def trigger_time(task: TaskInfo, rule: str | ReminderRule | None, tz: tzinfo) -> datetime | None:
    """The UTC trigger of `rule` on the Task's ``date``, else None.

    None when the task is done, has no ``date``, or the reminder doesn't parse
    or doesn't fit the date's resolution (a day reminder on a time date, or a
    time reminder on a day date).
    """
    if task.done or not task.date or not isinstance(task.date.get("start"), str):
        return None
    resolution = task.date.get("resolution")
    if resolution not in ("day", "time"):
        return None
    if isinstance(rule, ReminderRule):
        parsed: ReminderRule | None = rule if rule.resolution == resolution else None
    else:
        parsed = parse_remind(rule, resolution)
    if parsed is None:
        return None
    start = task.date["start"]
    if resolution == "time":
        at = _parse_instant(start)
        if at is None:
            return None
        return at - timedelta(minutes=parsed.minutesBefore)
    try:
        day = date.fromisoformat(start[:10])
    except ValueError:
        return None
    hh, mm = (int(x) for x in (parsed.timeOfDay or "00:00").split(":"))
    wall = datetime.combine(day - timedelta(days=parsed.daysBefore), time(hh, mm))
    return from_local(wall, tz)


def _status_done(t, fm: Mapping[str, Any]) -> bool:
    sdef = status_key_of(t)
    if sdef is None:
        return False
    texts = decode_value(sdef, fm.get(sdef.key), fm) or []
    text = texts[0] if texts else None
    if not text:
        return False
    opt = label_lookup(sdef, text)
    if opt is None:
        return False
    return (opt.statusCategory or status_category(opt.text)) == "done"


def task_infos(space) -> list[TaskInfo]:
    """Every basic-Task object (not templates) that has a ``remind`` text."""
    out: list[TaskInfo] = []
    with space._lock:
        items = [(rel, raw, space._summaries.get(rel)) for rel, raw in space._raw.items()]
    for rel, raw, summary in items:
        if summary is None or summary.template:
            continue
        fm = raw.fm or {}
        remind = fm.get("remind")
        if not isinstance(remind, str) or not remind.strip():
            continue
        t = space.type_by_id(summary.type)
        if not is_task_type(t):
            continue
        date_def = t.prop("date")
        value = decode_value(date_def, fm.get("date"), fm) if date_def is not None else None
        out.append(
            TaskInfo(
                path=rel,
                id=str(fm["id"]) if fm.get("id") else None,
                title=summary.title,
                date=value if isinstance(value, dict) else None,
                done=_status_done(t, fm),
                remind=remind,
                lastUpdated=_parse_instant(fm.get("lastUpdated")),
            )
        )
    return out


@dataclass(frozen=True)
class Due:
    path: str
    key: str
    """``<object id>|<date>|<trigger>``: the ledger key."""
    title: str
    body: str
    trigger: datetime


def _body(task: TaskInfo, now: datetime, tz: tzinfo) -> str:
    """"Due today" or "Due {date}" (our strings), the date in ISO form."""
    assert task.date is not None
    start = task.date["start"]
    if task.date.get("resolution") == "time":
        at = _parse_instant(start)
        if at is None:
            return f"Due {start}"
        local = to_local(at, tz)
        day, text = local.date(), local.strftime("%Y-%m-%d %H:%M")
    else:
        day, text = date.fromisoformat(start[:10]), start[:10]
    return "Due today" if day == to_local(now, tz).date() else f"Due {text}"


def due(space, since: datetime | None, now: datetime, ledger: Ledger) -> list[Due]:
    """The reminders to fire now, oldest trigger first.

    A trigger is due when it is in ``(floor, now]``, later than its task's
    ``lastUpdated`` and not already in the ledger. ``floor`` is `since` (the
    scheduler's last check); at start-up (``since`` None) it is the catch-up
    floor: the ledger's ``lastRunning``, else 12 hours ago when there is no
    ledger, else ``now`` (an unreadable ledger: no catch-up).
    """
    floor = since if since is not None else ledger.catch_up_floor(now)
    out: list[Due] = []
    for task in task_infos(space):
        trig = trigger_time(task, task.remind, space.tz)
        if trig is None or not (floor < trig <= now):
            continue
        if task.lastUpdated is not None and trig <= task.lastUpdated:
            continue
        key = f"{task.key_id}|{task.date['start']}|{_stamp(trig)}"  # type: ignore[index]
        if key in ledger.fired:
            continue
        out.append(Due(task.path, key, task.title, _body(task, now, space.tz), trig))
    out.sort(key=lambda d: (d.trigger, d.path))
    return out


# -- the ledger -----------------------------------------------------------------


def _state_dir() -> Path:
    override = os.environ.get(STATE_DIR_ENV)
    if override:
        return Path(override)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA")
        return (Path(base) if base else Path.home() / "AppData" / "Local") / "object"
    xdg = os.environ.get("XDG_STATE_HOME")
    return (Path(xdg) if xdg else Path.home() / ".local" / "state") / "object"


def ledger_path_for(space_root: Path) -> Path:
    """``<state dir>/reminders-<hash of the space path>.json`` (outside the space)."""
    key = os.path.normcase(str(Path(space_root).resolve()))
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    return _state_dir() / f"reminders-{digest}.json"


class Ledger:
    """``{"lastRunning": iso, "fired": {key: firedAt}}``, written atomically.

    ``status`` is ``'missing'`` (no file), ``'ok'`` or ``'unknown'`` (the file
    can't be read or isn't a ledger; it is replaced on the next write).
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()
        self.status = "missing"
        self.last_running: datetime | None = None
        self.fired: dict[str, str] = {}
        self.load()

    @classmethod
    def for_space(cls, space_root: Path) -> Ledger:
        return cls(ledger_path_for(space_root))

    def load(self) -> None:
        with self._lock:
            self.last_running, self.fired = None, {}
            try:
                raw = self.path.read_bytes()
            except FileNotFoundError:
                self.status = "missing"
                return
            except OSError:
                self.status = "unknown"
                return
            try:
                data = json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                self.status = "unknown"
                return
            fired = data.get("fired", {}) if isinstance(data, dict) else None
            if not isinstance(fired, dict):
                self.status = "unknown"
                return
            self.status = "ok"
            self.last_running = _parse_instant(data.get("lastRunning"))
            self.fired = {str(k): str(v) for k, v in fired.items()}

    def catch_up_floor(self, now: datetime) -> datetime:
        with self._lock:
            if self.status == "unknown":
                return now
            if self.status == "ok" and self.last_running is not None:
                return self.last_running
            return now - CATCH_UP_FALLBACK

    def _save(self, now: datetime) -> None:
        cutoff = now - LEDGER_RETENTION
        kept = {}
        for key, fired_at in self.fired.items():
            at = _parse_instant(fired_at)
            if at is not None and at >= cutoff:
                kept[key] = fired_at
        self.fired = kept
        payload = {"lastRunning": _stamp(self.last_running or now), "fired": kept}
        data = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(self.path, data)
        self.status = "ok"

    def record(self, key: str, now: datetime) -> None:
        """Record a fired reminder (and that the scheduler was running at `now`)."""
        with self._lock:
            self.fired[key] = _stamp(now)
            self.last_running = now
            self._save(now)

    def mark_running(self, now: datetime) -> None:
        """Record that the scheduler was running until `now` (a clean stop)."""
        with self._lock:
            self.last_running = now
            self._save(now)


# -- the scheduler ----------------------------------------------------------------


def reminders_enabled(space_root: Path) -> bool:
    """``ui.json`` ``reminders.enabled`` (default true)."""
    section = load_ui(Path(space_root)).get("reminders")
    if isinstance(section, dict) and isinstance(section.get("enabled"), bool):
        return section["enabled"]
    return True


class ReminderScheduler:
    """Checks every `interval` seconds on a daemon thread; `tick` is the unit of work."""

    def __init__(
        self,
        space,
        notifier: Notifier,
        interval: float = 30.0,
        ledger: Ledger | None = None,
    ) -> None:
        self.space = space
        self.notifier = notifier
        self.interval = interval
        self.ledger = ledger if ledger is not None else Ledger.for_space(space.root)
        self._last_check: datetime | None = None
        self._tick_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def tick(self, now: datetime | None = None) -> list[Due]:
        """Fire every reminder due at `now` (default `Space.clock()`); return them."""
        with self._tick_lock:
            now = now if now is not None else self.space.clock()
            since, self._last_check = self._last_check, now
            if not reminders_enabled(self.space.root):
                return []
            fired = due(self.space, since, now, self.ledger)
            for item in fired:
                self.ledger.record(item.key, now)  # before sending: at most once
                try:
                    self.notifier.send(item.title, item.body)
                except Exception:
                    log.exception("Reminders: the notifier failed")
            return fired

    def _run(self) -> None:
        while True:
            try:
                self.tick()
            except Exception:
                log.exception("Reminders: a check failed")
            if self._stop.wait(self.interval):
                return

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="object-reminders", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Stop the thread, join it, and record ``lastRunning``."""
        thread, self._thread = self._thread, None
        self._stop.set()
        if thread is not None:
            thread.join()
            try:
                self.ledger.mark_running(self.space.clock())
            except OSError:
                log.exception("Reminders: could not record lastRunning")

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()


# -- test hooks ---------------------------------------------------------------------


def file_clock(path: Path) -> Callable[[], datetime]:
    """A `Space.clock` that re-reads an ISO UTC instant from `path` on every call.

    The ``OBJECT_CLOCK_FILE`` test hook. A missing or unreadable file reads as
    the system clock.
    """
    target = Path(path)

    def clock() -> datetime:
        try:
            text = target.read_text(encoding="utf-8")
        except OSError:
            return datetime.now(UTC)
        return _parse_instant(text) or datetime.now(UTC)

    return clock
