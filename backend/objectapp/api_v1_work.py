"""The work routes for agents (M22 Task 9; plan ``2026-11-05-m22-work-model.md``, "Routes"),
behind M17's ``v1guard.V1Guard``:

- ``GET /v1/work/items?scope=active|all`` -> ``{items: WorkItemSummary[]}`` (read scope)
- ``GET /v1/work/item?path=`` -> ``WorkItem`` (read scope)
- ``POST /v1/work/step``, ``/v1/work/steps``, ``/v1/work/fields``, ``/v1/work/note``,
  ``/v1/work/activity`` (``{path, text}``, the service's ``log``), ``/v1/work/floor``
  (read-write scope)

The shapes and errors are the app's (``api_work``). Every write goes through the one
`WorkService` with the actor ``Actor("agent", <token name>)``, is announced
``api:<token name>`` and is added to the activity log. Objects marked "Exclude from AI" and
templates answer 404 and are left out of the list. No v1 close: Gene closes items.

`STEP_GUARD` is read at call time by ``POST /v1/work/step`` before ``service.step``; a message
it returns answers 403 ``{detail}`` (M24 sets it).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any, Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from .apictx import ApiContext
from .propvalues import InvalidValue
from .space import Conflict, ReadOnly
from .tokens import TokenRecord, TokenStore
from .typemodel import RevisionConflict, TypeReadOnly
from .v1guard import V1Guard, error, guarded
from .workmodel import (
    ITEM_CHANGED,
    ActivityRequest,
    FieldsRequest,
    FloorRequest,
    NoteRequest,
    StepRequest,
    StepsRequest,
)
from .workread import NotWorkItem
from .workrules import IllegalMove
from .workvalues import UnreadableList

if TYPE_CHECKING:
    from .workservice import WorkService

__all__ = ["STEP_GUARD", "router"]

STEP_GUARD: Callable[[TokenRecord, str, str, str], str | None] = (
    lambda record, path, step_id, action: None
)
"""``(token, path, step id, action) -> message | None``; a message answers 403. M24 sets it."""


def _safe(value: Any) -> Any:
    from .server import _display_safe  # lazy: server.py imports this module

    return _display_safe(value)


def router(ctx: ApiContext, service: WorkService) -> APIRouter:
    """The agents' work routes over ``service`` (mounted on the app's ``/api`` router)."""
    from .workservice import Actor, FloorItemChanged, StepChanged

    space = ctx.space
    guard = V1Guard(ctx, TokenStore(space.root))
    r = APIRouter()

    def actor(token: TokenRecord) -> Actor:
        return Actor("agent", token.name)

    def current_version(rel: str) -> str:
        try:
            return space.read(rel)[2]
        except (KeyError, ValueError, OSError):
            return ""

    def visible(path: str) -> str | JSONResponse:
        try:
            return guard.visible_rel(path)
        except ValueError as exc:
            return error(400, str(exc))
        except KeyError:
            return error(404, f"No object at {path!r}")

    def write(token: TokenRecord, path: str, action: str, call: Callable[[str], dict]) -> Any:
        """``call(rel)`` for a visible object, with the work errors mapped to the app's answers;
        announce and log the write."""
        rel = visible(path)
        if isinstance(rel, JSONResponse):
            return rel
        try:
            result = call(rel)
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
            return JSONResponse(
                {"currentVersion": current_version(rel), "detail": ITEM_CHANGED}, status_code=409
            )
        except (ReadOnly, TypeReadOnly) as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except (NotWorkItem, IllegalMove, UnreadableList, InvalidValue) as exc:
            return error(422, str(exc))
        except (KeyError, FileNotFoundError):
            return error(404, f"No object at {path!r}")
        except ValueError as exc:
            return error(400, str(exc))
        done = result["item"]["path"]
        guard.announce("changed", done, result["version"], token)
        for synced in result.get("synced") or []:
            guard.announce("changed", synced, space.cached_version(synced), token)
        guard.log(token, action, done)
        return _safe(result)

    # -- reads ----------------------------------------------------------------------------------

    @r.get("/v1/work/items")
    @guarded
    def work_items(request: Request, scope: Literal["active", "all"] = Query(default="active")):  # noqa: B008
        guard.auth(request)
        hidden = guard.hidden_paths()
        items = [i for i in service.items(scope) if i["path"] not in hidden]
        for i in items:
            if i.get("projectPath") in hidden:
                i["projectPath"] = None
        return _safe({"items": items})

    @r.get("/v1/work/item")
    @guarded
    def work_item(request: Request, path: str = Query(...)):  # noqa: B008
        guard.auth(request)
        rel = visible(path)
        if isinstance(rel, JSONResponse):
            return rel
        try:
            item = service.item(rel)
        except NotWorkItem as exc:
            return error(422, str(exc))
        except (KeyError, FileNotFoundError):
            return error(404, f"No object at {path!r}")
        except ValueError as exc:
            return error(400, str(exc))
        if item.get("projectPath") in guard.hidden_paths():
            item["projectPath"] = None
        return _safe(item)

    # -- writes ---------------------------------------------------------------------------------

    @r.post("/v1/work/step")
    @guarded
    def work_step(req: StepRequest, request: Request):
        token = guard.auth(request, write=True)
        rel = visible(req.path)
        if isinstance(rel, JSONResponse):
            return rel
        message = STEP_GUARD(token, rel, req.stepId, req.action)
        if message:
            return error(403, message)
        return write(token, rel, "work-step", lambda p: service.step(
            p, req.stepId, req.stepRev, req.action, actor(token),
            text=req.text, not_before=req.notBefore, ask=req.ask,
        ))

    @r.post("/v1/work/steps")
    @guarded
    def work_steps(req: StepsRequest, request: Request):
        token = guard.auth(request, write=True)
        return write(token, req.path, "work-steps",
                     lambda p: service.edit_steps(p, req.ops, actor(token)))

    @r.post("/v1/work/fields")
    @guarded
    def work_fields(req: FieldsRequest, request: Request):
        token = guard.auth(request, write=True)
        return write(token, req.path, "work-fields", lambda p: service.fields(
            p, req.baseVersion, req.set, req.remove, actor(token)
        ))

    @r.post("/v1/work/note")
    @guarded
    def work_note(req: NoteRequest, request: Request):
        token = guard.auth(request, write=True)
        return write(token, req.path, "work-note",
                     lambda p: service.note(p, req.kind, req.text, actor(token)))

    @r.post("/v1/work/activity")
    @guarded
    def work_activity(req: ActivityRequest, request: Request):
        token = guard.auth(request, write=True)
        return write(token, req.path, "work-activity",
                     lambda p: service.log(p, req.text, actor(token)))

    @r.post("/v1/work/floor")
    @guarded
    def work_floor(req: FloorRequest, request: Request):
        token = guard.auth(request, write=True)
        return write(token, req.path, "work-floor", lambda p: service.floor(
            p, req.op, actor(token), item_id=req.itemId, item_rev=req.itemRev,
            place=req.place, what=req.what, found=req.found,
        ))

    return r
