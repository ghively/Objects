"""The table-rows route, mounted on ``/api`` (once inline in `server.py`):

- ``POST /api/rows`` ``{typeIds?, collectionIds?, paths?, search?: {terms, mode}}`` ->
  ``{rows: [{summary, version, values, links, preview}]}``; ``422`` for a bad search.
  Answered as a `SafeJSONResponse` (see `GET /api/objects`)."""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .propvalues import InvalidValue

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


class RowsSearch(BaseModel):
    terms: list[str] = []
    mode: str = "auto"


class RowsRequest(BaseModel):
    typeIds: list[str] | None = None
    collectionIds: list[str] | None = None
    paths: list[str] | None = None
    search: RowsSearch | None = None
    #: False leaves ``preview`` empty (a view fetches the visible rows' previews after).
    preview: bool = True


def router(ctx: ApiContext) -> APIRouter:
    """The table-rows route."""
    from .server import SafeJSONResponse  # lazy: server.py imports this module
    space = ctx.space

    r = APIRouter()

    @r.post("/rows")
    def post_rows(req: RowsRequest):
        search = (req.search.terms, req.search.mode) if req.search is not None else None
        try:
            rows = space.rows(req.typeIds, req.collectionIds, req.paths, search, req.preview)
        except InvalidValue as exc:
            return _error(422, str(exc))
        return SafeJSONResponse({"rows": [asdict(r) for r in rows]})  # see `list_objects`


    return r
