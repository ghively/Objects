"""The app's own trash, in ``.object/trash/`` (not the OS recycle bin).

Layout:

- an object: ``<ulid>.md`` (the file's bytes, unchanged) plus ``<ulid>.json``
  ``{id, kind: 'object', originalPath, title, type, deletedAt, typeTrashId?}``;
- a type: ``types/<ulid>/`` with ``type.json``, ``templates/<original path>``
  for each of its template files, and ``manifest.json`` ``{id, kind: 'type',
  typeId, name, deletedAt, objectTrashIds, allowedTypesRefs, templates}``. Its
  objects are ordinary object entries carrying ``typeTrashId``.

This module only knows the folder layout and the metadata; `Space` moves the
files (so it can keep the watcher quiet and its index current).
"""

from __future__ import annotations

import json
import shutil
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .textfile import atomic_write

__all__ = ["RETENTION", "Trash", "TrashItem", "parse_stamp"]

RETENTION = timedelta(days=30)
"""Entries older than this are purged when the space opens."""


@dataclass
class TrashItem:
    id: str
    kind: str
    """``'object'`` or ``'type'``."""
    originalPath: str
    """The object's space path; for a type, its type JSON's space path."""
    title: str
    type: str
    """The type id (of the object, or the trashed type itself)."""
    deletedAt: str
    typeTrashId: str | None = None
    """For an object trashed with its type: that type's trash entry id."""
    objectCount: int | None = None
    """For a type: how many of its objects are still in the trash."""

    def to_api(self) -> dict[str, Any]:
        return asdict(self)


def parse_stamp(text: str) -> datetime | None:
    """A ``YYYY-MM-DDTHH:MM:SS.sssZ`` (or other ISO) stamp as an aware UTC datetime."""
    try:
        dt = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


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

    # -- paths ---------------------------------------------------------------

    def object_file(self, trash_id: str) -> Path:
        return self.dir / f"{trash_id}.md"

    def object_meta_file(self, trash_id: str) -> Path:
        return self.dir / f"{trash_id}.json"

    def type_dir(self, trash_id: str) -> Path:
        return self.types_dir / trash_id

    @staticmethod
    def _safe_id(trash_id: str) -> bool:
        return bool(trash_id) and all(c.isalnum() for c in trash_id)

    # -- metadata ------------------------------------------------------------

    def write_json(self, path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, _dump(data))

    def object_meta(self, trash_id: str) -> dict[str, Any] | None:
        if not self._safe_id(trash_id) or not self.object_file(trash_id).is_file():
            return None
        return _load(self.object_meta_file(trash_id))

    def manifest(self, trash_id: str) -> dict[str, Any] | None:
        if not self._safe_id(trash_id):
            return None
        return _load(self.type_dir(trash_id) / "manifest.json")

    def object_ids(self) -> list[str]:
        if not self.dir.is_dir():
            return []
        return sorted(
            p.stem for p in self.dir.glob("*.json") if self.object_file(p.stem).is_file()
        )

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
            for entry in base.glob("*.json"):
                data = _load(entry)
                if data and isinstance(data.get("id"), str):
                    found.add(data["id"])
        return found

    def remove_type(self, trash_id: str) -> None:
        shutil.rmtree(self.type_dir(trash_id), ignore_errors=True)

    def expired(self, now: datetime) -> list[str]:
        """Ids of the entries deleted more than `RETENTION` before `now`."""
        out = []
        for item in self.items():
            when = parse_stamp(item.deletedAt)
            if when is not None and now - when > RETENTION:
                out.append(item.id)
        return out
