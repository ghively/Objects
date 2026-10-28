"""``.capacities/space.json``: the space's name, icon, description and "hide task management".

Absent file = the folder name and defaults; reading never creates or changes it.
A patch writes only the patched keys over what the file already holds (unknown
keys are kept), atomically and against the revision the caller edited. A file
that exists but is not a JSON object is never replaced (`ReadOnly`, 423).
"""

from __future__ import annotations

import hashlib
import threading
from pathlib import Path
from typing import Any

from .jsonstore import dump_json, parse_json_object
from .textfile import atomic_write
from .typemodel import RevisionConflict

__all__ = [
    "MAX_NAME_LENGTH",
    "PATCH_KEYS",
    "SPACE_REL",
    "SpaceConfigProblem",
    "patch",
    "read",
    "space_fields",
]

SPACE_REL = ".capacities/space.json"
MAX_NAME_LENGTH = 120
PATCH_KEYS = ("name", "icon", "description", "hideTaskManagement")

_lock = threading.RLock()


class SpaceConfigProblem(ValueError):
    """A ``PUT /api/space`` patch has an unknown key or a value of the wrong shape (422)."""

    def __init__(self, key: str, message: str | None = None) -> None:
        super().__init__(message or f"Cannot patch: {key}")
        self.key = key
        self.message = message or f"Cannot patch: {key}"


def _path(root: Path) -> Path:
    return Path(root) / ".capacities" / "space.json"


def read(root: Path) -> tuple[dict[str, Any], str, str | None]:
    """(data, revision, error): ``({}, '', None)`` when there is no file.

    An unreadable file gives ``({}, <its revision>, <why>)``. Never writes.
    """
    try:
        raw = _path(root).read_bytes()
    except (FileNotFoundError, NotADirectoryError):
        return {}, "", None
    except OSError as exc:
        return {}, "", f"space.json can't be read: {exc}"
    revision = hashlib.sha256(raw).hexdigest()
    try:
        return parse_json_object(raw), revision, None
    except (ValueError, UnicodeDecodeError) as exc:
        return {}, revision, f"space.json is not a valid JSON object: {exc}"


def space_fields(root: Path) -> dict[str, Any]:
    """The ``SpaceInfo`` fields from ``space.json``: name, icon, description, hideTaskManagement, revision."""
    data, revision, _error = read(root)
    name = data.get("name")
    icon = data.get("icon")
    description = data.get("description")
    return {
        "name": name.strip() if isinstance(name, str) and name.strip() else Path(root).name,
        "icon": icon if isinstance(icon, str) else None,
        "description": description if isinstance(description, str) else None,
        "hideTaskManagement": data.get("hideTaskManagement") is True,
        "revision": revision,
    }


def _checked(patch_: dict[str, Any]) -> dict[str, Any]:
    """`patch_` with ``name`` trimmed; raises `SpaceConfigProblem`."""
    if not isinstance(patch_, dict):
        raise SpaceConfigProblem("patch", "The patch must be an object.")
    out: dict[str, Any] = {}
    for key, value in patch_.items():
        if key not in PATCH_KEYS:
            raise SpaceConfigProblem(key)
        if key == "name":
            if not isinstance(value, str) or not value.strip():
                raise SpaceConfigProblem(key, "A space needs a name.")
            value = value.strip()
            if len(value) > MAX_NAME_LENGTH:
                raise SpaceConfigProblem(
                    key, f"A space name can have at most {MAX_NAME_LENGTH} characters."
                )
        elif key in ("icon", "description"):
            if value is not None and not isinstance(value, str):
                raise SpaceConfigProblem(key)
        elif not isinstance(value, bool):
            raise SpaceConfigProblem(key)
        out[key] = value
    return out


def patch(root: Path, patch: dict[str, Any], base_revision: str | None) -> tuple[dict[str, Any], str]:
    """Write the patched keys over ``space.json``; return (data, revision).

    Raises `SpaceConfigProblem` (422), `RevisionConflict` (409: the file is not at
    `base_revision`; a missing file's revision is ``''``) and `ReadOnly` (423: the
    file exists but is unreadable; it is left as it is). Writes nothing else.
    """
    from .space import ReadOnly  # space imports this module

    changes = _checked(patch)
    path = _path(root)
    with _lock:
        data, current, error = read(root)
        if error is not None:
            raise ReadOnly(error)
        if current != (base_revision or ""):
            raise RevisionConflict(current)
        data = {**data, **changes}
        payload = dump_json(data)
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, payload)
        return data, hashlib.sha256(payload).hexdigest()
