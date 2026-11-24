"""A type's data-view routes, mounted on ``/api`` (once inline in `server.py`):

- ``GET /api/views/{typeId}`` -> ``{views, revision, readOnlyReason?}`` (the saved views
  over the defaults; ``404``).
- ``PUT /api/views/{typeId}`` ``{views, baseRevision, clientId?}`` -> ``{revision}``;
  ``422`` a bad Views object, ``409 {currentRevision}``, ``423``. Announces ``views``."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .jsonstore import DefinitionUnreadable, default_views, json_revision, normalize_views
from .space import ReadOnly
from .typemodel import RevisionConflict
from .watcher import ChangeEvent

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


class SaveViewsRequest(BaseModel):
    views: dict[str, Any]
    baseRevision: str = ""
    clientId: str | None = None


def _views_problem(views: dict[str, Any]) -> str | None:
    """Why a PUT /api/views body is not a Views object, else None."""
    if "activeTab" in views and not isinstance(views["activeTab"], str):
        return 'The key "activeTab" must be a string.'
    if "all" in views and not isinstance(views["all"], dict):
        return 'The key "all" must be an object.'
    if "dashboard" in views:
        dash = views["dashboard"]
        if not isinstance(dash, dict):
            return 'The key "dashboard" must be an object.'
        sections = dash.get("sections", [])
        if not isinstance(sections, list) or not all(
            isinstance(x, dict) and isinstance(x.get("key"), str) for x in sections
        ):
            return 'The key "dashboard.sections" must be a list of sections with a key.'
        if not isinstance(dash.get("removedSections", []), list):
            return 'The key "dashboard.removedSections" must be a list.'
    return None


def router(ctx: ApiContext) -> APIRouter:
    """A type's data-view routes."""
    space = ctx.space
    announce = ctx.announce

    r = APIRouter()

    @r.get("/views/{type_id}")
    def get_views(type_id: str):
        t = space.type_by_id(type_id)
        if t is None:
            return _error(404, f'There is no object type "{type_id}".')
        store = space.store("views")
        try:
            data, revision = store.read(type_id)
        except DefinitionUnreadable as exc:
            revision = json_revision(store.path(type_id))
            return {"views": default_views(t), "revision": revision, "readOnlyReason": exc.error}
        except ValueError:
            # An id no file name can hold (e.g. with a space): its views can't be stored.
            return {
                "views": default_views(t),
                "revision": "",
                "readOnlyReason": "This type's id can't be used as a file name, so its views can't be saved.",
            }
        return {"views": normalize_views(data, default_views(t)), "revision": revision}

    @r.put("/views/{type_id}")
    def put_views(type_id: str, req: SaveViewsRequest):
        if space.type_by_id(type_id) is None:
            return _error(404, f'There is no object type "{type_id}".')
        problem = _views_problem(req.views)
        if problem:
            return _error(422, problem)
        try:
            revision = space.store("views").write(type_id, req.views, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except ValueError:
            return _error(422, "This type's id can't be used as a file name, so its views can't be saved.")
        announce(ChangeEvent("views", type_id, revision, origin=req.clientId))
        return {"revision": revision}


    return r
