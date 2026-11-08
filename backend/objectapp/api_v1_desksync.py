"""The agent route behind `sync_ticket_fields` (M24): `POST /api/v1/agent/work/ticket-fields`.

Only a ``work-sync`` run (Desk sync) may use it; it sets ticket fields only, through the work service,
as ``Actor("agent", <token name>)``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import desksync
from .apictx import ApiContext
from .propvalues import InvalidValue
from .space import Conflict, ReadOnly
from .tokens import TokenStore
from .typemodel import RevisionConflict, TypeReadOnly
from .v1guard import WRITE_GUARDS, Denied, V1Guard, agent_auth, agent_tool_allowed, error, guarded
from .workmodel import ITEM_CHANGED
from .workread import NotWorkItem
from .workrules import IllegalMove

if TYPE_CHECKING:
    from .workloop import WorkLoop
    from .workservice import WorkService

__all__ = ["NOT_DESK_SYNC", "router"]

TOOL = "sync_ticket_fields"
PURPOSE = "work-sync"
NOT_DESK_SYNC = "Only Desk sync updates ticket fields this way."  # our string


class TicketFieldsRequest(BaseModel):
    path: str
    version: str
    values: dict[str, Any]


def router(ctx: ApiContext, loop: WorkLoop, service: WorkService) -> APIRouter:
    from .agents import AgentRegistry
    from .workservice import Actor

    space = ctx.space
    guard = V1Guard(ctx, TokenStore(space.root))
    api = APIRouter()

    def safe(value: Any) -> Any:
        from .server import _display_safe  # lazy: server.py imports this module

        return _display_safe(value)

    @api.post("/v1/agent/work/ticket-fields")
    @guarded
    def ticket_fields(req: TicketFieldsRequest, request: Request):
        token, _agent = agent_auth(guard, AgentRegistry(), request)
        agent_tool_allowed(token, TOOL)
        if token.purpose != PURPOSE:
            raise Denied(403, NOT_DESK_SYNC)
        if token.scope != "read-write":
            raise Denied(403, "This token can only read.")
        for check in list(WRITE_GUARDS):
            message = check(token, request)
            if message:
                raise Denied(403, message)
        try:
            rel = guard.visible_rel(req.path)
            result = desksync.apply_ticket_fields(service, rel, req.version, req.values,
                                                  Actor("agent", token.name))
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version, "detail": ITEM_CHANGED},
                                status_code=409)
        except RevisionConflict:
            return error(409, ITEM_CHANGED)
        except (ReadOnly, TypeReadOnly) as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except (NotWorkItem, IllegalMove, InvalidValue) as exc:
            return error(422, str(exc))
        except (KeyError, FileNotFoundError):
            return error(404, f'There is no object at "{req.path}".')
        except ValueError as exc:
            return error(400, str(exc))
        done = result["item"]["path"]
        guard.announce("changed", done, result["version"], token)
        guard.log(token, "work-ticket-fields", done)
        return safe(result)

    return api
