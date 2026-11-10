"""Synced facts (M29): property values filled only by a script or agent, never stored in a ``.md``.

A property marked ``synced`` (`typemodel.SyncedSpec`) is filled through ``/api/v1`` (a
``read-write`` or ``sync`` token, ``POST /api/v1/synced/{typeId}``) or the MCP tool
``sync_facts``. Its values live in ``.object/synced/<typeId>.json``, one file per type, of the
shape ``{objectId: {"values": {key: value}, "refreshedAt": "YYYY-MM-DDTHH:MM:SS.sssZ"}}``; each
``value`` is the front-matter form `propvalues.encode_value` gives (a string, number, boolean or
list of strings). The app shows them read-only, with their source and how long ago they were
refreshed (plan ``2026-11-09-m29-synced-facts-and-type-suggestion.md``, Contract).

`SyncedStore` is the store (a `JsonStore` over ``.object/synced/``); the functions are pure
helpers (matching, encoding, staleness). `Space` overlays the store's values onto the in-memory
front matter wherever values are decoded and runs a sync (`Space.sync_facts`).
"""

from __future__ import annotations

import copy
import hashlib
from collections.abc import Sequence
from dataclasses import dataclass, fields
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, get_args

from . import jsonstore
from .jsonstore import JsonStore
from .propvalues import InvalidValue, encode_value, label_lookup
from .typemodel import SYNCABLE_KINDS, PropertyDefinition, TypeDefinition

__all__ = [
    "FOLDER",
    "MAX_ITEMS",
    "MAX_MATCH_VALUE",
    "SYNCED_READ_ONLY",
    "Candidate",
    "ItemResult",
    "ItemStatus",
    "MatchBy",
    "SyncOutcome",
    "SyncedEntry",
    "SyncedStore",
    "check_match",
    "encode_facts",
    "find_matches",
    "is_stale",
    "norm",
    "synced_props",
]

FOLDER = "synced"
"""The store's folder under ``.object/``."""
MAX_ITEMS = 1000
"""Items per sync call."""
MAX_MATCH_VALUE = 300
"""Characters of a match value."""

SYNCED_READ_ONLY = '"{name}" is filled by {source} and can\'t be edited.'
"""Our string: every write path other than a sync refuses a synced key (422)."""

MatchBy = Literal["title", "alias", "key"]
ItemStatus = Literal["updated", "notFound", "ambiguous", "invalid"]

_BY = get_args(MatchBy)
_KEY_KINDS = frozenset({"text", "url"})
"""The kinds a ``key`` match may name (and `Candidate.keys` holds)."""
_DATE_KINDS = frozenset({"datetime", "datetimeSimple"})


@dataclass(frozen=True)
class SyncedEntry:
    """One object's synced values (front-matter form) and when they were last refreshed."""

    values: dict[str, Any]
    refreshedAt: str


@dataclass(frozen=True)
class Candidate:
    """One object of the type, as matching sees it."""

    path: str
    objectId: str | None
    title: str
    aliases: tuple[str, ...]
    keys: dict[str, str]
    """Text and URL property key -> its decoded value."""


@dataclass
class ItemResult:
    """The outcome of one sync item, in the item's order."""

    index: int
    status: ItemStatus
    path: str | None = None
    objectId: str | None = None
    paths: list[str] | None = None
    """``ambiguous`` only: every matching path."""
    detail: str | None = None

    def to_api(self) -> dict[str, Any]:
        """The result as the route answers it, with the ``None`` fields left out."""
        out: dict[str, Any] = {}
        for f in fields(self):
            value = getattr(self, f.name)
            if value is not None:
                out[f.name] = list(value) if isinstance(value, list) else value
        return out


@dataclass
class SyncOutcome:
    """What one `Space.sync_facts` call did."""

    typeId: str
    refreshedAt: str
    revision: str
    results: list[ItemResult]
    idWrites: list[tuple[str, str]]
    """(path, new version) of the objects that got their ``id`` on this sync."""


def synced_props(t: TypeDefinition | None) -> list[PropertyDefinition]:
    """The type's synced properties, in the type's order ([] for None).

    A synced mark on a kind that can't be synced (only a hand-edited type file has one: a
    type save refuses it) is inert, so that property's front-matter value shows as before.
    """
    if t is None:
        return []
    return [p for p in t.propertyDefinitions if p.synced is not None and p.type in SYNCABLE_KINDS]


def _parse_iso(text: str | None) -> datetime | None:
    if not isinstance(text, str) or not text.strip():
        return None
    try:
        dt = datetime.fromisoformat(text.strip())
    except ValueError:
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def is_stale(refreshed_at: str | None, stale_after_days: int, now: datetime) -> bool:
    """Whether ``now - refreshed_at`` is more than `stale_after_days` days (False for None)."""
    at = _parse_iso(refreshed_at)
    if at is None:
        return False
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    return now - at > timedelta(days=stale_after_days)


def norm(text: str) -> str:
    """`text` stripped, inner whitespace collapsed to one space, case-folded."""
    return " ".join(text.split()).casefold()


def find_matches(
    candidates: Sequence[Candidate], by: MatchBy, value: str, key: str | None
) -> list[Candidate]:
    """The candidates whose title, alias or `key` property equals `value` after `norm`."""
    wanted = norm(value)
    if not wanted:
        return []
    if by == "title":
        return [c for c in candidates if norm(c.title) == wanted]
    if by == "alias":
        return [c for c in candidates if any(norm(a) == wanted for a in c.aliases)]
    if by == "key" and key:
        return [c for c in candidates if key in c.keys and norm(c.keys[key]) == wanted]
    return []


def check_match(t: TypeDefinition, by: str, value: Any, key: Any) -> str | None:
    """The ``invalid`` detail of a match, or None when it is well formed.

    ``key`` is read for ``by == "key"`` only. A key that is itself synced is named as such
    (whatever its kind); any other key must be a text or URL property of the type.
    """
    if not isinstance(by, str) or by not in _BY:
        return '"by" must be title, alias or key.'
    if not isinstance(value, str) or not value.strip() or len(value) > MAX_MATCH_VALUE:
        return f'"value" must be 1-{MAX_MATCH_VALUE} characters.'
    if by != "key":
        return None
    pdef = t.prop(key) if isinstance(key, str) and key else None
    if pdef is not None and pdef.synced is not None:
        return f'"{key}" is synced: match by a property the script doesn\'t fill.'
    if pdef is None or pdef.type not in _KEY_KINDS:
        return f'Matching by key needs "key": a text or URL property of {t.name}.'
    return None


def _plain(value: Any) -> Any:
    """`encode_value`'s output as plain JSON (its ruamel scalars and flow lists unwrapped)."""
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return float(value)
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return str(value)


def encode_facts(t: TypeDefinition, values: dict[str, Any]) -> dict[str, Any]:
    """`values` (API form) in front-matter form, as plain JSON; raises `InvalidValue`.

    ``None`` stays ``None`` (the store removes that key). A date may also be sent as one ISO
    text (its start). A label value must be one of the property's options (a sync never
    edits the type).
    """
    allowed = {p.key: p for p in synced_props(t)}
    out: dict[str, Any] = {}
    for key, value in values.items():
        pdef = allowed.get(key)
        if pdef is None:
            raise InvalidValue(f'"{key}" isn\'t a synced property of {t.name}.')
        if value is None:
            out[key] = None
            continue
        if pdef.type in _DATE_KINDS and isinstance(value, str):
            value = {"start": value}
        if pdef.type == "label":
            texts = [value] if isinstance(value, str) else value if isinstance(value, list) else []
            for text in texts:
                if isinstance(text, str) and text.strip() and label_lookup(pdef, text) is None:
                    raise InvalidValue(f'"{text.strip()}" isn\'t an option of {pdef.name}.')
        out[key] = _plain(encode_value(pdef, value))
    return out


class SyncedStore:
    """``.object/synced/<typeId>.json``, one file per type, keyed by object id."""

    def __init__(self, store: JsonStore) -> None:
        self._store = store
        self._cache: dict[str, tuple[tuple[int, int], dict[str, Any]]] = {}

    def _read(self, type_id: str) -> tuple[dict[str, Any] | None, str]:
        """(data, revision) of the file as it is now: ``({}, '')`` when there is none, data
        None when it isn't a JSON object. Read directly (no key upgrades: the values are the
        user's own)."""
        try:
            raw = self._store.path(type_id).read_bytes()
        except (FileNotFoundError, NotADirectoryError):
            return {}, ""
        revision = hashlib.sha256(raw).hexdigest()
        try:
            return jsonstore.parse_json_object(raw), revision
        except (ValueError, UnicodeDecodeError):
            return None, revision

    def data(self, type_id: str) -> dict[str, Any]:
        """The type's whole file ({} when there is none, or it isn't readable); cached by the
        file's ``(mtime_ns, size)``. The caller must not change what it is given."""
        try:
            path = self._store.path(type_id)
            st = path.stat()
        except (ValueError, OSError):
            self._cache.pop(type_id, None)
            return {}
        stamp = (st.st_mtime_ns, st.st_size)
        cached = self._cache.get(type_id)
        if cached is not None and cached[0] == stamp:
            return cached[1]
        data = self._read(type_id)[0] or {}
        self._cache[type_id] = (stamp, data)
        return data

    def entry(self, type_id: str, object_id: str | None) -> SyncedEntry | None:
        """One object's entry, or None (no id, no entry)."""
        if not object_id:
            return None
        raw = self.data(type_id).get(object_id)
        if not isinstance(raw, dict) or not isinstance(raw.get("values"), dict):
            return None
        at = raw.get("refreshedAt")
        return SyncedEntry(values=dict(raw["values"]), refreshedAt=at if isinstance(at, str) else "")

    def overlay(self, t: TypeDefinition | None, fm: dict) -> dict:
        """A shallow copy of `fm` whose synced keys hold the store's values (a key the store
        has no value for is removed; without an ``id`` every synced key is); `fm` itself when
        `t` has no synced properties."""
        props = synced_props(t)
        if t is None or not props:
            return fm
        out = dict(fm)
        for p in props:
            out.pop(p.key, None)
        raw_id = fm.get("id")
        object_id = (
            None if raw_id is None or isinstance(raw_id, (dict, list)) else str(raw_id).strip()
        )
        entry = self.entry(t.id, object_id)
        if entry is not None:
            for p in props:
                value = entry.values.get(p.key)
                if value is not None:
                    out[p.key] = value
        return out

    def apply(self, type_id: str, updates: dict[str, dict[str, Any]], refreshed_at: str) -> str:
        """Merge `updates` (``None`` removes a key) per object and key, stamp each object in it
        with `refreshed_at`, write once; return the new revision. Raises `ReadOnly` (the file
        isn't readable) and `RevisionConflict`."""
        from .space import ReadOnly  # space imports this module

        with self._store._lock:
            current, revision = self._read(type_id)
            if current is None:
                raise ReadOnly(f"{self._store.rel(type_id)} is not a valid JSON object.")
            data = copy.deepcopy(current)
            for object_id, changes in updates.items():
                old = data.get(object_id)
                values = (
                    dict(old["values"])
                    if isinstance(old, dict) and isinstance(old.get("values"), dict)
                    else {}
                )
                for key, value in changes.items():
                    if value is None:
                        values.pop(key, None)
                    else:
                        values[key] = value
                data[object_id] = {"values": values, "refreshedAt": refreshed_at}
            self._cache.pop(type_id, None)
            return self._store.write(type_id, data, revision)
