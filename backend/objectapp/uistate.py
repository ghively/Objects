"""``.object/ui.json``: pinned items, custom sidebar sections, the All notes layout.

Also holds ``changeTypePreferences`` (see `changetype`) and any key it doesn't
know. A patch replaces only the top-level keys it names. A missing file reads as
defaults and is written the first time something changes; a file that isn't a
readable JSON object is never replaced.

This module must not import `space` at import time (`space` imports `changetype`,
which imports this).
"""

from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path
from typing import Any

from .jsonstore import dump_json
from .keycompat import upgrade_keys
from .textfile import atomic_write
from .typemodel import RevisionConflict

__all__ = ["UI_REL", "load_ui", "patch_ui", "read_ui", "ui_read_only_reason", "ui_with_defaults", "write_ui_patch"]

UI_REL = ".object/ui.json"
_fallback_lock = threading.RLock()


def _ui_file(root: Path) -> Path:
    return Path(root) / ".object" / "ui.json"


def _read(root: Path) -> tuple[dict[str, Any], str, str | None]:
    """(data, revision, error); data is ``{}`` when missing or unreadable."""
    try:
        raw = _ui_file(root).read_bytes()
    except (FileNotFoundError, NotADirectoryError):
        return {}, "", None
    revision = hashlib.sha256(raw).hexdigest()
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        return {}, revision, f"ui.json is not valid JSON: {exc}"
    if not isinstance(data, dict):
        return {}, revision, "ui.json is not a JSON object"
    upgrade_keys(data)  # older key names, renamed in memory only
    return data, revision, None


def load_ui(root: Path) -> dict[str, Any]:
    """``.object/ui.json`` as a dict (empty when missing or unreadable)."""
    return _read(root)[0]


def read_ui(root: Path) -> tuple[dict[str, Any], str]:
    """(ui, revision); ``({}, '')`` when missing (``{}`` and the file's revision when unreadable)."""
    data, revision, _error = _read(root)
    return data, revision


def ui_read_only_reason(root: Path) -> str | None:
    """Why ``ui.json`` can't be patched (it exists but isn't a JSON object), else None."""
    return _read(root)[2]


def ui_with_defaults(ui: dict[str, Any]) -> dict[str, Any]:
    """`ui` with ``pinned``, ``sections`` and ``allNotesLayout`` filled in when absent."""
    out = dict(ui)
    out.setdefault("pinned", [])
    out.setdefault("sections", [])
    out.setdefault("allNotesLayout", "list")
    return out


def write_ui_patch(
    root: Path,
    patch: dict[str, Any],
    base_revision: str | None,
    own_writes: dict[str, str] | None = None,
    lock: threading.RLock | None = None,
) -> tuple[dict[str, Any], str]:
    """Replace the patched top-level keys; return (ui, revision).

    Raises `RevisionConflict` when `base_revision` is given and stale, and
    `ReadOnly` when the file can't be read (it is never replaced).
    """
    from .space import ReadOnly

    path = _ui_file(root)
    with lock or _fallback_lock:
        data, current, error = _read(root)
        if error is not None:
            raise ReadOnly(error)
        if base_revision is not None and base_revision != current:
            raise RevisionConflict(current)
        data = {**data, **patch}
        payload = dump_json(data)
        revision = hashlib.sha256(payload).hexdigest()
        path.parent.mkdir(parents=True, exist_ok=True)
        previous = own_writes.get(UI_REL) if own_writes is not None else None
        if own_writes is not None:
            own_writes[UI_REL] = revision

        def unchanged() -> None:
            # Re-check right before the replace: an external edit since the read
            # above is a conflict, never overwritten (as `JsonStore.write`).
            now = _read(root)[1]
            if now != current:
                raise RevisionConflict(now)

        try:
            atomic_write(path, payload, check=unchanged)
        except BaseException:
            if own_writes is not None:
                if previous is None:
                    own_writes.pop(UI_REL, None)
                else:
                    own_writes[UI_REL] = previous
            raise
        return data, revision


def patch_ui(space, patch: dict[str, Any], base_revision: str | None) -> tuple[dict[str, Any], str]:
    """`write_ui_patch` for a `Space`: under its lock, with own-write suppression."""
    return write_ui_patch(space.root, patch, base_revision, space.own_writes, space._lock)
