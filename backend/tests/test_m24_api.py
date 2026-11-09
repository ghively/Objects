"""M24 Task 7: the work agent's app routes and M23's agent routes behind the live seams."""

from __future__ import annotations

import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from objectapp import mcpgateway, windowhost, workqueue
from objectapp.mcpmodel import McpServerInput
from objectapp.mcpprobe import ProbeResult
from objectapp.mcpstore import McpStore
from objectapp.workagentmodel import NOT_RETRYABLE, NOT_SET, REMOTE_REFUSED
from objectapp.workloop import REAPPROVE, RUNNER_ID, loop_for
from objectapp.workservice import Actor
from test_m23_api import PRINTER, Env, _make

FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    windowhost.set_opener(None)
    mcpgateway.install()
    mcpgateway.TOOL_CACHE.clear()
    e = _make(tmp_path, monkeypatch)
    e.loop = loop_for(e.space)  # type: ignore[attr-defined]
    e.loop.clock = lambda: NOW  # type: ignore[attr-defined]
    yield e
    mcpgateway.TOOL_CACHE.clear()
    windowhost.set_opener(None)


def settings(env: Env) -> dict:
    res = env.c.get("/api/work/agent-settings")
    assert res.status_code == 200
    return res.json()


def put(env: Env, rev: str, **body):
    return env.c.put("/api/work/agent-settings", json={"baseRevision": rev, **body})


def test_status_and_settings(env: Env) -> None:
    s = settings(env)
    assert s["agentId"] is None and s["problem"] == NOT_SET and s["acts"] is False and s["autoRun"] is True
    res = put(env, s["settingsRevision"], acts=True)
    assert res.status_code == 200, res.text
    after = res.json()
    assert after["acts"] is True and after["agent"]["name"] == "Work" and after["problem"] is None
    stale = put(env, s["settingsRevision"], autoRun=False)
    assert stale.status_code == 409 and stale.json()["currentRevision"] == after["settingsRevision"]
    bad = put(env, after["settingsRevision"], agentId="nope")
    assert bad.status_code == 422
    tools = put(env, after["settingsRevision"], readTools=["mcp__jira__get_issue", "mcp__jira__get_issue"])
    assert tools.status_code == 200 and tools.json()["readTools"] == ["mcp__jira__get_issue"]
    rev = tools.json()["settingsRevision"]
    assert put(env, rev, readTools=["Bash"]).status_code == 422
    assert put(env, rev, readTools=[f"mcp__s__t{i}" for i in range(501)]).status_code == 422
    env.published.clear()
    res = put(env, rev, autoRun=False)
    assert res.status_code == 200 and res.json()["autoRun"] is False
    assert ("workQueue", "settings", None) in env.events()


def test_remote_agent_is_refused(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    from objectapp import api_work_agent

    monkeypatch.setattr(api_work_agent, "work_agent", lambda reg, s: (None, REMOTE_REFUSED))
    res = put(env, settings(env)["settingsRevision"], agentId="01ABC")
    assert res.status_code == 422 and res.json()["detail"] == REMOTE_REFUSED


def test_auto_run_switch_does_not_scan_existing_items(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []
    monkeypatch.setattr(env.loop, "scan_auto_runs", lambda: calls.append(1) or 0)  # type: ignore[attr-defined]
    s = settings(env)
    assert put(env, s["settingsRevision"], autoRun=True).status_code == 200
    assert calls == []


def test_create_info_and_create(env: Env, tmp_path: Path) -> None:
    home = tmp_path / "home"
    shutil.copytree(FIXTURES / "home-reviewer", home)
    env.loop.home = lambda: home  # type: ignore[attr-defined]
    before = env.state_files()
    info = env.c.get("/api/work/agent/create-info").json()
    assert info == {"name": "Work", "changeReviewer": str(home / ".claude/agents/change-reviewer.md")}
    assert env.state_files() == before
    res = env.c.post("/api/work/agent/create", json={"copyChangeReviewer": True})
    assert res.status_code == 201, res.text
    folder = Path(res.json()["agent"]["folder"])
    assert (folder / ".claude/agents/change-reviewer.md").is_file()
    assert res.json()["settings"]["agentId"] == res.json()["agent"]["id"]
    again = env.c.post("/api/work/agent/create", json={"copyChangeReviewer": False})
    assert again.status_code == 409 and again.json()["detail"] == "A work agent is already set."


def entry(env: Env, kind: str, state: str, offset: int, **kw) -> dict:
    at = NOW + timedelta(seconds=offset)
    e = env.loop.store.add({"kind": kind, "path": PRINTER, "title": "Printer", "stepId": kw.pop("stepId", None),
                            "state": "pending", **kw}, now=at)
    if state != "pending":
        e = env.loop.store.update(e["id"], state=state, runner=RUNNER_ID if state == "running" else None,
                                  finishedAt=at.isoformat())
    return e


def test_queue_rows_order(env: Env) -> None:
    workqueue._LIVE_RUNNERS.add(RUNNER_ID)
    store = env.loop.store
    done = [entry(env, "note", "done", i) for i in range(25)]
    failed_old = entry(env, "note", "failed", 30)
    failed_new = entry(env, "note", "failed", 31)
    retried = entry(env, "note", "failed", 32)
    again = store.add({"kind": "note", "path": PRINTER, "retryOf": retried["id"]}, now=NOW + timedelta(seconds=40))
    later = entry(env, "approve", "pending", 41, notBefore="2026-11-05T12:00:00Z", stepId="a")
    due = entry(env, "request", "pending", 42)
    run = entry(env, "request", "running", 43)
    before = store.file.read_bytes()
    state = env.state_files()
    rows = env.c.get("/api/work/agent").json()["rows"]
    ids = [r["id"] for r in rows]
    retry_target = next(r for r in rows if r["id"] == retried["id"]) if retried["id"] in ids else None
    assert retry_target is None  # a retried failed entry is left out
    assert ids[:3] == [run["id"], again["id"], due["id"]]
    assert ids.index(later["id"]) > ids.index(due["id"])
    assert ids.index(failed_new["id"]) < ids.index(failed_old["id"])
    assert ids.index(later["id"]) < ids.index(failed_new["id"])
    assert len([r for r in rows if r["state"] == "done"]) == 20
    assert done and store.file.read_bytes() == before and env.state_files() == state


def test_m23_agent_routes_are_live(env: Env) -> None:
    assert env.c.post("/api/work/agent/retry", json={"id": "nope"}).status_code == 404
    res = env.c.put("/api/work/agent/acts", json={"on": True})
    assert res.status_code == 200, res.text
    assert res.json()["actsOnApprovals"] is True and res.json()["agentName"] == "Work"
    d = entry(env, "note", "done", 1)
    r = env.c.post("/api/work/agent/retry", json={"id": d["id"]})
    assert r.status_code == 422 and r.json()["detail"] == NOT_RETRYABLE
    f = entry(env, "approve", "failed", 2, stepId="r8k1pd", stepN=2, stepKind="approve", stepText="x")
    r = env.c.post("/api/work/agent/retry", json={"id": f["id"]})
    assert r.status_code == 409 and r.json()["detail"] == "This step changed. Look again."
    g = entry(env, "request", "failed", 3, text="again")
    r = env.c.post("/api/work/agent/retry", json={"id": g["id"]})
    assert r.status_code == 200, r.text
    assert any(row["state"] == "pending" and row["reason"] == "Request" for row in r.json()["rows"])
    assert not any(row["id"] == g["id"] for row in r.json()["rows"])


def test_retry_of_a_spent_approval_asks_for_approval_again(env: Env) -> None:
    # Gene's decision (2026-11-08): Retry on a failed Approve step run asks for approval again.
    w = entry(env, "approve", "withdrawn", 5, stepId="r8k1pd", reason=REAPPROVE)
    r = env.c.post("/api/work/agent/retry", json={"id": w["id"]})
    assert r.status_code == 409 and r.json()["detail"] == REAPPROVE
    service = env.loop.service  # type: ignore[attr-defined]
    rev = next(s["rev"] for s in service.item(PRINTER)["steps"] if s["id"] == "r8k1pd")
    service.step(PRINTER, "r8k1pd", rev, "approve", Actor("user", "Gene"))
    f = entry(env, "approve", "failed", 6, stepId="r8k1pd", stepN=2, stepKind="approve", stepText="x")
    r = env.c.post("/api/work/agent/retry", json={"id": f["id"]})
    assert r.status_code == 409 and r.json()["detail"] == REAPPROVE
    step = next(s for s in service.item(PRINTER)["steps"] if s["id"] == "r8k1pd")
    assert step["state"] == "open" and step["result"] == REAPPROVE
    states = {e["id"]: e["state"] for e in env.loop.store.entries()}  # type: ignore[attr-defined]
    assert states[f["id"]] == "withdrawn"
    assert "pending" not in states.values()  # the approval's own entry went with it
    # the Agent queue row carries the reason
    rows = env.c.get("/api/work/agent").json()["rows"]
    row = next(x for x in rows if x["id"] == f["id"])
    assert row["state"] == "withdrawn" and row["error"] == REAPPROVE


def test_read_tools(env: Env) -> None:
    store = McpStore()
    store.create(McpServerInput(name="jira", kind="command", command="python", args=["srv.py"]))
    store.create(McpServerInput(name="quiet", kind="command", command="python", args=["q.py"]))
    saved = next(r for r in store.list() if r.data["name"] == "jira")
    mcpgateway.TOOL_CACHE.put(mcpgateway.gateway_key(saved), ProbeResult(
        True, (("get_issue", "Read one"), ("edit_issue", "Change one")), None, 5, "2026-11-06T09:00:00.000Z",
        read_only=("get_issue",)))
    s = settings(env)
    assert put(env, s["settingsRevision"], readTools=["mcp__jira__get_issue"]).status_code == 200
    before = env.state_files()
    servers = {x["name"]: x for x in env.c.get("/api/work/read-tools").json()["servers"]}
    assert servers["jira"]["listed"] is True and servers["jira"]["source"] == "gateway"
    rows = {t["name"]: t for t in servers["jira"]["tools"]}
    assert rows["get_issue"] == {"id": "mcp__jira__get_issue", "name": "get_issue", "description": "Read one",
                                 "marked": True, "serverSaysReadOnly": True}
    assert rows["edit_issue"]["marked"] is False and rows["edit_issue"]["serverSaysReadOnly"] is False
    assert servers["quiet"]["listed"] is False and servers["quiet"]["tools"] == []
    assert env.state_files() == before


def test_test_hook_gated(env: Env) -> None:
    assert env.c.post("/api/_test/work/idle").status_code == 404
