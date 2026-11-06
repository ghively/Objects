"""M24's shapes, constants and strings (plan ``2026-11-05-m24-brain-dump-and-agent-loop.md``,
Contract): the queue entry, the work agent settings, a capture as the API shows it, Desk sync's
status and M23's `AgentQueueRow` as `AgentSeam` builds it. The TypeScript mirrors are in
``frontend/src/api/types.ts``. Every string here is "our string" unless the plan quotes the spec.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from .workseams import SeamRefused

__all__ = [
    "ALREADY_FILED",
    "CRASHED",
    "EMPTY_CAPTURE",
    "ENTRY_KINDS",
    "ENTRY_STATES",
    "GONE",
    "KEEP_AUTO_RUNS",
    "KEEP_FINISHED",
    "NOT_FILED",
    "NOT_MARKED",
    "NOT_RETRYABLE",
    "NOT_SET",
    "READ_TOOLS_MAX",
    "REMOTE_REFUSED",
    "STOPPED",
    "TIMED_OUT",
    "WITHDRAWN_CHANGED",
    "WITHDRAWN_REDECIDED",
    "WORK_ENTRY_LABELS",
    "AgentQueueRow",
    "CaptureItem",
    "DeskSyncStatus",
    "EntryKind",
    "QueueRefused",
    "ReadToolRow",
    "ReadToolServer",
    "WorkAgentSettings",
    "WorkEntryState",
    "WorkQueueEntry",
]

EntryKind = Literal[
    "approve", "run", "answer", "done", "decline", "note", "request", "capture", "breakDown", "question"
]
WorkEntryState = Literal["pending", "running", "done", "failed", "withdrawn"]
ENTRY_KINDS: tuple[str, ...] = EntryKind.__args__  # type: ignore[attr-defined]
ENTRY_STATES: tuple[str, ...] = WorkEntryState.__args__  # type: ignore[attr-defined]

KEEP_FINISHED = 500
"""`done` and `withdrawn` entries kept in the queue file (our cap)."""
KEEP_AUTO_RUNS = 2000
READ_TOOLS_MAX = 500

WORK_ENTRY_LABELS = {
    "approve": "Approved step", "run": "Agent step", "answer": "Answer", "done": "Done",
    "decline": "Declined", "note": "Note", "request": "Request", "capture": "Brain dump",
    "breakDown": "Break down", "question": "Question",
}

NOT_SET = "Create the Work agent first."
REMOTE_REFUSED = "The work agent must be one of Object's own agents."
TIMED_OUT = "The run didn't finish within 30 minutes."
CRASHED = "Object closed during this run."
STOPPED = "Stopped because the space was closed."  # = M21's schedulerun.STOPPED
NOT_MARKED = "The agent finished without marking the step done."
NOT_FILED = "The agent didn't file this brain dump."
WITHDRAWN_REDECIDED = "Withdrawn: the step was decided again."
WITHDRAWN_CHANGED = "Withdrawn: the step changed before the run started."
GONE = "Withdrawn: the item is gone or isn't a work item any more."
ALREADY_FILED = "This brain dump is already filed."
NOT_RETRYABLE = "Only a failed entry can be retried."
EMPTY_CAPTURE = "A brain dump needs text."


class QueueRefused(SeamRefused):
    """A refused retry (409 / 422); M23's routes answer ``status`` ``{detail}``."""


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WorkQueueEntry(_Model):
    id: str
    kind: EntryKind
    state: WorkEntryState
    path: str | None = None
    objectId: str | None = None
    title: str | None = None
    stepId: str | None = None
    stepN: int | None = None
    stepKind: str | None = None
    stepText: str | None = None
    text: str | None = None
    capturePath: str | None = None
    notBefore: str | None = None
    auto: bool = False
    by: str = "Gene"
    createdAt: str
    claimedAt: str | None = None
    finishedAt: str | None = None
    result: str | None = None
    reason: str | None = None
    chatId: str | None = None
    agentId: str | None = None
    purpose: str | None = None
    runner: str | None = None
    attempt: int = 1
    retryOf: str | None = None


class AgentQueueRow(_Model):
    """M23's `AgentQueueRow` (``reason`` is what queued it)."""

    id: str
    path: str | None
    title: str | None
    stepId: str | None
    n: int | None
    stepText: str | None
    reason: str
    state: WorkEntryState
    notBefore: str | None
    createdAt: str
    claimedAt: str | None
    finishedAt: str | None
    result: str | None
    error: str | None


class WorkAgentSettings(_Model):
    agentId: str | None
    agent: dict[str, Any] | None
    problem: str | None
    acts: bool
    autoRun: bool
    readTools: list[str]
    settingsRevision: str


class CaptureItem(_Model):
    path: str
    text: str
    status: Literal["new", "filed", "needsYou"]
    question: str | None
    capturedAt: str
    linkedPath: str | None
    objectId: str | None
    version: str
    title: str
    fromView: str | None
    linkedTitle: str | None
    filedTo: dict[str, str] | None
    route: Literal["file", "breakDown", "question"]


class ReadToolRow(_Model):
    id: str
    name: str
    description: str
    marked: bool
    serverSaysReadOnly: bool


class ReadToolServer(_Model):
    name: str
    source: Literal["gateway", "folder"]
    listed: bool
    tools: list[ReadToolRow]


class DeskSyncStatus(_Model):
    ruleId: str | None
    enabled: bool
    repeat: str | None
    time: str | None
    lastRun: dict[str, Any] | None
    markedReadTools: int
