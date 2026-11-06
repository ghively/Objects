"""The A2A v1.0 client, JSON-RPC binding only (M20, spec section 7).

Fetches and parses an Agent Card, and sends ``SendMessage`` / ``SendStreamingMessage``,
``GetTask`` and ``CancelTask`` with size caps, timeouts and no redirects. It is the only M20 module
with a network client; it reads nothing from the disk and writes nothing.

The client never follows a redirect (a 3xx is an error, so a secret never travels to another
host), reads every body in chunks against the caps in ``remotemodel``, and keeps every request
inside the caller's deadline (``loop.time()``). A secret appears only in the request headers:
never in an `A2AError`, a log line or a repr.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, TypeVar
from urllib.parse import urlsplit

import httpx

from . import remotemodel as rm

__all__ = [
    "STATE_INTERRUPTED",
    "STATE_TERMINAL",
    "A2AError",
    "Auth",
    "Card",
    "Update",
    "cancel",
    "fetch_card",
    "parse_card",
    "send",
    "user_message",
]

STATE_TERMINAL: frozenset[str] = frozenset({
    "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_REJECTED", "TASK_STATE_CANCELED",
})
"""A task that is over."""
STATE_INTERRUPTED: frozenset[str] = frozenset({"TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED"})
"""A task waiting on the user (the turn ends; input-required keeps its task id)."""

_FINAL = STATE_TERMINAL | STATE_INTERRUPTED
_SKILL_STR_MAX = 500
_CANCEL_TIMEOUT = 5.0
_TASK_NOT_FOUND = -32001
_ERROR_MESSAGE_MAX = 300

NOT_A_CARD = "That address didn't answer with an Agent Card."
NO_INTERFACE = "This agent doesn't offer A2A 1.0 over JSON-RPC."
OLD_VERSION = "This agent speaks A2A {version}; Object speaks A2A 1.0."
CARD_TOO_LARGE = "The Agent Card is too large."  # our string
NOT_HTTP = "That isn't an http or https address."
ANSWERED = "{host} answered {status}."
UNREACHABLE = "Object couldn't reach {host}."  # our string
RPC_ERROR = "{name} answered with an error: {message} ({code})"
UNREADABLE = "{name} sent an answer Object can't read."  # our string
TOO_MUCH = "{name} sent more than Object accepts."  # our string
TOO_SLOW = "{name} took too long and was stopped."  # our string
CARD_TOO_SLOW = "{host} didn't send its Agent Card in time."  # our string
FILE_LEFT_OUT = "(A file that couldn't be read was left out.)"  # our string


@dataclass(frozen=True)
class Card:
    """A parsed Agent Card with the interface Object uses."""

    name: str
    description: str
    version: str | None
    provider: str | None
    documentation_url: str | None
    endpoint_url: str
    protocol_version: str
    streaming: bool
    skills: tuple[dict[str, Any], ...]
    """``{id, name, description, tags: [..], examples: [..]}`` (strings cut to 500 characters)."""
    input_modes: tuple[str, ...]
    output_modes: tuple[str, ...]
    raw: dict[str, Any]


@dataclass
class Auth:
    """How a request authenticates. Never logged; its repr hides the value."""

    kind: Literal["none", "bearer", "header"]
    header_name: str | None = None
    value: str | None = field(default=None, repr=False)

    def __repr__(self) -> str:
        shown = "set" if self.value else None
        return f"Auth(kind={self.kind!r}, header_name={self.header_name!r}, value={shown!r})"

    def headers(self) -> dict[str, str]:
        """``Authorization: Bearer <value>`` for bearer, ``<header_name>: <value>`` for header, else none."""
        if not self.value:
            return {}
        if self.kind == "bearer":
            return {"Authorization": f"Bearer {self.value}"}
        if self.kind == "header" and self.header_name:
            return {self.header_name: self.value}
        return {}


@dataclass
class Update:
    """One piece of an answer, in arrival order."""

    kind: Literal["text", "file", "data", "state"]
    text: str = ""
    """kind text: an agent message's, an artifact text part's or the final status message's text."""
    artifact_id: str | None = None
    name: str | None = None
    media_type: str | None = None
    data: Any = None
    """kind data."""
    raw: bytes | None = None
    url: str | None = None
    """kind file: exactly one of `raw` and `url`."""
    state: str | None = None
    context_id: str | None = None
    task_id: str | None = None
    """kind state."""
    status_text: str = ""
    """kind state: the status message's text."""


class A2AError(Exception):
    """Remote or protocol trouble: `status` 502, 504 at a timeout, 422 for a refused card."""

    def __init__(self, message: str, status: int = 502, code: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        """The JSON-RPC error code, when the agent answered one."""


class _Deadline(Exception):
    """The caller's deadline passed (internal; `send` turns it into a 504 after ``CancelTask``)."""


# -- helpers ----------------------------------------------------------------------------------

_T = TypeVar("_T")


def _host(url: str) -> str:
    """``host[:port]`` of `url`, without any user info (never a secret)."""
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
        port = parts.port
    except ValueError:
        return "The agent"
    if ":" in host:
        host = f"[{host}]"
    return f"{host}:{port}" if port else (host or "The agent")


def _is_http(url: Any) -> bool:
    if not isinstance(url, str):
        return False
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and bool(parts.hostname)


def _remaining(deadline: float) -> float:
    return deadline - asyncio.get_running_loop().time()


async def _within(aw: Awaitable[_T], deadline: float, host: str) -> _T:
    """Await `aw` before `deadline`; transport trouble becomes an `A2AError` naming only the host."""
    left = _remaining(deadline)
    if left <= 0:
        if asyncio.iscoroutine(aw):
            aw.close()
        raise _Deadline
    try:
        return await asyncio.wait_for(aw, left)
    except (TimeoutError, httpx.TimeoutException):
        raise _Deadline from None
    except httpx.HTTPError:
        raise A2AError(UNREACHABLE.format(host=host)) from None


def _new_client(read: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(follow_redirects=False, timeout=httpx.Timeout(rm.CONNECT_TIMEOUT, read=read))


def _base_headers(auth: Auth, accept: str) -> dict[str, str]:
    return {"Accept": accept, "A2A-Version": rm.A2A_VERSION, "User-Agent": "Object", **auth.headers()}


async def _open(client: httpx.AsyncClient, method: str, url: str, headers: dict[str, str],
                body: bytes | None, deadline: float) -> httpx.Response:
    """Send one request (streamed, no redirects). A non-2xx answer is closed and refused."""
    host = _host(url)
    try:
        req = client.build_request(method, url, headers=headers, content=body)
    except (httpx.HTTPError, ValueError, TypeError):
        raise A2AError(UNREACHABLE.format(host=host)) from None
    resp = await _within(client.send(req, stream=True, follow_redirects=False), deadline, host)
    if not 200 <= resp.status_code < 300:
        await resp.aclose()
        raise A2AError(ANSWERED.format(host=host, status=resp.status_code))
    return resp


async def _read_capped(resp: httpx.Response, cap: int, deadline: float, host: str, too_big: str) -> bytes:
    length = resp.headers.get("content-length")
    if length and length.isdigit() and int(length) > cap:
        raise A2AError(too_big)
    buf = bytearray()
    chunks = resp.aiter_bytes()
    while True:
        try:
            chunk = await _within(chunks.__anext__(), deadline, host)
        except StopAsyncIteration:
            break
        buf += chunk
        if len(buf) > cap:
            raise A2AError(too_big)
    return bytes(buf)


def _cut(value: Any) -> str | None:
    return value[:_SKILL_STR_MAX] if isinstance(value, str) else None


def _strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [v[:_SKILL_STR_MAX] for v in value if isinstance(v, str)]


def _decode_b64(raw: str) -> bytes | None:
    text = re.sub(r"\s+", "", raw)
    if not re.fullmatch(r"[A-Za-z0-9+/_-]*={0,2}", text):
        return None
    text = text.replace("-", "+").replace("_", "/")
    text += "=" * (-len(text) % 4)
    try:
        return base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        return None


def _texts(message: Any) -> str:
    """The joined text parts of a ``Message``."""
    if not isinstance(message, dict):
        return ""
    parts = message.get("parts")
    if not isinstance(parts, list):
        return ""
    return "\n".join(p["text"] for p in parts if isinstance(p, dict) and isinstance(p.get("text"), str))


# -- the card ---------------------------------------------------------------------------------


async def fetch_card(card_url: str, auth: Auth, *, client: httpx.AsyncClient | None = None) -> Card:
    """GET the card (at most ``CARD_MAX_BYTES``, no redirects) and `parse_card` it."""
    if not _is_http(card_url):
        raise A2AError(NOT_HTTP, 422)
    host = _host(card_url)
    own = client is None
    http = client if client is not None else _new_client(rm.CARD_TIMEOUT)
    deadline = asyncio.get_running_loop().time() + rm.CARD_TIMEOUT
    try:
        resp = await _open(http, "GET", card_url, _base_headers(auth, "application/json"), None, deadline)
        try:
            body = await _read_capped(resp, rm.CARD_MAX_BYTES, deadline, host, CARD_TOO_LARGE)
        finally:
            await resp.aclose()
    except _Deadline:
        raise A2AError(CARD_TOO_SLOW.format(host=host), 504) from None
    finally:
        if own:
            await http.aclose()
    try:
        data = json.loads(body.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        raise A2AError(NOT_A_CARD, 422) from None
    return parse_card(data)


def parse_card(data: Any) -> Card:
    """The card's first JSON-RPC A2A 1.x interface; `A2AError` (422) with the Contract's messages."""
    if not isinstance(data, dict) or not isinstance(data.get("name"), str):
        raise A2AError(NOT_A_CARD, 422)
    interfaces = data.get("supportedInterfaces")
    chosen: dict[str, Any] | None = None
    if isinstance(interfaces, list):
        for entry in interfaces:
            if not isinstance(entry, dict) or entry.get("protocolBinding") != rm.A2A_BINDING:
                continue
            version = entry.get("protocolVersion")
            if not isinstance(version, str) or not (version == rm.A2A_VERSION or version.startswith("1.")):
                continue
            if not _is_http(entry.get("url")):
                continue
            chosen = entry
            break
    if chosen is None:
        top = data.get("protocolVersion")
        if not interfaces and isinstance(top, str) and top.startswith("0."):
            raise A2AError(OLD_VERSION.format(version=top), 422)
        raise A2AError(NO_INTERFACE, 422)
    provider = data.get("provider")
    if isinstance(provider, dict):
        provider = provider.get("organization")
    skills: list[dict[str, Any]] = []
    for s in data.get("skills") or []:
        if not isinstance(s, dict):
            continue
        skills.append({"id": _cut(s.get("id")) or "", "name": _cut(s.get("name")) or "",
                       "description": _cut(s.get("description")) or "",
                       "tags": _strings(s.get("tags")), "examples": _strings(s.get("examples"))})
    capabilities = data.get("capabilities")
    streaming = isinstance(capabilities, dict) and capabilities.get("streaming") is True
    description = data.get("description")
    version = data.get("version")
    docs = data.get("documentationUrl")
    return Card(
        name=data["name"],
        description=description if isinstance(description, str) else "",
        version=version if isinstance(version, str) else None,
        provider=provider if isinstance(provider, str) else None,
        documentation_url=docs if isinstance(docs, str) else None,
        endpoint_url=chosen["url"],
        protocol_version=chosen["protocolVersion"],
        streaming=streaming,
        skills=tuple(skills),
        input_modes=tuple(_strings(data.get("defaultInputModes"))),
        output_modes=tuple(_strings(data.get("defaultOutputModes"))),
        raw=data,
    )


# -- messages ---------------------------------------------------------------------------------


def user_message(parts: list[dict[str, Any]], *, context_id: str | None, task_id: str | None) -> dict[str, Any]:
    """A ``ROLE_USER`` ``Message`` with a new ``messageId``, and ``contextId``/``taskId`` when given."""
    message: dict[str, Any] = {"messageId": str(uuid.uuid4()), "role": "ROLE_USER", "parts": list(parts)}
    if context_id is not None:
        message["contextId"] = context_id
    if task_id is not None:
        message["taskId"] = task_id
    return message


class _Run:
    """One `send`: the ids seen so far and how the answer's pieces become `Update`s."""

    def __init__(self, card: Card, auth: Auth, client: httpx.AsyncClient, deadline: float) -> None:
        self.card = card
        self.auth = auth
        self.client = client
        self.deadline = deadline
        self.host = _host(card.endpoint_url)
        self.task_id: str | None = None
        self.context_id: str | None = None
        self.seen_artifacts: set[str] = set()
        self.on_ids: Callable[[str | None, str | None], None] | None = None
        """Told the task and context ids whenever one changes (M20 T4: Stop cancels the running task)."""

    # -- the wire ---------------------------------------------------------------------------

    def _body(self, method: str, params: dict[str, Any]) -> bytes:
        return json.dumps({"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": method,
                           "params": params}).encode("utf-8")

    def _headers(self, accept: str) -> dict[str, str]:
        return {"Content-Type": "application/json", **_base_headers(self.auth, accept)}

    async def _call(self, method: str, params: dict[str, Any]) -> Any:
        """One JSON-RPC call answered with a plain JSON body; its ``result``."""
        resp = await _open(self.client, "POST", self.card.endpoint_url, self._headers("application/json"),
                           self._body(method, params), self.deadline)
        try:
            body = await _read_capped(resp, rm.RESPONSE_MAX_BYTES, self.deadline, self.host, self._too_much())
        finally:
            await resp.aclose()
        return self._result(self._json(body))

    def _too_much(self) -> str:
        return TOO_MUCH.format(name=self.card.name)

    def _unreadable(self) -> A2AError:
        return A2AError(UNREADABLE.format(name=self.card.name))

    def _json(self, body: bytes) -> Any:
        try:
            return json.loads(body.decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError):
            raise self._unreadable() from None

    def _result(self, envelope: Any) -> Any:
        if not isinstance(envelope, dict):
            raise self._unreadable()
        error = envelope.get("error")
        if error is not None:
            code = error.get("code") if isinstance(error, dict) else None
            text = error.get("message") if isinstance(error, dict) else None
            message = (text if isinstance(text, str) else json.dumps(error))[:_ERROR_MESSAGE_MAX]
            code_int = code if isinstance(code, int) and not isinstance(code, bool) else None
            raise A2AError(RPC_ERROR.format(name=self.card.name, message=message, code=code),
                           code=code_int)
        if "result" not in envelope:
            raise self._unreadable()
        return envelope["result"]

    # -- pieces -> updates ------------------------------------------------------------------

    def _parts(self, parts: Any, artifact_id: str | None, artifact_name: str | None) -> list[Update]:
        out: list[Update] = []
        if not isinstance(parts, list):
            return out
        for part in parts:
            if not isinstance(part, dict):
                continue
            media = part.get("mediaType") if isinstance(part.get("mediaType"), str) else None
            filename = part.get("filename") if isinstance(part.get("filename"), str) else None
            if isinstance(part.get("text"), str):
                out.append(Update("text", text=part["text"], artifact_id=artifact_id, name=artifact_name,
                                  media_type=media))
            elif "raw" in part:
                raw = part.get("raw")
                if isinstance(raw, str) and len(raw) * 3 // 4 > rm.FILE_MAX_BYTES + 3:
                    raise A2AError(self._too_much())
                decoded = _decode_b64(raw) if isinstance(raw, str) else None
                if decoded is None:
                    out.append(Update("text", text=FILE_LEFT_OUT, artifact_id=artifact_id, name=artifact_name))
                    continue
                if len(decoded) > rm.FILE_MAX_BYTES:
                    raise A2AError(self._too_much())
                out.append(Update("file", raw=decoded, name=filename, media_type=media, artifact_id=artifact_id))
            elif isinstance(part.get("url"), str):
                out.append(Update("file", url=part["url"], name=filename, media_type=media,
                                  artifact_id=artifact_id))
            elif "data" in part:
                out.append(Update("data", data=part["data"], artifact_id=artifact_id, name=artifact_name,
                                  media_type=media))
        return out

    def _artifact(self, artifact: Any) -> list[Update]:
        if not isinstance(artifact, dict):
            return []
        aid = artifact.get("artifactId") if isinstance(artifact.get("artifactId"), str) else None
        if aid is not None:
            self.seen_artifacts.add(aid)
        name = artifact.get("name") if isinstance(artifact.get("name"), str) else None
        return self._parts(artifact.get("parts"), aid, name)

    def _ids(self, task_id: Any, context_id: Any) -> None:
        before = (self.task_id, self.context_id)
        if isinstance(task_id, str) and task_id:
            self.task_id = task_id
        if isinstance(context_id, str) and context_id:
            self.context_id = context_id
        if self.on_ids is not None and (self.task_id, self.context_id) != before:
            self.on_ids(self.task_id, self.context_id)

    def _state(self, status: Any) -> tuple[str | None, list[Update]]:
        """The status's state and, when it is final, the state `Update`."""
        state = status.get("state") if isinstance(status, dict) else None
        if not isinstance(state, str):
            return None, []
        if state not in _FINAL:
            return state, []
        return state, [Update("state", state=state, context_id=self.context_id, task_id=self.task_id,
                              status_text=_texts(status.get("message")))]

    def _task(self, task: Any, *, artifacts_now: bool) -> tuple[list[Update], bool]:
        """A ``Task``: its new artifacts (always when streaming, else once it is final) and, when final,
        its state. Answers (updates, final)."""
        if not isinstance(task, dict) or not isinstance(task.get("id"), str):
            raise self._unreadable()
        self._ids(task.get("id"), task.get("contextId"))
        state, final = self._state(task.get("status"))
        out: list[Update] = []
        if artifacts_now or final:
            for art in task.get("artifacts") or []:
                aid = art.get("artifactId") if isinstance(art, dict) else None
                if isinstance(aid, str) and aid in self.seen_artifacts:
                    continue
                out.extend(self._artifact(art))
        return out + final, bool(final)

    def _message(self, message: Any) -> list[Update]:
        if not isinstance(message, dict):
            raise self._unreadable()
        self._ids(message.get("taskId"), message.get("contextId"))
        out = self._parts(message.get("parts"), None, None)
        task_id = message.get("taskId") if isinstance(message.get("taskId"), str) else None
        out.append(Update("state", state=None, context_id=self.context_id, task_id=task_id))
        return out

    def _send_result(self, result: Any, *, streaming: bool) -> tuple[list[Update], bool]:
        if isinstance(result, dict) and "task" in result:
            return self._task(result["task"], artifacts_now=streaming)
        if isinstance(result, dict) and "message" in result:
            return self._message(result["message"]), True
        raise self._unreadable()

    def _event(self, result: Any) -> tuple[list[Update], bool]:
        """One ``StreamResponse``; unknown ones are skipped."""
        if not isinstance(result, dict):
            return [], False
        if "task" in result or "message" in result:
            return self._send_result(result, streaming=True)
        if isinstance(result.get("statusUpdate"), dict):
            upd = result["statusUpdate"]
            self._ids(upd.get("taskId"), upd.get("contextId"))
            _, final = self._state(upd.get("status"))
            return final, bool(final)
        if isinstance(result.get("artifactUpdate"), dict):
            upd = result["artifactUpdate"]
            self._ids(upd.get("taskId"), upd.get("contextId"))
            return self._artifact(upd.get("artifact")), False
        return [], False

    # -- the two ways of sending ------------------------------------------------------------

    def _params(self, message: dict[str, Any]) -> dict[str, Any]:
        return {"message": message,
                "configuration": {"acceptedOutputModes": list(rm.OUTPUT_MODES), "returnImmediately": False}}

    async def plain(self, message: dict[str, Any]) -> AsyncIterator[Update]:
        result = await self._call("SendMessage", self._params(message))
        updates, final = self._send_result(result, streaming=False)
        for u in updates:
            yield u
        if not final:
            async for u in self.poll():
                yield u

    async def poll(self) -> AsyncIterator[Update]:
        """``GetTask`` every ``POLL_INTERVAL`` until the task is final (or the deadline)."""
        if self.task_id is None:
            raise self._unreadable()
        while True:
            left = _remaining(self.deadline)
            if left <= 0:
                raise _Deadline
            await asyncio.sleep(min(rm.POLL_INTERVAL, left))
            task = await self._call("GetTask", {"id": self.task_id, "historyLength": 0})
            updates, final = self._task(task, artifacts_now=False)
            for u in updates:
                yield u
            if final:
                return

    async def stream(self, message: dict[str, Any]) -> AsyncIterator[Update]:
        resp = await _open(self.client, "POST", self.card.endpoint_url, self._headers("text/event-stream"),
                           self._body("SendStreamingMessage", self._params(message)), self.deadline)
        final = False
        try:
            ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
            if ctype != "text/event-stream":
                # A plain JSON answer (an error, or a server that doesn't stream after all).
                body = await _read_capped(resp, rm.RESPONSE_MAX_BYTES, self.deadline, self.host, self._too_much())
                updates, final = self._send_result(self._result(self._json(body)), streaming=True)
                for u in updates:
                    yield u
            else:
                async for data in self._sse(resp):
                    try:
                        envelope = json.loads(data)
                    except ValueError:
                        continue  # a malformed line is skipped
                    updates, final = self._event(self._result(envelope))
                    for u in updates:
                        yield u
                    if final:
                        break
        finally:
            await resp.aclose()
        if not final:
            # The stream ended before a final state: ask for the task until it is final.
            async for u in self.poll():
                yield u

    async def _sse(self, resp: httpx.Response) -> AsyncIterator[str]:
        """The ``data:`` payloads of an SSE body, each event's lines joined, under ``STREAM_MAX_BYTES``."""
        total = 0
        pending = b""
        data: list[str] = []
        chunks = resp.aiter_bytes()
        while True:
            try:
                chunk = await _within(chunks.__anext__(), self.deadline, self.host)
            except StopAsyncIteration:
                break
            total += len(chunk)
            if total > rm.STREAM_MAX_BYTES:
                raise A2AError(self._too_much())
            pending += chunk
            *lines, pending = pending.split(b"\n")
            for raw_line in lines:
                line = raw_line.rstrip(b"\r").decode("utf-8", errors="replace")
                if not line:
                    if data:
                        yield "\n".join(data)
                        data = []
                elif line.startswith("data:"):
                    value = line[5:]
                    data.append(value[1:] if value.startswith(" ") else value)
        tail = pending.rstrip(b"\r").decode("utf-8", errors="replace")
        if tail.startswith("data:"):
            value = tail[5:]
            data.append(value[1:] if value.startswith(" ") else value)
        if data:
            yield "\n".join(data)


async def send(card: Card, auth: Auth, message: dict[str, Any], *, deadline: float,
               client: httpx.AsyncClient | None = None,
               on_ids: Callable[[str | None, str | None], None] | None = None) -> AsyncIterator[Update]:
    """``SendStreamingMessage`` when ``card.streaming``, else ``SendMessage`` (+ ``GetTask`` polling
    while running). Raises `A2AError` (504) at the deadline (``loop.time()``) after a best-effort
    ``CancelTask``.

    `on_ids` (M20 T4), when given, is told the task and context ids as soon as they arrive, so a
    caller that closes the generator early can still cancel the running task.

    A ``-32001`` (TaskNotFound) answered to a message that carried a ``taskId``, before anything
    arrived, sends the message once more without it."""
    own = client is None
    http = client if client is not None else _new_client(max(1.0, _remaining(deadline)))
    run = _Run(card, auth, http, deadline)
    run.on_ids = on_ids
    try:
        retried = False
        while True:
            yielded = False
            try:
                pieces = run.stream(message) if card.streaming else run.plain(message)
                async for update in pieces:
                    yielded = True
                    yield update
                return
            except A2AError as exc:
                if (exc.code == _TASK_NOT_FOUND and not yielded and not retried
                        and message.get("taskId") is not None):
                    retried = True
                    message = {k: v for k, v in message.items() if k != "taskId"}
                    continue
                raise
            except _Deadline:
                if run.task_id is not None:
                    await cancel(card, auth, run.task_id, client=http)
                raise A2AError(TOO_SLOW.format(name=card.name), 504) from None
    finally:
        if own:
            await http.aclose()


async def cancel(card: Card, auth: Auth, task_id: str, *, client: httpx.AsyncClient | None = None) -> None:
    """A best-effort ``CancelTask`` (5 s, errors swallowed)."""
    own = client is None
    try:
        http = client if client is not None else _new_client(_CANCEL_TIMEOUT)
    except Exception:  # noqa: BLE001 - best effort
        return
    try:
        run = _Run(card, auth, http, asyncio.get_running_loop().time() + _CANCEL_TIMEOUT)
        await run._call("CancelTask", {"id": task_id})
    except (A2AError, _Deadline, httpx.HTTPError, OSError, ValueError):
        pass
    finally:
        if own:
            await http.aclose()
