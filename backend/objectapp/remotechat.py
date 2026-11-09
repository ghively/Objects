"""Chatting with a remote agent over A2A (M20, spec section 7).

One chat turn becomes A2A calls (`a2a.send`). `respond` is the chat route's answer for a remote
agent (M17's ``POST /api/ai/chat`` hands a ``kind: "remote"`` record here); `stream_turn` yields
M10/M16/M17 stream events plus the ``attachment`` event and writes the chat's transcript in the
remote agent's folder; `call_remote` is one turn with no client stream (the agent tools and
delegation use it).

- Only ``mode: "chat"``: a ``block`` from the editor never goes out.
- Context pages come from `ai.gather_context`, so pages excluded from AI and templates are never
  sent. The first send with context needs the agent's ``contextNoticeAt`` (428 otherwise).
- The A2A context id and a pending input-required task id are read from the chat's transcript
  (the last assistant line's ``a2a``); a new chat id is a fresh context.
- File artifacts are saved under ``<folder>/.object-agent/files/<chatId>/`` with safe names (never
  opened); ``url`` files are kept as links when they are http or https.
- Closing the stream sends a best-effort ``CancelTask`` and keeps the partial reply ``stopped``.
- A remote turn writes nothing in the space. A secret never reaches an event, a transcript or a
  log line: every error message passes through `secretstore.redact`.

Imports no network client (`a2a` is the one that talks to the network).
"""

from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import anyio
from fastapi.responses import JSONResponse, Response
from sse_starlette import EventSourceResponse, ServerSentEvent

from . import a2a, ai, remotesecrets, transcripts
from .agents import AgentRecord, AgentRegistry, endpoint_host, remote_auth, remote_card
from .aichat import default_title
from .apictx import ApiContext
from .appstate import space_key as space_key_of
from .remotemodel import DATA_BLOCK_MAX_CHARS
from .secretstore import redact
from .space import _RESERVED_STEMS, safe_filename
from .textfile import create_new
from .watcher import ChangeEvent

__all__ = [
    "FILES_DIR",
    "RemoteResult",
    "build_parts",
    "call_remote",
    "respond",
    "safe_attachment_name",
    "save_attachment",
    "stream_turn",
]

FILES_DIR = ".object-agent/files"
"""A remote agent's file artifacts, one folder per chat."""
ONLY_CHAT = "Remote agents can only chat."
CONFIRM_CONTEXT = "Confirm that context leaves this computer first."
NEEDS_TOKEN = "This remote agent needs its token again (its page > Replace token)."
URL_LEFT_OUT = "(A file link that isn't http or https was left out.)"  # our string
CARD_UNREADABLE = "{name}'s Agent Card can't be read; refresh it on its page."  # our string
NOT_SAVED = "The chat couldn't be saved: {reason}"  # M17's wording
TOO_SLOW = "{name} took too long (over {seconds:g} seconds) and was stopped."  # M10's wording
AUTH_REQUIRED = "{name} needs a sign-in that Object can't do."
FAILED = "{name} couldn't do it: {text}"
FAILED_BARE = "{name} couldn't do it."
REJECTED = "{name} turned the task down: {text}"
REJECTED_BARE = "{name} turned the task down."  # our string (no status text)
CANCELED = "{name} canceled the task."

COMPLETED = "TASK_STATE_COMPLETED"
INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED"
_ERROR_STATES = frozenset({"TASK_STATE_AUTH_REQUIRED", "TASK_STATE_FAILED", "TASK_STATE_REJECTED",
                           "TASK_STATE_CANCELED"})
_NAME_MAX = 120
_UNUSABLE = re.compile(r'[\\/:*?"<>|\x00-\x1f\[\]#.\s]')
_EXT = re.compile(r"\.[A-Za-z0-9]{1,16}")


def _now() -> str:
    moment = datetime.now(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _name(record: AgentRecord) -> str:
    name = record.data.get("name")
    return name if isinstance(name, str) and name else record.id


def _is_http(url: Any) -> bool:
    if not isinstance(url, str):
        return False
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and bool(parts.hostname)


def _valid_chat_id(chat_id: Any) -> str | None:
    try:
        transcripts.path_for(Path("."), chat_id)
    except ValueError:
        return None
    return chat_id


# -- what goes out ----------------------------------------------------------------------------


def build_parts(prompt: str, pack: ai.ContextPack) -> list[dict[str, Any]]:
    """The message's own text part, then one Markdown text part per context page (excluded pages
    and templates are never in ``pack.pages``)."""
    parts: list[dict[str, Any]] = [{"text": prompt}]
    for page in pack.pages:
        title = page.title or page.path
        parts.append({"text": f"# {title}\n\n{page.text}", "mediaType": "text/markdown",
                      "filename": f"{safe_filename(title)}.md"})
    return parts


# -- what comes back --------------------------------------------------------------------------


def safe_attachment_name(name: str | None, media_type: str | None) -> str:
    """A file name that is safe to create: no path parts, Windows' reserved names prefixed
    ``_``, at most 120 characters (the extension kept), and ``attachment`` plus an extension from
    the media type when nothing usable is left."""
    raw = re.split(r"[\\/]", name or "")[-1].strip()
    stem, ext = os.path.splitext(raw)
    if not _EXT.fullmatch(ext):
        stem, ext = raw, ""
    if not _UNUSABLE.sub("", stem):
        guessed = mimetypes.guess_extension(media_type or "") if media_type else None
        return "attachment" + (ext or guessed or "")
    if stem.split(".", 1)[0].strip().upper() in _RESERVED_STEMS:
        stem = "_" + stem
    return safe_filename(stem[: _NAME_MAX - len(ext)] + ext)[:_NAME_MAX]


def save_attachment(folder: Path, chat_id: str, update: a2a.Update) -> dict[str, Any] | None:
    """A file update as a `RemoteAttachment`: raw bytes saved (a new file; a clash gets `` (2)``),
    a link kept when it is http or https. None for a link with any other scheme."""
    if update.raw is None:
        if not _is_http(update.url):
            return None
        url = str(update.url)
        shown = update.name or urlsplit(url).path.rsplit("/", 1)[-1]
        return {"name": safe_attachment_name(shown, update.media_type), "mediaType": update.media_type,
                "size": None, "kind": "url", "file": None, "url": url}
    transcripts.path_for(folder, chat_id)  # a ULID, so the folder below stays inside files/
    target = Path(folder) / FILES_DIR / chat_id
    target.mkdir(parents=True, exist_ok=True)
    name = safe_attachment_name(update.name, update.media_type)
    stem, ext = os.path.splitext(name)
    if not _EXT.fullmatch(ext):
        stem, ext = name, ""
    for n in range(1, 10_000):
        candidate = name if n == 1 else f"{stem[: _NAME_MAX - len(ext) - 8]} ({n}){ext}"
        try:
            create_new(target / candidate, update.raw)
        except FileExistsError:
            continue
        return {"name": candidate, "mediaType": update.media_type, "size": len(update.raw), "kind": "file",
                "file": f"{chat_id}/{candidate}", "url": None}
    raise FileExistsError(target / name)


class _Reply:
    """One turn's answer as it arrives: the reply text, the attachments, the A2A ids and state."""

    def __init__(self, folder: Path, chat_id: str, agent_id: str = "") -> None:
        self.folder = Path(folder)
        self.chat_id = chat_id
        self.agent_id = agent_id
        self.pieces: list[str] = []
        self.attachments: list[dict[str, Any]] = []
        self.context_id: str | None = None
        self.task_id: str | None = None
        self.state: str | None = None
        self.status_text = ""
        self.final = False
        self._last_artifact: str | None = None
        self._named: set[str] = set()

    def ids(self, task_id: str | None, context_id: str | None) -> None:
        """`a2a.send`'s ``on_ids``: the running task's ids, for Stop."""
        self.task_id = task_id or self.task_id
        self.context_id = context_id or self.context_id

    def text(self) -> str:
        return "".join(self.pieces)

    def _add(self, text: str, artifact_id: str | None) -> dict[str, Any]:
        if self.pieces and not (artifact_id is not None and artifact_id == self._last_artifact):
            text = "\n\n" + text
        self._last_artifact = artifact_id
        self.pieces.append(text)
        return {"type": "text", "text": text}

    def _heading(self, update: a2a.Update) -> str:
        aid = update.artifact_id
        if aid is None or not update.name or aid in self._named:
            return ""
        self._named.add(aid)
        return f"**{update.name}**\n\n"

    def take(self, update: a2a.Update) -> list[dict[str, Any]]:
        """The stream events one update gives (files are saved here)."""
        if update.kind == "text":
            if not update.text:
                return []
            return [self._add(self._heading(update) + update.text, update.artifact_id)]
        if update.kind == "data":
            block = json.dumps(update.data, indent=2, ensure_ascii=False)
            if len(block) > DATA_BLOCK_MAX_CHARS:
                block = block[:DATA_BLOCK_MAX_CHARS] + "…"
            event = self._add(f"{self._heading(update)}```json\n{block}\n```", None)
            self._last_artifact = None
            return [event]
        if update.kind == "file":
            try:
                att = save_attachment(self.folder, self.chat_id, update)
            except OSError:
                return [self._add(a2a.FILE_LEFT_OUT, None)]
            if att is None:
                return [self._add(URL_LEFT_OUT, None)]
            self.attachments.append(att)
            return [{"type": "attachment", "agentId": self.agent_id, "chatId": self.chat_id, "attachment": att}]
        # kind state: the turn's end (a message result has no state)
        self.final = True
        self.state = update.state
        self.ids(update.task_id, update.context_id)
        self.status_text = update.status_text
        if (update.state not in _ERROR_STATES and update.status_text and not self.pieces
                and not self.attachments):
            return [self._add(update.status_text, None)]
        return []

    def error_message(self, name: str) -> str | None:
        """The error a failed, rejected, canceled or auth-required task answers; None otherwise."""
        text = " ".join(self.status_text.split())
        if self.state == "TASK_STATE_AUTH_REQUIRED":
            return AUTH_REQUIRED.format(name=name)
        if self.state == "TASK_STATE_FAILED":
            return FAILED.format(name=name, text=text) if text else FAILED_BARE.format(name=name)
        if self.state == "TASK_STATE_REJECTED":
            return REJECTED.format(name=name, text=text) if text else REJECTED_BARE.format(name=name)
        if self.state == "TASK_STATE_CANCELED":
            return CANCELED.format(name=name)
        return None

    def a2a(self) -> dict[str, Any]:
        return {"contextId": self.context_id, "taskId": self.task_id, "state": self.state}

    def assistant_line(self, *, stopped: bool = False) -> dict[str, Any]:
        line: dict[str, Any] = {"type": "assistant", "text": self.text(), "at": _now(), "model": None,
                                "sessionId": None, "a2a": self.a2a()}
        if self.attachments:
            line["attachments"] = list(self.attachments)
        if stopped:
            line["stopped"] = True
        return line


def _error_text(exc: a2a.A2AError, name: str, auth: a2a.Auth, seconds: float) -> str:
    message = TOO_SLOW.format(name=name, seconds=seconds) if exc.status == 504 else exc.message
    return redact(message, [auth.value] if auth.value else [])


async def _cancel_shielded(card: a2a.Card, auth: a2a.Auth, task_id: str) -> None:
    """A best-effort ``CancelTask`` that finishes even while the caller is being cancelled."""
    with anyio.CancelScope(shield=True):
        try:
            await a2a.cancel(card, auth, task_id)
        except Exception:  # noqa: BLE001 - best effort
            pass


def _continuation(folder: Path, chat_id: str) -> tuple[str | None, str | None]:
    """The chat's A2A context id, and the task id while that task waits for input."""
    last = transcripts.last_a2a(folder, chat_id) or {}
    context_id = last.get("contextId") if isinstance(last.get("contextId"), str) else None
    task_id = last.get("taskId") if isinstance(last.get("taskId"), str) else None
    return context_id, task_id if last.get("state") == INPUT_REQUIRED else None


def _load(record: AgentRecord) -> tuple[a2a.Card, a2a.Auth]:
    """The agent's card and auth; `a2a.A2AError` (409) when the card can't be used. Never writes."""
    try:
        card = remote_card(record)
    except (ValueError, a2a.A2AError):
        raise a2a.A2AError(CARD_UNREADABLE.format(name=_name(record)), 409) from None
    return card, remote_auth(record)


# -- a turn in the panel ----------------------------------------------------------------------


async def stream_turn(record: AgentRecord, *, chat_id: str, prompt: str, pack: ai.ContextPack,
                      space_name: str | None, space_key: str | None,
                      deadline: float) -> AsyncIterator[dict[str, Any]]:
    """One panel turn: ``chat``, then ``text``/``attachment`` events, then ``done`` or ``error``.

    Writes the transcript (the header when new and the user line first; the answer or error line
    before the last event). Closed early, it cancels the running task (best effort) and keeps
    what arrived with ``stopped: true``."""
    folder = record.folder
    name = _name(record)
    sent_paths = [page.path for page in pack.pages]

    def begin() -> tuple[str | None, str | None]:
        now = _now()
        transcripts.start(folder, chat_id, agent_id=record.id,
                          title=default_title([{"role": "user", "text": prompt}]),
                          space_name=space_name, space_key=space_key, created_at=now)
        ids = _continuation(folder, chat_id)
        transcripts.append(folder, chat_id, [{"type": "user", "text": prompt, "at": now,
                                              "contextPaths": sent_paths}])
        return ids

    def write(lines: list[dict[str, Any]]) -> None:
        try:
            transcripts.append(folder, chat_id, lines)
        except OSError:
            pass

    try:
        context_id, task_id = await asyncio.to_thread(begin)
    except OSError as exc:
        yield {"type": "chat", "chatId": chat_id, "agentId": record.id}
        yield {"type": "error", "message": NOT_SAVED.format(reason=exc.strerror or exc)}
        return
    yield {"type": "chat", "chatId": chat_id, "agentId": record.id}

    reply = _Reply(folder, chat_id, record.id)
    ended = False
    card: a2a.Card | None = None
    auth = a2a.Auth("none")
    try:
        error: str | None = None
        try:
            card, auth = await asyncio.to_thread(_load, record)
            message = a2a.user_message(build_parts(prompt, pack), context_id=context_id, task_id=task_id)
            async for update in a2a.send(card, auth, message, deadline=deadline, on_ids=reply.ids):
                if update.kind == "file":
                    events = await asyncio.to_thread(reply.take, update)
                else:
                    events = reply.take(update)
                for event in events:
                    yield event
        except a2a.A2AError as exc:
            error = _error_text(exc, name, auth, ai.TURN_TIMEOUT)
        except Exception:  # noqa: BLE001 - anything else a hostile answer causes ends the turn as an error
            error = a2a.UNREADABLE.format(name=name)
        else:
            error = reply.error_message(name)
        if error is not None:
            last: dict[str, Any] = {"type": "error", "message": error}
            line: dict[str, Any] = {"type": "error", "message": error, "at": _now()}
        else:
            last = {"type": "done", "text": reply.text(), "sessionId": None, "proposal": None,
                    "skipped": list(pack.skipped)}
            line = reply.assistant_line()
        # Written before the last event goes out, so a client that reloads the chat finds it.
        await asyncio.to_thread(write, [line])
        ended = True
        yield last
    finally:
        if not ended:
            if card is not None and reply.task_id and not reply.final:
                await _cancel_shielded(card, auth, reply.task_id)
            write([reply.assistant_line(stopped=True)])


def _one_error(message: str) -> EventSourceResponse:
    async def only():
        yield ServerSentEvent(data=json.dumps({"type": "error", "message": message}, ensure_ascii=False), sep="\n")

    return EventSourceResponse(only(), sep="\n")


def respond(ctx: ApiContext, registry: AgentRegistry, record: AgentRecord, req: Any) -> Response:
    """The chat route's answer for a remote agent (after M17's lookup and checks)."""
    if req.mode != "chat":
        return _one_error(ONLY_CHAT)
    if req.contextPaths and not record.data.get("contextNoticeAt"):
        endpoint = record.data.get("endpoint")
        url = endpoint.get("url") if isinstance(endpoint, dict) else None
        return JSONResponse({"detail": CONFIRM_CONTEXT, "agentId": record.id,
                             "host": endpoint_host(url if isinstance(url, str) else "")}, status_code=428)
    if remote_auth(record).kind != "none" and not remotesecrets.is_set(record.id):
        return _one_error(NEEDS_TOKEN)
    space = ctx.space
    chat_id = _valid_chat_id(req.chatId) or transcripts.new_chat_id()

    def frame(event: dict[str, Any]) -> ServerSentEvent:
        return ServerSentEvent(data=json.dumps(event, ensure_ascii=False), sep="\n")

    def written() -> None:
        ctx.announce(ChangeEvent("agentChats", record.id, chat_id, origin=None))

    async def stream():
        key = (record.id, chat_id)
        if key in ai.RUNNING_CHATS:  # decision S8: the local chats' in-flight guard
            yield frame({"type": "error", "message": ai.CHAT_BUSY})
            return
        ai.RUNNING_CHATS.add(key)  # nothing awaits between the check above and here
        turn = None
        ended = False
        try:
            pack = await asyncio.to_thread(ai.gather_context, space, list(req.contextPaths))
            deadline = asyncio.get_running_loop().time() + ai.TURN_TIMEOUT
            turn = stream_turn(record, chat_id=chat_id, prompt=req.prompt, pack=pack, space_name=space.name,
                               space_key=space_key_of(space.root), deadline=deadline)
            async for event in turn:
                kind = event.get("type")
                if kind == "chat":
                    written()
                elif kind in ("done", "error"):
                    ended = True
                    written()
                yield frame(event)
        finally:
            ai.RUNNING_CHATS.discard(key)
            if turn is not None:
                with anyio.CancelScope(shield=True):
                    await turn.aclose()
                if not ended:
                    written()  # the stopped line

    return EventSourceResponse(stream(), ping=15, sep="\n")


# -- one turn for an agent --------------------------------------------------------------------


@dataclass
class RemoteResult:
    chat_id: str
    state: str
    text: str
    context_id: str | None
    task_id: str | None
    attachments: list[dict[str, Any]] = field(default_factory=list)
    cut: bool = False


async def call_remote(record: AgentRecord, text: str, *, context_id: str | None, task_id: str | None,
                      timeout: float, delegated_from: str | None, from_chat: str | None,
                      space_name: str | None, space_key: str | None, cap: int) -> RemoteResult:
    """One turn with no client stream, kept as a chat in the remote agent's folder: the chat whose
    last ``a2a.contextId`` is `context_id`, else a new one (header ``delegated: true``, ``from``
    `delegated_from`). The text is cut to `cap` + "…" (the transcript keeps it whole).

    A failed, rejected, canceled or auth-required task is an answer (its `state`, the error as the
    text when nothing else came). Raises `a2a.A2AError`: 409 (no token, an unreadable card), 504
    (past `timeout`; the chat so far is kept, ``stopped``), else the remote's trouble (redacted).
    Once the chat is written, the error's ``chat_id`` names it."""
    name = _name(record)
    folder = record.folder
    card, auth = await asyncio.to_thread(_load, record)
    if auth.kind != "none" and not auth.value:
        raise a2a.A2AError(NEEDS_TOKEN, 409)

    def begin() -> str:
        found = transcripts.find_by_context(folder, context_id) if context_id else None
        chat_id = found or transcripts.new_chat_id()
        now = _now()
        transcripts.start(folder, chat_id, agent_id=record.id,
                          title=default_title([{"role": "user", "text": text}]),
                          space_name=space_name, space_key=space_key, created_at=now,
                          delegated=True, delegated_from=delegated_from, from_chat=from_chat)
        transcripts.append(folder, chat_id, [{"type": "user", "text": text, "at": now, "contextPaths": []}])
        return chat_id

    chat_id = await asyncio.to_thread(begin)
    reply = _Reply(folder, chat_id, record.id)
    deadline = asyncio.get_running_loop().time() + timeout
    message = a2a.user_message([{"text": text}], context_id=context_id, task_id=task_id)
    try:
        async for update in a2a.send(card, auth, message, deadline=deadline, on_ids=reply.ids):
            if update.kind == "file":
                await asyncio.to_thread(reply.take, update)
            else:
                reply.take(update)
    except a2a.A2AError as exc:
        message_text = _error_text(exc, name, auth, timeout)
        if exc.status == 504:
            transcripts.append(folder, chat_id, [reply.assistant_line(stopped=True)])
        else:
            transcripts.append(folder, chat_id, [{"type": "error", "message": message_text, "at": _now()}])
        err = a2a.A2AError(message_text, exc.status)
        err.chat_id = chat_id
        raise err from None
    except Exception:  # anything else a hostile answer causes: an error line, then a 502
        if reply.task_id and not reply.final:
            await _cancel_shielded(card, auth, reply.task_id)
        message_text = a2a.UNREADABLE.format(name=name)
        transcripts.append(folder, chat_id, [{"type": "error", "message": message_text, "at": _now()}])
        err = a2a.A2AError(message_text, 502)
        err.chat_id = chat_id
        raise err from None
    except BaseException:
        if reply.task_id and not reply.final:
            await _cancel_shielded(card, auth, reply.task_id)
        transcripts.append(folder, chat_id, [reply.assistant_line(stopped=True)])
        raise
    error = reply.error_message(name)
    if error is not None:
        await asyncio.to_thread(transcripts.append, folder, chat_id,
                                [{"type": "error", "message": error, "at": _now()}])
    else:
        await asyncio.to_thread(transcripts.append, folder, chat_id, [reply.assistant_line()])
    full = reply.text() or error or ""
    cut = len(full) > cap
    return RemoteResult(chat_id=chat_id, state=reply.state or COMPLETED, text=full[:cap] + "…" if cut else full,
                        context_id=reply.context_id, task_id=reply.task_id, attachments=list(reply.attachments),
                        cut=cut)
