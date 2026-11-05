"""The M15 import routes (contract: ``docs/superpowers/plans/2026-11-05-m15-importers.md``).

- ``POST /api/import/preview`` `PreviewRequest` -> `ImportPreview`: reads the zip or folder at
  ``source.path`` into an `ImportPlan` and answers the dry run; writes nothing anywhere.
  ``404`` no such file or folder, ``415`` neither a ``.zip`` nor a folder, ``413`` over the
  limits, ``422`` a bad mapping.
- ``POST /api/import/start`` `StartImportRequest` -> ``202`` `StartImportResponse`: checks the
  target (``409`` the new space's folder exists, another import runs or the source changed since
  the preview; ``422`` bad name, a target inside the source or the source inside the target;
  ``404`` unknown or expired preview, location not a folder) and starts the job.
- ``GET /api/import/jobs/{id}`` -> `ImportJob` (``404``).
- ``POST /api/import/jobs/{id}/cancel`` -> ``{ok}``: stops after the file being written (``404``).

T1 scaffolding: every route answers ``501`` until Lane B builds it.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .apictx import ApiContext
from .importers.model import PreviewRequest, StartImportRequest

__all__ = ["NOT_BUILT", "router"]

NOT_BUILT = "Import is not built yet."


def _not_built() -> JSONResponse:
    return JSONResponse({"detail": NOT_BUILT}, status_code=501)


def router(ctx: ApiContext) -> APIRouter:
    """The import routes, mounted on the app's ``/api`` router (so no prefix here)."""
    r = APIRouter()

    @r.post("/import/preview")
    def post_preview(req: PreviewRequest):
        return _not_built()

    @r.post("/import/start", status_code=202)
    def post_start(req: StartImportRequest):
        return _not_built()

    @r.get("/import/jobs/{job_id}")
    def get_job(job_id: str):
        return _not_built()

    @r.post("/import/jobs/{job_id}/cancel")
    def post_cancel(job_id: str):
        return _not_built()

    return r
