"""The ``/api/v1`` routes behind the expanded ``objectapp-mcp`` (M17; the plan's "Expanded
objectapp-mcp" table).

T1 mounts this router empty; T5 fills it. Each route uses the same `Space` method as the app's
route, plus ``v1guard``. Some app routes keep their state inside their router, so `create_app`
passes the automation engine and the import router it mounts (whose ``jobs`` and preview and
start endpoints the v1 import routes reuse).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter

from .apictx import ApiContext

if TYPE_CHECKING:
    from .automations import AutomationEngine

__all__ = ["router"]


def router(ctx: ApiContext, engine: AutomationEngine, imports: APIRouter) -> APIRouter:
    """The v1 tool routes, mounted on the app's ``/api`` router (so no prefix here)."""
    r = APIRouter()
    return r
