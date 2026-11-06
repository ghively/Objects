"""The agent route behind `file_capture` (M24): `POST /api/v1/agent/work/file-capture`.

Only a ``work-file`` run may file brain dumps (its token's purpose); the write is the work agent's, as
``Actor("agent", <token name>)``, announced ``api:<token name>`` and logged in the activity log.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import captures
from .apictx import ApiContext
from .propvalues import InvalidValue
from .space import Conflict, ReadOnly
from .tokens import TokenStore
from .typemodel import RevisionConflict, TypeReadOnly
from .v1guard import WRITE_GUARDS, Denied, V1Guard, agent_auth, agent_tool_allowed, error, guarded
from .workseams import SeamRefused

if TYPE_CHECKING:
    from .workloop import WorkLoop
    from .workservice import WorkService

__all__ = ["NOT_A_FILING_RUN", "router"]

TOOL = "file_capture"
PURPOSE = "work-file"
NOT_A_FILING_RUN = "This run can't file brain dumps."  # our string


class FileCaptureRequest(BaseModel):
    capture: str
    outcome: Literal["workNote", "step", "task", "fact", "needsYou"]
    item: str | None = None
    text: str | None = None
    stepKind: str | None = None
    stepText: str | None = None
    taskTitle: str | None = None
    page: str | None = None
    section: str | None = None
    question: str | None = None


def router(ctx: ApiContext, loop: WorkLoop, service: WorkService) -> APIRouter:
    from .agents import AgentRegistry
    from .workservice import Actor

    space = ctx.space
    guard = V1Guard(ctx, TokenStore(space.root))
    api = APIRouter()

    def safe(value: Any) -> Any:
        from .server import _display_safe  # lazy: server.py imports this module

        return _display_safe(value)

    @api.post("/v1/agent/work/file-capture")
    @guarded
    def file_capture(req: FileCaptureRequest, request: Request):
        token, _agent = agent_auth(guard, AgentRegistry(), request)
        agent_tool_allowed(token, TOOL)
        if token.purpose != PURPOSE:
            raise Denied(403, NOT_A_FILING_RUN)
        if token.scope != "read-write":
            raise Denied(403, "This token can only read.")
        for check in list(WRITE_GUARDS):
            message = check(token, request)
            if message:
                raise Denied(403, message)
        try:
            done = captures.apply_outcome(
                space, service, req.capture, req.outcome, Actor("agent", token.name),
                item=req.item, text=req.text, step_kind=req.stepKind, step_text=req.stepText,
                task_title=req.taskTitle, page=req.page, section=req.section, question=req.question,
            )
        except SeamRefused as exc:
            return error(exc.status, exc.detail)
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version,
                                 "detail": "This changed. Look again."}, status_code=409)
        except RevisionConflict:
            return error(409, "This changed. Look again.")
        except (ReadOnly, TypeReadOnly) as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return error(422, str(exc))
        except (KeyError, FileNotFoundError):
            return error(404, "No such brain dump, item or page.")
        except ValueError as exc:
            return error(400, str(exc))
        except Exception as exc:  # noqa: BLE001 - the work service's own errors keep their meaning
            from .workrules import IllegalMove
            from .workservice import FloorItemChanged, StepChanged
            from .workread import NotWorkItem

            if isinstance(exc, (IllegalMove, NotWorkItem)):
                return error(422, str(exc))
            if isinstance(exc, (StepChanged, FloorItemChanged)):
                return error(409, str(exc))
            raise
        for path, version in done["written"]:
            guard.announce("created" if req.outcome == "task" else "changed", path, version, token)
        cap = done["capture"]
        guard.announce("changed", cap["path"], cap["version"], token)
        guard.log(token, "file-capture", cap["path"])
        return safe({"capture": cap, "filedTo": done["filedTo"]})

    return api
