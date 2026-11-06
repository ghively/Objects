"""M17 Task 7: ``/api/ai/chat`` talks to agents (run with the fake ``claude``).

``OBJECT_STATE_DIR`` is a temp folder (conftest). The space is a copy of ``space-sample``.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fake_claude import install
from fastapi.testclient import TestClient
from objectapp import aichat, toolcatalog, transcripts
from objectapp import settings as device_settings
from objectapp.appstate import state_dir
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import Registry
from objectapp.tokens import TokenStore

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
ULID = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
SESSION_A = "0f8fad5b-d9cb-469f-a165-70867728950e"
PROPOSAL_MODES = ("askBlock", "tagBlock", "tagObject", "autofill", "rephrase")
WRITE_TOOLS = {f"mcp__object__{t}" for t in toolcatalog.OBJECT_WRITE}


def _set(**patch) -> None:
    _data, revision = device_settings.read()
    device_settings.patch(patch, revision)


@pytest.fixture
def fake(tmp_path: Path, monkeypatch) -> dict:
    path = install(tmp_path / "bin")
    log = tmp_path / "claude-log.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    _set(claudePath=str(path))
    return {"path": path, "log": log}


@pytest.fixture
def tokens_made(monkeypatch) -> list[dict]:
    """Every ephemeral token a turn asks for (name, scope, agent, chat)."""
    made: list[dict] = []
    real = TokenStore.ephemeral

    def spy(self, name, scope="read", agent=None, chat=None):
        made.append({"name": name, "scope": scope, "agent": agent, "chat": chat})
        return real(self, name, scope, agent=agent, chat=chat)

    monkeypatch.setattr(TokenStore, "ephemeral", spy)
    return made


def _app(root: Path):
    space = Space(root)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    return space, app, published


@pytest.fixture
def api(space_dir: Path, fake):
    space, app, published = _app(space_dir)
    client = TestClient(app)
    with client:
        yield space, client, published


def _runs(log: Path) -> list[dict]:
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line]


def _frames(raw: str) -> list[dict]:
    out = []
    for frame in raw.split("\n\n"):
        data = [line[5:].lstrip(" ") for line in frame.split("\n") if line.startswith("data:")]
        if data:
            out.append(json.loads("\n".join(data)))
    return out


def _chat(client: TestClient, prompt: str = "Hi", **extra) -> list[dict]:
    body = {"mode": "chat", "prompt": prompt, "contextPaths": [], "history": [], **extra}
    res = client.post("/api/ai/chat", json=body)
    assert res.status_code == 200, res.text
    return _frames(res.text)


def _wait(published: list, count: int) -> None:
    deadline = time.monotonic() + 5
    while len(published) < count and time.monotonic() < deadline:
        time.sleep(0.01)


def _create(client: TestClient, name: str = "Researcher", **agent) -> dict:
    res = client.post("/api/agents", json={"agent": {"name": name, **agent}, "instructions": "Dig."})
    assert res.status_code == 201, res.text
    return res.json()


def _snapshot(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


# -- which agent ----------------------------------------------------------------------------------


def test_chat_defaults_to_the_assistant(api, fake) -> None:
    _space, client, _ = api
    assert not (state_dir() / "agents" / "Assistant").exists()
    events = _chat(client, "Hello")
    assert events[0]["type"] == "chat" and events[0]["agentId"] == "assistant"
    assert ULID.match(events[0]["chatId"]) and set(events[0]) == {"type", "chatId", "agentId"}
    assert events[1]["type"] == "session" and events[-1]["type"] == "done"
    folder = (state_dir() / "agents" / "Assistant").resolve()
    assert (folder / ".object-agent" / "agent.json").is_file()
    (run,) = _runs(fake["log"])
    assert Path(run["cwd"]).resolve() == folder
    assert run["settingSources"] == "project,local"
    # The guidance carries the intro now; the stdin prompt doesn't repeat M10's.
    assert "You are Assistant," in run["appendPrompt"]
    assert "You are the assistant inside Object" not in run["prompt"]


def test_chat_with_a_custom_agent(api, fake, tokens_made) -> None:
    _space, client, _ = api
    made = _create(client, model="haiku")
    events = _chat(client, "Hi", agentId=made["id"])
    assert events[0]["agentId"] == made["id"]
    chat_id = events[0]["chatId"]
    _chat(client, "Again", agentId=made["id"], model="opus", chatId=chat_id)
    first, second = _runs(fake["log"])
    assert Path(first["cwd"]).resolve() == Path(made["folder"]).resolve()
    assert first["model"] == "haiku" and second["model"] == "opus"
    assert [t["agent"] for t in tokens_made] == [made["id"], made["id"]]
    assert [t["name"] for t in tokens_made] == ["Researcher", "Researcher"]
    assert tokens_made[0]["chat"] == chat_id
    # The same chat id continues the same transcript.
    assert [c["id"] for c in transcripts.list_chats(Path(made["folder"]))] == [chat_id]


def test_direct_action(api, fake, tokens_made) -> None:
    _space, client, _ = api
    _chat(client, "Write it")
    (run,) = _runs(fake["log"])
    assert "mcp__object__write_body" in run["allowed"]
    assert WRITE_TOOLS <= set(run["allowed"])
    assert "--read-only" not in run["mcpConfig"]["mcpServers"]["object"]["args"]
    assert tokens_made[0]["scope"] == "read-write"


def test_proposal_modes_run_read_only(api, fake, tokens_made) -> None:
    _space, client, _ = api
    asks = {
        "askBlock": ("", "FAKE:x", "Pages/Notes.md"),
        "tagBlock": ("FAKE:tags", "Some block", "Pages/Notes.md"),
        "tagObject": ("FAKE:tags", None, None),
        "autofill": ("FAKE:props", None, None),
        "rephrase": ("FAKE:text", "a unclear sentence", "Pages/Notes.md"),
    }
    for mode in PROPOSAL_MODES:
        prompt, block, block_path = asks[mode]
        extra = {"mode": mode, "contextPaths": ["People/Ada Lovelace.md"]}
        if block:
            extra.update(block=block, blockPath=block_path)
        events = _chat(client, prompt, **extra)
        assert events[-1]["type"] == "done", (mode, events)
        if mode in ("tagBlock", "tagObject", "autofill", "rephrase"):
            assert events[-1]["proposal"] is not None, mode
    runs = _runs(fake["log"])
    assert len(runs) == len(PROPOSAL_MODES)
    for run in runs:
        assert run["mcpConfig"]["mcpServers"]["object"]["args"][-1] == "--read-only"
        assert not WRITE_TOOLS & set(run["allowed"])
        assert WRITE_TOOLS <= set(run["disallowed"])
        assert "can't change any note" in run["appendPrompt"]
    assert {t["scope"] for t in tokens_made} == {"read"}


def test_shell_switch(api, fake) -> None:
    _space, client, _ = api
    on = _create(client, "Shelly", toolsOff=[])
    _chat(client, "Hi", agentId=on["id"])
    _chat(client, "Hi")
    with_shell, default = _runs(fake["log"])
    assert "Bash" in with_shell["allowed"] and "Bash" not in with_shell["disallowed"]
    assert "Bash" in default["disallowed"] and "Bash" not in default["allowed"]


# -- the transcript -------------------------------------------------------------------------------


def test_transcript_written(api, fake) -> None:
    _space, client, published = api
    events = _chat(client, "FAKE:tool find alpha", contextPaths=["People/Ada Lovelace.md"])
    chat_id = events[0]["chatId"]
    _wait(published, 2)
    folder = state_dir() / "agents" / "Assistant"
    lines = [json.loads(x) for x in transcripts.path_for(folder, chat_id).read_text(encoding="utf-8").splitlines()]
    # M18: the chat's first run also writes the frozen memory snapshot line.
    assert [x["type"] for x in lines] == ["chat", "user", "memory", "tool", "assistant"]
    header, user, _memory, tool, answer = lines
    assert header["agentId"] == "assistant" and header["id"] == chat_id and header["v"] == 1
    assert header["title"] == "FAKE:tool find alpha" and header["space"]["name"] == _space.name
    assert user["text"] == "FAKE:tool find alpha" and user["contextPaths"] == ["People/Ada Lovelace.md"]
    assert tool["id"] == "toolu_1" and tool["name"] == "search" and tool["input"] == {"query": "alpha"}
    assert isinstance(tool["result"], str) and tool["isError"] is False
    done = events[-1]
    assert answer["sessionId"] == done["sessionId"] and answer["model"] is None
    # With tool steps the line keeps every streamed text (what the panel shows).
    assert answer["text"] == "".join(e["text"] for e in events if e["type"] == "text")
    assert "stopped" not in answer
    chats = [e for e in published if e.kind == "agentChats"]
    assert chats and all(e.path == "assistant" and e.version == chat_id and e.origin is None for e in chats)


def test_error_turn_is_recorded(api, fake) -> None:
    _space, client, _ = api
    events = _chat(client, "FAKE:error")
    assert events[-1]["type"] == "error"
    t = transcripts.read(state_dir() / "agents" / "Assistant", events[0]["chatId"])
    assert [i["type"] for i in t["items"]] == ["user", "error"]


def test_stopped_turn_is_marked(space_dir: Path, fake) -> None:
    """Closing the stream during ``FAKE:wait`` records what was shown so far, ``stopped``."""
    _space, app, _published = _app(space_dir)
    body = json.dumps({"mode": "chat", "prompt": "FAKE:wait", "contextPaths": [], "history": []}).encode()
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
            # Wait until the CLI started, then go away.
            deadline = time.monotonic() + 20
            while not _runs(fake["log"]) and time.monotonic() < deadline:
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
    events = _frames(b"".join(seen).decode("utf-8").replace("\r\n", "\n"))
    chat_id = events[0]["chatId"]
    t = transcripts.read(state_dir() / "agents" / "Assistant", chat_id)
    assert [i["type"] for i in t["items"]] == ["user", "assistant"]
    last = t["items"][-1]
    assert last["stopped"] is True and last["text"] == ""


def test_unknown_or_missing_agent(api, fake, tmp_path: Path) -> None:
    _space, client, _ = api
    assert _chat(client, "Hi", agentId="01JC7ZK3T9Q4M2X8B5N6R1V0WE") == [
        {"type": "error", "message": "That agent isn't listed any more."}]
    assert _chat(client, "Hi", agentId="../x") == [{"type": "error", "message": "That agent isn't listed any more."}]
    (tmp_path / "ext").mkdir()
    made = _create(client, "Gone", location=str(tmp_path / "ext"))
    folder = Path(made["folder"])
    import shutil

    shutil.rmtree(folder)
    assert _chat(client, "Hi", agentId=made["id"]) == [
        {"type": "error", "message": f"This agent's folder is missing: {folder}"}]
    locked = _create(client, "Locked")
    (Path(locked["folder"]) / ".object-agent" / "agent.json").write_text("{", encoding="utf-8")
    assert _chat(client, "Hi", agentId=locked["id"]) == [
        {"type": "error", "message": "This agent's settings can't be read."}]
    assert _runs(fake["log"]) == []


def test_run_refused_for_nested_folder(api, fake, tmp_path: Path) -> None:
    _space, client, _ = api
    (tmp_path / "holder").mkdir()
    made = _create(client, "Holder", location=str(tmp_path / "holder"))
    # A space registered later inside the agent's folder.
    inner = Path(made["folder"]) / "notes"
    inner.mkdir()
    Registry(state_dir()).register(inner)
    events = _chat(client, "Hi", agentId=made["id"])
    assert events == [{"type": "error", "message": "An agent folder can't be inside a space folder or hold one."}]
    assert _runs(fake["log"]) == []
    assert transcripts.list_chats(Path(made["folder"])) == []


# -- saved chats ----------------------------------------------------------------------------------


MESSAGES = [
    {"role": "user", "text": "What do my notes say?", "at": "2026-11-05T12:00:00.000Z"},
    {"role": "assistant", "text": "Plenty.", "at": "2026-11-05T12:00:05.000Z"},
]


def _save(client: TestClient, **body) -> dict:
    req = {"title": "", "contextPaths": [], "sessionId": None, "messages": MESSAGES, "clientId": "w", **body}
    res = client.post("/api/ai/chat/save", json=req)
    assert res.status_code == 200, res.text
    return res.json()


def test_m10_saved_chat_continues_with_default_agent(space_dir: Path, fake) -> None:
    # An M10 chat: the type with only Context and Session, a chat file with no Agent property.
    space, app, _ = _app(space_dir)
    client = TestClient(app)
    with client:
        t = space.create_type("AI Chat", "AI Chats")
        from objectapp.typemodel import PROPERTY_ICONS, Icon, PropertyDefinition

        import copy

        t2 = copy.deepcopy(t)
        t2.propertyDefinitions.append(PropertyDefinition(
            id="session", key="session", name="Session", type="text", icon=Icon("iconify", PROPERTY_ICONS["text"])))
        _cur, rev = space.refresh_type(t.id)
        space.save_type(t2, rev)
        path, version = space.create_object(t.id, "Old chat", "none", {"session": SESSION_A})
        space.save_body(path, aichat.render_body("Old chat", MESSAGES), version)
        loaded = client.get("/api/ai/chat", params={"path": path}).json()
        assert loaded["agentId"] == "assistant" and loaded["agent"] is None and loaded["chatId"] is None
        assert loaded["sessionId"] == SESSION_A
        events = _chat(client, "Next", sessionId=SESSION_A, agentId=loaded["agentId"], chatId=loaded["chatId"])
        assert events[0]["agentId"] == "assistant" and ULID.match(events[0]["chatId"])
        assert events[-1]["type"] == "done"
        folder = state_dir() / "agents" / "Assistant"
        assert [c["id"] for c in transcripts.list_chats(folder)] == [events[0]["chatId"]]


def test_agent_property_added_without_rewriting_chats(api, space_dir: Path, fake) -> None:
    space, client, published = api
    # An M10-style chat saved before the Agent property existed.
    old = _save(client, title="Earlier chat")
    t = space.type_by_id("ai-chat")
    assert aichat.agent_key(t) == "agent"  # the first save made the type with it
    defs = space_dir / ".object" / "types" / "ai-chat.json"
    data = json.loads(defs.read_text(encoding="utf-8"))
    data["propertyDefinitions"] = [p for p in data["propertyDefinitions"] if p.get("key") != "agent"]
    defs.write_text(json.dumps(data), encoding="utf-8")
    old_file = space_dir / old["path"]
    old_file.write_text(old_file.read_text(encoding="utf-8").replace("agent: Assistant\n", ""), encoding="utf-8")
    space2, app2, published2 = _app(space_dir)
    client2 = TestClient(app2)
    with client2:
        before = old_file.read_bytes()
        made = _create(client2, "Researcher")
        events = _chat(client2, "Hi", agentId=made["id"], sessionId=None)
        chat_id = events[0]["chatId"]
        session = events[-1]["sessionId"]
        saved = _save(client2, title="Researcher chat", agentId=made["id"], chatId=chat_id, sessionId=session)
        names = [p["name"] for p in json.loads(defs.read_text(encoding="utf-8"))["propertyDefinitions"]]
        assert "Agent" in names
        agent_def = next(p for p in json.loads(defs.read_text(encoding="utf-8"))["propertyDefinitions"]
                         if p["name"] == "Agent")
        assert agent_def["type"] == "text" and agent_def["description"] == "The agent this chat was with"
        assert old_file.read_bytes() == before
        text = (space_dir / saved["path"]).read_text(encoding="utf-8")
        assert "agent: Researcher" in text
        t = transcripts.read(Path(made["folder"]), chat_id)
        assert t["objectPath"] == saved["path"]
        _wait(published2, 1)
        assert any(e.kind == "agentChats" and e.path == made["id"] for e in published2)
        loaded = client2.get("/api/ai/chat", params={"path": saved["path"]}).json()
        assert loaded["agent"] == "Researcher" and loaded["agentId"] == made["id"]
        assert loaded["chatId"] == chat_id
        # A second save of the same chat keeps one object line.
        _save(client2, title="Researcher chat", path=saved["path"], baseVersion=saved["version"],
              agentId=made["id"], chatId=chat_id, sessionId=session)
        lines = transcripts.path_for(Path(made["folder"]), chat_id).read_text(encoding="utf-8").splitlines()
        assert sum(1 for x in lines if json.loads(x)["type"] == "object") == 1
        # The name is matched back in any case; an unknown name is the default agent.
        p = space_dir / saved["path"]
        p.write_text(p.read_text(encoding="utf-8").replace("agent: Researcher", "agent: researcher"),
                     encoding="utf-8")
        assert client2.get("/api/ai/chat", params={"path": saved["path"]}).json()["agentId"] == made["id"]
        p.write_text(p.read_text(encoding="utf-8").replace("agent: researcher", "agent: Nobody"), encoding="utf-8")
        assert client2.get("/api/ai/chat", params={"path": saved["path"]}).json()["agentId"] == "assistant"


def test_hidden_ai_still_403(api) -> None:
    _space, client, _ = api
    _set(aiHidden=True)
    res = client.post("/api/ai/chat", json={"mode": "chat", "prompt": "x", "contextPaths": [], "history": []})
    assert res.status_code == 403
    assert client.get("/api/agents").status_code == 200


def test_a_turn_writes_no_space_file(api, space_dir: Path, fake) -> None:
    _space, client, published = api
    before = _snapshot(space_dir)
    _chat(client, "FAKE:tool hi", contextPaths=["People/Ada Lovelace.md"])
    _chat(client, "FAKE:tags", mode="tagObject", contextPaths=["People/Ada Lovelace.md"])
    _wait(published, 4)
    assert _snapshot(space_dir) == before
    assert {e.kind for e in published} == {"agentChats"}
