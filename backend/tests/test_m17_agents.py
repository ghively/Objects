"""M17 Task 2: agent folders, the registry and the agent trash (``agents``, ``agentfiles``)."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import pytest

from objectapp import agentfiles, agentmodel
from objectapp.agentmodel import (
    DEFAULT_SOUL,
    GITIGNORE,
    AgentConflict,
    AgentInput,
    AgentInvalid,
    AgentNotFound,
    AgentReadOnly,
)
from objectapp.agents import AgentRegistry, effective_model
from objectapp.jsonstore import dump_json
from objectapp.spaces import Registry

ULID = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
NESTED = "An agent folder can't be inside a space folder or hold one."
PROTECTED_RULES = ["Edit(./CLAUDE.md)", "Edit(./.claude/**)", "Edit(./.object-agent/**)", "Edit(./.mcp.json)",
                   "Edit(./CLAUDE.local.md)"]


@pytest.fixture
def state(tmp_path: Path) -> Path:
    return tmp_path / "state"


@pytest.fixture
def space(tmp_path: Path, state: Path) -> Path:
    root = tmp_path / "space"
    (root / ".object").mkdir(parents=True)
    (root / ".object" / "space.json").write_bytes(dump_json({"name": "Notes"}))
    Registry(state).register(root)
    return root


@pytest.fixture
def reg(state: Path, space: Path) -> AgentRegistry:
    return AgentRegistry(state)


def _snapshot(folder: Path) -> dict[str, tuple[bytes, int]]:
    return {
        str(p.relative_to(folder)): (p.read_bytes(), p.stat().st_mtime_ns)
        for p in sorted(folder.rglob("*"))
        if p.is_file()
    }


def _bytes(folder: Path) -> dict[str, bytes]:
    return {str(p.relative_to(folder)): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


def _registry(state: Path) -> list[dict]:
    return json.loads((state / "agents.json").read_text(encoding="utf-8"))["agents"]


def _deny(folder: Path) -> list[str]:
    return json.loads((folder / ".claude" / "settings.json").read_text(encoding="utf-8"))["permissions"]["deny"]


def test_list_never_writes(tmp_path: Path) -> None:
    state = tmp_path / "state"
    records = AgentRegistry(state).list()
    assert len(records) == 1
    rec = records[0]
    assert rec.id == "assistant"
    assert rec.data["name"] == "Assistant"
    assert rec.exists is False
    assert rec.default is True
    assert rec.revision is None
    api = rec.to_api({"aiModel": "sonnet"})
    assert api["name"] == "Assistant" and api["icon"] == "ph-sparkle" and api["model"] == "sonnet"
    assert api["exists"] is False and api["default"] is True and api["kind"] == "local"
    assert not state.exists() or not any(state.rglob("*"))


def test_ensure_default_makes_the_skeleton(reg: AgentRegistry, state: Path) -> None:
    registry_before = (state / "agents.json").read_bytes() if (state / "agents.json").exists() else None
    rec = reg.ensure_default()
    folder = state / "agents" / "Assistant"
    assert rec.folder == folder.resolve()
    assert rec.exists is True
    assert (folder / "CLAUDE.md").read_text(encoding="utf-8") == DEFAULT_SOUL
    deny = _deny(folder)
    assert {"Bash", "PowerShell"} <= set(deny)
    assert set(PROTECTED_RULES) <= set(deny)
    data = json.loads((folder / ".object-agent" / "agent.json").read_text(encoding="utf-8"))
    assert data["id"] == "assistant" and data["toolsOff"] == ["Bash"] and data["model"] is None
    assert data["icon"] == "ph-sparkle" and data["schemaVersion"] == 1
    assert (folder / ".object-agent" / "sessions").is_dir()
    assert (folder / ".gitignore").read_bytes() == GITIGNORE.encode()
    after = (state / "agents.json").read_bytes() if (state / "agents.json").exists() else None
    assert after == registry_before
    snap = _snapshot(folder)
    again = reg.ensure_default()
    assert _snapshot(folder) == snap
    assert again.revision == rec.revision


def test_create_in_state_dir_and_name_clash(reg: AgentRegistry, state: Path) -> None:
    a = reg.create(AgentInput(name="Researcher"), "Find things.\n")
    b = reg.create(AgentInput(name="  Researcher "), "Find more.\n")
    assert a.folder == (state / "agents" / "Researcher").resolve()
    assert b.folder == (state / "agents" / "Researcher (2)").resolve()
    assert ULID.match(a.id) and ULID.match(b.id) and a.id != b.id
    assert a.in_state_dir and b.in_state_dir
    listed = _registry(state)
    assert [e["id"] for e in listed] == [a.id, b.id]
    assert all(e["kind"] == "local" and e["addedAt"] for e in listed)
    assert [r.id for r in reg.list()] == ["assistant", a.id, b.id]
    assert (a.folder / "CLAUDE.md").read_text(encoding="utf-8") == "Find things.\n"
    data = json.loads((a.folder / ".object-agent" / "agent.json").read_text(encoding="utf-8"))
    assert data["icon"] == "ph-robot" and data["toolsOff"] == ["Bash"] and data["name"] == "Researcher"


def test_a_new_agent_never_takes_the_default_agents_folder(reg: AgentRegistry, state: Path) -> None:
    a = reg.create(AgentInput(name="Assistant"), "")
    assert a.folder.name == "Assistant (2)"
    assert reg.ensure_default().folder.name == "Assistant"


def test_create_at_location(reg: AgentRegistry, tmp_path: Path) -> None:
    where = tmp_path / "elsewhere"
    where.mkdir()
    rec = reg.create(AgentInput(name="Researcher"), "x", location=where)
    assert rec.folder == (where / "Researcher").resolve()
    assert rec.in_state_dir is False
    with pytest.raises(AgentConflict) as e:
        reg.create(AgentInput(name="Researcher"), "x", location=where)
    assert e.value.status == 409
    with pytest.raises(AgentNotFound):
        reg.create(AgentInput(name="Other"), "x", location=tmp_path / "nope")


def test_agent_folder_inside_a_space_is_refused(reg: AgentRegistry, space: Path, tmp_path: Path) -> None:
    (space / "sub").mkdir()
    with pytest.raises(AgentInvalid) as e:
        reg.create(AgentInput(name="Researcher"), "x", location=space / "sub")
    assert e.value.message == NESTED
    assert not (space / "sub" / "Researcher").exists()
    # a new folder that would hold a registered space
    holder = tmp_path / "holder"
    (holder / "Inner" / "deep").mkdir(parents=True)
    Registry(reg.state).register(holder / "Inner" / "deep")
    with pytest.raises(AgentInvalid) as e:
        reg.create(AgentInput(name="Inner"), "x", location=holder)
    assert e.value.message == NESTED
    # add_folder of an agent folder inside a space
    other = reg.create(AgentInput(name="Copyable"), "x", location=tmp_path)
    inside = space / "agent-copy"
    import shutil

    shutil.copytree(other.folder, inside)
    data = json.loads((inside / ".object-agent" / "agent.json").read_text(encoding="utf-8"))
    data["id"] = "01JC7ZK3T9Q4M2X8B5N6R1V0WE"
    (inside / ".object-agent" / "agent.json").write_bytes(dump_json(data))
    with pytest.raises(AgentInvalid) as e:
        reg.add_folder(inside)
    assert e.value.message == NESTED


def test_duplicate(reg: AgentRegistry, tmp_path: Path) -> None:
    src = reg.create(AgentInput(name="Researcher"), "Soul.\n")
    f = src.folder
    (f / ".claude" / "settings.local.json").write_text('{"x": 1}\n', encoding="utf-8")
    (f / ".mcp.json").write_text('{"mcpServers": {}}\n', encoding="utf-8")
    (f / ".claude" / "skills" / "x").mkdir(parents=True)
    (f / ".claude" / "skills" / "x" / "SKILL.md").write_text("skill", encoding="utf-8")
    (f / ".object-agent" / "memory").mkdir()
    (f / ".object-agent" / "memory" / "MEMORY.md").write_text("mem", encoding="utf-8")
    (f / ".object-agent" / "sessions" / "01JC7ZK3T9Q4M2X8B5N6R1V0WE.jsonl").write_text("{}\n", encoding="utf-8")
    (f / ".object-agent" / "ledger.jsonl").write_text("{}\n", encoding="utf-8")
    (f / ".object-agent" / "usage.json").write_text("{}\n", encoding="utf-8")
    (f / ".object-agent" / "cache").mkdir()
    (f / ".object-agent" / "cache" / "c").write_text("c", encoding="utf-8")

    bare = reg.duplicate(src.id, AgentInput(name="Researcher copy"), memory=False, skills=False)
    b = bare.folder
    assert bare.id != src.id and ULID.match(bare.id)
    assert bare.data["name"] == "Researcher copy"
    assert (b / "CLAUDE.md").read_bytes() == b"Soul.\n"
    assert (b / ".claude" / "settings.json").read_bytes() == (f / ".claude" / "settings.json").read_bytes()
    assert (b / ".claude" / "settings.local.json").read_text(encoding="utf-8") == '{"x": 1}\n'
    assert (b / ".mcp.json").exists()
    assert not (b / ".claude" / "skills").exists()
    assert not (b / ".object-agent" / "memory").exists()
    assert not any((b / ".object-agent" / "sessions").iterdir())
    for name in ("ledger.jsonl", "usage.json", "cache"):
        assert not (b / ".object-agent" / name).exists()
    data = json.loads((b / ".object-agent" / "agent.json").read_text(encoding="utf-8"))
    assert data["id"] == bare.id and data["name"] == "Researcher copy"

    full = reg.duplicate(src.id, AgentInput(name="Full"), memory=True, skills=True, location=tmp_path)
    assert (full.folder / ".claude" / "skills" / "x" / "SKILL.md").read_text(encoding="utf-8") == "skill"
    assert (full.folder / ".object-agent" / "memory" / "MEMORY.md").read_text(encoding="utf-8") == "mem"
    assert full.in_state_dir is False
    with pytest.raises(AgentNotFound):
        reg.duplicate("01JC7ZK3T9Q4M2X8B5N6R1V0WE", AgentInput(name="X"), memory=False, skills=False)


def test_add_folder(reg: AgentRegistry, tmp_path: Path) -> None:
    import shutil

    src = reg.create(AgentInput(name="Researcher"), "x", location=tmp_path)
    copy = tmp_path / "copy"
    shutil.copytree(src.folder, copy)
    with pytest.raises(AgentConflict) as e:
        reg.add_folder(copy)
    assert e.value.message == "An agent with this id is already listed."
    data = json.loads((copy / ".object-agent" / "agent.json").read_text(encoding="utf-8"))
    data["id"] = "01JC7ZK3T9Q4M2X8B5N6R1V0WE"
    (copy / ".object-agent" / "agent.json").write_bytes(dump_json(data))
    before = _bytes(copy)
    rec = reg.add_folder(copy)
    assert rec.id == "01JC7ZK3T9Q4M2X8B5N6R1V0WE"
    assert _bytes(copy) == before
    assert rec.id in [r.id for r in reg.list()]
    plain = tmp_path / "plain"
    plain.mkdir()
    with pytest.raises(AgentInvalid) as e:
        reg.add_folder(plain)
    assert e.value.message == "This folder isn't an Object agent."
    with pytest.raises(AgentNotFound):
        reg.add_folder(tmp_path / "nope")
    # a copy of the default agent's folder: its id is always listed
    default_copy = tmp_path / "default-copy"
    shutil.copytree(reg.ensure_default().folder, default_copy)
    with pytest.raises(AgentConflict):
        reg.add_folder(default_copy)


def test_save_keeps_unknown_keys_and_checks_revision(reg: AgentRegistry) -> None:
    rec = reg.create(AgentInput(name="Researcher"), "x")
    path = rec.folder / ".object-agent" / "agent.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["extra"] = [1]
    path.write_bytes(dump_json(data))
    settings_path = rec.folder / ".claude" / "settings.json"
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    settings["permissions"]["deny"].append("Read(./private/**)")
    settings["hooks"] = {"SessionStart": []}
    settings_path.write_bytes(dump_json(settings))
    rev = reg.get(rec.id).revision

    with pytest.raises(AgentConflict) as e:
        reg.save(rec.id, AgentInput(name="R2"), "stale")
    assert e.value.current_revision == rev

    saved = reg.save(
        rec.id, AgentInput(name="Researcher", description="d", toolsOff=["mcp__object__move_to_trash"]), rev
    )
    after = json.loads(path.read_text(encoding="utf-8"))
    assert after["extra"] == [1]
    assert after["description"] == "d" and after["toolsOff"] == ["mcp__object__move_to_trash"]
    assert saved.revision != rev
    assert saved.revision == hashlib.sha256(path.read_bytes()).hexdigest()
    new_settings = json.loads(settings_path.read_text(encoding="utf-8"))
    deny = new_settings["permissions"]["deny"]
    assert "Bash" not in deny and "PowerShell" not in deny
    assert "mcp__object__move_to_trash" in deny
    assert "Read(./private/**)" in deny
    assert set(PROTECTED_RULES) <= set(deny)
    assert new_settings["hooks"] == {"SessionStart": []}
    with pytest.raises(AgentInvalid):
        reg.save(rec.id, AgentInput(name="x" * 61), saved.revision)


def test_default_agent_rules(reg: AgentRegistry) -> None:
    with pytest.raises(AgentInvalid) as e:
        reg.delete("assistant")
    assert e.value.message == "The default agent can't be deleted."
    with pytest.raises(AgentInvalid) as e:
        reg.unregister("assistant")
    assert e.value.message == "The default agent can't be deleted."
    default = reg.get("assistant")
    assert effective_model(default, {"aiModel": "sonnet"}) == "sonnet"
    other = reg.create(AgentInput(name="R", model="opus"), "x")
    assert effective_model(other, {"aiModel": "sonnet"}) == "opus"
    # the default agent's file keeps model null; saving it before its first use makes its folder
    saved = reg.save("assistant", AgentInput(name="Helper", model="opus"), None)
    assert saved.exists and saved.data["name"] == "Helper" and saved.data["model"] is None
    with pytest.raises(AgentNotFound):
        reg.get("01JC7ZK3T9Q4M2X8B5N6R1V0WE")


def test_delete_moves_to_agent_trash_and_restores(reg: AgentRegistry, state: Path) -> None:
    rec = reg.create(AgentInput(name="Researcher", icon="ph-robot"), "Soul.\n")
    original = rec.folder
    before = _bytes(original)
    trash_id = reg.delete(rec.id)
    assert trash_id and ULID.match(trash_id)
    trash_dir = state / "agents" / ".trash"
    assert (trash_dir / trash_id).is_dir()
    assert _bytes(trash_dir / trash_id) == before
    meta = json.loads((trash_dir / f"{trash_id}.json").read_text(encoding="utf-8"))
    assert meta["agentId"] == rec.id and meta["name"] == "Researcher" and meta["icon"] == "ph-robot"
    assert meta["originalPath"] == str(original) and meta["deletedAt"] and meta["trashId"] == trash_id
    assert not original.exists()
    assert rec.id not in [r.id for r in reg.list()]
    items = reg.trash()
    assert [i["trashId"] for i in items] == [trash_id]
    back = reg.restore(trash_id)
    assert back.id == rec.id and back.folder == original
    assert _bytes(original) == before
    assert rec.id in [r.id for r in reg.list()]
    assert reg.trash() == []
    assert not (trash_dir / f"{trash_id}.json").exists()
    with pytest.raises(AgentNotFound):
        reg.restore(trash_id)
    with pytest.raises(AgentNotFound):
        reg.restore("../x")


def test_delete_outside_state_dir_only_unregisters(reg: AgentRegistry, tmp_path: Path) -> None:
    rec = reg.create(AgentInput(name="Outside"), "x", location=tmp_path)
    before = _snapshot(rec.folder)
    assert reg.delete(rec.id) is None
    assert _snapshot(rec.folder) == before
    assert rec.id not in [r.id for r in reg.list()]
    assert reg.trash() == []
    with pytest.raises(AgentNotFound):
        reg.delete(rec.id)


def test_unregister(reg: AgentRegistry) -> None:
    rec = reg.create(AgentInput(name="Kept"), "x")
    reg.unregister(rec.id)
    assert rec.folder.is_dir()
    assert rec.id not in [r.id for r in reg.list()]
    with pytest.raises(AgentNotFound):
        reg.unregister(rec.id)


def test_restore_collisions(reg: AgentRegistry) -> None:
    rec = reg.create(AgentInput(name="Researcher"), "x")
    original = rec.folder
    trash_id = reg.delete(rec.id)
    assert trash_id
    original.mkdir()  # the path is taken again
    back = reg.restore(trash_id)
    assert back.folder == original.parent / "Researcher (2)"
    assert (back.folder / ".object-agent" / "agent.json").exists()
    # an id listed again
    trash_id = reg.delete(rec.id)
    assert trash_id
    import shutil

    copy_dir = original.parent.parent / "copy"
    shutil.copytree(original.parent / ".trash" / trash_id, copy_dir)
    reg.add_folder(copy_dir)
    with pytest.raises(AgentConflict):
        reg.restore(trash_id)
    assert (original.parent / ".trash" / trash_id).is_dir()


def test_instructions_keep_bom_and_crlf(reg: AgentRegistry) -> None:
    rec = reg.create(AgentInput(name="R"), "x")
    path = rec.folder / "CLAUDE.md"
    path.write_bytes(b"\xef\xbb\xbfold\r\nline\r\n")
    text, rev = reg.read_instructions(rec.id)
    assert text == "old\nline\n"
    assert rev == hashlib.sha256(path.read_bytes()).hexdigest()
    new_rev = reg.save_instructions(rec.id, "a\nb", rev)
    assert path.read_bytes() == b"\xef\xbb\xbfa\r\nb"
    assert new_rev == hashlib.sha256(path.read_bytes()).hexdigest()
    with pytest.raises(AgentConflict) as e:
        reg.save_instructions(rec.id, "c", rev)
    assert e.value.status == 409 and e.value.current_revision == new_rev
    path.unlink()
    snap = _snapshot(rec.folder)
    assert reg.read_instructions(rec.id) == ("", None)
    assert _snapshot(rec.folder) == snap
    assert not path.exists()


def test_default_agent_instructions_before_first_use(reg: AgentRegistry, state: Path) -> None:
    assert reg.read_instructions("assistant") == ("", None)
    assert not (state / "agents").exists()
    rev = reg.save_instructions("assistant", "Be brief.\n", None)
    folder = state / "agents" / "Assistant"
    assert (folder / "CLAUDE.md").read_bytes() == b"Be brief.\n"
    assert rev == hashlib.sha256(b"Be brief.\n").hexdigest()
    assert reg.get("assistant").exists


def test_unreadable_registry_is_kept_aside(reg: AgentRegistry, state: Path) -> None:
    state.mkdir(parents=True, exist_ok=True)
    (state / "agents.json").write_text("{nope", encoding="utf-8")
    assert [r.id for r in reg.list()] == ["assistant"]
    assert (state / "agents.json").read_text(encoding="utf-8") == "{nope"
    rec = reg.create(AgentInput(name="R"), "x")
    aside = list(state.glob("agents.unreadable-*.json"))
    assert len(aside) == 1 and aside[0].read_text(encoding="utf-8") == "{nope"
    assert [e["id"] for e in _registry(state)] == [rec.id]


def test_unreadable_agent_file_is_read_only(reg: AgentRegistry) -> None:
    rec = reg.create(AgentInput(name="R"), "x")
    (rec.folder / ".object-agent" / "agent.json").write_text("{bad", encoding="utf-8")
    got = reg.get(rec.id)
    assert got.read_only_reason == "This agent's settings can't be read."
    assert got.to_api({})["readOnlyReason"] == "This agent's settings can't be read."
    with pytest.raises(AgentReadOnly) as e:
        reg.save(rec.id, AgentInput(name="R"), got.revision or "")
    assert e.value.status == 423
    with pytest.raises(AgentReadOnly):
        reg.save_instructions(rec.id, "y", None)
    newer = reg.create(AgentInput(name="N"), "x")
    path = newer.folder / ".object-agent" / "agent.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["schemaVersion"] = 2
    path.write_bytes(dump_json(data))
    assert reg.get(newer.id).read_only_reason == agentmodel.NEWER_VERSION
    gone = reg.create(AgentInput(name="Gone"), "x")
    import shutil

    shutil.rmtree(gone.folder)
    missing = reg.get(gone.id)
    assert missing.missing is True
    assert missing.to_api({})["missing"] is True


def test_folder_mcp_servers_and_var_refs(tmp_path: Path) -> None:
    folder = tmp_path / "a"
    folder.mkdir()
    assert agentfiles.folder_mcp_servers(folder) == {}
    (folder / ".mcp.json").write_text("{nope", encoding="utf-8")
    assert agentfiles.folder_mcp_servers(folder) == {}
    (folder / ".mcp.json").write_bytes(
        dump_json({"mcpServers": {"gh": {"command": "x", "env": {"T": "${GH_TOKEN}"}}}})
    )
    servers = agentfiles.folder_mcp_servers(folder)
    assert list(servers) == ["gh"]
    assert agentfiles.var_refs(servers["gh"]) == {"GH_TOKEN"}
    assert agentfiles.var_refs({"args": ["${A:-x}", "--k=${B}"], "url": "$C"}) == {"A", "B"}


def test_agent_api_lists_folder_mcp_servers(reg: AgentRegistry) -> None:
    rec = reg.create(AgentInput(name="R"), "x")
    (rec.folder / ".mcp.json").write_bytes(
        dump_json({"mcpServers": {"gh": {"command": "x", "env": {"T": "${GH_TOKEN}"}}, "plain": {"command": "y"}}})
    )
    api = reg.get(rec.id).to_api({})
    assert api["mcpServers"] == [
        {"name": "gh", "missingVars": ["GH_TOKEN"], "usable": False},
        {"name": "plain", "missingVars": [], "usable": True},
    ]
    assert api["folder"] == str(rec.folder) and api["inStateDir"] is True
    assert api["toolsOff"] == ["Bash"] and api["revision"] == rec.revision


def test_generated_denies_and_sync_permissions(tmp_path: Path) -> None:
    assert agentfiles.generated_denies(["Bash"]) == ["Bash", "PowerShell", *PROTECTED_RULES]
    assert agentfiles.generated_denies(["Edit", "mcp__gh"])[:3] == ["Edit", "MultiEdit", "mcp__gh"]
    folder = tmp_path / "f"
    folder.mkdir()
    agentfiles.sync_permissions(folder, [], ["Bash"])  # a missing file is created
    assert _deny(folder) == ["Bash", "PowerShell", *PROTECTED_RULES]


def test_write_skeleton_never_overwrites(tmp_path: Path) -> None:
    folder = tmp_path / "f"
    folder.mkdir()
    (folder / "CLAUDE.md").write_bytes(b"mine")
    data = {"schemaVersion": 1, "id": "assistant", "name": "Assistant", "icon": None, "color": None,
            "toolsOff": ["Bash"], "createdAt": "t", "updatedAt": "t"}
    agentfiles.write_skeleton(folder, data, "theirs")
    assert (folder / "CLAUDE.md").read_bytes() == b"mine"
    read, rev = agentfiles.read_agent_file(folder)
    assert read["id"] == "assistant"
    assert rev == hashlib.sha256((folder / ".object-agent" / "agent.json").read_bytes()).hexdigest()
    read["extra"] = {"k": 1}
    new_rev = agentfiles.write_agent_file(folder, read)
    assert agentfiles.read_agent_file(folder) == (read, new_rev)
    (folder / ".object-agent" / "agent.json").write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError):
        agentfiles.read_agent_file(folder)
