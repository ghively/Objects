"""M20 Task 3: remote agents in the registry, their secrets and transcripts."""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any

import pytest

from objectapp import a2a, agents, remotesecrets, transcripts
from objectapp.agentmodel import AgentConflict, AgentInput, AgentInvalid, AgentNotFound
from objectapp.agents import AgentRegistry, remote_auth, remote_card
from objectapp.jsonstore import dump_json
from objectapp.remotemodel import AuthInput, RemoteAgentFile
from objectapp.spaces import Registry

TOKEN = "tok-SECRET-123"
T0 = "2026-11-05T09:00:00.000Z"
T1 = "2026-11-05T09:00:01.000Z"
T2 = "2026-11-05T09:00:02.000Z"


def _card_raw(endpoint: str = "http://127.0.0.1:9/a2a", name: str = "Fake Planner") -> dict[str, Any]:
    return {
        "name": name,
        "description": "Plans synthetic trips.",
        "version": "1.0.0",
        "supportedInterfaces": [{"url": endpoint, "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}],
        "capabilities": {"streaming": True},
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "skills": [{"id": "plan", "name": "Plan", "description": "Plans a trip", "tags": ["travel"],
                    "examples": ["Plan a weekend"]}],
    }


def _stub_parse(data: Any) -> a2a.Card:
    iface = data["supportedInterfaces"][0]
    return a2a.Card(
        name=data["name"], description=data.get("description", ""), version=data.get("version"),
        provider=None, documentation_url=None, endpoint_url=iface["url"],
        protocol_version=iface["protocolVersion"], streaming=data.get("capabilities", {}).get("streaming") is True,
        skills=tuple(data.get("skills") or ()), input_modes=tuple(data.get("defaultInputModes") or ()),
        output_modes=tuple(data.get("defaultOutputModes") or ()), raw=data,
    )


def _card(raw: dict[str, Any]) -> a2a.Card:
    return _stub_parse(raw)


@pytest.fixture
def state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    st = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(st))
    try:
        a2a.parse_card(_card_raw())
    except NotImplementedError:  # until Task 2 lands
        monkeypatch.setattr(a2a, "parse_card", _stub_parse)
    return st


@pytest.fixture
def reg(tmp_path: Path, state: Path) -> AgentRegistry:
    root = tmp_path / "space"
    (root / ".object").mkdir(parents=True)
    (root / ".object" / "space.json").write_bytes(dump_json({"name": "Notes"}))
    Registry(state).register(root)
    return AgentRegistry(state)


def _bearer(value: str = TOKEN) -> AuthInput:
    return AuthInput(kind="bearer", value=value)


def _add(reg: AgentRegistry, *, auth: AuthInput | None = None, endpoint: str = "http://127.0.0.1:9/a2a",
         name: str | None = None) -> agents.AgentRecord:
    raw = _card_raw(endpoint)
    return reg.create_remote(_card(raw), raw, "http://127.0.0.1:9/.well-known/agent-card.json",
                             auth or _bearer(), name=name)


def _files(folder: Path) -> dict[str, tuple[bytes, int]]:
    return {str(p.relative_to(folder)): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in sorted(folder.rglob("*")) if p.is_file()}


# -- creating ---------------------------------------------------------------------------------


def test_create_remote_folder_and_entry(reg: AgentRegistry, state: Path) -> None:
    rec = _add(reg)
    folder = state / "agents" / "Fake Planner"
    assert rec.folder == folder.resolve() and rec.kind == "remote"
    data = json.loads((folder / ".object-agent" / "agent.json").read_bytes())
    model = RemoteAgentFile.model_validate(data)
    assert model.kind == "remote" and model.icon == "ph-globe" and model.auth.kind == "bearer"
    assert model.contextNoticeAt is None and model.id == rec.id and model.name == "Fake Planner"
    assert model.endpoint.url == "http://127.0.0.1:9/a2a" and model.endpoint.protocolVersion == "1.0"
    assert model.streaming is True
    assert json.loads((folder / ".object-agent" / "card.json").read_bytes()) == _card_raw()
    assert not (folder / "CLAUDE.md").exists() and not (folder / ".claude").exists()
    assert not (folder / ".mcp.json").exists()
    entries = json.loads((state / "agents.json").read_bytes())["agents"]
    assert entries[-1]["kind"] == "remote" and entries[-1]["id"] == rec.id and entries[-1]["addedAt"]
    listed = reg.list()
    assert listed[0].default and listed[-1].id == rec.id
    api = listed[-1].to_api({"aiModel": "opus"})
    assert api["kind"] == "remote" and api["model"] is None and api["toolsOff"] == []
    assert api["learning"] is None and api["mcpServers"] == []
    remote = api["remote"]
    assert remote["auth"] == {"kind": "bearer", "headerName": None, "set": True}
    assert remote["endpointUrl"] == "http://127.0.0.1:9/a2a" and remote["endpointHost"] == "127.0.0.1:9"
    assert remote["cardUrl"] == "http://127.0.0.1:9/.well-known/agent-card.json"
    assert remote["protocolVersion"] == "1.0" and remote["streaming"] is True
    assert remote["card"]["name"] == "Fake Planner" and remote["card"]["skills"][0]["id"] == "plan"
    assert remote["card"]["inputModes"] == ["text/plain"] and remote["contextNoticeAt"] is None
    assert listed[0].to_api({})["remote"] is None and listed[0].to_api({})["kind"] == "local"


def test_secret_never_stored_or_shown(reg: AgentRegistry, state: Path, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    rec = _add(reg)
    reg.save_remote(rec.id, name="Planner", icon=None, color=None, auth=None,
                    base_revision=reg.get(rec.id).revision or "")
    rec = reg.get(rec.id)
    secret = TOKEN.encode("utf-8")
    holders = [p.name for p in state.rglob("*") if p.is_file() and secret in p.read_bytes()]
    assert holders == ["secrets.json"]
    for r in reg.list():
        assert TOKEN not in json.dumps(r.to_api({}))
        assert TOKEN not in repr(r)
    assert all(TOKEN not in m.getMessage() for m in caplog.records)
    assert remote_auth(rec).value == TOKEN and remote_auth(rec).kind == "bearer"
    assert TOKEN not in repr(remote_auth(rec))


def test_name_clash_and_failure_cleanup(reg: AgentRegistry, state: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _add(reg)
    second = _add(reg)
    assert second.folder.name == "Fake Planner (2)"
    before = (state / "agents.json").read_bytes()

    def boom(agent_id: str, value: str) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(remotesecrets, "put", boom)
    with pytest.raises(OSError):
        _add(reg)
    assert not (state / "agents" / "Fake Planner (3)").exists()
    assert (state / "agents.json").read_bytes() == before


def test_create_remote_checks_name_and_auth(reg: AgentRegistry, state: Path) -> None:
    with pytest.raises(AgentInvalid):
        _add(reg, auth=AuthInput(kind="bearer"))
    with pytest.raises(AgentInvalid):
        _add(reg, name="x" * 61)
    assert not (state / "agents").exists() or not any((state / "agents").iterdir())
    rec = _add(reg, auth=AuthInput(kind="none", value="ignored"), name="  My   Planner ")
    assert rec.data["name"] == "My Planner" and rec.data["auth"] == {"kind": "none", "headerName": None}
    assert not remotesecrets.is_set(rec.id)
    hdr = _add(reg, auth=AuthInput(kind="header", headerName="X-Api-Key", value="k-1234"))
    assert hdr.to_api({})["remote"]["auth"] == {"kind": "header", "headerName": "X-Api-Key", "set": True}
    assert remote_auth(hdr).headers() == {"X-Api-Key": "k-1234"}


# -- saving -----------------------------------------------------------------------------------


def test_save_remote(reg: AgentRegistry) -> None:
    rec = _add(reg)
    agent_file = rec.folder / ".object-agent" / "agent.json"
    data = json.loads(agent_file.read_bytes())
    data["x-extra"] = {"keep": 1}
    agent_file.write_bytes(dump_json(data))
    rev = reg.get(rec.id).revision
    saved = reg.save_remote(rec.id, name="Trips", icon="ph-airplane", color=None, auth=None, base_revision=rev or "")
    assert saved.data["name"] == "Trips" and saved.data["icon"] == "ph-airplane"
    assert saved.revision != rev and saved.data["x-extra"] == {"keep": 1}
    assert remotesecrets.get(rec.id) == TOKEN
    with pytest.raises(AgentConflict) as err:
        reg.save_remote(rec.id, name="Stale", icon=None, color=None, auth=None, base_revision=rev or "")
    assert err.value.current_revision == saved.revision
    saved = reg.save_remote(rec.id, name="Trips", icon=None, color=None, auth=_bearer("tok-NEW-456"),
                            base_revision=saved.revision or "")
    assert remotesecrets.get(rec.id) == "tok-NEW-456"
    saved = reg.save_remote(rec.id, name="Trips", icon=None, color=None, auth=AuthInput(kind="none"),
                            base_revision=saved.revision or "")
    assert not remotesecrets.is_set(rec.id) and saved.data["auth"]["kind"] == "none"
    assert saved.data["x-extra"] == {"keep": 1} and saved.data["icon"] == "ph-globe"
    with pytest.raises(AgentInvalid):
        reg.save_remote("assistant", name="A", icon=None, color=None, auth=None, base_revision="")


def test_refresh_keeps_name_and_drops_secret_on_host_change(reg: AgentRegistry) -> None:
    rec = _add(reg)
    reg.save_remote(rec.id, name="Gene's Planner", icon=None, color=None, auth=None,
                    base_revision=rec.revision or "")
    before = reg.get(rec.id).data["cardFetchedAt"]
    raw = _card_raw("http://127.0.0.1:9/a2a/v2", name="Renamed Upstream")
    raw["capabilities"] = {"streaming": False}
    card_url = "http://127.0.0.1:9/.well-known/agent-card.json"
    fresh = reg.refresh_remote(rec.id, _card(raw), raw, card_url)
    assert fresh.data["name"] == "Gene's Planner"
    assert fresh.data["endpoint"]["url"] == "http://127.0.0.1:9/a2a/v2" and fresh.data["streaming"] is False
    assert fresh.data["cardFetchedAt"] >= before
    assert json.loads((rec.folder / ".object-agent" / "card.json").read_bytes())["name"] == "Renamed Upstream"
    assert remotesecrets.get(rec.id) == TOKEN
    assert remote_card(fresh).streaming is False and remote_card(fresh).endpoint_url.endswith("/a2a/v2")
    moved = _card_raw("http://127.0.0.2:9/a2a")
    fresh = reg.refresh_remote(rec.id, _card(moved), moved, card_url)
    assert not remotesecrets.is_set(rec.id)
    assert fresh.to_api({})["remote"]["auth"]["set"] is False


def test_mark_context_notice_once(reg: AgentRegistry) -> None:
    rec = _add(reg)
    first = reg.mark_context_notice(rec.id)
    assert first and reg.get(rec.id).data["contextNoticeAt"] == first
    path = rec.folder / ".object-agent" / "agent.json"
    stamp = path.stat().st_mtime_ns
    assert reg.mark_context_notice(rec.id) == first
    assert path.stat().st_mtime_ns == stamp
    assert reg.get(rec.id).to_api({})["remote"]["contextNoticeAt"] == first


def test_m17_methods_refuse_remote(reg: AgentRegistry) -> None:
    rec = _add(reg)
    settings = "This is a remote agent; it has no settings here in Object."
    instructions = "This is a remote agent; it has no instructions in Object."
    with pytest.raises(AgentInvalid, match=settings):
        reg.save(rec.id, AgentInput(name="X"), rec.revision)
    with pytest.raises(AgentInvalid, match=instructions):
        reg.read_instructions(rec.id)
    with pytest.raises(AgentInvalid, match=instructions):
        reg.save_instructions(rec.id, "soul", None)
    with pytest.raises(AgentInvalid, match=settings):
        reg.duplicate(rec.id, AgentInput(name="Copy"), memory=False, skills=False)


# -- removing ---------------------------------------------------------------------------------


def test_delete_and_restore_remote(reg: AgentRegistry, state: Path) -> None:
    rec = _add(reg)
    trash_id = reg.delete(rec.id)
    assert trash_id and (state / "agents" / ".trash" / trash_id / ".object-agent" / "agent.json").is_file()
    assert not rec.folder.exists() and all(r.id != rec.id for r in reg.list())
    assert remotesecrets.get(rec.id) == TOKEN
    back = reg.restore(trash_id)
    assert back.kind == "remote" and back.folder == rec.folder
    entry = [e for e in json.loads((state / "agents.json").read_bytes())["agents"] if e["id"] == rec.id]
    assert entry[0]["kind"] == "remote"
    assert back.to_api({})["remote"]["auth"]["set"] is True
    reg.unregister(rec.id)
    assert rec.folder.is_dir() and all(r.id != rec.id for r in reg.list())


def test_add_folder_of_a_remote_copy(reg: AgentRegistry, tmp_path: Path) -> None:
    rec = _add(reg)
    copy = tmp_path / "copies" / "Planner copy"
    shutil.copytree(rec.folder, copy)
    agent_file = copy / ".object-agent" / "agent.json"
    data = json.loads(agent_file.read_bytes())
    data["id"] = "01JC7ZK3T9Q4M2X8B5N6R1V0WE"
    agent_file.write_bytes(dump_json(data))
    before = _files(copy)
    added = reg.add_folder(copy)
    assert added.kind == "remote" and added.id == "01JC7ZK3T9Q4M2X8B5N6R1V0WE"
    assert added.to_api({})["remote"]["auth"]["set"] is False
    assert _files(copy) == before
    assert reg.get(added.id).kind == "remote"


def test_find_by_name(reg: AgentRegistry) -> None:
    rec = _add(reg)
    assert reg.find_by_name(rec.id).id == rec.id
    assert reg.find_by_name("fake planner").id == rec.id
    assert reg.find_by_name("  FAKE PLANNER ").id == rec.id
    assert reg.find_by_name("assistant").default
    assert reg.find_by_name("Assistant").default
    with pytest.raises(AgentNotFound):
        reg.find_by_name("Nobody")


def test_remote_folders_and_local_folders(reg: AgentRegistry, tmp_path: Path) -> None:
    rec = _add(reg)
    local = reg.create(AgentInput(name="Writer"), "soul")
    remote = [str(p) for p in reg.remote_folders()]
    locals_ = [str(p) for p in reg.local_folders()]
    assert remote == [str(rec.folder)]
    assert str(rec.folder) not in locals_ and str(local.folder) in locals_


def test_list_never_writes_with_remote(reg: AgentRegistry, state: Path) -> None:
    rec = _add(reg)
    before = _files(state)
    for r in reg.list():
        r.to_api({})
    reg.get(rec.id)
    reg.find_by_name("fake planner")
    remote_auth(reg.get(rec.id))
    remote_card(reg.get(rec.id))
    assert _files(state) == before


def test_remote_api_survives_an_unreadable_card(reg: AgentRegistry) -> None:
    rec = _add(reg)
    (rec.folder / ".object-agent" / "card.json").write_bytes(b"not json")
    api = reg.get(rec.id).to_api({})
    assert api["kind"] == "remote" and api["remote"]["card"]["name"] == "Fake Planner"
    assert api["remote"]["card"]["skills"] == []


# -- transcripts ------------------------------------------------------------------------------


def test_transcript_delegated_header(tmp_path: Path) -> None:
    folder = tmp_path / "agent"
    a, b = transcripts.new_chat_id(), transcripts.new_chat_id()
    transcripts.start(folder, a, agent_id="01JC7ZK3T9Q4M2X8B5N6R1V0WE", title="Task", space_name="Notes",
                      space_key="k1", created_at=T0, delegated=True, delegated_from="assistant",
                      from_chat="01K0000000000000000000000A")
    transcripts.start(folder, b, agent_id="01JC7ZK3T9Q4M2X8B5N6R1V0WE", title="Mine", space_name=None,
                      space_key=None, created_at=T0)
    header = json.loads(transcripts.path_for(folder, a).read_bytes().split(b"\n")[0])
    assert header["delegated"] is True and header["from"] == "assistant"
    assert header["fromChat"] == "01K0000000000000000000000A"
    plain = json.loads(transcripts.path_for(folder, b).read_bytes().split(b"\n")[0])
    assert "from" not in plain and "fromChat" not in plain and plain["delegated"] is False
    chats = {c["id"]: c for c in transcripts.list_chats(folder)}
    assert chats[a]["delegated"] is True and chats[a]["from"] == "assistant"
    assert chats[b]["delegated"] is False and chats[b]["from"] is None


def test_last_a2a_and_find_by_context(tmp_path: Path) -> None:
    folder = tmp_path / "agent"
    a, other = transcripts.new_chat_id(), transcripts.new_chat_id()
    for cid in (a, other):
        transcripts.start(folder, cid, agent_id="r", title="T", space_name=None, space_key=None, created_at=T0)
    attachment = {"name": "plan.md", "mediaType": "text/markdown", "size": 6, "kind": "file",
                  "file": f"{a}/plan.md", "url": None}
    transcripts.append(folder, a, [
        {"type": "user", "text": "q", "at": T1, "contextPaths": []},
        {"type": "assistant", "text": "Which date?", "at": T1, "model": None, "sessionId": None,
         "a2a": {"contextId": "c1", "taskId": "t1", "state": "TASK_STATE_INPUT_REQUIRED"}},
        {"type": "user", "text": "Friday", "at": T2, "contextPaths": []},
        {"type": "assistant", "text": "Booked", "at": T2, "model": None, "sessionId": None,
         "a2a": {"contextId": "c1", "taskId": "t1", "state": "TASK_STATE_COMPLETED"},
         "attachments": [attachment]},
    ])
    transcripts.append(folder, other, [
        {"type": "assistant", "text": "x", "at": T1, "model": None, "sessionId": None,
         "a2a": {"contextId": "c2", "taskId": None, "state": "TASK_STATE_COMPLETED"}},
    ])
    assert transcripts.last_a2a(folder, a) == {"contextId": "c1", "taskId": "t1", "state": "TASK_STATE_COMPLETED"}
    assert transcripts.find_by_context(folder, "c1") == a
    assert transcripts.find_by_context(folder, "c2") == other
    assert transcripts.find_by_context(folder, "nope") is None
    assert transcripts.last_a2a(folder, transcripts.new_chat_id()) is None
    items = [i for i in transcripts.read(folder, a)["items"] if i["type"] == "assistant"]
    assert items[0]["a2a"]["state"] == "TASK_STATE_INPUT_REQUIRED" and "attachments" not in items[0]
    assert items[1]["attachments"] == [attachment] and items[1]["a2a"]["contextId"] == "c1"
