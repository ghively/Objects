"""The work purposes, the read-only tool lists and the two guards (M24 T4).

T1 ships the constants, the signatures and an idempotent `install` that registers the guards (and
the contributors, which do nothing yet); T4 fills them.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import TYPE_CHECKING, Any

from . import api_v1_work, v1guard
from .agentrun import RunParts, RunScope, add_contributor

if TYPE_CHECKING:
    from fastapi import Request

    from .tokens import TokenRecord
    from .workloop import WorkLoop
    from .workservice import WorkService

__all__ = [
    "EXTRA_AGENT_TOOLS",
    "READ_ONLY_PURPOSES",
    "READ_ONLY_WRITE_ROUTES",
    "STEP_WRITE_ROUTES",
    "WORK",
    "WORK_FILE",
    "WORK_PURPOSES",
    "WORK_READ",
    "WORK_SYNC",
    "install",
    "read_only_write_guard",
    "read_run_tools",
    "step_guard",
    "work_guidance_contributor",
    "work_tools_contributor",
]

WORK = "work"
WORK_READ = "work-read"
WORK_FILE = "work-file"
WORK_SYNC = "work-sync"
WORK_PURPOSES = frozenset({WORK, WORK_READ, WORK_FILE, WORK_SYNC})
READ_ONLY_PURPOSES = frozenset({WORK_READ, WORK_FILE, WORK_SYNC})
EXTRA_AGENT_TOOLS = {WORK_READ: (), WORK_FILE: ("file_capture",), WORK_SYNC: ("sync_ticket_fields",)}
STEP_WRITE_ROUTES = ("/api/v1/work/step", "/api/v1/work/steps", "/api/v1/work/activity", "/api/v1/work/note")
READ_ONLY_WRITE_ROUTES = {
    WORK_READ: STEP_WRITE_ROUTES,
    WORK_FILE: STEP_WRITE_ROUTES + ("/api/v1/agent/work/file-capture",),
    WORK_SYNC: STEP_WRITE_ROUTES + ("/api/v1/agent/work/ticket-fields",),
}

_loop: "WorkLoop | None" = None


def read_run_tools(purpose: str, tools_off: Iterable[str], marked: Iterable[str],
                   servers: Mapping[str, dict[str, Any]],
                   listed: Callable[[str], tuple[str, ...] | None]) -> tuple[list[str], list[str], list[str]]:
    raise NotImplementedError("M24 T4")


def work_guidance_contributor(scope: RunScope, parts: RunParts) -> None:
    """Order 57 ``work-guidance`` (T4)."""


def work_tools_contributor(scope: RunScope, parts: RunParts) -> None:
    """Order 66 ``work-tools`` (T4)."""


def read_only_write_guard(record: TokenRecord, request: Request) -> str | None:
    """A `v1guard.WRITE_GUARDS` entry (T4)."""
    return None


def step_guard(record: TokenRecord, path: str, step_id: str, action: str) -> str | None:
    """`api_v1_work.STEP_GUARD` (T4)."""
    return None


def install(loop: "WorkLoop", service: WorkService) -> None:
    """Both contributors and both guards; idempotent."""
    global _loop
    _loop = loop
    add_contributor("work-guidance", 57, work_guidance_contributor)
    add_contributor("work-tools", 66, work_tools_contributor)
    if read_only_write_guard not in v1guard.WRITE_GUARDS:
        v1guard.WRITE_GUARDS.append(read_only_write_guard)
    api_v1_work.STEP_GUARD = step_guard
