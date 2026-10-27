"""The graph route (M5): ``GET /api/graph`` -> ``GraphData``. Reads only."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .apictx import ApiContext
from .graphdata import graph_data

__all__ = ["router"]


def _display_safe(value: Any) -> Any:
    # Imported lazily: server.py imports this module.
    from .server import _display_safe as safe

    return safe(value)


def router(ctx: ApiContext) -> APIRouter:
    """The graph routes, mounted on the app's `/api` router (so no prefix here)."""
    r = APIRouter()

    @r.get("/graph")
    def get_graph() -> JSONResponse:
        # A JSONResponse skips FastAPI's per-value encoder (100,000 link ints at 5,000 objects).
        return JSONResponse(_display_safe(graph_data(ctx.space)))

    return r
