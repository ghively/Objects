"""The agent tools' learning routes (M18), under ``/api/v1/agent`` through `v1guard.agent_auth`:
``memory``, ``skills_list``, ``skill_view``, ``skill_manage`` and ``session_search``
(plan "Routes for the agent tools").

T1 stub: the router has no routes yet; the plan's T5 fills it. Each route acts only on the
token's own agent and calls `v1guard.agent_tool_allowed` for its tool.
"""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The learning v1 routes, mounted on the app's ``/api`` router (so no prefix here)."""
    r = APIRouter()
    return r
