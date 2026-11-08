from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from objectapp.workagentmodel import CRASHED, WITHDRAWN_REDECIDED
from objectapp.workqueue import QueueStore, auto_run_key, plan_for_notice
from objectapp.workservice import Actor, WorkNotice

NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
P = "Tasks/Printer jams on line 3.md"


def notice(event, role="user", name="Gene", **kw):
    base = dict(path=P, object_id="o1", event=event, step_id="r8k1pd", n=2, kind="approve",
                step_text="Restart the print spooler on PRN-TEST-01", before=None, after=None,
                by=Actor(role, name), text=None, not_before=None, at=NOW, version="v")
    base.update(kw)
    return WorkNotice(**base)


@pytest.mark.parametrize("event,kind", [("approve", "approve"), ("answer", "answer"), ("done", "done"),
                                        ("decline", "decline"), ("run", "run"), ("note", "note"),
                                        ("request", "request")])
def test_plan_table_creates(event, kind):
    plan = plan_for_notice(notice(event, text="why", not_before="2026-11-05T12:00:00Z"))
    assert plan.create["kind"] == kind
    if event == "approve":
        assert plan.create["notBefore"] == "2026-11-05T12:00:00Z"
    if event == "decline":
        assert plan.stop_running and plan.create["text"] == "why"
    if event in ("note", "request"):
        assert plan.withdraw_step is None


def test_plan_app_run_and_reopen_close():
    plan = plan_for_notice(notice("run", "app", "Object"))
    assert plan.create["auto"] is True and plan.create["by"] == "Object"
    plan = plan_for_notice(notice("reopen"))
    assert plan.create is None and plan.withdraw_step == "r8k1pd" and plan.stop_running
    plan = plan_for_notice(notice("close"))
    assert plan.withdraw_item and plan.create is None and plan.stop_running
    for ev in ("edit", "remove"):
        assert plan_for_notice(notice(ev)).stop_running


def test_agent_and_app_writes_never_queue_work():
    for ev in ("approve", "answer", "done", "decline", "run", "reopen", "note", "request", "fields",
               "close", "edit", "remove", "complete", "fail", "log", "add", "move", "floor"):
        assert plan_for_notice(notice(ev, "agent", "Work")) is None
    for ev in ("complete", "fail", "log", "fields", "floor", "add", "move"):
        assert plan_for_notice(notice(ev)) is None
    for ev in ("approve", "answer", "note", "reopen", "fields", "complete"):
        assert plan_for_notice(notice(ev, "app", "Object")) is None


def store(tmp_path):
    return QueueStore(tmp_path / "space", tmp_path / "state")


def test_states_and_due(tmp_path):
    s = store(tmp_path)
    e = s.add({"kind": "approve", "path": P, "notBefore": "2099-11-05T12:00:00Z"}, now=NOW)
    assert s.claim_next(NOW, "r1") is None
    assert not s.get(e["id"])["due"]
    older = s.add({"kind": "note", "path": P}, now=NOW - timedelta(minutes=5))
    got = s.claim_next(NOW, "r1")
    assert got["id"] == older["id"] and got["state"] == "running" and got["runner"] == "r1" and got["claimedAt"]
    assert s.claim_next(datetime(2099, 11, 5, 12, tzinfo=UTC), "r1")["id"] == e["id"]


def test_withdraw_on_redecide(tmp_path):
    s = store(tmp_path)
    for _ in range(2):
        s.add({"kind": "approve", "path": P, "stepId": "r8k1pd"}, now=NOW)
    other = s.add({"kind": "approve", "path": P, "stepId": "zzz"}, now=NOW)
    withdrawn, created = s.apply(plan_for_notice(notice("reopen")), now=NOW)
    assert created is None and len(withdrawn) == 2
    assert all(w["state"] == "withdrawn" and w["reason"] == WITHDRAWN_REDECIDED for w in withdrawn)
    assert s.get(other["id"])["state"] == "pending"


def test_auto_run_once_per_step_text(tmp_path):
    s = store(tmp_path)
    key = auto_run_key(P, "s1", "Check the spooler log")
    s.record_auto_run(key)
    s2 = store(tmp_path)
    assert s2.has_auto_run(key)
    assert not s2.has_auto_run(auto_run_key(P, "s1", "Check the spooler log again"))
    for i in range(2100):
        s2.record_auto_run(f"k{i}")
    assert not s2.has_auto_run(key) and s2.has_auto_run("k2099")
    assert len(s2._load()["autoRuns"]) == 2000


def test_crashed_running_is_served_failed_without_a_write(tmp_path):
    s = store(tmp_path)
    e = s.add({"kind": "note", "path": P}, now=NOW)
    s.claim_next(NOW, "run-a")
    import objectapp.workqueue as wq
    wq._LIVE_RUNNERS.discard("run-a")
    before = s.file.read_bytes()
    got = s.get(e["id"])
    assert got["state"] == "failed" and got["reason"] == CRASHED and got["retryable"] is True
    assert s.file.read_bytes() == before
    s.add({"kind": "note", "path": P}, now=NOW)
    assert '"state": "failed"' in s.file.read_text()


def test_unreadable_file_kept_aside(tmp_path):
    s = store(tmp_path)
    s.file.parent.mkdir(parents=True)
    s.file.write_bytes(b"\x00garbage")
    assert s.entries() == [] and s.problem() == "The work queue file can't be read."
    s.add({"kind": "note", "path": P}, now=NOW)
    asides = list(s.file.parent.glob("work-queue-*.unreadable-*.json"))
    assert len(asides) == 1 and asides[0].read_bytes() == b"\x00garbage"
    assert s.problem() is None


def test_finished_entries_capped(tmp_path):
    s = store(tmp_path)
    for i in range(520):
        s.add({"kind": "note", "path": P, "state": "done"}, now=NOW + timedelta(seconds=i))
    p = s.add({"kind": "note", "path": P}, now=NOW)
    f = s.add({"kind": "note", "path": P, "state": "failed"}, now=NOW)
    ents = s.entries()
    assert sum(e["state"] == "done" for e in ents) == 500
    assert {p["id"], f["id"]} <= {e["id"] for e in ents}


def test_a_no_op_edit_of_an_approved_step_withdraws_nothing():
    """Audit 10: an approved step's text and kind can't change, so an edit of one changed nothing
    and must not withdraw its entry."""
    assert plan_for_notice(notice("edit", before="approved", after="approved")) is None
    plan = plan_for_notice(notice("edit", before="open", after="open"))
    assert plan.withdraw_step == "r8k1pd" and plan.stop_running


def test_failed_entries_capped_too(tmp_path):
    """Audit 33: failed entries were kept forever; the most recent KEEP_FINISHED stay."""
    s = store(tmp_path)
    for i in range(510):
        s.add({"kind": "note", "path": P, "state": "failed"}, now=NOW + timedelta(seconds=i))
    pending = s.add({"kind": "note", "path": P}, now=NOW)
    ents = s.entries()
    failed = [e for e in ents if e["state"] == "failed"]
    assert len(failed) == 500
    assert failed[0]["createdAt"] == (NOW + timedelta(seconds=10)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    assert pending["id"] in {e["id"] for e in ents}
