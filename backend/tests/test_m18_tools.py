"""M18 Task 5: the agent's learning tools (``agent_tools_learning``) and their routes
(``api_learning_v1``), scoped to the token's own agent and run."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mcp.server.mcpserver.exceptions import ToolError

from objectapp import agent_mcp, agentskills, ledger, transcripts
from objectapp.agentmodel import DEFAULT_AGENT_ID, AgentInput
from objectapp.agents import AgentRegistry
from objectapp.learningmodel import MEMORY_FILE
from objectapp.mcp_server import ApiError, ObjectClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

CHAT = "01KAAAAAAAAAAAAAAAAAAAAAAA"
OTHER_CHAT = "01KBBBBBBBBBBBBBBBBBBBBBBB"


class Env:
    def __init__(self, space_dir: Path) -> None:
        self.space_dir = space_dir
        app = create_app(Space(space_dir), None, watch=False)
        self.events: list = []
        app.state.hub.publish = self.events.append
        self.http = TestClient(app)
        self.http.__enter__()  # the lifespan: the hub's loop delivers announcements
        self.agent = AgentRegistry().create(AgentInput(name="Researcher"), "Find things.\n")
        self.secrets: list[str] = []

    def token(self, agent: str | None = None, scope: str = "read", **kw) -> tuple:
        record, secret = TokenStore(self.space_dir).ephemeral(
            "Researcher", scope, agent=agent or self.agent.id, chat=kw.pop("chat", CHAT), **kw
        )
        self.secrets.append(secret)
        return record, secret

    def server(self, secret: str):
        return agent_mcp.build_server(ObjectClient("http://testserver", secret, self.http))

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


def _call(server, tool: str, **args):
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


def _learning_events(env: Env, want: int = 0) -> list:
    """The agentLearning events published so far (announce hands them to the hub's loop, so
    wait briefly for `want` of them)."""
    deadline = time.monotonic() + 2.0
    while True:
        got = [e for e in env.events if e.kind == "agentLearning"]
        if len(got) >= want or time.monotonic() > deadline:
            return got
        time.sleep(0.01)


def test_tools_listed(env: Env) -> None:
    _rec, secret = env.token()
    tools = {t.name: t for t in asyncio.run(env.server(secret).list_tools())}
    assert {"agent_info", "memory", "skills_list", "skill_view", "skill_manage", "session_search"} <= set(tools)
    assert "2,200" in tools["memory"].description and "§" in tools["memory"].description
    manage = tools["skill_manage"].description
    assert "skill_view first" in manage and "64" in manage and "60" in manage
    assert tools["memory"].annotations.read_only_hint is False
    assert tools["skill_manage"].annotations.read_only_hint is False
    for name in ("skills_list", "skill_view", "session_search"):
        assert tools[name].annotations.read_only_hint is True


def test_memory_tool_round_trip(env: Env) -> None:
    _rec, secret = env.token()
    server = env.server(secret)
    out = _call(server, "memory", action="add", target="memory", content="X")
    assert out["ok"] is True and out["entries"] == ["X"]
    assert (env.agent.folder / MEMORY_FILE).read_text(encoding="utf-8") == "X"
    default = AgentRegistry().get(DEFAULT_AGENT_ID)
    assert not (default.folder / MEMORY_FILE).exists()
    entry = ledger.get(env.agent.folder, out["entryId"])
    assert entry["source"] == {"kind": "chat", "agentId": env.agent.id, "chatId": CHAT, "run": None}
    events = _learning_events(env, 1)
    assert len(events) == 1 and events[0].path == env.agent.id and events[0].version == out["entryId"]
    # a cap failure lists the current entries
    with pytest.raises(ApiError) as exc:
        _call(server, "memory", action="add", target="memory", content="y" * 2300)
    assert "over its cap of 2,200" in str(exc.value) and "Current entries:\nX" in str(exc.value)
    assert len(_learning_events(env)) == 1


def test_skill_tools_round_trip(env: Env) -> None:
    _rec, secret = env.token()
    server = env.server(secret)
    created = _call(server, "skill_manage", action="create", name="rack-labels", description="Label racks",
                    content="# Steps\nPrint the label.\n")
    assert created["ok"] is True and created["skill"]["createdBy"] == "agent"
    listed = _call(server, "skills_list")
    assert [s["name"] for s in listed["skills"]] == ["rack-labels"]
    viewed = _call(server, "skill_view", name="rack-labels")
    assert viewed["name"] == "rack-labels" and viewed["file"] == "SKILL.md"
    assert "Print the label." in viewed["text"] and viewed["files"]
    assert agentskills.list_skills(env.agent.folder)[0].uses == 1
    patched = _call(server, "skill_manage", action="patch", name="rack-labels",
                    old_string="Print the label.", new_string="Print two labels.")
    assert patched["ok"] is True
    assert "Print two labels." in (env.agent.folder / ".claude/skills/rack-labels/SKILL.md").read_text(encoding="utf-8")
    archived = _call(server, "skill_manage", action="archive", name="rack-labels")
    assert archived["skill"]["state"] == "archived"
    assert _call(server, "skills_list")["skills"] == []
    with pytest.raises(ApiError, match="404: There's no active skill named 'nope'."):
        _call(server, "skill_view", name="nope")
    with pytest.raises(ApiError, match="404: There's no active skill named 'nope'."):
        _call(server, "skill_manage", action="patch", name="nope", old_string="a", new_string="b")
    assert len(_learning_events(env, 3)) == 3


def test_read_memo_is_per_token(env: Env) -> None:
    _a, secret_a = env.token()
    _b, secret_b = env.token()
    a, b = env.server(secret_a), env.server(secret_b)
    _call(a, "skill_manage", action="create", name="rack-labels", description="Label racks", content="Body\n")
    _c, secret_c = env.token()
    c = env.server(secret_c)
    _call(c, "skill_view", name="rack-labels")
    with pytest.raises(ApiError, match="Read the skill with skill_view first"):
        _call(b, "skill_manage", action="patch", name="rack-labels", old_string="Body", new_string="New")
    _call(c, "skill_manage", action="patch", name="rack-labels", old_string="Body", new_string="New")


def test_session_search_tool(env: Env) -> None:
    folder = env.agent.folder
    transcripts.start(folder, OTHER_CHAT, agent_id=env.agent.id, title="Labels", space_name="Notes",
                      space_key=None, created_at="2026-11-05T09:00:00.000Z")
    transcripts.append(folder, OTHER_CHAT, [
        {"type": "user", "text": "Where do they go?", "at": "2026-11-05T09:01:00.000Z"},
        {"type": "assistant", "text": "Rack labels go on the left.", "at": "2026-11-05T09:02:00.000Z",
         "model": "sonnet", "sessionId": None},
    ])
    _rec, secret = env.token()
    server = env.server(secret)
    found = _call(server, "session_search", query="labels")
    assert [c["chatId"] for c in found["chats"]] == [OTHER_CHAT]
    read = _call(server, "session_search", chat_id=OTHER_CHAT)
    assert read["chatId"] == OTHER_CHAT
    assert [m["role"] for m in read["messages"]] == ["user", "assistant"]
    with pytest.raises(ApiError, match="Give a query or a chat_id."):
        _call(server, "session_search")
    with pytest.raises(ApiError, match="404"):
        _call(server, "session_search", chat_id="01KZZZZZZZZZZZZZZZZZZZZZZZ")
    with pytest.raises(ApiError, match="404"):
        _call(server, "session_search", chat_id="../x")


def test_review_token_scoping(env: Env) -> None:
    _rec, secret = env.token(purpose="review", run="R1", tools=("skills_list", "skill_view", "skill_manage"))
    server = env.server(secret)
    with pytest.raises(ApiError, match="403: This run can't use memory."):
        _call(server, "memory", action="add", target="memory", content="X")
    with pytest.raises(ApiError, match="403: This run can't use session_search."):
        _call(server, "session_search", query="labels")
    out = _call(server, "skill_manage", action="create", name="rack-labels", description="Label racks",
                content="Body\n")
    entry = ledger.get(env.agent.folder, out["entryId"])
    assert entry["source"] == {"kind": "review", "agentId": env.agent.id, "chatId": CHAT, "run": "R1"}
    assert not (env.agent.folder / MEMORY_FILE).exists()


def test_curator_source(env: Env) -> None:
    _rec, secret = env.token(purpose="curator", run="C1", chat=None)
    out = _call(env.server(secret), "skill_manage", action="create", name="rack-labels",
                description="Label racks", content="Body\n")
    assert ledger.get(env.agent.folder, out["entryId"])["source"]["kind"] == "curator"


def test_non_agent_token_is_403(env: Env) -> None:
    secret = env.http.post("/api/integrations/tokens", json={"name": "mcp", "scope": "read-write"}).json()["secret"]
    h = {"Authorization": f"Bearer {secret}"}
    calls = [
        env.http.post("/api/v1/agent/memory", json={"action": "add", "target": "memory", "content": "X"}, headers=h),
        env.http.get("/api/v1/agent/skills", headers=h),
        env.http.get("/api/v1/agent/skills/rack-labels", headers=h),
        env.http.post("/api/v1/agent/skills/manage", json={"action": "create", "name": "x"}, headers=h),
        env.http.get("/api/v1/agent/sessions/search", params={"q": "x"}, headers=h),
        env.http.get(f"/api/v1/agent/sessions/{CHAT}", headers=h),
    ]
    for res in calls:
        assert res.status_code == 403
        assert res.json()["detail"] == "This token isn't an agent's."
    assert env.http.get("/api/v1/agent/skills").status_code == 401


def test_read_only_agent(env: Env) -> None:
    (env.agent.folder / ".object-agent" / "agent.json").write_bytes(b"{not json")
    _rec, secret = env.token()
    h = {"Authorization": f"Bearer {secret}"}
    res = env.http.post("/api/v1/agent/memory", json={"action": "add", "target": "memory", "content": "X"}, headers=h)
    assert res.status_code == 423
    res = env.http.post("/api/v1/agent/skills/manage",
                        json={"action": "create", "name": "x", "description": "d", "content": "b"}, headers=h)
    assert res.status_code == 423
    assert not (env.agent.folder / MEMORY_FILE).exists()
    assert not (env.agent.folder / ".claude" / "skills" / "x").exists()
    assert env.http.get("/api/v1/agent/skills", headers=h).status_code == 200


def test_default_agent_reads_write_nothing_then_a_write_makes_its_folder(env: Env) -> None:
    default = AgentRegistry().get(DEFAULT_AGENT_ID)
    assert not default.exists
    _rec, secret = env.token(agent=DEFAULT_AGENT_ID)
    server = env.server(secret)
    assert _call(server, "skills_list") == {"skills": []}
    assert _call(server, "session_search", query="labels") == {"chats": []}
    assert not default.folder.exists()
    _call(server, "memory", action="add", target="user", content="Gene prefers short answers")
    assert AgentRegistry().get(DEFAULT_AGENT_ID).exists
    assert (default.folder / ".object-agent/memory/USER.md").read_text(encoding="utf-8") == "Gene prefers short answers"


def test_budget_counts_learning_calls(env: Env) -> None:
    _rec, secret = env.token(purpose="review", run="R2", budget=2)
    server = env.server(secret)
    _call(server, "skills_list")
    _call(server, "skills_list")
    with pytest.raises(ApiError, match="429: This run has used its 2 tool steps."):
        _call(server, "skills_list")
