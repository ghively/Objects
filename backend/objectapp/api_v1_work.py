"""The work routes for agents (M22 Task 9 fills this stub; plan
``2026-11-05-m22-work-model.md``, "Routes"), behind M17's ``v1guard.V1Guard``:

- ``GET /v1/work/items``, ``GET /v1/work/item`` (read scope)
- ``POST /v1/work/step``, ``/v1/work/steps``, ``/v1/work/fields``, ``/v1/work/note``,
  ``/v1/work/activity``, ``/v1/work/floor`` (read-write scope)

Every write goes through the one `WorkService` with the actor ``Actor("agent", <token name>)``.
No v1 close: Gene closes items.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter

from .apictx import ApiContext

if TYPE_CHECKING:
    from .workservice import WorkService

__all__ = ["router"]


def router(ctx: ApiContext, service: WorkService) -> APIRouter:
    """The agents' work routes (none yet: T1's stub)."""
    return APIRouter()
