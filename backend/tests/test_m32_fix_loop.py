"""M32 fix pass, finding 1: the Work agent does not run in a space where Work is off.

Against the M24 loop fixture (a copy of ``space-work``, a live loopback app, the fake ``claude``).
An entry that is already pending is left as it is (not failed, not withdrawn) and runs once Work is
on again; a brain dump saved while Work is off is not queued; no step is auto-run. Synthetic data
only."""

from __future__ import annotations

import time

import httpx
import pytest
from test_m24_loop import GENE, STEP, B, Env, P, actions, env, step_call  # noqa: F401


def _switch(env: Env, on: bool) -> None:
    url = f"http://127.0.0.1:{env.port}/api/space"
    rev = httpx.get(url).json()["revision"]
    r = httpx.put(url, json={"patch": {"workEnabled": on}, "baseRevision": rev})
    assert r.status_code == 200 and r.json()["workOn"] is on, r.text


def _two_passes(env: Env) -> None:
    """Let the worker look at the queue twice more (it would have run a due entry by then)."""
    start = env.loop._passes
    end = time.monotonic() + 20
    while env.loop._passes < start + 2 and time.monotonic() < end:
        env.loop.wake()
        time.sleep(0.05)
    assert env.loop._passes >= start + 2
    env.idle()


def test_a_queued_step_waits_while_work_is_off_and_runs_when_it_is_on_again(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    actions(monkeypatch, {"approve": [step_call("complete", "Change review: PASS. Spooler restarted.")]})
    env.step(P, STEP, "approve")  # queued while Work is on; the agent does not act yet
    before = (env.root / P).read_bytes()
    _switch(env, False)
    env.acts()
    _two_passes(env)
    assert [(e["kind"], e["state"]) for e in env.entries()] == [("approve", "pending")]
    assert env.runs() == []
    assert (env.root / P).read_bytes() == before

    _switch(env, True)  # the route wakes the loop
    env.wait_for(lambda: [e for e in env.entries() if e["state"] == "done"])
    env.idle()
    [e] = [x for x in env.entries() if x["kind"] == "approve"]
    assert e["state"] == "done", e.get("reason")
    assert env.runs()
    step = next(s for s in env.service.item(P)["steps"] if s["id"] == STEP)
    assert step["state"] == "done"


def test_a_brain_dump_saved_while_work_is_off_is_not_queued(env: Env) -> None:
    _switch(env, False)
    env.acts()
    cap = env.post("/api/work/captures", text="a stray thought", fromView="now")["capture"]
    _two_passes(env)
    assert env.entries() == [] and env.runs() == []
    assert env.loop.scan_unqueued_captures() == 0  # asked directly, it queues nothing either
    assert env.entries() == []

    _switch(env, True)
    got = env.wait_for(lambda: [e for e in env.entries() if e.get("capturePath") == cap["path"]])
    assert got[0]["kind"] == "capture"


def test_no_step_is_auto_run_while_work_is_off(env: Env) -> None:
    _switch(env, False)
    env.setting(workAutoRun=True)
    env.acts()
    do = env.service.item(B)["steps"][0]
    env.service.edit_steps(
        B,
        [
            {"op": "add", "kind": "agent", "text": "Check the badge reader log"},
            {"op": "remove", "stepId": do["id"], "stepRev": do["rev"]},
        ],
        GENE,
    )
    _two_passes(env)
    assert env.loop.scan_auto_runs() == 0
    assert env.entries() == [] and env.runs() == []
    step = next(s for s in env.service.item(B)["steps"] if s["kind"] == "agent")
    assert step["state"] == "open"

    _switch(env, True)
    env.loop.scan_auto_runs()
    assert [e["kind"] for e in env.entries()] == ["run"]
