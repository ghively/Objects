"""M20 Task 1: the A2A and delegation contract (constants, the remote ``agent.json`` model, the URL
and auth rules, the three agent tools, the stub routers and ``delegation.install()``) and the two
fakes (the fake A2A agent and the fake ``claude``'s ``FAKE:long`` / ``FAKE:echo-env``)."""

from __future__ import annotations

import ast
import asyncio
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from objectapp import (
    agent_mcp,
    ai,
    api_agent_a2a_v1,
    api_remote_agents,
    delegation,
    remotemodel,
    server,
    toolcatalog,
)
from objectapp.agentmodel import AgentInvalid
from objectapp.remotemodel import AuthInput, RemoteAgentFile, card_url_for, clean_auth
from objectapp.space import Space

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent / "objectapp"
sys.path.insert(0, str(HERE))

import fake_a2a  # noqa: E402
import fake_claude  # noqa: E402


def test_constants() -> None:
    assert remotemodel.DELEGATE_SUMMARY_CAP == 24_000
    assert remotemodel.DELEGATE_MAX_AT_ONCE == 3
    assert remotemodel.DELEGATE_TIMEOUT < ai.TURN_TIMEOUT
    assert remotemodel.REMOTE_CALL_TIMEOUT <= remotemodel.REMOTE_CALL_TIMEOUT_MAX < ai.TURN_TIMEOUT
    assert remotemodel.A2A_VERSION == "1.0"
    assert remotemodel.CARD_PATH == "/.well-known/agent-card.json"
    assert remotemodel.SECRET_KEY.format(agent_id="X1") == "a2a:X1"
    assert remotemodel.REMOTE_KIND == "remote" and remotemodel.REMOTE_ICON == "ph-globe"
    assert remotemodel.OUTPUT_MODES == ("text/plain", "text/markdown", "application/json")


def test_card_url_for() -> None:
    assert card_url_for("https://h.example/a/agent-card.json") == "https://h.example/a/agent-card.json"
    assert card_url_for("https://h.example:8443/a2a") == "https://h.example:8443/.well-known/agent-card.json"
    assert card_url_for("http://127.0.0.1:8799") == "http://127.0.0.1:8799/.well-known/agent-card.json"
    for bad in ("ftp://h", "javascript:alert(1)", "", "h.example"):
        with pytest.raises(AgentInvalid) as e:
            card_url_for(bad)
        assert str(e.value) == "That isn't an http or https address."


def test_clean_auth() -> None:
    ok = clean_auth(AuthInput(kind="header", headerName="X-Api-Key", value="v1"))
    assert (ok.kind, ok.headerName, ok.value) == ("header", "X-Api-Key", "v1")
    for name in ("Host", "a b", "x" * 65):
        with pytest.raises(AgentInvalid):
            clean_auth(AuthInput(kind="header", headerName=name, value="v1"))
    with pytest.raises(AgentInvalid):
        clean_auth(AuthInput(kind="header", headerName="X-Api-Key", value="a\r\nb"))
    with pytest.raises(AgentInvalid):
        clean_auth(AuthInput(kind="bearer", value="a\nb"))
    with pytest.raises(AgentInvalid):
        clean_auth(AuthInput(kind="bearer"))
    with pytest.raises(AgentInvalid):
        clean_auth(AuthInput(kind="bearer", value=""))
    bearer = clean_auth(AuthInput(kind="bearer", headerName="X-Ignored", value="tok"))
    assert (bearer.kind, bearer.headerName, bearer.value) == ("bearer", None, "tok")
    none = clean_auth(AuthInput(kind="none", headerName="X-Api-Key", value="dropped"))
    assert (none.kind, none.headerName, none.value) == ("none", None, None)


def _remote_file(**extra: Any) -> dict[str, Any]:
    return {
        "schemaVersion": 1, "kind": "remote", "id": "01JC7ZK3T9Q4M2X8B5N6R1V0WE", "name": "Travel Planner",
        "icon": "ph-globe", "color": None, "cardUrl": "https://agents.example.com/.well-known/agent-card.json",
        "endpoint": {"url": "https://agents.example.com/a2a/v1", "protocolVersion": "1.0", "binding": "JSONRPC"},
        "streaming": True, "auth": {"kind": "bearer", "headerName": None}, "contextNoticeAt": None,
        "cardFetchedAt": "2026-11-05T09:00:00.000Z", "createdAt": "2026-11-05T09:00:00.000Z",
        "updatedAt": "2026-11-05T09:00:00.000Z", **extra,
    }


def test_remote_agent_file_keeps_unknown_keys() -> None:
    out = RemoteAgentFile.model_validate(_remote_file(x=1)).model_dump()
    assert out["x"] == 1
    assert out["auth"] == {"kind": "bearer", "headerName": None}
    assert out["endpoint"]["binding"] == "JSONRPC"


def test_agent_tools_registered() -> None:
    tools = toolcatalog.AGENT_TOOLS
    at = tools.index("session_search")
    assert tools[at + 1:at + 4] == ("remote_agents_list", "remote_agent_call", "delegate")
    group = next(g for g in toolcatalog.catalogue() if g.id == "object-agent")
    rows = {t.id: t for t in group.tools}
    labels = {
        "remote_agents_list": "List remote agents",
        "remote_agent_call": "Call a remote agent",
        "delegate": "Delegate to another agent",
    }
    for name, label in labels.items():
        row = rows[f"mcp__object-agent__{name}"]
        assert row.label == label and row.default_on
    assert "objectapp.agent_tools_a2a" in agent_mcp.TOOL_MODULES


def test_stub_routers_mounted(space_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    mounted: list[str] = []
    real_remote, real_v1 = api_remote_agents.router, api_agent_a2a_v1.router

    def remote_router(*args: Any, **kwargs: Any) -> Any:
        mounted.append("remote-agents")
        return real_remote(*args, **kwargs)

    def v1_router(*args: Any, **kwargs: Any) -> Any:
        mounted.append("agent-a2a-v1")
        return real_v1(*args, **kwargs)

    monkeypatch.setattr(delegation, "install", lambda: calls.append("install"))
    monkeypatch.setattr(api_remote_agents, "router", remote_router)
    monkeypatch.setattr(api_agent_a2a_v1, "router", v1_router)
    app = server.create_app(Space(space_dir), None, watch=False)
    app.state.hub.publish = lambda _e: None
    assert calls == ["install"]
    assert sorted(mounted) == ["agent-a2a-v1", "remote-agents"]
    assert TestClient(app).get("/api/agents").status_code == 200


def test_delegation_install_is_idempotent() -> None:
    delegation.install()
    delegation.install()


# -- the fake A2A agent ---------------------------------------------------------------------------


def _no_kind(value: Any) -> bool:
    """True when no dict inside `value` that looks like a Part carries a ``kind`` key."""
    if isinstance(value, dict):
        if "kind" in value and ({"text", "raw", "url", "data"} & set(value)):
            return False
        return all(_no_kind(v) for v in value.values())
    if isinstance(value, list):
        return all(_no_kind(v) for v in value)
    return True


def _rpc(method: str, params: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": "1", "method": method, "params": params}


def _send_params(text: str, **message: Any) -> dict[str, Any]:
    return {"message": {"messageId": "m1", "role": "ROLE_USER", "parts": [{"text": text}], **message},
            "configuration": {"acceptedOutputModes": list(remotemodel.OUTPUT_MODES), "returnImmediately": False}}


def test_fake_a2a_card_and_echo() -> None:
    fake = fake_a2a.FakeA2A(token="t")
    base = fake.start()
    try:
        assert base.startswith("http://127.0.0.1:")
        auth = {"Authorization": "Bearer t", "A2A-Version": "1.0"}
        card = httpx.get(base + remotemodel.CARD_PATH, headers=auth).json()
        assert card["supportedInterfaces"][0] == {"url": base + "/a2a", "protocolBinding": "JSONRPC",
                                                  "protocolVersion": "1.0"}
        assert card["capabilities"]["streaming"] is True
        assert httpx.post(base + "/a2a", json=_rpc("SendMessage", _send_params("hi"))).status_code == 401
        res = httpx.post(base + "/a2a", json=_rpc("SendMessage", _send_params("hi")), headers=auth).json()
        task = res["result"]["task"]
        assert task["status"]["state"] == "TASK_STATE_COMPLETED"
        text = task["artifacts"][0]["parts"][0]["text"]
        assert text.startswith("Echo: hi\nctx=") and text.endswith(" task=-")
        assert set(res["result"]) == {"task"}
        # The context is kept; the second line names it.
        again = httpx.post(base + "/a2a", json=_rpc("SendMessage", _send_params("x", contextId=task["contextId"])),
                           headers=auth).json()
        assert again["result"]["task"]["contextId"] == task["contextId"]
        # Input required, then the task completes.
        ask = httpx.post(base + "/a2a", json=_rpc("SendMessage", _send_params("A2A:input")), headers=auth).json()
        asked = ask["result"]["task"]
        assert asked["status"]["state"] == "TASK_STATE_INPUT_REQUIRED"
        assert asked["status"]["message"]["parts"] == [{"text": "Which date?"}]
        done = httpx.post(base + "/a2a", json=_rpc("SendMessage", _send_params(
            "Friday", contextId=asked["contextId"], taskId=asked["id"])), headers=auth).json()
        assert done["result"]["task"]["artifacts"][0]["parts"][0]["text"] == "Booked for Friday"
        unknown = httpx.post(base + "/a2a", json=_rpc("SendMessage", _send_params("x", taskId="nope")),
                             headers=auth).json()
        assert unknown["error"]["code"] == -32001
        # Artifacts and states.
        answers = [res, again, ask, done]
        for marker in ("A2A:file", "A2A:url", "A2A:data", "A2A:fail", "A2A:reject", "A2A:auth"):
            answers.append(httpx.post(base + "/a2a", json=_rpc("SendMessage", _send_params(marker)),
                                      headers=auth).json())
        raw_part = answers[4]["result"]["task"]["artifacts"][0]["parts"][0]
        assert (raw_part["filename"], raw_part["mediaType"], raw_part["raw"]) == ("plan.md", "text/markdown", "IyBQbGFu")
        assert answers[5]["result"]["task"]["artifacts"][0]["parts"][0]["url"] == "https://example.org/x.pdf"
        assert answers[6]["result"]["task"]["artifacts"][0]["parts"][0]["data"] == {"rooms": 2}
        assert [a["result"]["task"]["status"]["state"] for a in answers[7:]] == [
            "TASK_STATE_FAILED", "TASK_STATE_REJECTED", "TASK_STATE_AUTH_REQUIRED"]
        # Streaming: task, two artifact chunks, the final status.
        with httpx.stream("POST", base + "/a2a", json=_rpc("SendStreamingMessage", _send_params("hi")),
                          headers={**auth, "Accept": "text/event-stream"}) as stream:
            events = [line[len("data: "):] for line in stream.iter_lines() if line.startswith("data: ")]
        import json

        results = [json.loads(e)["result"] for e in events]
        assert [next(iter(r)) for r in results] == ["task", "artifactUpdate", "artifactUpdate", "statusUpdate"]
        assert results[2]["artifactUpdate"]["append"] is True
        chunks = "".join(r["artifactUpdate"]["artifact"]["parts"][0]["text"] for r in results[1:3])
        assert chunks.startswith("Echo: hi\nctx=")
        assert results[3]["statusUpdate"]["status"]["state"] == "TASK_STATE_COMPLETED"
        answers.append({"stream": results})
        # Cancel.
        slow = httpx.post(base + "/a2a", json=_rpc("SendMessage", _send_params("A2A:slow:5")), headers=auth).json()
        slow_task = slow["result"]["task"]
        assert slow_task["status"]["state"] == "TASK_STATE_WORKING"
        canceled = httpx.post(base + "/a2a", json=_rpc("CancelTask", {"id": slow_task["id"]}), headers=auth).json()
        assert canceled["result"]["status"]["state"] == "TASK_STATE_CANCELED"
        got = httpx.post(base + "/a2a", json=_rpc("GetTask", {"id": slow_task["id"], "historyLength": 0}),
                         headers=auth).json()
        assert got["result"]["status"]["state"] == "TASK_STATE_CANCELED"
        assert _no_kind(answers)
        logged = [r["rpc"] for r in fake.requests if r["rpc"]]
        assert "CancelTask" in logged and "SendStreamingMessage" in logged
        assert any(r["headers"].get("Authorization") == "Bearer t" for r in fake.requests)
    finally:
        fake.stop()


def test_fake_a2a_overrides_and_header_auth(tmp_path: Path) -> None:
    log = tmp_path / "a2a.jsonl"
    fake = fake_a2a.FakeA2A(header=("X-Api-Key", "k1"), streaming=False, card_version="0.3.0", log=log)
    base = fake.start()
    try:
        assert httpx.get(base + remotemodel.CARD_PATH).status_code == 401
        card = httpx.get(base + remotemodel.CARD_PATH, headers={"X-Api-Key": "k1"}).json()
        assert "supportedInterfaces" not in card and card["protocolVersion"] == "0.3.0"
        assert card["capabilities"]["streaming"] is False
        fake.card_override = {"name": 3}
        assert httpx.get(base + remotemodel.CARD_PATH, headers={"X-Api-Key": "k1"}).json() == {"name": 3}
        fake.raw_override = lambda method: (502, {"Content-Type": "text/html"}, b"<html>Bad gateway</html>")
        res = httpx.post(base + "/a2a", json=_rpc("SendMessage", _send_params("hi")), headers={"X-Api-Key": "k1"})
        assert res.status_code == 502 and res.text == "<html>Bad gateway</html>"
        assert len(log.read_text(encoding="utf-8").splitlines()) == len(fake.requests) == 4
    finally:
        fake.stop()


# -- the fake claude ------------------------------------------------------------------------------


def _run_fake(tmp_path: Path, prompt: str, env: dict[str, str] | None = None) -> list[dict[str, Any]]:
    from objectapp.agentrun import RunCommand

    claude = fake_claude.install(tmp_path / "bin")

    def run(resume: str | None) -> RunCommand:
        tmp = Path(tempfile.mkdtemp(prefix="object-test-run-"))
        args = [str(claude), "-p", "--output-format", "stream-json"]
        return RunCommand(args=args, cwd=tmp_path, env={**os.environ, **(env or {})}, tmp=tmp, mcp_config={},
                          run_settings={}, append="")

    turn = ai.Turn(run=run, claude=str(claude), mode="chat", prompt_resume=None, prompt_fresh=prompt,
                   session_id=None, model=None, api_url="http://127.0.0.1:9", token="obj_x")

    async def go() -> list[dict[str, Any]]:
        return [e async for e in ai.run_turn(turn)]

    return asyncio.run(go())


def test_fake_claude_long(tmp_path: Path) -> None:
    events = _run_fake(tmp_path, "FAKE:long:30000")
    done = events[-1]
    assert done["type"] == "done"
    assert len(done["text"]) == 30_000


def test_fake_claude_echo_env(tmp_path: Path) -> None:
    events = _run_fake(tmp_path, "FAKE:echo-env", {"MCP_TOOL_TIMEOUT": "300000"})
    assert events[-1]["type"] == "done" and events[-1]["text"] == "MCP_TOOL_TIMEOUT=300000"


# -- no network client ----------------------------------------------------------------------------

M20_MODULES = ("remotemodel", "remotesecrets", "remotechat", "delegation", "headless", "api_remote_agents",
               "api_agent_a2a_v1")


@pytest.mark.parametrize("module", M20_MODULES)
def test_ai_modules_use_no_network_client_m20(module: str) -> None:
    path = BACKEND / f"{module}.py"
    if not path.exists():
        pytest.skip(f"{module}.py is made by a later M20 task")
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module)
            names |= {f"{node.module}.{a.name}" for a in node.names}
    banned = ("httpx", "requests", "urllib.request", "socket", "http.client")
    hits = {n for n in names for b in banned if n == b or n.startswith(b + ".")}
    assert not hits, hits
