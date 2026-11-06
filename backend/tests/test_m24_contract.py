"""M24 Task 1: the contract of the brain dump and the agent loop (plan
``2026-11-05-m24-brain-dump-and-agent-loop.md``, Contract and Task 1): constants, models, the
settings keys, the hooks `create_app` fills, the tool catalogue, the fake `claude`'s work actions and
the mounted routers (reads write nothing).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import m23_helpers
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from objectapp import (
    agent_mcp,
    api_v1_work,
    desksync,
    mcpmodel,
    schedulerun,
    settings,
    spaceconfig,
    toolcatalog,
    v1guard,
    workagent,
    workagentmodel,
    workloop,
    workseams,
    worktools,
)
from objectapp.space import Space
from objectapp.workagentmodel import (
    AgentQueueRow,
    CaptureItem,
    DeskSyncStatus,
    QueueRefused,
    WorkAgentSettings,
    WorkQueueEntry,
)

NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
FAKE = Path(__file__).parent / "fake_claude.py"
FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(path))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.delenv("OBJECT_CLOCK_FILE", raising=False)
    return path


def test_constants() -> None:
    assert workagentmodel.WORK_ENTRY_LABELS["capture"] == "Brain dump"
    assert workloop.WORK_RUN_TIMEOUT == 1800
    assert desksync.DESK_SYNC_TIME == "07:00"
    assert desksync.DESK_SYNC_REPEAT == "every weekday"
    assert 1 <= len(workagent.SKILL_DESCRIPTION) <= 60
    assert workagentmodel.STOPPED == schedulerun.STOPPED
    assert worktools.WORK_PURPOSES == {"work", "work-read", "work-file", "work-sync"}
    assert "work" not in worktools.READ_ONLY_PURPOSES
    assert worktools.READ_ONLY_PURPOSES == {"work-read", "work-file", "work-sync"}


def test_models_parse_contract_json() -> None:
    entry = {
        "id": "01JC0000000000000000000000", "kind": "approve", "state": "pending",
        "path": "Tasks/Printer jams on line 3.md", "objectId": "x", "title": "Printer jams on line 3",
        "stepId": "r8k1pd", "stepN": 2, "stepKind": "approve",
        "stepText": "Restart the print spooler on PRN-TEST-01", "text": None, "capturePath": None,
        "notBefore": None, "auto": False, "by": "Gene", "createdAt": "2026-11-05T10:00:00Z",
        "claimedAt": None, "finishedAt": None, "result": None, "reason": None, "chatId": None,
        "agentId": None, "purpose": None, "runner": None, "attempt": 1, "retryOf": None,
    }
    assert WorkQueueEntry.model_validate(entry).kind == "approve"
    for bad in ({**entry, "kind": "mystery"}, {**entry, "state": "sleeping"}):
        with pytest.raises(ValidationError):
            WorkQueueEntry.model_validate(bad)
    WorkAgentSettings.model_validate({
        "agentId": None, "agent": None, "problem": workagentmodel.NOT_SET, "acts": False,
        "autoRun": True, "readTools": [], "settingsRevision": "",
    })
    CaptureItem.model_validate({
        "path": "Captures/x.md", "text": "x", "status": "needsYou", "question": "Which?",
        "capturedAt": "2026-11-05T10:00:00Z", "linkedPath": None, "objectId": "c1", "version": "v",
        "title": "x", "fromView": "now", "linkedTitle": None,
        "filedTo": {"path": "Tasks/A.md", "title": "A"}, "route": "question",
    })
    DeskSyncStatus.model_validate({
        "ruleId": None, "enabled": False, "repeat": None, "time": None, "lastRun": None,
        "markedReadTools": 0,
    })
    row = loop_row = workloop._row({**entry, "kind": "run", "auto": True, "reason": None})
    AgentQueueRow.model_validate(row)
    assert loop_row["reason"] == "Agent step (auto)"


def test_settings_keys(state: Path) -> None:
    merged, rev = settings.read()
    assert merged["workAgentId"] is None and merged["workAgentActs"] is False
    assert merged["workAutoRun"] is True and merged["workReadTools"] == []
    settings.patch({"workReadTools": ["mcp__jira__get_issue"], "workAgentActs": True}, rev)
    for bad in (["bad"], ["mcp__x__"], "mcp__a__b"):
        with pytest.raises(settings.SettingsProblem):
            settings.patch({"workReadTools": bad}, settings.read()[1])
    many = [f"mcp__s__t{i}" for i in range(501)]
    with pytest.raises(settings.SettingsProblem):
        settings.patch({"workReadTools": many}, settings.read()[1])
    settings.patch({"workReadTools": many[:500]}, settings.read()[1])
    with pytest.raises(settings.SettingsProblem):
        settings.patch({"workAgentActs": "yes"}, settings.read()[1])


def test_hooks_filled(tmp_path: Path, state: Path) -> None:
    from objectapp.server import create_app

    root = m23_helpers.copy_space(tmp_path)
    space = Space(root)
    space.clock = lambda: NOW
    space.tz = UTC
    create_app(space, None, watch=False)
    create_app(space, None, watch=False)  # install is idempotent
    assert schedulerun.PURPOSE_FOR is desksync.purpose_for
    assert desksync.purpose_for(space, "01JX") == "schedule"
    spaceconfig.set_internal(root, "deskSyncRuleId", "01JRULE")
    assert desksync.purpose_for(space, "01JRULE") == "work-sync"
    assert desksync.purpose_for(space, "01JOTHER") == "schedule"
    assert v1guard.WRITE_GUARDS.count(worktools.read_only_write_guard) == 1
    assert api_v1_work.STEP_GUARD is worktools.step_guard
    assert mcpmodel.GATEWAY_PURPOSES[3:] == ("work", "work-read", "work-file", "work-sync")
    assert isinstance(QueueRefused(409, "x"), workseams.SeamRefused)
    assert [c[2] for c in __import__("objectapp.agentrun", fromlist=["x"]).contributors()
            if c[1] in ("work-guidance", "work-tools")] == [worktools.work_guidance_contributor,
                                                            worktools.work_tools_contributor]


def test_set_internal_keeps_everything_else(tmp_path: Path) -> None:
    root = tmp_path / "s"
    (root / ".object").mkdir(parents=True)
    path = root / ".object" / "space.json"
    path.write_text('{"name": "Desk", "jiraSite": "https://example.invalid", "extra": [1, 2]}', encoding="utf-8")
    before = json.loads(path.read_text(encoding="utf-8"))
    spaceconfig.set_internal(root, "deskSyncRuleId", "01JRULE")
    after = json.loads(path.read_text(encoding="utf-8"))
    assert after == {**before, "deskSyncRuleId": "01JRULE"}
    assert "deskSyncRuleId" not in spaceconfig.space_fields(root)
    assert spaceconfig.INTERNAL_KEYS == ("deskSyncRuleId",)
    with pytest.raises(ValueError):
        spaceconfig.set_internal(root, "name", "x")
    with pytest.raises(spaceconfig.SpaceConfigProblem):
        spaceconfig.patch(root, {"deskSyncRuleId": "x"}, spaceconfig.read(root)[1])


def test_agent_tools_catalogue() -> None:
    assert toolcatalog.AGENT_TOOLS[-2:] == ("file_capture", "sync_ticket_fields")
    assert toolcatalog.AGENT_TOOL_LABELS["file_capture"] == "File a brain dump"
    off = toolcatalog.default_off()
    assert "file_capture" not in off and "sync_ticket_fields" not in off
    assert agent_mcp.TOOL_MODULES[-2:] == ("objectapp.agent_tools_captures", "objectapp.agent_tools_desksync")


def _fake(args: list[str], prompt: str, tmp: Path, env: dict[str, str]) -> list[dict]:
    log = tmp / f"log-{uuid.uuid4().hex}.jsonl"
    res = subprocess.run([sys.executable, str(FAKE), *args], input=prompt, capture_output=True, text=True,
                         encoding="utf-8", env={**os.environ, "FAKE_CLAUDE_LOG": str(log), **env},
                         cwd=tmp, timeout=60)
    return [json.loads(line) for line in res.stdout.splitlines() if line.strip()]


ECHO_SERVER = '''\
from mcp.server.mcpserver import MCPServer

server = MCPServer(name="object")


@server.tool()
def work_item(path: str, step: str = "", capture: str = "") -> dict:
    """Echo."""
    return {"path": path, "step": step, "capture": capture}


server.run(transport="stdio")
'''


def test_fake_work_actions(tmp_path: Path) -> None:
    script = tmp_path / "server.py"
    script.write_text(ECHO_SERVER, encoding="utf-8")
    config = tmp_path / "mcp.json"
    config.write_text(json.dumps({"mcpServers": {"object": {
        "command": sys.executable, "args": [str(script)]}}}), encoding="utf-8")
    actions = json.dumps({"run": [{"server": "object", "tool": "work_item",
                                   "args": {"path": "{path}", "step": "{stepId}", "capture": "{capture}"}}]})
    prompt = ("Work queue entry 01JC0000000000000000000000: run.\n"
              "Ref: path=Tasks/Printer jams on line 3.md step=r8k1pd rev=abc capture=-\nDo it.")
    args = ["-p", "--mcp-config", str(config), "--allowedTools", "mcp__object__work_item"]
    events = _fake(args, prompt, tmp_path, {"FAKE_CLAUDE_WORK_ACTIONS": actions})
    uses = [b for e in events if e.get("type") == "assistant" for b in e["message"]["content"]
            if b.get("type") == "tool_use"]
    assert uses and uses[0]["name"] == "mcp__object__work_item"
    assert uses[0]["input"] == {"path": "Tasks/Printer jams on line 3.md", "step": "r8k1pd", "capture": ""}
    # Another kind, or a prompt that isn't an entry prompt, runs nothing.
    other = prompt.replace(": run.", ": note.")
    assert not [e for e in _fake(args, other, tmp_path, {"FAKE_CLAUDE_WORK_ACTIONS": actions})
                if e.get("type") == "user"]
    plain = "Hello\n" + prompt
    assert not [e for e in _fake(args, plain, tmp_path, {"FAKE_CLAUDE_WORK_ACTIONS": actions})
                if e.get("type") == "user"]


def test_home_fixtures_are_synthetic() -> None:
    for rel in ("home-reviewer/.claude/agents/change-reviewer.md",
                "home-reviewer-plugin/.claude/plugins/cache/example/change-reviewer/0.1.0/agents/change-reviewer.md"):
        text = (FIXTURES / rel).read_text(encoding="utf-8")
        assert "name: change-reviewer" in text and "description: Reviews a proposed change" in text


def test_routers_mounted_and_reads_write_nothing(tmp_path: Path, state: Path) -> None:
    from objectapp import server
    from objectapp.server import create_app

    root = m23_helpers.copy_space(tmp_path)
    before_space = {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    space = Space(root)
    space.clock = lambda: NOW
    space.tz = UTC
    app = create_app(space, None, watch=False)
    client = TestClient(app)
    before_state = sorted(p.relative_to(state) for p in state.rglob("*")) if state.exists() else []
    agent = client.get("/api/work/agent")
    assert agent.status_code == 200 and agent.json()["available"] is True
    assert agent.json()["rows"] == [] and agent.json()["note"] == workagentmodel.NOT_SET
    assert client.get("/api/work/captures").json() == {"captures": []}
    got = client.get("/api/work/agent-settings")
    assert got.status_code == 200 and got.json()["agentId"] is None and got.json()["acts"] is False
    assert client.get("/api/work/desk-sync").json()["ruleId"] is None
    assert client.get("/api/work/read-tools").json() == {"servers": []}
    assert client.get("/api/work/agent/create-info").json()["name"] == "Work"
    after_state = sorted(p.relative_to(state) for p in state.rglob("*")) if state.exists() else []
    assert after_state == before_state
    after_space = {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    assert after_space == before_space
    assert "workQueue" in {e.kind for e in server.RESYNC_EVENTS}
    seams = workseams.build_seams(space, app.state.work)
    assert isinstance(seams.agent, workloop.AgentSeam)
