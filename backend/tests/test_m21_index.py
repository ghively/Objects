"""M21 Task 2: the machine-wide schedules index (`<state>/agent-schedules.json`) and the
skills it protects from M18's curator, in every space, open or not."""

from __future__ import annotations

import importlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from objectapp import agentschedules, agentskills, curator
from objectapp.agents import AgentInput, AgentRecord, AgentRegistry
from objectapp.agentschedules import INDEX_FILE, IndexUnreadable, ScheduleIndex, skills_in_use
from objectapp.appstate import space_key, state_dir
from objectapp.automations import LoadedRule, load_rule
from objectapp.learningmodel import USAGE_FILE

CHAT_SOURCE = {"kind": "chat", "agentId": "a", "chatId": None, "run": None}


def _space(tmp_path: Path, name: str) -> Path:
    root = tmp_path / name
    root.mkdir()
    return root


def _rule(agent_id: str, rule_id: str, *, name: str = "Weekly review", prompt: str = "Review the week.",
          enabled: bool = True) -> LoadedRule:
    data = {
        "schemaVersion": 1, "name": name, "description": "", "enabled": enabled,
        "trigger": {"kind": "schedule", "repeat": "every week on monday", "time": "09:00", "start": "2026-11-09"},
        "conditions": {"type": "filterGroup", "operator": "and", "elements": []},
        "actions": [{"kind": "runAgent", "agentId": agent_id, "prompt": prompt, "model": None}],
        "templateRepeat": None, "createdAt": "2026-11-01T00:00:00.000Z",
    }
    lr = load_rule(rule_id, data, "rev", None)
    assert lr.rule is not None
    return lr


def _notify_rule(rule_id: str) -> LoadedRule:
    data = {
        "schemaVersion": 1, "name": "Ping", "description": "", "enabled": True,
        "trigger": {"kind": "schedule", "repeat": "every day", "time": "09:00", "start": "2026-11-09"},
        "conditions": {"type": "filterGroup", "operator": "and", "elements": []},
        "actions": [{"kind": "notify", "title": "Ping"}], "templateRepeat": None,
        "createdAt": "2026-11-01T00:00:00.000Z",
    }
    lr = load_rule(rule_id, data, "rev", None)
    assert lr.rule is not None
    return lr


def _researcher(*skills: str) -> AgentRecord:
    agent = AgentRegistry().create(AgentInput(name="Researcher"), "Dig.\n")
    for name in skills:
        agentskills.manage(agent.folder, "create", name=name, source=CHAT_SOURCE, memo_key=None,
                           description=f"About {name}", content="Do it.\n")
    return agent


def _index_path() -> Path:
    return state_dir() / INDEX_FILE


def _read() -> dict[str, Any]:
    return json.loads(_index_path().read_text(encoding="utf-8"))


def test_sync_writes_only_on_change(tmp_path: Path) -> None:
    root = _space(tmp_path, "Notes")
    idx = ScheduleIndex()
    assert idx.sync_space(root, "Notes", []) is False
    assert idx.sync_space(root, "Notes", [_notify_rule("01JN0000000000000000000001")]) is False
    assert not _index_path().exists()
    rule = _rule("assistant", "01JR0000000000000000000001")
    assert idx.sync_space(root, "Notes", [rule]) is True
    data = _read()
    assert data["v"] == 1
    entry = data["spaces"][space_key(root)]
    assert entry["name"] == "Notes" and entry["path"] == root.resolve().as_posix()
    assert entry["schedules"] == {"01JR0000000000000000000001": {
        "agentId": "assistant", "name": "Weekly review", "prompt": "Review the week.", "enabled": True,
        "usedSkills": []}}
    past = 1_600_000_000
    os.utime(_index_path(), (past, past))
    assert idx.sync_space(root, "Notes", [rule]) is False
    assert _index_path().stat().st_mtime == past
    assert idx.sync_space(root, "Notes", [_rule("assistant", rule.id, name="Renamed")]) is True
    assert _read()["spaces"][space_key(root)]["schedules"][rule.id]["name"] == "Renamed"
    # A turned-off schedule stays listed (it still protects its skills).
    assert idx.sync_space(root, "Notes", [_rule("assistant", rule.id, name="Renamed", enabled=False)]) is True
    assert _read()["spaces"][space_key(root)]["schedules"][rule.id]["enabled"] is False


def test_read_only_rule_keeps_its_entry(tmp_path: Path) -> None:
    root = _space(tmp_path, "Notes")
    idx = ScheduleIndex()
    rule = _rule("assistant", "01JR0000000000000000000001")
    idx.sync_space(root, "Notes", [rule])
    idx.record_used(root, rule.id, ["weekly-report"])
    broken = LoadedRule(rule.id, "rev2", None, None, "This automation can't be read.")
    assert idx.sync_space(root, "Notes", [broken]) is False
    assert _read()["spaces"][space_key(root)]["schedules"][rule.id]["usedSkills"] == ["weekly-report"]
    # Its usedSkills survive a later edit of the schedule.
    assert idx.sync_space(root, "Notes", [_rule("assistant", rule.id, prompt="Other.")]) is True
    assert _read()["spaces"][space_key(root)]["schedules"][rule.id]["usedSkills"] == ["weekly-report"]


def test_record_used_keeps_newest_100(tmp_path: Path) -> None:
    root = _space(tmp_path, "Notes")
    idx = ScheduleIndex()
    rule = _rule("assistant", "01JR0000000000000000000001")
    idx.sync_space(root, "Notes", [rule])
    idx.record_used(root, rule.id, [f"skill-{n}" for n in range(120)])
    idx.record_used(root, rule.id, ["skill-119", "skill-50"])
    used = _read()["spaces"][space_key(root)]["schedules"][rule.id]["usedSkills"]
    assert len(used) == 100 and len(set(used)) == 100
    assert used[-1] == "skill-50" and used[-2] == "skill-119"
    assert "skill-0" not in used and "skill-19" not in used
    # An unknown rule records nothing.
    before = _index_path().read_bytes()
    idx.record_used(root, "01JR0000000000000000000009", ["x"])
    idx.record_used(root, rule.id, [])
    assert _index_path().read_bytes() == before


def test_skills_in_use_across_spaces(tmp_path: Path) -> None:
    agent = _researcher("weekly-report", "notes")
    a, b = _space(tmp_path, "A"), _space(tmp_path, "B")
    idx = ScheduleIndex()
    idx.sync_space(a, "A", [_rule(agent.id, "01JRA000000000000000000001")])
    idx.sync_space(b, "B", [_rule(agent.id, "01JRB000000000000000000001")])
    idx.record_used(b, "01JRB000000000000000000001", ["weekly-report"])
    # Only A is open now: it syncs again without B's rules.
    idx.sync_space(a, "A", [_rule(agent.id, "01JRA000000000000000000001", name="Changed")])
    assert skills_in_use(agent.folder) == {"weekly-report"}
    assert {e["ruleId"] for e in idx.entries(agent.id)} == {"01JRA000000000000000000001",
                                                            "01JRB000000000000000000001"}
    assert idx.entries("assistant") == []


def test_prompt_mentions_are_whole_names(tmp_path: Path) -> None:
    agent = _researcher("report", "weekly-report", "notes")
    root = _space(tmp_path, "A")
    idx = ScheduleIndex()
    idx.sync_space(root, "A", [_rule(agent.id, "01JRA000000000000000000001", prompt="Use /weekly-report, then tidy.")])
    assert skills_in_use(agent.folder) == {"weekly-report"}
    idx.sync_space(root, "A", [_rule(agent.id, "01JRA000000000000000000001", prompt="Use the NOTES skill")])
    assert skills_in_use(agent.folder) == {"notes"}
    idx.sync_space(root, "A", [_rule(agent.id, "01JRA000000000000000000001", prompt="Take notesy notes_x")])
    assert skills_in_use(agent.folder) == set()


def test_deleted_rule_unprotects(tmp_path: Path) -> None:
    agent = _researcher("weekly-report")
    root = _space(tmp_path, "A")
    idx = ScheduleIndex()
    rule = _rule(agent.id, "01JRA000000000000000000001")
    idx.sync_space(root, "A", [rule])
    idx.record_used(root, rule.id, ["weekly-report"])
    assert skills_in_use(agent.folder) == {"weekly-report"}
    assert idx.sync_space(root, "A", []) is True
    assert skills_in_use(agent.folder) == set()
    assert space_key(root) not in _read()["spaces"]


def test_other_agents_not_counted(tmp_path: Path) -> None:
    agent = _researcher("weekly-report")
    root = _space(tmp_path, "A")
    idx = ScheduleIndex()
    rule = _rule("assistant", "01JRA000000000000000000001", prompt="Run weekly-report.")
    idx.sync_space(root, "A", [rule])
    idx.record_used(root, rule.id, ["weekly-report"])
    assert skills_in_use(agent.folder) == set()


def test_no_index_is_empty(tmp_path: Path) -> None:
    agent = _researcher("weekly-report")
    assert skills_in_use(agent.folder) == set()
    assert ScheduleIndex().entries(agent.id) == []
    assert not _index_path().exists()


def test_unreadable_index(tmp_path: Path) -> None:
    agent = _researcher("weekly-report", "notes")
    # Both skills are long unused: without the index, the curator would archive them.
    usage = agent.folder / USAGE_FILE
    data = json.loads(usage.read_text(encoding="utf-8")) if usage.exists() else {"v": 1, "skills": {}}
    for n in ("weekly-report", "notes"):
        data.setdefault("skills", {}).setdefault(n, {})["lastUsed"] = "2026-01-01T00:00:00.000Z"
    usage.parent.mkdir(parents=True, exist_ok=True)
    usage.write_text(json.dumps(data), encoding="utf-8")
    state_dir().mkdir(parents=True, exist_ok=True)
    _index_path().write_text("{nope", encoding="utf-8")
    with pytest.raises(IndexUnreadable):
        skills_in_use(agent.folder)
    with pytest.raises(IndexUnreadable):
        ScheduleIndex().entries(agent.id)
    before = {p.name: p.read_bytes() for p in (agent.folder / ".claude" / "skills").rglob("*") if p.is_file()}
    now = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
    assert curator.deterministic_pass(agent.folder, now, run_id="C1", agent_id=agent.id) == []
    after = {p.name: p.read_bytes() for p in (agent.folder / ".claude" / "skills").rglob("*") if p.is_file()}
    assert after == before
    root = _space(tmp_path, "A")
    assert ScheduleIndex().sync_space(root, "A", [_rule(agent.id, "01JRA000000000000000000001")]) is True
    aside = list(state_dir().glob("agent-schedules.unreadable-*.json"))
    assert len(aside) == 1 and aside[0].read_text(encoding="utf-8") == "{nope"
    assert skills_in_use(agent.folder) == set()
    # A readable index protects what a schedule uses; the rest is archived as usual.
    ScheduleIndex().record_used(root, "01JRA000000000000000000001", ["weekly-report"])
    made = curator.deterministic_pass(agent.folder, now, run_id="C2", agent_id=agent.id)
    assert made and all("weekly-report" not in json.dumps(e) for e in made)
    states = {i.name: i.state for i in agentskills.list_skills(agent.folder, archived=True)}
    assert states["weekly-report"] == "active" and states["notes"] != "active"


def test_registered_with_curator() -> None:
    importlib.import_module("objectapp.agentschedules")
    assert agentskills.SCHEDULE_SKILLS is agentschedules.skills_in_use
    import objectapp.automations  # noqa: F401  - the app's import path sets it too

    assert agentskills.SCHEDULE_SKILLS is agentschedules.skills_in_use
