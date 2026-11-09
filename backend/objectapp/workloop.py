"""The work loop: the queue's listener, auto-run and the runner (M24 T6) and the seam M23 calls.

One `WorkLoop` per app (an app serves one space), one worker thread, one run at a time. Runs are
M20 headless chats of the work agent. Only a run for a current, approved Approve step gets the
agent's full tool set (purpose ``work``); the pre-run check is made again at the moment of claiming.
An approval is spent by the run it starts: when that run ends failed (timed out, stopped, an error,
Object closed), the step goes back to Open and the entry is withdrawn with `REAPPROVE`, so Retry
asks for approval again (Gene, 2026-11-08). Steps of other kinds keep Retry.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from . import captures, headless, writeorigin
from . import settings as device_settings
from .agentrun import RunRefused
from .agents import AgentRegistry, effective_model
from .appstate import space_key
from .ids import new_ulid
from .watcher import ChangeEvent
from .workagent import ensure_work_agent, work_agent
from .workagentmodel import (
    ALREADY_FILED,
    AUTO_RUN_CAP,
    AUTO_RUN_HELD,
    CRASHED,
    GONE,
    NOT_FILED,
    NOT_MARKED,
    NOT_RETRYABLE,
    STOPPED,
    TIMED_OUT,
    WITHDRAWN_CHANGED,
    WITHDRAWN_REDECIDED,
    WORK_ENTRY_LABELS,
    QueueRefused,
    WorkEntryState,
)
from .workbody import one_line
from .workfields import is_work_type
from .workprompts import entry_prompt
from .workqueue import QueuePlan, QueueStore, auto_run_key, plan_for_notice
from .workread import NotWorkItem
from .workrules import IllegalMove
from .workservice import Actor, StepChanged, add_work_listener, in_work_write

if TYPE_CHECKING:
    from .headless import HeadlessResult
    from .space import Space, SpaceChange
    from .workservice import WorkNotice, WorkService

log = logging.getLogger(__name__)

__all__ = [
    "POLL_SECONDS",
    "REAPPROVE",
    "RUNNER_ID",
    "TEST_TIMEOUT_ENV",
    "WORK_RUN_TIMEOUT",
    "AgentSeam",
    "QueueRefused",
    "WorkLoop",
    "loop_for",
    "on_change_event",
    "outcome",
    "precheck",
    "run_timeout",
]

WORK_RUN_TIMEOUT = 1800.0
POLL_SECONDS = 30.0
RUNNER_ID = new_ulid()
TEST_TIMEOUT_ENV = "OBJECT_TEST_WORK_TIMEOUT"
"""Seconds; honoured only while OBJECT_FAKE_NOTIFY_FILE is set (M14's test-hook rule)."""
CAPTURE_UNREADABLE = "This brain dump couldn't be read. Try again."
CHANGED_409 = "This step changed. Look again."
GONE_409 = "This item is gone or isn't a work item any more."
REAPPROVE = "The run didn't finish; approve the step again to retry."
"""An Approve step whose run ended failed goes back to Open and its entry is withdrawn with this
reason (Gene, 2026-11-08): the approval was spent by the run it started; Retry answers 409 with it."""
_RETRY_409 = {ALREADY_FILED: ALREADY_FILED, GONE: GONE_409}
"""What Retry answers for the pre-run check's reason: a brain dump filed meanwhile and a gone item
say so; a changed step says `CHANGED_409`."""

_loops: dict[str, WorkLoop] = {}
_loops_lock = threading.Lock()

_FOREIGN_ORIGINS = ("api:", "automation:")
"""Change-event origins that aren't one of Gene's windows: ``api:<token name>`` (`v1guard`: an
agent's run, or another program's) and ``automation:<rule id>`` (`automations_model.origin_for`)."""


def _from_ui(origin: str | None) -> bool:
    """Whether a change event's origin is one of Gene's windows (its ``clientId``, `server`'s
    routes). None is the app's own write, or one made outside the app (no client at all);
    `writeorigin.ALERTS` is the monitoring folder watch's."""
    return bool(origin) and not origin.startswith(_FOREIGN_ORIGINS) and origin != writeorigin.ALERTS


def on_change_event(space: Space, event: ChangeEvent) -> None:
    """`server`'s ``announce`` hands every change event to the space's loop (`WorkLoop.on_change`);
    nothing when the space has no loop yet."""
    with _loops_lock:
        loop = _loops.get(WorkLoop._key(space))
    if loop is not None:
        loop.on_change(event)


def run_timeout() -> float:
    if os.environ.get("OBJECT_FAKE_NOTIFY_FILE") and os.environ.get(TEST_TIMEOUT_ENV):
        try:
            value = float(os.environ[TEST_TIMEOUT_ENV])
        except ValueError:
            return WORK_RUN_TIMEOUT
        if value > 0:
            return value
    return WORK_RUN_TIMEOUT


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _iso(at: datetime) -> str:
    return at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _step_of(item: dict | None, step_id: str | None) -> dict | None:
    return next((s for s in (item or {}).get("steps", []) if s.get("id") == step_id), None)


def precheck(entry: dict, item: dict | None, capture: dict | None, now: datetime
             ) -> tuple[Literal["run", "wait", "withdraw"], str | None, str | None]:
    """(verdict, purpose, reason). Pure. Only an approved, current Approve step earns ``work``."""
    kind = entry.get("kind")
    if kind == "capture":
        if capture is not None and capture.get("status") == "new":
            return "run", "work-file", None
        return "withdraw", None, ALREADY_FILED
    if item is None or item.get("done") and kind in ("approve", "run"):
        return "withdraw", None, GONE if item is None else WITHDRAWN_CHANGED
    if kind in ("approve", "run"):
        step = _step_of(item, entry.get("stepId"))
        want = "approve" if kind == "approve" else "agent"
        if (step is None or step.get("kind") != want or step.get("state") != "approved"
                or not step.get("current")):
            return "withdraw", None, WITHDRAWN_CHANGED
        if kind == "approve":
            moment = _parse(step.get("notBefore")) or _parse(entry.get("notBefore"))
            if moment is not None and moment > now:
                return "wait", None, None
            return "run", "work", None
        return "run", "work-read", None
    if kind in ("breakDown", "question") and entry.get("capturePath"):
        if capture is not None and capture.get("status") != "new":
            return "withdraw", None, ALREADY_FILED
    if kind == "breakDown":
        step = _step_of(item, entry.get("stepId"))
        if step is None or step.get("state") in ("done", "declined"):
            return "withdraw", None, WITHDRAWN_CHANGED
        return "run", "work-read", None
    if kind in ("answer", "done", "decline", "note", "request", "question"):
        return "run", "work-read", None
    return "withdraw", None, WITHDRAWN_CHANGED


def outcome(entry: dict, result: HeadlessResult, notices: list[WorkNotice], filed: bool, *, timed_out: bool,
            withdrawn: bool) -> tuple[WorkEntryState, str | None, str | None]:
    """(state, result, reason) of a finished run. Pure."""
    if withdrawn:
        return "withdrawn", None, WITHDRAWN_REDECIDED
    kind = entry.get("kind")
    if timed_out or result.state in ("stopped", "error"):
        if kind in ("approve", "run"):
            # The agent may have completed the step through the tools before the CLI erred, idled
            # past the limit or was stopped: then the step is done, and a failed (retryable) entry
            # would only answer 409 on Retry.
            mine = [n for n in notices if n.step_id == entry.get("stepId") and n.by.role == "agent"
                    and n.event in ("complete", "done", "fail")]
            if mine and mine[-1].event in ("complete", "done"):
                return "done", one_line(mine[-1].text, 500), None
        if timed_out:
            return "failed", None, TIMED_OUT
        if result.state == "stopped":
            return "failed", None, STOPPED
        return "failed", None, one_line(result.error or "The run failed.", 500)
    if kind in ("approve", "run"):
        mine = [n for n in notices if n.step_id == entry.get("stepId") and n.by.role == "agent"]
        for n in reversed(mine):
            if n.event == "fail":
                return "failed", None, one_line(n.text or "The agent couldn't proceed.", 500)
            if n.event in ("complete", "done"):
                return "done", one_line(n.text, 500), None
        return "failed", None, NOT_MARKED
    if kind == "capture":
        return ("done", None, None) if filed else ("failed", None, NOT_FILED)
    return "done", one_line(result.text, 500), None


def _now() -> datetime:
    return datetime.now(UTC)


class WorkLoop:
    def __init__(self, space: Space, service: WorkService, *, announce: Callable[[ChangeEvent], None],
                 base_url: Callable[[], str | None], registry: Callable[[], AgentRegistry] | None = None,
                 read_settings: Callable[[], dict[str, Any]] | None = None,
                 home: Callable[[], Path] = Path.home, clock: Callable[[], datetime] = _now) -> None:
        self.space = space
        self.service = service
        self.announce = announce
        self.base_url = base_url
        self.registry = registry or AgentRegistry
        self.read_settings = read_settings or (lambda: device_settings.read()[0])
        self.home = home
        self.clock = clock
        self.store = QueueStore(space.root)
        self._wake = threading.Event()
        self._quit = threading.Event()
        self._thread: threading.Thread | None = None
        self._unsubscribe: Callable[[], None] | None = None
        self._lock = threading.RLock()
        self._busy = False
        self._passes = 0  # counts the worker's passes, so wait_idle can tell one ran between its checks
        self._current: dict[str, Any] | None = None
        self._stops: dict[str, threading.Event] = {}
        self._notices: list[WorkNotice] = []
        self._cap_lock = threading.RLock()
        self._queued: set[tuple[str, str]] = set()
        self._changed_lock = threading.Lock()
        self._changed: set[str] = set()  # work items written since the worker last looked (any write)
        self._settled_crashes = False  # crashed Approve runs are looked at once per start, when the agent acts
        self._unsubscribe_space: Callable[[], None] | None = None
        with _loops_lock:
            _loops[self._key(space)] = self

    @staticmethod
    def _key(space: Space) -> str:
        return str(Path(space.root).resolve())

    # -- lifecycle ---------------------------------------------------------------------------

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._quit.clear()
        self._settled_crashes = False
        self._unsubscribe = add_work_listener(self.on_notice)
        self._unsubscribe_space = self.space.add_listener(self._on_space_change)
        self._thread = threading.Thread(target=self._work, name="work-loop", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        if self._unsubscribe is not None:
            self._unsubscribe()
            self._unsubscribe = None
        if self._unsubscribe_space is not None:
            self._unsubscribe_space()
            self._unsubscribe_space = None
        self._quit.set()
        with self._lock:
            for flag in self._stops.values():
                flag.set()
        self._wake.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout)
        self._thread = None

    def wake(self) -> None:
        self._wake.set()

    def wait_idle(self, timeout: float) -> bool:
        """True when nothing is running and nothing due could start (tests)."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            # The worker can wake between the checks and claim the only due entry: then the first
            # check sees it idle and `_can_start` sees nothing pending. Re-read both after.
            passes = self._passes
            if not self._busy and not self._can_start() and not self._busy and self._passes == passes:
                return True
            self._wake.set()
            time.sleep(0.05)
        return False

    def _usable(self) -> bool:
        settings = self.read_settings()
        if not settings.get("workAgentActs"):
            return False
        return work_agent(self.registry(), settings)[0] is not None

    def _can_start(self) -> bool:
        if not self._usable():
            return False
        now = self.clock()
        for e in self.store.entries():
            nb = _parse(e.get("notBefore"))
            if e.get("state") == "pending" and (nb is None or nb <= now):
                return True
        return False

    def _event(self, entry_id: str) -> None:
        try:
            self.announce(ChangeEvent("workQueue", entry_id, None, origin=None))
        except Exception:
            log.exception("Announcing a queue change failed")

    # -- notices -----------------------------------------------------------------------------

    def on_notice(self, space: Space, notice: WorkNotice) -> None:
        if self._key(space) != self._key(self.space):
            return
        if notice.by.role == "user":
            # Decision S3: any action of Gene's on the item starts its auto-run count again.
            try:
                if self.store.reset_auto_streak(notice.path):
                    self._event("held")
            except Exception:
                log.exception("Resetting the auto-run count of %s failed", notice.path)
        with self._lock:
            cur = self._current
            if cur is not None and notice.by.role == "agent" and notice.path == cur.get("path"):
                self._notices.append(notice)
        plan = plan_for_notice(notice)
        if plan is not None and plan.create is not None and not plan.create.get("title"):
            # The item's title, for the Agent queue row and the run's chat title (a step's or a
            # note's entry had none, so its row was blank and its chat read "Brain dump").
            item = self._item(notice.path)
            if item is not None and item.get("title"):
                plan.create["title"] = item["title"]
        if plan is not None:
            try:
                withdrawn, created = self.store.apply(plan, now=self.clock())
            except Exception:
                log.exception("Queueing work for %s failed", notice.path)
                withdrawn, created = [], None
            if plan.stop_running:
                with self._lock:
                    for e in withdrawn:
                        flag = self._stops.get(e["id"])
                        if flag is not None:
                            flag.set()
            for e in withdrawn:
                self._event(e["id"])
            if created is not None:
                self._event(created["id"])
            if withdrawn or created is not None:
                self.wake()
        try:
            self._auto_check(notice.path)
        except Exception:
            log.exception("Auto-run check failed for %s", notice.path)

    def on_change(self, event: ChangeEvent) -> None:
        """A change event the app announces (`on_change_event`): a write of Gene's own to a work
        item, one of his windows' ``clientId`` as its origin (a property set in the editor, a body
        save), is his action on the item, so its auto-run count starts again and a held step is let
        go, then the item is looked at for auto-run as after a notice (decision S3). The writes of
        an agent's run or another program (``api:``), an automation's, the alert watch's and ones
        with no origin (made outside the app) count for nothing."""
        if event.kind != "changed" or not _from_ui(event.origin):
            return
        path = event.path
        try:
            summary = self.space.get(path)
        except KeyError:
            return
        if not is_work_type(self.space.type_by_id(summary.type)):
            return
        try:
            if not self.store.reset_auto_streak(path):
                return
            self._event("held")
            self._auto_check(path)
        except Exception:
            log.exception("Resetting the auto-run count of %s failed", path)

    def _on_space_change(self, change: SpaceChange) -> None:
        """`Space.add_listener`: a work item written any way (a status set back in the property
        editor, an edit outside the app) is looked at again by the worker. Runs under the space
        lock, so it only records the path and wakes the worker; the look happens there."""
        path = change.path
        if change.kind != "object" or not path or in_work_write():
            return  # a work service write is heard as the `WorkNotice` that follows it
        try:
            summary = self.space.get(path)
        except KeyError:
            return  # gone: nothing to queue
        if not is_work_type(self.space.type_by_id(summary.type)):
            return
        with self._changed_lock:
            self._changed.add(path)
        self.wake()

    def _requeue_changed(self) -> None:
        """Queue the approved step of each work item written since the last pass whose entry was
        withdrawn while the step stayed approved: closing an item withdraws its approved step, and
        reopening it by its status is a plain property write that raises no work notice."""
        with self._changed_lock:
            paths = sorted(self._changed)
            self._changed.clear()
        for path in paths:
            try:
                item = self._item(path)
                if item is not None and not item.get("done"):
                    self._requeue_approved(item)
            except Exception:
                log.exception("Looking again at %s failed", path)

    # -- auto-run ----------------------------------------------------------------------------

    def _item(self, path: str | None) -> dict | None:
        if not path:
            return None
        try:
            return self.service.item(path)
        except (KeyError, NotWorkItem, ValueError, OSError):
            return None

    def _reopen_step(self, entry: dict, why: str | None) -> bool:
        """Move the Approve step of ``entry`` back to Open (its approval was spent by the run that
        failed with ``why``). False when it isn't approved any more or couldn't be written (logged;
        Retry tries again)."""
        try:
            done = self.service.withdraw_approval(entry.get("path") or "", str(entry.get("stepId")), REAPPROVE, why)
        except Exception:
            log.exception("Reopening the step of %s failed", entry.get("id"))
            return False
        return done is not None

    def _reapprove(self, entry: dict) -> bool:
        """After a failed run of an approved Approve step: the step goes back to Open, the entry
        (and any pending entry of the step) is withdrawn with `REAPPROVE`. False when the step was
        not approved any more: the entry is left as it is."""
        if not self._reopen_step(entry, entry.get("reason")):
            return False
        now = self.clock()
        self.store.apply(QueuePlan(entry.get("path") or "", str(entry.get("stepId")), False, False, None), now=now)
        self.store.update(entry["id"], state="withdrawn", reason=REAPPROVE,
                          finishedAt=entry.get("finishedAt") or _iso(now))
        self._event(entry["id"])
        return True

    def _settle_crashed_approvals(self) -> None:
        """Approve entries whose run Object closed on (served failed, CRASHED): their steps go back
        to Open and they are withdrawn, so nothing runs them again under the old approval."""
        for e in self.store.entries():
            if e.get("kind") == "approve" and e.get("state") == "failed" and e.get("reason") == CRASHED \
                    and e.get("retryable"):
                self._reapprove(e)

    def _requeue_approved(self, item: dict) -> dict | None:
        """Queue the current approved step again when its last entry was withdrawn while it stayed
        approved (it was moved away and back, so the claim found it not current). Only a step Gene
        approved, and only when its last entry was withdrawn: a failed one waits for Retry."""
        step = next((s for s in item.get("steps", []) if s.get("current")), None)
        if step is None or step.get("state") != "approved" or step.get("kind") not in ("approve", "agent"):
            return None
        kind = "approve" if step["kind"] == "approve" else "run"
        fields = {"stepId": step["id"], "stepN": step.get("n"), "stepKind": step.get("kind"),
                  "stepText": step.get("text"), "notBefore": step.get("notBefore")}
        entry = self.store.requeue_withdrawn(item["path"], step["id"], kind, fields, now=self.clock())
        if entry is None:
            return None
        self._event(entry["id"])
        self.wake()
        return entry

    def _auto_check(self, path: str) -> bool:
        item = self._item(path)
        if item is not None and not item.get("done"):
            self._requeue_approved(item)
        step = None if item is None or item.get("done") else next(
            (s for s in item.get("steps", []) if s.get("current")), None)
        runnable = step is not None and step.get("kind") == "agent" and step.get("state") == "open"
        if not runnable and self.store.reset_auto_streak(path, keep_count=True):
            self._event("held")  # the held step isn't current and Open any more (S3)
        settings = self.read_settings()
        if not settings.get("workAutoRun") or not settings.get("workAgentActs"):
            return False
        if not runnable:
            return False
        assert item is not None and step is not None
        key = auto_run_key(path, str(step["id"]), str(step.get("text") or ""))
        if self.store.has_auto_run(key):
            return False
        if self.store.auto_streak(path) >= AUTO_RUN_CAP:
            # Decision S3: the step stays Open, shown in Stuck, until Gene presses Run now.
            held = {"stepId": step["id"], "stepN": step.get("n"), "stepText": step.get("text"),
                    "title": item.get("title"), "at": _iso(self.clock())}
            if self.store.hold_auto_run(path, held):
                log.info("Auto-run of %s step %s held: %d in a row", path, step["id"], AUTO_RUN_CAP)
                self._event("held")
            return False
        try:
            self.service.step(path, step["id"], step["rev"], "run", Actor("app", "Object"))
        except (StepChanged, IllegalMove):
            log.info("Auto-run of %s step %s was dropped", path, step["id"])
            return False
        # Recorded only once the step is running: a write that failed (read-only, disk error) is
        # tried again on the next change or scan.
        self.store.record_auto_run(key, path)
        return True

    def scan_auto_runs(self) -> int:
        count = 0
        for summary in self.service.items("active"):
            try:
                if self._auto_check(summary["path"]):
                    count += 1
            except Exception:
                log.exception("Auto-run scan failed for %s", summary.get("path"))
        return count

    # -- captures ----------------------------------------------------------------------------

    def enqueue_capture(self, capture: dict, parsed: Any, item: dict | None) -> dict:
        with self._cap_lock:
            return self._enqueue_capture(capture, parsed, item)

    def _live_entry(self, capture_path: str) -> dict | None:
        live = [e for e in self.store.entries()
                if e.get("capturePath") == capture_path and e.get("state") in ("pending", "running")]
        return live[-1] if live else None

    def _enqueue_capture(self, capture: dict, parsed: Any, item: dict | None) -> dict:
        live = self._live_entry(capture["path"])
        if live is not None:
            return live
        route = parsed.route
        full = self._item(item.get("path")) if item else None
        fields: dict[str, Any] = {"capturePath": capture["path"], "by": "Gene"}
        step = None
        if route == "breakDown" and full is not None and parsed.step_n:
            steps = full.get("steps", [])
            if 1 <= parsed.step_n <= len(steps) and steps[parsed.step_n - 1].get("state") not in ("done", "declined"):
                step = steps[parsed.step_n - 1]
        if full is None or (route == "breakDown" and step is None):
            route = "file"
        if route == "file":
            fields["kind"] = "capture"
        else:
            fields.update(kind=route, path=full["path"], objectId=full.get("objectId"), title=full.get("title"))
            if step is not None:
                fields.update(stepId=step["id"], stepN=step["n"], stepKind=step["kind"], stepText=step["text"])
        entry = self.store.add(fields, now=self.clock())
        self._queued.add((capture["path"], str(capture.get("version"))))
        self._event(entry["id"])
        self.wake()
        return entry

    def scan_unqueued_captures(self) -> int:
        """Queue each New brain dump nothing carries. One whose filing run failed is not queued again
        by the scan until it changes or the app restarts."""
        count = 0
        for cap in captures.list_captures(self.space, "new"):
            with self._cap_lock:
                if (cap["path"], str(cap.get("version"))) in self._queued or self._live_entry(cap["path"]):
                    continue
                parsed = captures.parse_prefix(cap["text"])
                linked = None
                if cap.get("linkedPath"):
                    linked = self._item(cap["linkedPath"])
                elif parsed.item_ref:
                    linked = captures.resolve_item(self.service, parsed.item_ref)
                self._enqueue_capture(cap, parsed, linked)
                count += 1
        return count

    # -- retry and settings ------------------------------------------------------------------

    def retry(self, entry_id: str) -> dict:
        e = self.store.get(entry_id)  # KeyError
        if e.get("state") == "withdrawn" and e.get("reason") == REAPPROVE:
            raise QueueRefused(409, REAPPROVE)
        if not e.get("retryable"):
            raise QueueRefused(422, NOT_RETRYABLE)
        item = self._item(e.get("path"))
        cap = self._capture(e.get("capturePath"))
        verdict, _p, reason = precheck(e, item, cap, self.clock())
        if verdict == "withdraw":
            raise QueueRefused(409, _RETRY_409.get(reason or "", CHANGED_409))
        if e.get("kind") == "approve":
            # the step is still approved: its approval was spent by the failed run, so it goes back
            # to Open and the user approves again instead of the old approval being run again
            self._reapprove(e)
            raise QueueRefused(409, REAPPROVE)
        fields = {k: e.get(k) for k in (
            "kind", "path", "objectId", "title", "stepId", "stepN", "stepKind", "stepText", "text",
            "capturePath", "notBefore", "auto", "by")}
        fields.update(attempt=int(e.get("attempt") or 1) + 1, retryOf=e["id"])
        new = self.store.add(fields, now=self.clock())
        self._event(new["id"])
        self.wake()
        return new

    def set_acts(self, on: bool) -> None:
        if on:
            ensure_work_agent(self.registry(), self.read_settings(), user=self.service.user_name(),
                              home=self.home())
        _data, revision = device_settings.read()
        device_settings.patch({"workAgentActs": bool(on)}, revision)
        self._event("settings")
        self.wake()

    def running_for_chat(self, chat_id: str | None) -> dict | None:
        if not chat_id:
            return None
        for e in self.store.entries():
            if e.get("state") == "running" and e.get("chatId") == chat_id:
                return e
        return None

    # -- the worker --------------------------------------------------------------------------

    def _capture(self, path: str | None) -> dict | None:
        if not path:
            return None
        try:
            return captures.capture(self.space, path)
        except (KeyError, OSError, ValueError):
            return None

    def _work(self) -> None:
        while not self._quit.is_set():
            try:
                self._busy = True
                self._passes += 1
                try:
                    self.scan_unqueued_captures()
                except Exception:
                    log.exception("Scanning for unqueued brain dumps failed")
                self._requeue_changed()
                ran = self._pass()
            except Exception:
                log.exception("The work loop failed")
                ran = False
            finally:
                self._busy = False
            if ran:
                continue
            self._wake.wait(POLL_SECONDS)
            self._wake.clear()

    def _pass(self) -> bool:
        """Claim and run (or settle) the first due entry. True when the queue changed."""
        settings = self.read_settings()
        if not settings.get("workAgentActs"):
            return False
        agent, _problem = work_agent(self.registry(), settings)
        if agent is None:
            return False
        if not self._settled_crashes:
            self._settled_crashes = True
            self._settle_crashed_approvals()
        now = self.clock()
        entry = self.store.claim_next(now, RUNNER_ID)
        if entry is None:
            return False
        self._event(entry["id"])
        item = self._item(entry.get("path"))
        cap = self._capture(entry.get("capturePath"))
        if entry.get("capturePath") and cap is None:
            self.store.update(entry["id"], state="failed", reason=CAPTURE_UNREADABLE, finishedAt=_iso(now))
            self._event(entry["id"])
            return True
        verdict, purpose, reason = precheck(entry, item, cap, now)
        if verdict == "withdraw":
            self.store.update(entry["id"], state="withdrawn", reason=reason, finishedAt=_iso(now))
            self._event(entry["id"])
            if entry.get("kind") in ("approve", "run"):
                # the step may have been moved back while this was decided: don't strand it
                fresh = self._item(entry.get("path"))
                if fresh is not None and not fresh.get("done"):
                    self._requeue_approved(fresh)
            return True
        if verdict == "wait":
            step = _step_of(item, entry.get("stepId")) or {}
            moment = _parse(step.get("notBefore")) or _parse(entry.get("notBefore")) or now
            self.store.update(entry["id"], state="pending", runner=None, claimedAt=None,
                              notBefore=_iso(max(moment, now)))
            self._event(entry["id"])
            return True
        assert purpose is not None
        try:
            self._run(entry, item, cap, agent, settings, purpose)
        except Exception as exc:
            log.exception("A work run failed before it finished")
            with self._lock:
                self._current = None
                self._stops.pop(entry["id"], None)
            try:
                if self.store.get(entry["id"]).get("state") == "running":
                    failed = self.store.update(entry["id"], state="failed", finishedAt=_iso(self.clock()),
                                               reason=one_line(str(exc) or "The run failed.", 500))
                    if failed.get("kind") == "approve":
                        self._reapprove(failed)
                self._event(entry["id"])
            except Exception:
                log.exception("Failing the entry %s failed", entry["id"])
        return True

    def _run(self, entry: dict, item: dict | None, cap: dict | None, agent: Any, settings: dict[str, Any],
             purpose: str) -> None:
        eid = entry["id"]
        flag = threading.Event()
        step = _step_of(item, entry.get("stepId"))
        with self._lock:
            self._stops[eid] = flag
            self._current = entry
            self._notices = []
        if self._is_withdrawn(eid) or self._quit.is_set():
            flag.set()  # a withdraw or stop landed before the flag was registered
        entry = self.store.update(eid, purpose=purpose, agentId=agent.id)
        with self._lock:
            self._current = entry
        prompt = entry_prompt(entry, item, cap, user=self.service.user_name(),
                              step_rev=(step or {}).get("rev"))
        timeout = run_timeout()
        started = time.monotonic()
        chat_seen: list[str] = []

        def announce(event: ChangeEvent) -> None:
            if event.kind == "agentChats" and not chat_seen and event.version:
                chat_seen.append(event.version)
                self.store.update(eid, chatId=event.version)
            self.announce(event)

        async def stop() -> bool:
            return flag.is_set()

        result: Any
        try:
            result = asyncio.run(headless.run_chat(
                agent, settings=settings, space_root=Path(self.space.root), space_name=self.space.name,
                space_key=space_key(self.space.root), api_url=self.base_url() or "", prompt=prompt,
                title=f"{one_line(entry.get('title') or 'Brain dump', 60)} · {entry['kind']}",
                purpose=purpose, model=effective_model(agent, settings), timeout=timeout,
                stop=stop, announce=announce))
        except RunRefused as exc:
            result = headless.HeadlessResult(chat_id="", state="error", text="", session_id=None,
                                             model=None, error=str(exc))
        except Exception as exc:
            log.exception("A work run failed")
            result = headless.HeadlessResult(chat_id="", state="error", text="", session_id=None,
                                             model=None, error=str(exc) or "The run failed.")
        elapsed = time.monotonic() - started
        with self._lock:
            notices = list(self._notices)
            self._current = None
            self._stops.pop(eid, None)
        withdrawn = self._is_withdrawn(eid)
        timed_out = result.state == "stopped" and not flag.is_set() and elapsed >= timeout - 1.0
        filed = False
        if entry["kind"] == "capture":
            latest = self._capture(entry.get("capturePath"))
            filed = latest is not None and latest.get("status") != "new"
        state, text, reason = outcome(entry, result, notices, filed, timed_out=timed_out, withdrawn=withdrawn)
        if self._quit.is_set() and state == "failed" and result.state == "stopped":
            reason = STOPPED
        if not withdrawn and state == "failed" and entry["kind"] == "approve" and self._reopen_step(entry, reason):
            # the approval was spent by this run: the step is Open again, the user approves again
            state, reason = "withdrawn", REAPPROVE
            self.store.apply(QueuePlan(entry.get("path") or "", str(entry.get("stepId")), False, False, None),
                             now=self.clock())
        now = self.clock()
        fields: dict[str, Any] = {"finishedAt": _iso(now), "chatId": result.chat_id or None}
        if not withdrawn:
            fields.update(state=state, result=text, reason=reason)
        else:
            fields.update(state="withdrawn")
        self.store.update(eid, **{k: v for k, v in fields.items() if k != "chatId" or v})
        if state == "done" and entry["kind"] in ("breakDown", "question"):
            self._file_capture(entry)
        self._event(eid)

    def _is_withdrawn(self, entry_id: str) -> bool:
        try:
            return self.store.get(entry_id).get("state") == "withdrawn"
        except KeyError:
            return False

    def _file_capture(self, entry: dict) -> None:
        cap = self._capture(entry.get("capturePath"))
        if cap is None or cap.get("status") != "new":
            return
        try:
            captures.set_status(self.space, cap["path"], "filed", base_version=None, filed_to=entry.get("path"))
        except Exception:
            log.exception("Filing the brain dump %s failed", cap["path"])

    # -- status ------------------------------------------------------------------------------

    def settings_status(self) -> dict:
        """WorkAgentSettings. Never writes."""
        merged, revision = device_settings.read()
        record, problem = work_agent(self.registry(), merged)
        agent = None
        if record is not None:
            try:
                agent = record.to_api(merged)
            except Exception:  # noqa: BLE001
                agent = None
        return {
            "agentId": merged.get("workAgentId"),
            "agent": agent,
            "problem": problem,
            "acts": bool(merged.get("workAgentActs")),
            "autoRun": bool(merged.get("workAutoRun")),
            "readTools": list(merged.get("workReadTools") or []),
            "settingsRevision": revision,
        }

    def agent_status(self, board: list[dict] | None = None) -> dict:
        """M23's `AgentStatus` from the queue. Never writes."""
        settings = self.read_settings()
        record, problem = work_agent(self.registry(), settings)
        entries = self.store.entries()
        carrying = sum(1 for e in entries if e["state"] in ("pending", "running"))
        return {
            "available": True,
            "agentName": record.data.get("name") if record is not None else None,
            "actsOnApprovals": bool(settings.get("workAgentActs")),
            "carrying": carrying,
            "rows": [_row(e) for e in _ordered(entries, self.clock())],
            "held": [_held_row(h) for h in self.store.held()],
            "note": problem or self.store.problem(),
        }


def _ordered(entries: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    running = [e for e in entries if e["state"] == "running"]
    pending = [e for e in entries if e["state"] == "pending"]
    due = [e for e in pending if (_parse(e.get("notBefore")) or now) <= now]
    waiting = sorted((e for e in pending if e not in due), key=lambda e: e.get("notBefore") or "")
    failed = sorted((e for e in entries if e.get("retryable")), key=lambda e: (e.get("finishedAt") or "", e["id"]),
                    reverse=True)
    finished = sorted((e for e in entries if e["state"] in ("done", "withdrawn")),
                      key=lambda e: (e.get("finishedAt") or e.get("createdAt") or "", e["id"]), reverse=True)[:20]
    return running + due + waiting + failed + finished


def _row(entry: dict[str, Any]) -> dict[str, Any]:
    label = WORK_ENTRY_LABELS.get(entry.get("kind", ""), str(entry.get("kind")))
    return {
        "id": entry["id"], "path": entry.get("path"), "title": entry.get("title"),
        "stepId": entry.get("stepId"), "n": entry.get("stepN"), "stepText": entry.get("stepText"),
        "reason": label + (" (auto)" if entry.get("auto") else ""), "state": entry["state"],
        "notBefore": entry.get("notBefore"), "createdAt": entry.get("createdAt"),
        "claimedAt": entry.get("claimedAt"), "finishedAt": entry.get("finishedAt"),
        "result": entry.get("result"), "error": entry.get("reason"),
    }


def _held_row(held: dict[str, Any]) -> dict[str, Any]:
    """An Agent step the auto-run cap held back (decision S3), for Stuck."""
    return {
        "path": held["path"], "title": held.get("title") or Path(held["path"]).stem,
        "stepId": held.get("stepId"), "n": held.get("stepN"), "stepText": held.get("stepText"),
        "heldAt": held.get("at"), "reason": AUTO_RUN_HELD,
    }


def loop_for(space: Space) -> WorkLoop:
    """The app's loop, registered by `WorkLoop.__init__` (KeyError when none)."""
    with _loops_lock:
        return _loops[WorkLoop._key(space)]


class AgentSeam:
    """M23's `AgentProvider`."""

    def status(self, space: Space, board: list[dict]) -> dict:
        return loop_for(space).agent_status(board)

    def set_acts(self, space: Space, on: bool) -> dict:
        loop = loop_for(space)
        loop.set_acts(on)
        return loop.agent_status()

    def retry(self, space: Space, entry_id: str) -> dict:
        loop = loop_for(space)
        loop.retry(entry_id)
        return loop.agent_status()
