"""M23's request bodies for the Work section's routes (``api_work_section.py``).

Plan ``2026-11-05-m23-work-section.md``, "Contract (T1)". The TS mirrors are in
``frontend/src/api/types.ts``. No file I/O.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

__all__ = [
    "AgentActsRequest",
    "AgentRetryRequest",
    "CaptureRequestModel",
    "ClientOnly",
    "FocusRequest",
    "GeneralFloorRequest",
]


class FocusRequest(BaseModel):
    """``PUT /api/work/focus``: the day's focus lines, against the note's version."""

    day: str
    lines: list[str]
    baseVersion: str | None = None
    clientId: str | None = None


class GeneralFloorRequest(BaseModel):
    """``POST /api/work/floor/general``: one op on the general floor list (M22's floor rules)."""

    op: Literal["add", "edit", "collect", "uncollect", "remove"]
    itemId: str | None = None
    itemRev: str | None = None
    place: str | None = None
    what: str | None = None
    found: str | None = None
    clientId: str | None = None


class CaptureRequestModel(BaseModel):
    """``POST /api/work/captures``: a brain dump (saved by M24's `CaptureSink`)."""

    text: str
    fromView: str
    linkedPath: str | None = None
    clientId: str | None = None


class AgentActsRequest(BaseModel):
    """``PUT /api/work/agent/acts``: the "Agent acts on my approvals" switch."""

    on: bool
    clientId: str | None = None


class AgentRetryRequest(BaseModel):
    """``POST /api/work/agent/retry``: retry one agent queue entry."""

    id: str
    clientId: str | None = None


class ClientOnly(BaseModel):
    """A body that only names the client (for the event's origin)."""

    clientId: str | None = None
