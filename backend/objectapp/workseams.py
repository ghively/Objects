"""The Work section's seams: the work agent and the brain-dump capture sink (M23 Contract).

The routes (`api_work_section`) talk to an `AgentProvider` and a `CaptureSink`; `build_seams`
gives the app's own, M24's agent loop (`workloop.AgentSeam`) and capture sink
(`captures.CaptureSeam`). A seam refuses a request with `SeamRefused` (409 or 422) and one that
can't serve it raises `SeamUnavailable` (501).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from .space import Space
    from .workservice import WorkService
    from .worksection_model import CaptureRequestModel

__all__ = [
    "AgentProvider",
    "CaptureSink",
    "SeamRefused",
    "SeamUnavailable",
    "WorkSeams",
    "build_seams",
]


class SeamUnavailable(Exception):
    """A seam that can't serve the request; the routes answer 501 ``{"detail": detail}``."""

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


def build_seams(space: Space, service: WorkService) -> WorkSeams:
    """The app's seams: M24's agent loop and capture sink."""
    from .captures import CaptureSeam
    from .workloop import AgentSeam

    return WorkSeams(AgentSeam(), CaptureSeam(service))
