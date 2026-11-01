"""The references routes (M5).

- ``GET /api/references?path=&relatedLimit=`` -> ``References`` (backlink contexts carry
  ``ancestors`` inside nested blocks, M8; ``relatedLimit``
  default 20, 1..200); 400 for a bad path, 404 when there is no object. Reads only.
- ``POST /api/references/link`` ``{path, target, start, end, text, baseVersion, clientId?}``
  -> ``{version}``: links one unlinked mention of ``target`` in ``path``'s body
  (one stamped write of ``path``) and announces ``changed`` for ``path`` with
  ``origin: clientId``. 409 ``{currentVersion}`` when stale, 422 when the text moved,
  the target is unknown or the range isn't a mention, 423 read-only, 404.
"""

from __future__ import annotations

from pathlib import PurePosixPath

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .propvalues import InvalidValue
from .references import link_mention, references
from .space import Conflict, ReadOnly
from .watcher import ChangeEvent

__all__ = ["MAX_RELATED_LIMIT", "LinkMentionRequest", "router"]

MAX_RELATED_LIMIT = 200


class LinkMentionRequest(BaseModel):
    path: str
    target: str
    start: int
    end: int
    text: str
    baseVersion: str
    clientId: str | None = None


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def _safe_json(value) -> JSONResponse:
    # Imported lazily: server.py imports this module.
    from .server import SafeJSONResponse

    return SafeJSONResponse(value)


def router(ctx: ApiContext) -> APIRouter:
    """The references routes, mounted on the app's `/api` router (so no prefix here)."""
    r = APIRouter()
    space = ctx.space

    @r.get("/references")
    def get_references(
        path: str,
        relatedLimit: int = Query(default=20, ge=1, le=MAX_RELATED_LIMIT),
    ):
        try:
            rel = space._rel(path)
        except ValueError as exc:
            return _error(400, str(exc))
        with space._lock:
            known = rel in space._summaries
        if not known and (space.root / rel).is_file():
            space.rescan_file(rel)
        try:
            data = references(space, ctx.search, rel, related_limit=relatedLimit)
        except KeyError:
            return _error(404, f"No object at {path!r}")
        return _safe_json(data)

    @r.post("/references/link")
    def post_link(req: LinkMentionRequest):
        try:
            version = link_mention(
                space,
                req.path,
                req.target,
                req.start,
                req.end,
                req.text,
                req.baseVersion,
            )
        except Conflict as exc:
            return JSONResponse(
                {"currentVersion": exc.current_version}, status_code=409
            )
        except ReadOnly as exc:
            return JSONResponse(
                {"reason": exc.reason, "detail": exc.reason}, status_code=423
            )
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No object at {req.path!r}")
        if version != req.baseVersion:
            rel = PurePosixPath(req.path.replace("\\", "/")).as_posix()
            ctx.announce(ChangeEvent("changed", rel, version, origin=req.clientId))
        return {"version": version}

    return r
