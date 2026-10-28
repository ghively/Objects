"""The per-user app state folder (outside every space).

It holds machine state that must never live in a space: M4's reminder ledgers,
the device settings (``settings.json``) and the spaces registry (``spaces.json``).

``OBJECT_STATE_DIR`` when set, else ``%LOCALAPPDATA%/object`` on Windows
(``~/AppData/Local/object`` when ``LOCALAPPDATA`` is unset), else
``$XDG_STATE_HOME/object``, else ``~/.local/state/object``. The folder is created
lazily, only by a writer; `state_dir` itself never touches the disk.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

__all__ = ["STATE_DIR_ENV", "state_dir"]

STATE_DIR_ENV = "OBJECT_STATE_DIR"


def state_dir() -> Path:
    """The state folder's path (not created here)."""
    override = os.environ.get(STATE_DIR_ENV)
    if override:
        return Path(override)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA")
        return (Path(base) if base else Path.home() / "AppData" / "Local") / "object"
    xdg = os.environ.get("XDG_STATE_HOME")
    return (Path(xdg) if xdg else Path.home() / ".local" / "state") / "object"
