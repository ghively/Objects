"""The version-history routes (M8 Task 4).

- ``GET /api/history?path=`` -> ``{versions: VersionInfo[]}`` newest first
- ``GET /api/history/version?path=&id=`` -> ``VersionContent``
- ``POST /api/history/restore`` ``{path, id, baseVersion, clientId?}`` -> ``{version}`` (boards: ``{revision}``)

The router factory builds the space's `HistoryStore` and installs it as
``space.before_write``, so every app write of an object file or a board sidecar keeps a
version first (`history` has the rules). The GET routes read only.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .history import HistoryStore, VersionNotFound
from .space import Conflict
from .watcher import ChangeEvent

__all__ = ["router"]


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
    space.before_write = lambda rel, data: store.snapshot(rel, data, space.clock())
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
            return _error(404, f"No object at {path!r}")
        return {"versions": store.versions(rel)}

    @r.get("/history/version")
    def get_version(path: str, id: str):
        try:
            rel = object_rel(path)
            return store.content(rel, id)
        except ValueError as exc:
            return _error(400, str(exc))
        except VersionNotFound:
            return _error(404, f"No version {id!r} of {path!r}")
        except KeyError:
            return _error(404, f"No object at {path!r}")

    @r.post("/history/restore")
    def post_restore(req: RestoreRequest):
        try:
            rel = object_rel(req.path)
            result = store.restore(space, rel, req.id, req.baseVersion, space.clock())
        except ValueError as exc:
            return _error(400, str(exc))
        except VersionNotFound:
            return _error(404, f"No version {req.id!r} of {req.path!r}")
        except KeyError:
            return _error(404, f"No object at {req.path!r}")
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except BoardReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except NotAWhiteboard as exc:
            return _error(422, str(exc))
        if "revision" in result:
            ctx.announce(ChangeEvent("whiteboard", rel, result["revision"], origin=req.clientId))
            ctx.announce(ChangeEvent("changed", rel, result["version"], origin=req.clientId))
            return {"revision": result["revision"]}
        ctx.announce(ChangeEvent("changed", rel, result["version"], origin=req.clientId))
        return {"version": result["version"]}

    return r
