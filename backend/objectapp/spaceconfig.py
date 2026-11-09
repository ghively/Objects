"""``.object/space.json``: the space's name, icon, description, "hide task management" and
(M22) the Jira site that makes a Jira ticket's browse link.

Absent file = the folder name and defaults; reading never creates or changes it.
A patch writes only the patched keys over what the file already holds (unknown
keys are kept), atomically and against the revision the caller edited. A file
that exists but is not a JSON object is never replaced (`ReadOnly`, 423).
"""

from __future__ import annotations

import hashlib
import re
import threading
from pathlib import Path
from typing import Any

from .jsonstore import dump_json, parse_json_object
from .textfile import atomic_write
from .typemodel import RevisionConflict

__all__ = [
    "JIRA_SITE_PROBLEM",
    "MAX_JIRA_SITE_LENGTH",
    "MAX_NAME_LENGTH",
    "INTERNAL_KEYS",
    "PATCH_KEYS",
    "SPACE_REL",
    "SpaceConfigProblem",
    "patch",
    "read",
    "ensure_space_id",
    "set_internal",
    "space_fields",
    "space_id",
]

SPACE_REL = ".object/space.json"
MAX_NAME_LENGTH = 120
PATCH_KEYS = ("name", "icon", "description", "hideTaskManagement", "jiraSite")
INTERNAL_KEYS = ("deskSyncRuleId", "spaceId")
"""M24: keys Object keeps in ``space.json`` for itself; never in `PATCH_KEYS`, never in `space_fields`.
``spaceId`` (2026-11-08): the space's stable id (`space_id`), which keys its version history and
its version-control settings, so moving or renaming the folder keeps both."""
_SPACE_ID_RE = re.compile(r"^[0-9a-f]{32}$")
MAX_JIRA_SITE_LENGTH = 300
JIRA_SITE_PROBLEM = "The Jira site is a web address (https://…)."
_WEB_ADDRESS = re.compile(r"https?://\S+", re.IGNORECASE)

_lock = threading.RLock()


class SpaceConfigProblem(ValueError):
    """A ``PUT /api/space`` patch has an unknown key or a value of the wrong shape (422).

    The default text is the bad-value sentence; `_checked` passes the unknown-key one for a
    key that is not a setting at all (review 2026-11-08, NIT 7).
    """

    def __init__(self, key: str, message: str | None = None) -> None:
        text = message or f"The setting \"{key}\" can't be saved."
        super().__init__(text)
        self.key = key
        self.message = text


def _path(root: Path) -> Path:
    return Path(root) / ".object" / "space.json"


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
    """The ``SpaceInfo`` fields from ``space.json``: name, icon, description, hideTaskManagement,
    jiraSite (null when absent or not a web address), revision."""
    data, revision, _error = read(root)
    name = data.get("name")
    icon = data.get("icon")
    description = data.get("description")
    return {
        "name": name.strip() if isinstance(name, str) and name.strip() else Path(root).name,
        "icon": icon if isinstance(icon, str) else None,
        "description": description if isinstance(description, str) else None,
        "hideTaskManagement": data.get("hideTaskManagement") is True,
        "jiraSite": data.get("jiraSite") if _jira_site_ok(data.get("jiraSite")) else None,
        "revision": revision,
    }


def _jira_site_ok(value: Any) -> bool:
    """A Jira site: an ``http(s)://`` address of at most 300 characters (None is not one)."""
    return (
        isinstance(value, str)
        and len(value) <= MAX_JIRA_SITE_LENGTH
        and _WEB_ADDRESS.fullmatch(value) is not None
    )


def _checked(patch_: dict[str, Any]) -> dict[str, Any]:
    """`patch_` with ``name`` trimmed; raises `SpaceConfigProblem`."""
    if not isinstance(patch_, dict):
        raise SpaceConfigProblem("patch", "The patch must be an object.")
    out: dict[str, Any] = {}
    for key, value in patch_.items():
        if key not in PATCH_KEYS:
            raise SpaceConfigProblem(key, f'There is no setting named "{key}".')
        if key == "name":
            if not isinstance(value, str) or not value.strip():
                raise SpaceConfigProblem(key, "A space needs a name.")
            value = value.strip()
            if len(value) > MAX_NAME_LENGTH:
                raise SpaceConfigProblem(
                    key, f"A space name can have at most {MAX_NAME_LENGTH} characters."
                )
        elif key == "jiraSite":
            if value is not None and not _jira_site_ok(value):
                raise SpaceConfigProblem(key, JIRA_SITE_PROBLEM)
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

        def unchanged() -> None:
            # An external edit since the read above is a conflict, never overwritten.
            now = read(root)[1]
            if now != current:
                raise RevisionConflict(now)

        atomic_write(path, payload, check=unchanged)
        return data, hashlib.sha256(payload).hexdigest()


def set_internal(root: Path, key: str, value: str) -> str:
    """Set one internal key (`INTERNAL_KEYS`) in ``space.json``, keeping every other key; return the
    new revision. Atomic. Raises `ValueError` for another key and `ReadOnly` (423) for an
    unreadable file, which is left as it is."""
    from .space import ReadOnly  # space imports this module

    if key not in INTERNAL_KEYS:
        raise ValueError(f"{key} isn't an internal key.")
    path = _path(root)
    with _lock:
        data, current, error = read(root)
        if error is not None:
            raise ReadOnly(error)
        data = {**data, key: value}
        payload = dump_json(data)
        path.parent.mkdir(parents=True, exist_ok=True)

        def unchanged() -> None:
            now = read(root)[1]
            if now != current:
                raise RevisionConflict(now)

        atomic_write(path, payload, check=unchanged)
        return hashlib.sha256(payload).hexdigest()


def space_id(root: Path) -> str | None:
    """The space's stable id from ``space.json`` (``spaceId``), or None when it has none yet.
    Reads only."""
    value = read(root)[0].get("spaceId")
    return value if isinstance(value, str) and _SPACE_ID_RE.match(value) else None


def ensure_space_id(root: Path, wanted: str | None = None, create: bool = True) -> str | None:
    """The space's id, written to ``space.json`` (every other key kept) when it has none.

    Called only by a write the user made: turning on version control, or the next app write
    (the history snapshot), never by opening a space. `wanted` puts a known id back (a restore
    to a commit from before the id existed). Without `create` a space that has no ``space.json``
    yet is left as it is (None): an ordinary edit never adds a file to the space. Raises
    `ReadOnly` for an unreadable ``space.json``.
    """
    import uuid

    with _lock:
        current = space_id(root)
        if current is not None and (wanted is None or wanted == current):
            return current
        if not create and not _path(root).is_file():
            return None
        new = wanted if wanted and _SPACE_ID_RE.match(wanted) else uuid.uuid4().hex
        set_internal(root, "spaceId", new)
        return new
