"""Desk sync's app routes (M24): ``GET /work/desk-sync`` and ``POST /work/desk-sync/setup``.
T1 mounts the read; T8 fills the setup.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import desksync
from .apictx import ApiContext
from .propvalues import InvalidValue
from .watcher import ChangeEvent
from .workagentmodel import NOT_SET, QueueRefused

if TYPE_CHECKING:
    from .automations import AutomationEngine
    from .workloop import WorkLoop
    from .workservice import WorkService

__all__ = ["router"]


class SetupRequest(BaseModel):
    clientId: str | None = None


def router(ctx: ApiContext, loop: WorkLoop, service: WorkService, engine: AutomationEngine) -> APIRouter:
    api = APIRouter()

    @api.get("/work/desk-sync")
    def desk_sync_status() -> dict:
        return desksync.status(ctx.space, engine, list(loop.read_settings().get("workReadTools") or []))

    @api.post("/work/desk-sync/setup", status_code=201)
    def desk_sync_setup(req: SetupRequest | None = None):
        settings = loop.read_settings()
        agent_id = settings.get("workAgentId")
        if not agent_id:
            return JSONResponse({"detail": NOT_SET}, status_code=422)
        read_tools = list(settings.get("workReadTools") or [])
        try:
            desksync.setup(ctx.space, engine, agent_id, ctx.space.clock())
        except QueueRefused as exc:
            return JSONResponse({"detail": exc.detail}, status_code=exc.status)
        except InvalidValue as exc:
            return JSONResponse({"detail": str(exc)}, status_code=422)
        rid = desksync.rule_id(ctx.space, engine)
        lr = engine.rules.get(rid) if rid else None
        if lr is not None:
            ctx.announce(ChangeEvent("automations", lr.id, lr.revision, origin=req.clientId if req else None))
        return JSONResponse(desksync.status(ctx.space, engine, read_tools), status_code=201)

    return api
