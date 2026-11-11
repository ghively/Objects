"""M24 Task 4: read-only work runs get narrowed tool lists enforced in code, and two guards.

Synthetic servers and tools only; nothing starts a server or the CLI.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from objectapp import (
    agentrun,
    api_v1_work,
    appstate,
    mcpgateway,
    toolcatalog,
    v1guard,
    worktools,
)
from objectapp.agentmodel import AgentInput
from objectapp.agentrun import RunScope, build_run
from objectapp.agents import AgentRegistry
from objectapp.mcpmodel import McpServerInput
from objectapp.mcpprobe import ProbeResult
from objectapp.mcpstore import McpStore
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore
from objectapp.workprompts import DESK_SYNC_GUIDANCE, WORK_GUIDANCE

FIXTURE = Path(__file__).parent / "fixtures" / "space-work"
PATH = "Tasks/Printer jams on line 3.md"
_made: list[Path] = []


class StubLoop:
    def __init__(self, settings: dict[str, Any], running: dict | None = None, steps: list | None = None) -> None:
        self.settings = settings
        self.running = running
        self.read_settings = lambda: self.settings
        self.service = SimpleNamespace(item=lambda path: {"steps": steps or []})

    def running_for_chat(self, chat: str | None) -> dict | None:
        return self.running


@pytest.fixture(autouse=True)
def installed():
    saved = (dict(agentrun._contributors), list(v1guard.WRITE_GUARDS), api_v1_work.STEP_GUARD,
             list(toolcatalog.GROUP_PROVIDERS), agentrun.SECRET_LOOKUP, worktools._loop)
    mcpgateway.install()
    mcpgateway.TOOL_CACHE.clear()
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


def _setup(tmp_path: Path, tools_off: list[str] | None = None, marked: list[str] | None = None,
           ) -> tuple[RunScope, StubLoop]:
    state = appstate.state_dir()
    state.mkdir(parents=True, exist_ok=True)
    reg = AgentRegistry()
    rec = reg.create(AgentInput(name="Work", toolsOff=tools_off if tools_off is not None else []), "Work.")
    (rec.folder / ".claude").mkdir(exist_ok=True)
    (rec.folder / ".claude" / "settings.local.json").write_text(
        json.dumps({"permissions": {"allow": ["Bash(*)"]}}), encoding="utf-8")
    (rec.folder / ".mcp.json").write_text(
        json.dumps({"mcpServers": {"notes": {"command": "node", "args": ["notes.js"]}}}), encoding="utf-8")
    store = McpStore(state)
    store.create(McpServerInput(name="jira", kind="command", command="python", args=["srv.py"]))
    saved = next(r for r in store.list() if r.data["name"] == "jira")
    mcpgateway.TOOL_CACHE.put(mcpgateway.gateway_key(saved), ProbeResult(
        True, (("get_issue", "x"), ("edit_issue", "y")), None, 5, "2026-11-06T09:00:00.000Z",
        read_only=("get_issue",)))
    space = tmp_path / "space"
    space.mkdir()
    scope = RunScope(agent=reg.get(rec.id), space_root=space, space_name="Notes", api_url="http://127.0.0.1:1",
                     token="tok", write=True, chat_id="CHAT1", purpose="chat", state=state)
    loop = StubLoop({"activityName": "Gene",
                     "workReadTools": ["mcp__jira__get_issue"] if marked is None else marked})
    worktools.install(loop, None)  # type: ignore[arg-type]
    return scope, loop


def _build(scope: RunScope, purpose: str) -> agentrun.RunCommand:
    cmd = build_run(RunScope(**{**scope.__dict__, "purpose": purpose}), claude="claude", model=None, resume=None)
    _made.append(cmd.tmp)
    return cmd


def _flag(cmd: agentrun.RunCommand, flag: str) -> list[str]:
    return [p for p in cmd.args[cmd.args.index(flag) + 1].split(",") if p]


@pytest.mark.parametrize("purpose", ["work-read", "work-file", "work-sync"])
def test_read_only_runs_get_no_write_tool(tmp_path: Path, purpose: str) -> None:
    scope, _loop = _setup(tmp_path)
    cmd = _build(scope, purpose)
    allowed, disallowed = _flag(cmd, "--allowedTools"), _flag(cmd, "--disallowedTools")
    extra = [f"mcp__object-agent__{t}" for t in worktools.EXTRA_AGENT_TOOLS[purpose]]
    expected = {
        *(f"mcp__object__{t}" for t in toolcatalog.OBJECT_READ),
        *(f"mcp__object__{t}" for t in toolcatalog.WORK_STEP_TOOLS),
        "WebFetch", "Skill", "mcp__jira__get_issue", *extra,
    }
    assert set(allowed) == expected
    for name in ("Bash", "PowerShell", "Write", "Edit", "MultiEdit", "Read", "Task", "Agent",
                 "mcp__object__set_properties", "mcp__object__set_work_fields",
                 "mcp__object__move_to_trash", "mcp__jira__edit_issue", "mcp__object-agent__memory"):
        assert name in disallowed, name
    assert "mcp__jira" not in allowed and "mcp__notes" not in allowed
    assert "notes" not in cmd.mcp_config["mcpServers"] and "jira" in cmd.mcp_config["mcpServers"]
    assert any("Left out notes in a read-only run" in n for n in _notes(scope, purpose))


def _notes(scope: RunScope, purpose: str) -> list[str]:
    parts = agentrun.RunParts()
    for _o, _n, fn in agentrun.contributors():
        fn(RunScope(**{**scope.__dict__, "purpose": purpose}), parts)
    return parts.notes


def test_switches_still_apply(tmp_path: Path) -> None:
    scope, _loop = _setup(tmp_path, tools_off=["WebFetch", "mcp__jira__get_issue"])
    allowed = _flag(_build(scope, "work-read"), "--allowedTools")
    assert "WebFetch" not in allowed and "mcp__jira__get_issue" not in allowed


def test_full_set_for_approved_runs(tmp_path: Path) -> None:
    scope, _loop = _setup(tmp_path)
    work, chat = _build(scope, "work"), _build(scope, "chat")
    assert _flag(work, "--allowedTools") == _flag(chat, "--allowedTools")
    assert _flag(work, "--disallowedTools") == _flag(chat, "--disallowedTools")
    assert "Bash" in _flag(work, "--allowedTools") and "mcp__jira" in _flag(work, "--allowedTools")
    assert WORK_GUIDANCE.format(user="Gene") in work.append and WORK_GUIDANCE.format(user="Gene") not in chat.append


def test_guidance(tmp_path: Path) -> None:
    scope, _loop = _setup(tmp_path)
    sync, chat = _build(scope, "work-sync"), _build(scope, "chat")
    guide = WORK_GUIDANCE.format(user="Gene")
    assert guide in sync.append and DESK_SYNC_GUIDANCE in sync.append
    assert sync.append.index(guide) > sync.append.index("Object")  # after M17's guidance
    assert guide not in chat.append and DESK_SYNC_GUIDANCE not in chat.append


def test_guidance_without_a_name_says_the_user(tmp_path: Path) -> None:
    """M32 (item 13): no name is built in. With "Your name in Activity" empty the guidance says
    "the user", never "You" (which the agent would read as itself) and never a made-up name."""
    scope, loop = _setup(tmp_path)
    loop.settings["activityName"] = ""
    work = _build(scope, "work")
    assert WORK_GUIDANCE.format(user="the user") in work.append
    assert "Gene" not in WORK_GUIDANCE.format(user="the user")
    assert WORK_GUIDANCE.format(user="You") not in work.append


def test_read_only_hint_never_marks(tmp_path: Path) -> None:
    scope, _loop = _setup(tmp_path, marked=[])
    cmd = _build(scope, "work-read")
    assert not any(t.startswith("mcp__jira") for t in _flag(cmd, "--allowedTools"))
    assert "jira" not in cmd.mcp_config["mcpServers"]


def test_v1_guard_refuses_writes_from_read_only_tokens(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    root = tmp_path / "space"
    shutil.copytree(FIXTURE, root)
    space = Space(root)
    client = TestClient(create_app(space, None, watch=False))
    store = TokenStore(root)

    bodies = {
        "/api/v1/object/properties": {"path": PATH, "version": "x", "set": {"a": 1}},
        "/api/v1/work/fields": {"path": PATH, "baseVersion": "x", "set": {"a": 1}},
        "/api/v1/work/activity": {"path": PATH, "text": "x"},
        "/api/v1/agent/work/ticket-fields": {"path": PATH, "fields": {}},
    }

    def refused(purpose: str, route: str) -> bool:
        _rec, secret = store.ephemeral("Run", "read-write", agent="a", chat="c", purpose=purpose)
        try:
            res = client.post(route, json=bodies[route], headers={"Authorization": f"Bearer {secret}"})
        finally:
            TokenStore.drop_ephemeral(secret)
        return res.status_code == 403 and res.json().get("detail") == "This run is read-only."

    for route in ("/api/v1/object/properties", "/api/v1/work/fields"):
        assert refused("work-read", route)
    assert not refused("work-read", "/api/v1/work/activity")
    # the agent routes enforce their purpose themselves; the guard's own table is checked directly
    def guard(purpose: str, path: str) -> str | None:
        request = SimpleNamespace(method="POST", url=SimpleNamespace(path=path))
        return worktools.read_only_write_guard(SimpleNamespace(purpose=purpose), request)  # type: ignore[arg-type]

    assert guard("work-read", "/api/v1/agent/work/ticket-fields") == "This run is read-only."
    assert guard("work-sync", "/api/v1/agent/work/ticket-fields") is None
    assert guard("work-file", "/api/v1/agent/work/file-capture") is None
    assert guard("work-sync", "/api/v1/agent/work/file-capture") == "This run is read-only."
    assert guard("work-read", "/api/v1/work/step/") is None
    assert guard("chat", "/api/v1/object/properties") is None
    assert refused("work-sync", "/api/v1/work/fields")
    assert not refused("chat", "/api/v1/work/fields")
    assert api_v1_work.STEP_GUARD is worktools.step_guard


def _record(purpose: str, chat: str = "CHAT1") -> Any:
    return SimpleNamespace(purpose=purpose, chat=chat)


def test_step_guard_refuses_approve_complete_outside_its_run() -> None:
    steps = [{"id": "ap", "kind": "approve"}, {"id": "ag", "kind": "agent"}]
    loop = StubLoop({}, running={"path": PATH, "stepId": "ap"}, steps=steps)
    worktools._loop = loop  # type: ignore[assignment]
    refused = "Only the run for this approved step can report it."
    assert worktools.step_guard(_record("work-read"), PATH, "ap", "complete") == refused
    assert worktools.step_guard(_record("work-read"), PATH, "ap", "fail") == refused
    assert worktools.step_guard(_record("work"), PATH, "ap", "complete") is None
    loop.running = {"path": PATH, "stepId": "other"}
    assert worktools.step_guard(_record("work"), PATH, "ap", "complete") == refused
    loop.running = None
    assert worktools.step_guard(_record("work"), PATH, "ap", "complete") == refused
    assert worktools.step_guard(_record("work-read"), PATH, "ag", "complete") is None
    assert worktools.step_guard(_record("chat"), PATH, "ap", "complete") is None
    assert worktools.step_guard(_record("work-read"), PATH, "ap", "approve") is None
