"""The version-history routes (M8 Task 4).

- ``GET /api/history?path=`` -> ``{versions: VersionInfo[]}`` newest first
- ``GET /api/history/version?path=&id=`` -> ``VersionContent``
- ``POST /api/history/restore`` ``{path, id, baseVersion, clientId?}`` -> ``{version}`` (boards: ``{revision, version}``: the board revision and the `.md` version)
- ``GET /api/history/definition?path=.object/<kind>/<id>.json`` -> ``{versions}`` and
  ``GET /api/history/definition/version?path=&id=`` -> ``{id, text}`` (2026-11-08): the versions a
  type, collection, query or view definition kept before each app save. Read only; a definition
  is restored from the space's git history (``api_vcs``).

The router factory builds the space's `HistoryStore` and installs it as
``space.before_write``, so every app write of an object file or a board sidecar keeps a
version first (`history` has the rules). The GET routes read only.
"""

from __future__ import annotations

import re

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .history import HistoryStore, VersionNotFound
from .space import Conflict, ReadOnly
from .watcher import ChangeEvent

__all__ = ["router"]

_DEFINITION_RE = re.compile(r"^\.object/(types|collections|queries|views)/[A-Za-z0-9_][A-Za-z0-9_.-]{0,120}\.json$")


class RestoreRequest(BaseModel):
    path: str
    id: str
    baseVersion: str
    clientId: str | None = None


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def router(ctx: ApiContext) -> APIRouter:
    """The version-history routes, mounted on the app's `/api` router (so no prefix here)."""
    from .whiteboardstore import BoardReadOnly, NotAWhiteboard, is_whiteboard

    space = ctx.space
    store = HistoryStore(space.root, is_whiteboard=lambda md: is_whiteboard(space, md))
    space.before_write = lambda rel, data, object_id=None: store.snapshot(
        rel, data, space.clock(), object_id=object_id
    )
    r = APIRouter()

    def object_rel(path: str) -> str:
        """The object's space-relative path; `ValueError` (400) or `KeyError` (404)."""
        rel = space._rel(path)
        if not (space.root / rel).is_file():
            raise KeyError(rel)
        return rel

    @r.get("/history")
    def get_history(path: str):
        try:
            rel = object_rel(path)
        except ValueError as exc:
            return _error(400, str(exc))
        except KeyError:
            return _error(404, f'There is no object at "{path}".')
        return {"versions": store.versions(rel)}

    @r.get("/history/version")
    def get_version(path: str, id: str):
        try:
            rel = object_rel(path)
            return store.content(rel, id)
        except ValueError as exc:
            return _error(400, str(exc))
        except VersionNotFound:
            return _error(404, f'There is no version "{id}" of "{path}".')
        except KeyError:
            return _error(404, f'There is no object at "{path}".')

    def definition_rel(path: str) -> str | None:
        rel = path.replace("\\", "/")
        return rel if _DEFINITION_RE.match(rel) and ".." not in rel else None

    @r.get("/history/definition")
    def get_definition_history(path: str):
        rel = definition_rel(path)
        if rel is None:
            return _error(400, f'"{path}" is not a type, collection, query or view file.')
        return {"versions": store.versions(rel)}

    @r.get("/history/definition/version")
    def get_definition_version(path: str, id: str):
        rel = definition_rel(path)
        if rel is None:
            return _error(400, f'"{path}" is not a type, collection, query or view file.')
        try:
            return store.content(rel, id)
        except VersionNotFound:
            return _error(404, f'There is no version "{id}" of "{path}".')

    @r.post("/history/restore")
    def post_restore(req: RestoreRequest):
        try:
            rel = object_rel(req.path)
            result = store.restore(space, rel, req.id, req.baseVersion, space.clock())
        except ValueError as exc:
            return _error(400, str(exc))
        except VersionNotFound:
            return _error(404, f'There is no version "{req.id}" of "{req.path}".')
        except KeyError:
            return _error(404, f'There is no object at "{req.path}".')
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except (BoardReadOnly, ReadOnly) as exc:  # ReadOnly: an imported Source (M30)
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except NotAWhiteboard as exc:
            return _error(422, str(exc))
        if "revision" in result:
            ctx.announce(ChangeEvent("whiteboard", rel, result["revision"], origin=req.clientId))
            ctx.announce(ChangeEvent("changed", rel, result["version"], origin=req.clientId))
            return {"revision": result["revision"], "version": result["version"]}
        ctx.announce(ChangeEvent("changed", rel, result["version"], origin=req.clientId))
        return {"version": result["version"]}

    return r
