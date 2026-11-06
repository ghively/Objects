"""M21 agent schedules: the helpers around a schedule rule (an M14 rule whose one action is
``runAgent``), the agent-facing schedule shape, and the machine-wide schedules index
``<state>/agent-schedules.json`` that tells M18's curator which skills schedules use, also for
spaces that aren't open (plan `docs/superpowers/plans/2026-11-05-m21-schedules.md`, "Schedules
index" and "Agent-facing shape and routes").

The index (``dump_json``, written atomically, only when its content changes)::

    {"v": 1, "spaces": {"<appstate.space_key>": {"name", "path", "schedules": {
        "<ruleId>": {"agentId", "name", "prompt", "enabled", "usedSkills": [...]}}}}}

Importing this module sets M18's ``agentskills.SCHEDULE_SKILLS = skills_in_use`` (`automations`
imports it, so it is set whenever the app runs).
"""

from __future__ import annotations

import copy
import json
import logging
import re
import threading
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import agentfiles, agentskills
from .appstate import space_key, state_dir
from .automations_model import AutomationRule, ScheduleTrigger, agent_action
from .jsonstore import dump_json
from .recurrence import step
from .space import now_stamp
from .taskmodel import parse_repeat
from .textfile import atomic_write

if TYPE_CHECKING:
    from .automations import LoadedRule

__all__ = [
    "INDEX_FILE",
    "MAX_USED",
    "NEXT_RUN_DAYS",
    "REMOTE_REFUSED",
    "IndexUnreadable",
    "ScheduleIndex",
    "default_start",
    "is_agent_schedule",
    "rule_payload",
    "schedule_v1",
    "skills_in_use",
]

log = logging.getLogger(__name__)

INDEX_FILE = "agent-schedules.json"
MAX_USED = 100
"""Skill names kept per schedule in ``usedSkills``, the newest (our cap)."""
NEXT_RUN_DAYS = 400
"""``nextRun`` looks this many days ahead (a yearly schedule fits)."""
REMOTE_REFUSED = "Schedules run Object's own agents, not remote ones."  # our string

_lock = threading.Lock()
"""Serialises every read-modify-write of the index file in this process."""


def is_agent_schedule(rule: AutomationRule | None) -> bool:
    """Whether ``rule`` is an agent schedule (it has a ``runAgent`` action)."""
    return rule is not None and agent_action(rule) is not None


class IndexUnreadable(Exception):
    """The schedules index file can't be read; M18's curator then leaves the agent alone."""


# -- the index file -------------------------------------------------------------------------------


def _valid(data: Any) -> bool:
    if not isinstance(data, dict) or not isinstance(data.get("spaces"), dict):
        return False
    for space in data["spaces"].values():
        if not isinstance(space, dict) or not isinstance(space.get("schedules"), dict):
            return False
        if not all(isinstance(e, dict) for e in space["schedules"].values()):
            return False
    return True


def _used(entry: Any) -> list[str]:
    raw = entry.get("usedSkills") if isinstance(entry, dict) else None
    return [s for s in raw if isinstance(s, str)] if isinstance(raw, list) else []


class ScheduleIndex:
    """The machine-wide schedules index in the state dir (``<state>/agent-schedules.json``)."""

    def __init__(self, state: Path | None = None) -> None:
        self.state = Path(state) if state is not None else state_dir()
        self.path = self.state / INDEX_FILE

    def _read(self) -> tuple[dict[str, Any] | None, bool]:
        """``(data, unreadable)``: ``(None, False)`` with no file, ``(None, True)`` when it can't
        be read or doesn't have the index's shape."""
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            return None, False
        except OSError:
            return None, True
        try:
            data = json.loads(raw.decode("utf-8-sig"))
        except (ValueError, UnicodeDecodeError):
            return None, True
        return (data, False) if _valid(data) else (None, True)

    def _keep_unreadable(self) -> None:
        """Copy an unreadable index aside before it is replaced (as ``agents.json`` is)."""
        try:
            raw = self.path.read_bytes()
        except OSError:
            return
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
        aside = self.state / f"agent-schedules.unreadable-{stamp}.json"
        n = 2
        while aside.exists():
            aside = self.state / f"agent-schedules.unreadable-{stamp}-{n}.json"
            n += 1
        atomic_write(aside, raw)
        log.warning("agentschedules: %s couldn't be read; kept it as %s", self.path, aside.name)

    def _write(self, data: dict[str, Any], unreadable: bool) -> None:
        self.state.mkdir(parents=True, exist_ok=True)
        if unreadable:
            self._keep_unreadable()
        atomic_write(self.path, dump_json(data))

    def sync_space(self, space_root: Path, space_name: str, rules: Iterable[LoadedRule]) -> bool:
        """Replace that space's entries with its readable ``runAgent`` rules (enabled or not),
        keeping each entry's ``usedSkills``; a read-only rule file keeps its old entry. Writes only
        when the content differs, and never creates the file when it would hold nothing. Returns
        whether it wrote. An unreadable index is copied aside, then replaced."""
        key = space_key(space_root)
        rules = list(rules)
        with _lock:
            data, unreadable = self._read()
            before = copy.deepcopy(data)
            if data is None:
                data = {"v": 1, "spaces": {}}
            spaces: dict[str, Any] = data["spaces"]
            old_space = spaces.get(key)
            old: dict[str, Any] = old_space["schedules"] if isinstance(old_space, dict) else {}
            new: dict[str, Any] = {}
            for lr in rules:
                if lr.rule is None:
                    if lr.id in old:
                        new[lr.id] = old[lr.id]
                    continue
                action = agent_action(lr.rule)
                if action is None:
                    continue
                new[lr.id] = {
                    "agentId": action.agentId,
                    "name": lr.rule.name,
                    "prompt": action.prompt,
                    "enabled": lr.rule.enabled,
                    "usedSkills": _used(old.get(lr.id)),
                }
            if new:
                spaces[key] = {"name": space_name, "path": Path(space_root).resolve().as_posix(), "schedules": new}
            else:
                spaces.pop(key, None)
            data["v"] = 1
            if before is None and not unreadable and not spaces:
                return False  # no file, and it would hold nothing
            if not unreadable and data == before:
                return False
            self._write(data, unreadable)
            return True

    def record_used(self, space_root: Path, rule_id: str, skills: Iterable[str]) -> None:
        """Add ``skills`` to the entry's ``usedSkills`` (the newest `MAX_USED`, no duplicates).
        An unknown rule, or an index that can't be read (the next `sync_space` replaces it),
        records nothing."""
        names = [s for s in skills if isinstance(s, str) and s]
        if not names:
            return
        key = space_key(space_root)
        with _lock:
            data, unreadable = self._read()
            if data is None or unreadable:
                return
            space = data["spaces"].get(key)
            entry = space["schedules"].get(rule_id) if isinstance(space, dict) else None
            if not isinstance(entry, dict):
                return
            used = _used(entry)
            for name in names:
                if name in used:
                    used.remove(name)
                used.append(name)
            used = used[-MAX_USED:]
            if used == entry.get("usedSkills"):
                return
            entry["usedSkills"] = used
            self._write(data, False)

    def entries(self, agent_id: str) -> list[dict[str, Any]]:
        """Every space's entries for this agent, each with its ``ruleId`` and ``spaceKey``.
        Raises `IndexUnreadable` when the file can't be read."""
        with _lock:
            data, unreadable = self._read()
        if unreadable:
            raise IndexUnreadable(f"{INDEX_FILE} can't be read.")
        if data is None:
            return []
        out: list[dict[str, Any]] = []
        for key, space in data["spaces"].items():
            for rule_id, entry in space["schedules"].items():
                if entry.get("agentId") == agent_id:
                    out.append({**entry, "ruleId": rule_id, "spaceKey": key})
        return out


def _current_skills(folder: Path) -> list[str]:
    try:
        return [p.name for p in (Path(folder) / ".claude" / "skills").iterdir() if p.is_dir()]
    except OSError:
        return []


def _mentions(prompt: str, name: str) -> bool:
    return re.search(rf"(?<![\w-]){re.escape(name)}(?![\w-])", prompt, re.IGNORECASE) is not None


def skills_in_use(folder: Path) -> set[str]:
    """M18's ``agentskills.SCHEDULE_SKILLS``: the skills schedules of the agent in ``folder`` use
    (their ``usedSkills``, plus the agent's current skills named in a prompt as a whole name). No
    index file: the empty set. An unreadable index raises `IndexUnreadable`."""
    try:
        data, _revision = agentfiles.read_agent_file(Path(folder))
    except ValueError:
        return set()
    agent_id = data.get("id")
    if not isinstance(agent_id, str):
        return set()
    found = ScheduleIndex().entries(agent_id)
    if not found:
        return set()
    out: set[str] = set()
    current = _current_skills(Path(folder))
    for entry in found:
        out.update(_used(entry))
        prompt = entry.get("prompt") if isinstance(entry.get("prompt"), str) else ""
        out.update(name for name in current if _mentions(prompt, name))
    return out


agentskills.SCHEDULE_SKILLS = skills_in_use


# -- the agent-facing shape -----------------------------------------------------------------------


def _last_run(run: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(run, dict):
        return None
    actions = run.get("actions") if isinstance(run.get("actions"), list) else []
    first = actions[0] if actions and isinstance(actions[0], dict) else {}
    return {
        "at": run.get("at"),
        "status": run.get("status"),
        "path": first.get("path"),
        "detail": first.get("detail") if first.get("detail") is not None else run.get("error"),
    }


def _str(value: Any, default: str = "") -> str:
    return value if isinstance(value, str) else default


def schedule_v1(lr: LoadedRule, last_run: dict[str, Any] | None, now: datetime, tz: Any, week_start: str) -> dict[str, Any]:
    """The agent-facing ``ScheduleV1`` of a schedule rule. ``nextRun`` is the first occurrence after
    ``now`` within `NEXT_RUN_DAYS` days (also for a turned-off rule), else None; a read-only rule
    shows what its file holds and has no ``nextRun``."""
    from .automations import schedule_occurrences  # late: automations imports this module

    rule = lr.rule
    action = agent_action(rule) if rule is not None else None
    if rule is not None and action is not None and isinstance(rule.trigger, ScheduleTrigger):
        trigger = rule.trigger
        found = schedule_occurrences(trigger, now, now + timedelta(days=NEXT_RUN_DAYS), tz, week_start)
        return {
            "id": lr.id, "name": rule.name, "prompt": action.prompt, "repeat": trigger.repeat,
            "time": trigger.time, "start": trigger.start, "model": action.model, "enabled": rule.enabled,
            "readOnlyReason": lr.read_only_reason, "lastRun": _last_run(last_run),
            "nextRun": now_stamp(found[0]) if found else None,
        }
    raw = lr.data or {}
    trig = raw.get("trigger") if isinstance(raw.get("trigger"), dict) else {}
    acts = raw.get("actions") if isinstance(raw.get("actions"), list) else []
    act = acts[0] if acts and isinstance(acts[0], dict) else {}
    model = act.get("model")
    return {
        "id": lr.id, "name": _str(raw.get("name"), lr.id), "prompt": _str(act.get("prompt")),
        "repeat": _str(trig.get("repeat")), "time": _str(trig.get("time")), "start": _str(trig.get("start")),
        "model": model if isinstance(model, str) else None, "enabled": raw.get("enabled") is True,
        "readOnlyReason": lr.read_only_reason, "lastRun": _last_run(last_run), "nextRun": None,
    }


def default_start(repeat: str, today: date, tz: Any, week_start: str) -> str:
    """The first day on or after ``today`` that ``repeat`` reaches (``YYYY-MM-DD``). A plain
    interval starts today; a repeat with days (``on``) or ``every weekday`` starts on its first
    matching day. A repeat the app can't read gives today (validation then refuses it)."""
    rule = parse_repeat(repeat)
    if rule is None or (rule.on is None and rule.unit != "weekday"):
        return today.isoformat()
    try:
        first = step(rule, today - timedelta(days=1), tz, week_start)  # type: ignore[arg-type]
    except (ValueError, OverflowError):
        return today.isoformat()
    return first.isoformat() if isinstance(first, date) else today.isoformat()


def rule_payload(agent_id: str, *, name: str, prompt: str, repeat: str, time: str, start: str,
                 model: str | None, enabled: bool) -> dict[str, Any]:
    """An ``AutomationRuleInput`` dict for an agent schedule (M14 adds ``schemaVersion`` and
    ``createdAt`` when it creates the rule)."""
    return {
        "name": name,
        "description": "",
        "enabled": enabled,
        "trigger": {"kind": "schedule", "repeat": repeat, "time": time, "start": start},
        "conditions": {"type": "filterGroup", "operator": "and", "elements": []},
        "actions": [{"kind": "runAgent", "agentId": agent_id, "prompt": prompt, "model": model}],
        "templateRepeat": None,
    }
