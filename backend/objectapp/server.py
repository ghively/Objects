"""The HTTP API over a `Space`, plus the built front end as static files.

Routes (all JSON):

- ``GET /api/space`` -> ``{name, root, types}``
- ``GET /api/objects?type=`` -> ``ObjectSummary[]``
- ``GET /api/object?path=`` -> ``{summary, frontmatter, body, version}``
- ``PUT /api/object/body`` ``{path, body, baseVersion}`` -> ``200 {version}``,
  ``409 {currentVersion}`` or ``423 {reason}``
- ``GET /api/resolve?link=&from=`` -> ``{path}`` or ``404``
- ``GET /api/events`` -> Server-Sent Events; event ``change`` with a
  `ChangeEvent` as JSON data (``{kind, path, version}``)

Errors: a path outside the space or not an object is ``400``; a missing object is ``404``.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import threading
from collections.abc import AsyncIterator
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette import EventSourceResponse, ServerSentEvent

from .space import Conflict, ReadOnly, Space
from .watcher import ChangeEvent, SpaceWatcher

__all__ = ["EventHub", "create_app"]


class EventHub:
    """Fans `ChangeEvent`s out to every connected SSE client (one queue each)."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[ChangeEvent | None]] = set()
        self._lock = threading.Lock()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.closed = False

    def publish(self, event: ChangeEvent) -> None:
        """Deliver `event` to all subscribers. Call on the hub's event loop."""
        with self._lock:
            subscribers = list(self._subscribers)
        for q in subscribers:
            q.put_nowait(event)

    def close(self) -> None:
        """End every open stream. Safe to call from any thread."""
        self.closed = True
        with self._lock:
            subscribers = list(self._subscribers)
        loop = self.loop
        for q in subscribers:
            if loop is not None and loop.is_running():
                loop.call_soon_threadsafe(q.put_nowait, None)
            else:
                q.put_nowait(None)

    async def subscribe(self) -> AsyncIterator[ChangeEvent]:
        q: asyncio.Queue[ChangeEvent | None] = asyncio.Queue()
        with self._lock:
            self._subscribers.add(q)
        try:
            while not self.closed:
                event = await q.get()
                if event is None:
                    return
                yield event
        finally:
            with self._lock:
                self._subscribers.discard(q)


class SaveBodyRequest(BaseModel):
    path: str
    body: str
    baseVersion: str


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def create_app(space: Space, static_dir: Path | None = None, watch: bool = True) -> FastAPI:
    """The app for `space`. With `watch`, a `SpaceWatcher` runs for the app's lifespan."""
    hub = EventHub()

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI):
        hub.loop = asyncio.get_running_loop()
        hub.closed = False
        if not watch:
            yield
            hub.close()
            return
        watcher = SpaceWatcher(space, hub.loop)
        watcher.start()

        async def pump() -> None:
            while True:
                hub.publish(await watcher.events.get())

        task = asyncio.create_task(pump())
        try:
            yield
        finally:
            hub.close()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            await asyncio.to_thread(watcher.stop)

    app = FastAPI(
        title="Object", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.space = space
    app.state.hub = hub
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

    @api.get("/events")
    async def events():
        async def stream():
            async for event in hub.subscribe():
                yield ServerSentEvent(event="change", data=json.dumps(asdict(event)))

        return EventSourceResponse(stream(), ping=15)

    app.include_router(api)

    if static_dir is not None and Path(static_dir).is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app
