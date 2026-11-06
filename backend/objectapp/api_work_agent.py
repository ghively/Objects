"""The work agent's app routes (M24): ``/api/work/agent-settings``, ``agent/create-info``,
``agent/create``, ``read-tools`` and the idle test hook. T1 mounts the reads; T7 fills the writes.
Reads write nothing.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from fastapi import APIRouter

from .apictx import ApiContext
from .workagent import WORK_AGENT_NAME

if TYPE_CHECKING:
    from .workloop import WorkLoop
    from .workservice import WorkService

__all__ = ["router"]


def router(ctx: ApiContext, loop: WorkLoop, service: WorkService) -> APIRouter:
    api = APIRouter()

    @api.get("/work/agent-settings")
    def agent_settings() -> dict:
        return loop.settings_status()

    @api.get("/work/agent/create-info")
    def create_info() -> dict:
        return {"name": WORK_AGENT_NAME, "changeReviewer": None}

    @api.get("/work/read-tools")
    def read_tools() -> dict:
        return {"servers": []}

    if os.environ.get("OBJECT_FAKE_NOTIFY_FILE"):

        @api.post("/_test/work/idle")
        def test_idle() -> dict:
            return {"idle": loop.wait_idle(30.0)}

    return api
