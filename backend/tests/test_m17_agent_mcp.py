"""M17 T6: the "Object agent tools" MCP server (``objectapp.agent_mcp``) and
``GET /api/v1/agent/info``, scoped to one agent and one space."""

from __future__ import annotations

import asyncio
import json
import sys
import types
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mcp.server.mcpserver.exceptions import ToolError
from objectapp import agent_mcp
from objectapp.agentmodel import DEFAULT_AGENT_ID
from objectapp.agents import AgentRegistry
from objectapp.mcp_server import ApiError, ObjectClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore


def _app(root: Path) -> TestClient:
    space = Space(root)
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    return TestClient(app)


@pytest.fixture
def http(space_dir: Path) -> TestClient:
    return _app(space_dir)


def _call(server, name: str, **args):
    try:
        result = asyncio.run(server.call_tool(name, args))
    except ToolError as exc:
        raise ApiError(str(exc)) from exc
    if result.is_error:
        raise ApiError(" ".join(getattr(c, "text", "") for c in result.content))
    if result.structured_content is not None:
        out = result.structured_content
        return out.get("result", out) if set(out) == {"result"} else out
    return json.loads(result.content[0].text)


def _names(server) -> set[str]:
    return {t.name for t in asyncio.run(server.list_tools())}


def test_agent_info(http: TestClient, space_dir: Path) -> None:
    _record, secret = TokenStore(space_dir).ephemeral(
        "Assistant", "read-write", agent=DEFAULT_AGENT_ID, chat="01KAAAAAAAAAAAAAAAAAAAAAAA"
    )
    try:
        server = agent_mcp.build_server(ObjectClient("http://testserver", secret, http))
        info = _call(server, "agent_info")
    finally:
        TokenStore.drop_ephemeral(secret)
    folder = AgentRegistry().get(DEFAULT_AGENT_ID).folder
    assert info == {
        "agent": {"id": "assistant", "name": "Assistant", "model": None, "folder": str(folder)},
        "space": {"name": Space(space_dir).name},
    }


def test_agent_info_route_writes_nothing(http: TestClient, space_dir: Path) -> None:
    from objectapp.appstate import state_dir

    before = sorted(p.relative_to(state_dir()) for p in state_dir().rglob("*")) if state_dir().exists() else []
    _record, secret = TokenStore(space_dir).ephemeral("Assistant", "read", agent=DEFAULT_AGENT_ID)
    try:
        res = http.get("/api/v1/agent/info", headers={"Authorization": f"Bearer {secret}"})
    finally:
        TokenStore.drop_ephemeral(secret)
    assert res.status_code == 200
    after = sorted(p.relative_to(state_dir()) for p in state_dir().rglob("*")) if state_dir().exists() else []
    assert after == before


def test_token_without_agent_is_403(http: TestClient) -> None:
    secret = http.post("/api/integrations/tokens", json={"name": "mcp", "scope": "read-write"}).json()["secret"]
    res = http.get("/api/v1/agent/info", headers={"Authorization": f"Bearer {secret}"})
    assert res.status_code == 403
    assert res.json()["detail"] == "This token isn't an agent's."
    server = agent_mcp.build_server(ObjectClient("http://testserver", secret, http))
    with pytest.raises(ApiError, match="This token isn't an agent's."):
        _call(server, "agent_info")


def test_no_token_is_401(http: TestClient) -> None:
    assert http.get("/api/v1/agent/info").status_code == 401


def test_token_for_another_space_is_401(http: TestClient, tmp_path: Path) -> None:
    other = tmp_path / "other-space"
    other.mkdir()
    _record, secret = TokenStore(other).ephemeral("Assistant", "read-write", agent=DEFAULT_AGENT_ID)
    try:
        res = http.get("/api/v1/agent/info", headers={"Authorization": f"Bearer {secret}"})
    finally:
        TokenStore.drop_ephemeral(secret)
    assert res.status_code == 401


def test_unlisted_agent_is_404(http: TestClient, space_dir: Path) -> None:
    _record, secret = TokenStore(space_dir).ephemeral("Gone", "read", agent="01KAAAAAAAAAAAAAAAAAAAAAAA")
    try:
        res = http.get("/api/v1/agent/info", headers={"Authorization": f"Bearer {secret}"})
    finally:
        TokenStore.drop_ephemeral(secret)
    assert res.status_code == 404


def test_tool_modules_extend(http: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    mod = types.ModuleType("objectapp_test_agent_tools_ping")

    def register(server, client) -> None:
        @server.tool()
        def ping() -> str:
            """Answers pong."""
            return "pong"

    mod.register = register  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, mod.__name__, mod)
    monkeypatch.setattr(agent_mcp, "TOOL_MODULES", (*agent_mcp.TOOL_MODULES, mod.__name__))
    server = agent_mcp.build_server(ObjectClient("http://testserver", "x", http))
    assert _names(server) == {"agent_info", "ping"}
    assert server.name == "object-agent"


def test_default_tool_modules() -> None:
    # M18 and later milestones append their modules after M17's.
    assert agent_mcp.TOOL_MODULES[0] == "objectapp.agent_tools_core"


def test_main_refuses_non_loopback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OBJECT_API_URL", "http://example.org")
    monkeypatch.setenv("OBJECT_API_TOKEN", "obj_x")
    with pytest.raises(SystemExit):
        agent_mcp.main([])


def test_main_needs_a_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OBJECT_API_URL", "http://127.0.0.1:8790")
    monkeypatch.delenv("OBJECT_API_TOKEN", raising=False)
    with pytest.raises(SystemExit):
        agent_mcp.main([])
