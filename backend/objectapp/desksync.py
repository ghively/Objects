"""Desk sync: an M21 agent schedule that reads Jira and updates ticket fields (M24 T8).

T1 ships the constants, the purpose hook (`schedulerun.PURPOSE_FOR`) and an empty status; T8 fills
`setup` and `apply_ticket_fields`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from . import agentschedules, spaceconfig
from .propvalues import InvalidValue
from .workagentmodel import QueueRefused
from .workfields import TICKET_KEYS

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
    return value if engine.rules.get(value) is not None else None


ALREADY_SET_UP = "Desk sync is already set up."  # our string
_DAY_KEYS = ("deskOpened", "deskUpdated", "deskResolved")


def setup(space: Space, engine: AutomationEngine, agent_id: str, now: datetime) -> dict:
    """Make the Desk sync schedule (off, 07:00 on weekdays) for the work agent and remember its id in
    ``space.json``. 409 `QueueRefused` when it already exists. Answers the status."""
    from .localtime import to_local
    from .recurrence import week_start_of

    if rule_id(space, engine) is not None:
        raise QueueRefused(409, ALREADY_SET_UP)
    today = to_local(now, space.tz).date()
    start = agentschedules.default_start(DESK_SYNC_REPEAT, today, space.tz, week_start_of(space.root))
    lr = engine.create(agentschedules.rule_payload(
        agent_id, name=DESK_SYNC_NAME, prompt=DESK_SYNC_PROMPT, repeat=DESK_SYNC_REPEAT,
        time=DESK_SYNC_TIME, start=start, model=None, enabled=False,
    ))
    spaceconfig.set_internal(space.root, "deskSyncRuleId", lr.id)
    return status(space, engine, [])


def purpose_for(space: Space, rule_id_: str) -> str:
    """M21's ``schedulerun.PURPOSE_FOR``: ``work-sync`` for the Desk sync rule, else ``schedule``."""
    value = spaceconfig.read(space.root)[0].get("deskSyncRuleId")
    return "work-sync" if isinstance(value, str) and value and value == rule_id_ else "schedule"


def apply_ticket_fields(service: WorkService, path: str, version: str, values: dict[str, Any],
                        actor: Actor) -> dict:
    """Set ticket fields only (never ``status`` or a work field), through the work service."""
    if not isinstance(values, dict) or not values:
        raise InvalidValue("Say which ticket fields to set.")
    clean: dict[str, Any] = {}
    for key, value in values.items():
        if key not in TICKET_KEYS:
            raise InvalidValue(f"{key} isn't a ticket field.")
        if key in _DAY_KEYS and isinstance(value, str):
            value = {"start": value.strip()[:10], "resolution": "day"}
        clean[key] = value
    return service.fields(path, version, clean, [], actor)


def _listed_marked(space: Space, read_tools: list[str]) -> int:
    """How many marked tools are listed right now (in the tool cache of a gateway server or of the work
    agent's folder servers). Never starts a probe."""
    if not read_tools:
        return 0
    from . import mcpgateway
    from .mcpstore import McpStore

    listed: set[str] = set()
    try:
        for rec in McpStore().list():
            name = rec.data.get("name")
            if not rec.data.get("enabled", True) or not mcpgateway._usable_name(name):
                continue
            result = mcpgateway.TOOL_CACHE.get(mcpgateway.gateway_key(rec))
            if result is not None and result.ok:
                listed.update(mcpgateway.tool_id(name, tool) for tool, _desc in result.tools)
    except Exception:  # noqa: BLE001 - a status read never fails on the gateway
        pass
    return sum(1 for t in set(read_tools) if t in listed)


def status(space: Space, engine: AutomationEngine, read_tools: list[str]) -> dict:
    """DeskSyncStatus. Never writes."""
    rid = rule_id(space, engine)
    out: dict[str, Any] = {"ruleId": rid, "enabled": False, "repeat": None, "time": None, "lastRun": None,
                           "markedReadTools": _listed_marked(space, read_tools)}
    if rid is None:
        return out
    lr = engine.rules.get(rid)
    data = (lr.data if lr is not None else None) or {}
    trigger = data.get("trigger") if isinstance(data.get("trigger"), dict) else {}
    out["enabled"] = bool(data.get("enabled"))
    out["repeat"] = trigger.get("repeat")
    out["time"] = trigger.get("time")
    run = engine.last_run(rid)
    if isinstance(run, dict):
        acts = run.get("actions") if isinstance(run.get("actions"), list) else []
        first = acts[0] if acts and isinstance(acts[0], dict) else {}
        detail = first.get("detail") if first.get("detail") is not None else run.get("error")
        out["lastRun"] = {"at": run.get("at"), "status": run.get("status"), "detail": detail}
    return out
