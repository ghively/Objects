"""Full-text search over an agent's own chats (M18): ``session_search`` and the Chats tab.

The index is ``<folder>/.object-agent/cache/sessions.db`` (SQLite FTS5), derived from the
transcripts in ``.object-agent/sessions/`` only: deleting it loses nothing. `sync` re-reads only
transcripts whose size or mtime changed and drops the rows of removed ones. A database that can't
be opened, or whose ``meta.version`` isn't `INDEX_VERSION`, is deleted and rebuilt.

Only user and assistant text is indexed (tool lines are not). Nothing here writes outside the
cache folder, and no model is called. One connection per call; a lock per folder serialises `sync`.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

from . import transcripts
from .agentmodel import SESSIONS_DIR
from .learningmodel import CACHE_DB, SESSION_READ_CAP
from .searchindex import build_match

__all__ = ["INDEX_VERSION", "read_chat", "search", "sync"]

_log = logging.getLogger(__name__)

INDEX_VERSION = 1
_TIMEOUT = 5.0
_MAX_SNIPPETS = 3
_MESSAGE_TYPES = ("user", "assistant")

_SCHEMA = (
    "CREATE VIRTUAL TABLE msgs USING fts5(chat_id UNINDEXED, role UNINDEXED, at UNINDEXED, text, "
    "tokenize='unicode61 remove_diacritics 2')",
    "CREATE TABLE files(chat_id TEXT PRIMARY KEY, size INTEGER, mtime_ns INTEGER, title TEXT, "
    "updated_at TEXT, space_name TEXT)",
    "CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)",
)
_SNIPPET = "snippet(msgs, 3, '«', '»', '…', 12)"

_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def _lock_for(folder: Path) -> threading.Lock:
    key = os.path.normcase(os.path.abspath(folder))
    with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = _locks[key] = threading.Lock()
        return lock


def _db_path(folder: Path) -> Path:
    return Path(folder) / CACHE_DB


def _sessions(folder: Path) -> Path:
    return Path(folder) / SESSIONS_DIR


def _connect(db: Path) -> sqlite3.Connection:
    return sqlite3.connect(db, timeout=_TIMEOUT)


def _remove_db(db: Path) -> None:
    for suffix in ("", "-journal", "-wal", "-shm"):
        try:
            os.remove(str(db) + suffix)
        except FileNotFoundError:
            pass


def _create(conn: sqlite3.Connection) -> None:
    with conn:
        for stmt in _SCHEMA:
            conn.execute(stmt)
        conn.execute("INSERT INTO meta(key, value) VALUES ('version', ?)", (str(INDEX_VERSION),))


def _usable(conn: sqlite3.Connection) -> bool:
    """True for a current index; creates the tables in an empty database. Raises DatabaseError
    for a file that isn't a database."""
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master")}
    if not names:
        _create(conn)
        return True
    if not {"msgs", "files", "meta"} <= names:
        return False
    row = conn.execute("SELECT value FROM meta WHERE key = 'version'").fetchone()
    if row is None or row[0] != str(INDEX_VERSION):
        return False
    conn.execute("SELECT count(*) FROM files").fetchone()
    conn.execute("SELECT count(*) FROM msgs").fetchone()
    return True


def _open(folder: Path) -> sqlite3.Connection:
    """A connection to a current index, rebuilding the file when it is unreadable or old."""
    db = _db_path(folder)
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = _connect(db)
    try:
        if _usable(conn):
            return conn
        _log.info("chat search index %s is of another version; rebuilding", db)
    except sqlite3.DatabaseError as exc:
        _log.info("chat search index %s is unreadable (%s); rebuilding", db, exc)
    conn.close()
    _remove_db(db)
    conn = _connect(db)
    try:
        _create(conn)
    except BaseException:
        conn.close()
        raise
    return conn


def _transcript_files(folder: Path) -> dict[str, os.stat_result]:
    out: dict[str, os.stat_result] = {}
    try:
        entries = list(_sessions(folder).iterdir())
    except OSError:
        return out
    for entry in entries:
        if entry.suffix != ".jsonl" or not transcripts._CHAT_ID_RE.match(entry.stem):
            continue
        try:
            st = entry.stat()
        except OSError:
            continue
        out[entry.stem] = st
    return out


def _describe(lines: list[dict[str, Any]]) -> tuple[str, str, str | None, list[tuple[str, str, str]]]:
    header = lines[0] if lines and lines[0].get("type") == "chat" else {}
    space = header.get("space")
    updated = str(header.get("createdAt") or "")
    msgs: list[tuple[str, str, str]] = []
    for line in lines:
        at = line.get("at")
        if isinstance(at, str) and at > updated:
            updated = at
        if line.get("type") in _MESSAGE_TYPES:
            text = line.get("text")
            if isinstance(text, str) and text.strip():
                msgs.append((str(line["type"]), str(at or ""), text))
    title = str(header.get("title") or "AI chat")
    space_name = space.get("name") if isinstance(space, dict) else None
    return title, updated, space_name if isinstance(space_name, str) else None, msgs


def _sync(conn: sqlite3.Connection, folder: Path) -> None:
    on_disk = _transcript_files(folder)
    known = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT chat_id, size, mtime_ns FROM files")}
    with conn:
        for chat_id in known.keys() - on_disk.keys():
            conn.execute("DELETE FROM msgs WHERE chat_id = ?", (chat_id,))
            conn.execute("DELETE FROM files WHERE chat_id = ?", (chat_id,))
        for chat_id, st in on_disk.items():
            if known.get(chat_id) == (st.st_size, st.st_mtime_ns):
                continue
            try:
                lines = transcripts.raw_lines(folder, chat_id)
            except (OSError, ValueError):
                continue
            title, updated, space_name, msgs = _describe(lines)
            conn.execute("DELETE FROM msgs WHERE chat_id = ?", (chat_id,))
            conn.executemany("INSERT INTO msgs(chat_id, role, at, text) VALUES (?, ?, ?, ?)",
                             [(chat_id, role, at, text) for role, at, text in msgs])
            conn.execute(
                "INSERT OR REPLACE INTO files(chat_id, size, mtime_ns, title, updated_at, space_name) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (chat_id, st.st_size, st.st_mtime_ns, title, updated, space_name),
            )


def sync(folder: Path) -> None:
    """(Re)index changed transcripts (by size and mtime_ns per file); drop removed ones.

    An agent with no sessions folder and no index yet is left as it is (nothing is written)."""
    folder = Path(folder)
    with _lock_for(folder):
        if not _sessions(folder).is_dir() and not _db_path(folder).exists():
            return
        conn = _open(folder)
        try:
            _sync(conn, folder)
        finally:
            conn.close()


def search(folder: Path, query: str, *, limit: int = 10) -> list[dict[str, Any]]:
    """ChatSearchHit list, best first: {"chatId","title","updatedAt","spaceName","snippets","matches"}."""
    folder = Path(folder)
    match = build_match(query or "")
    if match is None or limit < 1:
        return []
    sync(folder)
    db = _db_path(folder)
    if not db.exists():
        return []
    conn = _connect(db)
    try:
        rows = conn.execute(
            f"SELECT chat_id, {_SNIPPET}, rank FROM msgs WHERE msgs MATCH ? ORDER BY rank", (match,)
        ).fetchall()
        files = {r[0]: r[1:] for r in conn.execute("SELECT chat_id, title, updated_at, space_name FROM files")}
    except sqlite3.Error as exc:
        _log.info("chat search query %r failed: %s", query, exc)
        return []
    finally:
        conn.close()
    hits: dict[str, dict[str, Any]] = {}
    best: dict[str, float] = {}
    for chat_id, snip, rank in rows:
        hit = hits.get(chat_id)
        if hit is None:
            title, updated, space_name = files.get(chat_id, ("AI chat", "", None))
            hit = hits[chat_id] = {"chatId": chat_id, "title": title, "updatedAt": updated or "",
                                   "spaceName": space_name, "snippets": [], "matches": 0}
            best[chat_id] = rank
        hit["matches"] += 1
        if len(hit["snippets"]) < _MAX_SNIPPETS:
            hit["snippets"].append(" ".join(str(snip).split()))
    ordered = sorted(hits.values(), key=lambda h: h["updatedAt"], reverse=True)
    ordered.sort(key=lambda h: best[h["chatId"]])
    return ordered[:limit]


def read_chat(folder: Path, chat_id: str, *, cap: int = SESSION_READ_CAP) -> dict[str, Any]:
    """{"chatId","title","createdAt","messages": [{"role","text","at"}],"truncated"}: user and
    assistant messages in order, at most `cap` characters, cut from the oldest.

    FileNotFoundError for an unknown chat; ValueError for an id that isn't a chat id."""
    lines = transcripts.raw_lines(Path(folder), chat_id)
    header = lines[0] if lines and lines[0].get("type") == "chat" else {}
    messages = [
        {"role": str(line["type"]), "text": str(line.get("text") or ""), "at": str(line.get("at") or "")}
        for line in lines
        if line.get("type") in _MESSAGE_TYPES
    ]
    total = sum(len(m["text"]) for m in messages)
    truncated = False
    while total > cap and len(messages) > 1:
        total -= len(messages.pop(0)["text"])
        truncated = True
    if messages and total > cap:
        keep = max(cap, 0)
        messages[0]["text"] = messages[0]["text"][-keep:] if keep else ""
        truncated = True
    return {
        "chatId": chat_id,
        "title": str(header.get("title") or "AI chat"),
        "createdAt": str(header.get("createdAt") or ""),
        "messages": messages,
        "truncated": truncated,
    }
