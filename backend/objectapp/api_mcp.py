"""The MCP gateway's routes (M19): ``/mcp-servers...``, ``/mcp-secrets...`` and
``/agents/{id}/tools/refresh``.

Mounted on the app's ``/api`` router before `api_agents`. Every route stays available while
"Hide AI features" is on; only the UI hides the section. A 422 message never holds a submitted
value. T1 stub with no routes; the plan's Task 6 fills it. Imports no network client.
"""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The MCP routes (no prefix here)."""
    r = APIRouter()
    return r
