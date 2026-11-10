"""``POST /api/v1/synced/{typeId}`` (M29): a script or agent fills synced facts.

The route takes a ``read-write`` or ``sync`` token (`V1Guard.auth_sync`) and runs
`Space.sync_facts`: each item is matched to one object of the type by title, alias or a key
property, and its values are written to ``.object/synced/<typeId>.json``, never to a ``.md``
(plan ``2026-11-09-m29-synced-facts-and-type-suggestion.md``, Contract, Routes).

Task 1 gives the router with no routes; Task 6 adds the route.
"""

from __future__ import annotations

from fastapi import APIRouter

from .apictx import ApiContext

__all__ = ["router"]


def router(ctx: ApiContext) -> APIRouter:
    """The synced-facts v1 route, mounted on the app's ``/api`` router (so no prefix here)."""
    return APIRouter()
