"""The space-folder deletion route (M8 Task 8).

- ``POST /api/spaces/delete`` ``{path, permanent?}`` -> ``{trashed}``: the folder goes to the
  OS trash (``trashed: true``) or, with ``permanent``, is removed for good after re-checking it
  is the same folder (``trashed: false``); either way it leaves the registry. ``404`` not a
  registered space folder (or the folder changed before a permanent delete), ``409`` the
  current space (or a folder holding it / inside it), ``428`` the trash is unavailable and
  ``permanent`` was not set (nothing changed). Writes nothing inside any open space.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .spaces import SpaceIsCurrent, SpaceNotFound, TrashUnavailable, delete_space

__all__ = ["router"]


class DeleteSpaceRequest(BaseModel):
    path: str
    permanent: bool = False


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def router(ctx: ApiContext) -> APIRouter:
    """The space-folder deletion route, mounted on the app's `/api` router (so no prefix here)."""
    r = APIRouter()

    @r.post("/spaces/delete")
    def post_delete_space(req: DeleteSpaceRequest):
        try:
            trashed = delete_space(req.path, req.permanent, current=ctx.space.root)
        except SpaceIsCurrent as exc:
            return _error(409, str(exc))
        except SpaceNotFound as exc:
            return _error(404, str(exc))
        except TrashUnavailable as exc:
            return JSONResponse(
                {"detail": f"The trash is not available: {exc}", "affected": 0}, status_code=428
            )
        except FileNotFoundError:
            return _error(404, f"Not a space folder: {req.path}")
        except OSError as exc:
            return _error(500, f"The folder could not be deleted: {exc.strerror or exc}")
        return {"trashed": trashed}

    return r
