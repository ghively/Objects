"""The agent page's and the chat panel's learning routes (M18), under ``/api`` (plan "Routes for
the app"):

- ``GET  /agents/{id}/memory`` -> ``{memory: MemoryFile, user: MemoryFile}``. Never writes.
- ``PUT  /agents/{id}/memory/{target}`` ``{text, baseRevision, clientId?}`` -> ``MemoryFile``
  (ledger ``edit``, source user). 404, 409 ``{currentRevision}``, 422 (bad target), 423.
- ``GET  /agents/{id}/skills?archived=true`` -> ``{skills: SkillSummary[]}``
- ``POST /agents/{id}/skills`` ``{name, description, body, clientId?}`` -> 201 ``SkillDetail``
  (``createdBy: "user"``). 404, 409, 422.
- ``GET  /agents/{id}/skills/{name}?archived=true`` -> ``SkillDetail`` (404)
- ``GET  /agents/{id}/skills/{name}/file?path=&archived=`` -> ``{path, text, revision, binary}``
- ``PUT  /agents/{id}/skills/{name}/file`` ``{path, text, baseRevision, clientId?}`` ->
  ``{revision}`` (ledger ``edit`` or ``write_file``, source user). 404, 409, 413, 422.
- ``POST /agents/{id}/skills/{name}/archive`` | ``/restore`` | ``/pin`` -> ``SkillSummary``
- ``GET  /agents/{id}/ledger?target=&skill=&run=&limit=&before=`` -> ``{entries: LedgerSummary[],
  more}`` newest first; ``GET /agents/{id}/ledger/{entryId}`` -> ``LedgerEntry``;
  ``POST /agents/{id}/ledger/{entryId}/undo`` -> ``LedgerSummary`` (404; 409)
- ``GET|PUT /agents/{id}/learning`` -> ``LearningState`` (PUT: 404, 409 ``{currentRevision}``,
  422, 423)
- ``POST /agents/{id}/curator/tidy`` -> 202 ``{runId}`` (404; 409; 503 when there is no ``claude``)
- ``GET  /agents/{id}/chats/search?q=&limit=`` -> ``{hits: ChatSearchHit[]}``
- ``POST /agents/{id}/chats/{chatId}/learn`` -> 202 ``ReviewStatus`` (404; 409; 422; 503)
- ``GET  /agents/{id}/chats/{chatId}/reviews`` -> ``{reviews: ReviewStatus[]}`` oldest first

Every ledger entry a route makes announces ``ChangeEvent("agentLearning", <agentId>, <entryId>,
origin=clientId)``; reviews and the curator announce their own runs. A write on the default agent
before its folder exists makes the folder first (`AgentRegistry.ensure_default`); the read routes
answer its empty state and write nothing. While "Hide AI features" is on, ``learn`` and
``curator/tidy`` answer 403 (they start the CLI); the other routes stay available.

`server.create_app` mounts this router **before** `api_agents` so ``GET /agents/{id}/chats/search``
isn't taken for a chat id. No route here reads a space file.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import agentmemory, agentskills, ai, chatsearch, learnundo, ledger, transcripts
from .agentmodel import AgentError, AgentInput, AgentNotFound, AgentReadOnly
from .agents import AgentRecord, AgentRegistry
from .api_agents import _fail
from .api_agents import _settings as _device_settings
from .apictx import ApiContext
from .learningmodel import LEARNING_DEFAULTS, LearningInvalid, clean_learning, effective_learning
from .watcher import ChangeEvent

if TYPE_CHECKING:
    from .curator import Curator
    from .reviews import ReviewRunner

__all__ = ["router"]

HIDDEN = "AI features are hidden (Settings > AI Assistant)."  # api_ai's words
NO_CHAT = "That chat isn't there."  # api_agents' words
NO_ENTRY = "That change isn't there."  # our string
REVIEW_BUSY = "This chat is already being reviewed."
TOOLS_OFF = "Learning tools are switched off for this agent."
TIDY_BUSY = "Tidying up is already running."
LEARNING_TOOLS = ("memory", "skill_manage")
LEDGER_LIMIT_MAX = 500  # our number
SEARCH_LIMIT_MAX = 25  # as session_search


class ClientRequest(BaseModel):
    clientId: str | None = None


class MemorySaveRequest(BaseModel):
    text: str
    baseRevision: str | None = None
    clientId: str | None = None


class SkillCreateRequest(BaseModel):
    name: str = ""
    description: str = ""
    body: str = ""
    clientId: str | None = None


class SkillFileRequest(BaseModel):
    path: str = ""
    text: str
    baseRevision: str | None = None
    clientId: str | None = None


class PinRequest(BaseModel):
    pinned: bool
    clientId: str | None = None


class LearningRequest(BaseModel):
    learning: dict[str, Any]
    baseRevision: str | None = None
    clientId: str | None = None


def _error(status: int, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse({"detail": detail, **extra}, status_code=status)


def _skill_fail(exc: agentskills.SkillError, *, revision: bool = False) -> JSONResponse:
    """A `SkillError` as its status; a stale file's 409 carries ``currentRevision``."""
    extra: dict[str, Any] = {}
    if revision and isinstance(exc, agentskills.SkillConflict):
        extra["currentRevision"] = exc.current_revision
    return _error(exc.status, exc.message, **extra)


def _client(req: BaseModel | None) -> str | None:
    return getattr(req, "clientId", None) if req is not None else None


def _tools_off(agent: AgentRecord) -> set[str]:
    off = agent.data.get("toolsOff")
    return {t for t in off if isinstance(t, str)} if isinstance(off, list) else set()


def _readable(agent: AgentRecord) -> bool:
    """Whether the agent has a folder to read (the default agent before its first write hasn't)."""
    return agent.exists and not agent.missing


def router(ctx: ApiContext, *, reviews: ReviewRunner | None = None, curator: Curator | None = None) -> APIRouter:
    """The learning routes, mounted on the app's ``/api`` router (so no prefix here)."""
    r = APIRouter()

    def registry() -> AgentRegistry:
        return AgentRegistry()  # the state dir is read per request (tests point it elsewhere)

    def agent_of(agent_id: str) -> AgentRecord:
        return registry().get(agent_id)

    def writable(agent: AgentRecord) -> AgentRecord:
        """The agent ready for a write: 404 for a missing folder, 423 for an unreadable
        ``agent.json``; the default agent's folder made first when it has none."""
        if agent.missing:
            raise AgentNotFound(f"This agent's folder is missing: {agent.folder}")
        if agent.read_only_reason:
            raise AgentReadOnly(agent.read_only_reason)
        if agent.default and not agent.exists:
            return registry().ensure_default()
        return agent

    def announce(agent_id: str, entry_id: str | None, origin: str | None) -> None:
        if entry_id:
            ctx.announce(ChangeEvent("agentLearning", agent_id, entry_id, origin=origin))

    def user_source(agent: AgentRecord) -> dict[str, Any]:
        return {"kind": "user", "agentId": agent.id}

    def chat_exists(agent: AgentRecord, chat_id: str) -> bool:
        if not _readable(agent):
            return False
        try:
            return transcripts.path_for(agent.folder, chat_id).is_file()
        except ValueError:
            return False

    def claude_or_none(settings: dict[str, Any]) -> str | None:
        return ai.find_claude(settings.get("claudePath"))

    def base_url(request: Request) -> str:
        return f"{request.url.scheme}://{request.url.netloc}"

    # -- memory -------------------------------------------------------------------------

    @r.get("/agents/{agent_id}/memory")
    def get_memory(agent_id: str):
        try:
            agent = agent_of(agent_id)
        except AgentError as exc:
            return _fail(exc)
        return {"memory": agentmemory.read(agent.folder, "memory"), "user": agentmemory.read(agent.folder, "user")}

    @r.put("/agents/{agent_id}/memory/{target}")
    def save_memory(agent_id: str, target: str, req: MemorySaveRequest):
        try:
            agent = agent_of(agent_id)
            if target not in ("memory", "user"):
                return _error(422, "The target is memory or user.")  # agentmemory's words
            agent = writable(agent)
        except AgentError as exc:
            return _fail(exc)
        try:
            out = agentmemory.user_save(agent.folder, target, req.text, req.baseRevision)
        except agentmemory.MemoryError as exc:
            if exc.status == 409:
                return _error(409, exc.message, currentRevision=exc.current_revision)
            return _error(exc.status, exc.message)
        entries = ledger.entries(agent.folder, target=target, limit=1)
        announce(agent.id, entries[0]["id"] if entries else None, req.clientId)
        return out

    # -- skills -------------------------------------------------------------------------

    def skill_info(agent: AgentRecord, name: str, archived: bool) -> agentskills.SkillInfo:
        for info in agentskills.list_skills(agent.folder, archived=archived):
            if info.name == name and (info.state == "archived") == archived:
                return info
        kind = "archived" if archived else "active"
        raise agentskills.SkillNotFound(f"There's no {kind} skill named '{name}'.")

    def skill_detail(agent: AgentRecord, name: str, archived: bool) -> dict[str, Any]:
        info = skill_info(agent, name, archived)
        viewed = agentskills.view(agent.folder, name, None, bump=False, archived=archived)
        return {**info.to_api(), "text": viewed["text"], "revision": viewed["revision"], "files": viewed["files"]}

    @r.get("/agents/{agent_id}/skills")
    def list_skills(agent_id: str, archived: bool = False):
        try:
            agent = agent_of(agent_id)
        except AgentError as exc:
            return _fail(exc)
        if not _readable(agent):
            return {"skills": []}
        return {"skills": [s.to_api() for s in agentskills.list_skills(agent.folder, archived=archived)]}

    @r.post("/agents/{agent_id}/skills", status_code=201)
    def create_skill(agent_id: str, req: SkillCreateRequest):
        try:
            agent = writable(agent_of(agent_id))
        except AgentError as exc:
            return _fail(exc)
        try:
            out = agentskills.user_create(agent.folder, req.name, req.description, req.body)
        except agentskills.SkillError as exc:
            return _skill_fail(exc)
        entry_id = out.pop("entryId", None)
        announce(agent.id, entry_id, req.clientId)
        return JSONResponse(out, status_code=201)

    @r.get("/agents/{agent_id}/skills/{name}")
    def get_skill(agent_id: str, name: str, archived: bool = False):
        try:
            agent = agent_of(agent_id)
        except AgentError as exc:
            return _fail(exc)
        try:
            return skill_detail(agent, name, archived)
        except agentskills.SkillError as exc:
            return _skill_fail(exc)

    @r.get("/agents/{agent_id}/skills/{name}/file")
    def get_skill_file(agent_id: str, name: str, path: str = "", archived: bool = False):
        try:
            agent = agent_of(agent_id)
        except AgentError as exc:
            return _fail(exc)
        try:
            viewed = agentskills.view(agent.folder, name, path or None, bump=False, archived=archived)
        except agentskills.SkillError as exc:
            return _skill_fail(exc)
        return {"path": viewed["file"], "text": viewed["text"], "revision": viewed["revision"],
                "binary": viewed["binary"]}

    @r.put("/agents/{agent_id}/skills/{name}/file")
    def save_skill_file(agent_id: str, name: str, req: SkillFileRequest):
        try:
            agent = writable(agent_of(agent_id))
        except AgentError as exc:
            return _fail(exc)
        try:
            out = agentskills.user_write(agent.folder, name, req.path, req.text, req.baseRevision)
        except agentskills.SkillError as exc:
            return _skill_fail(exc, revision=True)
        announce(agent.id, out.get("entryId"), req.clientId)
        return {"revision": out["revision"]}

    def skill_change(agent_id: str, req: BaseModel | None, change) -> Any:
        try:
            agent = writable(agent_of(agent_id))
        except AgentError as exc:
            return _fail(exc)
        try:
            out = change(agent)
        except agentskills.SkillError as exc:
            return _skill_fail(exc)
        announce(agent.id, out.get("entryId"), _client(req))
        return out["skill"]

    @r.post("/agents/{agent_id}/skills/{name}/archive")
    def archive_skill(agent_id: str, name: str, req: ClientRequest | None = None):
        return skill_change(agent_id, req, lambda a: agentskills.archive(a.folder, name, source=user_source(a)))

    @r.post("/agents/{agent_id}/skills/{name}/restore")
    def restore_skill(agent_id: str, name: str, req: ClientRequest | None = None):
        return skill_change(agent_id, req, lambda a: agentskills.restore(a.folder, name, source=user_source(a)))

    @r.post("/agents/{agent_id}/skills/{name}/pin")
    def pin_skill(agent_id: str, name: str, req: PinRequest):
        return skill_change(
            agent_id, req, lambda a: agentskills.set_pinned(a.folder, name, req.pinned, source=user_source(a))
        )

    # -- the ledger and Undo --------------------------------------------------------------

    @r.get("/agents/{agent_id}/ledger")
    def get_ledger(agent_id: str, target: str | None = None, skill: str | None = None, run: str | None = None,
                   limit: int = 100, before: str | None = None):
        try:
            agent = agent_of(agent_id)
        except AgentError as exc:
            return _fail(exc)
        limit = max(1, min(LEDGER_LIMIT_MAX, limit))
        found = ledger.entries(agent.folder, target=target or None, skill=skill or None, run=run or None,
                               limit=limit + 1, before=before or None)
        return {"entries": [ledger.summary(e) for e in found[:limit]], "more": len(found) > limit}

    @r.get("/agents/{agent_id}/ledger/{entry_id}")
    def get_ledger_entry(agent_id: str, entry_id: str):
        try:
            agent = agent_of(agent_id)
        except AgentError as exc:
            return _fail(exc)
        try:
            entry = ledger.get(agent.folder, entry_id)
        except KeyError:
            return _error(404, NO_ENTRY)
        return {**entry, "line": ledger.line(entry)}

    @r.post("/agents/{agent_id}/ledger/{entry_id}/undo")
    def undo_entry(agent_id: str, entry_id: str, req: ClientRequest | None = None):
        try:
            agent = writable(agent_of(agent_id))
        except AgentError as exc:
            return _fail(exc)
        try:
            made = learnundo.undo(agent.folder, entry_id, source={"kind": "undo", "agentId": agent.id})
        except KeyError:
            return _error(404, NO_ENTRY)
        except learnundo.UndoConflict as exc:
            return _error(409, exc.message)
        announce(agent.id, made.get("id"), _client(req))
        return ledger.summary(made)

    # -- learning settings -----------------------------------------------------------------

    def learning_state(agent: AgentRecord) -> dict[str, Any]:
        cur = curator.state(agent) if curator is not None else {
            "lastRunAt": None, "nextDueAt": None, "running": False, "report": None,
        }
        return {"settings": effective_learning(agent.data), "defaults": dict(LEARNING_DEFAULTS),
                "curator": cur, "revision": agent.revision}

    @r.get("/agents/{agent_id}/learning")
    def get_learning(agent_id: str):
        try:
            return learning_state(agent_of(agent_id))
        except AgentError as exc:
            return _fail(exc)

    @r.put("/agents/{agent_id}/learning")
    def save_learning(agent_id: str, req: LearningRequest):
        reg = registry()
        try:
            agent = reg.get(agent_id)
            try:
                cleaned = clean_learning(req.learning)
            except LearningInvalid as exc:
                return _error(422, exc.message)
            stored = agent.data.get("learning")
            merged = {**(stored if isinstance(stored, dict) else {}), **cleaned}
            d = agent.data
            inp = AgentInput(
                name=d.get("name") if isinstance(d.get("name"), str) else agent.folder.name,
                icon=d.get("icon") if isinstance(d.get("icon"), str) else None,
                color=d.get("color") if isinstance(d.get("color"), str) else None,
                description=d.get("description") if isinstance(d.get("description"), str) else "",
                model=d.get("model") if isinstance(d.get("model"), str) and d.get("model") else None,
                toolsOff=None,
                learning=merged,
            )
            rec = reg.save(agent_id, inp, req.baseRevision)
        except AgentError as exc:
            return _fail(exc)
        ctx.announce(ChangeEvent("agents", rec.id, rec.revision, origin=req.clientId))
        return learning_state(rec)

    # -- tidy up ------------------------------------------------------------------------

    @r.post("/agents/{agent_id}/curator/tidy", status_code=202)
    async def tidy(agent_id: str, request: Request, req: ClientRequest | None = None):
        try:
            agent = await asyncio.to_thread(agent_of, agent_id)
        except AgentError as exc:
            return _fail(exc)
        settings = await asyncio.to_thread(_device_settings)
        if settings.get("aiHidden"):
            return _error(403, HIDDEN)
        if await asyncio.to_thread(claude_or_none, settings) is None:
            return _error(503, ai.NOT_FOUND)
        try:
            agent = await asyncio.to_thread(writable, agent)
        except AgentError as exc:
            return _fail(exc)
        if curator is None:
            return _error(503, ai.NOT_FOUND)
        from .curator import CuratorBusy

        try:
            out = await curator.tidy_now(agent, base_url(request))
        except CuratorBusy:
            return _error(409, TIDY_BUSY)
        return JSONResponse({"runId": out["runId"]}, status_code=202)

    # -- chats --------------------------------------------------------------------------

    @r.get("/agents/{agent_id}/chats/search")
    def search_chats(agent_id: str, q: str = "", limit: int = 10):
        try:
            agent = agent_of(agent_id)
        except AgentError as exc:
            return _fail(exc)
        if not _readable(agent):
            return {"hits": []}
        limit = max(1, min(SEARCH_LIMIT_MAX, limit))
        return {"hits": chatsearch.search(agent.folder, q, limit=limit)}

    @r.post("/agents/{agent_id}/chats/{chat_id}/learn", status_code=202)
    async def learn(agent_id: str, chat_id: str, request: Request, req: ClientRequest | None = None):
        try:
            agent = await asyncio.to_thread(agent_of, agent_id)
        except AgentError as exc:
            return _fail(exc)
        settings = await asyncio.to_thread(_device_settings)
        if settings.get("aiHidden"):
            return _error(403, HIDDEN)
        if not await asyncio.to_thread(chat_exists, agent, chat_id):
            return _error(404, NO_CHAT)
        if agent.read_only_reason:
            return _fail(AgentReadOnly(agent.read_only_reason))
        if all(t in _tools_off(agent) for t in LEARNING_TOOLS):
            return _error(422, TOOLS_OFF)
        claude = await asyncio.to_thread(claude_or_none, settings)
        if claude is None or reviews is None:
            return _error(503, ai.NOT_FOUND)
        from .reviews import ReviewBusy

        try:
            status = reviews.learn_now(agent=agent, chat_id=chat_id, api_url=base_url(request), claude=claude)
        except ReviewBusy:
            return _error(409, REVIEW_BUSY)
        return JSONResponse(status.to_api(), status_code=202)

    @r.get("/agents/{agent_id}/chats/{chat_id}/reviews")
    def chat_reviews(agent_id: str, chat_id: str):
        try:
            agent = agent_of(agent_id)
        except AgentError as exc:
            return _fail(exc)
        if not chat_exists(agent, chat_id):
            return _error(404, NO_CHAT)
        found = reviews.statuses(agent, chat_id) if reviews is not None else []
        return {"reviews": [s.to_api() for s in found]}

    return r
