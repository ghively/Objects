"""M22: the ticket and work fields, topping up Task, and "Add work fields".

Names, kinds and options come from the work dashboard design (sections 1-2); the keys,
option colours and visibility are **our choice** (the M22 plan's Contract). Every key is
also the property's id (``id == key``, as M4's Task fields), so filters and queries name
them directly.

- ``TICKET_FIELDS`` and ``WORK_FIELDS``: the definitions, in order. ``project`` (a single
  relation to the space's Project types) is on Tasks only.
- ``topup_work_fields``: the basic Task type gains the missing fields **in memory** (as
  ``typemodel.topup_task_type`` does for the Task fields); they reach ``task.json`` the
  first time the type is saved. Never writes.
- ``with_work_fields``: "Add work fields" on another type: a copy with the missing fields,
  plus a Status (Task's five options, not a status label) when the type has none and a
  hidden ``completed`` on every work type but Task.

A field is **skipped** when the type has that key with another kind, or another property
with that name (case-insensitively). A field the type has with the same key and kind is
kept as it is. A **work type** is a type with a ``steps`` property of kind ``steps``.
"""

from __future__ import annotations

import copy
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from .typemodel import (
    PROPERTY_ICONS,
    PropertyDefinition,
    TypeDefinition,
    _option_id,
    _task_field_defs,
    is_task_type,
)
from .typetemplates import template_for

__all__ = [
    "FIELD_KEYS",
    "TICKET_FIELDS",
    "TICKET_KEYS",
    "WORK_FIELDS",
    "WORK_KEYS",
    "FieldSpec",
    "field_defs",
    "is_work_type",
    "project_type_ids",
    "resolved_key",
    "topup_work_fields",
    "with_work_fields",
    "work_type_ids",
]

KEY_EXISTS = "A property with this key exists"
NAME_EXISTS = "A property with this name exists"


@dataclass(frozen=True)
class FieldSpec:
    key: str
    name: str
    kind: str
    options: dict[str, Any] = field(default_factory=dict)
    visibility: str = "hideWhenEmpty"
    task_only: bool = False


def _label(pairs: Sequence[tuple[str, str]]) -> dict[str, Any]:
    """Single-label options: ids are the text's slug, colours as given."""
    taken: set[str] = set()
    return {
        "isArray": False,
        "set": [
            {"id": _option_id(text, taken), "text": text, "color": color, "icon": None}
            for text, color in pairs
        ],
    }


_DAY = {"constraints": {"resolutionPreference": "day", "endTimeSettings": "notAllowed"}}

TICKET_FIELDS: tuple[FieldSpec, ...] = (
    FieldSpec("ticketId", "Ticket ID", "text"),
    FieldSpec("system", "System", "label", _label((("ServiceNow", "green"), ("Jira", "blue")))),
    FieldSpec("ticketLink", "Ticket link", "url"),
    FieldSpec("deskStatus", "Desk status", "label", _label((
        ("Open", "gray"), ("In progress", "blue"), ("Active", "sky"), ("Blocked", "red"),
        ("Waiting response", "amber"), ("Resolved", "green"), ("Closed", "gray"),
    ))),
    FieldSpec("deskPriority", "Desk priority", "label", _label((
        ("Critical", "red"), ("High", "amber"), ("Medium", "yellow"), ("Low", "gray"),
    ))),
    FieldSpec("requester", "Requester", "text"),
    FieldSpec("deskGroup", "Group", "text"),
    FieldSpec("deskLocation", "Location", "text"),
    FieldSpec("deskOpened", "Opened", "datetime", _DAY),
    FieldSpec("deskUpdated", "Desk updated", "datetime", _DAY),
    FieldSpec("deskResolved", "Resolved", "datetime", _DAY),
)  # fmt: skip

WORK_FIELDS: tuple[FieldSpec, ...] = (
    FieldSpec("rank", "Rank", "number"),
    FieldSpec("area", "Area", "label", {"isArray": False, "set": []}),
    FieldSpec("cause", "Cause", "label", _label((
        ("Likely", "amber"), ("Confirmed", "green"), ("Unknown", "gray"),
        ("Not found", "purple"), ("Need to ask", "sky"),
    ))),
    FieldSpec("priorityNote", "Priority note", "text"),
    FieldSpec("blockedOn", "Blocked on", "text"),
    FieldSpec("findings", "Findings", "textBlock"),
    FieldSpec("hypothesis", "Hypothesis", "textBlock"),
    FieldSpec("confidence", "Confidence", "label", _label((
        ("High", "green"), ("Medium", "amber"), ("Low", "red"), ("N/A", "gray"),
    ))),
    FieldSpec("confidenceReason", "Confidence reason", "text"),
    FieldSpec("verified", "Verified", "textList"),
    FieldSpec("assumed", "Assumed", "textList"),
    FieldSpec("toRaiseConfidence", "To raise confidence", "textList"),
    FieldSpec("floorItems", "Floor items", "floorItems"),
    FieldSpec("steps", "Steps", "steps", visibility="alwaysShow"),
    FieldSpec("project", "Project", "entity", {"isArray": False}, task_only=True),
)  # fmt: skip

TICKET_KEYS: frozenset[str] = frozenset(f.key for f in TICKET_FIELDS)
WORK_KEYS: frozenset[str] = frozenset(f.key for f in WORK_FIELDS)
FIELD_KEYS = TICKET_KEYS | WORK_KEYS


def _define(spec: FieldSpec, project_type_ids: Sequence[str]) -> PropertyDefinition:
    options = copy.deepcopy(spec.options)
    if spec.key == "project":
        options["allowedTypes"] = list(project_type_ids)
    return PropertyDefinition.from_json(
        {
            "id": spec.key,
            "key": spec.key,
            "name": spec.name,
            "type": spec.kind,
            "description": "",
            "icon": {"type": "iconify", "val": PROPERTY_ICONS[spec.kind]},
            "visibility": spec.visibility,
            "options": options,
        }
    )


def field_defs(*, task: bool, project_type_ids: Sequence[str]) -> list[PropertyDefinition]:
    """Fresh ticket and work field definitions, in order (``project`` only when ``task``)."""
    return [
        _define(spec, project_type_ids)
        for spec in (*TICKET_FIELDS, *WORK_FIELDS)
        if task or not spec.task_only
    ]


def _support_defs() -> dict[str, PropertyDefinition]:
    """Task's ``status`` (as a plain label: ``isStatus`` not set) and hidden ``completed``."""
    defs = {p.key: p for p in _task_field_defs() if p.key in ("status", "completed")}
    defs["status"].options.pop("isStatus", None)
    return defs


def is_work_type(t: TypeDefinition | None) -> bool:
    """True when the type has a property ``steps`` of kind ``steps``."""
    if t is None:
        return False
    p = t.prop("steps")
    return p is not None and p.type == "steps"


def resolved_key(t: TypeDefinition | None) -> str | None:
    """M31 (G3): the property that holds a ticket's resolved time on ``t``: the ticket field
    ``deskResolved`` when the type has it (a Task, a Project, an M28-era Incident), else the type's
    own ``resolved`` date (the Incident's one Resolved), else None."""
    if t is None:
        return None
    for key in ("deskResolved", "resolved"):
        p = t.prop(key)
        if p is not None and p.type == "datetime":
            return key
    return None


def work_type_ids(types: Iterable[TypeDefinition]) -> list[str]:
    return [t.id for t in types if is_work_type(t)]


def project_type_ids(types: Iterable[TypeDefinition]) -> list[str]:
    """Ids of the types made from (or named like) the Project template."""
    return [t.id for t in types if template_for(t) == "project"]


def _merge(
    t: TypeDefinition, defs: Iterable[PropertyDefinition]
) -> tuple[list[str], list[dict[str, str]]]:
    """Append each of ``defs`` that ``t`` lacks; (added keys, skipped entries)."""
    added: list[str] = []
    skipped: list[dict[str, str]] = []
    for d in defs:
        same_key = [p for p in t.propertyDefinitions if p.key == d.key or p.id == d.id]
        if same_key:
            if any(p.key == d.key and p.type == d.type for p in same_key):
                continue  # kept as it is
            skipped.append({"key": d.key, "name": d.name, "reason": KEY_EXISTS})
            continue
        low = d.name.casefold()
        if any(p.name.casefold() == low for p in t.propertyDefinitions):
            skipped.append({"key": d.key, "name": d.name, "reason": NAME_EXISTS})
            continue
        t.propertyDefinitions.append(d)
        added.append(d.key)
    return added, skipped


def topup_work_fields(t: TypeDefinition, types: Sequence[TypeDefinition]) -> TypeDefinition:
    """Give the basic Task type the ticket and work fields it lacks, in memory; return ``t``.

    Any other type comes back untouched. Never writes.
    """
    if not is_task_type(t):
        return t
    _merge(t, field_defs(task=True, project_type_ids=project_type_ids(types)))
    return t


def with_work_fields(
    t: TypeDefinition, types: Sequence[TypeDefinition]
) -> tuple[TypeDefinition, list[str], list[dict[str, str]]]:
    """"Add work fields": a copy of ``t`` with the missing fields appended.

    Returns (copy, added keys, skipped ``{key, name, reason}``). Adds ``status`` when the
    type has none and a hidden ``completed`` unless the type is the basic Task.
    """
    out = copy.deepcopy(t)
    task = is_task_type(out)
    defs = field_defs(task=task, project_type_ids=project_type_ids(types))
    if not task:
        support = _support_defs()
        defs += [support["status"], support["completed"]]
    added, skipped = _merge(out, defs)
    return out, added, skipped
