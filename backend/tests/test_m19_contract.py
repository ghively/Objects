"""M19 Task 1: the MCP gateway contract (constants, the stored server model, ``ToolGroup.server``,
the stub router and resync kind) and the two fakes (the fake MCP server and the fake ``claude``'s
HTTP / SSE ``FAKE:mcp`` entries)."""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp import api_mcp, mcpgateway, mcpmodel, server, toolcatalog
from objectapp.mcpmodel import McpServerFile
from objectapp.space import Space
from objectapp.toolcatalog import ToolGroup
from objectapp.watcher import ChangeEvent

HERE = Path(__file__).resolve().parent
FAKE_CLAUDE = HERE / "fake_claude.py"
FAKE_MCP = HERE / "fake_mcp_server.py"
sys.path.insert(0, str(HERE))

import fake_mcp_server  # noqa: E402


def test_model_constants() -> None:
    for ok in ("github", "a_b-1", "x" * 64):
        assert re.fullmatch(mcpmodel.NAME_PATTERN, ok)
    for bad in ("my server", "a/b", "", "x" * 65):
        assert not re.fullmatch(mcpmodel.NAME_PATTERN, bad)
    assert mcpmodel.RESERVED_NAMES == ("object", "object-agent")
    assert mcpmodel.RESERVED_NAMES == (toolcatalog.OBJECT_SERVER, toolcatalog.AGENT_SERVER)
    assert mcpmodel.GATEWAY_PURPOSES[:3] == ("chat", "delegate", "schedule")
    assert mcpmodel.PROBE_TIMEOUT_S == 20
    assert mcpmodel.SERVERS_FILE == "mcp-servers.json" and mcpmodel.SECRETS_FILE == "secrets.json"
    assert mcpmodel.ENV_PREFIX == "OBJECT_MCP_"


def test_server_file_keeps_unknown_keys() -> None:
    data = {
        "id": "01JC7ZK3T9Q4M2X8B5N6R1V0WE", "name": "github", "kind": "command", "command": "npx",
        "args": ["-y", "x"], "env": [{"key": "API_KEY", "secret": True, "note": "kept"}],
        "createdAt": "2026-11-05T09:00:00.000Z", "updatedAt": "2026-11-05T09:00:00.000Z", "extra": [1],
    }
    out = McpServerFile.model_validate(data).model_dump()
    assert out["extra"] == [1]
    assert out["env"][0]["note"] == "kept" and out["env"][0]["value"] is None
    assert out["enabled"] is True and out["bearer"] is False and out["headers"] == []


def test_tool_group_server_field() -> None:
    out = toolcatalog.groups_out([ToolGroup("mcp:x", "x", (), server={"status": "ok"})], [])
    assert out[0]["server"] == {"status": "ok"}
    plain = toolcatalog.groups_out([ToolGroup("builtin", "b", toolcatalog.BUILTINS)], [])
    assert plain[0]["server"] is None


def test_stub_router_mounted_and_resync(space_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    mounted: list[str] = []
    real_router = api_mcp.router

    def counting_router(*args, **kwargs):
        mounted.append("mcp")
        return real_router(*args, **kwargs)

    monkeypatch.setattr(mcpgateway, "install", lambda: calls.append("install"))
    monkeypatch.setattr(api_mcp, "router", counting_router)
    app = server.create_app(Space(space_dir), None, watch=False)
    app.state.hub.publish = lambda _e: None
    assert calls == ["install"] and mounted == ["mcp"]
    assert TestClient(app).get("/api/agents").status_code == 200
    assert "mcpServers" in [e.kind for e in server.RESYNC_EVENTS]
    assert server.RESYNC_EVENTS[-1] == ChangeEvent("mcpServers", "*", None)
    assert ChangeEvent("mcpServers", "secrets", None).kind == "mcpServers"


# -- the fake MCP server ---------------------------------------------------------------------------


async def _list_stdio(args: list[str], env: dict[str, str] | None = None) -> list[str]:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(command=sys.executable, args=[str(FAKE_MCP), *args],
                                   env={**os.environ, **(env or {})})
    with open(os.devnull, "w", encoding="utf-8") as devnull:
        async with stdio_client(params, errlog=devnull) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                return sorted(t.name for t in (await session.list_tools()).tools)


async def _list_http(url: str, headers: dict[str, str]) -> list[str]:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from mcp.shared._httpx_utils import create_mcp_http_client

    async with create_mcp_http_client(headers=headers) as http:
        async with streamable_http_client(url, http_client=http) as streams:
            async with ClientSession(streams[0], streams[1]) as session:
                await session.initialize()
                return sorted(t.name for t in (await session.list_tools()).tools)


def test_fake_mcp_server_modes() -> None:
    assert asyncio.run(_list_stdio([])) == ["add", "echo", "whoami"]
    assert asyncio.run(_list_stdio(["--odd-name"])) == ["add", "echo", "get-item.v2", "whoami"]
    assert asyncio.run(_list_stdio(["--many", "3"])) == ["t0", "t1", "t2"]
    res = subprocess.run([sys.executable, str(FAKE_MCP), "--require-env", "FAKE_NOT_SET_X"],
                         capture_output=True, text=True, timeout=30,
                         env={k: v for k, v in os.environ.items() if k != "FAKE_NOT_SET_X"})
    assert res.returncode == 3 and "missing FAKE_NOT_SET_X" in res.stderr

    import httpx

    url, stop = fake_mcp_server.serve_in_thread("http", require_bearer="s3cret-http")
    try:
        assert url.startswith("http://127.0.0.1:") and url.endswith("/mcp")
        assert asyncio.run(_list_http(url, {"Authorization": "Bearer s3cret-http"})) == ["add", "echo", "whoami"]
        refused = httpx.post(url, json={}, headers={"Authorization": "Bearer wrong"})
        assert refused.status_code == 401 and "Bearer wrong" in refused.text
        assert httpx.post(url, json={}).status_code == 401
    finally:
        stop()


# -- the fake claude's FAKE:mcp marker --------------------------------------------------------------


def _fake(args: list[str], prompt: str, tmp: Path, env: dict[str, str]) -> tuple[list[dict], dict]:
    log = tmp / f"log-{uuid.uuid4().hex}.jsonl"
    run_env = {**os.environ, "FAKE_CLAUDE_LOG": str(log), **env}
    res = subprocess.run([sys.executable, str(FAKE_CLAUDE), *args], input=prompt, capture_output=True,
                         text=True, encoding="utf-8", env=run_env, cwd=tmp, timeout=90)
    events = [json.loads(line) for line in res.stdout.splitlines() if line.strip()]
    entry = json.loads(log.read_text(encoding="utf-8").splitlines()[-1])
    return events, entry


def _results(events: list[dict]) -> list[dict]:
    return [b for e in events if e.get("type") == "user" for b in e["message"]["content"]]


def _text(block: dict) -> str:
    content = block.get("content")
    if isinstance(content, list):
        return "".join(c.get("text", "") for c in content)
    return str(content)


def test_fake_claude_mcp_marker(tmp_path: Path) -> None:
    secret = "s3cret-stdio"
    config = tmp_path / "mcp.json"
    config.write_text(json.dumps({"mcpServers": {"fake": {
        "type": "stdio", "command": sys.executable,
        "args": [str(FAKE_MCP), "--require-env", "FAKE_KEY"],
        "env": {"FAKE_KEY": "${OBJECT_MCP_TEST}"},
    }}}), encoding="utf-8")
    env = {"OBJECT_MCP_TEST": secret}
    events, entry = _fake(["-p", "--mcp-config", str(config), "--allowedTools", "mcp__fake"],
                          "FAKE:mcp:fake:whoami", tmp_path, env)
    results = _results(events)
    assert results and not results[0].get("is_error")
    assert _text(results[0]) == secret
    assert entry["mcpServers"] == ["fake"]

    events, _entry = _fake(["-p", "--mcp-config", str(config), "--allowedTools", "mcp__fake",
                            "--disallowedTools", "mcp__fake__whoami"], "FAKE:mcp:fake:whoami", tmp_path, env)
    results = _results(events)
    assert results[0]["is_error"] is True
    assert results[0]["content"] == "Permission to use mcp__fake__whoami has been denied."

    # ${VAR:-default}: the default when the variable is unset.
    config.write_text(json.dumps({"mcpServers": {"fake": {
        "type": "stdio", "command": sys.executable,
        "args": [str(FAKE_MCP), "--require-env", "FAKE_KEY"],
        "env": {"FAKE_KEY": "${OBJECT_MCP_UNSET_X:-fallback-value}"},
    }}}), encoding="utf-8")
    events, _entry = _fake(["-p", "--mcp-config", str(config), "--allowedTools", "mcp__fake"],
                           "FAKE:mcp:fake:whoami", tmp_path, {})
    assert _text(_results(events)[0]) == "fallback-value"

    for mode in ("http", "sse"):
        url, stop = fake_mcp_server.serve_in_thread(mode, require_bearer=secret)
        try:
            config.write_text(json.dumps({"mcpServers": {
                "remote": {"type": mode, "url": url, "headers": {"Authorization": "Bearer ${OBJECT_MCP_TEST}"}},
                "other": {"type": "stdio", "command": sys.executable, "args": [str(FAKE_MCP)]},
            }}), encoding="utf-8")
            events, entry = _fake(["-p", "--mcp-config", str(config), "--allowedTools", "mcp__remote"],
                                  'FAKE:mcp:remote:add:{"a":2,"b":3}', tmp_path, env)
            results = _results(events)
            assert results and not results[0].get("is_error"), (mode, results)
            assert _text(results[0]) == "5"
            assert entry["mcpServers"] == ["other", "remote"]
        finally:
            stop()
