"""A cache of parsed frontmatter, so a warm re-open parses only the files that changed.

Opening a space is almost all pure-Python YAML (audit 2026-11-01, B3: 1.1 ms of the
1.14 ms per file). ``<cache dir>/frontmatter.json`` keeps, per object path, the
``sha1`` of the frontmatter source text and its `parse_fm` result, so `read_raw`
parses a file again only when that text differs. The key is the text itself, not
the file's size and mtime, so a hit is exact: the same source parses the same way,
and any edit, however small or quick, misses.

The cache never changes behaviour: a missing, stale, corrupt or unwritable cache
means parsing; a file whose frontmatter doesn't parse isn't cached; only values
that round-trip through JSON (frontmatter is JSON-like: string keys, lists,
scalars) are stored; and a hit is a fresh copy, so an edit to one object's
``fm`` can't leak into the next read.

The cache dir is the search index's (`searchindex.cache_dir_for`, mirrored here
because that module imports `space`, which imports `typedefs`): under
``$OBJECT_CACHE_DIR`` keyed by the space root's hash, else
``<root>/.capacities-cache``. Entries added or refreshed are flushed to disk,
atomically and at most once a second, from a later `read_raw` call or at
interpreter exit; a flush drops the entries of files that no longer exist.
Nothing else under the space is ever written.
"""

from __future__ import annotations

import atexit
import copy
import hashlib
import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from .textfile import atomic_write

__all__ = ["FrontmatterCache", "cache_dir_for_root", "flush_all", "for_root"]

CACHE_FOLDER = ".capacities-cache"
FILE_NAME = "frontmatter.json"
_VERSION = 1
_FLUSH_AFTER = 1.0
"""Seconds a dirty entry waits for more before the cache is written."""


def cache_dir_for_root(root: Path) -> Path:
    """Where a space's caches live (the same rule as `searchindex.cache_dir_for`)."""
    override = os.environ.get("OBJECT_CACHE_DIR")
    if override:
        digest = hashlib.sha256(str(root).encode("utf-8")).hexdigest()[:16]
        return Path(override) / digest
    return Path(root) / CACHE_FOLDER


def _digest(src: str) -> str:
    return hashlib.sha1(src.encode("utf-8", errors="surrogateescape")).hexdigest()


class FrontmatterCache:
    """The parsed-frontmatter cache of one space (see the module docstring)."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.path = cache_dir_for_root(self.root) / FILE_NAME
        self._lock = threading.Lock()
        self._entries: dict[str, tuple[str, dict[str, Any]]] | None = None
        self._dirty_since: float | None = None
        self._unwritable = False

    # -- the file -------------------------------------------------------------

    def _load(self) -> dict[str, tuple[str, dict[str, Any]]]:
        """The entries on disk; anything that isn't the expected shape is ignored."""
        try:
            data = json.loads(self.path.read_bytes().decode("utf-8"))
        except (OSError, ValueError, UnicodeDecodeError):
            return {}
        if not isinstance(data, dict) or data.get("v") != _VERSION:
            return {}
        raw = data.get("entries")
        if not isinstance(raw, dict):
            return {}
        entries: dict[str, tuple[str, dict[str, Any]]] = {}
        for rel, entry in raw.items():
            if (
                isinstance(rel, str)
                and isinstance(entry, list)
                and len(entry) == 2
                and isinstance(entry[0], str)
                and isinstance(entry[1], dict)
            ):
                entries[rel] = (entry[0], entry[1])
        return entries

    def _ensure(self) -> dict[str, tuple[str, dict[str, Any]]]:
        if self._entries is None:
            self._entries = self._load()
        return self._entries

    def flush(self) -> None:
        """Write the entries now (a no-op when nothing changed or the dir can't be written)."""
        with self._lock:
            if self._dirty_since is None or self._entries is None or self._unwritable:
                return
            self._dirty_since = None
            for rel in [r for r in self._entries if not (self.root / r).is_file()]:
                del self._entries[rel]
            payload = {"v": _VERSION, "entries": {r: [h, fm] for r, (h, fm) in self._entries.items()}}
            data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                atomic_write(self.path, data)
            except OSError:
                self._unwritable = True  # a read-only location: parse as if there were no cache

    def _flush_if_due(self) -> None:
        if self._dirty_since is not None and time.monotonic() - self._dirty_since >= _FLUSH_AFTER:
            self.flush()

    # -- lookups ---------------------------------------------------------------

    def get(self, rel: str, src: str) -> dict[str, Any] | None:
        """The parsed frontmatter of ``rel`` when ``src`` is the text it was parsed from, else None."""
        with self._lock:
            entry = self._ensure().get(rel)
            hit = copy.deepcopy(entry[1]) if entry is not None and entry[0] == _digest(src) else None
        self._flush_if_due()
        return hit

    def put(self, rel: str, src: str, fm: dict[str, Any]) -> None:
        """Remember that ``src`` parses to ``fm`` (skipped when ``fm`` doesn't survive JSON)."""
        try:
            stored = json.loads(json.dumps(fm, ensure_ascii=False))
        except (TypeError, ValueError):
            return
        if stored != fm:
            return  # non-string keys, NaN...: parse it every time rather than cache a different value
        with self._lock:
            self._ensure()[rel] = (_digest(src), stored)
            if self._dirty_since is None:
                self._dirty_since = time.monotonic()
        self._flush_if_due()


_caches: dict[str, FrontmatterCache] = {}
_caches_lock = threading.Lock()


def for_root(root: Path) -> FrontmatterCache:
    """The one cache of the space at ``root`` in this process."""
    key = os.fspath(root)
    with _caches_lock:
        cache = _caches.get(key)
        if cache is None:
            cache = _caches[key] = FrontmatterCache(root)
        return cache


def flush_all() -> None:
    """Write every space's pending entries (run at interpreter exit)."""
    with _caches_lock:
        caches = list(_caches.values())
    for cache in caches:
        cache.flush()


atexit.register(flush_all)
