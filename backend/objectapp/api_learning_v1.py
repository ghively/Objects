"""The agent tools' learning routes (M18), under ``/api/v1/agent`` through `v1guard.agent_auth`:
``memory``, ``skills_list``, ``skill_view``, ``skill_manage`` and ``session_search``
(plan "Routes for the agent tools").

- ``POST /v1/agent/memory`` ``{action, target, content?, old_text?}`` -> ``{ok, entryId,
  target, entries, chars, cap, note?}`` (422 with the memory tool's messages).
- ``GET /v1/agent/skills`` -> ``{skills: SkillSummary[]}`` (active and stale).
- ``GET /v1/agent/skills/{name}?file=`` -> ``{name, file, text, files}``; marks the skill read
  for this run (the memo's key is the token's id) and bumps its usage (404).
- ``POST /v1/agent/skills/manage`` -> ``{ok, entryId, skill}`` (404, 409, 413, 422).
- ``GET /v1/agent/sessions/search?q=&limit=`` (1-25, default 10) -> ``{chats: ChatSearchHit[]}``.
- ``GET /v1/agent/sessions/{chatId}`` -> ``{chatId, title, createdAt, messages, truncated}`` (404).

Each route acts only on the token's own agent and calls `v1guard.agent_tool_allowed` for its
tool (403 "This run can't use {tool}."). A write's ledger ``source`` is ``{"kind": "review" |
"curator" (the token's purpose) else "chat", "agentId", "chatId", "run"}``, and each write that
made a ledger entry announces ``ChangeEvent("agentLearning", <agentId>, <entryId>)``.

These routes write only the agent's own folder (memory, skills, ``usage.json``, the ledger and
the rebuildable search cache), never a space file, so they don't need a ``read-write`` token: a
review's token is ``read`` and may still save memories. A write on an agent whose ``agent.json``
can't be read is a 423; a write on the default agent before its folder exists makes the folder
first (`AgentRegistry.ensure_default`). Reads never write (the search cache aside).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from . import agentmemory, agentskills, chatsearch
from .apictx import ApiContext
from .learningmodel import effective_learning
from .tokens import TokenRecord, TokenStore
from .v1guard import Denied, V1Guard, agent_auth, agent_tool_allowed, guarded

__all__ = ["router"]

SEARCH_LIMIT_MAX = 25
"""The most chats `session_search` returns at once (plan: ``limit`` 1-25, default 10)."""


class MemoryRequest(BaseModel):
    action: str = ""
    target: str = ""
    content: str | None = None
    old_text: str | None = None


class ManageRequest(BaseModel):
    action: str = ""
    name: str = ""
    description: str | None = None
    content: str | None = None
    old_string: str | None = None
    new_string: str | None = None
    replace_all: bool = False
    file: str | None = None
    absorbed_into: str | None = None


def _source(token: TokenRecord, agent_id: str) -> dict[str, Any]:
    kind = token.purpose if token.purpose in ("review", "curator") else "chat"
    return {"kind": kind, "agentId": agent_id, "chatId": token.chat, "run": token.run}


def router(ctx: ApiContext) -> APIRouter:
    """The learning v1 routes, mounted on the app's ``/api`` router (so no prefix here)."""
    from .agentmodel import AgentError, AgentNotFound, AgentReadOnly
    from .agents import AgentRecord, AgentRegistry

    guard = V1Guard(ctx, TokenStore(ctx.space.root))
    r = APIRouter()

    def auth(request: Request, tool: str) -> tuple[TokenRecord, AgentRecord]:
        token, agent = agent_auth(guard, AgentRegistry(), request)
        agent_tool_allowed(token, tool)
        return token, agent

    def writable(agent: AgentRecord) -> AgentRecord:
        """The agent ready for a write: 404 for a missing folder, 423 for an unreadable
        ``agent.json``; the default agent's folder made first when it has none."""
        if agent.missing:  # AgentRegistry's words for the same case
            raise Denied(AgentNotFound.status, f"This agent's folder is missing: {agent.folder}")
        if agent.read_only_reason:
            raise Denied(AgentReadOnly.status, agent.read_only_reason)
        if agent.default and not agent.exists:
            try:
                return AgentRegistry().ensure_default()
            except AgentError as exc:
                raise Denied(exc.status, exc.message) from exc
        return agent

    def announce(token: TokenRecord, agent: AgentRecord, entry_id: str | None) -> None:
        if entry_id:
            guard.announce("agentLearning", agent.id, entry_id, token)

    # -- memory -------------------------------------------------------------------------

    @r.post("/v1/agent/memory")
    @guarded
    def memory(req: MemoryRequest, request: Request):
        token, agent = auth(request, "memory")
        agent = writable(agent)
        try:
            out = agentmemory.apply(
                agent.folder, req.action, req.target, content=req.content, old_text=req.old_text,
                source=_source(token, agent.id), caps=effective_learning(agent.data),
            )
        except agentmemory.MemoryError as exc:
            raise Denied(exc.status, exc.message) from exc
        announce(token, agent, out.get("entryId"))
        return out

    # -- skills -------------------------------------------------------------------------

    @r.get("/v1/agent/skills")
    @guarded
    def skills_list(request: Request):
        _token, agent = auth(request, "skills_list")
        return {"skills": [s.to_api() for s in agentskills.list_skills(agent.folder)]}

    @r.post("/v1/agent/skills/manage")
    @guarded
    def skill_manage(req: ManageRequest, request: Request):
        token, agent = auth(request, "skill_manage")
        agent = writable(agent)
        try:
            out = agentskills.manage(
                agent.folder, req.action, name=req.name, source=_source(token, agent.id), memo_key=token.id,
                description=req.description, content=req.content, old_string=req.old_string,
                new_string=req.new_string, replace_all=req.replace_all, file=req.file,
                absorbed_into=req.absorbed_into,
            )
        except agentskills.SkillError as exc:
            raise Denied(exc.status, exc.message) from exc
        announce(token, agent, out.get("entryId"))
        return out

    @r.get("/v1/agent/skills/{name}")
    @guarded
    def skill_view(name: str, request: Request, file: str | None = None):
        token, agent = auth(request, "skill_view")
        try:
            out = agentskills.view(agent.folder, name, file, memo_key=token.id, bump=True)
        except agentskills.SkillError as exc:
            raise Denied(exc.status, exc.message) from exc
        return {"name": out["name"], "file": out["file"], "text": out["text"], "files": out["files"]}

    # -- chat search ----------------------------------------------------------------------

    @r.get("/v1/agent/sessions/search")
    @guarded
    def session_search(request: Request, q: str = "", limit: int = 10):
        _token, agent = auth(request, "session_search")
        limit = max(1, min(SEARCH_LIMIT_MAX, limit))
        return {"chats": chatsearch.search(agent.folder, q, limit=limit)}

    @r.get("/v1/agent/sessions/{chat_id}")
    @guarded
    def session_read(chat_id: str, request: Request):
        _token, agent = auth(request, "session_search")
        try:
            return chatsearch.read_chat(agent.folder, chat_id)
        except (FileNotFoundError, ValueError):
            raise Denied(404, "That chat isn't there.") from None  # api_agents' words

    return r
