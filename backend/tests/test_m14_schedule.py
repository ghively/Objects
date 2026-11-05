"""M14: schedules (ticks, sleeps, restarts), the catch-up answers, and never running a missed
occurrence silently."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from m14support import NOW, m14_space, served
from objectapp.automations import (
    MAX_PENDING,
    SKIPPED_CATCH_UP,
    run_log_path,
    state_path,
)
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object


@pytest.fixture
def root(tmp_path: Path) -> Path:
    return m14_space(tmp_path)


def weekly(**over):
    """Every Monday at 09:00 from 2026-11-02, a Page titled with the occurrence's day."""
    rule = {
        "name": "Weekly page",
        "trigger": {"kind": "schedule", "repeat": "every week", "time": "09:00", "start": "2026-11-02"},
        "actions": [{"kind": "createFromTemplate", "typeId": "page", "templateId": "none",
                     "title": "Week of {date:YYYY-MM-DD}"}],
    }  # fmt: skip
    rule.update(over)
    return rule


def pages(root: Path, prefix: str = "Week of ") -> list[str]:
    return sorted(p.stem for p in (root / "Pages").glob(f"{prefix}*.md"))


def events(s) -> list:
    seen: list = []
    real = s.engine.announce

    def record(ev):
        seen.append(ev)
        real(ev)

    s.engine.announce = record
    return seen


def at(s, when: datetime) -> list:
    s.clock.now = when
    res = s.client.post("/api/_test/tick")
    assert res.status_code == 200, res.text
    return res.json()["automationRuns"]


def test_a_schedule_runs_at_its_time_once(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(weekly())
        assert at(s, NOW + timedelta(minutes=55)) == []  # ticks come every 30 seconds
        runs = at(s, NOW + timedelta(minutes=60))
        assert len(runs) == 1 and runs[0]["trigger"]["scheduledFor"] == "2026-11-02T09:00:00.000Z"
        assert runs[0]["trigger"]["catchUp"] is False
        assert pages(root) == ["Week of 2026-11-02"]
        assert at(s, NOW + timedelta(minutes=61)) == []
        assert s.runs(rule["id"])[0]["id"] == runs[0]["id"]
        state = json.loads(state_path(root).read_text(encoding="utf-8"))
        assert state["rules"][rule["id"]]["lastDone"] == "2026-11-02T09:00:00.000Z"
        assert state["rules"][rule["id"]]["pending"] == []


def test_a_rule_made_after_its_time_owes_nothing(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path, now=NOW + timedelta(hours=3)) as s:
        s.create(weekly())
        assert at(s, NOW + timedelta(hours=3, minutes=1)) == []
        assert s.client.get("/api/automations/catch-up").json() == {"items": []}
        assert pages(root) == []


def test_after_a_sleep_missed_runs_wait_for_an_answer(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(weekly())
        seen = events(s)
        # The machine sleeps across Monday 09:00 and wakes 20 minutes later.
        assert at(s, NOW + timedelta(minutes=50)) == []
        assert at(s, NOW + timedelta(minutes=80)) == []
        assert pages(root) == []
        assert [(e.kind, e.path) for e in seen] == [("automationRuns", "catch-up")]
        items = s.client.get("/api/automations/catch-up").json()["items"]
        assert items == [{
            "ruleId": rule["id"], "name": "Weekly page", "missed": ["2026-11-02T09:00:00.000Z"],
            "count": 1, "capped": False, "createsObjects": True,
        }]  # fmt: skip
        # Later ticks don't run it either, and the next week's occurrence runs on time.
        assert at(s, NOW + timedelta(days=7, minutes=59)) == []
        assert len(at(s, NOW + timedelta(days=7, minutes=60))) == 1
        assert pages(root) == ["Week of 2026-11-09"]
        assert s.client.get("/api/automations/catch-up").json()["items"][0]["count"] == 1
        res = s.client.post("/api/automations/catch-up", json={"ruleId": rule["id"], "choice": "all"})
        assert res.status_code == 200
        assert pages(root) == ["Week of 2026-11-02", "Week of 2026-11-09"]
        assert s.client.get("/api/automations/catch-up").json() == {"items": []}
        assert s.client.post(
            "/api/automations/catch-up", json={"ruleId": rule["id"], "choice": "all"}
        ).status_code == 404


def restart_after_three_weeks(root, monkeypatch, tmp_path, rule=None):
    """Serve, make the rule, let Monday 09:00 run, stop; start again three weeks on (09:30)."""
    with served(root, monkeypatch, tmp_path) as s:
        made = s.create(rule or weekly())
        at(s, NOW + timedelta(minutes=55))
        at(s, NOW + timedelta(minutes=61))
        assert pages(root) == ["Week of 2026-11-02"]
    later = NOW + timedelta(days=21, hours=1, minutes=30)
    return made, later


def test_a_restart_lists_three_missed_weeks_and_runs_none(root, monkeypatch, tmp_path):
    made, later = restart_after_three_weeks(root, monkeypatch, tmp_path)
    with served(root, monkeypatch, tmp_path, now=later) as s:
        items = s.client.get("/api/automations/catch-up").json()["items"]
        assert [i["missed"] for i in items] == [[
            "2026-11-09T09:00:00.000Z", "2026-11-16T09:00:00.000Z", "2026-11-23T09:00:00.000Z",
        ]]  # fmt: skip
        # Nothing has run while the app was closed, nor on start.
        assert pages(root) == ["Week of 2026-11-02"] and len(s.runs(made["id"])) == 1
        # A tick doesn't run them either.
        assert at(s, later + timedelta(minutes=1)) == []
        res = s.client.post("/api/automations/catch-up", json={"ruleId": made["id"], "choice": "all"})
        runs = res.json()["runs"]
        assert [r["trigger"]["scheduledFor"] for r in runs] == items[0]["missed"]
        assert all(r["trigger"]["catchUp"] and r["status"] == "ok" for r in runs)
        assert pages(root) == [
            "Week of 2026-11-02", "Week of 2026-11-09", "Week of 2026-11-16", "Week of 2026-11-23"]
        made_at = parse_fm(split_object((root / "Pages" / "Week of 2026-11-16.md").read_text(
            encoding="utf-8")).frontmatter_src or "")  # fmt: skip
        assert made_at["title"] == "Week of 2026-11-16"
    # Answered once: the next start owes nothing more.
    with served(root, monkeypatch, tmp_path, now=later + timedelta(minutes=5)) as s:
        assert s.client.get("/api/automations/catch-up").json() == {"items": []}


def test_run_the_latest_only(root, monkeypatch, tmp_path):
    made, later = restart_after_three_weeks(root, monkeypatch, tmp_path)
    with served(root, monkeypatch, tmp_path, now=later) as s:
        res = s.client.post("/api/automations/catch-up", json={"ruleId": made["id"], "choice": "latest"})
        assert [r["trigger"]["scheduledFor"] for r in res.json()["runs"]] == ["2026-11-23T09:00:00.000Z"]
        assert pages(root) == ["Week of 2026-11-02", "Week of 2026-11-23"]
        assert s.client.get("/api/automations/catch-up").json() == {"items": []}


def test_skip_runs_nothing_and_logs_it(root, monkeypatch, tmp_path):
    made, later = restart_after_three_weeks(root, monkeypatch, tmp_path)
    with served(root, monkeypatch, tmp_path, now=later) as s:
        res = s.client.post("/api/automations/catch-up", json={"ruleId": made["id"], "choice": "skip"})
        runs = res.json()["runs"]
        assert len(runs) == 1 and runs[0]["status"] == "skipped"
        assert runs[0]["actions"][0]["detail"] == SKIPPED_CATCH_UP
        assert pages(root) == ["Week of 2026-11-02"]
        assert s.runs(made["id"])[0]["id"] == runs[0]["id"]
        assert s.client.get("/api/automations/catch-up").json() == {"items": []}
        # The next occurrence runs as usual.
        assert at(s, datetime(2026, 11, 30, 8, 59, tzinfo=UTC)) == []
        assert len(at(s, datetime(2026, 11, 30, 9, 0, tzinfo=UTC))) == 1


def test_the_list_holds_at_most_fifty_and_says_so(root, monkeypatch, tmp_path):
    rule = weekly(trigger={"kind": "schedule", "repeat": "every day", "time": "07:00", "start": "2026-11-01"})
    with served(root, monkeypatch, tmp_path) as s:
        made = s.create(rule)
    with served(root, monkeypatch, tmp_path, now=NOW + timedelta(days=70)) as s:
        item = s.client.get("/api/automations/catch-up").json()["items"][0]
        assert item["count"] == MAX_PENDING and item["capped"] is True
        assert item["missed"][-1] == "2027-01-11T07:00:00.000Z"
        s.client.post("/api/automations/catch-up", json={"ruleId": made["id"], "choice": "latest"})
        assert pages(root) == ["Week of 2027-01-11"]


def test_turning_a_rule_off_drops_what_it_owed(root, monkeypatch, tmp_path):
    made, later = restart_after_three_weeks(root, monkeypatch, tmp_path)
    with served(root, monkeypatch, tmp_path, now=later) as s:
        seen = events(s)
        lr = s.client.get(f"/api/automations/{made['id']}").json()
        res = s.client.put(f"/api/automations/{made['id']}", json={
            "rule": {**weekly(), "enabled": False}, "baseRevision": lr["revision"]})
        assert res.status_code == 200, res.text
        assert s.client.get("/api/automations/catch-up").json() == {"items": []}
        assert ("automationRuns", "catch-up") in [(e.kind, e.path) for e in seen]
        # Back on: counting starts now, nothing is owed from before.
        lr = res.json()["rule"]
        s.client.put(f"/api/automations/{made['id']}", json={
            "rule": weekly(), "baseRevision": lr["revision"]})
        assert s.client.get("/api/automations/catch-up").json() == {"items": []}
        assert at(s, later + timedelta(hours=1)) == []
        assert pages(root) == ["Week of 2026-11-02"]


def test_an_unreadable_state_file_owes_nothing(root, monkeypatch, tmp_path):
    made, later = restart_after_three_weeks(root, monkeypatch, tmp_path)
    state_path(root).write_text("{broken", encoding="utf-8")
    with served(root, monkeypatch, tmp_path, now=later) as s:
        assert s.client.get("/api/automations/catch-up").json() == {"items": []}
        assert pages(root) == ["Week of 2026-11-02"] and len(s.runs(made["id"])) == 1
    json.loads(state_path(root).read_text(encoding="utf-8"))  # replaced by a good one


def test_opening_and_reading_writes_nothing(root, monkeypatch, tmp_path):
    before = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
    with served(root, monkeypatch, tmp_path, now=NOW) as s:
        assert s.client.get("/api/automations").json() == []
        assert s.client.get("/api/automations/catch-up").json() == {"items": []}
        at(s, NOW + timedelta(hours=2))
    assert not state_path(root).exists()
    assert not run_log_path(root, "x").parent.exists()
    after = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
    assert after == before
    # With a rule, reads stay reads: listing and fetching change no file.
    with served(root, monkeypatch, tmp_path) as s:
        made = s.create(weekly(enabled=False))
        rule_file = root / ".object" / "automations" / f"{made['id']}.json"
        snapshot = rule_file.read_bytes()
        s.client.get("/api/automations")
        s.client.get(f"/api/automations/{made['id']}")
        s.client.get(f"/api/automations/{made['id']}/runs")
        assert rule_file.read_bytes() == snapshot
    assert not run_log_path(root, made["id"]).exists()


def test_template_repeat_names_the_template_and_is_one_per_template(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        tpath = s.client.post("/api/types/page/templates", json={"name": "Weekly plan"}).json()["path"]
        tid = parse_fm(split_object((root / tpath).read_text(encoding="utf-8")).frontmatter_src or "")["id"]
        rule = weekly(
            name="Repeat Weekly plan",
            actions=[{"kind": "createFromTemplate", "typeId": "page", "templateId": tid,
                      "title": "Plan {date:YYYY-MM-DD}"}],
            templateRepeat={"typeId": "page", "templateId": tid},
        )  # fmt: skip
        made = s.create(rule)
        s.create(rule, status=422)
        at(s, NOW + timedelta(minutes=50))
        at(s, NOW + timedelta(minutes=80))  # a sleep
        items = s.client.get("/api/automations/catch-up").json()["items"]
        assert [(i["ruleId"], i["name"]) for i in items] == [(made["id"], "Weekly plan")]
