"""Brain-dump routes beside M23's ``/work/captures`` (M24): ``POST /work/captures/reply`` and
``/work/captures/mark-filed``. T1 mounts an empty router; T3 fills it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter

from .apictx import ApiContext

if TYPE_CHECKING:
    from .workloop import WorkLoop
    from .workservice import WorkService

__all__ = ["router"]


def router(ctx: ApiContext, loop: WorkLoop, service: WorkService) -> APIRouter:
    return APIRouter()
