"""The graph route (M5): ``GET /api/graph`` -> ``GraphData``. Reads only.

Every 200 carries an ``ETag`` (a digest of the answer's bytes) and
``Cache-Control: no-cache``; a request whose ``If-None-Match`` names the current
one answers ``304 Not Modified`` with no body, so a client refetching after
every save gets the graph again only when it changed (audit 2026-11-01 F7).
The graph is rebuilt only when what it is built from changed: the link index's
``revision``, the type definitions, or an object's scan (each compared by
identity: a write replaces them, never changes them).
"""

from __future__ import annotations

import hashlib
import threading
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from .apictx import ApiContext
from .graphdata import graph_data

__all__ = ["router"]


def _safe_json(value: Any) -> JSONResponse:
    # Imported lazily: server.py imports this module.
    from .server import SafeJSONResponse

    return SafeJSONResponse(value)


def _matches(if_none_match: str | None, etag: str) -> bool:
    """Whether an ``If-None-Match`` header names `etag` (weak or strong) or is ``*``."""
    if not if_none_match:
        return False
    for tag in if_none_match.split(","):
        tag = tag.strip()
        if tag == "*" or tag.removeprefix("W/") == etag:
            return True
    return False


class _GraphCache:
    """The last answer, its ETag and the inputs it was built from."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.inputs: tuple[int, list, list] | None = None
        self.etag = ""
        self.body = b""

    @staticmethod
    def inputs_of(space: Any) -> tuple[int, list, list]:
        space.links._ensure()  # apply pending changes, so ``revision`` is current
        with space._lock:
            objects = [(p, s, space._raw.get(p)) for p, s in space._summaries.items()]
            types = list(space.types)
        return space.links.revision, types, objects

    def unchanged(self, inputs: tuple[int, list, list]) -> bool:
        if self.inputs is None:
            return False
        rev, types, objects = inputs
        old_rev, old_types, old_objects = self.inputs
        return (
            rev == old_rev
            and len(types) == len(old_types)
            and all(a is b for a, b in zip(types, old_types, strict=True))
            and len(objects) == len(old_objects)
            and all(
                a[0] == b[0] and a[1] is b[1] and a[2] is b[2]
                for a, b in zip(objects, old_objects, strict=True)
            )
        )

    def answer(self, space: Any) -> tuple[str, bytes]:
        with self.lock:
            inputs = self.inputs_of(space)
            if not self.unchanged(inputs):
                body = _safe_json(graph_data(space)).body
                if body != self.body:
                    self.body = body
                    self.etag = '"' + hashlib.sha256(body).hexdigest()[:20] + '"'
                # What was read before the build: a change during it rebuilds next time.
                self.inputs = inputs
            return self.etag, self.body


def router(ctx: ApiContext) -> APIRouter:
    """The graph routes, mounted on the app's `/api` router (so no prefix here)."""
    r = APIRouter()
    cache = _GraphCache()

    @r.get("/graph")
    def get_graph(request: Request) -> Response:
        # A built body skips FastAPI's per-value encoder (100,000 link ints at 5,000 objects).
        etag, body = cache.answer(ctx.space)
        headers = {"ETag": etag, "Cache-Control": "no-cache"}
        if _matches(request.headers.get("if-none-match"), etag):
            return Response(status_code=304, headers=headers)
        return Response(body, media_type="application/json", headers=headers)

    return r
