"""The curator (M18, spec section 5): the idle clock, the deterministic pass, the optional
consolidation run and the scheduler.

T1: `IdleClock` and `ActivityMiddleware` are complete; the rest are the Contract's names and
final signatures, which the plan's T8 fills (`Curator.tick` answers ``[]`` and `start` / `stop`
do nothing until then).

Idle means no request to ``/api`` other than the events stream (``GET /api/events``) and the
test hooks (``/api/_test/*``), measured with the space's clock (so ``OBJECT_CLOCK_FILE`` moves it
in tests); a running turn or review counts as busy.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .agents import AgentRecord
    from .reviews import ReviewRunner
    from .watcher import ChangeEvent

__all__ = [
    "CONSOLIDATE_PROMPT",
    "ActivityMiddleware",
    "Curator",
    "CuratorBusy",
    "IdleClock",
    "deterministic_pass",
    "due",
]

CONSOLIDATE_PROMPT: str = "Tidy up your skills."
"""T8 writes the whole prompt; its first line is what the fake claude keys its curator actions on."""


class IdleClock:
    """When Object last had a request that counts as activity."""

    def __init__(self, clock: Callable[[], datetime]) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._last = clock()
        self.base_url: str | None = None
        """The last loopback base seen (the consolidation run needs one)."""

    def touch(self, base_url: str | None) -> None:
        """A request that counts as activity; remembers its base URL."""
        now = self._clock()
        with self._lock:
            self._last = now
            if base_url:
                self.base_url = base_url

    def idle_for(self) -> timedelta:
        """Since the last touch, or since the app started (never negative)."""
        now = self._clock()
        with self._lock:
            last = self._last
        try:
            gap = now - last
        except TypeError:  # one aware, one naive (a clock file changed form): count as active
            return timedelta(0)
        return gap if gap > timedelta(0) else timedelta(0)


def _counts(scope: dict[str, Any]) -> bool:
    path = str(scope.get("path") or "")
    if path != "/api" and not path.startswith("/api/"):
        return False  # static files
    if path.startswith("/api/_test/") or path == "/api/_test":
        return False
    return not (scope.get("method") == "GET" and path == "/api/events")


def _base_url(scope: dict[str, Any]) -> str | None:
    scheme = scope.get("scheme") or "http"
    host = None
    for name, value in scope.get("headers") or []:
        if name.lower() == b"host":
            host = value.decode("latin-1")
            break
    if not host:
        server = scope.get("server")
        if not server:
            return None
        host = f"{server[0]}:{server[1]}" if server[1] else str(server[0])
    return f"{scheme}://{host}"


class ActivityMiddleware:
    """Pure ASGI: touches `idle` on every http request except ``GET /api/events``,
    ``/api/_test/*`` and non-``/api`` paths (static files). Added inside `LocalOnlyMiddleware`,
    so only loopback requests reach it."""

    def __init__(self, app: Any, idle: IdleClock) -> None:
        self.app = app
        self.idle = idle

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope.get("type") == "http" and _counts(scope):
            self.idle.touch(_base_url(scope))
        await self.app(scope, receive, send)


def deterministic_pass(folder: Path, now: datetime, *, run_id: str) -> list[dict[str, Any]]:
    """The ledger entries it made: stale after 14 days without use, archived after 30 (T8)."""
    raise NotImplementedError("M18 T8")


def due(learning: dict[str, Any], usage: dict[str, Any], now: datetime, idle: timedelta, busy: bool) -> bool:
    """Curator on; not busy; idle >= curatorIdleHours; lastRunAt None or >= curatorEveryDays ago (T8)."""
    raise NotImplementedError("M18 T8")


class CuratorBusy(Exception):
    """Tidying up already runs for this agent (409)."""

    status = 409


class Curator:
    """One per app: ticks every ``CURATOR_TICK`` seconds while running (T8)."""

    def __init__(self, announce: Callable[[ChangeEvent], None], idle: IdleClock, reviews: ReviewRunner,
                 space_root: Path, space_name: str, clock: Callable[[], datetime],
                 claude_path: Callable[[], str | None]) -> None:
        self.announce = announce
        self.idle = idle
        self.reviews = reviews
        self.space_root = Path(space_root)
        self.space_name = space_name
        self.clock = clock
        self.claude_path = claude_path
        self._turns = 0
        self._lock = threading.Lock()

    def busy_turns(self, delta: int) -> None:
        """`api_ai`: +1 when a turn starts, -1 when it ends."""
        with self._lock:
            self._turns = max(0, self._turns + delta)

    async def tick(self) -> list[str]:
        """The agent ids it ran for (T8)."""
        return []

    async def tidy_now(self, agent: AgentRecord, api_url: str) -> dict[str, Any]:
        """"Tidy up now": the consolidation run once, as a task; ``{"runId"}``; `CuratorBusy` (T8)."""
        raise NotImplementedError("M18 T8")

    def state(self, agent: AgentRecord) -> dict[str, Any]:
        """CuratorState (T8)."""
        return {"lastRunAt": None, "nextDueAt": None, "running": False, "report": None}

    def start(self) -> None:
        """Start the ticking task (T8)."""
        return None

    async def stop(self) -> None:
        """Stop the ticking task (T8)."""
        return None
