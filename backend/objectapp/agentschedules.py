"""M21 agent schedules: the helpers around a schedule rule (an M14 rule whose one action is
``runAgent``), the agent-facing schedule shape, and the machine-wide schedules index
``<state>/agent-schedules.json`` that tells M18's curator which skills schedules use, also for
spaces that aren't open (plan `docs/superpowers/plans/2026-11-05-m21-schedules.md`, "Schedules
index" and "Agent-facing shape and routes").

The index (``dump_json``, written atomically, only when its content changes)::

    {"v": 1, "spaces": {"<appstate.space_key>": {"name", "path", "schedules": {
        "<ruleId>": {"agentId", "name", "prompt", "enabled", "usedSkills": [...]}}}}}

T1 (the contract) holds the constants and `is_agent_schedule`; T2 fills the rest. T2 also sets
M18's ``agentskills.SCHEDULE_SKILLS = skills_in_use`` at import.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .automations_model import AutomationRule, agent_action

if TYPE_CHECKING:
    from .automations import LoadedRule

__all__ = [
    "INDEX_FILE",
    "MAX_USED",
    "IndexUnreadable",
    "ScheduleIndex",
    "default_start",
    "is_agent_schedule",
    "rule_payload",
    "schedule_v1",
    "skills_in_use",
]

INDEX_FILE = "agent-schedules.json"
MAX_USED = 100
"""Skill names kept per schedule in ``usedSkills``, the newest (our cap)."""


def is_agent_schedule(rule: AutomationRule | None) -> bool:
    """Whether ``rule`` is an agent schedule (it has a ``runAgent`` action)."""
    return rule is not None and agent_action(rule) is not None


class IndexUnreadable(Exception):
    """The schedules index file can't be read; M18's curator then leaves the agent alone."""


class ScheduleIndex:
    """The machine-wide schedules index in the state dir (``<state>/agent-schedules.json``)."""

    def __init__(self, state: Path | None = None) -> None:
        self.state = state

    def sync_space(self, space_root: Path, space_name: str, rules: Iterable[LoadedRule]) -> bool:
        """Replace that space's entries with its readable ``runAgent`` rules (enabled or not),
        keeping each entry's ``usedSkills``; a read-only rule file keeps its old entry. Writes only
        when the content differs, and never creates the file when it would hold nothing. Returns
        whether it wrote."""
        raise NotImplementedError

    def record_used(self, space_root: Path, rule_id: str, skills: Iterable[str]) -> None:
        """Add ``skills`` to the entry's ``usedSkills`` (the newest `MAX_USED`, no duplicates)."""
        raise NotImplementedError

    def entries(self, agent_id: str) -> list[dict[str, Any]]:
        """Every space's entries for this agent."""
        raise NotImplementedError


def skills_in_use(folder: Path) -> set[str]:
    """M18's ``agentskills.SCHEDULE_SKILLS``: the skills schedules of the agent in ``folder`` use
    (their ``usedSkills``, plus the agent's current skills named in a prompt as a whole name). No
    index file: the empty set. An unreadable index raises `IndexUnreadable`."""
    raise NotImplementedError


def schedule_v1(lr: LoadedRule, last_run: dict[str, Any] | None, now: datetime, tz: Any, week_start: str) -> dict[str, Any]:
    """The agent-facing ``ScheduleV1`` of a schedule rule."""
    raise NotImplementedError


def default_start(repeat: str, today: date, tz: Any, week_start: str) -> str:
    """The first day on or after ``today`` that ``repeat`` reaches (``YYYY-MM-DD``)."""
    raise NotImplementedError


def rule_payload(agent_id: str, *, name: str, prompt: str, repeat: str, time: str, start: str,
                 model: str | None, enabled: bool) -> dict[str, Any]:
    """An ``AutomationRuleInput`` dict for an agent schedule."""
    raise NotImplementedError
