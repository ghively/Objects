"""M20 Task 2: the A2A 1.0 JSON-RPC client (``objectapp.a2a``) against the fake A2A agent.

Every test talks only to `fake_a2a.FakeA2A` (or a tiny stdlib redirect server) on ``127.0.0.1``.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import sys
import threading
import time
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from objectapp import a2a, remotemodel
from objectapp.a2a import A2AError, Auth, Card, Update

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fake_a2a  # noqa: E402

TOKEN = "s3cret-bearer-value"
BEARER = Auth("bearer", None, TOKEN)


@pytest.fixture
def fake() -> Iterator[fake_a2a.FakeA2A]:
    f = fake_a2a.FakeA2A(token=TOKEN)
    f.start()
    try:
        yield f
    finally:
        f.stop()


@pytest.fixture
def plain_fake() -> Iterator[fake_a2a.FakeA2A]:
    f = fake_a2a.FakeA2A(token=TOKEN, streaming=False)
    f.start()
    try:
        yield f
    finally:
        f.stop()


def _card(f: fake_a2a.FakeA2A) -> Card:
    return asyncio.run(a2a.fetch_card(f.base_url + fake_a2a.CARD_PATH, BEARER))


def _send(card: Card, text: str | list[dict[str, Any]], *, auth: Auth = BEARER, within: float = 15.0,
          context_id: str | None = None, task_id: str | None = None) -> list[Update]:
    parts = [{"text": text}] if isinstance(text, str) else text

    async def go() -> list[Update]:
        msg = a2a.user_message(parts, context_id=context_id, task_id=task_id)
        deadline = asyncio.get_running_loop().time() + within
        return [u async for u in a2a.send(card, auth, msg, deadline=deadline)]

    return asyncio.run(go())


def _rpc(f: fake_a2a.FakeA2A, method: str) -> list[dict[str, Any]]:
    return [r for r in f.requests if r["rpc"] == method]


def _no_kind(value: Any) -> bool:
    if isinstance(value, dict):
        return "kind" not in value and all(_no_kind(v) for v in value.values())
    if isinstance(value, list):
        return all(_no_kind(v) for v in value)
    return True


def _header(entry: dict[str, Any], name: str) -> str | None:
    return {k.lower(): v for k, v in entry["headers"].items()}.get(name.lower())


# -- the card ---------------------------------------------------------------------------------


def test_fetch_and_parse_card(fake: fake_a2a.FakeA2A) -> None:
    card = _card(fake)
    assert card.name == "Fake Planner"
    assert card.endpoint_url == fake.base_url + "/a2a"
    assert card.protocol_version == "1.0"
    assert card.streaming is True
    assert card.description == "A synthetic agent for Object's tests."
    assert card.version == "1.0.0"
    assert card.provider == "Fake Org"
    assert card.documentation_url == "https://example.org/docs"
    assert card.skills == ({"id": "plan-trip", "name": "Plan a trip", "description": "Plans a short trip.",
                            "tags": ["travel"], "examples": ["Plan two days in Lisbon."]},)
    assert card.input_modes == ("text/plain", "text/markdown")
    assert card.output_modes == ("text/plain", "application/json")
    assert card.raw["name"] == "Fake Planner"
    get = fake.requests[-1]
    assert get["method"] == "GET" and get["path"] == fake_a2a.CARD_PATH
    assert _header(get, "A2A-Version") == "1.0"
    assert _header(get, "Authorization") == f"Bearer {TOKEN}"


def test_parse_card_cuts_skill_strings() -> None:
    card = a2a.parse_card({"name": "N", "supportedInterfaces": [
        {"url": "https://h.example/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.2"}],
        "skills": [{"id": "s", "name": "x" * 900, "description": "d", "tags": ["t" * 600, 3], "examples": []}]})
    assert card.protocol_version == "1.2"
    assert card.streaming is False
    assert len(card.skills[0]["name"]) == 500
    assert card.skills[0]["tags"] == ["t" * 500]


_INTERFACE_OK = {"url": "https://h.example/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}


@pytest.mark.parametrize(("data", "message"), [
    ({"name": "Old", "url": "https://h.example/a2a", "protocolVersion": "0.3.0"},
     "This agent speaks A2A 0.3.0; Object speaks A2A 1.0."),
    ({"name": "G", "supportedInterfaces": [{**_INTERFACE_OK, "protocolBinding": "GRPC"}]},
     "This agent doesn't offer A2A 1.0 over JSON-RPC."),
    ({"name": "F", "supportedInterfaces": [{**_INTERFACE_OK, "url": "file:///etc/passwd"}]},
     "This agent doesn't offer A2A 1.0 over JSON-RPC."),
    ({"name": "J", "supportedInterfaces": [{**_INTERFACE_OK, "url": "javascript:alert(1)"}]},
     "This agent doesn't offer A2A 1.0 over JSON-RPC."),
    ({"name": "V", "supportedInterfaces": [{**_INTERFACE_OK, "protocolVersion": "0.3"}]},
     "This agent doesn't offer A2A 1.0 over JSON-RPC."),
    ({"name": "Nothing"}, "This agent doesn't offer A2A 1.0 over JSON-RPC."),
    ([], "That address didn't answer with an Agent Card."),
    ("x", "That address didn't answer with an Agent Card."),
    ({}, "That address didn't answer with an Agent Card."),
    ({"name": 3, "supportedInterfaces": [_INTERFACE_OK]}, "That address didn't answer with an Agent Card."),
])
def test_card_refusals(data: Any, message: str) -> None:
    with pytest.raises(A2AError) as err:
        a2a.parse_card(data)
    assert err.value.status == 422
    assert err.value.message == message


def test_card_refusals_over_the_wire(fake: fake_a2a.FakeA2A) -> None:
    fake.card_override = {"name": "Old", "url": fake.base_url + "/a2a", "protocolVersion": "0.3.0"}
    with pytest.raises(A2AError) as err:
        _card(fake)
    assert (err.value.status, err.value.message) == (422, "This agent speaks A2A 0.3.0; Object speaks A2A 1.0.")


def test_card_too_large(fake: fake_a2a.FakeA2A) -> None:
    big = {"name": "Big", "description": ""}
    big["description"] = "a" * (remotemodel.CARD_MAX_BYTES + 1 - len(json.dumps(big)))
    assert len(json.dumps(big).encode()) == remotemodel.CARD_MAX_BYTES + 1
    fake.card_override = big
    with pytest.raises(A2AError) as err:
        _card(fake)
    assert (err.value.status, err.value.message) == (502, "The Agent Card is too large.")


def test_card_not_json(fake: fake_a2a.FakeA2A) -> None:
    with pytest.raises(A2AError) as err:
        asyncio.run(a2a.fetch_card(fake.base_url + "/nowhere.json", BEARER))
    assert err.value.status == 502
    assert err.value.message == f"{fake.base_url.removeprefix('http://')} answered 404."


def test_card_deeply_nested_json(fake: fake_a2a.FakeA2A) -> None:
    # json.loads raises RecursionError (not ValueError) on deeply nested input.
    fake.card_raw = b"[" * 200_000
    with pytest.raises(A2AError) as err:
        _card(fake)
    assert (err.value.status, err.value.message) == (422, "That address didn't answer with an Agent Card.")


def test_card_url_must_be_http() -> None:
    with pytest.raises(A2AError) as err:
        asyncio.run(a2a.fetch_card("file:///etc/passwd", BEARER))
    assert err.value.status == 422


# -- sending ----------------------------------------------------------------------------------


def test_send_streaming(fake: fake_a2a.FakeA2A) -> None:
    card = _card(fake)
    updates = _send(card, "hi")
    req = _rpc(fake, "SendStreamingMessage")[-1]
    assert _header(req, "Accept") == "text/event-stream"
    assert _header(req, "A2A-Version") == "1.0"
    assert _header(req, "User-Agent") == "Object"
    assert _header(req, "Content-Type") == "application/json"
    msg = req["params"]["message"]
    assert msg["messageId"] and msg["role"] == "ROLE_USER" and msg["parts"] == [{"text": "hi"}]
    assert "contextId" not in msg and "taskId" not in msg
    assert _no_kind(req["params"])
    assert req["params"]["configuration"] == {"acceptedOutputModes": list(remotemodel.OUTPUT_MODES),
                                              "returnImmediately": False}
    texts = [u for u in updates if u.kind == "text"]
    assert len(texts) == 2
    joined = "".join(u.text for u in texts)
    assert joined.startswith("Echo: hi\nctx=")
    assert texts[0].artifact_id == texts[1].artifact_id is not None
    last = updates[-1]
    assert last.kind == "state" and last.state == "TASK_STATE_COMPLETED"
    assert last.context_id and last.task_id
    assert joined == f"Echo: hi\nctx={last.context_id} task=-"


def test_send_plain_polls(plain_fake: fake_a2a.FakeA2A) -> None:
    card = _card(plain_fake)
    assert card.streaming is False
    started = time.monotonic()
    updates = _send(card, "A2A:slow:2")
    took = time.monotonic() - started
    assert len(_rpc(plain_fake, "SendMessage")) == 1
    assert not _rpc(plain_fake, "SendStreamingMessage")
    polls = _rpc(plain_fake, "GetTask")
    assert 1 <= len(polls) <= 4
    assert polls[0]["params"]["historyLength"] == 0
    assert 1.5 <= took < 6
    assert updates[-1].kind == "state" and updates[-1].state == "TASK_STATE_COMPLETED"
    assert [u.text for u in updates if u.kind == "text"][0].startswith("Echo: A2A:slow:2")


@pytest.mark.parametrize("streaming", [True, False])
def test_message_result(streaming: bool) -> None:
    with fake_a2a.FakeA2A(token=TOKEN, streaming=streaming) as f:
        updates = _send(_card(f), "A2A:message please")
    assert [u.text for u in updates if u.kind == "text"] == ["Just a message: A2A:message please"]
    last = updates[-1]
    assert last.kind == "state" and last.state is None and last.context_id


def test_context_and_task_ids_sent(fake: fake_a2a.FakeA2A) -> None:
    msg = a2a.user_message([{"text": "x"}], context_id="c1", task_id="t1")
    assert msg["contextId"] == "c1" and msg["taskId"] == "t1" and msg["role"] == "ROLE_USER"
    bare = a2a.user_message([{"text": "x"}], context_id=None, task_id=None)
    assert "contextId" not in bare and "taskId" not in bare
    assert bare["messageId"] != msg["messageId"]
    card = _card(fake)
    first = _send(card, "one")[-1]
    second = _send(card, "two", context_id=first.context_id)
    sent = _rpc(fake, "SendStreamingMessage")[-1]["params"]["message"]
    assert sent["contextId"] == first.context_id
    assert second[-1].context_id == first.context_id


@pytest.mark.parametrize("streaming", [True, False])
def test_input_required(streaming: bool) -> None:
    with fake_a2a.FakeA2A(token=TOKEN, streaming=streaming) as f:
        card = _card(f)
        updates = _send(card, "A2A:input")
        last = updates[-1]
        assert last.state == "TASK_STATE_INPUT_REQUIRED"
        assert last.status_text == "Which date?"
        assert not [u for u in updates if u.kind == "text"]
        follow = _send(card, "June 3", context_id=last.context_id, task_id=last.task_id)
    assert follow[-1].state == "TASK_STATE_COMPLETED"
    assert "".join(u.text for u in follow if u.kind == "text") == "Booked for June 3"


def test_task_not_found_retries_without_task_id(fake: fake_a2a.FakeA2A) -> None:
    card = _card(fake)
    updates = _send(card, "again", task_id="task-unknown")
    sends = _rpc(fake, "SendStreamingMessage")
    assert len(sends) == 2
    assert sends[0]["params"]["message"]["taskId"] == "task-unknown"
    assert "taskId" not in sends[1]["params"]["message"]
    assert updates[-1].state == "TASK_STATE_COMPLETED"


@pytest.mark.parametrize("streaming", [True, False])
def test_artifacts(streaming: bool) -> None:
    with fake_a2a.FakeA2A(token=TOKEN, streaming=streaming) as f:
        card = _card(f)
        files = [u for u in _send(card, "A2A:file") if u.kind == "file"]
        urls = [u for u in _send(card, "A2A:url") if u.kind == "file"]
        datas = [u for u in _send(card, "A2A:data") if u.kind == "data"]
    assert len(files) == 1
    assert (files[0].raw, files[0].name, files[0].media_type, files[0].url) == (
        b"# Plan", "plan.md", "text/markdown", None)
    assert files[0].artifact_id
    assert len(urls) == 1 and urls[0].url == "https://example.org/x.pdf" and urls[0].raw is None
    assert len(datas) == 1 and datas[0].data == {"rooms": 2}


@pytest.mark.parametrize("streaming", [True, False])
def test_terminal_states_come_through(streaming: bool) -> None:
    with fake_a2a.FakeA2A(token=TOKEN, streaming=streaming) as f:
        card = _card(f)
        fail = _send(card, "A2A:fail")[-1]
        auth = _send(card, "A2A:auth")[-1]
    assert (fail.state, fail.status_text) == ("TASK_STATE_FAILED", "The fake planner broke.")
    assert auth.state == "TASK_STATE_AUTH_REQUIRED"
    assert "TASK_STATE_FAILED" in a2a.STATE_TERMINAL and "TASK_STATE_AUTH_REQUIRED" in a2a.STATE_INTERRUPTED


@pytest.mark.parametrize("streaming", [True, False])
def test_deadline_cancels(streaming: bool) -> None:
    with fake_a2a.FakeA2A(token=TOKEN, streaming=streaming) as f:
        card = _card(f)
        started = time.monotonic()
        with pytest.raises(A2AError) as err:
            _send(card, "A2A:slow:30", within=1.0)
        took = time.monotonic() - started
        cancels = _rpc(f, "CancelTask")
        task_id = cancels[0]["params"]["id"] if cancels else None
        known = f._task(task_id) if task_id else None
    assert err.value.status == 504
    assert took < 8
    assert len(cancels) == 1
    assert known is not None and known["status"]["state"] == "TASK_STATE_CANCELED"


def test_cancel_swallows_errors(fake: fake_a2a.FakeA2A) -> None:
    card = _card(fake)
    asyncio.run(a2a.cancel(card, BEARER, "task-unknown"))
    dead = Card(**{**card.__dict__, "endpoint_url": "http://127.0.0.1:9/a2a"})
    asyncio.run(a2a.cancel(dead, BEARER, "task-x"))
    assert _rpc(fake, "CancelTask")[-1]["params"] == {"id": "task-unknown"}


# -- hostile answers --------------------------------------------------------------------------


def _sse(*events: Any) -> bytes:
    out = b""
    for e in events:
        out += (e if isinstance(e, bytes) else b"data: " + json.dumps(e).encode()) + b"\n\n"
    return out


def _env(result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": "1", "result": result}


_SSE = {"Content-Type": "text/event-stream"}
_JSON = {"Content-Type": "application/json"}
_DONE = _env({"statusUpdate": {"taskId": "t", "contextId": "c", "status": {"state": "TASK_STATE_COMPLETED"}}})


def _artifact(*parts: dict[str, Any]) -> dict[str, Any]:
    return _env({"artifactUpdate": {"taskId": "t", "contextId": "c",
                                    "artifact": {"artifactId": "a1", "parts": list(parts)}}})


HOSTILE: list[tuple[str, bool, Callable[[str], tuple[int, dict[str, str], bytes]], Any]] = [
    ("html-502", True, lambda m: (502, {"Content-Type": "text/html"}, b"<html>Bad gateway</html>"),
     (502, "{host} answered 502.")),
    ("http-401", True, lambda m: (401, _JSON, b"{}"), (502, "{host} answered 401.")),
    ("rpc-error", True, lambda m: (200, _JSON, json.dumps({"jsonrpc": "2.0", "id": "1", "error": {
        "code": -32001, "message": "nope"}}).encode()),
     (502, "Fake Planner answered with an error: nope (-32001)")),
    ("rpc-error-long", False, lambda m: (200, _JSON, json.dumps({"jsonrpc": "2.0", "id": "1", "error": {
        "code": -32603, "message": "x" * 400}}).encode()),
     (502, f"Fake Planner answered with an error: {'x' * 300} (-32603)")),
    ("neither", False, lambda m: (200, _JSON, json.dumps(_env({"other": 1})).encode()),
     (502, "Fake Planner sent an answer Object can't read.")),
    ("not-json", False, lambda m: (200, _JSON, b"<html>"), (502, "Fake Planner sent an answer Object can't read.")),
    ("sse-bad-line", True, lambda m: (200, _SSE, _sse(b"data: {not json", _artifact({"text": "fine"}), _DONE)),
     ["fine"]),
    ("nested-json", False, lambda m: (200, _JSON, b"[" * 10_000),
     (502, "Fake Planner sent an answer Object can't read.")),
    ("nested-json-streaming", True, lambda m: (200, _JSON, b"[" * 10_000),
     (502, "Fake Planner sent an answer Object can't read.")),
    ("sse-nested-line", True, lambda m: (200, _SSE, _sse(b"data: " + b"[" * 10_000, _artifact({"text": "fine"}), _DONE)),
     ["fine"]),
    ("sse-kind-ignored", True, lambda m: (200, _SSE, _sse(_artifact({"kind": "text", "text": "typed"}), _DONE)),
     ["typed"]),
    ("sse-bad-base64", True, lambda m: (200, _SSE, _sse(
        _artifact({"raw": "!!not base64!!", "filename": "x.bin"}), _artifact({"text": "after"}), _DONE)),
     ["(A file that couldn't be read was left out.)", "after"]),
    ("sse-too-much", True, lambda m: (200, _SSE, _sse(*[_artifact({"text": "y" * 1000})] * 30, _DONE)),
     (502, "Fake Planner sent more than Object accepts.")),
    ("file-too-big", True, lambda m: (200, _SSE, _sse(
        _artifact({"raw": base64.b64encode(b"z" * 3000).decode(), "filename": "big.bin"}), _DONE)),
     (502, "Fake Planner sent more than Object accepts.")),
    ("plain-too-much", False, lambda m: (200, _JSON, json.dumps(_env({"message": {
        "messageId": "m", "role": "ROLE_AGENT", "parts": [{"text": "q" * 30_000}]}})).encode()),
     (502, "Fake Planner sent more than Object accepts.")),
]


@pytest.mark.parametrize(("streaming", "override", "expect"), [h[1:] for h in HOSTILE], ids=[h[0] for h in HOSTILE])
def test_hostile_answers(monkeypatch: pytest.MonkeyPatch, streaming: bool,
                         override: Callable[[str], tuple[int, dict[str, str], bytes]], expect: Any) -> None:
    monkeypatch.setattr(remotemodel, "STREAM_MAX_BYTES", 20_000)
    monkeypatch.setattr(remotemodel, "RESPONSE_MAX_BYTES", 20_000)
    monkeypatch.setattr(remotemodel, "FILE_MAX_BYTES", 2_000)
    with fake_a2a.FakeA2A(token=TOKEN, streaming=streaming) as f:
        card = _card(f)
        f.raw_override = override
        host = f.base_url.removeprefix("http://")
        if isinstance(expect, tuple):
            with pytest.raises(A2AError) as err:
                _send(card, "hi")
            assert (err.value.status, err.value.message) == (expect[0], expect[1].format(host=host))
        else:
            updates = _send(card, "hi")
            assert [u.text for u in updates if u.kind == "text"] == expect
            assert updates[-1].state == "TASK_STATE_COMPLETED"


def test_stream_without_final_state_polls(fake: fake_a2a.FakeA2A) -> None:
    card = _card(fake)
    def override(method: str) -> tuple[int, dict[str, str], bytes]:
        if method == "GetTask":
            return 200, _JSON, json.dumps({"jsonrpc": "2.0", "id": "1", "result": {
                "id": "t", "contextId": "c", "status": {"state": "TASK_STATE_COMPLETED"},
                "artifacts": [{"artifactId": "a1", "parts": [{"text": "streamed"}]},
                              {"artifactId": "a2", "parts": [{"text": "late"}]}]}}).encode()
        return 200, _SSE, _sse(_env({"task": {"id": "t", "contextId": "c", "status": {"state": "TASK_STATE_WORKING"}}}),
                               _artifact({"text": "streamed"}))

    fake.raw_override = override
    updates = _send(card, "hi")
    assert [u.text for u in updates if u.kind == "text"] == ["streamed", "late"]
    assert updates[-1].state == "TASK_STATE_COMPLETED" and updates[-1].task_id == "t"


# -- redirects and the secret -----------------------------------------------------------------


class _Redirect(BaseHTTPRequestHandler):
    target = ""

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def _go(self) -> None:
        self.send_response(302)
        self.send_header("Location", self.target)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        self._go()

    def do_POST(self) -> None:  # noqa: N802
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self._go()


def test_redirects_not_followed_and_auth_not_forwarded(fake: fake_a2a.FakeA2A,
                                                        caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    other = fake_a2a.FakeA2A()
    other_url = other.start()
    port = other_url.rsplit(":", 1)[1]

    class Handler(_Redirect):
        target = f"http://localhost:{port}{fake_a2a.CARD_PATH}"

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    redirect_host = f"127.0.0.1:{httpd.server_address[1]}"
    errors: list[A2AError] = []
    try:
        with pytest.raises(A2AError) as err:
            asyncio.run(a2a.fetch_card(f"http://{redirect_host}{fake_a2a.CARD_PATH}", BEARER))
        errors.append(err.value)
        assert (err.value.status, err.value.message) == (502, f"{redirect_host} answered 302.")
        # The endpoint redirecting a JSON-RPC call is refused the same way.
        card = _card(fake)
        moved = Card(**{**card.__dict__, "endpoint_url": f"http://{redirect_host}/a2a"})
        with pytest.raises(A2AError) as err2:
            _send(moved, "hi")
        errors.append(err2.value)
        assert (err2.value.status, err2.value.message) == (502, f"{redirect_host} answered 302.")
        # The endpoint refusing the connection says so without the token.
        dead = Card(**{**card.__dict__, "endpoint_url": "http://127.0.0.1:9/a2a"})
        with pytest.raises(A2AError) as err3:
            _send(dead, "hi")
        errors.append(err3.value)
        assert err3.value.status == 502
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)
        other.stop()
    assert other.requests == []
    for e in errors:
        assert TOKEN not in e.message and TOKEN not in str(e)
    for record in caplog.records:
        assert TOKEN not in record.getMessage()
        assert TOKEN not in repr(record.args)
    assert TOKEN not in caplog.text


def test_auth_header_kind() -> None:
    with fake_a2a.FakeA2A(header=("X-Api-Key", "k")) as f:
        auth = Auth("header", "X-Api-Key", "k")
        card = _card_with(f, auth)
        updates = _send(card, "hi", auth=auth)
        sent = _rpc(f, "SendStreamingMessage")[-1]
    assert updates[-1].state == "TASK_STATE_COMPLETED"
    assert _header(sent, "X-Api-Key") == "k"
    assert _header(sent, "Authorization") is None
    assert "'k'" not in repr(auth) and "value='k'" not in repr(auth)
    assert repr(Auth("bearer", None, "zz-secret-zz")).find("zz-secret-zz") == -1


def _card_with(f: fake_a2a.FakeA2A, auth: Auth) -> Card:
    return asyncio.run(a2a.fetch_card(f.base_url + fake_a2a.CARD_PATH, auth))


def test_missing_auth_is_401(fake: fake_a2a.FakeA2A) -> None:
    with pytest.raises(A2AError) as err:
        asyncio.run(a2a.fetch_card(fake.base_url + fake_a2a.CARD_PATH, Auth("none")))
    assert err.value.message.endswith("answered 401.")
