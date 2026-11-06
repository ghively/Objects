"""The per-space work queue file and the rule that turns a work notice into queue entries (M24 T2).

The file is ``<state>/work-queue-<space key>.json``. Listing never writes; a ``running`` entry whose
runner isn't live in this process is served failed (CRASHED) and saved as failed on the next write.
"""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .appstate import space_key, state_dir
from .ids import new_ulid
from .jsonstore import dump_json
from .textfile import atomic_write
from .workagentmodel import CRASHED, KEEP_AUTO_RUNS, KEEP_FINISHED, WITHDRAWN_REDECIDED
from .workservice import WorkNotice

__all__ = ["QueuePlan", "QueueStore", "auto_run_key", "plan_for_notice"]

UNREADABLE = "The work queue file can't be read."
_LOCK = threading.RLock()
_LIVE_RUNNERS: set[str] = set()
_STEP_EVENTS = {"approve", "answer", "done", "decline", "run", "reopen", "edit", "remove"}
_CREATES = {"approve", "answer", "done", "decline", "run", "note", "request"}
_STOPS = {"decline", "reopen", "edit", "remove", "close"}


@dataclass(frozen=True)
class QueuePlan:
    path: str
    withdraw_step: str | None
    withdraw_item: bool
    stop_running: bool
    create: dict[str, Any] | None


def _iso(at: datetime) -> str:
    return at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _one_line(text: str | None, limit: int = 500) -> str | None:
    if text is None:
        return None
    return " ".join(text.split())[:limit]


def plan_for_notice(notice: WorkNotice) -> QueuePlan | None:
    """The queue change one work notice asks for; None when nothing. Agent writes never queue work."""
    role, event = notice.by.role, notice.event
    if role == "agent":
        return None
    if role == "app":
        if event != "run":
            return None
    elif role != "user":
        return None
    if event not in _STEP_EVENTS and event not in ("note", "request", "close"):
        return None
    step = notice.step_id if event in _STEP_EVENTS else None
    item = event == "close"
    create: dict[str, Any] | None = None
    if event in _CREATES:
        create = {"kind": event, "by": "Object" if role == "app" else notice.by.name}
        if event in _STEP_EVENTS:
            create.update(
                stepId=notice.step_id,
                stepN=notice.n,
                stepKind=notice.kind,
                stepText=notice.step_text,
            )
        if event == "approve":
            create["notBefore"] = notice.not_before
        if role == "app":
            create["auto"] = True
        if notice.text is not None and event in ("answer", "done", "decline", "note", "request"):
            create["text"] = notice.text
        create["path"] = notice.path
        create["objectId"] = notice.object_id
    if create is None and step is None and not item:
        return None
    return QueuePlan(
        path=notice.path,
        withdraw_step=step,
        withdraw_item=item,
        stop_running=event in _STOPS,
        create=create,
    )


def auto_run_key(path: str, step_id: str, text: str) -> str:
    return hashlib.sha256(f"{path}|{step_id}|{text}".encode()).hexdigest()[:20]


class QueueStore:
    def __init__(self, space_root: Path, state: Path | None = None) -> None:
        self.space_root = Path(space_root)
        self.state = state
        self._bad = False

    @property
    def file(self) -> Path:
        return (self.state or state_dir()) / f"work-queue-{space_key(self.space_root)}.json"

    # -- reading ---------------------------------------------------------
    def _load(self) -> dict[str, Any]:
        self._bad = False
        try:
            raw = self.file.read_bytes()
        except FileNotFoundError:
            return {"v": 1, "entries": [], "autoRuns": []}
        except OSError:
            self._bad = True
            return {"v": 1, "entries": [], "autoRuns": []}
        try:
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("entries", []), list):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            self._bad = True
            return {"v": 1, "entries": [], "autoRuns": []}
        data["entries"] = [e for e in data["entries"] if isinstance(e, dict) and e.get("id")]
        runs = data.get("autoRuns")
        data["autoRuns"] = [r for r in runs if isinstance(r, str)] if isinstance(runs, list) else []
        data["v"] = 1
        return data

    @staticmethod
    def _crashed(e: dict[str, Any]) -> bool:
        return e.get("state") == "running" and e.get("runner") not in _LIVE_RUNNERS

    def _settle(self, data: dict[str, Any], now: datetime | None = None) -> None:
        """Save crashed running entries as failed (called only inside a write)."""
        for e in data["entries"]:
            if self._crashed(e):
                e["state"] = "failed"
                e["reason"] = CRASHED
                e["finishedAt"] = e.get("finishedAt") or _iso(now or datetime.now(UTC))

    def entries(self) -> list[dict[str, Any]]:
        with _LOCK:
            data = self._load()
        entries = data["entries"]
        retried = {e.get("retryOf") for e in entries if e.get("retryOf")}
        now = datetime.now(UTC)
        out = []
        for e in entries:
            e = dict(e)
            if self._crashed(e):
                e["state"] = "failed"
                e["reason"] = CRASHED
            nb = _parse(e.get("notBefore"))
            e["due"] = e.get("state") == "pending" and (nb is None or nb <= now)
            e["retryable"] = e.get("state") == "failed" and e["id"] not in retried
            out.append(e)
        out.sort(key=lambda e: (e.get("createdAt") or "", e["id"]))
        return out

    def get(self, entry_id: str) -> dict[str, Any]:
        for e in self.entries():
            if e["id"] == entry_id:
                return e
        raise KeyError(entry_id)

    def problem(self) -> str | None:
        with _LOCK:
            self._load()
        return UNREADABLE if self._bad else None

    def has_auto_run(self, key: str) -> bool:
        with _LOCK:
            return key in self._load()["autoRuns"]

    # -- writing ---------------------------------------------------------
    def _save(self, data: dict[str, Any], now: datetime | None = None) -> None:
        self._settle(data, now)
        entries = data["entries"]
        keep_ids = {e["id"] for e in entries if e.get("state") not in ("done", "withdrawn")}
        finished = [e for e in entries if e["id"] not in keep_ids]
        finished.sort(key=lambda e: (e.get("createdAt") or "", e["id"]))
        drop = {e["id"] for e in finished[: max(0, len(finished) - KEEP_FINISHED)]}
        data["entries"] = [e for e in entries if e["id"] not in drop]
        data["autoRuns"] = data["autoRuns"][-KEEP_AUTO_RUNS:]
        path = self.file
        path.parent.mkdir(parents=True, exist_ok=True)
        if self._bad:
            try:
                raw = path.read_bytes()
            except OSError:
                raw = None
            if raw is not None:
                stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
                aside = path.with_name(f"work-queue-{space_key(self.space_root)}.unreadable-{stamp}.json")
                n = 2
                while aside.exists():
                    aside = path.with_name(
                        f"work-queue-{space_key(self.space_root)}.unreadable-{stamp}-{n}.json"
                    )
                    n += 1
                atomic_write(aside, raw)
            self._bad = False
        atomic_write(path, dump_json(data))

    @staticmethod
    def _new(fields: dict[str, Any], now: datetime) -> dict[str, Any]:
        entry: dict[str, Any] = {
            "id": new_ulid(), "kind": None, "state": "pending", "path": None, "objectId": None,
            "title": None, "stepId": None, "stepN": None, "stepKind": None, "stepText": None,
            "text": None, "capturePath": None, "notBefore": None, "auto": False, "by": "Gene",
            "createdAt": _iso(now), "claimedAt": None, "finishedAt": None, "result": None,
            "reason": None, "chatId": None, "agentId": None, "purpose": None, "runner": None,
            "attempt": 1, "retryOf": None,
        }
        entry.update(fields)
        return entry

    def add(self, fields: dict[str, Any], *, now: datetime) -> dict[str, Any]:
        with _LOCK:
            data = self._load()
            entry = self._new(fields, now)
            data["entries"].append(entry)
            self._save(data, now)
        return dict(entry)

    def _withdraw(self, data: dict[str, Any], plan: QueuePlan, now: datetime) -> list[dict]:
        out = []
        for e in data["entries"]:
            if e.get("path") != plan.path:
                continue
            if not (plan.withdraw_item or (plan.withdraw_step and e.get("stepId") == plan.withdraw_step)):
                continue
            if e.get("state") == "pending" or (plan.stop_running and e.get("state") == "running"):
                e["state"] = "withdrawn"
                e["reason"] = WITHDRAWN_REDECIDED
                e["finishedAt"] = _iso(now)
                out.append(dict(e))
        return out

    def apply(self, plan: QueuePlan, *, now: datetime) -> tuple[list[dict], dict | None]:
        with _LOCK:
            data = self._load()
            withdrawn = self._withdraw(data, plan, now)
            created = None
            if plan.create:
                created = self._new(plan.create, now)
                data["entries"].append(created)
            if withdrawn or created:
                self._save(data, now)
        return withdrawn, (dict(created) if created else None)

    def update(self, entry_id: str, **fields: Any) -> dict[str, Any]:
        with _LOCK:
            data = self._load()
            for e in data["entries"]:
                if e["id"] == entry_id:
                    for k in ("result", "reason"):
                        if k in fields:
                            fields[k] = _one_line(fields[k])
                    e.update(fields)
                    self._save(data)
                    return dict(e)
        raise KeyError(entry_id)

    def claim_next(self, now: datetime, runner: str) -> dict[str, Any] | None:
        with _LOCK:
            data = self._load()
            due = []
            for e in data["entries"]:
                nb = _parse(e.get("notBefore"))
                if e.get("state") == "pending" and (nb is None or nb <= now):
                    due.append(e)
            if not due:
                return None
            due.sort(key=lambda e: (e.get("createdAt") or "", e["id"]))
            e = due[0]
            e.update(state="running", claimedAt=_iso(now), runner=runner)
            _LIVE_RUNNERS.add(runner)
            self._save(data, now)
            return dict(e)

    def record_auto_run(self, key: str) -> None:
        with _LOCK:
            data = self._load()
            if key in data["autoRuns"]:
                return
            data["autoRuns"].append(key)
            self._save(data)
