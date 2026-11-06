"""An agent's learning ledger (M18, spec section 5): ``.object-agent/ledger.jsonl``.

One `learningmodel.LedgerEntry` per line, append-only, UTF-8. Every memory and skill change
(from a chat, a review, the curator, Gene or an Undo) is one line holding the whole file's text
before and after, so every change can be shown and undone.

- `append` fills ``v``, ``id`` and ``at`` (when not given) and writes the line in one write under
  the folder's lock. A torn last line (a crash mid-write) is skipped on read, and the next append
  starts on a fresh line so it isn't lost to the torn one.
- `entries` lists newest first (file order, reversed: ULIDs made in the same millisecond aren't
  ordered).
- An ``undo`` entry also keeps ``undoneLine``, the history line of the entry it undid, filled by
  `append`, so `line` can say ``Undid: …`` from the entry alone.

Called only by `agentmemory`, `agentskills`, `learnundo` and `curator`. No network client.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .ids import new_ulid
from .learningmodel import LEDGER_FILE, LedgerEntry

__all__ = ["append", "entries", "get", "line", "summary"]

_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}

_DEFAULTS: dict[str, Any] = {
    "skill": None, "file": None, "before": None, "after": None, "encoding": "text",
    "absorbedInto": None, "undoes": None,
}


def _now() -> str:
    moment = datetime.now(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _lock_for(folder: Path) -> threading.Lock:
    key = os.path.normcase(os.path.abspath(folder))
    with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = _locks[key] = threading.Lock()
        return lock


def _path(folder: Path) -> Path:
    return Path(folder) / LEDGER_FILE


def _parse(folder: Path) -> list[dict[str, Any]]:
    """Every parsable entry, oldest first; a missing ledger is empty."""
    try:
        data = _path(folder).read_bytes()
    except FileNotFoundError:
        return []
    out: list[dict[str, Any]] = []
    for raw in data.split(b"\n"):
        if not raw.strip():
            continue
        try:
            obj = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            continue
        if isinstance(obj, dict) and isinstance(obj.get("id"), str):
            out.append(obj)
    return out


def append(folder: Path, entry: dict[str, Any]) -> dict[str, Any]:
    """Append `entry` (``v``/``id``/``at`` filled when absent); the entry as written.

    Raises pydantic's ValidationError for an entry that isn't a `LedgerEntry`.
    """
    full: dict[str, Any] = {
        "v": entry.get("v") or 1, "id": entry.get("id") or new_ulid(), "at": entry.get("at") or _now(),
    }
    full.update(_DEFAULTS)
    full.update({k: v for k, v in entry.items() if k not in ("v", "id", "at")})
    LedgerEntry.model_validate(full)
    path = _path(folder)
    with _lock_for(folder):
        if full.get("action") == "undo" and full.get("undoes") and not full.get("undoneLine"):
            undone = next((e for e in _parse(folder) if e.get("id") == full["undoes"]), None)
            if undone is not None:
                full["undoneLine"] = line(undone)
        data = json.dumps(full, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a+b") as f:
            f.seek(0, os.SEEK_END)
            if f.tell() > 0:
                f.seek(-1, os.SEEK_END)
                if f.read(1) != b"\n":
                    data = b"\n" + data
                f.seek(0, os.SEEK_END)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    return full


def entries(folder: Path, *, target: str | None = None, skill: str | None = None, run: str | None = None,
            limit: int = 100, before: str | None = None) -> list[dict[str, Any]]:
    """Entries newest first, filtered; `before` is an entry id: only entries older than it (an
    unknown id gives none). Torn lines are skipped. Never writes."""
    items = list(reversed(_parse(folder)))
    if before is not None:
        index = next((i for i, e in enumerate(items) if e.get("id") == before), None)
        if index is None:
            return []
        items = items[index + 1:]
    out: list[dict[str, Any]] = []
    for e in items:
        if target is not None and e.get("target") != target:
            continue
        if skill is not None and e.get("skill") != skill:
            continue
        if run is not None:
            source = e.get("source")
            if not isinstance(source, dict) or source.get("run") != run:
                continue
        out.append(e)
        if len(out) >= limit:
            break
    return out


def get(folder: Path, entry_id: str) -> dict[str, Any]:
    """The entry with `entry_id`; KeyError when there is none."""
    for e in _parse(folder):
        if e.get("id") == entry_id:
            return e
    raise KeyError(entry_id)


_MEMORY_LINES = {
    "add": "Saved a memory",
    "replace": "Changed a memory",
    "remove": "Removed a memory",
    "edit": "Edited the memory file",
}


def _support_file(entry: dict[str, Any]) -> str | None:
    file = entry.get("file")
    return file if isinstance(file, str) and file and file != "SKILL.md" else None


def line(entry: dict[str, Any]) -> str:
    """The entry's history line (our strings)."""
    action = str(entry.get("action") or "")
    target = entry.get("target")
    if action == "undo":
        undone = entry.get("undoneLine")
        return f"Undid: {undone}" if isinstance(undone, str) and undone else "Undid a change"
    if target in ("memory", "user"):
        text = _MEMORY_LINES.get(action, "Changed the memory file")
        return f"{text} about you" if target == "user" else text
    skill = str(entry.get("skill") or "")
    file = _support_file(entry)
    if action == "create":
        return f"Created the skill '{skill}'"
    if action == "patch":
        return f"Patched '{skill}' in {file}" if file else f"Patched '{skill}'"
    if action == "edit":
        return f"Rewrote '{skill}'"
    if action == "write_file":
        return f"Added {entry.get('file')} to '{skill}'"
    if action == "remove_file":
        return f"Removed {entry.get('file')} from '{skill}'"
    if action == "archive":
        into = entry.get("absorbedInto")
        return f"Archived '{skill}' into '{into}'" if into else f"Archived '{skill}'"
    if action == "restore":
        return f"Restored '{skill}'"
    if action == "stale":
        return f"Marked '{skill}' stale"
    if action == "active":
        return f"Marked '{skill}' active"
    if action == "pin":
        return f"Pinned '{skill}'"
    if action == "unpin":
        return f"Unpinned '{skill}'"
    return f"Changed '{skill}'"


def summary(entry: dict[str, Any]) -> dict[str, Any]:
    """LedgerSummary: the entry without ``before``/``after``, plus ``line``."""
    out = {k: v for k, v in entry.items() if k not in ("before", "after")}
    out["line"] = line(entry)
    return out
