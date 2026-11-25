"""The collection routes, mounted on ``/api`` (once inline in `server.py`):

- ``GET /api/collections`` -> the definitions with their revisions.
- ``POST /api/collections`` ``{name, typeIds, icon?, clientId?}`` -> ``201`` the
  definition (``422``).
- ``PUT /api/collections/{id}`` ``{collection, baseRevision, clientId?}`` -> the
  definition after the write (``404``, ``409 {currentRevision}``, ``422``, ``423``).
- ``DELETE /api/collections/{id}?confirm=&clientId=`` -> ``{trashId, removedFrom,
  skipped, deleted}``; ``428 {detail, affected}``, ``423``. Announces ``collections``
  (and ``changed``/``deleted`` for the files it rewrote or removed)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .collections import CollectionDef
from .propvalues import InvalidValue
from .space import ConfirmRequired, ReadOnly
from .typemodel import RevisionConflict
from .watcher import ChangeEvent

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def _safe(value: Any) -> Any:
    from .server import _display_safe  # lazy: server.py imports this module

    return _display_safe(value)


class CreateCollectionRequest(BaseModel):
    name: str = ""
    typeIds: list[str] = []
    icon: Any = None
    clientId: str | None = None


class SaveCollectionRequest(BaseModel):
    collection: dict[str, Any]
    baseRevision: str = ""
    clientId: str | None = None


def router(ctx: ApiContext) -> APIRouter:
    """The collection routes."""
    space = ctx.space
    announce = ctx.announce

    r = APIRouter()

    @r.get("/collections")
    def get_collections():
        # One read of each collection file: its definition and revision together.
        return _safe([c.to_api(rev) for c, rev in space.collections_with_revisions()])

    @r.post("/collections", status_code=201)
    def create_collection(req: CreateCollectionRequest):
        try:
            c = space.create_collection(req.name, req.typeIds, req.icon)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError:  # `JsonStore.path` refused the id made from the name
            return _error(422, "This name can't be used as a file name. Try a different name.")
        announce(ChangeEvent("collections", c.id, None, origin=req.clientId))
        return JSONResponse(_safe(c.to_api(space.collection_revision(c.id))), status_code=201)

    @r.put("/collections/{collection_id}")
    def save_collection(collection_id: str, req: SaveCollectionRequest):
        if collection_id not in space.collections:
            return _error(404, f'There is no collection "{collection_id}".')
        c = CollectionDef.from_json(req.collection, fallback_id=collection_id)
        c.id = collection_id
        try:
            result = space.save_collection(c, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no collection "{collection_id}".')
        announce(ChangeEvent("collections", collection_id, result.revision, origin=req.clientId))
        for path in result.rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        return _safe(result.to_api())

    @r.delete("/collections/{collection_id}")
    def delete_collection(
        collection_id: str,
        confirm: bool = Query(default=False),
        clientId: str | None = Query(default=None),
    ):
        try:
            result = space.delete_collection(collection_id, confirm=confirm)
        except ConfirmRequired as exc:
            return JSONResponse({"detail": exc.detail, "affected": exc.affected}, status_code=428)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except KeyError:
            return _error(404, f'There is no collection "{collection_id}".')
        announce(ChangeEvent("collections", collection_id, None, origin=clientId))
        for path in result.deleted:
            announce(ChangeEvent("deleted", path, None, origin=clientId))
        for path in result.removed_from:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=clientId))
        return _safe(result.to_api())


    return r
