"""The app's own trash, in ``.object/trash/`` (not the OS recycle bin).

Layout:

- an object: ``<ulid>.md`` (the file's bytes, unchanged) plus ``<ulid>.json``
  ``{id, kind: 'object', originalPath, title, type, deletedAt, typeTrashId?}``;
- a type: ``types/<ulid>/`` with ``type.json``, ``templates/<original path>``
  for each of its template files, and ``manifest.json`` ``{id, kind: 'type',
  typeId, name, deletedAt, objectTrashIds, allowedTypesRefs, templates}``. Its
  objects are ordinary object entries carrying ``typeTrashId``;
- a collection: ``collections/<ulid>/`` with ``collection.json``, ``before/<n>.md``
  (a member's bytes before its ``collections:`` item was removed) and
  ``manifest.json`` ``{id, kind: 'collection', collectionId, name, deletedAt,
  objectTrashIds, removedFrom, skipped}``. Its sole members are ordinary object
  entries carrying ``collectionTrashId``;
- a query: ``queries/<ulid>.json``, the query file's bytes unchanged, plus
  ``queries/<ulid>.meta.json`` ``{id, deletedAt}`` recording the original id (the
  file's stem, which need not match an ``id`` inside it). Entries without the
  sidecar fall back to the JSON's ``id`` and the ulid's time.

This module only knows the folder layout and the metadata; `Space` moves the
files (so it can keep the watcher quiet and its index current).
"""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .textfile import atomic_write
from .typedefs import read_raw

__all__ = ["RETENTION", "Trash", "TrashItem", "parse_stamp", "ulid_time"]

RETENTION = timedelta(days=30)
"""Entries older than this are purged when the space opens."""

# Characters no file name may hold (Windows' set covers the others').
_ILLEGAL_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _file_stem(title: str) -> str:
    """A safe file stem for ``title`` (`space.safe_filename` can't be imported here)."""
    return " ".join(_ILLEGAL_RE.sub("", title).split()).strip(". ")[:120].rstrip(". ")


@dataclass
class TrashItem:
    id: str
    kind: str
    """``'object'``, ``'type'``, ``'collection'`` or ``'query'``."""
    originalPath: str
    """The object's space path; for a type, its type JSON's space path."""
    title: str
    type: str
    """The type id (of the object, or the trashed type itself)."""
    deletedAt: str
    typeTrashId: str | None = None
    """For an object trashed with its type: that type's trash entry id."""
    objectCount: int | None = None
    """For a type or collection: how many of its objects are still in the trash."""
    collectionTrashId: str | None = None
    """For an object trashed by a collection delete: that collection's trash entry id."""
    collectionId: str | None = None
    """For a collection entry: the collection's id."""
    name: str | None = None
    """For a collection or query entry: its name."""
    queryId: str | None = None
    """For a query entry: the query's id."""

    def to_api(self) -> dict[str, Any]:
        return asdict(self)


def parse_stamp(text: str) -> datetime | None:
    """A ``YYYY-MM-DDTHH:MM:SS.sssZ`` (or other ISO) stamp as an aware UTC datetime."""
    try:
        dt = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def ulid_time(ulid: str) -> datetime | None:
    """The millisecond timestamp a ULID starts with, as an aware UTC datetime."""
    if len(ulid) != 26:
        return None
    try:
        value = 0
        for ch in ulid[:10].upper():
            value = value * 32 + _CROCKFORD.index(ch)
        return datetime.fromtimestamp(value / 1000, UTC)
    except (ValueError, OverflowError, OSError):
        return None


def _dump(data: dict[str, Any]) -> bytes:
    return (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def _load(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


class Trash:
    def __init__(self, root: Path) -> None:
        self.dir = Path(root) / ".object" / "trash"
        self.types_dir = self.dir / "types"
        self.collections_dir = self.dir / "collections"
        self.queries_dir = self.dir / "queries"

    # -- paths ---------------------------------------------------------------

    def object_file(self, trash_id: str) -> Path:
        return self.dir / f"{trash_id}.md"

    def object_meta_file(self, trash_id: str) -> Path:
        return self.dir / f"{trash_id}.json"

    def type_dir(self, trash_id: str) -> Path:
        return self.types_dir / trash_id

    def collection_dir(self, trash_id: str) -> Path:
        return self.collections_dir / trash_id

    def query_file(self, trash_id: str) -> Path:
        return self.queries_dir / f"{trash_id}.json"

    def query_meta_file(self, trash_id: str) -> Path:
        return self.queries_dir / f"{trash_id}.meta.json"

    @staticmethod
    def _safe_id(trash_id: str) -> bool:
        return bool(trash_id) and all(c.isalnum() for c in trash_id)

    # -- metadata ------------------------------------------------------------

    def write_json(self, path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, _dump(data))

    def object_meta(self, trash_id: str) -> dict[str, Any] | None:
        """The entry's metadata; made up from the ``.md`` itself when the ``.json`` is missing or unreadable."""
        if not self._safe_id(trash_id) or not self.object_file(trash_id).is_file():
            return None
        return _load(self.object_meta_file(trash_id)) or self._fallback_meta(trash_id)

    def _fallback_meta(self, trash_id: str) -> dict[str, Any]:
        """Metadata for a trashed ``.md`` without its ``.json``: still listed, restorable (into
        the space root, named after its title) and purged by the ULID's time."""
        title = ""
        try:
            fm = read_raw(self.dir, f"{trash_id}.md").fm
            title = fm.get("title") if isinstance(fm.get("title"), str) else ""
        except OSError:
            pass
        title = title.strip() or trash_id
        return {
            "id": trash_id,
            "kind": "object",
            "originalPath": f"{_file_stem(title) or trash_id}.md",
            "title": title,
            "type": "",
            "deletedAt": self._stamp_of(trash_id, self.object_file(trash_id)),
        }

    @staticmethod
    def _stamp_of(trash_id: str, path: Path) -> str:
        """When an entry without a recorded ``deletedAt`` was deleted: the ULID's time, else the file's mtime."""
        when = ulid_time(trash_id)
        if when is None:
            try:
                when = datetime.fromtimestamp(path.stat().st_mtime, UTC)
            except OSError:
                return ""
        return when.strftime("%Y-%m-%dT%H:%M:%S.") + f"{when.microsecond // 1000:03d}Z"

    def manifest(self, trash_id: str) -> dict[str, Any] | None:
        if not self._safe_id(trash_id):
            return None
        return _load(self.type_dir(trash_id) / "manifest.json")

    def collection_manifest(self, trash_id: str) -> dict[str, Any] | None:
        if not self._safe_id(trash_id):
            return None
        return _load(self.collection_dir(trash_id) / "manifest.json")

    def collection_trash_ids(self) -> list[str]:
        if not self.collections_dir.is_dir():
            return []
        return sorted(
            p.name for p in self.collections_dir.iterdir() if (p / "manifest.json").is_file()
        )

    def query_trash_ids(self) -> list[str]:
        if not self.queries_dir.is_dir():
            return []
        return sorted(p.stem for p in self.queries_dir.glob("*.json") if self._safe_id(p.stem))

    def query_data(self, trash_id: str) -> dict[str, Any] | None:
        if not self._safe_id(trash_id):
            return None
        return _load(self.query_file(trash_id))

    def _query_meta(self, trash_id: str) -> dict[str, Any]:
        if not self._safe_id(trash_id):
            return {}
        return _load(self.query_meta_file(trash_id)) or {}

    def query_id(self, trash_id: str) -> str:
        """The deleted query's original id: the sidecar's, else the JSON's ``id``."""
        recorded = self._query_meta(trash_id).get("id")
        if isinstance(recorded, str) and recorded:
            return recorded
        data = self.query_data(trash_id) or {}
        return str(data.get("id") or "")

    def query_deleted_at(self, trash_id: str) -> str:
        recorded = self._query_meta(trash_id).get("deletedAt")
        if isinstance(recorded, str) and recorded:
            return recorded
        return self._stamp_of(trash_id, self.query_file(trash_id))

    def object_ids(self) -> list[str]:
        """Every trashed object: its ``.md`` is the entry; the ``.json`` may be missing."""
        if not self.dir.is_dir():
            return []
        return sorted(p.stem for p in self.dir.glob("*.md") if self._safe_id(p.stem))

    def type_ids(self) -> list[str]:
        if not self.types_dir.is_dir():
            return []
        return sorted(
            p.name for p in self.types_dir.iterdir() if (p / "manifest.json").is_file()
        )

    def items(self) -> list[TrashItem]:
        """Every entry, newest first."""
        objects: list[TrashItem] = []
        for oid in self.object_ids():
            meta = self.object_meta(oid)
            if meta is None:
                continue
            objects.append(
                TrashItem(
                    id=oid,
                    kind="object",
                    originalPath=str(meta.get("originalPath", "")),
                    title=str(meta.get("title", "")),
                    type=str(meta.get("type", "")),
                    deletedAt=str(meta.get("deletedAt", "")),
                    typeTrashId=meta.get("typeTrashId") or None,
                    collectionTrashId=meta.get("collectionTrashId") or None,
                )
            )
        out = list(objects)
        for tid in self.type_ids():
            manifest = self.manifest(tid)
            if manifest is None:
                continue
            type_id = str(manifest.get("typeId", ""))
            out.append(
                TrashItem(
                    id=tid,
                    kind="type",
                    originalPath=f".object/types/{type_id}.json",
                    title=str(manifest.get("name", type_id)),
                    type=type_id,
                    deletedAt=str(manifest.get("deletedAt", "")),
                    objectCount=sum(1 for o in objects if o.typeTrashId == tid),
                )
            )
        for cid in self.collection_trash_ids():
            manifest = self.collection_manifest(cid)
            if manifest is None:
                continue
            collection_id = str(manifest.get("collectionId", ""))
            name = str(manifest.get("name", collection_id))
            out.append(
                TrashItem(
                    id=cid,
                    kind="collection",
                    originalPath=f".object/collections/{collection_id}.json",
                    title=name,
                    type="",
                    deletedAt=str(manifest.get("deletedAt", "")),
                    objectCount=sum(1 for o in objects if o.collectionTrashId == cid),
                    collectionId=collection_id,
                    name=name,
                )
            )
        for qid in self.query_trash_ids():
            data = self.query_data(qid)
            if data is None:
                continue
            query_id = self.query_id(qid)
            name = str(data.get("name") or "") or query_id
            out.append(
                TrashItem(
                    id=qid,
                    kind="query",
                    originalPath=f".object/queries/{query_id}.json",
                    title=name,
                    type="",
                    deletedAt=self.query_deleted_at(qid),
                    queryId=query_id,
                    name=name,
                )
            )
        out.sort(key=lambda i: (i.deletedAt, i.id), reverse=True)
        return out

    # -- removal -------------------------------------------------------------

    def remove_object(self, trash_id: str) -> None:
        for p in (self.object_file(trash_id), self.object_meta_file(trash_id)):
            p.unlink(missing_ok=True)

    def definition_ids(self, folder: str) -> set[str]:
        """Ids of the collections or queries held by trash entries (``collections`` / ``queries``)."""
        found: set[str] = set()
        base = self.dir / folder
        if folder == "collections":
            for manifest in base.glob("*/manifest.json"):
                data = _load(manifest)
                if data and isinstance(data.get("collectionId"), str):
                    found.add(data["collectionId"])
        elif folder == "queries":
            for trash_id in self.query_trash_ids():
                query_id = self.query_id(trash_id)
                if query_id:
                    found.add(query_id)
        return found

    def remove_type(self, trash_id: str) -> None:
        shutil.rmtree(self.type_dir(trash_id), ignore_errors=True)

    def remove_collection(self, trash_id: str) -> None:
        shutil.rmtree(self.collection_dir(trash_id), ignore_errors=True)

    def has_query(self, trash_id: str) -> bool:
        return self._safe_id(trash_id) and self.query_file(trash_id).is_file()

    def remove_query(self, trash_id: str) -> None:
        if self._safe_id(trash_id):
            self.query_file(trash_id).unlink(missing_ok=True)
            self.query_meta_file(trash_id).unlink(missing_ok=True)

    def expired(self, now: datetime) -> list[str]:
        """Ids of the entries deleted more than `RETENTION` before `now`."""
        out = []
        for item in self.items():
            when = parse_stamp(item.deletedAt)
            if when is not None and now - when > RETENTION:
                out.append(item.id)
        return out
