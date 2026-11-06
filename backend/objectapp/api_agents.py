"""The ``/api/agents...`` routes (M17; the plan's Contract "Routes").

T1 mounts this router empty; T7 fills it: list, get, create, add folder, save, delete,
unregister, the agent trash and restore, instructions, tools and chats, reveal.
"""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The agent routes, mounted on the app's ``/api`` router (so no prefix here)."""
    r = APIRouter()
    return r
