"""The search routes (M5).

- ``GET /api/search?q=&type=&excludeType=&tag=&limit=&mode=`` -> ``SearchResponse``
  (``{results, partial}``); ``type``/``excludeType`` repeat, a type id that
  doesn't exist is ignored; ``mode`` is ``auto`` (default) or ``title``; an empty
  ``q`` gives no results. 422 for a bad mode, a limit outside 1..200 or a ``q``
  longer than 200 characters.
- ``POST /api/search/reindex`` ``{clientId?}`` -> 202 ``{started: true}``: drops
  and rebuilds the index in the background (``partial`` until done).

Both routes write nothing in the space outside the index's cache folder.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

from .apictx import ApiContext
from .searchindex import MAX_LIMIT

__all__ = ["MAX_QUERY_LENGTH", "MODES", "router"]

MAX_QUERY_LENGTH = 200
MODES = ("auto", "title")


def _error(message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=422)


def router(ctx: ApiContext) -> APIRouter:
    """The search routes, mounted on the app's `/api` router (so no prefix here)."""
    r = APIRouter()

    @r.get("/search")
    def search(
        q: str = Query(default=""),
        type: list[str] = Query(default=[]),  # noqa: B008
        excludeType: list[str] = Query(default=[]),  # noqa: B008
        tag: str | None = Query(default=None),
        limit: str | None = Query(default=None),
        mode: str = Query(default="auto"),
    ):
        if mode not in MODES:
            return _error("mode must be auto or title.")
        if len(q) > MAX_QUERY_LENGTH:
            return _error(f"q must be at most {MAX_QUERY_LENGTH} characters.")
        n = 50
        if limit is not None and limit != "":
            try:
                n = int(limit)
            except ValueError:
                return _error(f"limit must be a whole number from 1 to {MAX_LIMIT}.")
            if not 1 <= n <= MAX_LIMIT:
                return _error(f"limit must be a whole number from 1 to {MAX_LIMIT}.")
        known = {t.id for t in ctx.space.types}
        types = [t for t in type if t in known]
        exclude = [t for t in excludeType if t in known]
        return ctx.search.search(
            q, types=types, exclude_types=exclude, tag=tag or None, limit=n, mode=mode
        )

    @r.post("/search/reindex", status_code=202)
    def reindex(body: dict[str, Any] | None = Body(default=None)):  # noqa: B008
        ctx.search.reindex()
        return JSONResponse({"started": True}, status_code=202)

    return r
