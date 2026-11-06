"""M17 Task 7: the ``/api/agents...`` routes (the plan's Contract "Routes").

``OBJECT_STATE_DIR`` is a temp folder (conftest); the fake ``claude`` runs the one turn the chats
routes need. Nothing here writes outside ``tmp_path`` and that state folder.
"""

from __future__ import annotations

import json
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fake_claude import install
from fastapi.testclient import TestClient
from objectapp import server
from objectapp import settings as device_settings
from objectapp.agentmodel import SHELL_WARNING
from objectapp.appstate import state_dir
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import Registry

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
NESTED = "An agent folder can't be inside a space folder or hold one."


def _set(**patch) -> None:
    _data, revision = device_settings.read()
    device_settings.patch(patch, revision)


@pytest.fixture
def api(space_dir: Path, tmp_path: Path, monkeypatch):
    path = install(tmp_path / "bin")
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(tmp_path / "claude-log.jsonl"))
    _set(claudePath=str(path))
    space = Space(space_dir)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    client = TestClient(app)
    with client:
        yield {"client": client, "published": published, "space": space, "tmp": tmp_path}


def _wait(published: list, count: int) -> None:
    deadline = time.monotonic() + 5
    while len(published) < count and time.monotonic() < deadline:
        time.sleep(0.01)


def _create(client: TestClient, name: str = "Researcher", **extra) -> dict:
    body = {"agent": {"name": name}, "instructions": "Be curious.", "clientId": "win-1", **extra}
    res = client.post("/api/agents", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _snapshot(root: Path) -> dict[str, bytes]:
    if not root.exists():
        return {}
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def _frames(raw: str) -> list[dict]:
    out = []
    for frame in raw.split("\n\n"):
        data = [line[5:].lstrip(" ") for line in frame.split("\n") if line.startswith("data:")]
        if data:
            out.append(json.loads("\n".join(data)))
    return out


# -- listing ------------------------------------------------------------------------------------


def test_get_agents_writes_nothing(api) -> None:
    client = api["client"]
    before = _snapshot(state_dir())
    agents = client.get("/api/agents").json()["agents"]
    assert [a["id"] for a in agents] == ["assistant"]
    first = agents[0]
    assert first["default"] is True and first["exists"] is False and first["name"] == "Assistant"
    assert first["icon"] == "ph-sparkle" and first["toolsOff"] == ["Bash"] and first["kind"] == "local"
    for route in ("/api/agents/assistant", "/api/agents/assistant/instructions", "/api/agents/assistant/tools",
                  "/api/agents/assistant/chats", "/api/agent-trash", "/api/agent-tools"):
        assert client.get(route).status_code == 200, route
    assert client.get("/api/agents/assistant/instructions").json() == {"text": "", "revision": None}
    assert client.get("/api/agents/assistant/chats").json() == {"chats": []}
    assert _snapshot(state_dir()) == before
    assert not (state_dir() / "agents").exists()


def test_get_unknown_agent_is_404(api) -> None:
    client = api["client"]
    for route in ("/api/agents/01JC7ZK3T9Q4M2X8B5N6R1V0WE", "/api/agents/nope",
                  "/api/agents/nope/instructions", "/api/agents/nope/tools", "/api/agents/nope/chats"):
        res = client.get(route)
        assert res.status_code == 404, route
        assert res.json()["detail"] == "That agent isn't listed any more."


# -- create and add -----------------------------------------------------------------------------


def test_create_announces_and_lists(api) -> None:
    client, published = api["client"], api["published"]
    made = _create(client)
    assert made["name"] == "Researcher" and made["icon"] == "ph-robot" and made["toolsOff"] == ["Bash"]
    assert len(made["id"]) == 26 and made["default"] is False and made["inStateDir"] is True
    folder = Path(made["folder"])
    assert folder == (state_dir() / "agents" / "Researcher").resolve()
    assert (folder / "CLAUDE.md").read_text(encoding="utf-8") == "Be curious."
    _wait(published, 1)
    (event,) = [e for e in published if e.kind == "agents"]
    assert event.path == made["id"] and event.origin == "win-1"
    agents = client.get("/api/agents").json()["agents"]
    assert [a["id"] for a in agents] == ["assistant", made["id"]]
    assert client.get(f"/api/agents/{made['id']}").json()["revision"] == made["revision"]


def test_create_errors(api, tmp_path: Path) -> None:
    client = api["client"]
    bad = client.post("/api/agents", json={"agent": {"name": "   "}, "instructions": ""})
    assert bad.status_code == 422
    long = client.post("/api/agents", json={"agent": {"name": "x" * 61}, "instructions": ""})
    assert long.status_code == 422
    model = client.post("/api/agents", json={"agent": {"name": "M", "model": "no such model!"}, "instructions": ""})
    assert model.status_code == 422
    nowhere = client.post("/api/agents", json={"agent": {"name": "N"}, "instructions": "",
                                               "location": str(tmp_path / "nowhere")})
    assert nowhere.status_code == 404
    (tmp_path / "loc" / "Taken").mkdir(parents=True)
    taken = client.post("/api/agents", json={"agent": {"name": "Taken"}, "instructions": "",
                                             "location": str(tmp_path / "loc")})
    assert taken.status_code == 409
    space_root = api["space"].root
    Registry(state_dir()).register(space_root)
    nested = client.post("/api/agents", json={"agent": {"name": "Inside"}, "instructions": "",
                                              "location": str(space_root / "Pages")})
    assert nested.status_code == 422 and nested.json()["detail"] == NESTED
    dup = client.post("/api/agents", json={"agent": {"name": "Copy"}, "instructions": "",
                                           "duplicateOf": {"id": "01JC7ZK3T9Q4M2X8B5N6R1V0WE"}})
    assert dup.status_code == 404


def test_create_at_a_location_and_duplicate(api, tmp_path: Path) -> None:
    client = api["client"]
    (tmp_path / "elsewhere").mkdir()
    made = _create(client, "Writer", location=str(tmp_path / "elsewhere"))
    assert Path(made["folder"]) == (tmp_path / "elsewhere" / "Writer").resolve() and made["inStateDir"] is False
    copy = client.post("/api/agents", json={"agent": {"name": "Writer two"}, "instructions": "",
                                            "duplicateOf": {"id": made["id"], "memory": False, "skills": True}})
    assert copy.status_code == 201, copy.text
    folder = Path(copy.json()["folder"])
    assert (folder / "CLAUDE.md").read_text(encoding="utf-8") == "Be curious."
    assert copy.json()["id"] != made["id"]


def test_add_folder_routes(api, tmp_path: Path) -> None:
    client = api["client"]
    assert client.post("/api/agents/add-folder", json={"path": str(tmp_path / "none")}).status_code == 404
    (tmp_path / "plain").mkdir()
    plain = client.post("/api/agents/add-folder", json={"path": str(tmp_path / "plain")})
    assert plain.status_code == 422 and plain.json()["detail"] == "This folder isn't an Object agent."
    (tmp_path / "ext").mkdir()
    made = _create(client, "Outside", location=str(tmp_path / "ext"))
    folder = Path(made["folder"])
    copy = tmp_path / "copy-of-outside"
    shutil.copytree(folder, copy)
    listed = client.post("/api/agents/add-folder", json={"path": str(copy)})
    assert listed.status_code == 409 and listed.json()["detail"] == "An agent with this id is already listed."
    assert client.post(f"/api/agents/{made['id']}/unregister", json={}).json() == {"ok": True}
    before = _snapshot(folder)
    again = client.post("/api/agents/add-folder", json={"path": str(folder), "clientId": "w"})
    assert again.status_code == 201 and again.json()["id"] == made["id"]
    assert _snapshot(folder) == before  # add writes nothing in the folder


# -- save ---------------------------------------------------------------------------------------


def test_put_saves_with_revision(api) -> None:
    client = api["client"]
    made = _create(client)
    body = {"agent": {"name": "Researcher", "description": "Digs.", "model": "haiku", "toolsOff": []},
            "baseRevision": made["revision"], "clientId": "win-2"}
    saved = client.put(f"/api/agents/{made['id']}", json=body)
    assert saved.status_code == 200, saved.text
    out = saved.json()
    assert out["description"] == "Digs." and out["model"] == "haiku" and out["toolsOff"] == []
    stale = client.put(f"/api/agents/{made['id']}", json=body)
    assert stale.status_code == 409 and stale.json()["currentRevision"] == out["revision"]
    bad = client.put(f"/api/agents/{made['id']}", json={**body, "baseRevision": out["revision"],
                                                        "agent": {"name": "R", "model": "bad model!"}})
    assert bad.status_code == 422
    assert client.put("/api/agents/01JC7ZK3T9Q4M2X8B5N6R1V0WE", json=body).status_code == 404
    agent_file = Path(out["folder"]) / ".object-agent" / "agent.json"
    data = json.loads(agent_file.read_text(encoding="utf-8"))
    data["schemaVersion"] = 2
    agent_file.write_text(json.dumps(data), encoding="utf-8")
    rev = client.get(f"/api/agents/{made['id']}").json()["revision"]
    locked = client.put(f"/api/agents/{made['id']}", json={**body, "baseRevision": rev})
    assert locked.status_code == 423


def test_put_default_model_writes_ai_model(api) -> None:
    client = api["client"]
    body = {"agent": {"name": "Assistant", "icon": "ph-sparkle", "model": "sonnet"}, "baseRevision": None}
    res = client.put("/api/agents/assistant", json=body)
    assert res.status_code == 200, res.text
    assert res.json()["model"] == "sonnet" and res.json()["exists"] is True
    assert device_settings.read()[0]["aiModel"] == "sonnet"
    folder = Path(res.json()["folder"])
    data = json.loads((folder / ".object-agent" / "agent.json").read_text(encoding="utf-8"))
    assert data["model"] is None
    cleared = client.put("/api/agents/assistant", json={"agent": {"name": "Assistant", "model": None},
                                                        "baseRevision": res.json()["revision"]})
    assert cleared.status_code == 200 and cleared.json()["model"] is None
    assert device_settings.read()[0]["aiModel"] is None


# -- delete, unregister, trash, restore ---------------------------------------------------------


def test_delete_and_restore_routes(api, tmp_path: Path) -> None:
    client, published = api["client"], api["published"]
    made = _create(client)
    gone = client.delete(f"/api/agents/{made['id']}", params={"clientId": "win-3"})
    assert gone.status_code == 200
    trash_id = gone.json()["trashId"]
    assert trash_id and (state_dir() / "agents" / ".trash" / trash_id).is_dir()
    assert not Path(made["folder"]).exists()
    assert any(e.kind == "agents" and e.origin == "win-3" for e in published)
    items = client.get("/api/agent-trash").json()["items"]
    assert [i["trashId"] for i in items] == [trash_id] and items[0]["agentId"] == made["id"]
    back = client.post(f"/api/agent-trash/{trash_id}/restore", json={"clientId": "win-3"})
    assert back.status_code == 200 and back.json()["id"] == made["id"]
    assert Path(back.json()["folder"]).is_dir()
    assert client.post(f"/api/agent-trash/{trash_id}/restore", json={}).status_code == 404
    # A second trashed copy whose id is listed again is a 409.
    again = client.delete(f"/api/agents/{made['id']}").json()["trashId"]
    client.post(f"/api/agent-trash/{again}/restore", json={})
    third = client.delete(f"/api/agents/{made['id']}").json()["trashId"]
    meta = state_dir() / "agents" / ".trash" / f"{third}.json"
    clone = state_dir() / "agents" / ".trash" / "01JC7ZK3T9Q4M2X8B5N6R1V0WF"
    shutil.copytree(state_dir() / "agents" / ".trash" / third, clone)
    m = json.loads(meta.read_text(encoding="utf-8"))
    m["trashId"] = clone.name
    (clone.parent / f"{clone.name}.json").write_text(json.dumps(m), encoding="utf-8")
    assert client.post(f"/api/agent-trash/{third}/restore", json={}).status_code == 200
    assert client.post(f"/api/agent-trash/{clone.name}/restore", json={}).status_code == 409
    # Outside the state dir: only unregistered, the folder untouched.
    (tmp_path / "ext").mkdir()
    outside = _create(client, "Outside", location=str(tmp_path / "ext"))
    before = _snapshot(Path(outside["folder"]))
    res = client.delete(f"/api/agents/{outside['id']}")
    assert res.status_code == 200 and res.json() == {"trashId": None}
    assert _snapshot(Path(outside["folder"])) == before
    # The default agent can't be deleted or unregistered.
    for res in (client.delete("/api/agents/assistant"), client.post("/api/agents/assistant/unregister", json={})):
        assert res.status_code == 422 and res.json()["detail"] == "The default agent can't be deleted."
    assert client.delete("/api/agents/01JC7ZK3T9Q4M2X8B5N6R1V0WE").status_code == 404


def test_put_with_unreadable_folder_settings_is_refused(api) -> None:
    client = api["client"]
    made = _create(client)
    folder = Path(made["folder"])
    settings = folder / ".claude" / "settings.json"
    settings.write_text("{nope", encoding="utf-8")
    agent_before = (folder / ".object-agent" / "agent.json").read_bytes()
    body = {"agent": {"name": "Researcher", "toolsOff": []}, "baseRevision": made["revision"]}
    res = client.put(f"/api/agents/{made['id']}", json=body)
    assert res.status_code == 423
    assert res.json()["detail"] == "This agent's .claude/settings.json can't be read. Fix it, then save again."
    assert (folder / ".object-agent" / "agent.json").read_bytes() == agent_before  # nothing half-saved
    assert settings.read_text(encoding="utf-8") == "{nope"


def test_delete_and_restore_while_the_folder_is_in_use(api, monkeypatch) -> None:
    from objectapp import agents

    client = api["client"]
    made = _create(client)

    def busy(src, dest):
        raise PermissionError(32, "The process cannot access the file", str(src))

    real = agents._move_folder
    monkeypatch.setattr(agents, "_move_folder", busy)
    res = client.delete(f"/api/agents/{made['id']}")
    in_use = "This agent's folder is in use. Wait for its turn to finish, then try again."
    assert res.status_code == 409 and res.json()["detail"] == in_use
    assert Path(made["folder"]).is_dir()
    assert client.get(f"/api/agents/{made['id']}").status_code == 200  # still listed
    assert not list((state_dir() / "agents" / ".trash").glob("*.json"))
    monkeypatch.setattr(agents, "_move_folder", real)
    trash_id = client.delete(f"/api/agents/{made['id']}").json()["trashId"]
    monkeypatch.setattr(agents, "_move_folder", busy)
    res = client.post(f"/api/agent-trash/{trash_id}/restore", json={})
    assert res.status_code == 409 and res.json()["detail"] == in_use
    assert [i["trashId"] for i in client.get("/api/agent-trash").json()["items"]] == [trash_id]


def test_unregister_route(api) -> None:
    client = api["client"]
    made = _create(client)
    assert client.post(f"/api/agents/{made['id']}/unregister", json={"clientId": "x"}).json() == {"ok": True}
    assert Path(made["folder"]).is_dir()
    assert client.post(f"/api/agents/{made['id']}/unregister", json={}).status_code == 404
    assert [a["id"] for a in client.get("/api/agents").json()["agents"]] == ["assistant"]


# -- instructions -------------------------------------------------------------------------------


def test_instructions_routes(api) -> None:
    client = api["client"]
    made = _create(client)
    path = Path(made["folder"]) / "CLAUDE.md"
    path.write_bytes(b"\xef\xbb\xbfLine one\r\nLine two\r\n")
    got = client.get(f"/api/agents/{made['id']}/instructions").json()
    assert got["text"] == "Line one\nLine two\n" and got["revision"]
    saved = client.put(f"/api/agents/{made['id']}/instructions",
                       json={"text": "Line one\nLine 2\n", "baseRevision": got["revision"], "clientId": "c"})
    assert saved.status_code == 200, saved.text
    assert path.read_bytes() == b"\xef\xbb\xbfLine one\r\nLine 2\r\n"
    stale = client.put(f"/api/agents/{made['id']}/instructions",
                       json={"text": "x", "baseRevision": got["revision"]})
    assert stale.status_code == 409 and stale.json()["currentRevision"] == saved.json()["revision"]
    assert client.get(f"/api/agents/{made['id']}/instructions").json()["revision"] == saved.json()["revision"]
    agent_file = Path(made["folder"]) / ".object-agent" / "agent.json"
    agent_file.write_text("{not json", encoding="utf-8")
    locked = client.put(f"/api/agents/{made['id']}/instructions",
                        json={"text": "y", "baseRevision": saved.json()["revision"]})
    assert locked.status_code == 423
    # The default agent's first save makes its folder.
    first = client.put("/api/agents/assistant/instructions", json={"text": "Be brief.", "baseRevision": None})
    assert first.status_code == 200
    assert client.get("/api/agents/assistant").json()["exists"] is True


# -- tools --------------------------------------------------------------------------------------


def _row(groups: list[dict], tool_id: str) -> dict:
    return next(t for g in groups for t in g["tools"] if t["id"] == tool_id)


def test_tools_routes(api) -> None:
    client = api["client"]
    groups = client.get("/api/agent-tools").json()["groups"]
    assert [g["id"] for g in groups] == ["object-read", "object-write", "object-agent", "builtin"]
    bash = _row(groups, "Bash")
    assert bash["on"] is False and bash["warning"] == SHELL_WARNING
    assert _row(groups, "Read")["on"] is True
    made = _create(client)
    folder = Path(made["folder"])
    (folder / ".mcp.json").write_text(json.dumps({"mcpServers": {"gh": {"command": "gh-mcp"}}}), encoding="utf-8")
    body = {"agent": {"name": "Researcher", "toolsOff": ["Read", "mcp__gh"]}, "baseRevision": made["revision"]}
    assert client.put(f"/api/agents/{made['id']}", json=body).status_code == 200
    mine = client.get(f"/api/agents/{made['id']}/tools").json()["groups"]
    assert [g["id"] for g in mine][-1] == "mcp:gh"
    assert _row(mine, "Read")["on"] is False and _row(mine, "Bash")["on"] is True
    assert _row(mine, "mcp__gh")["on"] is False


def test_tool_group_providers_join(api, monkeypatch) -> None:
    from objectapp import toolcatalog

    extra = toolcatalog.ToolGroup("gw:x", "X", (toolcatalog.ToolEntry("mcp__x__a", "A", ("mcp__x__a",)),))
    monkeypatch.setattr(toolcatalog, "GROUP_PROVIDERS", [lambda rec: [extra]])
    groups = api["client"].get("/api/agents/assistant/tools").json()["groups"]
    assert groups[-1]["id"] == "gw:x"


# -- chats and reveal ---------------------------------------------------------------------------


def test_chats_routes(api) -> None:
    client = api["client"]
    made = _create(client)
    res = client.post("/api/ai/chat", json={"mode": "chat", "prompt": "What do my notes say?", "contextPaths": [],
                                            "history": [], "agentId": made["id"]})
    events = _frames(res.text)
    assert events[0]["type"] == "chat" and events[-1]["type"] == "done", events
    chat_id = events[0]["chatId"]
    chats = client.get(f"/api/agents/{made['id']}/chats").json()["chats"]
    assert [c["id"] for c in chats] == [chat_id]
    assert chats[0]["title"] == "What do my notes say?" and chats[0]["messageCount"] == 2
    full = client.get(f"/api/agents/{made['id']}/chats/{chat_id}").json()
    assert full["agentId"] == made["id"] and [i["type"] for i in full["items"]] == ["user", "assistant"]
    assert client.get(f"/api/agents/{made['id']}/chats/nope").status_code == 404
    assert client.get(f"/api/agents/{made['id']}/chats/01JC7ZK3T9Q4M2X8B5N6R1V0WE").status_code == 404
    assert client.get(f"/api/agents/01JC7ZK3T9Q4M2X8B5N6R1V0WE/chats/{chat_id}").status_code == 404


def test_reveal_route(api, monkeypatch) -> None:
    client = api["client"]
    shown: list[Path] = []
    monkeypatch.setattr(server, "reveal_in_file_manager", shown.append)
    assert client.post("/api/agents/assistant/reveal").status_code == 404  # no folder yet
    made = _create(client)
    assert client.post(f"/api/agents/{made['id']}/reveal").json() == {"ok": True}
    assert shown == [Path(made["folder"])]
    assert client.post("/api/agents/01JC7ZK3T9Q4M2X8B5N6R1V0WE/reveal").status_code == 404


def test_agent_routes_answer_while_ai_is_hidden(api) -> None:
    _set(aiHidden=True)
    assert api["client"].get("/api/agents").status_code == 200
