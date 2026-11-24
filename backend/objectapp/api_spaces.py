"""The space-folder registry routes (M7; once inline in `server.py`), mounted on ``/api``.
The registry is ``<state dir>/spaces.json``; no folder is ever deleted (the M8 deletion
route is `api_spaces_m8`):

- ``GET /api/spaces`` -> ``{spaces: [...]}`` in registry order, the current space always
  listed; never writes.
- ``POST /api/spaces`` ``{name, location, setup?}`` -> ``201 {path}`` (a new folder holding
  only ``.object/space.json``, registered); ``409`` the folder exists, ``422`` bad name,
  ``404`` not a folder.
- ``POST /api/spaces/open`` ``{path}`` -> ``{path}`` (registers an existing folder; ``404``).
- ``DELETE /api/spaces?path=`` -> ``{ok}`` (registry only; ``409`` for the current space).
- ``POST /api/spaces/switch`` ``{path}`` -> ``202 {path}``, then the launcher restarts the
  server on that folder on the same port; ``404`` not a folder, ``503`` without the
  launcher (`create_app`'s ``on_switch``)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path
from typing import Literal

import os

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from .appstate import state_dir
from .apictx import ApiContext
from .spaces import Registry, SpaceNameProblem, create_space, is_full_path, normalize

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


class CreateSpaceRequest(BaseModel):
    name: str = ""
    location: str = ""
    setup: Literal["blank", "basic", "itops"] = "blank"


class SpacePathRequest(BaseModel):
    path: str = ""


def router(ctx: ApiContext, on_switch: Callable[[Path], None] | None) -> APIRouter:
    """The registry routes; ``on_switch`` is the launcher's ``SpaceHost.request_switch``."""
    space = ctx.space

    r = APIRouter()

    # -- spaces (M7): the registry in the state dir; folders are never deleted --

    def registry() -> Registry:
        return Registry(state_dir())

    @r.get("/spaces")
    def list_spaces():
        return {"spaces": [asdict(e) for e in registry().list(current=space.root)]}

    @r.post("/spaces", status_code=201)
    def post_space(req: CreateSpaceRequest):
        # Blank, or relative (it would be read against the server's working folder).
        if not is_full_path(req.location):
            return _error(404, "Choose a folder for the new space.")
        try:
            path = create_space(req.name, req.location, setup=req.setup)
        except SpaceNameProblem as exc:
            return _error(422, exc.message)
        except (NotADirectoryError, FileNotFoundError):
            return _error(404, f'"{req.location}" is not a folder.')
        except FileExistsError:
            return _error(409, "A folder with that name already exists here.")
        registry().register(path, touch=False)
        return JSONResponse({"path": str(path)}, status_code=201)

    def _folder(raw: str) -> Path | None | JSONResponse:
        """The folder `raw` names, None when there is none, or the 404 for a path that
        is not a full one (it would be read against the server's working folder)."""
        if not raw.strip():
            return None
        if not is_full_path(raw):
            return _error(404, "Choose a folder by its full path.")
        try:
            path = normalize(raw)
            return path if path.is_dir() else None
        except (ValueError, OSError):  # a NUL, or a path too long for the OS to stat
            return None

    @r.post("/spaces/open")
    def open_space(req: SpacePathRequest):
        path = _folder(req.path)
        if isinstance(path, JSONResponse):
            return path
        if path is None:
            return _error(404, f'"{req.path}" is not a folder.')
        registry().register(path, touch=False)
        return {"path": str(path)}

    @r.delete("/spaces")
    def remove_space(path: str = Query(default="")):
        if not path.strip():
            return _error(404, "No space given.")
        try:
            target = normalize(path)
        except ValueError:
            return _error(404, f'"{path[:60]}" is not a folder.')
        if os.path.normcase(str(target)) == os.path.normcase(str(space.root)):
            return _error(409, "This space is open. Switch to another space first.")
        registry().remove(target)
        return {"ok": True}

    @r.post("/spaces/switch", status_code=202)
    def switch_space(req: SpacePathRequest):
        if on_switch is None:
            return _error(503, "Switching spaces needs the Object launcher.")
        path = _folder(req.path)
        if isinstance(path, JSONResponse):
            return path
        if path is None:
            return _error(404, f'"{req.path}" is not a folder.')
        return JSONResponse(
            {"path": str(path)}, status_code=202, background=BackgroundTask(on_switch, path)
        )


    return r
