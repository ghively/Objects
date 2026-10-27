"""The version-history routes (M8 Task 4 fills this router; M8 Task 2 mounted it empty).

- ``GET /api/history?path=`` -> ``{versions: VersionInfo[]}`` newest first
- ``GET /api/history/version?path=&id=`` -> ``VersionContent``
- ``POST /api/history/restore`` ``{path, id, baseVersion, clientId?}`` -> ``{version}`` (boards: ``{revision}``)
"""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The version-history routes, mounted on the app's `/api` router (so no prefix here)."""
    return APIRouter()
