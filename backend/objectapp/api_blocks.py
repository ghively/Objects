"""The block-reference routes (M8 Task 27 fills this router; M8 Task 2 mounted it empty).

- ``GET /api/block?path=&id=`` -> ``BlockInfo``
- ``GET /api/block/references?path=&id=`` -> ``{paths: string[]}``
"""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The block-reference routes, mounted on the app's `/api` router (so no prefix here)."""
    return APIRouter()
