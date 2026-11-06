"""M20 Task 5: the remote-agent routes (the plan's Contract "Routes").

Every remote agent here is `fake_a2a.FakeA2A` on ``127.0.0.1``; ``OBJECT_STATE_DIR`` is a temp
folder (conftest). Nothing here reaches the internet or writes outside the temp folders.
"""

from __future__ import annotations

import asyncio
import socket
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fake_a2a import FakeA2A
from fastapi.testclient import TestClient
from objectapp import api_remote_agents, server, transcripts
from objectapp.appstate import state_dir
from objectapp.curator import Curator, IdleClock
from objectapp.reviews import ReviewRunner
from objectapp.server import create_app
from objectapp.space import Space

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
TOKEN = "t"
LONG_TOKEN = "tok-QX7v9Lk2Wm4Rr8Zp1Hy6Bn3Jd5Fs0Ct"
NO_LEARNING = "This is a remote agent; it has no memory or skills in Object."


@pytest.fixture
def api(space_dir: Path, tmp_path: Path):
    space = Space(space_dir)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    client = TestClient(app)
    with client:
        yield {"client": client, "published": published, "space": space, "tmp": tmp_path}


@pytest.fixture
def fake():
    f = FakeA2A(token=TOKEN)
    f.start()
    yield f
    f.stop()


def _bearer(value: str = TOKEN) -> dict[str, Any]:
    return {"kind": "bearer", "value": value}


def _snapshot(root: Path) -> dict[str, bytes]:
    if not root.exists():
        return {}
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def _wait(published: list, count: int) -> None:
    deadline = time.monotonic() + 5
    while len(published) < count and time.monotonic() < deadline:
        time.sleep(0.01)


def _add(client: TestClient, base: str, token: str = TOKEN, **extra: Any) -> dict[str, Any]:
    res = client.post("/api/remote-agents", json={"url": base, "auth": _bearer(token), "clientId": "win-1", **extra})
    assert res.status_code == 201, res.text
    return res.json()


def _closed_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _moved_card(fake: FakeA2A, endpoint: str) -> dict[str, Any]:
    card = fake.card()
    card["supportedInterfaces"] = [{"url": endpoint, "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}]
    return card


# -- preview ------------------------------------------------------------------------------------


def test_preview_writes_nothing(api, fake: FakeA2A) -> None:
    client = api["client"]
    before = _snapshot(state_dir())
    res = client.post("/api/remote-agents/preview", json={"url": fake.base_url, "auth": _bearer()})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["cardUrl"] == fake.base_url + "/.well-known/agent-card.json"
    assert body["card"]["name"] == "Fake Planner"
    assert body["card"]["skills"][0]["name"] == "Plan a trip"
    assert body["card"]["streaming"] is True
    assert body["endpointUrl"] == fake.base_url + "/a2a"
    assert body["endpointHost"] == fake.base_url.removeprefix("http://")
    assert body["warnings"] == []
    assert _snapshot(state_dir()) == before
    assert not (state_dir() / "agents.json").exists()
    # the card was fetched with the token
    assert fake.requests[-1]["headers"].get("Authorization") == f"Bearer {TOKEN}"


def test_preview_errors(api, fake: FakeA2A) -> None:
    client = api["client"]
    res = client.post("/api/remote-agents/preview", json={"url": fake.base_url, "auth": {"kind": "none"}})
    assert (res.status_code, res.json()["detail"]) == (502, "127.0.0.1 refused the token.")

    res = client.post("/api/remote-agents/preview",
                      json={"url": f"http://127.0.0.1:{_closed_port()}", "auth": {"kind": "none"}})
    assert res.status_code == 502
    assert res.json()["detail"].startswith("Couldn't reach 127.0.0.1")

    old = FakeA2A(card_version="0.3")
    old.start()
    try:
        res = client.post("/api/remote-agents/preview", json={"url": old.base_url, "auth": {"kind": "none"}})
    finally:
        old.stop()
    assert (res.status_code, res.json()["detail"]) == (422, "This agent speaks A2A 0.3; Object speaks A2A 1.0.")

    res = client.post("/api/remote-agents/preview", json={"url": "ftp://x", "auth": {"kind": "none"}})
    assert (res.status_code, res.json()["detail"]) == (422, "That isn't an http or https address.")

    # a bad header rule, and a body that doesn't fit, answer our 422 without echoing a value
    res = client.post("/api/remote-agents/preview",
                      json={"url": fake.base_url, "auth": {"kind": "header", "headerName": "Host", "value": "x"}})
    assert res.status_code == 422
    res = client.post("/api/remote-agents/preview", json={"url": fake.base_url,
                                                           "auth": {"kind": "magic", "value": LONG_TOKEN}})
    assert res.status_code == 422
    assert LONG_TOKEN not in res.text


def test_preview_other_status(api, fake: FakeA2A) -> None:
    """An answer other than 401/403 says the status."""
    res = api["client"].post("/api/remote-agents/preview",
                             json={"url": fake.base_url + "/nothing-here.json", "auth": _bearer()})
    assert (res.status_code, res.json()["detail"]) == (502, "127.0.0.1 answered 404.")


def test_preview_warnings(api, fake: FakeA2A) -> None:
    port = fake.base_url.rsplit(":", 1)[1]
    fake.card_override = _moved_card(fake, f"http://localhost:{port}/a2a")
    res = api["client"].post("/api/remote-agents/preview", json={"url": fake.base_url, "auth": _bearer()})
    assert res.status_code == 200, res.text
    assert res.json()["warnings"] == ["This agent's card sends messages to localhost, not 127.0.0.1."]
    assert res.json()["endpointHost"] == f"localhost:{port}"


def test_warning_rules() -> None:
    warn = api_remote_agents.preview_warnings
    card = "https://agents.example.com/.well-known/agent-card.json"
    http = "This address isn't encrypted (http), so the token can be read on the network."
    assert warn(card, "https://agents.example.com/a2a", True) == []
    assert warn(card, "http://agents.example.com/a2a", True) == [http]
    assert warn(card, "http://agents.example.com/a2a", False) == []
    assert warn(card, "http://127.0.0.1:8000/a2a", True) == [
        "This agent's card sends messages to 127.0.0.1, not agents.example.com."
    ]
    assert warn("http://localhost:1/x.json", "http://localhost:2/a2a", True) == []
    assert warn("http://[::1]:1/x.json", "http://[::1]:2/a2a", True) == []


# -- add ----------------------------------------------------------------------------------------


def test_add_lists_and_announces(api, fake: FakeA2A) -> None:
    client, published = api["client"], api["published"]
    agent = _add(client, fake.base_url)
    assert agent["kind"] == "remote"
    assert agent["name"] == "Fake Planner"
    assert agent["icon"] == "ph-globe"
    assert agent["remote"]["auth"] == {"kind": "bearer", "headerName": None, "set": True}
    assert agent["remote"]["endpointUrl"] == fake.base_url + "/a2a"
    _wait(published, 1)
    events = [e for e in published if e.kind == "agents" and e.path == agent["id"]]
    assert events and events[-1].origin == "win-1"
    listed = client.get("/api/agents").json()["agents"]
    assert agent["id"] in [a["id"] for a in listed]

    res = client.post("/api/remote-agents", json={"url": fake.base_url, "auth": _bearer(), "name": "Other"})
    assert (res.status_code, res.json()["detail"]) == (409, "This agent is already listed as Fake Planner.")


def test_two_adds_at_once_list_one_agent(api, fake: FakeA2A, monkeypatch: pytest.MonkeyPatch) -> None:
    import threading

    from objectapp.agents import AgentRegistry

    client = api["client"]
    original = AgentRegistry.create_remote

    def slow_create(self, *args, **kw):
        time.sleep(0.3)  # widen the window between the check and the create
        return original(self, *args, **kw)

    monkeypatch.setattr(AgentRegistry, "create_remote", slow_create)
    answers: list[Any] = []

    def add() -> None:
        answers.append(client.post("/api/remote-agents", json={"url": fake.base_url, "auth": _bearer()}))

    threads = [threading.Thread(target=add) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert sorted(r.status_code for r in answers) == [201, 409]
    remotes = [a for a in client.get("/api/agents").json()["agents"] if a["kind"] == "remote"]
    assert len(remotes) == 1


def test_add_with_name_and_errors(api, fake: FakeA2A) -> None:
    client = api["client"]
    agent = _add(client, fake.base_url + "/.well-known/agent-card.json", name="Trips", icon="ph-airplane")
    assert (agent["name"], agent["icon"]) == ("Trips", "ph-airplane")
    res = client.post("/api/remote-agents", json={"url": "ftp://x", "auth": {"kind": "none"}})
    assert res.status_code == 422
    res = client.post("/api/remote-agents", json={"url": fake.base_url, "auth": {"kind": "none"}})
    assert (res.status_code, res.json()["detail"]) == (502, "127.0.0.1 refused the token.")


def test_secret_absent_from_answers(api) -> None:
    client = api["client"]
    with FakeA2A(token=LONG_TOKEN) as f:
        texts: list[str] = []
        res = client.post("/api/remote-agents/preview", json={"url": f.base_url, "auth": _bearer(LONG_TOKEN)})
        texts.append(res.text)
        res = client.post("/api/remote-agents", json={"url": f.base_url, "auth": _bearer(LONG_TOKEN)})
        texts.append(res.text)
        agent = res.json()
        texts.append(client.get("/api/agents").text)
        texts.append(client.get(f"/api/agents/{agent['id']}").text)
        res = client.put(f"/api/remote-agents/{agent['id']}",
                         json={"name": "Renamed", "baseRevision": agent["revision"]})
        texts.append(res.text)
        texts.append(client.post(f"/api/remote-agents/{agent['id']}/refresh", json={}).text)
        texts.append(client.post(f"/api/remote-agents/{agent['id']}/context-notice", json={}).text)
        # a refused send with the token in a bad body never echoes it
        texts.append(client.post("/api/remote-agents", json={"url": 5, "auth": _bearer(LONG_TOKEN)}).text)
        texts.append(client.put(f"/api/remote-agents/{agent['id']}",
                                json={"name": "", "auth": _bearer(LONG_TOKEN), "baseRevision": "x"}).text)
    events = repr(api["published"])
    for text in [*texts, events]:
        assert LONG_TOKEN not in text
    for path in state_dir().rglob("*"):
        if path.is_file() and path.name != "secrets.json":
            assert LONG_TOKEN.encode() not in path.read_bytes(), path


# -- edit ---------------------------------------------------------------------------------------


def test_put_remote(api, fake: FakeA2A) -> None:
    client = api["client"]
    agent = _add(client, fake.base_url)
    aid = agent["id"]
    res = client.put(f"/api/remote-agents/{aid}",
                     json={"name": "Trips", "icon": "ph-airplane", "color": None, "auth": None,
                           "baseRevision": agent["revision"], "clientId": "win-2"})
    assert res.status_code == 200, res.text
    saved = res.json()
    assert saved["name"] == "Trips"
    assert saved["remote"]["auth"]["set"] is True  # auth null keeps the token
    assert saved["revision"] != agent["revision"]

    res = client.put(f"/api/remote-agents/{aid}", json={"name": "Again", "baseRevision": agent["revision"]})
    assert res.status_code == 409
    assert res.json()["currentRevision"] == saved["revision"]

    res = client.put(f"/api/remote-agents/{aid}",
                     json={"name": "Trips", "auth": {"kind": "header", "headerName": "Host", "value": "x"},
                           "baseRevision": saved["revision"]})
    assert res.status_code == 422

    res = client.put("/api/remote-agents/01JC7ZK3T9Q4M2X8B5N6R1V0WE", json={"name": "X", "baseRevision": "r"})
    assert res.status_code == 404

    local = client.get("/api/agents").json()["agents"][0]  # the default agent
    res = client.put(f"/api/remote-agents/{local['id']}", json={"name": "X", "baseRevision": "r"})
    assert (res.status_code, res.json()["detail"]) == (422, "That isn't a remote agent.")

    # a new token replaces the old one, and is sent from then on
    res = client.put(f"/api/remote-agents/{aid}", json={"name": "Trips", "auth": {"kind": "none"},
                                                        "baseRevision": saved["revision"]})
    assert res.status_code == 200
    assert res.json()["remote"]["auth"] == {"kind": "none", "headerName": None, "set": False}


def test_url_change_drops_the_secret(api, fake: FakeA2A) -> None:
    client = api["client"]
    agent = _add(client, fake.base_url)
    other = FakeA2A()
    other.start()
    try:
        port = other.base_url.rsplit(":", 1)[1]
        fake.card_override = _moved_card(fake, f"http://localhost:{port}/a2a")
        res = client.post(f"/api/remote-agents/{agent['id']}/refresh", json={"clientId": "win-3"})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["remote"]["endpointUrl"] == f"http://localhost:{port}/a2a"
        assert body["remote"]["auth"]["set"] is False
        assert body["name"] == "Fake Planner"
    finally:
        other.stop()
    assert all(r["headers"].get("Authorization") is None for r in other.requests)


def test_refresh_errors(api, fake: FakeA2A) -> None:
    client = api["client"]
    agent = _add(client, fake.base_url)
    fake.card_override = {"name": "Fake Planner", "protocolVersion": "0.3"}
    res = client.post(f"/api/remote-agents/{agent['id']}/refresh", json={})
    assert (res.status_code, res.json()["detail"]) == (422, "This agent speaks A2A 0.3; Object speaks A2A 1.0.")
    fake.stop()
    res = client.post(f"/api/remote-agents/{agent['id']}/refresh", json={})
    assert res.status_code == 502
    assert res.json()["detail"].startswith("Couldn't reach 127.0.0.1")
    res = client.post("/api/remote-agents/01JC7ZK3T9Q4M2X8B5N6R1V0WE/refresh", json={})
    assert res.status_code == 404


def test_context_notice_route(api, fake: FakeA2A) -> None:
    client, published = api["client"], api["published"]
    agent = _add(client, fake.base_url)
    assert agent["remote"]["contextNoticeAt"] is None
    res = client.post(f"/api/remote-agents/{agent['id']}/context-notice", json={"clientId": "win-4"})
    assert res.status_code == 200, res.text
    at = res.json()["contextNoticeAt"]
    assert isinstance(at, str) and at
    _wait(published, 2)
    assert any(e.kind == "agents" and e.path == agent["id"] and e.origin == "win-4" for e in published)
    again = client.post(f"/api/remote-agents/{agent['id']}/context-notice", json={})
    assert again.json() == {"contextNoticeAt": at}
    assert client.get(f"/api/agents/{agent['id']}").json()["remote"]["contextNoticeAt"] == at
    local = client.get("/api/agents").json()["agents"][0]
    assert client.post(f"/api/remote-agents/{local['id']}/context-notice", json={}).status_code == 422
    assert client.post("/api/remote-agents/01JC7ZK3T9Q4M2X8B5N6R1V0WE/context-notice", json={}).status_code == 404


# -- M17 and M18 routes on a remote id ------------------------------------------------------------


def test_m17_routes_on_a_remote_id(api, fake: FakeA2A) -> None:
    client = api["client"]
    agent = _add(client, fake.base_url)
    aid = agent["id"]
    res = client.put(f"/api/agents/{aid}", json={"agent": {"name": "X"}, "baseRevision": agent["revision"]})
    assert (res.status_code, res.json()["detail"]) == (
        422, "This is a remote agent; it has no settings here in Object.")
    res = client.put(f"/api/agents/{aid}/instructions", json={"text": "Hi", "baseRevision": None})
    assert (res.status_code, res.json()["detail"]) == (422, "This is a remote agent; it has no instructions in Object.")
    assert client.get(f"/api/agents/{aid}/tools").json() == {"groups": []}
    res = client.delete(f"/api/agents/{aid}")
    assert res.status_code == 200, res.text
    trash_id = res.json()["trashId"]
    assert trash_id
    assert aid not in [a["id"] for a in client.get("/api/agents").json()["agents"]]
    res = client.post(f"/api/agent-trash/{trash_id}/restore", json={})
    assert res.status_code == 200, res.text
    assert res.json()["id"] == aid
    assert res.json()["remote"]["auth"]["set"] is True


def test_m18_routes_on_a_remote_id(api, fake: FakeA2A) -> None:
    client = api["client"]
    agent = _add(client, fake.base_url)
    aid = agent["id"]
    for res in (
        client.get(f"/api/agents/{aid}/memory"),
        client.get(f"/api/agents/{aid}/skills"),
        client.get(f"/api/agents/{aid}/ledger"),
        client.get(f"/api/agents/{aid}/learning"),
        client.post(f"/api/agents/{aid}/chats/{transcripts.new_chat_id()}/learn", json={}),
    ):
        assert (res.status_code, res.json()["detail"]) == (422, NO_LEARNING)
    assert client.get(f"/api/agents/{aid}/chats/search", params={"q": "x"}).json() == {"hits": []}

    folder = Path(agent["folder"])
    chat_id = transcripts.new_chat_id()
    transcripts.start(folder, chat_id, agent_id=aid, title="Trip", space_name=None, space_key=None,
                      created_at="2026-11-05T12:00:00.000Z")
    assert client.get(f"/api/agents/{aid}/chats/{chat_id}/reviews").json() == {"reviews": []}

    # the curator skips a remote agent, even with its curator due
    before = _snapshot(folder)
    events: list = []
    clock = lambda: datetime.now(UTC) + timedelta(days=30)  # noqa: E731 - long idle, never run
    space_dir = api["space"].root
    runner = ReviewRunner(events.append, space_dir, "space-sample")
    cur = Curator(events.append, IdleClock(clock), runner, space_dir, "space-sample", clock, lambda: None)
    ran = asyncio.run(cur.tick())
    assert aid not in ran
    assert _snapshot(folder) == before


# -- reveal a file ------------------------------------------------------------------------------


def test_reveal_file(api, fake: FakeA2A, monkeypatch: pytest.MonkeyPatch) -> None:
    client = api["client"]
    agent = _add(client, fake.base_url)
    folder = Path(agent["folder"])
    chat_id = transcripts.new_chat_id()
    target = folder / ".object-agent" / "files" / chat_id / "plan.md"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"# Plan\n")
    shown: list[Path] = []
    monkeypatch.setattr(server, "reveal_in_file_manager", shown.append)

    res = client.post(f"/api/agents/{agent['id']}/files/reveal", json={"file": f"{chat_id}/plan.md"})
    assert res.status_code == 200, res.text
    assert res.json() == {"ok": True}
    assert shown == [target.resolve()]

    for bad in ("../../agents.json", f"{chat_id}/nothing.md", f"{chat_id}", "", "/etc/passwd",
                f"{chat_id}\\..\\..\\..\\agents.json"):
        res = client.post(f"/api/agents/{agent['id']}/files/reveal", json={"file": bad})
        assert res.status_code == 404, bad
    res = client.post("/api/agents/01JC7ZK3T9Q4M2X8B5N6R1V0WE/files/reveal", json={"file": f"{chat_id}/plan.md"})
    assert res.status_code == 404
    assert len(shown) == 1
