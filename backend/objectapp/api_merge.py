"""The merge route (M8 Task 6).

- ``POST /api/object/merge`` ``{source, target, sourceVersion, targetVersion, confirm, clientId?}``
  -> ``MergeResult``. ``428`` without ``confirm`` (nothing written), ``409`` a stale version
  (``{currentVersion}``, nothing written), ``413`` over the limit (``{detail, limit}``),
  ``422`` into itself / tag into non-tag / non-tag into tag / a whiteboard, ``423`` the target
  can't be saved, ``404`` no such object. Announces ``changed`` for the target and each
  relinked object (``whiteboard`` for a relinked board file) and ``deleted`` for the source.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .merge import TooLarge, merge_objects
from .propvalues import InvalidValue
from .space import Conflict, ReadOnly
from .watcher import ChangeEvent

__all__ = ["router"]


class MergeRequest(BaseModel):
    source: str
    target: str
    sourceVersion: str
    targetVersion: str
    confirm: bool = False
    clientId: str | None = None


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def router(ctx: ApiContext) -> APIRouter:
    """The merge route, mounted on the app's `/api` router (so no prefix here)."""
    from .whiteboardfile import sidecar_owner

    space = ctx.space
    r = APIRouter()

    @r.post("/object/merge")
    def post_merge(req: MergeRequest):
        if not req.confirm:
            return _error(428, "Merging needs to be confirmed.")
        try:
            result = merge_objects(
                space, req.source, req.target, req.sourceVersion, req.targetVersion, space.clock()
            )
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except TooLarge as exc:
            return JSONResponse({"detail": str(exc), "limit": exc.limit}, status_code=413)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError) as exc:
            return _error(404, f'There is no object at "{exc.args[0] if exc.args else ""}".')
        origin = req.clientId
        ctx.announce(ChangeEvent("changed", result.target, result.version, origin=origin))
        for path in result.relinked:
            owner = sidecar_owner(path)
            if owner is not None:
                ctx.announce(ChangeEvent("whiteboard", owner, None, origin=origin))
            else:
                ctx.announce(
                    ChangeEvent("changed", path, space.cached_version(path), origin=origin)
                )
        ctx.announce(ChangeEvent("deleted", space._rel(req.source), None, origin=origin))
        return result.to_api()

    return r
