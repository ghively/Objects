"""Brain-dump routes beside M23's ``/work/captures`` (M24): ``POST /work/captures/reply`` and
``/work/captures/mark-filed``.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import captures
from .apictx import ApiContext
from .propvalues import InvalidValue
from .space import Conflict, ReadOnly
from .watcher import ChangeEvent
from .workseams import SeamRefused

if TYPE_CHECKING:
    from .workloop import WorkLoop
    from .workservice import WorkService

__all__ = ["NOT_WAITING", "router"]

log = logging.getLogger(__name__)

NOT_WAITING = "This brain dump isn't waiting on you."  # our string


class ReplyRequest(BaseModel):
    path: str
    version: str
    text: str
    clientId: str | None = None


class MarkFiledRequest(BaseModel):
    path: str
    version: str
    clientId: str | None = None


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def router(ctx: ApiContext, loop: WorkLoop, service: WorkService) -> APIRouter:
    api = APIRouter()
    space = ctx.space

    def safe(value: Any) -> Any:
        from .server import _display_safe  # lazy: server.py imports this module

        return _display_safe(value)

    def run(req: ReplyRequest | MarkFiledRequest, call):
        try:
            item = captures.capture(space, req.path)
            if item["version"] != req.version:
                raise Conflict(item["version"])
            return call(item)
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version,
                                 "detail": "This brain dump changed. Look again."}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except SeamRefused as exc:
            return _error(exc.status, exc.detail)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except (KeyError, FileNotFoundError, ValueError):
            return _error(404, f'There is no brain dump at "{req.path}".')

    @api.post("/work/captures/reply")
    def reply(req: ReplyRequest):
        def call(item: dict):
            if item["status"] != "needsYou":
                return _error(422, NOT_WAITING)
            if not req.text.strip():
                return _error(422, "A reply needs text.")
            done = captures.set_status(space, req.path, "new", base_version=req.version, reply=req.text)
            ctx.announce(ChangeEvent("changed", done["path"], done["version"], origin=req.clientId))
            linked = None
            if done["linkedPath"]:
                linked = next((i for i in service.items("all") if i["path"] == done["linkedPath"]), None)
            try:
                loop.enqueue_capture(done, captures.parse_prefix(done["text"]), linked)
            except Exception:  # noqa: BLE001 - the reply stands; the unqueued scan picks it up
                log.exception("Queueing the reply to %s failed", done["path"])
            return {"capture": safe(done)}

        return run(req, call)

    @api.post("/work/captures/mark-filed")
    def mark_filed(req: MarkFiledRequest):
        def call(_item: dict):
            done = captures.set_status(space, req.path, "filed", base_version=req.version)
            ctx.announce(ChangeEvent("changed", done["path"], done["version"], origin=req.clientId))
            return {"capture": safe(done)}

        return run(req, call)

    return api
