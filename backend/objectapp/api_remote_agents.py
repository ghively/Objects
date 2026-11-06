"""The app's remote-agent routes (M20, spec section 7): ``/api/remote-agents/*`` and
``POST /api/agents/{id}/files/reveal``.

M20 Task 1 mounts this stub (no routes); Task 5 fills it. Imports no network client (the A2A
calls go through ``a2a``).
"""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The remote-agent routes, mounted on the app's ``/api`` router (so no prefix here)."""
    return APIRouter()
