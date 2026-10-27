"""The spaces registry (``<state dir>/spaces.json``) and creating a new space.

The registry lists the space folders this device has opened, in the order they
were first registered, with when each was last opened::

    {"spaces": [{"path": "...", "lastOpened": "2026-10-27T09:00:00Z"}], "lastOpened": "..."}

It holds no user content: an unreadable file reads as empty and is replaced on
the next write. Reading never writes. Removing a space only drops it from the
list; its folder is never touched. `create_space` makes a new folder holding only
``.capacities/space.json`` and refuses a folder that already exists.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .jsonstore import dump_json
from .space import safe_filename
from .spaceconfig import MAX_NAME_LENGTH, space_fields
from .textfile import atomic_write

__all__ = [
    "REGISTRY_FILE",
    "Registry",
    "SpaceEntry",
    "SpaceNameProblem",
    "create_space",
    "normalize",
]

REGISTRY_FILE = "spaces.json"

_lock = threading.RLock()


class SpaceNameProblem(ValueError):
    """A new space's name is empty or too long (422)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass
class SpaceEntry:
    path: str
    name: str
    icon: str | None
    current: bool
    missing: bool
    lastOpened: str | None


def normalize(path: Path | str) -> Path:
    """The absolute, resolved form of `path` (``~`` expanded) the registry stores."""
    return Path(os.path.expanduser(str(path))).resolve()


def _key(path: Path | str) -> str:
    """A comparison key: case-insensitive where the file system is (Windows)."""
    return os.path.normcase(str(path))


def _iso(now: datetime | str | None) -> str:
    if isinstance(now, str):
        return now
    moment = now or datetime.now(UTC)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class Registry:
    """``<state_dir>/spaces.json``. Created lazily, by `register` and `remove` only."""

    def __init__(self, state_dir: Path) -> None:
        self.state_dir = Path(state_dir)
        self.path = self.state_dir / REGISTRY_FILE

    # -- reading (never writes) -------------------------------------------------

    def _load(self) -> dict[str, Any]:
        """``{"spaces": [{path, lastOpened}], "lastOpened": str | None}``; empty when unreadable."""
        try:
            data = json.loads(self.path.read_bytes().decode("utf-8"))
        except (OSError, ValueError, UnicodeDecodeError):
            return {"spaces": [], "lastOpened": None}
        if not isinstance(data, dict):
            return {"spaces": [], "lastOpened": None}
        spaces: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in data.get("spaces") or []:
            if not isinstance(item, dict) or not isinstance(item.get("path"), str):
                continue
            if not item["path"] or _key(item["path"]) in seen:
                continue
            seen.add(_key(item["path"]))
            opened = item.get("lastOpened")
            spaces.append(
                {"path": item["path"], "lastOpened": opened if isinstance(opened, str) else None}
            )
        last = data.get("lastOpened")
        return {"spaces": spaces, "lastOpened": last if isinstance(last, str) and last else None}

    def _save(self, data: dict[str, Any]) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        atomic_write(self.path, dump_json(data))

    def list(self, current: Path | str | None = None) -> list[SpaceEntry]:
        """Every registered space in registry order, `current` flagged (and listed even if unregistered)."""
        data = self._load()
        items = list(data["spaces"])
        current_key = _key(normalize(current)) if current is not None else None
        if current_key is not None and all(_key(i["path"]) != current_key for i in items):
            items.append({"path": str(normalize(current)), "lastOpened": None})
        out: list[SpaceEntry] = []
        for item in items:
            root = Path(item["path"])
            missing = not root.is_dir()
            fields = space_fields(root) if not missing else None
            out.append(
                SpaceEntry(
                    path=item["path"],
                    name=fields["name"] if fields else root.name or item["path"],
                    icon=fields["icon"] if fields else None,
                    current=current_key is not None and _key(item["path"]) == current_key,
                    missing=missing,
                    lastOpened=item["lastOpened"],
                )
            )
        return out

    def last_opened(self) -> Path | None:
        """The space opened most recently, or None (whether or not its folder still exists)."""
        last = self._load()["lastOpened"]
        return Path(last) if last else None

    # -- writing ----------------------------------------------------------------

    def register(
        self, path: Path | str, now: datetime | str | None = None, *, touch: bool = True
    ) -> None:
        """Add `path` (or refresh its ``lastOpened``) and make it the registry's ``lastOpened``.

        ``touch=False`` only adds the entry (with no ``lastOpened``) when it is not
        listed yet: nothing was opened, so neither timestamp moves.
        """
        root = str(normalize(path))
        stamp = _iso(now) if touch else None
        with _lock:
            data = self._load()
            for item in data["spaces"]:
                if _key(item["path"]) == _key(root):
                    if not touch:
                        return
                    item["lastOpened"] = stamp
                    break
            else:
                data["spaces"].append({"path": root, "lastOpened": stamp})
            if touch:
                data["lastOpened"] = root
            self._save(data)

    def remove(self, path: Path | str) -> None:
        """Drop `path` from the list. Its folder is left exactly as it is."""
        key = _key(normalize(path))
        with _lock:
            data = self._load()
            kept = [i for i in data["spaces"] if _key(i["path"]) != key]
            last = data["lastOpened"]
            if len(kept) == len(data["spaces"]) and not (last and _key(last) == key):
                return
            data["spaces"] = kept
            if last and _key(last) == key:
                data["lastOpened"] = None
            self._save(data)


def create_space(name: str, location: Path | str) -> Path:
    """Create ``<location>/<safe_filename(name)>`` holding only ``.capacities/space.json``.

    Raises `SpaceNameProblem` (422) for an empty or over-long name,
    `NotADirectoryError` (404) when `location` is not an existing folder and
    `FileExistsError` (409) when the target already exists (it is not touched).
    """
    if not isinstance(name, str) or not name.strip():
        raise SpaceNameProblem("A space needs a name.")
    name = name.strip()
    if len(name) > MAX_NAME_LENGTH:
        raise SpaceNameProblem(f"A space name can have at most {MAX_NAME_LENGTH} characters.")
    parent = normalize(location)
    if not parent.is_dir():
        raise NotADirectoryError(f"Not a folder: {parent}")
    target = parent / safe_filename(name)
    target.mkdir()  # FileExistsError when anything is already there
    (target / ".capacities").mkdir()
    atomic_write(target / ".capacities" / "space.json", dump_json({"name": name}))
    return target
