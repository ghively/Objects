"""The Work section's routes (M23), mounted on ``/api`` right after M22's work routers.

T1 stub: the Contract's `router` signature with no routes. Plan Task 6 fills it (board, focus,
today, wins, alerts, the general floor list, the M24 seams and the keep-on-top window).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter

if TYPE_CHECKING:
    from .alertwatch import AlertWatch
    from .apictx import ApiContext
    from .workseams import WorkSeams
    from .workservice import WorkService

__all__ = ["router"]


def router(ctx: ApiContext, service: WorkService, seams: WorkSeams, watch: AlertWatch) -> APIRouter:
    """The Work section's routes (T1 stub: none yet)."""
    return APIRouter()
