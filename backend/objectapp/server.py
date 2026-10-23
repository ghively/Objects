"""The HTTP API over a `Space`, plus the built front end as static files.

Routes (all JSON):

- ``GET /api/space`` -> ``{name, root, types}``
- ``GET /api/objects?type=`` -> ``ObjectSummary[]``
- ``GET /api/object?path=`` -> ``{summary, frontmatter, body, version}``
- ``PUT /api/object/body`` ``{path, body, baseVersion}`` -> ``200 {version}``,
  ``409 {currentVersion}`` or ``423 {reason}``
- ``GET /api/resolve?link=&from=`` -> ``{path}`` or ``404``

Errors: a path outside the space or not an object is ``400``; a missing object is ``404``.
"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .space import Conflict, ReadOnly, Space

__all__ = ["create_app"]


class SaveBodyRequest(BaseModel):
    path: str
    body: str
    baseVersion: str


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def create_app(space: Space, static_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="Object", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.space = space
    api = APIRouter(prefix="/api")

    @api.get("/space")
    def get_space():
        return {
            "name": space.name,
            "root": str(space.root),
            "types": [asdict(t) for t in space.types],
        }

    @api.get("/objects")
    def list_objects(type: str | None = Query(default=None)):
        return [asdict(s) for s in space.list(type or None)]

    @api.get("/object")
    def get_object(path: str):
        try:
            of, fm, version = space.read(path)
            try:
                summary = space.get(path)
            except KeyError:
                space.rescan_file(path)
                summary = space.get(path)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No object at {path!r}")
        return {
            "summary": asdict(summary),
            "frontmatter": fm,
            "body": of.body,
            "version": version,
        }

    @api.put("/object/body")
    def put_body(req: SaveBodyRequest):
        try:
            version = space.save_body(req.path, req.body, req.baseVersion)
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason}, status_code=423)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No object at {req.path!r}")
        return {"version": version}

    @api.get("/resolve")
    def resolve(link: str, from_: str | None = Query(default=None, alias="from")):
        path = space.resolve(link, from_ or None)
        if path is None:
            return _error(404, f"No object matches {link!r}")
        return {"path": path}

    app.include_router(api)

    if static_dir is not None and Path(static_dir).is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app
