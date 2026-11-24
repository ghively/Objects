"""The link-resolution routes, mounted on ``/api`` (once inline in `server.py`):

- ``GET /api/resolve?link=&from=`` -> ``{path}`` or ``404``: the object a wiki link
  names, resolved against the linking object when given.
- ``POST /api/reveal`` ``{path}`` -> ``200 {ok}``: show the file in the OS file manager
  (`server.reveal_in_file_manager`, which tests patch)."""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


class RevealRequest(BaseModel):
    path: str


def router(ctx: ApiContext) -> APIRouter:
    """The link-resolution routes."""
    space = ctx.space

    r = APIRouter()

    @r.get("/resolve")
    def resolve(link: str, from_: str | None = Query(default=None, alias="from")):
        path = space.resolve(link, from_ or None)
        if path is None:
            return _error(404, f'No object matches "{link}".')
        return {"path": path}

    @r.post("/reveal")
    def reveal(req: RevealRequest):
        from . import server  # tests patch `objectapp.server.reveal_in_file_manager`

        try:
            full = space.abspath(req.path)
        except ValueError as exc:
            return _error(400, str(exc))
        if not full.is_file():
            return _error(404, f'There is no object at "{req.path}".')
        server.reveal_in_file_manager(full)
        return {"ok": True}


    return r
