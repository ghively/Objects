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

Task 1 gives the names and signatures; Task 3 fills the bodies.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from .jsonstore import JsonStore
from .typemodel import PropertyDefinition, TypeDefinition

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
        raise NotImplementedError


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
    """The type's synced properties, in the type's order ([] for None)."""
    raise NotImplementedError


def is_stale(refreshed_at: str | None, stale_after_days: int, now: datetime) -> bool:
    """Whether ``now - refreshed_at`` is more than `stale_after_days` days (False for None)."""
    raise NotImplementedError


def norm(text: str) -> str:
    """`text` stripped, inner whitespace collapsed to one space, case-folded."""
    raise NotImplementedError


def find_matches(
    candidates: Sequence[Candidate], by: MatchBy, value: str, key: str | None
) -> list[Candidate]:
    """The candidates whose title, alias or `key` property equals `value` after `norm`."""
    raise NotImplementedError


def check_match(t: TypeDefinition, by: str, value: Any, key: Any) -> str | None:
    """The ``invalid`` detail of a match, or None when it is well formed."""
    raise NotImplementedError


def encode_facts(t: TypeDefinition, values: dict[str, Any]) -> dict[str, Any]:
    """`values` (API form) in front-matter form, as plain JSON; raises `InvalidValue`."""
    raise NotImplementedError


class SyncedStore:
    """``.object/synced/<typeId>.json``, one file per type, keyed by object id."""

    def __init__(self, store: JsonStore) -> None:
        self._store = store

    def data(self, type_id: str) -> dict[str, Any]:
        """The type's whole file ({} when there is none, or it isn't readable); cached by the
        file's ``(mtime_ns, size)``."""
        raise NotImplementedError

    def entry(self, type_id: str, object_id: str | None) -> SyncedEntry | None:
        """One object's entry, or None (no id, no entry)."""
        raise NotImplementedError

    def overlay(self, t: TypeDefinition | None, fm: dict) -> dict:
        """A shallow copy of `fm` whose synced keys hold the store's values (a key the store
        has no value for is removed; without an ``id`` every synced key is); `fm` itself when
        `t` has no synced properties."""
        raise NotImplementedError

    def apply(self, type_id: str, updates: dict[str, dict[str, Any]], refreshed_at: str) -> str:
        """Merge `updates` (``None`` removes a key) per object and key, stamp each object in it
        with `refreshed_at`, write once; return the new revision. Raises `ReadOnly` (the file
        isn't readable) and `RevisionConflict`."""
        raise NotImplementedError
