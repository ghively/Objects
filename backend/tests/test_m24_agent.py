"""M24 Task 5: the Work agent, its skill, the change-reviewer copy and the entry prompts."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from objectapp import agentskills, settings, workagent
from objectapp.agents import AgentRegistry
from objectapp.workagentmodel import ENTRY_KINDS, NOT_SET, REMOTE_REFUSED
from objectapp.workprompts import WORK_SKILL, WORK_SOUL, entry_prompt

FIXTURES = Path(__file__).parent / "fixtures"
HEADINGS = ("## One entry, one step", "## Change-review gate", "## Questions", "## Steps", "## Never")


@pytest.fixture
def registry() -> AgentRegistry:
    return AgentRegistry()


def _home(tmp_path: Path, name: str) -> Path:
    dest = tmp_path / name
    shutil.copytree(FIXTURES / name, dest)
    return dest


def test_create_work_agent(registry: AgentRegistry, tmp_path: Path) -> None:
    rec = workagent.create_work_agent(registry, user="Gene", copy_change_reviewer=False, home=tmp_path)
    assert rec.data["name"] == "Work" and rec.data["icon"] == "ph-briefcase"
    assert rec.data["toolsOff"] == []
    soul = (rec.folder / "CLAUDE.md").read_text(encoding="utf-8")
    assert "Load the work-follow-through skill before acting on any work queue entry." in soul
    skills = {s.name: s for s in agentskills.list_skills(rec.folder)}
    assert skills["work-follow-through"].created_by == "user"
    text = (rec.folder / ".claude" / "skills" / "work-follow-through" / "SKILL.md").read_text(encoding="utf-8")
    assert all(h in text for h in HEADINGS)
    assert settings.read()[0]["workAgentId"] == rec.id
    second = workagent.create_work_agent(registry, user="Gene", copy_change_reviewer=False, home=tmp_path)
    assert second.data["name"] == "Work 2"


def test_skill_carries_the_rules() -> None:
    text = WORK_SKILL
    for needle in ("Change review: PASS", "When is <host> idle?", "3 to 6",
                   "If a change-reviewer subagent is available, have it check the plan."):
        assert needle in text
    assert "one question at a time" in text.lower()
    never = text.split("## Never")[1]
    assert "never" in never.lower() and "ServiceNow" in never
    assert "Load the work-follow-through skill before acting on any work queue entry." in WORK_SOUL


def test_change_reviewer_copy(registry: AgentRegistry, tmp_path: Path) -> None:
    home = _home(tmp_path, "home-reviewer")
    found = workagent.find_change_reviewer(home)
    assert found == home / ".claude" / "agents" / "change-reviewer.md"
    before = found.read_bytes()
    rec = workagent.create_work_agent(registry, user="Gene", copy_change_reviewer=True, home=home)
    assert (rec.folder / ".claude" / "agents" / "change-reviewer.md").read_bytes() == before
    assert found.read_bytes() == before
    plugin = _home(tmp_path, "home-reviewer-plugin")
    assert workagent.find_change_reviewer(plugin).name == "change-reviewer.md"
    # ignored candidates
    bad = tmp_path / "bad"
    agents = bad / ".claude" / "agents"
    agents.mkdir(parents=True)
    (agents / "change-reviewer.md").write_text("---\nname: other\n---\n", encoding="utf-8")
    assert workagent.find_change_reviewer(bad) is None
    (agents / "change-reviewer.md").unlink()
    (agents / "change-reviewer.md").mkdir()
    assert workagent.find_change_reviewer(bad) is None
    (agents / "change-reviewer.md").rmdir()
    (agents / "change-reviewer.md").write_text(
        "---\nname: change-reviewer\n---\n" + "x" * workagent.CHANGE_REVIEWER_MAX, encoding="utf-8")
    assert workagent.find_change_reviewer(bad) is None
    empty = tmp_path / "empty"
    empty.mkdir()
    rec2 = workagent.create_work_agent(registry, user="Gene", copy_change_reviewer=True, home=empty)
    assert not (rec2.folder / ".claude" / "agents" / "change-reviewer.md").exists()


def test_work_agent_problems(registry: AgentRegistry, tmp_path: Path) -> None:
    assert workagent.work_agent(registry, {"workAgentId": None}) == (None, NOT_SET)
    assert workagent.work_agent(registry, {"workAgentId": "01NOPE"}) == (None, "That agent isn't listed any more.")
    rec = workagent.create_work_agent(registry, user="Gene", copy_change_reviewer=False, home=tmp_path)
    assert workagent.work_agent(registry, {"workAgentId": rec.id})[1] is None
    again = workagent.ensure_work_agent(registry, {"workAgentId": rec.id}, user="Gene", home=tmp_path)
    assert again.id == rec.id and len(registry.list()) == len([r for r in registry.list()])
    made = workagent.ensure_work_agent(registry, {"workAgentId": None}, user="Gene", home=tmp_path)
    assert made.id != rec.id and made.data["name"] == "Work 2"
    remote = registry.get(rec.id)
    from dataclasses import replace
    fake = replace(remote, kind="remote")
    registry_get = registry.get
    registry.get = lambda i: fake if i == rec.id else registry_get(i)  # type: ignore[method-assign]
    assert workagent.work_agent(registry, {"workAgentId": rec.id}) == (None, REMOTE_REFUSED)


SENTENCES = {
    "approve": "approved exactly this one step. Follow the change-review gate",
    "run": "Do this Agent step read-only",
    "answer": "answered this question. Work the answer into the item",
    "done": "Gene did this step.",
    "decline": "Gene declined this step.",
    "note": "Work this note into the item.",
    "request": "Do what Gene asks if it is read-only",
    "capture": "File this brain dump with file_capture",
    "breakDown": "Replace step 2 with 3 to 6 smaller ordered steps",
    "question": "Answer Gene's question on the item",
}


@pytest.mark.parametrize("kind", ENTRY_KINDS)
def test_entry_prompts(kind: str) -> None:
    entry = {"id": "01JCX", "kind": kind, "path": "Tasks/Printer jams on line 3.md", "stepId": "r8k1pd",
             "stepN": 2, "stepKind": "approve", "stepText": "Restart the print spooler on PRN-TEST-01",
             "text": "Line one\nline two [[Link]] ---", "capturePath": "Captures/x.md" if kind == "capture" else None,
             "notBefore": "2026-11-06T22:00:00Z" if kind == "approve" else None, "title": "Printer jams on line 3"}
    item = {"title": "Printer jams on line 3", "ticket": {"id": "INC0012345"}, "turn": "agent",
            "steps": [{"id": "a", "kind": "do", "text": "x"},
                      {"id": "r8k1pd", "kind": "approve", "text": "Restart the print spooler on PRN-TEST-01"}]}
    out = entry_prompt(entry, item, None, user="Gene", step_rev="REV1")
    assert out.splitlines()[0] == f"Work queue entry 01JCX: {kind}."
    ref = out.splitlines()[1]
    assert "path=Tasks/Printer jams on line 3.md" in ref and "step=r8k1pd" in ref and "rev=REV1" in ref
    assert SENTENCES[kind] in out
    assert "Line one\nline two [[Link]] ---" in out
    assert "Step 2 of 2" in out
    if kind == "approve":
        assert "2026-11-06T22:00:00Z" in out
