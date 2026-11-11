"""Object types, v2: the full type model and its lossless migration.

A type lives in ``.object/types/<id>.json``. M1 wrote a simplified shape
("v1": no ``schemaVersion``); `TypeDefinition.from_json` reads both and keeps
every key it doesn't know (in ``extra``) and every property entry it can't read
(in ``invalid_property_entries``), so `to_json` gives all of it back.

`load_types` migrates v1 files once (backing each original up to
``.object/backup/types-v1/``), writes the built-in Page and Tag types when
missing, and never touches a type file that isn't valid JSON (see
`UnreadableType`).
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .keycompat import upgrade_keys
from .textfile import atomic_write, decode
from .typedefs import SYSTEM_KEYS, slug

__all__ = [
    "BASIC_MEDIA_TYPES",
    "basic_media_type",
    "BASIC_TYPE_NAMES",
    "BUILTIN_TYPES",
    "DATA_VIEW_LAYOUTS",
    "DEFAULT_LAYOUT_KEY",
    "PROPERTY_ICONS",
    "THEME_COLORS",
    "Icon",
    "LabelOption",
    "PropertyDefinition",
    "MAX_STALE_DAYS",
    "MAX_SYNC_SOURCE",
    "ON_DEMAND_TYPES",
    "RevisionConflict",
    "SYNCABLE_KINDS",
    "SYNCED_STALE_DEFAULT",
    "SyncedSpec",
    "TypeDefinition",
    "TypeReadOnly",
    "UnreadableType",
    "is_task_type",
    "load_types",
    "on_demand_type",
    "on_demand_types",
    "status_category",
    "synced_problems",
    "system_property_defs",
    "topup_task_type",
    "type_revision",
    "write_starting_types",
    "write_type_json",
]

SCHEMA_VERSION = 2

DEFAULT_LAYOUT_KEY = "defaultDataViewLayout"
"""Polish item 20 (our key): the layout a type page without saved views opens in. Absent
means the built-in default; it lives in `TypeDefinition.extra`, so an unset type's file
never gains it."""
DATA_VIEW_LAYOUTS = ("list", "grid", "wall", "table", "embed", "kanban", "calendar", "timeline", "chart")
"""The layouts a type page's "All" view offers (the frontend's ``FULL_VIEW_LAYOUTS``)."""

THEME_COLORS = (
    "gray",
    "rose",
    "pink",
    "fuchsia",
    "purple",
    "violet",
    "indigo",
    "blue",
    "sky",
    "cyan",
    "teal",
    "emerald",
    "green",
    "lime",
    "yellow",
    "amber",
    "orange",
    "red",
)

# Default property icons per property kind.
PROPERTY_ICONS = {
    "text": "ph-text-align-left",
    "textBlock": "ph-text-align-left",
    "boolean": "ph-check-square",
    "number": "ph-hash",
    "blocks": "ph-list-dashes",
    "url": "ph-link",
    "datetime": "ph-calendar",
    "datetimeSimple": "ph-calendar-blank",
    "label": "ph-caret-circle-down",
    "entity": "ph-file-text",
    "simpleTableBlock": "ph-table",
    "coverImage": "ph-image",
    "color": "ph-palette",
    # M12: our kinds (docs/superpowers/plans/2026-11-05-m12-property-kinds.md)
    "formula": "ph-function",
    "rollup": "ph-stack",
    "uniqueId": "ph-hash-straight",
    "email": "ph-at",
    "phone": "ph-phone",
    "files": "ph-paperclip",
    "entity_title": "ph-text-t",
    "entity_icon": "ph-smiley",
    "entity_description": "ph-info",
    "entity_createdAt": "ph-calendar-blank",
    "entity_lastUpdated": "ph-clock-clockwise",
    "entity_tags": "ph-tag",
    "entity_aliases": "ph-cards",
    "entity_collections": "ph-cards-three",
    "entity_backlinks": "ph-line-segment",
    "entity_type": "ph-notebook",
    # M14 (our choice): a button runs an automation on its object; it holds no value.
    "button": "ph-cursor-click",
    # M22 (our kinds): a work item's steps, a list of short texts and its floor items.
    "steps": "ph-list-checks",
    "textList": "ph-list-bullets",
    "floorItems": "ph-clipboard-text",
}

# (key, kind, en-US name, description) of the system properties, in order.
_SYSTEM_DEFS = (
    ("title", "entity_title", "Title", "The name of the object, shown wherever it appears"),
    ("collections", "entity_collections", "Collections", "The collections this object belongs to"),
    (
        "description",
        "entity_description",
        "Description",
        "A short summary of what the object is about",
    ),
    ("createdAt", "entity_createdAt", "Created at", "When the object was made"),
    ("lastUpdated", "entity_lastUpdated", "Last updated", "When the object last changed"),
    ("tags", "entity_tags", "Tags", "Tags attached to the object"),
    ("icon", "entity_icon", "Icon", "An emoji or icon shown beside the title"),
    ("aliases", "entity_aliases", "Aliases", "Other names the object goes by"),
)
_TYPE_DEF = ("type", "entity_type", "Object type", "What kind of object this is")
# System properties a type only has once they are added.
_OPTIONAL_SYSTEM_DEFS = {
    "type": _TYPE_DEF,
    "backlinks": ("backlinks", "entity_backlinks", "Backlinks", ""),
    "coverImage": ("coverImage", "coverImage", "Cover image", ""),
    "color": ("color", "color", "Color", ""),
}

BASIC_TYPE_NAMES = ("Page", "Tag", "Task", "DailyNote", "Whiteboard")

# The basic media types: their fields become read-only system definitions.
BASIC_MEDIA_TYPES: dict[str, dict[str, str]] = {
    "Weblink": {"url": "url", "domain": "text", "iframeUrl": "url", "previewImage": "url"},
    "File": {"mimeType": "text", "fileSize": "number", "source": "text"},
    "Image": {
        "mimeType": "text",
        "fileSize": "number",
        "width": "number",
        "height": "number",
        "source": "text",
    },
    "PDF": {"mimeType": "text", "fileSize": "number", "source": "text"},
    "Audio": {"mimeType": "text", "fileSize": "number", "source": "text"},
    "Video": {
        "mimeType": "text",
        "fileSize": "number",
        "width": "number",
        "height": "number",
        "source": "text",
    },
    "Tweet": {"url": "url", "source": "text"},
}

_TYPE_ICONS = {
    "Page": "ph-file-text",
    "Tag": "ph-tag",
    "Task": "ph-check-circle",
    "DailyNote": "ph-calendar-blank",
    "Whiteboard": "ph-presentation",
    "Person": "ph-user",
    "Server": "ph-hard-drives",
    "Weblink": "ph-globe-hemisphere-west",
    "File": "ph-file",
    "Image": "ph-image",
    "PDF": "ph-file-pdf",
    "Audio": "ph-waveform",
    "Video": "ph-video",
    "Tweet": "ph-twitter-logo",
}
_DEFAULT_TYPE_ICON = "ph-cube"

# Built-in types written when missing (as v1-shaped seeds, migrated like any other).
BUILTIN_TYPES: dict[str, dict[str, Any]] = {
    "page": {
        "id": "page",
        "name": "Page",
        "pluralName": "Pages",
        "folder": "Pages",
        "icon": "ph-file-text",
        "color": "gray",
        "propertyDefinitions": [],
    },
    "tag": {
        "id": "tag",
        "name": "Tag",
        "pluralName": "Tags",
        "folder": "Tags",
        "icon": "ph-tag",
        "color": "gray",
        "propertyDefinitions": [],
    },
}

# M32: the built-in types every space can make from its first second. Unlike `BUILTIN_TYPES`
# these are **not** written at load: a space that has none gets them in memory
# (`on_demand_types`), so the app can always offer "New task" and "Today's note", and each is
# written to ``.object/types/`` with its first object (`Space._persist_type`), by that user
# action. A new space is made with them on disk (`write_starting_types`). The Task's fields
# (Status with Not Started, Next Up, In Progress, On Hold and Done, Priority, Date, ...) are
# `topup_task_type`'s; Task's colour is our choice.
ON_DEMAND_TYPES: dict[str, dict[str, Any]] = {
    "task": {
        "id": "task",
        "name": "Task",
        "pluralName": "Tasks",
        "folder": "Tasks",
        "icon": "ph-check-circle",
        "color": "green",
        "propertyDefinitions": [],
    },
    "dailynote": {
        "id": "dailynote",
        "name": "DailyNote",
        "pluralName": "DailyNotes",
        "folder": "DailyNotes",
        "icon": "ph-calendar-blank",
        "color": "blue",
        "propertyDefinitions": [
            {"id": "date", "key": "date", "name": "Date", "type": "datetime", "isArray": False},
            {"id": "reviewed", "key": "reviewed", "name": "Reviewed", "type": "boolean",
             "isArray": False},
        ],
    },
}  # fmt: skip

_STATUS_CATEGORIES = {
    "not started": "not-started",
    "next up": "not-started",
    "in progress": "in-progress",
    "on hold": "blocked",
    "blocked": "blocked",
    "done": "done",
    "complete": "done",
}
# The colours of the basic Task status options.
_STATUS_COLORS = {
    "not started": "red",
    "next up": "yellow",
    "in progress": "blue",
    "on hold": "pink",
    "done": "green",
}

_ICONIFY_RE = re.compile(r"^[a-z0-9]+(?:[-:][a-z0-9]+)+$")
_V1_PROP_KEYS = frozenset({"id", "key", "name", "type", "isArray"})
# `synced` (M29): the synced mark, a top-level field (`SyncedSpec`), not an option.
_V2_PROP_KEYS = frozenset(
    {"id", "key", "name", "type", "description", "icon", "visibility", "options", "synced"}
)
# `counterparts` (M28): the computed other sides `GET /api/space` serves per type; never saved.
_API_ONLY_KEYS = frozenset({"revision", "readOnlyReason", "counterparts"})


class RevisionConflict(Exception):
    """The type file changed since the revision the caller edited."""

    def __init__(self, current_revision: str) -> None:
        super().__init__(f"Type changed on disk (current revision {current_revision!r})")
        self.current_revision = current_revision


class TypeReadOnly(Exception):
    """The type cannot be saved (its file on disk isn't readable JSON)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def status_category(text: str) -> str:
    """The status category for an option text (Task's status label)."""
    return _STATUS_CATEGORIES.get(" ".join(text.lower().split()), "not-started")


# -- icons and options -----------------------------------------------------------


@dataclass
class Icon:
    type: str
    """``'emoji'`` or ``'iconify'``."""
    val: str
    color: str | None = None

    @classmethod
    def parse(cls, v: Any) -> Icon | None:
        """An icon from a stored value: an Iconify id or emoji string, or ``{type, val, color?}``."""
        if v is None:
            return None
        if isinstance(v, Icon):
            return v
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return None
            return cls("iconify" if _ICONIFY_RE.match(s) else "emoji", s)
        if isinstance(v, dict) and isinstance(v.get("val"), str):
            kind = v.get("type")
            if kind not in ("emoji", "iconify"):
                kind = "iconify" if _ICONIFY_RE.match(v["val"]) else "emoji"
            color = v.get("color")
            return cls(kind, v["val"], color if isinstance(color, str) and color else None)
        return None

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"type": self.type, "val": self.val}
        if self.color:
            out["color"] = self.color
        return out


@dataclass
class LabelOption:
    id: str
    text: str
    color: str | None
    icon: Icon | None = None
    statusCategory: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> LabelOption:
        known = {"id", "text", "color", "icon", "statusCategory"}
        return cls(
            id=str(data.get("id") or slug(str(data.get("text", "")))),
            text=str(data.get("text", "")),
            color=data.get("color") if isinstance(data.get("color"), str) else None,
            icon=Icon.parse(data.get("icon")),
            statusCategory=data.get("statusCategory"),
            extra={k: v for k, v in data.items() if k not in known},
        )

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "text": self.text,
            "color": self.color,
            "icon": self.icon.to_json() if self.icon else None,
        }
        if self.statusCategory is not None:
            out["statusCategory"] = self.statusCategory
        for k, v in self.extra.items():
            out.setdefault(k, v)
        return out


def _option_id(text: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "option"
    oid, n = base, 2
    while oid in taken:
        oid, n = f"{base}-{n}", n + 1
    taken.add(oid)
    return oid


def label_options(texts: Iterable[str], status: bool = False) -> list[dict[str, Any]]:
    """Option JSON for observed label texts, coloured round-robin (status: the status colours)."""
    out: list[dict[str, Any]] = []
    taken: set[str] = set()
    for i, text in enumerate(texts):
        norm = " ".join(text.lower().split())
        color = THEME_COLORS[(i + 7) % len(THEME_COLORS)]
        opt: dict[str, Any] = {"id": _option_id(text, taken), "text": text[:100], "icon": None}
        if status:
            color = _STATUS_COLORS.get(norm, color)
            opt["statusCategory"] = status_category(text)
        opt["color"] = color
        out.append(opt)
    return out


# -- property definitions --------------------------------------------------------


NUMBER_FORMAT_TYPES = frozenset({"number", "currency", "percentage", "progress"})


def _str_list(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


# M28: a counterpart's key (the computed other side of a relation; plan 2026-11-09-m28, Contract).
_COUNTERPART_KEY_RE = re.compile(r"[A-Za-z][A-Za-z0-9]{0,59}")
_COUNTERPART_RESERVED = SYSTEM_KEYS | {"backlinks", "title", "type", "tags", "aliases", "id"}


def valid_counterpart(value: Any) -> bool:
    """Whether `value` is a well-shaped ``options.counterpart``: ``{"name": str, "key": str}``.

    ``name`` is one line of 1 to 60 characters (not only spaces); ``key`` is a letter, then
    letters and digits, at most 60 in all, and not a system key. Whether the key is free on the
    target types is `counterparts.check_type`'s question, not this one.
    """
    if not isinstance(value, dict):
        return False
    name, key = value.get("name"), value.get("key")
    if not isinstance(name, str) or not name.strip() or len(name) > 60:
        return False
    if name.splitlines() != [name]:
        return False
    if not isinstance(key, str) or not _COUNTERPART_KEY_RE.fullmatch(key):
        return False
    return key not in _COUNTERPART_RESERVED


# M29: synced facts (plan 2026-11-09-m29, Contract). A synced property's values are filled only by
# a script or agent through `/api/v1` (`Space.sync_facts`) and live in `.object/synced/`.
SYNCABLE_KINDS = frozenset(
    {"text", "url", "number", "boolean", "datetime", "datetimeSimple", "label"}
)
SYNCED_STALE_DEFAULT = 7
MAX_SYNC_SOURCE = 60
MAX_STALE_DAYS = 365

_SYNCED_KIND = (
    '"{name}" can\'t be synced: only text, URL, number, checkbox, date and label properties can.'
)
_SYNCED_SOURCE = 'The source of "{name}" must be 1-60 characters on one line.'
_SYNCED_STALE = '"Stale after" of "{name}" must be a whole number of days from 1 to 365.'


def _valid_source(v: Any) -> bool:
    return (
        isinstance(v, str)
        and bool(v.strip())
        and len(v) <= MAX_SYNC_SOURCE
        and v.splitlines() == [v]
    )


def _valid_stale_days(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= MAX_STALE_DAYS


@dataclass(frozen=True)
class SyncedSpec:
    """A property's synced mark: who fills it (``source``) and after how many days it is stale."""

    source: str
    staleAfterDays: int = SYNCED_STALE_DEFAULT

    @classmethod
    def parse(cls, data: Any) -> SyncedSpec | None:
        """The mark `data` describes, or None for anything malformed (the caller keeps it in
        ``extra``): ``source`` 1-60 characters on one line, ``staleAfterDays`` (default 7) a
        whole number from 1 to 365."""
        if not isinstance(data, dict) or not _valid_source(data.get("source")):
            return None
        days = data.get("staleAfterDays", SYNCED_STALE_DEFAULT)
        if not _valid_stale_days(days):
            return None
        return cls(source=data["source"], staleAfterDays=days)

    def to_json(self) -> dict[str, Any]:
        return {"source": self.source, "staleAfterDays": self.staleAfterDays}


def synced_problems(entry: dict[str, Any]) -> list[str]:
    """For one property JSON entry of a type save: [] when it has no `synced` or a valid one.

    Otherwise the problems, in this order: a kind that can't be synced, a bad source, a bad
    "Stale after". ``synced: null`` means not synced.
    """
    if not isinstance(entry, dict) or entry.get("synced") is None:
        return []
    mark = entry["synced"]
    name = entry.get("name")
    if not isinstance(name, str) or not name:
        name = str(entry.get("key", ""))
    problems: list[str] = []
    if entry.get("type") not in SYNCABLE_KINDS:
        problems.append(_SYNCED_KIND.format(name=name))
    if not isinstance(mark, dict) or not _valid_source(mark.get("source")):
        problems.append(_SYNCED_SOURCE.format(name=name))
    if isinstance(mark, dict) and not _valid_stale_days(
        mark.get("staleAfterDays", SYNCED_STALE_DEFAULT)
    ):
        problems.append(_SYNCED_STALE.format(name=name))
    return problems


def option_shape_problems(options: Any) -> list[str]:
    """The option keys whose value has the wrong shape (see `normalize_options`)."""
    if not isinstance(options, dict):
        return ["options"]
    bad: list[str] = []
    for key in ("allowedTypes", "fixedSet"):
        if key in options and not _str_list(options[key]):
            bad.append(key)
    # M31: `headerColumn` (a Table property: "First column is a header"; display only).
    for key in ("isArray", "hasFixedSet", "headerColumn"):
        if key in options and not isinstance(options[key], bool):
            bad.append(key)
    if "set" in options and not (
        isinstance(options["set"], list) and all(isinstance(x, dict) for x in options["set"])
    ):
        bad.append("set")
    if "numberFormat" in options:
        fmt = options["numberFormat"]
        if not (
            isinstance(fmt, dict)
            and fmt.get("type") in NUMBER_FORMAT_TYPES
            and isinstance(fmt.get("options", {}), dict)
        ):
            bad.append("numberFormat")
    if "propertySyncing" in options:
        sync = options["propertySyncing"]
        if not (isinstance(sync, dict) and _str_list(sync.get("propertyIds", []))):
            bad.append("propertySyncing")
    # M28: `null` means no other side; anything else must be a valid counterpart.
    if options.get("counterpart") is not None and not valid_counterpart(options["counterpart"]):
        bad.append("counterpart")
    return bad


def normalize_options(kind: str, options: dict[str, Any]) -> dict[str, Any]:
    """`options` with each badly shaped value dropped (or reset to the kind's default).

    A hand-edited type file can hold ``allowedTypes: "server"`` or
    ``numberFormat: "x"``; passing those on would break the code reading them.
    """
    bad = option_shape_problems(options)
    if not bad:
        return options
    defaults = _default_options(kind, None)
    out = {k: v for k, v in options.items() if k not in bad}
    for k in bad:
        if k in defaults:
            out[k] = copy.deepcopy(defaults[k])
    return out


def _default_options(kind: str, is_array: bool | None) -> dict[str, Any]:
    if kind == "entity":
        return {
            "isArray": True if is_array is None else is_array,
            "allowedTypes": [],
            "hasFixedSet": False,
            "fixedSet": [],
        }
    if kind == "label":
        return {"isArray": bool(is_array), "set": []}
    if kind == "entity_tags":
        return {"isArray": True, "allowedTypes": ["tag"]}
    if kind == "entity_aliases":
        return {"isArray": True}
    if kind == "button":
        return {"ruleId": None}  # M14: the automation the button runs (our key)
    # M12: our kinds
    if kind == "formula":
        return {"expression": ""}
    if kind == "rollup":
        return {"relationId": "", "targetId": "", "calc": "showOriginal"}
    if kind == "uniqueId":
        return {"prefix": "", "nextNumber": 1}
    if kind == "files":
        return {"isArray": True}
    if is_array:
        return {"isArray": True}
    # M22: `steps`, `textList` and `floorItems` take no options; they fall through to `{}`.
    return {}


@dataclass
class PropertyDefinition:
    id: str
    key: str
    name: str
    type: str
    description: str = ""
    icon: Icon | None = None
    visibility: str = "alwaysShow"
    options: dict[str, Any] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)
    """Unknown fields (and ``isNotSearchable``), written back as they were."""
    synced: SyncedSpec | None = None
    """M29: the synced mark (top-level ``synced``); None when not synced. A malformed mark read
    from disk stays None and its raw value is kept in ``extra``."""

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> PropertyDefinition:
        """A definition from v1 (``isArray`` at the top) or v2 JSON. Raises on a malformed entry."""
        if not isinstance(data, dict):
            raise ValueError("Property entry is not an object")
        key, kind = data.get("key"), data.get("type")
        if not isinstance(key, str) or not key or not isinstance(kind, str) or not kind:
            raise ValueError("Property entry has no key or type")
        pid = data.get("id")
        pid = pid if isinstance(pid, str) and pid else key
        options = data.get("options")
        options = copy.deepcopy(options) if isinstance(options, dict) else {}
        options = normalize_options(kind, options)
        is_array = data.get("isArray")
        is_array = is_array if isinstance(is_array, bool) else None
        for k, v in _default_options(kind, is_array).items():
            options.setdefault(k, v)
        if is_array is not None:
            options["isArray"] = is_array
        name = data.get("name")
        icon = Icon.parse(data["icon"]) if "icon" in data else None
        if "icon" not in data and kind in PROPERTY_ICONS:
            icon = Icon("iconify", PROPERTY_ICONS[kind])
        visibility = data.get("visibility")
        if visibility not in ("alwaysShow", "hideWhenEmpty", "hidden"):
            visibility = "alwaysShow"
        known = _V1_PROP_KEYS | _V2_PROP_KEYS
        extra = {k: copy.deepcopy(v) for k, v in data.items() if k not in known}
        synced = SyncedSpec.parse(data.get("synced"))
        if synced is None and data.get("synced") is not None:
            extra["synced"] = copy.deepcopy(data["synced"])
        return cls(
            id=pid,
            key=key,
            name=name if isinstance(name, str) else key,
            type=kind,
            description=data.get("description") if isinstance(data.get("description"), str) else "",
            icon=icon,
            visibility=visibility,
            options=options,
            extra=extra,
            synced=synced,
        )

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "key": self.key,
            "name": self.name,
            "type": self.type,
            "description": self.description,
            "icon": self.icon.to_json() if self.icon else None,
            "visibility": self.visibility,
            "options": copy.deepcopy(self.options),
        }
        if self.synced is not None:
            out["synced"] = self.synced.to_json()
        for k, v in self.extra.items():
            out.setdefault(k, copy.deepcopy(v))
        return out


def _system_def(spec: tuple[str, str, str, str], extra_options: dict | None = None):
    key, kind, name, description = spec
    options = _default_options(kind, None)
    options.update(extra_options or {})
    return PropertyDefinition(
        id=key,
        key=key,
        name=name,
        type=kind,
        description=description,
        icon=Icon("iconify", PROPERTY_ICONS[kind]),
        options=options,
    )


def system_property_defs(include_type: bool = False) -> list[PropertyDefinition]:
    """Fresh system definitions in display order (``type`` last, when asked for)."""
    defs = [_system_def(s) for s in _SYSTEM_DEFS]
    if include_type:
        defs.append(_system_def(_TYPE_DEF))
    return defs


def _system_kind_for(key: str) -> str | None:
    for spec in (*_SYSTEM_DEFS, *_OPTIONAL_SYSTEM_DEFS.values()):
        if spec[0] == key:
            return spec[1]
    return None


# -- types -----------------------------------------------------------------------

_TYPE_KEYS = (
    "schemaVersion",
    "id",
    "name",
    "pluralName",
    "folder",
    "formerNames",
    "icon",
    "color",
    "description",
    "basic",
    "propertyDefinitions",
    "collectionsPropertyPosition",
    "viewDesign",
    "font",
    "wideLayoutMode",
    "wideCoverImage",
    "cropCoverImage",
    "templates",
    "namePatterns",  # M29
)


def _basic_name(name: str) -> str | None:
    """The canonical basic type name `name` matches (case-insensitively), or None."""
    low = name.lower()
    for n in (*BASIC_TYPE_NAMES, *BASIC_MEDIA_TYPES):
        if n.lower() == low:
            return n
    return None


@dataclass
class TypeDefinition:
    id: str
    name: str
    pluralName: str
    folder: str
    icon: Icon
    color: str
    formerNames: list[str] = field(default_factory=list)
    description: str = ""
    basic: bool = False
    propertyDefinitions: list[PropertyDefinition] = field(default_factory=list)
    collectionsPropertyPosition: int = 0
    viewDesign: str | None = None
    font: str = "sans-serif"
    wideLayoutMode: bool = False
    wideCoverImage: bool = False
    cropCoverImage: bool = True
    templates: dict[str, Any] = field(
        default_factory=lambda: {"ids": [], "defaultTemplateId": None}
    )
    schemaVersion: int = SCHEMA_VERSION
    extra: dict[str, Any] = field(default_factory=dict)
    """Unknown and store-only top-level keys, written back as they were."""
    invalid_property_entries: list[tuple[int, Any]] = field(default_factory=list)
    """Property entries that couldn't be read: (position, entry), written back verbatim."""
    readOnlyReason: str | None = None
    """API only: why the type can't be saved (its file isn't readable)."""
    namePatterns: list[str] = field(default_factory=list)
    """M29: the name patterns that suggest this type in a create row (`typesuggest`). Each entry
    as read: a hand-edited file's non-string entry is kept (and ignored by `typesuggest.matches`);
    a value that isn't a list stays in ``extra``. Written only when non-empty."""

    def prop(self, key: str) -> PropertyDefinition | None:
        return next((p for p in self.propertyDefinitions if p.key == key), None)

    # -- JSON ----------------------------------------------------------------

    @classmethod
    def from_json(cls, data: dict[str, Any], fallback_id: str | None = None) -> TypeDefinition:
        """Read v1 (no ``schemaVersion``) or v2 type JSON. Never raises on unknown keys."""
        data = copy.deepcopy(data)
        upgrade_keys(data)  # older key names (`keycompat`)
        v1 = "schemaVersion" not in data
        name = data.get("name")
        tid = data.get("id")
        if not isinstance(tid, str) or not tid:
            tid = fallback_id or slug(name if isinstance(name, str) else "type")
        if not isinstance(name, str) or not name.strip():
            name = tid
        basic_name = _basic_name(name)

        props: list[PropertyDefinition] = []
        invalid: list[tuple[int, Any]] = []
        entries = data.get("propertyDefinitions")
        entries = entries if isinstance(entries, list) else []
        for i, entry in enumerate(entries):
            try:
                props.append(PropertyDefinition.from_json(entry))
            except (ValueError, TypeError, AttributeError):
                invalid.append((i, entry))

        if v1:
            props = cls._migrate_props(name, basic_name, props)

        plural = data.get("pluralName")
        folder = data.get("folder")
        icon = Icon.parse(data.get("icon")) or Icon(
            "iconify", _TYPE_ICONS.get(basic_name or name, _DEFAULT_TYPE_ICON)
        )
        templates = data.get("templates")
        if not isinstance(templates, dict):
            templates = {}
        templates.setdefault("ids", [])
        templates.setdefault("defaultTemplateId", None)
        former = data.get("formerNames")
        view = data.get("viewDesign")
        font = data.get("font")
        position = data.get("collectionsPropertyPosition")
        patterns = data.get("namePatterns")
        extra = {k: v for k, v in data.items() if k not in _TYPE_KEYS and k not in _API_ONLY_KEYS}
        if "namePatterns" in data and not isinstance(patterns, list):
            extra["namePatterns"] = patterns
        return cls(
            id=tid,
            name=name,
            pluralName=plural if isinstance(plural, str) and plural else f"{name}s",
            folder=folder if isinstance(folder, str) else "",
            icon=icon,
            color=data["color"] if isinstance(data.get("color"), str) else "gray",
            formerNames=[f for f in former if isinstance(f, str)] if isinstance(former, list) else [],
            description=data["description"] if isinstance(data.get("description"), str) else "",
            basic=bool(data["basic"]) if "basic" in data else basic_name is not None,
            propertyDefinitions=props,
            collectionsPropertyPosition=position if isinstance(position, int) else 0,
            viewDesign=view if view in ("indexCard", "profile", "encyclopedia") else None,
            font=font if font in ("sans-serif", "serif", "monospace") else "sans-serif",
            wideLayoutMode=bool(data.get("wideLayoutMode", False)),
            wideCoverImage=bool(data.get("wideCoverImage", False)),
            cropCoverImage=bool(data.get("cropCoverImage", True)),
            templates=templates,
            extra=extra,
            invalid_property_entries=invalid,
            namePatterns=list(patterns) if isinstance(patterns, list) else [],
        )

    @staticmethod
    def _migrate_props(
        name: str, basic_name: str | None, props: list[PropertyDefinition]
    ) -> list[PropertyDefinition]:
        """v1 → v2: system keys become system defs (inserted in order), media fields too."""
        media = BASIC_MEDIA_TYPES.get(basic_name or "", {})
        by_key: dict[str, PropertyDefinition] = {}
        rest: list[PropertyDefinition] = []
        for p in props:
            system_kind = _system_kind_for(p.key)
            if system_kind is not None and p.key not in by_key:
                spec = next(
                    s for s in (*_SYSTEM_DEFS, *_OPTIONAL_SYSTEM_DEFS.values()) if s[0] == p.key
                )
                d = _system_def(spec)
                d.extra = p.extra
                by_key[p.key] = d
                continue
            if p.key in media:
                p.id = p.key
                p.type = media[p.key]
                p.options = {k: v for k, v in p.options.items() if k != "isArray"}
                p.icon = Icon("iconify", PROPERTY_ICONS.get(p.type, "ph-info"))
            if basic_name == "Task" and p.key == "status" and p.type == "label":
                p.options["isStatus"] = True
            if p.type == "label" and p.options.get("isStatus"):
                for opt in p.options.get("set", []):
                    if isinstance(opt, dict) and "statusCategory" not in opt:
                        opt["statusCategory"] = status_category(str(opt.get("text", "")))
            rest.append(p)
        out = [by_key.pop(s[0], None) or _system_def(s) for s in _SYSTEM_DEFS]
        optional = [by_key.pop(k) for k in _OPTIONAL_SYSTEM_DEFS if k in by_key]
        if basic_name == "Tag" and not any(p.key == "color" for p in optional):
            optional.append(_system_def(_OPTIONAL_SYSTEM_DEFS["color"]))
        return out + optional + rest

    def to_json(self) -> dict[str, Any]:
        props: list[Any] = [p.to_json() for p in self.propertyDefinitions]
        for index, entry in self.invalid_property_entries:
            props.insert(min(index, len(props)), copy.deepcopy(entry))
        out: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "id": self.id,
            "name": self.name,
            "pluralName": self.pluralName,
            "folder": self.folder,
            "formerNames": list(self.formerNames),
            "icon": self.icon.to_json(),
            "color": self.color,
            "description": self.description,
            "basic": self.basic,
            "propertyDefinitions": props,
            "collectionsPropertyPosition": self.collectionsPropertyPosition,
            "viewDesign": self.viewDesign,
            "font": self.font,
            "wideLayoutMode": self.wideLayoutMode,
            "wideCoverImage": self.wideCoverImage,
            "cropCoverImage": self.cropCoverImage,
            "templates": copy.deepcopy(self.templates),
        }
        if self.namePatterns:
            out["namePatterns"] = copy.deepcopy(self.namePatterns)
        for k, v in self.extra.items():
            out.setdefault(k, copy.deepcopy(v))
        return out

    def to_api(self, revision: str = "") -> dict[str, Any]:
        """The v2 JSON plus ``revision`` and ``readOnlyReason``."""
        out = self.to_json()
        out["readOnlyReason"] = self.readOnlyReason
        out["revision"] = revision
        return out


@dataclass(frozen=True)
class UnreadableType:
    """A type file that isn't valid JSON (or isn't an object): never written or replaced."""

    id: str
    path: str
    """Space-relative POSIX path of the file."""
    error: str


# -- files -----------------------------------------------------------------------


def _types_dir(root: Path) -> Path:
    return Path(root) / ".object" / "types"


def _backup_dir(root: Path) -> Path:
    return Path(root) / ".object" / "backup" / "types-v1"


def _revision_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _serialize(t: TypeDefinition) -> bytes:
    return (json.dumps(t.to_json(), indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def _parse(data: bytes) -> dict[str, Any]:
    """The JSON object in `data`; raises ValueError when it isn't one."""
    value = json.loads(decode(data).text)
    if not isinstance(value, dict):
        raise ValueError("Type file is not a JSON object")
    return value


def type_revision(root: Path, type_id: str) -> str:
    """The sha256 of ``types/<id>.json``, or ``''`` when there is no such file."""
    try:
        return _revision_of((_types_dir(root) / f"{type_id}.json").read_bytes())
    except FileNotFoundError:
        return ""


def write_type_json(
    root: Path,
    t: TypeDefinition,
    base_revision: str,
    before_write: Callable[[str, bytes], None] | None = None,
) -> str:
    """Write `t` to ``types/<id>.json`` if the file is still at `base_revision`.

    Returns the new revision. Raises `RevisionConflict` when the file changed and
    `TypeReadOnly` when the type (or the file on disk) can't be read. `before_write` (the
    space's version-history hook, 2026-11-08) is given the file's current bytes first.
    """
    if t.readOnlyReason:
        raise TypeReadOnly(t.readOnlyReason)
    path = _types_dir(root) / f"{t.id}.json"
    current = type_revision(root, t.id)
    if current:
        try:
            _parse(path.read_bytes())
        except (ValueError, UnicodeDecodeError) as exc:
            raise TypeReadOnly(f"The type file could not be read: {exc}") from exc
    if current != base_revision:
        raise RevisionConflict(current)
    data = _serialize(t)
    if before_write is not None and current:
        try:
            before_write(f".object/types/{t.id}.json", path.read_bytes())
        except OSError:
            pass

    def unchanged() -> None:
        now = type_revision(root, t.id)
        if now != current:
            raise RevisionConflict(now)

    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(path, data, check=unchanged)
    return _revision_of(data)


def _fill_from_inferred(t: TypeDefinition, inferred: TypeDefinition | None) -> None:
    """Give a migrated v1 type the label options and date preferences seen in its objects."""
    if inferred is None:
        return
    for p in t.propertyDefinitions:
        q = inferred.prop(p.key)
        if q is None or q.type != p.type:
            continue
        if p.type == "label" and not p.options.get("set"):
            p.options["set"] = copy.deepcopy(q.options.get("set", []))
            if p.options.get("isStatus"):
                for opt in p.options["set"]:
                    opt.setdefault("statusCategory", status_category(opt.get("text", "")))
        dated = p.type in ("datetime", "datetimeSimple")
        if dated and "constraints" not in p.options and "constraints" in q.options:
            p.options["constraints"] = copy.deepcopy(q.options["constraints"])


def _sorted(types: list[TypeDefinition]) -> list[TypeDefinition]:
    return sorted(types, key=lambda t: (t.name.lower(), t.name))


def load_types(
    root: Path, inferred: list[TypeDefinition] | None = None
) -> tuple[list[TypeDefinition], list[UnreadableType]]:
    """Read (and once, migrate) ``.object/types/*.json``.

    The only writes: when ``types/`` is missing, the inferred types (M1's first
    open); a v1 file's backup and its v2 rewrite; the built-in Page and Tag
    types when missing. A second load writes nothing. `inferred` lets a caller
    that has already scanned the space skip a second scan.
    """
    root = Path(root)
    if inferred is None:
        from .typedefs import infer_types_from, iter_object_paths, read_raw

        inferred = infer_types_from(read_raw(root, rel) for rel in iter_object_paths(root))
    inferred_by_id = {t.id: t for t in inferred}
    types_dir = _types_dir(root)

    loaded: list[TypeDefinition] = []
    unreadable: list[UnreadableType] = []
    if not types_dir.is_dir():
        for t in inferred:
            t = copy.deepcopy(t)
            write_type_json(root, t, type_revision(root, t.id))
            loaded.append(t)
    else:
        for f in sorted(types_dir.glob("*.json")):
            rel = f.relative_to(root).as_posix()
            original = f.read_bytes()
            try:
                data = _parse(original)
            except (ValueError, UnicodeDecodeError) as exc:
                unreadable.append(UnreadableType(f.stem, rel, str(exc)))
                continue
            t = TypeDefinition.from_json(data, fallback_id=f.stem)
            if "schemaVersion" not in data:
                _fill_from_inferred(t, inferred_by_id.get(t.id))
                backup = _backup_dir(root) / f.name
                if not backup.exists():
                    backup.parent.mkdir(parents=True, exist_ok=True)
                    atomic_write(backup, original)
                atomic_write(f, _serialize(t))
            loaded.append(t)

    known = {t.id for t in loaded} | {t.name.lower() for t in loaded} | {u.id for u in unreadable}
    for tid, seed in BUILTIN_TYPES.items():
        if tid in known or seed["name"].lower() in known:
            continue
        t = copy.deepcopy(inferred_by_id.get(tid)) or TypeDefinition.from_json(seed)
        write_type_json(root, t, type_revision(root, t.id))
        loaded.append(t)
    return _sorted(loaded), unreadable


def on_demand_type(type_id: str) -> TypeDefinition:
    """A fresh built-in Task or DailyNote (`ON_DEMAND_TYPES`), the Task with its fields."""
    return topup_task_type(TypeDefinition.from_json(ON_DEMAND_TYPES[type_id]))


def on_demand_types(
    known_ids: Iterable[str], known_names: Iterable[str]
) -> list[TypeDefinition]:
    """M32: the built-in Task and DailyNote a space lacks, for its in-memory type list.

    A type is left out when its id is in `known_ids` (a loaded, inferred or unreadable type, or
    a type file on disk) or its name is, case-insensitively, in `known_names` (the user's own
    "Task" stays the only one). Never writes.
    """
    ids = set(known_ids)
    names = {n.lower() for n in known_names}
    return [
        on_demand_type(tid)
        for tid, seed in ON_DEMAND_TYPES.items()
        if tid not in ids and seed["name"].lower() not in names
    ]


def write_starting_types(root: Path) -> list[Path]:
    """M32: write the types a **new** space starts with (Page, Tag, Task, DailyNote) into
    ``<root>/.object/types/``; return the written paths.

    Called only when a space is made (`spaces.create_space`), never by opening one. Nothing is
    replaced: a type whose file exists is left as it is.
    """
    root = Path(root)
    written: list[Path] = []
    for tid, seed in (*BUILTIN_TYPES.items(), *ON_DEMAND_TYPES.items()):
        path = _types_dir(root) / f"{tid}.json"
        if path.exists():
            continue
        write_type_json(root, topup_task_type(TypeDefinition.from_json(seed)), "")
        written.append(path)
    return written


# -- the Task fields (M4) ----------------------------------------------------------

_TASK_STATUS_TEXTS = ("Not Started", "Next Up", "In Progress", "On Hold", "Done")
_TASK_PRIORITY = (("low", "Low", "amber"), ("medium", "Medium", "orange"), ("high", "High", "red"))


def _task_field_defs() -> list[PropertyDefinition]:
    """Fresh definitions of the basic Task fields, plus
    our hidden ``repeat``, ``remind`` and (M8) ``occurrenceLog`` text fields, in the order
    they are appended."""

    def define(key, name, kind, icon, options=None, visibility="alwaysShow"):
        return PropertyDefinition.from_json(
            {
                "id": key,
                "key": key,
                "name": name,
                "type": kind,
                "description": "",
                "icon": {"type": "iconify", "val": icon},
                "visibility": visibility,
                "options": options or {},
            }
        )

    return [
        define(
            "status", "Status", "label", "ph-trend-up",
            {"isArray": False, "isStatus": True,
             "set": label_options(_TASK_STATUS_TEXTS, status=True)},
        ),
        define(
            "priority", "Priority", "label", "ph-flag",
            {"isArray": False,
             "set": [{"id": i, "text": t, "color": c, "icon": None} for i, t, c in _TASK_PRIORITY]},
        ),
        define(
            "date", "Date", "datetimeSimple", "ph-calendar",
            {"constraints": {"resolutionPreference": "day", "endTimeSettings": "notAllowed",
                             "supportsReminders": True}},
        ),
        define(
            "deadline", "Deadline", "datetimeSimple", "ph-hourglass-medium",
            {"constraints": {"resolutionPreference": "day", "endTimeSettings": "notAllowed"}},
        ),
        define(
            "completed", "Completed", "datetimeSimple", "ph-calendar-check",
            {"constraints": {"resolutionPreference": "time", "endTimeSettings": "notAllowed"}},
            visibility="hidden",
        ),
        define("repeat", "Repeat", "text", PROPERTY_ICONS["text"], visibility="hidden"),
        define("remind", "Remind", "text", PROPERTY_ICONS["text"], visibility="hidden"),
        # M8: the recurrence's occurrence log ("Occurrence log" is our string).
        define("occurrenceLog", "Occurrence log", "text", PROPERTY_ICONS["text"],
               visibility="hidden"),
    ]  # fmt: skip


# Fields the basic media types define beyond the ones we store (key -> name, kind).
# Label fields start with a built-in option set (`_MEDIA_LABEL_SETS`); the user edits it.
_MEDIA_EXTRA_FIELDS: dict[str, tuple[tuple[str, str, str], ...]] = {
    "PDF": (
        ("numberOfPages", "Number of Pages", "number"),
        ("tableOfContents", "Table of Contents", "boolean"),
        ("documentType", "Document type", "label"),
        ("topic", "Topic", "label"),
    ),
    "Image": (("category", "Category", "label"), ("colors", "Colors", "label")),
    "Weblink": (("category", "Category", "label"), ("topic", "Topic", "label")),
    "Audio": (
        ("duration", "Duration", "number"),
        ("origin", "Origin", "text"),
        ("category", "Category", "label"),
    ),
}


# The option sets for those label fields: (option id, en-US text), in the
# order of their ids. Option colours are our choice (round-robin, and for
# Image "Colors" the theme colour of the same name where there is one).
_MEDIA_LABEL_SETS: dict[tuple[str, str], tuple[tuple[str, str], ...]] = {
    ("PDF", "documentType"): (
        ("academic-paper", "Academic paper"), ("article", "Article"), ("book", "Book"),
        ("educational-material", "Educational material"),
        ("financial-document", "Financial document"), ("form", "Form"),
        ("legal-document", "Legal document"), ("letter", "Letter"), ("manual", "Manual"),
        ("marketing-material", "Marketing material"), ("other", "Other"),
        ("policy-document", "Policy document"), ("presentation", "Presentation"),
        ("report", "Report"), ("scanned-document", "Scanned document"),
    ),
    ("PDF", "topic"): (
        ("ai-ml", "AI/ML"), ("arts-culture", "Arts & culture"), ("business", "Business"),
        ("design", "Design"), ("education", "Education"), ("finance", "Finance"),
        ("government", "Government"), ("history", "History"), ("legal", "Legal"),
        ("marketing", "Marketing"), ("medicine", "Medicine"), ("operations", "Operations"),
        ("other", "Other"), ("personal", "Personal"), ("policy", "Policy"),
        ("product", "Product"), ("programming", "Programming"), ("research", "Research"),
        ("science", "Science"), ("technology", "Technology"),
    ),
    ("Image", "category"): (
        ("book-page", "Book Page"), ("business-card", "Business Card"), ("code", "Code"),
        ("cover", "Cover"), ("diagram", "Diagram"), ("document", "Document"),
        ("handwritten-note", "Handwritten Note"), ("illustration", "Illustration"),
        ("infographic", "Infographic"), ("logo-icon", "Logo/Icon"), ("map", "Map"),
        ("medical", "Medical"), ("meme", "Meme"), ("other", "Other"), ("painting", "Painting"),
        ("photo-animal", "Photo (Animal)"), ("photo-architecture", "Photo (Architecture)"),
        ("photo-event", "Photo (Event)"), ("photo-food", "Photo (Food)"),
        ("photo-nature", "Photo (Nature)"), ("photo-object", "Photo (Object)"),
        ("photo-people", "Photo (People)"), ("receipt", "Receipt"),
        ("scientific", "Scientific"), ("screenshot", "Screenshot"),
        ("ui-mockup", "UI Mockup"), ("whiteboard", "Whiteboard"),
    ),
    ("Image", "colors"): (
        ("beige", "Beige"), ("black", "Black"), ("blue", "Blue"), ("brown", "Brown"),
        ("cyan", "Cyan"), ("fuchsia", "Fuchsia"), ("gold", "Gold"), ("gray", "Gray"),
        ("green", "Green"), ("indigo", "Indigo"), ("magenta", "Magenta"),
        ("orange", "Orange"), ("pink", "Pink"), ("purple", "Purple"), ("red", "Red"),
        ("tan", "Tan"), ("teal", "Teal"), ("turquoise", "Turquoise"), ("violet", "Violet"),
        ("white", "White"), ("yellow", "Yellow"),
    ),
    ("Weblink", "category"): (
        ("about", "About"), ("app", "App"), ("article", "Article"), ("audio", "Audio"),
        ("blog-post", "Blog Post"), ("code", "Code"), ("course", "Course"),
        ("documentation", "Documentation"), ("event", "Event"),
        ("forum-thread", "Forum Thread"), ("guide", "Guide"), ("how-to", "How-To"),
        ("image-gallery", "Image Gallery"), ("infographic", "Infographic"),
        ("marketplace", "Marketplace"), ("news", "News"), ("other", "Other"),
        ("podcast", "Podcast"), ("portfolio", "Portfolio"), ("product", "Product"),
        ("profile", "Profile"), ("q-and-a", "Q&A"), ("recipe", "Recipe"),
        ("repository", "Repository"), ("service", "Service"), ("shop", "Shop"),
        ("social-post", "Social Post"), ("tool", "Tool"), ("tutorial", "Tutorial"),
        ("video", "Video"), ("webinar", "Webinar"),
    ),
    ("Weblink", "topic"): (
        ("academic", "Academic"), ("ai-ml", "AI/ML"), ("art", "Art"), ("business", "Business"),
        ("creative", "Creative"), ("current-events", "Current Events"), ("design", "Design"),
        ("education", "Education"), ("entertainment", "Entertainment"),
        ("finance", "Finance"), ("fitness", "Fitness"), ("food", "Food"),
        ("gaming", "Gaming"), ("health", "Health"), ("learning", "Learning"),
        ("lifestyle", "Lifestyle"), ("marketing", "Marketing"), ("media", "Media"),
        ("news", "News"), ("other", "Other"), ("politics", "Politics"),
        ("productivity", "Productivity"), ("programming", "Programming"),
        ("research", "Research"), ("science", "Science"), ("technology", "Technology"),
        ("tools", "Tools"), ("travel", "Travel"), ("wellness", "Wellness"),
    ),
    ("Audio", "category"): (
        ("ambient", "Ambient"), ("dictation", "Dictation"), ("interview", "Interview"),
        ("lecture", "Lecture"), ("meeting", "Meeting"), ("music", "Music"), ("other", "Other"),
        ("phone-call", "Phone Call"), ("podcast", "Podcast"), ("voice-memo", "Voice Memo"),
    ),
}  # fmt: skip


def _media_label_set(name: str, key: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, (oid, text) in enumerate(_MEDIA_LABEL_SETS.get((name, key), ())):
        color = THEME_COLORS[(i + 7) % len(THEME_COLORS)]
        if key == "colors" and oid in THEME_COLORS:
            color = oid
        out.append({"id": oid, "text": text, "color": color, "icon": None})
    return out


def _media_field_defs(name: str) -> list[PropertyDefinition]:
    out = []
    for key, label, kind in _MEDIA_EXTRA_FIELDS.get(name, ()):
        options: dict[str, Any] = (
            {"isArray": key == "colors", "set": _media_label_set(name, key)} if kind == "label" else {}
        )
        out.append(
            PropertyDefinition.from_json(
                {
                    "id": key, "key": key, "name": label, "type": kind, "description": "",
                    "icon": {"type": "iconify", "val": PROPERTY_ICONS[kind]},
                    "visibility": "alwaysShow", "options": options,
                }
            )
        )  # fmt: skip
    return out


def is_task_type(t: TypeDefinition | None) -> bool:
    """True for the basic Task type."""
    return t is not None and t.basic and _basic_name(t.name) == "Task"


# The en-US names of the basic media fields, and the media types' plural names (our strings).
_MEDIA_FIELD_NAMES = {
    "url": "URL", "domain": "Domain", "iframeUrl": "Embed URL", "previewImage": "Preview image",
    "mimeType": "MIME type", "fileSize": "File size", "width": "Width", "height": "Height", "source": "Source",
}  # fmt: skip
_MEDIA_PLURALS = {
    "Weblink": "Weblinks", "File": "Files", "Image": "Images", "PDF": "PDFs", "Audio": "Audio", "Video": "Videos",
    "Tweet": "Tweets",
}  # fmt: skip


def basic_media_type(name: str, type_id: str) -> TypeDefinition:
    """A fresh basic media type (Image, PDF, File, ...): the system properties, its media fields
    as read-only system definitions (``id == key``) and the extra fields `topup_task_type` gives
    it, read as a v1 seed like `BUILTIN_TYPES`. Raises ``KeyError`` for a name that is no media type."""
    basic = _basic_name(name)
    if basic not in BASIC_MEDIA_TYPES:
        raise KeyError(name)
    plural = _MEDIA_PLURALS[basic]
    seed = {
        "id": type_id,
        "name": basic,
        "pluralName": plural,
        "folder": plural,
        "icon": _TYPE_ICONS.get(basic, _DEFAULT_TYPE_ICON),
        "color": "gray",
        "basic": True,
        "propertyDefinitions": [
            {"id": k, "key": k, "name": _MEDIA_FIELD_NAMES.get(k, k), "type": kind}
            for k, kind in BASIC_MEDIA_TYPES[basic].items()
        ],
    }
    return topup_task_type(TypeDefinition.from_json(seed))


def topup_task_type(t: TypeDefinition) -> TypeDefinition:
    """Give the basic Task type the Task fields it lacks, in memory; return ``t``.

    Each missing key of ``status``, ``priority``, ``date``, ``deadline``,
    ``completed``, ``repeat``, ``remind`` and ``occurrenceLog`` is appended after the existing
    properties (the basic PDF, Image, Weblink and Audio types likewise get the fields
    defined for them, in ``_MEDIA_EXTRA_FIELDS``); a key the type already defines keeps its own definition and
    options. Any other type comes back untouched. Never writes: the fields reach
    ``task.json`` the first time the type is persisted.
    """
    media = _basic_name(t.name) if t.basic else None
    if media in _MEDIA_EXTRA_FIELDS:
        have = {p.key for p in t.propertyDefinitions}
        t.propertyDefinitions.extend(p for p in _media_field_defs(media) if p.key not in have)
        return t
    if not is_task_type(t):
        return t
    have = {p.key for p in t.propertyDefinitions}
    for p in _task_field_defs():
        if p.key not in have:
            t.propertyDefinitions.append(p)
    return t
