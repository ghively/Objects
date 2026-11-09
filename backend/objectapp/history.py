"""Version history for objects and whiteboards (M8 Task 4).

Snapshots live outside the space, in the per-user state dir::

    <state dir>/history/<space id>/<key>/<UTC stamp>.<ext>
    <state dir>/history/<space id>/<key>/index.json   [{id, at, rel, files, ...}]

``<space id>`` is the space's stable id (``.object/space.json`` ``spaceId``, 2026-11-08), so
moving or renaming the folder keeps the history. A space without one yet gets it on the next
app write (`snapshot`) or when version control is turned on, never on open. Older history was
kept under ``sha1(space root)[:16]``: while the id's folder doesn't exist that folder is read,
and the first write moves it to the id's folder.

``<key>`` is the object's frontmatter ``id``, else ``path-<sha1(rel)[:16]>``, so the history
follows a rename. The rules (the plan's Global Constraints, "our rules", listed for Gene):

- `snapshot` runs only from `Space.before_write` (and a restore): it keeps the file's current
  bytes when the object's newest version is older than 5 minutes or it has none (so a typing
  session is one version). At most 200 versions per object; the oldest go first.
- An object's version is stored cheaply (audit 2026-11-01: a hub rename kept 214 full copies,
  1-4 MB): as a delta against the object's previous version when the two share all but a
  small middle (a relink, a type rename, a short edit) - the entry's ``delta`` holds the
  previous version's id, the common prefix and suffix lengths, the new middle (base64) and
  the sha1 of the whole, so no file at all; otherwise as ``<stamp>.md.gz`` (gzip). A delta
  chain is at most 16 long; pruning a version another one is a delta of first stores that
  one whole. Older plain ``<stamp>.md`` files are still read.
- A whiteboard's version holds its ``.md`` and both sidecars (whichever exist), whichever of
  the three is being written. Boards are restore-only (no preview text).
- Reading (`versions`, `content`) writes nothing and creates no folder.
- Definitions (2026-11-08): a type, collection, query or view file (``.object/<kind>/<id>.json``)
  keeps a version before each app save too (`snapshot` with the file's path; its key is the
  path key). They are listed by `versions` and read by `content` like an object's; restoring
  one is done from the space's git history (`api_vcs`).
- `restore` refuses a stale ``base_version`` (`Conflict`), keeps the current state as a version
  first, then puts the version's bytes back except the current ``id`` and ``title`` (and the
  file name, which a restore never changes). Attachments are left as they are.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import logging
import re
import threading
import zlib
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta, tzinfo
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


class _IndexChanged(Exception):
    """An index file changed between its read and its replace (see `_update_index`)."""


_INDEX_RETRIES = 5
_GZ = ".md.gz"
_MAX_CHAIN = 16
"""Deltas in a row before a version is stored whole again (bounds a read's work)."""
_DELTA_MAX = 0.5
"""A delta is kept only when its middle is under this share of the version's bytes."""


def _gzip(data: bytes) -> bytes:
    return gzip.compress(data, compresslevel=6, mtime=0)


def _common_prefix(a: bytes, b: bytes) -> int:
    """Length of the common prefix of ``a`` and ``b`` (binary search over slice compares)."""
    lo, hi = 0, min(len(a), len(b))
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if a[:mid] == b[:mid]:
            lo = mid
        else:
            hi = mid - 1
    return lo


def _common_suffix(a: bytes, b: bytes, limit: int) -> int:
    """Length (at most ``limit``) of the common suffix of ``a`` and ``b``."""
    lo, hi = 0, limit
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if a[len(a) - mid :] == b[len(b) - mid :]:
            lo = mid
        else:
            hi = mid - 1
    return lo


def _make_delta(base: bytes, data: bytes) -> tuple[int, int, bytes]:
    """(prefix, suffix, middle): ``data == base[:prefix] + middle + base[len(base) - suffix:]``."""
    prefix = _common_prefix(base, data)
    suffix = _common_suffix(base, data, min(len(base), len(data)) - prefix)
    return prefix, suffix, data[prefix : len(data) - suffix]


def _apply_delta(base: bytes, delta: dict[str, Any]) -> bytes | None:
    """The version a delta entry describes, or None when it doesn't check out (sha1)."""
    try:
        prefix, suffix = int(delta["prefix"]), int(delta["suffix"])
        middle = base64.b64decode(delta["mid"], validate=True)
    except (KeyError, TypeError, ValueError):
        return None
    if prefix < 0 or suffix < 0 or prefix + suffix > len(base):
        return None
    data = base[:prefix] + middle + base[len(base) - suffix :]
    return data if hashlib.sha1(data).hexdigest() == delta.get("sha1") else None


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
    def legacy_dir(self) -> Path:
        """Where history was kept before spaces had an id: keyed by the folder's path."""
        return state_dir() / "history" / _sha1(str(self.root))[:16]

    @property
    def dir(self) -> Path:
        """This space's history folder (read from the state dir on each access; not created):
        the space id's folder, or the older path-keyed one while only that exists."""
        from .spaceconfig import space_id

        sid = space_id(self.root)
        if sid is None:
            return self.legacy_dir
        new = state_dir() / "history" / sid
        if not new.exists() and self.legacy_dir.is_dir():
            return self.legacy_dir
        return new

    def migrate(self, create: bool = True) -> None:
        """Give the space its id (when it has none) and move older path-keyed history to the id's
        folder. Writes; called only from a write (`snapshot`, turning on version control).
        Without `create` (an app write) a space with no ``space.json`` is left without an id."""
        from .spaceconfig import ensure_space_id

        sid = ensure_space_id(self.root, create=create)
        if sid is None:
            return
        new = state_dir() / "history" / sid
        old = self.legacy_dir
        if old.is_dir() and not new.exists():
            try:
                old.replace(new)
            except OSError:
                _log.warning("The history folder %s couldn't be moved to %s", old, new)

    @staticmethod
    def _path_key(md_rel: str) -> str:
        return "path-" + _sha1(md_rel)[:16]

    @staticmethod
    def _id_key(object_id: str | None) -> str | None:
        if not object_id:
            return None
        return object_id if _SAFE_KEY_RE.match(object_id) else "id-" + _sha1(object_id)[:16]

    def _keys_for(self, md_rel: str, object_id: str | None = None) -> list[str]:
        """The keys whose versions belong to the object at ``md_rel`` now (id key, path key).

        ``object_id`` is the file's frontmatter ``id`` when the caller has it; otherwise the
        file is read and parsed for it.
        """
        if object_id is None:
            object_id = _str(_fm_of(_read(self.root / md_rel)).get("id"))
        id_key = self._id_key(object_id)
        return [id_key, self._path_key(md_rel)] if id_key else [self._path_key(md_rel)]

    def key_for(self, md_rel: str, object_id: str | None) -> str:
        """The key the object's new versions go under (its id key, else its path key).

        ``object_id`` None reads the file's frontmatter ``id``. Reads only (M23 Wins)."""
        return self._keys_for(PurePosixPath(md_rel).as_posix(), object_id)[0]

    def changed_keys_by_day(
        self, lo: datetime, hi: datetime, tz: tzinfo
    ) -> dict[str, set[str]]:
        """The keys with a version made in ``[lo, hi)``, by the local day (``YYYY-MM-DD`` in
        ``tz``) it was made on. An index that can't be read is skipped. Reads only: no folder
        is created (M23 Wins)."""
        out: dict[str, set[str]] = {}
        try:
            folders = [p for p in self.dir.iterdir() if p.is_dir()]
        except OSError:
            return out
        for folder in folders:
            for entry in self._load_index(folder.name):
                at = _parse_iso(entry.get("at", ""))
                if at is None:
                    continue
                if at.tzinfo is None:
                    at = at.replace(tzinfo=UTC)
                if lo <= at < hi:
                    out.setdefault(at.astimezone(tz).date().isoformat(), set()).add(folder.name)
        return out

    def _load_index(self, key: str) -> list[dict[str, Any]]:
        return self._parse_index(_read(self.dir / key / _INDEX))

    @staticmethod
    def _parse_index(data: bytes | None) -> list[dict[str, Any]]:
        if data is None:
            return []
        try:
            items = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return []
        return [e for e in items if isinstance(e, dict) and isinstance(e.get("id"), str)] if isinstance(items, list) else []

    def _entries(
        self, md_rel: str, keys: list[str] | None = None
    ) -> list[tuple[str, dict[str, Any]]]:
        """(key, entry) of every version of the object, oldest first.

        ``keys`` are the object's keys when the caller computed them already (`_keys_for`).
        """
        out: list[tuple[int, int, str, dict[str, Any]]] = []
        for rank, key in enumerate(reversed(keys or self._keys_for(md_rel))):
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

    def _update_index(
        self, key: str, change: Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
    ) -> list[dict[str, Any]]:
        """Rewrite ``key``'s index as ``change(current entries)``, checked like `jsonstore`.

        The index is re-read right before the replace; if another writer (a second app on
        the same space) changed it since it was read, the change is applied again to what
        is there now instead of overwriting it.
        """
        path = self.dir / key / _INDEX
        for _attempt in range(_INDEX_RETRIES):
            before = _read(path)
            entries = change(self._parse_index(before))

            def unchanged(before: bytes | None = before) -> None:
                if _read(path) != before:
                    raise _IndexChanged

            try:
                atomic_write(path, dump_json(entries), check=unchanged)
            except _IndexChanged:
                continue
            return entries
        raise OSError(f"The history index {path} keeps changing")

    def snapshot(
        self,
        rel: str,
        data: bytes,
        now: datetime,
        force: bool = False,
        object_id: str | None = None,
    ) -> str | None:
        """Keep ``data`` (``rel``'s bytes before an app write) as a version; return its id.

        Nothing is kept (None) when the object's newest version is less than 5 minutes old,
        unless ``force`` (a restore keeps the current state always). ``object_id`` is the
        file's frontmatter ``id`` when the caller has parsed it already (spares the parse).
        """
        rel = PurePosixPath(rel).as_posix()
        md_rel = _md_of(rel)
        with self._lock:
            try:
                self.migrate(create=False)
            except Exception:  # noqa: BLE001 - an unreadable space.json keeps the older key
                _log.debug("The space id couldn't be set for %s", self.root)
            # `data` is the .md as it stands on disk (the bytes before the write), so the
            # object's id comes from it: one parse, no second read of the file.
            md_data = data if rel == md_rel else _read(self.root / md_rel)
            if object_id is None:
                object_id = _str(_fm_of(md_data).get("id"))
            keys = self._keys_for(md_rel, object_id or "")
            entries = self._entries(md_rel, keys)
            if entries and not force:
                newest = _parse_iso(entries[-1][1].get("at", ""))
                if newest is not None and now - newest < VERSION_GAP:
                    return None
            kind = self._kind(md_rel, rel)
            files: dict[str, bytes] = {}
            if kind == "whiteboard":
                stem = _stem(md_rel)
                for path, ext in ((md_rel, ".md"), (stem + BOARD_SUFFIX, BOARD_SUFFIX), (stem + INK_SUFFIX, INK_SUFFIX)):
                    if path == md_rel:
                        content = md_data
                    else:
                        content = data if path == rel else _read(self.root / path)
                    if content is not None:
                        files[ext] = content
            key = keys[0]
            delta: dict[str, Any] | None = None
            if kind != "whiteboard":
                delta = self._delta_for(key, [e for k, e in entries if k == key], data)
                if delta is None:
                    files[_GZ] = _gzip(data)
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
            entry: dict[str, Any] = {
                "id": vid, "at": _iso(now), "rel": md_rel, "kind": kind, "files": names
            }
            if kind != "whiteboard":
                entry["size"] = len(data)
            if delta is not None:
                entry["delta"] = delta
            self._update_index(key, lambda index: [*index, entry])
            self._prune(md_rel, keys, len(entries) + 1)
            return vid

    def _prune(self, md_rel: str, keys: list[str], count: int) -> None:
        """Drop the oldest versions beyond `MAX_VERSIONS`; ``count`` is how many there are now."""
        if count <= MAX_VERSIONS:
            return
        entries = self._entries(md_rel, keys)
        extra = len(entries) - MAX_VERSIONS
        if extra <= 0:
            return
        drop: dict[str, set[str]] = {}
        for key, entry in entries[:extra]:
            drop.setdefault(key, set()).add(entry["id"])
        for key, ids in drop.items():
            folder = self.dir / key
            index = self._load_index(key)
            whole = self._materialise_dependents(key, index, ids)

            def keep(now: list[dict[str, Any]], ids=ids, whole=whole) -> list[dict[str, Any]]:
                return [whole.get(e["id"], e) for e in now if e["id"] not in ids]

            self._update_index(key, keep)
            for e in index:
                if e["id"] in ids:
                    for name in e.get("files", []):
                        try:
                            (folder / PurePosixPath(name).name).unlink()
                        except OSError:
                            pass

    def _materialise_dependents(
        self, key: str, index: list[dict[str, Any]], dropped: set[str]
    ) -> dict[str, dict[str, Any]]:
        """Store whole (``.md.gz``) every kept version whose delta chain reaches a dropped one.

        Returns id -> the entry to keep in its place.
        """
        by_id = {e["id"]: e for e in index}
        memo: dict[str, bytes] = {}
        out: dict[str, dict[str, Any]] = {}
        for e in index:
            if e["id"] in dropped or not isinstance(e.get("delta"), dict):
                continue
            if not self._chain(e, by_id) & dropped:
                continue
            data = self._md(key, e, by_id, memo)
            if data is None:
                continue  # already unreadable: dropping its base changes nothing
            name = e["id"] + _GZ
            atomic_write(self.dir / key / name, _gzip(data))
            whole = {k: v for k, v in e.items() if k != "delta"}
            whole["files"] = [name]
            out[e["id"]] = whole
        return out

    @staticmethod
    def _chain(entry: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> set[str]:
        """The ids of the versions ``entry``'s delta chain rests on (not ``entry`` itself)."""
        seen: set[str] = set()
        e = entry
        while isinstance(e.get("delta"), dict) and len(seen) <= MAX_VERSIONS:
            base = e["delta"].get("base")
            if not isinstance(base, str) or base in seen:
                break
            seen.add(base)
            nxt = by_id.get(base)
            if nxt is None:
                break
            e = nxt
        return seen

    def _delta_for(
        self, key: str, own: list[dict[str, Any]], data: bytes
    ) -> dict[str, Any] | None:
        """A delta of ``data`` against ``key``'s newest version, when that is small; else None."""
        if not own:
            return None
        base = own[-1]
        if self._is_board_entry(base):
            return None
        by_id = {e["id"]: e for e in own}
        if len(self._chain(base, by_id)) + 1 >= _MAX_CHAIN:
            return None
        base_data = self._md(key, base, by_id)
        if base_data is None:
            return None
        prefix, suffix, middle = _make_delta(base_data, data)
        if len(middle) >= _DELTA_MAX * len(data):
            return None
        return {
            "base": base["id"],
            "prefix": prefix,
            "suffix": suffix,
            "mid": base64.b64encode(middle).decode("ascii"),
            "sha1": hashlib.sha1(data).hexdigest(),
        }

    # -- reading --------------------------------------------------------------

    def _stored_md(self, key: str, entry: dict[str, Any]) -> bytes | None:
        """A whole stored ``.md`` version: ``<id>.md.gz`` or (older) ``<id>.md``."""
        for name in entry.get("files", []):
            if not isinstance(name, str):
                continue
            if name == entry["id"] + _GZ:
                packed = _read(self.dir / key / PurePosixPath(name).name)
                try:
                    return gzip.decompress(packed) if packed is not None else None
                except (OSError, EOFError, ValueError, zlib.error):
                    return None
            if name == entry["id"] + ".md":
                return _read(self.dir / key / PurePosixPath(name).name)
        return None

    def _md(
        self,
        key: str,
        entry: dict[str, Any],
        by_id: dict[str, dict[str, Any]] | None = None,
        memo: dict[str, bytes] | None = None,
    ) -> bytes | None:
        """The ``.md`` bytes of a version, following its delta chain (None when unreadable).

        ``by_id`` is ``key``'s index by id and ``memo`` id -> bytes already rebuilt, when
        the caller reads several versions; it gets every version this rebuilds. Without one
        nothing is kept beyond the chain being walked.
        """
        chain: list[dict[str, Any]] = []
        e = entry
        while True:
            if memo is not None and e["id"] in memo:
                data: bytes | None = memo[e["id"]]
                break
            if not isinstance(e.get("delta"), dict):
                data = self._stored_md(key, e)
                break
            chain.append(e)
            if len(chain) > MAX_VERSIONS:
                return None
            if by_id is None:
                by_id = {x["id"]: x for x in self._load_index(key)}
            nxt = by_id.get(e["delta"].get("base"))
            if nxt is None:
                return None
            e = nxt
        if data is None:
            return None
        if memo is not None:
            memo[e["id"]] = data
        for d in reversed(chain):
            data = _apply_delta(data, d["delta"])
            if data is None:
                return None
            if memo is not None:
                memo[d["id"]] = data
        return data

    def _find(self, md_rel: str, version_id: str) -> tuple[str, dict[str, Any], int]:
        for number, (key, entry) in enumerate(self._entries(md_rel), start=1):
            if entry["id"] == version_id:
                return key, entry, number
        raise VersionNotFound(version_id)

    def _file(self, key: str, entry: dict[str, Any], ext: str) -> bytes | None:
        if ext == ".md":
            return self._md(key, entry)
        for name in entry.get("files", []):
            if isinstance(name, str) and name == entry["id"] + ext:
                return _read(self.dir / key / PurePosixPath(name).name)
        return None

    def versions(self, rel: str) -> list[dict[str, Any]]:
        """``VersionInfo`` of every version, newest first (numbered 1… oldest first)."""
        md_rel = _md_of(PurePosixPath(rel).as_posix())
        with self._lock:
            entries = self._entries(md_rel)
            by_key: dict[str, dict[str, dict[str, Any]]] = {}
            for key, entry in entries:
                by_key.setdefault(key, {})[entry["id"]] = entry
            # Each key keeps only its last rebuilt version: the next one's delta rests on it,
            # and keeping them all held every version of a big file in memory at once.
            memos: dict[str, dict[str, bytes]] = {}
            out = []
            for number, (key, entry) in enumerate(entries, start=1):
                md = self._md(key, entry, by_key[key], memos.get(key, {}))
                memos[key] = {entry["id"]: md} if md is not None else {}
                size = entry.get("size")
                if not isinstance(size, int):  # a version kept before sizes were recorded
                    size = 0
                    for name in entry.get("files", []):
                        try:
                            size += (self.dir / key / PurePosixPath(str(name)).name).stat().st_size
                        except OSError:
                            pass
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
