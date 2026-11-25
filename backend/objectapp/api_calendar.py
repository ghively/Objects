"""The calendar range route, mounted on ``/api`` (once inline in `server.py`):

- ``GET /api/calendar?from=&to=`` -> the days between the two dates (daily notes, tasks,
  dated and created/updated objects); ``422`` without both bounds or for a bad range.
  Answered as a `SafeJSONResponse` (see `GET /api/objects`)."""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from .apictx import ApiContext
from .propvalues import InvalidValue

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def router(ctx: ApiContext) -> APIRouter:
    """The calendar route."""
    from .server import SafeJSONResponse  # lazy: server.py imports this module
    space = ctx.space

    r = APIRouter()

    @r.get("/calendar")
    def get_calendar(from_: str | None = Query(default=None, alias="from"), to: str | None = None):
        if not from_ or not to:
            return _error(422, "A calendar range needs from and to (YYYY-MM-DD).")
        try:
            return SafeJSONResponse(space.calendar(from_, to))  # see `list_objects`
        except InvalidValue as exc:
            return _error(422, str(exc))


    return r
