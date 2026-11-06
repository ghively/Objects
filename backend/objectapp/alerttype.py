"""The Alert type (M23): a normal object type the monitoring folder watch fills.

Made on first need (the watch's first alert, or "Add the Alert type" in Settings > Work)
with `Space.create_type` and then `Space.save_type` adding the seven Alert fields after
the type's own properties. Keys are ids. Source's key is ``alertSource``: ``source`` is a
reserved key (the basic media types' field), which `save_type` refuses. A space that
already has an "Alert" type that isn't an alert type gets "Monitoring alert" instead (our
fallback).

Nothing here announces: the caller (the watch, or the route) announces
``ChangeEvent("types", id, revision, origin)`` when ``created`` is True.
"""

from __future__ import annotations

import copy
import threading
from typing import TYPE_CHECKING

from .propvalues import InvalidValue
from .typemodel import PROPERTY_ICONS, PropertyDefinition, TypeDefinition
from .workfields import FieldSpec

if TYPE_CHECKING:
    from .space import Space

__all__ = [
    "ALERT_COLOR",
    "ALERT_FIELDS",
    "ALERT_ICON",
    "ALERT_NAME",
    "ALERT_PLURAL",
    "alert_type",
    "ensure_alert_type",
    "is_alert_type",
]

ALERT_NAME = "Alert"
ALERT_PLURAL = "Alerts"
ALERT_ICON = "ph-warning"
ALERT_COLOR = "red"

_LOCK = threading.RLock()

_FALLBACK_NAME = "Monitoring alert"
_FALLBACK_PLURAL = "Monitoring alerts"

_TIME = {"constraints": {"resolutionPreference": "time"}}

ALERT_FIELDS: tuple[FieldSpec, ...] = (
    FieldSpec("alertSource", "Source", "text"),  # "source" is a reserved key
    FieldSpec("severity", "Severity", "label", {
        "isArray": False,
        "set": [
            {"id": "critical", "text": "Critical", "color": "red", "icon": None},
            {"id": "warning", "text": "Warning", "color": "amber", "icon": None},
            {"id": "info", "text": "Info", "color": "gray", "icon": None},
        ],
    }),
    FieldSpec("message", "Message", "text"),
    FieldSpec("raisedAt", "Raised at", "datetime", _TIME),
    FieldSpec("clearedAt", "Cleared at", "datetime", _TIME),
    FieldSpec("link", "Link", "url"),
    FieldSpec("alertKey", "Alert key", "text", visibility="hidden"),
)  # fmt: skip


def _define(spec: FieldSpec) -> PropertyDefinition:
    return PropertyDefinition.from_json(
        {
            "id": spec.key,
            "key": spec.key,
            "name": spec.name,
            "type": spec.kind,
            "description": "",
            "icon": {"type": "iconify", "val": PROPERTY_ICONS[spec.kind]},
            "visibility": spec.visibility,
            "options": copy.deepcopy(spec.options),
        }
    )


def is_alert_type(t: TypeDefinition | None) -> bool:
    """True for a type with an ``alertKey`` text property and a ``severity`` label property."""
    if t is None:
        return False
    key, severity = t.prop("alertKey"), t.prop("severity")
    return (
        key is not None
        and key.type == "text"
        and severity is not None
        and severity.type == "label"
    )


def alert_type(space: Space) -> TypeDefinition | None:
    """The first alert type by id, or None. Reads only."""
    for t in sorted(space.types, key=lambda x: x.id):
        if not t.readOnlyReason and is_alert_type(t):
            return t
    return None


def _bare(space: Space, name: str, plural: str) -> TypeDefinition | None:
    """A type this module made but never finished (a failed second step): our name, plural,
    icon and colour and none of the alert fields."""
    for t in space.types:
        if (
            t.name == name
            and t.pluralName == plural
            and not t.readOnlyReason
            and t.prop("alertKey") is None
            and t.prop("severity") is None
            and t.icon is not None
            and t.icon.val == ALERT_ICON
            and t.color == ALERT_COLOR
        ):
            return t
    return None


def _add_fields(space: Space, type_id: str) -> TypeDefinition:
    t, rev = space.refresh_type(type_id)
    assert t is not None
    new = copy.deepcopy(t)
    taken = {p.key for p in new.propertyDefinitions}
    new.propertyDefinitions = [
        *new.propertyDefinitions,
        *(_define(spec) for spec in ALERT_FIELDS if spec.key not in taken),
    ]
    result = space.save_type(new, rev)
    return space.type_by_id(type_id) or result.type


def ensure_alert_type(space: Space) -> tuple[TypeDefinition, bool]:
    """The alert type, making it when the space has none: ``(type, created)``. Idempotent.

    Serialised, so two callers never make two types. When the second step (adding the
    fields) failed earlier and left a bare type, the next call finishes that one.
    """
    with _LOCK:
        existing = alert_type(space)
        if existing is not None:
            return existing, False
        bare = _bare(space, ALERT_NAME, ALERT_PLURAL) or _bare(
            space, _FALLBACK_NAME, _FALLBACK_PLURAL
        )
        if bare is not None:
            return _add_fields(space, bare.id), True
        try:
            made = space.create_type(ALERT_NAME, ALERT_PLURAL, ALERT_ICON, ALERT_COLOR)
        except InvalidValue:
            # "Alert" is taken by a type that isn't an alert type.
            made = space.create_type(
                _FALLBACK_NAME, _FALLBACK_PLURAL, ALERT_ICON, ALERT_COLOR
            )
        return _add_fields(space, made.id), True
