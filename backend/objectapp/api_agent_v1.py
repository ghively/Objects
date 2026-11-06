"""The ``/api/v1/agent/*`` routes (M17): what an agent's own token may ask about that agent.

They need a token whose ``agent`` is set (403 "This token isn't an agent's.") and act only on
that agent (`v1guard.agent_auth`). M18, M20 and M21 add their routes here.

- ``GET /v1/agent/info`` -> ``{agent: {id, name, model, folder}, space: {name}}``. Never
  writes (the default agent's folder may not exist yet; its path is still answered).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from . import settings as device_settings
from .apictx import ApiContext
from .tokens import TokenStore
from .v1guard import V1Guard, agent_auth, guarded

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The agent v1 routes, mounted on the app's ``/api`` router (so no prefix here)."""
    from .agents import AgentRegistry

    space = ctx.space
    guard = V1Guard(ctx, TokenStore(space.root))
    r = APIRouter()

    def settings_now() -> dict[str, Any]:
        from .space import ReadOnly

        try:
            merged, _revision = device_settings.read()
        except ReadOnly:  # an unreadable settings file: the defaults (aiModel None)
            return {}
        return merged

    @r.get("/v1/agent/info")
    @guarded
    def agent_info(request: Request):
        _token, agent = agent_auth(guard, AgentRegistry(), request)
        out = agent.to_api(settings_now())
        return {
            "agent": {"id": out["id"], "name": out["name"], "model": out["model"], "folder": out["folder"]},
            "space": {"name": space.name},
        }

    return r
