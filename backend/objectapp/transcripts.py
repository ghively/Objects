"""Per-agent chat transcripts: one append-only JSONL file per chat.

The file is ``<folder>/.object-agent/sessions/<chatId>.jsonl``, UTF-8, one JSON
object per line. The first line is the header (``{"type": "chat", "v": 1, ...}``);
then ``user``, ``tool``, ``assistant``, ``error`` and ``object`` lines follow. A
line that doesn't parse (a torn last line) is skipped on read, and the next
append starts on a fresh line so it isn't lost to the torn one.

The header's ``title`` is fixed at the first message: callers pass
``aichat.default_title([{"role": "user", "text": <first message>}])``.

M18 adds two line types. A ``memory`` line (the chat's frozen memory snapshot) is never an item.
``review`` lines (a background review's start and end, sharing an ``id``) read as one
``learning`` item per review, at the start line's place, with the end line's state, summary and
message. Unknown line types are skipped. `raw_lines` gives every parsable line, header included.

M20 adds a delegated chat's header keys ``from`` (the delegating agent's id) and ``fromChat`` (its
chat), and a remote agent's assistant lines carry ``a2a`` (``{contextId, taskId, state}``) and
``attachments`` (`RemoteAttachment` list); `read` keeps both on the items.
"""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path
from typing import Any

from .agentmodel import SESSIONS_DIR
from .ids import new_ulid

TRANSCRIPT_VERSION = 1
CHAT_ID = r"^[0-9A-HJKMNP-TV-Z]{26}$"
_CHAT_ID_RE = re.compile(CHAT_ID)
_ITEM_TYPES = ("user", "assistant", "tool", "error")
_MESSAGE_TYPES = ("user", "assistant")

_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def _lock_for(path: Path) -> threading.Lock:
    key = os.path.normcase(os.path.abspath(path))
    with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = _locks[key] = threading.Lock()
        return lock


def _dumps(obj: dict[str, Any]) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"


def new_chat_id() -> str:
    return new_ulid()


def path_for(folder: Path, chat_id: str) -> Path:
    """The transcript file of `chat_id`; ValueError unless it is a ULID."""
    if not isinstance(chat_id, str) or not _CHAT_ID_RE.match(chat_id):
        raise ValueError(f"not a chat id: {chat_id!r}")
    return Path(folder) / SESSIONS_DIR / f"{chat_id}.jsonl"


def start(folder: Path, chat_id: str, *, agent_id: str, title: str, space_name: str | None,
          space_key: str | None, created_at: str, delegated: bool = False,
          delegated_from: str | None = None, from_chat: str | None = None) -> None:
    """Write the header line, only when the transcript is new. A delegated chat's header also
    names the delegating agent (``from``) and its chat (``fromChat``) when given."""
    path = path_for(folder, chat_id)
    header = {
        "type": "chat",
        "v": TRANSCRIPT_VERSION,
        "id": chat_id,
        "agentId": agent_id,
        "title": title,
        "createdAt": created_at,
        "space": {"name": space_name, "key": space_key} if (space_name or space_key) else None,
        "delegated": delegated,
    }
    if delegated_from is not None:
        header["from"] = delegated_from
    if from_chat is not None:
        header["fromChat"] = from_chat
    with _lock_for(path):
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(path, "xb") as f:
                f.write(_dumps(header))
        except FileExistsError:
            pass


def append(folder: Path, chat_id: str, lines: list[dict[str, Any]]) -> None:
    """Append `lines` in one write (a lock per file)."""
    path = path_for(folder, chat_id)
    if not lines:
        return
    data = b"".join(_dumps(line) for line in lines)
    with _lock_for(path):
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a+b") as f:
            f.seek(0, os.SEEK_END)
            if f.tell() > 0:
                f.seek(-1, os.SEEK_END)
                if f.read(1) != b"\n":
                    data = b"\n" + data
                f.seek(0, os.SEEK_END)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())


def _parse(path: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in path.read_bytes().split(b"\n"):
        if not raw.strip():
            continue
        try:
            obj = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out


def _item(line: dict[str, Any]) -> dict[str, Any]:
    kind = line["type"]
    at = str(line.get("at") or "")
    if kind == "user":
        paths = line.get("contextPaths")
        return {"type": "user", "text": str(line.get("text") or ""), "at": at,
                "contextPaths": [str(p) for p in paths] if isinstance(paths, list) else []}
    if kind == "assistant":
        item: dict[str, Any] = {"type": "assistant", "text": str(line.get("text") or ""), "at": at,
                                "model": line.get("model"), "sessionId": line.get("sessionId")}
        if line.get("stopped"):
            item["stopped"] = True
        if isinstance(line.get("a2a"), dict):
            item["a2a"] = line["a2a"]
        if isinstance(line.get("attachments"), list):
            item["attachments"] = [a for a in line["attachments"] if isinstance(a, dict)]
        return item
    if kind == "tool":
        inp = line.get("input")
        result = line.get("result")
        return {"type": "tool", "id": str(line.get("id") or ""), "name": str(line.get("name") or ""),
                "input": inp if isinstance(inp, dict) else None,
                "result": result if isinstance(result, str) or result is None else str(result),
                "isError": bool(line.get("isError")), "at": at}
    return {"type": "error", "message": str(line.get("message") or ""), "at": at}


def _learning(line: dict[str, Any]) -> dict[str, Any]:
    kinds = line.get("kinds")
    return {
        "type": "learning",
        "reviewId": str(line.get("id") or ""),
        "kinds": [str(k) for k in kinds] if isinstance(kinds, list) else [],
        "state": str(line.get("state") or "running"),
        "summary": line.get("summary") if isinstance(line.get("summary"), str) else None,
        "message": line.get("message") if isinstance(line.get("message"), str) else None,
        "at": str(line.get("at") or ""),
    }


def _review_end(item: dict[str, Any], line: dict[str, Any]) -> None:
    """A later ``review`` line of the same id: its state, summary and message win."""
    item["state"] = str(line.get("state") or item["state"])
    item["summary"] = line.get("summary") if isinstance(line.get("summary"), str) else None
    item["message"] = line.get("message") if isinstance(line.get("message"), str) else None
    kinds = line.get("kinds")
    if isinstance(kinds, list) and not item["kinds"]:
        item["kinds"] = [str(k) for k in kinds]


def _summarize(chat_id: str, lines: list[dict[str, Any]]) -> dict[str, Any]:
    header = lines[0] if lines and lines[0].get("type") == "chat" else {}
    space = header.get("space")
    created = str(header.get("createdAt") or "") or None
    updated = created
    items: list[dict[str, Any]] = []
    session_id: str | None = None
    object_path: str | None = None
    reviews: dict[str, dict[str, Any]] = {}
    for line in lines:
        kind = line.get("type")
        at = line.get("at")
        if isinstance(at, str) and at and (updated is None or at > updated):
            updated = at
        if kind in _ITEM_TYPES:
            item = _item(line)
            items.append(item)
            if kind == "assistant" and isinstance(item["sessionId"], str) and item["sessionId"]:
                session_id = item["sessionId"]
        elif kind == "object" and isinstance(line.get("path"), str):
            object_path = line["path"]
        elif kind == "review" and isinstance(line.get("id"), str) and line["id"]:
            known = reviews.get(line["id"])
            if known is None:
                reviews[line["id"]] = item = _learning(line)
                items.append(item)
            else:
                _review_end(known, line)
    return {
        "id": chat_id,
        "title": str(header.get("title") or "AI chat"),
        "createdAt": created or "",
        "updatedAt": updated or "",
        "messageCount": sum(1 for i in items if i["type"] in _MESSAGE_TYPES),
        "spaceName": space.get("name") if isinstance(space, dict) else None,
        "delegated": bool(header.get("delegated")),
        "from": header.get("from") if isinstance(header.get("from"), str) else None,
        "agentId": header.get("agentId"),
        "sessionId": session_id,
        "objectPath": object_path,
        "items": items,
    }


def raw_lines(folder: Path, chat_id: str) -> list[dict[str, Any]]:
    """Every parsable line of the chat's transcript, the header included (M18); FileNotFoundError
    when there is no such chat, ValueError for a chat id that isn't a ULID."""
    return _parse(path_for(folder, chat_id))


def read(folder: Path, chat_id: str) -> dict[str, Any]:
    """The AgentTranscript shape; FileNotFoundError when there is no such chat."""
    path = path_for(folder, chat_id)
    return _summarize(chat_id, _parse(path))


_SUMMARY_KEYS = ("id", "title", "createdAt", "updatedAt", "messageCount", "spaceName", "delegated", "from")


def _all(folder: Path) -> list[dict[str, Any]]:
    sessions = Path(folder) / SESSIONS_DIR
    try:
        entries = list(sessions.iterdir())
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for entry in entries:
        if entry.suffix != ".jsonl" or not _CHAT_ID_RE.match(entry.stem):
            continue
        try:
            out.append(_summarize(entry.stem, _parse(entry)))
        except OSError:
            continue
    out.sort(key=lambda t: (t["updatedAt"], t["id"]), reverse=True)
    return out


def list_chats(folder: Path) -> list[dict[str, Any]]:
    """AgentChatSummary of every chat, newest updatedAt first."""
    return [{k: t[k] for k in _SUMMARY_KEYS} for t in _all(folder)]


def find_by_session(folder: Path, session_id: str) -> str | None:
    """The newest chat whose assistant lines carry `session_id`."""
    if not session_id:
        return None
    for t in _all(folder):
        if any(i["type"] == "assistant" and i["sessionId"] == session_id for i in t["items"]):
            return t["id"]
    return None


def _last_assistant_a2a(lines: list[dict[str, Any]]) -> dict[str, Any] | None:
    for line in reversed(lines):
        if line.get("type") == "assistant":
            a2a = line.get("a2a")
            return a2a if isinstance(a2a, dict) else None
    return None


def last_a2a(folder: Path, chat_id: str) -> dict[str, Any] | None:
    """The last assistant line's ``a2a`` (M20), or None (no such chat, no assistant line, or a
    last assistant line without one). Never writes."""
    try:
        return _last_assistant_a2a(_parse(path_for(folder, chat_id)))
    except (OSError, ValueError):
        return None


def find_by_context(folder: Path, context_id: str) -> str | None:
    """The newest chat whose last assistant line's ``a2a.contextId`` is `context_id` (M20)."""
    if not context_id:
        return None
    sessions = Path(folder) / SESSIONS_DIR
    try:
        entries = list(sessions.iterdir())
    except OSError:
        return None
    found: list[tuple[str, str]] = []
    for entry in entries:
        if entry.suffix != ".jsonl" or not _CHAT_ID_RE.match(entry.stem):
            continue
        try:
            lines = _parse(entry)
        except OSError:
            continue
        a2a = _last_assistant_a2a(lines)
        if a2a is not None and a2a.get("contextId") == context_id:
            found.append((_summarize(entry.stem, lines)["updatedAt"], entry.stem))
    return max(found)[1] if found else None
