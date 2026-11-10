"""M28: named two-way relations, the computed side (plan ``2026-11-09-m28-itops-starter-and-relations.md``,
Contract; design ``2026-11-09-it-ops-type-model-design.md`` section 2).

A relation property may name a **counterpart**: ``options.counterpart = {"name", "key"}`` on the
stored side's ``entity`` definition. The other side is never written: it is computed from the link
index on read (`LinkIndex.counterparts`), shown on the target as an editable row, and edited by
writing the stored side of each other object (`Space.edit_counterpart`).

This module is pure: it turns a space's types into counterpart specs and virtual property
definitions, checks a type before it is saved, and names relations for M30 and the graph.

Rules:

- A counterpart applies to target type T for source property P of type S when P is ``entity`` with
  a valid counterpart and P's ``allowedTypes`` contains T or is empty ("any"). Explicit targets get
  the row always (``hideWhenEmpty`` on the virtual definition); "any" targets only while it has a
  value.
- A counterpart key that is a stored property key on T gives T no row (the stored property wins);
  saving S with it, when T is an explicit target, is refused.
- Rows with the same key from several sources are separate `CounterpartRow`s; the UI and the
  virtual definition merge them by key.
- A path counts when it is a non-template object of type S whose resolved value of P includes the
  target, and is not the target itself. Body links and other front matter wikilinks never count.
- ``propertySyncing`` and ``counterpart`` are exclusive on one definition.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, TypedDict

from pydantic import BaseModel

from .typemodel import Icon, PropertyDefinition, TypeDefinition, valid_counterpart

__all__ = [
    "COUNTERPART_KEY",
    "COUNTERPART_KIND",
    "COUNTERPART_NAME",
    "COUNTERPART_SYNCED",
    "COUNTERPART_TAKEN",
    "GONE",
    "NO_COUNTERPART",
    "WRONG_TYPE",
    "CounterpartEditRequest",
    "CounterpartRow",
    "CounterpartSpec",
    "RelationMatch",
    "check_type",
    "counterpart_defs",
    "counterpart_specs",
    "defs_from_specs",
    "edge_label",
    "find_relation",
    "specs_for",
    "valid_counterpart",
]

# -- save texts (`InvalidValue`, 422; our strings) ------------------------------------------------

COUNTERPART_NAME = "Name the other side in 1 to 60 characters, on one line."
COUNTERPART_KEY = "The other side's key can't be used."
COUNTERPART_KIND = "Only a relation can have an other side."
COUNTERPART_SYNCED = "A relation that syncs both ways can't also have a computed other side."
COUNTERPART_TAKEN = '{type} already has a property with the key "{key}".'

# -- edit texts (`InvalidValue` -> 422; our strings) ----------------------------------------------

NO_COUNTERPART = 'This object has no "{key}" relation from {type}.'
WRONG_TYPE = '"{title}" isn\'t of type {type}.'
GONE = "It's gone."
"""The `Skip` reason for an other object that no longer exists."""


# -- shapes ---------------------------------------------------------------------------------------


class CounterpartRow(TypedDict):
    """One computed other side on a target object: the objects of one source type linking to it."""

    key: str
    name: str
    sourceTypeId: str
    sourcePropertyKey: str
    paths: list[str]
    """By title, then path."""


@dataclass(frozen=True)
class CounterpartSpec:
    """One source property with a valid counterpart."""

    source_type_id: str
    source_key: str
    source_name: str
    key: str
    name: str
    targets: tuple[str, ...]
    """Type ids; ``()`` means any type."""


@dataclass(frozen=True)
class RelationMatch:
    """A relation found by name (for M30)."""

    source_type_id: str
    property_key: str
    reversed: bool
    """True when the name was the counterpart's (the object holds the stored side)."""


class CounterpartEditRequest(BaseModel):
    """``POST /api/object/counterpart``: add or remove other objects on one counterpart row."""

    path: str
    key: str
    sourceTypeId: str
    add: list[str] = []
    remove: list[str] = []
    clientId: str | None = None


# -- functions ------------------------------------------------------------------------------------

_ICON = Icon("iconify", "ph-arrows-left-right")


def _synced(p: PropertyDefinition) -> bool:
    """Whether `p` is a stored-both-sides relation (``propertySyncing`` naming a property)."""
    sync = p.options.get("propertySyncing")
    ids = sync.get("propertyIds") if isinstance(sync, dict) else None
    return isinstance(ids, list) and any(isinstance(i, str) and i for i in ids)


def _targets(p: PropertyDefinition) -> tuple[str, ...]:
    """`p`'s allowed type ids, distinct, in order (``()``: any type)."""
    allowed = p.options.get("allowedTypes")
    if not isinstance(allowed, list):
        return ()
    return tuple(dict.fromkeys(a for a in allowed if isinstance(a, str) and a))


def counterpart_specs(types: Iterable[TypeDefinition]) -> list[CounterpartSpec]:
    """Every source property with a valid counterpart, over `types` then their properties.

    A badly shaped counterpart (one `valid_counterpart` refuses), one on a property that isn't
    ``entity`` and one on a relation that syncs both ways give no spec.
    """
    out: list[CounterpartSpec] = []
    for t in types:
        for p in t.propertyDefinitions:
            cp = p.options.get("counterpart")
            if p.type != "entity" or cp is None or not valid_counterpart(cp) or _synced(p):
                continue
            out.append(
                CounterpartSpec(
                    source_type_id=t.id,
                    source_key=p.key,
                    source_name=p.name,
                    key=cp["key"],
                    name=cp["name"],
                    targets=_targets(p),
                )
            )
    return out


def specs_for(type_id: str, types: Iterable[TypeDefinition]) -> list[CounterpartSpec]:
    """The specs that apply to `type_id`, those whose key is a stored key on it dropped.

    An unknown `type_id` has none.
    """
    types = list(types)
    target = next((t for t in types if t.id == type_id), None)
    if target is None:
        return []
    stored = {p.key for p in target.propertyDefinitions}
    return [
        s
        for s in counterpart_specs(types)
        if (not s.targets or type_id in s.targets) and s.key not in stored
    ]


def defs_from_specs(specs: Iterable[CounterpartSpec]) -> list[PropertyDefinition]:
    """`counterpart_defs` from one type's `specs_for`: one virtual definition per key, first seen
    first, its ``allowedTypes`` and ``counterpartOf`` merged over the sources.

    A key only sources open to any type give (Command's and Runbook's "Documented in" on a
    Source) has no definition: the type's objects show that row only while it has a value.
    """
    by_key: dict[str, list[CounterpartSpec]] = {}
    for s in specs:
        by_key.setdefault(s.key, []).append(s)
    by_key = {k: g for k, g in by_key.items() if any(s.targets for s in g)}
    return [
        PropertyDefinition(
            id=f"counterpart:{key}",
            key=key,
            name=group[0].name,
            type="entity",
            description="",
            icon=Icon(_ICON.type, _ICON.val),
            visibility="hideWhenEmpty",
            options={
                "isArray": True,
                "allowedTypes": list(dict.fromkeys(s.source_type_id for s in group)),
                "hasFixedSet": False,
                "fixedSet": [],
                "counterpartOf": [{"typeId": s.source_type_id, "key": s.source_key} for s in group],
            },
        )
        for key, group in by_key.items()
    ]


def counterpart_defs(type_id: str, types: Iterable[TypeDefinition]) -> list[PropertyDefinition]:
    """One virtual ``entity`` definition per counterpart key on `type_id` (merged over sources)."""
    return defs_from_specs(specs_for(type_id, types))


def _shape_text(cp: Any) -> str:
    """The save text for a counterpart `valid_counterpart` refuses: its name, else its key."""
    name = cp.get("name") if isinstance(cp, dict) else None
    if not valid_counterpart({"name": name, "key": "x"}):
        return COUNTERPART_NAME
    return COUNTERPART_KEY


def check_type(t: TypeDefinition, types: Iterable[TypeDefinition]) -> str | None:
    """The save text for `t`'s counterparts (`types` with `t` in place), or None when they're fine.

    Only explicit targets are checked for a taken key: a relation open to any type never is (a
    type holding the key just gets no row for it).
    """
    by_id: dict[str, TypeDefinition] = {}
    for x in types:
        by_id.setdefault(x.id, x)
    by_id[t.id] = t
    for p in t.propertyDefinitions:
        cp = p.options.get("counterpart")
        if cp is None:
            continue
        if p.type != "entity":
            return COUNTERPART_KIND
        if not valid_counterpart(cp):
            return _shape_text(cp)
        if _synced(p):
            return COUNTERPART_SYNCED
        for target_id in _targets(p):
            target = by_id.get(target_id)
            if target is not None and target.prop(cp["key"]) is not None:
                return COUNTERPART_TAKEN.format(type=target.name, key=cp["key"])
    return None


def _fold(name: str) -> str:
    return " ".join(name.split()).casefold()


def find_relation(
    types: Iterable[TypeDefinition], subject_type_id: str, object_type_id: str, name: str
) -> RelationMatch | None:
    """The relation named `name` (any case) from subject to object: a stored name or a counterpart's.

    A stored relation of the subject allowing the object's type comes first
    (``reversed=False``); else a counterpart on the subject from the object's type
    (``reversed=True``: the object holds the stored side).
    """
    types = list(types)
    wanted = _fold(name)
    subject = next((t for t in types if t.id == subject_type_id), None)
    if subject is not None:
        for p in subject.propertyDefinitions:
            if p.type != "entity" or _fold(p.name) != wanted:
                continue
            targets = _targets(p)
            if not targets or object_type_id in targets:
                return RelationMatch(subject_type_id, p.key, False)
    for s in specs_for(subject_type_id, types):
        if s.source_type_id == object_type_id and _fold(s.name) == wanted:
            return RelationMatch(s.source_type_id, s.source_key, True)
    return None


def edge_label(src_type: TypeDefinition | None, keys: Iterable[str]) -> str | None:
    """The distinct names of `src_type`'s ``entity`` properties among `keys`, joined by " · "."""
    if src_type is None:
        return None
    names: list[str] = []
    for key in keys:
        p = src_type.prop(key)
        if p is not None and p.type == "entity" and p.name not in names:
            names.append(p.name)
    return " · ".join(names) if names else None
