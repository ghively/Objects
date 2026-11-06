"""The ``/api/v1/agent/*`` routes (M17): what an agent's own token may ask about that agent.

They need a token whose ``agent`` is set (403 "This token isn't an agent's.") and act only on
that agent. T1 mounts this router empty; T6 adds ``GET /v1/agent/info`` (M18, M20 and M21 add
their routes here).
"""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The agent v1 routes, mounted on the app's ``/api`` router (so no prefix here)."""
    r = APIRouter()
    return r
