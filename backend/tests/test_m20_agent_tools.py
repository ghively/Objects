"""M20 Task 6: the ``remote_agents_list``, ``remote_agent_call`` and ``delegate`` agent tools
(``agent_tools_a2a``) over their routes (``api_agent_a2a_v1``), through the ``object-agent`` MCP
server built on the app's TestClient."""

from __future__ import annotations

import asyncio
import json
import sys
import types
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from mcp.server.mcpserver.exceptions import ToolError

from objectapp import a2a, agent_mcp, agent_tools_a2a, remotesecrets
from objectapp.agentmodel import AgentInput
from objectapp.agents import AgentRegistry
from objectapp.mcp_server import ApiError, ObjectClient
from objectapp.remotemodel import DELEGATE_TIMEOUT, REMOTE_CALL_TIMEOUT, REMOTE_CALL_TIMEOUT_MAX, AuthInput
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

CHAT = "01KAAAAAAAAAAAAAAAAAAAAAAA"


def card_raw(name: str = "Fake Planner") -> dict[str, Any]:
    return {
        "name": name,
        "description": "Plans synthetic trips.",
        "version": "1.0.0",
        "supportedInterfaces": [{"url": "http://127.0.0.1:9/a2a", "protocolBinding": "JSONRPC",
                                 "protocolVersion": "1.0"}],
        "capabilities": {"streaming": True},
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "skills": [{"id": "plan", "name": "Plan", "description": "Plans a trip", "tags": ["travel"],
                    "examples": ["Plan a weekend"]}],
    }


def add_remote(name: str = "Fake Planner", token: str | None = "tok-1"):
    raw = card_raw(name)
    auth = AuthInput(kind="bearer", value=token) if token else AuthInput(kind="none")
    return AgentRegistry().create_remote(a2a.parse_card(raw), raw, "http://127.0.0.1:9/.well-known/agent-card.json",
                                         auth)


def remote_result(**over: Any):
    fields = {"chat_id": "01KCCCCCCCCCCCCCCCCCCCCCCC", "state": "TASK_STATE_INPUT_REQUIRED", "text": "Which date?",
              "context_id": "ctx-1", "task_id": "task-9",
              "attachments": [{"name": "plan.md", "mediaType": "text/markdown", "size": 6, "kind": "file",
                               "file": "01KCCCCCCCCCCCCCCCCCCCCCCC/plan.md", "url": None}],
              "cut": False, **over}
    try:
        from objectapp.remotechat import RemoteResult
    except ImportError:  # until M20 Task 4 lands
        return types.SimpleNamespace(**fields)
    return RemoteResult(**fields)


def patch_call_remote(monkeypatch: pytest.MonkeyPatch, answer: Any) -> list[dict[str, Any]]:
    """Replace ``remotechat.call_remote`` with a double that records its arguments."""
    calls: list[dict[str, Any]] = []

    async def fake(record, text, **kw):
        calls.append({"record": record, "text": text, **kw})
        if isinstance(answer, BaseException):
            raise answer
        return answer

    try:
        from objectapp import remotechat
    except ImportError:  # until M20 Task 4 lands
        import objectapp

        mod = types.ModuleType("objectapp.remotechat")
        mod.call_remote = fake  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "objectapp.remotechat", mod)
        monkeypatch.setattr(objectapp, "remotechat", mod, raising=False)
    else:
        monkeypatch.setattr(remotechat, "call_remote", fake)
    return calls


class Env:
    def __init__(self, space_dir: Path) -> None:
        self.space_dir = space_dir
        app = create_app(Space(space_dir), None, watch=False)
        self.events: list = []
        app.state.hub.publish = self.events.append
        self.http = TestClient(app)
        self.http.__enter__()
        self.agent = AgentRegistry().create(AgentInput(name="Researcher"), "Find things.\n")
        self.secrets: list[str] = []

    def token(self, agent: str = "assistant", scope: str = "read-write", **kw) -> tuple:
        record, secret = TokenStore(self.space_dir).ephemeral(
            "Assistant", scope, agent=agent, chat=kw.pop("chat", CHAT), **kw
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


def test_tools_listed(env: Env) -> None:
    _rec, secret = env.token()
    tools = {t.name: t for t in asyncio.run(env.server(secret).list_tools())}
    assert {"agent_info", "remote_agents_list", "remote_agent_call", "delegate"} <= set(tools)
    assert {"memory", "skill_manage", "session_search"} <= set(tools)  # M18's
    assert tools["remote_agents_list"].description == (
        "List the remote (A2A) agents you can call, with what their cards say they do.")
    assert tools["remote_agent_call"].description == (
        "Send a message to a remote agent and wait for its answer. Pass context_id (and task_id when it "
        "asked for input) to continue.")
    assert tools["delegate"].description == (
        "Hand a task to another agent (local or remote) by name, with a goal and context; it runs as that "
        "agent's own chat and you get back its summary.")


def test_remote_agents_list(env: Env) -> None:
    remote = add_remote()
    _rec, secret = env.token()
    server = env.server(secret)
    listed = _call(server, "remote_agents_list")["agents"]
    assert listed == [{
        "id": remote.id, "name": "Fake Planner", "description": "Plans synthetic trips.",
        "skills": [{"id": "plan", "name": "Plan", "description": "Plans a trip"}],
        "streaming": True, "usable": True,
    }]
    remotesecrets.remove(remote.id)
    assert _call(server, "remote_agents_list")["agents"][0]["usable"] is False
    open_one = add_remote("Open Planner", token=None)
    by_id = {a["id"]: a for a in _call(server, "remote_agents_list")["agents"]}
    assert by_id[open_one.id]["usable"] is True
    assert env.agent.id not in by_id and "assistant" not in by_id  # local agents aren't listed


def test_remote_agent_call_shape(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    remote = add_remote()
    calls = patch_call_remote(monkeypatch, remote_result())
    _rec, secret = env.token()
    server = env.server(secret)
    out = _call(server, "remote_agent_call", agent="fake planner", message="Book it", context_id="ctx-1",
                timeout_seconds=9999)
    assert out == {
        "agent": {"id": remote.id, "name": "Fake Planner"},
        "chatId": "01KCCCCCCCCCCCCCCCCCCCCCCC",
        "state": "input-required",
        "text": "Which date?",
        "contextId": "ctx-1",
        "taskId": "task-9",
        "artifacts": [{"name": "plan.md", "mediaType": "text/markdown", "size": 6, "kind": "file",
                       "file": "01KCCCCCCCCCCCCCCCCCCCCCCC/plan.md", "url": None}],
        "cut": False,
    }
    first = calls[0]
    assert first["record"].id == remote.id and first["text"] == "Book it"
    assert first["timeout"] == REMOTE_CALL_TIMEOUT_MAX
    assert first["context_id"] == "ctx-1" and first["task_id"] is None
    assert first["delegated_from"] == "assistant" and first["from_chat"] == CHAT
    _call(server, "remote_agent_call", agent=remote.id, message="Again")
    assert calls[1]["timeout"] == REMOTE_CALL_TIMEOUT
    with pytest.raises(ApiError, match="That isn't a remote agent."):
        _call(server, "remote_agent_call", agent="Researcher", message="Hi")
    with pytest.raises(ApiError, match="No agent named nobody."):
        _call(server, "remote_agent_call", agent="nobody", message="Hi")
    assert len(calls) == 2


def test_remote_agent_call_errors(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    add_remote()
    _rec, secret = env.token()
    server = env.server(secret)
    patch_call_remote(monkeypatch, a2a.A2AError("Fake Planner answered with an error: nope (-32001)"))
    with pytest.raises(ApiError, match=r"502: Fake Planner answered with an error: nope \(-32001\)"):
        _call(server, "remote_agent_call", agent="Fake Planner", message="Hi")
    patch_call_remote(monkeypatch, a2a.A2AError("late", status=504))
    with pytest.raises(ApiError, match="504: Fake Planner didn't finish within 5 seconds; its chat so far is kept."):
        _call(server, "remote_agent_call", agent="Fake Planner", message="Hi", timeout_seconds=5)


def test_long_calls_outlive_the_default_client() -> None:
    assert agent_tools_a2a.CLIENT_TIMEOUT >= DELEGATE_TIMEOUT + 30
    own = agent_tools_a2a.long_client(ObjectClient("http://127.0.0.1:1", "secret-x"))
    try:
        assert isinstance(own.http, httpx.Client)
        assert own.http.timeout.read is not None and own.http.timeout.read >= DELEGATE_TIMEOUT + 30
        assert own.headers == {"Authorization": "Bearer secret-x"}
    finally:
        own.http.close()


def test_remote_agent_call_cant_run_is_409(env: Env) -> None:
    gone = add_remote("Gone Planner")
    import shutil

    shutil.rmtree(gone.folder)
    no_token = add_remote()
    remotesecrets.remove(no_token.id)
    _rec, secret = env.token()
    server = env.server(secret)
    with pytest.raises(ApiError, match=r"Conflict: Gone Planner can't run: This agent's folder .* is missing"):
        _call(server, "remote_agent_call", agent="Gone Planner", message="Hi")
    with pytest.raises(ApiError, match=r"Conflict: Fake Planner can't run: This remote agent needs its token again"):
        _call(server, "remote_agent_call", agent="Fake Planner", message="Hi")


def test_remote_agent_call_error_announces_the_chat(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    remote = add_remote()
    _rec, secret = env.token()
    server = env.server(secret)
    err = a2a.A2AError("Fake Planner sent an answer Object can't read.")
    err.chat_id = "01KCCCCCCCCCCCCCCCCCCCCCCC"
    patch_call_remote(monkeypatch, err)
    with pytest.raises(ApiError, match="502: Fake Planner sent an answer Object can't read."):
        _call(server, "remote_agent_call", agent="Fake Planner", message="Hi")
    chats = [e for e in env.events if e.kind == "agentChats"]
    assert [(e.path, e.version) for e in chats] == [(remote.id, "01KCCCCCCCCCCCCCCCCCCCCCCC")]


def test_token_without_agent_is_403(env: Env) -> None:
    _rec, secret = TokenStore(env.space_dir).ephemeral("Plain", "read-write")
    env.secrets.append(secret)
    headers = {"Authorization": f"Bearer {secret}"}
    assert env.http.get("/api/v1/agent/remote-agents", headers=headers).status_code == 403
    res = env.http.post("/api/v1/agent/remote-call", json={"agent": "x", "message": "m"}, headers=headers)
    assert res.status_code == 403 and res.json()["detail"] == "This token isn't an agent's."
    res = env.http.post("/api/v1/agent/delegate", json={"agent": "x", "goal": "g"}, headers=headers)
    assert res.status_code == 403
    assert env.http.get("/api/v1/agent/remote-agents").status_code == 401


def test_inputs_capped(env: Env) -> None:
    _rec, secret = env.token()
    headers = {"Authorization": f"Bearer {secret}"}
    res = env.http.post("/api/v1/agent/delegate", json={"agent": "Researcher", "goal": "g" * 20_001},
                        headers=headers)
    assert res.status_code == 422
    res = env.http.post("/api/v1/agent/delegate", json={"agent": "Researcher", "goal": ""}, headers=headers)
    assert res.status_code == 422
    res = env.http.post("/api/v1/agent/delegate",
                        json={"agent": "Researcher", "goal": "g", "context": "c" * 200_001}, headers=headers)
    assert res.status_code == 422
    res = env.http.post("/api/v1/agent/remote-call", json={"agent": "x", "message": ""}, headers=headers)
    assert res.status_code == 422
