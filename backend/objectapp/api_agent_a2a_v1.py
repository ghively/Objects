"""The ``/api/v1/agent/*`` routes behind the ``remote_agents_list``, ``remote_agent_call`` and
``delegate`` agent tools (M20, spec sections 7 and 8).

M20 Task 1 mounts this stub (no routes); Task 6 fills it. Imports no network client.
"""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The agent A2A v1 routes, mounted on the app's ``/api`` router (so no prefix here)."""
    return APIRouter()
