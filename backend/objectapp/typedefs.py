"""Object types: inference from a space's files, and their JSON definitions.

A space without ``.capacities/types/`` gets its types inferred from the
objects' ``type`` frontmatter field (objects without valid frontmatter count as
``Page``). `load_types` writes the inferred definitions once, to
``.capacities/types/<id>.json``, and from then on reads them back.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Literal

from .frontmatter import FrontmatterError, parse_fm
from .objfile import ObjectFile, split_object
from .textfile import atomic_write, decode, read_text

__all__ = [
    "DEFAULT_TYPE",
    "PropertyDef",
    "PropertyKind",
    "RawObject",
    "SYSTEM_KEYS",
    "TypeDef",
    "infer_types",
    "infer_types_from",
    "is_ignored",
    "iter_object_paths",
    "load_types",
    "read_raw",
    "slug",
]

PropertyKind = Literal["text", "number", "boolean", "url", "datetime", "label", "entity", "blocks"]

DEFAULT_TYPE = "Page"

# Frontmatter keys the app manages itself; never property definitions.
SYSTEM_KEYS = frozenset(
    {"id", "type", "title", "icon", "createdAt", "lastUpdated", "aliases", "description"}
)

_ICONS = {
    "Task": "ph-check-circle",
    "Person": "ph-user",
    "Server": "ph-hard-drives",
    "DailyNote": "ph-calendar-blank",
    "Page": "ph-file-text",
}
_DEFAULT_ICON = "ph-cube"
_COLORS = ["blue", "green", "orange", "purple", "pink", "teal", "yellow", "red"]

# String-valued keys that are labels (option sets) by convention.
_LABEL_KEYS = frozenset({"status", "priority", "category", "stage", "state", "kind", "level"})

_DATE_RE = re.compile(
    r"\d{4}-\d{2}-\d{2}"
    r"(?:[Tt ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?"
    r"(?:\s*->\s*\d{4}-\d{2}-\d{2}\S*)?"
)
_URL_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9+.-]*://\S+")
_WIKILINK_RE = re.compile(r"\[\[[^\[\]]+\]\]")


@dataclass
class PropertyDef:
    id: str
    key: str
    name: str
    type: PropertyKind
    isArray: bool = False


@dataclass
class TypeDef:
    id: str
    name: str
    pluralName: str
    folder: str
    icon: str
    color: str
    propertyDefinitions: list[PropertyDef] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> TypeDef:
        props = [PropertyDef(**p) for p in data.get("propertyDefinitions", [])]
        return cls(
            id=data["id"],
            name=data["name"],
            pluralName=data.get("pluralName", data["name"]),
            folder=data.get("folder", ""),
            icon=data.get("icon", _DEFAULT_ICON),
            color=data.get("color", _COLORS[0]),
            propertyDefinitions=props,
        )


@dataclass(frozen=True)
class RawObject:
    """One object file as read from disk (never written back from here)."""

    path: str
    """Space-relative POSIX path, e.g. ``Tasks/Write docs.md``."""
    data: bytes
    of: ObjectFile
    fm: dict
    readOnly: bool
    typeName: str


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "type"


def is_ignored(rel: PurePosixPath) -> bool:
    """Dot-folders (``.capacities``, ``.capacities-cache``, ``.git``…) are not part of the space."""
    return any(part.startswith(".") for part in rel.parts[:-1])


def iter_object_paths(root: Path) -> Iterator[str]:
    """Every ``*.md`` object file under `root`, as sorted space-relative POSIX paths."""
    root = Path(root)
    found = []
    for p in root.rglob("*.md"):
        rel = PurePosixPath(p.relative_to(root).as_posix())
        if is_ignored(rel) or rel.name.startswith(".") or not p.is_file():
            continue
        found.append(rel.as_posix())
    yield from sorted(found)


def read_raw(root: Path, rel: str) -> RawObject:
    path = Path(root) / rel
    data = path.read_bytes()

    tf = decode(data)
    of = split_object(tf.text)
    fm: dict = {}
    read_only = not of.fm_ok
    if of.fm_ok and of.frontmatter_src is not None:
        try:
            fm = parse_fm(of.frontmatter_src)
        except FrontmatterError:
            fm = {}
            read_only = True
    type_name = DEFAULT_TYPE
    if not read_only:
        t = fm.get("type")
        if isinstance(t, str) and t.strip():
            type_name = t.strip()
    return RawObject(path=rel, data=data, of=of, fm=fm, readOnly=read_only, typeName=type_name)


def _kind_of(key: str, values: list[Any]) -> tuple[PropertyKind, bool]:
    values = [v for v in values if v is not None]
    if not values:
        return "text", False
    if any(isinstance(v, list) for v in values):
        items = [i for v in values for i in (v if isinstance(v, list) else [v]) if i is not None]
        if items and all(isinstance(i, str) and _WIKILINK_RE.fullmatch(i.strip()) for i in items):
            return "entity", True
        return "label", True
    if all(isinstance(v, bool) for v in values):
        return "boolean", False
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
        return "number", False
    if not all(isinstance(v, str) for v in values):
        return "text", False
    strs = [v.strip() for v in values]
    if all(_WIKILINK_RE.fullmatch(s) for s in strs):
        return "entity", False
    if all(_URL_RE.fullmatch(s) for s in strs):
        return "url", False
    if all(_DATE_RE.fullmatch(s) for s in strs):
        return "datetime", False
    if key in _LABEL_KEYS:
        return "label", False
    if len(strs) > 1 and len(set(strs)) < len(strs) and all("\n" not in s for s in strs):
        return "label", False
    return "text", False


def _humanize(key: str) -> str:
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", key).replace("_", " ").replace("-", " ")
    return words[:1].upper() + words[1:]


def infer_types_from(objects: Iterable[RawObject]) -> list[TypeDef]:
    """Infer type definitions from already-read objects. Ordered by name."""
    folders: dict[str, Counter[str]] = {}
    keys: dict[str, dict[str, list[Any]]] = {}
    for obj in objects:
        folders.setdefault(obj.typeName, Counter())[PurePosixPath(obj.path).parent.as_posix()] += 1
        per_key = keys.setdefault(obj.typeName, {})
        if obj.readOnly:
            continue
        for k, v in obj.fm.items():
            if isinstance(k, str) and k not in SYSTEM_KEYS:
                per_key.setdefault(k, []).append(v)

    types: list[TypeDef] = []
    for i, name in enumerate(sorted(folders, key=lambda n: (n.lower(), n))):
        counts = folders[name]
        folder = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        folder = "" if folder == "." else folder
        props = []
        for key, values in keys[name].items():
            kind, is_array = _kind_of(key, values)
            props.append(PropertyDef(id=key, key=key, name=_humanize(key), type=kind, isArray=is_array))
        types.append(
            TypeDef(
                id=slug(name),
                name=name,
                pluralName=PurePosixPath(folder).name if folder else f"{name}s",
                folder=folder,
                icon=_ICONS.get(name, _DEFAULT_ICON),
                color=_COLORS[i % len(_COLORS)],
                propertyDefinitions=props,
            )
        )
    return types


def infer_types(root: Path) -> list[TypeDef]:
    return infer_types_from(read_raw(root, rel) for rel in iter_object_paths(root))


def _types_dir(root: Path) -> Path:
    return Path(root) / ".capacities" / "types"


def load_types(root: Path, inferred: list[TypeDef] | None = None) -> list[TypeDef]:
    """Read ``.capacities/types/*.json``; if that folder is missing, infer and write it.

    `inferred` lets a caller that has already scanned the space skip a second scan.
    Existing type files are never rewritten.
    """
    types_dir = _types_dir(root)
    if types_dir.is_dir():
        loaded = []
        for f in sorted(types_dir.glob("*.json")):
            try:
                loaded.append(TypeDef.from_json(json.loads(read_text(f).text)))
            except (ValueError, KeyError, TypeError):
                continue
        return sorted(loaded, key=lambda t: (t.name.lower(), t.name))

    types = inferred if inferred is not None else infer_types(root)
    types_dir.mkdir(parents=True, exist_ok=True)
    for t in types:
        data = (json.dumps(t.to_json(), indent=2, ensure_ascii=False) + "\n").encode("utf-8")
        atomic_write(types_dir / f"{t.id}.json", data)
    return types
