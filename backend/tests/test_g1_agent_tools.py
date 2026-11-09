"""Lane G1 (decisions memo 2026-11-08, S1 and S2): every run names its built-in tools with an
explicit ``--tools`` list, and every run's token carries the agent tools its CLI lists allow.

Synthetic agents only; nothing starts the CLI.
"""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from objectapp import (
    agentrun,
    api_v1_work,
    appstate,
    importfiling,
    mcpgateway,
    toolcatalog,
    v1guard,
    worktools,
)
from objectapp.agentmodel import AgentInput
from objectapp.agentrun import RunScope, build_run
from objectapp.agents import AgentRegistry
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

FIXTURES = Path(__file__).resolve().parent / "fixtures"

_made: list[Path] = []


@pytest.fixture(autouse=True)
def installed():
    saved = (dict(agentrun._contributors), list(v1guard.WRITE_GUARDS), api_v1_work.STEP_GUARD,
             list(toolcatalog.GROUP_PROVIDERS), agentrun.SECRET_LOOKUP, worktools._loop)
    mcpgateway.install()
    mcpgateway.TOOL_CACHE.clear()
    loop = SimpleNamespace(read_settings=lambda: {"activityName": "Gene", "workReadTools": []},
                           service=SimpleNamespace(item=lambda path: {"steps": []}),
                           running_for_chat=lambda chat: None)
    worktools.install(loop, None)  # type: ignore[arg-type]
    importfiling.install()
    yield
    mcpgateway.TOOL_CACHE.clear()
    agentrun._contributors.clear()
    agentrun._contributors.update(saved[0])
    v1guard.WRITE_GUARDS[:] = saved[1]
    api_v1_work.STEP_GUARD = saved[2]
    toolcatalog.GROUP_PROVIDERS[:] = saved[3]
    agentrun.SECRET_LOOKUP = saved[4]
    worktools._loop = saved[5]
    while _made:
        shutil.rmtree(_made.pop(), ignore_errors=True)


def _scope(tmp_path: Path, *, tools_off: list[str] | None = None, purpose: str = "chat", write: bool = True,
           token: str = "tok") -> RunScope:
    state = appstate.state_dir()
    state.mkdir(parents=True, exist_ok=True)
    reg = AgentRegistry()
    name = f"Agent {len(list(reg.list()))}"
    rec = reg.create(AgentInput(name=name, toolsOff=tools_off if tools_off is not None else ["Bash"]), "Hi.")
    space = tmp_path / "space"
    space.mkdir(exist_ok=True)
    return RunScope(agent=reg.get(rec.id), space_root=space, space_name="Notes", api_url="http://127.0.0.1:1",
                    token=token, write=write, chat_id="CHAT1", purpose=purpose, state=state)


def _build(scope: RunScope) -> agentrun.RunCommand:
    cmd = build_run(scope, claude="claude", model=None, resume=None)
    _made.append(cmd.tmp)
    return cmd


def _flag(cmd: agentrun.RunCommand, flag: str) -> list[str]:
    return [p for p in cmd.args[cmd.args.index(flag) + 1].split(",") if p]


# -- S1: the explicit --tools list ----------------------------------------------------------------


def test_cli_flags_no_longer_ask_for_the_default_tools() -> None:
    assert "default" not in agentrun.CLI_FLAGS
    assert "--tools" not in agentrun.CLI_FLAGS


def test_tools_list_is_the_on_builtins_plus_skill_and_tool_search(tmp_path: Path) -> None:
    cmd = _build(_scope(tmp_path, tools_off=["Bash"]))
    assert cmd.args.count("--tools") == 1
    tools = _flag(cmd, "--tools")
    on = [c for e in toolcatalog.BUILTINS if e.id != "Bash" for c in e.cli]
    assert tools == [*on, "Skill", "ToolSearch"]
    for name in ("Bash", "PowerShell", "CronCreate", "RemoteTrigger", "SendMessage", "default"):
        assert name not in tools


def test_tools_list_follows_the_switches(tmp_path: Path) -> None:
    tools = _flag(_build(_scope(tmp_path, tools_off=[])), "--tools")
    assert "Bash" in tools and "PowerShell" in tools
    tools = _flag(_build(_scope(tmp_path, tools_off=["Bash", "WebSearch", "Task"])), "--tools")
    for name in ("WebSearch", "Task", "Agent", "Bash"):
        assert name not in tools
    assert "Read" in tools and tools[-2:] == ["Skill", "ToolSearch"]


@pytest.mark.parametrize("purpose", ["work-read", "work-file", "work-sync"])
def test_read_only_work_runs_get_only_web_fetch(tmp_path: Path, purpose: str) -> None:
    tools = _flag(_build(_scope(tmp_path, tools_off=[], purpose=purpose)), "--tools")
    assert tools == ["WebFetch", "Skill", "ToolSearch"]


def test_filing_runs_get_no_builtin_and_no_skill(tmp_path: Path) -> None:
    cmd = _build(_scope(tmp_path, tools_off=[], purpose=importfiling.PURPOSE, write=False))
    assert _flag(cmd, "--tools") == ["ToolSearch"]


def test_cli_tools_helper() -> None:
    assert toolcatalog.cli_tools(["Read", "mcp__object__read", "Skill"], []) == ["Read", "Skill", "ToolSearch"]
    assert toolcatalog.cli_tools([], ["Skill"]) == ["ToolSearch"]


# -- S2: the run's token carries its agent tools ----------------------------------------------------


@pytest.fixture
def minted() -> Iterator[list[str]]:
    secrets: list[str] = []
    yield secrets
    for secret in secrets:
        TokenStore.drop_ephemeral(secret)


def _run_token(tmp_path: Path, minted: list[str], *, purpose: str = "chat", tools_off: list[str] | None = None,
               write: bool = True, tools: tuple[str, ...] | None = None):
    """A token minted as the run code mints one, then the run's command built with it."""
    scope = _scope(tmp_path, tools_off=tools_off, purpose=purpose, write=write)
    record, secret = TokenStore(scope.space_root).ephemeral(
        "Agent", "read-write" if write else "read", agent=scope.agent.id, chat=scope.chat_id, purpose=purpose,
        tools=tools,
    )
    minted.append(secret)
    assert record.tools == tools
    _build(RunScope(**{**scope.__dict__, "token": secret}))
    return record, scope


def test_chat_token_gets_the_agent_tools_the_run_allows(tmp_path: Path, minted: list[str]) -> None:
    off = ["Bash", "mcp__object-agent__memory", "mcp__object-agent__delegate"]
    record, _scope_ = _run_token(tmp_path, minted, tools_off=off)
    assert record.tools is not None
    assert "memory" not in record.tools and "delegate" not in record.tools
    assert "skill_manage" in record.tools and "agent_info" in record.tools
    assert set(record.tools) <= set(toolcatalog.AGENT_TOOLS)


@pytest.mark.parametrize(("purpose", "expected"), [
    ("work-read", ()), ("work-file", ("file_capture",)), ("work-sync", ("sync_ticket_fields",)),
])
def test_read_only_work_tokens_get_only_their_extra_tool(tmp_path: Path, minted: list[str], purpose: str,
                                                         expected: tuple[str, ...]) -> None:
    record, _ = _run_token(tmp_path, minted, purpose=purpose, tools_off=[])
    assert record.tools == expected


def test_filing_token_gets_no_agent_tool(tmp_path: Path, minted: list[str]) -> None:
    record, _ = _run_token(tmp_path, minted, purpose=importfiling.PURPOSE, tools_off=[], write=False)
    assert record.tools == ()


def test_a_preset_token_list_is_only_narrowed(tmp_path: Path, minted: list[str]) -> None:
    off = ["Bash", "mcp__object-agent__skill_manage"]
    record, _ = _run_token(tmp_path, minted, tools_off=off, tools=("skills_list", "skill_manage", "memory"))
    assert record.tools == ("skills_list", "memory")


def test_build_without_a_live_token_changes_nothing(tmp_path: Path) -> None:
    _build(_scope(tmp_path, token=""))  # the nesting check before a run builds with no token


def test_read_only_purposes_list_matches_the_run_purposes() -> None:
    assert v1guard.NO_LEARNING_WRITES == worktools.READ_ONLY_PURPOSES | {importfiling.PURPOSE}


@pytest.mark.parametrize("purpose", ["work-read", "work-file", "work-sync", importfiling.PURPOSE])
@pytest.mark.parametrize("tool", ["memory", "skill_manage"])
def test_read_only_purposes_never_write_learning(purpose: str, tool: str) -> None:
    record = SimpleNamespace(tools=None, purpose=purpose)
    with pytest.raises(v1guard.Denied) as e:
        v1guard.agent_tool_allowed(record, tool)  # type: ignore[arg-type]
    assert e.value.status == 403 and e.value.detail == f"This run can't use {tool}."
    v1guard.agent_tool_allowed(record, "skills_list")  # type: ignore[arg-type]  # reads stay open


def _client(tmp_path: Path):
    from fastapi.testclient import TestClient

    root = tmp_path / "space-sample"
    shutil.copytree(FIXTURES / "space-sample", root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    return TestClient(create_app(Space(root), None, watch=False)), root


def test_routes_refuse_what_the_run_token_lacks(tmp_path: Path, minted: list[str]) -> None:
    client, root = _client(tmp_path)
    scope = _scope(tmp_path, tools_off=["Bash", "mcp__object-agent__memory"])
    with client:
        record, secret = TokenStore(root).ephemeral("Agent", "read-write", agent=scope.agent.id, chat="CHAT1")
        minted.append(secret)
        _build(RunScope(**{**scope.__dict__, "space_root": root, "token": secret}))
        auth = {"Authorization": f"Bearer {secret}"}
        res = client.post("/api/v1/agent/memory", headers=auth,
                          json={"action": "add", "target": "memory", "content": "Injected."})
        assert res.status_code == 403 and res.json()["detail"] == "This run can't use memory."
        assert client.get("/api/v1/agent/skills", headers=auth).status_code == 200

        # A read-only work run's token, even one minted before any run narrowed it.
        _rec, ro = TokenStore(root).ephemeral("Agent", "read-write", agent=scope.agent.id, chat="CHAT2",
                                              purpose="work-read")
        minted.append(ro)
        auth = {"Authorization": f"Bearer {ro}"}
        res = client.post("/api/v1/agent/memory", headers=auth,
                          json={"action": "add", "target": "memory", "content": "Injected."})
        assert res.status_code == 403 and res.json()["detail"] == "This run can't use memory."
        res = client.post("/api/v1/agent/skills/manage", headers=auth,
                          json={"action": "create", "name": "evil", "content": "---\nname: evil\n---\nx"})
        assert res.status_code == 403 and res.json()["detail"] == "This run can't use skill_manage."
