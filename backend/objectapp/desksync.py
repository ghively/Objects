"""Desk sync: an M21 agent schedule that reads Jira and updates ticket fields (M24 T8).

T1 ships the constants, the purpose hook (`schedulerun.PURPOSE_FOR`) and an empty status; T8 fills
`setup` and `apply_ticket_fields`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from . import spaceconfig

if TYPE_CHECKING:
    from datetime import datetime

    from .automations import AutomationEngine
    from .space import Space
    from .workservice import Actor, WorkService

__all__ = [
    "DESK_SYNC_NAME",
    "DESK_SYNC_PROMPT",
    "DESK_SYNC_REPEAT",
    "DESK_SYNC_TIME",
    "apply_ticket_fields",
    "purpose_for",
    "rule_id",
    "setup",
    "status",
]

DESK_SYNC_NAME = "Desk sync"
DESK_SYNC_REPEAT = "every weekday"
DESK_SYNC_TIME = "07:00"
DESK_SYNC_PROMPT = (
    "Desk sync. List the active tickets with work_items. Read each Jira ticket with the Atlassian MCP "
    "tools you have and set the changed ticket fields with sync_ticket_fields. Do ServiceNow tickets "
    "only when a ServiceNow MCP tool is available to you; otherwise leave them. Never write to "
    "ServiceNow or Jira. Reply with one line per ticket you changed."
)


def rule_id(space: Space, engine: AutomationEngine) -> str | None:
    """The ``deskSyncRuleId`` in ``space.json`` while that rule exists, else None. Never writes."""
    value = spaceconfig.read(space.root)[0].get("deskSyncRuleId")
    if not isinstance(value, str) or not value:
        return None
    return value if engine.get(value) is not None else None


def setup(space: Space, engine: AutomationEngine, agent_id: str, now: datetime) -> dict:
    raise NotImplementedError("M24 T8")


def purpose_for(space: Space, rule_id_: str) -> str:
    """M21's ``schedulerun.PURPOSE_FOR``: ``work-sync`` for the Desk sync rule, else ``schedule``."""
    value = spaceconfig.read(space.root)[0].get("deskSyncRuleId")
    return "work-sync" if isinstance(value, str) and value and value == rule_id_ else "schedule"


def apply_ticket_fields(service: WorkService, path: str, version: str, values: dict[str, Any],
                        actor: Actor) -> dict:
    raise NotImplementedError("M24 T8")


def status(space: Space, engine: AutomationEngine, read_tools: list[str]) -> dict:
    """DeskSyncStatus (T1: not set up unless the rule exists; T8 adds the last run and the count)."""
    rid = rule_id(space, engine)
    return {"ruleId": rid, "enabled": False, "repeat": None, "time": None, "lastRun": None,
            "markedReadTools": 0}
