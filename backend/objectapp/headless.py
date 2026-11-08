"""The headless agent chat (M20): one local agent turn with no client stream.

`run_chat` runs one turn of a local agent the way M17's chat route does (an agent run built by
`agentrun.build_run`, through `ai.run_turn`), but nobody watches it: the reply comes back as a
`HeadlessResult`. M20's delegation uses it, and M21's schedules call it too, so these
transcripts are written in one place.

- The turn gets its own transcript in the agent's ``sessions/`` (header keys from `header`:
  M20's ``delegated``, ``delegated_from`` and ``from_chat``; M21 adds ``schedule``), the user
  line when it starts and the tool lines plus the answer (or the error) in one write when it
  ends. ``stopped: true`` marks an answer cut short by the timeout or by `stop`.
- Its token is an ephemeral ``read-write`` token stamped with the agent, the chat and the
  `purpose`, dropped when the turn ends (as is the run's skill-read memo).
- No review is started: the purposes callers pass (``"delegate"``, ``"schedule"``) are never in
  M18's ``REVIEW_PURPOSES``, and this module never calls ``ReviewRunner.after_turn``.

Writes nothing in a space. Imports no network client.
"""

from __future__ import annotations

import asyncio
import contextlib
import shutil
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from . import agentrun, agentskills, ai, transcripts
from . import reviews as review_hooks
from .agentmodel import AgentError
from .appstate import state_dir
from .tokens import TokenStore
from .watcher import ChangeEvent

if TYPE_CHECKING:
    from .agents import AgentRecord

__all__ = ["STOP_POLL", "HeadlessResult", "run_chat"]

STOP_POLL = 0.5
"""Seconds between two calls of the caller's ``stop()`` (our number)."""


@dataclass
class HeadlessResult:
    chat_id: str
    state: Literal["done", "error", "stopped"]
    """``"stopped"``: the timeout or ``stop()`` closed the run."""
    text: str
    """The whole reply, or the text shown so far."""
    session_id: str | None
    model: str | None
    error: str | None
    """The error event's message."""
    tool_lines: list[dict[str, Any]] = field(default_factory=list)
    """This turn's transcript tool lines (M16's paired events)."""


def _now() -> str:
    moment = datetime.now(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


class _Seen:
    """What the turn streamed: the tool calls paired by id, the text, the session id."""

    def __init__(self) -> None:
        self.tools: dict[str, dict[str, Any]] = {}
        self.texts: list[str] = []
        self.session_id: str | None = None

    def see(self, event: dict[str, Any]) -> None:
        kind = event.get("type")
        if kind == "session":
            self.session_id = event.get("sessionId") or self.session_id
        elif kind == "text":
            self.texts.append(str(event.get("text") or ""))
        elif kind == "tool":
            tid = str(event.get("id") or "")
            line = self.tools.get(tid)
            if line is None:
                line = self.tools[tid] = {
                    "type": "tool", "id": tid, "name": str(event.get("name") or ""),
                    "input": event.get("input"), "result": None, "isError": False, "at": _now(),
                }
            if "result" in event:
                line["result"] = event.get("result")
                line["isError"] = bool(event.get("isError"))

    def shown(self) -> str:
        return "".join(self.texts)

    def answer(self, done: dict[str, Any] | None) -> str:
        """As M17's chat route: with tool steps every streamed text joined, else ``done.text``
        (or the streamed text when it is empty)."""
        if self.tools or done is None:
            return self.shown()
        return str(done.get("text") or "") or self.shown()


def _agent_name(target: AgentRecord) -> str:
    name = target.data.get("name")
    return name if isinstance(name, str) and name else target.id


async def run_chat(
    target: AgentRecord,
    *,
    settings: dict[str, Any],
    space_root: Path,
    space_name: str,
    space_key: str | None,
    api_url: str,
    prompt: str,
    title: str,
    purpose: str,
    model: str | None,
    timeout: float,
    header: dict[str, Any] | None = None,
    stop: Callable[[], Awaitable[bool]] | None = None,
    announce: Callable[[ChangeEvent], None] | None = None,
    scope: str = "read-write",
    budget: int | None = None,
) -> HeadlessResult:
    """One turn of the local agent `target` with `prompt`, recorded as a new chat.

    Raises `agentrun.RunRefused` before anything is written when Claude Code isn't found
    (`ai.NOT_FOUND`), the default agent's folder can't be made, or the folder is nested in (or
    holds) a fenced folder. The run may last `timeout` seconds (``ai.Turn.timeout``); reaching
    it, or ``stop()`` answering True (polled every `STOP_POLL` seconds), stops the run's process
    tree and ends the result ``"stopped"``. `scope` and `budget` are the run token's: a delegated
    run passes its caller's, so it is never stronger than the turn that asked for it.
    """
    from .agents import AgentRegistry

    claude = await asyncio.to_thread(ai.find_claude, settings.get("claudePath"))
    if claude is None:
        raise agentrun.RunRefused(ai.NOT_FOUND)
    registry = AgentRegistry()
    if target.default and not target.exists:  # the default agent's first write makes its folder
        try:
            target = await asyncio.to_thread(registry.ensure_default)
        except AgentError as exc:
            raise agentrun.RunRefused(exc.message) from exc
    name = _agent_name(target)
    folder = Path(target.folder)
    chat_id = transcripts.new_chat_id()
    state = state_dir()

    def scope_for(secret: str) -> agentrun.RunScope:
        return agentrun.RunScope(
            agent=target, space_root=space_root, space_name=space_name, api_url=api_url,
            token=secret, write=scope == "read-write", chat_id=chat_id, purpose=purpose, state=state,
        )

    def check() -> None:
        """A nesting problem, found before anything is written (as M17's chat route does)."""
        cmd = agentrun.build_run(scope_for(""), claude=claude, model=model, resume=None)
        shutil.rmtree(cmd.tmp, ignore_errors=True)

    await asyncio.to_thread(check)

    def written() -> None:
        if announce is not None:
            announce(ChangeEvent("agentChats", target.id, chat_id, origin=None))

    def begin() -> None:
        now = _now()
        transcripts.start(
            folder, chat_id, agent_id=target.id, title=title, space_name=space_name,
            space_key=space_key, created_at=now, **(header or {}),
        )
        transcripts.append(folder, chat_id, [{"type": "user", "text": prompt, "at": now, "contextPaths": []}])

    await asyncio.to_thread(begin)
    written()

    token_record, secret = TokenStore(space_root).ephemeral(
        name, scope, agent=target.id, chat=chat_id, purpose=purpose, budget=budget
    )
    seen = _Seen()
    last: dict[str, Any] | None = None
    stopped = False
    gen = None
    pending: asyncio.Future | None = None
    try:
        scope = scope_for(secret)
        turn = ai.Turn(
            claude=claude,
            mode="chat",
            prompt_resume=None,
            prompt_fresh=ai.build_prompt("chat", prompt, ai.ContextPack(), None, [], intro=False),
            session_id=None,
            model=model,
            api_url=api_url,
            token=secret,
            timeout=timeout,
            run=lambda resume: agentrun.build_run(scope, claude=claude, model=model, resume=resume),
        )
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        gen = ai.run_turn(turn)
        while True:
            pending = asyncio.ensure_future(gen.__anext__())
            while True:
                done, _ = await asyncio.wait({pending}, timeout=STOP_POLL)
                if done:
                    break
                if stop is not None and await stop():
                    stopped = True
                    break
            if stopped:
                break
            try:
                event = pending.result()
            except StopAsyncIteration:
                break
            finally:
                if pending.done():
                    pending = None
            seen.see(event)
            if event.get("type") == "tool":  # only tool events can touch a file
                await asyncio.to_thread(review_hooks.watch, event, folder=folder, memo_key=token_record.id)
            else:
                review_hooks.watch(event, folder=folder, memo_key=token_record.id)
            if event.get("type") in ("done", "error"):
                last = event
                if event.get("type") == "error" and loop.time() >= deadline:
                    stopped = True  # run_turn's own deadline (this run's timeout) ended it
                break
    finally:
        if pending is not None and not pending.done():
            pending.cancel()  # run_turn's own cleanup stops the CLI's process tree
            with contextlib.suppress(BaseException):
                await pending
        if gen is not None:
            with contextlib.suppress(BaseException):
                await asyncio.shield(gen.aclose())
        TokenStore.drop_ephemeral(secret)
        agentskills.MEMO.forget(token_record.id)

    if last is None:
        stopped = True
    tool_lines = list(seen.tools.values())
    if stopped:
        result = HeadlessResult(chat_id=chat_id, state="stopped", text=seen.shown(), session_id=seen.session_id,
                                model=model, error=None, tool_lines=tool_lines)
    elif last is not None and last.get("type") == "error":
        result = HeadlessResult(chat_id=chat_id, state="error", text=seen.shown(), session_id=seen.session_id,
                                model=model, error=str(last.get("message") or ""), tool_lines=tool_lines)
    else:
        result = HeadlessResult(chat_id=chat_id, state="done", text=seen.answer(last),
                                session_id=(last or {}).get("sessionId") or seen.session_id,
                                model=model, error=None, tool_lines=tool_lines)

    def finish() -> None:
        lines: list[dict[str, Any]] = list(tool_lines)
        now = _now()
        if result.state == "error":
            lines.append({"type": "error", "message": result.error or "", "at": now})
        else:
            line: dict[str, Any] = {"type": "assistant", "text": result.text, "at": now, "model": model,
                                    "sessionId": result.session_id}
            if result.state == "stopped":
                line["stopped"] = True
            lines.append(line)
        transcripts.append(folder, chat_id, lines)

    with contextlib.suppress(OSError):
        await asyncio.shield(asyncio.to_thread(finish))
        written()
    return result
