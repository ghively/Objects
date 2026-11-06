"""The work loop: the queue's listener, auto-run and the runner (M24 T6) and the seam M23 calls.

T1 ships the signatures, the constants and a `WorkLoop` whose `start`/`stop` do nothing; the
status reads work (an empty queue). T6 fills the loop itself.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from . import settings as device_settings
from .ids import new_ulid
from .workagentmodel import (
    NOT_SET,
    WORK_ENTRY_LABELS,
    QueueRefused,
    WorkEntryState,
)
from .workqueue import QueueStore

if TYPE_CHECKING:
    from .agents import AgentRegistry
    from .headless import HeadlessResult
    from .space import Space
    from .watcher import ChangeEvent
    from .workservice import WorkNotice, WorkService

__all__ = [
    "POLL_SECONDS",
    "RUNNER_ID",
    "TEST_TIMEOUT_ENV",
    "WORK_RUN_TIMEOUT",
    "AgentSeam",
    "QueueRefused",
    "WorkLoop",
    "loop_for",
    "outcome",
    "precheck",
    "run_timeout",
]

WORK_RUN_TIMEOUT = 1800.0
POLL_SECONDS = 30.0
RUNNER_ID = new_ulid()
TEST_TIMEOUT_ENV = "OBJECT_TEST_WORK_TIMEOUT"
"""Seconds; honoured only while OBJECT_FAKE_NOTIFY_FILE is set (M14's test-hook rule)."""

_loops: dict[str, "WorkLoop"] = {}
_loops_lock = threading.Lock()


def run_timeout() -> float:
    if os.environ.get("OBJECT_FAKE_NOTIFY_FILE") and os.environ.get(TEST_TIMEOUT_ENV):
        try:
            value = float(os.environ[TEST_TIMEOUT_ENV])
        except ValueError:
            return WORK_RUN_TIMEOUT
        if value > 0:
            return value
    return WORK_RUN_TIMEOUT


def precheck(entry: dict, item: dict | None, capture: dict | None, now: datetime
             ) -> tuple[Literal["run", "wait", "withdraw"], str | None, str | None]:
    raise NotImplementedError("M24 T6")


def outcome(entry: dict, result: HeadlessResult, notices: list[WorkNotice], filed: bool, *, timed_out: bool,
            withdrawn: bool) -> tuple[WorkEntryState, str | None, str | None]:
    raise NotImplementedError("M24 T6")


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
        self.registry = registry
        self.read_settings = read_settings or (lambda: device_settings.read()[0])
        self.home = home
        self.clock = clock
        self.store = QueueStore(space.root)
        with _loops_lock:
            _loops[self._key(space)] = self

    @staticmethod
    def _key(space: Space) -> str:
        return str(Path(space.root).resolve())

    # -- lifecycle (T6) ---------------------------------------------------------------------

    def start(self) -> None:
        """T6: subscribe to work notices and start the worker thread."""

    def stop(self, timeout: float = 5.0) -> None:
        """T6: unsubscribe and stop a running run."""

    def on_notice(self, space: Space, notice: WorkNotice) -> None:
        raise NotImplementedError("M24 T6")

    def enqueue_capture(self, capture: dict, parsed: Any, item: dict | None) -> dict:
        raise NotImplementedError("M24 T3/T6")

    def scan_auto_runs(self) -> int:
        return 0

    def scan_unqueued_captures(self) -> int:
        return 0

    def retry(self, entry_id: str) -> dict:
        raise NotImplementedError("M24 T6")

    def set_acts(self, on: bool) -> None:
        raise NotImplementedError("M24 T6/T7")

    def running_for_chat(self, chat_id: str | None) -> dict | None:
        return None

    def wake(self) -> None:
        """T6: wake the worker."""

    def wait_idle(self, timeout: float) -> bool:
        return True

    # -- status -----------------------------------------------------------------------------

    def settings_status(self) -> dict:
        """WorkAgentSettings (T1: the saved keys; T5/T7 add the agent record and its problem)."""
        merged, revision = device_settings.read()
        agent_id = merged.get("workAgentId")
        return {
            "agentId": agent_id,
            "agent": None,
            "problem": NOT_SET if not agent_id else None,
            "acts": bool(merged.get("workAgentActs")),
            "autoRun": bool(merged.get("workAutoRun")),
            "readTools": list(merged.get("workReadTools") or []),
            "settingsRevision": revision,
        }

    def agent_status(self, board: list[dict] | None = None) -> dict:
        """M23's `AgentStatus` from the queue. Never writes."""
        settings = self.read_settings()
        rows = [_row(e) for e in self.store.entries() if e.get("state") in ("pending", "running")]
        carrying = len(rows) or sum(1 for item in (board or []) if item.get("turn") == "agent")
        return {
            "available": True,
            "agentName": None,
            "actsOnApprovals": bool(settings.get("workAgentActs")),
            "carrying": carrying,
            "rows": rows,
            "note": NOT_SET if not settings.get("workAgentId") else None,
        }


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
