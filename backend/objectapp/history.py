"""Version history for objects and whiteboards (M8 Task 4).

Snapshots live outside the space, in the per-user state dir::

    <state dir>/history/<sha1(space root)[:16]>/<key>/<UTC stamp>.<ext>
    <state dir>/history/<sha1(space root)[:16]>/<key>/index.json   [{id, at, rel, files}]

``<key>`` is the object's frontmatter ``id``, else ``path-<sha1(rel)[:16]>``, so the history
follows a rename. The rules (the plan's Global Constraints, "our rules", listed for Gene):

- `snapshot` runs only from `Space.before_write` (and a restore): it keeps the file's current
  bytes when the object's newest version is older than 5 minutes or it has none (so a typing
  session is one version). At most 200 versions per object; the oldest go first.
- A whiteboard's version holds its ``.md`` and both sidecars (whichever exist), whichever of
  the three is being written. Boards are restore-only (no preview text).
- Reading (`versions`, `content`) writes nothing and creates no folder.
- `restore` refuses a stale ``base_version`` (`Conflict`), keeps the current state as a version
  first, then puts the version's bytes back except the current ``id`` and ``title`` (and the
  file name, which a restore never changes). Attachments are left as they are.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any

from .appstate import state_dir
from .frontmatter import FrontmatterError, delete_keys, parse_fm, set_keys
from .jsonstore import dump_json
from .objfile import join_object, split_object
from .textfile import atomic_write, decode, encode_like

if TYPE_CHECKING:
    from .space import Space

__all__ = ["MAX_VERSIONS", "VERSION_GAP", "HistoryStore", "VersionNotFound", "keep_identity"]

_log = logging.getLogger(__name__)

VERSION_GAP = timedelta(minutes=5)
MAX_VERSIONS = 200
BOARD_SUFFIX = ".whiteboard.json"
INK_SUFFIX = ".ink.svg"
_SAFE_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_INDEX = "index.json"
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


class VersionNotFound(KeyError):
    """No such version for that object (404)."""


def _sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _md_of(rel: str) -> str:
    """The object's ``.md`` for a sidecar path; the path itself otherwise."""
    for suffix in (BOARD_SUFFIX, INK_SUFFIX):
        if rel.endswith(suffix):
            return rel[: -len(suffix)] + ".md"
    return rel


def _stem(md_rel: str) -> str:
    return md_rel.removesuffix(".md")


def _fm_of(data: bytes | None) -> dict[str, Any]:
    if not data:
        return {}
    of = split_object(decode(data).text)
    if of.frontmatter_src is None or not of.fm_ok:
        return {}
    try:
        return parse_fm(of.frontmatter_src)
    except (FrontmatterError, ValueError):
        return {}


def _str(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _iso(at: datetime) -> str:
    at = at.astimezone(UTC)
    return at.strftime("%Y-%m-%dT%H:%M:%S.") + f"{at.microsecond // 1000:03d}Z"


def _parse_iso(text: str) -> datetime | None:
    try:
        return datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None


def _read(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except OSError:
        return None


def keep_identity(old: bytes, current: bytes) -> bytes:
    """``old`` with the current ``id`` and ``title`` (only those lines change; CRLF/BOM kept)."""
    cur = _fm_of(current)
    tf = decode(old)
    of = split_object(tf.text)
    if not of.fm_ok:
        return old
    old_fm = _fm_of(old)
    src = of.frontmatter_src or ""
    updates = {k: cur[k] for k in ("id", "title") if k in cur and old_fm.get(k) != cur[k]}
    removals = [k for k in ("id", "title") if k in old_fm and k not in cur]
    if not updates and not removals:
        return old
    try:
        new_src = set_keys(
            delete_keys(src, removals),
            {k: v for k, v in updates.items() if k != "id"},
            insert_first={"id": updates["id"]} if "id" in updates else None,
        )
    except FrontmatterError:
        return old
    if of.frontmatter_src is None:
        if not new_src:
            return old
        nl = "\n"
        of = replace(of, frontmatter_src=new_src if new_src.endswith(nl) else new_src + nl)
    else:
        of = replace(of, frontmatter_src=new_src)
    return encode_like(old, join_object(of))


class HistoryStore:
    """The version history of one space (see the module docstring)."""

    def __init__(
        self,
        space_root: Path | str,
        is_whiteboard: Callable[[str], bool] | None = None,
    ) -> None:
        self.root = Path(space_root).resolve()
        self._is_whiteboard = is_whiteboard
        self._lock = threading.RLock()

    # -- layout ---------------------------------------------------------------

    @property
    def dir(self) -> Path:
        """This space's history folder (read from the state dir on each access; not created)."""
        return state_dir() / "history" / _sha1(str(self.root))[:16]

    @staticmethod
    def _path_key(md_rel: str) -> str:
        return "path-" + _sha1(md_rel)[:16]

    @staticmethod
    def _id_key(object_id: str | None) -> str | None:
        if not object_id:
            return None
        return object_id if _SAFE_KEY_RE.match(object_id) else "id-" + _sha1(object_id)[:16]

    def _key_of(self, md_rel: str, md_data: bytes | None) -> str:
        return self._id_key(_str(_fm_of(md_data).get("id"))) or self._path_key(md_rel)

    def _keys_for(self, md_rel: str) -> list[str]:
        """The keys whose versions belong to the object at ``md_rel`` now (id key, path key)."""
        keys = []
        id_key = self._id_key(_str(_fm_of(_read(self.root / md_rel)).get("id")))
        if id_key:
            keys.append(id_key)
        keys.append(self._path_key(md_rel))
        return keys

    def _load_index(self, key: str) -> list[dict[str, Any]]:
        data = _read(self.dir / key / _INDEX)
        if data is None:
            return []
        try:
            items = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return []
        return [e for e in items if isinstance(e, dict) and isinstance(e.get("id"), str)] if isinstance(items, list) else []

    def _entries(self, md_rel: str) -> list[tuple[str, dict[str, Any]]]:
        """(key, entry) of every version of the object, oldest first."""
        out: list[tuple[int, int, str, dict[str, Any]]] = []
        for rank, key in enumerate(reversed(self._keys_for(md_rel))):
            for pos, entry in enumerate(self._load_index(key)):
                out.append((rank, pos, key, entry))
        # Oldest first by instant; within one instant, the index order (path key first).
        out.sort(key=lambda t: (_parse_iso(t[3].get("at", "")) or _EPOCH, t[0], t[1]))
        return [(key, entry) for _r, _p, key, entry in out]

    def _kind(self, md_rel: str, rel: str) -> str:
        if rel != md_rel:
            return "whiteboard"
        if self._is_whiteboard is not None:
            try:
                return "whiteboard" if self._is_whiteboard(md_rel) else "object"
            except (KeyError, ValueError, OSError):
                _log.debug("Could not classify %s; checking for sidecars", md_rel)
        stem = _stem(md_rel)
        for suffix in (BOARD_SUFFIX, INK_SUFFIX):
            if (self.root / (stem + suffix)).is_file():
                return "whiteboard"
        return "object"

    # -- writing --------------------------------------------------------------

    def snapshot(self, rel: str, data: bytes, now: datetime, force: bool = False) -> str | None:
        """Keep ``data`` (``rel``'s bytes before an app write) as a version; return its id.

        Nothing is kept (None) when the object's newest version is less than 5 minutes old,
        unless ``force`` (a restore keeps the current state always).
        """
        rel = PurePosixPath(rel).as_posix()
        md_rel = _md_of(rel)
        with self._lock:
            entries = self._entries(md_rel)
            if entries and not force:
                newest = _parse_iso(entries[-1][1].get("at", ""))
                if newest is not None and now - newest < VERSION_GAP:
                    return None
            kind = self._kind(md_rel, rel)
            files: dict[str, bytes] = {}
            if kind == "whiteboard":
                stem = _stem(md_rel)
                for path, ext in ((md_rel, ".md"), (stem + BOARD_SUFFIX, BOARD_SUFFIX), (stem + INK_SUFFIX, INK_SUFFIX)):
                    content = data if path == rel else _read(self.root / path)
                    if content is not None:
                        files[ext] = content
            else:
                files[".md"] = data
            md_data = files.get(".md") if ".md" in files else _read(self.root / md_rel)
            key = self._key_of(md_rel, md_data)
            folder = self.dir / key
            folder.mkdir(parents=True, exist_ok=True)
            base = now.astimezone(UTC).strftime("%Y%m%dT%H%M%S") + f"{now.microsecond // 1000:03d}Z"
            taken = {e["id"] for _k, e in entries}
            vid, n = base, 1
            while vid in taken or any((folder / (vid + ext)).exists() for ext in files):
                n += 1
                vid = f"{base}-{n}"
            names = []
            for ext, content in files.items():
                atomic_write(folder / (vid + ext), content)
                names.append(vid + ext)
            index = self._load_index(key)
            index.append({"id": vid, "at": _iso(now), "rel": md_rel, "kind": kind, "files": names})
            atomic_write(folder / _INDEX, dump_json(index))
            self._prune(md_rel)
            return vid

    def _prune(self, md_rel: str) -> None:
        entries = self._entries(md_rel)
        extra = len(entries) - MAX_VERSIONS
        if extra <= 0:
            return
        drop: dict[str, set[str]] = {}
        for key, entry in entries[:extra]:
            drop.setdefault(key, set()).add(entry["id"])
        for key, ids in drop.items():
            folder = self.dir / key
            index = self._load_index(key)
            keep = [e for e in index if e["id"] not in ids]
            atomic_write(folder / _INDEX, dump_json(keep))
            for e in index:
                if e["id"] in ids:
                    for name in e.get("files", []):
                        try:
                            (folder / PurePosixPath(name).name).unlink()
                        except OSError:
                            pass

    # -- reading --------------------------------------------------------------

    def _find(self, md_rel: str, version_id: str) -> tuple[str, dict[str, Any], int]:
        for number, (key, entry) in enumerate(self._entries(md_rel), start=1):
            if entry["id"] == version_id:
                return key, entry, number
        raise VersionNotFound(version_id)

    def _file(self, key: str, entry: dict[str, Any], ext: str) -> bytes | None:
        for name in entry.get("files", []):
            if isinstance(name, str) and name == entry["id"] + ext:
                return _read(self.dir / key / PurePosixPath(name).name)
        return None

    def versions(self, rel: str) -> list[dict[str, Any]]:
        """``VersionInfo`` of every version, newest first (numbered 1… oldest first)."""
        md_rel = _md_of(PurePosixPath(rel).as_posix())
        with self._lock:
            entries = self._entries(md_rel)
            out = []
            for number, (key, entry) in enumerate(entries, start=1):
                size = 0
                for name in entry.get("files", []):
                    try:
                        size += (self.dir / key / PurePosixPath(str(name)).name).stat().st_size
                    except OSError:
                        pass
                md = self._file(key, entry, ".md")
                kind = entry.get("kind") if entry.get("kind") in ("object", "whiteboard") else (
                    "whiteboard" if any(str(n).endswith((BOARD_SUFFIX, INK_SUFFIX)) for n in entry.get("files", [])) else "object"
                )
                out.append({
                    "id": entry["id"],
                    "number": number,
                    "at": entry.get("at", ""),
                    "size": size,
                    "kind": kind,
                    "title": _str(_fm_of(md).get("title")),
                })
        out.reverse()
        return out

    def content(self, rel: str, version_id: str) -> dict[str, Any]:
        """``VersionContent``: the version's text (``\\n`` line ends, no BOM); null for boards."""
        md_rel = _md_of(PurePosixPath(rel).as_posix())
        with self._lock:
            key, entry, _n = self._find(md_rel, version_id)
            if self._is_board_entry(entry):
                return {"id": version_id, "text": None}
            data = self._file(key, entry, ".md")
            if data is None:
                raise VersionNotFound(version_id)
            return {"id": version_id, "text": decode(data).text}

    @staticmethod
    def _is_board_entry(entry: dict[str, Any]) -> bool:
        if entry.get("kind") == "whiteboard":
            return True
        return any(str(n).endswith((BOARD_SUFFIX, INK_SUFFIX)) for n in entry.get("files", []))

    # -- restoring ------------------------------------------------------------

    def restore(
        self, space: Space, rel: str, version_id: str, base_version: str, now: datetime
    ) -> dict[str, Any]:
        """Put a version back; return ``{version}`` (boards: ``{revision, version}``).

        Raises `KeyError` (no object), `VersionNotFound`, `Conflict` (stale ``base_version``),
        and for boards `BoardReadOnly` when a current sidecar can't be read.
        """
        from .space import Conflict, version_of

        md_rel = space._rel(rel)
        full = space.root / md_rel
        with space._lock:
            current = _read(full)
            if current is None:
                raise KeyError(md_rel)
            key, entry, _n = self._find(md_rel, version_id)
            if self._is_board_entry(entry):
                return self._restore_board(space, md_rel, key, entry, current, base_version, now)
            if version_of(current) != base_version:
                raise Conflict(version_of(current))
            old = self._file(key, entry, ".md")
            if old is None:
                raise VersionNotFound(version_id)
            self.snapshot(md_rel, current, now, force=True)
            new = keep_identity(old, current)
            if new == current:
                return {"version": version_of(current)}
            if not space._write_exact(md_rel, base_version, new):
                raise Conflict(version_of(_read(full) or b""))
            return {"version": version_of(new)}

    def _restore_board(
        self,
        space: Space,
        md_rel: str,
        key: str,
        entry: dict[str, Any],
        current_md: bytes,
        base_version: str,
        now: datetime,
    ) -> dict[str, Any]:
        from .space import Conflict, version_of
        from .whiteboardfile import dump_board, empty_board, load_board
        from .whiteboardink import dump_ink, load_ink
        from .whiteboardstore import _board_md, _save_sidecar

        _board_md(space, md_rel)  # 404 / 422 when it is no longer a whiteboard
        stem = _stem(md_rel)
        board_path, ink_path = stem + BOARD_SUFFIX, stem + INK_SUFFIX
        board_now = _read(space.root / board_path)
        board_rev = version_of(board_now) if board_now is not None else ""
        md_version = version_of(current_md)
        # The board view knows the board's revision, an object view the .md's version.
        if base_version not in (board_rev, md_version):
            raise Conflict(board_rev)
        self.snapshot(md_rel, current_md, now, force=True)
        sidecars = (
            (board_path, BOARD_SUFFIX, dump_board(empty_board()), lambda b: load_board(b)[1]),
            (ink_path, INK_SUFFIX, dump_ink([]), lambda b: load_ink(b)[1]),
        )
        for path, ext, empty, unreadable in sidecars:
            target = self._file(key, entry, ext)
            existing = _read(space.root / path)
            if target is None:
                if existing is None:
                    continue
                target = empty
            if existing == target:
                continue
            _save_sidecar(
                space,
                path,
                target,
                version_of(existing) if existing is not None else "",
                unreadable,
            )
        out_version = md_version
        old_md = self._file(key, entry, ".md")
        if old_md is not None:
            new_md = keep_identity(old_md, current_md)
            if new_md != current_md:
                if not space._write_exact(md_rel, md_version, new_md):
                    raise Conflict(version_of(_read(space.root / md_rel) or b""))
                out_version = version_of(new_md)
        board_after = _read(space.root / board_path)
        return {
            "revision": version_of(board_after) if board_after is not None else "",
            "version": out_version,
        }
