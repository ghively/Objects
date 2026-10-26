"""Definition files in ``.object/``: collections, queries and per-type views.

Each lives in ``.object/<folder>/<id>.json`` (JSON, ``indent=2``,
``ensure_ascii=False``, LF, trailing newline). Unknown keys are the caller's to
keep: `JsonStore.write` writes exactly the dict it is given. A file that isn't
valid JSON is never rewritten (`DefinitionUnreadable` on read, `ReadOnly` on
write). Writes are atomic, checked against the revision the caller edited, and
recorded in ``own_writes`` so the watcher stays silent about them.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .textfile import atomic_write
from .typedefs import slug
from .typemodel import RevisionConflict, TypeDefinition

__all__ = [
    "DefinitionUnreadable",
    "JsonStore",
    "default_views",
    "dump_json",
    "json_revision",
]

_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_MEDIA_GRID_TYPES = frozenset({"image", "weblink", "tweet"})


class DefinitionUnreadable(Exception):
    """A definition file exists but isn't a readable JSON object."""

    def __init__(self, path: Path | str, error: str) -> None:
        super().__init__(f"{path}: {error}")
        self.path = path
        self.error = error


def _read_only(reason: str) -> Exception:
    from .space import ReadOnly  # space imports changetype, which imports uistate

    return ReadOnly(reason)


def json_revision(path: Path) -> str:
    """sha256 of the file's bytes, ``''`` when it doesn't exist (same as `version_of`)."""
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    except (FileNotFoundError, NotADirectoryError):
        return ""


def dump_json(data: Any) -> bytes:
    return (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def parse_json_object(data: bytes) -> dict[str, Any]:
    """The JSON object in `data`; raises `ValueError` when it is anything else."""
    value = json.loads(data.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("not a JSON object")
    return value


class JsonStore:
    """The ``.object/<folder>/`` definition files of one kind."""

    def __init__(
        self,
        root: Path,
        folder: str,
        own_writes: dict[str, str],
        trash_ids: Callable[[], set[str]] = lambda: set(),
        lock: threading.RLock | None = None,
    ) -> None:
        self.root = Path(root)
        self.folder = folder
        self.own_writes = own_writes
        self.trash_ids = trash_ids
        self._lock = lock or threading.RLock()

    @property
    def dir(self) -> Path:
        return self.root / ".object" / self.folder

    def rel(self, id: str) -> str:
        return f".object/{self.folder}/{id}.json"

    def path(self, id: str) -> Path:
        if not _ID_RE.match(id) or id.endswith("."):
            raise ValueError(f"Invalid definition id {id!r}")
        return self.dir / f"{id}.json"

    def revision(self, id: str) -> str:
        return json_revision(self.path(id))

    def _load(self, path: Path) -> tuple[dict[str, Any] | None, str, str | None]:
        """(data, revision, error) of one file; data is None when missing or unreadable."""
        try:
            raw = path.read_bytes()
        except (FileNotFoundError, NotADirectoryError):
            return None, "", None
        revision = hashlib.sha256(raw).hexdigest()
        try:
            return parse_json_object(raw), revision, None
        except (ValueError, UnicodeDecodeError) as exc:
            return None, revision, f"Not a valid JSON object: {exc}"

    def read(self, id: str) -> tuple[dict[str, Any] | None, str]:
        """(data, revision); ``(None, '')`` when missing. Raises `DefinitionUnreadable`."""
        path = self.path(id)
        data, revision, error = self._load(path)
        if error is not None:
            raise DefinitionUnreadable(path, error)
        return data, revision

    def list(self) -> list[tuple[str, dict[str, Any] | None, str, str | None]]:
        """``(id, data, revision, error)`` for every ``*.json`` file, sorted by id."""
        out = []
        try:
            files = sorted(p for p in self.dir.glob("*.json") if p.is_file())
        except OSError:
            return []
        for p in files:
            if not _ID_RE.match(p.stem):
                continue
            data, revision, error = self._load(p)
            out.append((p.stem, data, revision, error))
        return out

    def new_id(self, name: str) -> str:
        """``slug(name)``, made unique with ``-2``, ``-3``... against live and trashed ids."""
        base = slug(name)
        taken = {i.lower() for i, *_ in self.list()} | {t.lower() for t in self.trash_ids()}
        candidate, n = base, 1
        while candidate.lower() in taken:
            n += 1
            candidate = f"{base}-{n}"
        return candidate

    def write(self, id: str, data: dict[str, Any], base_revision: str) -> str:
        """Write `data` if the file is still at `base_revision` (``''`` = no file); return the new revision.

        Raises `RevisionConflict` (stale) or `ReadOnly` (the file holds invalid JSON).
        """
        path = self.path(id)
        rel = self.rel(id)
        with self._lock:
            _old, current, error = self._load(path)
            if error is not None:
                raise _read_only(error)
            if current != (base_revision or ""):
                raise RevisionConflict(current)
            payload = dump_json(data)
            revision = hashlib.sha256(payload).hexdigest()
            path.parent.mkdir(parents=True, exist_ok=True)
            previous = self.own_writes.get(rel)
            self.own_writes[rel] = revision
            try:
                atomic_write(path, payload)
            except BaseException:
                if previous is None:
                    self.own_writes.pop(rel, None)
                else:
                    self.own_writes[rel] = previous
                raise
            return revision

    def remove(self, id: str) -> None:
        """Delete the file (the watcher's ``deleted`` is suppressed). A missing file is fine."""
        path = self.path(id)
        rel = self.rel(id)
        with self._lock:
            self.own_writes[rel] = ""
            try:
                path.unlink()
            except FileNotFoundError:
                self.own_writes.pop(rel, None)
            except BaseException:
                self.own_writes.pop(rel, None)
                raise


def _empty_filter_group() -> dict[str, Any]:
    return {"type": "filterGroup", "operator": "and", "elements": []}


def default_views(t: TypeDefinition) -> dict[str, Any]:
    """The Views of a type page that has none saved yet."""
    layout = "grid" if t.basic and t.name.lower() in _MEDIA_GRID_TYPES else "list"
    keys = ["recentlyAccessed", "collections", "queries", "inNoCollection"]
    if any(p.key == "tags" for p in t.propertyDefinitions):
        keys.append("notTagged")
    return {
        "activeTab": "all",
        "all": {
            "viewDefinition": {"dataViewLayout": layout},
            "filterGroup": _empty_filter_group(),
            "sorts": [],
            "groupBy": None,
        },
        "dashboard": {
            "sections": [{"key": k, "collapsed": False} for k in keys],
            "removedSections": [],
        },
    }
