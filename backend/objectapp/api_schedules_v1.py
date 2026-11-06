"""The ``/api/v1/agent/schedules`` routes behind the ``schedule_manage`` agent tool (M21, spec
section 9), through `v1guard.agent_auth` (plan `docs/superpowers/plans/2026-11-05-m21-schedules.md`,
"Agent-facing shape and routes").

- ``GET    /v1/agent/schedules`` -> ``{schedules: ScheduleV1[]}`` (this agent's).
- ``POST   /v1/agent/schedules`` ``ScheduleCreateV1`` -> 201 ``ScheduleV1``.
- ``PUT    /v1/agent/schedules/{id}`` ``ScheduleUpdateV1`` -> ``ScheduleV1``.
- ``DELETE /v1/agent/schedules/{id}`` -> ``{trashId}``.

Each route acts only for the token's agent in the token's space, and writes go through the
`AutomationEngine` passed to `router`. T1 (the contract) mounts the router with no routes; T4
fills it. Imports no network client.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter

from .apictx import ApiContext

if TYPE_CHECKING:
    from .automations import AutomationEngine

__all__ = ["router"]


def router(ctx: ApiContext, engine: AutomationEngine) -> APIRouter:
    """The agent schedule v1 routes, mounted on the app's ``/api`` router (so no prefix here)."""
    r = APIRouter()
    return r
