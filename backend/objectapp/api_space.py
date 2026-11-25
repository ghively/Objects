"""The open space's own routes, mounted on ``/api`` (once inline in `server.py`):

- ``GET /api/space`` -> the space's name, root, types and switches (`space_info`).
- ``POST /api/space/setup`` ``{setup}`` -> the same after the starting point is written
  (``422`` an unknown pick, ``409`` ``blank`` once the space has a start, ``423``).
- ``PUT /api/space`` ``{patch, baseRevision, clientId?}`` -> the same after the config
  write (``422``, ``409 {currentRevision}``, ``423``); the Work switch moving is
  announced through `create_app`'s ``announce_work_moved``."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .space import ReadOnly
from .spaceconfig import (
    SpaceConfigProblem,
    needs_setup,
    patch as patch_space_config,
    space_fields,
)
from .typemodel import RevisionConflict
from .watcher import ChangeEvent

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


class SpaceSetupRequest(BaseModel):
    setup: str


class PatchSpaceRequest(BaseModel):
    patch: dict[str, Any]
    baseRevision: str = ""
    clientId: str | None = None


def router(ctx: ApiContext, announce_work_moved: Callable[[], None]) -> APIRouter:
    """The open space's routes; ``announce_work_moved`` is `create_app`'s (M32's Work switch)."""
    space = ctx.space
    announce = ctx.announce

    r = APIRouter()

    def space_info() -> dict[str, Any]:
        fields = space_fields(space.root)
        # M32: the effective Work switch is the open space's own answer (the stored value, else
        # the default from its index); asked before the types are listed, so the Task type's
        # fields already follow it. Reading it writes nothing.
        work_on = space.work_on()
        return {
            "name": fields["name"],
            "root": str(space.root),
            "types": space.types_api(),  # M28: with each type's computed other sides
            "icon": fields["icon"],
            "description": fields["description"],
            "hideTaskManagement": fields["hideTaskManagement"],
            "jiraSite": fields["jiraSite"],
            # M32: the Work switch as stored (true / false / null) and the effective value.
            "workEnabled": fields["workEnabled"],
            "workOn": work_on,
            "revision": fields["revision"],
            "needsSetup": needs_setup(space.root),
        }

    @r.get("/space")
    def get_space():
        return space_info()

    @r.post("/space/setup")
    def post_space_setup(req: SpaceSetupRequest):
        # Fix pass H2: "Pick a starting point" for a space opened as a new or empty folder.
        # M32: the app no longer asks. ``blank`` is the plain start of a new or empty folder
        # (refused once the space has a start); the starter sets ``basic`` and ``itops`` are
        # also added later, from the type gallery: they write only what the space lacks.
        if req.setup not in ("basic", "itops", "blank"):
            return _error(422, "Pick \"basic\", \"itops\" or \"blank\" as the starting point.")
        if req.setup == "blank" and not needs_setup(space.root):
            return _error(409, "This space already has a starting point.")
        try:
            created = space.apply_setup(req.setup)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        # The types written (the starter's, a new space's Task and DailyNote), then M28's
        # templates and seed Tags as created objects.
        announce(ChangeEvent("types", "*", None))
        for rel in created:
            announce(ChangeEvent("created", rel, space.cached_version(rel)))
        return space_info()

    @r.put("/space")
    def put_space(req: PatchSpaceRequest):
        try:
            patch_space_config(space.root, req.patch, req.baseRevision)
        except SpaceConfigProblem as exc:
            return _error(422, exc.message)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        info = space_info()
        # M32: when the Work switch moved, the types' fields and the saved searches (Tickets)
        # did too, in memory: the windows read both again (and the Work loop is woken).
        announce_work_moved()
        return info


    return r
