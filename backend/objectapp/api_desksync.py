"""Desk sync's app routes (M24): ``GET /work/desk-sync`` and ``POST /work/desk-sync/setup``.
T1 mounts the read; T8 fills the setup.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter

from . import desksync
from .apictx import ApiContext

if TYPE_CHECKING:
    from .automations import AutomationEngine
    from .workloop import WorkLoop
    from .workservice import WorkService

__all__ = ["router"]


def router(ctx: ApiContext, loop: WorkLoop, service: WorkService, engine: AutomationEngine) -> APIRouter:
    api = APIRouter()

    @api.get("/work/desk-sync")
    def desk_sync_status() -> dict:
        return desksync.status(ctx.space, engine, list(loop.read_settings().get("workReadTools") or []))

    return api
