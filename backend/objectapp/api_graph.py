"""The graph routes (stub; M5 replaces this module)."""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The graph routes, mounted on the app's `/api` router (so no prefix here)."""
    return APIRouter()
