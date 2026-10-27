"""The whiteboard routes (M6), as an `APIRouter` that `server.py` mounts (Task 13).

- ``GET /api/whiteboard?path=`` -> ``BoardResponse`` ``{path, board, revision, readOnlyReason?}``
  (the empty board and ``revision: ''`` when the file is missing; nothing is written).
- ``PUT /api/whiteboard`` ``{path, board, baseRevision, clientId?}`` -> ``{revision}``;
  ``409 {currentRevision}``, ``422 {detail}``, ``423 {reason, detail}``, ``404``, ``400``.
- ``GET /api/whiteboard/ink?path=`` -> ``InkResponse`` ``{path, strokes, revision, readOnlyReason?}``.
- ``PUT /api/whiteboard/ink`` ``{path, strokes, baseRevision, clientId?}`` -> ``{revision}``;
  the same errors.
- ``POST /api/whiteboards`` ``{title?, clientId?}`` -> ``201 {path, version, typeIds}``;
  announces ``types`` (when the Whiteboard type's JSON was written now) and ``created``.

Board and ink saves announce ``ChangeEvent(kind='whiteboard', path=<the .md>, version=<the new
revision>, origin=clientId)``. A path outside the space or not an object path is 400, an
unknown object 404, an object of another type 422.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .propvalues import InvalidValue
from .watcher import ChangeEvent
from .whiteboardstore import (
    BoardConflict,
    BoardInvalid,
    BoardReadOnly,
    InkInvalid,
    NotAWhiteboard,
    create_whiteboard,
    read_board,
    read_ink,
    save_board,
    save_ink,
)

if TYPE_CHECKING:
    from .space import Space

__all__ = [
    "CreateWhiteboardRequest",
    "SaveBoardRequest",
    "SaveInkRequest",
    "whiteboard_router",
]


class SaveBoardRequest(BaseModel):
    path: str
    board: Any
    baseRevision: str
    clientId: str | None = None


class SaveInkRequest(BaseModel):
    path: str
    strokes: Any
    baseRevision: str
    clientId: str | None = None


class CreateWhiteboardRequest(BaseModel):
    title: str | None = None
    clientId: str | None = None


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def _failure(exc: Exception, path: str) -> JSONResponse:
    """The response for an exception a whiteboard read or save raised."""
    if isinstance(exc, BoardConflict):
        return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
    if isinstance(exc, BoardReadOnly):
        return JSONResponse(
            {"reason": exc.reason, "detail": exc.reason}, status_code=423
        )
    if isinstance(exc, (BoardInvalid, InkInvalid)):
        return _error(422, exc.detail)
    if isinstance(exc, NotAWhiteboard):
        return _error(422, str(exc))
    if isinstance(exc, KeyError):
        return _error(404, f"No object at {path!r}")
    return _error(400, str(exc))


_HANDLED = (
    BoardConflict,
    BoardReadOnly,
    BoardInvalid,
    InkInvalid,
    NotAWhiteboard,
    KeyError,
    ValueError,
)


def whiteboard_router(
    space: Space, announce: Callable[[ChangeEvent], None]
) -> APIRouter:
    """The four whiteboard routes for ``space``; ``announce`` publishes a `ChangeEvent`."""
    api = APIRouter(prefix="/api")

    def announce_saved(md_rel: str, revision: str, client_id: str | None) -> None:
        announce(ChangeEvent("whiteboard", md_rel, revision, origin=client_id))

    @api.get("/whiteboard")
    def get_board(path: str):
        try:
            return read_board(space, path)
        except _HANDLED as exc:
            return _failure(exc, path)

    @api.put("/whiteboard")
    def put_board(req: SaveBoardRequest):
        try:
            revision = save_board(space, req.path, req.board, req.baseRevision)
        except _HANDLED as exc:
            return _failure(exc, req.path)
        announce_saved(space._rel(req.path), revision, req.clientId)
        return {"revision": revision}

    @api.get("/whiteboard/ink")
    def get_ink(path: str):
        try:
            return read_ink(space, path)
        except _HANDLED as exc:
            return _failure(exc, path)

    @api.put("/whiteboard/ink")
    def put_ink(req: SaveInkRequest):
        try:
            revision = save_ink(space, req.path, req.strokes, req.baseRevision)
        except _HANDLED as exc:
            return _failure(exc, req.path)
        announce_saved(space._rel(req.path), revision, req.clientId)
        return {"revision": revision}

    @api.post("/whiteboards", status_code=201)
    def post_whiteboard(req: CreateWhiteboardRequest):
        try:
            path, version, type_ids = create_whiteboard(space, req.title or "")
        except InvalidValue as exc:
            return _error(422, str(exc))
        for type_id in type_ids:
            announce(ChangeEvent("types", type_id, None, origin=req.clientId))
        announce(ChangeEvent("created", path, version, origin=req.clientId))
        return JSONResponse(
            {"path": path, "version": version, "typeIds": type_ids}, status_code=201
        )

    return api
