"""Undo of one ledger entry (M18, spec section 5: "the Skills tab offers Undo per change").

Every entry can be undone, undo entries included. Whether the files still match is checked when
Undo is pressed: a file whose content isn't the entry's ``after`` any more, a skill that moved, or
a pin or state that changed since refuses with `UndoConflict` (409) and changes nothing.

What an entry did (its *effect*) decides the inverse:

- ``file`` (every memory action; a skill's patch, edit, write_file and remove_file): the file is
  written back to ``before``. A support file that didn't exist is removed again (its text stays in
  the ledger); a memory file that didn't exist is left empty, never deleted.
- ``create``: the skill is archived, never deleted.
- ``archive`` / ``restore``: the folder is moved back (``archivedAs`` names the archive folder).
- ``pin`` / ``unpin``, ``stale`` / ``active``: the opposite is set.

An undo entry records its own effect (``effect``) and the encodings of its ``before``
(``encoding``) and ``after`` (``afterEncoding``), so undoing it is the same mechanism again.

No network client.
"""

from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

from . import agentmemory, agentskills, ledger, textfile
from .agentskills import SKILL_FILE, SkillConflict, SkillError

__all__ = ["CHANGED_MESSAGE", "UndoConflict", "undo"]

CHANGED_MESSAGE = "This changed again since. Undo the later change first."  # our string

_OPPOSITE = {"pin": "unpin", "unpin": "pin", "stale": "active", "active": "stale"}
_FILE_ACTIONS = frozenset({"patch", "edit", "write_file", "remove_file"})


class UndoConflict(Exception):
    """The entry can't be undone as things are now (409)."""

    status = 409

    def __init__(self, message: str = CHANGED_MESSAGE) -> None:
        super().__init__(message)
        self.message = message


def _effect(entry: dict[str, Any]) -> str:
    action = entry.get("action")
    if action == "undo":
        return str(entry.get("effect") or "")
    if entry.get("target") in ("memory", "user"):
        return "file"
    if action in _FILE_ACTIONS:
        return "file"
    return str(action or "")


def _value_bytes(value: str, encoding: str) -> bytes | None:
    if encoding == "base64":
        return base64.b64decode(value)
    return None


def _matches(raw: bytes | None, value: str | None, encoding: str) -> bool:
    """Whether the file's bytes `raw` (None: no file) are what the ledger value says."""
    if value is None:
        return raw is None
    if raw is None:
        return False
    if encoding == "base64":
        return raw == base64.b64decode(value)
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return textfile.decode(raw).text == value


def _undo_memory(folder: Path, entry: dict[str, Any]) -> dict[str, Any]:
    target = entry["target"]
    path = agentmemory._target_path(folder, target)
    with agentmemory._lock_for(path):
        raw = agentmemory._read_bytes(path)
        if not _matches(raw, entry.get("after"), "text"):
            raise UndoConflict()
        before = entry.get("before")
        data = agentmemory._encode(raw, before if isinstance(before, str) else "")
        path.parent.mkdir(parents=True, exist_ok=True)
        textfile.atomic_write(path, data)
        return {"target": target, "before": entry.get("after"), "after": textfile.decode(data).text,
                "effect": "file"}


def _undo_skill_file(folder: Path, entry: dict[str, Any]) -> dict[str, Any]:
    name = str(entry.get("skill") or "")
    skill_dir = agentskills._active_dir(folder, name)
    if skill_dir is None:
        raise UndoConflict()
    try:
        agentskills._check_skill_dir(folder, skill_dir)
        rel, path = agentskills._file_path(skill_dir, entry.get("file"))
    except SkillError as exc:
        raise UndoConflict() from exc
    raw = agentskills._read_bytes(path) if path.is_file() else None
    before_enc = str(entry.get("encoding") or "text")
    after_enc = str(entry.get("afterEncoding") or "text")
    if not _matches(raw, entry.get("after"), after_enc):
        raise UndoConflict()
    before = entry.get("before")
    if before is None:
        if rel == SKILL_FILE:
            raise UndoConflict()
        textfile.retry_os(lambda: os.unlink(path))
        written: str | None = None
    else:
        data = _value_bytes(before, before_enc)
        if data is None:
            data = agentskills._encode(raw, before)
        path.parent.mkdir(parents=True, exist_ok=True)
        textfile.atomic_write(path, data)
        written = before if before_enc == "base64" else textfile.decode(data).text
    return {"target": "skill", "skill": name, "file": rel, "before": entry.get("after"), "after": written,
            "encoding": after_enc, "afterEncoding": before_enc, "effect": "file"}


def _undo_create(folder: Path, entry: dict[str, Any]) -> dict[str, Any]:
    name = str(entry.get("skill") or "")
    skill_dir = agentskills._active_dir(folder, name)
    if skill_dir is None:
        raise UndoConflict()
    text = agentskills._skill_md_of(skill_dir)
    if text != entry.get("after"):
        raise UndoConflict()
    archived = agentskills._do_archive(folder, name, None)
    return {"target": "skill", "skill": name, "file": SKILL_FILE, "before": text, "after": None,
            "archivedAs": archived, "effect": "archive"}


def _undo_archive(folder: Path, entry: dict[str, Any]) -> dict[str, Any]:
    name = str(entry.get("skill") or "")
    archived = entry.get("archivedAs")
    if not isinstance(archived, str) or agentskills._archived_dir(folder, archived) is None:
        raise UndoConflict()
    if agentskills._base_name(archived) != name:
        raise UndoConflict()
    try:
        active = agentskills._do_restore(folder, archived)
    except SkillConflict as exc:
        raise UndoConflict(exc.message) from exc
    except SkillError as exc:
        raise UndoConflict() from exc
    after = agentskills._skill_md_of(agentskills._skills_root(folder) / active)
    return {"target": "skill", "skill": active, "file": SKILL_FILE, "before": None, "after": after,
            "archivedAs": archived, "effect": "restore"}


def _undo_restore(folder: Path, entry: dict[str, Any]) -> dict[str, Any]:
    name = str(entry.get("skill") or "")
    skill_dir = agentskills._active_dir(folder, name)
    if skill_dir is None:
        raise UndoConflict()
    text = agentskills._skill_md_of(skill_dir)
    archived = agentskills._do_archive(folder, name, None)
    return {"target": "skill", "skill": name, "file": SKILL_FILE, "before": text, "after": None,
            "archivedAs": archived, "effect": "archive"}


def _undo_flag(folder: Path, entry: dict[str, Any], effect: str) -> dict[str, Any]:
    name = str(entry.get("skill") or "")
    if agentskills._active_dir(folder, name) is None:
        raise UndoConflict()
    usage, _ok = agentskills._read_usage(folder)
    current = agentskills._skill_usage(usage, name)
    if effect in ("pin", "unpin"):
        if (current.get("pinned") is True) != (effect == "pin"):
            raise UndoConflict()
    elif ("stale" if current.get("state") == "stale" else "active") != effect:
        raise UndoConflict()
    opposite = _OPPOSITE[effect]

    def change(u: dict[str, Any]) -> bool:
        item = agentskills._entry_for(u, name)
        if opposite in ("pin", "unpin"):
            item["pinned"] = opposite == "pin"
        else:
            item["state"] = opposite
        return True

    try:
        agentskills._update_usage(folder, change, strict=True)
    except SkillError as exc:
        raise UndoConflict(exc.message) from exc
    return {"target": "skill", "skill": name, "effect": opposite}


def undo(folder: Path, entry_id: str, *, source: dict[str, Any]) -> dict[str, Any]:
    """Undo the entry `entry_id`; the new ``undo`` entry. KeyError for an unknown id,
    `UndoConflict` when it changed since (nothing is changed then)."""
    folder = Path(folder)
    entry = ledger.get(folder, entry_id)
    effect = _effect(entry)
    with agentskills._lock(folder):
        if entry.get("target") in ("memory", "user"):
            fields = _undo_memory(folder, entry)
        elif effect == "file":
            fields = _undo_skill_file(folder, entry)
        elif effect == "create":
            fields = _undo_create(folder, entry)
        elif effect == "archive":
            fields = _undo_archive(folder, entry)
        elif effect == "restore":
            fields = _undo_restore(folder, entry)
        elif effect in _OPPOSITE:
            fields = _undo_flag(folder, entry, effect)
        else:
            raise UndoConflict("This change can't be undone.")
        return ledger.append(folder, {"action": "undo", "undoes": entry["id"], "source": source, **fields})
