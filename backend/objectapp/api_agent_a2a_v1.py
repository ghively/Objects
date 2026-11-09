"""The ``/api/v1/agent/*`` routes behind the ``remote_agents_list``, ``remote_agent_call`` and
``delegate`` agent tools (M20, spec sections 7 and 8), through `v1guard.agent_auth`.

- ``GET  /v1/agent/remote-agents`` -> ``{agents: [{id, name, description, skills: [{id, name,
  description}], streaming, usable}]}`` (``usable``: auth ``none`` or its secret set).
- ``POST /v1/agent/remote-call`` ``{agent, message, contextId?, taskId?, timeoutSeconds?}`` ->
  ``{agent: {id, name}, chatId, state, text, contextId, taskId, artifacts, cut}``. The timeout is
  clamped to 1..`REMOTE_CALL_TIMEOUT_MAX` seconds (default `REMOTE_CALL_TIMEOUT`); the text is
  cut at `REMOTE_TEXT_CAP` characters.
- ``POST /v1/agent/delegate`` ``{agent, goal, context?}`` -> ``{agent: {id, name, kind}, chatId,
  state, summary, cut}`` (`delegation.delegate`).

``agent`` is an id or a name (any case) of any listed agent (404 "No agent named {agent}.").
``message``, ``goal`` and ``context`` are 1..200,000, 1..20,000 and 0..200,000 characters (422).
A delegated run's token gets 403 "A delegated agent can't delegate further." on ``remote-call``
and ``delegate``; a ``read`` token (a proposal turn's) gets 403 "This token can only read." there,
since the other agent would act with write tools, and the purpose-based `v1guard.WRITE_GUARDS`
run there too (a read-only work run's or an import-filing run's token gets its 403 "This run is
read-only."), since handing work on is a write. Each route calls `v1guard.agent_tool_allowed`
for its tool.

Imports no network client: a remote call goes through ``remotechat`` (and its ``a2a``).
"""

from __future__ import annotations

import asyncio
import functools
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from . import delegation, remotesecrets
from .apictx import ApiContext
from .appstate import space_key
from .remotemodel import REMOTE_CALL_TIMEOUT, REMOTE_CALL_TIMEOUT_MAX, REMOTE_KIND, REMOTE_TEXT_CAP
from .tokens import TokenRecord, TokenStore
from .v1guard import WRITE_GUARDS, Denied, V1Guard, agent_auth, agent_tool_allowed, error
from .watcher import ChangeEvent

__all__ = ["CONTEXT_MAX", "GOAL_MAX", "MESSAGE_MAX", "NOT_REMOTE", "router"]

MESSAGE_MAX = 200_000  # our number
GOAL_MAX = 20_000  # our number
CONTEXT_MAX = 200_000  # our number
NOT_REMOTE = "That isn't a remote agent."  # our string
TOO_LONG = delegation.TOO_LONG
READ_ONLY = "This token can only read."  # `v1guard.V1Guard.auth`'s string


class RemoteCallRequest(BaseModel):
    agent: str = ""
    message: str = ""
    contextId: str | None = None
    taskId: str | None = None
    timeoutSeconds: float | None = None


class DelegateRequest(BaseModel):
    agent: str = ""
    goal: str = ""
    context: str | None = ""


def _aguarded(fn):
    """`v1guard.guarded` for an async route."""

    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except Denied as exc:
            return error(exc.status, exc.detail)

    return wrapper


def _name(record: Any) -> str:
    name = record.data.get("name")
    return name if isinstance(name, str) and name else record.folder.name


def _length(value: str, field: str, low: int, high: int) -> None:
    if not low <= len(value) <= high:
        raise Denied(422, f'"{field}" must be {low:,} to {high:,} characters.')  # our string


def _timeout(value: float | None) -> float:
    if value is None:
        return REMOTE_CALL_TIMEOUT
    return min(max(float(value), 1.0), REMOTE_CALL_TIMEOUT_MAX)


def router(ctx: ApiContext) -> APIRouter:
    """The agent A2A v1 routes, mounted on the app's ``/api`` router (so no prefix here)."""
    from .agentmodel import AgentError
    from .agents import AgentRecord, AgentRegistry

    guard = V1Guard(ctx, TokenStore(ctx.space.root))
    r = APIRouter()

    def auth(request: Request, tool: str, hands_on: bool = False) -> tuple[TokenRecord, AgentRecord, AgentRegistry]:
        """`hands_on` (remote-call, delegate): `flat`'s refusals come before the token's tool list
        (decisions memo S2 gives every run one), so a delegated run still hears why."""
        registry = AgentRegistry()
        token, agent = agent_auth(guard, registry, request)
        if hands_on:
            flat(token, request)
        agent_tool_allowed(token, tool)
        return token, agent, registry

    def flat(token: TokenRecord, request: Request) -> None:
        if token.purpose == "delegate" or delegation.is_delegated_chat(token.chat):
            raise Denied(403, delegation.FLAT)
        if token.scope != "read-write":  # handing work on would lift a read-only turn to writes
            raise Denied(403, READ_ONLY)
        for check in list(WRITE_GUARDS):  # as `V1Guard.auth(write=True)`: a read-only purpose
            message = check(token, request)
            if message:
                raise Denied(403, message)

    def find(registry: AgentRegistry, name: str) -> AgentRecord:
        try:
            return registry.find_by_name(name)
        except AgentError as exc:
            raise Denied(exc.status, exc.message) from exc

    # -- remote_agents_list -------------------------------------------------------------------

    def listing() -> dict[str, Any]:
        out = []
        for rec in AgentRegistry().list():
            if rec.kind != REMOTE_KIND:
                continue
            info = rec.to_api({}).get("remote") or {}
            card = info.get("card") or {}
            auth_kind = (info.get("auth") or {}).get("kind", "none")
            out.append({
                "id": rec.id,
                "name": _name(rec),
                "description": card.get("description") or "",
                "skills": [{"id": s.get("id", ""), "name": s.get("name", ""), "description": s.get("description", "")}
                           for s in card.get("skills") or []],
                "streaming": bool(info.get("streaming")),
                "usable": auth_kind == "none" or remotesecrets.is_set(rec.id),
            })
        return {"agents": out}

    @r.get("/v1/agent/remote-agents")
    @_aguarded
    async def remote_agents(request: Request):
        await asyncio.to_thread(auth, request, "remote_agents_list")
        return await asyncio.to_thread(listing)

    # -- remote_agent_call --------------------------------------------------------------------

    @r.post("/v1/agent/remote-call")
    @_aguarded
    async def remote_call(req: RemoteCallRequest, request: Request):
        token, caller, registry = await asyncio.to_thread(auth, request, "remote_agent_call", True)
        _length(req.message, "message", 1, MESSAGE_MAX)
        target = await asyncio.to_thread(find, registry, req.agent)
        if target.kind != REMOTE_KIND:
            raise Denied(422, NOT_REMOTE)
        timeout = _timeout(req.timeoutSeconds)
        name = _name(target)
        try:
            delegation.can_run(target, name)
        except delegation.DelegationError as exc:
            raise Denied(exc.status, exc.message) from exc
        from . import a2a, remotechat

        try:
            res = await remotechat.call_remote(
                target, req.message, context_id=req.contextId or None, task_id=req.taskId or None,
                timeout=timeout, delegated_from=caller.id, from_chat=token.chat,
                space_name=ctx.space.name, space_key=space_key(ctx.space.root), cap=REMOTE_TEXT_CAP,
            )
        except a2a.A2AError as exc:
            if exc.chat_id:  # the chat was written (the user line, then an error or stopped line)
                ctx.announce(ChangeEvent("agentChats", target.id, exc.chat_id, origin=None))
            failure = delegation.remote_error(exc, name, timeout)
            raise Denied(failure.status, failure.message) from exc
        except AgentError as exc:
            raise Denied(exc.status, exc.message) from exc
        if res.chat_id:
            ctx.announce(ChangeEvent("agentChats", target.id, res.chat_id, origin=None))
        return {
            "agent": {"id": target.id, "name": name},
            "chatId": res.chat_id,
            "state": delegation.state_name(res.state),
            "text": res.text,
            "contextId": res.context_id,
            "taskId": res.task_id,
            "artifacts": list(res.attachments or []),
            "cut": bool(res.cut),
        }

    # -- delegate -----------------------------------------------------------------------------

    @r.post("/v1/agent/delegate")
    @_aguarded
    async def delegate(req: DelegateRequest, request: Request):
        token, caller, registry = await asyncio.to_thread(auth, request, "delegate", True)
        _length(req.goal, "goal", 1, GOAL_MAX)
        context = req.context or ""
        _length(context, "context", 0, CONTEXT_MAX)
        target = await asyncio.to_thread(find, registry, req.agent)
        base = f"{request.url.scheme}://{request.url.netloc}"
        try:
            result = await delegation.delegate(
                ctx, registry, caller, token, target, req.goal, context, api_url=base,
                disconnected=request.is_disconnected,
            )
        except delegation.Busy as exc:
            raise Denied(429, str(exc)) from exc
        except delegation.DelegationError as exc:
            raise Denied(exc.status, exc.message) from exc
        return {
            "agent": {"id": result.agent.id, "name": _name(result.agent), "kind": result.agent.kind},
            "chatId": result.chat_id,
            "state": result.state,
            "summary": result.summary,
            "cut": result.cut,
        }

    return r
