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

Reads write nothing. ``404`` unknown batch, ``409`` busy or not allowed now, ``422`` bad input.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import importfiling
from .apictx import ApiContext
from .importers import batches, filing, proposal
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


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


NO_BATCH = "No such import batch."


def router(ctx: ApiContext, jobs: Jobs, announce_resync) -> APIRouter:
    r = APIRouter()
    fil = filing.Filing(ctx.space, announce_resync)
    r.filing = fil  # type: ignore[attr-defined]  (tests reach it)

    @r.post("/import/batches")
    def post_draft(req: DraftRequest):
        root = Path(req.path.strip().strip('"')).expanduser()
        if not root.exists():
            return _error(404, "There is no file or folder at this path.")
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

    return r
