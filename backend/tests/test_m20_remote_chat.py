"""M20 Task 4: chatting with a remote agent over A2A in the same panel (``/api/ai/chat``).

The app comes from `create_app` over a synthetic space (``Pages/Open.md`` with ``OPEN-TEXT``,
``Pages/Secret.md`` excluded from AI with ``SECRET-MARKER``, a Task template with
``TEMPLATE-MARKER``), a `FakeA2A` on ``127.0.0.1`` and a remote agent added with
`AgentRegistry.create_remote`. ``OBJECT_STATE_DIR`` is a temp folder (conftest).
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fake_a2a import FakeA2A
from fastapi.testclient import TestClient
from objectapp import a2a, ai, remotechat, remotesecrets, transcripts
from objectapp import settings as device_settings
from objectapp.agents import AgentRegistry
from objectapp.remotemodel import DATA_BLOCK_MAX_CHARS, AuthInput
from objectapp.server import create_app
from objectapp.space import Space

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
TOKEN = "t-remote-token"
OPEN = "Pages/Open.md"
SECRET = "Pages/Secret.md"
TEMPLATE = "Templates/Tasks/Bug report.md"


def _set(**patch) -> None:
    _data, revision = device_settings.read()
    device_settings.patch(patch, revision)


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))


@pytest.fixture
def space_root(full_space_dir: Path) -> Path:
    _write(full_space_dir / OPEN, "---\ntype: 'Page'\ntitle: Open\n---\n\nOPEN-TEXT lives here.\n")
    _write(full_space_dir / SECRET,
           "---\ntype: 'Page'\ntitle: Secret\nexcludeFromAI: true\n---\n\nSECRET-MARKER lives here.\n")
    tpl = full_space_dir / TEMPLATE
    tpl.write_bytes(tpl.read_bytes() + b"- [ ] TEMPLATE-MARKER\n")
    return full_space_dir


@pytest.fixture
def no_claude(tmp_path: Path, monkeypatch) -> Path:
    """No Claude Code at all: claudePath unset and PATH without it; the fake's log stays absent."""
    log = tmp_path / "claude-log.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    monkeypatch.setattr(ai, "find_claude", lambda _setting: None)
    return log


def _start_fake(**kw: Any) -> FakeA2A:
    fake = FakeA2A(token=TOKEN, **kw)
    fake.start()
    return fake


@pytest.fixture
def fake() -> Iterator[FakeA2A]:
    f = _start_fake()
    yield f
    f.stop()


def _add_remote(fake: FakeA2A, *, notice: bool = False) -> Any:
    reg = AgentRegistry()
    card = a2a.parse_card(fake.card())
    rec = reg.create_remote(card, fake.card(), fake.base_url + "/.well-known/agent-card.json",
                            AuthInput(kind="bearer", value=TOKEN))
    if notice:
        reg.mark_context_notice(rec.id)
        rec = reg.get(rec.id)
    return rec


def _app(root: Path):
    space = Space(root)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    return space, app, published


@pytest.fixture
def api(space_root: Path, no_claude):
    space, app, published = _app(space_root)
    with TestClient(app) as client:
        yield space, client, published


def _frames(raw: str) -> list[dict]:
    out = []
    for frame in raw.replace("\r\n", "\n").split("\n\n"):
        data = [line[5:].lstrip(" ") for line in frame.split("\n") if line.startswith("data:")]
        if data:
            out.append(json.loads("\n".join(data)))
    return out


def _chat(client: TestClient, prompt: str, agent_id: str, **extra) -> list[dict]:
    body = {"mode": "chat", "prompt": prompt, "contextPaths": [], "history": [], "agentId": agent_id, **extra}
    res = client.post("/api/ai/chat", json=body)
    assert res.status_code == 200, res.text
    return _frames(res.text)


def _rpc(fake: FakeA2A, *methods: str) -> list[dict]:
    return [r for r in fake.requests if r["rpc"] in methods]


def _sent_messages(fake: FakeA2A) -> list[dict]:
    return [r["params"]["message"] for r in _rpc(fake, "SendMessage", "SendStreamingMessage")]


def _snapshot(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*")
            if p.is_file() and ".object-cache" not in p.parts}


def _lines(rec: Any, chat_id: str) -> list[dict]:
    return transcripts.raw_lines(rec.folder, chat_id)


# -- a turn ---------------------------------------------------------------------------------------


def test_remote_turn_streams(api, fake, no_claude) -> None:
    _space, client, _ = api
    rec = _add_remote(fake)
    events = _chat(client, "hi", rec.id)
    assert [e["type"] for e in events] == ["chat", "text", "text", "done"]
    assert events[0] == {"type": "chat", "chatId": events[0]["chatId"], "agentId": rec.id}
    done = events[-1]
    assert done["sessionId"] is None and done["proposal"] is None and done["skipped"] == []
    (msg,) = _sent_messages(fake)
    task = "-"
    ctx = done["text"].split("ctx=")[1].split(" ")[0]
    assert done["text"] == f"Echo: hi\nctx={ctx} task={task}"
    assert "".join(e["text"] for e in events if e["type"] == "text") == done["text"]
    assert _rpc(fake, "SendStreamingMessage") and not _rpc(fake, "SendMessage")
    assert msg["parts"] == [{"text": "hi"}] and "contextId" not in msg
    assert not no_claude.exists()


def test_plain_send_when_card_has_no_streaming(api, no_claude) -> None:
    _space, client, _ = api
    fake = _start_fake(streaming=False)
    try:
        rec = _add_remote(fake)
        events = _chat(client, "hi", rec.id)
        assert events[-1]["type"] == "done" and events[-1]["text"].startswith("Echo: hi")
        assert _rpc(fake, "SendMessage") and not _rpc(fake, "SendStreamingMessage")
    finally:
        fake.stop()


def test_transcript_written(api, fake) -> None:
    _space, client, published = api
    rec = _add_remote(fake)
    events = _chat(client, "hi", rec.id)
    chat_id = events[0]["chatId"]
    assert (rec.folder / ".object-agent" / "sessions" / f"{chat_id}.jsonl").is_file()
    header, user, answer = _lines(rec, chat_id)
    assert header["type"] == "chat" and header["delegated"] is False and header["agentId"] == rec.id
    assert user["type"] == "user" and user["text"] == "hi" and user["contextPaths"] == []
    assert answer["type"] == "assistant" and answer["model"] is None and answer["sessionId"] is None
    assert answer["a2a"]["state"] == "TASK_STATE_COMPLETED" and answer["a2a"]["contextId"].startswith("ctx-")
    assert answer["text"] == events[-1]["text"]
    assert any(e.kind == "agentChats" and e.path == rec.id and e.version == chat_id for e in published)


def test_context_id_kept_and_input_required_continues(api, fake) -> None:
    _space, client, _ = api
    rec = _add_remote(fake)
    first = _chat(client, "hi", rec.id)
    chat_id = first[0]["chatId"]
    ctx = _lines(rec, chat_id)[-1]["a2a"]["contextId"]

    _chat(client, "again", rec.id, chatId=chat_id)
    msg = _sent_messages(fake)[-1]
    assert msg["contextId"] == ctx and "taskId" not in msg

    asked = _chat(client, "Book it A2A:input", rec.id, chatId=chat_id)
    assert asked[-1]["type"] == "done" and asked[-1]["text"] == "Which date?"
    task_id = _lines(rec, chat_id)[-1]["a2a"]["taskId"]

    answered = _chat(client, "June 3", rec.id, chatId=chat_id)
    msg = _sent_messages(fake)[-1]
    assert msg["taskId"] == task_id and msg["contextId"] == ctx
    assert answered[-1]["text"] == "Booked for June 3"

    _chat(client, "thanks", rec.id, chatId=chat_id)
    msg = _sent_messages(fake)[-1]
    assert "taskId" not in msg and msg["contextId"] == ctx

    _chat(client, "fresh", rec.id)
    msg = _sent_messages(fake)[-1]
    assert "contextId" not in msg and "taskId" not in msg


def test_task_not_found_retries_without_task_id(api, fake) -> None:
    _space, client, _ = api
    rec = _add_remote(fake)
    asked = _chat(client, "A2A:input", rec.id)
    chat_id = asked[0]["chatId"]
    task_id = _lines(rec, chat_id)[-1]["a2a"]["taskId"]
    with fake._lock:  # the fake forgets the task: it answers -32001 to that taskId
        fake._tasks.pop(task_id)
        fake._pending_input.discard(task_id)
    events = _chat(client, "June 3", rec.id, chatId=chat_id)
    sent = _sent_messages(fake)[-2:]
    assert sent[0].get("taskId") == task_id and "taskId" not in sent[1]
    assert events[-1]["type"] == "done" and events[-1]["text"].startswith("Echo: June 3")


# -- what never leaves ----------------------------------------------------------------------------


def test_excluded_context_never_sent(api, fake) -> None:
    _space, client, _ = api
    rec = _add_remote(fake, notice=True)
    events = _chat(client, "A2A:echo-parts", rec.id, contextPaths=[OPEN, SECRET, TEMPLATE])
    done = events[-1]
    assert done["type"] == "done" and "OPEN-TEXT" in done["text"]
    (msg,) = _sent_messages(fake)
    assert msg["parts"][0] == {"text": "A2A:echo-parts"}
    assert msg["parts"][1]["mediaType"] == "text/markdown" and msg["parts"][1]["filename"] == "Open.md"
    assert msg["parts"][1]["text"].startswith("# Open\n\n")
    for r in fake.requests:
        blob = json.dumps(r)
        assert "SECRET-MARKER" not in blob and "TEMPLATE-MARKER" not in blob
    assert {"path": SECRET, "reason": "excluded"} in done["skipped"]
    assert {"path": TEMPLATE, "reason": "template"} in done["skipped"]


def test_context_without_notice_is_428(api, fake) -> None:
    _space, client, _ = api
    rec = _add_remote(fake)
    body = {"mode": "chat", "prompt": "hi", "contextPaths": [OPEN], "history": [], "agentId": rec.id}
    res = client.post("/api/ai/chat", json=body)
    assert res.status_code == 428
    assert res.json() == {"detail": "Confirm that context leaves this computer first.", "agentId": rec.id,
                          "host": fake.base_url.split("//")[1]}
    assert not _rpc(fake, "SendMessage", "SendStreamingMessage")


@pytest.mark.parametrize("mode", ["askBlock", "tagBlock", "tagObject", "autofill", "rephrase"])
def test_proposal_modes_refused_for_remote(api, fake, mode) -> None:
    _space, client, _ = api
    rec = _add_remote(fake)
    events = _chat(client, "hi", rec.id, mode=mode, block="OPEN-TEXT lives here.", blockPath=OPEN)
    assert events == [{"type": "error", "message": "Remote agents can only chat."}]
    assert not _rpc(fake, "SendMessage", "SendStreamingMessage")


def test_missing_secret(api, fake) -> None:
    _space, client, _ = api
    rec = _add_remote(fake)
    remotesecrets.remove(rec.id)
    events = _chat(client, "hi", rec.id)
    assert events == [{"type": "error",
                       "message": "This remote agent needs its token again (its page > Replace token)."}]
    assert not _rpc(fake, "SendMessage", "SendStreamingMessage")


def test_hidden_ai_still_403(api, fake) -> None:
    _space, client, _ = api
    rec = _add_remote(fake)
    _set(aiHidden=True)
    res = client.post("/api/ai/chat", json={"mode": "chat", "prompt": "hi", "agentId": rec.id})
    assert res.status_code == 403
    assert not _rpc(fake, "SendMessage", "SendStreamingMessage")


# -- artifacts ------------------------------------------------------------------------------------


def test_artifacts_and_attachments(api, fake) -> None:
    _space, client, _ = api
    rec = _add_remote(fake)
    events = _chat(client, "A2A:file", rec.id)
    chat_id = events[0]["chatId"]
    (att,) = [e for e in events if e["type"] == "attachment"]
    assert att["agentId"] == rec.id and att["chatId"] == chat_id
    assert att["attachment"] == {"name": "plan.md", "mediaType": "text/markdown", "size": 6, "kind": "file",
                                 "file": f"{chat_id}/plan.md", "url": None}
    assert (rec.folder / ".object-agent" / "files" / chat_id / "plan.md").read_bytes() == b"# Plan"
    assert _lines(rec, chat_id)[-1]["attachments"] == [att["attachment"]]

    data = _chat(client, "A2A:data", rec.id)
    assert '```json\n{\n  "rooms": 2\n}\n```' in data[-1]["text"]

    url = _chat(client, "A2A:url", rec.id)
    (att,) = [e["attachment"] for e in url if e["type"] == "attachment"]
    assert att["kind"] == "url" and att["url"] == "https://example.org/x.pdf" and att["file"] is None


@pytest.mark.parametrize(("name", "media"), [
    ("../../evil.md", None), ("CON", None), ("a:b", None), ("", "application/pdf"), ("x" * 300 + ".txt", None),
])
def test_attachment_names_and_caps(tmp_path: Path, name: str, media: str | None) -> None:
    folder = tmp_path / "remote"
    chat_id = transcripts.new_chat_id()
    upd = a2a.Update("file", raw=b"x", name=name, media_type=media)
    att = remotechat.save_attachment(folder, chat_id, upd)
    assert att is not None and att["kind"] == "file"
    base = (folder / ".object-agent" / "files" / chat_id).resolve()
    saved = (folder / ".object-agent" / "files" / att["file"]).resolve()
    assert saved.parent == base and saved.is_file()
    assert len(att["name"]) <= 120 and att["file"] == f"{chat_id}/{att['name']}"
    assert att["name"].split(".")[0].upper() != "CON"
    if name == "":
        assert att["name"] == "attachment.pdf"
    if name == "CON":
        assert att["name"] == "_CON"


def test_attachment_clash_url_scheme_and_data_cap(tmp_path: Path) -> None:
    folder = tmp_path / "remote"
    chat_id = transcripts.new_chat_id()
    first = remotechat.save_attachment(folder, chat_id, a2a.Update("file", raw=b"1", name="plan.md"))
    second = remotechat.save_attachment(folder, chat_id, a2a.Update("file", raw=b"2", name="plan.md"))
    assert first["name"] == "plan.md" and second["name"] == "plan (2).md"
    assert remotechat.save_attachment(folder, chat_id, a2a.Update("file", url="javascript:alert(1)")) is None
    reply = remotechat._Reply(folder, chat_id)
    events = reply.take(a2a.Update("file", url="javascript:alert(1)"))
    assert reply.text() == "(A file link that isn't http or https was left out.)" and events[0]["type"] == "text"
    reply = remotechat._Reply(folder, chat_id)
    reply.take(a2a.Update("data", data={"blob": "y" * 1_000_000}))
    body = reply.text().split("```json\n", 1)[1].rsplit("\n```", 1)[0]
    assert body.endswith("…") and len(body) == DATA_BLOCK_MAX_CHARS + 1


# -- endings --------------------------------------------------------------------------------------


@pytest.mark.parametrize(("prompt", "message"), [
    ("A2A:fail", "Fake Planner couldn't do it: The fake planner broke."),
    ("A2A:reject", "Fake Planner turned the task down: Not something the fake planner does."),
    ("A2A:auth", "Fake Planner needs a sign-in that Object can't do."),
])
def test_terminal_states(api, fake, prompt, message) -> None:
    _space, client, _ = api
    rec = _add_remote(fake)
    events = _chat(client, prompt, rec.id)
    assert events[-1] == {"type": "error", "message": message}
    assert [e["type"] for e in events] == ["chat", "error"]
    last = _lines(rec, events[0]["chatId"])[-1]
    assert last["type"] == "error" and last["message"] == message


def test_canceled_state(tmp_path: Path) -> None:
    reply = remotechat._Reply(tmp_path, transcripts.new_chat_id())
    reply.take(a2a.Update("state", state="TASK_STATE_CANCELED", context_id="c", task_id="t"))
    assert reply.error_message("Fake Planner") == "Fake Planner canceled the task."
    reply = remotechat._Reply(tmp_path, transcripts.new_chat_id())
    reply.take(a2a.Update("state", state="TASK_STATE_FAILED"))
    assert reply.error_message("Fake Planner") == "Fake Planner couldn't do it."


def _raw_turn(app, body: bytes, until) -> list[bytes]:
    """Drive the ASGI app by hand and go away once `until()` holds (the client closing the stream)."""
    seen: list[bytes] = []

    async def go() -> None:
        got_data = asyncio.Event()
        sent = False

        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            await got_data.wait()
            deadline = time.monotonic() + 20
            while not until() and time.monotonic() < deadline:
                await asyncio.sleep(0.05)
            await asyncio.sleep(0.3)
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.body" and message.get("body"):
                seen.append(message["body"])
                if b'"chat"' in b"".join(seen):
                    got_data.set()

        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
            "scheme": "http", "path": "/api/ai/chat", "raw_path": b"/api/ai/chat", "query_string": b"",
            "root_path": "", "headers": [(b"host", b"testserver"), (b"content-type", b"application/json"),
                                         (b"content-length", str(len(body)).encode())],
            "client": ("127.0.0.1", 5000), "server": ("testserver", 80),
        }
        await asyncio.wait_for(app(scope, receive, send), timeout=40)

    asyncio.run(go())
    return seen


def test_stop_cancels_the_task(space_root: Path, fake, no_claude) -> None:
    rec = _add_remote(fake)
    _space, app, _ = _app(space_root)
    body = json.dumps({"mode": "chat", "prompt": "A2A:slow:30", "agentId": rec.id}).encode()
    seen = _raw_turn(app, body, lambda: bool(_rpc(fake, "SendStreamingMessage")))
    events = _frames(b"".join(seen).decode("utf-8"))
    chat_id = events[0]["chatId"]
    (cancel,) = _rpc(fake, "CancelTask")
    last = _lines(rec, chat_id)[-1]
    assert last["type"] == "assistant" and last["stopped"] is True and last["text"] == ""
    assert cancel["params"]["id"] == last["a2a"]["taskId"]


def test_timeout(api, fake, monkeypatch) -> None:
    _space, client, _ = api
    rec = _add_remote(fake)
    monkeypatch.setattr(ai, "TURN_TIMEOUT", 1.0)
    events = _chat(client, "A2A:slow:5", rec.id)
    assert events[-1] == {"type": "error", "message": "Fake Planner took too long (over 1 seconds) and was stopped."}
    assert _rpc(fake, "CancelTask")


def test_a_remote_turn_writes_no_space_file(api, fake, space_root: Path) -> None:
    _space, client, _ = api
    rec = _add_remote(fake, notice=True)
    before = _snapshot(space_root)
    for prompt in ("hi", "A2A:file", "A2A:data", "A2A:url", "A2A:input", "A2A:fail"):
        _chat(client, prompt, rec.id, contextPaths=[OPEN])
    assert _snapshot(space_root) == before


# -- one turn for an agent ------------------------------------------------------------------------


def test_call_remote_marks_delegated(fake, tmp_path: Path) -> None:
    rec = _add_remote(fake)
    result = asyncio.run(remotechat.call_remote(
        rec, "A2A:long:50", context_id=None, task_id=None, timeout=30, delegated_from="assistant",
        from_chat=None, space_name="Notes", space_key=None, cap=10))
    assert result.cut is True and result.text == "abcdefghij…"
    assert result.state == "TASK_STATE_COMPLETED" and result.context_id
    header = _lines(rec, result.chat_id)[0]
    assert header["delegated"] is True and header["from"] == "assistant"
    assert len(_lines(rec, result.chat_id)[-1]["text"]) == 50  # the transcript keeps it whole

    again = asyncio.run(remotechat.call_remote(
        rec, "more", context_id=result.context_id, task_id=None, timeout=30, delegated_from="assistant",
        from_chat=None, space_name="Notes", space_key=None, cap=10_000))
    assert again.chat_id == result.chat_id
    assert _sent_messages(fake)[-1]["contextId"] == result.context_id
    assert [line["type"] for line in _lines(rec, result.chat_id)] == ["chat", "user", "assistant", "user",
                                                                      "assistant"]
