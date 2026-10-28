"""A space: a folder of object files, scanned into summaries, types and a link index.

Reading, listing, resolving and opening objects never write an object file.
The only writes `Space` makes on its own are inside ``.object/`` (see
`typemodel.load_types`): the first-open type JSON, the one-time v1 type
migration, and the built-in Page and Tag types when missing.

Every write to an object file goes through `Space._write` (re-read, version and
read-only checks, edit, optional stamp, `encode_like`, ``own_writes``,
`atomic_write` with a re-check, `rescan_file`). Rewrites of *other* files on the
user's behalf use `Space._rewrite_other`, which retries once on a conflict and
otherwise reports a `Skip` instead of overwriting.

Objects are created with `Space.create_object` and deleted to the app's own
trash (`trash.Trash`, in ``.object/trash/``) with `Space.delete_object`;
types go there with `Space.trash_type`. Opening the space purges trash entries
older than 30 days.
"""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import os
import random
import re
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, tzinfo
from pathlib import Path, PurePosixPath
from typing import Any

from ruamel.yaml.scalarstring import SingleQuotedScalarString

from .changetype import (
    CARRIED_KEYS,
    CHANGE_FROM_ALLOWED,
    CHANGE_TO_ALLOWED,
    MappingRow,
    compatible,
    mapping_targets,
    remembered_mapping,
    save_change_type_preference,
    suggest_mapping,
    type_category,
)
from .frontmatter import (
    FlowList,
    FrontmatterError,
    delete_keys,
    insert_in_list,
    parse_fm,
    remove_from_list,
    remove_items,
    rename_key,
    replace_in_value,
    set_keys,
)
from .ids import new_ulid
from .collections import CollectionDef, SaveCollectionResult
from .dailynotes import FILE_NAME_TAKEN, DailyNoteExists, build_index, day_of, parse_day
from .jsonstore import DefinitionUnreadable, JsonStore
from .localtime import SystemTz, from_local, to_local
from .queries import DEFAULT_NAME as DEFAULT_QUERY_NAME
from .queries import LIMIT_SIZES, MAX_SEARCH_TERMS, QueryDef, query_type_ids
from .objfile import ObjectFile, join_object
from .rows import member_of
from .propvalues import (
    KIND_TRANSFORMS,
    InvalidValue,
    convert_value,
    decode_value,
    encode_updates,
    encode_value,
)
from .spaceconfig import space_fields
from .recurrence import week_start_of
from .taskhook import TaskResult, on_status_change
from .linkindex import LinkIndex
from .relink import relink_frontmatter, replace_wikilinks, rewrite_tag_lists, wikilink_targets
from .resolver import Resolver, link_candidates
from .templates import TemplateError, creation_variable, expand_title, resolve_date_variable
from .textfile import atomic_write, create_new, encode_like, move_no_overwrite, retry_os
from .trash import Trash, TrashItem
from .typedefs import (
    SYSTEM_KEYS,
    RawObject,
    infer_types_from,
    is_ignored,
    iter_object_paths,
    read_raw,
    slug,
)
from .typemodel import (
    PROPERTY_ICONS,
    THEME_COLORS,
    Icon,
    PropertyDefinition,
    RevisionConflict,
    TypeDefinition,
    TypeReadOnly,
    UnreadableType,
    load_types,
    system_property_defs,
    topup_task_type,
    type_revision,
    write_type_json,
)

__all__ = [
    "ChangeKindResult",
    "ChangeTypeResult",
    "ConfirmRequired",
    "Conflict",
    "DeleteCollectionResult",
    "ObjectSummary",
    "ReadOnly",
    "RenameResult",
    "RestoreConflict",
    "SaveTypeResult",
    "Skip",
    "Space",
    "SpaceChange",
    "SyncResult",
    "TrashItem",
    "UpdateResult",
    "now_stamp",
    "safe_filename",
    "unique_path",
    "version_of",
]

_log = logging.getLogger(__name__)

Edit = Callable[[ObjectFile, dict], "ObjectFile | None"]
"""An edit for `Space._write`: (current file, its frontmatter) -> new file, or None for no change."""

# Keys that `update_properties` refuses: they change through their own routes
# (rename, change type) or are managed by the app.
_LOCKED_KEYS = frozenset({"title", "type", "id", "template"})
_WHITEBOARD_TYPE_ID = "whiteboard"  # whiteboardstore.WHITEBOARD_TYPE_ID (it imports this module)

# Keys a template never copies into an object, and kinds the app maintains itself.
_NOT_COPIED = frozenset({"template", "id", "type", "title", "createdAt", "lastUpdated", "iconColor"})
_NOT_COPIED_KINDS = frozenset(
    {"entity_title", "entity_type", "entity_createdAt", "entity_lastUpdated",
     "entity_collections", "entity_backlinks"}
)  # fmt: skip
# A body that is empty or only a `# Title` heading (a template's body replaces it).
_TITLE_ONLY_RE = re.compile(r"\s*(?:#[ \t][^\n]*)?\s*")


def _parse_created(value: Any) -> datetime:
    """An object's ``createdAt`` as a local datetime (now when missing or unreadable)."""
    if isinstance(value, datetime):
        return value.astimezone() if value.tzinfo else value
    text = str(value or "").strip()
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now().astimezone()
    return dt.astimezone() if dt.tzinfo else dt

_EXTRA_SYSTEM_DEFS = (
    PropertyDefinition(id="coverImage", key="coverImage", name="Cover image", type="coverImage"),
    PropertyDefinition(id="color", key="color", name="Color", type="color"),
)

_HEADING_RE = re.compile(r"^#[ \t]+(.+?)[ \t#]*$", re.MULTILINE)
_UNTITLED_STEM_RE = re.compile(r"^Untitled(?: \(\d+\))?$")

# Characters Windows doesn't allow in a file name (and control characters).
_ILLEGAL_FILENAME_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_MAX_FILENAME = 120
# Device names Windows reserves (a file `CON.md` can't be created there).
_RESERVED_STEMS = frozenset(
    {
        "CON", "PRN", "AUX", "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }
)


_LINK_UNSAFE_RE = re.compile(r"[\[\]#]")
# A title that can't be a wikilink target as it is (it would end the target early).
_LINK_BREAKING_RE = re.compile(r"[\[\]|#\n]")


def safe_filename(title: str) -> str:
    """The file stem for a title, as Object's export names files.

    The title up to its first character that is illegal in a Windows file name,
    with whitespace collapsed and trailing dots and spaces stripped, capped at
    120 characters. If that is empty, the illegal characters are dropped
    instead; if still empty, ``Untitled``. (A Windows device name such as
    ``CON`` gets a trailing ``_``.) ``[``, ``]`` and ``#`` are dropped first.
    """

    def clean(text: str) -> str:
        text = " ".join(text.split()).rstrip(". ")
        return text[:_MAX_FILENAME].rstrip(". ")

    # `[`, `]` and `#` are legal in file names but end a wikilink's target, so
    # the path form of a link (see `Space._link_text`) must never contain them.
    title = _LINK_UNSAFE_RE.sub("", str(title or ""))
    m = _ILLEGAL_FILENAME_RE.search(title)
    stem = clean(title[: m.start()] if m else title)
    if not stem:
        stem = clean(_ILLEGAL_FILENAME_RE.sub("", title))
    if stem.split(".", 1)[0].upper() in _RESERVED_STEMS:
        stem += "_"
    return stem or "Untitled"


def unique_path(root: Path, folder: str, stem: str, same_as: str | None = None) -> str:
    """A free space path ``<folder>/<stem>.md``, appending `` (2)``, `` (3)``... on a collision.

    Names compare case-insensitively (as on Windows). `same_as` is the path of
    the file being renamed: finding only itself is not a collision.
    """
    folder = folder.strip("/")
    base = Path(root) / folder if folder else Path(root)
    try:
        taken = {p.name.lower() for p in base.iterdir()} if base.is_dir() else set()
    except OSError:
        taken = set()
    own = None
    if same_as:
        same = PurePosixPath(same_as.replace("\\", "/"))
        same_folder = same.parent.as_posix()
        if (same_folder if same_folder != "." else "").lower() == folder.lower():
            own = same.name.lower()
    n = 1
    while True:
        name = f"{stem}.md" if n == 1 else f"{stem} ({n}).md"
        if name.lower() not in taken or name.lower() == own:
            return f"{folder}/{name}" if folder else name
        n += 1


def _same_file(a: Path, b: Path) -> bool:
    """Whether ``a`` and ``b`` name one file (e.g. two spellings on a case-insensitive disk)."""
    try:
        return os.path.samefile(a, b)
    except OSError:
        return False


class Conflict(Exception):
    """The file changed on disk since the version the caller edited."""

    def __init__(self, current_version: str) -> None:
        super().__init__(f"Object changed on disk (current version {current_version})")
        self.current_version = current_version


class ReadOnly(Exception):
    """The object cannot be saved (e.g. its frontmatter is malformed)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def now_stamp(instant: datetime | None = None) -> str:
    """``instant`` (default: the current time) in UTC as ``YYYY-MM-DDTHH:MM:SS.sssZ``."""
    now = (instant or datetime.now(UTC)).astimezone(UTC)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


@dataclass
class ObjectSummary:
    path: str
    id: str | None
    type: str
    """The object's type id (see `TypeDefinition.id`)."""
    title: str
    icon: str | None
    createdAt: str | None
    lastUpdated: str | None
    tags: list[str] = field(default_factory=list)
    readOnly: bool = False
    readOnlyReason: str | None = None
    """Why the object opens read-only (None when it can be saved)."""
    description: str | None = None
    aliases: list[str] = field(default_factory=list)
    coverImage: str | None = None
    iconColor: str | None = None
    template: str | None = None
    """The template's name when the file is a template (``template:`` key), else None."""
    color: str | None = None
    """A Tag's colour (``bg-<c>``), else None."""
    collections: list[str] = field(default_factory=list)
    """The raw names of the ``collections:`` key (``[]`` when absent)."""


@dataclass(frozen=True)
class SpaceChange:
    """A change to the space's in-memory scan, for `Space.add_listener` listeners.

    ``kind`` is ``'object'`` (``path`` is the object's space path; it may be gone
    now) or ``'types'`` (a type definition changed; ``path`` is None).
    """

    kind: str
    path: str | None


def _names_key(s: ObjectSummary | None) -> tuple | None:
    """What link resolution reads from a summary (None when the object is gone)."""
    if s is None:
        return None
    return (s.title, tuple(s.aliases), s.createdAt, s.template, s.type)


@dataclass(frozen=True)
class Skip:
    """A rewrite of another file that was not made (the file's bytes are unchanged)."""

    path: str
    reason: str


@dataclass
class UpdateResult:
    version: str
    frontmatter: dict
    links: dict[str, list[str | None]]
    synced: list[str]
    """Other objects written by relation syncing."""
    skipped: list[Skip]
    """Other objects relation syncing could not write."""
    task: TaskResult | None = None
    """What the Task status hook did (only when a Task's status changed category)."""


class RestoreConflict(Exception):
    """A restore that would clash with a live definition (the API answers 409)."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


COLLECTION_DELETE_DETAIL = (
    "By deleting a collection all entries will be removed as well. "
    "Entries that exist in other collections will be kept there."
)


@dataclass
class DeleteCollectionResult:
    trash_id: str
    removed_from: list[str] = field(default_factory=list)
    """Paths of the members that lost the collection's item (they stay)."""
    skipped: list[dict[str, str]] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    """Paths of the sole members that went to the trash."""

    def to_api(self) -> dict[str, Any]:
        return {
            "trashId": self.trash_id,
            "removedFrom": list(self.removed_from),
            "skipped": list(self.skipped),
            "deleted": list(self.deleted),
        }


class ConfirmRequired(Exception):
    """A type edit that removes values (or deletes a type) needs ``confirm`` (the API answers 428)."""

    def __init__(self, affected: int, detail: str = "This change needs to be confirmed") -> None:
        super().__init__(detail)
        self.affected = affected
        """How many files would change (for a type deletion: how many objects go to the trash)."""
        self.detail = detail


@dataclass
class SaveTypeResult:
    type: TypeDefinition
    rewritten: list[str]
    """Other files rewritten (unstamped) to follow the type change."""
    skipped: list[Skip]
    """Files the change could not rewrite (their bytes are unchanged)."""
    revision: str = ""
    """The type file's new revision (``type.revision`` in the API)."""

    def to_api(self) -> dict[str, Any]:
        """The route's response: ``{type, rewritten, skipped}``."""
        return {
            "type": self.type.to_api(self.revision),
            "rewritten": list(self.rewritten),
            "skipped": [{"path": s.path, "reason": s.reason} for s in self.skipped],
        }


def _skips_api(skipped: Iterable[Skip]) -> list[dict[str, str]]:
    return [{"path": s.path, "reason": s.reason} for s in skipped]


@dataclass
class ChangeKindResult:
    type: TypeDefinition
    newPropertyId: str
    rewritten: list[str]
    """Files that got the converted value under the new key (unstamped)."""
    skipped: list[Skip]
    lossy: int
    """How many values converted lossily."""
    revision: str = ""
    """The type file's new revision (``type.revision`` in the API)."""

    def to_api(self) -> dict[str, Any]:
        """The route's response: ``{type, newPropertyId, rewritten, skipped, lossy}``."""
        return {
            "type": self.type.to_api(self.revision),
            "newPropertyId": self.newPropertyId,
            "rewritten": list(self.rewritten),
            "skipped": _skips_api(self.skipped),
            "lossy": self.lossy,
        }


@dataclass
class RenameResult:
    path: str
    """The object's path after the rename (unchanged when the file name stays)."""
    version: str
    relinked: list[str]
    """Other objects whose links to it were rewritten (unstamped)."""
    skipped: list[Skip]
    """Other objects with such links that could not be rewritten."""

    def to_api(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "version": self.version,
            "relinked": list(self.relinked),
            "skipped": _skips_api(self.skipped),
        }


@dataclass
class ChangeTypeResult:
    path: str
    """The object's path after the change (in the new type's folder)."""
    version: str
    relinked: list[str]
    """Other objects whose links to it were rewritten (unstamped)."""
    skipped: list[Skip]
    """Other objects with such links that could not be rewritten."""
    typeWritten: bool = False
    """Not in the API: the target type's JSON was written (first use, or new label options)."""

    def to_api(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "version": self.version,
            "relinked": list(self.relinked),
            "skipped": _skips_api(self.skipped),
        }


@dataclass
class SyncResult:
    types: list[TypeDefinition]
    """Every type whose definition changed (the source first)."""
    rewritten: list[str]
    """Objects the backfill linked back (unstamped)."""
    skipped: list[Skip]
    revisions: dict[str, str] = field(default_factory=dict)
    """Type id -> its file's new revision."""

    def to_api(self) -> dict[str, Any]:
        """The route's response: ``{types, rewritten, skipped}``."""
        return {
            "types": [t.to_api(self.revisions.get(t.id, "")) for t in self.types],
            "rewritten": list(self.rewritten),
            "skipped": _skips_api(self.skipped),
        }


_KEY_WORD_RE = re.compile(r"[^\W_]+")


def camel_key(name: str) -> str:
    """The camelCase key for a property name (``CPU cores`` -> ``cpuCores``)."""
    words = _KEY_WORD_RE.findall(str(name or ""))
    if not words:
        return "property"
    return words[0].lower() + "".join(w[:1].upper() + w[1:].lower() for w in words[1:])


def unique_key(name: str, taken: Iterable[str]) -> str:
    """A new property key: `camel_key` of the name, never reserved or taken.

    A collision appends ``_`` (as the export does), then ``_2``, ``_3``...
    """
    taken = set(taken) | SYSTEM_KEYS | {"backlinks"}
    base = camel_key(name)
    if base not in taken:
        return base
    if f"{base}_" not in taken:
        return f"{base}_"
    n = 2
    while f"{base}_{n}" in taken:
        n += 1
    return f"{base}_{n}"


# Object's en-US texts.
BASIC_LOCKED = "Properties of basic object types cannot be edited."
NO_TRANSFORMATIONS = (
    "This property type cannot be changed. If you need to change it, please add a ticket "
    "to our feedback board including the types you need."
)
SYNC_MULTI_ONLY = (
    "Synced properties are only available for multi-select properties without a fixed set. "
    "You need to change your settings above or in your linked object type to enable "
    "synchronization."
)
SYNC_NOT_ALLOWED = (
    "Property syncing is not available for basic object types. "
    "You need to link to your own custom object types above."
)
_DEFAULT_TYPE_ICON = "ph-note-pencil"
# System properties every type keeps (the optional ones, e.g. `coverImage`, may be removed).
_CORE_SYSTEM_KEYS = frozenset(
    {"title", "collections", "description", "createdAt", "lastUpdated", "tags", "icon", "aliases"}
)


def _is_system_def(p: PropertyDefinition) -> bool:
    """A system definition: its id is its key, and the key is reserved (or ``backlinks``)."""
    return p.id == p.key and (p.key in SYSTEM_KEYS or p.key == "backlinks") and (
        p.type.startswith("entity_") or p.type in ("coverImage", "color")
    )


def _is_multi(p: PropertyDefinition) -> bool:
    default = p.type == "entity"
    value = p.options.get("isArray", default)
    return value if isinstance(value, bool) else default


def _sync_ids(p: PropertyDefinition) -> list[str]:
    sync = p.options.get("propertySyncing")
    ids = sync.get("propertyIds") if isinstance(sync, dict) else None
    return [i for i in ids if isinstance(i, str)] if isinstance(ids, list) else []


def _option_texts(p: PropertyDefinition) -> dict[str, str]:
    """Label option id -> text."""
    return {
        str(o.get("id")): str(o.get("text", ""))
        for o in p.options.get("set") or []
        if isinstance(o, dict)
    }


def _fold(value: Any) -> str:
    return str(value).strip().casefold()


@dataclass
class _TypeOp:
    """One rewrite every file of a type gets: ``fn(src, rel) -> src``."""

    fn: Callable[[str, str], str]
    confirm: bool
    """True when it removes values (the save then needs ``confirm``)."""


def version_of(data: bytes) -> str:
    """An object's version: the sha256 hex digest of its file bytes."""
    return hashlib.sha256(data).hexdigest()


def _str_or_none(value: object) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _str_list(value: object) -> list[str]:
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    return [str(i) for i in items if i is not None and str(i).strip()]


def _json_scalar(key: str, value: Any) -> Any:
    """A value for a key without a definition: a JSON scalar, or a list of them."""
    scalar = (str, int, float, bool, type(None))
    if isinstance(value, list) and all(isinstance(v, scalar) and v is not None for v in value):
        return FlowList(value) if value else None
    if not isinstance(value, scalar):
        raise InvalidValue(f"{key!r} has no definition, so its value must be a JSON scalar")
    return value


def _title_of(raw: RawObject) -> str:
    title = _str_or_none(raw.fm.get("title"))
    if title:
        return title
    if not raw.readOnly:
        m = _HEADING_RE.search(raw.of.body)
        if m:
            return m.group(1).strip()
    stem = PurePosixPath(raw.path).stem
    return "Untitled" if _UNTITLED_STEM_RE.match(stem) else stem


def _yaml_single_quoted(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


_link_candidates = link_candidates


class Space:
    @property
    def name(self) -> str:
        """``.object/space.json``'s ``name``, else the folder name (re-read on every access)."""
        return space_fields(self.root)["name"]

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        self._lock = threading.RLock()
        self._raw: dict[str, RawObject] = {}
        self._summaries: dict[str, ObjectSummary] = {}
        self._listeners: list[Callable[[SpaceChange], None]] = []
        self._names_rev = 0
        """Bumped whenever the set of link names changes (see `_names_changed`)."""
        self._resolver: Resolver | None = None
        self._links = LinkIndex(self)
        self._listeners.append(self._links.on_change)
        self.own_writes: dict[str, str] = {}
        """Path -> version of the last write `save_body` made (for self-write suppression)."""
        self.own_deletes: dict[str, str] = {}
        """Path -> version of a file the app moved away (to the trash); the watcher stays silent."""
        self.trash = Trash(self.root)
        self.clock: Callable[[], datetime] = lambda: datetime.now(UTC)
        """The only source of "now" for stamps, the Task hook and the calendar (tests set it)."""
        self.tz: tzinfo = SystemTz()
        """The local zone (DST-aware) that turns instants into local days (tests set it)."""
        self.before_write: Callable[[str, bytes], None] | None = None
        """M8 version history: called as ``before_write(rel, current_bytes)`` inside the lock
        right before the app replaces an existing file (never on create, never on read).
        Errors it raises are logged and never stop the write (see `_call_before_write`)."""
        for rel in iter_object_paths(self.root):
            try:
                self._raw[rel] = read_raw(self.root, rel)
            except OSError:
                continue
        inferred = infer_types_from(self._raw.values())
        loaded, unreadable = load_types(self.root, inferred=inferred)
        self.types: list[TypeDefinition] = list(loaded)
        self.unreadable_types: list[UnreadableType] = list(unreadable)
        self._add_placeholders(inferred)
        self._merge_types(inferred)
        for t in self.types:
            topup_task_type(t)
        self._loaded_revisions: dict[str, str] = {
            t.id: type_revision(self.root, t.id) for t in self.types if not t.readOnlyReason
        }
        """Type id -> the revision of its file when the in-memory copy was loaded or written."""
        for rel, raw in self._raw.items():
            self._summaries[rel] = self._summarize(raw)
        self.collections: dict[str, CollectionDef] = {}
        """Collection id -> definition (unreadable files included, read-only)."""
        for cid, data, _rev, err in self.store("collections").list():
            self.collections[cid] = self._load_collection(cid, data, err)
        self.purge_expired(datetime.now(UTC))

    # -- types --------------------------------------------------------------

    def _add_placeholders(self, inferred: list[TypeDefinition]) -> None:
        """An in-memory, read-only type for each type file that couldn't be read."""
        by_id = {t.id: t for t in inferred}
        for u in self.unreadable_types:
            if any(t.id == u.id for t in self.types):
                continue
            base = by_id.get(u.id)
            t = copy.deepcopy(base) if base is not None else TypeDefinition.from_json(
                {"id": u.id, "name": u.id, "schemaVersion": 2}
            )
            t.readOnlyReason = f"The type file {u.path} could not be read: {u.error}"
            self.types.append(t)

    def _merge_types(self, inferred: list[TypeDefinition]) -> None:
        """Add (in memory only) inferred types that the stored definitions lack.

        An inferred type is written only when the user first saves it.
        """
        known = {t.name.lower() for t in self.types} | {t.id for t in self.types}
        for t in self.types:
            known |= {f.lower() for f in t.formerNames}
        added = False
        for t in inferred:
            if t.name.lower() not in known and t.id not in known:
                self.types.append(t)
                known |= {t.name.lower(), t.id}
                added = True
        if added:
            self._types_changed()

    def refresh_type(self, type_id: str) -> tuple[TypeDefinition | None, str]:
        """The type and its file's revision, reloading it when the file changed outside the app.

        A type file edited by hand, a sync or a pull keeps its id; the in-memory copy
        is replaced whenever the file's revision differs from the one it was loaded
        with, so content and revision always match.
        """
        with self._lock:
            mem = self.type_by_id(type_id)
            if mem is None or mem.readOnlyReason:
                return mem, type_revision(self.root, type_id) if mem is not None else ""
            current = type_revision(self.root, type_id)
            if current and current != self._loaded_revisions.get(type_id):
                stored = self._stored_type(type_id)
                if stored is not None:
                    topup_task_type(stored)
                if stored is not None and stored.id == type_id:
                    self.types = [stored if x.id == type_id else x for x in self.types]
                    self._sort_types()
                    mem = stored
                    self._types_changed(type_id)
                self._loaded_revisions[type_id] = current
            return mem, current

    def types_with_revisions(self) -> list[tuple[TypeDefinition, str]]:
        """Every type with its file's revision, each reloaded first if its file changed."""
        with self._lock:
            ids = [t.id for t in self.types]
            out = []
            for tid in ids:
                t, rev = self.refresh_type(tid)
                if t is not None:
                    out.append((t, rev))
            return out

    def store(self, folder: str) -> JsonStore:
        """The definition store of ``.object/<folder>/`` (``collections``, ``queries``, ``views``).

        Bound to this space's lock and ``own_writes`` so the watcher stays silent
        about the app's own writes.
        """
        return JsonStore(
            self.root,
            folder,
            self.own_writes,
            trash_ids=lambda: self.trash.definition_ids(folder),
            lock=self._lock,
        )

    # -- collections ---------------------------------------------------------

    @staticmethod
    def _load_collection(cid: str, data: dict | None, error: str | None) -> CollectionDef:
        if data is None:
            c = CollectionDef(id=cid, name=cid)
            c.readOnlyReason = error or "The collection file could not be read."
            return c
        c = CollectionDef.from_json(data, fallback_id=cid)
        c.id = cid  # the file name is the id, whatever "id" the JSON holds
        return c

    def reload_collection(self, collection_id: str) -> None:
        """Re-read one collection file into `self.collections` (drop it when the file is gone)."""
        with self._lock:
            store = self.store("collections")
            try:
                data, _rev = store.read(collection_id)
                error = None
            except DefinitionUnreadable as exc:
                data, error = None, exc.error
            except ValueError:
                self.collections.pop(collection_id, None)
                return
            if data is None and error is None:
                self.collections.pop(collection_id, None)
            else:
                self.collections[collection_id] = self._load_collection(collection_id, data, error)

    def reload_collections(self) -> None:
        """Re-read every collection file (the list route does this, so it is never stale)."""
        with self._lock:
            found = {}
            for cid, data, _rev, err in self.store("collections").list():
                found[cid] = self._load_collection(cid, data, err)
            self.collections = found

    def list_collections(self) -> list[CollectionDef]:
        with self._lock:
            return sorted(self.collections.values(), key=lambda c: (c.name.lower(), c.id))

    def collection_revision(self, collection_id: str) -> str:
        return self.store("collections").revision(collection_id)

    def collection_by_name(self, name: str) -> CollectionDef | None:
        """The readable collection `name` names: by name first, then by former name."""
        key = name.strip().casefold()
        with self._lock:
            live = [c for c in self.list_collections() if not c.readOnlyReason]
            for c in live:
                if c.name.strip().casefold() == key:
                    return c
            for c in live:
                if any(f.strip().casefold() == key for f in c.formerNames):
                    return c
        return None

    def _collection_names(self) -> dict[str, list[str]]:
        """Collection id -> [its name, *formerNames], from the readable collections."""
        with self._lock:
            return {
                c.id: [c.name, *c.formerNames]
                for c in self.collections.values()
                if not c.readOnlyReason
            }

    def _check_collection_name(self, name: str, except_id: str | None) -> None:
        low = name.strip().casefold()
        for c in self.collections.values():
            if c.id != except_id and not c.readOnlyReason and c.name.strip().casefold() == low:
                raise InvalidValue("A collection with this name already exists.")

    def create_collection(
        self, name: str, type_ids: list[str], icon: object | None = None
    ) -> CollectionDef:
        with self._lock:
            known = {t.id for t in self.types}
            for tid in type_ids:
                if tid not in known:
                    raise InvalidValue(f"Unknown object type {tid!r}.")
            name = name.strip()
            if name:
                self._check_collection_name(name, None)
            else:
                name, n = "New Collection", 1
                taken = {c.name.strip().casefold() for c in self.collections.values()}
                while name.casefold() in taken:
                    n += 1
                    name = f"New Collection {n}"
            store = self.store("collections")
            cid = store.new_id(name)
            c = CollectionDef(
                id=cid,
                name=name,
                icon=Icon.parse(icon),
                typeIds=list(dict.fromkeys(type_ids)),
            )
            store.write(cid, c.to_json(), "")
            self.collections[cid] = c
            return c

    def save_collection(self, c: CollectionDef, base_revision: str) -> SaveCollectionResult:
        """Save `c` over its file if still at `base_revision` (`RevisionConflict`, `ReadOnly`)."""
        with self._lock:
            store = self.store("collections")
            try:
                stored, _rev = store.read(c.id)
            except DefinitionUnreadable as exc:
                raise ReadOnly(exc.error) from exc
            if stored is None:
                raise KeyError(c.id)
            before = CollectionDef.from_json(stored, fallback_id=c.id)
            if not c.name.strip():
                raise InvalidValue("A collection needs a name.")
            self._check_collection_name(c.name, c.id)
            known = {t.id for t in self.types} | set(before.typeIds)
            for tid in c.typeIds:
                if tid not in known:
                    raise InvalidValue(f"Unknown object type {tid!r}.")
            c.readOnlyReason = None
            old_name = before.name.strip()
            renamed = bool(old_name) and c.name != before.name
            if renamed and old_name.casefold() not in {
                n.strip().casefold() for n in c.formerNames
            }:
                c.formerNames = [*c.formerNames, before.name]
            revision = store.write(c.id, c.to_json(), base_revision)
            self.collections[c.id] = c
            result = SaveCollectionResult(collection=c, revision=revision)
            if renamed:
                result.rewritten, result.skipped = self._rename_members(old_name, c.name)
            return result

    def _rename_members(self, old: str, new: str) -> tuple[list[str], list[dict[str, str]]]:
        """Rewrite the ``collections:`` items naming ``old`` to ``new`` (unstamped, one item each)."""
        folded = old.casefold()
        with self._lock:
            paths = sorted(
                s.path
                for s in self._summaries.values()
                if any(n.strip().casefold() == folded for n in s.collections)
            )

        def rename(src: str, _fm: dict) -> str:
            try:
                return replace_in_value(
                    src, "collections", lambda item: new if item.strip().casefold() == folded else item
                )
            except FrontmatterError as exc:
                raise ReadOnly(str(exc)) from exc

        rewritten: list[str] = []
        skipped: list[Skip] = []
        for rel in paths:
            before = self.cached_version(rel)
            res = self._rewrite_other(rel, self._fm_edit(rename))
            if isinstance(res, Skip):
                skipped.append(res)
            elif res != before:
                rewritten.append(rel)
        return rewritten, _skips_api(skipped)

    def _collection_lookup(self) -> tuple[dict[str, str], dict[str, str]]:
        """Case-folded collection name -> id, and former name -> id (readable collections)."""
        by_name: dict[str, str] = {}
        by_former: dict[str, str] = {}
        for cid, names in self._collection_names().items():
            if not names:
                continue
            by_name.setdefault(names[0].strip().casefold(), cid)
            for former in names[1:]:
                by_former.setdefault(former.strip().casefold(), cid)
        return by_name, by_former

    def _resolve_collection_names(
        self, t: TypeDefinition | None, names: Any, existing: list[str]
    ) -> list[str]:
        """Validate collection names for an object of type ``t``; return each as its current name.

        A name already in the object's list (``existing``) is kept even when it no
        longer resolves or the collection no longer holds the type.
        """
        if names is None:
            return []
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
            raise InvalidValue("Expected a list of collection names")
        had = {n.strip().casefold() for n in existing}
        out: list[str] = []
        seen_ids: set[str] = set()
        seen_loose: set[str] = set()
        for raw in names:
            name = raw.strip()
            if not name:
                continue
            key = name.casefold()
            c = self.collection_by_name(name)
            if c is None:
                if key not in had:
                    raise InvalidValue(f"There is no collection named {name!r}.")
                if key not in seen_loose:
                    seen_loose.add(key)
                    out.append(name)
                continue
            if c.id in seen_ids:
                continue
            seen_ids.add(c.id)
            if key not in had and (t is None or t.id not in c.typeIds):
                raise InvalidValue("This collection doesn't hold objects of this type.")
            out.append(c.name)
        return out

    # -- collection delete and restore ------------------------------------------

    def _rewrite_with_snapshot(self, rel: str, edit: Edit) -> tuple[bytes, str] | Skip:
        """`_rewrite_other` that also returns the file's bytes from just before the write."""
        full = self.root / rel
        for attempt in range(2):
            try:
                data = full.read_bytes()
            except OSError:
                return Skip(rel, "The file no longer exists")
            try:
                return data, self._write(rel, version_of(data), edit, stamp=False)
            except Conflict:
                if attempt:
                    return Skip(rel, "The file changed on disk while it was being updated")
            except ReadOnly as exc:
                return Skip(rel, exc.reason)
            except (KeyError, FileNotFoundError):
                return Skip(rel, "The file no longer exists")
            except PermissionError as exc:
                return Skip(rel, f"The file could not be written: {exc.strerror or exc}")
        raise AssertionError("unreachable")

    def _call_before_write(self, rel: str, data: bytes) -> None:
        """Run the `before_write` hook (M8 history) for ``rel``'s current bytes; never raises."""
        hook = self.before_write
        if hook is None:
            return
        try:
            hook(rel, data)
        except Exception:  # noqa: BLE001 - history must never stop a save
            _log.exception("The pre-write hook failed for %s", rel)

    def _write_exact(self, rel: str, base_version: str, data: bytes) -> bool:
        """Put ``data`` back at ``rel`` if it is still at ``base_version``; False when it changed."""
        full = self.root / rel
        new_version = version_of(data)

        def unchanged() -> None:
            try:
                now = version_of(full.read_bytes())
            except OSError as exc:
                raise KeyError(rel) from exc
            if now != base_version:
                raise Conflict(now)

        with self._lock:
            try:
                current = full.read_bytes()
            except OSError:
                current = None
            if current is not None and version_of(current) == base_version and current != data:
                self._call_before_write(rel, current)
            self.own_writes[rel] = new_version
            try:
                atomic_write(full, data, check=unchanged)
            except (Conflict, KeyError):
                if self.own_writes.get(rel) == new_version:
                    del self.own_writes[rel]
                return False
            except BaseException:
                if self.own_writes.get(rel) == new_version:
                    del self.own_writes[rel]
                raise
            self.rescan_file(rel)
            return True

    def delete_collection(self, collection_id: str, confirm: bool = False) -> DeleteCollectionResult:
        """Move a collection to the trash, with its sole members; restorable.

        Members in no other collection become object trash entries (``collectionTrashId``).
        For every other member the collection's item is removed from its
        ``collections:`` (unstamped), its bytes from before kept in the trash folder.
        Raises `KeyError`, `ReadOnly` (unreadable file) and `ConfirmRequired` (without
        ``confirm``; ``affected`` = every member).
        """
        with self._lock:
            c = self.collections.get(collection_id)
            if c is None:
                raise KeyError(collection_id)
            if c.readOnlyReason:
                raise ReadOnly(c.readOnlyReason)
            by_name, by_former = self._collection_lookup()
            sole: list[str] = []
            shared: list[str] = []
            for s in sorted(self._summaries.values(), key=lambda s: s.path):
                if s.template is not None:
                    continue
                ids = member_of(s.collections, by_name, by_former)
                if collection_id in ids:
                    # Sole only when every non-empty item names this collection: an item
                    # that resolves elsewhere, or to nothing (an unreadable or unknown
                    # collection), keeps the object, which only loses this item.
                    only_ours = all(
                        member_of([n], by_name, by_former) == {collection_id}
                        for n in s.collections
                        if n.strip()
                    )
                    (sole if only_ours else shared).append(s.path)
            if not confirm:
                raise ConfirmRequired(len(sole) + len(shared), COLLECTION_DELETE_DETAIL)

            store = self.store("collections")
            trash_id = new_ulid()
            folder = self.trash.collection_dir(trash_id)
            (folder / "before").mkdir(parents=True, exist_ok=True)
            result = DeleteCollectionResult(trash_id=trash_id)
            skipped: list[Skip] = []
            object_ids: list[str] = []
            removed: list[dict[str, Any]] = []

            for rel in sole:
                try:
                    item = self.delete_object(rel, collection_trash_id=trash_id)
                except (OSError, KeyError) as exc:
                    skipped.append(Skip(rel, f"The file could not be moved: {exc}"))
                    continue
                object_ids.append(item.id)
                result.deleted.append(rel)

            def ours(item: str) -> bool:
                return member_of([item], by_name, by_former) == {collection_id}

            for rel in shared:
                indexes: list[int] = []

                def edit(src: str, _fm: dict, indexes=indexes) -> str:
                    out, idx = remove_from_list(src, "collections", ours)
                    indexes[:] = idx
                    return out

                res = self._rewrite_with_snapshot(rel, self._fm_edit(edit))
                if isinstance(res, Skip):
                    skipped.append(res)
                    continue
                before_bytes, version_after = res
                if not indexes:
                    continue  # no longer names the collection: nothing was removed
                n = len(removed)
                (folder / "before" / f"{n}.md").write_bytes(before_bytes)
                removed.append(
                    {
                        "path": rel,
                        "index": indexes[0],
                        "versionAfter": version_after,
                        "before": f"before/{n}.md",
                    }
                )
                result.removed_from.append(rel)

            result.skipped = _skips_api(skipped)
            stored = store.path(collection_id)
            (folder / "collection.json").write_bytes(stored.read_bytes())
            self.trash.write_json(
                folder / "manifest.json",
                {
                    "id": trash_id,
                    "kind": "collection",
                    "collectionId": collection_id,
                    "name": c.name,
                    "deletedAt": now_stamp(),
                    "objectTrashIds": object_ids,
                    "removedFrom": removed,
                    "skipped": result.skipped,
                },
            )
            store.remove(collection_id)
            self.collections.pop(collection_id, None)
            return result

    def _restore_collection_entry(self, trash_id: str, manifest: dict) -> dict[str, Any]:
        """Bring a deleted collection back: its file, its sole members and its items in the others."""
        folder = self.trash.collection_dir(trash_id)
        cid = str(manifest.get("collectionId", ""))
        stored = folder / "collection.json"
        try:
            data = json.loads(stored.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = None
        if not isinstance(data, dict):
            raise InvalidValue("The deleted collection's file could not be read.")
        restored = CollectionDef.from_json(data, fallback_id=cid)
        store = self.store("collections")
        self.reload_collections()
        if store.path(cid).exists():
            raise RestoreConflict("Its id is used by another definition.")
        low = restored.name.strip().casefold()
        if any(
            o.id != cid and not o.readOnlyReason and o.name.strip().casefold() == low
            for o in self.collections.values()
        ):
            raise RestoreConflict("A collection with this name already exists.")

        live = store.path(cid)
        live.parent.mkdir(parents=True, exist_ok=True)
        self.own_writes[store.rel(cid)] = version_of(stored.read_bytes())
        move_no_overwrite(stored, live)
        self.reload_collection(cid)

        paths: list[str] = []
        for oid in manifest.get("objectTrashIds") or []:
            ometa = self.trash.object_meta(oid)
            if ometa is not None:
                paths.append(self._restore_object_entry(oid, ometa))

        rewritten: list[str] = []
        skipped: list[Skip] = []
        folded = restored.name.casefold()
        for n, entry in enumerate(manifest.get("removedFrom") or []):
            rel = str(entry.get("path", ""))
            full = self.root / rel
            if not full.is_file():
                skipped.append(Skip(rel, "The file no longer exists"))
                continue
            before = folder / str(entry.get("before") or f"before/{n}.md")
            try:
                current = version_of(full.read_bytes())
                if before.is_file() and current == entry.get("versionAfter"):
                    if self._write_exact(rel, current, before.read_bytes()):
                        rewritten.append(rel)
                        continue
            except OSError as exc:
                skipped.append(Skip(rel, f"The file could not be written: {exc}"))
                continue
            index = int(entry.get("index") or 0)

            def insert(src: str, fm: dict, index=index) -> str:
                if any(i.strip().casefold() == folded for i in _str_list(fm.get("collections"))):
                    return src
                return insert_in_list(src, "collections", index, restored.name)

            res = self._rewrite_other(rel, self._fm_edit(insert))
            if isinstance(res, Skip):
                skipped.append(res)
            else:
                rewritten.append(rel)
        self.trash.remove_collection(trash_id)
        return {
            "paths": paths,
            "typeIds": [],
            "collectionIds": [cid],
            "queryIds": [],
            "skipped": _skips_api(skipped),
            "rewritten": rewritten,
        }

    # -- queries ---------------------------------------------------------------

    @staticmethod
    def _load_query(qid: str, data: dict | None, error: str | None) -> QueryDef:
        if data is None:
            q = QueryDef(id=qid, name=qid)
            q.readOnlyReason = error or "The query file could not be read."
            return q
        q = QueryDef.from_json(data, fallback_id=qid)
        q.id = qid  # the file name is the id, whatever "id" the JSON holds
        return q

    def list_queries(self) -> list[QueryDef]:
        """Every query, by name (case-insensitive). An unreadable file lists with ``readOnlyReason``."""
        with self._lock:
            found = [
                self._load_query(qid, data, err)
                for qid, data, _rev, err in self.store("queries").list()
            ]
        return sorted(found, key=lambda q: (q.name.casefold(), q.id))

    def query_revision(self, query_id: str) -> str:
        return self.store("queries").revision(query_id)

    def _check_query_definition(self, definition: dict[str, Any], stored_type_ids: set[str]) -> None:
        """Raise `InvalidValue` for an unknown new type id, a bad result limit or too many search terms."""
        if not isinstance(definition.get("structures"), list):
            raise InvalidValue("A query's structures must be a list.")
        known = {t.id for t in self.types} | stored_type_ids
        for tid in sorted(query_type_ids(definition)):
            if tid not in known:
                raise InvalidValue(f"Unknown object type {tid!r}.")
        limit = definition.get("limit")
        if limit is not None:
            size = limit.get("size") if isinstance(limit, dict) else None
            if isinstance(size, bool) or not isinstance(size, int | float) or size not in LIMIT_SIZES:
                raise InvalidValue("A query's limit must be one of 1, 3, 5, 10, 25 or 50.")
        search = definition.get("search")
        if search is not None:
            terms = search.get("searchTerms") if isinstance(search, dict) else None
            if not isinstance(terms, list):
                raise InvalidValue("A query's search needs a list of search terms.")
            if len(terms) > MAX_SEARCH_TERMS:
                raise InvalidValue(f"A query has at most {MAX_SEARCH_TERMS} search terms.")

    def create_query(
        self,
        name: str | None = None,
        definition: dict[str, Any] | None = None,
        view: dict[str, Any] | None = None,
    ) -> QueryDef:
        """Create ``.object/queries/<id>.json``. No name: "New Query", ``titleIsCustom`` false."""
        name = (name or "").strip()
        data: dict[str, Any] = {"name": name or DEFAULT_QUERY_NAME, "titleIsCustom": bool(name)}
        if definition is not None:
            data["definition"] = definition
        if view is not None:
            data["view"] = view
        with self._lock:
            q = QueryDef.from_json(data, fallback_id="")
            self._check_query_definition(q.definition, set())
            store = self.store("queries")
            q.id = store.new_id(q.name)
            store.write(q.id, q.to_json(), "")
            return q

    def save_query(self, q: QueryDef, base_revision: str) -> tuple[QueryDef, str]:
        """Save `q` over its file if still at `base_revision`; return it with the new revision.

        Raises `RevisionConflict`, `ReadOnly` (the file holds invalid JSON), `KeyError`
        (no such query) and `InvalidValue`.
        """
        with self._lock:
            store = self.store("queries")
            try:
                stored, _rev = store.read(q.id)
            except DefinitionUnreadable as exc:
                raise ReadOnly(exc.error) from exc
            if stored is None:
                raise KeyError(q.id)
            before = QueryDef.from_json(stored, fallback_id=q.id)
            self._check_query_definition(q.definition, query_type_ids(before.definition))
            q.readOnlyReason = None
            revision = store.write(q.id, q.to_json(), base_revision)
            return q, revision

    def delete_query(self, query_id: str) -> str:
        """Move a query's file to ``trash/queries/<ulid>.json`` unchanged; return the trash id.

        No confirmation: it is restorable and touches no object. Raises `KeyError`, `ReadOnly`.
        """
        with self._lock:
            store = self.store("queries")
            try:
                data, _rev = store.read(query_id)
            except DefinitionUnreadable as exc:
                raise ReadOnly(exc.error) from exc
            if data is None:
                raise KeyError(query_id)
            trash_id = new_ulid()
            dest = self.trash.query_file(trash_id)
            dest.parent.mkdir(parents=True, exist_ok=True)
            rel = store.rel(query_id)
            previous = self.own_writes.get(rel)
            self.own_writes[rel] = ""
            try:
                move_no_overwrite(store.path(query_id), dest)
            except BaseException:
                if previous is None:
                    self.own_writes.pop(rel, None)
                else:
                    self.own_writes[rel] = previous
                raise
            # The query's id is its file name, which the JSON need not repeat: record it
            # beside the unchanged bytes so the entry can always be restored.
            self.trash.write_json(
                self.trash.query_meta_file(trash_id), {"id": query_id, "deletedAt": now_stamp()}
            )
            return trash_id

    def _restore_query_entry(self, trash_id: str, data: dict) -> dict[str, Any]:
        """Bring a deleted query back under its original id (`RestoreConflict` if that file exists)."""
        del data  # the id comes from the trash entry's record (or, failing that, the JSON)
        qid = self.trash.query_id(trash_id)
        store = self.store("queries")
        try:
            live = store.path(qid)
        except ValueError as exc:
            raise InvalidValue("The deleted query's id is not valid.") from exc
        if live.exists():
            raise RestoreConflict("Its id is used by another definition.")
        src = self.trash.query_file(trash_id)
        live.parent.mkdir(parents=True, exist_ok=True)
        rel = store.rel(qid)
        self.own_writes[rel] = version_of(src.read_bytes())
        try:
            move_no_overwrite(src, live)
        except FileExistsError as exc:
            self.own_writes.pop(rel, None)
            raise RestoreConflict("Its id is used by another definition.") from exc
        except BaseException:
            self.own_writes.pop(rel, None)
            raise
        self.trash.query_meta_file(trash_id).unlink(missing_ok=True)
        return {
            "paths": [],
            "typeIds": [],
            "collectionIds": [],
            "queryIds": [qid],
            "skipped": [],
        }

    def rows(
        self,
        type_ids: list[str] | None = None,
        collection_ids: list[str] | None = None,
        paths: list[str] | None = None,
        search: tuple[list[str], str] | None = None,
    ):
        """The objects in scope as `rows.Row`s (decoded values, links, preview), sorted by path."""
        from .rows import build_rows

        return build_rows(self, type_ids, collection_ids, paths, search)

    def type_by_id(self, type_id: str) -> TypeDefinition | None:
        return next((t for t in self.types if t.id == type_id), None)

    def _type_id(self, type_name: str) -> str:
        """The id of the type `type_name` names: by name, then id, then former names."""
        lowered = type_name.lower()
        for match in (
            lambda t: t.name.lower() == lowered,
            lambda t: t.id.lower() == lowered,
            lambda t: lowered in (f.lower() for f in t.formerNames),
        ):
            for t in self.types:
                if match(t):
                    return t.id
        return slug(type_name)

    # -- paths --------------------------------------------------------------

    def _rel(self, path: str) -> str:
        """Normalise a space-relative path; reject anything outside the space."""
        rel = PurePosixPath(str(path).replace("\\", "/"))
        if rel.is_absolute() or ".." in rel.parts or not rel.parts:
            raise ValueError(f"Path is outside the space: {path!r}")
        if is_ignored(rel) or rel.name.startswith(".") or rel.suffix.lower() != ".md":
            raise ValueError(f"Not an object path: {path!r}")
        full = (self.root / rel).resolve()
        if not full.is_relative_to(self.root):
            raise ValueError(f"Path is outside the space: {path!r}")
        return rel.as_posix()

    def abspath(self, path: str) -> Path:
        return self.root / self._rel(path)

    # -- objects ------------------------------------------------------------

    def _summarize(self, raw: RawObject) -> ObjectSummary:
        fm = raw.fm
        return ObjectSummary(
            path=raw.path,
            id=_str_or_none(fm.get("id")),
            type=self._type_id(raw.typeName),
            title=_title_of(raw),
            icon=_str_or_none(fm.get("icon")),
            createdAt=_str_or_none(fm.get("createdAt")),
            lastUpdated=_str_or_none(fm.get("lastUpdated")),
            tags=_str_list(fm.get("tags")),
            readOnly=raw.readOnly,
            readOnlyReason=raw.readOnlyReason,
            description=_str_or_none(fm.get("description")),
            aliases=_str_list(fm.get("aliases")),
            coverImage=_str_or_none(fm.get("coverImage")),
            iconColor=_str_or_none(fm.get("iconColor")),
            template=None if raw.readOnly else _str_or_none(fm.get("template")),
            color=_str_or_none(fm.get("color")),
            collections=_str_list(fm.get("collections")),
        )

    def list(self, type_id: str | None = None) -> list[ObjectSummary]:
        """The space's objects (templates excluded), optionally of one type."""
        with self._lock:
            items = sorted(
                (s for s in self._summaries.values() if s.template is None), key=lambda s: s.path
            )
        if type_id is None:
            return items
        return [s for s in items if s.type == type_id]

    def get(self, path: str) -> ObjectSummary:
        rel = self._rel(path)
        with self._lock:
            return self._summaries[rel]

    def read(self, path: str) -> tuple[ObjectFile, dict, str]:
        """Read the object fresh from disk: (split file, frontmatter values, version)."""
        rel = self._rel(path)
        if not (self.root / rel).is_file():
            raise KeyError(rel)
        raw = read_raw(self.root, rel)
        return raw.of, dict(raw.fm), version_of(raw.data)

    # -- the write engine -----------------------------------------------------

    def _write(
        self,
        rel: str,
        base_version: str | None,
        edit: Edit,
        stamp: bool = True,
        now: datetime | None = None,
    ) -> str:
        """Apply `edit` to an object file safely; return its (new) version.

        Re-reads the file, raises `Conflict` when it isn't at ``base_version``
        (``None`` means "whatever is current") and `ReadOnly` when it can't be
        saved. An edit that changes nothing writes nothing. With `stamp`,
        ``lastUpdated`` is set and an ``id`` inserted first when missing. A file
        without frontmatter gets a new fence block. Line endings, BOM and every
        untouched line's bytes are kept; the replace re-checks the version.
        ``now`` is the write's instant for the stamp (default: `Space.clock`).
        """
        rel = self._rel(rel)
        full = self.root / rel
        with self._lock:
            if not full.is_file():
                raise KeyError(rel)
            raw = read_raw(self.root, rel)
            current = version_of(raw.data)
            if base_version is not None and current != base_version:
                raise Conflict(current)
            if raw.readOnly:
                raise ReadOnly(raw.readOnlyReason or "Object is read-only")
            of = edit(raw.of, dict(raw.fm))
            if of is None or join_object(of) == join_object(raw.of):
                return current
            if stamp:
                insert_first = None if _str_or_none(raw.fm.get("id")) else {"id": new_ulid()}
                fm_src = set_keys(
                    of.frontmatter_src or "",
                    {"lastUpdated": now_stamp(now or self.clock())},
                    insert_first=insert_first,
                )
                of = replace(of, frontmatter_src=fm_src)
            # Untouched lines keep their own bytes (and line endings) from the original.
            data = encode_like(raw.data, join_object(of))
            new_version = version_of(data)

            def unchanged_on_disk() -> None:
                # Re-check right before the replace: an external write since the
                # read above must surface as a conflict, never be overwritten.
                try:
                    now = version_of(full.read_bytes())
                except OSError as exc:
                    raise KeyError(rel) from exc
                if now != current:
                    raise Conflict(now)

            self._call_before_write(rel, raw.data)
            self.own_writes[rel] = new_version
            try:
                atomic_write(full, data, check=unchanged_on_disk)
            except BaseException:
                if self.own_writes.get(rel) == new_version:
                    del self.own_writes[rel]
                raise
            self.rescan_file(rel)
            return new_version

    def _rewrite_other(self, rel: str, edit: Edit, stamp: bool = False) -> str | Skip:
        """Rewrite another file on the user's behalf (unstamped unless asked).

        Retries once on `Conflict`; a second conflict, a read-only file or a
        missing one is returned as a `Skip` and the file is left as it is.
        """
        for attempt in range(2):
            try:
                return self._write(rel, None, edit, stamp=stamp)
            except Conflict:
                if attempt:
                    return Skip(rel, "The file changed on disk while it was being updated")
            except ReadOnly as exc:
                return Skip(rel, exc.reason)
            except (KeyError, FileNotFoundError):
                return Skip(rel, "The file no longer exists")
            except PermissionError as exc:  # e.g. locked by another program
                return Skip(rel, f"The file could not be written: {exc.strerror or exc}")
            except FrontmatterError:
                # One file the edit can't rewrite must not stop the caller's
                # loop over the others (a rename would stop halfway).
                return Skip(rel, "The file's frontmatter could not be rewritten")
        raise AssertionError("unreachable")

    @staticmethod
    def _fm_edit(fn: Callable[[str, dict], str]) -> Edit:
        """An `Edit` that rewrites only the frontmatter source with ``fn(src, fm)``."""

        def edit(of: ObjectFile, fm: dict) -> ObjectFile | None:
            src = of.frontmatter_src or ""
            new = fn(src, fm)
            if new == src:
                return None
            return replace(of, frontmatter_src=new)

        return edit

    def save_body(self, path: str, body: str, base_version: str) -> str:
        """Replace an object's body, touching nothing else; return the new version.

        Raises `Conflict` when the file on disk no longer matches ``base_version``
        and `ReadOnly` when its frontmatter is malformed. An unchanged body
        writes nothing. Otherwise ``lastUpdated`` is set (in place, or appended)
        and an ``id`` is inserted first if absent; line endings, BOM and the
        trailing newline are kept.
        """
        body = body.replace("\r\n", "\n")

        def edit(of: ObjectFile, _fm: dict) -> ObjectFile | None:
            return None if of.body == body else replace(of, body=body)

        return self._write(path, base_version, edit)

    # -- properties -----------------------------------------------------------

    def _type_of(self, rel: str) -> TypeDefinition | None:
        with self._lock:
            summary = self._summaries.get(rel)
        if summary is None:
            self.rescan_file(rel)
            with self._lock:
                summary = self._summaries.get(rel)
        return self.type_by_id(summary.type) if summary is not None else None

    @staticmethod
    def _pdef(t: TypeDefinition | None, key: str) -> PropertyDefinition | None:
        """The definition of ``key``: the type's own, else the system definition."""
        if t is not None:
            p = t.prop(key)
            if p is not None:
                return p
        for p in (*system_property_defs(include_type=True), *_EXTRA_SYSTEM_DEFS):
            if p.key == key:
                return p
        return None

    def _ref_path(self, ref: Any, from_rel: str) -> str | None:
        """The object path an API entity reference points at (``path`` wins)."""
        if isinstance(ref, str):
            ref = {"target": ref, "path": None}
        if not isinstance(ref, dict):
            return None
        path = ref.get("path")
        if isinstance(path, str) and path.strip():
            try:
                rel = self._rel(path.strip())
            except ValueError as exc:
                raise InvalidValue(str(exc)) from exc
            with self._lock:
                if rel not in self._summaries:
                    raise InvalidValue(f"No object at {path!r}")
            return rel
        target = ref.get("target")
        return self.resolve(target, from_rel) if isinstance(target, str) else None

    def _link_text(self, path: str, from_rel: str) -> str:
        """Link text for ``path`` from ``from_rel``: its title, or the path form.

        The path form is used for duplicate titles and for titles a wikilink
        can't hold (``[``, ``]``, ``|``, ``#`` or a line break end the target).
        """
        with self._lock:
            summary = self._summaries.get(path)
        if (
            summary is not None
            and not _LINK_BREAKING_RE.search(summary.title)
            and self.resolve(summary.title, from_rel) == path
        ):
            return summary.title
        return path[:-3] if path.lower().endswith(".md") else path

    def _link_for(self, from_rel: str) -> Callable[[dict], str]:
        def link_for(ref: dict) -> str:
            path = ref.get("path")
            if isinstance(path, str) and path.strip():
                rel = self._ref_path(ref, from_rel)
                assert rel is not None
                return self._link_text(rel, from_rel)
            target = ref.get("target")
            return target.strip() if isinstance(target, str) else ""

        return link_for

    def _check_fixed_set(self, pdef: PropertyDefinition, value: Any, from_rel: str) -> None:
        if not pdef.options.get("hasFixedSet") or not isinstance(value, list):
            return
        allowed = set(pdef.options.get("fixedSet") or [])
        for ref in value:
            path = self._ref_path(ref, from_rel)
            with self._lock:
                summary = self._summaries.get(path) if path else None
            if summary is None or summary.id not in allowed:
                raise InvalidValue(f"{pdef.name} only takes the objects of its fixed set")

    def links_of(self, path: str, fm: dict) -> dict[str, list[str | None]]:
        """Each entity value of the object resolved from its own file (None when dangling)."""
        rel = self._rel(path)
        t = self._type_of(rel)
        out: dict[str, list[str | None]] = {}
        for p in t.propertyDefinitions if t is not None else []:
            if p.type != "entity":
                continue
            refs = decode_value(p, fm.get(p.key))
            out[p.key] = [self.resolve(r["target"], rel) for r in refs]
        return out

    def _linked_paths(self, pdef: PropertyDefinition, raw: Any, rel: str) -> set[str]:
        refs = decode_value(pdef, raw)
        found = (self.resolve(r["target"], rel) for r in refs)
        return {p for p in found if p is not None and p != rel}

    def update_properties(
        self,
        path: str,
        updates: dict[str, Any],
        base_version: str,
        remove: Iterable[str] = (),
    ) -> UpdateResult:
        """Write property values (API form) and remove keys, as one stamped write.

        Keys map through the type's definitions (system keys to the system
        definitions); a key without a definition takes a JSON scalar as is.
        ``title`` and ``type`` are refused (`InvalidValue`): they change through
        rename and change type. Synced relations are updated afterwards in the
        linked objects; a sync failure is reported in ``skipped`` and never
        undoes the main write.
        """
        rel = self._rel(path)
        remove = list(remove)
        for key in (*updates, *remove):
            if key in _LOCKED_KEYS:
                raise InvalidValue(f"{key!r} can't be changed as a property")
        t = self._type_of(rel)
        before: dict = {}
        task: list[TaskResult | None] = [None]
        now = self.clock()  # one instant for `completed`, `lastUpdated` and "today"

        def hook(fm: dict, sets: dict[str, Any], removals: list[str]) -> None:
            task[0] = on_status_change(
                t, fm, sets, removals, now, self.tz, explicit={*updates, *remove},
                week_start=week_start_of(self.root),
            )

        def apply(src: str, fm: dict) -> str:
            before.update(fm)
            task[0] = None
            return self._apply_values(t, rel, src, fm, updates, remove, hook=hook)

        version = self._write(rel, base_version, self._fm_edit(apply), now=now)
        _of, fm, _v = self.read(rel)
        synced, skipped = self._sync_relations(rel, t, before, fm)
        return UpdateResult(
            version=version,
            frontmatter=fm,
            links=self.links_of(rel, fm),
            synced=synced,
            skipped=skipped,
            task=task[0],
        )

    def _apply_values(
        self,
        t: TypeDefinition | None,
        rel: str,
        src: str,
        fm: dict,
        updates: dict[str, Any],
        remove: Iterable[str] = (),
        merge_collections: bool = False,
        hook: Callable[[dict, dict[str, Any], list[str]], None] | None = None,
    ) -> str:
        """Frontmatter source ``src`` with ``updates`` encoded in and the ``remove`` keys dropped.

        With ``merge_collections`` the ``collections`` names are added to the ones
        already in ``fm`` (a new object from a template). ``hook(fm, sets,
        removals)`` (the Task status hook, `update_properties` only) may edit
        what is written before it is; a ``date`` it rewrites keeps its line's
        quotes and trailing comment.
        """
        sets: dict[str, Any] = {}
        removals: list[str] = []
        for key, value in updates.items():
            pdef = self._pdef(t, key)
            if pdef is None:
                encoded = _json_scalar(key, value)
                if encoded is not None or key in fm:
                    sets[key] = encoded
                continue
            if pdef.type == "entity":
                self._check_fixed_set(pdef, value, rel)
            if pdef.type == "entity_collections":
                existing = _str_list(fm.get(key))
                if merge_collections and isinstance(value, list):
                    value = [*existing, *value]
                value = self._resolve_collection_names(t, value, existing)
            u, r = encode_updates(pdef, value, fm, link_for=self._link_for(rel))
            sets.update(u)
            removals.extend(r)
        removals.extend(k for k in remove if k in fm)
        in_place: dict[str, str] = {}
        if hook is not None:
            explicit_date = "date" in sets
            hook(fm, sets, removals)
            new_date = sets.get("date")
            if not explicit_date and isinstance(new_date, str) and isinstance(fm.get("date"), str):
                in_place["date"] = sets.pop("date")
        out = set_keys(src, sets) if sets else src
        for key, value in in_place.items():
            out = replace_in_value(out, key, lambda _old, value=value: value)
        return delete_keys(out, [k for k in removals if k not in sets and k not in in_place])

    def _sync_relations(
        self, rel: str, t: TypeDefinition | None, old: dict, new: dict
    ) -> tuple[list[str], list[Skip]]:
        """Add or remove ``[[this]]`` in the counterpart property of each newly (un)linked object."""
        synced: list[str] = []
        skipped: list[Skip] = []
        for pdef in t.propertyDefinitions if t is not None else []:
            sync = pdef.options.get("propertySyncing")
            ids = sync.get("propertyIds") if isinstance(sync, dict) else None
            if pdef.type != "entity" or not ids:
                continue
            was = self._linked_paths(pdef, old.get(pdef.key), rel)
            now = self._linked_paths(pdef, new.get(pdef.key), rel)
            for target in sorted(was ^ now):
                with self._lock:
                    summary = self._summaries.get(target)
                if summary is None:
                    continue
                if summary.readOnly:
                    # Its type can't be read either; report it rather than guess.
                    skipped.append(Skip(target, summary.readOnlyReason or "Object is read-only"))
                    continue
                tt = self.type_by_id(summary.type)
                cdef = next(
                    (
                        p
                        for p in (tt.propertyDefinitions if tt is not None else [])
                        if p.id in ids and p.type == "entity"
                    ),
                    None,
                )
                if cdef is None:
                    continue
                edit = self._backlink_edit(cdef, rel, target, add=target in now)
                wrote: list[bool] = []

                def tracked(of: ObjectFile, fm: dict, edit=edit, wrote=wrote) -> ObjectFile | None:
                    out = edit(of, fm)
                    wrote.append(out is not None)
                    return out

                result = self._rewrite_other(target, tracked, stamp=True)
                if isinstance(result, Skip):
                    skipped.append(result)
                elif wrote and wrote[-1]:
                    synced.append(target)
        return synced, skipped

    def _backlink_edit(self, cdef: PropertyDefinition, rel: str, target: str, add: bool) -> Edit:
        """Add (or remove) the link to ``rel`` in ``target``'s ``cdef`` value, keeping other items."""

        def apply(src: str, fm: dict) -> str:
            raw = fm.get(cdef.key)
            items = [i for i in (raw if isinstance(raw, list) else [raw]) if i is not None]
            single = cdef.options.get("isArray") is False
            pointing = [i for i in items if self._linked_paths(cdef, i, target) == {rel}]
            if add:
                if pointing:
                    return src
                link = f"[[{self._link_text(rel, target)}]]"
                kept = [link] if single else [*items, link]
            else:
                if not pointing:
                    return src
                kept = [i for i in items if i not in pointing]
            if not kept:
                value: Any = None
            elif single and not isinstance(raw, list):
                value = kept[0]
            else:
                value = FlowList(kept)
                if not add and isinstance(raw, list):
                    # Drop only the removed links' bytes: comments and quotes stay.
                    out = remove_items(src, cdef.key, lambda v: v in pointing)
                    if out is not None:
                        return out
            return set_keys(src, {cdef.key: value})

        return self._fm_edit(apply)

    def ensure_id(self, path: str) -> tuple[str, str]:
        """The object's ``id``, inserted first in its frontmatter if missing (unstamped)."""
        found: list[str] = []

        def apply(src: str, fm: dict) -> str:
            existing = _str_or_none(fm.get("id"))
            if existing:
                found.append(existing)
                return src
            new = new_ulid()
            found.append(new)
            return set_keys(src, {}, insert_first={"id": new})

        version = self._write(path, None, self._fm_edit(apply), stamp=False)
        return found[-1], version

    # -- rename -------------------------------------------------------------

    def _is_title_locked(self, rel: str) -> bool:
        """A daily note's title is its date: it can't be renamed."""
        t = self._type_of(rel)
        return t is not None and t.basic and t.name.lower() == "dailynote"

    def _referrers(self, rel: str, old_title: str) -> dict[str, set[str]]:
        """Files linking to ``rel`` by its title or file name: path -> the link targets that do.

        A link qualifies when its target text equals the old title, file stem
        or space path (without ``.md``), case-insensitively, **and** it resolves
        to ``rel`` from the linking file. Links that reach it through an alias,
        or that resolve to another object with the same title, don't.
        """
        names = {_fold(old_title), _fold(PurePosixPath(rel).stem), _fold(rel[:-3])}
        with self._lock:
            raws = list(self._raw.values())
        out: dict[str, set[str]] = {}
        for raw in raws:
            text = (raw.of.frontmatter_src or "") + raw.of.body
            if "[[" not in text:
                continue
            found = {
                t
                for t in wikilink_targets(text)
                if _fold(t) in names and self.resolve(t, raw.path) == rel
            }
            if found:
                out[raw.path] = found
        return out

    @staticmethod
    def _relink_edit(targets: set[str], new_text: str) -> Edit:
        """Rewrite the links whose target is one of ``targets`` (exactly) to ``new_text``."""

        def should(t: str) -> bool:
            return t in targets

        def edit(of: ObjectFile, fm: dict) -> ObjectFile | None:
            body = replace_wikilinks(of.body, should, new_text)
            src = of.frontmatter_src
            if src is not None:
                src = relink_frontmatter(src, fm, should, new_text)
            if body == of.body and src == of.frontmatter_src:
                return None
            return replace(of, frontmatter_src=src, body=body)

        return edit

    def _move_file(self, rel: str, new_rel: str, version: str) -> None:
        """Move an object file within the space, never overwriting, quietly for the watcher.

        A case-only rename goes through a temporary (dot) name, so it works on
        case-insensitive file systems too. A move keeps the file's bytes, so it calls no
        `before_write` hook (M8 history follows the object by its ``id``; the write before
        a rename is where its version is kept).
        """
        src = self.root / rel
        dest = self.root / new_rel
        case_only = rel.lower() == new_rel.lower()
        if dest.exists() and not (case_only and _same_file(src, dest)):
            # A case-only spelling that names another file (case-sensitive
            # folder) is taken too: never overwrite it.
            raise FileExistsError(new_rel)
        self.own_deletes[rel] = version
        self.own_writes[new_rel] = version
        try:
            if case_only:
                tmp = src.with_name(f".rename-{new_ulid()}.tmp")
                retry_os(lambda: os.rename(src, tmp))
                try:
                    retry_os(lambda: os.rename(tmp, dest))
                except BaseException:
                    os.rename(tmp, src)
                    raise
            else:
                move_no_overwrite(src, dest)
        except BaseException:
            self.own_deletes.pop(rel, None)
            self.own_writes.pop(new_rel, None)
            raise
        if case_only and src.exists():
            # Case-insensitive file system: the old spelling names the new file,
            # and the watcher only ever sees that one.
            self.own_deletes.pop(rel, None)
        self.own_writes.pop(rel, None)
        with self._lock:
            self._raw.pop(rel, None)
            if self._summaries.pop(rel, None) is not None:
                self._names_changed()
            self._fire(SpaceChange("object", rel))
        self.rescan_file(new_rel)

    def _rename_target(self, rel: str, new_title: str) -> str:
        """The new path for ``rel`` titled ``new_title`` (in its folder, made unique)."""
        parent = PurePosixPath(rel).parent.as_posix()
        folder = "" if parent == "." else parent
        stem = safe_filename(new_title)
        free = unique_path
        if self._is_whiteboard(rel):
            # A whiteboard's stem must be free for its .md and both sidecars (M6).
            from .whiteboardtrash import free_whiteboard_stem as free
        return self._free_target(rel, folder, stem, free)

    def _free_target(
        self, rel: str, folder: str, stem: str, free: Callable[..., str] = unique_path
    ) -> str:
        """Where ``rel`` can move to as ``<folder>/<stem>.md``: its own spelling or a free name."""
        new_rel = free(self.root, folder, stem, same_as=rel)
        dest = self.root / new_rel
        if new_rel == rel or not dest.exists():
            return new_rel
        # On a case-sensitive file system both spellings can exist: then pick a free name.
        return new_rel if _same_file(self.root / rel, dest) else free(self.root, folder, stem)

    def _board_referrers(self, rel: str, old_title: str) -> dict[str, set[str]]:
        """Whiteboards whose board file links to ``rel`` by its old name: board .md -> targets.

        The same rule as `_referrers`, over each board's entity blocks and text-block links
        (read only; an unreadable or missing board adds nothing).
        """
        from .whiteboardfile import board_rel, load_board
        from .whiteboardstore import whiteboard_type
        from .whiteboardtrash import board_links

        t = whiteboard_type(self)
        if t is None:
            return {}
        names = {_fold(old_title), _fold(PurePosixPath(rel).stem), _fold(rel[:-3])}
        with self._lock:
            boards = [p for p, s in self._summaries.items() if s.type == t.id]
        out: dict[str, set[str]] = {}
        for md in boards:
            with self._lock:
                try:
                    data = (self.root / board_rel(md)).read_bytes()
                except OSError:
                    continue
            board, reason = load_board(data)
            if reason:
                continue
            found = {
                target
                for target in board_links(board)
                if _fold(target) in names and self.resolve(target, md) == rel
            }
            if found:
                out[md] = found
        return out

    def rename_object(self, path: str, new_title: str, base_version: str) -> RenameResult:
        """Set an object's title, rename its file to match, and relink references to it.

        The title (and the first ``# Old title`` heading of the body) is written
        as a stamped user edit; the file then moves to `safe_filename` of the
        new title in the same folder, made unique (never overwriting; a
        case-only change keeps the name without a suffix). Links in other files
        that reached it by its old title or file name are rewritten, unstamped,
        link text only; the ones that can't be are reported in ``skipped``.
        Raises `Conflict`, `ReadOnly`, `KeyError`, and `InvalidValue` for an
        empty title or a daily note.
        """
        rel = self._rel(path)
        new_title = " ".join(str(new_title or "").split())
        if not (self.root / rel).is_file():
            raise KeyError(rel)
        if not new_title:
            raise InvalidValue("The title can't be empty")
        if self._is_title_locked(rel):
            raise InvalidValue("A daily note's title is its date and can't be changed")
        with self._lock:
            summary = self._summaries.get(rel)
        if summary is None:
            raise KeyError(rel)
        old_title = summary.title
        if new_title == old_title:
            version = self._write(rel, base_version, lambda _of, _fm: None)
            return RenameResult(rel, version, [], [])

        referrers = self._referrers(rel, old_title)
        board_referrers = self._board_referrers(rel, old_title)
        whiteboard = self._is_whiteboard(rel)

        def edit(of: ObjectFile, _fm: dict) -> ObjectFile | None:
            src = set_keys(of.frontmatter_src or "", {"title": new_title})
            body = of.body
            for m in _HEADING_RE.finditer(body):
                if m.group(1).strip() == old_title:
                    body = body[: m.start()] + f"# {new_title}" + body[m.end() :]
                    break
            return replace(of, frontmatter_src=src, body=body)

        with self._lock:
            version = self._write(rel, base_version, edit)
            new_rel = self._rename_target(rel, new_title)
            if new_rel != rel:
                try:
                    self._move_file(rel, new_rel, version)
                except OSError:
                    # The title change stands; the file just keeps its old name
                    # (locked by another program, or the name was taken meanwhile).
                    new_rel = rel
                else:
                    if whiteboard:
                        new_rel = self._move_board_files(rel, new_rel, version)

        relinked: list[str] = []
        skipped: list[Skip] = []
        for ref in sorted(referrers):
            own = ref == rel
            at = new_rel if own else ref
            relink = self._relink_edit(referrers[ref], self._link_text(new_rel, at))
            wrote: list[bool] = []

            def tracked(of: ObjectFile, fm: dict, e=relink, w=wrote) -> ObjectFile | None:
                out = e(of, fm)
                w.append(out is not None)
                return out

            result = self._rewrite_other(at, tracked)
            if own:  # links to itself: part of the rename, not a referrer
                if not isinstance(result, Skip):
                    version = result
            elif isinstance(result, Skip):
                skipped.append(result)
            elif wrote and wrote[-1]:
                relinked.append(ref)
        if board_referrers:
            from .whiteboardtrash import relink_board_file

            for md in sorted(board_referrers):
                at = new_rel if md == rel else md
                written = relink_board_file(
                    self, at, board_referrers[md], self._link_text(new_rel, at)
                )
                if written is not None:
                    relinked.append(written)
                    self.rescan_file(at)  # the link index and search re-read the board
        if summary.type == "tag":
            self._rename_tag_lists(old_title, new_title, new_rel, relinked, skipped)
        return RenameResult(new_rel, version, relinked, skipped)

    def _move_board_files(self, rel: str, new_rel: str, version: str) -> str:
        """Move a renamed whiteboard's sidecars after its .md; return where the .md ends up.

        If the sidecars can't follow (both or neither move), the .md goes back to ``rel``
        and the board keeps its old file name; the title change stands.
        """
        from .whiteboardtrash import move_sidecars

        try:
            move_sidecars(self, rel, new_rel)
        except OSError:
            try:
                self._move_file(new_rel, rel, version)
            except OSError:
                _log.exception("Could not move %s back after its sidecars failed", new_rel)
                return new_rel
            return rel
        return new_rel

    def _rename_tag_lists(
        self, old: str, new: str, tag_rel: str, relinked: list[str], skipped: list[Skip]
    ) -> None:
        """Rename the tag ``old`` to ``new`` in every ``tags:`` list (unstamped, one item each)."""
        folded = _fold(old)
        with self._lock:
            holders = sorted(
                rel
                for rel, raw in self._raw.items()
                if rel != tag_rel
                and not raw.readOnly
                and any(_fold(t) == folded for t in _str_list(raw.fm.get("tags")))
            )
        for rel in holders:
            wrote: list[bool] = []
            edit = self._fm_edit(lambda src, fm: rewrite_tag_lists(src, fm, old, new))

            def tracked(of: ObjectFile, fm: dict, e=edit, w=wrote) -> ObjectFile | None:
                out = e(of, fm)
                w.append(out is not None)
                return out

            result = self._rewrite_other(rel, tracked)
            if isinstance(result, Skip):
                skipped.append(result)
            elif wrote and wrote[-1] and rel not in relinked:
                relinked.append(rel)

    # -- tags -----------------------------------------------------------------

    def ensure_tag(self, name: str) -> tuple[str, bool]:
        """The Tag object named ``name`` (case-insensitively): (path, created).

        When none exists, creates ``Tags/<safe name>.md`` (the type's folder)
        with ``id``, ``type: 'Tag'``, ``title``, a random ``color: bg-<c>``,
        ``createdAt`` and ``lastUpdated``, and an empty body. Raises
        `InvalidValue` for an empty name.
        """
        title = " ".join(str(name or "").split())
        if not title:
            raise InvalidValue("A tag needs a name")
        t = self.type_by_id("tag")
        if t is None:
            raise KeyError("tag")
        folded = _fold(title)
        with self._lock:
            for s in sorted(self._summaries.values(), key=lambda s: s.path):
                if s.type == "tag" and s.template is None and _fold(s.title) == folded:
                    return s.path, False
            stamp = now_stamp()
            fm_src = set_keys(
                f"type: {_yaml_single_quoted(t.name)}\n",
                {
                    "title": title,
                    "color": f"bg-{random.choice(THEME_COLORS)}",
                    "createdAt": stamp,
                    "lastUpdated": stamp,
                },
                insert_first={"id": new_ulid()},
            )
            data = join_object(ObjectFile(fm_src, "", True, None)).encode("utf-8")
            self._persist_type(t)
            folder = t.folder.strip("/") or "Tags"
            stem = safe_filename(title)
            for _attempt in range(100):
                rel = unique_path(self.root, folder, stem)
                if self._place(rel, data):
                    return rel, True
        raise OSError(f"Could not find a free file name for {stem!r}")

    # -- change type ----------------------------------------------------------

    def _change_type_pair(self, rel: str, type_id: str) -> tuple[TypeDefinition, TypeDefinition]:
        """(current type, target type) of a type change; raises when it isn't allowed."""
        dst = self.type_by_id(type_id)
        if dst is None:
            raise KeyError(type_id)
        src = self._type_of(rel)
        if src is None:
            raise KeyError(rel)
        if type_category(src) not in CHANGE_FROM_ALLOWED:
            raise InvalidValue(f"The type of a {src.name} object can't be changed")
        if type_category(dst) not in CHANGE_TO_ALLOWED:
            raise InvalidValue(f"An object can't be changed to a {dst.name}")
        if src.id == dst.id:
            raise InvalidValue(f"The object already is a {dst.name}")
        return src, dst

    def suggest_change_type(self, path: str, type_id: str) -> list[MappingRow]:
        """The suggested property mapping for changing the object to ``type_id``.

        The mapping last used between the two types is preferred (``ui.json``).
        Raises `KeyError` and `InvalidValue` (a type that can't change, or be changed to).
        """
        rel = self._rel(path)
        if not (self.root / rel).is_file():
            raise KeyError(rel)
        src, dst = self._change_type_pair(rel, type_id)
        _of, fm, _v = self.read(rel)
        return suggest_mapping(src, dst, fm, remembered_mapping(self.root, src.id, dst.id))

    def _check_mapping(
        self, src: TypeDefinition, dst: TypeDefinition, mapping: dict[str, Any]
    ) -> dict[str, str | None]:
        targets = {q.key: q for q in mapping_targets(dst)}
        used: set[str] = set()
        out: dict[str, str | None] = {}
        for frm, to in (mapping or {}).items():
            if not isinstance(frm, str) or frm in CARRIED_KEYS:
                raise InvalidValue(f"{frm!r} can't be mapped: it carries over as it is")
            if to is None:
                out[frm] = None
                continue
            p = src.prop(frm)
            q = targets.get(to) if isinstance(to, str) else None
            if p is None:
                raise InvalidValue(f"{src.name} has no property {frm!r}")
            if q is None:
                raise InvalidValue(f"{dst.name} has no property {to!r} to map to")
            if q.key in used:
                raise InvalidValue(f"{q.name} can only take one value")
            if not compatible(p, q):
                raise InvalidValue(f"{p.name} can't become {q.name}")
            used.add(q.key)
            out[frm] = q.key
        return out

    def change_type(
        self, path: str, type_id: str, mapping: dict[str, Any], base_version: str
    ) -> ChangeTypeResult:
        """Change an object's type, mapping its property values, and move it to the type's folder.

        A file without frontmatter gets a fence block with ``id``, ``type``,
        ``title`` and ``lastUpdated``; otherwise the ``type:`` line is rewritten
        keeping its quotes. Each ``mapping`` entry ``from: to`` moves a value:
        an unchanged kind renames the key in place, another kind is converted
        (`convert_value`) into the target key and the source key is removed.
        Unmapped keys (``to`` is None, or not in the mapping) stay as they are.
        The write is stamped; the file then moves to ``<folder>/<safe_filename(title)>.md``
        (made unique). Links in other files that no longer resolve to it are
        relinked to its title, unstamped. The mapping is remembered in ``ui.json``.

        Raises `Conflict`, `ReadOnly`, `KeyError`, `TypeReadOnly` (a target type
        whose file can't be read gets new label options) and `InvalidValue`.
        """
        rel = self._rel(path)
        if not (self.root / rel).is_file():
            raise KeyError(rel)
        src, dst = self._change_type_pair(rel, type_id)
        clean = self._check_mapping(src, dst, mapping)
        with self._lock:
            summary = self._summaries.get(rel)
        if summary is None:
            raise KeyError(rel)
        title = summary.title

        # Converting into a label may add options to the target type.
        needs_options = any(
            to is not None
            and dst.prop(to).type == "label"
            and src.prop(frm) is not None
            and src.prop(frm).type != "label"
            for frm, to in clean.items()
        )
        dst_edit: TypeDefinition | None = None
        dst_revision = ""
        if needs_options:
            dst_edit, dst_revision = self._editable_type(dst.id)
        defs = dst_edit or dst
        options_before = json.dumps(
            [p.to_json() for p in defs.propertyDefinitions], sort_keys=True, default=str
        )
        referrers = self._referrers(rel, title)
        name = dst.name

        def apply(src_text: str | None, fm: dict) -> str:
            if src_text is None:
                new = set_keys(f"type: {_yaml_single_quoted(name)}\n", {"title": title})
            elif isinstance(fm.get("type"), str):
                new = replace_in_value(src_text, "type", lambda _v: name)
            else:
                new = set_keys(src_text, {"type": SingleQuotedScalarString(name)})
            sets: dict[str, Any] = {}
            removals: list[str] = []
            for frm, to in clean.items():
                if to is None or frm not in fm:
                    continue
                p = src.prop(frm)
                q = defs.prop(to)
                assert p is not None and q is not None
                if p.type == q.type and frm == to:
                    continue
                if p.type == q.type and to not in fm:
                    new = rename_key(new, frm, to)
                    continue
                raw = fm.get(frm)
                try:
                    value, _lossy = convert_value(p, q, raw)
                    encoded = encode_value(q, value, fm.get(to))
                except InvalidValue:
                    encoded = None
                if encoded is not None or to in fm:
                    sets[to] = encoded
                removals.append(frm)
            if sets:
                new = set_keys(new, sets)
            return delete_keys(new, [k for k in removals if k not in sets])

        def edit(of: ObjectFile, fm: dict) -> ObjectFile | None:
            return replace(of, frontmatter_src=apply(of.frontmatter_src, fm))

        with self._lock:
            type_written = False
            if dst_edit is None:
                type_written = self._persist_type(dst)
            version = self._write(rel, base_version, edit)
            if dst_edit is not None:
                after = json.dumps(
                    [p.to_json() for p in dst_edit.propertyDefinitions], sort_keys=True, default=str
                )
                if after != options_before or not dst_revision:
                    self._commit_type(dst_edit, dst_revision)
                    type_written = True
            folder = dst.folder.strip("/")
            new_rel = self._free_target(rel, folder, safe_filename(title))
            if new_rel != rel:
                (self.root / folder).mkdir(parents=True, exist_ok=True)
                self._move_file(rel, new_rel, version)

        try:
            save_change_type_preference(
                self.root,
                src.id,
                dst.id,
                [MappingRow(f, t, False) for f, t in clean.items()],
                self.own_writes,
                lock=self._lock,
            )
        except OSError:
            pass  # a preference that can't be saved is only not remembered

        relinked: list[str] = []
        skipped: list[Skip] = []
        for ref in sorted(referrers):
            own = ref == rel
            at = new_rel if own else ref
            stale = {t for t in referrers[ref] if self.resolve(t, at) != new_rel}
            if not stale:
                continue
            relink = self._relink_edit(stale, self._link_text(new_rel, at))
            wrote: list[bool] = []

            def tracked(of: ObjectFile, fm: dict, e=relink, w=wrote) -> ObjectFile | None:
                out = e(of, fm)
                w.append(out is not None)
                return out

            result = self._rewrite_other(at, tracked)
            if own:
                if not isinstance(result, Skip):
                    version = result
            elif isinstance(result, Skip):
                skipped.append(result)
            elif wrote and wrote[-1]:
                relinked.append(ref)
        return ChangeTypeResult(new_rel, version, relinked, skipped, type_written)

    # -- create ---------------------------------------------------------------

    def _persist_type(self, t: TypeDefinition) -> bool:
        """Write an inferred-only type's JSON (the first time it is used); True if written."""
        if t.readOnlyReason or type_revision(self.root, t.id):
            return False
        try:
            write_type_json(self.root, t, "")
        except (RevisionConflict, TypeReadOnly):
            return False
        self._types_changed(t.id)
        return True

    def create_object(
        self,
        type_id: str,
        title: str = "",
        template_id: str | None = None,
        values: dict[str, Any] | None = None,
    ) -> tuple[str, str]:
        """Create an object of the type in its folder; return (path, version).

        The frontmatter is ``id``, ``type: '<Name>'``, ``title`` (only when
        non-empty), ``createdAt`` and ``lastUpdated``; the body is ``# <title>``
        or empty. The file name is `safe_filename` of the title, made unique.

        ``template_id`` None applies the type's default template (if it still
        exists), ``"none"`` applies none, anything else that template (see
        `apply_template`). Without a title, a template's ``title`` (with its
        ``{date:FMT}`` placeholders expanded) is used.

        ``values`` (API form, like `update_properties`' ``updates``) go into the
        creating write; after a template they win, except ``collections``, which
        are merged with the template's. An invalid value raises `InvalidValue`
        before anything is written.

        Raises `KeyError` for an unknown type and `TemplateError` when the
        template can't be found or applied (nothing is written then).
        """
        t = self.type_by_id(type_id)
        if t is None:
            raise KeyError(type_id)
        tmpl: RawObject | None = None
        if template_id is None:
            default = t.templates.get("defaultTemplateId")
            if default and self._templates_allowed(t):
                try:
                    tmpl = self._find_template(t, str(default))
                except TemplateError:
                    tmpl = None  # a default that no longer exists is ignored
        elif template_id != "none":
            if not self._templates_allowed(t):
                raise TemplateError(f"{t.name} objects have no templates")
            tmpl = self._find_template(t, template_id)
        instant = self.clock()
        created = to_local(instant, self.tz)
        title = " ".join(str(title or "").split("\n")).strip()
        if not title and tmpl is not None:
            pattern = _str_or_none(tmpl.fm.get("title"))
            if pattern:
                title = " ".join(expand_title(pattern, created).split("\n")).strip()
        stamp = now_stamp(instant)
        fm_src = set_keys(
            f"type: {_yaml_single_quoted(t.name)}\n",
            {**({"title": title} if title else {}), "createdAt": stamp, "lastUpdated": stamp},
            insert_first={"id": new_ulid()},
        )
        body = f"# {title}\n" if title else ""
        of = ObjectFile(fm_src, body, True, None)
        if tmpl is not None:
            of = self._template_edit(t, tmpl, created)(of, parse_fm(fm_src)) or of
        stem = safe_filename(title) if title else "Untitled"
        if values:
            for key in values:
                if key in _LOCKED_KEYS:
                    raise InvalidValue(f"{key!r} can't be changed as a property")
            src = of.frontmatter_src or ""
            of = replace(
                of,
                frontmatter_src=self._apply_values(
                    t,
                    f"{t.folder.strip('/')}/{stem}.md",
                    src,
                    parse_fm(src),
                    values,
                    merge_collections=True,
                ),
            )
        data = join_object(of).encode("utf-8")
        version = version_of(data)
        with self._lock:
            self._persist_type(t)
            folder = t.folder.strip("/")
            (self.root / folder).mkdir(parents=True, exist_ok=True)
            free = unique_path
            if t.id == _WHITEBOARD_TYPE_ID:
                # A whiteboard's stem must be free for its .md and both sidecars, so a new
                # board never adopts an orphan sidecar (M6).
                from .whiteboardtrash import free_whiteboard_stem as free
            for _attempt in range(100):
                rel = free(self.root, folder, stem)
                if self._place(rel, data):
                    return rel, version
        raise OSError(f"Could not find a free file name for {stem!r}")

    def _place(self, rel: str, data: bytes) -> bool:
        """Write a new file at ``rel`` unless something is there by then; True if written."""
        full = self.root / self._rel(rel)
        self.own_writes[rel] = version_of(data)
        try:
            full.parent.mkdir(parents=True, exist_ok=True)
            create_new(full, data)
        except FileExistsError:
            self.own_writes.pop(rel, None)
            return False
        except BaseException:
            self.own_writes.pop(rel, None)
            raise
        self.rescan_file(rel)
        return True

    # -- daily notes (M4) -------------------------------------------------------

    def daily_note_type(self) -> TypeDefinition | None:
        """The basic DailyNote type, when the space has one (stored or inferred)."""
        return next((t for t in self.types if t.basic and t.name.lower() == "dailynote"), None)

    @staticmethod
    def daily_note_day(raw: RawObject) -> str | None:
        """The day a daily note stands for: its ``date``, else its ``title``, else its file stem."""
        return day_of(raw.fm, raw.path)

    def daily_notes(self) -> tuple[dict[str, str], list[tuple[str, list[str]]]]:
        """``{day: path}`` of the daily notes (first by path wins) and the duplicates.

        Templates and notes with no usable day are left out. Reads only memory.
        """
        t = self.daily_note_type()
        if t is None:
            return {}, []
        with self._lock:
            pairs = [
                (rel, self.daily_note_day(raw))
                for rel, raw in self._raw.items()
                if self._type_id(raw.typeName) == t.id
                and not (rel in self._summaries and self._summaries[rel].template)
            ]
        return build_index(pairs)

    # -- calendar (M4) -----------------------------------------------------------

    def calendar(self, from_day: str, to_day: str) -> dict[str, Any]:
        """The ``CalendarRange`` for local days ``from_day`` through ``to_day`` (memory only).

        Raises `InvalidValue` for a malformed day, ``from_day > to_day`` or more than 100 days.
        """
        from .calendarquery import calendar_range

        return calendar_range(self, from_day, to_day)

    def _ensure_daily_note_type(self) -> TypeDefinition:
        """The DailyNote type; a space that has none gets the basic one in memory."""
        t = self.daily_note_type()
        if t is not None:
            return t
        t = TypeDefinition.from_json(
            {
                "id": "dailynote",
                "name": "DailyNote",
                "pluralName": "DailyNotes",
                "folder": "DailyNotes",
                "icon": "ph-calendar-blank",
                "color": "blue",
                "propertyDefinitions": [
                    {"id": "date", "key": "date", "name": "Date", "type": "datetime",
                     "isArray": False},
                    {"id": "reviewed", "key": "reviewed", "name": "Reviewed",
                     "type": "boolean", "isArray": False},
                ],
            }
        )  # fmt: skip
        self.types.append(t)
        self._types_changed(t.id)
        return t

    def create_daily_note(self, day: str, template_id: str | None = None) -> tuple[str, str]:
        """Create the daily note for ``day`` as ``DailyNotes/<day>.md``; return (path, version).

        Frontmatter ``id``, ``type: 'DailyNote'``, ``title`` and ``date`` (the day),
        ``createdAt``, ``lastUpdated`` and ``reviewed: false``; the body is empty.
        ``template_id`` None applies the type's default template, ``"none"``
        none; a template adds its body and values, never ``title`` or ``date``,
        and its reference instant is local midnight of ``day``.

        Raises `InvalidValue` (malformed day), `TemplateError`, and
        `DailyNoteExists` when the day has a note or the file name is taken by
        another file (never a ``2026-10-23 2.md``: one note per day).
        """
        parsed = parse_day(day) if isinstance(day, str) else None
        if parsed is None or parsed != day.strip():
            raise InvalidValue(f"Not a day (YYYY-MM-DD): {day!r}")
        day = parsed
        with self._lock:
            t = self._ensure_daily_note_type()
            existing = self.daily_notes()[0].get(day)
            if existing is not None:
                raise DailyNoteExists(existing)
            tmpl: RawObject | None = None
            if template_id is None:
                default = t.templates.get("defaultTemplateId")
                if default:
                    try:
                        tmpl = self._find_template(t, str(default))
                    except TemplateError:
                        tmpl = None  # a default that no longer exists is ignored
            elif template_id != "none":
                tmpl = self._find_template(t, template_id)
            stamp = now_stamp(self.clock())
            fm_src = set_keys(
                f"type: {_yaml_single_quoted(t.name)}\n",
                {"title": day, "createdAt": stamp, "lastUpdated": stamp, "date": day,
                 "reviewed": False},
                insert_first={"id": new_ulid()},
            )  # fmt: skip
            of = ObjectFile(fm_src, "", True, None)
            if tmpl is not None:
                y, m, d = (int(x) for x in day.split("-"))
                midnight = datetime(y, m, d)  # noqa: DTZ001 (a local wall clock)
                created = to_local(from_local(midnight, self.tz), self.tz)
                of = self._template_edit(t, tmpl, created)(of, parse_fm(fm_src)) or of
                src = of.frontmatter_src or ""
                if parse_fm(src).get("date") != day:
                    of = replace(of, frontmatter_src=set_keys(src, {"date": day}))
            data = join_object(of).encode("utf-8")
            folder = t.folder.strip("/") or "DailyNotes"
            rel = f"{folder}/{day}.md"
            self._persist_type(t)
            if self._place(rel, data):
                return rel, version_of(data)
            # The name is taken: a racing client, a file the watcher hasn't
            # reported yet, or a file that is not this day's note.
            self.rescan_file(rel)
            existing = self.daily_notes()[0].get(day)
            if existing is not None:
                raise DailyNoteExists(existing)
            raise DailyNoteExists(rel, FILE_NAME_TAKEN)

    # -- delete and trash -------------------------------------------------------

    def _move_out(self, rel: str, dest: Path) -> None:
        """Move an object file out of the space (into the trash), quietly for the watcher."""
        full = self.root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.own_deletes[rel] = version_of(full.read_bytes())
        except OSError:
            self.own_deletes[rel] = ""
        try:
            retry_os(lambda: os.replace(full, dest))
        except BaseException:
            self.own_deletes.pop(rel, None)
            raise
        self.own_writes.pop(rel, None)
        self.rescan_file(rel)

    def _is_whiteboard(self, rel: str) -> bool:
        """True when ``rel`` is an object of the Whiteboard type (M6: it has sidecar files)."""
        from .whiteboardstore import is_whiteboard

        return is_whiteboard(self, rel)

    def delete_object(
        self,
        path: str,
        base_version: str | None = None,
        type_trash_id: str | None = None,
        collection_trash_id: str | None = None,
    ) -> TrashItem:
        """Move an object to the trash (bytes unchanged); links to it are left dangling.

        A stale ``base_version`` raises `Conflict`; a missing file `KeyError`.
        Read-only objects can be deleted (the file is moved, not rewritten).
        """
        rel = self._rel(path)
        full = self.root / rel
        with self._lock:
            if not full.is_file():
                raise KeyError(rel)
            current = version_of(full.read_bytes())
            if base_version is not None and current != base_version:
                raise Conflict(current)
            summary = self._summaries.get(rel)
            if summary is None:
                self.rescan_file(rel)
                summary = self._summaries.get(rel)
            item = TrashItem(
                id=new_ulid(),
                kind="object",
                originalPath=rel,
                title=summary.title if summary else PurePosixPath(rel).stem,
                type=summary.type if summary else "",
                deletedAt=now_stamp(),
                typeTrashId=type_trash_id,
                collectionTrashId=collection_trash_id,
            )
            meta = {
                k: v
                for k, v in item.to_api().items()
                if k not in ("objectCount", "collectionId", "name")
            }
            if type_trash_id is None:
                meta.pop("typeTrashId")
            if collection_trash_id is None:
                meta.pop("collectionTrashId")
            whiteboard = self._is_whiteboard(rel)
            meta_file = self.trash.object_meta_file(item.id)
            self.trash.write_json(meta_file, meta)
            try:
                self._move_out(rel, self.trash.object_file(item.id))
            except BaseException:
                meta_file.unlink(missing_ok=True)
                raise
            if whiteboard:
                from .whiteboardtrash import trash_sidecars

                try:
                    trash_sidecars(self, item.id, rel)
                except BaseException:
                    # The sidecars stayed (or went back): put the .md back beside them.
                    stored = self.trash.object_file(item.id)
                    self.own_writes[rel] = version_of(stored.read_bytes())
                    move_no_overwrite(stored, full)
                    self.own_deletes.pop(rel, None)
                    meta_file.unlink(missing_ok=True)
                    self.rescan_file(rel)
                    raise
            if summary is not None and summary.template and summary.id and type_trash_id is None:
                self.unregister_template(summary.type, summary.id)
            return item

    def _templates_of(self, type_id: str) -> list[str]:
        """Paths of the template files (``template:`` key) whose type is ``type_id``."""
        with self._lock:
            raws = list(self._raw.values())
        return sorted(
            r.path
            for r in raws
            if not r.readOnly
            and r.fm.get("template") not in (None, "")
            and self._type_id(r.typeName) == type_id
        )

    # -- templates ------------------------------------------------------------

    @staticmethod
    def _templates_allowed(t: TypeDefinition) -> bool:
        """Page, Task, DailyNote and custom types have templates (Tag has none)."""
        return not t.basic or t.name.lower() in ("page", "task", "dailynote")

    def template_versions(self) -> dict[str, str]:
        """Path -> version of every template file (to see which ones a call wrote)."""
        with self._lock:
            return {
                r.path: version_of(r.data)
                for r in self._raw.values()
                if not r.readOnly and r.fm.get("template") not in (None, "")
            }

    def list_templates(self, type_id: str) -> list[ObjectSummary]:
        """The type's templates: its ``templates.ids`` order, then the other discovered ones.

        Discovery is by the template's ``type:`` key, not its folder. Nothing is
        written (a template without an ``id`` is listed as it is).
        """
        t = self.type_by_id(type_id)
        if t is None:
            raise KeyError(type_id)
        with self._lock:
            found = [self._summaries[p] for p in self._templates_of(t.id) if p in self._summaries]
        order = {tid: i for i, tid in enumerate(t.templates.get("ids") or [])}
        registered = sorted((s for s in found if s.id in order), key=lambda s: order[s.id])
        return [*registered, *(s for s in found if s.id not in order)]

    def _find_template(self, t: TypeDefinition, template_id: str) -> RawObject:
        """The template of ``t`` with this id (or path); one found by path gets an ``id``."""
        for path in self._templates_of(t.id):
            with self._lock:
                raw = self._raw.get(path)
            if raw is None:
                continue
            tid = _str_or_none(raw.fm.get("id"))
            if tid == template_id:
                return raw
            if path == template_id:
                if tid is None:
                    self.ensure_id(path)
                    with self._lock:
                        raw = self._raw[path]
                return raw
        raise TemplateError(f"No template {template_id!r} for {t.name}")

    def _save_templates_field(self, t: TypeDefinition, templates: dict[str, Any]) -> bool:
        """Write the type with a new ``templates`` value; False when it can't be saved."""
        if t.readOnlyReason:
            return False
        new = copy.deepcopy(t)
        new.templates = templates
        try:
            write_type_json(self.root, new, type_revision(self.root, t.id))
        except (RevisionConflict, TypeReadOnly):
            return False
        self.types = [new if x.id == t.id else x for x in self.types]
        self._types_changed(t.id)
        return True

    def unregister_template(self, type_id: str, template_id: str) -> bool:
        """Drop a template's id from its type's ``templates``; True when the type was written."""
        with self._lock:
            t = self.type_by_id(type_id)
            if t is None:
                return False
            ids = list(t.templates.get("ids") or [])
            default = t.templates.get("defaultTemplateId")
            if template_id not in ids and default != template_id:
                return False
            templates = {
                **t.templates,
                "ids": [i for i in ids if i != template_id],
                "defaultTemplateId": None if default == template_id else default,
            }
            return self._save_templates_field(t, templates)

    def create_template(self, type_id: str, name: str = "New template") -> tuple[str, str]:
        """Create an empty template of the type and register it; return (path, version).

        The file is ``Templates/<last segment of the type's folder>/<name>.md``
        with ``id``, ``type: '<Name>'`` and ``template: <name>``; its id is
        appended to ``templates.ids``. Raises `KeyError` (unknown type),
        `TypeReadOnly` and `InvalidValue` (a type without templates).
        """
        t = self.type_by_id(type_id)
        if t is None:
            raise KeyError(type_id)
        if not self._templates_allowed(t):
            raise InvalidValue(f"{t.name} objects have no templates")
        if t.readOnlyReason:
            raise TypeReadOnly(t.readOnlyReason)
        name = " ".join(str(name or "").split()) or "New template"
        segment = PurePosixPath(t.folder.strip("/")).name or safe_filename(t.pluralName)
        folder = f"Templates/{segment}"
        template_id = new_ulid()
        fm_src = set_keys(
            f"type: {_yaml_single_quoted(t.name)}\n",
            {"template": name},
            insert_first={"id": template_id},
        )
        data = join_object(ObjectFile(fm_src, "", True, None)).encode("utf-8")
        version = version_of(data)
        stem = safe_filename(name)
        with self._lock:
            (self.root / folder).mkdir(parents=True, exist_ok=True)
            for _attempt in range(100):
                rel = unique_path(self.root, folder, stem)
                if self._place(rel, data):
                    break
            else:
                raise OSError(f"Could not find a free file name for {stem!r}")
            t = self.type_by_id(type_id) or t
            ids = [*(t.templates.get("ids") or []), template_id]
            self._save_templates_field(t, {**t.templates, "ids": ids})
            return rel, version

    def _template_edit(
        self, t: TypeDefinition, tmpl: RawObject, created: datetime | None = None
    ) -> Edit:
        """An `Edit` that applies template ``tmpl`` to an object of ``t``.

        Each non-empty template value overwrites the object's (``template``,
        ``id``, ``type``, ``title``, ``createdAt`` and ``lastUpdated`` are never
        copied); ``{creation:<var>}`` on a ``datetime`` property becomes a date
        from ``created`` (default: the object's ``createdAt``, else now). The
        template's body is appended, or replaces a body that is only ``# Title``.
        Raises `TemplateError`.
        """

        def edit(of: ObjectFile, fm: dict) -> ObjectFile | None:
            when = created or _parse_created(fm.get("createdAt"))
            sets: dict[str, Any] = {}
            removals: list[str] = []
            for key, raw in tmpl.fm.items():
                if not isinstance(key, str) or key in _NOT_COPIED:
                    continue
                pdef = self._pdef(t, key)
                var = creation_variable(raw)
                if var is not None:
                    if pdef is None or pdef.type != "datetime":
                        raise TemplateError(f"{{creation:{var}}} needs a date property")
                    start, _, end = resolve_date_variable(var, when).partition(" -> ")
                    value: Any = {"start": start, "resolution": "day"}
                    if end:
                        value["end"] = end
                elif pdef is None:
                    if raw is None or raw == []:
                        continue
                    try:
                        sets[key] = _json_scalar(key, raw)
                    except InvalidValue as exc:
                        raise TemplateError(str(exc)) from exc
                    continue
                elif pdef.type in _NOT_COPIED_KINDS:
                    continue
                else:
                    value = decode_value(pdef, raw, tmpl.fm)
                    if value is None or value == []:
                        continue
                try:
                    u, r = encode_updates(pdef, value, fm)
                except InvalidValue as exc:
                    raise TemplateError(str(exc)) from exc
                sets.update(u)
                removals.extend(r)
            src = of.frontmatter_src or ""
            new_src = set_keys(src, sets) if sets else src
            new_src = delete_keys(new_src, [k for k in removals if k not in sets])
            body = of.body
            addition = tmpl.of.body.lstrip("\n")
            if addition.strip():
                if _TITLE_ONLY_RE.fullmatch(body):
                    body = addition
                else:
                    body = body.rstrip("\n") + "\n\n" + addition
            if new_src == src and body == of.body:
                return None
            fm_src = new_src if new_src != src else of.frontmatter_src
            return replace(of, frontmatter_src=fm_src, body=body)

        return edit

    def apply_template(self, path: str, template_id: str, base_version: str) -> str:
        """Apply a template of the object's type to it (one stamped write); return the version.

        Raises `Conflict`, `ReadOnly`, `KeyError` and `TemplateError` (a type
        without templates, an unknown template, a template applied to a
        template, or a value the template can't give).
        """
        rel = self._rel(path)
        t = self._type_of(rel)
        if t is None:
            raise KeyError(rel)
        if not self._templates_allowed(t):
            raise TemplateError(f"{t.name} objects have no templates")
        with self._lock:
            summary = self._summaries.get(rel)
        if summary is not None and summary.template:
            raise TemplateError("A template can't be applied to a template")
        tmpl = self._find_template(t, template_id)
        return self._write(rel, base_version, self._template_edit(t, tmpl))

    def _save_type(self, t: TypeDefinition) -> bool:
        try:
            write_type_json(self.root, t, type_revision(self.root, t.id))
        except (RevisionConflict, TypeReadOnly):
            return False
        self._types_changed(t.id)
        return True

    def trash_type(self, type_def: TypeDefinition, object_paths: Iterable[str]) -> TrashItem:
        """Move a type, its template files and the given objects to the trash.

        The type JSON and templates go to ``trash/types/<ulid>/``; each object
        becomes an object entry with ``typeTrashId``. Other types' relation
        properties that allowed this type stop allowing it; ``allowedTypesRefs``
        records them so a restore puts them back.
        """
        with self._lock:
            trash_id = new_ulid()
            folder = self.trash.type_dir(trash_id)
            folder.mkdir(parents=True, exist_ok=True)
            type_file = self.root / ".object" / "types" / f"{type_def.id}.json"
            if type_file.is_file():
                os.replace(type_file, folder / "type.json")
            else:
                (folder / "type.json").write_bytes(
                    (json.dumps(type_def.to_json(), indent=2, ensure_ascii=False) + "\n").encode()
                )
            views_file = self.root / ".object" / "views" / f"{type_def.id}.json"
            if views_file.is_file():
                self.own_writes[f".object/views/{type_def.id}.json"] = ""
                os.replace(views_file, folder / "views.json")
            objects = [self._rel(p) for p in object_paths]
            templates = [p for p in self._templates_of(type_def.id) if p not in objects]
            for rel in templates:
                self._move_out(rel, folder / "templates" / rel)
            object_ids = [
                self.delete_object(rel, type_trash_id=trash_id).id
                for rel in objects
                if (self.root / rel).is_file()
            ]
            refs: list[dict[str, str]] = []
            for other in self.types:
                if other.id == type_def.id or other.readOnlyReason:
                    continue
                touched = [
                    p
                    for p in other.propertyDefinitions
                    if p.type == "entity" and type_def.id in (p.options.get("allowedTypes") or [])
                ]
                if not touched:
                    continue
                changed = copy.deepcopy(other)
                for p in changed.propertyDefinitions:
                    if p.id in {q.id for q in touched}:
                        p.options["allowedTypes"] = [
                            a for a in p.options["allowedTypes"] if a != type_def.id
                        ]
                if self._save_type(changed):
                    other.propertyDefinitions = changed.propertyDefinitions
                    refs.extend({"typeId": other.id, "propertyId": p.id} for p in touched)
            deleted_at = now_stamp()
            self.trash.write_json(
                folder / "manifest.json",
                {
                    "id": trash_id,
                    "kind": "type",
                    "typeId": type_def.id,
                    "name": type_def.name,
                    "deletedAt": deleted_at,
                    "objectTrashIds": object_ids,
                    "allowedTypesRefs": refs,
                    "templates": templates,
                },
            )
            self.types = [t for t in self.types if t.id != type_def.id]
            self._types_changed(type_def.id)
            return TrashItem(
                id=trash_id,
                kind="type",
                originalPath=f".object/types/{type_def.id}.json",
                title=type_def.name,
                type=type_def.id,
                deletedAt=deleted_at,
                objectCount=len(object_ids),
            )

    def list_trash(self) -> list[TrashItem]:
        """Every trash entry, newest first."""
        with self._lock:
            return self.trash.items()

    def _restore_file(self, original: str, data: bytes) -> str:
        """Put bytes back at ``original`` (`` (2)``... on a collision); return the path used."""
        rel = self._rel(original)
        parent = PurePosixPath(rel).parent.as_posix()
        folder = "" if parent == "." else parent
        stem = PurePosixPath(rel).stem
        for _attempt in range(100):
            target = unique_path(self.root, folder, stem)
            if self._place(target, data):
                return target
        raise OSError(f"Could not find a free file name for {stem!r}")

    def _check_type_restorable(self, trash_id: str, manifest: dict) -> None:
        """Raise `InvalidValue` when a saved type now has the trashed type's id or name.

        Restoring over it would lose one of the two definitions; nothing is
        restored and the trash entry stays as it is.
        """
        type_id = str(manifest.get("typeId", ""))
        stored = self.trash.type_dir(trash_id) / "type.json"
        try:
            data = json.loads(stored.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if not isinstance(data, dict):
            return
        name = TypeDefinition.from_json(data, fallback_id=type_id).name
        for t in self.types:
            if not type_revision(self.root, t.id) and not t.readOnlyReason:
                continue  # inferred, never saved: the restored definition supersedes it
            if t.id == type_id or t.name.lower() == name.lower():
                raise InvalidValue(
                    f"An object type named {t.name} already exists. "
                    "Rename or delete it first, then restore."
                )

    def _restore_type_entry(self, trash_id: str, manifest: dict) -> tuple[list[str], list[str]]:
        """Restore a trashed type's definition, templates and relation refs; (paths, typeIds)."""
        folder = self.trash.type_dir(trash_id)
        type_id = str(manifest.get("typeId", ""))
        type_ids = [type_id]
        type_file = self.root / ".object" / "types" / f"{type_id}.json"
        stored = folder / "type.json"
        if stored.is_file():
            if type_file.exists():
                raise InvalidValue(f"An object type with the id {type_id} already exists.")
            type_file.parent.mkdir(parents=True, exist_ok=True)
            move_no_overwrite(stored, type_file)
        try:
            data = json.loads(type_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = None
        if isinstance(data, dict):
            restored = TypeDefinition.from_json(data, fallback_id=type_id)
            name = restored.name.lower()
            self.types = [
                t for t in self.types if t.id != restored.id and t.name.lower() != name
            ]
            self.types.append(restored)
            self.types.sort(key=lambda t: (t.name.lower(), t.name))
            self._types_changed(restored.id)
        stored_views = folder / "views.json"
        if stored_views.is_file():
            views_file = self.root / ".object" / "views" / f"{type_id}.json"
            if not views_file.exists():
                views_file.parent.mkdir(parents=True, exist_ok=True)
                self.own_writes[f".object/views/{type_id}.json"] = version_of(
                    stored_views.read_bytes()
                )
                move_no_overwrite(stored_views, views_file)
        paths: list[str] = []
        for original in manifest.get("templates") or []:
            src = folder / "templates" / original
            if src.is_file():
                paths.append(self._restore_file(original, src.read_bytes()))
        for ref in manifest.get("allowedTypesRefs") or []:
            other = self.type_by_id(str(ref.get("typeId")))
            if other is None or other.readOnlyReason:
                continue
            changed = copy.deepcopy(other)
            p = next((q for q in changed.propertyDefinitions if q.id == ref.get("propertyId")), None)
            if p is None or type_id in (p.options.get("allowedTypes") or []):
                continue
            p.options["allowedTypes"] = [*(p.options.get("allowedTypes") or []), type_id]
            if self._save_type(changed):
                other.propertyDefinitions = changed.propertyDefinitions
                if other.id not in type_ids:
                    type_ids.append(other.id)
        self.trash.remove_type(trash_id)
        # Objects whose type was unknown while it was in the trash resolve again.
        for rel in list(self._raw):
            self.rescan_file(rel)
        return paths, type_ids

    def _restore_object_entry(self, trash_id: str, meta: dict) -> str:
        from .whiteboardtrash import sidecar_trash_dir

        data = self.trash.object_file(trash_id).read_bytes()
        original = str(meta.get("originalPath", ""))
        # A whiteboard comes back under a stem free for all three names, even when it had no
        # sidecars to trash (restore_sidecars does nothing then), so it never adopts an orphan.
        if meta.get("type") == _WHITEBOARD_TYPE_ID or sidecar_trash_dir(self, trash_id).is_dir():
            path = self._restore_whiteboard(trash_id, original, data)
        else:
            path = self._restore_file(original, data)
        self.trash.remove_object(trash_id)
        return path

    def _restore_whiteboard(self, trash_id: str, original: str, data: bytes) -> str:
        """Put a trashed whiteboard's ``.md`` and its sidecars back under one free stem."""
        from .whiteboardtrash import free_whiteboard_stem, restore_sidecars

        rel = self._rel(original)
        parent = PurePosixPath(rel).parent.as_posix()
        folder = "" if parent == "." else parent
        stem = PurePosixPath(rel).stem
        for _attempt in range(100):
            target = free_whiteboard_stem(self.root, folder, stem)
            if self._place(target, data):
                break
        else:
            raise OSError(f"Could not find a free file name for {stem!r}")
        try:
            restore_sidecars(self, trash_id, target)
        except BaseException:
            # Leave the entry whole in the trash: take the .md back out.
            self.own_deletes[target] = version_of(data)
            (self.root / target).unlink(missing_ok=True)
            self.own_writes.pop(target, None)
            self.rescan_file(target)
            raise
        return target

    def restore(self, trash_id: str) -> dict[str, list[str]]:
        """Restore a trash entry; return ``{paths, typeIds}`` of what came back.

        An object returns to its original path (`` (2)`` on a collision); if its
        type is in the trash, the type definition and templates come back with
        it (not the type's other objects). A type entry restores the type, its
        templates, its remaining objects and its ``allowedTypesRefs``.
        Raises `KeyError` for an unknown id and `InvalidValue` when a saved type
        now has the trashed type's id or name (nothing is restored then).
        """
        with self._lock:
            meta = self.trash.object_meta(trash_id)
            if meta is not None:
                paths: list[str] = []
                type_ids: list[str] = []
                type_trash = meta.get("typeTrashId")
                manifest = self.trash.manifest(type_trash) if type_trash else None
                if manifest is not None:
                    self._check_type_restorable(type_trash, manifest)
                obj_path = self._restore_object_entry(trash_id, meta)
                if manifest is not None:
                    paths, type_ids = self._restore_type_entry(type_trash, manifest)
                return {"paths": [obj_path, *paths], "typeIds": type_ids}
            manifest = self.trash.manifest(trash_id)
            if manifest is None:
                collection = self.trash.collection_manifest(trash_id)
                if collection is None:
                    query = self.trash.query_data(trash_id)
                    if query is None:
                        raise KeyError(trash_id)
                    return self._restore_query_entry(trash_id, query)
                return self._restore_collection_entry(trash_id, collection)
            self._check_type_restorable(trash_id, manifest)
            objects: list[str] = []
            for oid in manifest.get("objectTrashIds") or []:
                ometa = self.trash.object_meta(oid)
                if ometa is not None:
                    objects.append(self._restore_object_entry(oid, ometa))
            paths, type_ids = self._restore_type_entry(trash_id, manifest)
            return {"paths": [*objects, *paths], "typeIds": type_ids}

    def purge(self, trash_id: str) -> int:
        """Delete a trash entry for good (a type with its objects); return how many entries went."""
        with self._lock:
            if self.trash.object_meta(trash_id) is not None:
                self._remove_trashed_object(trash_id)
                return 1
            manifest = self.trash.manifest(trash_id)
            if manifest is None:
                collection = self.trash.collection_manifest(trash_id)
                if collection is None:
                    if self.trash.has_query(trash_id):
                        self.trash.remove_query(trash_id)
                        return 1
                    raise KeyError(trash_id)
                count = 1
                for oid in collection.get("objectTrashIds") or []:
                    if self.trash.object_meta(oid) is not None:
                        self._remove_trashed_object(oid)
                        count += 1
                self.trash.remove_collection(trash_id)
                return count
            count = 1
            for oid in manifest.get("objectTrashIds") or []:
                if self.trash.object_meta(oid) is not None:
                    self._remove_trashed_object(oid)
                    count += 1
            self.trash.remove_type(trash_id)
            return count

    def _remove_trashed_object(self, trash_id: str) -> None:
        """Delete an object trash entry for good, with a whiteboard's sidecars."""
        from .whiteboardtrash import purge_sidecars

        self.trash.remove_object(trash_id)
        purge_sidecars(self, trash_id)

    def empty_trash(self) -> int:
        """Delete every trash entry for good; return how many there were."""
        with self._lock:
            count = 0
            for item in self.trash.items():
                try:
                    count += self.purge(item.id)
                except KeyError:
                    continue  # already purged with its type
            return count

    def purge_expired(self, now: datetime) -> int:
        """Purge the entries deleted more than 30 days before ``now``; return how many went."""
        with self._lock:
            count = 0
            for trash_id in self.trash.expired(now):
                try:
                    count += self.purge(trash_id)
                except KeyError:
                    continue
            return count

    # -- type definitions -------------------------------------------------------

    def _sort_types(self) -> None:
        self.types.sort(key=lambda t: (t.name.lower(), t.name))

    def _name_taken(self, name: str, except_id: str | None = None) -> bool:
        low = name.lower()
        return any(t.id != except_id and t.name.lower() == low for t in self.types)

    def _type_members(self, type_id: str, templates: bool = True) -> list[str]:
        """Paths of the (readable) objects of a type, with its templates unless told otherwise."""
        with self._lock:
            raws = list(self._raw.values())
        return sorted(
            r.path
            for r in raws
            if not r.readOnly
            and self._type_id(r.typeName) == type_id
            and (templates or r.fm.get("template") in (None, ""))
        )

    def _stored_type(self, type_id: str) -> TypeDefinition | None:
        """The type as its file holds it (None when there is no readable file)."""
        try:
            data = json.loads(
                (self.root / ".object" / "types" / f"{type_id}.json").read_text(
                    encoding="utf-8"
                )
            )
        except (OSError, ValueError):
            return None
        return TypeDefinition.from_json(data, fallback_id=type_id) if isinstance(data, dict) else None

    def create_type(
        self, name: str, plural_name: str, icon: Any = None, color: str | None = None
    ) -> TypeDefinition:
        """Create and save a new object type.

        It gets the system properties (Tags among them) and a ``blocks``
        property named "Content". The id is `slug` of the name, made unique;
        the folder comes from the plural name. Neither changes afterwards. The
        folder is created with the type's first object. Raises `InvalidValue`
        for a missing name or plural, a name in use, or a bad icon or colour.
        """
        name = " ".join(str(name or "").split())
        plural = " ".join(str(plural_name or "").split())
        if not name or not plural:
            raise InvalidValue("An object type needs a name and a plural name")
        color = color or "gray"
        if color not in THEME_COLORS:
            raise InvalidValue(f"Unknown colour {color!r}")
        parsed = Icon("iconify", _DEFAULT_TYPE_ICON) if icon is None else Icon.parse(icon)
        if parsed is None:
            raise InvalidValue("Unknown icon")
        with self._lock:
            if self._name_taken(name):
                raise InvalidValue(f"An object type named {name!r} already exists")
            types_dir = self.root / ".object" / "types"
            taken = {t.id for t in self.types} | {u.id for u in self.unreadable_types}
            if types_dir.is_dir():
                taken |= {f.stem for f in types_dir.glob("*.json")}
            base = slug(name)
            type_id, n = base, 2
            while type_id in taken:
                type_id, n = f"{base}-{n}", n + 1
            content = PropertyDefinition(
                id=new_ulid(),
                key="content",
                name="Content",
                type="blocks",
                icon=Icon("iconify", PROPERTY_ICONS["blocks"]),
            )
            t = TypeDefinition(
                id=type_id,
                name=name,
                pluralName=plural,
                folder=safe_filename(plural),
                icon=parsed,
                color=color,
                propertyDefinitions=[*system_property_defs(), content],
            )
            write_type_json(self.root, t, "")
            self.types.append(t)
            self._sort_types()
            self._types_changed(t.id)
            return t

    def sync_problem(
        self,
        t: TypeDefinition,
        p: PropertyDefinition,
        types: dict[str, TypeDefinition] | None = None,
    ) -> str | None:
        """Why ``p`` of ``t`` can't sync with its ``propertySyncing`` targets (Object's text).

        Syncing needs an entity property that is multi-select without a fixed
        set, on a non-basic type, whose ``allowedTypes`` is exactly the
        counterpart's (non-basic) type, and a counterpart of the same kind.
        """
        lookup = types if types is not None else {x.id: x for x in self.types}
        if t.basic:
            return SYNC_NOT_ALLOWED
        if p.type != "entity" or not _is_multi(p) or p.options.get("hasFixedSet"):
            return SYNC_MULTI_ONLY
        allowed = p.options.get("allowedTypes") or []
        target = lookup.get(allowed[0]) if len(allowed) == 1 else None
        if target is None or target.basic:
            return SYNC_NOT_ALLOWED
        for pid in _sync_ids(p):
            q = next((x for x in target.propertyDefinitions if x.id == pid), None)
            if q is None or q.type != "entity" or not _is_multi(q) or q.options.get("hasFixedSet"):
                return SYNC_MULTI_ONLY
        return None

    def save_type(
        self, t: TypeDefinition, base_revision: str, confirm: bool = False
    ) -> SaveTypeResult:
        """Save an edited type, rewriting other files (unstamped) to follow it.

        Diffs ``t`` against the stored type. A renamed type rewrites the
        ``type:`` lines naming the old name (quotes kept) and keeps the old name
        in ``formerNames``; a deleted property strips its key; renamed label
        options are rewritten, deleted ones removed; multi→single keeps the
        first value; relation rule changes drop links that break them (dangling
        links stay). ``id``, ``folder``, ``basic`` and ``formerNames`` are the
        server's. Every rewrite is planned first: a change that removes values
        (or deletes a property) raises `ConfirmRequired` before anything is
        written unless ``confirm``. Files that can't be rewritten are reported
        in ``skipped``; the type JSON is written last.

        Raises `KeyError` (unknown type), `TypeReadOnly` (unreadable type file),
        `RevisionConflict` (stale ``base_revision``) and `InvalidValue` (422).
        """
        with self._lock:
            mem, current = self.refresh_type(t.id)
            if mem is None:
                raise KeyError(t.id)
            if mem.readOnlyReason:
                raise TypeReadOnly(mem.readOnlyReason)
            if current != (base_revision or ""):
                raise RevisionConflict(current)
            stored = self._stored_type(mem.id)
            old = topup_task_type(stored) if stored is not None else mem
            new = copy.deepcopy(t)
            new.id, new.folder, new.basic = old.id, old.folder, old.basic
            new.formerNames = list(old.formerNames)
            new.readOnlyReason = None
            new.name = " ".join(str(new.name or "").split())
            new.pluralName = " ".join(str(new.pluralName or "").split())

            ops, deletes_property = self._plan_type_ops(old, new)

            members = self._type_members(old.id) if ops else []
            raws = {rel: self._raw[rel] for rel in members if rel in self._raw}

            def run(src: str, rel: str, only_confirm: bool = False) -> str:
                for op in ops:
                    if op.confirm or not only_confirm:
                        src = op.fn(src, rel)
                return src

            to_write: list[str] = []
            affected = 0
            for rel, raw in raws.items():
                src = raw.of.frontmatter_src or ""
                if run(src, rel, only_confirm=True) != src:
                    affected += 1
                if run(src, rel) != src:
                    to_write.append(rel)
            if (deletes_property or affected) and not confirm:
                raise ConfirmRequired(
                    affected,
                    f"This change removes values from {affected} "
                    f"object{'s' if affected != 1 else ''}.",
                )

            # The rewritten files are rescanned as they are written, so they must
            # already resolve to the edited type (a renamed type by its new name).
            self.types = [new if x.id == new.id else x for x in self.types]
            self._types_changed(new.id)
            try:
                rewritten, skipped = self._apply_type_ops(to_write, run)
                revision = write_type_json(self.root, new, current)
            except BaseException:
                self.types = [mem if x.id == new.id else x for x in self.types]
                self._types_changed(new.id)
                for rel in members:
                    self.rescan_file(rel)
                raise
            self._sort_types()
            return SaveTypeResult(new, rewritten, skipped, revision)

    def _apply_type_ops(
        self, to_write: list[str], run: Callable[[str, str], str]
    ) -> tuple[list[str], list[Skip]]:
        """Rewrite each file with ``run(src, rel)`` (unstamped); (rewritten, skipped)."""
        rewritten: list[str] = []
        skipped: list[Skip] = []
        for rel in to_write:
            wrote: list[bool] = []

            def edit(of: ObjectFile, _fm: dict, rel=rel, wrote=wrote) -> ObjectFile | None:
                src = of.frontmatter_src or ""
                out = run(src, rel)
                wrote.append(out != src)
                return replace(of, frontmatter_src=out) if out != src else None

            result = self._rewrite_other(rel, edit)
            if isinstance(result, Skip):
                skipped.append(result)
            elif wrote and wrote[-1]:
                rewritten.append(rel)
        return rewritten, skipped

    def _plan_type_ops(
        self, old: TypeDefinition, new: TypeDefinition
    ) -> tuple[list[_TypeOp], bool]:
        """Validate a type edit (`InvalidValue`) and list the rewrites it needs.

        Returns (ops, whether a property is deleted).
        """
        if not new.name or not new.pluralName:
            raise InvalidValue("An object type needs a name and a plural name")
        if new.color != old.color and new.color not in THEME_COLORS:
            raise InvalidValue(f"Unknown colour {new.color!r}")
        ops: list[_TypeOp] = []

        renamed = new.name != old.name
        if renamed:
            if old.basic:
                raise InvalidValue(BASIC_LOCKED)
            if self._name_taken(new.name, except_id=old.id):
                raise InvalidValue(f"An object type named {new.name!r} already exists")
            former = [f for f in old.formerNames if f.lower() != new.name.lower()]
            if old.name.lower() != new.name.lower() and old.name.lower() not in (
                f.lower() for f in former
            ):
                former.append(old.name)
            new.formerNames = former
            ops.append(_TypeOp(self._type_line_op(old.name, new.name), confirm=False))

        ids = [p.id for p in new.propertyDefinitions]
        keys = [p.key for p in new.propertyDefinitions]
        if len(set(ids)) != len(ids):
            raise InvalidValue("Two properties have the same id")
        if len(set(keys)) != len(keys):
            raise InvalidValue("Two properties have the same key")
        old_by_id = {p.id: p for p in old.propertyDefinitions}
        new_by_id = {p.id: p for p in new.propertyDefinitions}
        lookup = {x.id: x for x in self.types}
        lookup[new.id] = new

        deletes_property = False
        for p in old.propertyDefinitions:
            if p.id in new_by_id:
                continue
            if _is_system_def(p):
                if p.key in _CORE_SYSTEM_KEYS:
                    raise InvalidValue(f"{p.name} can't be removed")
                continue  # an optional system property: display only, nothing to strip
            if old.basic:
                raise InvalidValue(BASIC_LOCKED)
            deletes_property = True
            ops.append(_TypeOp(self._delete_key_op(p.key), confirm=True))

        for p in new.propertyDefinitions:
            before = old_by_id.get(p.id)
            if before is None:
                self._check_new_property(old, new, p)
            else:
                if p.key != before.key:
                    raise InvalidValue("The key of a property never changes")
                if p.type != before.type:
                    raise InvalidValue("Change the kind of a property with change-kind")
                if old.basic and _is_multi(p) != _is_multi(before):
                    raise InvalidValue(BASIC_LOCKED)
            if p.type == "label":
                self._check_label(p, before)
                if before is not None:
                    ops.extend(self._label_ops(before, p))
            elif p.type == "entity":
                self._check_fixed_set_ids(p, before)
                if _sync_ids(p) and (before is None or p.options != before.options):
                    problem = self.sync_problem(new, p, lookup)
                    if problem:
                        raise InvalidValue(problem)
                if before is not None:
                    op = self._entity_op(before, p)
                    if op is not None:
                        ops.append(op)
        return ops, deletes_property

    def _check_new_property(
        self, old: TypeDefinition, new: TypeDefinition, p: PropertyDefinition
    ) -> None:
        if _is_system_def(p):
            return  # e.g. adding the optional `coverImage` or `type` property
        if old.basic:
            raise InvalidValue(BASIC_LOCKED)
        if not isinstance(p.key, str) or not p.key.strip():
            raise InvalidValue("A property needs a key")
        if p.key in SYSTEM_KEYS:
            raise InvalidValue(f"{p.key!r} is a reserved key")
        if p.type.startswith("entity_") or p.type in ("coverImage", "color"):
            raise InvalidValue(f"{p.type!r} is a system property kind")

    @staticmethod
    def _check_label(p: PropertyDefinition, before: PropertyDefinition | None) -> None:
        seen: set[str] = set()
        for o in p.options.get("set") or []:
            if not isinstance(o, dict) or not isinstance(o.get("id"), str) or not o["id"]:
                raise InvalidValue("A label option needs an id")
            text = o.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 100:
                raise InvalidValue("A label option's text is 1 to 100 characters")
            if o["id"] in seen:
                raise InvalidValue("Two label options have the same id")
            seen.add(o["id"])
        was_status = before is not None and before.options.get("isStatus")
        if p.options.get("isStatus") and not was_status:
            raise InvalidValue("Only the basic Task status is a status label")

    def _check_fixed_set_ids(self, p: PropertyDefinition, before: PropertyDefinition | None) -> None:
        old_ids = set(before.options.get("fixedSet") or []) if before is not None else set()
        fresh = [i for i in p.options.get("fixedSet") or [] if i not in old_ids]
        if not fresh:
            return
        with self._lock:
            known = {s.id for s in self._summaries.values() if s.id}
        for object_id in fresh:
            if object_id not in known:
                raise InvalidValue(f"No object has the id {object_id!r}")

    @staticmethod
    def _type_line_op(old_name: str, new_name: str) -> Callable[[str, str], str]:
        folded = old_name.lower()

        def fn(src: str, _rel: str) -> str:
            value = parse_fm(src).get("type") if src else None
            if not isinstance(value, str) or value.strip().lower() != folded:
                return src
            return replace_in_value(
                src, "type", lambda v: new_name if v.strip().lower() == folded else v
            )

        return fn

    @staticmethod
    def _delete_key_op(key: str) -> Callable[[str, str], str]:
        def fn(src: str, _rel: str) -> str:
            return delete_keys(src, [key]) if src else src

        return fn

    @staticmethod
    def _label_ops(before: PropertyDefinition, p: PropertyDefinition) -> list[_TypeOp]:
        """Removal (deleted options, multi→single) and rename ops for a label property."""
        key = p.key
        old_texts, new_texts = _option_texts(before), _option_texts(p)
        renamed = {
            _fold(text): new_texts[oid]
            for oid, text in old_texts.items()
            if oid in new_texts and new_texts[oid] != text
        }
        deleted = {_fold(text) for oid, text in old_texts.items() if oid not in new_texts}
        # A deleted option's text that another option still has is not removed.
        deleted -= {_fold(t) for t in new_texts.values()}
        collapse = _is_multi(before) and not _is_multi(p)
        ops: list[_TypeOp] = []

        if deleted or collapse:

            def remove(src: str, _rel: str) -> str:
                raw = parse_fm(src).get(key) if src else None
                if raw is None:
                    return src
                items = [i for i in (raw if isinstance(raw, list) else [raw]) if i is not None]
                kept = [i for i in items if _fold(i) not in deleted]
                squash = collapse and isinstance(raw, list) and len(kept) >= 2
                if not squash and len(kept) == len(items):
                    return src
                if squash:
                    value: Any = kept[0]
                elif not kept:
                    value = None
                elif isinstance(raw, list):
                    value = FlowList(kept)
                    out = remove_items(src, key, lambda v: _fold(v) in deleted)
                    if out is not None:
                        return out
                else:
                    value = kept[0]
                return set_keys(src, {key: value})

            ops.append(_TypeOp(remove, confirm=True))

        if renamed:

            def rename(src: str, _rel: str) -> str:
                if not src or key not in parse_fm(src):
                    return src
                return replace_in_value(src, key, lambda v: renamed.get(_fold(v), v))

            ops.append(_TypeOp(rename, confirm=False))
        return ops

    def _entity_op(self, before: PropertyDefinition, p: PropertyDefinition) -> _TypeOp | None:
        """The op that drops links breaking a relation's new rules, or None if they didn't tighten."""
        o, n = before.options, p.options
        collapse = _is_multi(before) and not _is_multi(p)
        allowed = [a for a in n.get("allowedTypes") or [] if isinstance(a, str)]
        types_changed = set(allowed) != set(o.get("allowedTypes") or [])
        fixed = set(n.get("fixedSet") or []) if n.get("hasFixedSet") else None
        fixed_changed = fixed is not None and (
            not o.get("hasFixedSet") or fixed != set(o.get("fixedSet") or [])
        )
        if not (collapse or (types_changed and allowed) or fixed_changed):
            return None
        key = p.key

        def breaks_rules(item: Any, rel: str) -> bool:
            refs = decode_value(p, item)
            if not refs:
                return False
            path = self.resolve(refs[0]["target"], rel)
            with self._lock:
                summary = self._summaries.get(path) if path else None
            if summary is None:
                return False  # dangling links stay
            if allowed and summary.type not in allowed:
                return True
            return fixed is not None and summary.id not in fixed

        def fn(src: str, rel: str) -> str:
            raw = parse_fm(src).get(key) if src else None
            if raw is None:
                return src
            items = [i for i in (raw if isinstance(raw, list) else [raw]) if i is not None]
            kept = [i for i in items if not breaks_rules(i, rel)]
            squash = collapse and isinstance(raw, list) and len(kept) >= 2
            if not squash and len(kept) == len(items):
                return src
            if not kept:
                value: Any = None
            elif squash or not isinstance(raw, list):
                value = kept[0]
            else:
                value = FlowList(kept)
                out = remove_items(src, key, lambda v: breaks_rules(v, rel))
                if out is not None:
                    return out
            return set_keys(src, {key: value})

        return _TypeOp(fn, confirm=True)

    def delete_type(self, type_id: str, confirm: bool = False) -> TrashItem:
        """Move a type, its objects and templates to the trash.

        Raises `KeyError` for an unknown type, `InvalidValue` for a basic type
        and `ConfirmRequired` (``affected`` = its objects) without ``confirm``.
        Other types' relations stop allowing it (restored with it).
        """
        with self._lock:
            t = self.type_by_id(type_id)
            if t is None:
                raise KeyError(type_id)
            if t.basic:
                raise InvalidValue("Basic object types cannot be deleted.")
            objects = self._type_members(type_id, templates=False)
            if not confirm:
                n = len(objects)
                raise ConfirmRequired(
                    n,
                    f"Delete the object type {t.name}? Its {n} object{'s' if n != 1 else ''} "
                    "and templates move to the Trash.",
                )
            return self.trash_type(t, objects)

    # -- kind change and two-way linking ------------------------------------------

    def _editable_type(self, type_id: str) -> tuple[TypeDefinition, str]:
        """A copy of the type as stored (or inferred) and its file's revision.

        Raises `KeyError` (unknown type) and `TypeReadOnly` (unreadable file).
        """
        mem, current = self.refresh_type(type_id)
        if mem is None:
            raise KeyError(type_id)
        if mem.readOnlyReason:
            raise TypeReadOnly(mem.readOnlyReason)
        t = copy.deepcopy(self._stored_type(mem.id) or mem)
        t.readOnlyReason = None
        return t, current

    def _commit_type(self, t: TypeDefinition, base_revision: str) -> str:
        """Write a type's JSON and put it in memory; return the new revision."""
        revision = write_type_json(self.root, t, base_revision)
        self._loaded_revisions[t.id] = revision
        if any(x.id == t.id for x in self.types):
            self.types = [t if x.id == t.id else x for x in self.types]
        else:
            self.types.append(t)
        self._sort_types()
        self._types_changed(t.id)
        return revision

    def change_property_kind(
        self, type_id: str, pid: str, to_type: str, base_revision: str
    ) -> ChangeKindResult:
        """Change a property's kind as Object does: by adding a new property.

        The new definition goes right after the old one, with the same name,
        icon, description and visibility, a new id and a new unique key. Each
        object (and template) of the type with a value gets the converted value
        under the new key, as one added line (unstamped); entity → label builds
        the option set from the values. The old property and its values stay.

        Raises `KeyError` (unknown type or property), `TypeReadOnly`,
        `RevisionConflict` and `InvalidValue` (basic type, or a kind the
        property can't change to).
        """
        with self._lock:
            t, current = self._editable_type(type_id)
            if current != (base_revision or ""):
                raise RevisionConflict(current)
            index = next(
                (i for i, p in enumerate(t.propertyDefinitions) if p.id == pid), None
            )
            if index is None:
                raise KeyError(pid)
            src = t.propertyDefinitions[index]
            if t.basic:
                raise InvalidValue(BASIC_LOCKED)
            if to_type == src.type or to_type not in KIND_TRANSFORMS.get(src.type, ()):
                raise InvalidValue(NO_TRANSFORMATIONS)

            members = self._type_members(t.id)
            raws = {rel: self._raw[rel] for rel in members if rel in self._raw}
            taken = {p.key for p in t.propertyDefinitions}
            for raw in raws.values():
                taken |= {k for k in raw.fm if isinstance(k, str)}
            spec: dict[str, Any] = {
                "id": new_ulid(),
                "key": unique_key(src.name, taken),
                "name": src.name,
                "type": to_type,
                "description": src.description,
                "icon": src.icon.to_json() if src.icon else None,
                "visibility": src.visibility,
            }
            if to_type == "label":
                spec["options"] = {"isArray": src.type == "entity" and _is_multi(src), "set": []}
            elif to_type in ("datetime", "datetimeSimple") and "constraints" in src.options:
                spec["options"] = {"constraints": copy.deepcopy(src.options["constraints"])}
            dst = PropertyDefinition.from_json(spec)

            def converted(fm: dict) -> tuple[Any, bool]:
                """(encoded value or None, lossy) of this file's old value."""
                raw = fm.get(src.key)
                if raw is None or raw == "" or raw == []:
                    return None, False
                try:
                    value, lossy = convert_value(src, dst, raw)
                    return encode_value(dst, value), lossy
                except InvalidValue:
                    return None, True

            # Plan first: it counts the lossy values and builds a label's options.
            lossy = 0
            to_write: list[str] = []
            for rel, raw in raws.items():
                if dst.key in raw.fm:
                    continue
                encoded, was_lossy = converted(raw.fm)
                lossy += was_lossy
                if encoded is not None:
                    to_write.append(rel)

            def run(fm_src: str, _rel: str) -> str:
                fm = parse_fm(fm_src) if fm_src else {}
                if dst.key in fm:
                    return fm_src
                encoded, _ = converted(fm)
                return set_keys(fm_src, {dst.key: encoded}) if encoded is not None else fm_src

            t.propertyDefinitions.insert(index + 1, dst)
            rewritten, skipped = self._apply_type_ops(to_write, run)
            revision = self._commit_type(t, current)
            return ChangeKindResult(t, dst.id, rewritten, skipped, lossy, revision)

    def set_property_sync(
        self,
        type_id: str,
        pid: str,
        target_pid: str | None,
        create_name: str | None = None,
        base_revision: str = "",
    ) -> SyncResult:
        """Link (or unlink) a relation with its counterpart on the linked type.

        With ``target_pid`` the existing counterpart is used; with
        ``create_name`` one is created on the linked type (a multi relation
        back to this type); with neither, the property and its counterparts are
        unlinked and nothing is rewritten. Both type JSONs get each other's
        property id in ``propertySyncing.propertyIds``. Linking backfills: for
        every link A1 → B1, ``[[A1]]`` is added to B1's counterpart value
        (unstamped; read-only or conflicting files are in ``skipped``). The
        type JSONs are written last.

        Raises `KeyError`, `TypeReadOnly`, `RevisionConflict` and
        `InvalidValue` with Object's texts when syncing isn't allowed.
        """
        with self._lock:
            src_t, current = self._editable_type(type_id)
            if current != (base_revision or ""):
                raise RevisionConflict(current)
            p = next((q for q in src_t.propertyDefinitions if q.id == pid), None)
            if p is None:
                raise KeyError(pid)
            edited: dict[str, TypeDefinition] = {src_t.id: src_t}
            revisions: dict[str, str] = {src_t.id: current}

            def editable(tid: str) -> TypeDefinition:
                if tid not in edited:
                    edited[tid], revisions[tid] = self._editable_type(tid)
                return edited[tid]

            def unlink(owner: TypeDefinition, prop: PropertyDefinition) -> None:
                """Drop ``prop``'s links and its id from every counterpart's list."""
                for other in self.types:
                    for q in other.propertyDefinitions:
                        if prop.id in _sync_ids(q) and not (
                            other.id == owner.id and q.id == prop.id
                        ):
                            if other.readOnlyReason:
                                continue
                            qq = editable(other.id).prop(q.key)
                            if qq is None:
                                continue
                            ids = [i for i in _sync_ids(qq) if i != prop.id]
                            if ids:
                                qq.options["propertySyncing"] = {"propertyIds": ids}
                            else:
                                qq.options.pop("propertySyncing", None)
                prop.options.pop("propertySyncing", None)

            if target_pid is None and not (create_name or "").strip():
                unlink(src_t, p)
                result_types = list(edited.values())
                new_revisions = {
                    t.id: self._commit_type(t, revisions[t.id]) for t in result_types
                }
                return SyncResult(result_types, [], [], new_revisions)

            lookup = {x.id: x for x in self.types}
            lookup[src_t.id] = src_t
            # Validate the source with a placeholder link (Object's texts).
            probe = copy.deepcopy(p)
            probe.options.pop("propertySyncing", None)
            problem = self.sync_problem(src_t, probe, lookup)
            if problem:
                raise InvalidValue(problem)
            target_type_id = p.options["allowedTypes"][0]
            target_t = editable(target_type_id)
            lookup[target_t.id] = target_t

            if target_pid is not None:
                q = next((x for x in target_t.propertyDefinitions if x.id == target_pid), None)
                if q is None:
                    raise KeyError(target_pid)
                if q is p or (target_t.id == src_t.id and q.id == p.id):
                    raise InvalidValue(SYNC_MULTI_ONLY)
                probe_q = copy.deepcopy(q)
                probe_q.options.pop("propertySyncing", None)
                problem = self.sync_problem(target_t, probe_q, lookup)
                if problem:
                    raise InvalidValue(problem)
                if probe_q.options.get("allowedTypes") != [src_t.id]:
                    raise InvalidValue(SYNC_NOT_ALLOWED)
            else:
                taken = {x.key for x in target_t.propertyDefinitions}
                name = " ".join(str(create_name).split())
                q = PropertyDefinition.from_json(
                    {
                        "id": new_ulid(),
                        "key": unique_key(name, taken),
                        "name": name,
                        "type": "entity",
                        "options": {
                            "isArray": True,
                            "allowedTypes": [src_t.id],
                            "hasFixedSet": False,
                            "fixedSet": [],
                        },
                    }
                )
                target_t.propertyDefinitions.append(q)

            # Leave any previous pairing first, then pair the two.
            unlink(src_t, p)
            unlink(target_t, q)
            p.options["propertySyncing"] = {"propertyIds": [q.id]}
            q.options["propertySyncing"] = {"propertyIds": [p.id]}

            rewritten, skipped = self._backfill_sync(src_t, p, target_t, q)
            result_types = list(edited.values())
            new_revisions = {t.id: self._commit_type(t, revisions[t.id]) for t in result_types}
            return SyncResult(result_types, rewritten, skipped, new_revisions)

    def _backfill_sync(
        self,
        src_t: TypeDefinition,
        p: PropertyDefinition,
        target_t: TypeDefinition,
        q: PropertyDefinition,
    ) -> tuple[list[str], list[Skip]]:
        """Add ``[[A1]]`` to B1's ``q`` for every existing link A1 → B1 (unstamped)."""
        rewritten: list[str] = []
        skipped: list[Skip] = []
        pairs: list[tuple[str, str]] = []
        for rel in self._type_members(src_t.id, templates=False):
            with self._lock:
                raw = self._raw.get(rel)
            if raw is None:
                continue
            for target in sorted(self._linked_paths(p, raw.fm.get(p.key), rel)):
                pairs.append((rel, target))
        # Each target is rewritten once per linking object, in path order.
        pairs.sort(key=lambda pair: (pair[1], pair[0]))
        reported: set[str] = set()
        for rel, target in pairs:
            with self._lock:
                summary = self._summaries.get(target)
            if summary is None:
                continue
            if summary.readOnly:
                if target not in reported:
                    skipped.append(Skip(target, summary.readOnlyReason or "Object is read-only"))
                    reported.add(target)
                continue
            if summary.type != target_t.id:
                continue
            edit = self._backlink_edit(q, rel, target, add=True)
            wrote: list[bool] = []

            def tracked(of: ObjectFile, fm: dict, edit=edit, wrote=wrote) -> ObjectFile | None:
                out = edit(of, fm)
                wrote.append(out is not None)
                return out

            result = self._rewrite_other(target, tracked)
            if isinstance(result, Skip):
                if target not in reported:
                    skipped.append(result)
                    reported.add(target)
            elif wrote and wrote[-1] and target not in rewritten:
                rewritten.append(target)
        return rewritten, skipped

    def cached_version(self, path: str) -> str | None:
        """The version of the object as last scanned, or None if the space doesn't know it."""
        rel = self._rel(path)
        with self._lock:
            raw = self._raw.get(rel)
            return version_of(raw.data) if raw is not None else None

    def rescan_file(self, path: str) -> None:
        """Refresh one object's summary from disk (or drop it if the file is gone).

        Every exit tells the listeners (`add_listener`) about the path, and a
        change to the names links resolve by invalidates the resolver.
        """
        rel = self._rel(path)
        full = self.root / rel
        with self._lock:
            before = self._summaries.get(rel)
            raw: RawObject | None = None
            if full.is_file():
                try:
                    raw = read_raw(self.root, rel)
                except OSError:
                    raw = None
            if raw is None:
                self._raw.pop(rel, None)
                self._summaries.pop(rel, None)
            else:
                self._raw[rel] = raw
                if self._type_id(raw.typeName) not in {t.id for t in self.types}:
                    self._merge_types(infer_types_from(self._raw.values()))
                self._summaries[rel] = self._summarize(raw)
            if _names_key(before) != _names_key(self._summaries.get(rel)):
                self._names_changed()
            self._fire(SpaceChange("object", rel))

    # -- change listeners -------------------------------------------------------

    def add_listener(self, fn: Callable[[SpaceChange], None]) -> Callable[[], None]:
        """Call ``fn(SpaceChange)`` after every change to the scan; returns an unsubscribe.

        Listeners may run while the space lock is held: they must only record or
        enqueue (never block, read files or take another lock). One that raises
        is logged and never breaks the write.
        """
        with self._lock:
            self._listeners.append(fn)

        def unsubscribe() -> None:
            with self._lock:
                if fn in self._listeners:
                    self._listeners.remove(fn)

        return unsubscribe

    def _fire(self, change: SpaceChange) -> None:
        for fn in list(self._listeners):
            try:
                fn(change)
            except Exception:  # noqa: BLE001 - a listener must never break a write
                _log.exception("A space change listener failed on %s", change)

    def _types_changed(self, type_id: str | None = None) -> None:
        """Tell the listeners that a type definition changed (``type_id`` is informative)."""
        self._fire(SpaceChange("types", None))

    def _names_changed(self) -> None:
        """The set of link names changed: rebuild the resolver on its next use."""
        self._names_rev += 1
        self._resolver = None

    # -- links --------------------------------------------------------------

    @property
    def links(self) -> LinkIndex:
        """The space's link index (built lazily from the scan on first read)."""
        return self._links

    def backlinks(self, path: str) -> list[dict[str, Any]]:
        """The distinct objects linking to ``path`` as entity references, title then path.

        Each is ``{target: <its link text from path>, path}``.
        """
        rel = self._rel(path)
        return [
            {"target": self._link_text(src, rel), "path": src}
            for src in self._links.backlinks(rel)
        ]

    def outgoing(self, path: str) -> list[str]:
        """The objects ``path`` links to, sorted by path."""
        return sorted(self._links.outgoing(self._rel(path)))

    def _current_resolver(self) -> Resolver:
        r = self._resolver
        if r is not None:
            return r
        with self._lock:
            r = self._resolver
            if r is None:
                aliases = {rel: _str_list(raw.fm.get("aliases")) for rel, raw in self._raw.items()}
                r = Resolver.build(list(self._summaries.values()), aliases)
                self._resolver = r
            return r

    def resolve(self, link: str, from_path: str | None) -> str | None:
        """Resolve ``[[link]]`` text to an object path, deterministically.

        Order: an exact space path without ``.md`` (``Pages/Untitled``, the form
        written for duplicate titles); exact title in the linking object's
        folder; exact title anywhere (oldest ``createdAt``, then path); alias;
        case-insensitive title or file stem. Within each step the linking
        object's folder wins, then the oldest ``createdAt``, then the path.
        Answered by a cached `Resolver`, rebuilt when the names change.
        """
        return self._current_resolver().resolve(link, from_path)
