"""Collections: model and creation rules (M3 Task 3).

A collection lives in ``.object/collections/<id>.json`` (`JsonStore`). Unknown
keys are kept. Membership is the object's ``collections:`` key (Task 4).
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from .typemodel import Icon

__all__ = ["CollectionDef", "SaveCollectionResult", "default_collection_views"]

DEFAULT_NAME = "New Collection"

_API_ONLY = ("revision", "readOnlyReason")
_KNOWN = (
    "schemaVersion", "id", "name", "formerNames", "icon", "color", "description",
    "typeIds", "views", "pinned", "templates",
)  # fmt: skip


def default_collection_views() -> dict[str, Any]:
    """The only definition of a collection's default views."""
    return {
        "activeTab": "all",
        "all": {
            "viewDefinition": {"dataViewLayout": "list"},
            "filterGroup": {"type": "filterGroup", "operator": "and", "elements": []},
            "sorts": [],
            "groupBy": None,
        },
        "dashboard": {
            "sections": [{"key": "pinned", "collapsed": False}],
            "removedSections": [],
        },
    }


def _strings(v: Any) -> list[str]:
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


@dataclass
class CollectionDef:
    id: str
    name: str
    formerNames: list[str] = field(default_factory=list)
    icon: Icon | None = None
    color: str | None = None
    description: str = ""
    typeIds: list[str] = field(default_factory=list)
    views: dict[str, Any] = field(default_factory=default_collection_views)
    pinned: dict[str, Any] = field(default_factory=lambda: {"ids": [], "isHidden": False})
    templates: dict[str, Any] = field(
        default_factory=lambda: {"ids": [], "defaultTemplateId": None}
    )
    extra: dict[str, Any] = field(default_factory=dict)
    readOnlyReason: str | None = None

    @classmethod
    def from_json(cls, data: dict[str, Any], fallback_id: str) -> CollectionDef:
        views = data.get("views")
        pinned = data.get("pinned") if isinstance(data.get("pinned"), dict) else {}
        templates = data.get("templates") if isinstance(data.get("templates"), dict) else {}
        color = data.get("color")
        default_template = templates.get("defaultTemplateId")
        return cls(
            id=str(data.get("id") or fallback_id),
            name=str(data.get("name") or ""),
            formerNames=_strings(data.get("formerNames")),
            icon=Icon.parse(data.get("icon")),
            color=color if isinstance(color, str) and color else None,
            description=data.get("description") if isinstance(data.get("description"), str) else "",
            typeIds=_strings(data.get("typeIds")),
            views=copy.deepcopy(views) if isinstance(views, dict) else default_collection_views(),
            pinned={
                **pinned,
                "ids": _strings(pinned.get("ids")),
                "isHidden": bool(pinned.get("isHidden", False)),
            },
            templates={
                **templates,
                "ids": _strings(templates.get("ids")),
                "defaultTemplateId": default_template if isinstance(default_template, str) else None,
            },
            extra={
                k: copy.deepcopy(v) for k, v in data.items() if k not in _KNOWN and k not in _API_ONLY
            },
        )

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "schemaVersion": 1,
            "id": self.id,
            "name": self.name,
            "formerNames": list(self.formerNames),
            "icon": self.icon.to_json() if self.icon else None,
            "color": self.color,
            "description": self.description,
            "typeIds": list(self.typeIds),
            "views": copy.deepcopy(self.views),
            "pinned": copy.deepcopy(self.pinned),
            "templates": copy.deepcopy(self.templates),
        }
        for k, v in self.extra.items():
            out[k] = copy.deepcopy(v)
        return out

    def to_api(self, revision: str = "") -> dict[str, Any]:
        out = self.to_json()
        out["readOnlyReason"] = self.readOnlyReason
        out["revision"] = revision
        return out


@dataclass
class SaveCollectionResult:
    collection: CollectionDef
    revision: str = ""
    rewritten: list[str] = field(default_factory=list)
    skipped: list[dict[str, str]] = field(default_factory=list)

    def to_api(self) -> dict[str, Any]:
        return {
            "collection": self.collection.to_api(self.revision),
            "rewritten": list(self.rewritten),
            "skipped": list(self.skipped),
        }
