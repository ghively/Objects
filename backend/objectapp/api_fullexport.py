"""The Full Export routes (M31; `fullexport` has the rules).

- ``POST /api/full-export`` ``{scope, folder?, media?, wikilinks?, titleHeading?}`` -> 202
  ``{job}``: export the open space (``scope: "current"``) or every registered space (``"all"``,
  "Export All Spaces") into a new dated folder in ``folder`` (a full path outside every space),
  in the background. A field left out takes its device setting (``fullExportFolder``,
  ``fullExportMedia``, ``fullExportWikilinks``, ``fullExportTitleHeading``). 422 (a bad scope,
  the folder unset, not a full path, missing or inside a space), 409 (an export is running).
- ``GET /api/full-export/jobs/{id}`` -> ``{id, state: running|done|failed, scope, done, total,
  result: {folder, spaces: [{name, folder, objects, media}], objects, media} | null, error}``;
  404 for an unknown id.
- ``GET /api/full-export/status`` -> ``{running: job | null, auto: {enabled, scope, folder,
  interval, lastRun, lastFolder, lastError, nextRun, blocked, running}}``: "Automated Full
  Exports" (``blocked`` says why a run can't happen: the folder unset, missing or inside a space).

Reads only, in every space: the export is written in the chosen folder alone.
"""

from __future__ import annotations

import contextlib
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .appstate import state_dir
from .fullexport import (
    SCOPES,
    AutoFullExport,
    Busy,
    FullExportJobs,
    FullExportOptions,
    Refused,
)
from .settings import read as read_settings
from .space import ReadOnly, Space
from .spaces import Registry

__all__ = ["auto_export", "router"]


class FullExportRequest(BaseModel):
    scope: str = "current"
    folder: str | None = None
    media: bool | None = None
    wikilinks: bool | None = None
    titleHeading: bool | None = None


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def _settings() -> dict[str, Any]:
    with contextlib.suppress(ReadOnly, OSError, ValueError):
        return read_settings()[0]
    return {}


def _registered(space: Space) -> list[Any]:
    try:
        return Registry(state_dir()).list(current=space.root)
    except (OSError, ValueError):
        return []


def spaces_for(space: Space, scope: str) -> list[tuple[str, Path]]:
    """``(name, folder)`` of the open space, or of every registered space that is there."""
    if scope != "all":
        return [(space.name, space.root)]
    out = [(e.name, Path(e.path)) for e in _registered(space) if not e.missing]
    return out or [(space.name, space.root)]


def all_space_folders(space: Space) -> list[Path]:
    """Every registered space's folder and the open one's: an export goes outside them all."""
    return [Path(e.path) for e in _registered(space)] + [space.root]


def auto_export(space: Space) -> AutoFullExport:
    """The automated export for the app of ``space`` (`create_app` starts and stops it)."""
    return AutoFullExport(
        settings=_settings,
        spaces=lambda scope: spaces_for(space, scope),
        all_spaces=lambda: all_space_folders(space),
        clock=lambda: space.clock(),
        state_dir=state_dir,
        local=lambda d: d.astimezone(space.tz),
    )


def router(ctx: ApiContext, auto: AutoFullExport, jobs: FullExportJobs | None = None) -> APIRouter:
    space = ctx.space
    jobs = jobs or FullExportJobs()
    r = APIRouter(prefix="/full-export")

    @r.post("")
    def post_full_export(req: FullExportRequest):
        if req.scope not in SCOPES:
            return _error(422, 'Pick "current" or "all" as the scope.')
        s = _settings()
        base = FullExportOptions.from_settings(s)
        options = FullExportOptions(
            media=base.media if req.media is None else req.media,
            wikilinks=base.wikilinks if req.wikilinks is None else req.wikilinks,
            title_heading=base.title_heading if req.titleHeading is None else req.titleHeading,
        )
        folder = req.folder if req.folder is not None else s.get("fullExportFolder")
        try:
            job = jobs.start(
                req.scope,
                spaces_for(space, req.scope),
                folder or "",
                options,
                space.clock().astimezone(space.tz),
                all_spaces=all_space_folders(space),
                label="All Spaces" if req.scope == "all" else None,
            )
        except Busy as exc:
            return _error(409, str(exc))
        except Refused as exc:
            return _error(422, str(exc))
        return JSONResponse({"job": job}, status_code=202)

    @r.get("/jobs/{job_id}")
    def get_job(job_id: str):
        job = jobs.get(job_id)
        if job is None:
            return _error(404, "There is no such export.")
        return job

    @r.get("/status")
    def get_status():
        return {"running": jobs.running(), "auto": auto.status()}

    return r
