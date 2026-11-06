"""The ``/api/agents...`` routes (M17; the plan's Contract "Routes").

- ``GET  /agents`` -> ``{agents: Agent[]}``: the default agent first, then registry order.
  Never writes.
- ``GET  /agents/{id}`` -> ``Agent`` (404)
- ``POST /agents`` ``CreateAgentRequest`` -> 201 ``Agent``: a new agent folder (or a duplicate of
  ``duplicateOf.id``). 404 (location not a folder, duplicate source unknown), 409 (a folder of
  that name at a chosen location), 422 (name, caps, model, nesting with a space folder).
- ``POST /agents/add-folder`` ``{path, clientId?}`` -> 201 ``Agent``: registers an existing agent
  folder, writing nothing in it. 404, 409 (its id is already listed), 422.
- ``PUT  /agents/{id}`` ``{agent, baseRevision, clientId?}`` -> ``Agent``. The default agent's
  ``model`` is written to the ``aiModel`` device setting. 404, 409 ``{currentRevision}``, 422,
  423.
- ``DELETE /agents/{id}?clientId=`` -> ``{trashId}``: to the agent trash, or ``null`` when the
  folder is outside the state dir (only unregistered). 422 for the default agent.
- ``POST /agents/{id}/unregister`` ``{clientId?}`` -> ``{ok: true}``. 422 for the default agent.
- ``GET  /agent-trash`` -> ``{items: AgentTrashItem[]}`` newest first
- ``POST /agent-trash/{trashId}/restore`` ``{clientId?}`` -> ``Agent`` (404; 409 when its id is
  listed again)
- ``GET  /agents/{id}/instructions`` -> ``{text, revision}``; ``PUT`` ``{text, baseRevision,
  clientId?}`` -> ``{revision}`` (404, 409 ``{currentRevision}``, 423)
- ``GET  /agent-tools`` -> ``{groups}``: the catalogue with the defaults (the New agent form)
- ``GET  /agents/{id}/tools`` -> ``{groups}``: this agent's switches, one group per folder MCP
  server, then `toolcatalog.GROUP_PROVIDERS`' groups
- ``GET  /agents/{id}/chats`` -> ``{chats}`` newest first; ``GET /agents/{id}/chats/{chatId}``
  -> ``AgentTranscript`` (404, also for a chat id that isn't a ULID)
- ``POST /agents/{id}/reveal`` -> ``{ok}``: shows the folder in the OS file manager

Writes announce ``ChangeEvent("agents", <agent id>, <revision or None>, origin=clientId)``.
These routes stay available while "Hide AI features" is on; only the UI hides them.
"""

from __future__ import annotations

import contextlib
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import agentfiles, toolcatalog, transcripts
from .agentmodel import AgentInput, clean_input
from .agents import AgentConflict, AgentError, AgentNotFound, AgentRecord, AgentRegistry
from .apictx import ApiContext
from .settings import RevisionConflict, SettingsProblem
from .settings import patch as patch_settings
from .settings import read as read_settings
from .space import ReadOnly
from .watcher import ChangeEvent

__all__ = ["router"]


class DuplicateOf(BaseModel):
    id: str
    memory: bool = False
    skills: bool = False


class CreateAgentRequest(BaseModel):
    agent: AgentInput
    instructions: str = ""
    location: str | None = None
    duplicateOf: DuplicateOf | None = None
    clientId: str | None = None


class AddFolderRequest(BaseModel):
    path: str
    clientId: str | None = None


class SaveAgentRequest(BaseModel):
    agent: AgentInput
    baseRevision: str | None = None
    clientId: str | None = None


class ClientRequest(BaseModel):
    clientId: str | None = None


class InstructionsRequest(BaseModel):
    text: str
    baseRevision: str | None = None
    clientId: str | None = None


def _settings() -> dict[str, Any]:
    try:
        return read_settings()[0]
    except (ReadOnly, OSError, ValueError):  # an unreadable settings file: the defaults
        return {}


def _fail(exc: AgentError) -> JSONResponse:
    body: dict[str, Any] = {"detail": exc.message}
    if isinstance(exc, AgentConflict):
        body["currentRevision"] = exc.current_revision
    return JSONResponse(body, status_code=exc.status)


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def _location(text: str | None) -> Path | None:
    return Path(text) if isinstance(text, str) and text.strip() else None


def router(ctx: ApiContext) -> APIRouter:
    """The agent routes, mounted on the app's ``/api`` router (so no prefix here)."""
    r = APIRouter()

    def registry() -> AgentRegistry:
        return AgentRegistry()  # the state dir is read per request (tests point it elsewhere)

    def out(rec: AgentRecord) -> dict[str, Any]:
        return rec.to_api(_settings())

    def announce(agent_id: str, revision: str | None, origin: str | None) -> None:
        ctx.announce(ChangeEvent("agents", agent_id, revision, origin=origin))

    # -- listing ----------------------------------------------------------------------------

    @r.get("/agents")
    def list_agents():
        settings = _settings()
        return {"agents": [rec.to_api(settings) for rec in registry().list()]}

    @r.get("/agents/{agent_id}")
    def get_agent(agent_id: str):
        try:
            return out(registry().get(agent_id))
        except AgentError as exc:
            return _fail(exc)

    # -- creating ---------------------------------------------------------------------------

    @r.post("/agents", status_code=201)
    def create_agent(req: CreateAgentRequest):
        reg = registry()
        location = _location(req.location)
        try:
            if req.duplicateOf is not None:
                rec = reg.duplicate(req.duplicateOf.id, req.agent, memory=req.duplicateOf.memory,
                                    skills=req.duplicateOf.skills, location=location)
            else:
                rec = reg.create(req.agent, req.instructions, location)
        except AgentError as exc:
            return _fail(exc)
        announce(rec.id, rec.revision, req.clientId)
        return JSONResponse(out(rec), status_code=201)

    @r.post("/agents/add-folder", status_code=201)
    def add_folder(req: AddFolderRequest):
        try:
            rec = registry().add_folder(Path(req.path))
        except AgentError as exc:
            return _fail(exc)
        announce(rec.id, rec.revision, req.clientId)
        return JSONResponse(out(rec), status_code=201)

    # -- saving -----------------------------------------------------------------------------

    @r.put("/agents/{agent_id}")
    def save_agent(agent_id: str, req: SaveAgentRequest):
        reg = registry()
        try:
            cleaned = clean_input(req.agent)
            rec = reg.save(agent_id, cleaned, req.baseRevision)
        except AgentError as exc:
            return _fail(exc)
        if rec.default:
            problem = _save_ai_model(cleaned.model)
            if problem is not None:
                return problem
        announce(rec.id, rec.revision, req.clientId)
        return out(rec)

    def _save_ai_model(model: str | None) -> JSONResponse | None:
        """The default agent's model is the ``aiModel`` device setting."""
        for _attempt in range(3):  # another window may write settings in between
            try:
                current, revision = read_settings()
            except ReadOnly as exc:
                return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
            if (current.get("aiModel") or None) == model:
                return None
            try:
                merged, _rev = patch_settings({"aiModel": model}, revision)
            except RevisionConflict:
                continue
            except SettingsProblem:
                return _error(422, "That isn't a model name.")
            except ReadOnly as exc:
                return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
            with contextlib.suppress(Exception):
                ctx.settings_changed(merged)
            return None
        return _error(409, "The settings changed elsewhere. Try again.")  # our string

    # -- removing ---------------------------------------------------------------------------

    @r.delete("/agents/{agent_id}")
    def delete_agent(agent_id: str, clientId: str | None = None):  # noqa: N803 - the query name
        try:
            trash_id = registry().delete(agent_id)
        except AgentError as exc:
            return _fail(exc)
        announce(agent_id, None, clientId)
        return {"trashId": trash_id}

    @r.post("/agents/{agent_id}/unregister")
    def unregister_agent(agent_id: str, req: ClientRequest | None = None):
        try:
            registry().unregister(agent_id)
        except AgentError as exc:
            return _fail(exc)
        announce(agent_id, None, req.clientId if req else None)
        return {"ok": True}

    @r.get("/agent-trash")
    def agent_trash():
        return {"items": registry().trash()}

    @r.post("/agent-trash/{trash_id}/restore")
    def restore_agent(trash_id: str, req: ClientRequest | None = None):
        try:
            rec = registry().restore(trash_id)
        except AgentError as exc:
            return _fail(exc)
        announce(rec.id, rec.revision, req.clientId if req else None)
        return out(rec)

    # -- instructions -----------------------------------------------------------------------

    @r.get("/agents/{agent_id}/instructions")
    def get_instructions(agent_id: str):
        try:
            text, revision = registry().read_instructions(agent_id)
        except AgentError as exc:
            return _fail(exc)
        return {"text": text, "revision": revision}

    @r.put("/agents/{agent_id}/instructions")
    def save_instructions(agent_id: str, req: InstructionsRequest):
        try:
            revision = registry().save_instructions(agent_id, req.text, req.baseRevision)
        except AgentError as exc:
            return _fail(exc)
        announce(agent_id, revision, req.clientId)
        return {"revision": revision}

    # -- tools ------------------------------------------------------------------------------

    @r.get("/agent-tools")
    def tool_defaults():
        groups = toolcatalog.catalogue()
        return {"groups": toolcatalog.groups_out(groups, toolcatalog.default_off())}

    @r.get("/agents/{agent_id}/tools")
    def agent_tools(agent_id: str):
        try:
            rec = registry().get(agent_id)
        except AgentError as exc:
            return _fail(exc)
        servers = list(agentfiles.folder_mcp_servers(rec.folder)) if rec.exists and not rec.missing else []
        groups = toolcatalog.catalogue(servers)
        for provider in toolcatalog.GROUP_PROVIDERS:
            groups += provider(rec)
        off = rec.data.get("toolsOff")
        off = [t for t in off if isinstance(t, str)] if isinstance(off, list) else []
        return {"groups": toolcatalog.groups_out(groups, off)}

    # -- chats ------------------------------------------------------------------------------

    @r.get("/agents/{agent_id}/chats")
    def agent_chats(agent_id: str):
        try:
            rec = registry().get(agent_id)
        except AgentError as exc:
            return _fail(exc)
        if not rec.exists or rec.missing:
            return {"chats": []}
        return {"chats": transcripts.list_chats(rec.folder)}

    @r.get("/agents/{agent_id}/chats/{chat_id}")
    def agent_chat(agent_id: str, chat_id: str):
        try:
            rec = registry().get(agent_id)
        except AgentError as exc:
            return _fail(exc)
        try:
            return transcripts.read(rec.folder, chat_id)
        except (ValueError, OSError):
            return _error(404, "That chat isn't there.")  # our string

    # -- reveal -----------------------------------------------------------------------------

    @r.post("/agents/{agent_id}/reveal")
    def reveal_agent(agent_id: str):
        from . import server  # server imports this module

        try:
            rec = registry().get(agent_id)
        except AgentError as exc:
            return _fail(exc)
        if not rec.folder.is_dir():
            return _fail(AgentNotFound(f"This agent's folder is missing: {rec.folder}"))
        server.reveal_in_file_manager(rec.folder)
        return {"ok": True}

    return r
