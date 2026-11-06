"""A fake A2A v1.0 agent for the M20 tests and hand checks (synthetic only; no real service behind it).

Built on the standard library's ``http.server.ThreadingHTTPServer``, bound to ``127.0.0.1`` only.
It serves its Agent Card at ``/.well-known/agent-card.json`` and the JSON-RPC 2.0 binding at
``POST /a2a`` (``SendMessage``, ``SendStreamingMessage``, ``GetTask``, ``CancelTask``).

Run it by hand with ``python backend/tests/fake_a2a.py --port 8799 [--no-streaming] [--token T]``.

- Every request without the right ``Authorization: Bearer <token>`` (or the configured header) is
  answered 401, when a token or header is configured.
- `requests` holds every request (method, path, headers, the JSON-RPC method and params; the
  ``Authorization`` header is kept so tests can assert it). With `log`, each is also appended to
  that file as one JSON line.
- `card_override` serves that card instead (`card_raw`: those bytes as the card body);
  `raw_override(method)` answers a JSON-RPC method with
  ``(status, headers, body)`` as given (hostile answers).

The reply is steered by markers in the user message's text parts:

- none: ``Echo: <first text part>`` and, on a second line, ``ctx=<contextId> task=<taskId or ->``
  (the message's own task id); a ``contextId`` is kept per context;
- ``A2A:input``: ``TASK_STATE_INPUT_REQUIRED`` with the status message "Which date?"; the next
  message carrying that ``taskId`` completes with "Booked for <its text>";
- ``A2A:file``: an artifact with a ``raw`` part (``plan.md``, ``text/markdown``, "# Plan");
- ``A2A:url``: an artifact with a ``url`` part ``https://example.org/x.pdf``;
- ``A2A:data``: an artifact with a ``data`` part ``{"rooms": 2}``;
- ``A2A:fail``, ``A2A:reject``, ``A2A:auth``: the matching state;
- ``A2A:slow:<s>``: ``TASK_STATE_WORKING``, then completes after ``<s>`` seconds;
- ``A2A:long:<n>``: a text of ``n`` characters;
- ``A2A:echo-parts``: every received text part, joined by blank lines.
- ``A2A:message``: a ``{"message": ...}`` result (no task) with "Just a message: <first text part>".

A message whose ``taskId`` the fake doesn't know answers the JSON-RPC error ``-32001``.
Streaming answers send ``task`` (working), then ``artifactUpdate``s (the text in two chunks, the
second with ``append: true``), then a ``statusUpdate`` with the final state. ``CancelTask``
answers the task as ``TASK_STATE_CANCELED``. No part ever carries a ``kind`` key (v1.0).
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import threading
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

CARD_PATH = "/.well-known/agent-card.json"
RPC_PATH = "/a2a"
WORKING = "TASK_STATE_WORKING"
COMPLETED = "TASK_STATE_COMPLETED"
INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED"
CANCELED = "TASK_STATE_CANCELED"
MARKER_STATES = {
    "A2A:fail": ("TASK_STATE_FAILED", "The fake planner broke."),
    "A2A:reject": ("TASK_STATE_REJECTED", "Not something the fake planner does."),
    "A2A:auth": ("TASK_STATE_AUTH_REQUIRED", "Sign in to the fake planner first."),
}
FINAL_STATES = frozenset({COMPLETED, INPUT_REQUIRED, CANCELED, "TASK_STATE_FAILED", "TASK_STATE_REJECTED",
                          "TASK_STATE_AUTH_REQUIRED"})


def _now() -> str:
    now = datetime.now(UTC)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _agent_message(text: str, context_id: str, task_id: str | None) -> dict[str, Any]:
    msg: dict[str, Any] = {"messageId": str(uuid.uuid4()), "role": "ROLE_AGENT", "parts": [{"text": text}],
                           "contextId": context_id}
    if task_id:
        msg["taskId"] = task_id
    return msg


class FakeA2A:
    """A synthetic A2A v1.0 agent on ``127.0.0.1``."""

    def __init__(self, *, streaming: bool = True, token: str | None = None, header: tuple[str, str] | None = None,
                 name: str = "Fake Planner", card_version: str = "1.0", log: Path | None = None,
                 port: int = 0) -> None:
        self.streaming = streaming
        self.token = token
        self.header = header
        self.name = name
        self.card_version = card_version
        self.log = log
        self.port = port
        self.requests: list[dict[str, Any]] = []
        self.card_override: dict[str, Any] | None = None
        self.card_raw: bytes | None = None
        self.raw_override: Callable[[str], tuple[int, dict[str, str], bytes]] | None = None
        self.base_url = ""
        self._lock = threading.Lock()
        self._tasks: dict[str, dict[str, Any]] = {}
        self._pending_input: set[str] = set()
        self._finish_at: dict[str, tuple[float, dict[str, Any]]] = {}
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    # -- lifecycle ------------------------------------------------------------------------------

    def start(self) -> str:
        """Serve on a free port (or the given one); the base URL ``http://127.0.0.1:<port>``."""
        fake = self

        class Handler(_Handler):
            owner = fake

        self._httpd = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        self._httpd.daemon_threads = True
        self.base_url = f"http://127.0.0.1:{self._httpd.server_address[1]}"
        self._thread = threading.Thread(target=self._httpd.serve_forever, name="fake-a2a", daemon=True)
        self._thread.start()
        return self.base_url

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def __enter__(self) -> FakeA2A:
        self.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.stop()

    # -- the card -------------------------------------------------------------------------------

    def card(self) -> dict[str, Any]:
        if self.card_override is not None:
            return self.card_override
        skills = [{"id": "plan-trip", "name": "Plan a trip", "description": "Plans a short trip.",
                   "tags": ["travel"], "examples": ["Plan two days in Lisbon."]}]
        card: dict[str, Any] = {
            "name": self.name,
            "description": "A synthetic agent for Object's tests.",
            "version": "1.0.0",
            "provider": {"organization": "Fake Org", "url": "https://example.org"},
            "documentationUrl": "https://example.org/docs",
            "capabilities": {"streaming": self.streaming},
            "defaultInputModes": ["text/plain", "text/markdown"],
            "defaultOutputModes": ["text/plain", "application/json"],
            "skills": skills,
        }
        if self.card_version.startswith("0."):
            card["protocolVersion"] = self.card_version
            card["url"] = self.base_url + RPC_PATH
            card["preferredTransport"] = "JSONRPC"
        else:
            card["supportedInterfaces"] = [{"url": self.base_url + RPC_PATH, "protocolBinding": "JSONRPC",
                                            "protocolVersion": self.card_version}]
        return card

    # -- auth and the log -----------------------------------------------------------------------

    def authorized(self, headers: dict[str, str]) -> bool:
        lower = {k.lower(): v for k, v in headers.items()}
        if self.token is not None and lower.get("authorization") != f"Bearer {self.token}":
            return False
        if self.header is not None and lower.get(self.header[0].lower()) != self.header[1]:
            return False
        return True

    def record(self, entry: dict[str, Any]) -> None:
        with self._lock:
            self.requests.append(entry)
            if self.log is not None:
                with open(self.log, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry) + "\n")

    # -- tasks ----------------------------------------------------------------------------------

    def _task(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            due = self._finish_at.get(task_id)
            if due is not None and time.monotonic() >= due[0] and self._tasks[task_id]["status"]["state"] == WORKING:
                self._tasks[task_id].update(due[1])
                del self._finish_at[task_id]
            task = self._tasks.get(task_id)
            return json.loads(json.dumps(task)) if task is not None else None

    def _store(self, task: dict[str, Any]) -> None:
        with self._lock:
            self._tasks[task["id"]] = json.loads(json.dumps(task))

    def cancel(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return None
            if task["status"]["state"] not in FINAL_STATES - {INPUT_REQUIRED}:
                task["status"] = {"state": CANCELED, "timestamp": _now()}
            self._finish_at.pop(task_id, None)
            self._pending_input.discard(task_id)
            return json.loads(json.dumps(task))

    def canceled(self, task_id: str) -> bool:
        with self._lock:
            task = self._tasks.get(task_id)
            return bool(task and task["status"]["state"] == CANCELED)

    def plan(self, message: dict[str, Any]) -> tuple[dict[str, Any], float] | str:
        """What to answer `message` with: (the finished task, seconds to wait before it is done),
        or an error string for an unknown task id."""
        parts = [p for p in message.get("parts") or [] if isinstance(p, dict)]
        texts = [str(p["text"]) for p in parts if isinstance(p.get("text"), str)]
        first = texts[0] if texts else ""
        joined = "\n".join(texts)
        context_id = str(message.get("contextId") or f"ctx-{uuid.uuid4().hex[:8]}")
        sent_task = message.get("taskId")
        if sent_task:
            with self._lock:
                known = sent_task in self._tasks
                waiting = sent_task in self._pending_input
                if waiting:
                    self._pending_input.discard(sent_task)
            if not known:
                return "Task not found"
            task_id = str(sent_task)
        else:
            task_id = f"task-{uuid.uuid4().hex[:8]}"
            waiting = False
        state, status_text = COMPLETED, ""
        artifacts: list[dict[str, Any]] = []
        delay = 0.0

        def text_artifact(text: str) -> None:
            artifacts.append({"artifactId": f"art-{uuid.uuid4().hex[:8]}", "parts": [{"text": text}]})

        if waiting:
            text_artifact(f"Booked for {first}")
        elif "A2A:input" in joined:
            state, status_text = INPUT_REQUIRED, "Which date?"
            with self._lock:
                self._pending_input.add(task_id)
        elif any(m in joined for m in MARKER_STATES):
            marker = next(m for m in MARKER_STATES if m in joined)
            state, status_text = MARKER_STATES[marker]
        elif "A2A:echo-parts" in joined:
            text_artifact("\n\n".join(texts))
        else:
            long = re.search(r"A2A:long:(\d+)", joined)
            slow = re.search(r"A2A:slow:(\d+(?:\.\d+)?)", joined)
            if long:
                n = int(long.group(1))
                text_artifact(("abcdefghij" * (n // 10 + 1))[:n])
            elif "A2A:file" in joined:
                artifacts.append({"artifactId": f"art-{uuid.uuid4().hex[:8]}", "name": "Plan", "parts": [{
                    "raw": base64.b64encode(b"# Plan").decode("ascii"), "filename": "plan.md",
                    "mediaType": "text/markdown"}]})
            elif "A2A:url" in joined:
                artifacts.append({"artifactId": f"art-{uuid.uuid4().hex[:8]}", "parts": [{
                    "url": "https://example.org/x.pdf", "filename": "x.pdf", "mediaType": "application/pdf"}]})
            elif "A2A:data" in joined:
                artifacts.append({"artifactId": f"art-{uuid.uuid4().hex[:8]}", "parts": [{"data": {"rooms": 2}}]})
            else:
                if slow:
                    delay = float(slow.group(1))
                text_artifact(f"Echo: {first}\nctx={context_id} task={sent_task or '-'}")
        status: dict[str, Any] = {"state": state, "timestamp": _now()}
        if status_text:
            status["message"] = _agent_message(status_text, context_id, task_id)
        task: dict[str, Any] = {"id": task_id, "contextId": context_id, "status": status}
        if artifacts:
            task["artifacts"] = artifacts
        return task, delay


class _Handler(BaseHTTPRequestHandler):
    owner: FakeA2A
    server_version = "FakeA2A/1.0"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - the stdlib's name
        return  # quiet

    def _headers(self) -> dict[str, str]:
        return {k: v for k, v in self.headers.items()}

    def _send(self, status: int, body: bytes, content_type: str = "application/json",
              extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, data: Any) -> None:
        self._send(status, json.dumps(data).encode("utf-8"))

    def do_GET(self) -> None:  # noqa: N802 - the stdlib's name
        fake = self.owner
        fake.record({"method": "GET", "path": self.path, "headers": self._headers(), "rpc": None, "params": None})
        if not fake.authorized(self._headers()):
            self._json(401, {"error": "unauthorized"})
            return
        if self.path.split("?")[0] != CARD_PATH:
            self._json(404, {"error": "not found"})
            return
        if fake.card_raw is not None:
            self._send(200, fake.card_raw)
            return
        self._json(200, fake.card())

    def do_POST(self) -> None:  # noqa: N802 - the stdlib's name
        fake = self.owner
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        try:
            req = json.loads(body.decode("utf-8") or "null")
        except ValueError:
            req = None
        method = req.get("method") if isinstance(req, dict) else None
        params = req.get("params") if isinstance(req, dict) else None
        rpc_id = req.get("id") if isinstance(req, dict) else None
        fake.record({"method": "POST", "path": self.path, "headers": self._headers(), "rpc": method,
                     "params": params})
        if not fake.authorized(self._headers()):
            self._json(401, {"error": "unauthorized"})
            return
        if self.path.split("?")[0] != RPC_PATH:
            self._json(404, {"error": "not found"})
            return
        if fake.raw_override is not None and isinstance(method, str):
            status, headers, raw = fake.raw_override(method)
            self.send_response(status)
            for k, v in headers.items():
                self.send_header(k, v)
            if not any(k.lower() == "content-length" for k in headers):
                self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if not isinstance(req, dict) or not isinstance(params, dict):
            self._rpc_error(rpc_id, -32600, "Invalid Request")
            return
        if method in ("SendMessage", "SendStreamingMessage"):
            message = params.get("message")
            if not isinstance(message, dict):
                self._rpc_error(rpc_id, -32602, "Invalid params")
                return
            msg_text = [str(p["text"]) for p in message.get("parts") or []
                        if isinstance(p, dict) and isinstance(p.get("text"), str)]
            if any("A2A:message" in t for t in msg_text):
                reply = _agent_message(f"Just a message: {msg_text[0]}",
                                       str(message.get("contextId") or f"ctx-{uuid.uuid4().hex[:8]}"), None)
                if method == "SendStreamingMessage":
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.close_connection = True
                    self._event(rpc_id, {"message": reply})
                else:
                    self._json(200, {"jsonrpc": "2.0", "id": rpc_id, "result": {"message": reply}})
                return
            planned = fake.plan(message)
            if isinstance(planned, str):
                self._rpc_error(rpc_id, -32001, planned)
                return
            task, delay = planned
            if method == "SendStreamingMessage":
                self._stream(rpc_id, task, delay)
            else:
                self._plain(rpc_id, task, delay)
        elif method == "GetTask":
            task = fake._task(str(params.get("id")))
            if task is None:
                self._rpc_error(rpc_id, -32001, "Task not found")
            else:
                self._json(200, {"jsonrpc": "2.0", "id": rpc_id, "result": task})
        elif method == "CancelTask":
            task = fake.cancel(str(params.get("id")))
            if task is None:
                self._rpc_error(rpc_id, -32001, "Task not found")
            else:
                self._json(200, {"jsonrpc": "2.0", "id": rpc_id, "result": task})
        else:
            self._rpc_error(rpc_id, -32601, "Method not found")

    def _rpc_error(self, rpc_id: Any, code: int, message: str) -> None:
        self._json(200, {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}})

    def _plain(self, rpc_id: Any, task: dict[str, Any], delay: float) -> None:
        fake = self.owner
        if delay > 0:
            working = {"id": task["id"], "contextId": task["contextId"],
                       "status": {"state": WORKING, "timestamp": _now()}}
            fake._store(working)
            with fake._lock:
                fake._finish_at[task["id"]] = (time.monotonic() + delay,
                                               {"status": task["status"], "artifacts": task.get("artifacts", [])})
            self._json(200, {"jsonrpc": "2.0", "id": rpc_id, "result": {"task": working}})
            return
        fake._store(task)
        self._json(200, {"jsonrpc": "2.0", "id": rpc_id, "result": {"task": task}})

    def _event(self, rpc_id: Any, result: dict[str, Any]) -> bool:
        data = json.dumps({"jsonrpc": "2.0", "id": rpc_id, "result": result})
        try:
            self.wfile.write(f"data: {data}\n\n".encode())
            self.wfile.flush()
        except OSError:
            return False
        return True

    def _stream(self, rpc_id: Any, task: dict[str, Any], delay: float) -> None:
        fake = self.owner
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        task_id, context_id = task["id"], task["contextId"]
        working = {"id": task_id, "contextId": context_id, "status": {"state": WORKING, "timestamp": _now()}}
        fake._store(working)
        if not self._event(rpc_id, {"task": working}):
            return
        deadline = time.monotonic() + delay
        while time.monotonic() < deadline:
            if fake.canceled(task_id):
                return
            time.sleep(0.05)
        for art in task.get("artifacts", []):
            parts = art["parts"]
            if len(parts) == 1 and isinstance(parts[0].get("text"), str) and len(parts[0]["text"]) > 1:
                text = parts[0]["text"]
                half = len(text) // 2
                chunks = [({**art, "parts": [{"text": text[:half]}]}, False, False),
                          ({**art, "parts": [{"text": text[half:]}]}, True, True)]
            else:
                chunks = [(art, False, True)]
            for chunk, append, last in chunks:
                update = {"taskId": task_id, "contextId": context_id, "artifact": chunk, "lastChunk": last}
                if append:
                    update["append"] = True
                if not self._event(rpc_id, {"artifactUpdate": update}):
                    return
        fake._store(task)
        self._event(rpc_id, {"statusUpdate": {"taskId": task_id, "contextId": context_id, "status": task["status"]}})


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="fake_a2a", description="A fake A2A v1.0 agent on 127.0.0.1.")
    parser.add_argument("--port", type=int, default=8799)
    parser.add_argument("--no-streaming", action="store_true")
    parser.add_argument("--token", default=None)
    parser.add_argument("--name", default="Fake Planner")
    args = parser.parse_args(argv)
    fake = FakeA2A(streaming=not args.no_streaming, token=args.token, name=args.name, port=args.port)
    url = fake.start()
    print(f"Fake A2A agent at {url} (card {url}{CARD_PATH}); Ctrl+C stops it.", flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        fake.stop()


if __name__ == "__main__":
    main()
