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
import math
import os
import random
import re
import shutil
import threading
import time
from collections import deque
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta, tzinfo
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
    take_parsed,
)
from . import writeorigin
from .ids import new_ulid
from .collections import CollectionDef, SaveCollectionResult
from . import fmcache
from .dailynotes import FILE_NAME_TAKEN, DailyNoteExists, build_index, day_of, parse_day
from .jsonstore import DefinitionUnreadable, JsonStore
from .keycompat import upgrade_list_name
from .localtime import SystemTz, from_local, to_local
from .queries import DEFAULT_NAME as DEFAULT_QUERY_NAME
from .queries import LIMIT_SIZES, MAX_SEARCH_TERMS, QueryDef, query_type_ids
from .objfile import ObjectFile, join_object, split_object
from .computed import COMPUTED_KINDS, check_type, rename_in_formulas
from .counterparts import GONE, NO_COUNTERPART, WRONG_TYPE, CounterpartRow, specs_for
from .counterparts import check_type as check_counterparts
from .counterparts import counterpart_defs as _counterpart_defs
from .rows import member_of
from .propvalues import (
    GATED_KINDS,
    KIND_TRANSFORMS,
    InvalidValue,
    convert_value,
    decode_value,
    encode_updates,
    encode_value,
)
from .spaceconfig import SPACE_REL, space_fields
from .spaceconfig import read as read_space_config
from .spaceconfig import work_on as config_work_on
from .recurrence import week_start_of
from .taskhook import TaskResult, on_status_change
from .workfields import FIELD_KEYS as WORK_FIELD_KEYS
from .workfields import (
    field_defs,
    is_work_type,
    project_type_ids,
    topup_work_fields,
    work_type_ids,
)
from .workhook import STEPS_GATED, on_work_write
from .workview import BUILT_IN as TICKETS_BUILT_IN
from .workview import TICKETS_ID, apply_types, for_storage, tickets_default
from .linkindex import LinkIndex
from .relink import (
    code_ranges,
    relink_frontmatter,
    replace_wikilinks,
    rewrite_tag_lists,
    wikilink_targets,
)
from .resolver import Resolver, link_candidates, link_names
from .roles import role_of
from .templates import TemplateError, creation_variable, expand_title, resolve_date_variable
from .textfile import (
    _write_temp,
    atomic_write,
    create_new,
    decode,
    encode_like,
    move_no_overwrite,
    retry_os,
)
from .synced import (
    FOLDER as SYNCED_FOLDER,
    MAX_ITEMS as MAX_SYNC_ITEMS,
    SYNCED_READ_ONLY,
    Candidate,
    ItemResult,
    SyncedStore,
    SyncOutcome,
    check_match,
    encode_facts,
    find_matches,
    is_synced,
    synced_props,
)
from .importers.sources import SOURCE_READ_ONLY, is_imported_source
from .trash import Trash, TrashItem
from .typedefs import (
    DEFAULT_TYPE,
    SYSTEM_KEYS,
    RawObject,
    has_undecodable,
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
    is_task_type,
    on_demand_type,
    on_demand_types,
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
    "WorkWriteOutcome",
    "WriteNotice",
    "now_stamp",
    "safe_filename",
    "unique_path",
    "version_of",
    "yaml_single_quoted",
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
     "entity_collections", "entity_backlinks", "formula", "rollup", "uniqueId"}
)  # fmt: skip
# M12: kinds never written through the property routes (computed, or numbered by the app).
_READ_ONLY_VALUE_KINDS = frozenset({"formula", "rollup", "uniqueId"})
# M9 duplicate: the roles that can't be duplicated that
# our types can have (see `roles.py`), and the refusal (our string).
_NOT_DUPLICATED_ROLES = frozenset(
    {"image", "weblink", "pdf", "audio", "file", "tweet",
     "dailyNote"}
)  # fmt: skip
_CANNOT_DUPLICATE = "This object can't be duplicated."
# M9 per-object layout keys (`wideLayoutMode`, `wideCoverImage`,
# `coverImageOffset`'s `offset`): absent means the type's default (offset 50); `None` removes.
_COVER_OFFSET = "coverImageOffset"
# Polish item 17: `hideProperties`, the property-pane toggle.
_LAYOUT_BOOL_KEYS = frozenset({"wideLayoutMode", "wideCoverImage", "hideProperties"})
_LAYOUT_KEYS = _LAYOUT_BOOL_KEYS | {_COVER_OFFSET}
# The date template variables; a datetime property's variable is "Set only on templates".
_CREATION_VARIABLES = ("day", "week", "month", "year")
# M9: how often a whiteboard save may re-stamp its `.md` (`Space.touch`; our choice).
_TOUCH_INTERVAL = timedelta(seconds=60)
# A body that is empty or only a `# Title` heading (a template's body replaces it).
_TITLE_ONLY_RE = re.compile(r"\s*(?:#[ \t][^\n]*)?\s*")


def _check_layout_value(key: str, value: Any) -> None:
    """Raise `InvalidValue` unless ``value`` fits the layout key (None always does)."""
    if value is None:
        return
    if key in _LAYOUT_BOOL_KEYS:
        if not isinstance(value, bool):
            raise InvalidValue(f'"{key}" must be true, false or null.')
        return
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not 0 <= value <= 100  # NaN fails this too
    ):
        raise InvalidValue(f'"{key}" must be a number from 0 to 100, or null.')


def _creation_value(value: str, fm: dict) -> SingleQuotedScalarString:
    """The frontmatter value for a ``{creation:<var>}`` update of a ``datetime`` property.

    Raises `InvalidValue` for an unknown variable, or on a file that isn't a template.
    """
    var = creation_variable(value)
    if var not in _CREATION_VARIABLES:
        raise InvalidValue(f'Unknown date variable "{value.strip()}".')
    if not _str_or_none(fm.get("template")):
        raise InvalidValue("Date variables can only be set on a template.")
    return SingleQuotedScalarString(f"{{creation:{var}}}")


def _instant_or_none(value: Any, tz: tzinfo) -> datetime | None:
    """A stamp such as ``lastUpdated`` as an aware instant, else None.

    A value without a time zone is local time in ``tz`` (as `_parse_created` reads one).
    """
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value or "").strip())
        except ValueError:
            return None
    if dt.tzinfo:
        return dt
    try:
        return from_local(dt, tz)
    except OverflowError:
        return None


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
# Bytes, too: a name may be 255 bytes on Linux and macOS, and " (2)", a whiteboard
# sidecar suffix or a temp name add to the stem.
_MAX_FILENAME_BYTES = 200
# Device names Windows reserves (a file `CON.md` can't be created there).
_RESERVED_STEMS = frozenset(
    {
        "CON", "PRN", "AUX", "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }
)


_LINK_UNSAFE_RE = re.compile(r"[\[\]#]")
_SURROGATE_RE = re.compile("[\ud800-\udfff]")
# A title that can't be a wikilink target as it is (it would end the target early).
_LINK_BREAKING_RE = re.compile(r"[\[\]|#\n]")


def safe_filename(title: str) -> str:
    """The file stem for a title, as an export names files.

    The title up to its first character that is illegal in a Windows file name,
    with whitespace collapsed and leading and trailing dots and spaces stripped
    (a leading dot would make a hidden dotfile), capped at 120 characters and
    200 UTF-8 bytes. If that is empty, the illegal characters are dropped
    instead; if still empty,
    ``Untitled``. (A Windows device name such as ``CON`` gets a trailing
    ``_``.) ``[``, ``]`` and ``#`` are dropped first.
    """

    def clean(text: str) -> str:
        text = " ".join(text.split()).strip(". ")[:_MAX_FILENAME]
        raw = text.encode("utf-8", errors="surrogatepass")
        if len(raw) > _MAX_FILENAME_BYTES:
            text = raw[:_MAX_FILENAME_BYTES].decode("utf-8", errors="ignore")
        return text.rstrip(". ")

    # `[`, `]` and `#` are legal in file names but end a wikilink's target, so
    # the path form of a link (see `Space._link_text`) must never contain them.
    title = _LINK_UNSAFE_RE.sub("", str(title or ""))
    # A lone surrogate (JSON allows "\udc80") is no character: on Linux it would become a
    # file name that isn't UTF-8. It is replaced, as a decoder replaces a bad byte.
    title = _SURROGATE_RE.sub("\ufffd", title)
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
        # Names only (no Path per entry): a restore of a type calls this once per object.
        taken = {name.lower() for name in os.listdir(base)}
    except OSError:  # no such folder (yet), or unreadable
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


_MAX_COMPONENT = 255


def _component_too_long(part: str) -> bool:
    """Whether one path component is longer than the file system allows.

    NTFS allows 255 UTF-16 code units per name (a character outside the BMP is two);
    Linux and macOS file systems allow 255 bytes (of UTF-8).
    """
    if os.name == "nt":
        return len(part.encode("utf-16-le", "surrogatepass")) > 2 * _MAX_COMPONENT
    return len(part.encode("utf-8", "surrogateescape")) > _MAX_COMPONENT


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


class _SpaceLock:
    """The space's re-entrant lock, holding back `after_write` notices until it is free.

    A notice made while the writing thread holds the lock (a write inside a rename, a type
    change, or any other operation that holds the lock across several steps) is kept for that
    thread and handed on when its outermost hold ends, so whoever gets it (the M14 engine's
    worker) never sees a half-done operation: a renamed file not moved yet, a lock still held.
    """

    __slots__ = ("_deliver", "_lock", "_pending")

    def __init__(self, deliver: Callable[[list[WriteNotice]], None]) -> None:
        self._lock = threading.RLock()
        self._pending: dict[int, list[WriteNotice]] = {}
        self._deliver = deliver

    def acquire(self, blocking: bool = True, timeout: float = -1) -> bool:
        return self._lock.acquire(blocking, timeout)

    def release(self) -> None:
        self._lock.release()
        if self._pending and not self._lock._is_owned():  # type: ignore[attr-defined]
            held = self._pending.pop(threading.get_ident(), None)
            if held:
                self._deliver(held)

    def __enter__(self) -> bool:
        return self._lock.acquire()

    def __exit__(self, *_exc: object) -> None:
        self.release()

    def _is_owned(self) -> bool:
        return self._lock._is_owned()  # type: ignore[attr-defined]

    def hold(self, notice: WriteNotice) -> bool:
        """Keep ``notice`` until this thread's outermost hold ends; False when it holds none."""
        if not self._lock._is_owned():  # type: ignore[attr-defined]
            return False
        self._pending.setdefault(threading.get_ident(), []).append(notice)
        return True


@dataclass(frozen=True)
class WriteNotice:
    """What `Space.after_write` is told about one write (M14 automations).

    ``kind`` is ``'created'`` (``before`` None) or ``'changed'``; ``before`` and ``after``
    are the parsed frontmatter values around the write; ``origin`` is
    `writeorigin.current()` at the write (None for the app's and the API's own writes).
    ``requested`` holds the values (frontmatter form) the caller's write asked for that a
    hook replaced before writing: completing a repeating Task asks for ``status: Done`` and
    writes the reset status and the next date (M8), so ``requested`` is ``{"status": "Done"}``
    (None when nothing was replaced).
    """

    kind: str
    path: str
    before: dict | None
    after: dict
    origin: str | None = None
    requested: dict | None = None


@dataclass(frozen=True)
class SpaceChange:
    """A change to the space's in-memory scan, for `Space.add_listener` listeners.

    ``kind`` is ``'object'`` (``path`` is the object's space path; it may be gone
    now) or ``'types'`` (a type definition changed; ``path`` is None and
    ``type_id`` names the type when the change knows it, so an index can
    limit its work to that type's members).
    """

    kind: str
    path: str | None
    type_id: str | None = field(default=None, compare=False)


def _same_bytes(a: Path, b: Path) -> bool:
    """True when both files exist and hold the same bytes."""
    try:
        return a.read_bytes() == b.read_bytes()
    except OSError:
        return False


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
class CounterpartEdit:
    """What `Space.edit_counterpart` did (M28): the other objects written (path, new version),
    the ones it could not write, and the target's counterpart rows afterwards."""

    written: list[tuple[str, str]]
    skipped: list[Skip]
    counterparts: list[CounterpartRow]


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


@dataclass
class WorkWriteOutcome:
    """What `Space.write_work` wrote (M22)."""

    version: str
    frontmatter: dict
    body: str
    synced: list[str]
    """Other objects written by relation syncing."""
    skipped: list[Skip]
    """Other objects relation syncing could not write."""


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


@dataclass
class NumberExistingResult:
    type: TypeDefinition
    numbered: int
    """How many objects got a number."""
    rewritten: list[str]
    """The objects numbered (unstamped rewrites)."""
    skipped: list[Skip]
    revision: str = ""

    def to_api(self) -> dict[str, Any]:
        """The route's response: ``{type, numbered, rewritten, skipped}`` (skipped: paths)."""
        return {
            "type": self.type.to_api(self.revision),
            "numbered": self.numbered,
            "rewritten": list(self.rewritten),
            "skipped": [s.path for s in self.skipped],
        }


def _has_unique_ids(t: TypeDefinition | None) -> bool:
    return t is not None and any(p.type == "uniqueId" for p in t.propertyDefinitions)


def _positive_int(value: Any, default: int = 1) -> int:
    if isinstance(value, int) and not isinstance(value, bool) and value >= 1:
        return value
    return default


def _id_value(p: PropertyDefinition, n: int) -> Any:
    """What an ID property writes for number ``n``: ``TASK-12`` (text) or ``12`` (no prefix)."""
    prefix = p.options.get("prefix")
    return f"{prefix}{n}" if isinstance(prefix, str) and prefix else n


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
class RelationPairResult:
    """M13: ``POST /api/types/{typeId}/relation-pair``."""

    type: TypeDefinition
    firstId: str
    """"Parent item" or "Blocked by"."""
    secondId: str
    """"Sub-items" or "Blocking"."""
    created: bool
    """False when the type already had both properties (they were reused)."""
    revision: str = ""
    changed: bool = False
    """Whether the type file was written (a pair was added or linked)."""

    def to_api(self) -> dict[str, Any]:
        """The route's response: ``{type, firstId, secondId, created}``."""
        return {
            "type": self.type.to_api(self.revision),
            "firstId": self.firstId,
            "secondId": self.secondId,
            "created": self.created,
        }


# M13 (our strings): the relation pairs a view turns on. kind -> ((first name, first is a
# list), (second name, second is a list)); both target the type itself and sync each other.
RELATION_PAIRS: dict[str, tuple[tuple[str, bool], tuple[str, bool]]] = {
    "subItems": (("Parent item", False), ("Sub-items", True)),
    "dependencies": (("Blocked by", True), ("Blocking", True)),
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


# The en-US texts.
BASIC_LOCKED = "The properties of basic types are fixed."
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
    """One rewrite every file of a type gets: ``fn(src, rel, fm) -> src``.

    ``fm`` is ``src`` parsed (the caller has it already: the scan's values, or the
    write's), so an op never parses the frontmatter itself.
    """

    fn: Callable[[str, str, dict], str]
    confirm: bool
    """True when it removes values (the save then needs ``confirm``)."""
    applies: Callable[[dict, str], bool]
    """``applies(fm, rel)``: whether ``fn`` would change the file, from its values alone
    (the plan runs this under the lock; ``fn``'s YAML round trip runs per file outside it)."""


def version_of(data: bytes) -> str:
    """An object's version: the sha256 hex digest of its file bytes."""
    return hashlib.sha256(data).hexdigest()


def _refuse_synced(pdef: PropertyDefinition | None) -> None:
    """M29: a synced property is filled by its source only (`Space.sync_facts`)."""
    if pdef is not None and is_synced(pdef):
        assert pdef.synced is not None
        raise InvalidValue(SYNCED_READ_ONLY.format(name=pdef.name, source=pdef.synced.source))


_HiddenFields = list[tuple[str | None, PropertyDefinition]]
"""M32: the ticket and work field definitions a type's file holds that are not listed while
Work is off, in the file's order, each with the key of the definition stored just before it."""


def _same_field(p: PropertyDefinition, builtin: PropertyDefinition) -> bool:
    """Whether ``p`` is the built-in ticket or work field as `workfields.field_defs` makes it
    (the user changed nothing about it). Project's ``allowedTypes`` are left out: the app fills
    them with the space's Project types of the moment the definition was made."""
    a, b = p.to_json(), builtin.to_json()
    if p.key == "project":
        for data in (a, b):
            if isinstance(data.get("options"), dict):
                data["options"].pop("allowedTypes", None)
    return a == b


def _merge_hidden(
    defs: list[PropertyDefinition], hidden: _HiddenFields
) -> list[PropertyDefinition]:
    """``defs`` with each of ``hidden`` it lacks put back where its file had it: right after
    the definition stored before it (at the end when that one is gone)."""
    out = list(defs)
    have = {p.key for p in out} | {p.id for p in out}
    for after, p in hidden:
        if p.key in have or p.id in have:
            continue  # the list has its own definition of that key: it stands
        at = len(out)
        if after is None:
            at = 0
        else:
            for i, q in enumerate(out):
                if q.key == after:
                    at = i + 1
                    break
        out.insert(at, p)
        have |= {p.key, p.id}
    return out


def _fm_has_value(value: object) -> bool:
    """Whether a front matter value is one: None, an empty or blank text and an empty list or
    map are not (M32: the Work switch's "this field has a value" and "a Ticket ID")."""
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, dict)):
        return bool(value)
    return True


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
    items = value if isinstance(value, list) else [value]
    if any(isinstance(v, float) and not math.isfinite(v) for v in items):
        # `.nan`/`.inf` in the file would make the object unreadable as JSON.
        raise InvalidValue(f'"{key}" must be a finite number.')
    if isinstance(value, list) and all(isinstance(v, scalar) and v is not None for v in value):
        return FlowList(value) if value else None
    if not isinstance(value, scalar):
        raise InvalidValue(f'"{key}" has no definition, so its value must be a JSON scalar.')
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


def yaml_single_quoted(text: str) -> str:
    """``text`` as a single-quoted YAML scalar, as the app writes ``type: '<Name>'``."""
    return _yaml_single_quoted(text)


_link_candidates = link_candidates


class _TypeList(list):
    """`Space.types`: a list that tells the space whenever it is changed in place."""

    def __init__(self, items: Iterable[TypeDefinition], changed: Callable[[], None]) -> None:
        super().__init__(items)
        self._changed = changed


def _notifying(name: str) -> Callable[..., Any]:
    method = getattr(list, name)

    def wrapper(self: _TypeList, *args: Any, **kwargs: Any) -> Any:
        try:
            return method(self, *args, **kwargs)
        finally:
            self._changed()

    wrapper.__name__ = name
    return wrapper


for _name in (
    "append", "extend", "insert", "remove", "pop", "clear", "sort", "reverse",
    "__setitem__", "__delitem__", "__iadd__", "__imul__",
):
    setattr(_TypeList, _name, _notifying(_name))


class Space:
    @property
    def types(self) -> list[TypeDefinition]:
        """The space's types; assigning or changing it in place drops the `_type_id` lookup."""
        return self._types

    @types.setter
    def types(self, value: Iterable[TypeDefinition]) -> None:
        self._types = _TypeList(value, self._forget_type_ids)
        self._forget_type_ids()

    def _forget_type_ids(self) -> None:
        self._type_ids = None
        self._work_data = None  # M32: which notes are work data depends on the types

    @property
    def name(self) -> str:
        """``.object/space.json``'s ``name``, else the folder name.

        Re-read only when the file's stat (times, size, inode) changed since the last
        access, so an edit made outside the app is still seen at once.
        """
        try:
            st = os.stat(self._space_json)
            key: tuple | None = (st.st_mtime_ns, st.st_ctime_ns, st.st_size, st.st_ino)
        except OSError:
            key = None
        cached = self._name_cache
        if cached is not None and cached[0] == key:
            return cached[1]
        name = space_fields(self.root)["name"]
        self._name_cache = (key, name)
        return name

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        self._space_json = os.fspath(self.root / SPACE_REL)
        self._name_cache: tuple[tuple | None, str] | None = None
        """(`space.json`'s stat key, the name read with it) for `name`."""
        self._config_cache: tuple[tuple | None, dict[str, Any]] | None = None
        """(`space.json`'s stat key, the data read with it) for `work_on` (M32)."""
        self._work_values: dict[str, tuple[str, frozenset[str]]] = {}
        """M32: path -> (the note's type name, the ticket and work field keys it holds a value
        for), for the notes that hold one; kept by every rescan (`_note_work_values`). Behind
        the Work switch's default (`_has_work_data`) and the fields listed with Work off."""
        self._work_data: bool | None = None
        """M32: `_has_work_data`'s answer, worked out again only after the index above or the
        types changed (so `work_on` stays a lookup)."""
        self._hidden_fields: dict[str, _HiddenFields] = {}
        """M32: type id -> the built-in ticket and work fields its file holds that are not
        listed while Work is off (`_hide_work_fields`); a type write puts them back
        (`_write_type_json`), so the file keeps them."""
        self.work_listing_rev = 0
        """M32: bumped whenever a type's listed ticket and work fields changed in memory (the
        Work switch moved, a value came or went); `server` tells the windows."""
        self._work_applied: bool | None = None
        """M32: the Work switch the in-memory Task type was last topped up for (None while
        the space is loading); `work_on` follows a change (`_follow_work_switch`)."""
        self._lock = _SpaceLock(self._deliver_notices)
        self._raw: dict[str, RawObject] = {}
        self._summaries: dict[str, ObjectSummary] = {}
        self._checked_rels: set[str] = set()
        """Known object paths that passed `_rel`'s full check since their last rescan."""
        self._listeners: list[Callable[[SpaceChange], None]] = []
        self._names_rev = 0
        """Bumped whenever the set of link names changes (see `_names_changed`)."""
        self._name_changes: deque[tuple[int, frozenset[str] | None]] = deque(maxlen=512)
        """(`_names_rev`, the folded link names that change touched; None when unknown)."""
        self._resolver: Resolver | None = None
        self._types_saving: set[str] = set()
        """Types whose `save_type` is rewriting objects outside the lock (no other type write then)."""
        self._links = LinkIndex(self)
        self._listeners.append(self._links.on_change)
        self.own_writes: dict[str, str] = {}
        """Path -> version of the last write `save_body` made (for self-write suppression)."""
        self.own_deletes: dict[str, str] = {}
        """Path -> version of a file the app moved away (to the trash); the watcher stays silent."""
        self.trash = Trash(self.root)
        self._source_tl = threading.local()
        """M30: this thread's `source_writes` depth (imported Sources are writable inside)."""
        synced_store = self.store(SYNCED_FOLDER)
        synced_store.before_write = None  # synced facts keep no version history
        self.synced = SyncedStore(synced_store)
        """M29: synced facts, ``.object/synced/<typeId>.json`` (`sync_facts` writes it)."""
        self.clock: Callable[[], datetime] = lambda: datetime.now(UTC)
        """The only source of "now" for stamps, the Task hook and the calendar (tests set it)."""
        self.tz: tzinfo = SystemTz()
        """The local zone (DST-aware) that turns instants into local days (tests set it)."""
        self.before_write: Callable[[str, bytes, str | None], None] | None = None
        """M8 version history: called as ``before_write(rel, current_bytes, object_id)``
        right before the app replaces an existing file (never on create, never on read).
        Errors it raises are logged and never stop the write (see `_call_before_write`)."""
        self.after_write: Callable[[WriteNotice], None] | None = None
        """M14 automations: called with a `WriteNotice` after the replace, once the writing
        thread holds the space's lock no more (a rename's write is announced after its move;
        see `_SpaceLock`), for stamped writes whose frontmatter changed, and by the create
        paths (`create_object`, `duplicate_object`, `create_daily_note`, `ensure_tag`). Never
        for unstamped rewrites, body-only saves, version or trash restores, or templates.
        Errors it raises are logged and never stop the write (see `_call_after_write`)."""
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
        self._add_on_demand_types()
        for rel, raw in self._raw.items():
            entry = self._work_entry(raw)
            if entry is not None:
                self._work_values[rel] = entry
        self._work_data = None
        # M32: the Task type gets every ticket and work field only while Work is on; with Work
        # off a type lists only those with a value or that the user changed (`_top_up`).
        self._work_applied = config_work_on(self._space_config(), self._has_work_data())
        for t in self.types:
            self._top_up(t)
        self._loaded_revisions: dict[str, str] = {
            t.id: type_revision(self.root, t.id) for t in self.types if not t.readOnlyReason
        }
        """Type id -> the revision of its file when the in-memory copy was loaded or written."""
        for rel, raw in self._raw.items():
            self._summaries[rel] = self._summarize(raw)
        # The frontmatter cache is written once here, outside any lock (startup only), so a
        # later start in this process finds nothing dirty and writes nothing; after this,
        # only the cache's own timer and interpreter exit write it (never a request thread).
        fmcache.for_root(self.root).flush()
        self.collections: dict[str, CollectionDef] = {}
        """Collection id -> definition (unreadable files included, read-only)."""
        self._collections_loaded: dict[str, tuple[str, CollectionDef]] = {}
        """Collection id -> (its file's revision, the definition parsed from it)."""
        self.reload_collections()
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

    def _add_on_demand_types(self) -> list[TypeDefinition]:
        """M32: give a space that has no Task or DailyNote type the built-in one, in memory.

        The types API lists it from the first open, so the app can always offer "New task" and
        "Today's note"; its file is written with the type's first object (`_persist_type`).
        A type of that id, name or former name (the user's own "Task", a renamed built-in)
        stays the only one. Never writes. Returns the types added.

        Called while the space loads only, so no listener is told (a type change recorded
        before the link index's first build would cost it its list of changed backlinks).
        """
        ids = {t.id for t in self.types} | {u.id for u in self.unreadable_types}
        names = {t.name for t in self.types}
        for t in self.types:
            names |= set(t.formerNames)
        added = on_demand_types(ids, names)
        if added:
            self.types.extend(added)  # the type-id lookup is dropped by the list itself
            self._sort_types()
        return added

    # -- the Work switch (M32) ----------------------------------------------------

    def _space_config(self) -> dict[str, Any]:
        """``space.json``'s data, re-read only when the file's stat changed (as `name`)."""
        try:
            st = os.stat(self._space_json)
            key: tuple | None = (st.st_mtime_ns, st.st_ctime_ns, st.st_size, st.st_ino)
        except OSError:
            key = None
        cached = self._config_cache
        if cached is not None and cached[0] == key:
            return cached[1]
        data = read_space_config(self.root)[0]
        self._config_cache = (key, data)
        return data

    def _work_entry(self, raw: RawObject) -> tuple[str, frozenset[str]] | None:
        """`_work_values`' entry for a note: its type name and the ticket and work field keys it
        holds a value for (an empty text or list is no value); None when it holds none."""
        hit = WORK_FIELD_KEYS & raw.fm.keys()
        if not hit:
            return None
        valued = frozenset(k for k in hit if _fm_has_value(raw.fm[k]))
        return (raw.typeName, valued) if valued else None

    def _hidden_steps(self, type_id: str) -> bool:
        """Whether the type's file holds a Steps property that is not listed (Work is off)."""
        return any(
            p.key == "steps" and p.type == "steps" for _a, p in self._hidden_fields.get(type_id, ())
        )

    def _is_work_kind(self, t: TypeDefinition | None) -> bool:
        """The basic Task or a work type (`workfields.is_work_type`), whether or not its Steps
        are listed just now: with Work off they are not while no note has a step."""
        return t is not None and (is_task_type(t) or is_work_type(t) or self._hidden_steps(t.id))

    def _has_work_data(self) -> bool:
        """Whether the space already holds work data: a Task or a work type's note holds a
        value for a built-in ticket or work field (a Ticket ID, steps, a Requester…), or the
        space has a Capture type (`captures.find_capture_type`: a type named "Capture") or an
        Alert type (`alerttype.is_alert_type`). A ``ticketId`` on a note of any other type is
        the user's own property and counts for nothing. Memory only, and worked out again
        only after a rescan changed which notes hold such a value, or the types changed."""
        found = self._work_data
        if found is None:
            with self._lock:
                found = self._work_data = self._find_work_data()
        return found

    def _find_work_data(self) -> bool:
        from .alerttype import is_alert_type
        from .captures import CAPTURE_TYPE_NAME

        capture = CAPTURE_TYPE_NAME.casefold()
        if any(t.name.casefold() == capture or is_alert_type(t) for t in self.types):
            return True
        if not self._work_values:
            return False
        tasks = {t.id for t in self.types if is_task_type(t)}
        kinds = tasks | {t.id for t in self.types if self._is_work_kind(t)}
        for type_name, valued in self._work_values.values():
            type_id = self._type_id(type_name)
            # Project (the relation to a Project) is a built-in field of the Task only.
            if type_id in kinds and (type_id in tasks or valued - {"project"}):
                return True
        return False

    def work_on(self) -> bool:
        """M32: whether Work is on for this space (`spaceconfig.work_on`).

        ``space.json``'s ``workEnabled`` when it is true or false; else the default: on when
        the space already holds work data (the IT operations starter's marker, a Capture or an
        Alert type, a value for a ticket or work field on a Task or a work type's note:
        `_has_work_data`), off otherwise. Reads ``space.json`` (only when its stat changed)
        and a flag kept in memory; never writes a file, so the default is not stored by being
        read. When the answer changed since the types were last listed for it, they follow in
        memory at once (`_follow_work_switch`).
        """
        on = config_work_on(self._space_config(), self._has_work_data())
        if self._work_applied is not None and on != self._work_applied:
            self._follow_work_switch(on)
        return on

    def _valued_work_keys(self, type_id: str) -> set[str]:
        """The ticket and work field keys some object of the type holds a value for (templates
        included; an empty text or list is no value). Memory only (`_work_values`)."""
        with self._lock:
            entries = list(self._work_values.values())
        keys: set[str] = set()
        for type_name, valued in entries:
            if self._type_id(type_name) == type_id:
                keys |= valued
        return keys

    def _builtin_work_fields(self, t: TypeDefinition) -> dict[str, PropertyDefinition]:
        """The built-in ticket and work fields of ``t`` by key (Project on the Task only)."""
        task = is_task_type(t)
        projects = project_type_ids(self.types) if task else []
        return {d.key: d for d in field_defs(task=task, project_type_ids=projects)}

    def _hide_work_fields(self, t: TypeDefinition, *, from_file: bool) -> None:
        """Work is off: take out of ``t`` (the basic Task or a work type, holding every
        definition it has) the built-in ticket and work fields that no note of the type holds
        a value for and the user did not change (`_same_field`), and remember them
        (`_hidden_fields`) so that a type write keeps them in the file and Work on lists them
        again. A field with a value, and one whose definition differs from the built-in one,
        stays listed. Memory only.

        ``from_file`` False: ``t`` is the in-memory type, where the Task also holds fields
        topped up in memory; those its file doesn't hold are dropped, not remembered.
        """
        if not (is_task_type(t) or is_work_type(t)):
            self._hidden_fields.pop(t.id, None)
            return
        builtin = self._builtin_work_fields(t)
        valued = self._valued_work_keys(t.id)
        hidden: _HiddenFields = []
        kept: list[PropertyDefinition] = []
        after: str | None = None
        for p in t.propertyDefinitions:
            d = builtin.get(p.key)
            if d is not None and p.key not in valued and _same_field(p, d):
                hidden.append((after, p))
            else:
                kept.append(p)
            after = p.key
        if hidden and is_task_type(t) and not from_file:
            stored = self._stored_type(t.id)
            in_file = {p.key for p in stored.propertyDefinitions} if stored is not None else set()
            hidden = [(a, p) for a, p in hidden if p.key in in_file]
        t.propertyDefinitions = kept
        if hidden:
            self._hidden_fields[t.id] = hidden
        else:
            self._hidden_fields.pop(t.id, None)

    def _show_work_fields(self, t: TypeDefinition) -> None:
        """Put the definitions `_hide_work_fields` took out of ``t`` back where its file has
        them. Memory only."""
        hidden = self._hidden_fields.pop(t.id, None)
        if hidden:
            t.propertyDefinitions = _merge_hidden(t.propertyDefinitions, hidden)

    def _top_up(self, t: TypeDefinition) -> TypeDefinition:
        """Give ``t`` (as its file holds it) the fields a load tops up and list its ticket and
        work fields as the Work switch says, in memory; return it. Never writes.

        The Task fields (`topup_task_type`), and for the basic Task M22's ticket and work
        fields: all of them while Work is on (as before M32).

        With Work off (M32) one rule for the basic Task and every work type: **a built-in
        ticket or work field (Steps and Project included) is listed only when some note of
        the type holds a value for it, or its stored definition differs from the built-in
        one (the user changed it).** The unchanged ones without a value are left out of what
        the type lists, whatever its file holds (`_hide_work_fields`); the file is not
        rewritten for it and keeps them (`_write_type_json`). The switch never hides a value.
        """
        topup_task_type(t)
        if self.work_on():
            self._hidden_fields.pop(t.id, None)
            return topup_work_fields(t, self.types)
        self._hide_work_fields(t, from_file=True)
        if is_task_type(t):
            topup_work_fields(t, self.types, only=self._valued_work_keys(t.id))
        return t

    def _follow_work_switch(self, on: bool) -> None:
        """Bring the in-memory types in line with a Work switch that changed (the user set
        it, or the default moved with the space's data). On: every definition a type's file
        holds is listed again and the Task gets the ticket and work fields it lacks. Off:
        the unchanged ones no note holds a value for go (`_top_up`'s rule). Memory only; no
        file is written either way."""
        with self._lock:
            if on == self._work_applied:
                return
            self._work_applied = on
            for t in list(self.types):
                if t.readOnlyReason:
                    continue
                self._relist(t, on)

    def _relist(self, t: TypeDefinition, on: bool) -> None:
        """List ``t``'s ticket and work fields for the Work switch ``on`` (see `_top_up`),
        starting from every definition it has; the listeners hear of a change."""
        if not self._is_work_kind(t):
            return
        before = [p.key for p in t.propertyDefinitions]
        self._show_work_fields(t)
        if on:
            topup_work_fields(t, self.types)
        else:
            topup_work_fields(t, self.types, only=self._valued_work_keys(t.id))
            self._hide_work_fields(t, from_file=False)
        if [p.key for p in t.propertyDefinitions] != before:
            self.work_listing_rev += 1
            self._types_changed(t.id)

    def _note_work_values(self, rel: str, raw: RawObject | None) -> None:
        """M32, on every rescan of ``rel`` (``raw`` None: the file is gone): keep the index of
        ticket and work field values behind the Work default (`_work_values`); and with Work
        off, list the fields of the note's type again when the keys it holds a value for
        changed: a value written outside the app is never left without its property, and a
        field whose last value went is no longer listed."""
        old = self._work_values.get(rel)
        new = self._work_entry(raw) if raw is not None else None
        if new == old:
            return
        if new is None:
            del self._work_values[rel]
        else:
            self._work_values[rel] = new
        self._work_data = None
        self.work_on()  # the default may have moved: the types follow
        if self._work_applied is not False:
            return
        for type_id in {self._type_id(entry[0]) for entry in (old, new) if entry is not None}:
            t = self.type_by_id(type_id)
            if t is not None and not t.readOnlyReason:
                self._relist(t, False)

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
                    self._top_up(stored)
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
            self.work_on()  # M32: the Task type's fields follow the Work switch first
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
            before_write=self._call_before_write,
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
        """Re-read the collection files that changed (the list route does this, so it is never stale).

        Every file is read and hashed; one is parsed again only when its revision differs
        from the one its in-memory definition was loaded at (and that definition is still
        the one in `collections`), so external edits, additions and removals all show.
        """
        with self._lock:
            loaded = self._collections_loaded
            known = {
                cid: rev
                for cid, (rev, c) in loaded.items()
                if self.collections.get(cid) is c
            }
            found: dict[str, CollectionDef] = {}
            fresh: dict[str, tuple[str, CollectionDef]] = {}
            for cid, data, rev, err in self.store("collections").list(known):
                if cid in known and known[cid] == rev:
                    c = self.collections[cid]
                else:
                    c = self._load_collection(cid, data, err)
                found[cid] = c
                fresh[cid] = (rev, c)
            self.collections = found
            self._collections_loaded = fresh

    def collections_with_revisions(self) -> list[tuple[CollectionDef, str]]:
        """`reload_collections`, then every collection with its file's revision, sorted as
        `list_collections` (one read of each file in all)."""
        with self._lock:
            self.reload_collections()
            return [
                (c, self._collections_loaded[c.id][0]) for c in self.list_collections()
            ]

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
                    raise InvalidValue(f'There is no object type "{tid}".')
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
                    raise InvalidValue(f'There is no object type "{tid}".')
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
            raise InvalidValue("Expected a list of collection names.")
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
                    raise InvalidValue(f'There is no collection named "{name}".')
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

    def _write_type_json(self, t: TypeDefinition, base_revision: str) -> str:
        """`write_type_json` with the version-history hook (the type file's bytes before the save).

        M32: the ticket and work fields that are in the type's file but not listed while Work
        is off (`_hidden_fields`) are put back where the file had them, so no type write made
        with Work off takes a definition out of the file."""
        hidden = self._hidden_fields.get(t.id)
        if hidden:
            full = copy.copy(t)
            full.propertyDefinitions = _merge_hidden(t.propertyDefinitions, hidden)
            t = full
        return write_type_json(self.root, t, base_revision, before_write=self._call_before_write)

    def _call_before_write(self, rel: str, data: bytes, object_id: str | None = None) -> None:
        """Run the `before_write` hook (M8 history) for ``rel``'s current bytes; never raises.

        ``object_id`` is the object's id when the caller already knows it, so the history
        store needn't parse the frontmatter again (re-measured after the audit fix pass).
        """
        hook = self.before_write
        if hook is None:
            return
        try:
            hook(rel, data, object_id)
        except Exception:  # noqa: BLE001 - history must never stop a save
            _log.exception("The pre-write hook failed for %s", rel)

    def _call_after_write(self, notice: WriteNotice | None) -> None:
        """Run the `after_write` hook (M14 automations) for one write; never raises."""
        if self.after_write is None or notice is None:
            return
        if self._lock.hold(notice):
            return  # handed on when this thread's outermost hold of the lock ends
        self._deliver_notices([notice])

    def _deliver_notices(self, notices: list[WriteNotice]) -> None:
        hook = self.after_write
        if hook is None:
            return
        for notice in notices:
            try:
                hook(notice)
            except Exception:  # noqa: BLE001 - an automation must never stop a save
                _log.exception("The post-write hook failed for %s", notice.path)

    def _created_notice(self, rel: str) -> WriteNotice | None:
        """The ``created`` notice of a file one of the create paths just placed (None for a
        template, or when the hook is unset)."""
        if self.after_write is None:
            return None
        with self._lock:
            raw = self._raw.get(rel)
        if raw is None or raw.readOnly or _str_or_none(raw.fm.get("template")):
            return None
        return WriteNotice("created", rel, None, dict(raw.fm), writeorigin.current())

    def _write_exact(self, rel: str, base_version: str, data: bytes) -> bool:
        """Put ``data`` back at ``rel`` if it is still at ``base_version``; False when it changed.
        Raises `ReadOnly` for an imported Source (M30)."""
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
            known = self._raw.get(rel)
            if known is not None:
                self._refuse_source(known)
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
        """Every query, by name (case-insensitive). An unreadable file lists with ``readOnlyReason``.

        M22: when the space has a work type, the built-in Tickets view (`workview.TICKETS_ID`)
        is listed too: its stored file when there is one, else the default; either way its
        ``types`` are every work type, set here. Without a work type it isn't listed. M32: nor
        while Work is off for the space (`work_on`); its stored file, if any, is kept.
        """
        with self._lock:
            found = [
                self._load_query(qid, data, err)
                for qid, data, _rev, err in self.store("queries").list()
            ]
            work_types = work_type_ids(self.types) if self.work_on() else []
        found = [q for q in found if q.id != TICKETS_ID] + (
            [self._tickets_query(found, work_types)] if work_types else []
        )
        return sorted(found, key=lambda q: (q.name.casefold(), q.id))

    @staticmethod
    def _tickets_query(found: list[QueryDef], work_types: list[str]) -> QueryDef:
        """The Tickets view: the stored one in ``found``, else the default, over ``work_types``."""
        q = next((x for x in found if x.id == TICKETS_ID), None)
        if q is None:
            q = QueryDef.from_json(tickets_default(), fallback_id=TICKETS_ID)
        return apply_types(q, work_types)

    def query_revision(self, query_id: str) -> str:
        return self.store("queries").revision(query_id)

    def _check_query_definition(self, definition: dict[str, Any], stored_type_ids: set[str]) -> None:
        """Raise `InvalidValue` for an unknown new type id, a bad result limit or too many search terms."""
        if not isinstance(definition.get("types"), list):
            raise InvalidValue("A query's types must be a list.")
        known = {t.id for t in self.types} | stored_type_ids
        for tid in sorted(query_type_ids(definition)):
            if tid not in known:
                raise InvalidValue(f'There is no object type "{tid}".')
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
            if q.id == TICKETS_ID:
                return self._save_tickets_query(q, stored, base_revision)
            if stored is None:
                raise KeyError(q.id)
            before = QueryDef.from_json(stored, fallback_id=q.id)
            self._check_query_definition(q.definition, query_type_ids(before.definition))
            q.readOnlyReason = None
            revision = store.write(q.id, q.to_json(), base_revision)
            return q, revision

    def _save_tickets_query(
        self, q: QueryDef, stored: dict | None, base_revision: str
    ) -> tuple[QueryDef, str]:
        """Save the Tickets view (M22): base ``""`` creates its file the first time.

        The file holds ``types: []`` (the live ones are set at read) and no ``builtIn``.
        Raises `KeyError` when the space has no work type (the view isn't listed then).
        """
        work_types = work_type_ids(self.types)
        if not work_types and stored is None:
            raise KeyError(q.id)
        out = for_storage(q)
        self._check_query_definition(out.definition, set())
        out.readOnlyReason = None
        revision = self.store("queries").write(out.id, out.to_json(), base_revision)
        return apply_types(out, work_types), revision

    def delete_query(self, query_id: str) -> str:
        """Move a query's file to ``trash/queries/<ulid>.json`` unchanged; return the trash id.

        No confirmation: it is restorable and touches no object. Raises `KeyError`, `ReadOnly`;
        M22: the built-in Tickets view raises `InvalidValue` ("The Tickets view is built in.").
        """
        if query_id == TICKETS_ID:
            raise InvalidValue(TICKETS_BUILT_IN)
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

    # -- automations (M14): delete to the trash, restore -------------------------

    def delete_automation(self, rule_id: str) -> str:
        """Move a rule's file to ``trash/automations/<ulid>.json`` unchanged; return the trash id.

        No confirmation: it is restorable and touches no object. Its run log stays until the
        entry is purged. Raises `KeyError` (no such rule, or an unusable id) and `ReadOnly`
        (the file isn't valid JSON).
        """
        with self._lock:
            store = self.store("automations")
            try:
                data, _rev = store.read(rule_id)
            except DefinitionUnreadable as exc:
                raise ReadOnly(exc.error) from exc
            except ValueError as exc:
                raise KeyError(rule_id) from exc
            if data is None:
                raise KeyError(rule_id)
            trash_id = new_ulid()
            dest = self.trash.automation_file(trash_id)
            dest.parent.mkdir(parents=True, exist_ok=True)
            rel = store.rel(rule_id)
            previous = self.own_writes.get(rel)
            self.own_writes[rel] = ""
            try:
                move_no_overwrite(store.path(rule_id), dest)
            except BaseException:
                if previous is None:
                    self.own_writes.pop(rel, None)
                else:
                    self.own_writes[rel] = previous
                raise
            self.trash.write_json(
                self.trash.automation_meta_file(trash_id),
                {"id": rule_id, "deletedAt": now_stamp()},
            )
            return trash_id

    def _restore_automation_entry(self, trash_id: str) -> dict[str, Any]:
        """Bring a deleted rule back under its id (`RestoreConflict` if that file exists)."""
        rule_id = self.trash.automation_id(trash_id)
        store = self.store("automations")
        try:
            live = store.path(rule_id)
        except ValueError as exc:
            raise InvalidValue("The deleted automation's id is not valid.") from exc
        if live.exists():
            raise RestoreConflict("Its id is used by another automation.")
        src = self.trash.automation_file(trash_id)
        live.parent.mkdir(parents=True, exist_ok=True)
        rel = store.rel(rule_id)
        self.own_writes[rel] = version_of(src.read_bytes())
        try:
            move_no_overwrite(src, live)
        except FileExistsError as exc:
            self.own_writes.pop(rel, None)
            raise RestoreConflict("Its id is used by another automation.") from exc
        except BaseException:
            self.own_writes.pop(rel, None)
            raise
        self.trash.automation_meta_file(trash_id).unlink(missing_ok=True)
        return {
            "paths": [],
            "typeIds": [],
            "collectionIds": [],
            "queryIds": [],
            "automationIds": [rule_id],
            "skipped": [],
        }

    def _purge_automation_entry(self, trash_id: str) -> None:
        """Delete a trashed rule for good, with its run log in the state dir."""
        from .automations import run_log_path  # automations imports this module

        rule_id = self.trash.automation_id(trash_id)
        self.trash.remove_automation(trash_id)
        if rule_id:
            try:
                run_log_path(self.root, rule_id).unlink(missing_ok=True)
            except (OSError, ValueError):
                _log.exception("Could not remove the run log of automation %s", rule_id)

    # A type delete's saved queries (our choice): a query whose only type is the deleted one
    # goes to the type's trash entry; one that names other types too, or excludes it, drops
    # the id (the dropped entries are kept in the entry's manifest). A restore undoes both,
    # so no live query points at a missing type and no types list empties (= every type).

    _QUERY_TYPE_LISTS = ("types", "excludeTypeIds")

    @staticmethod
    def _query_type_list(data: dict, key: str) -> list | None:
        d = data.get("definition")
        found = d.get(key) if isinstance(d, dict) else None
        return found if isinstance(found, list) else None

    @staticmethod
    def _query_entry_id(entry: Any) -> Any:
        """A ``types`` entry's type id, or an ``excludeTypeIds`` item itself."""
        return entry.get("id") if isinstance(entry, dict) else entry

    def _queries_of_type(self, type_id: str) -> tuple[list[str], list[tuple[str, dict, str]]]:
        """(ids of the readable queries of only `type_id`, (id, data, revision) of the others
        naming it in ``types`` or ``excludeTypeIds``)."""
        only: list[str] = []
        others: list[tuple[str, dict, str]] = []
        for qid, data, rev, err in self.store("queries").list():
            if data is None or err is not None:
                continue  # an unreadable file is never rewritten or moved
            entries = self._query_type_list(data, "types") or []
            excluded = self._query_type_list(data, "excludeTypeIds") or []
            ids = [self._query_entry_id(s) for s in entries]
            if ids and all(i == type_id for i in ids):
                only.append(qid)
            elif type_id in ids or type_id in excluded:
                others.append((qid, data, rev))
        return only, others

    def _trash_type_queries(
        self, type_id: str, folder: Path, moved: list[str], refs: list[dict[str, Any]]
    ) -> None:
        """`trash_type`'s query part: moves into ``folder/queries/``, drops the id elsewhere."""
        store = self.store("queries")
        only, others = self._queries_of_type(type_id)
        for qid in only:
            dest = folder / "queries" / f"{qid}.json"
            dest.parent.mkdir(parents=True, exist_ok=True)
            rel = store.rel(qid)
            previous = self.own_writes.get(rel)
            self.own_writes[rel] = ""
            try:
                move_no_overwrite(store.path(qid), dest)
            except OSError:
                if previous is None:
                    self.own_writes.pop(rel, None)
                else:
                    self.own_writes[rel] = previous
                _log.exception("Could not move query %s to the trash with its type", qid)
                continue
            moved.append(qid)
        for qid, data, rev in others:
            changed = copy.deepcopy(data)
            dropped: list[dict[str, Any]] = []
            for key in self._QUERY_TYPE_LISTS:
                items = self._query_type_list(changed, key)
                if items is None:
                    continue
                kept = []
                for index, entry in enumerate(items):
                    if self._query_entry_id(entry) == type_id:
                        dropped.append(
                            {"queryId": qid, "list": key, "index": index, "entry": entry}
                        )
                    else:
                        kept.append(entry)
                changed["definition"][key] = kept
            try:
                store.write(qid, changed, rev)
            except (RevisionConflict, ReadOnly, OSError):
                _log.warning("Could not drop the deleted type %s from query %s", type_id, qid)
                continue
            refs.extend(dropped)

    def _restore_type_queries(self, folder: Path, type_id: str, manifest: dict) -> list[str]:
        """Put back a type trash entry's queries and dropped ids; return the query ids touched."""
        store = self.store("queries")
        out: list[str] = []
        for qid in manifest.get("queries") or []:
            src = folder / "queries" / f"{qid}.json" if isinstance(qid, str) else None
            if src is None or not src.is_file():
                continue
            data = src.read_bytes()
            try:
                target = qid if not store.path(qid).exists() else ""
            except ValueError:
                target = ""
            if not target:  # the id was taken meanwhile: never overwrite, use a new one
                try:
                    name = json.loads(data.decode("utf-8")).get("name")
                except (ValueError, UnicodeDecodeError, AttributeError):
                    name = None
                usable = isinstance(name, str) and name.strip()
                target = store.new_id(name if usable else DEFAULT_QUERY_NAME)
            rel = store.rel(target)
            self.own_writes[rel] = version_of(data)
            try:
                move_no_overwrite(src, store.path(target))
            except BaseException:
                self.own_writes.pop(rel, None)
                raise
            out.append(target)
        # A query that listed the type more than once gets every entry back: the refs are
        # grouped per query and list, and the "added back by hand" check runs once per list.
        grouped: dict[str, dict[str, list[dict[str, Any]]]] = {}
        for ref in manifest.get("queryRefs") or []:
            qid, key = ref.get("queryId"), upgrade_list_name(ref.get("list"))
            if not isinstance(qid, str) or key not in self._QUERY_TYPE_LISTS or "entry" not in ref:
                continue
            grouped.setdefault(qid, {}).setdefault(key, []).append(ref)
        for qid, lists in grouped.items():
            try:
                data, rev = store.read(qid)
            except (DefinitionUnreadable, ValueError):
                continue
            if data is None or not isinstance(data.get("definition"), dict):
                continue  # deleted since: nothing to put the id back into
            touched = False
            for key, refs in lists.items():
                items = self._query_type_list(data, key)
                if items is None:
                    items = data["definition"][key] = []
                if any(self._query_entry_id(e) == type_id for e in items):
                    continue  # already there again (added back by hand)
                # In the order they were dropped, so each index is its original position.
                for ref in sorted(
                    refs,
                    key=lambda r: r["index"] if isinstance(r.get("index"), int) else 1 << 30,
                ):
                    index = ref.get("index")
                    index = (
                        index if isinstance(index, int) and 0 <= index <= len(items) else len(items)
                    )
                    items.insert(index, ref["entry"])
                    touched = True
            if not touched:
                continue
            try:
                store.write(qid, data, rev)
            except (RevisionConflict, ReadOnly, OSError):
                _log.warning("Could not put the restored type %s back into query %s", type_id, qid)
                continue
            if qid not in out:
                out.append(qid)
        return out

    def rows(
        self,
        type_ids: list[str] | None = None,
        collection_ids: list[str] | None = None,
        paths: list[str] | None = None,
        search: tuple[list[str], str] | None = None,
        preview: bool = True,
    ):
        """The objects in scope as `rows.Row`s (decoded values, links, preview), sorted by path."""
        from .rows import build_rows

        return build_rows(self, type_ids, collection_ids, paths, search, preview)

    def type_by_id(self, type_id: str) -> TypeDefinition | None:
        return next((t for t in self.types if t.id == type_id), None)

    def _type_id(self, type_name: str) -> str:
        """The id of the type `type_name` names: by name, then id, then former names.

        Case-insensitive; answered from a lookup built once per change of `types`.
        """
        lookup = self._type_ids
        if lookup is None:
            lookup = {}
            # Lowest priority first, so a name overrides an id overrides a former name,
            # and within one kind the first type in `types` wins.
            for t in reversed(self.types):
                for f in t.formerNames:
                    lookup[f.lower()] = t.id
            for kind in ("id", "name"):
                for t in reversed(self.types):
                    lookup[getattr(t, kind).lower()] = t.id
            self._type_ids = lookup
        found = lookup.get(type_name.lower())
        return found if found is not None else slug(type_name)

    # -- paths --------------------------------------------------------------

    def _rel(self, path: str) -> str:
        """Normalise a space-relative path; reject anything outside the space.

        A path the space already knows in exactly this spelling, and that passed the
        full check (``resolve()``, which costs ~46 µs) since it was last rescanned, is
        answered from `_checked_rels`; `rescan_file` forgets it first, so a file replaced
        on disk (say, by a symlink out of the space) is checked again.
        """
        if path in self._checked_rels and path in self._summaries:
            return path
        rel = PurePosixPath(str(path).replace("\\", "/"))
        if rel.is_absolute() or ".." in rel.parts or not rel.parts:
            raise ValueError(f"Path is outside the space: {path!r}")
        if is_ignored(rel) or rel.name.startswith(".") or rel.suffix.lower() != ".md":
            raise ValueError(f"Not an object path: {path!r}")
        if any(_component_too_long(part) for part in rel.parts):
            raise ValueError(f"Path component too long: {path!r}")
        try:
            full = (self.root / rel).resolve()
        except OSError as exc:  # e.g. ENAMETOOLONG: a bad path, not a file-system fault
            raise ValueError(f"Not an object path: {path!r}") from exc
        if not full.is_relative_to(self.root):
            raise ValueError(f"Path is outside the space: {path!r}")
        out = rel.as_posix()
        if out in self._summaries:
            self._checked_rels.add(out)
        return out

    def abspath(self, path: str) -> Path:
        return self.root / self._rel(path)

    # -- objects ------------------------------------------------------------

    def _summarize(self, raw: RawObject) -> ObjectSummary:
        fm = raw.fm
        type_id = self._type_id(raw.typeName)
        # M30: an imported Source opens read-only (only its import's re-run writes it).
        source = not raw.readOnly and is_imported_source(type_id, fm)
        return ObjectSummary(
            path=raw.path,
            id=_str_or_none(fm.get("id")),
            type=type_id,
            title=_title_of(raw),
            icon=_str_or_none(fm.get("icon")),
            createdAt=_str_or_none(fm.get("createdAt")),
            lastUpdated=_str_or_none(fm.get("lastUpdated")),
            tags=_str_list(fm.get("tags")),
            readOnly=raw.readOnly or source,
            readOnlyReason=SOURCE_READ_ONLY if source else raw.readOnlyReason,
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

    # -- synced facts (M29) ---------------------------------------------------

    def synced_fm(self, summary: ObjectSummary, fm: dict) -> dict:
        """`fm` with the synced values of the summary's type overlaid (`SyncedStore.overlay`):
        what every reader decodes. `fm` itself when the type has no synced properties."""
        return self.synced.overlay(self.type_by_id(summary.type), fm)

    def sync_facts(
        self,
        type_id: str,
        items: list[dict[str, Any]],
        hidden: set[str],
        now: datetime | None = None,
    ) -> SyncOutcome:
        """Fill the synced properties of the type's objects, one result per item, in order.

        ``type_id`` is a type id or name. Each item is ``{"match": {"by", "value", "key"?},
        "values": {key: API value}}``; it is matched among the type's objects that are not
        templates and not in ``hidden`` (`V1Guard.hidden_paths`). A matched object without an
        ``id`` gets one first (`ensure_id`, one unstamped line, no version kept); nothing else
        of any ``.md`` is written. Then one `SyncedStore.apply` stamps every updated object
        with one ``refreshedAt``; two items of one object merge in item order. Items that fail
        never stop the others. Raises `KeyError` (no such type), `InvalidValue` (the type has
        no synced properties, more than `MAX_ITEMS` items) and `ReadOnly` (the store file
        isn't readable, checked before anything is written).
        """
        t = self.type_by_id(self._type_id(type_id))
        if t is None:
            raise KeyError(type_id)
        if not synced_props(t):
            what = t.name  # a type's name: a capitalised subject
            raise InvalidValue(f"{what} has no synced properties.")
        if len(items) > MAX_SYNC_ITEMS:
            raise InvalidValue(f"At most {MAX_SYNC_ITEMS} items per call.")
        self.synced.check_readable(t.id)
        keyed = [
            p for p in t.propertyDefinitions if p.type in ("text", "url") and not is_synced(p)
        ]
        with self._lock:
            members = [
                (s, self._raw.get(s.path))
                for s in self._summaries.values()
                if s.type == t.id and s.template is None and s.path not in hidden
            ]
        members.sort(key=lambda m: m[0].path)
        candidates = []
        for s, raw in members:
            fm = raw.fm if raw is not None else {}
            keys: dict[str, str] = {}
            for p in keyed:
                value = decode_value(p, fm.get(p.key), fm)
                if isinstance(value, str):
                    keys[p.key] = value
            candidates.append(Candidate(s.path, s.id, s.title, tuple(s.aliases), keys))

        results: list[ItemResult] = []
        matched: list[tuple[ItemResult, dict[str, Any]]] = []
        for index, item in enumerate(items):
            item = item if isinstance(item, dict) else {}
            match = item.get("match")
            match = match if isinstance(match, dict) else {}
            by, value, key = match.get("by"), match.get("value"), match.get("key")
            detail = check_match(t, by, value, key)
            values = item.get("values")
            if detail is None and not isinstance(values, dict):
                detail = '"values" must be an object.'  # our string
            encoded: dict[str, Any] = {}
            if detail is None:
                try:
                    encoded = encode_facts(t, values)
                except InvalidValue as exc:
                    detail = str(exc)
            if detail is not None:
                results.append(ItemResult(index, "invalid", detail=detail))
                continue
            found = find_matches(candidates, by, value, key if by == "key" else None)
            what = f"the {by}" if by != "key" else f"the {t.prop(key).name}"  # type: ignore[union-attr]
            if not found:
                results.append(
                    ItemResult(index, "notFound", detail=f'No {t.name} has {what} "{value}".')
                )
                continue
            if len(found) > 1:
                results.append(
                    ItemResult(
                        index,
                        "ambiguous",
                        paths=[c.path for c in found],
                        detail=f'{len(found)} {t.pluralName} have {what} "{value}".',
                    )
                )
                continue
            result = ItemResult(index, "updated", path=found[0].path, objectId=found[0].objectId)
            results.append(result)
            matched.append((result, encoded))

        id_writes: list[tuple[str, str]] = []
        ids: dict[str, str | None] = {}
        failed: dict[str, str] = {}
        for result, _encoded in matched:
            path = result.path
            assert path is not None
            if result.objectId is not None:
                continue
            if path not in ids:
                ids[path] = self._sync_id(path, id_writes, failed)
            result.objectId = ids[path]
            if result.objectId is None:
                result.status = "invalid"
                result.path = None
                result.detail = failed.get(path)
        updates: dict[str, dict[str, Any]] = {}
        for result, encoded in matched:
            if result.status == "updated" and result.objectId:
                updates.setdefault(result.objectId, {}).update(encoded)
        refreshed_at = now_stamp(now or self.clock())
        revision = (
            self.synced.apply(t.id, updates, refreshed_at) if updates else self.synced.revision(t.id)
        )
        return SyncOutcome(t.id, refreshed_at, revision, results, id_writes)

    def _sync_id(
        self, path: str, id_writes: list[tuple[str, str]], failed: dict[str, str]
    ) -> str | None:
        """The id of a matched object `sync_facts` saw without one, inserted when still missing.

        Under the space lock, so two syncs of one id-less object add one id line between them:
        the summary's id is read again first (another sync may have added it since the
        candidates were taken) and adopted when there. An external write during the insert is
        retried once. Records the write in ``id_writes``, or the failure's detail in ``failed``.
        """
        with self._lock:
            for attempt in range(2):
                summary = self._summaries.get(self._rel(path))
                if summary is not None and summary.id:
                    return summary.id
                try:
                    before = self.cached_version(path)
                    new_id, version = self.ensure_id(path, history=False)
                except Conflict:
                    if attempt == 0:
                        self.rescan_file(path)
                        continue
                    # our string
                    failed[path] = "The object changed on disk while it got its id. Sync it again."
                    return None
                except (ReadOnly, KeyError, FileNotFoundError, ValueError) as exc:
                    failed[path] = getattr(exc, "reason", None) or str(exc)
                    return None
                if version != before:  # the file had its id already: nothing was written
                    id_writes.append((path, version))
                return new_id
        return None

    # -- the write engine -----------------------------------------------------

    @contextmanager
    def source_writes(self) -> Iterator[None]:
        """M30: while inside, this thread (only) may write imported Sources; nests.

        Only the M25 re-run of a Source's own source uses it (`writer._write_one`)."""
        tl = self._source_tl
        tl.depth = getattr(tl, "depth", 0) + 1
        try:
            yield
        finally:
            tl.depth -= 1

    def _refuse_source(self, raw: RawObject) -> None:
        """M30: `ReadOnly` ("Imported source") for an imported Source outside `source_writes`."""
        if getattr(self._source_tl, "depth", 0) > 0:
            return
        if is_imported_source(self._type_id(raw.typeName), raw.fm):
            raise ReadOnly(SOURCE_READ_ONLY)

    def _write(
        self,
        rel: str,
        base_version: str | None,
        edit: Edit,
        stamp: bool = True,
        now: datetime | None = None,
        history: bool = True,
        requested: dict[str, Any] | None = None,
    ) -> str:
        """Apply `edit` to an object file safely; return its (new) version.

        Re-reads the file, raises `Conflict` when it isn't at ``base_version``
        (``None`` means "whatever is current") and `ReadOnly` when it can't be
        saved. An edit that changes nothing writes nothing. With `stamp`,
        ``lastUpdated`` is set and an ``id`` inserted first when missing. A file
        without frontmatter gets a new fence block. Line endings, BOM and every
        untouched line's bytes are kept; the replace re-checks the version.
        ``now`` is the write's instant for the stamp (default: `Space.clock`).
        Without ``history`` the write takes no version-history snapshot (`before_write`).
        ``requested`` (filled by `edit` as it runs) is passed on as `WriteNotice.requested`.

        The lock is held for the read and the edit, released while the history
        snapshot and the temp file are written and synced (the slow part; reads go
        on meanwhile), and taken again for the version re-check, the replace and
        the rescan, so a write since the read still surfaces as a conflict.
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
            self._refuse_source(raw)
            stamped: dict[str, str] | None = None
            # M14: a stamped write that changes the frontmatter is announced to `after_write`
            # (a body-only save changes it only by its own stamp; unstamped rewrites never).
            notify = stamp and of.frontmatter_src != raw.of.frontmatter_src
            if stamp:
                insert_first = None if _str_or_none(raw.fm.get("id")) else {"id": new_ulid()}
                stamps = {"lastUpdated": now_stamp(now or self.clock())}
                if of.frontmatter_src == raw.of.frontmatter_src:
                    stamped = {**(insert_first or {}), **stamps}  # the only frontmatter change
                fm_src = set_keys(of.frontmatter_src or "", stamps, insert_first=insert_first)
                of = replace(of, frontmatter_src=fm_src)
            elif of.frontmatter_src == raw.of.frontmatter_src:
                stamped = {}
            # Untouched lines keep their own bytes (and line endings) from the original.
            text = join_object(of)
            data = encode_like(raw.data, text)
            new_version = version_of(data)
            self.own_writes[rel] = new_version

        def forget() -> None:
            if self.own_writes.get(rel) == new_version:
                del self.own_writes[rel]

        try:
            if history:
                self._call_before_write(rel, raw.data, _str_or_none(raw.fm.get("id")))
            tmp = _write_temp(full, data, keep_mode=True)  # written and fsynced beside the file
        except BaseException:
            forget()
            raise
        with self._lock:
            try:
                # Re-check right before the replace: an external write since the
                # read above must surface as a conflict, never be overwritten.
                try:
                    on_disk = version_of(full.read_bytes())
                except OSError as exc:
                    raise KeyError(rel) from exc
                if on_disk != current:
                    raise Conflict(on_disk)
                retry_os(lambda: os.replace(tmp, full))
            except BaseException:
                try:
                    os.unlink(tmp)
                except FileNotFoundError:
                    pass
                forget()
                raise
            fresh = self._raw_after_write(rel, data, text, raw, stamped)
            if fresh is None:
                self.rescan_file(rel)
            else:
                if fresh.of.frontmatter_src is not None:
                    # The next `read_raw` of this file (the next save, a rescan) finds its
                    # new frontmatter parsed instead of parsing it again.
                    fmcache.for_root(self.root).put(rel, fresh.of.frontmatter_src, fresh.fm)
                self._rescan_with(rel, fresh)
            notice: WriteNotice | None = None
            if notify and self.after_write is not None:
                after = fresh.fm if fresh is not None else self._raw.get(rel, raw).fm
                notice = WriteNotice(
                    "changed", rel, dict(raw.fm), dict(after), writeorigin.current(),
                    dict(requested) if requested else None,
                )
        self._call_after_write(notice)
        return new_version

    @staticmethod
    def _raw_after_write(
        rel: str, data: bytes, text: str, before: RawObject, stamped: dict[str, str] | None
    ) -> RawObject | None:
        """What `read_raw` would give for the file `_write` just wrote, without reading it.

        ``stamped`` holds the frontmatter keys `_write` itself set when the edit left the
        frontmatter alone (``{}`` when nothing changed there), so ``before``'s parsed values
        are reused instead of parsing the YAML again. None means "re-read the file"
        (anything unusual: undecodable text, a changed frontmatter that doesn't parse).
        """
        if has_undecodable(text) or decode(data).text != text:
            return None
        of = split_object(text)
        if not of.fm_ok:
            return None
        if stamped is not None and ("id" not in stamped or "id" in before.fm):
            # In the file's order: stamped keys already there were set in place, a new
            # `lastUpdated` was appended. A newly inserted id (once per object: first, or
            # last in a flow-style mapping) is left to the parse below.
            fm = {**before.fm, **stamped}
        elif of.frontmatter_src is None:
            fm = {}
        else:
            try:
                # An edit that checked its result by parsing it hands that parse on.
                fm = take_parsed(of.frontmatter_src)
            except FrontmatterError:
                return None
        t = fm.get("type")
        type_name = t.strip() if isinstance(t, str) and t.strip() else DEFAULT_TYPE
        return RawObject(
            path=rel, data=data, of=of, fm=fm, readOnly=False, typeName=type_name
        )

    def touch(self, path: str, now: datetime | None = None) -> tuple[str, str]:
        """Set only the object's ``lastUpdated`` to ``now``; return ``(base, version)``.

        ``base`` is the version on disk the stamp started from (read under the lock) and
        ``version`` the version after it: equal when nothing was written. M9: a
        whiteboard's canvas or ink save stamps its ``.md`` (``lastUpdated`` is
        component-level). A stamp under `_TOUCH_INTERVAL` old is left as it
        is (our choice), as is a read-only file; the write takes no version-history
        snapshot (our choice). Raises `KeyError`, `ValueError` and `Conflict` (an
        external write during the stamp).
        """
        instant = now or self.clock()

        def apply(src: str, fm: dict) -> str:
            last = _instant_or_none(fm.get("lastUpdated"), self.tz)
            # A stamp after now (a skewed clock, another machine) is replaced too.
            if last is not None and timedelta(0) <= instant - last < _TOUCH_INTERVAL:
                return src
            return set_keys(src, {"lastUpdated": now_stamp(instant)})

        rel = self._rel(path)
        with self._lock:
            full = self.root / rel
            if not full.is_file():
                raise KeyError(rel)
            base = version_of(full.read_bytes())
            try:
                version = self._write(
                    rel, base, self._fm_edit(apply), stamp=False, history=False
                )
            except ReadOnly:
                return base, base
            return base, version

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
                    raise InvalidValue(f'There is no object at "{path}".')
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
                raise InvalidValue(f'"{pdef.name}" only takes the objects of its fixed set.')

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
                raise InvalidValue(f'"{key}" can\'t be changed as a property.')
        t = self._type_of(rel)
        for key in (*updates, *remove):
            pdef = t.prop(key) if t is not None else None
            _refuse_synced(pdef)
            if pdef is not None and pdef.type in _READ_ONLY_VALUE_KINDS:
                raise InvalidValue(f'"{pdef.name}" can\'t be edited.')
            if pdef is not None and pdef.type in GATED_KINDS:
                # M22: steps change only through the work service (`write_work`).
                raise InvalidValue(STEPS_GATED)
        before: dict = {}
        task: list[TaskResult | None] = [None]
        requested: dict[str, Any] = {}
        now = self.clock()  # one instant for `completed`, `lastUpdated` and "today"
        hook = self._value_hook(t, now, {*updates, *remove}, task, requested, work=self.work_on())

        def apply(src: str, fm: dict) -> str:
            before.update(fm)
            task[0] = None
            requested.clear()
            return self._apply_values(t, rel, src, fm, updates, remove, hook=hook)

        version = self._write(rel, base_version, self._fm_edit(apply), now=now, requested=requested)
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

    def _value_hook(
        self,
        t: TypeDefinition | None,
        now: datetime,
        explicit: set[str],
        task: list[TaskResult | None],
        requested: dict[str, Any],
        work: bool = True,
    ) -> Callable[[dict, dict[str, Any], list[str]], None]:
        """The `_apply_values` hook of a property write: the Task status hook, then M22's
        `workhook.on_work_write` (System from the Ticket ID, ``completed`` on other work types).

        ``task[0]`` receives the Task hook's result; ``requested`` the asked-for values a
        recurrence replaced. M32: ``work`` False (a generic property write while Work is off
        for the space) leaves out the System inferred from a Ticket ID; a work type's
        ``completed`` is stamped and cleared whatever the switch says, as before M32 (with
        Work off its Steps may be in its file without being listed: `_is_work_kind`). The
        work service's own write always runs the whole hook.
        """

        def hook(fm: dict, sets: dict[str, Any], removals: list[str]) -> None:
            asked = dict(sets)
            task[0] = on_status_change(
                t, fm, sets, removals, now, self.tz, explicit=explicit,
                week_start=week_start_of(self.root),
            )
            if task[0] is not None and task[0].advanced:
                # M14: the notice says which asked-for values the recurrence replaced (the
                # status set to Done, reset to Not Started), so "changes to Done" still fires.
                requested.update({k: v for k, v in asked.items() if sets.get(k) != v})
            if work:
                on_work_write(t, fm, sets, removals, now, explicit)
            else:
                on_work_write(
                    t, fm, sets, removals, now, explicit,
                    system=False, work_type=self._is_work_kind(t),
                )

        return hook

    def write_work(
        self,
        path: str,
        base_version: str | None,
        *,
        updates: dict[str, Any] | None = None,
        remove: Iterable[str] = (),
        raw: Callable[[dict], dict[str, Any]] | None = None,
        body: Callable[[str, dict], str] | None = None,
    ) -> WorkWriteOutcome:
        """M22: one work write (the work service's only write), as one stamped `_write`.

        ``updates``/``remove`` are encoded as `update_properties` does (the Task hook and
        `workhook.on_work_write` run; the gated ``steps`` kind is allowed here, open steps
        only). Then ``raw(fm)`` returns front-matter keys set as given (the encoded ``steps``
        and ``floorItems`` lists; ``None`` removes the key), and ``body(body, fm_after)``
        returns the new body (LF; the file's CRLF/BOM are restored on write). ``fm`` is the
        front matter freshly read under the space lock, ``fm_after`` the one about to be
        written. ``raw`` and ``body`` may raise (`IllegalMove`, `InvalidValue`, the service's
        `StepChanged`): the write is then aborted with nothing written. ``base_version`` None
        means whatever is current (step and floor actions check their own revision). One
        history snapshot, one ``lastUpdated`` stamp, one `after_write` notice; a write that
        changes nothing writes nothing. Relation syncs run after, as in `update_properties`.
        Raises `KeyError`, `Conflict`, `ReadOnly`, `InvalidValue`.
        """
        rel = self._rel(path)
        updates = dict(updates or {})
        remove = list(remove)
        for key in (*updates, *remove):
            if key in _LOCKED_KEYS:
                raise InvalidValue(f'"{key}" can\'t be changed as a property.')
        t = self._type_of(rel)
        for key in (*updates, *remove):
            pdef = t.prop(key) if t is not None else None
            _refuse_synced(pdef)
            if pdef is not None and pdef.type in _READ_ONLY_VALUE_KINDS:
                raise InvalidValue(f'"{pdef.name}" can\'t be edited.')
        before: dict = {}
        task: list[TaskResult | None] = [None]
        requested: dict[str, Any] = {}
        now = self.clock()  # one instant for `completed`, `lastUpdated` and the callbacks
        hook = self._value_hook(t, now, {*updates, *remove}, task, requested)

        def edit(of: ObjectFile, fm: dict) -> ObjectFile | None:
            before.clear()
            before.update(fm)
            task[0] = None
            requested.clear()
            src = of.frontmatter_src or ""
            out = src
            if updates or remove:
                out = self._apply_values(t, rel, out, dict(fm), updates, remove, hook=hook)
            if raw is not None:
                keys = raw(copy.deepcopy(fm)) or {}
                sets = {k: v for k, v in keys.items() if v is not None}
                drops = [k for k, v in keys.items() if v is None]
                if sets:
                    out = set_keys(out, sets)
                if drops:
                    out = delete_keys(out, drops)
            new_body = of.body
            if body is not None:
                fm_after = dict(fm) if out == src else (parse_fm(out) if out else {})
                new_body = body(of.body, fm_after)
            if out == src and new_body == of.body:
                return None
            return replace(of, frontmatter_src=out if out != src else of.frontmatter_src,
                           body=new_body)

        version = self._write(rel, base_version, edit, now=now, requested=requested)
        of, fm, _v = self.read(rel)
        synced, skipped = self._sync_relations(rel, t, before, fm)
        return WorkWriteOutcome(
            version=version, frontmatter=fm, body=of.body, synced=synced, skipped=skipped
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

        M9: the layout keys (``wideLayoutMode``, ``wideCoverImage``, ``coverImageOffset``)
        take their own shapes and ``None`` removes them; a changed ``coverImage`` drops
        ``coverImageOffset``; a ``datetime`` takes ``{creation:<var>}`` on a template only.
        """
        sets: dict[str, Any] = {}
        removals: list[str] = []
        unquote: list[str] = []
        for key, value in updates.items():
            if key in _LAYOUT_KEYS:
                _check_layout_value(key, value)
                if value is None:
                    removals.append(key)
                else:
                    sets[key] = value
                continue
            pdef = self._pdef(t, key)
            if pdef is not None and pdef.type == "datetime":
                if isinstance(value, str) and value.strip().startswith("{creation:"):
                    sets[key] = _creation_value(value, fm)
                    continue
                if creation_variable(fm.get(key)) is not None:
                    unquote.append(key)  # a date replacing a variable drops its quotes
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
        if _COVER_OFFSET not in sets and (
            ("coverImage" in sets and sets["coverImage"] != fm.get("coverImage"))
            or "coverImage" in removals
        ):
            # A new cover image drops the old one's position (``referenceImageId``).
            removals.append(_COVER_OFFSET)
        in_place: dict[str, str] = {}
        if hook is not None:
            explicit_date = "date" in sets
            hook(fm, sets, removals)
            new_date = sets.get("date")
            if not explicit_date and isinstance(new_date, str) and isinstance(fm.get("date"), str):
                in_place["date"] = sets.pop("date")
        unquote = [k for k in unquote if k in sets and k in fm]
        if unquote:
            src = set_keys(src, dict.fromkeys(unquote))
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
                # M13: a single counterpart (a sub-item's "Parent item") is replaced, so the
                # parent it named before must drop the target from its own list.
                displaced: list[str] = []
                if target in now and cdef.options.get("isArray") is False:
                    with self._lock:
                        traw = self._raw.get(target)
                    if traw is not None:
                        displaced = sorted(
                            self._linked_paths(cdef, traw.fm.get(cdef.key), target) - {rel}
                        )
                edit = self._backlink_edit(cdef, rel, target, add=target in now)
                wrote: list[bool] = []

                def tracked(of: ObjectFile, fm: dict, edit=edit, wrote=wrote) -> ObjectFile | None:
                    out = edit(of, fm)
                    wrote.append(out is not None)
                    return out

                result = self._rewrite_other(target, tracked, stamp=True)
                if isinstance(result, Skip):
                    skipped.append(result)
                    continue
                if wrote and wrote[-1]:
                    synced.append(target)
                for old_parent in displaced:
                    out = self._drop_link(pdef, old_parent, target)
                    if isinstance(out, Skip):
                        skipped.append(out)
                    elif out and old_parent not in synced:
                        synced.append(old_parent)
        return synced, skipped

    def _drop_link(self, pdef: PropertyDefinition, owner: str, target: str) -> Skip | bool:
        """Remove ``owner``'s link to ``target`` from its ``pdef`` value (stamped); whether it wrote."""
        with self._lock:
            summary = self._summaries.get(owner)
        if summary is None:
            return False
        if summary.readOnly:
            return Skip(owner, summary.readOnlyReason or "Object is read-only")
        tt = self.type_by_id(summary.type)
        odef = next(
            (p for p in (tt.propertyDefinitions if tt is not None else []) if p.id == pdef.id),
            None,
        )
        if odef is None or odef.type != "entity":
            return False
        edit = self._backlink_edit(odef, target, owner, add=False)
        wrote: list[bool] = []

        def tracked(of: ObjectFile, fm: dict) -> ObjectFile | None:
            out = edit(of, fm)
            wrote.append(out is not None)
            return out

        result = self._rewrite_other(owner, tracked, stamp=True)
        if isinstance(result, Skip):
            return result
        return bool(wrote and wrote[-1])

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

    def ensure_id(
        self, path: str, base_version: str | None = None, *, history: bool = True
    ) -> tuple[str, str]:
        """The object's ``id``, inserted first in its frontmatter if missing (unstamped).

        ``base_version`` and ``history`` are passed on to `_write` (the file is left alone,
        and no version kept, when it has an id already).
        """
        found: list[str] = []

        def apply(src: str, fm: dict) -> str:
            existing = _str_or_none(fm.get("id"))
            if existing:
                found.append(existing)
                return src
            new = new_ulid()
            found.append(new)
            return set_keys(src, {}, insert_first={"id": new})

        version = self._write(
            path, base_version, self._fm_edit(apply), stamp=False, history=history
        )
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
        raws = self._mentioning(names)
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

    def _bystanders(self, rel: str, new_title: str) -> dict[str, dict[str, str]]:
        """Links that reach another object by ``new_title``: path -> {target: where it resolves}.

        Renaming ``rel`` to that name could make them resolve to it instead
        (an exact title or the linking folder wins), so the rename rewrites the
        ones that change to their old object's unambiguous link text.
        """
        names = {_fold(new_title), _fold(safe_filename(new_title))}
        raws = self._mentioning(names)
        out: dict[str, dict[str, str]] = {}
        for raw in raws:
            text = (raw.of.frontmatter_src or "") + raw.of.body
            if "[[" not in text:
                continue
            found: dict[str, str] = {}
            for t in wikilink_targets(text):
                if _fold(t) not in names:
                    continue
                was = self.resolve(t, raw.path)
                if was is not None and was != rel:
                    found[t] = was
            if found:
                out[raw.path] = found
        return out

    def _mentioning(self, names: set[str]) -> list[RawObject]:
        """The objects holding a link whose target text folds to one of ``names`` (by path).

        The link index's candidates (audit 2026-11-01 P4): the callers then check each
        file's links exactly instead of scanning every file in the space.
        """
        candidates = self._links.mentioning(names)
        with self._lock:
            return [self._raw[p] for p in sorted(candidates) if p in self._raw]

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
            gone = self._summaries.pop(rel, None)
            self._checked_rels.discard(rel)
            entry = self._work_values.pop(rel, None)
            if entry is not None:
                # M32: its ticket and work values move with the file (the rescan below reads
                # them again), so the Work default does not flicker in between.
                self._work_values[new_rel] = entry
            if gone is not None:
                self._names_changed(gone, None)
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
        candidates = self._links.mentioning(names)  # a board's links count as body links
        with self._lock:
            boards = sorted(p for p, s in self._summaries.items() if s.type == t.id and p in candidates)
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
            raise InvalidValue("The title can't be empty.")
        if self._is_title_locked(rel):
            raise InvalidValue("A daily note's title is its date and can't be changed.")
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
        bystanders = self._bystanders(rel, new_title)
        whiteboard = self._is_whiteboard(rel)

        def edit(of: ObjectFile, _fm: dict) -> ObjectFile | None:
            src = set_keys(of.frontmatter_src or "", {"title": new_title})
            body = of.body
            code = code_ranges(body)  # a `# Old title` line inside a fence is not the heading
            for m in _HEADING_RE.finditer(body):
                if any(s <= m.start() < e for s, e in code):
                    continue
                if m.group(1).strip() == old_title:
                    body = body[: m.start()] + f"# {new_title}" + body[m.end() :]
                    break
            return replace(of, frontmatter_src=src, body=body)

        with self._lock:
            # An object without an `id` gets one first (unstamped, no version kept), so the
            # title write's history snapshot is keyed by the id that follows the file to its
            # new name, not by the old path (sweep 2026-11-08). A file with an id is untouched.
            _, base_version = self.ensure_id(rel, base_version, history=False)
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
        for ref in sorted(bystanders):
            # Links that reached another object by the new name keep reaching it.
            at = new_rel if ref == rel else ref
            for target, was in sorted(bystanders[ref].items()):
                if self.resolve(target, at) == was:
                    continue
                result = self._rewrite_other(
                    at, self._relink_edit({target}, self._link_text(was, at))
                )
                if isinstance(result, Skip):
                    skipped.append(result)
                elif ref != rel and ref not in relinked:
                    relinked.append(ref)
                elif ref == rel:
                    version = result
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
            raise InvalidValue("A tag needs a name.")
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
                    break
            else:
                raise OSError(f"Could not find a free file name for {stem!r}")
        self._call_after_write(self._created_notice(rel))
        return rel, True

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
            raise InvalidValue(f"The type of a {src.name} object can't be changed.")
        if type_category(dst) not in CHANGE_TO_ALLOWED:
            raise InvalidValue(f"An object can't be changed to a {dst.name}.")
        if src.id == dst.id:
            raise InvalidValue(f"The object already is a {dst.name}.")
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
                raise InvalidValue(f'"{frm}" can\'t be mapped: it carries over as it is.')
            if to is None:
                out[frm] = None
                continue
            p = src.prop(frm)
            q = targets.get(to) if isinstance(to, str) else None
            if p is None:
                raise InvalidValue(f'The object type {src.name} has no property "{frm}".')
            if q is None:
                raise InvalidValue(f'The object type {dst.name} has no property "{to}" to map to.')
            if q.key in used:
                raise InvalidValue(f'"{q.name}" can only take one value.')
            if not compatible(p, q):
                raise InvalidValue(f'"{p.name}" can\'t become "{q.name}".')
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
                new = replace_in_value(src_text, "type", lambda _v: name, parsed=fm)
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
        """Write an inferred-only type's JSON (the first time it is used); True if written.

        M32: the basic Task is written without the built-in ticket and work fields it was
        topped up with in memory (all of them while Work is on): a load adds them again
        while Work is on, and storing them is what would keep them on the Task for good. One
        the user changed is written."""
        if t.readOnlyReason or type_revision(self.root, t.id):
            return False
        out = t
        if is_task_type(t):
            builtin = self._builtin_work_fields(t)
            out = copy.copy(t)
            out.propertyDefinitions = [
                p
                for p in t.propertyDefinitions
                if not (p.key in builtin and _same_field(p, builtin[p.key]))
            ]
        try:
            self._check_type_free(t.id)
            self._write_type_json(out, "")
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
        reference: datetime | None = None,
        body: str | None = None,
        append_body: str | None = None,
    ) -> tuple[str, str]:
        """Create an object of the type in its folder; return (path, version).

        The frontmatter is ``id``, ``type: '<Name>'``, ``title`` (only when
        non-empty), ``createdAt`` and ``lastUpdated``; the body is empty. (M32: it was
        ``# <title>`` for a titled object. The app shows the title above the body, so
        that line showed every new note's title twice; the title is in the front matter
        only. Notes that already open with the heading keep it, and a rename still keeps
        such a line in step.) The file name is `safe_filename` of the title, made unique.

        ``template_id`` None applies the type's default template (if it still
        exists), ``"none"`` applies none, anything else that template (see
        `apply_template`). Without a title, a template's ``title`` (with its
        ``{date:FMT}`` placeholders expanded) is used.

        ``values`` (API form, like `update_properties`' ``updates``) go into the
        creating write; after a template they win, except ``collections``, which
        are merged with the template's. An invalid value raises `InvalidValue`
        before anything is written.

        ``reference`` (M14: an automation's run instant) is the instant a template's
        ``{date:FMT}`` and ``{creation:...}`` values are taken at (default: the clock);
        ``createdAt`` and ``lastUpdated`` are always the clock's.

        ``body`` replaces the body the object would get (empty, or the template's);
        ``append_body`` is added below that body after one blank line (alone when it is
        empty). Both are written in the creating write, so the text is there before anything
        hears of the object (M14: a creation rule's write can't race a separate body save).

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
                raise TemplateError(f"The object type {t.name} has no templates.")
            tmpl = self._find_template(t, template_id)
        instant = self.clock()
        created = to_local(reference or instant, self.tz)
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
        of = ObjectFile(fm_src, "", True, None)
        if tmpl is not None:
            of = self._template_edit(t, tmpl, created)(of, parse_fm(fm_src)) or of
        if body is not None:
            of = replace(of, body=body.replace("\r\n", "\n"))
        if append_body:
            extra = append_body.replace("\r\n", "\n")
            joined = f"{of.body.rstrip()}\n\n{extra}" if of.body.strip() else extra
            of = replace(of, body=joined if joined.endswith("\n") else f"{joined}\n")
        stem = safe_filename(title) if title else "Untitled"
        if values:
            for key in values:
                if key in _LOCKED_KEYS:
                    raise InvalidValue(f'"{key}" can\'t be changed as a property.')
                _refuse_synced(t.prop(key))
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
        ids = self._take_unique_ids(t)
        if ids:
            of = replace(of, frontmatter_src=set_keys(of.frontmatter_src or "", ids))
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
                    break
            else:
                raise OSError(f"Could not find a free file name for {stem!r}")
        self._call_after_write(self._created_notice(rel))
        return rel, version

    def duplicate_object(
        self, path: str, now: datetime | None = None
    ) -> tuple[str, str, list[str]]:
        """Copy an object as ``<Title> (Copy)`` in its own folder; return (path, version, synced).

        The copy is the source's bytes (line endings and BOM included) except for a
        new ``id``, ``title: <Title> (Copy)``, fresh ``createdAt`` and ``lastUpdated``
        (``now``, default `Space.clock`) and a first ``# <Title>`` heading, which
        becomes ``# <Title> (Copy)``. The title rule is
        ``${title || 'Untitled'} (Copy)``. Besides the new file, the targets of its
        synced (two-way) relations gain ``[[<Title> (Copy)]]`` in their counterpart
        property, as for any relation edit (Gene, 2026-10-29); ``synced`` lists them.

        Raises `KeyError` (no such file), `ValueError` (not an object path) and
        `InvalidValue` for what can't be duplicated (daily notes and media),
        templates, whiteboards (their sidecars would
        need copying too; our choice) and read-only files.
        """
        rel = self._rel(path)
        full = self.root / rel
        instant = now or self.clock()
        with self._lock:
            if not full.is_file():
                raise KeyError(rel)
            raw = read_raw(self.root, rel)
            t = self.type_by_id(self._type_id(raw.typeName))
            if (
                raw.readOnly
                or _str_or_none(raw.fm.get("template"))
                or role_of(t) in _NOT_DUPLICATED_ROLES
                or self._is_whiteboard(rel)
            ):
                raise InvalidValue(_CANNOT_DUPLICATE)
        # M12: a copy gets a new ID number (taken outside the lock: it may wait for a type save).
        ids = self._take_unique_ids(t) if t is not None else {}
        with self._lock:
            title = _title_of(raw)
            new_title = f"{title or 'Untitled'} (Copy)"
            stamp = now_stamp(instant)
            fm_src = set_keys(
                raw.of.frontmatter_src or "",
                {"title": new_title, "createdAt": stamp, "lastUpdated": stamp, **ids},
                insert_first={"id": new_ulid()},
            )
            body = raw.of.body
            lines = body.split("\n")
            first = next((i for i, line in enumerate(lines) if line.strip()), None)
            if first is not None and lines[first].rstrip() == f"# {title}":
                lines[first] = f"# {new_title}"
                body = "\n".join(lines)
            of = replace(raw.of, frontmatter_src=fm_src, body=body, fm_ok=True, fm_error=None)
            data = encode_like(raw.data, join_object(of))
            version = version_of(data)
            folder = PurePosixPath(rel).parent.as_posix()
            folder = "" if folder == "." else folder
            stem = safe_filename(new_title)
            for _attempt in range(100):
                new_rel = unique_path(self.root, folder, stem)
                if self._place(new_rel, data):
                    break
            else:
                raise OSError(f"Could not find a free file name for {stem!r}")
        self._call_after_write(self._created_notice(new_rel))
        _of, fm, _v = self.read(new_rel)
        synced, _skipped = self._sync_relations(new_rel, t, {}, fm)
        return new_rel, version, synced

    def place_new(self, rel: str, data: bytes) -> bool:
        """Write a new object file at ``rel`` unless something is there by then; True if
        written. Never overwrites; holds the space lock as `create_object` does and rescans
        the file (M15's importer writes through this)."""
        with self._lock:
            return self._place(rel, data)

    # -- M12: IDs -----------------------------------------------------------------

    _ID_WAIT_SECONDS = 10.0

    def _take_unique_ids(self, t: TypeDefinition) -> dict[str, Any]:
        """The next number of each ID property of ``t`` (``{key: value}``), bumping ``nextNumber``.

        The type JSON is written under the space lock, so two creates never share a number;
        a create that comes while `save_type` is rewriting the type's objects waits for it
        (outside the lock) so the save can't write an older ``nextNumber`` back. A number,
        once taken, is never given again (even when the create then fails).
        """
        if not _has_unique_ids(t):
            return {}
        deadline = time.monotonic() + self._ID_WAIT_SECONDS
        while True:
            with self._lock:
                if t.id not in self._types_saving:
                    try:
                        stored, current = self._editable_type(t.id)
                    except (KeyError, TypeReadOnly):
                        return {}  # an unreadable type file can't be bumped: no number
                    values: dict[str, Any] = {}
                    for p in stored.propertyDefinitions:
                        if p.type != "uniqueId":
                            continue
                        n = _positive_int(p.options.get("nextNumber"))
                        values[p.key] = _id_value(p, n)
                        p.options["nextNumber"] = n + 1
                    if values:
                        self._commit_type(stored, current)
                    return values
            if time.monotonic() > deadline:
                raise RevisionConflict(type_revision(self.root, t.id))
            time.sleep(0.02)

    def number_existing(self, type_id: str, pid: str, base_revision: str) -> NumberExistingResult:
        """Give every object of the type without a value of ID property ``pid`` the next number.

        Oldest ``createdAt`` first (then path); templates are left out. ``nextNumber`` is
        bumped (written first, so a number is never given twice) and the objects are
        rewritten unstamped. Raises `KeyError` (unknown type or property), `TypeReadOnly`,
        `RevisionConflict` and `InvalidValue` (not an ID property).
        """
        with self._lock:
            t, current = self._editable_type(type_id)
            if current != (base_revision or ""):
                raise RevisionConflict(current)
            self._check_type_free(t.id, current)
            p = next((x for x in t.propertyDefinitions if x.id == pid), None)
            if p is None:
                raise KeyError(pid)
            if p.type != "uniqueId":
                raise InvalidValue(f'"{p.name}" is not an ID property.')
            key = p.key
            members = self._type_members(t.id, templates=False)

            def missing(fm: dict) -> bool:
                return fm.get(key) is None or str(fm.get(key)).strip() == ""

            todo = [
                self._raw[rel] for rel in members if rel in self._raw and missing(self._raw[rel].fm)
            ]

            def order(raw: RawObject) -> tuple:
                created = _instant_or_none(raw.fm.get("createdAt"), self.tz)
                return (created is None, created.timestamp() if created else 0.0, raw.path)

            todo.sort(key=order)
            n = _positive_int(p.options.get("nextNumber"))
            numbers: dict[str, Any] = {}
            for raw in todo:
                numbers[raw.path] = _id_value(p, n)
                n += 1
            p.options["nextNumber"] = n
            revision = self._commit_type(t, current) if numbers else current

            def run(src: str, rel: str, fm: dict) -> str:
                if not missing(fm) or rel not in numbers:
                    return src
                return set_keys(src, {key: numbers[rel]})

            rewritten, skipped = self._apply_type_ops(list(numbers), run)
            stored = self.type_by_id(t.id) or t
            return NumberExistingResult(stored, len(rewritten), rewritten, skipped, revision)

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
        t = on_demand_type("dailynote")
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
            raise InvalidValue(f'"{day}" is not a day (YYYY-MM-DD).')
        day = parsed
        ids: dict[str, Any] = {}
        pre = self.daily_note_type()
        if pre is not None and _has_unique_ids(pre) and day not in self.daily_notes()[0]:
            ids = self._take_unique_ids(pre)  # M12: before the lock (it may wait for a type save)
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
            if ids:
                of = replace(of, frontmatter_src=set_keys(of.frontmatter_src or "", ids))
            data = join_object(of).encode("utf-8")
            folder = t.folder.strip("/") or "DailyNotes"
            rel = f"{folder}/{day}.md"
            self._persist_type(t)
            placed = self._place(rel, data)
            if not placed:
                self._daily_note_taken(rel, day)
        self._call_after_write(self._created_notice(rel))
        return rel, version_of(data)

    def _daily_note_taken(self, rel: str, day: str) -> None:
        """Raise `DailyNoteExists` for a daily note whose file name was taken meanwhile."""
        with self._lock:
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
            unregister = (
                summary is not None and summary.template and summary.id and type_trash_id is None
            )
            if unregister:
                # Restore puts the template back where it was in the type's `templates`.
                registration = self._template_registration(summary.type, summary.id)
                if registration is not None:
                    meta["template"] = registration
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
            if unregister:
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
        raise TemplateError(f'There is no template "{template_id}" for {t.name}.')

    def _save_templates_field(self, t: TypeDefinition, templates: dict[str, Any]) -> bool:
        """Write the type with a new ``templates`` value; False when it can't be saved."""
        if t.readOnlyReason:
            return False
        new = copy.deepcopy(t)
        new.templates = templates
        try:
            self._check_type_free(t.id)
            self._write_type_json(new, type_revision(self.root, t.id))
        except (RevisionConflict, TypeReadOnly):
            return False
        self.types = [new if x.id == t.id else x for x in self.types]
        self._types_changed(t.id)
        return True

    def _template_registration(self, type_id: str, template_id: str) -> dict[str, Any] | None:
        """A template's place in its type's ``templates`` (kept in its trash meta), or None."""
        t = self.type_by_id(type_id)
        if t is None:
            return None
        ids = list(t.templates.get("ids") or [])
        default = t.templates.get("defaultTemplateId") == template_id
        if template_id not in ids and not default:
            return None
        return {"index": ids.index(template_id) if template_id in ids else None, "default": default}

    def _register_template(self, path: str, registration: dict[str, Any]) -> None:
        """Put a restored template back in its type's ``templates`` (see `delete_object`).

        Its id returns to its old position in ``ids`` (or the end) and it becomes the
        default again unless another template is by now.
        """
        with self._lock:
            summary = self._summaries.get(path)
            if summary is None or not summary.id or not summary.template:
                return
            t = self.type_by_id(summary.type)
            if t is None or t.readOnlyReason:
                return
            ids = list(t.templates.get("ids") or [])
            if summary.id not in ids:
                index = registration.get("index")
                at = min(index, len(ids)) if isinstance(index, int) and index >= 0 else len(ids)
                ids.insert(at, summary.id)
            default = t.templates.get("defaultTemplateId")
            if registration.get("default") and default is None:
                default = summary.id
            templates = {**t.templates, "ids": ids, "defaultTemplateId": default}
            if templates != t.templates:
                self._save_templates_field(t, templates)

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

    def create_template(
        self, type_id: str, name: str = "New template", body: str = "", default: bool = False
    ) -> tuple[str, str]:
        """Create an empty template of the type and register it; return (path, version).

        The file is ``Templates/<last segment of the type's folder>/<name>.md``
        with ``id``, ``type: '<Name>'`` and ``template: <name>``; its id is
        appended to ``templates.ids``. Raises `KeyError` (unknown type),
        `TypeReadOnly` and `InvalidValue` (a type without templates).

        M28: ``body`` is the new template's body (an IT ops type's sections) and ``default``
        also makes it the type's ``defaultTemplateId``, in the same type write.
        """
        t = self.type_by_id(type_id)
        if t is None:
            raise KeyError(type_id)
        if not self._templates_allowed(t):
            raise InvalidValue(f"The object type {t.name} has no templates.")
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
        data = join_object(ObjectFile(fm_src, body, True, None)).encode("utf-8")
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
            templates = {**t.templates, "ids": ids}
            if default:
                templates["defaultTemplateId"] = template_id
            self._save_templates_field(t, templates)
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
                        raise TemplateError(f'"{{creation:{var}}}" needs a date property.')
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
            raise TemplateError(f"The object type {t.name} has no templates.")
        with self._lock:
            summary = self._summaries.get(rel)
        if summary is not None and summary.template:
            raise TemplateError("A template can't be applied to a template.")
        tmpl = self._find_template(t, template_id)
        return self._write(rel, base_version, self._template_edit(t, tmpl))

    def _save_type(self, t: TypeDefinition) -> bool:
        try:
            self._check_type_free(t.id)
            self._write_type_json(t, type_revision(self.root, t.id))
        except (RevisionConflict, TypeReadOnly):
            return False
        self._types_changed(t.id)
        return True

    def trash_type(self, type_def: TypeDefinition, object_paths: Iterable[str]) -> TrashItem:
        """Move a type, its template files and the given objects to the trash.

        The type JSON and templates go to ``trash/types/<ulid>/``; each object
        becomes an object entry with ``typeTrashId``. Other types' relation
        properties that allowed this type stop allowing it; ``allowedTypesRefs``
        records them so a restore puts them back. Saved queries of only this type
        move to ``queries/`` in the entry; others naming it drop it (``queryRefs``).
        """
        with self._lock:
            self._check_type_free(type_def.id)
            trash_id = new_ulid()
            folder = self.trash.type_dir(trash_id)
            folder.mkdir(parents=True, exist_ok=True)
            objects = [self._rel(p) for p in object_paths]
            templates = [p for p in self._templates_of(type_def.id) if p not in objects]
            object_ids: list[str] = []
            refs: list[dict[str, str]] = []
            queries: list[str] = []
            query_refs: list[dict[str, Any]] = []
            deleted_at = now_stamp()
            manifest = {
                "id": trash_id,
                "kind": "type",
                "typeId": type_def.id,
                "name": type_def.name,
                "deletedAt": deleted_at,
                "objectTrashIds": object_ids,
                "allowedTypesRefs": refs,
                "templates": templates,
                "queries": queries,
                "queryRefs": query_refs,
            }
            # The manifest goes first, so a failure partway (a locked file) never
            # strands the type and its templates in the trash with no way back.
            self.trash.write_json(folder / "manifest.json", manifest)
            try:
                self._trash_type_files(type_def, folder, trash_id, objects, templates, object_ids, refs)
                self._trash_type_queries(type_def.id, folder, queries, query_refs)
            except BaseException:
                try:
                    if not (folder / "type.json").exists():
                        shutil.rmtree(folder)  # nothing was moved yet: no entry
                    else:
                        self.trash.write_json(folder / "manifest.json", manifest)
                except OSError:
                    _log.exception("Could not record a partial type trash %s", trash_id)
                try:
                    self._resync_type_from_disk(type_def.id)
                except Exception:
                    _log.exception("Could not reload the type %s after a failed delete", type_def.id)
                raise
            self.trash.write_json(folder / "manifest.json", manifest)
            self.types = [t for t in self.types if t.id != type_def.id]
            self._hidden_fields.pop(type_def.id, None)
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

    def _resync_type_from_disk(self, type_id: str) -> None:
        """Make the in-memory type ``type_id`` match its file again (after a partial delete).

        Still on disk: reloaded from it. Gone (moved to the trash): dropped from memory,
        and inferred again only if objects of it remain, as a fresh open would.
        """
        if type_revision(self.root, type_id):
            self._loaded_revisions.pop(type_id, None)
            self.refresh_type(type_id)
            return
        self.types = [t for t in self.types if t.id != type_id]
        self._hidden_fields.pop(type_id, None)
        self._loaded_revisions.pop(type_id, None)
        self._merge_types(infer_types_from(self._raw.values()))
        self._types_changed(type_id)

    def _trash_type_files(
        self,
        type_def: TypeDefinition,
        folder: Path,
        trash_id: str,
        objects: list[str],
        templates: list[str],
        object_ids: list[str],
        refs: list[dict[str, str]],
    ) -> None:
        """`trash_type`'s moves, recording each object's trash id and each ref as it goes."""
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
        for rel in templates:
            self._move_out(rel, folder / "templates" / rel)
        for rel in objects:
            if (self.root / rel).is_file():
                object_ids.append(self.delete_object(rel, type_trash_id=trash_id).id)
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
        if _same_bytes(stored, self.root / ".object" / "types" / f"{type_id}.json"):
            return  # an earlier, interrupted restore already put this very file back
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

    def _restore_type_entry(
        self, trash_id: str, manifest: dict
    ) -> tuple[list[str], list[str], list[str]]:
        """Restore a trashed type's definition, templates, relation refs and queries.

        Returns (paths, typeIds, queryIds).
        """
        folder = self.trash.type_dir(trash_id)
        type_id = str(manifest.get("typeId", ""))
        type_ids = [type_id]
        type_file = self.root / ".object" / "types" / f"{type_id}.json"
        stored = folder / "type.json"
        if stored.is_file():
            if _same_bytes(stored, type_file):
                stored.unlink()  # put back by an earlier, interrupted restore: carry on
            elif type_file.exists():
                raise InvalidValue(f"An object type with the id {type_id} already exists.")
            else:
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
            self._top_up(restored)  # M32: listed as a load lists it (the Work switch)
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
                # Placed: a retry after a later step fails must not place it twice.
                src.unlink()
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
        query_ids = self._restore_type_queries(folder, type_id, manifest)
        self.trash.remove_type(trash_id)
        # Objects whose type was unknown while it was in the trash resolve again: only the
        # ones whose summary no longer matches what their type name resolves to are
        # rescanned, not the whole space (audit 2026-11-01 B10).
        known = {t.id for t in self.types}
        for rel, raw in list(self._raw.items()):
            summary = self._summaries.get(rel)
            if (
                summary is None
                or summary.type not in known
                or summary.type != self._type_id(raw.typeName)
            ):
                self.rescan_file(rel)
        return paths, type_ids, query_ids

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
        registration = meta.get("template")
        if isinstance(registration, dict):
            self._register_template(path, registration)
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
        templates, its remaining objects, its ``allowedTypesRefs`` and its saved
        queries (``queryIds``). Raises `KeyError` for an unknown id and
        `InvalidValue` when a saved type now has the trashed type's id or name
        (nothing is restored then).
        """
        with self._lock:
            meta = self.trash.object_meta(trash_id)
            if meta is not None:
                type_trash = meta.get("typeTrashId")
                manifest = self.trash.manifest(type_trash) if type_trash else None
                if manifest is not None:
                    self._check_type_restorable(type_trash, manifest)
                obj_path = self._restore_object_entry(trash_id, meta)
                if manifest is None:
                    return {"paths": [obj_path], "typeIds": []}
                paths, type_ids, query_ids = self._restore_type_entry(type_trash, manifest)
                return {"paths": [obj_path, *paths], "typeIds": type_ids, "queryIds": query_ids}
            manifest = self.trash.manifest(trash_id)
            if manifest is None:
                collection = self.trash.collection_manifest(trash_id)
                if collection is None:
                    if self.trash.has_automation(trash_id):
                        return self._restore_automation_entry(trash_id)
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
            paths, type_ids, query_ids = self._restore_type_entry(trash_id, manifest)
            return {"paths": [*objects, *paths], "typeIds": type_ids, "queryIds": query_ids}

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
                    if self.trash.has_automation(trash_id):
                        self._purge_automation_entry(trash_id)
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

    def apply_setup(self, setup: str) -> list[str]:
        """Fix pass H2: apply M8's "Pick a starting point" to this (new or empty) space.

        ``basic`` writes the Person, Meeting, Project and Book types (`basicsetup`) and loads
        them; M28: ``itops`` writes the IT ops types, their default templates and the seed Tags
        (`basicsetup.write_itops_types`, `write_itops_tags`), never replacing a file that is
        there (a type id the space has already is left out); ``blank`` writes nothing else.
        Either way ``space.json`` records the pick (``setup``), so the space is asked once.
        Returns the space-relative paths of the objects written (templates and Tags), for the
        caller to announce. Raises `ValueError` for another value.

        M32: the app no longer asks; a new or empty folder gets ``blank``, and the two starters
        are also added later, from the type gallery. So a starter leaves out a type whose
        **name** the space has already (under another id) as well, pointing its relations at
        that type; a space that was still new (`spaceconfig.needs_setup`) gets its built-in
        Task and DailyNote types written too (the pick is what makes the space); and a later
        ``basic`` leaves an ``itops`` marker as it is. The basic Project carries the ticket and
        work fields only while Work is on for the space (`work_on`); ``itops`` turns Work on
        (``workEnabled: true`` beside the marker) unless the user already set the switch.
        """
        from . import spaceconfig
        from .basicsetup import basic_types, retarget_relations
        from .typemodel import ON_DEMAND_TYPES

        if setup not in ("basic", "blank", "itops"):
            raise ValueError(f"Unknown space setup: {setup!r}")
        created: list[str] = []
        with self._lock:
            fresh = spaceconfig.needs_setup(self.root)
            if setup == "basic":
                taken = {t.id for t in self.types} | {u.id for u in self.unreadable_types}
                named = self._ids_by_name()
                # M32: Project gets the ticket and work fields only while Work is on here.
                starter = basic_types(work=self.work_on())
                retarget = {t.id: named[t.name.lower()] for t in starter
                            if t.id not in taken and t.name.lower() in named}  # fmt: skip
                types_dir = self.root / ".object" / "types"
                for t in starter:
                    if t.id in taken or t.id in retarget:
                        continue
                    if (types_dir / f"{t.id}.json").exists():
                        # A type file put there since the space was opened (a sync, by hand)
                        # and not loaded: never replaced, as `write_itops_types` leaves it.
                        continue
                    retarget_relations(t, retarget)
                    self._write_type_json(t, "")
                    self.types.append(t)
                    self._types_changed(t.id)
                self._sort_types()
            elif setup == "itops":
                created = self._apply_itops_setup()
            if fresh:
                for type_id in ON_DEMAND_TYPES:
                    builtin = self.type_by_id(type_id)
                    if builtin is not None and builtin.basic:
                        self._persist_type(builtin)
            config = spaceconfig.read(self.root)[0]
            marker = config.get("setup")
            # A set asked for again finds its marker (and, for the IT operations set, a Work
            # switch) already there: space.json is not written again.
            settled = marker == setup and (
                setup != "itops" or isinstance(config.get("workEnabled"), bool)
            )
            if not (setup == "basic" and marker == "itops") and not settled:
                # M32: the IT operations starter turns Work on for its space (unless the user
                # already set the switch), in the same write as the marker.
                spaceconfig.set_internal(
                    self.root, "setup", setup, work_default=True if setup == "itops" else None
                )
            self.work_on()  # the Task type follows a switch this turned on
        return created

    def _ids_by_name(self) -> dict[str, str]:
        """Lower-cased type name -> the id of the (first) type of that name."""
        out: dict[str, str] = {}
        for t in self.types:
            out.setdefault(t.name.lower(), t.id)
        return out

    def _apply_itops_setup(self) -> list[str]:
        """Write and load the IT ops types, templates and seed Tags; return the objects' paths."""
        from .basicsetup import write_itops_tags, write_itops_types

        taken = {t.id for t in self.types} | {u.id for u in self.unreadable_types}
        written = [
            *write_itops_types(self.root, skip=taken, named=self._ids_by_name()),
            *write_itops_tags(self.root),
        ]
        types_dir = self.root / ".object" / "types"
        created: list[str] = []
        loaded: list[str] = []
        for full in written:
            if full.parent == types_dir and full.suffix == ".json":
                t = self._stored_type(full.stem)
                if t is not None:
                    # M32: listed as a load lists it (a switch the user set off stays off).
                    self._top_up(t)
                    self.types = [x for x in self.types if x.id != t.id]
                    self.types.append(t)
                    loaded.append(t.id)
            else:
                created.append(full.relative_to(self.root).as_posix())
        self._sort_types()
        for type_id in loaded:
            self._types_changed(type_id)
        # The templates and Tags after the types, so each file is read as its type's.
        for rel in created:
            self.rescan_file(rel)
        return created

    def add_type(self, t: TypeDefinition) -> TypeDefinition:
        """M30: write the ready-made type ``t`` (its id, folder and properties as given) and
        load it. Raises `InvalidValue` when its id or its name is in use."""
        with self._lock:
            types_dir = self.root / ".object" / "types"
            taken = {x.id for x in self.types} | {u.id for u in self.unreadable_types}
            if types_dir.is_dir():
                taken |= {f.stem for f in types_dir.glob("*.json")}
            if t.id in taken:
                raise InvalidValue(f'An object type with the id "{t.id}" already exists.')
            if self._name_taken(t.name):
                raise InvalidValue(f'An object type named "{t.name}" already exists.')
            t = copy.deepcopy(t)
            self._write_type_json(t, "")
            self.types.append(t)
            self._sort_types()
            self._types_changed(t.id)
            return self.type_by_id(t.id) or t

    def create_type(
        self,
        name: str,
        plural_name: str,
        icon: Any = None,
        color: str | None = None,
        template: str | None = None,
    ) -> TypeDefinition:
        """Create and save a new object type.

        It gets the system properties (Tags among them) and a ``blocks``
        property named "Content". The id is `slug` of the name, made unique;
        the folder comes from the plural name. Neither changes afterwards. The
        folder is created with the type's first object. Raises `InvalidValue`
        for a missing name or plural, a name in use, or a bad icon or colour.

        Polish item 21: with ``template`` (a gallery key, `typetemplates`), the
        template's properties replace "Content", its name, plural, description,
        icon and colour fill whatever isn't given, and the key is stored as
        ``templateKey`` (the template it was made from). M28: an IT ops entry (a key in
        `basicsetup.ITOPS_TYPE_IDS`) also gets its default template (`_add_itops_template`), and
        no Sources relation while the space has no Source type to point it at.
        """
        tpl = None
        if template is not None:
            from .typetemplates import get_template

            tpl = get_template(template)
            if tpl is None:
                raise InvalidValue(f'Unknown object type template "{template}".')
            name = name or tpl.name
            plural_name = plural_name or tpl.pluralName
            icon = icon if icon is not None else tpl.icon
            color = color or tpl.color
        name = " ".join(str(name or "").split())
        plural = " ".join(str(plural_name or "").split())
        if not name or not plural:
            raise InvalidValue("An object type needs a name and a plural name.")
        color = color or "gray"
        if color not in THEME_COLORS:
            raise InvalidValue(f'Unknown color "{color}".')
        parsed = Icon("iconify", _DEFAULT_TYPE_ICON) if icon is None else Icon.parse(icon)
        if parsed is None:
            raise InvalidValue("Unknown icon.")
        with self._lock:
            if self._name_taken(name):
                raise InvalidValue(f'An object type named "{name}" already exists.')
            types_dir = self.root / ".object" / "types"
            taken = {t.id for t in self.types} | {u.id for u in self.unreadable_types}
            if types_dir.is_dir():
                taken |= {f.stem for f in types_dir.glob("*.json")}
            base = slug(name)
            type_id, n = base, 2
            while type_id in taken:
                type_id, n = f"{base}-{n}", n + 1
            if tpl is not None:
                from .typetemplates import build_template

                # The new type stands in for its own gallery key first, so a relation to that key
                # (Location's "Part of") points at the new type, not at any type (M28).
                itself = TypeDefinition(
                    id=type_id, name=name, pluralName=plural, folder=safe_filename(plural),
                    icon=parsed, color=color, extra={"templateKey": tpl.key},
                )
                custom = build_template(tpl.key, [itself, *self.types], work=self.work_on())
                if tpl.section == "itOperations":
                    # M28 fix pass: with no Source type to point at, Sources would be open to any
                    # type, giving whatever it links a "Distilled into" row: it is left out (M30
                    # adds it when it creates Source).
                    custom = [
                        p
                        for p in custom
                        if p.key != "sources" or p.options.get("allowedTypes")
                    ]
            else:
                custom = [
                    PropertyDefinition(
                        id=new_ulid(),
                        key="content",
                        name="Content",
                        type="blocks",
                        icon=Icon("iconify", PROPERTY_ICONS["blocks"]),
                    )
                ]
            t = TypeDefinition(
                id=type_id,
                name=name,
                pluralName=plural,
                folder=safe_filename(plural),
                icon=parsed,
                color=color,
                propertyDefinitions=[*system_property_defs(), *custom],
            )
            query = None
            if tpl is not None:
                t.description = tpl.description
                t.namePatterns = list(tpl.namePatterns)  # M29: the starter's name patterns
                t.extra["templateKey"] = tpl.key
                # Built and checked before the type is written, so a query that can't be
                # made never leaves a half-created type: the type is made without it.
                query = self._template_query(tpl.key, t)
            self._write_type_json(t, "")
            self.types.append(t)
            self._sort_types()
            self._types_changed(t.id)
            if tpl is not None:
                self._add_itops_template(t, tpl.key)
                t = self.type_by_id(t.id) or t
            if query is not None:
                # The template's saved query (polish item 21); a blank type gets none.
                try:
                    self.create_query(*query)
                except Exception:  # the type exists now: never fail its creation
                    _log.warning("Could not save the query %r of type %s", query[0], t.id, exc_info=True)
            return t

    def _add_itops_template(self, t: TypeDefinition, key: str) -> None:
        """M28: an IT ops type made from the gallery (``key`` in `ITOPS_TYPE_IDS`) gets its
        default template (named as the type, with the type's sections) as the starter writes
        it; the older gallery entries get none. A template that can't be made never fails the
        type's creation."""
        from .basicsetup import ITOPS_TEMPLATE_SECTIONS, ITOPS_TYPE_IDS, itops_template

        if key not in ITOPS_TYPE_IDS or key not in ITOPS_TEMPLATE_SECTIONS:
            return
        _name, body = itops_template(key)
        try:
            self.create_template(t.id, t.name, body=body, default=True)
        except (InvalidValue, TypeReadOnly, KeyError, OSError):
            _log.warning("Type %s is created without its default template", t.id, exc_info=True)

    def create_media_type(self, name: str) -> TypeDefinition:
        """Create and save the basic media type ``name`` (Image, PDF, File, ...): its media fields
        (``mimeType``, ``fileSize``, ``width``, ``height``, ``source`` ...) are read-only system
        definitions, as for a migrated v1 media type. Used by the importer (AC-2: imported images
        are Image objects). Raises `InvalidValue` for a name in use or that is no media type."""
        from .typemodel import basic_media_type

        with self._lock:
            if self._name_taken(name):
                raise InvalidValue(f'An object type named "{name}" already exists.')
            types_dir = self.root / ".object" / "types"
            taken = {t.id for t in self.types} | {u.id for u in self.unreadable_types}
            if types_dir.is_dir():
                taken |= {f.stem for f in types_dir.glob("*.json")}
            base = slug(name)
            type_id, n = base, 2
            while type_id in taken:
                type_id, n = f"{base}-{n}", n + 1
            try:
                t = basic_media_type(name, type_id)
            except KeyError:
                raise InvalidValue(f'"{name}" is not a media type.') from None
            self._write_type_json(t, "")
            self.types.append(t)
            self._sort_types()
            self._types_changed(t.id)
            return t

    def _template_query(
        self, key: str, t: TypeDefinition
    ) -> tuple[str, dict[str, Any], dict[str, Any]] | None:
        """Template ``key``'s (name, definition, view) over the new type ``t``, checked as
        `create_query` would; None (with a warning) when it can't be built, and None when a
        query of that name already targets ``t.id``."""
        from .typetemplates import TEMPLATE_QUERIES, template_query

        try:
            qname, definition, view = template_query(key, t)
            q = QueryDef.from_json({"name": qname, "definition": definition, "view": view}, "")
            self._check_query_definition(q.definition, {t.id})
        except (KeyError, InvalidValue) as exc:
            spec = TEMPLATE_QUERIES.get(key)
            _log.warning(
                "Type %s is created without its query %r: %s",
                t.id,
                spec.name if spec else key,
                exc,
            )
            return None
        # A query of that name already over the id (made by hand, or a type's query that
        # stayed live because its file could not be moved to the trash): don't make a second one.
        if any(
            q.name == qname and t.id in query_type_ids(q.definition) for q in self.list_queries()
        ):
            return None
        return qname, definition, view

    def sync_problem(
        self,
        t: TypeDefinition,
        p: PropertyDefinition,
        types: dict[str, TypeDefinition] | None = None,
    ) -> str | None:
        """Why ``p`` of ``t`` can't sync with its ``propertySyncing`` targets (the user-facing text).

        Syncing needs an entity property that is multi-select without a fixed
        set, on a non-basic type, whose ``allowedTypes`` is exactly the
        counterpart's (non-basic) type, and a counterpart of the same kind.
        M13: one side may be single (a relation pair's "Parent item") when its
        one counterpart is a list that syncs back to it.
        """
        lookup = types if types is not None else {x.id: x for x in self.types}
        allowed = p.options.get("allowedTypes") or []
        # Decision AC-1: the basic Task type syncs with itself (its sub-items and dependencies pairs).
        task_self = is_task_type(t) and allowed == [t.id]
        if t.basic and not task_self:
            return SYNC_NOT_ALLOWED
        ids = _sync_ids(p)
        if p.type != "entity" or p.options.get("hasFixedSet"):
            return SYNC_MULTI_ONLY
        if not _is_multi(p) and len(ids) != 1:
            return SYNC_MULTI_ONLY
        target = lookup.get(allowed[0]) if len(allowed) == 1 else None
        if target is None or (target.basic and not task_self):
            return SYNC_NOT_ALLOWED
        for pid in ids:
            q = next((x for x in target.propertyDefinitions if x.id == pid), None)
            if q is None or q.type != "entity" or q.options.get("hasFixedSet"):
                return SYNC_MULTI_ONLY
            # M13: one side may be single (a sub-item's "Parent item") when the other is a
            # list that syncs back to it; two single sides never sync.
            if not (_is_multi(p) and _is_multi(q)) and not (
                (_is_multi(p) or _is_multi(q)) and p.id in _sync_ids(q)
            ):
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
            hidden_before = self._hidden_fields.get(mem.id)
            old = self._top_up(stored) if stored is not None else copy.deepcopy(mem)
            new = copy.deepcopy(t)
            # M32: with Work off the type lists its ticket and work fields by `_top_up`'s
            # rule, and so does the window that sends this save. The ones its file holds but
            # doesn't list are no part of the edit: both sides get them back (in the file's
            # order) before the edit is planned, so the save neither removes them from the
            # file nor asks to delete a property.
            hidden = self._hidden_fields.get(old.id) or []
            if hidden:
                old.propertyDefinitions = _merge_hidden(old.propertyDefinitions, hidden)
                new.propertyDefinitions = _merge_hidden(new.propertyDefinitions, hidden)
            if is_task_type(old) and not self.work_on():
                # A window that listed the Task while Work was on still holds every ticket
                # and work field; with Work off the ones the type doesn't have (not saved,
                # no value) are left out of the save, as they are out of the type.
                have = {p.key for p in old.propertyDefinitions}
                new.propertyDefinitions = [
                    p
                    for p in new.propertyDefinitions
                    if not (p.key in WORK_FIELD_KEYS and p.id == p.key and p.key not in have)
                ]
            new.id, new.folder, new.basic = old.id, old.folder, old.basic
            new.formerNames = list(old.formerNames)
            new.readOnlyReason = None
            new.name = " ".join(str(new.name or "").split())
            new.pluralName = " ".join(str(new.pluralName or "").split())
            # M28: a counterpart must be well shaped, on a relation that doesn't sync both ways,
            # with a key no explicit target type holds, and a newly stored key no counterpart
            # naming this type uses (checked with `new` in place; only what changes from `old`).
            problem = check_counterparts(
                new, [new if x.id == new.id else x for x in self.types], old
            )
            if problem is not None:
                raise InvalidValue(problem)

            ops, deletes_property = self._plan_type_ops(old, new)

            members = self._type_members(old.id) if ops else []
            raws = {rel: self._raw[rel] for rel in members if rel in self._raw}

            def run(src: str, rel: str, fm: dict) -> str:
                parsed = src  # the source `fm` holds; re-parsed only after an op changed it
                for op in ops:
                    if src != parsed:
                        fm = take_parsed(src) if src else {}
                        parsed = src
                    src = op.fn(src, rel, fm)
                return src

            # The plan only asks each op whether it applies (values already parsed); the
            # rewrites themselves run per file outside the lock.
            to_write: list[str] = []
            affected = 0
            for rel, raw in raws.items():
                hits = [op for op in ops if op.applies(raw.fm, rel)]
                if any(op.confirm for op in hits):
                    affected += 1
                if hits:
                    to_write.append(rel)
            if (deletes_property or affected) and not confirm:
                raise ConfirmRequired(
                    affected,
                    f"This change removes values from {affected} "
                    f"object{'s' if affected != 1 else ''}.",
                )

            # The rewritten files are rescanned as they are written, so they must
            # already resolve to the edited type (a renamed type by its new name).
            self._check_type_free(new.id, current)
            self._types_saving.add(new.id)
            if not self.work_on():
                # M32: in memory (and in the answer) the saved type lists its ticket and work
                # fields by the rule again; the file gets them all (`_write_type_json`).
                self._hide_work_fields(new, from_file=True)
            self.types = [new if x.id == new.id else x for x in self.types]
            self._types_changed(new.id)
        # The files are rewritten outside the lock (each `_write` takes it for its own
        # file), so reads go on meanwhile; `_types_saving` keeps other type writes out.
        try:
            rewritten, skipped = self._apply_type_ops(to_write, run)
            with self._lock:
                revision = self._write_type_json(new, current)
                self._loaded_revisions[new.id] = revision  # else the next refresh reloads it
                self._sort_types()
        except BaseException:
            with self._lock:
                self.types = [mem if x.id == new.id else x for x in self.types]
                if hidden_before:
                    self._hidden_fields[mem.id] = hidden_before
                else:
                    self._hidden_fields.pop(mem.id, None)
                self._types_changed(new.id)
                for rel in members:
                    self.rescan_file(rel)
            raise
        finally:
            with self._lock:
                self._types_saving.discard(new.id)
        return SaveTypeResult(new, rewritten, skipped, revision)

    def _check_type_free(self, type_id: str, revision: str | None = None) -> None:
        """Raise `RevisionConflict` while a `save_type` of ``type_id`` is still rewriting files."""
        if type_id in self._types_saving:
            raise RevisionConflict(
                type_revision(self.root, type_id) if revision is None else revision
            )

    def _apply_type_ops(
        self, to_write: list[str], run: Callable[[str, str, dict], str]
    ) -> tuple[list[str], list[Skip]]:
        """Rewrite each file with ``run(src, rel, fm)`` (unstamped); (rewritten, skipped)."""
        rewritten: list[str] = []
        skipped: list[Skip] = []
        for rel in to_write:
            wrote: list[bool] = []

            def edit(of: ObjectFile, fm: dict, rel=rel, wrote=wrote) -> ObjectFile | None:
                src = of.frontmatter_src or ""
                out = run(src, rel, fm)
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
            raise InvalidValue("An object type needs a name and a plural name.")
        if new.color != old.color and new.color not in THEME_COLORS:
            raise InvalidValue(f'Unknown color "{new.color}".')
        ops: list[_TypeOp] = []

        renamed = new.name != old.name
        if renamed:
            if old.basic:
                raise InvalidValue(BASIC_LOCKED)
            if self._name_taken(new.name, except_id=old.id):
                raise InvalidValue(f'An object type named "{new.name}" already exists.')
            former = [f for f in old.formerNames if f.lower() != new.name.lower()]
            if old.name.lower() != new.name.lower() and old.name.lower() not in (
                f.lower() for f in former
            ):
                former.append(old.name)
            new.formerNames = former
            ops.append(self._type_line_op(old.name, new.name))

        ids = [p.id for p in new.propertyDefinitions]
        keys = [p.key for p in new.propertyDefinitions]
        if len(set(ids)) != len(ids):
            raise InvalidValue("Two properties have the same id.")
        if len(set(keys)) != len(keys):
            raise InvalidValue("Two properties have the same key.")
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
                    raise InvalidValue(f'"{p.name}" can\'t be removed.')
                continue  # an optional system property: display only, nothing to strip
            if old.basic:
                raise InvalidValue(BASIC_LOCKED)
            if p.type in COMPUTED_KINDS:
                continue  # M12: a formula or rollup has no values in any file
            deletes_property = True
            ops.append(self._delete_key_op(p.key))

        for p in new.propertyDefinitions:
            before = old_by_id.get(p.id)
            if before is None:
                self._check_new_property(old, new, p)
            else:
                if p.key != before.key:
                    raise InvalidValue("The key of a property never changes.")
                if p.type != before.type:
                    raise InvalidValue("Change the kind of a property with change-kind.")
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
        # M12: renamed properties are renamed in the type's formulas, then the formulas,
        # rollups and IDs are checked (no file is rewritten for any of them).
        rename_in_formulas(old, new)
        check_type(old, new, lookup)
        return ops, deletes_property

    def _check_new_property(
        self, old: TypeDefinition, new: TypeDefinition, p: PropertyDefinition
    ) -> None:
        if _is_system_def(p):
            return  # e.g. adding the optional `coverImage` or `type` property
        if old.basic:
            raise InvalidValue(BASIC_LOCKED)
        if not isinstance(p.key, str) or not p.key.strip():
            raise InvalidValue("A property needs a key.")
        if p.key in SYSTEM_KEYS:
            raise InvalidValue(f'"{p.key}" is a reserved key.')
        if p.type.startswith("entity_") or p.type in ("coverImage", "color"):
            raise InvalidValue(f'"{p.type}" is a system property kind.')

    @staticmethod
    def _check_label(p: PropertyDefinition, before: PropertyDefinition | None) -> None:
        seen: set[str] = set()
        for o in p.options.get("set") or []:
            if not isinstance(o, dict) or not isinstance(o.get("id"), str) or not o["id"]:
                raise InvalidValue("A label option needs an id.")
            text = o.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 100:
                raise InvalidValue("A label option's text is 1 to 100 characters.")
            if o["id"] in seen:
                raise InvalidValue("Two label options have the same id.")
            seen.add(o["id"])
        was_status = before is not None and before.options.get("isStatus")
        if p.options.get("isStatus") and not was_status:
            raise InvalidValue("Only the basic Task status is a status label.")

    def _check_fixed_set_ids(self, p: PropertyDefinition, before: PropertyDefinition | None) -> None:
        old_ids = set(before.options.get("fixedSet") or []) if before is not None else set()
        fresh = [i for i in p.options.get("fixedSet") or [] if i not in old_ids]
        if not fresh:
            return
        with self._lock:
            known = {s.id for s in self._summaries.values() if s.id}
        for object_id in fresh:
            if object_id not in known:
                raise InvalidValue(f'No object has the id "{object_id}".')

    @staticmethod
    def _type_line_op(old_name: str, new_name: str) -> _TypeOp:
        folded = old_name.lower()

        def applies(fm: dict, _rel: str) -> bool:
            value = fm.get("type")
            return isinstance(value, str) and value.strip().lower() == folded

        def fn(src: str, rel: str, fm: dict) -> str:
            if not src or not applies(fm, rel):
                return src
            return replace_in_value(
                src, "type", lambda v: new_name if v.strip().lower() == folded else v, parsed=fm
            )

        return _TypeOp(fn, confirm=False, applies=applies)

    @staticmethod
    def _delete_key_op(key: str) -> _TypeOp:
        def fn(src: str, _rel: str, _fm: dict) -> str:
            return delete_keys(src, [key]) if src else src

        return _TypeOp(fn, confirm=True, applies=lambda fm, _rel: key in fm)

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

            def removal(raw: Any) -> tuple[list, list, bool] | None:
                """(items, kept, squash) when the value loses something, else None."""
                if raw is None:
                    return None
                items = [i for i in (raw if isinstance(raw, list) else [raw]) if i is not None]
                kept = [i for i in items if _fold(i) not in deleted]
                squash = collapse and isinstance(raw, list) and len(kept) >= 2
                if not squash and len(kept) == len(items):
                    return None
                return items, kept, squash

            def remove(src: str, _rel: str, fm: dict) -> str:
                raw = fm.get(key) if src else None
                plan = removal(raw)
                if plan is None:
                    return src
                _items, kept, squash = plan
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

            ops.append(
                _TypeOp(remove, confirm=True, applies=lambda fm, _rel: removal(fm.get(key)) is not None)
            )

        if renamed:

            def renames(fm: dict, _rel: str) -> bool:
                raw = fm.get(key)
                items = raw if isinstance(raw, list) else [raw]
                return any(isinstance(i, str) and _fold(i) in renamed for i in items)

            def rename(src: str, rel: str, fm: dict) -> str:
                if not src or not renames(fm, rel):
                    return src
                return replace_in_value(src, key, lambda v: renamed.get(_fold(v), v), parsed=fm)

            ops.append(_TypeOp(rename, confirm=False, applies=renames))
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

        def removal(raw: Any, rel: str) -> tuple[list, list, bool] | None:
            """(items, kept, squash) when the value loses a link, else None."""
            if raw is None:
                return None
            items = [i for i in (raw if isinstance(raw, list) else [raw]) if i is not None]
            kept = [i for i in items if not breaks_rules(i, rel)]
            squash = collapse and isinstance(raw, list) and len(kept) >= 2
            if not squash and len(kept) == len(items):
                return None
            return items, kept, squash

        def fn(src: str, rel: str, fm: dict) -> str:
            raw = fm.get(key) if src else None
            plan = removal(raw, rel)
            if plan is None:
                return src
            _items, kept, squash = plan
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

        return _TypeOp(fn, confirm=True, applies=lambda fm, rel: removal(fm.get(key), rel) is not None)

    def delete_type(self, type_id: str, confirm: bool = False) -> TrashItem:
        """Move a type, its objects and templates to the trash.

        Raises `KeyError` for an unknown type, `InvalidValue` for a basic type
        and `ConfirmRequired` (``affected`` = its objects) without ``confirm``.
        Other types' relations stop allowing it, and its saved queries follow it
        (`_trash_type_queries`); both are restored with it.
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
                only, others = self._queries_of_type(type_id)
                detail = (
                    f"Delete the object type {t.name}? Its {n} object{'s' if n != 1 else ''} "
                    "and templates move to the Trash."
                )
                # Our strings: what happens to the saved queries that name the type.
                if only:
                    k = len(only)
                    detail += (
                        f" {k} saved {'query' if k == 1 else 'queries'} of only this type "
                        f"{'goes' if k == 1 else 'go'} with it."
                    )
                if others:
                    m = len(others)
                    detail += (
                        f" {m} other {'query' if m == 1 else 'queries'} "
                        f"{'stops' if m == 1 else 'stop'} using it until it is restored."
                    )
                raise ConfirmRequired(n, detail)
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
        self._check_type_free(t.id, base_revision)
        revision = self._write_type_json(t, base_revision)
        self._loaded_revisions[t.id] = revision
        # In memory the type keeps the fields a load tops up (the Task and work fields), as
        # `refresh_type` does; the file keeps only what it stored.
        self._top_up(t)
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
        """Change a property's kind: by adding a new property.

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

            def run(fm_src: str, _rel: str, fm: dict) -> str:
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
        `InvalidValue` with the user-facing texts when syncing isn't allowed.
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
            # Validate the source with a placeholder link (same texts).
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

    def create_relation_pair(
        self, type_id: str, kind: str, base_revision: str = ""
    ) -> RelationPairResult:
        """M13: add (or reuse) a two-way relation pair of ``type_id`` with itself.

        ``kind`` is ``subItems`` ("Parent item", single, and "Sub-items") or
        ``dependencies`` ("Blocked by" and "Blocking"). A property with one of
        those names (whitespace and case folded) is reused when it is an entity
        property targeting exactly this type, of the right cardinality, without
        a fixed set, and synced with nothing but its partner; the missing ones
        are added and the two are linked by property syncing. Nothing but the
        type JSON is written (no object is rewritten, existing values are not
        backfilled), and nothing at all when the pair is already there.

        Raises `KeyError`, `TypeReadOnly`, `RevisionConflict` and `InvalidValue`
        (unknown kind, a basic type other than Task, or a same-named property that doesn't match).
        """
        spec = RELATION_PAIRS.get(kind)
        if spec is None:
            raise InvalidValue(f'Unknown relation pair "{kind}".')
        with self._lock:
            t, current = self._editable_type(type_id)
            if current != (base_revision or ""):
                raise RevisionConflict(current)
            # Decision AC-1: of the basic types, only Task may take sub-items and dependencies.
            if t.basic and not is_task_type(t):
                raise InvalidValue(SYNC_NOT_ALLOWED)

            def named(name: str) -> PropertyDefinition | None:
                want = _fold(" ".join(name.split()))
                return next(
                    (q for q in t.propertyDefinitions if _fold(" ".join(str(q.name).split())) == want),
                    None,
                )

            found = [named(name) for name, _ in spec]
            for (name, is_list), q, partner in zip(spec, found, reversed(found)):
                if q is None:
                    continue
                matches = (
                    q.type == "entity"
                    and (q.options.get("allowedTypes") or []) == [t.id]
                    and _is_multi(q) == is_list
                    and not q.options.get("hasFixedSet")
                    and all(partner is not None and i == partner.id for i in _sync_ids(q))
                )
                if not matches:
                    raise InvalidValue(
                        f'A property named "{q.name}" already exists and isn\'t a matching '
                        f"relation to {t.name}. Rename it to turn this on."
                    )
            first, second = found
            if (
                first is not None
                and second is not None
                and _sync_ids(first) == [second.id]
                and _sync_ids(second) == [first.id]
            ):
                return RelationPairResult(t, first.id, second.id, False, current, False)

            created = False
            taken = {x.key for x in t.propertyDefinitions}
            made: list[PropertyDefinition] = []
            for (name, is_list), q in zip(spec, found):
                if q is None:
                    key = unique_key(name, taken)
                    taken.add(key)
                    q = PropertyDefinition.from_json(
                        {
                            "id": new_ulid(),
                            "key": key,
                            "name": name,
                            "type": "entity",
                            "options": {
                                "isArray": is_list,
                                "allowedTypes": [t.id],
                                "hasFixedSet": False,
                                "fixedSet": [],
                            },
                        }
                    )
                    t.propertyDefinitions.append(q)
                    created = True
                made.append(q)
            first, second = made
            first.options["propertySyncing"] = {"propertyIds": [second.id]}
            second.options["propertySyncing"] = {"propertyIds": [first.id]}
            revision = self._commit_type(t, current)
            return RelationPairResult(t, first.id, second.id, created, revision, True)

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
        # The file may have been replaced on disk: check its path in full again.
        self._checked_rels.discard(path)
        rel = self._rel(path)
        full = self.root / rel
        with self._lock:
            raw: RawObject | None = None
            if full.is_file():
                try:
                    raw = read_raw(self.root, rel)
                except OSError:
                    raw = None
            self._rescan_with(rel, raw)

    def _rescan_with(self, rel: str, raw: RawObject | None) -> None:
        """`rescan_file` given what the file holds (None: it is gone; see `_raw_after_write`)."""
        with self._lock:
            before = self._summaries.get(rel)
            if raw is None:
                self._raw.pop(rel, None)
                self._summaries.pop(rel, None)
                self._checked_rels.discard(rel)
                self._note_work_values(rel, None)
            else:
                self._raw[rel] = raw
                # A template never makes a type (`infer_types_from` skips it), so one whose
                # type stays unknown would re-infer every file on each rescan for nothing.
                template = not raw.readOnly and raw.fm.get("template") not in (None, "")
                if not template and self._type_id(raw.typeName) not in {
                    t.id for t in self.types
                }:
                    self._merge_types(infer_types_from(self._raw.values()))
                self._note_work_values(rel, raw)
                self._summaries[rel] = self._summarize(raw)
            after = self._summaries.get(rel)
            if _names_key(before) != _names_key(after):
                self._names_changed(before, after)
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
        """Tell the listeners that a type definition changed (``type_id`` when known)."""
        self._forget_type_ids()
        self._fire(SpaceChange("types", None, type_id))

    def _names_changed(
        self, before: ObjectSummary | None = None, after: ObjectSummary | None = None
    ) -> None:
        """The set of link names changed: move the resolver along, or drop it.

        ``before`` and ``after`` are the one object's summaries around the change: the
        resolver is replaced by `Resolver.updated` and the link index learns which link
        names it touched (`_names_since`). Without them the resolver is rebuilt on its
        next use and every link re-resolved.
        """
        self._names_rev += 1
        if before is None and after is None:
            self._resolver = None
            self._name_changes.append((self._names_rev, None))
            return
        names = frozenset().union(*(link_names(s) for s in (before, after) if s is not None))
        r = self._resolver
        if r is not None:
            self._resolver = r.updated(before, after)
        self._name_changes.append((self._names_rev, names))

    def _names_since(self, rev: int) -> frozenset[str] | None:
        """The folded link names changed since `_names_rev` was ``rev``; None when unknown."""
        out: set[str] = set()
        seen = rev
        for r, names in self._name_changes:
            if r <= rev:
                continue
            if r != seen + 1 or names is None:
                return None
            seen = r
            out |= names
        return frozenset(out) if seen == self._names_rev else None

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

    # -- counterparts (M28) ---------------------------------------------------

    def counterparts(self, path: str) -> list[CounterpartRow]:
        """The computed other sides of ``path`` (`LinkIndex.counterparts`); never stored."""
        return self._links.counterparts(self._rel(path))

    def counterpart_defs(self, type_id: str) -> list[PropertyDefinition]:
        """The virtual definitions of ``type_id``'s counterpart rows (`counterparts.counterpart_defs`)."""
        return _counterpart_defs(type_id, self.types)

    def type_api(self, t: TypeDefinition, revision: str) -> dict[str, Any]:
        """A type as the window gets it: its API JSON (`TypeDefinition.to_api`) with its computed
        other sides (``counterparts``, API only, never saved)."""
        return {**t.to_api(revision), "counterparts": [d.to_json() for d in self.counterpart_defs(t.id)]}

    def types_api(self) -> list[dict[str, Any]]:
        """The type list the window gets (``GET /api/space``), each as `type_api`."""
        return [self.type_api(t, rev) for t, rev in self.types_with_revisions()]

    def edit_counterpart(
        self,
        path: str,
        key: str,
        source_type_id: str,
        add: Iterable[str] = (),
        remove: Iterable[str] = (),
    ) -> CounterpartEdit:
        """Add or remove other objects on ``path``'s counterpart row ``key`` from ``source_type_id``.

        The target is never written: each other object gets one ordinary `update_properties`
        of the stored property (only its lines and ``lastUpdated`` change). An added object
        already linking here, or a removed one that doesn't, writes nothing; a single-valued
        source gets exactly the new link (replaced, not appended). Every other object is checked
        before anything is written: a missing one goes to ``skipped`` (`GONE`); one of another
        type (or a template) raises `InvalidValue` (`WRONG_TYPE`). A key the target's type has
        no row for from that source raises `InvalidValue` (`NO_COUNTERPART`); a missing target
        raises `KeyError`. A conflict is retried once; write failures go to ``skipped``.
        """
        rel = self._rel(path)
        adds = [self._rel(p) for p in add]
        removes = [self._rel(p) for p in remove]
        with self._lock:
            summary = self._summaries.get(rel)
        if summary is None and (self.root / rel).is_file():
            self.rescan_file(rel)
            with self._lock:
                summary = self._summaries.get(rel)
        if summary is None:
            raise KeyError(rel)
        source = self.type_by_id(source_type_id)
        source_name = source.name if source is not None else source_type_id
        spec = next(
            (
                s
                for s in specs_for(summary.type, self.types)
                if s.key == key and s.source_type_id == source_type_id
            ),
            None,
        )
        pdef = source.prop(spec.source_key) if spec is not None and source is not None else None
        if summary.template is not None or pdef is None:
            raise InvalidValue(NO_COUNTERPART.format(key=key, type=source_name))

        both = set(adds) & set(removes)  # asked to add and remove: nothing to do
        wanted = {p: True for p in adds if p not in both}
        wanted.update({p: False for p in removes if p not in both})
        wanted.pop(rel, None)  # a self link never counts
        skipped: list[Skip] = []
        todo: list[tuple[str, bool]] = []
        for other in sorted(wanted):
            with self._lock:
                s = self._summaries.get(other)
            if s is None and (self.root / other).is_file():
                self.rescan_file(other)
                with self._lock:
                    s = self._summaries.get(other)
            if s is None:
                skipped.append(Skip(other, GONE))
                continue
            if s.type != source_type_id or s.template is not None:
                raise InvalidValue(WRONG_TYPE.format(title=s.title, type=source_name))
            todo.append((other, wanted[other]))

        written: list[tuple[str, str]] = []
        for other, adding in todo:
            done = self._edit_counterpart_one(rel, other, pdef, adding)
            if isinstance(done, Skip):
                skipped.append(done)
            elif done is not None:
                written.append((other, done))
        return CounterpartEdit(written=written, skipped=skipped, counterparts=self.counterparts(rel))

    def _edit_counterpart_one(
        self, target: str, other: str, pdef: PropertyDefinition, adding: bool
    ) -> str | Skip | None:
        """Link (or unlink) ``target`` in ``other``'s ``pdef`` value: the new version, a `Skip`,
        or None when nothing needed writing."""
        for attempt in range(2):
            try:
                _of, fm, version = self.read(other)
                refs = [
                    {"target": r["target"], "path": None}
                    for r in decode_value(pdef, fm.get(pdef.key))
                ]
                hits = [self.resolve(r["target"], other) == target for r in refs]
                if adding:
                    if any(hits):
                        return None
                    new = {"target": self._link_text(target, other), "path": None}
                    refs = [*refs, new] if _is_multi(pdef) else [new]
                else:
                    if not any(hits):
                        return None
                    refs = [r for r, hit in zip(refs, hits, strict=True) if not hit]
                result = self.update_properties(other, {pdef.key: refs}, version)
                return result.version if result.version != version else None
            except Conflict:
                if attempt:
                    return Skip(other, "The file changed on disk while it was being updated")
            except ReadOnly as exc:
                return Skip(other, exc.reason)
            except (KeyError, FileNotFoundError):
                return Skip(other, GONE)
            except InvalidValue as exc:
                return Skip(other, str(exc))
            except PermissionError as exc:  # e.g. locked by another program
                return Skip(other, f"The file could not be written: {exc.strerror or exc}")
            except FrontmatterError:
                return Skip(other, "The file's frontmatter could not be rewritten")
        raise AssertionError("unreachable")

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
