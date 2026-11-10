"""M17 Task 1: the contract (agent.json model, tool catalogue, agent tokens, stub routers) and
the fake ``claude``'s own permission matcher."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from objectapp import agentmodel, toolcatalog
from objectapp.agentmodel import (
    AGENT_ID,
    SHELL_WARNING,
    AgentFile,
    AgentInput,
    AgentInvalid,
    clean_input,
)
from objectapp.tokens import TokenStore

HERE = Path(__file__).resolve().parent
FAKE = HERE / "fake_claude.py"

M11_TOOLS = {
    "schema", "search", "query", "run_saved_query", "peek", "read", "backlinks", "daily_note",
    "changes_since", "create_object", "create_task", "set_properties", "add_tags",
    "add_to_collection", "append_to_section", "replace_section", "rename", "move_to_trash",
}


def _rp(p: Path) -> str:
    """The CLI's absolute rule form, written here from its documentation (not agentrun's)."""
    text = str(p.resolve()).replace("\\", "/")
    if len(text) > 1 and text[1] == ":":
        text = "/" + text[0].lower() + text[2:]
    return "/" + text


def test_agent_file_model() -> None:
    with pytest.raises(AgentInvalid):
        clean_input(AgentInput(name="x" * 61))
    assert clean_input(AgentInput(name="x" * 60)).name == "x" * 60
    assert clean_input(AgentInput(name="  A   b ")).name == "A b"
    data = {
        "schemaVersion": 1, "id": "01JC7ZK3T9Q4M2X8B5N6R1V0WE", "name": "Researcher", "icon": "ph-robot",
        "color": "violet", "description": "", "model": None, "toolsOff": ["Bash"], "learning": None,
        "createdAt": "2026-11-05T09:00:00.000Z", "updatedAt": "2026-11-05T09:00:00.000Z", "x": 1,
    }
    assert AgentFile.model_validate(data).model_dump()["x"] == 1
    with pytest.raises(AgentInvalid) as e:
        clean_input(AgentInput(name="A", model="-p"))
    assert e.value.message == "That isn't a model name." and e.value.status == 422
    assert clean_input(AgentInput(name="A", model=" sonnet ")).model == "sonnet"
    with pytest.raises(AgentInvalid):
        clean_input(AgentInput(name="A", description="d" * 501))
    import re

    assert re.match(AGENT_ID, "assistant")
    assert re.match(AGENT_ID, "01JC7ZK3T9Q4M2X8B5N6R1V0WE")
    assert not re.match(AGENT_ID, "../x")
    assert agentmodel.GITIGNORE == "settings.local.json\ncache/\n"
    assert agentmodel.PROTECTED == ("CLAUDE.md", ".claude/**", ".object-agent/**")


def test_catalogue_groups() -> None:
    groups = toolcatalog.catalogue()
    assert [g.id for g in groups] == ["object-read", "object-write", "object-agent", "builtin"]
    assert [g.label for g in groups] == ["Object read", "Object write", "Object agent tools", "Claude Code built-ins"]
    assert len(toolcatalog.OBJECT_READ) == 26 and len(toolcatalog.OBJECT_WRITE) == 44  # M29: sync_facts; M30: import_entities
    names = set(toolcatalog.OBJECT_READ) | set(toolcatalog.OBJECT_WRITE)
    assert len(names) == 70
    assert M11_TOOLS <= names
    for name in names:
        for bad in ("delete_forever", "purge", "empty_trash", "settings"):
            assert bad not in name
    assert toolcatalog.default_off() == ["Bash"]
    bash = next(t for t in toolcatalog.BUILTINS if t.id == "Bash")
    assert bash.warning == SHELL_WARNING == (
        "With the shell on, this agent can read every file on this computer, including pages excluded from AI."
    )
    assert bash.default_on is False and bash.cli == ("Bash", "PowerShell")
    with_server = toolcatalog.catalogue(["gh"])
    assert with_server[-1].id == "mcp:gh" and with_server[-1].tools[0].id == "mcp__gh"
    out = toolcatalog.groups_out(groups, ["Bash", "mcp__object__read"])
    rows = {t["id"]: t for g in out for t in g["tools"]}
    assert rows["Bash"]["on"] is False and rows["Bash"]["warning"] == SHELL_WARNING
    assert rows["mcp__object__read"]["on"] is False and rows["Read"]["on"] is True
    assert rows["mcp__object-agent__agent_info"]["on"] is True


def test_run_tool_lists() -> None:
    lists = toolcatalog.run_tool_lists({"Bash"}, write=True, folder_servers=[])
    assert "Bash" in lists.disallowed and "PowerShell" in lists.disallowed
    assert "mcp__object__write_body" in lists.allowed and "Skill" in lists.allowed
    assert "mcp__object-agent__agent_info" in lists.allowed
    assert "Bash" not in lists.allowed
    read_only = toolcatalog.run_tool_lists({"Bash"}, write=False, folder_servers=[])
    for name in toolcatalog.OBJECT_WRITE:
        assert f"mcp__object__{name}" in read_only.disallowed
        assert f"mcp__object__{name}" not in read_only.allowed
    assert "mcp__object__read" in read_only.allowed
    off = toolcatalog.run_tool_lists({"mcp__object__move_to_trash"}, write=True, folder_servers=["gh"])
    assert "mcp__object__move_to_trash" in off.disallowed and "mcp__object__move_to_trash" not in off.allowed
    assert "Bash" in off.allowed and "PowerShell" in off.allowed and "mcp__gh" in off.allowed
    assert not set(off.allowed) & set(off.disallowed)


def test_ephemeral_agent_token(tmp_path: Path) -> None:
    state = tmp_path / "state"
    store = TokenStore(tmp_path / "space", state)
    record, secret = store.ephemeral(
        "Researcher", "read-write", agent="01JC7ZK3T9Q4M2X8B5N6R1V0WE", chat="01KC7ZK3T9Q4M2X8B5N6R1V0WE"
    )
    try:
        assert record.agent == "01JC7ZK3T9Q4M2X8B5N6R1V0WE" and record.chat == "01KC7ZK3T9Q4M2X8B5N6R1V0WE"
        assert record.scope == "read-write"
        assert store.verify(secret) is record
        assert store.list() == []
        assert not state.exists()
    finally:
        TokenStore.drop_ephemeral(secret)
    # A stored token never carries the agent fields, in memory or in the file.
    stored, _ = store.create("Script", "read")
    assert stored.agent is None and stored.chat is None
    saved = json.loads((state / "api-tokens.json").read_text(encoding="utf-8"))["tokens"][0]
    assert "agent" not in saved and "chat" not in saved


def test_stub_routers_mounted(space_dir: Path) -> None:
    from objectapp import api_agent_v1, api_agents, api_v1_tools, server
    from objectapp.space import Space

    assert server.api_agents is api_agents
    assert server.api_agent_v1 is api_agent_v1
    assert server.api_v1_tools is api_v1_tools
    app = server.create_app(Space(space_dir), None, watch=False)
    assert app is not None
    kinds = [e.kind for e in server.RESYNC_EVENTS]
    assert "agents" in kinds and "agentChats" in kinds


def _run_fake(tmp: Path, prompt: str, settings: dict) -> list[dict]:
    settings_file = tmp / "run-settings.json"
    settings_file.write_text(json.dumps(settings), encoding="utf-8")
    cwd = tmp / "agent"
    cwd.mkdir(exist_ok=True)
    env = {k: v for k, v in os.environ.items() if k != "FAKE_CLAUDE_LOG"}
    res = subprocess.run(
        [sys.executable, str(FAKE), "-p", "--output-format", "stream-json", "--settings", str(settings_file)],
        input=prompt, capture_output=True, text=True, encoding="utf-8", cwd=cwd, env=env, timeout=60,
    )
    assert res.returncode == 0, res.stderr
    return [json.loads(line) for line in res.stdout.splitlines() if line.strip()]


def _results(events: list[dict]) -> list[dict]:
    return [
        block
        for e in events
        if e.get("type") == "user"
        for block in e["message"]["content"]
        if block.get("type") == "tool_result"
    ]


def test_fake_matches_documented_rules(tmp_path: Path) -> None:
    space = tmp_path / "space"
    space.mkdir()
    (space / "a.md").write_text("SECRET-A", encoding="utf-8")
    other = tmp_path / "other"
    other.mkdir()
    (other / "b.md").write_text("visible b", encoding="utf-8")
    deny = {"permissions": {"deny": [f"Read({_rp(space)}/**)", f"Edit({_rp(space)}/**)"]}}
    prompt = "\n".join([
        f"FAKE:read:{space / 'a.md'}",
        f"FAKE:read:{other / 'b.md'}",
        f"FAKE:grep:{space}",
        f"FAKE:glob:{space}",
        f"FAKE:write:{space / 'a.md'}",
        f"FAKE:write:{other / 'c.md'}",
    ])
    events = _run_fake(tmp_path, prompt, deny)
    results = _results(events)
    assert len(results) == 6
    assert results[0]["is_error"] is True
    assert results[0]["content"] == "Permission to use Read has been denied."
    assert results[1]["content"] == "visible b" and not results[1].get("is_error")
    assert results[2]["content"] == "Permission to use Grep has been denied."
    assert results[3]["content"] == "Permission to use Glob has been denied."
    assert results[4]["content"] == "Permission to use Write has been denied."
    assert results[5]["content"] == "wrote"
    assert not (other / "c.md").exists()  # the fake never writes
    assert "SECRET-A" not in json.dumps(events)


def test_fence_holds_on_glob_characters_in_a_folder_name(tmp_path: Path) -> None:
    """Sweep finding 18 (checked against the live CLI 2.1.319): an unescaped ``[2024]`` in a rule
    path is a character class, so a space named ``Notes [2024]`` was left unfenced while
    ``Notes 2`` was closed. `agentrun.rule_path` escapes the brackets; ``*``, ``?`` and braces stay
    as written (the CLI still matches them on the literal name, and ``\\?`` broke the match)."""
    from objectapp import agentrun

    agent = tmp_path / "agent"
    agent.mkdir()
    pairs = [("Notes [2024]", "Notes 2"), ("Plans {a,b}", "Plans a"), ("Wild*", None), ("Ask?", None)]
    deny: list[str] = []
    lines: list[str] = []
    for name, twin in pairs:
        space = tmp_path / name
        space.mkdir()
        (space / "a.md").write_text(f"SECRET {name}", encoding="utf-8")
        deny += agentrun.fence_rules([space], agent, tmp_path / "state", tmp_path / "home")[:2]
        lines.append(f"FAKE:read:{space / 'a.md'}")
        if twin:
            (tmp_path / twin).mkdir()
            (tmp_path / twin / "b.md").write_text(f"open {twin}", encoding="utf-8")
            lines.append(f"FAKE:read:{tmp_path / twin / 'b.md'}")
    results = _results(_run_fake(tmp_path, "\n".join(lines), {"permissions": {"deny": deny}}))
    assert [r.get("is_error") is True for r in results] == [True, False, True, False, True, True], results
    assert agentrun.rule_path(Path("/x/Notes [2024]")) == "//x/Notes \\[2024\\]"
    assert agentrun.rule_path(Path("/x/Plans {a,b}/Wild*/Ask?")) == "//x/Plans {a,b}/Wild*/Ask?"


def test_claude_md_excludes_stay_literal(tmp_path: Path) -> None:
    """Sweep finding 18: the CLI (2.1.319, live) matches ``claudeMdExcludes`` on the literal path,
    and a backslash-escaped entry stopped matching, so the excludes are never escaped."""
    from objectapp import agentrun

    own = (tmp_path / "Notes [2024]" / "Plans {a,b}" / "agents" / "Helper").resolve()
    own.mkdir(parents=True)
    got = agentrun.claude_md_excludes(own, tmp_path / "home")
    assert str(own.parent.parent / "CLAUDE.md").replace("\\", "/") in got
    assert not [e for e in got if "\\" in e]


def test_fake_bare_names_and_folder_settings(tmp_path: Path) -> None:
    (tmp_path / "agent" / ".claude").mkdir(parents=True)
    (tmp_path / "agent" / ".claude" / "settings.json").write_text(
        json.dumps({"permissions": {"deny": ["Read(./private/**)"]}}), encoding="utf-8"
    )
    (tmp_path / "agent" / "private").mkdir()
    (tmp_path / "agent" / "private" / "p.md").write_text("PRIVATE", encoding="utf-8")
    events = _run_fake(tmp_path, f"FAKE:bash\nFAKE:read:{tmp_path / 'agent' / 'private' / 'p.md'}",
                       {"permissions": {"deny": ["Bash"]}})
    results = _results(events)
    assert results[0]["content"] == "Permission to use Bash has been denied."
    assert results[1]["content"] == "Permission to use Read has been denied."


def test_fake_logs_the_agent_run_flags(tmp_path: Path, monkeypatch) -> None:
    log = tmp_path / "log.jsonl"
    append = tmp_path / "append.md"
    append.write_text("GUIDANCE", encoding="utf-8")
    settings = tmp_path / "s.json"
    settings.write_text(json.dumps({"permissions": {"deny": []}}), encoding="utf-8")
    env = {**os.environ, "FAKE_CLAUDE_LOG": str(log)}
    env.pop("CLAUDE_CONFIG_DIR", None)
    res = subprocess.run(
        [sys.executable, str(FAKE), "-p", "--setting-sources", "project,local", "--tools", "default",
         "--settings", str(settings), "--append-system-prompt-file", str(append),
         "--allowedTools", "Read,mcp__object__search", "--disallowedTools", "Bash,PowerShell"],
        input="hi", capture_output=True, text=True, encoding="utf-8", env=env, timeout=60, cwd=tmp_path,
    )
    assert res.returncode == 0, res.stderr
    entry = json.loads(log.read_text(encoding="utf-8").splitlines()[-1])
    assert entry["appendPrompt"] == "GUIDANCE"
    assert entry["runSettings"] == {"permissions": {"deny": []}}
    assert entry["settingSources"] == "project,local" and entry["tools"] == "default"
    assert entry["allowed"] == ["Read", "mcp__object__search"]
    assert entry["disallowed"] == ["Bash", "PowerShell"]
    assert entry["env"] == {"CLAUDE_CONFIG_DIR": False}
    init = next(json.loads(x) for x in res.stdout.splitlines() if '"init"' in x)
    assert "Bash" not in init["tools"] and "PowerShell" not in init["tools"]
    assert "Read" in init["tools"] and "Skill" in init["tools"] and "mcp__object__search" in init["tools"]
