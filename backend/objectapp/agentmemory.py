"""An agent's memory (M18, spec section 5): ``MEMORY.md`` and ``USER.md`` in
``.object-agent/memory/``, the ``memory`` tool's operations, the per-chat frozen snapshot and the
two run contributors that append it and the learning guidance.

T1 stub: the Contract's names and signatures; the plan's T2 fills them. The contributors are
registered by `learnhooks.install` and do nothing yet.

- Entries are joined by ``"\\n§\\n"`` (a line holding only ``§``). An absent file is empty; the
  folder is made by the first write. An existing file's BOM and line endings are kept.
- Caps (characters, not bytes): after an ``add`` or ``replace`` the file must be at most its cap,
  or the write must make it shorter. ``remove`` always passes. Gene's whole-file saves
  (`user_save`) aren't capped.
- Every write is atomic, under a lock per file, and logged in the ledger.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

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

LEARNING_GUIDANCE: dict[str, str] = {}
"""T2: one sentence per learning tool (keyed by tool name); `guidance_contributor` appends the
sentences for the tools the agent has switched on."""


class MemoryError(Exception):  # noqa: A001 - the Contract's name
    """A memory write that can't be made: 422 (409 for a stale base revision)."""

    def __init__(self, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def parse_entries(text: str) -> list[str]:
    """Split on lines that are exactly ``§`` (spaces trimmed); blank entries dropped."""
    raise NotImplementedError("M18 T2")


def join_entries(entries: list[str]) -> str:
    """``"\\n§\\n".join(entries)``."""
    raise NotImplementedError("M18 T2")


def read(folder: Path, target: str) -> dict[str, Any]:
    """MemoryFile: ``{"target","text","entries","chars","cap","revision"}``; never writes."""
    raise NotImplementedError("M18 T2")


def apply(folder: Path, action: str, target: str, *, content: str | None, old_text: str | None,
          source: dict[str, Any], caps: dict[str, Any]) -> dict[str, Any]:
    """The memory tool: ``{"ok": True, "entryId", "target", "entries", "chars", "cap"}``; a lock
    per file; one ledger line."""
    raise NotImplementedError("M18 T2")


def user_save(folder: Path, target: str, text: str, base_revision: str | None) -> dict[str, Any]:
    """Gene's whole-file edit; no cap; 409 when `base_revision` is stale."""
    raise NotImplementedError("M18 T2")


def snapshot_for(folder: Path, chat_id: str) -> tuple[str, str]:
    """The chat's frozen (memory, user): its transcript's ``memory`` line, else the files as they
    are now, written as that line first."""
    raise NotImplementedError("M18 T2")


def snapshot_text(memory: str, user: str) -> str:
    """``""`` when both are empty; else the ``<memory>`` / ``<user-profile>`` block."""
    raise NotImplementedError("M18 T2")


def snapshot_contributor(scope: RunScope, parts: RunParts) -> None:
    """Order 10 ``memory-snapshot``: every purpose except ``curator`` (T2)."""
    return None


def guidance_contributor(scope: RunScope, parts: RunParts) -> None:
    """Order 15 ``learning-guidance``: `LEARNING_GUIDANCE`, only the sentences for tools the agent
    has switched on (T2)."""
    return None
