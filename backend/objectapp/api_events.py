"""The Server-Sent Events route, mounted on ``/api`` (once inline in `server.py`):

- ``GET /api/events`` -> Server-Sent Events; event ``change`` with a `ChangeEvent` as
  JSON data (``{kind, path, version, origin}``), from the app's `EventHub`."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from fastapi import APIRouter
from sse_starlette import EventSourceResponse, ServerSentEvent

if TYPE_CHECKING:
    from .server import EventHub

__all__ = ["router"]


def router(hub: EventHub) -> APIRouter:
    """The SSE route over the app's ``hub``."""
    from .server import event_payload  # lazy: server.py imports this module

    r = APIRouter()

    @r.get("/events")
    async def events():
        async def stream():
            async for event in hub.subscribe():
                yield ServerSentEvent(event="change", data=json.dumps(event_payload(event)))

        return EventSourceResponse(stream(), ping=15)


    return r
