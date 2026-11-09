"""Lane G1 (decisions memo 2026-11-08, S1 and S2): every run names its built-in tools with an
explicit ``--tools`` list, and every run's token carries the agent tools its CLI lists allow.

Synthetic agents only; nothing starts the CLI.
"""

from __future__ import annotations

import shutil
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
from objectapp.tokens import TokenStore

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
