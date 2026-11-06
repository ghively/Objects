"""The work routes for the app (M22 Task 8 fills this stub; plan
``2026-11-05-m22-work-model.md``, "Routes"), mounted on ``/api``:

- ``GET /work/items``, ``GET /work/item``
- ``POST /work/step``, ``/work/steps``, ``/work/fields``, ``/work/note``, ``/work/close``,
  ``/work/floor``
- ``POST /types/{typeId}/work-fields``

Every write goes through the one `WorkService` with the actor ``Actor("user", <activityName>)``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter

from .apictx import ApiContext

if TYPE_CHECKING:
    from .workservice import WorkService

__all__ = ["router"]


def router(ctx: ApiContext, service: WorkService) -> APIRouter:
    """The app's work routes (none yet: T1's stub)."""
    return APIRouter()
