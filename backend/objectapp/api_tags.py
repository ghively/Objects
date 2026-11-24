"""The tag route, mounted on ``/api`` (once inline in `server.py`):

- ``POST /api/tags/ensure`` ``{name, clientId?}`` -> ``{path, created}`` (the Tag object
  named so, case-insensitively, created in ``Tags/`` when missing); ``422`` for an empty
  name. Announces ``created`` when it created one."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .propvalues import InvalidValue
from .watcher import ChangeEvent

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


class EnsureTagRequest(BaseModel):
    name: str = ""
    clientId: str | None = None


def router(ctx: ApiContext) -> APIRouter:
    """The tag route."""
    space = ctx.space
    announce = ctx.announce

    r = APIRouter()

    @r.post("/tags/ensure")
    def ensure_tag(req: EnsureTagRequest):
        try:
            path, created = space.ensure_tag(req.name)
        except InvalidValue as exc:
            return _error(422, str(exc))
        if created:
            announce(ChangeEvent("created", path, space.cached_version(path), origin=req.clientId))
        return {"path": path, "created": created}


    return r
