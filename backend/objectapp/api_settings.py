"""The device settings routes, mounted on ``/api`` (once inline in `server.py`):

- ``GET /api/settings`` -> ``{settings, revision}`` (``423`` read-only).
- ``PUT /api/settings`` ``{patch, baseRevision, clientId?}`` -> the same after the write
  (``422``, ``409 {currentRevision}``, ``423``); applies the merged settings to the
  running app (`ApiContext.settings_changed`, M8: ``timeZone`` sets ``space.tz``) and
  announces ``settings``."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .settings import SettingsProblem
from .settings import patch as patch_settings
from .settings import read as read_settings
from .space import ReadOnly
from .typemodel import RevisionConflict
from .watcher import ChangeEvent

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


class PatchSettingsRequest(BaseModel):
    patch: dict[str, Any]
    baseRevision: str = ""
    clientId: str | None = None


def router(ctx: ApiContext) -> APIRouter:
    """The device settings routes."""
    announce = ctx.announce
    settings_changed = ctx.settings_changed

    r = APIRouter()

    @r.get("/settings")
    def get_settings():
        try:
            data, revision = read_settings()
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        return {"settings": data, "revision": revision}

    @r.put("/settings")
    def put_settings(req: PatchSettingsRequest):
        try:
            data, revision = patch_settings(req.patch, req.baseRevision)
        except SettingsProblem as exc:
            return _error(422, exc.message)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        settings_changed(data)
        # Fix pass H: other windows reload their settings (and the Work page its Alerts).
        announce(ChangeEvent("settings", "settings.json", revision, origin=req.clientId))
        return {"settings": data, "revision": revision}


    return r
