"""The image, attachment and file routes (M2's cover-image picker, M7 attachments), mounted
on ``/api`` (once inline in `server.py`):

- ``GET /api/images`` -> ``{path}[]``; ``POST /api/images?name=`` (raw bytes) -> ``201
  {path}``; ``415`` for a name without an image extension.
- ``GET /api/attachments`` -> ``{path, kind, size}[]``; ``POST /api/attachments?name=``
  (raw bytes) -> ``201 {path, kind}``; ``413`` over 100 MiB, ``422`` an unusable name,
  ``415`` a ``.md`` name. ``POST /api/attachments/open`` ``{path}`` -> ``{ok}``.
- ``GET /api/file?path=`` -> the file's bytes with per-kind headers; ``415``/``404`` as
  above. Uploads must be ``application/octet-stream`` (see `LocalOnlyMiddleware`)."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from . import media
from .apictx import ApiContext
from .media import (
    NotAnImage,
    NotServed,
    RefusedToOpen,
    TooLarge,
    attachment_media_type,
    attachment_path,
    import_attachment,
    import_image,
    kind_of,
    list_attachments,
    list_images,
    open_with_system,
    serve_headers,
)

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def _safe(value: Any) -> Any:
    from .server import _display_safe  # lazy: server.py imports this module

    return _display_safe(value)


class OpenAttachmentRequest(BaseModel):
    path: str


def router(ctx: ApiContext) -> APIRouter:
    """The image, attachment and file routes."""
    space = ctx.space

    r = APIRouter()

    @r.get("/images")
    def get_images():
        return _safe(list_images(space.root))

    async def _upload_body(request: Request) -> bytes | None:
        """The uploaded bytes, or None once they exceed the 100 MiB limit (413)."""
        limit = media.MAX_ATTACHMENT_BYTES
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > limit:
            return None
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                return None
            chunks.append(chunk)
        return b"".join(chunks)

    @r.post("/images", status_code=201)
    async def post_image(request: Request, name: str = Query(default="")):
        too_large = _error(413, media.UPLOAD_LIMIT_DETAIL)
        data = await _upload_body(request)
        if data is None:
            return too_large
        try:
            path = await asyncio.to_thread(import_image, space.root, name, data)
        except NotAnImage:
            return _error(415, "Only png, jpg, jpeg, gif, webp and svg images can be added.")
        except media.SidecarUpload:
            return _error(415, media.SIDECAR_UPLOAD_DETAIL)
        except TooLarge:
            return too_large
        except ValueError as exc:
            return _error(422, str(exc))
        return JSONResponse({"path": path}, status_code=201)

    @r.get("/attachments")
    def get_attachments():
        return _safe(list_attachments(space.root))

    @r.post("/attachments", status_code=201)
    async def post_attachment(request: Request, name: str = Query(default="")):
        too_large = _error(413, media.UPLOAD_LIMIT_DETAIL)
        data = await _upload_body(request)
        if data is None:
            return too_large
        try:
            path, kind = await asyncio.to_thread(import_attachment, space.root, name, data)
        except TooLarge:
            return too_large
        except media.MarkdownUpload:
            return _error(415, media.MARKDOWN_UPLOAD_DETAIL)
        except media.SidecarUpload:
            return _error(415, media.SIDECAR_UPLOAD_DETAIL)
        except ValueError as exc:
            return _error(422, str(exc))
        return JSONResponse({"path": path, "kind": kind}, status_code=201)

    @r.post("/attachments/open")
    def open_attachment(req: OpenAttachmentRequest):
        try:
            full = attachment_path(space.root, req.path)
        except NotServed:
            return _error(415, "Objects are opened in Object, not with another app.")
        except (FileNotFoundError, OSError):
            return _error(404, f'There is no file at "{req.path}".')
        try:
            open_with_system(full)
        except RefusedToOpen:
            return _error(415, media.REFUSED_OPEN_DETAIL)
        return {"ok": True}

    @r.get("/file")
    def get_file(path: str):
        try:
            full = attachment_path(space.root, path)
        except NotServed:
            return _error(415, "Objects are opened, not served.")
        except (FileNotFoundError, OSError):
            return _error(404, f'There is no file at "{path}".')
        kind = kind_of(full.name)
        return FileResponse(
            full,
            media_type=attachment_media_type(full.name),
            headers=serve_headers(kind, full.name),
        )


    return r
