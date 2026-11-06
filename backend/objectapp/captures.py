"""Brain dumps: the Capture type, the save and the filing outcomes (M24 T3).

T1 ships the signatures, the prefix patterns and `CaptureSeam`; T3 fills them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from .space import Space
    from .typemodel import TypeDefinition
    from .worksection_model import CaptureRequestModel
    from .workservice import Actor, WorkService

__all__ = [
    "BREAK_DOWN",
    "CAPTURE_TEXT_MAX",
    "CAPTURE_TYPE_NAME",
    "CAPTURE_TYPE_PLURAL",
    "QUESTION",
    "CaptureSeam",
    "CaptureStatus",
    "Outcome",
    "Parsed",
    "Route",
    "apply_outcome",
    "capture",
    "ensure_capture_type",
    "list_captures",
    "parse_prefix",
    "resolve_item",
    "save",
    "set_status",
]

CAPTURE_TYPE_NAME = "Capture"
CAPTURE_TYPE_PLURAL = "Captures"
CAPTURE_TEXT_MAX = 8000  # M22's note cap
CaptureStatus = Literal["new", "filed", "needsYou"]
Route = Literal["file", "breakDown", "question"]
Outcome = Literal["workNote", "step", "task", "fact", "needsYou"]
BREAK_DOWN = re.compile(r"(?is)^\s*break\s*down\s+(?P<item>.+?)\s+step\s+(?P<n>\d{1,2})\s*:\s*(?P<rest>.*)$")
QUESTION = re.compile(r"(?is)^\s*question\s+about\s+(?P<item>.+?)\s*:\s*(?P<rest>.+)$")


@dataclass(frozen=True)
class Parsed:
    route: Route
    item_ref: str | None
    step_n: int | None
    rest: str


def parse_prefix(text: str) -> Parsed:
    """``Break down <item> step n: ...`` and ``Question about <item>: ...`` route a capture to that item
    ("BREAKDOWN ..." matches too); anything else is filed as typed."""
    m = BREAK_DOWN.match(text)
    if m:
        return Parsed("breakDown", m.group("item").strip(), int(m.group("n")), m.group("rest").strip())
    m = QUESTION.match(text)
    if m:
        return Parsed("question", m.group("item").strip(), None, m.group("rest").strip())
    return Parsed("file", None, None, text)


def resolve_item(service: WorkService, ref: str) -> dict | None:
    raise NotImplementedError("M24 T3")


def ensure_capture_type(space: Space) -> tuple[TypeDefinition, bool]:
    raise NotImplementedError("M24 T3")


def save(space: Space, service: WorkService, *, text: str, from_view: str | None, linked_path: str | None,
         now: datetime) -> tuple[dict, Parsed, dict | None]:
    raise NotImplementedError("M24 T3")


def capture(space: Space, path: str) -> dict:
    raise KeyError(path)


def list_captures(space: Space, status: CaptureStatus | None = None) -> list[dict]:
    """CaptureItem[], newest first; never writes. (T3 fills it; until then no Capture type, no captures.)"""
    return []


def apply_outcome(space: Space, service: WorkService, capture_path: str, outcome: Outcome, actor: Actor, *,
                  item: str | None = None, text: str | None = None, step_kind: str | None = None,
                  step_text: str | None = None, task_title: str | None = None, page: str | None = None,
                  section: str | None = None, question: str | None = None) -> dict:
    raise NotImplementedError("M24 T3")


def set_status(space: Space, capture_path: str, status: CaptureStatus, *, base_version: str | None,
               filed_to: str | None = None, question: str | None = None, reply: str | None = None) -> dict:
    raise NotImplementedError("M24 T3")


class CaptureSeam:
    """M23's `CaptureSink`: the save, then the queue entry (T3 fills `save`)."""

    def __init__(self, service: WorkService) -> None:
        self.service = service

    def save(self, space: Space, req: CaptureRequestModel, now: datetime) -> dict:
        raise NotImplementedError("M24 T3")

    def list(self, space: Space, status: str | None) -> list[dict[str, Any]]:
        return list_captures(space, status)  # type: ignore[arg-type]
