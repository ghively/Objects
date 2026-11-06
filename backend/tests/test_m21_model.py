"""M21 Task 2: an agent schedule validates against the agent registry through M14's routes,
older versions read an unknown action kind as read-only, and the agent-facing schedule shape
(`agentschedules.schedule_v1`, `default_start`, `rule_payload`)."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from m14support import NOW, m14_space, served
from objectapp import agentschedules
from objectapp.agents import AgentInput, AgentRegistry
from objectapp.automations import load_rule

RESEARCHER_PROMPT = "Review last week's notes ({date:YYYY-MM-DD}) and list open tasks."


@pytest.fixture
def root(tmp_path: Path) -> Path:
    return m14_space(tmp_path)


@pytest.fixture
def researcher() -> str:
    return AgentRegistry().create(AgentInput(name="Researcher"), "Dig.\n").id


def schedule(agent_id: str, **over: Any) -> dict[str, Any]:
    rule: dict[str, Any] = {
        "name": "Weekly review",
        "trigger": {"kind": "schedule", "repeat": "every week on monday", "time": "09:00", "start": "2026-11-09"},
        "actions": [{"kind": "runAgent", "agentId": agent_id, "prompt": RESEARCHER_PROMPT, "model": None}],
    }
    rule.update(over)
    return rule


def _rule_file(root: Path, rule_id: str) -> Path:
    return root / ".object" / "automations" / f"{rule_id}.json"


def test_create_through_m14_route(root, monkeypatch, tmp_path, researcher) -> None:
    with served(root, monkeypatch, tmp_path) as s:
        made = s.create(schedule(researcher))
        data = json.loads(_rule_file(root, made["id"]).read_text(encoding="utf-8"))
        assert data["actions"] == [{"kind": "runAgent", "agentId": researcher, "prompt": RESEARCHER_PROMPT,
                                    "model": None}]
        listed = {r["id"]: r for r in s.client.get("/api/automations").json()}
        assert listed[made["id"]]["lastRun"] is None
        assert listed[made["id"]]["readOnlyReason"] is None
        # The default agent can be scheduled too.
        s.create(schedule("assistant", name="Daily"))


def test_unknown_agent_and_remote_refused(root, monkeypatch, tmp_path) -> None:
    with served(root, monkeypatch, tmp_path) as s:
        res = s.client.post("/api/automations", json={"rule": schedule("01JC7ZK3T9Q4M2X8B5N6R1V0WE")})
        assert res.status_code == 422, res.text
        assert "That agent isn't listed any more." in res.text
        assert not (root / ".object" / "automations").exists() or not list((root / ".object" / "automations").iterdir())


def test_remote_agent_refused(root, monkeypatch, tmp_path) -> None:
    reg = AgentRegistry()
    remote_id = "01JC7ZK3T9Q4M2X8B5N6R1V0WR"
    folder = reg.agents_dir / "Far away"
    (folder / ".object-agent").mkdir(parents=True)
    reg.path.parent.mkdir(parents=True, exist_ok=True)
    reg.path.write_text(json.dumps({"agents": [{"id": remote_id, "path": str(folder), "kind": "remote",
                                                "addedAt": "2026-11-01T00:00:00.000Z"}]}), encoding="utf-8")
    assert reg.get(remote_id).kind == "remote"
    with served(root, monkeypatch, tmp_path) as s:
        res = s.client.post("/api/automations", json={"rule": schedule(remote_id)})
        assert res.status_code == 422, res.text
        assert "Schedules run Object's own agents, not remote ones." in res.text


def test_switch_only_save_skips_agent_check(root, monkeypatch, tmp_path, researcher) -> None:
    with served(root, monkeypatch, tmp_path) as s:
        made = s.create(schedule(researcher))
        AgentRegistry().unregister(researcher)
        assert researcher not in {a.id for a in AgentRegistry().list()}
        off = {k: v for k, v in made.items() if k not in ("id", "revision", "readOnlyReason", "lastRun")}
        res = s.client.put(f"/api/automations/{made['id']}",
                           json={"rule": {**off, "enabled": False}, "baseRevision": made["revision"]})
        assert res.status_code == 200, res.text
        again = res.json()["rule"]
        edited = {**off, "enabled": True, "actions": [{**off["actions"][0], "prompt": "Something else."}]}
        res = s.client.put(f"/api/automations/{made['id']}",
                           json={"rule": edited, "baseRevision": again["revision"]})
        assert res.status_code == 422 and "That agent isn't listed any more." in res.text


def test_unknown_action_kind_stays_read_only(root, monkeypatch, tmp_path) -> None:
    rid = "01JFUTURE00000000000000000"
    folder = root / ".object" / "automations"
    folder.mkdir(parents=True)
    rule = schedule("assistant", actions=[{"kind": "futureKind", "x": 1}], enabled=True, schemaVersion=1,
                    createdAt="2026-11-01T00:00:00.000Z", description="", templateRepeat=None,
                    conditions={"type": "filterGroup", "operator": "and", "elements": []},
                    trigger={"kind": "schedule", "repeat": "every day", "time": "09:00", "start": "2026-11-01"})
    _rule_file(root, rid).write_text(json.dumps(rule), encoding="utf-8")
    before = _rule_file(root, rid).read_bytes()
    with served(root, monkeypatch, tmp_path) as s:
        listed = {r["id"]: r for r in s.client.get("/api/automations").json()}
        assert listed[rid]["readOnlyReason"]
        for hours in (1, 2, 30):
            s.clock.now = NOW + timedelta(hours=hours)
            assert s.client.post("/api/_test/tick").json()["automationRuns"] == []
        assert s.runs(rid) == []
        res = s.client.put(f"/api/automations/{rid}", json={"rule": schedule("assistant"),
                                                             "baseRevision": listed[rid]["revision"]})
        assert res.status_code == 423
    assert _rule_file(root, rid).read_bytes() == before


def test_unknown_keys_kept(root, monkeypatch, tmp_path, researcher) -> None:
    with served(root, monkeypatch, tmp_path) as s:
        made = s.create(schedule(researcher))
        f = _rule_file(root, made["id"])
        data = json.loads(f.read_text(encoding="utf-8"))
        data["x"] = 1
        f.write_text(json.dumps(data), encoding="utf-8")
        lr = s.engine.rules.get(made["id"])
        body = schedule(researcher, actions=[{"kind": "runAgent", "agentId": researcher, "prompt": "New prompt",
                                              "model": None}])
        res = s.client.put(f"/api/automations/{made['id']}", json={"rule": body, "baseRevision": lr.revision})
        assert res.status_code == 200, res.text
        saved = json.loads(f.read_text(encoding="utf-8"))
        assert saved["x"] == 1 and saved["actions"][0]["prompt"] == "New prompt"


def test_default_start() -> None:
    thursday = date(2026, 11, 5)
    assert agentschedules.default_start("every week on monday", thursday, UTC, "monday") == "2026-11-09"
    assert agentschedules.default_start("every day", thursday, UTC, "monday") == "2026-11-05"
    assert agentschedules.default_start("every week on thursday", thursday, UTC, "monday") == "2026-11-05"
    assert agentschedules.default_start("every weekday", date(2026, 11, 7), UTC, "monday") == "2026-11-09"
    assert agentschedules.default_start("every month on the 1st", thursday, UTC, "monday") == "2026-12-01"


def _loaded(rule: dict[str, Any], rule_id: str = "01JSCHED000000000000000001") -> Any:
    data = {"schemaVersion": 1, "description": "", "enabled": True,
            "conditions": {"type": "filterGroup", "operator": "and", "elements": []},
            "templateRepeat": None, "createdAt": "2026-11-01T00:00:00.000Z", **rule}
    lr = load_rule(rule_id, data, "rev1", None)
    assert lr.rule is not None, lr.read_only_reason
    return lr


def test_schedule_v1() -> None:
    now = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
    lr = _loaded(schedule("assistant", trigger={"kind": "schedule", "repeat": "every week on monday",
                                                "time": "09:00", "start": "2026-11-02"}))
    run = {"id": "R1", "ruleId": lr.id, "at": "2026-11-02T09:00:05.000Z", "status": "ok",
           "trigger": {"kind": "schedule"}, "error": None,
           "actions": [{"index": 0, "kind": "runAgent", "status": "ok", "path": "AI Chats/Weekly review.md",
                        "detail": "Saved the chat."}]}
    v1 = agentschedules.schedule_v1(lr, run, now, UTC, "monday")
    assert v1 == {
        "id": lr.id, "name": "Weekly review", "prompt": RESEARCHER_PROMPT, "repeat": "every week on monday",
        "time": "09:00", "start": "2026-11-02", "model": None, "enabled": True, "readOnlyReason": None,
        "lastRun": {"at": "2026-11-02T09:00:05.000Z", "status": "ok", "path": "AI Chats/Weekly review.md",
                    "detail": "Saved the chat."},
        "nextRun": "2026-11-09T09:00:00.000Z",
    }
    off = _loaded(schedule("assistant", enabled=False))
    assert agentschedules.schedule_v1(off, None, now, UTC, "monday")["nextRun"] == "2026-11-09T09:00:00.000Z"
    assert agentschedules.schedule_v1(off, None, now, UTC, "monday")["lastRun"] is None
    ended = _loaded(schedule("assistant", trigger={"kind": "schedule", "repeat": "every day until 2026-11-01",
                                                   "time": "09:00", "start": "2026-10-01"}))
    assert agentschedules.schedule_v1(ended, None, now, UTC, "monday")["nextRun"] is None
    unreadable = load_rule("01JSCHED000000000000000002", {**schedule("assistant"), "actions": [{"kind": "x"}]},
                           "rev2", None)
    shown = agentschedules.schedule_v1(unreadable, None, now, UTC, "monday")
    assert shown["readOnlyReason"] and shown["nextRun"] is None and shown["name"] == "Weekly review"


def test_rule_payload_validates() -> None:
    payload = agentschedules.rule_payload("assistant", name="Daily", prompt="Hi", repeat="every day",
                                          time="08:30", start="2026-11-05", model="haiku", enabled=False)
    assert payload == {
        "name": "Daily", "description": "", "enabled": False,
        "trigger": {"kind": "schedule", "repeat": "every day", "time": "08:30", "start": "2026-11-05"},
        "conditions": {"type": "filterGroup", "operator": "and", "elements": []},
        "actions": [{"kind": "runAgent", "agentId": "assistant", "prompt": "Hi", "model": "haiku"}],
        "templateRepeat": None,
    }
    assert agentschedules.is_agent_schedule(_loaded(payload).rule)
