"""A space: a folder of object files, scanned into summaries, types and a link index.

Reading, listing, resolving and opening objects never write an object file.
The only writes `Space` makes on its own are inside ``.capacities/`` (see
`typemodel.load_types`): the first-open type JSON, the one-time v1 type
migration, and the built-in Page and Tag types when missing.

Every write to an object file goes through `Space._write` (re-read, version and
read-only checks, edit, optional stamp, `encode_like`, ``own_writes``,
`atomic_write` with a re-check, `rescan_file`). Rewrites of *other* files on the
user's behalf use `Space._rewrite_other`, which retries once on a conflict and
otherwise reports a `Skip` instead of overwriting.

Objects are created with `Space.create_object` and deleted to the app's own
trash (`trash.Trash`, in ``.capacities/trash/``) with `Space.delete_object`;
types go there with `Space.trash_type`. Opening the space purges trash entries
older than 30 days.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from .frontmatter import FlowList, delete_keys, set_keys
from .ids import new_ulid
from .objfile import ObjectFile, join_object
from .propvalues import InvalidValue, decode_value, encode_updates
from .textfile import atomic_write, encode_like
from .trash import Trash, TrashItem
from .typedefs import (
    RawObject,
    infer_types_from,
    is_ignored,
    iter_object_paths,
    read_raw,
    slug,
)
from .typemodel import (
    PropertyDefinition,
    RevisionConflict,
    TypeDefinition,
    TypeReadOnly,
    UnreadableType,
    load_types,
    system_property_defs,
    type_revision,
    write_type_json,
)

__all__ = [
    "Conflict",
    "ObjectSummary",
    "ReadOnly",
    "Skip",
    "Space",
    "TrashItem",
    "UpdateResult",
    "now_stamp",
    "safe_filename",
    "unique_path",
    "version_of",
]

Edit = Callable[[ObjectFile, dict], "ObjectFile | None"]
"""An edit for `Space._write`: (current file, its frontmatter) -> new file, or None for no change."""

# Keys that `update_properties` refuses: they change through their own routes
# (rename, change type) or are managed by the app.
_LOCKED_KEYS = frozenset({"title", "type", "id", "template"})

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


def safe_filename(title: str) -> str:
    """The file stem for a title, as Capacities' export names files.

    The title up to its first character that is illegal in a Windows file name,
    with whitespace collapsed and trailing dots and spaces stripped, capped at
    120 characters. If that is empty, the illegal characters are dropped
    instead; if still empty, ``Untitled``. (A Windows device name such as
    ``CON`` gets a trailing ``_``.)
    """

    def clean(text: str) -> str:
        text = " ".join(text.split()).rstrip(". ")
        return text[:_MAX_FILENAME].rstrip(". ")

    title = str(title or "")
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


def now_stamp() -> str:
    """The current UTC time as ``YYYY-MM-DDTHH:MM:SS.sssZ``."""
    now = datetime.now(UTC)
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


def _link_candidates(link: str) -> list[str]:
    """The link text as given, then without ``[[ ]]``, ``|alias`` and ``#heading`` parts."""
    text = link.strip()
    if text.startswith("[[") and text.endswith("]]"):
        text = text[2:-2].strip()
    out = [text]
    for sep in ("|", "#"):
        for c in list(out):
            if sep in c:
                head = c.split(sep, 1)[0].strip()
                if head not in out:
                    out.append(head)
    return [c for c in out if c]


class Space:
    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        self.name = self.root.name
        self._lock = threading.RLock()
        self._raw: dict[str, RawObject] = {}
        self._summaries: dict[str, ObjectSummary] = {}
        self.own_writes: dict[str, str] = {}
        """Path -> version of the last write `save_body` made (for self-write suppression)."""
        self.own_deletes: dict[str, str] = {}
        """Path -> version of a file the app moved away (to the trash); the watcher stays silent."""
        self.trash = Trash(self.root)
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
        for rel, raw in self._raw.items():
            self._summaries[rel] = self._summarize(raw)
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
        for t in inferred:
            if t.name.lower() not in known and t.id not in known:
                self.types.append(t)
                known |= {t.name.lower(), t.id}

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
        )

    def list(self, type_id: str | None = None) -> list[ObjectSummary]:
        with self._lock:
            items = sorted(self._summaries.values(), key=lambda s: s.path)
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
        self, rel: str, base_version: str | None, edit: Edit, stamp: bool = True
    ) -> str:
        """Apply `edit` to an object file safely; return its (new) version.

        Re-reads the file, raises `Conflict` when it isn't at ``base_version``
        (``None`` means "whatever is current") and `ReadOnly` when it can't be
        saved. An edit that changes nothing writes nothing. With `stamp`,
        ``lastUpdated`` is set and an ``id`` inserted first when missing. A file
        without frontmatter gets a new fence block. Line endings, BOM and every
        untouched line's bytes are kept; the replace re-checks the version.
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
                    {"lastUpdated": now_stamp()},
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
        """Link text for ``path`` from ``from_rel``: its title, or the path form for duplicates."""
        with self._lock:
            summary = self._summaries.get(path)
        if summary is not None and self.resolve(summary.title, from_rel) == path:
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

        def apply(src: str, fm: dict) -> str:
            before.update(fm)
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
                u, r = encode_updates(pdef, value, fm, link_for=self._link_for(rel))
                sets.update(u)
                removals.extend(r)
            removals.extend(k for k in remove if k in fm)
            out = set_keys(src, sets) if sets else src
            return delete_keys(out, [k for k in removals if k not in sets])

        version = self._write(rel, base_version, self._fm_edit(apply))
        _of, fm, _v = self.read(rel)
        synced, skipped = self._sync_relations(rel, t, before, fm)
        return UpdateResult(
            version=version,
            frontmatter=fm,
            links=self.links_of(rel, fm),
            synced=synced,
            skipped=skipped,
        )

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

    # -- create ---------------------------------------------------------------

    def _persist_type(self, t: TypeDefinition) -> bool:
        """Write an inferred-only type's JSON (the first time it is used); True if written."""
        if t.readOnlyReason or type_revision(self.root, t.id):
            return False
        try:
            write_type_json(self.root, t, "")
        except (RevisionConflict, TypeReadOnly):
            return False
        return True

    def create_object(
        self, type_id: str, title: str = "", template_id: str | None = None
    ) -> tuple[str, str]:
        """Create an object of the type in its folder; return (path, version).

        The frontmatter is ``id``, ``type: '<Name>'``, ``title`` (only when
        non-empty), ``createdAt`` and ``lastUpdated``; the body is ``# <title>``
        or empty. The file name is `safe_filename` of the title, made unique.
        Raises `KeyError` for an unknown type. (``template_id`` is used from Task 9.)
        """
        del template_id  # templates arrive in Task 9
        t = self.type_by_id(type_id)
        if t is None:
            raise KeyError(type_id)
        title = " ".join(str(title or "").split("\n")).strip()
        stamp = now_stamp()
        fm_src = set_keys(
            f"type: {_yaml_single_quoted(t.name)}\n",
            {**({"title": title} if title else {}), "createdAt": stamp, "lastUpdated": stamp},
            insert_first={"id": new_ulid()},
        )
        body = f"# {title}\n" if title else ""
        data = join_object(ObjectFile(fm_src, body, True, None)).encode("utf-8")
        version = version_of(data)
        stem = safe_filename(title) if title else "Untitled"
        with self._lock:
            self._persist_type(t)
            folder = t.folder.strip("/")
            (self.root / folder).mkdir(parents=True, exist_ok=True)
            for _attempt in range(100):
                rel = unique_path(self.root, folder, stem)
                if self._place(rel, data):
                    return rel, version
        raise OSError(f"Could not find a free file name for {stem!r}")

    def _place(self, rel: str, data: bytes) -> bool:
        """Write a new file at ``rel`` unless something is there by then; True if written."""
        full = self.root / self._rel(rel)

        def absent() -> None:
            if full.exists():
                raise FileExistsError(rel)

        self.own_writes[rel] = version_of(data)
        try:
            full.parent.mkdir(parents=True, exist_ok=True)
            atomic_write(full, data, check=absent)
        except FileExistsError:
            self.own_writes.pop(rel, None)
            return False
        except BaseException:
            self.own_writes.pop(rel, None)
            raise
        self.rescan_file(rel)
        return True

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
            os.replace(full, dest)
        except BaseException:
            self.own_deletes.pop(rel, None)
            raise
        self.own_writes.pop(rel, None)
        self.rescan_file(rel)

    def delete_object(
        self, path: str, base_version: str | None = None, type_trash_id: str | None = None
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
            )
            meta = {k: v for k, v in item.to_api().items() if k != "objectCount"}
            if type_trash_id is None:
                meta.pop("typeTrashId")
            meta_file = self.trash.object_meta_file(item.id)
            self.trash.write_json(meta_file, meta)
            try:
                self._move_out(rel, self.trash.object_file(item.id))
            except BaseException:
                meta_file.unlink(missing_ok=True)
                raise
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

    def _save_type(self, t: TypeDefinition) -> bool:
        try:
            write_type_json(self.root, t, type_revision(self.root, t.id))
        except (RevisionConflict, TypeReadOnly):
            return False
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
            type_file = self.root / ".capacities" / "types" / f"{type_def.id}.json"
            if type_file.is_file():
                os.replace(type_file, folder / "type.json")
            else:
                (folder / "type.json").write_bytes(
                    (json.dumps(type_def.to_json(), indent=2, ensure_ascii=False) + "\n").encode()
                )
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
            return TrashItem(
                id=trash_id,
                kind="type",
                originalPath=f".capacities/types/{type_def.id}.json",
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

    def _restore_type_entry(self, trash_id: str, manifest: dict) -> tuple[list[str], list[str]]:
        """Restore a trashed type's definition, templates and relation refs; (paths, typeIds)."""
        folder = self.trash.type_dir(trash_id)
        type_id = str(manifest.get("typeId", ""))
        type_ids = [type_id]
        type_file = self.root / ".capacities" / "types" / f"{type_id}.json"
        stored = folder / "type.json"
        if stored.is_file() and not type_file.exists():
            type_file.parent.mkdir(parents=True, exist_ok=True)
            os.replace(stored, type_file)
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
        data = self.trash.object_file(trash_id).read_bytes()
        path = self._restore_file(str(meta.get("originalPath", "")), data)
        self.trash.remove_object(trash_id)
        return path

    def restore(self, trash_id: str) -> dict[str, list[str]]:
        """Restore a trash entry; return ``{paths, typeIds}`` of what came back.

        An object returns to its original path (`` (2)`` on a collision); if its
        type is in the trash, the type definition and templates come back with
        it (not the type's other objects). A type entry restores the type, its
        templates, its remaining objects and its ``allowedTypesRefs``.
        Raises `KeyError` for an unknown id.
        """
        with self._lock:
            meta = self.trash.object_meta(trash_id)
            if meta is not None:
                paths: list[str] = []
                type_ids: list[str] = []
                type_trash = meta.get("typeTrashId")
                manifest = self.trash.manifest(type_trash) if type_trash else None
                obj_path = self._restore_object_entry(trash_id, meta)
                if manifest is not None:
                    paths, type_ids = self._restore_type_entry(type_trash, manifest)
                return {"paths": [obj_path, *paths], "typeIds": type_ids}
            manifest = self.trash.manifest(trash_id)
            if manifest is None:
                raise KeyError(trash_id)
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
                self.trash.remove_object(trash_id)
                return 1
            manifest = self.trash.manifest(trash_id)
            if manifest is None:
                raise KeyError(trash_id)
            count = 1
            for oid in manifest.get("objectTrashIds") or []:
                if self.trash.object_meta(oid) is not None:
                    self.trash.remove_object(oid)
                    count += 1
            self.trash.remove_type(trash_id)
            return count

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

    def cached_version(self, path: str) -> str | None:
        """The version of the object as last scanned, or None if the space doesn't know it."""
        rel = self._rel(path)
        with self._lock:
            raw = self._raw.get(rel)
            return version_of(raw.data) if raw is not None else None

    def rescan_file(self, path: str) -> None:
        """Refresh one object's summary from disk (or drop it if the file is gone)."""
        rel = self._rel(path)
        full = self.root / rel
        with self._lock:
            if not full.is_file():
                self._raw.pop(rel, None)
                self._summaries.pop(rel, None)
                return
            try:
                raw = read_raw(self.root, rel)
            except OSError:
                self._raw.pop(rel, None)
                self._summaries.pop(rel, None)
                return
            self._raw[rel] = raw
            if self._type_id(raw.typeName) not in {t.id for t in self.types}:
                self._merge_types(infer_types_from(self._raw.values()))
            self._summaries[rel] = self._summarize(raw)

    # -- links --------------------------------------------------------------

    def resolve(self, link: str, from_path: str | None) -> str | None:
        """Resolve ``[[link]]`` text to an object path, deterministically.

        Order: an exact space path without ``.md`` (``Pages/Untitled``, the form
        written for duplicate titles); exact title in the linking object's
        folder; exact title anywhere (oldest ``createdAt``, then path); alias;
        case-insensitive title or file stem. Within each step the linking
        object's folder wins, then the oldest ``createdAt``, then the path.
        """
        candidates = _link_candidates(link)
        with self._lock:
            for text in candidates:
                if "/" in text and f"{text}.md" in self._summaries:
                    return f"{text}.md"
        from_folder = None
        if from_path:
            from_folder = PurePosixPath(str(from_path).replace("\\", "/")).parent.as_posix()
        with self._lock:
            summaries = list(self._summaries.values())
            aliases = {
                rel: [a.lower() for a in _str_list(raw.fm.get("aliases"))]
                for rel, raw in self._raw.items()
            }

        def folder(s: ObjectSummary) -> str:
            return PurePosixPath(s.path).parent.as_posix()

        def best(matches: list[ObjectSummary]) -> str | None:
            if not matches:
                return None
            matches.sort(
                key=lambda s: (
                    folder(s) != from_folder,
                    s.createdAt is None,
                    s.createdAt or "",
                    s.path,
                )
            )
            return matches[0].path

        for text in candidates:
            low = text.lower()
            steps = (
                lambda s: s.title == text,
                lambda s: low in aliases.get(s.path, ()),
                lambda s: s.title.lower() == low or PurePosixPath(s.path).stem.lower() == low,
            )
            for match in steps:
                found = best([s for s in summaries if match(s)])
                if found:
                    return found
        return None
