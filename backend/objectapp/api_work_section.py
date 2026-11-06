"""The Work section's routes (M23 Task 6; plan ``2026-11-05-m23-work-section.md``, Contract
"Routes"), mounted on ``/api`` right after M22's work routers:

- ``GET /work/board?scope=active|all`` -> ``WorkBoard`` (M22's summaries plus steps, floor
  items, deadline and the people Blocked on names).
- ``GET /work/focus?day=`` -> ``FocusDay`` (reads only: a missing daily note is not created);
  ``PUT /work/focus`` ``FocusRequest`` -> ``FocusDay``; ``409 {currentVersion, detail:
  "Today's note changed. Look again."}``, ``422``, ``423``.
- ``GET /work/today?day=`` -> ``WorkToday``; ``GET /work/wins?days=1-31`` -> ``WorkWins``.
- ``GET /work/alerts`` -> ``WorkAlerts``; ``POST /work/alerts/scan`` -> ``{report, alerts}``;
  ``POST /work/alert-type`` -> ``{type, created}`` ("Add the Alert type"); ``423``.
- ``GET /work/floor/general`` -> ``GeneralFloor``; ``POST /work/floor/general``
  ``GeneralFloorRequest`` -> ``GeneralFloor``; ``409 {detail: "This floor item changed. Look
  again."}``, ``422``, ``423``.
- The M24 seams: ``GET /work/agent``, ``PUT /work/agent/acts``, ``POST /work/agent/retry``,
  ``POST /work/captures`` (201), ``GET /work/captures?status=``; an unfilled seam answers
  ``501 {detail}``, a filled seam's refusal its own status.
- ``GET /work/keep-on-top`` -> ``{window}``; ``POST /work/keep-on-top`` -> 204 (the window
  opened at ``{base}/?mini=work``) or ``501``.

Every write to a work item stays on M22's routes; this router has none. Reads write nothing.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import TYPE_CHECKING, Any, Literal

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import JSONResponse

from . import alerttype, windowhost, workboard, workday, workfloor, workfocus, workwins
from .alertwatch import alerts_view
from .apictx import ApiContext
from .history import HistoryStore
from .localtime import to_local
from .propvalues import InvalidValue
from .space import Conflict, ReadOnly
from .typemodel import TypeReadOnly
from .watcher import ChangeEvent
from .workseams import SeamRefused, SeamUnavailable
from .worksection_model import (
    AgentActsRequest,
    AgentRetryRequest,
    CaptureRequestModel,
    ClientOnly,
    FocusRequest,
    GeneralFloorRequest,
)

if TYPE_CHECKING:
    from .alertwatch import AlertWatch
    from .workseams import WorkSeams
    from .workservice import WorkService

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def _locked(reason: str) -> JSONResponse:
    return JSONResponse({"reason": reason, "detail": reason}, status_code=423)


def _safe(value: Any) -> Any:
    from .server import _display_safe  # lazy: server.py imports this module

    return _display_safe(value)


def _seam_error(exc: SeamRefused | SeamUnavailable) -> JSONResponse:
    if isinstance(exc, SeamRefused):
        return _error(exc.status, exc.detail)
    return _error(501, exc.detail)


def router(ctx: ApiContext, service: WorkService, seams: WorkSeams, watch: AlertWatch) -> APIRouter:
    """The Work section's routes over ``service``, ``seams`` and ``watch`` (one per app)."""
    from .workservice import FloorItemChanged

    api = APIRouter()
    space = ctx.space

    def history() -> HistoryStore:
        """Built per call, as ``api_history`` builds it (constructing it creates nothing)."""
        from .whiteboardstore import is_whiteboard

        return HistoryStore(space.root, is_whiteboard=lambda md: is_whiteboard(space, md))

    def today_local() -> str:
        return to_local(space.clock(), space.tz).date().isoformat()

    # -- the board ------------------------------------------------------------------------------

    @api.get("/work/board")
    def work_board(scope: Literal["active", "all"] = Query(default="active")):
        return _safe(workboard.board(space, service, scope))

    # -- focus lines ----------------------------------------------------------------------------

    @api.get("/work/focus")
    def work_focus(day: str | None = Query(default=None)):
        try:
            return _safe(workfocus.focus_day(space, day if day is not None else today_local()))
        except InvalidValue as exc:
            return _error(422, str(exc))

    @api.put("/work/focus")
    def save_work_focus(req: FocusRequest):
        try:
            before = workfocus.focus_day(space, req.day)
            out = workfocus.save_focus(space, req.day, req.lines, req.baseVersion)
        except Conflict as exc:
            return JSONResponse(
                {"currentVersion": exc.current_version, "detail": workfocus.FOCUS_CHANGED},
                status_code=409,
            )
        except ReadOnly as exc:
            return _locked(exc.reason)
        except InvalidValue as exc:
            return _error(422, str(exc))
        path = out["notePath"]
        if path:
            made = before["notePath"] is None
            if made:
                ctx.announce(ChangeEvent("created", path, out["version"], origin=req.clientId))
            if made or out["version"] != before["version"]:
                ctx.announce(ChangeEvent("changed", path, out["version"], origin=req.clientId))
        return _safe(out)

    # -- today and wins -------------------------------------------------------------------------

    @api.get("/work/today")
    def work_today(day: str | None = Query(default=None)):
        try:
            return _safe(workday.today(space, day))
        except InvalidValue as exc:
            return _error(422, str(exc))

    @api.get("/work/wins")
    def work_wins(days: int = Query(default=14, ge=1, le=31)):
        return _safe(workwins.wins(space, service, history(), days=days))

    # -- alerts ---------------------------------------------------------------------------------

    @api.get("/work/alerts")
    def work_alerts():
        return _safe(alerts_view(space, watch))

    @api.post("/work/alerts/scan")
    def scan_alerts(req: ClientOnly):
        report = watch.scan_once()  # the watch announces its own writes (origin "alerts")
        return _safe({"report": asdict(report), "alerts": alerts_view(space, watch)})

    @api.post("/work/alert-type")
    def add_alert_type(req: ClientOnly):
        try:
            t, created = alerttype.ensure_alert_type(space)
        except (ReadOnly, TypeReadOnly) as exc:
            return _locked(exc.reason)
        except InvalidValue as exc:
            return _error(422, str(exc))
        fresh, revision = space.refresh_type(t.id)
        if fresh is not None:
            t = fresh
        if created:
            ctx.announce(ChangeEvent("types", t.id, revision, origin=req.clientId))
        return _safe({"type": t.to_api(revision), "created": created})

    # -- the general floor list -----------------------------------------------------------------

    @api.get("/work/floor/general")
    def general_floor():
        return _safe(workfloor.general_floor(space))

    @api.post("/work/floor/general")
    def general_floor_op(req: GeneralFloorRequest):
        try:
            out = workfloor.general_floor_op(
                space, req.op, item_id=req.itemId, item_rev=req.itemRev,
                place=req.place, what=req.what, found=req.found,
            )
        except FloorItemChanged as exc:
            return _error(409, str(exc))
        except ReadOnly as exc:
            return _locked(exc.reason)
        except InvalidValue as exc:
            return _error(422, str(exc))
        ctx.announce(
            ChangeEvent("work", workfloor.FLOOR_ID, out["revision"], origin=req.clientId)
        )
        return _safe(out)

    # -- the M24 seams --------------------------------------------------------------------------

    @api.get("/work/agent")
    def work_agent():
        board = workboard.board(space, service, "active")["items"]
        return _safe(seams.agent.status(space, board))

    @api.put("/work/agent/acts")
    def set_agent_acts(req: AgentActsRequest):
        try:
            return _safe(seams.agent.set_acts(space, req.on))
        except (SeamRefused, SeamUnavailable) as exc:
            return _seam_error(exc)

    @api.post("/work/agent/retry")
    def retry_agent_entry(req: AgentRetryRequest):
        try:
            return _safe(seams.agent.retry(space, req.id))
        except (SeamRefused, SeamUnavailable) as exc:
            return _seam_error(exc)
        except KeyError:
            return _error(404, f"No agent queue entry {req.id!r}")

    @api.post("/work/captures", status_code=201)
    def save_capture(req: CaptureRequestModel):
        try:
            capture = seams.captures.save(space, req, space.clock())
        except (SeamRefused, SeamUnavailable) as exc:
            return _seam_error(exc)
        except InvalidValue as exc:
            return _error(422, str(exc))
        return JSONResponse(_safe({"capture": capture}), status_code=201)

    @api.get("/work/captures")
    def list_captures(
        status: Literal["new", "filed", "needsYou"] | None = Query(default=None),
    ):
        return _safe({"captures": seams.captures.list(space, status)})

    # -- keep on top ----------------------------------------------------------------------------

    @api.get("/work/keep-on-top")
    def keep_on_top_info():
        return {"window": windowhost.can_open()}

    @api.post("/work/keep-on-top", status_code=204)
    def open_keep_on_top(req: ClientOnly, request: Request):
        url = f"{str(request.base_url).rstrip('/')}/?mini=work"
        try:
            windowhost.open_window(url)
        except SeamUnavailable as exc:
            return _error(501, exc.detail)
        return Response(status_code=204)

    return api
