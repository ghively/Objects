"""The work routes for the app (M22 Task 8; plan ``2026-11-05-m22-work-model.md``, "Routes"),
mounted on ``/api``:

- ``GET /work/items?scope=active|all`` -> ``{items: WorkItemSummary[]}`` (``active``: active
  items plus the recently done).
- ``GET /work/item?path=`` -> ``WorkItem``; ``404``, ``422`` not a work item.
- ``POST /work/step`` ``{path, stepId, stepRev, action, text?, notBefore?, ask?, clientId?}``
  -> ``WorkWriteResult``; ``409 {detail: "This step changed. Look again.", currentVersion,
  step}``, ``422 {detail}``, ``404``, ``423``.
- ``POST /work/steps`` ``{path, ops, clientId?}`` (all ops in one write) -> as above.
- ``POST /work/fields`` ``{path, baseVersion, set, remove?, clientId?}`` -> ``WorkWriteResult``;
  ``409 {currentVersion, detail: "This item changed. Look again."}``, ``422``, ``404``, ``423``.
- ``POST /work/note`` ``{path, kind, text, clientId?}`` -> ``WorkWriteResult``; ``422``
  (``"A note needs text."``), ``404``, ``423``.
- ``POST /work/close`` ``{path, baseVersion, clientId?}`` -> ``WorkWriteResult``; ``409``,
  ``422``, ``404``, ``423``.
- ``POST /work/floor`` ``{path, op, itemId?, itemRev?, place?, what?, found?, clientId?}`` ->
  ``WorkWriteResult``; ``409 {detail: "This floor item changed. Look again.",
  currentVersion}``, ``422``, ``404``, ``423``.
- ``POST /types/{typeId}/work-fields`` ``{baseRevision, clientId?}`` -> ``{type, added,
  skipped}``; ``409 {currentRevision}``, ``404``, ``422`` for a basic type (the M2 text),
  ``423``.

Every write goes through the one `WorkService` with the actor ``Actor("user", <activityName>)``
and announces one ``changed`` event (plus one per synced object) with the client id. "Add work
fields" announces ``types`` and the Tickets view's ``queries`` event.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any, Literal

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from .apictx import ApiContext
from .propvalues import InvalidValue
from .space import BASIC_LOCKED, ConfirmRequired, Conflict, ReadOnly
from .typemodel import RevisionConflict, TypeReadOnly
from .watcher import ChangeEvent
from .workfields import with_work_fields
from .workmodel import (
    ITEM_CHANGED,
    CloseRequest,
    FieldsRequest,
    FloorRequest,
    NoteRequest,
    StepRequest,
    StepsRequest,
    WorkFieldsTypeRequest,
)
from .workread import NotWorkItem
from .workrules import IllegalMove
from .workvalues import UnreadableList
from .workview import TICKETS_ID

if TYPE_CHECKING:
    from .workservice import WorkService

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def _safe(value: Any) -> Any:
    from .server import _display_safe  # lazy: server.py imports this module

    return _display_safe(value)


def router(ctx: ApiContext, service: WorkService) -> APIRouter:
    """The app's work routes over ``service`` (one per app)."""
    from .workservice import Actor, FloorItemChanged, StepChanged

    api = APIRouter()
    space = ctx.space

    def actor() -> Actor:
        return Actor("user", service.user_name())

    def current_version(path: str) -> str:
        try:
            return space.read(path)[2]
        except (KeyError, ValueError, OSError):
            return ""

    def run(path: str, client_id: str | None, call: Callable[[], dict]) -> Any:
        """``call()`` with the work errors mapped to their answers; announce the write."""
        try:
            result = call()
        except StepChanged as exc:
            return JSONResponse(
                {"detail": str(exc), "currentVersion": exc.current_version, "step": exc.step},
                status_code=409,
            )
        except FloorItemChanged as exc:
            return JSONResponse(
                {"detail": str(exc), "currentVersion": exc.current_version}, status_code=409
            )
        except Conflict as exc:
            return JSONResponse(
                {"currentVersion": exc.current_version, "detail": ITEM_CHANGED}, status_code=409
            )
        except RevisionConflict:
            # The type changed while an Area option was added: look again, as for the item.
            return JSONResponse(
                {"currentVersion": current_version(path), "detail": ITEM_CHANGED},
                status_code=409,
            )
        except (ReadOnly, TypeReadOnly) as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except NotWorkItem as exc:
            return _error(422, str(exc))
        except (IllegalMove, UnreadableList, InvalidValue) as exc:
            return _error(422, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No object at {path!r}")
        except ValueError as exc:  # a path outside the space
            return _error(400, str(exc))
        rel = result["item"]["path"]
        ctx.announce(ChangeEvent("changed", rel, result["version"], origin=client_id))
        for synced in result.get("synced") or []:
            ctx.announce(
                ChangeEvent("changed", synced, space.cached_version(synced), origin=client_id)
            )
        return _safe(result)

    # -- reads ----------------------------------------------------------------------------------

    @api.get("/work/items")
    def work_items(scope: Literal["active", "all"] = Query(default="active")):
        return _safe({"items": service.items(scope)})

    @api.get("/work/item")
    def work_item(path: str = Query(...)):
        try:
            return _safe(service.item(path))
        except NotWorkItem as exc:
            return _error(422, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No object at {path!r}")
        except ValueError as exc:
            return _error(400, str(exc))

    # -- writes ---------------------------------------------------------------------------------

    @api.post("/work/step")
    def work_step(req: StepRequest):
        return run(req.path, req.clientId, lambda: service.step(
            req.path, req.stepId, req.stepRev, req.action, actor(),
            text=req.text, not_before=req.notBefore, ask=req.ask,
        ))

    @api.post("/work/steps")
    def work_steps(req: StepsRequest):
        return run(req.path, req.clientId, lambda: service.edit_steps(req.path, req.ops, actor()))

    @api.post("/work/fields")
    def work_fields(req: FieldsRequest):
        return run(req.path, req.clientId, lambda: service.fields(
            req.path, req.baseVersion, req.set, req.remove, actor()
        ))

    @api.post("/work/note")
    def work_note(req: NoteRequest):
        return run(req.path, req.clientId,
                   lambda: service.note(req.path, req.kind, req.text, actor()))

    @api.post("/work/close")
    def work_close(req: CloseRequest):
        return run(req.path, req.clientId,
                   lambda: service.close(req.path, req.baseVersion, actor()))

    @api.post("/work/floor")
    def work_floor(req: FloorRequest):
        return run(req.path, req.clientId, lambda: service.floor(
            req.path, req.op, actor(), item_id=req.itemId, item_rev=req.itemRev,
            place=req.place, what=req.what, found=req.found,
        ))

    # -- Add work fields ------------------------------------------------------------------------

    @api.post("/types/{type_id}/work-fields")
    def add_work_fields(type_id: str, req: WorkFieldsTypeRequest):
        t, revision = space.refresh_type(type_id)
        if t is None:
            return _error(404, f"No object type {type_id!r}")
        if t.basic:
            return _error(422, BASIC_LOCKED)
        if t.readOnlyReason:
            return JSONResponse(
                {"reason": t.readOnlyReason, "detail": t.readOnlyReason}, status_code=423
            )
        if revision != (req.baseRevision or ""):
            return JSONResponse({"currentRevision": revision}, status_code=409)
        new, added, skipped = with_work_fields(t, space.types)
        if not added:
            return _safe({"type": t.to_api(revision), "added": [], "skipped": skipped})
        try:
            result = space.save_type(new, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except ConfirmRequired as exc:  # adding properties removes nothing; kept for safety
            return JSONResponse({"detail": exc.detail, "affected": exc.affected}, status_code=428)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f"No object type {type_id!r}")
        ctx.announce(ChangeEvent("types", type_id, result.revision, origin=req.clientId))
        ctx.announce(ChangeEvent("queries", TICKETS_ID, None, origin=req.clientId))
        for path in result.rewritten:
            ctx.announce(
                ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId)
            )
        return _safe({
            "type": result.type.to_api(result.revision), "added": added, "skipped": skipped,
        })

    return api
