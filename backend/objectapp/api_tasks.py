"""The task routes (M8 Tasks 11 and 12 fill this router; M8 Task 2 mounted it empty).

- ``GET /api/tasks/overdue?path=`` -> ``OverdueInfo``
- ``POST /api/tasks/occurrence`` ``{path, action, catchUp?, baseVersion, clientId?}`` -> ``UpdateResult``
- ``GET /api/tasks/stats?path=`` -> ``TaskStats``
- ``PUT /api/tasks/reminder`` ``{path, key, remind, baseVersion, clientId?}`` -> ``UpdateResult``
"""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The task routes, mounted on the app's `/api` router (so no prefix here)."""
    return APIRouter()
