"""Saved queries: model and validation rules (M3 Task 5).

A query lives in ``.object/queries/<id>.json`` (`JsonStore`). It is a definition
with a view, not a ``.md`` object. Unknown keys are kept.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from .typemodel import Icon

__all__ = [
    "DEFAULT_NAME",
    "LIMIT_SIZES",
    "MAX_SEARCH_TERMS",
    "QueryDef",
    "default_definition",
    "default_view",
    "query_type_ids",
]

DEFAULT_NAME = "New Query"
LIMIT_SIZES = (1, 3, 5, 10, 25, 50)
"""The result limits Object offers."""
MAX_SEARCH_TERMS = 5

_API_ONLY = ("revision", "readOnlyReason")
_KNOWN = ("schemaVersion", "id", "name", "titleIsCustom", "icon", "description", "definition", "view")


def _empty_filter_group() -> dict[str, Any]:
    return {"type": "filterGroup", "operator": "and", "elements": []}


def default_definition() -> dict[str, Any]:
    return {"structures": [], "filterGroup": _empty_filter_group(), "sorts": [], "groupBy": None}


def default_view() -> dict[str, Any]:
    return {"viewDefinition": {"dataViewLayout": "list"}}


def _definition(value: Any) -> dict[str, Any]:
    out = copy.deepcopy(value) if isinstance(value, dict) else {}
    for key, default in default_definition().items():
        if key not in out or (key != "groupBy" and out[key] is None):
            out[key] = default
    return out


def _view(value: Any) -> dict[str, Any]:
    out = copy.deepcopy(value) if isinstance(value, dict) else {}
    if not isinstance(out.get("viewDefinition"), dict):
        out["viewDefinition"] = default_view()["viewDefinition"]
    return out


def query_type_ids(definition: dict[str, Any]) -> set[str]:
    """Every type id a definition names (``structures[].id`` and ``excludeStructureIds``)."""
    found: set[str] = set()
    for s in definition.get("structures") or []:
        if isinstance(s, dict) and isinstance(s.get("id"), str):
            found.add(s["id"])
    for tid in definition.get("excludeStructureIds") or []:
        if isinstance(tid, str):
            found.add(tid)
    return found


@dataclass
class QueryDef:
    id: str
    name: str = ""
    titleIsCustom: bool = False
    icon: Icon | None = None
    description: str = ""
    definition: dict[str, Any] = field(default_factory=default_definition)
    view: dict[str, Any] = field(default_factory=default_view)
    extra: dict[str, Any] = field(default_factory=dict)
    readOnlyReason: str | None = None

    @classmethod
    def from_json(cls, data: dict[str, Any], fallback_id: str) -> QueryDef:
        name = data.get("name") if isinstance(data.get("name"), str) else ""
        custom = data.get("titleIsCustom")
        return cls(
            id=str(data.get("id") or fallback_id),
            name=name,
            titleIsCustom=custom if isinstance(custom, bool) else bool(name),
            icon=Icon.parse(data.get("icon")),
            description=data.get("description") if isinstance(data.get("description"), str) else "",
            definition=_definition(data.get("definition")),
            view=_view(data.get("view")),
            extra={
                k: copy.deepcopy(v) for k, v in data.items() if k not in _KNOWN and k not in _API_ONLY
            },
        )

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "schemaVersion": 1,
            "id": self.id,
            "name": self.name,
            "titleIsCustom": self.titleIsCustom,
            "icon": self.icon.to_json() if self.icon else None,
            "description": self.description,
            "definition": copy.deepcopy(self.definition),
            "view": copy.deepcopy(self.view),
        }
        for k, v in self.extra.items():
            out[k] = copy.deepcopy(v)
        return out

    def to_api(self, revision: str = "") -> dict[str, Any]:
        out = self.to_json()
        out["readOnlyReason"] = self.readOnlyReason
        out["revision"] = revision
        return out
