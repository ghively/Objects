"""The per-space work queue file and the rule that turns a work notice into queue entries (M24 T2).

T1 ships the signatures; T2 fills them.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .workservice import WorkNotice

__all__ = ["QueuePlan", "QueueStore", "auto_run_key", "plan_for_notice"]


@dataclass(frozen=True)
class QueuePlan:
    path: str
    withdraw_step: str | None
    withdraw_item: bool
    stop_running: bool
    create: dict[str, Any] | None


def plan_for_notice(notice: WorkNotice) -> QueuePlan | None:
    raise NotImplementedError("M24 T2")


def auto_run_key(path: str, step_id: str, text: str) -> str:
    return hashlib.sha256(f"{path}|{step_id}|{text}".encode()).hexdigest()[:20]


class QueueStore:
    def __init__(self, space_root: Path, state: Path | None = None) -> None:
        self.space_root = Path(space_root)
        self.state = state

    def entries(self) -> list[dict[str, Any]]:
        return []

    def get(self, entry_id: str) -> dict[str, Any]:
        raise KeyError(entry_id)

    def apply(self, plan: QueuePlan, *, now: datetime) -> tuple[list[dict], dict | None]:
        raise NotImplementedError("M24 T2")

    def add(self, fields: dict[str, Any], *, now: datetime) -> dict[str, Any]:
        raise NotImplementedError("M24 T2")

    def update(self, entry_id: str, **fields: Any) -> dict[str, Any]:
        raise NotImplementedError("M24 T2")

    def claim_next(self, now: datetime, runner: str) -> dict[str, Any] | None:
        raise NotImplementedError("M24 T2")

    def has_auto_run(self, key: str) -> bool:
        return False

    def record_auto_run(self, key: str) -> None:
        raise NotImplementedError("M24 T2")

    def problem(self) -> str | None:
        return None
