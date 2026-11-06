"""M20 Task 6: delegation (``delegation``, ``headless``) and its route ``/api/v1/agent/delegate``,
run with the fake ``claude``.

``OBJECT_STATE_DIR`` is a temp folder (conftest). The space is a copy of ``space-sample``. The
caller's turn token is minted the way M17's chat route does; requests go to ``/api/v1/agent/*``
with it, as the MCP tool would send them.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import socket
import sys
import threading
import time
import types
from pathlib import Path
from typing import Any

import httpx
import pytest
import uvicorn
from fake_claude import install
from fastapi.testclient import TestClient
from mcp.server.mcpserver.exceptions import ToolError

from objectapp import a2a, agent_mcp, agentrun, ai, delegation, headless, transcripts
from objectapp import settings as device_settings
from objectapp.agentmodel import DEFAULT_AGENT_ID, AgentInput
from objectapp.agents import AgentRegistry
from objectapp.appstate import state_dir
from objectapp.learningmodel import MEMORY_FILE
from objectapp.mcp_server import ApiError, ObjectClient
from objectapp.remotemodel import DELEGATE_SUMMARY_CAP, DELEGATE_TIMEOUT, AuthInput
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import Registry
from objectapp.tokens import TokenStore

CALLER_CHAT = "01KAAAAAAAAAAAAAAAAAAAAAAA"
OTHER_CHAT = "01KBBBBBBBBBBBBBBBBBBBBBBB"
DELEGATE = "mcp__object-agent__delegate"
REMOTE_CALL = "mcp__object-agent__remote_agent_call"
REMOTE_LIST = "mcp__object-agent__remote_agents_list"


def _set(**patch) -> None:
    _data, revision = device_settings.read()
    device_settings.patch(patch, revision)


@pytest.fixture
def fake(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict:
    path = install(tmp_path / "bin")
    log = tmp_path / "claude-log.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    _set(claudePath=str(path))
    return {"path": path, "log": log, "go": Path(str(log) + ".go")}


@pytest.fixture
def tokens_made(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """Every ephemeral token asked for (name, scope and the keyword stamps)."""
    made: list[dict] = []
    real = TokenStore.ephemeral

    def spy(self, name, scope="read", **kw):
        made.append({"name": name, "scope": scope, **kw})
        return real(self, name, scope, **kw)

    monkeypatch.setattr(TokenStore, "ephemeral", spy)
    return made


def _runs(log: Path) -> list[dict]:
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line]


def _wait_runs(log: Path, count: int, timeout: float = 30) -> list[dict]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        runs = _runs(log)
        if len(runs) >= count:
            return runs
        time.sleep(0.05)
    raise AssertionError(f"expected {count} runs, saw {len(_runs(log))}")


def _alive(pid: int) -> bool:
    if os.name == "nt":  # pragma: no cover - Windows
        import subprocess

        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True, check=False)
        return str(pid) in out.stdout
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
        return stat.split(")")[-1].split()[0] != "Z"
    except OSError:
        return True


def _gone(pid: int, within: float) -> bool:
    deadline = time.monotonic() + within
    while time.monotonic() < deadline:
        if not _alive(pid):
            return True
        time.sleep(0.1)
    return not _alive(pid)


def _hashes(folder: Path) -> dict[str, str]:
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*")) if p.is_file()}


def _md_files(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*.md")}


def card_raw(name: str = "Fake Planner") -> dict[str, Any]:
    return {
        "name": name,
        "description": "Plans synthetic trips.",
        "supportedInterfaces": [{"url": "http://127.0.0.1:9/a2a", "protocolBinding": "JSONRPC",
                                 "protocolVersion": "1.0"}],
        "capabilities": {"streaming": True},
        "skills": [],
    }


def add_remote(name: str = "Fake Planner"):
    raw = card_raw(name)
    return AgentRegistry().create_remote(a2a.parse_card(raw), raw, "http://127.0.0.1:9/.well-known/agent-card.json",
                                         AuthInput(kind="bearer", value="tok-1"))


def patch_call_remote(monkeypatch: pytest.MonkeyPatch, answer: Any) -> list[dict[str, Any]]:
    """Replace ``remotechat.call_remote`` with a double that records its arguments."""
    calls: list[dict[str, Any]] = []

    async def fake_call(record, text, **kw):
        calls.append({"record": record, "text": text, **kw})
        return answer

    try:
        from objectapp import remotechat
    except ImportError:  # until M20 Task 4 lands
        import objectapp

        mod = types.ModuleType("objectapp.remotechat")
        mod.call_remote = fake_call  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "objectapp.remotechat", mod)
        monkeypatch.setattr(objectapp, "remotechat", mod, raising=False)
    else:
        monkeypatch.setattr(remotechat, "call_remote", fake_call)
    return calls


class Env:
    def __init__(self, space_dir: Path, fake: dict) -> None:
        self.space_dir = space_dir
        self.fake = fake
        self.app = create_app(Space(space_dir), None, watch=False)
        self.events: list = []
        self.app.state.hub.publish = self.events.append
        self.http = TestClient(self.app)
        self.http.__enter__()
        self.registry = AgentRegistry()
        self.researcher = self.registry.create(AgentInput(name="Researcher"), "Find things.\n")
        self.secrets: list[str] = []
        self.caller, self.secret = self.token()

    def token(self, chat: str = CALLER_CHAT) -> tuple:
        record, secret = TokenStore(self.space_dir).ephemeral(
            "Assistant", "read-write", agent=DEFAULT_AGENT_ID, chat=chat
        )
        self.secrets.append(secret)
        return record, secret

    def post(self, route: str, body: dict, secret: str | None = None) -> httpx.Response:
        return self.http.post(f"/api/v1/agent/{route}", json=body,
                              headers={"Authorization": f"Bearer {secret or self.secret}"})

    def delegate(self, agent: str = "researcher", goal: str = "Find rack notes", secret: str | None = None,
                 **body) -> httpx.Response:
        return self.post("delegate", {"agent": agent, "goal": goal, **body}, secret)

    def close(self) -> None:
        for s in self.secrets:
            TokenStore.drop_ephemeral(s)
        self.http.__exit__(None, None, None)


@pytest.fixture
def env(space_dir: Path, fake: dict):
    e = Env(space_dir, fake)
    try:
        yield e
    finally:
        e.fake["go"].touch()  # nothing waits past a test
        e.close()


def _in_thread(fn, *args, **kw) -> tuple[threading.Thread, list]:
    out: list = []
    t = threading.Thread(target=lambda: out.append(fn(*args, **kw)), daemon=True)
    t.start()
    return t, out


def _wait_events(env: Env, kind: str, timeout: float = 3) -> list:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        got = [e for e in env.events if e.kind == kind]
        if got:
            return got
        time.sleep(0.02)
    return [e for e in env.events if e.kind == kind]


# -- delegating to a local agent ----------------------------------------------------------------------


def test_delegate_to_a_local_agent(env: Env, tokens_made: list[dict]) -> None:
    res = env.delegate(context="Gene asked")
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["agent"] == {"id": env.researcher.id, "name": "Researcher", "kind": "local"}
    assert out["state"] == "completed" and out["cut"] is False
    assert out["summary"] == "Hello from the fake claude."
    assert transcripts.path_for(env.researcher.folder, out["chatId"]).is_file()
    [run] = _runs(env.fake["log"])
    assert Path(run["cwd"]).resolve() == Path(env.researcher.folder).resolve()
    expected = delegation.delegate_prompt("Assistant", "Find rack notes", "Gene asked")
    assert expected in run["prompt"]
    assert "Goal: Find rack notes" in run["prompt"] and "Context from Assistant:\nGene asked" in run["prompt"]
    assert "at most 24,000 characters" in run["prompt"]
    [made] = [t for t in tokens_made if t.get("purpose") == "delegate"]
    assert made["scope"] == "read-write" and made["agent"] == env.researcher.id
    assert made["chat"] == out["chatId"]
    assert TokenStore(env.space_dir).verify(run["token"]) is None  # dropped after the run
    items = transcripts.read(env.researcher.folder, out["chatId"])["items"]
    assert [i["type"] for i in items] == ["user", "assistant"]  # no review line


def test_delegate_prompt_without_context() -> None:
    text = delegation.delegate_prompt("Assistant", "Do X", "")
    assert "Context from" not in text
    assert text == (
        "Assistant, another agent working for the same person, has handed you this task.\n\nGoal: Do X\n\n"
        "Do it with your own tools. When you are done, reply with a summary for Assistant of what you did "
        "and found, at most 24,000 characters."
    )


def test_delegated_chat_is_kept_and_marked(env: Env) -> None:
    before = _md_files(env.space_dir)
    out = env.delegate().json()
    chat_id = out["chatId"]
    header = json.loads(transcripts.path_for(env.researcher.folder, chat_id).read_text(encoding="utf-8")
                        .splitlines()[0])
    assert header["delegated"] is True and header["from"] == DEFAULT_AGENT_ID
    assert header["fromChat"] == CALLER_CHAT
    listed = env.http.get(f"/api/agents/{env.researcher.id}/chats").json()
    chats = listed["chats"] if isinstance(listed, dict) else listed
    [summary] = [c for c in chats if c["id"] == chat_id]
    assert summary["delegated"] is True and summary["from"] == DEFAULT_AGENT_ID
    events = _wait_events(env, "agentChats")
    assert any(e.path == env.researcher.id and e.version == chat_id for e in events)
    assert _md_files(env.space_dir) == before  # no AI Chat object written


def test_summary_capped_at_24000(env: Env) -> None:
    out = env.delegate(goal="FAKE:long:30000").json()
    assert out["cut"] is True and out["state"] == "completed"
    assert len(out["summary"]) == DELEGATE_SUMMARY_CAP + 1 and out["summary"].endswith("…")
    items = transcripts.read(env.researcher.folder, out["chatId"])["items"]
    assert len(items[-1]["text"]) == 30_000


# -- the flat rule --------------------------------------------------------------------------------


def test_delegated_run_cannot_delegate(env: Env) -> None:
    t, out = _in_thread(env.delegate, goal="FAKE:wait")
    [run] = _wait_runs(env.fake["log"], 1)
    assert DELEGATE in run["disallowed"] and REMOTE_CALL in run["disallowed"]
    assert DELEGATE not in run["allowed"] and REMOTE_CALL not in run["allowed"]
    assert REMOTE_LIST in run["allowed"]
    token = run["token"]
    for route, body in (("delegate", {"agent": "Assistant", "goal": "more"}),
                        ("remote-call", {"agent": "Fake Planner", "message": "hi"})):
        res = env.post(route, body, token)
        assert res.status_code == 403, res.text
        assert res.json()["detail"] == "A delegated agent can't delegate further."
    env.fake["go"].touch()
    t.join(60)
    assert out[0].status_code == 200 and out[0].json()["state"] == "completed"
    assert delegation.DELEGATED_CHATS == set()


def test_non_delegated_runs_keep_the_tools(env: Env) -> None:
    body = {"mode": "chat", "prompt": "FAKE:echo-env", "contextPaths": [], "history": []}
    res = env.http.post("/api/ai/chat", json=body)
    assert res.status_code == 200
    assert "MCP_TOOL_TIMEOUT=300000" in res.text
    [run] = _runs(env.fake["log"])
    assert {DELEGATE, REMOTE_CALL, REMOTE_LIST} <= set(run["allowed"])
    assert DELEGATE not in run["disallowed"]


def test_fourth_delegation_at_once_is_refused(env: Env) -> None:
    threads = [_in_thread(env.delegate, goal="FAKE:wait") for _ in range(3)]
    _wait_runs(env.fake["log"], 3)
    res = env.delegate(goal="One more")
    assert res.status_code == 429 and res.json()["detail"] == "At most 3 delegations at once per turn."
    # another turn's token isn't limited by the first one's three
    _other, other_secret = env.token(OTHER_CHAT)
    res = env.delegate(goal="Elsewhere", secret=other_secret)
    assert res.status_code == 200 and res.json()["state"] == "completed"
    env.fake["go"].touch()
    for t, out in threads:
        t.join(60)
        assert out[0].status_code == 200 and out[0].json()["state"] == "completed"
    res = env.delegate(goal="After them")
    assert res.status_code == 200 and res.json()["state"] == "completed"
    assert delegation.LIMITER.in_flight(env.caller.id) == 0


def test_self_and_unknown_targets(env: Env, tmp_path: Path) -> None:
    res = env.delegate(agent="Assistant")
    assert res.status_code == 422 and res.json()["detail"] == "An agent can't delegate to itself."
    res = env.delegate(agent="nobody")
    assert res.status_code == 404 and res.json()["detail"] == "No agent named nobody."
    (tmp_path / "ext").mkdir()
    gone = env.registry.create(AgentInput(name="Gone"), "x", location=tmp_path / "ext")
    import shutil

    shutil.rmtree(gone.folder)
    res = env.delegate(agent="Gone")
    assert res.status_code == 409
    assert res.json()["detail"] == f"Gone can't run: This agent's folder is missing: {gone.folder}"
    locked = env.registry.create(AgentInput(name="Locked"), "x")
    (Path(locked.folder) / ".object-agent" / "agent.json").write_text("{", encoding="utf-8")
    res = env.delegate(agent="Locked")
    assert res.status_code == 409
    assert res.json()["detail"] == "Locked can't run: This agent's settings can't be read."
    (tmp_path / "holder").mkdir()
    holder = env.registry.create(AgentInput(name="Holder"), "x", location=tmp_path / "holder")
    inner = Path(holder.folder) / "notes"
    inner.mkdir()
    Registry(state_dir()).register(inner)
    res = env.delegate(agent="Holder")
    assert res.status_code == 409
    assert res.json()["detail"] == "Holder can't run: An agent folder can't be inside a space folder or hold one."
    assert transcripts.list_chats(Path(holder.folder)) == []
    assert _runs(env.fake["log"]) == []
    assert delegation.LIMITER.in_flight(env.caller.id) == 0


# -- timeouts and the caller going away -----------------------------------------------------------


def test_timeout_stops_the_delegated_run(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(delegation, "DELEGATE_TIMEOUT", 1)
    res = env.delegate(goal="FAKE:sleep")
    assert res.status_code == 504
    assert res.json()["detail"] == "Researcher didn't finish within 1 seconds; its chat so far is kept."
    for run in _runs(env.fake["log"]):
        assert _gone(run["pid"], 5)
    [chat] = transcripts.list_chats(env.researcher.folder)
    items = transcripts.read(env.researcher.folder, chat["id"])["items"]
    assert items[-1]["type"] == "assistant" and items[-1]["stopped"] is True


def test_run_chat_timeout_is_its_own(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ai, "TURN_TIMEOUT", 1)
    settings = device_settings.read()[0]
    space = Space(env.space_dir)
    started = time.monotonic()
    result = asyncio.run(headless.run_chat(
        env.researcher, settings=settings, space_root=space.root, space_name=space.name, space_key=None,
        api_url="http://127.0.0.1:9", prompt="FAKE:wait", title="Wait", purpose="delegate", model=None,
        timeout=3,
    ))
    elapsed = time.monotonic() - started
    assert result.state == "stopped" and result.error is None
    assert 2.5 <= elapsed < 15
    items = transcripts.read(env.researcher.folder, result.chat_id)["items"]
    assert items[-1]["stopped"] is True


class Live:
    """The app served on a free loopback port (a uvicorn thread)."""

    def __init__(self, space_dir: Path) -> None:
        self.app = create_app(Space(space_dir), None, watch=False)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.server = uvicorn.Server(uvicorn.Config(self.app, host="127.0.0.1", port=self.port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        for _ in range(400):
            try:
                if httpx.get(f"http://127.0.0.1:{self.port}/api/space").status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.05)
        raise AssertionError("the app didn't start")

    def stop(self) -> None:
        self.server.should_exit = True
        self.thread.join(30)


def test_caller_going_away_stops_delegations(space_dir: Path, fake: dict) -> None:
    researcher = AgentRegistry().create(AgentInput(name="Researcher"), "Find things.\n")
    live = Live(space_dir)
    _rec, secret = TokenStore(space_dir).ephemeral("Assistant", "read-write", agent=DEFAULT_AGENT_ID,
                                                  chat=CALLER_CHAT)
    try:
        body = json.dumps({"agent": "Researcher", "goal": "FAKE:wait"}).encode("utf-8")
        request = (
            f"POST /api/v1/agent/delegate HTTP/1.1\r\nHost: 127.0.0.1:{live.port}\r\n"
            f"Authorization: Bearer {secret}\r\nContent-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n\r\n"
        ).encode("ascii") + body
        sock = socket.create_connection(("127.0.0.1", live.port))
        sock.sendall(request)
        [run] = _wait_runs(fake["log"], 1)
        sock.close()  # the caller's turn ends: the request disconnects
        assert _gone(run["pid"], 3)
        deadline = time.monotonic() + 5
        items: list = []
        while time.monotonic() < deadline:
            chats = transcripts.list_chats(researcher.folder)
            if chats:
                items = transcripts.read(researcher.folder, chats[0]["id"])["items"]
                if items and items[-1]["type"] == "assistant":
                    break
            time.sleep(0.05)
        assert items[-1]["type"] == "assistant" and items[-1]["stopped"] is True
    finally:
        fake["go"].touch()
        TokenStore.drop_ephemeral(secret)
        live.stop()


# -- a remote target ------------------------------------------------------------------------------


def test_delegate_to_a_remote_agent(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    remote = add_remote()
    answer = types.SimpleNamespace(chat_id="01KCCCCCCCCCCCCCCCCCCCCCCC", state="TASK_STATE_COMPLETED",
                                   text="Booked.", context_id="ctx-1", task_id="task-1", attachments=[], cut=False)
    calls = patch_call_remote(monkeypatch, answer)
    res = env.delegate(agent="Fake Planner", goal="Plan the offsite", context="Two days")
    assert res.status_code == 200, res.text
    assert res.json() == {"agent": {"id": remote.id, "name": "Fake Planner", "kind": "remote"},
                          "chatId": "01KCCCCCCCCCCCCCCCCCCCCCCC", "state": "completed", "summary": "Booked.",
                          "cut": False}
    [call] = calls
    assert call["record"].id == remote.id
    assert call["timeout"] == DELEGATE_TIMEOUT and call["delegated_from"] == DEFAULT_AGENT_ID
    assert call["from_chat"] == CALLER_CHAT and call["cap"] == DELEGATE_SUMMARY_CAP
    assert "Goal: Plan the offsite" in call["text"] and "Two days" in call["text"]
    assert _runs(env.fake["log"]) == []


# -- the caller's memory and the fences -----------------------------------------------------------


def _call_tool(server, tool: str, **args):
    try:
        result = asyncio.run(server.call_tool(tool, args))
    except ToolError as exc:
        raise ApiError(str(exc)) from exc
    if result.is_error:
        raise ApiError(" ".join(getattr(c, "text", "") for c in result.content))
    out = result.structured_content
    if out is None:
        return json.loads(result.content[0].text)
    return out.get("result", out) if set(out) == {"result"} else out


def test_caller_memory_untouched(env: Env) -> None:
    caller = env.registry.ensure_default()
    before = _hashes(Path(caller.folder))
    t, out = _in_thread(env.delegate, goal="FAKE:wait")
    [run] = _wait_runs(env.fake["log"], 1)
    rp = agentrun.rule_path(Path(caller.folder).resolve())
    deny = run["runSettings"]["permissions"]["deny"]
    assert f"Read({rp}/**)" in deny and f"Edit({rp}/**)" in deny
    token = TokenStore(env.space_dir).verify(run["token"])
    assert token is not None and token.agent == env.researcher.id and token.purpose == "delegate"
    server = agent_mcp.build_server(ObjectClient("http://testserver", run["token"], env.http))
    saved = _call_tool(server, "memory", action="add", target="memory", content="delegated note")
    assert saved["ok"] is True
    env.fake["go"].touch()
    t.join(60)
    assert out[0].status_code == 200
    assert "delegated note" in (Path(env.researcher.folder) / MEMORY_FILE).read_text(encoding="utf-8")
    assert _hashes(Path(caller.folder)) == before


def test_remote_folders_are_fenced(env: Env) -> None:
    add_remote()
    [folder] = AgentRegistry().remote_folders()
    chat_id = transcripts.new_chat_id()
    transcripts.start(folder, chat_id, agent_id="x", title="t", space_name=None, space_key=None,
                      created_at="2026-11-05T09:00:00.000Z")
    target = folder / ".object-agent" / "sessions" / f"{chat_id}.jsonl"
    assert target.is_file()
    body = {"mode": "chat", "prompt": f"FAKE:read:{target}", "contextPaths": [], "history": [],
            "agentId": env.researcher.id}
    res = env.http.post("/api/ai/chat", json=body)
    assert res.status_code == 200
    assert "Permission to use Read has been denied." in res.text
    [run] = _runs(env.fake["log"])
    rp = agentrun.rule_path(folder)
    deny = run["runSettings"]["permissions"]["deny"]
    assert deny.count(f"Read({rp}/**)") == 1 and deny.count(f"Edit({rp}/**)") == 1


def test_contributor_orders() -> None:
    from objectapp import learnhooks, mcpgateway

    learnhooks.install()
    mcpgateway.install()
    delegation.install()
    delegation.install()
    found = [(o, n) for o, n, _fn in agentrun.contributors()]
    orders = {n: o for o, n in found}
    assert [x for x in found if x[1] == "delegation"] == [(64, "delegation")]
    assert [x for x in found if x[1] == "fence-remote"] == [(75, "fence-remote")]
    assert orders["tools"] < orders["delegation"] < orders["review-tools"]
    assert orders["gateway-tools"] < orders["delegation"]
    assert orders["fence"] < orders["fence-remote"]
    assert len({o for o, _n in found}) == len(found)
