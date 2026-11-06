"""The seams M24 fills: the work agent and the brain-dump capture sink (M23 Contract).

M23 ships the routes and the front end in their final form; until M24 replaces the body of
`build_seams`, the agent is `NoAgent` (``available: False``, the items whose turn is the
agent's counted as ``carrying``) and the capture sink is `NoCaptures` (every save answers
501 with `CAPTURE_LATER`). M24 changes nothing else in this file.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from .space import Space
    from .workservice import WorkService
    from .worksection_model import CaptureRequestModel

__all__ = [
    "AGENT_LATER",
    "CAPTURE_LATER",
    "AgentProvider",
    "CaptureSink",
    "NoAgent",
    "NoCaptures",
    "SeamRefused",
    "SeamUnavailable",
    "WorkSeams",
    "build_seams",
]

AGENT_LATER = "The agent loop comes with M24."
CAPTURE_LATER = "Saving a brain dump comes with M24."


class SeamUnavailable(Exception):
    """A seam that isn't filled yet; the routes answer 501 ``{"detail": detail}``."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class SeamRefused(Exception):
    """A filled seam refusing a request (409 or 422); the routes answer ``status`` ``{detail}``.

    M24 raises subclasses.
    """

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


class AgentProvider(Protocol):
    def status(self, space: Space, board: list[dict]) -> dict:
        """AgentStatus."""
        ...

    def set_acts(self, space: Space, on: bool) -> dict:
        """AgentStatus; `SeamRefused` -> its status."""
        ...

    def retry(self, space: Space, entry_id: str) -> dict:
        """AgentStatus; KeyError -> 404; `SeamRefused` -> its status."""
        ...


class CaptureSink(Protocol):
    def save(self, space: Space, req: CaptureRequestModel, now: datetime) -> dict:
        """CaptureSummary; InvalidValue -> 422; `SeamRefused` -> its status."""
        ...

    def list(self, space: Space, status: str | None) -> list[dict]:
        """CaptureSummary[], newest first."""
        ...


@dataclass(frozen=True)
class WorkSeams:
    agent: AgentProvider
    captures: CaptureSink


class NoAgent:
    """No agent loop yet: the board's agent-turn items are what the agent is carrying."""

    def status(self, space: Space, board: list[dict]) -> dict:
        return {
            "available": False,
            "agentName": None,
            "actsOnApprovals": False,
            "carrying": sum(1 for item in board if item.get("turn") == "agent"),
            "rows": [],
            "note": AGENT_LATER,
        }

    def set_acts(self, space: Space, on: bool) -> dict:
        raise SeamUnavailable(AGENT_LATER)

    def retry(self, space: Space, entry_id: str) -> dict:
        raise SeamUnavailable(AGENT_LATER)


class NoCaptures:
    """No capture sink yet: a save answers 501, the list is empty."""

    def save(self, space: Space, req: CaptureRequestModel, now: datetime) -> dict:
        raise SeamUnavailable(CAPTURE_LATER)

    def list(self, space: Space, status: str | None) -> list[dict[str, Any]]:
        return []


def build_seams(space: Space, service: WorkService) -> WorkSeams:
    """The app's seams. M23: no agent, no capture sink; M24 replaces this body only."""
    return WorkSeams(NoAgent(), NoCaptures())
