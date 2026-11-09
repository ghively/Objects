"""The app-info route (sweep 2026-11-08): ``GET /api/app`` -> ``{version}``.

The version is the installed ``objectapp`` package's (``pyproject.toml``'s ``version``),
``"dev"`` when the package is not installed (run from a checkout without ``uv sync``).
Loopback-only like every route; reads nothing in the space. The Settings nav's footer
shows it as "Object <version>".
"""

from __future__ import annotations

import importlib.metadata

from fastapi import APIRouter

__all__ = ["app_version", "router"]


def app_version() -> str:
    """The installed package's version, or ``"dev"`` when it is not installed."""
    try:
        return importlib.metadata.version("objectapp")
    except importlib.metadata.PackageNotFoundError:
        return "dev"


def router() -> APIRouter:
    """The app-info route, mounted on the app's `/api` router (so no prefix here)."""
    r = APIRouter()

    @r.get("/app")
    def get_app():
        return {"version": app_version()}

    return r
