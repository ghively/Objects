"""Object types, v2: the full Object-shaped type model and its lossless migration.

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
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .textfile import atomic_write, decode
from .typedefs import slug

__all__ = [
    "BASIC_MEDIA_TYPES",
    "BASIC_TYPE_NAMES",
    "BUILTIN_TYPES",
    "PROPERTY_ICONS",
    "THEME_COLORS",
    "Icon",
    "LabelOption",
    "PropertyDefinition",
    "RevisionConflict",
    "TypeDefinition",
    "TypeReadOnly",
    "UnreadableType",
    "load_types",
    "status_category",
    "system_property_defs",
    "type_revision",
    "write_type_json",
]

SCHEMA_VERSION = 2

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

# Default property icons, as Object's `propertyIcons`.
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
}

# (key, kind, en-US name, description) of the system properties, in order.
_SYSTEM_DEFS = (
    ("title", "entity_title", "Title", "The title serves as the main identifier for any entry"),
    ("collections", "entity_collections", "Collections", "Collections this content is included in"),
    (
        "description",
        "entity_description",
        "Description",
        "Additional information to further describe an item",
    ),
    ("createdAt", "entity_createdAt", "Created at", "Date and time of creation"),
    ("lastUpdated", "entity_lastUpdated", "Last updated", "Date and time of last edit"),
    ("tags", "entity_tags", "Tags", "General tags of this content"),
    ("icon", "entity_icon", "Icon", "A quick visual identifier"),
    ("aliases", "entity_aliases", "Aliases", "Additional names for this content"),
)
_TYPE_DEF = ("type", "entity_type", "Object type", "The type of this content")
# System properties a type only has once they are added.
_OPTIONAL_SYSTEM_DEFS = {
    "type": _TYPE_DEF,
    "backlinks": ("backlinks", "entity_backlinks", "Backlinks", ""),
    "coverImage": ("coverImage", "coverImage", "Cover image", ""),
    "color": ("color", "color", "Color", ""),
}

BASIC_TYPE_NAMES = ("Page", "Tag", "Task", "DailyNote")

# Object's media types: their fields become read-only system definitions.
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

_STATUS_CATEGORIES = {
    "not started": "not-started",
    "next up": "not-started",
    "in progress": "in-progress",
    "on hold": "blocked",
    "blocked": "blocked",
    "done": "done",
    "complete": "done",
}
# Object's colours for the basic Task status options.
_STATUS_COLORS = {
    "not started": "red",
    "next up": "yellow",
    "in progress": "blue",
    "on hold": "pink",
    "done": "green",
}

_ICONIFY_RE = re.compile(r"^[a-z0-9]+(?:[-:][a-z0-9]+)+$")
_V1_PROP_KEYS = frozenset({"id", "key", "name", "type", "isArray"})
_V2_PROP_KEYS = frozenset(
    {"id", "key", "name", "type", "description", "icon", "visibility", "options"}
)
_API_ONLY_KEYS = frozenset({"revision", "readOnlyReason"})


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
    """Option JSON for observed label texts, coloured round-robin (status: Object's colours)."""
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


def option_shape_problems(options: Any) -> list[str]:
    """The option keys whose value has the wrong shape (see `normalize_options`)."""
    if not isinstance(options, dict):
        return ["options"]
    bad: list[str] = []
    for key in ("allowedTypes", "fixedSet"):
        if key in options and not _str_list(options[key]):
            bad.append(key)
    for key in ("isArray", "hasFixedSet"):
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
    if is_array:
        return {"isArray": True}
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
        return cls(
            id=pid,
            key=key,
            name=name if isinstance(name, str) else key,
            type=kind,
            description=data.get("description") if isinstance(data.get("description"), str) else "",
            icon=icon,
            visibility=visibility,
            options=options,
            extra={k: copy.deepcopy(v) for k, v in data.items() if k not in known},
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
    """Fresh system definitions in Object's order (``type`` last, when asked for)."""
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

    def prop(self, key: str) -> PropertyDefinition | None:
        return next((p for p in self.propertyDefinitions if p.key == key), None)

    # -- JSON ----------------------------------------------------------------

    @classmethod
    def from_json(cls, data: dict[str, Any], fallback_id: str | None = None) -> TypeDefinition:
        """Read v1 (no ``schemaVersion``) or v2 type JSON. Never raises on unknown keys."""
        data = copy.deepcopy(data)
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
            extra={
                k: v for k, v in data.items() if k not in _TYPE_KEYS and k not in _API_ONLY_KEYS
            },
            invalid_property_entries=invalid,
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


def write_type_json(root: Path, t: TypeDefinition, base_revision: str) -> str:
    """Write `t` to ``types/<id>.json`` if the file is still at `base_revision`.

    Returns the new revision. Raises `RevisionConflict` when the file changed and
    `TypeReadOnly` when the type (or the file on disk) can't be read.
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
