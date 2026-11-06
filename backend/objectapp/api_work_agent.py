"""The work agent's app routes (M24): ``/api/work/agent-settings``, ``agent/create-info``,
``agent/create``, ``read-tools`` and the idle test hook. Reads write nothing.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import agentfiles, mcpgateway
from . import settings as device_settings
from .agents import AgentRegistry
from .apictx import ApiContext
from .mcpstore import McpStore
from .space import ReadOnly
from .typemodel import RevisionConflict
from .watcher import ChangeEvent
from .workagent import (
    WORK_AGENT_NAME,
    _taken,
    create_work_agent,
    ensure_work_agent,
    find_change_reviewer,
    work_agent,
)
from .workagentmodel import READ_TOOLS_MAX

if TYPE_CHECKING:
    from .workloop import WorkLoop
    from .workservice import WorkService

__all__ = ["router"]

READ_TOOL_ID = re.compile(r"^mcp__[A-Za-z0-9_-]{1,64}__\S{1,128}$")
ALREADY_SET = "A work agent is already set."  # our string
BAD_TOOL = "A read tool is written mcp__<server>__<tool>."  # our string
TOO_MANY_TOOLS = f"At most {READ_TOOLS_MAX} read tools can be marked."  # our string


class SettingsRequest(BaseModel):
    agentId: str | None = None
    acts: bool | None = None
    autoRun: bool | None = None
    readTools: list[str] | None = None
    baseRevision: str
    clientId: str | None = None


class CreateRequest(BaseModel):
    copyChangeReviewer: bool = False
    clientId: str | None = None


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def _tool_rows(name: str, result: Any, marked: set[str]) -> list[dict[str, Any]]:
    if result is None or not getattr(result, "ok", False):
        return []
    hinted = set(result.read_only or ())
    rows = []
    for tool, description in result.tools:
        tid = f"mcp__{name}__{tool}"
        rows.append({"id": tid, "name": tool, "description": description or "",
                     "marked": tid in marked, "serverSaysReadOnly": tool in hinted})
    return rows


def router(ctx: ApiContext, loop: WorkLoop, service: WorkService) -> APIRouter:
    api = APIRouter()

    def registry() -> AgentRegistry:
        return loop.registry()

    @api.get("/work/agent-settings")
    def agent_settings() -> dict:
        return loop.settings_status()

    @api.put("/work/agent-settings")
    def put_agent_settings(req: SettingsRequest):
        try:
            merged, revision = device_settings.read()
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        if revision != (req.baseRevision or ""):
            return JSONResponse({"currentRevision": revision}, status_code=409)
        patch: dict[str, Any] = {}
        given = req.model_fields_set
        if "agentId" in given:
            if req.agentId is not None:
                record, problem = work_agent(registry(), {"workAgentId": req.agentId})
                if record is None:
                    return _error(422, problem or "That agent isn't listed any more.")
            patch["workAgentId"] = req.agentId
        if req.readTools is not None:
            if len(req.readTools) > READ_TOOLS_MAX:
                return _error(422, TOO_MANY_TOOLS)
            if not all(READ_TOOL_ID.match(t) for t in req.readTools):
                return _error(422, BAD_TOOL)
            patch["workReadTools"] = list(dict.fromkeys(req.readTools))
        if req.autoRun is not None:
            patch["workAutoRun"] = req.autoRun
        if req.acts is not None:
            patch["workAgentActs"] = req.acts
        try:
            if req.acts and "agentId" not in given:
                ensure_work_agent(registry(), merged, user=service.user_name(), home=loop.home())
                _merged, revision = device_settings.read()  # first use set workAgentId
            if patch:
                device_settings.patch(patch, revision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except device_settings.SettingsProblem as exc:
            return _error(422, exc.message)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        ctx.announce(ChangeEvent("workQueue", "settings", None, origin=req.clientId))
        loop.wake()
        return loop.settings_status()

    @api.get("/work/agent/create-info")
    def create_info() -> dict:
        name, n = WORK_AGENT_NAME, 1
        reg = registry()
        while _taken(reg, name):
            n += 1
            name = f"{WORK_AGENT_NAME} {n}"
        found = find_change_reviewer(Path(loop.home()))
        return {"name": name, "changeReviewer": str(found) if found else None}

    @api.post("/work/agent/create", status_code=201)
    def create(req: CreateRequest):
        merged, _revision = device_settings.read()
        if work_agent(registry(), merged)[0] is not None:
            return _error(409, ALREADY_SET)
        record = create_work_agent(registry(), user=service.user_name(),
                                   copy_change_reviewer=req.copyChangeReviewer, home=Path(loop.home()))
        ctx.announce(ChangeEvent("agents", record.id, None, origin=req.clientId))
        ctx.announce(ChangeEvent("workQueue", "settings", None, origin=req.clientId))
        loop.wake()
        new, _rev = device_settings.read()
        return JSONResponse({"agent": record.to_api(new), "settings": loop.settings_status()}, status_code=201)

    @api.get("/work/read-tools")
    def read_tools() -> dict:
        merged, _rev = device_settings.read()
        marked = set(merged.get("workReadTools") or [])
        servers: list[dict[str, Any]] = []
        record, _problem = work_agent(registry(), merged)
        seen: set[str] = set()
        if record is not None and record.exists and not record.missing:
            for name, server in agentfiles.folder_mcp_servers(Path(record.folder)).items():
                seen.add(name)
                result = mcpgateway.TOOL_CACHE.get(mcpgateway.folder_key(record.id, name, server))
                rows = _tool_rows(name, result, marked)
                servers.append({"name": name, "source": "folder", "listed": result is not None and result.ok,
                                "tools": rows})
        for rec in McpStore().list():
            name = rec.data.get("name")
            if not isinstance(name, str) or name in seen or not rec.data.get("enabled", True):
                continue
            result = mcpgateway.TOOL_CACHE.get(mcpgateway.gateway_key(rec))
            servers.append({"name": name, "source": "gateway", "listed": result is not None and result.ok,
                            "tools": _tool_rows(name, result, marked)})
        return {"servers": servers}

    if os.environ.get("OBJECT_FAKE_NOTIFY_FILE"):

        @api.post("/_test/work/idle")
        def test_idle() -> dict:
            return {"idle": loop.wait_idle(30.0)}

    return api
