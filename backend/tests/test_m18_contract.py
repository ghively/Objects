"""M18 Task 1: the learning contract (settings, constants, the run budget, transcript lines,
contributors, routers, the activity clock) and the fake ``claude``'s fork and MCP markers."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp import agentrun, learnhooks, server, toolcatalog, transcripts
from objectapp.learningmodel import (
    ARCHIVE_DAYS,
    LEARNING_DEFAULTS,
    REVIEW_MAX_STEPS,
    SKILL_DESCRIPTION_MAX,
    SKILL_MD_MAX,
    SKILL_NAME,
    STALE_DAYS,
    SUPPORT_FILE_MAX,
    LearningInvalid,
    clean_learning,
    effective_learning,
)
from objectapp.space import Space
from objectapp.tokens import TokenStore
from objectapp.v1guard import Denied, agent_tool_allowed
from objectapp.watcher import ChangeEvent

HERE = Path(__file__).resolve().parent
FAKE = HERE / "fake_claude.py"
CHAT = "01KAAAAAAAAAAAAAAAAAAAAAAA"


def _app(root: Path):
    app = server.create_app(Space(root), None, watch=False)
    app.state.hub.publish = lambda _e: None
    return app


# -- learning settings and constants -------------------------------------------------------------


def test_learning_defaults() -> None:
    assert effective_learning({}) == LEARNING_DEFAULTS
    d = LEARNING_DEFAULTS
    assert d["memoryChars"] == 2200 and d["userChars"] == 1375
    assert d["memoryReviewEvery"] == 10 and d["skillReviewEvery"] == 10
    assert d["reviewModel"] is None and d["curator"] is True
    assert d["curatorIdleHours"] == 2 and d["curatorEveryDays"] == 7 and d["consolidate"] is False
    got = effective_learning({"learning": {"memoryChars": "x", "userChars": 5, "skillReviewEvery": 0}})
    assert got["memoryChars"] == 2200 and got["userChars"] == 1375 and got["skillReviewEvery"] == 0
    assert effective_learning({"learning": None}) == LEARNING_DEFAULTS
    assert effective_learning({"learning": {"curator": 1, "memoryChars": True}}) == LEARNING_DEFAULTS


def test_clean_learning() -> None:
    with pytest.raises(LearningInvalid) as e:
        clean_learning({"memoryChars": 100})
    assert e.value.message == "The memory cap must be between 200 and 20,000 characters."
    with pytest.raises(LearningInvalid) as e:
        clean_learning({"reviewModel": "-p"})
    assert e.value.message == "That isn't a model name."
    assert clean_learning({"x": 1}) == {"x": 1}
    assert clean_learning({"reviewModel": " sonnet ", "memoryChars": 3000}) == {
        "reviewModel": "sonnet", "memoryChars": 3000,
    }


def test_constants() -> None:
    import re

    assert STALE_DAYS == 14 and ARCHIVE_DAYS == 30 and REVIEW_MAX_STEPS == 16
    assert SKILL_DESCRIPTION_MAX == 60 and SKILL_MD_MAX == 100_000 and SUPPORT_FILE_MAX == 1_048_576
    assert re.match(SKILL_NAME, "a" * 64)
    for bad in ("a" * 65, "Rack", "a b", "../x"):
        assert not re.match(SKILL_NAME, bad), bad


# -- the tool catalogue ------------------------------------------------------------------------


def test_agent_tools_catalogued() -> None:
    names = ("memory", "skills_list", "skill_view", "skill_manage", "session_search")
    assert toolcatalog.AGENT_TOOLS[0] == "agent_info"
    assert toolcatalog.AGENT_TOOLS[1:6] == names
    groups = toolcatalog.groups_out(toolcatalog.catalogue(), [])
    agent = next(g for g in groups if g["id"] == "object-agent")
    rows = {t["id"]: t for t in agent["tools"]}
    labels = ["Memory", "List skills", "Read skills", "Change skills", "Search chats"]
    for name, label in zip(names, labels, strict=True):
        row = rows[f"mcp__object-agent__{name}"]
        assert row["label"] == label and row["on"] is True
    assert rows["mcp__object-agent__agent_info"]["label"] == "Agent info"
    lists = toolcatalog.run_tool_lists([], write=True, folder_servers=[])
    assert "mcp__object-agent__memory" in lists.allowed


# -- the run budget ----------------------------------------------------------------------------


def test_token_budget(tmp_path: Path) -> None:
    store = TokenStore(tmp_path)
    record, secret = store.ephemeral(
        "R", "read", agent="assistant", purpose="review", run="01JREVIEW", budget=2, tools=("memory",)
    )
    try:
        assert record.purpose == "review" and record.run == "01JREVIEW"
        assert record.budget == 2 and record.used == 0 and record.tools == ("memory",)
        assert [store.spend(record), store.spend(record), store.spend(record)] == [True, True, False]
    finally:
        TokenStore.drop_ephemeral(secret)
    stored, stored_secret = store.create("script", "read")
    again = store.verify(stored_secret)
    assert again is not None and again.budget is None and again.purpose == "chat" and again.used == 0
    assert all(store.spend(again) for _ in range(30))
    raw = json.loads(store.path.read_text(encoding="utf-8"))["tokens"][0]
    for key in ("purpose", "run", "budget", "used", "tools"):
        assert key not in raw
    assert stored.id == raw["id"]


def test_v1_budget_and_tools(space_dir: Path) -> None:
    http = TestClient(_app(space_dir))
    record, secret = TokenStore(space_dir).ephemeral("Assistant", "read", agent="assistant", budget=1)
    try:
        auth = {"Authorization": f"Bearer {secret}"}
        assert http.get("/api/v1/agent/info", headers=auth).status_code == 200
        res = http.get("/api/v1/agent/info", headers=auth)
        assert res.status_code == 429
        assert res.json()["detail"] == "This run has used its 1 tool steps."
    finally:
        TokenStore.drop_ephemeral(secret)
    with_tools, secret2 = TokenStore(space_dir).ephemeral("A", "read", agent="assistant", tools=("memory",))
    TokenStore.drop_ephemeral(secret2)
    agent_tool_allowed(with_tools, "memory")
    with pytest.raises(Denied) as e:
        agent_tool_allowed(with_tools, "skill_manage")
    assert e.value.status == 403 and e.value.detail == "This run can't use skill_manage."
    everything, secret3 = TokenStore(space_dir).ephemeral("A", "read", agent="assistant")
    TokenStore.drop_ephemeral(secret3)
    agent_tool_allowed(everything, "skill_manage")


# -- transcripts -------------------------------------------------------------------------------


def test_transcript_keeps_new_lines(tmp_path: Path) -> None:
    folder = tmp_path / "agent"
    transcripts.start(folder, CHAT, agent_id="assistant", title="Hi", space_name="s", space_key=None,
                      created_at="2026-11-05T09:00:00.000Z")
    transcripts.append(folder, CHAT, [
        {"type": "memory", "memory": "m", "user": "u", "at": "2026-11-05T09:00:00.000Z"},
        {"type": "user", "text": "Hello", "at": "2026-11-05T09:00:01.000Z"},
        {"type": "assistant", "text": "Hi", "at": "2026-11-05T09:00:02.000Z", "model": "sonnet", "sessionId": "s1"},
        {"type": "review", "id": "01JREVIEW", "state": "running", "kinds": ["memory", "skills"],
         "trigger": "auto", "model": "sonnet", "at": "2026-11-05T09:00:03.000Z"},
        {"type": "x"},
        {"type": "user", "text": "Next", "at": "2026-11-05T09:00:04.000Z"},
        {"type": "review", "id": "01JREVIEW", "state": "done", "summary": "Saved 1 memory, updated 1 skill",
         "entryIds": ["01JENTRY"], "message": None, "at": "2026-11-05T09:00:05.000Z"},
    ])
    t = transcripts.read(folder, CHAT)
    kinds = [i["type"] for i in t["items"]]
    assert kinds == ["user", "assistant", "learning", "user"]
    learning = t["items"][2]
    assert learning == {
        "type": "learning", "reviewId": "01JREVIEW", "kinds": ["memory", "skills"], "state": "done",
        "summary": "Saved 1 memory, updated 1 skill", "message": None, "at": "2026-11-05T09:00:03.000Z",
    }
    assert t["messageCount"] == 3
    raw = transcripts.raw_lines(folder, CHAT)
    assert raw[0]["type"] == "chat"
    assert [r["type"] for r in raw[1:]] == ["memory", "user", "assistant", "review", "x", "user", "review"]


# -- contributors, routers, events -------------------------------------------------------------


def test_install_registers_contributors() -> None:
    learnhooks.install()
    learnhooks.install()
    found = [(o, n) for o, n, _fn in agentrun.contributors()]
    for order, name in ((10, "memory-snapshot"), (15, "learning-guidance"), (68, "review-tools")):
        assert [x for x in found if x[1] == name] == [(order, name)]


def test_routers_mounted_and_events(space_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from objectapp import api_learning, api_learning_v1

    mounted: list[str] = []
    real, real_v1 = api_learning.router, api_learning_v1.router

    def learning_router(*args, **kwargs):
        # T1's router has no routes yet, so a probe route shows where it is mounted. Once T6's
        # real search route exists, it answers first and the probe is never reached.
        mounted.append("learning")
        r = real(*args, **kwargs)
        r.add_api_route("/agents/{agent_id}/chats/search", lambda agent_id: {"hits": []}, methods=["GET"])
        return r

    def learning_v1_router(*args, **kwargs):
        mounted.append("learning-v1")
        return real_v1(*args, **kwargs)

    monkeypatch.setattr(api_learning, "router", learning_router)
    monkeypatch.setattr(api_learning_v1, "router", learning_v1_router)
    app = _app(space_dir)
    assert sorted(mounted) == ["learning", "learning-v1"]
    http = TestClient(app)
    res = http.get("/api/agents/assistant/chats/search", params={"q": "x"})
    assert not (res.status_code == 404 and res.json().get("detail") == "That chat isn't there.")
    assert app.state.reviews is not None and app.state.idle is not None and app.state.curator is not None
    assert any(e.kind == "agentLearning" and e.path == "*" for e in server.RESYNC_EVENTS)
    assert ChangeEvent("agentLearning", "assistant", "x").kind == "agentLearning"


def test_activity_middleware(space_dir: Path) -> None:
    from objectapp.curator import ActivityMiddleware, IdleClock

    app = _app(space_dir)
    seen: list[str | None] = []
    app.state.idle.touch = lambda base: seen.append(base)
    http = TestClient(app)
    http.get("/api/agents")
    assert seen == ["http://testserver"]
    http.post("/api/_test/reviews/idle")
    http.get("/index.html")
    assert len(seen) == 1

    # GET /api/events: the stream never ends in a TestClient, so the middleware is driven directly.
    touched: list[str | None] = []
    clock = IdleClock(lambda: datetime(2026, 11, 5, 9, 0))
    clock.touch = lambda base: touched.append(base)

    async def inner(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"event: change\n\n"})

    sent: list[dict] = []

    async def send(message):
        sent.append(message)

    async def receive():
        return {"type": "http.disconnect"}

    mw = ActivityMiddleware(inner, clock)
    for method, path in (("GET", "/api/events"), ("POST", "/api/_test/curator/tick"), ("GET", "/assets/x.js")):
        scope = {"type": "http", "method": method, "path": path, "scheme": "http",
                 "headers": [(b"host", b"127.0.0.1:8765")], "server": ("127.0.0.1", 8765)}
        asyncio.run(mw(scope, receive, send))
    assert touched == []
    scope = {"type": "http", "method": "GET", "path": "/api/agents", "scheme": "http",
             "headers": [(b"host", b"127.0.0.1:8765")], "server": ("127.0.0.1", 8765)}
    asyncio.run(mw(scope, receive, send))
    assert touched == ["http://127.0.0.1:8765"]


def test_idle_clock() -> None:
    from objectapp.curator import IdleClock

    now = [datetime(2026, 11, 5, 9, 0)]
    clock = IdleClock(lambda: now[0])
    now[0] += timedelta(minutes=5)
    assert clock.idle_for() == timedelta(minutes=5)
    clock.touch("http://127.0.0.1:1")
    assert clock.base_url == "http://127.0.0.1:1" and clock.idle_for() == timedelta(0)
    now[0] += timedelta(hours=3)
    assert clock.idle_for() == timedelta(hours=3)


# -- the fake claude ---------------------------------------------------------------------------


def _fake(args: list[str], prompt: str, tmp: Path, env: dict[str, str] | None = None) -> tuple[list[dict], dict]:
    log = tmp / f"log-{uuid.uuid4().hex}.jsonl"
    run_env = {**os.environ, "FAKE_CLAUDE_LOG": str(log), **(env or {})}
    res = subprocess.run([sys.executable, str(FAKE), *args], input=prompt, capture_output=True, text=True,
                         encoding="utf-8", env=run_env, cwd=tmp, timeout=60)
    events = [json.loads(line) for line in res.stdout.splitlines() if line.strip()]
    entry = json.loads(log.read_text(encoding="utf-8").splitlines()[-1])
    return events, entry


ECHO_SERVER = '''\
import sys
from pathlib import Path
from mcp.server.mcpserver import MCPServer

Path(sys.argv[1]).write_text("started", encoding="utf-8")
server = MCPServer(name="t")


@server.tool()
def echo(x: int) -> dict:
    """Echo x."""
    return {"x": x}


server.run(transport="stdio")
'''


def _mcp_config(tmp: Path) -> tuple[Path, Path]:
    script = tmp / "echo_server.py"
    script.write_text(ECHO_SERVER, encoding="utf-8")
    marker = tmp / "started.txt"
    config = tmp / "mcp.json"
    config.write_text(json.dumps({"mcpServers": {"t": {
        "command": sys.executable, "args": [str(script), str(marker)], "env": {"T_VAR": "${HOME_FOR_TEST}"},
    }}}), encoding="utf-8")
    return config, marker


def test_fake_fork_and_mcp(tmp_path: Path) -> None:
    original = str(uuid.uuid4())
    events, entry = _fake(["-p", "--resume", original, "--fork-session", "--no-session-persistence"], "hi", tmp_path)
    init = next(e for e in events if e.get("type") == "system")
    assert entry["forkSession"] is True and entry["noSessionPersistence"] is True and entry["resume"] == original
    assert init["session_id"] != original
    _events, plain = _fake(["-p", "--resume", original], "hi", tmp_path)
    assert plain["forkSession"] is False and plain["noSessionPersistence"] is False

    config, marker = _mcp_config(tmp_path)
    events, _entry = _fake(["-p", "--mcp-config", str(config), "--allowedTools", "mcp__t__echo"],
                           'FAKE:mcp:t:echo:{"x":1}', tmp_path)
    uses = [b for e in events if e.get("type") == "assistant" for b in e["message"]["content"]
            if b.get("type") == "tool_use"]
    assert uses and uses[0]["name"] == "mcp__t__echo" and uses[0]["input"] == {"x": 1}
    results = [b for e in events if e.get("type") == "user" for b in e["message"]["content"]]
    assert results and not results[0].get("is_error") and "1" in json.dumps(results[0]["content"])
    assert marker.exists()

    marker.unlink()
    events, _entry = _fake(["-p", "--mcp-config", str(config), "--disallowedTools", "mcp__t__echo"],
                           'FAKE:mcp:t:echo:{"x":1}', tmp_path)
    results = [b for e in events if e.get("type") == "user" for b in e["message"]["content"]]
    assert results[0]["is_error"] is True
    assert results[0]["content"] == "Permission to use mcp__t__echo has been denied."
    assert not marker.exists()


def test_fake_review_actions_and_skill_tool(tmp_path: Path) -> None:
    config, marker = _mcp_config(tmp_path)
    actions = json.dumps([{"server": "t", "tool": "echo", "args": {"x": 7}}])
    events, _entry = _fake(["-p", "--mcp-config", str(config), "--allowedTools", "mcp__t__echo"],
                           "Look back over this chat.\nMore.", tmp_path, {"FAKE_CLAUDE_REVIEW_ACTIONS": actions})
    results = [b for e in events if e.get("type") == "user" for b in e["message"]["content"]]
    assert results and "7" in json.dumps(results[0]["content"])
    events, _entry = _fake(["-p"], "Hello", tmp_path, {"FAKE_CLAUDE_REVIEW_ACTIONS": actions})
    assert not [e for e in events if e.get("type") == "user"]
    res = subprocess.run([sys.executable, str(FAKE), "-p"], input="Look back over this chat.",
                         capture_output=True, text=True, encoding="utf-8",
                         env={**os.environ, "FAKE_CLAUDE_REVIEW_FAIL": "1"}, timeout=60)
    assert res.returncode == 1 and res.stderr
    events, _entry = _fake(["-p"], "FAKE:skilltool:rack-labels", tmp_path)
    uses = [b for e in events if e.get("type") == "assistant" for b in e["message"]["content"]
            if b.get("type") == "tool_use"]
    assert uses[0]["name"] == "Skill" and uses[0]["input"] == {"skill": "rack-labels"}
    del marker
