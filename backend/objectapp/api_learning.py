"""The agent page's and the chat panel's learning routes (M18), under ``/api``: memory, skills,
the ledger and Undo, the Learning settings, "Tidy up now", chat search, "Learn from this chat"
and a chat's reviews (plan "Routes for the app").

T1 stub: the router has no routes yet; the plan's T6 fills it. `server.create_app` mounts it
**before** `api_agents` so ``GET /agents/{id}/chats/search`` isn't taken for a chat id.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter

from .apictx import ApiContext

if TYPE_CHECKING:
    from .curator import Curator
    from .reviews import ReviewRunner

__all__ = ["router"]


def router(ctx: ApiContext, *, reviews: ReviewRunner | None = None, curator: Curator | None = None) -> APIRouter:
    """The learning routes, mounted on the app's ``/api`` router (so no prefix here)."""
    r = APIRouter()
    return r
