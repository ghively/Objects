"""Delegation: one agent hands a task to another, local or remote (M20, spec section 8).

- `delegate` runs one delegated turn. A local target runs headless (`headless.run_chat`, with
  ``purpose="delegate"``, the target's own model and `DELEGATE_TIMEOUT`); a remote target goes
  through ``remotechat.call_remote``. The answer's summary is the delegated agent's reply, cut at
  `DELEGATE_SUMMARY_CAP` characters + "…"; the transcript keeps the whole reply.
- The limits (spec section 8): at most `DELEGATE_MAX_AT_ONCE` delegations in flight per turn
  token (`LIMITER`; a 4th is refused, not queued), one level only (a delegated run has neither
  ``delegate`` nor ``remote_agent_call``, and the routes refuse its token: `is_delegated_chat`),
  no self-delegation. The delegated run is a turn of the target, with a token naming the
  target, so it can't write the caller's memory; the caller's folder is in its fence.
- `install` (idempotent; ``server.create_app`` calls it once after ``mcpgateway.install()``)
  registers two run contributors: ``"delegation"`` at 64 and ``"fence-remote"`` at 75.

Writes nothing in a space. Imports no network client.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from . import agentrun, headless, toolcatalog
from .aichat import default_title
from .appstate import space_key
from .remotemodel import DELEGATE_MAX_AT_ONCE, DELEGATE_SUMMARY_CAP, DELEGATE_TIMEOUT
from .watcher import ChangeEvent

if TYPE_CHECKING:
    from .agents import AgentRecord, AgentRegistry
    from .apictx import ApiContext
    from .tokens import TokenRecord

__all__ = [
    "BUSY",
    "DELEGATED_CHATS",
    "DELEGATE_PROMPT",
    "FLAT",
    "LIMITER",
    "SELF",
    "Busy",
    "DelegationError",
    "DelegationResult",
    "Limiter",
    "delegate",
    "delegate_prompt",
    "install",
    "is_delegated_chat",
    "state_name",
]

_CONTEXT_PARAGRAPH = "Context from {caller}:\n{context}\n\n"
DELEGATE_PROMPT = (
    "{caller}, another agent working for the same person, has handed you this task.\n\nGoal: {goal}\n\n"
    + _CONTEXT_PARAGRAPH
    + "Do it with your own tools. When you are done, reply with a summary for "
    "{caller} of what you did and found, at most {cap:,} characters."
)  # our text; the Context paragraph only when there is context

SELF = "An agent can't delegate to itself."  # our string
FLAT = "A delegated agent can't delegate further."  # our string
BUSY = f"At most {DELEGATE_MAX_AT_ONCE} delegations at once per turn."  # our string
CANT_RUN = "{name} can't run: {reason}"  # our string
TOO_LONG = "{name} didn't finish within {n} seconds; its chat so far is kept."  # our string

DELEGATE_TOOL = f"mcp__{toolcatalog.AGENT_SERVER}__delegate"
REMOTE_CALL_TOOL = f"mcp__{toolcatalog.AGENT_SERVER}__remote_agent_call"
FLAT_TOOLS = (DELEGATE_TOOL, REMOTE_CALL_TOOL)
"""The two tools that hand work to another agent: a delegated run has neither."""


class Busy(Exception):
    """`DELEGATE_MAX_AT_ONCE` delegations of this turn are already in flight."""


class DelegationError(Exception):
    """A delegation that can't run or didn't finish: the route's status and detail."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class DelegationResult:
    agent: AgentRecord
    chat_id: str
    state: str
    summary: str
    cut: bool


class Limiter:
    """Delegations in flight per turn token (thread-safe)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counts: dict[str, int] = {}

    def enter(self, turn_token_id: str) -> None:
        """Count one more; raises `Busy` when `DELEGATE_MAX_AT_ONCE` are already in flight."""
        with self._lock:
            n = self._counts.get(turn_token_id, 0)
            if n >= DELEGATE_MAX_AT_ONCE:
                raise Busy(BUSY)
            self._counts[turn_token_id] = n + 1

    def leave(self, turn_token_id: str) -> None:
        with self._lock:
            n = self._counts.get(turn_token_id, 0) - 1
            if n > 0:
                self._counts[turn_token_id] = n
            else:
                self._counts.pop(turn_token_id, None)

    def in_flight(self, turn_token_id: str) -> int:
        with self._lock:
            return self._counts.get(turn_token_id, 0)


LIMITER = Limiter()

DELEGATED_CHATS: set[str] = set()
"""The chat ids of delegated runs in flight (guarded by `_CHATS_LOCK`)."""
_CHATS_LOCK = threading.Lock()


def is_delegated_chat(chat_id: str | None) -> bool:
    """Whether `chat_id` is a delegated run's chat that is still running."""
    if not chat_id:
        return False
    with _CHATS_LOCK:
        return chat_id in DELEGATED_CHATS


def _mark(chat_id: str) -> None:
    with _CHATS_LOCK:
        DELEGATED_CHATS.add(chat_id)


def _unmark(chat_id: str | None) -> None:
    if chat_id:
        with _CHATS_LOCK:
            DELEGATED_CHATS.discard(chat_id)


def delegate_prompt(caller: str, goal: str, context: str, cap: int = DELEGATE_SUMMARY_CAP) -> str:
    """`DELEGATE_PROMPT` filled in; without `context` its paragraph is left out."""
    template = DELEGATE_PROMPT if context.strip() else DELEGATE_PROMPT.replace(_CONTEXT_PARAGRAPH, "")
    return template.format(caller=caller, goal=goal, context=context, cap=cap)


def state_name(state: str | None) -> str:
    """An A2A state as the tools answer it: ``TASK_STATE_INPUT_REQUIRED`` -> ``input-required``."""
    text = str(state or "").strip()
    if text.upper().startswith("TASK_STATE_"):
        text = text[len("TASK_STATE_"):]
    return text.lower().replace("_", "-") or "completed"


def _name(record: AgentRecord) -> str:
    name = record.data.get("name")
    return name if isinstance(name, str) and name else record.folder.name


def _cap(text: str, cap: int) -> tuple[str, bool]:
    if len(text) > cap:
        return text[:cap] + "…", True
    return text, False


def _settings() -> dict[str, Any]:
    from .settings import read as read_settings
    from .space import ReadOnly

    try:
        return read_settings()[0]
    except (ReadOnly, OSError, ValueError):
        return {}


async def _until_done(task: asyncio.Future, disconnected: Callable[[], Awaitable[bool]]) -> bool:
    """Wait for `task`; True when `disconnected()` said the caller went away first (the task is
    then cancelled)."""
    while True:
        done, _ = await asyncio.wait({task}, timeout=headless.STOP_POLL)
        if done:
            return False
        if await disconnected():
            task.cancel()
            with contextlib.suppress(BaseException):
                await task
            return True


async def delegate(
    ctx: ApiContext,
    registry: AgentRegistry,
    caller: AgentRecord,
    caller_token: TokenRecord,
    target: AgentRecord,
    goal: str,
    context: str,
    *,
    api_url: str,
    disconnected: Callable[[], Awaitable[bool]],
) -> DelegationResult:
    """Run one delegated turn of `target` for `caller`. Raises `DelegationError` (422 self, 409
    can't run, 504 too long, 502 a remote's trouble) or `Busy` (429)."""
    if target.id == caller.id:
        raise DelegationError(422, SELF)
    name = _name(target)
    space = ctx.space
    key = space_key(space.root)
    timeout = DELEGATE_TIMEOUT
    if target.kind != "remote":
        if target.missing:
            raise DelegationError(409, CANT_RUN.format(name=name, reason=f"This agent's folder is missing: {target.folder}"))
        if target.read_only_reason:
            raise DelegationError(409, CANT_RUN.format(name=name, reason=target.read_only_reason))
    LIMITER.enter(caller_token.id)
    chat_id: str | None = None
    try:
        prompt = delegate_prompt(_name(caller), goal, context)
        if target.kind == "remote":
            return await _delegate_remote(target, name, prompt, caller, caller_token, space.name, key,
                                          timeout, disconnected)

        def announce(event: ChangeEvent) -> None:
            nonlocal chat_id
            if chat_id is None:
                chat_id = str(event.version)
                _mark(chat_id)  # before the run starts: its token's requests to the routes are refused
            ctx.announce(event)

        went_away = False

        async def stop() -> bool:
            nonlocal went_away
            if await disconnected():
                went_away = True
            return went_away

        settings = await asyncio.to_thread(_settings)
        from .agents import effective_model

        try:
            result = await headless.run_chat(
                target, settings=settings, space_root=space.root, space_name=space.name, space_key=key,
                api_url=api_url, prompt=prompt, title=default_title([{"role": "user", "text": goal}]),
                purpose="delegate", model=effective_model(target, settings), timeout=timeout,
                header={"delegated": True, "delegated_from": caller.id, "from_chat": caller_token.chat},
                stop=stop, announce=announce,
            )
        except agentrun.RunRefused as exc:
            raise DelegationError(409, CANT_RUN.format(name=name, reason=exc.message)) from exc
        if result.state == "stopped" and not went_away:
            raise DelegationError(504, TOO_LONG.format(name=name, n=f"{timeout:g}"))
        if result.state == "done":
            summary, cut = _cap(result.text, DELEGATE_SUMMARY_CAP)
            return DelegationResult(agent=target, chat_id=result.chat_id, state="completed", summary=summary, cut=cut)
        summary, cut = _cap(result.error or result.text, DELEGATE_SUMMARY_CAP)
        return DelegationResult(agent=target, chat_id=result.chat_id, state="failed", summary=summary, cut=cut)
    finally:
        _unmark(chat_id)
        LIMITER.leave(caller_token.id)


async def _delegate_remote(target: AgentRecord, name: str, prompt: str, caller: AgentRecord,
                           caller_token: TokenRecord, space_name: str, key: str | None, timeout: float,
                           disconnected: Callable[[], Awaitable[bool]]) -> DelegationResult:
    from . import a2a, remotechat
    from .agentmodel import AgentError

    task = asyncio.ensure_future(remotechat.call_remote(
        target, prompt, context_id=None, task_id=None, timeout=timeout, delegated_from=caller.id,
        from_chat=caller_token.chat, space_name=space_name, space_key=key, cap=DELEGATE_SUMMARY_CAP,
    ))
    try:
        went_away = await _until_done(task, disconnected)
        if went_away:
            return DelegationResult(agent=target, chat_id="", state="canceled", summary="", cut=False)
        res = task.result()
    except a2a.A2AError as exc:
        if exc.status == 504:
            raise DelegationError(504, TOO_LONG.format(name=name, n=f"{timeout:g}")) from exc
        raise DelegationError(502, exc.message) from exc
    except AgentError as exc:
        raise DelegationError(exc.status, exc.message) from exc
    finally:
        if not task.done():
            task.cancel()
    state = state_name(res.state)
    if state == "timeout":
        raise DelegationError(504, TOO_LONG.format(name=name, n=f"{timeout:g}"))
    return DelegationResult(agent=target, chat_id=res.chat_id, state=state, summary=res.text, cut=bool(res.cut))


# -- run contributors ---------------------------------------------------------------------------


def delegation_contributor(scope: agentrun.RunScope, parts: agentrun.RunParts) -> None:
    """Order 64 ``delegation``: a ``delegate`` run loses ``delegate`` and ``remote_agent_call``
    (one level only); every run's MCP tool calls may last as long as a delegation, plus a minute."""
    if scope.purpose == "delegate":
        for tool in FLAT_TOOLS:
            while tool in parts.allowed:
                parts.allowed.remove(tool)
            if tool not in parts.disallowed:
                parts.disallowed.append(tool)
    parts.env["MCP_TOOL_TIMEOUT"] = str(int((DELEGATE_TIMEOUT + 60) * 1000))


def fence_remote_contributor(scope: agentrun.RunScope, parts: agentrun.RunParts) -> None:
    """Order 75 ``fence-remote``: every remote agent's folder is closed to the file tools."""
    from .agents import AgentRegistry

    for folder in AgentRegistry(scope.state).remote_folders():
        rp = agentrun.rule_path(folder)
        for rule in (f"Read({rp}/**)", f"Edit({rp}/**)"):
            if rule not in parts.deny_rules:
                parts.deny_rules.append(rule)


def install() -> None:
    """Register M20's two run contributors (again is harmless)."""
    agentrun.add_contributor("delegation", 64, delegation_contributor)
    agentrun.add_contributor("fence-remote", 75, fence_remote_contributor)
