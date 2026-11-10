"""M27 routes for the agent workflow (design sections 8 and 9), mounted by `api_import` on ``/api``.

- ``POST /api/import/batches`` ``{path, leaveOut?}`` -> ``{batch, scan}``: a draft batch for a source
  (the scan runs and is stored as ``scan.json``); the import adopts it (``StartImportRequest.batch``).
- ``GET  /api/import/batches/{id}/proposal`` -> ``{proposal, review}`` (both null until one is saved).
- ``PUT  /api/import/batches/{id}/proposal/review`` ``{items: [{id, status, edited?}]}`` -> ``{ok, review}``.
- ``POST /api/import/batches/{id}/proposal/apply`` -> ``{created, extended, skipped}``: creates and edits
  the approved types. App only; there is no MCP tool for it.
- ``POST /api/import/batches/{id}/filing/start`` ``{trial}`` -> ``{ok}``;
  ``GET .../filing`` -> ``{state, trial: {items, rightShare}, normalise, error}``;
  ``POST .../filing/mark`` ``{path, verdict}``; ``POST .../filing/continue``;
  ``POST .../filing/normalise`` ``{merges: [{from: [...], to}]}``.
- M30, a batch kept as Sources: ``GET /api/import/batches/{id}/entities`` -> ``EntitiesView``;
  ``PUT .../entities/review`` ``{decisions, merges, splits}`` -> ``{ok, view}``;
  ``POST .../entities/write`` ``{}`` -> 202 ``{ok}`` (the Write runs in the filing worker; poll
  ``GET .../filing``). App only; there is no MCP tool to accept or write entities. ``409``
  ("This import didn't keep its pages as Sources.") on a batch not kept as Sources.

Reads write nothing. ``404`` unknown batch, ``409`` busy or not allowed now, ``422`` bad input.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import importfiling
from .api_importscan import NO_SOURCE, scan_root
from .apictx import ApiContext
from .importers import batches, entities, filing, proposal
from .importers.jobs import Jobs
from .importscan import scan_tree

__all__ = ["router"]


class DraftRequest(BaseModel):
    path: str
    leaveOut: list[str] = Field(default_factory=list)


class ReviewRequest(BaseModel):
    items: list[dict[str, Any]]


class StartRequest(BaseModel):
    trial: bool = True


class MarkRequest(BaseModel):
    path: str
    verdict: str


class Merge(BaseModel):
    from_: list[str] = Field(alias="from")
    to: str


class NormaliseRequest(BaseModel):
    merges: list[Merge]


class EntityDecision(BaseModel):
    status: str
    name: str | None = None


class SplitOp(BaseModel):
    id: str
    names: list[str]


class EntitiesReviewRequest(BaseModel):
    decisions: dict[str, EntityDecision] = Field(default_factory=dict)
    merges: list[list[str]] = Field(default_factory=list)
    splits: list[SplitOp] = Field(default_factory=list)


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


NO_BATCH = "No such import batch."


def router(ctx: ApiContext, jobs: Jobs, announce_resync) -> APIRouter:
    r = APIRouter()
    fil = filing.Filing(ctx.space, announce_resync)
    r.filing = fil  # type: ignore[attr-defined]  (tests reach it)

    @r.post("/import/batches")
    def post_draft(req: DraftRequest):
        root = scan_root(req.path)  # absolute and present; never the working or home folder
        if root is None:
            return _error(404, NO_SOURCE)
        batch = batches.create_draft(ctx.space.root, str(root), req.leaveOut)
        scan = scan_tree(root, req.leaveOut).to_json()
        batches.store_scan(ctx.space.root, batch, scan)
        return {"batch": batch, "scan": scan}

    @r.get("/import/batches/{batch_id}/proposal")
    def get_proposal(batch_id: str):
        try:
            batches.load_batch(ctx.space.root, batch_id)
        except KeyError:
            return _error(404, NO_BATCH)
        return proposal.view(ctx.space, batch_id)

    @r.put("/import/batches/{batch_id}/proposal/review")
    def put_review(batch_id: str, req: ReviewRequest):
        try:
            proposal.save_review(ctx.space, batch_id, req.items)
        except KeyError:
            return _error(404, NO_BATCH)
        except proposal.ProposalInvalid as exc:
            return _error(422, str(exc))
        return {"ok": True, **proposal.view(ctx.space, batch_id)}

    @r.post("/import/batches/{batch_id}/proposal/apply")
    def post_apply(batch_id: str):
        if jobs.running():
            return _error(409, "Another import is running.")
        try:
            out = proposal.apply(ctx.space, batch_id)
        except KeyError:
            return _error(404, "No proposal for this batch.")
        except Exception as exc:  # noqa: BLE001 - InvalidValue, RevisionConflict: the app's words
            return _error(422, str(exc) or "The types could not be changed.")
        if out["created"] or out["extended"]:
            announce_resync()
        return out

    def base(request: Request) -> str:
        return f"{request.url.scheme}://{request.url.netloc}"

    @r.post("/import/batches/{batch_id}/filing/start")
    def post_start(batch_id: str, req: StartRequest, request: Request):
        try:
            fil.start(batch_id, req.trial, importfiling.make_runner(ctx.space, base(request), None))
        except KeyError:
            return _error(404, NO_BATCH)
        except (filing.Busy, filing.NotAllowed) as exc:
            return _error(409, str(exc))
        return {"ok": True}

    @r.get("/import/batches/{batch_id}/filing")
    def get_filing(batch_id: str):
        try:
            return fil.status(batch_id)
        except KeyError:
            return _error(404, NO_BATCH)

    @r.post("/import/batches/{batch_id}/filing/mark")
    def post_mark(batch_id: str, req: MarkRequest):
        try:
            fil.mark(batch_id, req.path, req.verdict)
        except ValueError as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, "That object is not in the trial.")
        return {"ok": True}

    @r.post("/import/batches/{batch_id}/filing/continue")
    def post_continue(batch_id: str, request: Request):
        try:
            fil.continue_(batch_id, importfiling.make_runner(ctx.space, base(request), None))
        except KeyError:
            return _error(404, NO_BATCH)
        except (filing.Busy, filing.NotAllowed) as exc:
            return _error(409, str(exc))
        return {"ok": True}

    @r.post("/import/batches/{batch_id}/filing/normalise")
    def post_normalise(batch_id: str, req: NormaliseRequest):
        try:
            out = fil.normalise(batch_id, [{"from": m.from_, "to": m.to} for m in req.merges])
        except KeyError:
            return _error(404, NO_BATCH)
        announce_resync()
        return {"ok": True, **out}

    # M30: the entities of a batch kept as Sources

    @r.get("/import/batches/{batch_id}/entities")
    def get_entities(batch_id: str):
        try:
            return fil.entities_view(batch_id)
        except KeyError:
            return _error(404, NO_BATCH)
        except filing.NotAllowed as exc:
            return _error(409, str(exc))

    @r.put("/import/batches/{batch_id}/entities/review")
    def put_entities_review(batch_id: str, req: EntitiesReviewRequest):
        try:
            view = fil.save_entity_review(batch_id, req.model_dump(exclude_none=True))
        except KeyError:
            return _error(404, NO_BATCH)
        except filing.NotAllowed as exc:
            return _error(409, str(exc))
        except entities.ReviewInvalid as exc:
            return _error(422, str(exc))
        return {"ok": True, "view": view}

    @r.post("/import/batches/{batch_id}/entities/write", status_code=202)
    def post_entities_write(batch_id: str):
        try:
            batches.load_batch(ctx.space.root, batch_id)
        except KeyError:
            return _error(404, NO_BATCH)
        if jobs.running():
            return _error(409, "Another import is running.")
        try:
            fil.write_entities(batch_id)
        except KeyError:
            return _error(404, NO_BATCH)
        except (filing.Busy, filing.NotAllowed) as exc:
            return _error(409, str(exc))
        return {"ok": True}

    return r
