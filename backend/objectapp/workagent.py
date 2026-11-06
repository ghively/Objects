"""The work agent: its setting, "Create the Work agent", the soul and the skill (M24 T5).

T1 ships the constants and signatures; T5 fills them.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .agents import AgentRecord, AgentRegistry

__all__ = [
    "CHANGE_REVIEWER",
    "CHANGE_REVIEWER_MAX",
    "SKILL_DESCRIPTION",
    "SKILL_NAME",
    "WORK_AGENT_COLOR",
    "WORK_AGENT_ICON",
    "WORK_AGENT_NAME",
    "create_work_agent",
    "ensure_work_agent",
    "find_change_reviewer",
    "work_agent",
]

WORK_AGENT_NAME = "Work"
WORK_AGENT_ICON = "ph-briefcase"
WORK_AGENT_COLOR = "teal"
SKILL_NAME = "work-follow-through"
SKILL_DESCRIPTION = "Carry work items: steps, approvals, questions"  # M18: 1-60 characters
CHANGE_REVIEWER = "change-reviewer.md"
CHANGE_REVIEWER_MAX = 256 * 1024


def find_change_reviewer(home: Path) -> Path | None:
    raise NotImplementedError("M24 T5")


def create_work_agent(registry: AgentRegistry, *, user: str, copy_change_reviewer: bool, home: Path) -> AgentRecord:
    raise NotImplementedError("M24 T5")


def work_agent(registry: AgentRegistry, settings: dict[str, Any]) -> tuple[AgentRecord | None, str | None]:
    """(record, problem); T1: NOT_SET unless an id is set (T5 adds the registry checks)."""
    from .workagentmodel import NOT_SET

    if not settings.get("workAgentId"):
        return None, NOT_SET
    raise NotImplementedError("M24 T5")


def ensure_work_agent(registry: AgentRegistry, settings: dict[str, Any], *, user: str, home: Path) -> AgentRecord:
    raise NotImplementedError("M24 T5")
