"""Background reviews (M18, spec section 5): the two counters, the three prompts, the review
runner, the review contributor and the turn watcher.

After a chat turn's reply has been shown, `ReviewRunner.after_turn` looks at the chat's two
counters (user turns since the agent last used ``memory``, tool calls since it last used
``skill_manage``) and, when one reaches the agent's interval, starts a review: a separate
``claude -p`` run built by `agentrun.build_run` (purpose ``"review"``) and run by `ai.run_turn`,
with the chat's model (or the Learning tab's review model), the same system prompt and the
chat's messages, and one of three prompts. Nothing here calls a model any other way.

- With the chat's session id the review resumes it as a fork (``--resume <id> --fork-session
  --no-session-persistence``), so the chat's own session never gains the review's messages; when
  that fails, `ai.run_turn` replays the transcript in a fresh run.
- The review's token is ``read`` with a budget of `REVIEW_MAX_STEPS` tool steps and only the
  learning tools of its kinds; `review_contributor` cuts the CLI's allow list to the same tools
  plus Object's read tools, denies every built-in, and drops every folder MCP server.
- At most one review runs per chat and `REVIEW_CONCURRENCY` in all. A review never blocks or
  fails the next turn: it is an asyncio task nobody awaits, and its failure is shown, not raised.

Review state lives only in the chat's transcript, as two ``review`` lines (start and end, the
same ``id``); the counters are computed from the transcript, so they survive restarts. A review's
start resets the counters of its kinds whether or not anything was saved.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import agentrun, agentskills, ai, aimodels, ledger, toolcatalog, transcripts
from .ids import new_ulid
from .learningmodel import REVIEW_CONCURRENCY, REVIEW_MAX_STEPS, effective_learning
from .tokens import TokenStore

if TYPE_CHECKING:
    from .agentrun import RunParts, RunScope
    from .agents import AgentRecord
    from .watcher import ChangeEvent

__all__ = [
    "BOTH_PROMPT",
    "MEMORY_PROMPT",
    "MEMORY_TOOL",
    "REVIEW_PURPOSES",
    "SKILLS_PROMPT",
    "SKILL_TOOL",
    "Counters",
    "ReviewBusy",
    "ReviewRunner",
    "ReviewStatus",
    "counters",
    "due_kinds",
    "prompt_for",
    "review_contributor",
    "review_tools",
    "summary_text",
    "tool_short",
    "watch",
]

REVIEW_PURPOSES = frozenset({"chat"})
"""Turns that can trigger a review. ``delegate`` (M20) and ``schedule`` (M21) are not in it."""

MEMORY_TOOL = "memory"
SKILL_TOOL = "skill_manage"
SKILL_READ_TOOLS = ("skills_list", "skill_view")
CURATOR_TOOLS = ("skills_list", "skill_view", "skill_manage")
"""The agent tools a curator run may use (plan "Curator")."""

BUSY_MESSAGE = "This chat is already being reviewed."  # our string (the learn route's 409)
STOPPED_MESSAGE = "The review was stopped."  # our string
FAILED_MESSAGE = "The review failed."  # our string

_AGENT_PREFIX = f"mcp__{toolcatalog.AGENT_SERVER}__"
_MAX_HISTORY = 100
_MAX_HISTORY_TEXT = 200_000
"""A fresh replay carries at most the newest 100 messages within 200,000 characters (as
`api_ai` caps a turn's history)."""


def tool_short(name: str) -> str:
    """``"mcp__object-agent__memory"`` -> ``"memory"``; other names unchanged."""
    return name.removeprefix(_AGENT_PREFIX)


def _now() -> str:
    moment = datetime.now(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


# -- the counters ----------------------------------------------------------------------------------


@dataclass
class Counters:
    user_turns: int
    """User lines since the last ``memory`` tool line, or since the last review start whose kinds
    hold ``"memory"``."""
    tool_calls: int
    """Tool lines since the last ``skill_manage`` tool line, or since the last review start whose
    kinds hold ``"skills"``."""


def _kinds_of(line: dict[str, Any]) -> list[str]:
    kinds = line.get("kinds")
    return [k for k in kinds if isinstance(k, str)] if isinstance(kinds, list) else []


def counters(lines: list[dict[str, Any]]) -> Counters:
    """From `transcripts.raw_lines`: a call of the tool (successful or not) or a review start of
    that kind resets its counter."""
    user_turns = tool_calls = 0
    for line in lines:
        kind = line.get("type")
        if kind == "user":
            user_turns += 1
        elif kind == "tool":
            name = tool_short(str(line.get("name") or ""))
            if name == MEMORY_TOOL:
                user_turns = 0
            if name == SKILL_TOOL:
                tool_calls = 0
            else:
                tool_calls += 1
        elif kind == "review" and line.get("state") == "running":
            kinds = _kinds_of(line)
            if "memory" in kinds:
                user_turns = 0
            if "skills" in kinds:
                tool_calls = 0
    return Counters(user_turns=user_turns, tool_calls=tool_calls)


def due_kinds(c: Counters, learning: dict[str, Any]) -> list[str]:
    """``[]``, ``["memory"]``, ``["skills"]`` or ``["memory", "skills"]``; an interval of 0
    switches that review off."""
    out: list[str] = []
    memory_every = int(learning.get("memoryReviewEvery") or 0)
    skill_every = int(learning.get("skillReviewEvery") or 0)
    if memory_every > 0 and c.user_turns >= memory_every:
        out.append("memory")
    if skill_every > 0 and c.tool_calls >= skill_every:
        out.append("skills")
    return out


# -- the prompts (our text) ------------------------------------------------------------------------

_FIRST = "Look back over this chat."
_LAST = "Answer with one short line saying what you saved or changed, or that there was nothing to save."
_MEMORY_BODY = (
    "Decide whether anything in it is worth remembering for later chats: lasting facts about the "
    "work and environment (target `memory`) or about the person you work for, their preferences "
    "and corrections (target `user`). Skip what is already saved, one-off details, environment "
    "failures and dead ends. Keep entries short; if a file is near its cap, replace or remove "
    "entries to make room."
)
_SKILLS_BODY = (
    "Decide whether this chat taught you a way of working worth keeping as a skill. Prefer, in "
    "this order: patch a skill you used in this chat; patch an existing broader skill; add a "
    "reference, template or script file to an existing skill; only then create a new, broader "
    "skill (never one skill per chat). Turn the person's corrections into rules in the skill they "
    "concern. Never delete a skill. Skip environment failures and dead ends. Use `skills_list` and "
    "`skill_view` before you change anything."
)

MEMORY_PROMPT: str = f"{_FIRST}\n\n{_MEMORY_BODY} Use only `memory`.\n\n{_LAST}"
SKILLS_PROMPT: str = (
    f"{_FIRST}\n\n{_SKILLS_BODY} Use only `skills_list`, `skill_view`, `skill_manage` and "
    f"Object's read tools.\n\n{_LAST}"
)
BOTH_PROMPT: str = (
    f"{_FIRST}\n\nFirst, memory. {_MEMORY_BODY}\n\nThen, skills. {_SKILLS_BODY}\n\nUse only "
    f"`memory`, `skills_list`, `skill_view`, `skill_manage` and Object's read tools.\n\n{_LAST}"
)


def prompt_for(kinds: list[str]) -> str:
    """`BOTH_PROMPT` for both kinds, else the one kind's prompt."""
    if "memory" in kinds and "skills" in kinds:
        return BOTH_PROMPT
    return MEMORY_PROMPT if "memory" in kinds else SKILLS_PROMPT


# -- the tool lists --------------------------------------------------------------------------------


def _mcp(server: str, tool: str) -> str:
    return f"mcp__{server}__{tool}"


def _add(out: list[str], names: Iterable[str]) -> None:
    for n in names:
        if n not in out:
            out.append(n)


def _off_of(agent: AgentRecord) -> set[str]:
    off = agent.data.get("toolsOff") if isinstance(agent.data, dict) else None
    return {t for t in off if isinstance(t, str)} if isinstance(off, list) else set()


def _review_agent_tools(kinds: Iterable[str]) -> tuple[str, ...]:
    kinds = list(kinds)
    return (*((MEMORY_TOOL,) if "memory" in kinds else ()), *SKILL_READ_TOOLS, SKILL_TOOL)


def _builtins_and_writes(disallowed: list[str]) -> None:
    for entry in toolcatalog.BUILTINS:
        _add(disallowed, entry.cli)
    _add(disallowed, toolcatalog.ALWAYS_ALLOWED)  # the CLI's own Skill tool
    _add(disallowed, (_mcp(toolcatalog.OBJECT_SERVER, n) for n in toolcatalog.OBJECT_WRITE))


def review_tools(kinds: list[str], tools_off: Iterable[str]) -> tuple[list[str], list[str]]:
    """(allowed, disallowed) CLI names for a review of `kinds`.

    allowed: the read-only Object tools the agent has on, plus ``skills_list``, ``skill_view`` and
    ``skill_manage`` (and ``memory`` when ``"memory"`` is in `kinds`), each only when on.
    disallowed: every built-in, ``Skill``, every Object write tool, every other agent tool (and
    every switched-off one). ``ToolSearch`` is in neither list (M17's spike).
    """
    off = set(tools_off)
    allowed: list[str] = []
    disallowed: list[str] = []
    for name in toolcatalog.OBJECT_READ:
        tool = _mcp(toolcatalog.OBJECT_SERVER, name)
        _add(disallowed if tool in off else allowed, [tool])
    wanted = _review_agent_tools(kinds)
    for name in toolcatalog.AGENT_TOOLS:
        tool = _mcp(toolcatalog.AGENT_SERVER, name)
        _add(allowed if name in wanted and tool not in off else disallowed, [tool])
    _builtins_and_writes(disallowed)
    return allowed, disallowed


def _curator_tools(tools_off: Iterable[str]) -> tuple[list[str], list[str]]:
    """The curator run's lists: only the three skill tools (when on) allowed."""
    off = set(tools_off)
    allowed: list[str] = []
    disallowed: list[str] = []
    for name in toolcatalog.AGENT_TOOLS:
        tool = _mcp(toolcatalog.AGENT_SERVER, name)
        _add(allowed if name in CURATOR_TOOLS and tool not in off else disallowed, [tool])
    _builtins_and_writes(disallowed)
    _add(disallowed, (_mcp(toolcatalog.OBJECT_SERVER, n) for n in toolcatalog.OBJECT_READ))
    return allowed, disallowed


def _run_kinds(scope: RunScope) -> list[str]:
    """A review run's kinds, read from its token: ``memory`` only when the token may use it."""
    record = TokenStore(scope.space_root).verify(scope.token) if scope.token else None
    if record is None:
        return ["skills"]  # no token (a pre-flight build): the narrower set
    if record.tools is None or MEMORY_TOOL in record.tools:
        return ["memory", "skills"]
    return ["skills"]


def review_contributor(scope: RunScope, parts: RunParts) -> None:
    """Order 68 ``review-tools``: for ``review`` runs, `review_tools` replaces the lists; for
    ``curator`` runs, only the three skill tools are allowed. For both, every MCP server except
    ``object`` and ``object-agent`` is dropped (and its tools denied)."""
    if scope.purpose not in ("review", "curator"):
        return
    off = _off_of(scope.agent)
    if scope.purpose == "review":
        allowed, disallowed = review_tools(_run_kinds(scope), off)
    else:
        allowed, disallowed = _curator_tools(off)
    for name in [n for n in parts.mcp_servers if n not in (toolcatalog.OBJECT_SERVER, toolcatalog.AGENT_SERVER)]:
        del parts.mcp_servers[name]
        _add(disallowed, [f"mcp__{name}"])
    parts.allowed[:] = allowed
    parts.disallowed[:] = disallowed


# -- the status --------------------------------------------------------------------------------------


@dataclass
class ReviewStatus:
    id: str
    agent_id: str
    chat_id: str
    kinds: list[str]
    trigger: str
    """``"auto"`` | ``"manual"``"""
    state: str
    """``"running"`` | ``"done"`` | ``"failed"``"""
    started_at: str
    ended_at: str | None = None
    summary: str | None = None
    message: str | None = None
    entry_ids: list[str] = field(default_factory=list)

    def to_api(self) -> dict[str, Any]:
        """The ``ReviewStatus`` shape of ``types.ts``."""
        return {
            "id": self.id,
            "agentId": self.agent_id,
            "chatId": self.chat_id,
            "kinds": list(self.kinds),
            "trigger": self.trigger,
            "state": self.state,
            "startedAt": self.started_at,
            "endedAt": self.ended_at,
            "summary": self.summary,
            "message": self.message,
            "entryIds": list(self.entry_ids),
        }


class ReviewBusy(Exception):
    """A review already runs for this chat (409)."""

    status = 409

    def __init__(self, message: str = BUSY_MESSAGE) -> None:
        super().__init__(message)
        self.message = message


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def summary_text(entries: list[dict[str, Any]]) -> str:
    """"Saved 1 memory, updated 1 skill" and the like (zero parts left out, the first
    capitalised); none: "Nothing new to learn" (our strings)."""
    saved = changed = created = updated = archived = 0
    for e in entries:
        target, action = e.get("target"), e.get("action")
        if target in ("memory", "user"):
            if action == "add":
                saved += 1
            elif action in ("replace", "remove"):
                changed += 1
        elif target == "skill":
            if action == "create":
                created += 1
            elif action in ("patch", "edit", "write_file", "remove_file"):
                updated += 1
            elif action == "archive":
                archived += 1
    parts = []
    if saved:
        parts.append("saved " + _plural(saved, "memory", "memories"))
    if changed:
        parts.append("changed " + _plural(changed, "memory", "memories"))
    if created:
        parts.append("created " + _plural(created, "skill", "skills"))
    if updated:
        parts.append("updated " + _plural(updated, "skill", "skills"))
    if archived:
        parts.append("archived " + _plural(archived, "skill", "skills"))
    if not parts:
        return "Nothing new to learn"
    text = ", ".join(parts)
    return text[:1].upper() + text[1:]


def _statuses_from(agent_id: str, chat_id: str, lines: list[dict[str, Any]]) -> dict[str, ReviewStatus]:
    out: dict[str, ReviewStatus] = {}
    for line in lines:
        if line.get("type") != "review" or not isinstance(line.get("id"), str):
            continue
        rid = line["id"]
        status = out.get(rid)
        if status is None:
            status = out[rid] = ReviewStatus(
                id=rid, agent_id=agent_id, chat_id=chat_id, kinds=_kinds_of(line),
                trigger=str(line.get("trigger") or "auto"), state="running",
                started_at=str(line.get("at") or ""),
            )
            if line.get("state") == "running":
                continue
        state = line.get("state")
        if state in ("done", "failed"):
            status.state = state
            status.ended_at = str(line.get("at") or "") or None
            summary, message = line.get("summary"), line.get("message")
            status.summary = summary if isinstance(summary, str) else None
            status.message = message if isinstance(message, str) else None
            ids = line.get("entryIds")
            status.entry_ids = [i for i in ids if isinstance(i, str)] if isinstance(ids, list) else []
    return out


def _last_assistant(lines: list[dict[str, Any]]) -> dict[str, Any] | None:
    for line in reversed(lines):
        if line.get("type") == "assistant":
            return line
    return None


def _history(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The transcript's user and assistant texts, the newest that fit."""
    messages = [
        {"role": line["type"], "text": str(line.get("text") or "")}
        for line in lines
        if line.get("type") in ("user", "assistant")
    ]
    kept: list[dict[str, Any]] = []
    total = 0
    for m in reversed(messages[-_MAX_HISTORY:]):
        total += len(m["text"])
        if total > _MAX_HISTORY_TEXT:
            break
        kept.append(m)
    kept.reverse()
    return kept


# -- the runner ------------------------------------------------------------------------------------


class ReviewRunner:
    """One per app (`server.create_app`), shared by `api_ai` and `api_learning`."""

    def __init__(self, announce: Callable[[ChangeEvent], None], space_root: Path, space_name: str) -> None:
        self.announce = announce
        self.space_root = Path(space_root)
        self.space_name = space_name
        self._cond = threading.Condition()
        self._running: dict[tuple[str, str], ReviewStatus] = {}
        self._slots = threading.BoundedSemaphore(REVIEW_CONCURRENCY)
        self._tasks: set[asyncio.Task[None]] = set()
        self._tokens = TokenStore(self.space_root)

    # -- starting ---------------------------------------------------------------------------------

    def after_turn(self, *, agent: AgentRecord, chat_id: str, mode: str, purpose: str, chat_model: str | None,
                   session_id: str | None, api_url: str, claude: str) -> ReviewStatus | None:
        """Start at most one review for the chat, as an asyncio task never awaited. None while
        one runs for the chat, for ``mode != "chat"``, for a purpose outside `REVIEW_PURPOSES`,
        or when no kind is due (or its tool is switched off)."""
        if mode != "chat" or purpose not in REVIEW_PURPOSES:
            return None
        folder = Path(agent.folder)
        try:
            lines = transcripts.raw_lines(folder, chat_id)
        except (OSError, ValueError):
            return None
        kinds = due_kinds(counters(lines), effective_learning(agent.data))
        off = _off_of(agent)
        if _mcp(toolcatalog.AGENT_SERVER, MEMORY_TOOL) in off:
            kinds = [k for k in kinds if k != "memory"]
        if _mcp(toolcatalog.AGENT_SERVER, SKILL_TOOL) in off:
            kinds = [k for k in kinds if k != "skills"]
        if not kinds:
            return None
        try:
            return self._start(agent, chat_id, kinds, "auto", chat_model, session_id, api_url, claude)
        except OSError:
            return None

    def learn_now(self, *, agent: AgentRecord, chat_id: str, api_url: str, claude: str) -> ReviewStatus:
        """"Learn from this chat": kinds ``["memory", "skills"]``, trigger ``"manual"``, whatever
        the counters say; `ReviewBusy` when one runs for the chat. FileNotFoundError when the
        chat has no transcript."""
        lines = transcripts.raw_lines(Path(agent.folder), chat_id)
        last = _last_assistant(lines) or {}
        model = last.get("model") if isinstance(last.get("model"), str) else None
        status = self._start(agent, chat_id, ["memory", "skills"], "manual", model,
                             ai.valid_session(last.get("sessionId")), api_url, claude)
        if status is None:
            raise ReviewBusy()
        return status

    def _start(self, agent: AgentRecord, chat_id: str, kinds: list[str], trigger: str, chat_model: str | None,
               session_id: str | None, api_url: str, claude: str) -> ReviewStatus | None:
        key = (agent.id, chat_id)
        learning = effective_learning(agent.data)
        model = aimodels.resolve_model(learning.get("reviewModel"), chat_model)
        status = ReviewStatus(id=new_ulid(), agent_id=agent.id, chat_id=chat_id, kinds=list(kinds),
                              trigger=trigger, state="running", started_at=_now())
        with self._cond:
            if key in self._running:
                return None
            self._running[key] = status
        try:
            transcripts.append(Path(agent.folder), chat_id, [{
                "type": "review", "id": status.id, "state": "running", "kinds": list(kinds),
                "trigger": trigger, "model": model, "at": status.started_at,
            }])
        except BaseException:
            self._done(key)
            raise
        self._announce(agent.id, status.id)
        coro = self._run(status, agent, model, ai.valid_session(session_id), api_url, claude)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # called outside the app's loop (a worker thread): a loop of its own
            threading.Thread(target=asyncio.run, args=(coro,), daemon=True, name="object-review").start()
        else:
            task = loop.create_task(coro)
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
        return status

    # -- running ----------------------------------------------------------------------------------

    async def _run(self, status: ReviewStatus, agent: AgentRecord, model: str | None, session_id: str | None,
                   api_url: str, claude: str) -> None:
        folder = Path(agent.folder)
        try:
            while not self._slots.acquire(blocking=False):
                await asyncio.sleep(0.05)
            try:
                error = await self._review(status, agent, model, session_id, api_url, claude)
            finally:
                self._slots.release()
            if error is None:
                made = list(reversed(ledger.entries(folder, run=status.id, limit=10_000)))
                status.state = "done"
                status.summary = summary_text(made)
                status.entry_ids = [str(e.get("id")) for e in made]
            else:
                status.state, status.message = "failed", error
        except asyncio.CancelledError:
            status.state, status.message = "failed", STOPPED_MESSAGE
            raise
        except Exception as exc:  # noqa: BLE001 - a review's failure is shown, never raised
            status.state, status.message = "failed", str(exc) or FAILED_MESSAGE
        finally:
            self._finish(status, folder)

    async def _review(self, status: ReviewStatus, agent: AgentRecord, model: str | None, session_id: str | None,
                      api_url: str, claude: str) -> str | None:
        """Run the review; its error message, or None."""
        from .agents import AgentRegistry

        off = _off_of(agent)
        tools = tuple(t for t in _review_agent_tools(status.kinds)
                      if _mcp(toolcatalog.AGENT_SERVER, t) not in off)
        name = str(agent.data.get("name") or agent.id)
        record, secret = self._tokens.ephemeral(
            name, "read", agent=agent.id, chat=status.chat_id, purpose="review", run=status.id,
            budget=REVIEW_MAX_STEPS, tools=tools,
        )
        try:
            scope = agentrun.RunScope(
                agent=agent, space_root=self.space_root, space_name=self.space_name, api_url=api_url,
                token=secret, write=False, chat_id=status.chat_id, purpose="review",
                state=AgentRegistry().state,
            )
            lines = await asyncio.to_thread(transcripts.raw_lines, Path(agent.folder), status.chat_id)
            prompt = prompt_for(status.kinds)
            fresh = ai.build_prompt("chat", prompt, ai.ContextPack(), None, _history(lines), intro=False)

            def run(resume_id: str | None) -> agentrun.RunCommand:
                cmd = agentrun.build_run(scope, claude=claude, model=model, resume=resume_id)
                if resume_id:
                    cmd.args.append("--fork-session")
                cmd.args.append("--no-session-persistence")
                return cmd

            turn = ai.Turn(claude=claude, mode="chat", prompt_resume=prompt, prompt_fresh=fresh,
                           session_id=session_id, model=model, api_url=api_url, token=secret, run=run)
            error: str | None = None
            async for event in ai.run_turn(turn):  # the events are read and dropped
                if event.get("type") == "error":
                    error = str(event.get("message") or "") or FAILED_MESSAGE
            return error
        finally:
            TokenStore.drop_ephemeral(secret)
            agentskills.MEMO.forget(record.id)

    def _finish(self, status: ReviewStatus, folder: Path) -> None:
        status.ended_at = _now()
        line: dict[str, Any] = {
            "type": "review", "id": status.id, "state": status.state,
            "summary": status.summary if status.state == "done" else None,
            "entryIds": list(status.entry_ids), "message": status.message, "at": status.ended_at,
        }
        with contextlib.suppress(OSError, ValueError):
            transcripts.append(folder, status.chat_id, [line])
        self._done((status.agent_id, status.chat_id))
        with contextlib.suppress(Exception):  # an announcement never fails the review's end
            self._announce(status.agent_id, status.id)

    def _done(self, key: tuple[str, str]) -> None:
        with self._cond:
            self._running.pop(key, None)
            self._cond.notify_all()

    def _announce(self, agent_id: str, review_id: str) -> None:
        from .watcher import ChangeEvent

        self.announce(ChangeEvent("agentLearning", agent_id, review_id, origin=None))

    # -- state ------------------------------------------------------------------------------------

    def statuses(self, agent: AgentRecord, chat_id: str) -> list[ReviewStatus]:
        """From the transcript, plus running ones, oldest first. A start line with no end that
        isn't running here (the app stopped mid-review) reads as failed."""
        try:
            lines = transcripts.raw_lines(Path(agent.folder), chat_id)
        except (OSError, ValueError):
            lines = []
        found = _statuses_from(agent.id, chat_id, lines)
        with self._cond:
            running = self._running.get((agent.id, chat_id))
        if running is not None:
            found[running.id] = running
        for rid, status in found.items():
            if status.state == "running" and (running is None or running.id != rid):
                status.state, status.message = "failed", STOPPED_MESSAGE
        return sorted(found.values(), key=lambda s: (s.started_at, s.id))

    def busy(self) -> bool:
        """Any review running (the curator waits)."""
        with self._cond:
            return bool(self._running)

    def wait_idle(self, timeout: float = 10.0) -> bool:
        """Wait until no review runs (tests and ``POST /api/_test/reviews/idle``)."""
        with self._cond:
            return self._cond.wait_for(lambda: not self._running, timeout)


# -- the turn watcher ------------------------------------------------------------------------------


def watch(event: dict[str, Any], *, folder: Path, memo_key: str) -> None:
    """A chat turn's event: a call of the CLI's own ``Skill`` tool with input ``{"skill": name}``
    marks that skill read in `agentskills.MEMO` and records a use (`agentskills.record_use`)."""
    if event.get("type") != "tool" or event.get("name") != "Skill":
        return
    data = event.get("input")
    name = data.get("skill") if isinstance(data, dict) else None
    if not isinstance(name, str) or not name:
        return
    with contextlib.suppress(agentskills.SkillError, OSError, ValueError):
        agentskills.record_use(Path(folder), name, memo_key)
