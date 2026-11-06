"""The curator (M18, spec section 5): the idle clock, the deterministic pass, the optional
consolidation run and the scheduler.

- The deterministic pass (no model): an agent-made skill not used for `STALE_DAYS` days is
  marked stale, for `ARCHIVE_DAYS` days archived (moved to ``skills-archive/``, restorable).
  Pinned skills, skills Gene wrote (``created_by`` other than ``agent``) and skills a schedule
  uses (`agentskills.SCHEDULE_SKILLS`) are never touched; when that hook raises, nothing of that
  agent is touched this run. A never-used skill counts from its ``createdAt``.
- The optional consolidation run (off by default; "Tidy up now" runs it once): a ``claude -p``
  run built by `agentrun.build_run` (purpose ``"curator"``) and run by `ai.run_turn`, with only
  the three skill tools, a budget of `CURATOR_MAX_STEPS` tool steps, the agent's default model
  and ``--no-session-persistence``; its final text (at most `REPORT_MAX` characters) is the report.
- `Curator` checks every `CURATOR_TICK` seconds and runs for each due local agent; it skips while
  "Hide AI features" is on.

Every change is a ledger entry (source ``{"kind": "curator", "run": <run id>}``), so it is
undoable. Curator state lives only in ``usage.json`` (``curator.lastRunAt``,
``lastConsolidatedAt`` and ``report``).

Idle means no request to ``/api`` other than the events stream (``GET /api/events``) and the
test hooks (``/api/_test/*``), measured with the space's clock (so ``OBJECT_CLOCK_FILE`` moves it
in tests); a running turn or review counts as busy. No network client.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import agentrun, agentskills, ai, ledger
from .ids import new_ulid
from .learningmodel import ARCHIVE_DAYS, CURATOR_MAX_STEPS, CURATOR_TICK, STALE_DAYS, effective_learning
from .tokens import TokenStore

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

log = logging.getLogger(__name__)

CONSOLIDATE_PROMPT: str = (
    "Tidy up your skills.\n\n"
    "Use `skills_list` and `skill_view` to find skills that overlap. Merge each overlapping group "
    "into one broader skill: patch the broadest one (or create one only if none fits), then "
    "archive each absorbed skill with `absorbed_into` naming the one it went into. Never archive "
    "a pinned skill or one you didn't write. Don't change skills that don't overlap.\n\n"
    "End with a short report: what you merged and why, in at most ten lines."
)
"""Our text. Its first line is what the fake claude keys its curator actions on."""

CURATOR_TOOLS = ("skills_list", "skill_view", "skill_manage")
"""The agent tools a consolidation run may use."""
REPORT_MAX = 4_000
"""Characters of the consolidation run's final text kept as the report (our number)."""
BUSY_MESSAGE = "Tidying up is already running."


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


# -- dates -----------------------------------------------------------------------------------------


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def _iso(moment: datetime) -> str:
    moment = _aware(moment).astimezone(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _parse(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return _aware(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError:
        return None


# -- usage.json ------------------------------------------------------------------------------------


def _usage(folder: Path) -> tuple[dict[str, Any], bool]:
    return agentskills._read_usage(Path(folder))


def _curator_block(usage: dict[str, Any]) -> dict[str, Any]:
    cur = usage.get("curator")
    return cur if isinstance(cur, dict) else {}


def _set_curator(folder: Path, **fields: Any) -> None:
    """Write `fields` into usage.json's ``curator`` object (unknown keys kept; an unreadable
    file is left alone)."""

    def change(usage: dict[str, Any]) -> bool:
        cur = usage.get("curator")
        if not isinstance(cur, dict):
            cur = usage["curator"] = {"lastRunAt": None, "lastConsolidatedAt": None, "report": None}
        cur.update(fields)
        return True

    with agentskills._lock(Path(folder)):
        agentskills._update_usage(Path(folder), change, strict=False)


# -- the deterministic pass ------------------------------------------------------------------------


def _source(agent_id: str | None, run_id: str) -> dict[str, Any]:
    return {"kind": "curator", "agentId": agent_id, "chatId": None, "run": run_id}


def deterministic_pass(folder: Path, now: datetime, *, run_id: str,
                       agent_id: str | None = None) -> list[dict[str, Any]]:
    """The ledger entries it made: stale after 14 days without use (from lastUsed, else
    createdAt), archived after 30. Never: pinned skills, ``created_by`` other than ``agent``,
    `agentskills.SCHEDULE_SKILLS`, a never-used skill younger than 14 days. When the schedule hook
    raises, the pass changes nothing for that agent this run and logs why (fail safe). A skill
    with neither date gets ``createdAt`` = `now` (the first time the curator saw it)."""
    folder = Path(folder)
    now = _aware(now)
    try:
        scheduled = set(agentskills.SCHEDULE_SKILLS(folder))
    except Exception as exc:  # noqa: BLE001 - M21's index can't be read: touch nothing
        log.warning("curator: left %s alone, the skills its schedules use can't be read: %s", folder, exc)
        return []
    source = _source(agent_id, run_id)
    made: list[dict[str, Any]] = []
    unseen: list[str] = []
    for info in agentskills.list_skills(folder):
        if info.pinned or info.created_by != "agent" or info.name in scheduled:
            continue
        since = _parse(info.last_used) or _parse(info.created_at)
        if since is None:
            unseen.append(info.name)
            continue
        age = now - since
        try:
            if age >= timedelta(days=ARCHIVE_DAYS):
                out = agentskills.archive(folder, info.name, source=source)
            elif age >= timedelta(days=STALE_DAYS) and info.state != "stale":
                out = agentskills.set_state(folder, info.name, "stale", source=source)
            else:
                continue
        except (agentskills.SkillError, OSError) as exc:
            log.warning("curator: left the skill %s alone: %s", info.name, exc)
            continue
        entry_id = out.get("entryId")
        if entry_id:
            with contextlib.suppress(KeyError):
                made.append(ledger.get(folder, entry_id))
    if unseen:
        stamp = _iso(now)

        def change(usage: dict[str, Any]) -> bool:
            for name in unseen:
                item = agentskills._entry_for(usage, name)
                if not item.get("createdAt"):
                    item["createdAt"] = stamp
            return True

        with agentskills._lock(folder):
            agentskills._update_usage(folder, change, strict=False)
    return made


def due(learning: dict[str, Any], usage: dict[str, Any], now: datetime, idle: timedelta, busy: bool) -> bool:
    """Curator on; not busy; idle >= curatorIdleHours; lastRunAt is None or now - lastRunAt >=
    curatorEveryDays."""
    if not learning.get("curator") or busy:
        return False
    if idle < timedelta(hours=float(learning.get("curatorIdleHours") or 0)):
        return False
    last = _parse(_curator_block(usage).get("lastRunAt")) if isinstance(usage, dict) else None
    if last is None:
        return True
    return _aware(now) - last >= timedelta(days=float(learning.get("curatorEveryDays") or 0))


class CuratorBusy(Exception):
    """Tidying up already runs for this agent (409)."""

    status = 409

    def __init__(self, message: str = BUSY_MESSAGE) -> None:
        super().__init__(message)
        self.message = message


def _device_settings() -> dict[str, Any]:
    from .settings import read

    try:
        return read()[0]
    except Exception:  # noqa: BLE001 - an unreadable settings file: the defaults
        return {}


# -- the curator -----------------------------------------------------------------------------------


class Curator:
    """One per app: checks every `CURATOR_TICK` seconds while running."""

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
        self._running: set[str] = set()
        """Agent ids a tick's run or "Tidy up now" runs for."""
        self._ticking = False
        self._tasks: set[asyncio.Task[Any]] = set()
        self._ticker: asyncio.Task[None] | None = None

    def busy_turns(self, delta: int) -> None:
        """`api_ai`: +1 when a turn starts, -1 when it ends."""
        with self._lock:
            self._turns = max(0, self._turns + delta)

    def _busy(self) -> bool:
        """A chat turn, a review or a curator run is running."""
        with self._lock:
            if self._turns > 0 or self._running:
                return True
        return self.reviews.busy()

    def _claim(self, agent_id: str) -> bool:
        with self._lock:
            if agent_id in self._running:
                return False
            self._running.add(agent_id)
            return True

    def _release(self, agent_id: str) -> None:
        with self._lock:
            self._running.discard(agent_id)

    def _announce(self, agent_id: str, key: str) -> None:
        from .watcher import ChangeEvent

        with contextlib.suppress(Exception):  # an announcement never fails a run
            self.announce(ChangeEvent("agentLearning", agent_id, key, origin=None))

    # -- the tick ---------------------------------------------------------------------------------

    async def tick(self) -> list[str]:
        """The agent ids it ran for. For each due local agent with a folder: the deterministic
        pass, then the consolidation run when ``learning["consolidate"]`` and a base URL is known;
        then usage.json ``curator.lastRunAt`` = now. Nothing while "Hide AI features" is on, or
        while another tick runs."""
        with self._lock:
            if self._ticking:
                return []
            self._ticking = True
        try:
            return await self._tick()
        finally:
            with self._lock:
                self._ticking = False

    async def _tick(self) -> list[str]:
        from .agents import AgentRegistry

        settings = await asyncio.to_thread(_device_settings)
        if settings.get("aiHidden"):
            return []
        try:
            agents = await asyncio.to_thread(AgentRegistry().list)
        except Exception as exc:  # noqa: BLE001 - the registry can't be read: try next tick
            log.warning("curator: the agents can't be listed: %s", exc)
            return []
        ran: list[str] = []
        for agent in agents:
            if not agent.exists or agent.missing or agent.read_only_reason:
                continue  # the default agent before its folder exists; a missing or read-only one
            usage, ok = await asyncio.to_thread(_usage, agent.folder)
            if not ok:
                continue  # usage.json can't be read: nothing to go on, and nowhere to record the run
            now = self.clock()
            learning = effective_learning(agent.data)
            if not due(learning, usage, now, self.idle.idle_for(), self._busy()):
                continue
            if not self._claim(agent.id):
                continue
            try:
                await self._run_for(agent, learning, settings, now)
            except Exception as exc:  # noqa: BLE001 - one agent's failure never stops the tick
                log.warning("curator: the run for %s failed: %s", agent.id, exc)
                continue
            finally:
                self._release(agent.id)
            ran.append(agent.id)
        return ran

    async def _run_for(self, agent: AgentRecord, learning: dict[str, Any], settings: dict[str, Any],
                       now: datetime) -> None:
        run_id = new_ulid()
        folder = Path(agent.folder)
        made = await asyncio.to_thread(deterministic_pass, folder, now, run_id=run_id, agent_id=agent.id)
        for entry in made:
            self._announce(agent.id, str(entry.get("id")))
        base = self.idle.base_url
        if learning.get("consolidate") and base:
            await self._consolidate(agent, run_id, base, settings)
        await asyncio.to_thread(_set_curator, folder, lastRunAt=_iso(now))
        self._announce(agent.id, run_id)

    # -- the consolidation run --------------------------------------------------------------------

    async def _consolidate(self, agent: AgentRecord, run_id: str, api_url: str,
                           settings: dict[str, Any] | None = None) -> str | None:
        """Run the consolidation once; the report written, or None (no claude, or it failed)."""
        from . import agents as agents_mod
        from .agents import AgentRegistry

        if settings is None:
            settings = await asyncio.to_thread(_device_settings)
        claude = await asyncio.to_thread(self.claude_path)
        if not claude:
            log.warning("curator: no claude to tidy up %s with", agent.id)
            return None
        model = agents_mod.effective_model(agent, settings)
        name = str(agent.data.get("name") or agent.id)
        record, secret = TokenStore(self.space_root).ephemeral(
            name, "read", agent=agent.id, purpose="curator", run=run_id, budget=CURATOR_MAX_STEPS,
            tools=CURATOR_TOOLS,
        )
        text: str | None = None
        try:
            scope = agentrun.RunScope(
                agent=agent, space_root=self.space_root, space_name=self.space_name, api_url=api_url,
                token=secret, write=False, chat_id=new_ulid(), purpose="curator",
                state=AgentRegistry().state,
            )

            def run(_resume_id: str | None) -> agentrun.RunCommand:
                cmd = agentrun.build_run(scope, claude=claude, model=model, resume=None)
                cmd.args.append("--no-session-persistence")
                return cmd

            turn = ai.Turn(claude=claude, mode="chat", prompt_resume=None, prompt_fresh=CONSOLIDATE_PROMPT,
                           session_id=None, model=model, api_url=api_url, token=secret, run=run)
            async for event in ai.run_turn(turn):
                if event.get("type") == "done":
                    text = str(event.get("text") or "")
                elif event.get("type") == "error":
                    log.warning("curator: tidying up %s failed: %s", agent.id, event.get("message"))
        finally:
            TokenStore.drop_ephemeral(secret)
            agentskills.MEMO.forget(record.id)
        if text is None:
            return None
        report = text.strip()[:REPORT_MAX]
        at = _iso(self.clock())
        await asyncio.to_thread(_set_curator, Path(agent.folder), lastConsolidatedAt=at,
                                report={"at": at, "runId": run_id, "text": report})
        return report

    async def tidy_now(self, agent: AgentRecord, api_url: str) -> dict[str, Any]:
        """"Tidy up now": the consolidation run once, as a task; ``{"runId"}``; `CuratorBusy` when
        one runs for the agent."""
        if not self._claim(agent.id):
            raise CuratorBusy()
        run_id = new_ulid()

        async def go() -> None:
            try:
                await self._consolidate(agent, run_id, api_url)
            except Exception as exc:  # noqa: BLE001 - logged, never raised
                log.warning("curator: tidying up %s failed: %s", agent.id, exc)
            finally:
                self._release(agent.id)
                self._announce(agent.id, run_id)

        try:
            task = asyncio.get_running_loop().create_task(go())
        except BaseException:
            self._release(agent.id)
            raise
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return {"runId": run_id}

    async def wait_tidy(self, timeout: float = 30.0) -> bool:
        """Wait until no "Tidy up now" run is running (tests)."""
        tasks = [t for t in self._tasks if not t.done()]
        if not tasks:
            return True
        _done, pending = await asyncio.wait(tasks, timeout=timeout)
        return not pending

    # -- state ------------------------------------------------------------------------------------

    def state(self, agent: AgentRecord) -> dict[str, Any]:
        """CuratorState ``{lastRunAt, nextDueAt, running, report}``. Never writes."""
        usage, _ok = _usage(agent.folder) if agent.exists else ({}, True)
        cur = _curator_block(usage)
        learning = effective_learning(agent.data)
        last = _parse(cur.get("lastRunAt"))
        next_due = None
        if learning.get("curator") and last is not None:
            next_due = _iso(last + timedelta(days=float(learning.get("curatorEveryDays") or 0)))
        raw = cur.get("report")
        report = None
        if isinstance(raw, dict) and isinstance(raw.get("text"), str):
            report = {"at": str(raw.get("at") or ""), "runId": str(raw.get("runId") or ""), "text": raw["text"]}
        with self._lock:
            running = agent.id in self._running
        return {"lastRunAt": _iso(last) if last is not None else None, "nextDueAt": next_due,
                "running": running, "report": report}

    # -- the scheduler ----------------------------------------------------------------------------

    def start(self) -> None:
        """Start the ticking task (in the app's lifespan, on its loop)."""
        if self._ticker is not None and not self._ticker.done():
            return
        self._ticker = asyncio.get_running_loop().create_task(self._loop())

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(CURATOR_TICK)
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - a failed tick waits for the next one
                log.warning("curator: the tick failed: %s", exc)

    async def stop(self) -> None:
        """Stop the ticking task and any "Tidy up now" run (which stops its CLI)."""
        tasks = [t for t in (self._ticker, *self._tasks) if t is not None and not t.done()]
        self._ticker = None
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
