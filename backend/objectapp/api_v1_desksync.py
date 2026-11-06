"""The agent route behind `sync_ticket_fields` (M24): `POST /api/v1/agent/work/ticket-fields`. T8 fills it."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter

from .apictx import ApiContext

if TYPE_CHECKING:
    from .workloop import WorkLoop
    from .workservice import WorkService

__all__ = ["router"]


def router(ctx: ApiContext, loop: WorkLoop, service: WorkService) -> APIRouter:
    return APIRouter()
