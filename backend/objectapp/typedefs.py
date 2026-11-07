"""Scanning a space's object files, and inferring object types from them.

`infer_types_from` turns the objects' ``type`` frontmatter field (objects
without valid frontmatter count as ``Page``) into `TypeDefinition`s. They go
through the same `TypeDefinition.from_json` migration as stored M1 types, and
are kept in memory until the user saves them (see `typemodel.load_types`).
"""

from __future__ import annotations

import os
import re
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any

from . import fmcache
from .frontmatter import FrontmatterError, parse_fm
from .objfile import ObjectFile, split_object
from .textfile import decode

if TYPE_CHECKING:
    from .typemodel import TypeDefinition

__all__ = [
    "DEFAULT_TYPE",
    "SYSTEM_KEYS",
    "RawObject",
    "has_undecodable",
    "infer_types_from",
    "is_ignored",
    "iter_object_paths",
    "read_raw",
    "slug",
]

DEFAULT_TYPE = "Page"

# Reserved keys: never the key of a new property (see the plan's "Keys").
SYSTEM_KEYS = frozenset(
    {
        "id", "type", "template", "title", "icon", "iconColor", "description", "aliases",
        "tags", "collections", "createdAt", "lastUpdated", "coverImage", "color",
        # basic media fields
        "url", "domain", "iframeUrl", "previewImage", "mimeType", "fileSize", "width",
        "height", "source",
        # DailyNote
        "date", "reviewed",
        # M9 per-object layout (wideLayoutMode, wideCoverImage, coverImageOffset)
        # and page view (defaultPageViewId, kept as it is)
        "wideLayoutMode", "wideCoverImage", "coverImageOffset", "defaultPageViewId",
        # the property-pane toggle (hideProperties; polish item 17)
        "hideProperties",
        # M25 import provenance (one nested system block, never a property)
        "importSource",
    }
)

# Keys the app manages itself: never inferred as properties. (Reserved keys that
# are system or basic properties - tags, coverImage, media fields... - are
# inferred, and the migration turns them into system definitions.)
_UNINFERRED_KEYS = frozenset(
    {"id", "type", "template", "title", "icon", "iconColor", "description", "aliases",
     "createdAt", "lastUpdated", "wideLayoutMode", "wideCoverImage", "coverImageOffset",
     "defaultPageViewId", "hideProperties", "importSource"}
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
_DAY_RE = re.compile(r"\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?Z)?")

# String-valued keys that are labels (option sets) by convention.
_LABEL_KEYS = frozenset({"status", "priority", "category", "stage", "state", "kind", "level"})

_DATE_RE = re.compile(
    r"\d{4}-\d{2}-\d{2}"
    r"(?:[Tt ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?"
    r"(?:\s*->\s*\d{4}-\d{2}-\d{2}\S*)?"
)
_URL_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9+.-]*://\S+")
_WIKILINK_RE = re.compile(r"\[\[[^\[\]]+\]\]")


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
    readOnlyReason: str | None = None
    """Why the object can't be saved (None when it can)."""


_UNDECODABLE_RE = re.compile("[\udc80-\udcff]")


def has_undecodable(text: str) -> bool:
    """True when `text` holds bytes that weren't valid UTF-8 (kept as surrogate escapes)."""
    return _UNDECODABLE_RE.search(text) is not None


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if not s:
        # A name with no ASCII letters or digits (e.g. CJK) keeps its own letters,
        # so two such names don't both become `type`.
        s = "-".join("".join(c if c.isalnum() else " " for c in name.lower()).split())
    # Ids name files (`<id>.json`): a very long name must not make one too long.
    s = s[:_MAX_SLUG].rstrip("-")
    return s or "type"


_MAX_SLUG = 64


def is_ignored(rel: PurePosixPath) -> bool:
    """Dot-folders (``.object``, ``.object-cache``, ``.git``…) are not part of the space."""
    return any(part.startswith(".") for part in rel.parts[:-1])


def iter_object_paths(root: Path) -> Iterator[str]:
    """Every ``*.md`` object file under `root`, as sorted space-relative POSIX paths.

    The suffix matches in any case (``Note.MD``), as `Space._rel` and the watcher accept
    it on every system; dot-folders are not entered.
    """
    root = Path(root)
    found = []
    for folder, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        base = PurePosixPath(Path(folder).relative_to(root).as_posix())
        for name in files:
            if name.startswith(".") or not name.lower().endswith(".md"):
                continue
            if not os.path.isfile(os.path.join(folder, name)):
                continue
            rel = base / name
            if is_ignored(rel):
                continue
            found.append(rel.as_posix())
    yield from sorted(found)


def read_raw(root: Path, rel: str, cache: bool = True) -> RawObject:
    """Read one object file. With ``cache``, the parsed frontmatter of an unchanged
    source comes from the space's `fmcache` (a file outside the space's objects).
    """
    path = Path(root) / rel
    data = path.read_bytes()

    tf = decode(data)
    undecodable = has_undecodable(tf.text)
    text = tf.text
    if undecodable:
        # Read-only (below): show the bad bytes as U+FFFD; this text is never written.
        text = text.encode("utf-8", errors="surrogateescape").decode("utf-8", errors="replace")
    of = split_object(text)
    fm: dict = {}
    read_only = not of.fm_ok
    reason = of.fm_error if read_only else None
    if of.fm_ok and of.frontmatter_src is not None:
        store = fmcache.for_root(root) if cache else None
        cached = store.get(rel, of.frontmatter_src) if store is not None else None
        if cached is not None:
            fm = cached
        else:
            try:
                fm = parse_fm(of.frontmatter_src)
            except FrontmatterError as exc:
                fm = {}
                read_only = True
                reason = f"Frontmatter is not valid YAML: {exc}"
            else:
                if store is not None:
                    store.put(rel, of.frontmatter_src, fm)
    type_name = DEFAULT_TYPE
    if not read_only:
        t = fm.get("type")
        if isinstance(t, str) and t.strip():
            type_name = t.strip()
    if not read_only and undecodable:
        # Saving would have to re-encode bytes the editor never saw correctly.
        read_only = True
        reason = "The file is not valid UTF-8 text"
    return RawObject(
        path=rel,
        data=data,
        of=of,
        fm=fm,
        readOnly=read_only,
        typeName=type_name,
        readOnlyReason=reason or ("Object is read-only" if read_only else None),
    )


def _kind_of(key: str, values: list[Any]) -> tuple[str, bool]:
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


def _label_texts(values: list[Any]) -> list[str]:
    seen: list[str] = []
    for v in values:
        for i in v if isinstance(v, list) else [v]:
            if i is None or isinstance(i, (dict, list)):
                continue
            text = str(i).strip()
            if text and text not in seen:
                seen.append(text)
    return seen


def _inferred_options(type_name: str, key: str, kind: str, values: list[Any]) -> dict[str, Any]:
    from .typemodel import label_options

    if kind == "label":
        status = type_name == "Task" and key == "status"
        options: dict[str, Any] = {"set": label_options(_label_texts(values), status=status)}
        if status:
            options["isStatus"] = True
        return options
    if kind == "datetime":
        strs = [str(v).strip() for v in values if v is not None]
        if strs and all(_DAY_RE.fullmatch(s) for s in strs):
            return {"constraints": {"resolutionPreference": "day"}}
    return {}


def infer_types_from(objects: Iterable[RawObject]) -> list[TypeDefinition]:
    """Infer type definitions from already-read objects. Ordered by name.

    Each type is built in M1's (v1) shape, plus inferred label options and date
    preferences, and read through `TypeDefinition.from_json`.
    """
    from .typemodel import TypeDefinition

    folders: dict[str, Counter[str]] = {}
    keys: dict[str, dict[str, list[Any]]] = {}
    for obj in objects:
        if not obj.readOnly and obj.fm.get("template") not in (None, ""):
            continue  # templates neither make a type nor add its properties
        folders.setdefault(obj.typeName, Counter())[PurePosixPath(obj.path).parent.as_posix()] += 1
        per_key = keys.setdefault(obj.typeName, {})
        if obj.readOnly:
            continue
        for k, v in obj.fm.items():
            if isinstance(k, str) and k not in _UNINFERRED_KEYS:
                per_key.setdefault(k, []).append(v)

    types: list[TypeDefinition] = []
    for i, name in enumerate(sorted(folders, key=lambda n: (n.lower(), n))):
        counts = folders[name]
        folder = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        folder = "" if folder == "." else folder
        props = []
        for key, values in keys[name].items():
            kind, is_array = _kind_of(key, values)
            prop: dict[str, Any] = {
                "id": key,
                "key": key,
                "name": _humanize(key),
                "type": kind,
                "isArray": is_array,
            }
            options = _inferred_options(name, key, kind, values)
            if options:
                prop["options"] = options
            props.append(prop)
        types.append(
            TypeDefinition.from_json(
                {
                    "id": slug(name),
                    "name": name,
                    "pluralName": PurePosixPath(folder).name if folder else f"{name}s",
                    "folder": folder,
                    "icon": _ICONS.get(name, _DEFAULT_ICON),
                    "color": _COLORS[i % len(_COLORS)],
                    "propertyDefinitions": props,
                }
            )
        )
    return types
