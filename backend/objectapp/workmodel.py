"""M22's work model: the step and floor-item records, their labels, caps and messages, and the
request bodies of the work routes (plan ``2026-11-05-m22-work-model.md``, "Contract (T1)").

The TS mirrors are in ``frontend/src/api/types.ts``. The rules over these records are
``workrules.py``; their codec (front matter <-> records) is ``workvalues.py``.

No file I/O.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field

__all__ = [
    "FLOOR_CHANGED",
    "FLOOR_KEYS",
    "ITEM_CHANGED",
    "KIND_LABELS",
    "MAX_FLOOR",
    "MAX_LIST",
    "MAX_LIST_TEXT",
    "MAX_NOTE",
    "MAX_STEPS",
    "MAX_STEP_TEXT",
    "NOT_WORK_ITEM",
    "STAGE_LABELS",
    "STATE_LABELS",
    "STEP_CHANGED",
    "STEP_KEYS",
    "STEP_KINDS",
    "STEP_STATES",
    "ActivityRequest",
    "CloseRequest",
    "FieldsRequest",
    "FloorItem",
    "FloorRequest",
    "NoteRequest",
    "Stage",
    "Step",
    "StepAction",
    "StepKind",
    "StepRequest",
    "StepState",
    "StepsRequest",
    "Turn",
    "WorkFieldsTypeRequest",
    "WorkRole",
]

StepKind = Literal["question", "do", "approve", "agent"]
StepState = Literal["open", "approved", "done", "declined"]
StepAction = Literal["answer", "done", "approve", "decline", "run", "reopen", "complete", "fail"]
WorkRole = Literal["user", "agent", "app"]
Turn = Literal["you", "approve", "agent", "parked", "close", "none"]
Stage = Literal["notStarted", "ready", "doing", "parked", "done"]

STEP_KINDS: tuple[StepKind, ...] = ("question", "do", "approve", "agent")
STEP_STATES: tuple[StepState, ...] = ("open", "approved", "done", "declined")

KIND_LABELS: dict[StepKind, str] = {
    "question": "Question",
    "do": "Do",
    "approve": "Approve",
    "agent": "Agent",
}
STATE_LABELS: dict[StepState, str] = {
    "open": "Open",
    "approved": "Approved",
    "done": "Done",
    "declined": "Declined",
}
STAGE_LABELS: dict[Stage, str] = {
    "notStarted": "Not started",
    "ready": "Ready",
    "doing": "Doing",
    "parked": "Waiting / parked",
    "done": "Done",
}

STEP_KEYS = (
    "id",
    "kind",
    "state",
    "text",
    "notBefore",
    "answer",
    "result",
    "addedAt",
    "approvedAt",
    "doneAt",
    "declinedAt",
)
"""A step mapping's known keys, in the order they are written (only when set)."""
FLOOR_KEYS = ("id", "place", "what", "collected", "found")
"""A floor item mapping's known keys, in the order they are written."""

# Caps (our choice; 8000 from the old dashboard).
MAX_STEPS = MAX_FLOOR = MAX_LIST = 50
MAX_STEP_TEXT = MAX_LIST_TEXT = 500
MAX_NOTE = 8000

STEP_CHANGED = "This step changed. Look again."
ITEM_CHANGED = "This item changed. Look again."
FLOOR_CHANGED = "This floor item changed. Look again."
NOT_WORK_ITEM = "This object has no work fields."


@dataclass
class Step:
    """One entry of a ``steps`` list, as stored (``id`` None when the file gives none)."""

    id: str | None
    kind: StepKind
    state: StepState
    text: str
    notBefore: str | None = None
    answer: str | None = None
    result: str | None = None
    addedAt: str | None = None
    approvedAt: str | None = None
    doneAt: str | None = None
    declinedAt: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    """Unknown keys, kept in their order after the known ones."""


@dataclass
class FloorItem:
    """One entry of a ``floorItems`` list (``place`` or ``what`` is set)."""

    id: str | None
    place: str | None
    what: str | None
    collected: str | None = None
    found: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


# -- request bodies -------------------------------------------------------------------------------


class StepRequest(BaseModel):
    """``POST /work/step`` (and ``/v1/work/step``)."""

    path: str
    stepId: str
    stepRev: str
    action: StepAction
    text: str | None = None
    notBefore: str | None = None
    ask: str | None = None
    clientId: str | None = None


class StepsRequest(BaseModel):
    """``POST /work/steps``: every op in one write, in order."""

    path: str
    ops: list[dict[str, Any]]
    clientId: str | None = None


class FieldsRequest(BaseModel):
    """``POST /work/fields``."""

    path: str
    baseVersion: str
    set: dict[str, Any] = Field(default_factory=dict)
    remove: list[str] = Field(default_factory=list)
    clientId: str | None = None


class NoteRequest(BaseModel):
    """``POST /work/note``."""

    path: str
    kind: Literal["note", "request"] = "note"
    text: str
    clientId: str | None = None


class ActivityRequest(BaseModel):
    """``POST /v1/work/activity``."""

    path: str
    text: str


class CloseRequest(BaseModel):
    """``POST /work/close``."""

    path: str
    baseVersion: str
    clientId: str | None = None


class FloorRequest(BaseModel):
    """``POST /work/floor``."""

    path: str
    op: Literal["add", "edit", "collect", "uncollect", "remove"]
    itemId: str | None = None
    itemRev: str | None = None
    place: str | None = None
    what: str | None = None
    found: str | None = None
    clientId: str | None = None


class WorkFieldsTypeRequest(BaseModel):
    """``POST /types/{typeId}/work-fields``."""

    baseRevision: str
    clientId: str | None = None
