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
from typing import TypedDict

from pydantic import BaseModel

from .typemodel import PropertyDefinition, TypeDefinition, valid_counterpart

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


# -- functions (Task 4 fills them) ----------------------------------------------------------------


def counterpart_specs(types: Iterable[TypeDefinition]) -> list[CounterpartSpec]:
    """Every source property with a valid counterpart, over `types` then their properties."""
    raise NotImplementedError


def specs_for(type_id: str, types: Iterable[TypeDefinition]) -> list[CounterpartSpec]:
    """The specs that apply to `type_id`, those whose key is a stored key on it dropped."""
    raise NotImplementedError


def counterpart_defs(type_id: str, types: Iterable[TypeDefinition]) -> list[PropertyDefinition]:
    """One virtual ``entity`` definition per counterpart key on `type_id` (merged over sources)."""
    raise NotImplementedError


def check_type(t: TypeDefinition, types: Iterable[TypeDefinition]) -> str | None:
    """The save text for `t`'s counterparts (`types` with `t` in place), or None when they're fine."""
    raise NotImplementedError


def find_relation(
    types: Iterable[TypeDefinition], subject_type_id: str, object_type_id: str, name: str
) -> RelationMatch | None:
    """The relation named `name` (any case) from subject to object: a stored name or a counterpart's."""
    raise NotImplementedError


def edge_label(src_type: TypeDefinition | None, keys: Iterable[str]) -> str | None:
    """The distinct names of `src_type`'s ``entity`` properties among `keys`, joined by " · "."""
    raise NotImplementedError
