"""The full-text search index (M5): SQLite FTS5 in the space's ``.object-cache/``.

Derived data only: deleting the cache loses nothing. One connection behind a
lock; one thread syncs the index with the scan at start-up (re-indexing only
paths whose version changed, so a second start on an unchanged space writes
nothing) and then follows `Space.add_listener` changes, debounced 200 ms.

A corrupt or old-format cache is rebuilt; an unwritable folder or a lock that
persists for 2 s falls back to an in-memory index for this run. The index
never writes anything in the space outside its cache folder, and there only
``search.sqlite`` (with its transient journal) and ``.gitignore`` (``*``).
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import queue
import re
import sqlite3
import threading
import time
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import fuzzy
from .searchtext import display_safe, plain_body, property_text
from .space import SpaceChange, version_of
from .textfile import atomic_write
from .typemodel import Icon
from .whiteboardindex import board_for_index
from .whiteboardtrash import board_text

if TYPE_CHECKING:
    from .space import Space

__all__ = [
    "DB_NAME",
    "INDEX_FORMAT",
    "MAX_LIMIT",
    "SearchIndex",
    "build_match",
    "cache_dir_for",
]

_log = logging.getLogger(__name__)

INDEX_FORMAT = 1
"""``PRAGMA user_version`` of the index; a mismatch rebuilds it."""
DB_NAME = "search.sqlite"
JOURNAL_NAME = DB_NAME + "-journal"
CACHE_FOLDER = ".object-cache"
MAX_LIMIT = 200
DEBOUNCE_S = 0.2
LOCK_TIMEOUT_S = 2.0
_CHUNK = 250
_TYPES_KEY = ""
"""The ``meta`` row holding the fingerprint of the type definitions ``props`` was built with."""

# fts columns: path, type (unindexed), then the searchable ones in this order.
_COLUMNS = ("title", "aliases", "description", "props", "body", "tags")
_FIELD = {
    "title": "title",
    "aliases": "aliases",
    "description": "description",
    "props": "properties",
    "body": "blocksContent",
    "tags": "tags",
}
_BM25 = "bm25(fts, 0, 0, 10, 8, 3, 2, 1, 5)"
_SNIPPET_TOKENS = 12
_HL_OPEN, _HL_CLOSE = "\u0002", "\u0003"

_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS meta(path TEXT PRIMARY KEY, version TEXT NOT NULL)",
    (
        "CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(path UNINDEXED, type UNINDEXED, "
        "title, aliases, description, props, body, tags, "
        "tokenize='unicode61 remove_diacritics 2', prefix='2 3')"
    ),
    "CREATE VIRTUAL TABLE IF NOT EXISTS vocab USING fts5vocab(fts, 'row')",
)
_TABLES = ("vocab", "fts", "meta")

_TERM_RE = re.compile(r"[^\W_]+")
_FTS_WORDS = frozenset({"and", "or", "not", "near"})
_RELATED_TERMS = 12


def cache_dir_for(space: Space) -> Path:
    """Where ``space``'s index lives: ``<space>/.object-cache``, or under ``OBJECT_CACHE_DIR``."""
    override = os.environ.get("OBJECT_CACHE_DIR")
    if override:
        digest = hashlib.sha256(str(space.root).encode("utf-8")).hexdigest()[:16]
        return Path(override) / digest
    return space.root / CACHE_FOLDER


def _quote(token: str) -> str:
    return '"' + token.replace('"', '""') + '"'


def build_match(q: str) -> str | None:
    """The FTS5 query for what was typed: each 2+ character token a quoted prefix term, AND-ed.

    Quoting neutralises the FTS syntax (``"``, ``*``, ``-``, ``:``, AND/OR/NOT/NEAR).
    Tokens without a letter or digit can't match anything and are dropped.
    """
    terms = [
        _quote(tok) + "*"
        for tok in q.split()
        if len(tok) >= 2 and _TERM_RE.search(tok) is not None
    ]
    return " AND ".join(terms) if terms else None


def _clean_snippet(text: str) -> str:
    return " ".join(text.split())


def _fold_terms(text: str) -> list[str]:
    return [fuzzy.fold(m.group()) for m in _TERM_RE.finditer(text)]


class _Fallback(Exception):
    """The on-disk index can't be used: switch to memory."""


class SearchIndex:
    def __init__(self, space: Space, cache_dir: Path | None = None) -> None:
        self.space = space
        self.cache_dir = (
            Path(cache_dir) if cache_dir is not None else cache_dir_for(space)
        )
        self.ready = threading.Event()
        """Set once the start-up sync (or a reindex) has finished."""
        self.in_memory = False
        """True when the index runs in memory for this run (unwritable or locked cache)."""
        self.sync_gate: threading.Event | None = None
        """Test hook: when set before `start`, the sync waits until this event is set."""
        self.started = False
        self.stopped = False
        self._db_lock = threading.RLock()
        self._conn: sqlite3.Connection | None = None
        self._queue: queue.SimpleQueue = queue.SimpleQueue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._unsubscribe = None
        self._fallback_logged = False
        self._pending: dict[str, int] = {}
        """Path -> change count, for the objects whose change the thread has not applied yet
        (see `pending_paths`); the count tells an apply step whether a newer change arrived."""
        self._pending_lock = threading.Lock()

    def pending_paths(self) -> set[str]:
        """The paths changed since the index last applied them (the debounce window).

        A reader that pre-filters by the index (`references.unlinked_mentions`) scans
        these too, so a fresh edit is never missed; cheaper than comparing every
        object's version against the stored one (audit 2026-11-01 B6).
        """
        with self._pending_lock:
            return set(self._pending)

    def _settle_pending(self, seen: dict[str, int]) -> None:
        """Forget the pending paths whose change count is still what `seen` recorded."""
        with self._pending_lock:
            for path, count in seen.items():
                if self._pending.get(path) == count:
                    del self._pending[path]

    # -- lifecycle -----------------------------------------------------------------

    def start(self) -> None:
        """Open the index and sync it on a thread; then follow the space's changes."""
        if self.started:
            return
        self.started = True
        self._unsubscribe = self.space.add_listener(self._on_change)
        self._thread = threading.Thread(
            target=self._run, name="search-index", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        """Stop following changes, join the thread and close the database."""
        self.stopped = True
        if self._unsubscribe is not None:
            self._unsubscribe()
            self._unsubscribe = None
        self._stop.set()
        if self.sync_gate is not None:
            self.sync_gate.set()
        self._queue.put(("stop", None))
        if self._thread is not None:
            self._thread.join(timeout=60)
            self._thread = None
        with self._db_lock:
            if self._conn is not None:
                try:
                    self._conn.close()
                except sqlite3.Error:
                    pass
                self._conn = None

    def _on_change(self, change: SpaceChange) -> None:
        # A listener only enqueues (it may run under the space lock).
        if change.kind == "object" and change.path:
            with self._pending_lock:
                self._pending[change.path] = self._pending.get(change.path, 0) + 1
        self._queue.put((change.kind, change.path))

    def reindex(self) -> None:
        """Drop and rebuild the index in the background (``partial`` until done)."""
        self.ready.clear()
        self._queue.put(("reindex", None))

    # -- the thread ----------------------------------------------------------------

    def _run(self) -> None:
        try:
            self._open()
            if self.sync_gate is not None:
                self.sync_gate.wait()
            if self._stop.is_set():
                return
            self._guarded(self._sync)
            self.ready.set()
            self._loop()
        except Exception:  # noqa: BLE001 - the index must never take the app down
            _log.exception("The search index thread failed")

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                item = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            items = [item]
            deadline = time.monotonic() + DEBOUNCE_S
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    items.append(self._queue.get(timeout=remaining))
                except queue.Empty:
                    break
            if any(kind == "stop" for kind, _ in items):
                return
            reindex = any(kind == "reindex" for kind, _ in items)
            types = any(kind == "types" for kind, _ in items)
            paths = {p for kind, p in items if kind == "object" and p}
            if reindex:
                self.ready.clear()
                self._guarded(self._rebuild)
                self.ready.set()
                continue
            if types:
                self._guarded(self._sync_types)
            if paths:
                self._guarded(lambda paths=paths: self._update_paths(sorted(paths)))

    def _guarded(self, fn) -> None:
        """Run a write step; on a lock or read-only failure, move to memory and rebuild there.

        Any other failure is logged and the thread carries on with the next change.
        """
        try:
            try:
                fn()
            except (sqlite3.OperationalError, _Fallback) as exc:
                if self.in_memory:
                    raise
                self._to_memory(exc)
                self._sync()
        except Exception:  # noqa: BLE001 - one bad step must not stop the index
            _log.exception("The search index could not apply a change")

    # -- opening -------------------------------------------------------------------

    def _db_path(self) -> Path:
        return self.cache_dir / DB_NAME

    def _inside_space(self) -> bool:
        try:
            self.cache_dir.resolve().relative_to(self.space.root.resolve())
        except ValueError:
            return False
        return True

    def _prepare_folder(self) -> None:
        folder = self.cache_dir
        if not folder.is_dir():
            folder.mkdir(parents=True, exist_ok=True)
        ignore = folder / ".gitignore"
        if self._inside_space() and not ignore.exists():
            atomic_write(ignore, b"*\n")

    def _open(self) -> None:
        try:
            self._prepare_folder()
            conn = self._open_file()
        except (OSError, sqlite3.Error, _Fallback) as exc:
            self._to_memory(exc)
            return
        with self._db_lock:
            self._conn = conn

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(
            str(self._db_path()),
            timeout=LOCK_TIMEOUT_S,
            isolation_level=None,
            check_same_thread=False,
        )
        return conn

    def _open_file(self) -> sqlite3.Connection:
        """Open the on-disk index, rebuilding a corrupt or old-format one."""
        for attempt in range(2):
            conn = self._connect()
            try:
                self._check_format(conn)
                return conn
            except sqlite3.OperationalError as exc:
                conn.close()
                msg = str(exc).lower()
                if (
                    "locked" in msg
                    or "busy" in msg
                    or "readonly" in msg
                    or "unable to open" in msg
                ):
                    raise _Fallback(str(exc)) from exc
                if attempt:
                    raise
                self._delete_own_files()
            except sqlite3.DatabaseError:
                conn.close()
                if attempt:
                    raise
                _log.info("The search cache is corrupt; rebuilding it")
                self._delete_own_files()
        raise _Fallback("cannot open the search cache")

    def _delete_own_files(self) -> None:
        for name in (DB_NAME, JOURNAL_NAME):
            p = self.cache_dir / name
            try:
                p.unlink()
            except FileNotFoundError:
                pass

    def _check_format(self, conn: sqlite3.Connection) -> None:
        """Make the schema current; writes only when something is missing or old."""
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        names = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table')"
            )
        }
        if version == INDEX_FORMAT and {"meta", "fts", "vocab"} <= names:
            conn.execute("SELECT count(*) FROM meta").fetchone()
            return
        conn.execute("BEGIN IMMEDIATE")
        try:
            if version != INDEX_FORMAT:
                for table in _TABLES:
                    conn.execute(f"DROP TABLE IF EXISTS {table}")
            for stmt in _SCHEMA:
                conn.execute(stmt)
            conn.execute(f"PRAGMA user_version = {INDEX_FORMAT}")
            conn.execute("COMMIT")
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise

    def _to_memory(self, exc: BaseException) -> None:
        if not self._fallback_logged:
            _log.warning("The search cache can't be used (%s); indexing in memory", exc)
            self._fallback_logged = True
        conn = sqlite3.connect(
            ":memory:", isolation_level=None, check_same_thread=False
        )
        for stmt in _SCHEMA:
            conn.execute(stmt)
        conn.execute(f"PRAGMA user_version = {INDEX_FORMAT}")
        with self._db_lock:
            old = self._conn
            self._conn = conn
            self.in_memory = True
        if old is not None:
            try:
                old.close()
            except sqlite3.Error:
                pass

    # -- documents -----------------------------------------------------------------

    def _snapshot(self) -> dict[str, tuple[Any, Any]]:
        """Path -> (raw, summary) of every indexable object (templates excluded)."""
        sp = self.space
        with sp._lock:
            return {
                rel: (raw, sp._summaries[rel])
                for rel, raw in sp._raw.items()
                if rel in sp._summaries and sp._summaries[rel].template is None
            }

    def _document(self, path: str) -> dict[str, str] | None:
        """The indexed columns of one object, or None when it isn't indexed (gone, template).

        The one place a document is built. A whiteboard's body column also holds its board's
        text blocks (M6).
        """
        sp = self.space
        with sp._lock:
            raw = sp._raw.get(path)
            summary = sp._summaries.get(path)
        if raw is None or summary is None or summary.template is not None:
            return None
        t = sp.type_by_id(summary.type)

        def link_title(target: str) -> str:
            hit = sp.resolve(target, path)
            if hit is None:
                return target
            s = sp._summaries.get(hit)
            return s.title if s is not None else target

        return {
            "type": summary.type,
            "title": display_safe(summary.title),
            "aliases": display_safe("\n".join(summary.aliases)),
            "description": display_safe(summary.description or ""),
            "props": property_text(t, raw.fm, link_title),
            "body": self._body_text(path, raw.of.body),
            "tags": display_safe("\n".join(summary.tags)),
        }

    def _body_text(self, path: str, body: str) -> str:
        text = plain_body(body)
        board, _revision = board_for_index(self.space, path)
        if board is not None:
            extra = plain_body(board_text(board))
            if extra:
                text = f"{text}\n\n{extra}" if text else extra
        return text

    def _version(self, path: str, raw) -> str:
        """The stored version of an object: its file's, plus its board file's for a whiteboard
        (so a board edit re-indexes the board without touching the ``.md``)."""
        version = version_of(raw.data)
        _board, board_revision = board_for_index(self.space, path)
        return f"{version}+{board_revision}" if board_revision else version

    def _type_fingerprints(self) -> dict[str, str]:
        """Type id -> a hash of what its definition contributes to the ``props`` column."""
        out: dict[str, str] = {}
        for t in self.space.types:
            shape = [
                (p.key, p.name, p.type, p.extra.get("isNotSearchable") is True)
                for p in t.propertyDefinitions
            ]
            out[t.id] = hashlib.sha256(json.dumps(shape).encode("utf-8")).hexdigest()
        return out

    def _types_fingerprint(self) -> str:
        """The stored ``meta`` row for the types: the per-type hashes as sorted JSON, so
        `_sync_types` can tell which types changed (audit 2026-11-01 P5)."""
        return json.dumps(self._type_fingerprints(), sort_keys=True, separators=(",", ":"))

    @staticmethod
    def _changed_types(stored: str | None, fingerprint: str) -> set[str] | None:
        """The type ids whose hash differs between two `_types_fingerprint` values; None
        when the stored value isn't in that format (every type counts as changed)."""
        try:
            before = json.loads(stored or "")
            after = json.loads(fingerprint)
        except ValueError:
            return None
        if not isinstance(before, dict) or not isinstance(after, dict):
            return None
        return {k for k in before.keys() | after.keys() if before.get(k) != after.get(k)}

    # -- writing -------------------------------------------------------------------

    def _write(self, fn) -> None:
        """Run ``fn(conn)`` in one write transaction."""
        with self._db_lock:
            conn = self._conn
            if conn is None:
                raise _Fallback("no database")
            conn.execute("BEGIN IMMEDIATE")
            try:
                fn(conn)
                conn.execute("COMMIT")
            except BaseException:
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise

    @staticmethod
    def _put(
        conn: sqlite3.Connection, path: str, version: str, doc: dict[str, str]
    ) -> None:
        row = conn.execute("SELECT rowid FROM meta WHERE path = ?", (path,)).fetchone()
        if row is not None:
            conn.execute("DELETE FROM fts WHERE rowid = ?", (row[0],))
            conn.execute(
                "UPDATE meta SET version = ? WHERE rowid = ?", (version, row[0])
            )
            rowid = row[0]
        else:
            rowid = conn.execute(
                "INSERT INTO meta(path, version) VALUES (?, ?)", (path, version)
            ).lastrowid
        conn.execute(
            "INSERT INTO fts(rowid, path, type, title, aliases, description, props, body, tags) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (rowid, path, doc["type"], *(doc[c] for c in _COLUMNS)),
        )

    @staticmethod
    def _drop(conn: sqlite3.Connection, path: str) -> None:
        row = conn.execute("SELECT rowid FROM meta WHERE path = ?", (path,)).fetchone()
        if row is not None:
            conn.execute("DELETE FROM fts WHERE rowid = ?", (row[0],))
            conn.execute("DELETE FROM meta WHERE rowid = ?", (row[0],))

    def _stored(self) -> dict[str, str]:
        with self._db_lock:
            if self._conn is None:
                return {}
            return dict(self._conn.execute("SELECT path, version FROM meta").fetchall())

    def _sync(self) -> None:
        """Bring the index in line with the scan; writes only what changed."""
        stored = self._stored()
        stored_types = stored.pop(_TYPES_KEY, None)
        fingerprint = self._types_fingerprint()
        with self._pending_lock:
            was_pending = dict(self._pending)  # changes the snapshot below includes
        current = self._snapshot()
        gone = [p for p in stored if p not in current]
        changed = [
            p
            for p, (raw, _s) in current.items()
            if stored.get(p) != self._version(p, raw)
        ]
        if stored_types != fingerprint and stored:
            # Property definitions changed while we were away: every props column may differ.
            changed = sorted(set(changed) | set(current))
        if gone:
            self._write(lambda conn: [self._drop(conn, p) for p in gone])
        self._index(sorted(changed))
        if stored_types != fingerprint:
            self._write(lambda conn: self._put_types_key(conn, fingerprint))
        self._settle_pending(was_pending)

    @staticmethod
    def _put_types_key(conn: sqlite3.Connection, fingerprint: str) -> None:
        conn.execute(
            "INSERT INTO meta(path, version) VALUES (?, ?) "
            "ON CONFLICT(path) DO UPDATE SET version = excluded.version",
            (_TYPES_KEY, fingerprint),
        )

    def _index(self, paths: list[str]) -> None:
        """(Re-)index ``paths`` in chunks, so searches can run in between."""
        for i in range(0, len(paths), _CHUNK):
            if self._stop.is_set():
                return
            batch: list[tuple[str, str | None, dict[str, str] | None]] = []
            for p in paths[i : i + _CHUNK]:
                with self.space._lock:
                    raw = self.space._raw.get(p)
                doc = self._document(p) if raw is not None else None
                batch.append(
                    (p, self._version(p, raw) if raw is not None else None, doc)
                )

            def apply(conn: sqlite3.Connection, batch=batch) -> None:
                for p, version, doc in batch:
                    if doc is None or version is None:
                        self._drop(conn, p)
                    else:
                        self._put(conn, p, version, doc)

            self._write(apply)

    def _update_paths(self, paths: list[str]) -> None:
        with self._pending_lock:
            seen = {p: self._pending[p] for p in paths if p in self._pending}
        stored = self._stored()
        todo = []
        for p in paths:
            with self.space._lock:
                raw = self.space._raw.get(p)
                summary = self.space._summaries.get(p)
            if raw is None or summary is None or summary.template is not None:
                if p in stored:
                    todo.append(p)
            elif stored.get(p) != self._version(p, raw):
                todo.append(p)
        if todo:
            self._index(todo)
        self._settle_pending(seen)

    def _sync_types(self) -> None:
        """A type changed: re-index the ``props`` of objects whose text differs."""
        fingerprint = self._types_fingerprint()
        stored = self._stored()
        if stored.get(_TYPES_KEY) == fingerprint:
            return
        # Only the changed types' members can have a different ``props`` column, plus any
        # object whose stored type isn't its current one (its type resolved differently
        # after the change). Documenting all 5,001 objects took 7 s (audit 2026-11-01 P5).
        changed = self._changed_types(stored.get(_TYPES_KEY), fingerprint)
        with self._db_lock:
            rows = self._conn.execute(
                "SELECT m.path, f.props, f.type FROM fts f JOIN meta m ON m.rowid = f.rowid"
            ).fetchall()
        indexed = {path: (props, type_id) for path, props, type_id in rows}
        updates: list[str] = []
        for p, (_raw, summary) in self._snapshot().items():
            row = indexed.get(p)
            if (
                changed is not None
                and summary.type not in changed
                and row is not None
                and row[1] == summary.type
            ):
                continue
            doc = self._document(p)
            if doc is None:
                continue
            if row is None or row[0] != doc["props"] or row[1] != doc["type"]:
                updates.append(p)
        self._index(updates)
        self._write(lambda conn: self._put_types_key(conn, fingerprint))

    def _rebuild(self) -> None:
        if not self.in_memory:
            # Reopen the file first: the cache may have been deleted while the app ran (the
            # old connection then points at an unlinked file SQLite can no longer write).
            with self._db_lock:
                old, self._conn = self._conn, None
            if old is not None:
                try:
                    old.close()
                except sqlite3.Error:
                    pass
            self._open()

        def drop(conn: sqlite3.Connection) -> None:
            for table in _TABLES:
                conn.execute(f"DROP TABLE IF EXISTS {table}")
            for stmt in _SCHEMA:
                conn.execute(stmt)

        self._write(drop)
        with self._db_lock:
            self._conn.execute(f"PRAGMA user_version = {INDEX_FORMAT}")
        self._sync()

    # -- reading -------------------------------------------------------------------

    def _query(self, sql: str, params: tuple | list) -> list[tuple]:
        with self._db_lock:
            conn = self._conn
            if conn is None:
                return []
            try:
                return conn.execute(sql, params).fetchall()
            except sqlite3.Error:
                return []

    def search(
        self,
        q: str,
        types: tuple[str, ...] | list[str] = (),
        exclude_types: tuple[str, ...] | list[str] = (),
        tag: str | None = None,
        limit: int = 50,
        mode: str = "auto",
    ) -> dict[str, Any]:
        """Search titles, aliases and (unless ``mode == 'title'``) the full text.

        Title and alias matches come first (fuzzy score), then full-text hits by
        ``bm25``; an object found both ways keeps its title rank and gains its
        snippets. ``mode == 'fullText'`` ("Text matches only", M8) skips the title
        and alias ranking and matches the body (blocks content) column only.
        ``partial`` is true until the start-up sync has finished.
        """
        partial = not self.ready.is_set()
        q = (q or "").strip()
        if not q:
            return {"results": [], "partial": partial}
        limit = max(1, min(int(limit), MAX_LIMIT))
        type_set = set(types)
        exclude_set = set(exclude_types)
        tag_key = tag.strip().casefold() if tag and tag.strip() else None
        sp = self.space

        with sp._lock:
            summaries = [s for s in sp._summaries.values() if s.template is None]

        def allowed(s) -> bool:
            if type_set and s.type not in type_set:
                return False
            if s.type in exclude_set:
                return False
            return tag_key is None or tag_key in {x.casefold() for x in s.tags}

        candidates = {s.path: s for s in summaries if allowed(s)}

        titled: list[tuple[int, str, str, list[tuple[int, int]]]] = []
        for s in candidates.values() if mode != "fullText" else ():
            best: tuple[int, list[tuple[int, int]]] | None = fuzzy.score(q, s.title)
            for alias in s.aliases:
                hit = fuzzy.score(q, alias)
                if hit is not None and (
                    best is None or hit[0] - fuzzy.ALIAS_PENALTY > best[0]
                ):
                    # An alias match carries no title spans.
                    best = (hit[0] - fuzzy.ALIAS_PENALTY, [])
            if best is not None:
                titled.append((best[0], s.title.casefold(), s.path, best[1]))
        titled.sort(key=lambda r: (-r[0], r[1], r[2]))

        match = build_match(q) if mode != "title" else None
        if match is not None and mode == "fullText":
            match = f"body : ({match})"
        fts_order: list[tuple[str, float]] = []
        if match is not None and len(titled) < limit:
            fts_order = self._fts_rank(match, candidates, type_set, limit)

        picked: list[tuple[Any, float, list[tuple[int, int]]]] = []
        seen: set[str] = set()
        for value, _t, path, spans in titled[:limit]:
            picked.append((candidates[path], value, spans))
            seen.add(path)
        for path, rank in fts_order:
            if len(picked) >= limit:
                break
            if path in seen:
                continue
            picked.append((candidates[path], rank, []))
            seen.add(path)

        highlights = self._snippets(match, list(seen)) if match is not None else {}
        results = [
            self._result(s, value, spans, highlights.get(s.path, []))
            for s, value, spans in picked
        ]
        return {"results": results, "partial": partial}

    def _fts_rank(
        self, match: str, candidates: dict[str, Any], type_set: set[str], limit: int
    ) -> list[tuple[str, float]]:
        """Full-text hits among ``candidates``, best ``bm25`` first."""
        where = "fts MATCH ?"
        params: list[Any] = [match]
        if type_set:
            where += f" AND type IN ({', '.join('?' for _ in type_set)})"
            params.extend(sorted(type_set))
        # Over-fetch: the tag and exclude filters apply afterwards, and title hits may repeat.
        fetch = min(limit * 4 + 50, 1000)
        # Rowids only: selecting ``path`` here would read it from the content table for
        # every hit before the sort (audit 2026-11-01 B9); `meta` names the kept ones.
        with self._db_lock:
            rows = self._query(
                f"SELECT rowid, {_BM25} AS r FROM fts WHERE {where} ORDER BY r LIMIT ?",
                [*params, fetch],
            )
            names = dict(
                self._query(
                    f"SELECT rowid, path FROM meta WHERE rowid IN ({', '.join('?' for _ in rows)})",
                    [rowid for rowid, _r in rows],
                )
            ) if rows else {}
        return [
            (p, round(-float(r), 4))
            for rowid, r in rows
            if (p := names.get(rowid)) is not None and p in candidates
        ]

    def _snippets(
        self, match: str, paths: list[str]
    ) -> dict[str, list[dict[str, Any]]]:
        """``FullTextSearchHighlight``s of ``paths`` for ``match``: one per matched column."""
        if not paths:
            return {}
        snippets = ", ".join(
            f"snippet(fts, {i + 2}, '{_HL_OPEN}', '{_HL_CLOSE}', '…', {_SNIPPET_TOKENS})"
            for i in range(len(_COLUMNS))
        )
        # ``+rowid`` keeps the filter out of FTS5's plan: the match runs once and each hit
        # is kept or dropped by its rowid. ``path IN`` read every hit's path (audit
        # 2026-11-01 B9), and a plain ``rowid IN`` re-runs the match once per rowid.
        rows = self._query(
            f"SELECT path, {snippets} FROM fts WHERE fts MATCH ? AND +rowid IN "
            f"(SELECT rowid FROM meta WHERE path IN ({', '.join('?' for _ in paths)}))",
            [match, *paths],
        )
        out: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            hl = []
            for col, text in zip(_COLUMNS, row[1:], strict=True):
                if text and _HL_OPEN in text:
                    hl.append(
                        {"field": _FIELD[col], "snippets": [_clean_snippet(text)]}
                    )
            out[row[0]] = hl
        return out

    def _result(
        self,
        s: Any,
        score: float,
        spans: list[tuple[int, int]],
        hl: list[dict[str, Any]],
    ) -> dict[str, Any]:
        icon = Icon.parse(s.icon)
        if icon is not None and s.iconColor:
            icon = Icon(icon.type, icon.val, s.iconColor)
        return {
            "path": s.path,
            "title": s.title,
            "type": s.type,
            "icon": icon.to_json() if icon is not None else None,
            "tags": list(s.tags),
            "score": score,
            "titleMatches": [[a, b] for a, b in spans],
            "highlights": hl,
        }

    def phrase_candidates(self, text: str) -> set[str] | None:
        """The paths whose body holds the phrase ``text``; None before the index is ready."""
        if not self.ready.is_set():
            return None
        if not _TERM_RE.search(text or ""):
            return set()
        with self._db_lock:
            conn = self._conn
            if conn is None:
                return None
            try:
                rows = conn.execute(
                    "SELECT path FROM fts WHERE fts MATCH ?",
                    ("body : " + _quote(text),),
                ).fetchall()
            except sqlite3.Error:
                return None
        return {r[0] for r in rows}

    def similar(self, path: str, limit: int) -> list[tuple[str, float]]:
        """Objects sharing ``path``'s strongest terms (tf-idf), best first; never ``path`` itself.

        A lexical stand-in for semantic related content.
        """
        if not self.ready.is_set() or limit <= 0:
            return []
        rows = self._query(
            "SELECT f.title, f.aliases, f.description, f.props, f.body, f.tags "
            "FROM fts f JOIN meta m ON m.rowid = f.rowid WHERE m.path = ?",
            (path,),
        )
        if not rows:
            return []
        tf = Counter(
            t for t in _fold_terms(" ".join(rows[0])) if len(t) >= 3 and not t.isdigit()
        )
        if not tf:
            return []
        terms = list(tf)
        df: dict[str, int] = {}
        for i in range(0, len(terms), 500):
            chunk = terms[i : i + 500]
            got = self._query(
                f"SELECT term, doc FROM vocab WHERE term IN ({', '.join('?' for _ in chunk)})",
                chunk,
            )
            df.update({t: d for t, d in got})
        total = self._query("SELECT count(*) FROM meta WHERE path != ''", ())
        n = max(total[0][0] if total else 1, 1)
        weighted = sorted(
            (
                (tf[t] * math.log((n + 1) / (df[t] + 0.5)), t)
                for t in terms
                if df.get(t)
            ),
            key=lambda x: (-x[0], x[1]),
        )
        strongest = [t for _w, t in weighted[:_RELATED_TERMS] if t not in _FTS_WORDS]
        if not strongest:
            return []
        match = " OR ".join(_quote(t) for t in strongest)
        got = self._query(
            f"SELECT path, {_BM25} AS r FROM fts WHERE fts MATCH ? AND path != ? "
            "ORDER BY r LIMIT ?",
            (match, path, limit),
        )
        return [(p, round(-float(r), 4)) for p, r in got]
