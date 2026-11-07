"""M25 import batch routes (design section 7), mounted by `api_import` on ``/api``.

- ``GET /api/import/batches`` -> the open space's batches, newest first (``batch.json`` of each).
- ``GET /api/import/batches/{id}`` -> ``{batch, items}``; ``404`` unknown.
- ``POST /api/import/batches/{id}/trash`` -> ``{trashed, missing}``: **Move batch to Trash**. Every
  object the batch created goes to the Trash (restorable as any Trash item); objects it only
  updated stay (restore them from version history). ``409`` while an import runs.
- ``POST /api/import/batches/{id}/resolve`` ``{action: "take" | "keep", paths?: [...]}`` ->
  ``{resolved, failed, pending}``: **Take source** / **Keep mine** for the batch's "changed in
  both" items (all, or the named objects). ``409`` while an import runs.

- ``POST /api/import/original/reveal`` ``{path}`` -> ``{ok}``: **Show file** for a kept original.

Batch records live in ``.object/imports/<batch>/`` (`importers.batches`).
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .importers import batches
from .importers.jobs import Jobs

__all__ = ["router"]

_log = logging.getLogger(__name__)


class OriginalRequest(BaseModel):
    path: str


class ResolveRequest(BaseModel):
    action: Literal["take", "keep"]
    paths: list[str] | None = None


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def router(ctx: ApiContext, jobs: Jobs, announce_resync) -> APIRouter:
    r = APIRouter()

    def changed() -> None:
        try:
            ctx.search.reindex()
        except Exception:  # noqa: BLE001 - search catches up on its own
            pass
        announce_resync()

    @r.get("/import/batches")
    def get_batches():
        return {"batches": batches.list_batches(ctx.space.root)}

    @r.get("/import/batches/{batch_id}")
    def get_batch(batch_id: str):
        try:
            data, items = batches.load_batch(ctx.space.root, batch_id)
        except KeyError:
            return _error(404, "No such import batch.")
        return {"batch": data, "items": items}

    @r.post("/import/batches/{batch_id}/trash")
    def post_trash(batch_id: str):
        if jobs.running():
            return _error(409, "Another import is running.")
        try:
            out = batches.trash_batch(ctx.space, batch_id)
        except KeyError:
            return _error(404, "No such import batch.")
        changed()
        return out

    @r.post("/import/batches/{batch_id}/resolve")
    def post_resolve(batch_id: str, req: ResolveRequest):
        if jobs.running():
            return _error(409, "Another import is running.")
        try:
            out = batches.resolve_conflicts(ctx.space, batch_id, req.action, req.paths)
        except KeyError:
            return _error(404, "No such import batch.")
        changed()
        return out

    @r.post("/import/original/reveal")
    def post_reveal_original(req: OriginalRequest):
        """"Show file" on the Source line: the kept original in the OS file manager (an
        attachment of this space; ``404`` otherwise)."""
        from . import server
        from .media import attachment_path

        try:
            full = attachment_path(ctx.space.root, req.path)
        except (FileNotFoundError, OSError, ValueError):
            return _error(404, f"No file at {req.path!r}")
        except Exception:  # noqa: BLE001 - NotServed for a .md
            return _error(404, f"No file at {req.path!r}")
        server.reveal_in_file_manager(full)
        return {"ok": True}

    return r
