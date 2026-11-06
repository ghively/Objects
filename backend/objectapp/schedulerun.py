"""M21 agent schedule runs: each due occurrence of a schedule rule (an M14 rule whose one action
is ``runAgent``) runs as a new headless chat of its agent, off the scheduler thread.

Plan: ``docs/superpowers/plans/2026-11-05-m21-schedules.md`` ("Running a schedule").

- `AgentJobs` is one worker thread per open space (the engine's ``agent_jobs``). It runs one job at
  a time, in the order they came due, so a run of up to `ai.TURN_TIMEOUT` seconds never delays the
  scheduler tick, other rules or a catch-up answer. `AgentJobs.stop` (the space closes) kills the
  running CLI and gives every occurrence it couldn't finish back to its rule's ``pending``
  (`AutomationScheduler.owe`), so the catch-up asks on the next open: nothing is lost and nothing
  runs without an answer.
- `run_schedule` runs one occurrence through M20's `headless.run_chat` (M17's ``agentrun`` and
  M10's ``ai.run_turn``) with the purpose `PURPOSE_FOR` gives (``"schedule"``, which isn't in M18's
  ``REVIEW_PURPOSES``, so no review starts), saves the reply as an AI Chat object in the space
  (`aichat.create_chat_object`) and announces it with a notification (only while "Activate
  notifications" is on).
- `install` registers the ``schedule-guidance`` contributor: a schedule run's appended prompt says
  no one is watching (`SCHEDULE_GUIDANCE`).

The run's own write in the space is the AI Chat object; what the agent's tools write goes through
Object's API like any agent turn. Imports no network client.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

from . import agentrun, ai, aimodels, headless, transcripts
from .agents import NOT_LISTED, AgentNotFound, AgentRegistry, effective_model
from .aichat import TITLE_MAX, create_chat_object
from .appstate import space_key
from .automations import expand_placeholders
from .automations_model import RunAgentAction
from .localtime import to_local
from .notify import Notifier
from .reminders import reminders_enabled
from .remotemodel import REMOTE_KIND
from .space import Space, now_stamp
from .watcher import ChangeEvent

if TYPE_CHECKING:
    from .automations import AutomationEngine

__all__ = [
    "HIDDEN",
    "NOTIFY_CHARS",
    "NO_URL",
    "PURPOSE_FOR",
    "SAVED",
    "SCHEDULE_GUIDANCE",
    "STOPPED",
    "AgentJob",
    "AgentJobs",
    "ScheduleResult",
    "chat_title",
    "install",
    "run_schedule",
]

log = logging.getLogger(__name__)

STOPPED = "Stopped because the space was closed."  # our strings
HIDDEN = "AI features are hidden (Settings > AI Assistant)."  # = api_ai's 403 text
NO_URL = "Object's address isn't known yet."
SAVED = "Saved the chat."
NOTIFY_CHARS = 200
SCHEDULE_GUIDANCE = ("This chat was started by a schedule. No one is watching it live, so don't ask "
                     "questions: do the task, then give the result in your reply. It is saved as a note.")

PURPOSE_FOR: Callable[[Space, str], str] = lambda space, rule_id: "schedule"  # noqa: E731
"""The run's ``RunScope`` purpose for a rule, read at call time (M24 sets it so its Desk sync rule
runs as ``"work-sync"``)."""

_SKILL_VIEW = "mcp__object-agent__skill_view"


@dataclass(frozen=True)
class AgentJob:
    rule_id: str
    instant: datetime
    """The occurrence (UTC)."""
    catch_up: bool


@dataclass
class ScheduleResult:
    status: Literal["ok", "failed", "skipped"]
    path: str | None
    """The AI Chat object's space path (``ok`` only)."""
    detail: str | None
    """`SAVED`, or the failure / skip message."""
    chat_id: str | None
    """The transcript's chat id."""
    used_skills: list[str] = field(default_factory=list)


# -- the contributor -------------------------------------------------------------------------


def schedule_guidance(scope: agentrun.RunScope, parts: agentrun.RunParts) -> None:
    """A schedule run's appended prompt says no one is watching (order 55)."""
    if scope.purpose == "schedule":
        parts.append_prompt.append(SCHEDULE_GUIDANCE)


def install() -> None:
    """Register the ``schedule-guidance`` contributor (again is harmless)."""
    agentrun.add_contributor("schedule-guidance", 55, schedule_guidance)


# -- one run ---------------------------------------------------------------------------------


def chat_title(name: str, instant: datetime, tz: Any) -> str:
    """``"<name> <local day YYYY-MM-DD>"``, the name cut so the whole fits `aichat.TITLE_MAX`."""
    day = to_local(instant, tz).date().isoformat()
    cut = " ".join(name.split())[: TITLE_MAX - len(day) - 1].rstrip()
    return f"{cut} {day}" if cut else day


def _now() -> str:
    return now_stamp(datetime.now(UTC))


def _used_skills(tool_lines: list[dict[str, Any]]) -> list[str]:
    """The skills a run loaded: each ``Skill`` call's input ``skill`` (else ``name``, else
    ``command``) and each ``skill_view`` call's ``name``."""
    out: list[str] = []
    for line in tool_lines:
        inp = line.get("input") if isinstance(line.get("input"), dict) else {}
        found: Any = None
        if line.get("name") == "Skill":
            found = next((inp[k] for k in ("skill", "name", "command")
                          if isinstance(inp.get(k), str) and inp[k].strip()), None)
        elif line.get("name") == _SKILL_VIEW:
            found = inp.get("name")
        if isinstance(found, str) and found.strip() and found.strip() not in out:
            out.append(found.strip())
    return out


def run_schedule(
    space: Space,
    rule_id: str,
    name: str,
    action: RunAgentAction,
    instant: datetime,
    catch_up: bool,
    *,
    registry: AgentRegistry,
    settings: dict[str, Any],
    base_url: str | None,
    notifier: Notifier,
    announce: Callable[[ChangeEvent], None],
    cancel: threading.Event,
) -> ScheduleResult:
    """One occurrence of an agent schedule, run as a new chat of its agent (see the module doc).
    A refused or failed run never raises: the result says why."""
    result, reply = _run(space, rule_id, name, action, instant, catch_up, registry=registry,
                         settings=settings, base_url=base_url, announce=announce, cancel=cancel)
    if result.status != "skipped" and reminders_enabled(space.root):
        body = " ".join(reply.split())[:NOTIFY_CHARS] if result.status == "ok" else f"Failed: {result.detail or ''}"
        try:
            notifier.send(name, body)
        except Exception:
            log.exception("Schedules: the notification of %s failed", rule_id)
    return result


def _run(
    space: Space,
    rule_id: str,
    name: str,
    action: RunAgentAction,
    instant: datetime,
    catch_up: bool,
    *,
    registry: AgentRegistry,
    settings: dict[str, Any],
    base_url: str | None,
    announce: Callable[[ChangeEvent], None],
    cancel: threading.Event,
) -> tuple[ScheduleResult, str]:
    """The run and the reply's text (for the notification)."""
    if settings.get("aiHidden"):
        return ScheduleResult("failed", None, HIDDEN, None), ""
    if ai.find_claude(settings.get("claudePath")) is None:
        return ScheduleResult("failed", None, ai.NOT_FOUND, None), ""
    if not base_url:
        return ScheduleResult("failed", None, NO_URL, None), ""
    try:
        agent = registry.get(action.agentId)
    except AgentNotFound as exc:
        return ScheduleResult("failed", None, exc.message or NOT_LISTED, None), ""
    if agent.kind == REMOTE_KIND:
        from .agentschedules import REMOTE_REFUSED

        return ScheduleResult("failed", None, REMOTE_REFUSED, None), ""
    if agent.missing:
        from .api_ai import MISSING_FOLDER  # late: the AI routes' module, for its message

        return ScheduleResult("failed", None, MISSING_FOLDER.format(path=agent.folder), None), ""
    if agent.read_only_reason:
        return ScheduleResult("failed", None, agent.read_only_reason, None), ""

    prompt = expand_placeholders(action.prompt, space, None, None, instant)
    model = aimodels.resolve_model(action.model, effective_model(agent, settings))
    title = chat_title(name, instant, space.tz)
    agent_name = str(agent.data.get("name") or agent.id)
    header = {"schedule": {"ruleId": rule_id, "name": name, "scheduledFor": now_stamp(instant),
                           "catchUp": catch_up}}

    async def stop() -> bool:
        return cancel.is_set()

    started = _now()
    try:
        res = asyncio.run(headless.run_chat(
            agent, settings=settings, space_root=space.root, space_name=space.name,
            space_key=space_key(space.root), api_url=base_url, prompt=prompt, title=title,
            purpose=PURPOSE_FOR(space, rule_id), model=model, timeout=ai.TURN_TIMEOUT, header=header,
            stop=stop, announce=announce,
        ))
    except agentrun.RunRefused as exc:
        return ScheduleResult("failed", None, exc.message, None), ""
    except Exception as exc:  # OSError from the transcript, a token or build error: logged failed
        log.exception("Schedules: the run of %s failed", rule_id)
        return ScheduleResult("failed", None, str(exc) or "The run failed.", None), ""
    used = _used_skills(res.tool_lines)
    if res.state == "stopped":
        detail = STOPPED if cancel.is_set() else (
            f"Claude Code took too long (over {ai.TURN_TIMEOUT:g} seconds) and was stopped.")
        return ScheduleResult("failed", None, detail, res.chat_id, used), ""
    if res.state == "error":
        return ScheduleResult("failed", None, res.error or "The run failed.", res.chat_id, used), ""

    messages = [{"role": "user", "text": prompt, "at": started},
                {"role": "assistant", "text": res.text, "at": _now()}]
    try:
        path, _version = create_chat_object(
            space, title=title, messages=messages, context_refs=[], session_id=res.session_id,
            agent_name=agent_name, origin=f"api:{agent_name}", announce=announce,
        )
    except Exception as exc:  # InvalidValue, ReadOnly, OSError: the run is logged failed
        log.exception("Schedules: saving the chat of %s failed", rule_id)
        detail = getattr(exc, "reason", None) or str(exc) or "The chat couldn't be saved."
        return ScheduleResult("failed", None, f"The chat couldn't be saved: {detail}", res.chat_id, used), ""
    folder = registry.get(agent.id).folder if agent.default else agent.folder
    try:
        transcripts.append(folder, res.chat_id, [{"type": "object", "path": path, "at": _now()}])
        announce(ChangeEvent("agentChats", agent.id, res.chat_id, origin=None))
    except (OSError, ValueError, AgentNotFound):
        log.exception("Schedules: the transcript of %s couldn't name its chat", rule_id)
    return ScheduleResult("ok", path, SAVED, res.chat_id, used), res.text


# -- the jobs --------------------------------------------------------------------------------


class AgentJobs:
    """One worker thread per open space; runs jobs one at a time, in the order they came due."""

    def __init__(
        self,
        engine: AutomationEngine,
        *,
        base_url: Callable[[], str | None],
        registry: Callable[[], AgentRegistry] = AgentRegistry,
    ) -> None:
        self.engine = engine
        self.base_url = base_url
        self.registry = registry
        self._cond = threading.Condition()
        self._queue: deque[AgentJob] = deque()
        self._running: AgentJob | None = None
        self._cancel: threading.Event | None = None
        self._interrupted: list[AgentJob] = []
        self._accepting = False
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        with self._cond:
            if self._thread is not None and self._thread.is_alive():
                return
            self._accepting = True
            self._interrupted = []
            self._thread = threading.Thread(target=self._work, name="object-agent-schedules", daemon=True)
            self._thread.start()

    def submit(self, job: AgentJob) -> bool:
        """Queue `job`. False when the same (rule, instant) is queued or running; while the jobs
        aren't running (the space is closing) the occurrence is owed to the catch-up instead."""
        key = (job.rule_id, job.instant)
        with self._cond:
            if self._running is not None and (self._running.rule_id, self._running.instant) == key:
                return False
            if any((j.rule_id, j.instant) == key for j in self._queue):
                return False
            if self._accepting:
                self._queue.append(job)
                self._cond.notify_all()
                return True
        self.engine.scheduler.owe(job.rule_id, [job.instant])
        return False

    def pending(self) -> int:
        """Jobs queued or running."""
        with self._cond:
            return len(self._queue) + (1 if self._running is not None else 0)

    def wait_idle(self, timeout: float) -> bool:
        """Wait until no job is queued or running (test hook). False on timeout."""
        deadline = time.monotonic() + timeout
        with self._cond:
            while self._queue or self._running is not None:
                left = deadline - time.monotonic()
                if left <= 0:
                    return False
                self._cond.wait(left)
        return True

    def stop(self, timeout: float = 5.0) -> None:
        """The space closes: queued jobs go back to their rules' ``pending``; the running one's CLI
        is killed (closing ``ai.run_turn``), it is logged failed with `STOPPED` and its occurrence
        is owed too."""
        with self._cond:
            self._accepting = False
            queued = list(self._queue)
            self._queue.clear()
            if self._cancel is not None:
                self._cancel.set()
            thread, self._thread = self._thread, None
            self._cond.notify_all()
        if thread is not None:
            thread.join(timeout)
        with self._cond:
            owed = [*self._interrupted, *queued]
            self._interrupted = []
            if self._running is not None and thread is not None and thread.is_alive():
                owed.append(self._running)  # still closing: its occurrence isn't lost either
            self._cond.notify_all()
        by_rule: dict[str, list[datetime]] = {}
        for job in owed:
            by_rule.setdefault(job.rule_id, []).append(job.instant)
        for rule_id, instants in by_rule.items():
            try:
                self.engine.scheduler.owe(rule_id, instants)
            except Exception:
                log.exception("Schedules: could not owe the stopped runs of %s", rule_id)

    def _work(self) -> None:
        me = threading.current_thread()
        while True:
            with self._cond:
                while not self._queue and self._accepting and self._thread is me:
                    self._cond.wait()
                if not self._accepting or self._thread is not me or not self._queue:
                    return
                job = self._queue.popleft()
                cancel = threading.Event()
                self._running, self._cancel = job, cancel
            status = "failed"
            try:
                run = self.engine.execute_agent_job(job, cancel)
                status = str(run.get("status") or "failed")
            except Exception as exc:  # the run is logged failed all the same, never lost unseen
                log.exception("Schedules: the run of %s failed", job.rule_id)
                try:
                    self.engine.log_failed_agent_job(job, str(exc) or "The run failed.")
                except Exception:
                    log.exception("Schedules: could not log the failed run of %s", job.rule_id)
            finally:
                with self._cond:
                    if cancel.is_set() and status != "ok":
                        self._interrupted.append(job)
                    self._running, self._cancel = None, None
                    self._cond.notify_all()
