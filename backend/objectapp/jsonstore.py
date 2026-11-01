"""Definition files in ``.capacities/``: collections, queries and per-type views.

Each lives in ``.capacities/<folder>/<id>.json`` (JSON, ``indent=2``,
``ensure_ascii=False``, LF, trailing newline). Unknown keys are the caller's to
keep: `JsonStore.write` writes exactly the dict it is given. A file that isn't
valid JSON is never rewritten (`DefinitionUnreadable` on read, `ReadOnly` on
write). Writes are atomic, checked against the revision the caller edited, and
recorded in ``own_writes`` so the watcher stays silent about them.
"""

from __future__ import annotations

import copy
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
    "normalize_views",
]

# A definition id names a file: a letter or digit (any script, so `slug` of a non-Latin
# name is accepted) then up to 99 word characters, dots or dashes; `path` also refuses a
# trailing dot. `typedefs.slug` never makes an id this rejects.
_ID_RE = re.compile(r"^[^\W_][\w.-]{0,99}$")
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
    """The ``.capacities/<folder>/`` definition files of one kind."""

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
        return self.root / ".capacities" / self.folder

    def rel(self, id: str) -> str:
        return f".capacities/{self.folder}/{id}.json"

    def path(self, id: str) -> Path:
        if not _ID_RE.match(id) or id.endswith("."):
            raise ValueError(f"Invalid definition id {id!r}")
        return self.dir / f"{id}.json"

    def revision(self, id: str) -> str:
        return json_revision(self.path(id))

    def _load(
        self, path: Path, known: str | None = None
    ) -> tuple[dict[str, Any] | None, str, str | None]:
        """(data, revision, error) of one file; data is None when missing or unreadable.

        A file whose revision is ``known`` is not parsed (data and error None).
        """
        try:
            raw = path.read_bytes()
        except (FileNotFoundError, NotADirectoryError):
            return None, "", None
        revision = hashlib.sha256(raw).hexdigest()
        if known is not None and revision == known:
            return None, revision, None
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

    def list(
        self, known: dict[str, str] | None = None
    ) -> list[tuple[str, dict[str, Any] | None, str, str | None]]:
        """``(id, data, revision, error)`` for every ``*.json`` file, sorted by id.

        ``known`` maps ids to the revision the caller already holds parsed: such a file
        is read and hashed but not parsed (its data and error are None).
        """
        known = known or {}
        out = []
        try:
            files = sorted(p for p in self.dir.glob("*.json") if p.is_file())
        except OSError:
            return []
        for p in files:
            if not _ID_RE.match(p.stem):
                continue
            data, revision, error = self._load(p, known.get(p.stem))
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

            def unchanged() -> None:
                # Re-check right before the replace: an external edit since the
                # read above is a conflict, never overwritten.
                now = self._load(path)[1]
                if now != current:
                    raise RevisionConflict(now)

            try:
                atomic_write(path, payload, check=unchanged)
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
    """The Views of a type page that has none saved yet.

    Capacities' initial built-in sections (``builtInDashboardSections``): Recently Opened,
    Collections and Queries, with the "All" tab. "Not in any collection" and "Not tagged" are
    not initial; "Add a section" offers them. Saved views are never rewritten to match.
    """
    layout = "grid" if t.basic and t.name.lower() in _MEDIA_GRID_TYPES else "list"
    keys = ["recentlyAccessed", "collections", "queries"]
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


def _view_of(stored: Any, default: dict[str, Any]) -> dict[str, Any]:
    """One stored view (``all`` or a section) over its default; unknown keys kept."""
    out = {**copy.deepcopy(default), **stored} if isinstance(stored, dict) else copy.deepcopy(default)
    vd = out.get("viewDefinition")
    out["viewDefinition"] = (
        {**default["viewDefinition"], **vd} if isinstance(vd, dict) else copy.deepcopy(default["viewDefinition"])
    )
    if not isinstance(out.get("filterGroup"), dict) or not isinstance(
        out["filterGroup"].get("elements"), list
    ):
        out["filterGroup"] = _empty_filter_group()
    if not isinstance(out.get("sorts"), list):
        out["sorts"] = []
    if "groupBy" in out and out["groupBy"] is not None and not isinstance(out["groupBy"], dict):
        out["groupBy"] = None
    return out


def _is_section(s: Any) -> bool:
    return isinstance(s, dict) and isinstance(s.get("key"), str) and bool(s["key"])


def _section_of(s: dict[str, Any]) -> dict[str, Any]:
    out = {**s, "collapsed": bool(s.get("collapsed", False))}
    if "viewDefinition" in out and not isinstance(out["viewDefinition"], dict):
        del out["viewDefinition"]
    return out


def normalize_views(stored: Any, defaults: dict[str, Any]) -> dict[str, Any]:
    """Stored Views deep-merged over ``defaults`` so every key the UI reads is there.

    Fills ``activeTab``, ``all`` (with ``viewDefinition``, ``filterGroup``, ``sorts``)
    and ``dashboard`` (``sections``, ``removedSections``); drops sections that aren't
    objects with a string ``key``. Unknown keys are kept. Read-only: the file is not
    rewritten.
    """
    if not isinstance(stored, dict):
        return copy.deepcopy(defaults)
    out = {**copy.deepcopy(defaults), **copy.deepcopy(stored)}
    if not isinstance(out.get("activeTab"), str) or not out["activeTab"]:
        out["activeTab"] = defaults["activeTab"]
    out["all"] = _view_of(stored.get("all"), defaults["all"])
    dash = stored.get("dashboard")
    dash = dict(dash) if isinstance(dash, dict) else {}
    sections = dash.get("sections")
    if isinstance(sections, list):
        dash["sections"] = [_section_of(s) for s in sections if _is_section(s)]
    else:
        dash["sections"] = copy.deepcopy(defaults["dashboard"]["sections"])
    removed = dash.get("removedSections")
    dash["removedSections"] = [r for r in removed if isinstance(r, str)] if isinstance(removed, list) else []
    out["dashboard"] = dash
    return out
