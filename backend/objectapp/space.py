"""A space: a folder of object files, scanned into summaries, types and a link index.

Reading, listing, resolving and opening objects never write an object file.
The only write `Space` makes on its own is the one-time creation of
``.object/types/`` (see `typedefs.load_types`).
"""

from __future__ import annotations

import hashlib
import re
import threading
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from .frontmatter import set_keys
from .ids import new_ulid
from .objfile import ObjectFile, join_object
from .textfile import atomic_write, encode_like
from .typedefs import (
    RawObject,
    TypeDef,
    infer_types_from,
    is_ignored,
    iter_object_paths,
    load_types,
    read_raw,
    slug,
)

__all__ = ["Conflict", "ObjectSummary", "ReadOnly", "Space", "now_stamp", "version_of"]

_HEADING_RE = re.compile(r"^#[ \t]+(.+?)[ \t#]*$", re.MULTILINE)


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
    """The object's type id (see `TypeDef.id`)."""
    title: str
    icon: str | None
    createdAt: str | None
    lastUpdated: str | None
    tags: list[str] = field(default_factory=list)
    readOnly: bool = False
    readOnlyReason: str | None = None
    """Why the object opens read-only (None when it can be saved)."""


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


def _title_of(raw: RawObject) -> str:
    title = _str_or_none(raw.fm.get("title"))
    if title:
        return title
    if not raw.readOnly:
        m = _HEADING_RE.search(raw.of.body)
        if m:
            return m.group(1).strip()
    return PurePosixPath(raw.path).stem


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
        for rel in iter_object_paths(self.root):
            try:
                self._raw[rel] = read_raw(self.root, rel)
            except OSError:
                continue
        inferred = infer_types_from(self._raw.values())
        loaded = load_types(self.root, inferred=inferred)
        self.types: list[TypeDef] = list(loaded)
        self._merge_types(inferred)
        for rel, raw in self._raw.items():
            self._summaries[rel] = self._summarize(raw)

    # -- types --------------------------------------------------------------

    def _merge_types(self, inferred: list[TypeDef]) -> None:
        """Add (in memory only) inferred types that the stored definitions lack."""
        known = {t.name.lower() for t in self.types} | {t.id for t in self.types}
        for t in inferred:
            if t.name.lower() not in known and t.id not in known:
                self.types.append(t)
                known |= {t.name.lower(), t.id}

    def _type_id(self, type_name: str) -> str:
        lowered = type_name.lower()
        for t in self.types:
            if t.name.lower() == lowered or t.id == lowered:
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

    def save_body(self, path: str, body: str, base_version: str) -> str:
        """Replace an object's body, touching nothing else; return the new version.

        Raises `Conflict` when the file on disk no longer matches ``base_version``
        and `ReadOnly` when its frontmatter is malformed. An unchanged body
        writes nothing. Otherwise ``lastUpdated`` is set (in place, or appended)
        and an ``id`` is inserted first if absent; line endings, BOM and the
        trailing newline are kept.
        """
        rel = self._rel(path)
        full = self.root / rel
        body = body.replace("\r\n", "\n")
        with self._lock:
            if not full.is_file():
                raise KeyError(rel)
            raw = read_raw(self.root, rel)
            current = version_of(raw.data)
            if current != base_version:
                raise Conflict(current)
            if raw.readOnly:
                raise ReadOnly(raw.readOnlyReason or "Object is read-only")
            if raw.of.body == body:
                return current

            insert_first = None if _str_or_none(raw.fm.get("id")) else {"id": new_ulid()}
            fm_src = set_keys(
                raw.of.frontmatter_src or "",
                {"lastUpdated": now_stamp()},
                insert_first=insert_first,
            )
            of = replace(raw.of, frontmatter_src=fm_src, body=body)
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

        Order: exact title in the linking object's folder; exact title anywhere
        (oldest ``createdAt``, then path); alias; case-insensitive title or file stem.
        Within each step the linking object's folder wins, then the oldest
        ``createdAt``, then the path.
        """
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

        for text in _link_candidates(link):
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
