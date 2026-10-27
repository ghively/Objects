"""Change an object's type: which types allow it, mapping suggestions, remembered choices.

`suggest_mapping` proposes, for each property value an object holds, the
property of the target type it should move to. Candidates are only the target
properties the value can be converted to (`propvalues.KIND_TRANSFORMS`, or the
same kind), and each target is used once. Matches score:

======================  ========
match                   priority
======================  ========
remembered              100
same system id          50
exact name              45
normalised name         40
case-insensitive name   35
same ``type``           20
same data type          15
======================  ========

Title, icon, description, tags, aliases and the timestamps always carry over,
so they are never rows. The user's last mapping for a pair of types is kept in
``.capacities/ui.json`` under ``changeTypePreferences`` and suggested next time.
The write itself is `Space.change_type`.
"""

from __future__ import annotations

import copy
import re
import threading
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .propvalues import KIND_TRANSFORMS, InvalidValue, convert_value
from .typedefs import SYSTEM_KEYS
from .typemodel import BASIC_MEDIA_TYPES, PropertyDefinition, TypeDefinition
from .uistate import _read as _read_ui
from .uistate import load_ui, write_ui_patch

__all__ = [
    "CARRIED_KEYS",
    "CHANGE_FROM_ALLOWED",
    "CHANGE_TO_ALLOWED",
    "MappingRow",
    "compatible",
    "load_ui",
    "save_change_type_preference",
    "suggest_mapping",
    "type_category",
]

CHANGE_FROM_ALLOWED = frozenset({"page", "custom", "task"})
"""Categories of types an object can be changed *from* (`type_category`)."""
CHANGE_TO_ALLOWED = frozenset({"page", "custom", "tag", "task"})
"""Categories of types an object can be changed *to*."""

CARRIED_KEYS = frozenset(
    {
        "id",
        "type",
        "template",
        "title",
        "icon",
        "iconColor",
        "description",
        "tags",
        "aliases",
        "collections",
        "createdAt",
        "lastUpdated",
    }
)
"""Keys that stay as they are on a type change (never mapping rows or targets)."""

_PREFS_KEY = "changeTypePreferences"

# Kinds that hold the same data, for the "same data type" match.
_DATA_TYPES = {
    "text": "string",
    "textBlock": "string",
    "url": "string",
    "blocks": "markdown",
    "simpleTableBlock": "markdown",
    "datetime": "date",
    "datetimeSimple": "date",
}

_NON_WORD_RE = re.compile(r"[\W_]+")


@dataclass(frozen=True)
class MappingRow:
    fromKey: str
    toKey: str | None
    """The target property's key, or None to leave the value under its own key."""
    lossy: bool
    """True when converting this object's value would lose data."""

    def to_api(self) -> dict[str, Any]:
        return {"fromKey": self.fromKey, "toKey": self.toKey, "lossy": self.lossy}


def type_category(t: TypeDefinition) -> str:
    """``page``, ``tag``, ``task``, ``dailynote``, ``whiteboard``, ``media`` or ``custom``."""
    if t.basic:
        low = t.name.lower()
        if low in ("page", "tag", "task", "dailynote", "whiteboard"):
            return low
        if any(low == m.lower() for m in BASIC_MEDIA_TYPES):
            return "media"
    return "custom"


def compatible(src: PropertyDefinition | None, dst: PropertyDefinition) -> bool:
    """Whether a value of ``src`` can move to ``dst`` (a key without a definition: any kind)."""
    if src is None:
        return True
    return src.type == dst.type or dst.type in KIND_TRANSFORMS.get(src.type, ())


def _normalised(name: str) -> str:
    """The name without accents, spaces and punctuation (case kept)."""
    text = unicodedata.normalize("NFKD", name)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return _NON_WORD_RE.sub("", text)


def _score(p: PropertyDefinition, q: PropertyDefinition) -> int:
    if p.id == q.id and p.id == p.key and (p.key in SYSTEM_KEYS or p.key == "backlinks"):
        return 50
    if p.name == q.name:
        return 45
    if _normalised(p.name) and _normalised(p.name) == _normalised(q.name):
        return 40
    if p.name.casefold() == q.name.casefold():
        return 35
    if p.type == q.type:
        return 20
    if _DATA_TYPES.get(p.type) is not None and _DATA_TYPES.get(p.type) == _DATA_TYPES.get(q.type):
        return 15
    return 0


def is_lossy(src: PropertyDefinition, dst: PropertyDefinition, raw: Any) -> bool:
    """Whether converting ``raw`` from ``src`` to ``dst`` loses data (``dst`` is not changed)."""
    if src.type == dst.type or raw is None or raw == "" or raw == []:
        return False
    try:
        _value, lossy = convert_value(src, copy.deepcopy(dst), raw)
    except InvalidValue:
        return True
    return lossy


def mapping_sources(src: TypeDefinition, fm: dict) -> list[PropertyDefinition]:
    """The properties of ``src`` that hold a value in ``fm`` and don't simply carry over."""
    out: list[PropertyDefinition] = []
    for p in src.propertyDefinitions:
        if p.key in CARRIED_KEYS or p.type.startswith("entity_") or p.key not in fm:
            continue
        raw = fm.get(p.key)
        if raw is None or raw == "" or raw == []:
            continue
        out.append(p)
    return out


def mapping_targets(dst: TypeDefinition) -> list[PropertyDefinition]:
    """The properties of ``dst`` a value can be mapped to."""
    return [
        q
        for q in dst.propertyDefinitions
        if q.key not in CARRIED_KEYS and not q.type.startswith("entity_")
    ]


def suggest_mapping(
    src: TypeDefinition,
    dst: TypeDefinition,
    fm: dict,
    remembered: dict[str, str | None] | None = None,
) -> list[MappingRow]:
    """One row per value-holding property of ``src``, with the best free target of ``dst``."""
    remembered = remembered or {}
    sources = mapping_sources(src, fm)
    targets = mapping_targets(dst)
    by_key = {q.key: q for q in targets}
    chosen: dict[str, str | None] = {}
    used: set[str] = set()

    # Remembered choices first (a remembered "no target" sticks too).
    for p in sources:
        if p.key not in remembered:
            continue
        to = remembered[p.key]
        q = by_key.get(to) if isinstance(to, str) else None
        if to is None:
            chosen[p.key] = None
        elif q is not None and q.key not in used and compatible(p, q):
            chosen[p.key] = q.key
            used.add(q.key)

    pairs: list[tuple[int, int, int, PropertyDefinition, PropertyDefinition]] = []
    for i, p in enumerate(sources):
        if p.key in chosen:
            continue
        for j, q in enumerate(targets):
            if not compatible(p, q):
                continue
            score = _score(p, q)
            if score:
                pairs.append((-score, i, j, p, q))
    pairs.sort(key=lambda x: x[:3])
    for _neg, _i, _j, p, q in pairs:
        if p.key in chosen or q.key in used:
            continue
        chosen[p.key] = q.key
        used.add(q.key)

    rows: list[MappingRow] = []
    for p in sources:
        to = chosen.get(p.key)
        lossy = is_lossy(p, by_key[to], fm.get(p.key)) if to is not None else False
        rows.append(MappingRow(p.key, to, lossy))
    return rows


# -- ui.json (the file itself is `uistate`'s) -----------------------------------------


def remembered_mapping(root: Path, from_id: str, to_id: str) -> dict[str, str | None]:
    """The mapping last used to change a ``from_id`` object to ``to_id``."""
    prefs = load_ui(root).get(_PREFS_KEY)
    found = prefs.get(from_id, {}).get(to_id) if isinstance(prefs, dict) else None
    if not isinstance(found, dict):
        return {}
    return {str(k): v if isinstance(v, str) else None for k, v in found.items()}


def save_change_type_preference(
    root: Path,
    from_id: str,
    to_id: str,
    rows: Iterable[MappingRow],
    own_writes: dict[str, str] | None = None,
    lock: threading.RLock | None = None,
) -> bool:
    """Remember a mapping in ``ui.json`` (other keys kept); False when the file can't be read.

    Pass the space's ``lock`` so the read-merge-write can't interleave with a
    ``PUT /api/ui`` (which holds it).
    """
    if lock is not None:
        with lock:
            return save_change_type_preference(root, from_id, to_id, rows, own_writes)
    return _save_preference(root, from_id, to_id, rows, own_writes)


def _save_preference(
    root: Path,
    from_id: str,
    to_id: str,
    rows: Iterable[MappingRow],
    own_writes: dict[str, str] | None,
) -> bool:
    from .space import ReadOnly

    data, _revision, error = _read_ui(root)
    if error is not None:
        return False  # never replace a file we can't read
    prefs = data.get(_PREFS_KEY)
    if not isinstance(prefs, dict):
        prefs = {}
    per_from = prefs.get(from_id)
    if not isinstance(per_from, dict):
        per_from = {}
    per_from[to_id] = {r.fromKey: r.toKey for r in rows}
    prefs[from_id] = per_from
    try:
        write_ui_patch(root, {_PREFS_KEY: prefs}, None, own_writes)
    except ReadOnly:
        return False
    return True
