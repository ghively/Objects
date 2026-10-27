"""The space-folder deletion route (M8 Task 8 fills this router; M8 Task 2 mounted it empty).

- ``POST /api/spaces/delete`` ``{path, permanent?}`` -> ``{trashed}``
"""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The space-folder deletion route, mounted on the app's `/api` router (so no prefix here)."""
    return APIRouter()
