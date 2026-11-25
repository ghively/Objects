"""The Trash routes, mounted on ``/api`` (once inline in `server.py`):

- ``GET /api/trash`` -> ``TrashItem[]``.
- ``POST /api/trash/{id}/restore?clientId=`` -> ``{paths, typeIds, rewritten}`` (plus
  ``collectionIds``, ``queryIds``, ``skipped`` for a collection or query entry);
  ``422`` when a saved type now has the trashed type's id or name, ``409`` for a
  collection entry, ``404``. Announces ``created`` per path, ``changed`` per rewritten
  file, ``types``/``collections``/``queries``/``automations`` per definition, and tells
  the automation engine its rules moved.
- ``DELETE /api/trash/{id}`` and ``DELETE /api/trash`` -> ``{purged}``; ``404``."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from .apictx import ApiContext
from .automations import AutomationEngine
from .propvalues import InvalidValue
from .space import RestoreConflict
from .watcher import ChangeEvent

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def _safe(value: Any) -> Any:
    from .server import _display_safe  # lazy: server.py imports this module

    return _display_safe(value)


def router(ctx: ApiContext, automations: AutomationEngine) -> APIRouter:
    """The Trash routes; ``automations`` is the app's engine (a restore re-reads its rules)."""
    space = ctx.space
    announce = ctx.announce

    r = APIRouter()

    @r.get("/trash")
    def list_trash():
        return _safe([i.to_api() for i in space.list_trash()])

    @r.post("/trash/{trash_id}/restore")
    def restore_trash(trash_id: str, clientId: str | None = Query(default=None)):
        try:
            result = space.restore(trash_id)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except RestoreConflict as exc:
            return _error(409, exc.detail)
        except KeyError:
            return _error(404, f'There is no Trash entry "{trash_id}".')
        rewritten = result.setdefault("rewritten", [])
        for type_id in result["typeIds"]:
            announce(ChangeEvent("types", type_id, None, origin=clientId))
        for collection_id in result.get("collectionIds", []):
            announce(ChangeEvent("collections", collection_id, None, origin=clientId))
        for query_id in result.get("queryIds", []):
            announce(ChangeEvent("queries", query_id, None, origin=clientId))
        for rule_id in result.get("automationIds", []):
            announce(ChangeEvent("automations", rule_id, None, origin=clientId))
        if result.get("automationIds"):
            automations.rules_changed()
        for path in result["paths"]:
            announce(ChangeEvent("created", path, space.cached_version(path), origin=clientId))
        for path in rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=clientId))
        return result

    @r.delete("/trash/{trash_id}")
    def purge_trash(trash_id: str, clientId: str | None = Query(default=None)):
        del clientId  # purging touches no visible file
        try:
            return {"purged": space.purge(trash_id)}
        except KeyError:
            return _error(404, f'There is no Trash entry "{trash_id}".')

    @r.delete("/trash")
    def empty_trash(clientId: str | None = Query(default=None)):
        del clientId
        return {"purged": space.empty_trash()}


    return r
