"""M21 Task 4: the ``schedule_manage`` agent tool (``agent_tools_schedules``) over its routes
(``api_schedules_v1``), through the ``object-agent`` MCP server built on the app's TestClient, and
M17's ``POST /api/v1/automations`` refusing ``runAgent`` rules."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from mcp.server.mcpserver.exceptions import ToolError

from objectapp import agent_mcp, toolcatalog
from objectapp.agentmodel import AgentInput
from objectapp.agents import AgentRegistry
from objectapp.localtime import to_local
from objectapp.mcp_server import ApiError, ObjectClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

CHAT = "01KAAAAAAAAAAAAAAAAAAAAAAA"


def rule_file(root: Path, rule_id: str) -> Path:
    return root / ".object" / "automations" / f"{rule_id}.json"


class Env:
    def __init__(self, space_dir: Path) -> None:
        self.space_dir = space_dir
        self.space = Space(space_dir)
        app = create_app(self.space, None, watch=False)
        self.events: list = []
        app.state.hub.publish = self.events.append
        self.http = TestClient(app)
        self.http.__enter__()
        self.agent = AgentRegistry().create(AgentInput(name="Researcher"), "Find things.\n")
        self.secrets: list[str] = []

    def token(self, name: str, agent: str | None, scope: str = "read-write", **kw) -> str:
        _record, secret = TokenStore(self.space_dir).ephemeral(name, scope, agent=agent, chat=CHAT, **kw)
        self.secrets.append(secret)
        return secret

    def researcher(self, scope: str = "read-write", **kw) -> str:
        return self.token("Researcher", self.agent.id, scope, **kw)

    def server(self, secret: str):
        return agent_mcp.build_server(ObjectClient("http://testserver", secret, self.http))

    def today(self) -> str:
        return to_local(datetime.now(UTC), self.space.tz).date().isoformat()

    def close(self) -> None:
        for s in self.secrets:
            TokenStore.drop_ephemeral(s)
        self.http.__exit__(None, None, None)


@pytest.fixture
def env(space_dir: Path):
    e = Env(space_dir)
    try:
        yield e
    finally:
        e.close()


def _call(server, tool: str, **args) -> Any:
    try:
        result = asyncio.run(server.call_tool(tool, args))
    except ToolError as exc:
        raise ApiError(str(exc)) from exc
    if result.is_error:
        raise ApiError(" ".join(getattr(c, "text", "") for c in result.content))
    if result.structured_content is not None:
        out = result.structured_content
        return out.get("result", out) if set(out) == {"result"} else out
    return json.loads(result.content[0].text)


def _manage(server, action: str, **args) -> Any:
    return _call(server, "schedule_manage", action=action, **args)


def _daily(server, **over) -> dict[str, Any]:
    args = {"name": "Daily digest", "prompt": "Sum up today", "repeat": "every day", "time": "18:00", **over}
    return _manage(server, "create", **args)


def notify_schedule() -> dict[str, Any]:
    return {
        "name": "Remind me",
        "description": "",
        "enabled": True,
        "trigger": {"kind": "schedule", "repeat": "every day", "time": "09:00", "start": "2026-11-09"},
        "conditions": {"type": "filterGroup", "operator": "and", "elements": []},
        "actions": [{"kind": "notify", "title": "Hi", "body": ""}],
        "templateRepeat": None,
    }


def test_create_list_update_delete(env: Env) -> None:
    server = env.server(env.researcher())
    made = _daily(server)
    assert made["name"] == "Daily digest" and made["prompt"] == "Sum up today"
    assert made["repeat"] == "every day" and made["time"] == "18:00"
    assert made["start"] == env.today()
    assert made["enabled"] is True and made["model"] is None and made["readOnlyReason"] is None
    assert made["lastRun"] is None and isinstance(made["nextRun"], str)
    path = rule_file(env.space_dir, made["id"])
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stored["actions"] == [{"kind": "runAgent", "agentId": env.agent.id, "prompt": "Sum up today",
                                  "model": None}]
    announced = [e for e in env.events if e.kind == "automations" and e.path == made["id"]]
    assert announced and announced[-1].origin == "api:Researcher"

    assert [s["id"] for s in _manage(server, "list")["schedules"]] == [made["id"]]

    off = _manage(server, "update", schedule_id=made["id"], enabled=False)
    assert off["enabled"] is False
    assert {k: v for k, v in off.items() if k not in ("enabled", "nextRun")} == {
        k: v for k, v in made.items() if k not in ("enabled", "nextRun")}
    assert json.loads(path.read_text(encoding="utf-8"))["enabled"] is False

    assert _manage(server, "update", schedule_id=made["id"], model="haiku")["model"] == "haiku"
    cleared = _manage(server, "update", schedule_id=made["id"], clear_model=True)
    assert cleared["model"] is None and cleared["name"] == "Daily digest"

    gone = _manage(server, "delete", schedule_id=made["id"])
    assert isinstance(gone["trashId"], str) and not path.exists()
    items = [i for i in env.http.get("/api/trash").json() if i["kind"] == "automation"]
    assert [(i["id"], i["automationId"]) for i in items] == [(gone["trashId"], made["id"])]
    assert env.http.post(f"/api/trash/{gone['trashId']}/restore").status_code == 200
    assert [s["id"] for s in _manage(server, "list")["schedules"]] == [made["id"]]


def test_list_is_by_name_then_id(env: Env) -> None:
    server = env.server(env.researcher())
    b = _daily(server, name="beta")
    a = _daily(server, name="Alpha")
    assert [s["id"] for s in _manage(server, "list")["schedules"]] == [a["id"], b["id"]]


def test_update_keeps_unknown_keys_and_description(env: Env) -> None:
    server = env.server(env.researcher())
    made = _daily(server)
    path = rule_file(env.space_dir, made["id"])
    data = json.loads(path.read_text(encoding="utf-8"))
    data["futureKey"] = {"kept": True}
    data["description"] = "Written in Settings"
    path.write_text(json.dumps(data), encoding="utf-8")
    out = _manage(server, "update", schedule_id=made["id"], prompt="Sum up the week", repeat="every week on monday")
    assert out["prompt"] == "Sum up the week" and out["repeat"].startswith("every week on mon")  # M14 normalises it
    after = json.loads(path.read_text(encoding="utf-8"))
    assert after["futureKey"] == {"kept": True} and after["description"] == "Written in Settings"


def test_validation_messages(env: Env) -> None:
    server = env.server(env.researcher())
    with pytest.raises(ApiError, match="422: A schedule can't repeat after completion."):
        _daily(server, repeat="every week after completion")
    with pytest.raises(ApiError, match="422: .*isn't a repeat"):
        _daily(server, repeat="whenever")
    with pytest.raises(ApiError, match="422"):
        _daily(server, time="25:00")
    with pytest.raises(ApiError, match="422"):
        _daily(server, prompt="")
    with pytest.raises(ApiError, match="name"):
        _manage(server, "create", prompt="Sum up today", repeat="every day")
    with pytest.raises(ApiError, match="schedule_id"):
        _manage(server, "update", enabled=False)
    assert _manage(server, "list")["schedules"] == []


def test_other_agents_schedules_are_404(env: Env) -> None:
    mine = _daily(env.server(env.researcher()))
    other = env.server(env.token("Assistant", "assistant"))
    assert _manage(other, "list")["schedules"] == []
    with pytest.raises(ApiError, match="404"):
        _manage(other, "update", schedule_id=mine["id"], enabled=False)
    with pytest.raises(ApiError, match="404"):
        _manage(other, "delete", schedule_id=mine["id"])
    assert json.loads(rule_file(env.space_dir, mine["id"]).read_text(encoding="utf-8"))["enabled"] is True


def test_read_token_cannot_write(env: Env) -> None:
    mine = _daily(env.server(env.researcher()))
    reader = env.server(env.researcher("read"))
    assert [s["id"] for s in _manage(reader, "list")["schedules"]] == [mine["id"]]
    with pytest.raises(ApiError, match="403: This token can only read."):
        _daily(reader, name="Another")
    with pytest.raises(ApiError, match="403: This token can only read."):
        _manage(reader, "update", schedule_id=mine["id"], enabled=False)
    with pytest.raises(ApiError, match="403: This token can only read."):
        _manage(reader, "delete", schedule_id=mine["id"])
    assert rule_file(env.space_dir, mine["id"]).exists()


def test_stored_token_is_403(env: Env) -> None:
    _record, secret = TokenStore(env.space_dir).create("Script", "read-write")
    res = env.http.get("/api/v1/agent/schedules", headers={"Authorization": f"Bearer {secret}"})
    assert res.status_code == 403 and res.json()["detail"] == "This token isn't an agent's."


def test_create_automation_refuses_run_agent(env: Env) -> None:
    secret = env.token("Assistant", "assistant")
    headers = {"Authorization": f"Bearer {secret}"}
    rule = notify_schedule()
    agent_rule = {**rule, "actions": [{"kind": "runAgent", "agentId": "assistant", "prompt": "Hi", "model": None}]}
    res = env.http.post("/api/v1/automations", json={"rule": agent_rule}, headers=headers)
    assert res.status_code == 422 and res.json()["detail"] == "Agent schedules are made with schedule_manage."
    assert env.http.get("/api/automations").json() == []
    res = env.http.post("/api/v1/automations", json={"rule": rule}, headers=headers)
    assert res.status_code == 201


def test_not_an_agent_schedule_is_404(env: Env) -> None:
    made = env.http.post("/api/automations", json={"rule": notify_schedule()}).json()
    server = env.server(env.researcher())
    with pytest.raises(ApiError, match="404"):
        _manage(server, "update", schedule_id=made["id"], enabled=False)
    with pytest.raises(ApiError, match="404"):
        _manage(server, "delete", schedule_id=made["id"])
    assert _manage(server, "list")["schedules"] == []


def test_review_token_is_403(env: Env) -> None:
    server = env.server(env.researcher("read", purpose="review", tools=("memory", "skill_manage")))
    with pytest.raises(ApiError, match="403: This run can't use schedule_manage."):
        _manage(server, "list")


def test_tool_registered(env: Env) -> None:
    assert "objectapp.agent_tools_schedules" in agent_mcp.TOOL_MODULES
    tools = {t.name: t for t in asyncio.run(env.server(env.researcher()).list_tools())}
    assert {"agent_info", "memory", "skill_manage", "session_search", "skills_list", "skill_view"} <= set(tools)
    assert {"remote_agents_list", "remote_agent_call", "delegate", "schedule_manage"} <= set(tools)
    desc = tools["schedule_manage"].description or ""
    for words in ("every weekday", "every month on the 1st", "HH:mm", "{date:YYYY-MM-DD}", "Trash"):
        assert words in desc
    off = toolcatalog.run_tool_lists(["mcp__object-agent__schedule_manage"], write=True, folder_servers=[])
    assert "mcp__object-agent__schedule_manage" in off.disallowed
    on = toolcatalog.run_tool_lists([], write=True, folder_servers=[])
    assert "mcp__object-agent__schedule_manage" in on.allowed
