"""The merge route (M8 Task 6 fills this router; M8 Task 2 mounted it empty).

- ``POST /api/object/merge`` ``{source, target, sourceVersion, targetVersion, confirm, clientId?}`` -> ``MergeResult``
"""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The merge route, mounted on the app's `/api` router (so no prefix here)."""
    return APIRouter()
