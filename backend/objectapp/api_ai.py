"""The AI assistant's routes (M10, M16), mounted on ``/api``.

- ``GET  /ai/status`` -> `AiStatus` (is the Claude Code CLI there and does it answer)
- ``GET  /ai/models`` -> `AiModels` (M16: `aimodels.MODELS` and the model-name pattern;
  answered also when "Hide AI features" is on)
- ``POST /ai/chat`` `AiChatRequest` -> ``text/event-stream``, one ``data: <AiEvent JSON>``
  frame per event, ending with ``done`` or ``error``. 403 when "Hide AI features" is on.
  A ``block`` is sent only when ``blockPath`` names an object the assistant may see (not
  excluded from AI, not a template), or when it is the text of an assistant message in
  ``history`` (rephrasing an answer); otherwise the stream is one ``error`` event and the
  CLI isn't started. ``history`` keeps its newest `MAX_HISTORY` messages within
  `MAX_TEXT` characters; a ``sessionId`` that isn't a UUID is ignored (a fresh session).
  ``model`` (M16) is this chat's pick: empty means none; a name `aimodels.clean_model`
  refuses is a 422 before the CLI is looked for. The turn runs on the pick, else the
  ``aiModel`` setting, else the CLI's default (no ``--model``).
  M17: ``agentId`` names the agent (none: the default agent, whose first turn makes its
  folder) and ``chatId`` its transcript (not a ULID: a new chat). Every turn's stream starts
  with ``{"type": "chat", chatId, agentId}``. An unknown agent, a missing folder, a read-only
  agent or a folder nested in (or holding) a space folder answers one ``error`` event and the
  CLI isn't started. The turn is an agent run (`agentrun.build_run`): ``chat`` acts directly
  (Object's write tools, a ``read-write`` token); the proposal modes run read-only (a
  ``read`` token). The token is held in memory (`TokenStore.ephemeral`, named after the agent,
  stamped with its id and the chat id) and revoked when the stream ends. Closing the stream
  stops the CLI. The turn is recorded in the agent's transcript (`transcripts`): the user line
  when it starts, the tool lines and the answer (or error) when it ends, ``stopped`` when the
  client went away; each write announces ``agentChats``.
- ``GET  /ai/chat?path=`` -> `AiChat` (a saved chat; 404 when the path isn't one). M17 adds
  ``agent`` (its Agent property), ``agentId`` (the first listed agent of that name, any case,
  else the default agent) and ``chatId`` (the transcript carrying its session, else null).
- ``POST /ai/chat/save`` `SaveAiChatRequest` -> ``{path, version}``: creates the chat (no
  ``path``; the "AI Chat" type is made on the first save) or replaces its messages,
  context and session (409 ``{currentVersion}`` on a stale ``baseVersion``). A given
  title that differs renames the chat; an empty one keeps it. A session id that isn't a
  UUID is stored as none. Writes announce `ChangeEvent`s with the request's ``clientId``.
  M17: ``agentId`` (none or unknown: the default agent) is written as the Agent property (the
  agent's name; the "AI Chat" type gains it on its next save) and ``chatId`` gets an
  ``object`` line in its transcript.

A turn reads the space (context pages, tag names) and writes no space file itself; what the
agent changes, it changes through Object's tools.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sse_starlette import EventSourceResponse, ServerSentEvent

from . import agentrun, ai, aimodels, transcripts
from .agentmodel import DEFAULT_AGENT_ID
from .agents import AgentError, AgentNotFound, AgentRegistry, effective_model
from .aichat import (
    agent_key,
    chat_keys,
    default_title,
    ensure_chat_type,
    find_chat_type,
    parse_body,
    render_body,
)
from .apictx import ApiContext
from .appstate import space_key
from .propvalues import InvalidValue
from .settings import read as read_settings
from .space import Conflict, ReadOnly
from .tokens import TokenStore
from .watcher import ChangeEvent

if TYPE_CHECKING:
    from .curator import Curator
    from .reviews import ReviewRunner

__all__ = ["router"]

MAX_CONTEXT_PATHS = 50
MAX_TEXT = 200_000
MAX_HISTORY = 100
"""Earlier messages a turn carries at most (the newest)."""
EXCLUDED_BLOCK = "This page is excluded from AI, so its text can't be sent."  # our string


class AiMessageModel(BaseModel):
    role: Literal["user", "assistant"]
    text: str
    at: str = ""


class ChatRequest(BaseModel):
    mode: Literal["chat", "askBlock", "tagBlock", "tagObject", "autofill", "rephrase"]
    prompt: str = ""
    contextPaths: list[str] = []
    block: str | None = None
    blockPath: str | None = None
    history: list[AiMessageModel] = []
    sessionId: str | None = None
    clientId: str | None = None
    model: Any = None  # any value reaches aimodels.clean_model, so a bad one gets BAD_MODEL
    agentId: str | None = None
    """M17: None means the default agent."""
    chatId: str | None = None
    """M17: not a ULID means a new chat."""


class SaveChatRequest(BaseModel):
    path: str | None = None
    baseVersion: str | None = None
    title: str = ""
    contextPaths: list[str] = []
    sessionId: str | None = None
    messages: list[AiMessageModel] = []
    clientId: str | None = None
    agentId: str | None = None
    chatId: str | None = None


PROPOSAL_MODES = ("askBlock", "tagBlock", "tagObject", "autofill", "rephrase")
"""Modes that run read-only, so their Accept step stays meaningful (M17)."""
MISSING_FOLDER = "This agent's folder is missing: {path}"


def _now() -> str:
    moment = datetime.now(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _valid_chat_id(chat_id: Any) -> str | None:
    try:
        transcripts.path_for(Path("."), chat_id)
    except ValueError:
        return None
    return chat_id


class _TurnRecord:
    """What a turn streamed, for its transcript lines: the tool calls paired by id, the text."""

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
        """What the panel shows: with tool steps, every streamed text joined (``done.text`` is
        then only the CLI's last message); else ``done.text``, or the streamed text when empty."""
        if self.tools or done is None:
            return self.shown()
        return str(done.get("text") or "") or self.shown()


def _error(status: int, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse({"detail": detail, **extra}, status_code=status)


def _cap_history(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The newest `MAX_HISTORY` messages whose text fits in `MAX_TEXT` characters together."""
    kept: list[dict[str, Any]] = []
    total = 0
    for m in reversed(history[-MAX_HISTORY:]):
        total += len(m.get("text") or "")
        if total > MAX_TEXT:
            break
        kept.append(m)
    kept.reverse()
    return kept


def _settings() -> dict[str, Any]:
    try:
        return read_settings()[0]
    except (ReadOnly, OSError, ValueError):  # an unreadable settings file: the defaults
        return {}


def router(
    ctx: ApiContext,
    state_folder: Path | None = None,
    *,
    reviews: ReviewRunner | None = None,
    curator: Curator | None = None,
) -> APIRouter:
    """M10's AI routes. M18: `reviews` and `curator` are the app's `ReviewRunner` and `Curator`
    (unused until the plan's T7 wires the chat stream to them)."""
    space = ctx.space
    tokens = TokenStore(space.root, state_folder)
    r = APIRouter()

    # -- status and turns -------------------------------------------------------------

    @r.get("/ai/status")
    def ai_status():
        return ai.status(_settings().get("claudePath"))

    @r.get("/ai/models")
    def ai_models():
        return aimodels.models_payload()

    @r.post("/ai/chat")
    async def ai_chat(req: ChatRequest, request: Request):
        settings = await asyncio.to_thread(_settings)
        if settings.get("aiHidden"):
            return _error(403, "AI features are hidden (Settings > AI Assistant).")
        if len(req.contextPaths) > MAX_CONTEXT_PATHS:
            return _error(422, f"At most {MAX_CONTEXT_PATHS} context pages.")
        if len(req.prompt) > MAX_TEXT or len(req.block or "") > MAX_TEXT:
            return _error(422, "The message is too long.")
        try:
            pick = aimodels.clean_model(req.model)
        except ValueError:
            return _error(422, aimodels.BAD_MODEL)
        claude = await asyncio.to_thread(ai.find_claude, settings.get("claudePath"))
        base = f"{request.url.scheme}://{request.url.netloc}"

        def frame(event: dict[str, Any]) -> ServerSentEvent:
            return ServerSentEvent(data=json.dumps(event, ensure_ascii=False), sep="\n")

        def one_error(message: str) -> EventSourceResponse:
            async def only():
                yield frame({"type": "error", "message": message})

            return EventSourceResponse(only(), sep="\n")

        history = _cap_history([m.model_dump() for m in req.history])
        if req.block:
            # Page text goes out only from a page the assistant may see; an answer of its own
            # (rephrased) is already in the history.
            own = any(m["role"] == "assistant" and m["text"] == req.block for m in history)
            shown = await asyncio.to_thread(ai.visible_path, space, req.blockPath)
            if shown is None and not (own and not req.blockPath):
                return one_error(EXCLUDED_BLOCK)

        registry = AgentRegistry()
        try:
            agent = await asyncio.to_thread(registry.get, req.agentId or DEFAULT_AGENT_ID)
        except AgentNotFound as exc:
            return one_error(exc.message)
        if agent.missing:
            return one_error(MISSING_FOLDER.format(path=agent.folder))
        if agent.read_only_reason:
            return one_error(agent.read_only_reason)

        if claude is None:
            return one_error(ai.NOT_FOUND)

        if agent.default and not agent.exists:  # the default agent's first turn makes its folder
            try:
                agent = await asyncio.to_thread(registry.ensure_default)
            except AgentError as exc:
                return one_error(exc.message)

        write = req.mode not in PROPOSAL_MODES
        purpose = "chat" if write else "proposal"
        chat_id = _valid_chat_id(req.chatId) or transcripts.new_chat_id()
        model = aimodels.resolve_model(pick, effective_model(agent, settings))
        name = str(agent.data.get("name") or agent.id)
        folder = agent.folder

        def scope_for(secret: str) -> agentrun.RunScope:
            return agentrun.RunScope(
                agent=agent, space_root=space.root, space_name=space.name, api_url=base,
                token=secret, write=write, chat_id=chat_id, purpose=purpose, state=registry.state,
            )

        def check() -> str | None:
            """A nesting problem, found before the stream starts (no CLI, no transcript)."""
            try:
                cmd = agentrun.build_run(scope_for(""), claude=claude, model=model, resume=None)
            except agentrun.RunRefused as exc:
                return exc.message
            shutil.rmtree(cmd.tmp, ignore_errors=True)
            return None

        refused = await asyncio.to_thread(check)
        if refused:
            return one_error(refused)

        pack = await asyncio.to_thread(
            ai.gather_context,
            space,
            req.contextPaths,
            tags=req.mode in ("tagBlock", "tagObject"),
            fields=req.mode == "autofill",
        )
        session_id = ai.valid_session(req.sessionId)
        fresh = ai.build_prompt(req.mode, req.prompt, pack, req.block, history, intro=False)
        resume = ai.build_prompt(req.mode, req.prompt, pack, req.block, intro=False) if session_id else None
        allowed = {f["id"] for f in pack.fields} if req.mode == "autofill" else None

        def written() -> None:
            ctx.announce(ChangeEvent("agentChats", agent.id, chat_id, origin=None))

        def begin() -> None:
            now = _now()
            transcripts.start(
                folder, chat_id, agent_id=agent.id,
                title=default_title([{"role": "user", "text": req.prompt}]),
                space_name=space.name, space_key=space_key(space.root), created_at=now,
            )
            transcripts.append(folder, chat_id, [
                {"type": "user", "text": req.prompt, "at": now, "contextPaths": list(req.contextPaths)},
            ])
            written()

        def finish(record: _TurnRecord, last: dict[str, Any] | None) -> None:
            """The tool lines and the answer (or error) in one write; ``last`` None: stopped."""
            lines: list[dict[str, Any]] = list(record.tools.values())
            now = _now()
            if last is not None and last.get("type") == "error":
                lines.append({"type": "error", "message": str(last.get("message") or ""), "at": now})
            else:
                line: dict[str, Any] = {
                    "type": "assistant", "text": record.answer(last), "at": now, "model": model,
                    "sessionId": (last or {}).get("sessionId") or record.session_id,
                }
                if last is None:
                    line["stopped"] = True
                lines.append(line)
            try:
                transcripts.append(folder, chat_id, lines)
            except OSError:
                return
            written()

        async def stream():
            _record, secret = tokens.ephemeral(
                name, "read-write" if write else "read", agent=agent.id, chat=chat_id
            )
            record = _TurnRecord()
            started = ended = False
            gen = None
            try:
                yield frame({"type": "chat", "chatId": chat_id, "agentId": agent.id})
                await asyncio.to_thread(begin)
                started = True
                turn = ai.Turn(
                    claude=claude,
                    mode=req.mode,
                    prompt_resume=resume,
                    prompt_fresh=fresh,
                    session_id=session_id,
                    model=model,
                    api_url=base,
                    token=secret,
                    skipped=pack.skipped,
                    allowed_keys=allowed,
                    run=lambda resume_id: agentrun.build_run(
                        scope_for(secret), claude=claude, model=model, resume=resume_id
                    ),
                )
                gen = ai.run_turn(turn)
                async for event in gen:
                    record.see(event)
                    if event.get("type") in ("done", "error"):
                        ended = True
                        # Written before the last frame goes out, so a client that reloads the
                        # chat on ``done`` finds the answer in it.
                        await asyncio.to_thread(finish, record, event)
                    yield frame(event)
            finally:
                TokenStore.drop_ephemeral(secret)
                if gen is not None:
                    with contextlib.suppress(BaseException):  # the stream is closing anyway
                        await asyncio.shield(gen.aclose())
                if started and not ended:
                    finish(record, None)  # the client went away: what was shown so far, stopped

        return EventSourceResponse(stream(), ping=15, sep="\n")

    # -- saved chats ------------------------------------------------------------------

    def announce(kind: str, path: str, version: str | None, origin: str | None, **extra: Any) -> None:
        ctx.announce(ChangeEvent(kind, path, version, origin=origin, **extra))

    @r.get("/ai/chat")
    def load_chat(path: str):
        try:
            rel = space._rel(path)
            of, fm, version = space.read(rel)
            summary = space.get(rel)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No AI chat at {path!r}")
        t = find_chat_type(space)
        if t is None or summary.type != t.id:
            return _error(404, f"No AI chat at {path!r}")
        ctx_key, ses_key = chat_keys(t)
        links = space.links_of(rel, fm) if ctx_key else {}
        context = [p for p in links.get(ctx_key, []) if p] if ctx_key else []
        session = ai.valid_session(fm.get(ses_key) if ses_key else None)
        a_key = agent_key(t)
        raw_agent = fm.get(a_key) if a_key else None
        agent_name = " ".join(raw_agent.split()) if isinstance(raw_agent, str) and raw_agent.strip() else None
        agent = _agent_named(agent_name)
        chat_id = None
        if session and agent.exists and not agent.missing:
            with contextlib.suppress(OSError):
                chat_id = transcripts.find_by_session(agent.folder, session)
        return {
            "path": rel,
            "version": version,
            "title": summary.title,
            "contextPaths": context,
            "sessionId": session,
            "messages": parse_body(of.body),
            "agent": agent_name,
            "agentId": agent.id,
            "chatId": chat_id,
        }

    def _agent_named(name: str | None):
        """The first listed agent called `name` (any case), else the default agent."""
        records = AgentRegistry().list()
        if name:
            for rec in records:
                own = rec.data.get("name")
                if isinstance(own, str) and own.casefold() == name.casefold():
                    return rec
        return records[0]

    def _agent_for(agent_id: str | None):
        registry = AgentRegistry()
        try:
            return registry.get(agent_id or DEFAULT_AGENT_ID)
        except AgentNotFound:
            return registry.get(DEFAULT_AGENT_ID)

    def record_object(agent_id: str | None, chat_id: str | None, rel: str) -> None:
        """An ``object`` line in the chat's transcript (once per path in a row)."""
        cid = _valid_chat_id(chat_id)
        if cid is None:
            return
        agent = _agent_for(agent_id)
        if not agent.exists or agent.missing:
            return
        try:
            current = transcripts.read(agent.folder, cid)
        except (OSError, ValueError):
            return
        if current.get("objectPath") == rel:
            return
        try:
            transcripts.append(agent.folder, cid, [{"type": "object", "path": rel, "at": _now()}])
        except OSError:
            return
        ctx.announce(ChangeEvent("agentChats", agent.id, cid, origin=None))

    def context_refs(paths: list[str]) -> list[dict[str, Any]]:
        refs = []
        seen: set[str] = set()
        for path in paths[:MAX_CONTEXT_PATHS]:
            try:
                rel = space._rel(path)
                summary = space.get(rel)
            except (ValueError, KeyError):
                continue  # a page that is gone isn't linked
            if rel not in seen:
                seen.add(rel)
                refs.append({"target": summary.title or rel, "path": rel})
        return refs

    @r.post("/ai/chat/save")
    def save_chat(req: SaveChatRequest):
        origin = req.clientId
        messages = [m.model_dump() for m in req.messages]
        title = " ".join(req.title.split())
        try:
            t, type_changed = ensure_chat_type(space)
        except InvalidValue as exc:
            return _error(422, str(exc))
        if type_changed:
            announce("types", t.id, None, origin)
        ctx_key, ses_key = chat_keys(t)
        values: dict[str, Any] = {ctx_key: context_refs(req.contextPaths), ses_key: ai.valid_session(req.sessionId)}
        a_key = agent_key(t)
        agent = _agent_for(req.agentId)
        if a_key:
            values[a_key] = str(agent.data.get("name") or agent.id)
        try:
            if not req.path:
                title = title or default_title(messages)
                path, version = space.create_object(t.id, title, "none", values)
                announce("created", path, version, origin)
                new = space.save_body(path, render_body(title, messages), version)
                if new != version:
                    announce("changed", path, new, origin)
                record_object(agent.id, req.chatId, path)
                return {"path": path, "version": new}
            rel = space._rel(req.path)
            summary = space.get(rel)
            if summary.type != t.id:
                return _error(404, f"No AI chat at {req.path!r}")
            if not req.baseVersion:
                return _error(422, "baseVersion is needed to update a chat.")
            _of, _fm, current = space.read(rel)
            if current != req.baseVersion:
                raise Conflict(current)
            title = title or summary.title
            result = space.update_properties(rel, values, req.baseVersion)
            version = space.save_body(rel, render_body(title, messages), result.version)
            if version != req.baseVersion:
                announce("changed", rel, version, origin)
            for synced in result.synced:
                announce("changed", synced, space.cached_version(synced), origin)
            if title != summary.title:
                renamed = space.rename_object(rel, title, version)
                if renamed.path != rel:
                    announce("renamed", renamed.path, renamed.version, origin, oldPath=rel)
                elif renamed.version != version:
                    announce("changed", rel, renamed.version, origin)
                for path in renamed.relinked:
                    announce("changed", path, space.cached_version(path), origin)
                rel, version = renamed.path, renamed.version
            record_object(agent.id, req.chatId, rel)
            return {"path": rel, "version": version}
        except Conflict as exc:
            return _error(409, "The chat changed since that version. Load it again and retry.",
                          currentVersion=exc.current_version)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No AI chat at {req.path!r}")

    return r
