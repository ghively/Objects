"""The work agent: its setting, "Create the Work agent", the soul and the skill (M24 T5).

T1 ships the constants and signatures; T5 fills them.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from . import agentskills, settings, textfile
from .agentmodel import AgentInput
from .agents import AgentNotFound, AgentRecord, AgentRegistry
from .space import safe_filename
from .workagentmodel import NOT_SET, REMOTE_REFUSED
from .workprompts import WORK_SKILL, WORK_SOUL

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
DESCRIPTION = "Carries your work items through Object: approved steps, answers and brain dumps."  # our string


def _is_reviewer(path: Path) -> bool:
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > CHANGE_REVIEWER_MAX:
            return False
        head = path.read_bytes().decode("utf-8-sig", errors="replace").replace("\r\n", "\n")
    except OSError:
        return False
    lines = head.split("\n")
    if not lines or lines[0].strip() != "---":
        return False
    for line in lines[1:]:
        if line.strip() == "---":
            break
        key, _sep, value = line.partition(":")
        if key.strip() == "name" and value.strip().strip("\"'") == "change-reviewer":
            return True
    return False


def find_change_reviewer(home: Path) -> Path | None:
    """Gene's own `change-reviewer` agent file: `~/.claude/agents/`, else the newest plugin-cache copy."""
    direct = Path(home) / ".claude" / "agents" / CHANGE_REVIEWER
    if _is_reviewer(direct):
        return direct
    cache = Path(home) / ".claude" / "plugins" / "cache"
    try:
        found = [p for p in cache.glob(f"*/*/*/agents/{CHANGE_REVIEWER}") if _is_reviewer(p)]
        found.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return None
    return found[0] if found else None


def _taken(registry: AgentRegistry, name: str) -> bool:
    if any(str(r.data.get("name", "")).casefold() == name.casefold() for r in registry.list()):
        return True
    return (registry.agents_dir / safe_filename(name)).exists()


def create_work_agent(registry: AgentRegistry, *, user: str, copy_change_reviewer: bool, home: Path) -> AgentRecord:
    """An agent "Work" with the shell on, its soul and the work-follow-through skill."""
    name, n = WORK_AGENT_NAME, 1
    while _taken(registry, name):
        n += 1
        name = f"{WORK_AGENT_NAME} {n}"
    record = registry.create(
        AgentInput(name=name, icon=WORK_AGENT_ICON, color=WORK_AGENT_COLOR, description=DESCRIPTION, toolsOff=[]),
        WORK_SOUL.format(user=user),
    )
    agentskills.user_create(record.folder, SKILL_NAME, SKILL_DESCRIPTION, WORK_SKILL.format(user=user))
    if copy_change_reviewer:
        source = find_change_reviewer(home)
        if source is not None:
            target = Path(record.folder) / ".claude" / "agents" / CHANGE_REVIEWER
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                textfile.create_new(target, source.read_bytes())
            except (OSError, FileExistsError):
                pass
    settings.patch({"workAgentId": record.id}, settings.read()[1])
    return registry.get(record.id)


def work_agent(registry: AgentRegistry, settings_: dict[str, Any]) -> tuple[AgentRecord | None, str | None]:
    """(record, problem): `NOT_SET`, M17's texts for an unknown, missing or read-only folder, `REMOTE_REFUSED`."""
    agent_id = settings_.get("workAgentId")
    if not agent_id:
        return None, NOT_SET
    try:
        record = registry.get(str(agent_id))
    except AgentNotFound as exc:
        return None, str(exc)
    if record.kind == "remote":
        return None, REMOTE_REFUSED
    if record.missing:
        return None, f"This agent's folder is missing: {record.folder}"
    if record.read_only_reason:
        return None, record.read_only_reason
    return record, None


def ensure_work_agent(registry: AgentRegistry, settings_: dict[str, Any], *, user: str, home: Path) -> AgentRecord:
    """"Created on first use": the usable work agent, else a new one."""
    record, _problem = work_agent(registry, settings_)
    if record is not None:
        return record
    return create_work_agent(registry, user=user, copy_change_reviewer=False, home=home)
