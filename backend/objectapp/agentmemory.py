"""An agent's memory (M18, spec section 5): ``MEMORY.md`` and ``USER.md`` in
``.object-agent/memory/``, the ``memory`` tool's operations, the per-chat frozen snapshot and the
two run contributors that append it and the learning guidance.

- Entries are joined by ``"\\n§\\n"`` (a line holding only ``§``). An absent file is empty; the
  folder is made by the first write. An existing file's BOM and line endings are kept
  (`textfile.encode_like`), and so is a final newline.
- Caps (characters, not bytes): after an ``add`` or ``replace`` the file must be at most its cap,
  or the write must make it shorter. ``remove`` always passes. Gene's whole-file saves
  (`user_save`) aren't capped.
- Every write is atomic, under a lock per file, and logged in the ledger (``before`` and
  ``after`` hold the file's decoded text: no BOM, ``\\n`` endings).
- The snapshot: a chat's first run writes a ``memory`` line into its transcript holding both
  files as they were then; every later run of that chat (and its reviews) appends that line's
  text, so the agent's own memory writes take effect in its next chat. A chat with no transcript
  yet (the pre-flight check before its header is written) gets the files as they are, unwritten.
"""

from __future__ import annotations

import hashlib
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import agentfiles, ledger, textfile, toolcatalog, transcripts
from .learningmodel import (
    ENTRY_SEPARATOR,
    LEARNING_DEFAULTS,
    MEMORY_FILE,
    USER_FILE,
    effective_learning,
)

if TYPE_CHECKING:
    from .agentrun import RunParts, RunScope

__all__ = [
    "LEARNING_GUIDANCE",
    "MemoryError",
    "apply",
    "guidance_contributor",
    "join_entries",
    "parse_entries",
    "read",
    "snapshot_contributor",
    "snapshot_for",
    "snapshot_text",
    "user_save",
]

LEARNING_GUIDANCE: dict[str, str] = {
    "memory": (
        "Save lasting facts with the memory tool: target user for facts about the person you work "
        "for, target memory for facts about the work and its environment. Keep each entry short; "
        "what you save shows up in your next chat."
    ),
    "skill_manage": (
        "Keep your skills with skills_list, skill_view and skill_manage: read a skill before you "
        "change it, and improve an existing skill before you make a new one."
    ),
    "session_search": "Find earlier chats with session_search.",
}
"""One sentence per learning tool (our text), keyed by tool name; `guidance_contributor` appends
the sentences for the tools the agent has switched on. The skills sentence is kept while any of
the three skill tools is on."""

_GUIDANCE_TOOLS: dict[str, tuple[str, ...]] = {
    "memory": ("memory",),
    "skill_manage": ("skills_list", "skill_view", "skill_manage"),
    "session_search": ("session_search",),
}

_FILES = {"memory": MEMORY_FILE, "user": USER_FILE}
_CAP_KEYS = {"memory": "memoryChars", "user": "userChars"}
_ACTIONS = ("add", "replace", "remove")

SNAPSHOT_BLOCK = (
    "<memory>\n"
    "What you saved about your work and environment, as of this chat's start (MEMORY.md):\n"
    "{memory}\n"
    "</memory>\n"
    "<user-profile>\n"
    "What you saved about the person you work for, as of this chat's start (USER.md):\n"
    "{user}\n"
    "</user-profile>"
)


class MemoryError(Exception):  # noqa: A001 - the Contract's name
    """A memory write that can't be made: 422 (409 for a stale base revision)."""

    def __init__(self, message: str, status: int = 422, current_revision: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.current_revision = current_revision


_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def _lock_for(path: Path) -> threading.Lock:
    key = os.path.normcase(os.path.abspath(path))
    with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = _locks[key] = threading.Lock()
        return lock


def _now() -> str:
    moment = datetime.now(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


# -- entries ---------------------------------------------------------------------------------------


def _is_separator(line: str) -> bool:
    return line.strip() == ENTRY_SEPARATOR


def parse_entries(text: str) -> list[str]:
    """Split on lines that are exactly ``§`` (spaces trimmed); blank entries dropped."""
    entries: list[str] = []
    current: list[str] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        if _is_separator(line):
            entries.append("\n".join(current))
            current = []
        else:
            current.append(line)
    entries.append("\n".join(current))
    return [e.strip() for e in entries if e.strip()]


def join_entries(entries: list[str]) -> str:
    """``"\\n§\\n".join(entries)``."""
    return f"\n{ENTRY_SEPARATOR}\n".join(entries)


# -- files -----------------------------------------------------------------------------------------


def _target_path(folder: Path, target: str) -> Path:
    if target not in _FILES:
        raise MemoryError("The target must be memory or user.")
    return Path(folder) / _FILES[target]


def _file_name(target: str) -> str:
    return Path(_FILES[target]).name


def _read_bytes(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def _revision(data: bytes | None) -> str | None:
    return hashlib.sha256(data).hexdigest() if data is not None else None


def _cap_of(folder: Path, target: str, caps: dict[str, Any] | None = None) -> int:
    key = _CAP_KEYS[target]
    if caps is not None:
        value = caps.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            return value
        return int(LEARNING_DEFAULTS[key])
    try:
        data, _rev = agentfiles.read_agent_file(folder)
    except ValueError:
        data = {}
    return int(effective_learning(data)[key])


def _memory_file(target: str, raw: bytes | None, cap: int) -> dict[str, Any]:
    text = textfile.decode(raw).text if raw is not None else ""
    entries = parse_entries(text)
    return {
        "target": target,
        "text": text,
        "entries": entries,
        "chars": len(join_entries(entries)),
        "cap": cap,
        "revision": _revision(raw),
    }


def read(folder: Path, target: str) -> dict[str, Any]:
    """MemoryFile: ``{"target","text","entries","chars","cap","revision"}``; never writes."""
    path = _target_path(folder, target)
    return _memory_file(target, _read_bytes(path), _cap_of(folder, target))


def _encode(original: bytes | None, text: str) -> bytes:
    if original is None:
        return text.encode("utf-8")
    old_text = textfile.decode(original).text
    if old_text.endswith("\n") and text and not text.endswith("\n"):
        text += "\n"
    return textfile.encode_like(original, text)


def _write(path: Path, original: bytes | None, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    textfile.atomic_write(path, _encode(original, text))


# -- the memory tool -------------------------------------------------------------------------------


def _clean_content(content: str | None) -> str:
    if not isinstance(content, str) or not content.strip():
        raise MemoryError("Give the entry's text.")
    if any(_is_separator(line) for line in content.replace("\r\n", "\n").split("\n")):
        raise MemoryError(f"An entry can't hold a line with only {ENTRY_SEPARATOR}.")
    return content.replace("\r\n", "\n").strip()


def _find(entries: list[str], old_text: str | None) -> int:
    if not isinstance(old_text, str) or not old_text.strip():
        raise MemoryError("Give the entry's text.")
    needle = old_text.replace("\r\n", "\n")
    hits = [i for i, e in enumerate(entries) if needle in e]
    if not hits:
        raise MemoryError("No entry contains that text.")
    if len(hits) > 1:
        raise MemoryError(f"{len(hits)} entries contain that text; give more of it.")
    return hits[0]


def _cap_message(target: str, n: int, cap: int, entries: list[str]) -> str:
    return (
        f"That would make {_file_name(target)} {n:,} characters, over its cap of {cap:,}. "
        f"Consolidate first: replace or remove entries. Current entries:\n{join_entries(entries)}"
    )


def apply(folder: Path, action: str, target: str, *, content: str | None, old_text: str | None,
          source: dict[str, Any], caps: dict[str, Any]) -> dict[str, Any]:
    """The memory tool: ``{"ok": True, "entryId", "target", "entries", "chars", "cap"}`` (and
    ``note`` for a duplicate ``add``, which changes nothing); a lock per file; one ledger line."""
    if action not in _ACTIONS:
        raise MemoryError("The memory tool's actions are add, replace and remove.")
    path = _target_path(folder, target)
    cap = _cap_of(folder, target, caps)
    with _lock_for(path):
        original = _read_bytes(path)
        before_text = textfile.decode(original).text if original is not None else None
        entries = parse_entries(before_text or "")
        old_chars = len(join_entries(entries))
        if action == "add":
            entry = _clean_content(content)
            if entry in entries:
                return {"ok": True, "entryId": None, "target": target, "entries": entries,
                        "chars": old_chars, "cap": cap, "note": "Already saved."}
            new_entries = [*entries, entry]
        elif action == "replace":
            entry = _clean_content(content)
            index = _find(entries, old_text)
            new_entries = list(entries)
            new_entries[index] = entry
        else:
            index = _find(entries, old_text)
            new_entries = entries[:index] + entries[index + 1:]
        new_text = join_entries(new_entries)
        new_chars = len(new_text)
        if action != "remove" and new_chars > cap and new_chars >= old_chars:
            raise MemoryError(_cap_message(target, new_chars, cap, entries))
        _write(path, original, new_text)
        after_text = textfile.decode(_encode(original, new_text)).text
        written = ledger.append(folder, {
            "target": target, "action": action, "before": before_text, "after": after_text,
            "source": source,
        })
    return {"ok": True, "entryId": written["id"], "target": target, "entries": new_entries,
            "chars": new_chars, "cap": cap}


def user_save(folder: Path, target: str, text: str, base_revision: str | None) -> dict[str, Any]:
    """Gene's whole-file edit; no cap; 409 (`MemoryError` with ``current_revision``) when
    `base_revision` is stale. The ledger line is an ``edit`` with source ``{"kind": "user"}``.
    The MemoryFile as saved."""
    path = _target_path(folder, target)
    with _lock_for(path):
        original = _read_bytes(path)
        current = _revision(original)
        if base_revision != current:
            raise MemoryError("This file changed since you opened it.", 409, current)
        before_text = textfile.decode(original).text if original is not None else None
        new_text = text.replace("\r\n", "\n")
        data = _encode(original, new_text)
        path.parent.mkdir(parents=True, exist_ok=True)
        textfile.atomic_write(path, data)
        ledger.append(folder, {
            "target": target, "action": "edit", "before": before_text,
            "after": textfile.decode(data).text, "source": {"kind": "user"},
        })
    return _memory_file(target, data, _cap_of(folder, target))


# -- the snapshot ----------------------------------------------------------------------------------


def _current_texts(folder: Path) -> tuple[str, str]:
    out = []
    for target in ("memory", "user"):
        raw = _read_bytes(_target_path(folder, target))
        out.append(join_entries(parse_entries(textfile.decode(raw).text)) if raw is not None else "")
    return out[0], out[1]


def _snapshot_line(lines: list[dict[str, Any]]) -> tuple[str, str] | None:
    for line in lines:
        if line.get("type") == "memory":
            memory = line.get("memory")
            user = line.get("user")
            return (memory if isinstance(memory, str) else "", user if isinstance(user, str) else "")
    return None


def snapshot_for(folder: Path, chat_id: str) -> tuple[str, str]:
    """The chat's frozen (memory, user): its transcript's ``memory`` line, else the files as they
    are now, written as that line first. A chat without a transcript (or an id that isn't a chat
    id) gets the files as they are now and nothing is written."""
    try:
        path = transcripts.path_for(Path(folder), chat_id)
    except ValueError:
        return _current_texts(folder)
    with _lock_for(path):
        try:
            lines = transcripts.raw_lines(Path(folder), chat_id)
        except FileNotFoundError:
            return _current_texts(folder)
        frozen = _snapshot_line(lines)
        if frozen is not None:
            return frozen
        memory, user = _current_texts(folder)
        try:
            transcripts.append(Path(folder), chat_id,
                               [{"type": "memory", "memory": memory, "user": user, "at": _now()}])
        except OSError:
            pass
        return memory, user


def snapshot_text(memory: str, user: str) -> str:
    """``""`` when both are empty; else the ``<memory>`` / ``<user-profile>`` block."""
    if not memory.strip() and not user.strip():
        return ""
    return SNAPSHOT_BLOCK.format(memory=memory, user=user)


def snapshot_contributor(scope: RunScope, parts: RunParts) -> None:
    """Order 10 ``memory-snapshot``: every purpose except ``curator``."""
    if scope.purpose == "curator":
        return
    memory, user = snapshot_for(Path(scope.agent.folder), scope.chat_id)
    text = snapshot_text(memory, user)
    if text:
        parts.append_prompt.append(text)


def guidance_contributor(scope: RunScope, parts: RunParts) -> None:
    """Order 15 ``learning-guidance``: `LEARNING_GUIDANCE`, only the sentences for tools the agent
    has switched on (nothing when all are off)."""
    off = scope.agent.data.get("toolsOff") if isinstance(scope.agent.data, dict) else None
    off_set = {t for t in off if isinstance(t, str)} if isinstance(off, list) else set()
    sentences = [
        LEARNING_GUIDANCE[key]
        for key, tools in _GUIDANCE_TOOLS.items()
        if any(f"mcp__{toolcatalog.AGENT_SERVER}__{t}" not in off_set for t in tools)
    ]
    if sentences:
        parts.append_prompt.append(" ".join(sentences))
