"""The saved-search (query) routes, mounted on ``/api`` (once inline in `server.py`):

- ``GET /api/queries`` -> the saved queries with their revisions (the built-in Tickets
  view included, M22).
- ``POST /api/queries`` ``{name?, definition?, view?, clientId?}`` -> ``201`` the query.
- ``PUT /api/queries/{id}`` ``{query, baseRevision, clientId?}`` -> ``{query}``.
- ``DELETE /api/queries/{id}?clientId=`` -> ``{trashId}`` (restorable; ``422`` for the
  built-in Tickets view). Announces ``queries``."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .propvalues import InvalidValue
from .queries import QueryDef
from .space import ReadOnly
from .typemodel import RevisionConflict
from .watcher import ChangeEvent
from .workview import api_extra as query_api_extra

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def _safe(value: Any) -> Any:
    from .server import _display_safe  # lazy: server.py imports this module

    return _display_safe(value)


class CreateQueryRequest(BaseModel):
    name: str | None = None
    definition: dict[str, Any] | None = None
    view: dict[str, Any] | None = None
    clientId: str | None = None


class SaveQueryRequest(BaseModel):
    query: dict[str, Any]
    baseRevision: str = ""
    clientId: str | None = None


def _unusable_id(id: str) -> bool:
    """An id no definition file name can hold, so no definition can exist under it.

    `JsonStore.path` checks the id's characters; the length is checked here so an
    over-long id from a URL answers 404 instead of ``ENAMETOOLONG`` from the OS (503).
    """
    return "\x00" in id or len(id.encode("utf-8", errors="surrogateescape")) > 200


def router(ctx: ApiContext) -> APIRouter:
    """The saved-search routes."""
    space = ctx.space
    announce = ctx.announce

    r = APIRouter()

    @r.get("/queries")
    def get_queries():
        return _safe([
            {**q.to_api(space.query_revision(q.id)), **query_api_extra(q)}
            for q in space.list_queries()
        ])

    @r.post("/queries", status_code=201)
    def create_query(req: CreateQueryRequest):
        try:
            q = space.create_query(req.name, req.definition, req.view)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError:  # `JsonStore.path` refused the id made from the name
            return _error(422, "This name can't be used as a file name. Try a different name.")
        announce(ChangeEvent("queries", q.id, None, origin=req.clientId))
        return JSONResponse(_safe(q.to_api(space.query_revision(q.id))), status_code=201)

    @r.put("/queries/{query_id}")
    def save_query(query_id: str, req: SaveQueryRequest):
        if _unusable_id(query_id):
            return _error(404, f'There is no query "{query_id[:60]}".')
        q = QueryDef.from_json(req.query, fallback_id=query_id)
        q.id = query_id
        try:
            q, revision = space.save_query(q, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except (KeyError, ValueError):
            return _error(404, f'There is no query "{query_id}".')
        announce(ChangeEvent("queries", query_id, revision, origin=req.clientId))
        return _safe({"query": {**q.to_api(revision), **query_api_extra(q)}})

    @r.delete("/queries/{query_id}")
    def delete_query(query_id: str, clientId: str | None = Query(default=None)):
        if _unusable_id(query_id):
            return _error(404, f'There is no query "{query_id[:60]}".')
        try:
            trash_id = space.delete_query(query_id)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:  # M22: the built-in Tickets view (before ValueError's 404)
            return _error(422, str(exc))
        except (KeyError, ValueError):
            return _error(404, f'There is no query "{query_id}".')
        announce(ChangeEvent("queries", query_id, None, origin=clientId))
        return {"trashId": trash_id}


    return r
