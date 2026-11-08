"""M24 Task 6: the work loop (queueing, auto-run, runs, outcomes) against the fake `claude` and a
live loopback app. Synthetic data only."""

from __future__ import annotations

import json
import shutil
import socket
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
import uvicorn
from fake_claude import install
from objectapp import ai, headless, workloop
from objectapp import settings as device_settings
from objectapp.agents import AgentRegistry
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.workagent import create_work_agent
from objectapp.workagentmodel import (
    CRASHED,
    NOT_FILED,
    NOT_MARKED,
    NOT_SET,
    STOPPED,
    TIMED_OUT,
    WITHDRAWN_CHANGED,
    WITHDRAWN_REDECIDED,
)
from objectapp.workloop import AgentSeam, WorkLoop, loop_for
from objectapp.workservice import Actor

FIXTURE = Path(__file__).parent / "fixtures" / "space-work"
P = "Tasks/Printer jams on line 3.md"
B = "Tasks/Badge reader audit.md"
STEP = "r8k1pd"
GENE = Actor("user", "Gene")
NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


class Env:
    def __init__(self, root: Path, log: Path, clock: Clock, loop: WorkLoop, agent: Any, port: int,
                 server: uvicorn.Server, thread: threading.Thread) -> None:
        self.root, self.log, self.clock, self.loop, self.agent = root, log, clock, loop, agent
        self.port, self.server, self.thread = port, server, thread
        self.service = loop.service

    def acts(self, on: bool = True) -> None:
        _d, rev = device_settings.read()
        device_settings.patch({"workAgentActs": on}, rev)
        self.loop.wake()

    def setting(self, **patch: Any) -> None:
        _d, rev = device_settings.read()
        device_settings.patch(patch, rev)

    def step(self, path: str, step_id: str, action: str, actor: Actor = GENE, **kw: Any) -> dict:
        rev = next(s["rev"] for s in self.service.item(path)["steps"] if s["id"] == step_id)
        return self.service.step(path, step_id, rev, action, actor, **kw)

    def idle(self) -> None:
        assert self.loop.wait_idle(40)

    def entries(self) -> list[dict]:
        return self.loop.store.entries()

    def runs(self) -> list[dict]:
        if not self.log.exists():
            return []
        return [json.loads(x) for x in self.log.read_text(encoding="utf-8").splitlines() if x]

    def post(self, url: str, **body: Any) -> dict:
        res = httpx.post(f"http://127.0.0.1:{self.port}{url}", json=body)
        assert res.status_code < 300, res.text
        return res.json()

    def wait_for(self, fn, timeout: float = 20.0):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            got = fn()
            if got:
                return got
            time.sleep(0.05)
        raise AssertionError("timed out waiting")


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "space"
    shutil.copytree(FIXTURE, root)
    claude = install(tmp_path / "bin")
    log = tmp_path / "claude-log.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    monkeypatch.setenv("OBJECT_FAKE_NOTIFY_FILE", str(tmp_path / "notified"))
    _d, rev = device_settings.read()
    device_settings.patch({"claudePath": str(claude)}, rev)
    space = Space(root)
    clock = Clock()
    space.clock = clock
    space.tz = UTC
    app = create_app(space, None, watch=False)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(400):
        try:
            if httpx.get(f"http://127.0.0.1:{port}/api/space").status_code == 200:
                break
        except httpx.HTTPError:
            pass
        time.sleep(0.05)
    loop = loop_for(space)
    loop.clock = clock
    agent = create_work_agent(AgentRegistry(), user="Gene", copy_change_reviewer=False, home=tmp_path)
    e = Env(root, log, clock, loop, agent, port, server, thread)
    e.go = Path(str(log) + ".go")  # type: ignore[attr-defined]
    yield e
    e.go.touch()
    server.should_exit = True
    thread.join(30)


def actions(monkeypatch: pytest.MonkeyPatch, table: dict) -> None:
    monkeypatch.setenv("FAKE_CLAUDE_WORK_ACTIONS", json.dumps(table))


def step_call(action: str, text: str, **extra: Any) -> dict:
    return {"server": "object", "tool": "step_action",
            "args": {"path": "{path}", "step_id": "{stepId}", "step_rev": "{stepRev}", "action": action,
                     "text": text, **extra}}


def wait_text(env: Env, path: str, step_id: str, text: str) -> None:
    rev = next(s["rev"] for s in env.service.item(path)["steps"] if s["id"] == step_id)
    env.service.edit_steps(path, [{"op": "edit", "stepId": step_id, "stepRev": rev, "text": text}], GENE)


def test_approve_runs_with_full_tools_and_completes(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    actions(monkeypatch, {"approve": [step_call("complete", "Change review: PASS. Spooler restarted.")]})
    env.acts()
    env.step(P, STEP, "approve")
    env.idle()
    [e] = [x for x in env.entries() if x["kind"] == "approve"]
    assert e["state"] == "done", e["reason"]
    assert e["result"] == "Change review: PASS. Spooler restarted."
    assert e["purpose"] == "work" and e["chatId"] and e["agentId"] == env.agent.id
    step = next(s for s in env.service.item(P)["steps"] if s["id"] == STEP)
    assert step["state"] == "done" and step["result"].startswith("Change review: PASS")
    assert any("Work completed step 2" in a["text"] for a in env.service.item(P)["activity"])
    env.idle()
    assert "Bash" in env.runs()[0]["allowed"]
    assert list((Path(env.agent.folder) / ".object-agent" / "sessions").glob("*.jsonl"))


def test_full_tools_only_for_a_current_approved_approve_step(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    # switch off: queue, then change things
    env.step(P, STEP, "approve")
    env.step(P, STEP, "reopen")
    [a] = env.entries()
    assert a["state"] == "withdrawn" and a["reason"] == WITHDRAWN_REDECIDED
    env.step(P, STEP, "approve")
    env.step(P, STEP, "decline")
    kinds = [(x["kind"], x["state"]) for x in env.entries()]
    assert kinds == [("approve", "withdrawn"), ("approve", "withdrawn"), ("decline", "pending")]  # no auto-run while the agent does not act
    # reordered: a hand-written entry for an Agent step is withdrawn by the pre-run check
    env.loop.store.add({"kind": "approve", "path": P, "stepId": "t2n7vc", "stepN": 3, "stepKind": "agent",
                        "stepText": "x"}, now=NOW)
    env.acts()
    env.idle()
    done = {(x["kind"], x["state"]) for x in env.entries() if x["state"] != "withdrawn" or x["kind"] == "approve"}
    assert ("decline", "done") in done
    assert not [x for x in env.entries() if x.get("purpose") == "work"]
    hand = [x for x in env.entries() if x["stepId"] == "t2n7vc" and x["kind"] == "approve"][0]
    assert hand["state"] == "withdrawn" and hand["reason"] == WITHDRAWN_CHANGED
    assert all("Bash" not in r["allowed"] for r in env.runs())


def test_not_before_and_reorder(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    actions(monkeypatch, {"approve": [step_call("complete", "Change review: PASS. Done.")]})
    env.acts()
    env.step(P, STEP, "approve", not_before="2026-11-05T12:00:00Z")
    env.idle()
    assert [x["state"] for x in env.entries()] == ["pending"] and not env.runs()
    env.clock.now = datetime(2026, 11, 5, 12, 5, tzinfo=UTC)
    env.service.space.clock = env.clock
    env.loop.wake()
    env.idle()
    assert [x["state"] for x in env.entries() if x["kind"] == "approve"] == ["done"]
    assert "Bash" in env.runs()[0]["allowed"]


def test_fail_with_question(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    actions(monkeypatch, {"approve": [step_call("fail", "Need timing", ask="When is PRN-TEST-01 idle?")]})
    env.acts()
    env.step(P, STEP, "approve")
    env.idle()
    [e] = [x for x in env.entries() if x["kind"] == "approve"]
    assert e["state"] == "failed" and "Need timing" in e["reason"] and e["retryable"]
    steps = env.service.item(P)["steps"]
    texts = [s["text"] for s in steps]
    assert texts.index("When is PRN-TEST-01 idle?") == texts.index("Restart the print spooler on PRN-TEST-01") - 1
    assert next(s for s in steps if s["id"] == STEP)["state"] == "open"
    with pytest.raises(workloop.QueueRefused) as exc:
        env.loop.retry(e["id"])
    assert exc.value.status == 409 and exc.value.detail == "This step changed. Look again."


def test_not_marked_and_timeout(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    env.acts()
    env.step(P, STEP, "approve")
    env.idle()
    [e] = [x for x in env.entries() if x["kind"] == "approve"]
    assert e["state"] == "failed" and e["reason"] == NOT_MARKED
    monkeypatch.setattr(workloop, "WORK_RUN_TIMEOUT", 2.0)
    env.acts(False)
    new = env.loop.retry(e["id"])
    assert new["attempt"] == 2 and new["retryOf"] == e["id"] and new["state"] == "pending"
    env.step(P, STEP, "reopen")  # withdraws the retry
    wait_text(env, P, STEP, "Restart FAKE:wait")
    env.step(P, STEP, "approve")
    started = time.monotonic()
    env.acts()
    env.idle()
    last = [x for x in env.entries() if x["kind"] == "approve"][-1]
    assert last["state"] == "failed" and last["reason"] == TIMED_OUT
    assert 1.5 < time.monotonic() - started < 15


def test_run_limit_is_thirty_minutes_not_turn_timeout(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ai, "TURN_TIMEOUT", 1)
    monkeypatch.setattr(workloop, "WORK_RUN_TIMEOUT", 3.0)
    seen: list[float] = []
    real = headless.run_chat

    async def spy(*a, **kw):
        seen.append(kw["timeout"])
        return await real(*a, **kw)

    monkeypatch.setattr(headless, "run_chat", spy)
    wait_text(env, P, STEP, "Restart FAKE:wait")
    env.acts()
    env.step(P, STEP, "approve")
    started = time.monotonic()
    env.idle()
    elapsed = time.monotonic() - started
    assert seen == [3.0] and 2.5 <= elapsed < 15
    assert env.entries()[-1]["reason"] == TIMED_OUT


def test_one_run_at_a_time_and_restart_safety(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    active = {"now": 0, "max": 0, "order": []}
    real = headless.run_chat

    async def spy(*a, **kw):
        active["now"] += 1
        active["max"] = max(active["max"], active["now"])
        active["order"].append(kw["prompt"].splitlines()[0])
        try:
            await __import__("asyncio").sleep(0.4)
            return await real(*a, **kw)
        finally:
            active["now"] -= 1

    monkeypatch.setattr(headless, "run_chat", spy)
    for text in ("one", "two", "three"):
        env.service.note(P, "request", text, GENE)
        NOW_ = env.clock.now
        env.clock.now = NOW_.replace(second=env.clock.now.second + 1)
    env.acts()
    env.idle()
    assert active["max"] == 1 and len(active["order"]) == 3
    ids = [x["id"] for x in env.entries()]
    assert [o.split(":")[0].split()[-1] for o in active["order"]] == ids
    # a running entry left by another process is served failed and never re-run
    env.loop.store.add({"kind": "request", "path": P, "state": "running", "runner": "OTHER", "text": "stuck"},
                       now=NOW)
    crashed = next(x for x in env.entries() if x.get("text") == "stuck")
    assert crashed["state"] == "failed" and crashed["reason"] == CRASHED and crashed["retryable"]
    env.loop.wake()
    env.idle()
    assert len(active["order"]) == 3


def test_stop_fails_the_running_entry(env: Env) -> None:
    wait_text(env, P, STEP, "Restart FAKE:wait")
    env.acts()
    env.step(P, STEP, "approve")
    env.wait_for(lambda: [x for x in env.entries() if x["state"] == "running" and x.get("chatId")])
    env.loop.stop()
    [e] = [x for x in env.entries() if x["kind"] == "approve"]
    assert e["state"] == "failed" and e["reason"] == STOPPED


def test_withdraw_during_a_run_stops_it(env: Env) -> None:
    wait_text(env, P, STEP, "Restart FAKE:wait")
    env.acts()
    env.step(P, STEP, "approve")
    env.wait_for(lambda: [x for x in env.entries() if x["state"] == "running" and x.get("chatId")])
    started = time.monotonic()
    env.step(P, STEP, "reopen")
    env.idle()
    [e] = [x for x in env.entries() if x["kind"] == "approve"]
    assert e["state"] == "withdrawn" and time.monotonic() - started < 15


def test_switch_off_means_nothing_runs(env: Env) -> None:
    env.step(P, STEP, "approve")
    env.service.note(P, "request", "look at it", GENE)
    env.post("/api/work/captures", text="a stray thought", fromView="now")
    assert len(env.entries()) == 3 and all(e["state"] == "pending" for e in env.entries())
    assert env.runs() == []
    env.loop.set_acts(True)
    env.idle()
    assert env.runs() and all(e["state"] != "pending" for e in env.entries())


def test_agent_status_for_m23(env: Env) -> None:
    status = AgentSeam().status(env.service.space, [])
    assert status["available"] and status["note"] is None
    env.step(P, STEP, "approve")
    env.service.note(P, "request", "hi", GENE)
    status = AgentSeam().status(env.service.space, [])
    assert status["carrying"] == 2 and [r["reason"] for r in status["rows"]] == ["Approved step", "Request"]
    assert status["actsOnApprovals"] is False and status["agentName"] == "Work"
    env.acts()
    env.idle()
    status = AgentSeam().status(env.service.space, [])
    assert status["carrying"] == 0
    failed = [r for r in status["rows"] if r["state"] == "failed"]
    assert failed and failed[0]["error"] == NOT_MARKED


def test_auto_run(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    actions(monkeypatch, {"run": [step_call("fail", "Can't read the log", ask="Which reader?")]})
    env.acts()
    do = env.service.item(B)["steps"][0]
    env.service.edit_steps(B, [
        {"op": "add", "kind": "question", "text": "Which site?"},
        {"op": "add", "kind": "agent", "text": "Check the badge reader log"},
        {"op": "remove", "stepId": do["id"], "stepRev": do["rev"]},
    ], GENE)
    assert not env.entries()
    q = env.service.item(B)["steps"][0]
    env.step(B, q["id"], "answer", text="Plant A")
    env.idle()
    runs = [e for e in env.entries() if e["kind"] == "run"]
    assert len(runs) == 1 and runs[0]["auto"] and runs[0]["purpose"] == "work-read"
    assert runs[0]["state"] == "failed" and "Can't read the log" in runs[0]["reason"]
    assert any("asked the agent to run step" in a["text"] for a in env.service.item(B)["activity"])
    q2 = next(s for s in env.service.item(B)["steps"] if s["current"])
    assert q2["text"] == "Which reader?"
    env.step(B, q2["id"], "answer", text="R4")
    env.idle()
    assert len([e for e in env.entries() if e["kind"] == "run"]) == 1  # same text: not again
    agent_step = next(s for s in env.service.item(B)["steps"] if s["kind"] == "agent")
    assert agent_step["state"] == "open"
    # an edited text is auto-run
    wait_text(env, B, agent_step["id"], "Check the badge reader log again")
    env.idle()
    assert len([e for e in env.entries() if e["kind"] == "run"]) == 2  # queued by the edit notice itself
    assert env.loop.scan_auto_runs() == 0  # and not again by a scan
    # switched off: nothing
    env.setting(workAutoRun=False)
    other = env.service.item(P)
    assert other and env.loop.scan_auto_runs() == 0


def test_capture_entries(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    actions(monkeypatch, {
        "capture": [{"server": "object-agent", "tool": "file_capture",
                     "args": {"capture": "{capture}", "outcome": "workNote", "item": P, "text": "Noted."}}],
        "question": [{"server": "object", "tool": "add_work_note",
                      "args": {"path": "{path}", "text": "It is tray 2."}}],
    })
    env.acts()
    cap = env.post("/api/work/captures", text="Printer jammed again", fromView="now")["capture"]
    env.idle()
    [e] = [x for x in env.entries() if x["kind"] == "capture"]
    assert e["state"] == "done" and e["purpose"] == "work-file"
    from objectapp import captures
    assert captures.capture(env.service.space, cap["path"])["status"] == "filed"
    q = env.post("/api/work/captures", text="Question about Badge reader audit: where?", fromView="now")["capture"]
    env.idle()
    qe = [x for x in env.entries() if x["kind"] == "question"][0]
    assert qe["state"] == "done" and qe["purpose"] == "work-read"
    got = captures.capture(env.service.space, q["path"])
    assert got["status"] == "filed" and got["filedTo"]["path"] == B


def test_failed_filing_keeps_the_capture_new(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    from objectapp import captures
    env.acts()
    made = []
    for text in ("never filed", "FAKE:error broken"):
        made.append(env.post("/api/work/captures", text=text, fromView="now")["capture"])
        env.idle()
    states = [(e["state"], e["reason"]) for e in env.entries() if e["kind"] == "capture"]
    assert states[0] == ("failed", NOT_FILED) and states[1][0] == "failed"
    assert all(captures.capture(env.service.space, c["path"])["status"] == "new" for c in made)
    assert env.loop.scan_unqueued_captures() == 0
    # a capture whose queue write failed is queued by the next pass
    real = env.loop.enqueue_capture

    def boom(*_a, **_k):
        raise RuntimeError("queue write failed")

    monkeypatch.setattr(env.loop, "enqueue_capture", boom)
    lost = env.post("/api/work/captures", text="lost then found", fromView="now")["capture"]
    monkeypatch.setattr(env.loop, "enqueue_capture", real)
    assert not [e for e in env.entries() if e.get("capturePath") == lost["path"]]
    assert env.loop.scan_unqueued_captures() == 1
    assert [e for e in env.entries() if e.get("capturePath") == lost["path"]]


def test_requeue_after_a_finished_entry(env: Env) -> None:
    from objectapp import captures
    cap = env.post("/api/work/captures", text="Printer jammed again", fromView="now")["capture"]
    [first] = [e for e in env.entries() if e.get("capturePath") == cap["path"]]
    again = env.loop.enqueue_capture(cap, captures.parse_prefix(cap["text"]), None)
    assert again["id"] == first["id"]  # still pending: the same entry
    env.loop.store.update(first["id"], state="failed", reason="x", finishedAt="2026-11-05T10:00:00Z")
    new = env.loop.enqueue_capture(cap, captures.parse_prefix(cap["text"]), None)
    assert new["id"] != first["id"] and new["state"] == "pending"
    env.loop.store.update(new["id"], state="done")
    assert env.loop.scan_unqueued_captures() == 0  # no loop-requeue of one already queued this run


def test_opening_writes_nothing_and_auto_run_needs_acts(env: Env) -> None:
    calls: list[int] = []
    env.loop.stop()
    env.loop.scan_auto_runs = lambda: calls.append(1) or 0  # type: ignore[method-assign]
    env.loop.start()
    env.loop.wake()
    time.sleep(0.3)
    assert calls == []
    # auto-run is off while "Agent acts on my approvals" is off
    do = env.service.item(B)["steps"][0]
    env.service.edit_steps(B, [{"op": "add", "kind": "agent", "text": "Check the log"},
                               {"op": "remove", "stepId": do["id"], "stepRev": do["rev"]}], GENE)
    assert env.loop._auto_check(B) is False
    assert not env.entries()


def test_a_failure_before_the_run_fails_the_entry(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_a, **_k):
        raise RuntimeError("prompt broke")

    monkeypatch.setattr(workloop, "entry_prompt", boom)
    env.acts()
    env.post("/api/work/captures", text="Printer jammed again", fromView="now")
    env.idle()
    [e] = [x for x in env.entries() if x["kind"] == "capture"]
    assert e["state"] == "failed" and "prompt broke" in e["reason"] and e["retryable"]


def test_unreadable_capture_fails_and_non_new_capture_withdraws(env: Env) -> None:
    from objectapp.workagentmodel import ALREADY_FILED
    entry = {"kind": "breakDown", "stepId": "s", "capturePath": "x"}
    item = {"path": P, "done": False, "steps": [{"id": "s", "state": "open"}]}
    assert workloop.precheck(entry, item, {"status": "filed"}, NOW)[0:3:2] == ("withdraw", ALREADY_FILED)
    assert workloop.precheck(entry, item, {"status": "new"}, NOW)[0] == "run"
    q = {"kind": "question", "capturePath": "x"}
    assert workloop.precheck(q, item, {"status": "filed"}, NOW)[0] == "withdraw"
    env.acts()
    env.loop.store.add({"kind": "capture", "capturePath": "Captures/nope.md", "by": "Gene"}, now=NOW)
    env.loop.wake()
    env.idle()
    [e] = [x for x in env.entries() if x.get("capturePath") == "Captures/nope.md"]
    assert e["state"] == "failed" and e["retryable"]


def test_waiting_entry_does_not_starve_a_later_due_one(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    actions(monkeypatch, {"approve": [step_call("complete", "Done.")]})
    env.acts()
    env.step(P, STEP, "approve", not_before="2026-11-05T12:00:00Z")
    env.loop.store.add({"kind": "capture", "capturePath": "Captures/nope.md", "by": "Gene"}, now=NOW)
    env.loop.wake()
    env.idle()
    waiting = [x for x in env.entries() if x["kind"] == "approve"][0]
    assert waiting["state"] == "pending" and waiting["notBefore"]
    assert [x["state"] for x in env.entries() if x["kind"] == "capture"] == ["failed"]


def test_no_agent_set(env: Env) -> None:
    env.setting(workAgentId=None)
    assert env.loop.settings_status()["problem"] == NOT_SET
    env.step(P, STEP, "approve")
    env.acts()
    env.idle()
    assert [e["state"] for e in env.entries()] == ["pending"] and not env.runs()
    assert AgentSeam().status(env.service.space, [])["note"] == NOT_SET
    env.loop.set_acts(True)
    assert env.loop.settings_status()["problem"] is None
    env.idle()
    assert env.entries()[0]["state"] != "pending"


def test_wait_idle_is_not_fooled_by_a_run_that_starts_between_its_checks() -> None:
    """Audit 46: the worker woke between `wait_idle`'s two checks and claimed the only due entry, so
    the first check saw it idle and the second saw nothing pending, while a run was in progress."""
    import types
    calls: list[int] = []

    class Wake:
        def set(self) -> None:  # the next poll comes after the run has finished
            stub._busy = False

    stub = types.SimpleNamespace(_busy=False, _passes=0, _wake=Wake())

    def can_start() -> bool:
        calls.append(1)
        if len(calls) == 1:  # the worker wakes now and claims the entry: busy, nothing left pending
            stub._busy = True
            stub._passes += 1
        return False

    stub._can_start = can_start
    assert WorkLoop.wait_idle(stub, 2)  # type: ignore[arg-type]
    assert len(calls) >= 2


def test_an_approved_step_moved_away_and_back_is_queued_again(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    """Audit 10: moving an approved step (or a no-op edit) must not strand it with no queue entry."""
    actions(monkeypatch, {"approve": [step_call("complete", "Change review: PASS. Done.")]})
    env.setting(workAutoRun=False)
    env.step(P, STEP, "approve")
    # a no-op edit (the same text) keeps the entry
    step = next(s for s in env.service.item(P)["steps"] if s["id"] == STEP)
    env.service.edit_steps(P, [{"op": "edit", "stepId": STEP, "stepRev": step["rev"], "text": step["text"]}], GENE)
    assert [x["state"] for x in env.entries()] == ["pending"]
    # moved to the end it isn't current, so the claim withdraws the entry
    step = next(s for s in env.service.item(P)["steps"] if s["id"] == STEP)
    env.service.edit_steps(P, [{"op": "move", "stepId": STEP, "stepRev": step["rev"], "before": None}], GENE)
    env.acts()
    env.idle()
    assert [(x["state"], x["reason"]) for x in env.entries()] == [("withdrawn", WITHDRAWN_CHANGED)]
    assert not env.runs()
    # moved back, it is current and approved again: queued and run
    steps = env.service.item(P)["steps"]
    step = next(s for s in steps if s["id"] == STEP)
    agent = next(s for s in steps if s["kind"] == "agent")
    env.service.edit_steps(P, [{"op": "move", "stepId": STEP, "stepRev": step["rev"], "before": agent["id"]}], GENE)
    env.idle()
    approve = [x for x in env.entries() if x["kind"] == "approve"]
    assert [x["state"] for x in approve] == ["withdrawn", "done"]
    assert approve[1]["purpose"] == "work" and approve[1]["by"] == "Gene"
    assert next(s for s in env.service.item(P)["steps"] if s["id"] == STEP)["state"] == "done"
    assert len(env.runs()) == 1


def test_auto_run_whose_write_failed_is_tried_again(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    """Audit 32: the auto-run key was recorded before the step write, so a failed write (read-only
    space, disk error) meant the step never auto-ran again until its text changed."""
    env.setting(workAgentActs=True)
    real = env.service.step
    calls: list[str] = []

    def failing(path, step_id, rev, action, actor, **kw):
        if action == "run" and not calls:
            calls.append(step_id)
            raise OSError("disk full")
        return real(path, step_id, rev, action, actor, **kw)

    monkeypatch.setattr(env.service, "step", failing)
    steps = env.service.item(P)["steps"]
    agent = next(s for s in steps if s["kind"] == "agent")
    # make the Agent step current: the Approve step before it goes after it
    approve = next(s for s in steps if s["id"] == STEP)
    env.service.edit_steps(P, [{"op": "move", "stepId": STEP, "stepRev": approve["rev"], "before": None}], GENE)
    assert calls == [agent["id"]]  # the auto-run was tried, and its write failed
    assert not [e for e in env.entries() if e["kind"] == "run"]
    assert env.loop.scan_auto_runs() == 1  # not given up on
    assert [e["auto"] for e in env.entries() if e["kind"] == "run"] == [True]


def test_a_run_whose_cli_errs_after_completing_the_step_is_done() -> None:
    """Audit 35: the agent completed the step through the tools, then the CLI died: the entry was
    failed and retryable, and Retry answered 409."""
    from objectapp.headless import HeadlessResult
    from objectapp.workloop import outcome
    from objectapp.workservice import WorkNotice

    def note(event: str, step: str = STEP, text: str = "Spooler restarted.") -> WorkNotice:
        return WorkNotice(path=P, object_id="o1", event=event, step_id=step, n=2, kind="approve",
                          step_text="Restart", before="approved", after="done", by=Actor("agent", "Work"),
                          text=text, not_before=None, at=NOW, version="v")

    entry = {"kind": "approve", "stepId": STEP}
    died = HeadlessResult(chat_id="c", state="error", text="", session_id=None, model=None, error="CLI exited 1")
    assert outcome(entry, died, [note("complete")], False, timed_out=False, withdrawn=False) == (
        "done", "Spooler restarted.", None)
    # no complete notice for this step: still failed with the CLI's error
    assert outcome(entry, died, [note("complete", step="other")], False, timed_out=False, withdrawn=False) == (
        "failed", None, "CLI exited 1")
    assert outcome(entry, died, [note("complete"), note("fail", text="no")], False, timed_out=False,
                   withdrawn=False)[0] == "failed"


def test_an_approved_step_is_queued_again_when_its_item_is_reopened_by_status(
    env: Env, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sweep 2026-11-08 (work-import 3): closing the item withdrew the approved step's entry; reopening
    it the only way the UI offers (the status set back in the property editor) is a plain property
    write, which raised no work notice, so the step stayed "Approved step: withdrawn" and never ran."""
    actions(monkeypatch, {"approve": [step_call("complete", "Change review: PASS. Done.")]})
    env.setting(workAutoRun=False)
    env.step(P, STEP, "approve")
    assert [x["state"] for x in env.entries()] == ["pending"]
    space = env.loop.space
    env.service.close(P, space.read(P)[2], GENE)
    assert [(x["state"], x["reason"]) for x in env.entries()] == [("withdrawn", WITHDRAWN_REDECIDED)]
    assert env.service.item(P)["done"]
    space.update_properties(P, {"status": ["In Progress"]}, space.read(P)[2])
    assert not env.service.item(P)["done"]
    env.wait_for(lambda: [x for x in env.entries() if x["state"] == "pending"])
    approve = [x for x in env.entries() if x["kind"] == "approve"]
    assert [x["state"] for x in approve] == ["withdrawn", "pending"]
    assert approve[1]["stepId"] == STEP and approve[1]["by"] == "Gene" and approve[1]["path"] == P
    # and it runs once the agent acts
    env.acts()
    env.idle()
    assert [x["state"] for x in env.entries() if x["kind"] == "approve"] == ["withdrawn", "done"]
    assert next(s for s in env.service.item(P)["steps"] if s["id"] == STEP)["state"] == "done"
    assert len(env.runs()) == 1
    # a property write on an item with nothing withdrawn queues nothing
    space.update_properties(P, {"priority": ["Low"]}, space.read(P)[2])
    env.idle()
    assert len([x for x in env.entries() if x["kind"] == "approve"]) == 2
