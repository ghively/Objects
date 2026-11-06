"""M14 local automations: the rule store, validation, the engine, the scheduler and the run log.

Contract: ``docs/superpowers/plans/2026-11-05-m14-automations.md``. Rules are
``.object/automations/<id>.json`` (shape: `automations_model`), written only by the
automation routes through ``Space.store("automations")``. Their schedule state and run
logs are machine state in the per-user state dir (`appstate`), never in the space:

- ``<state dir>/automations-<space key>.json``: ``{"lastRunning", "rules": {id: {since,
  lastDone, pending, capped, trigger}}}`` (`ScheduleState`);
- ``<state dir>/automation-logs-<space key>/<id>.json``: ``{"runs": [...]}``, newest first,
  the newest `MAX_RUNS` (`run_log_path`).

Nothing here writes on read: listing rules, runs or the catch-up reads files only. The state
file is first written when there is a schedule rule to remember; the log folder when a run
is logged.

**Running.** `Space.after_write` hands every write notice to `AutomationEngine.on_write`,
which drops the ones made by an automation (the loop guard: their origin is
``automation:<id>``, see `writeorigin`) and queues the rest for the engine's one worker
thread, so a user's save never waits for a rule. Edits the watcher sees never reach
``after_write``, so they trigger nothing. Button presses and catch-up answers run
synchronously in the request; schedules run on the `AutomationScheduler` thread. Every
action runs inside ``writeorigin.acting_as("automation:<id>")`` and writes through the
public `Space` methods (history snapshot, ``lastUpdated``, version checks); a conflict is
retried once on the fresh version, then the action fails.

**Never run missed schedules silently.** A schedule's occurrences run while the app runs.
Occurrences missed while it was closed (counted from ``lastRunning``/``since``/``lastDone``
at start) or while the computer slept (a tick more than `SLEEP_GAP` after the previous
one) only go into ``pending``; they run when the user answers the catch-up.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from collections import deque
from collections.abc import Callable, Iterable, Iterator, Mapping
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from datetime import time as dtime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from . import writeorigin
from .appstate import space_key, state_dir
from .automation_filter import (
    FilterCtx,
    filter_options_for,
    match_filter,
    match_group,
    type_json,
)
from .automations_model import (
    API_ONLY_KEYS,
    OBJECT_ACTION_KINDS,
    AutomationRule,
    ButtonTrigger,
    CreateFromTemplateAction,
    ObjectCreatedTrigger,
    PropertyChangedTrigger,
    ScheduleTrigger,
    Scope,
    agent_action,
    origin_for,
)
from .dailynotes import DailyNoteExists
from .ids import new_ulid
from .jsonstore import DefinitionUnreadable, dump_json
from .localtime import from_local, to_local
from .notify import Notifier
from .objfile import ObjectFile
from .propvalues import _READ_ONLY_KINDS, InvalidValue, decode_value, encode_value
from .recurrence import scheduled_between, week_start_of
from .reminders import reminders_enabled
from .rows import member_of
from .space import Conflict, ReadOnly, Space, WriteNotice, now_stamp
from .taskmodel import format_repeat, parse_repeat
from .templates import TemplateError, format_date
from .textfile import atomic_write
from .typedefs import DEFAULT_TYPE, RawObject
from .typemodel import PropertyDefinition, TypeDefinition, type_revision
from .watcher import ChangeEvent

__all__ = [
    "CATCH_UP_PATH",
    "MAX_PENDING",
    "MAX_RUNS",
    "SLEEP_GAP",
    "AutomationEngine",
    "AutomationScheduler",
    "LoadedRule",
    "RuleRefused",
    "ScheduleState",
    "check_rule",
    "expand_placeholders",
    "run_log_path",
    "schedule_occurrences",
    "state_path",
]

log = logging.getLogger(__name__)

MAX_RUNS = 200
"""Runs kept per rule in its log (newest first)."""
MAX_PENDING = 50
"""Missed occurrences kept per rule for the catch-up (the newest; our cap)."""
SLEEP_GAP = timedelta(minutes=10)
"""A tick this long after the previous one means the computer slept (our choice)."""
MARK_EVERY = timedelta(minutes=5)
"""How often the scheduler records ``lastRunning`` while it runs."""
CATCH_UP_PATH = "catch-up"
"""``automationRuns`` with this path: the catch-up list changed."""
LOG_FLUSH_EVERY = 2.0
"""Seconds the worker may hold logged runs before writing them (a burst is one write)."""
STOP_WAIT = 5.0
"""Seconds quitting waits for the run in progress (our choice; queued runs are dropped)."""

# Our strings.
CANT_READ = "This automation can't be read."
NEWER = "This automation was made by a newer version of Object."
TURNED_OFF = "This automation is turned off."
CHANGED = "The object changed while the automation was running."
GONE = "The object no longer exists."
NO_TEMPLATE = "The template no longer exists."
NO_TYPE = "The type no longer exists."
NO_TAG = "The tag no longer exists."
NO_COLLECTION = "The collection no longer exists."
NOT_HELD = "This collection doesn't hold objects of this type."
NOTIFY_OFF = "Notifications are turned off."
NOT_A_BUTTON = "This automation doesn't run from a button."
OUT_OF_SCOPE = "This automation doesn't apply to this object."
IN_TEMPLATE = "Buttons run in objects made from this template."
MISSED_CONDITIONS = "The object doesn't meet the automation's conditions."
SKIPPED_CATCH_UP = "Skipped when catching up."

# A propertyChanged trigger can't watch these (system keys the app maintains, and buttons).
_UNWATCHABLE_KINDS = frozenset(
    {"entity_type", "entity_createdAt", "entity_lastUpdated", "entity_backlinks", "button"}
)
_LOCKED_KEYS = frozenset({"title", "type", "id", "template"})
_PLACEHOLDER_RE = re.compile(r"\{(title|link|date:([^{}]*))\}")


# -- paths --------------------------------------------------------------------------------


def state_path(space_root: Path) -> Path:
    """``<state dir>/automations-<space key>.json`` (schedule state; outside the space)."""
    return state_dir() / f"automations-{space_key(space_root)}.json"


def run_log_path(space_root: Path, rule_id: str) -> Path:
    """``<state dir>/automation-logs-<space key>/<id>.json``. Raises `ValueError` for an id
    that can't name a file."""
    if not re.fullmatch(r"[^\W_][\w.-]{0,99}", rule_id) or rule_id.endswith("."):
        raise ValueError(f"Invalid automation id {rule_id!r}")
    return state_dir() / f"automation-logs-{space_key(space_root)}" / f"{rule_id}.json"


def _stamp(instant: datetime) -> str:
    return now_stamp(instant)


def _instant(text: Any) -> datetime | None:
    if not isinstance(text, str) or not text.strip():
        return None
    try:
        dt = datetime.fromisoformat(text.strip())
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=UTC)).astimezone(UTC)


# -- loading rules ------------------------------------------------------------------------


@dataclass
class LoadedRule:
    """One rule file as read: its model when it can run, else why it can't."""

    id: str
    revision: str
    data: dict[str, Any] | None
    """The file's JSON object (None when it isn't valid JSON)."""
    rule: AutomationRule | None
    read_only_reason: str | None = None

    @property
    def runnable(self) -> bool:
        return self.rule is not None and self.rule.enabled

    def order_key(self) -> tuple[str, str]:
        created = self.rule.createdAt if self.rule is not None else None
        return (created or "", self.id)


def _model_problem(exc: ValidationError) -> str:
    """One line naming the first problem pydantic found."""
    err = exc.errors()[0]
    msg = str(err.get("msg", "Not a valid automation"))
    msg = msg.removeprefix("Value error, ").removeprefix("Assertion failed, ")
    loc = ".".join(str(p) for p in err.get("loc", ()))
    if err.get("type") == "value_error" or not loc:
        return msg
    return f"{loc}: {msg}"


def _newer(data: dict[str, Any], exc: ValidationError | None) -> bool:
    version = data.get("schemaVersion")
    if isinstance(version, int) and not isinstance(version, bool) and version > 1:
        return True
    if exc is None:
        return False
    # A trigger or action kind this version doesn't know: made by a newer version.
    return any(e.get("type") == "union_tag_invalid" for e in exc.errors())


def load_rule(rule_id: str, data: dict[str, Any] | None, revision: str, error: str | None) -> LoadedRule:
    if data is None:
        return LoadedRule(rule_id, revision, None, None, CANT_READ)
    if _newer(data, None):
        return LoadedRule(rule_id, revision, data, None, NEWER)
    try:
        rule = AutomationRule.model_validate(data)
    except ValidationError as exc:
        return LoadedRule(rule_id, revision, data, None, NEWER if _newer(data, exc) else CANT_READ)
    return LoadedRule(rule_id, revision, data, rule, None)


class RuleCache:
    """The space's rules, re-parsed only when a file's revision changed."""

    def __init__(self, space: Space) -> None:
        self.space = space
        self._lock = threading.Lock()
        self._known: dict[str, LoadedRule] = {}

    def all(self) -> list[LoadedRule]:
        store = self.space.store("automations")
        with self._lock:
            known = {i: lr.revision for i, lr in self._known.items()}
            out: dict[str, LoadedRule] = {}
            for rid, data, revision, error in store.list(known):
                cached = self._known.get(rid)
                if cached is not None and cached.revision == revision and data is None and error is None:
                    out[rid] = cached
                else:
                    out[rid] = load_rule(rid, data, revision, error)
            self._known = out
            return list(out.values())

    def get(self, rule_id: str) -> LoadedRule | None:
        try:
            self.space.store("automations").path(rule_id)
        except ValueError:
            return None
        return next((lr for lr in self.all() if lr.id == rule_id), None)


# -- validation against the space ---------------------------------------------------------


def _scope_types(space: Space, scope: Scope | None) -> list[TypeDefinition] | None:
    """The types a scope covers (None: any object). Raises `InvalidValue` for a missing one."""
    if scope is None:
        return None
    if scope.kind == "type":
        t = space.type_by_id(scope.id)
        if t is None:
            raise InvalidValue(f"There is no object type {scope.id!r}.")
        return [t]
    c = space.collections.get(scope.id)
    if c is None or c.readOnlyReason:
        raise InvalidValue(f"There is no collection {scope.id!r}.")
    ids = c.typeIds or [t.id for t in space.types]  # a collection naming no type: any type
    return [t for t in (space.type_by_id(i) for i in ids) if t is not None]


def _key_def(space: Space, types: Iterable[TypeDefinition], key: str) -> PropertyDefinition | None:
    """``key``'s definition in the first of ``types`` that has it; a system key (title, tags,
    collections...) has its system definition on every type."""
    for t in types:
        p = t.prop(key)
        if p is not None:
            return p
    return space._pdef(None, key) if key in _SYSTEM_KEYS else None


def _type_names(types: list[TypeDefinition]) -> str:
    return ", ".join(t.name for t in types) or "this scope"


def _check_value(pdef: PropertyDefinition, value: Any, where: str) -> None:
    if pdef.type == "entity_collections":
        if value is not None and (
            not isinstance(value, list) or not all(isinstance(n, str) for n in value)
        ):
            raise InvalidValue(f"{where}: expected a list of collection names.")
        return
    try:
        encode_value(pdef, value, None)
    except InvalidValue as exc:
        raise InvalidValue(f"{where}: {exc}") from exc


def _find_template(space: Space, type_id: str, template_id: str) -> Any:
    """The summary of ``type_id``'s template with this frontmatter id, or None (no write)."""
    with space._lock:
        raws = list(space._raw.values())
    for raw in raws:
        if raw.readOnly or raw.fm.get("template") in (None, ""):
            continue
        if space._type_id(raw.typeName) != type_id:
            continue
        if str(raw.fm.get("id") or "").strip() == template_id:
            return space._summaries.get(raw.path)
    return None


def check_rule(
    space: Space,
    payload: Mapping[str, Any],
    rule_id: str | None = None,
    others: Iterable[LoadedRule] = (),
    against_space: bool = True,
) -> AutomationRule:
    """The rule in ``payload``, validated against the model and the space.

    ``repeat`` comes back canonical. Raises `InvalidValue` with one message (the 422).
    Without ``against_space`` the scope, keys, values, types and templates the rule names
    aren't checked (a save that only turns a rule on or off, or keeps it off: a rule whose
    template or type was deleted can still be turned off and edited).
    """
    try:
        rule = AutomationRule.model_validate(dict(payload))
    except ValidationError as exc:
        raise InvalidValue(_model_problem(exc)) from exc
    trigger = rule.trigger
    if isinstance(trigger, ScheduleTrigger):
        parsed = parse_repeat(trigger.repeat)
        if parsed is None:
            raise InvalidValue(f"“{trigger.repeat}” isn't a repeat this app understands.")
        if parsed.mode == "completionDate":
            raise InvalidValue("A schedule can't repeat after completion.")
        trigger.repeat = format_repeat(parsed)
    if against_space:
        _check_against_space(space, rule)
    if rule.templateRepeat is not None:
        for other in others:
            if other.id == rule_id:
                continue
            tr = other.rule.templateRepeat if other.rule is not None else None
            if tr is None and other.data is not None:
                raw = other.data.get("templateRepeat")
                tid = raw.get("templateId") if isinstance(raw, dict) else None
            else:
                tid = tr.templateId if tr is not None else None
            if tid == rule.templateRepeat.templateId:
                raise InvalidValue("This template already repeats.")
    return rule


def _check_against_space(space: Space, rule: AutomationRule) -> None:
    """What `check_rule` checks in the space: the scope, keys, values, types and templates."""
    trigger = rule.trigger
    scope = None if isinstance(trigger, ScheduleTrigger) else trigger.scope
    types = _scope_types(space, scope)
    if isinstance(trigger, PropertyChangedTrigger):
        assert types is not None
        pdef = _key_def(space, types, trigger.propertyKey)
        if pdef is None:
            raise InvalidValue(
                f"“{trigger.propertyKey}” isn't a property of {_type_names(types)}."
            )
        if pdef.type in _UNWATCHABLE_KINDS or trigger.propertyKey in ("type", "id", "template"):
            raise InvalidValue(f"“{pdef.name}” can't start an automation.")
        if trigger.to is not None:
            options = filter_options_for({"type": pdef.type, "options": pdef.options or {}})
            if trigger.to.option not in options:
                raise InvalidValue(f"“{trigger.to.option}” isn't a condition for {pdef.name}.")
    for n, a in enumerate(rule.actions, start=1):
        where = f"Action {n}"
        if a.kind == "runAgent":
            # M21: an agent schedule runs one of Object's own listed agents (late imports: the
            # registry is machine state, and agentschedules imports this module).
            from .agents import AgentNotFound, AgentRegistry
            from .agentschedules import REMOTE_REFUSED
            from .remotemodel import REMOTE_KIND

            try:
                record = AgentRegistry().get(a.agentId)  # type: ignore[union-attr]
            except AgentNotFound as exc:
                raise InvalidValue(str(exc)) from exc
            if record.kind == REMOTE_KIND:
                raise InvalidValue(REMOTE_REFUSED)
            continue
        if a.kind in ("setProperty", "clearProperty") and types is not None:
            key = a.key  # type: ignore[union-attr]
            pdef = _key_def(space, types, key)
            if pdef is None:
                raise InvalidValue(f"{where}: “{key}” isn't a property of {_type_names(types)}.")
            if pdef.type in _READ_ONLY_KINDS or key in _LOCKED_KEYS:
                raise InvalidValue(f"{where}: “{pdef.name}” can't be set by an automation.")
            if a.kind == "setProperty":
                if a.now:  # type: ignore[union-attr]
                    if pdef.type not in ("datetime", "datetimeSimple"):
                        raise InvalidValue(f"{where}: “{pdef.name}” isn't a date.")
                else:
                    _check_value(pdef, a.value, where)  # type: ignore[union-attr]
        elif a.kind in ("setProperty", "clearProperty"):
            key = a.key  # type: ignore[union-attr]
            if key in _LOCKED_KEYS or key in ("createdAt", "lastUpdated", "backlinks"):
                raise InvalidValue(f"{where}: “{key}” can't be set by an automation.")
        if isinstance(a, CreateFromTemplateAction):
            t = space.type_by_id(a.typeId)
            if t is None:
                raise InvalidValue(f"{where}: there is no object type {a.typeId!r}.")
            if a.templateId not in (None, "none") and _find_template(space, t.id, a.templateId) is None:
                raise InvalidValue(f"{where}: {t.name} has no template {a.templateId!r}.")
            if a.relateVia is not None:
                rel_def = t.prop(a.relateVia)
                if rel_def is None or rel_def.type != "entity":
                    raise InvalidValue(f"{where}: “{a.relateVia}” isn't a relation of {t.name}.")
                allowed = rel_def.options.get("allowedTypes") or []
                if allowed and types is not None:
                    refused = [x.name for x in types if x.id not in allowed]
                    if refused:
                        raise InvalidValue(
                            f"{where}: {rel_def.name} doesn't take {', '.join(refused)} objects."
                        )


def rule_api(lr: LoadedRule, last_run: dict[str, Any] | None) -> dict[str, Any]:
    """The API form: the file's keys plus ``id``, ``revision``, ``readOnlyReason``, ``lastRun``."""
    if lr.rule is not None:
        body = lr.rule.to_json()
    else:
        raw = {k: v for k, v in (lr.data or {}).items() if k not in API_ONLY_KEYS}
        body = {
            "schemaVersion": raw.get("schemaVersion", 1),
            "name": raw.get("name") if isinstance(raw.get("name"), str) else lr.id,
            "description": raw.get("description") if isinstance(raw.get("description"), str) else "",
            "enabled": raw.get("enabled") is True,
            "trigger": raw.get("trigger"),
            "conditions": raw.get("conditions")
            if isinstance(raw.get("conditions"), dict)
            else {"type": "filterGroup", "operator": "and", "elements": []},
            "actions": raw.get("actions") if isinstance(raw.get("actions"), list) else [],
            "templateRepeat": raw.get("templateRepeat"),
            "createdAt": raw.get("createdAt"),
            **{k: v for k, v in raw.items() if k not in AutomationRule.model_fields},
        }
    return {
        **body,
        "id": lr.id,
        "revision": lr.revision,
        "readOnlyReason": lr.read_only_reason,
        "lastRun": last_run,
    }


# -- schedules ----------------------------------------------------------------------------


def schedule_occurrences(
    trigger: ScheduleTrigger,
    lo: datetime,
    hi: datetime,
    tz: Any,
    week_start: str = "monday",
    newest: int | None = None,
) -> list[datetime]:
    """The trigger's occurrence instants in ``(lo, hi]``, oldest first.

    Exactly a by-due-date Task's dates: ``start`` first, then each `recurrence.step` from it
    (``until`` honoured); an occurrence's instant is ``time`` on its day in ``tz``. With
    ``newest``, at most that many (the newest).
    """
    rule = parse_repeat(trigger.repeat)
    if rule is None or rule.mode != "dueDate" or hi <= lo:
        return []
    try:
        start = date.fromisoformat(trigger.start)
        hh, mm = (int(x) for x in trigger.time.split(":"))
    except ValueError:
        return []
    lo_day = max(start, to_local(lo, tz).date() - timedelta(days=1))
    hi_day = to_local(hi, tz).date()
    if hi_day < lo_day:
        return []
    limit = (newest + 10) if newest is not None else 10_000
    days = scheduled_between(
        rule, start, lo_day, hi_day, tz, week_start, limit=limit, newest=newest is not None
    )
    out = []
    for d in days:
        day = d if not isinstance(d, datetime) else to_local(d, tz).date()
        inst = from_local(datetime.combine(day, dtime(hh, mm)), tz).astimezone(UTC)
        if lo < inst <= hi:
            out.append(inst)
    return out[-newest:] if newest is not None and len(out) > newest else out


class ScheduleState:
    """The scheduler's state file, written atomically.

    ``status`` is ``'missing'`` (no file: a first start, nothing owed), ``'ok'`` or
    ``'unknown'`` (unreadable: nothing owed; it is replaced on the next write).
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.status = "missing"
        self.last_running: datetime | None = None
        self.rules: dict[str, dict[str, Any]] = {}
        self.load()

    def load(self) -> None:
        self.last_running, self.rules = None, {}
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            self.status = "missing"
            return
        except OSError:
            self.status = "unknown"
            return
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.status = "unknown"
            return
        rules = data.get("rules") if isinstance(data, dict) else None
        if not isinstance(rules, dict):
            self.status = "unknown"
            return
        self.status = "ok"
        self.last_running = _instant(data.get("lastRunning"))
        for rid, entry in rules.items():
            if not isinstance(entry, dict):
                continue
            pending = entry.get("pending")
            self.rules[str(rid)] = {
                "since": entry.get("since") if isinstance(entry.get("since"), str) else None,
                "lastDone": entry.get("lastDone") if isinstance(entry.get("lastDone"), str) else None,
                "pending": [p for p in pending if _instant(p)] if isinstance(pending, list) else [],
                "capped": entry.get("capped") is True,
                "trigger": entry.get("trigger"),
            }

    @property
    def worth_saving(self) -> bool:
        """Only a space with schedule rules gets a state file (or one that has one)."""
        return bool(self.rules) or self.status != "missing"

    def save(self, last_running: datetime | None = None) -> None:
        if last_running is not None:
            self.last_running = last_running
        if not self.worth_saving:
            return
        payload = {
            "lastRunning": _stamp(self.last_running) if self.last_running else None,
            "rules": self.rules,
        }
        data = (json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(self.path, data)
        self.status = "ok"


def _merge_pending(entry: dict[str, Any], found: list[datetime], capped: bool) -> bool:
    """Add missed occurrences to an entry (deduplicated, the newest `MAX_PENDING`)."""
    have = {_instant(p) for p in entry["pending"]}
    added = [i for i in found if i not in have]
    if not added and not capped:
        return False
    merged = sorted({*(i for i in have if i is not None), *added})
    if len(merged) > MAX_PENDING:
        merged = merged[-MAX_PENDING:]
        capped = True
    entry["pending"] = [_stamp(i) for i in merged]
    entry["capped"] = bool(entry.get("capped")) or capped
    return True


class AutomationScheduler:
    """Runs schedule rules on a daemon thread (a tick every `interval` seconds, as reminders)."""

    def __init__(self, engine: AutomationEngine, interval: float = 30.0) -> None:
        self.engine = engine
        self.space = engine.space
        self.interval = interval
        self.state = ScheduleState(state_path(self.space.root))
        self._lock = threading.RLock()
        self._last_tick: datetime | None = None
        self._last_mark: datetime | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # -- bookkeeping --

    def _schedule_rules(self, rules: Iterable[LoadedRule]) -> list[LoadedRule]:
        return sorted(
            (lr for lr in rules if lr.runnable and isinstance(lr.rule.trigger, ScheduleTrigger)),  # type: ignore[union-attr]
            key=LoadedRule.order_key,
        )

    def reconcile(self, now: datetime, rules: list[LoadedRule] | None = None) -> tuple[bool, bool]:
        """Give every enabled schedule rule an entry; drop the others'.

        An entry starts counting (``since``) when its rule is first seen, created, turned
        on or rescheduled: nothing is owed from before. Returns (state changed, catch-up
        list changed).
        """
        rules = self.engine.rules.all() if rules is None else rules
        changed = catch_up = False
        with self._lock:
            # A rule file that can't be read just now keeps its entry (and what it owes); only
            # a deleted, turned-off or no-longer-scheduled rule drops it.
            live: set[str] = {lr.id for lr in rules if lr.rule is None}
            for lr in self._schedule_rules(rules):
                fingerprint = lr.rule.trigger.model_dump(mode="json")  # type: ignore[union-attr]
                live.add(lr.id)
                entry = self.state.rules.get(lr.id)
                if entry is None or entry.get("trigger") != fingerprint:
                    if entry is not None and entry.get("pending"):
                        catch_up = True
                    self.state.rules[lr.id] = {
                        "since": _stamp(now),
                        "lastDone": None,
                        "pending": [],
                        "capped": False,
                        "trigger": fingerprint,
                    }
                    changed = True
            for rid in [r for r in self.state.rules if r not in live]:
                if self.state.rules[rid].get("pending"):
                    catch_up = True
                del self.state.rules[rid]
                changed = True
        return changed, catch_up

    def _floor(self, entry: dict[str, Any], *others: datetime | None) -> datetime | None:
        found = [i for i in (*others, _instant(entry.get("since")), _instant(entry.get("lastDone"))) if i]
        return max(found) if found else None

    def _week_start(self) -> str:
        return week_start_of(self.space.root)

    # -- start and stop --

    def catch_up_on_start(self, now: datetime) -> bool:
        """Put what was missed while the app was closed into ``pending`` (never run it)."""
        rules = self.engine.rules.all()
        with self._lock:
            owed = False
            if self.state.status == "ok":
                week_start = self._week_start()
                for lr in self._schedule_rules(rules):
                    entry = self.state.rules.get(lr.id)
                    trigger = lr.rule.trigger  # type: ignore[union-attr]
                    if entry is None or entry.get("trigger") != trigger.model_dump(mode="json"):
                        continue
                    lo = self._floor(entry, self.state.last_running)
                    if lo is None:
                        continue
                    found = schedule_occurrences(
                        trigger, lo, now, self.space.tz, week_start, newest=MAX_PENDING + 1
                    )
                    capped = len(found) > MAX_PENDING
                    if found and _merge_pending(entry, found[-MAX_PENDING:], capped):
                        owed = True
            changed, catch_up = self.reconcile(now, rules)
            if owed or changed:
                self._save()
        return owed or catch_up

    def _save(self, last_running: datetime | None = None) -> None:
        try:
            self.state.save(last_running)
        except OSError:
            log.exception("Automations: could not write the schedule state")

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        now = self.space.clock()
        self.state.load()
        if self.catch_up_on_start(now):
            self.engine.announce_catch_up()
        with self._lock:
            self._last_tick = now
            self._last_mark = now
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="object-automations", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Stop the thread and record ``lastRunning`` (when there is state to keep).

        ``lastRunning`` is the instant occurrences were handled through (the last tick), never
        the clock at quitting: what came due between the last tick and the quit (or across a
        sleep the app quit right after) is then owed on the next start, never lost.
        """
        thread, self._thread = self._thread, None
        self._stop.set()
        if thread is not None:
            thread.join(STOP_WAIT)
            with self._lock:
                self._save(self._last_tick or self.space.clock())

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            try:
                self.tick()
            except Exception:
                log.exception("Automations: a schedule check failed")

    # -- ticks --

    def tick(self, now: datetime | None = None) -> list[dict[str, Any]]:
        """Run the occurrences due since the last tick; after a sleep, owe them instead."""
        runs: list[dict[str, Any]] = []
        due: list[tuple[LoadedRule, datetime]] = []
        with self._lock:
            now = now if now is not None else self.space.clock()
            last = self._last_tick or now
            self._last_tick = now
            rules = self.engine.rules.all()
            changed, catch_up = self.reconcile(now, rules)
            if now > last:
                slept = now - last > SLEEP_GAP
                week_start = self._week_start()
                for lr in self._schedule_rules(rules):
                    entry = self.state.rules[lr.id]
                    lo = self._floor(entry, last)
                    assert lo is not None
                    trigger = lr.rule.trigger  # type: ignore[union-attr]
                    if slept:
                        found = schedule_occurrences(
                            trigger, lo, now, self.space.tz, week_start, newest=MAX_PENDING + 1
                        )
                        capped = len(found) > MAX_PENDING
                        if found and _merge_pending(entry, found[-MAX_PENDING:], capped):
                            changed = catch_up = True
                        continue
                    for inst in schedule_occurrences(trigger, lo, now, self.space.tz, week_start):
                        entry["lastDone"] = _stamp(inst)  # recorded before it runs: at most once
                        changed = True
                        due.append((lr, inst))
            if self._last_mark is None or now - self._last_mark >= MARK_EVERY or now < self._last_mark:
                self._last_mark = now
                self._save(now)
            elif changed:
                self._save()
        if catch_up:
            self.engine.announce_catch_up()
        for lr, inst in due:
            run = self.engine.run_scheduled(lr, inst, catch_up=False)
            if run is not None:  # None: an agent schedule's run, handed to the agent jobs (M21)
                runs.append(run)
        return runs

    # -- the catch-up --

    def catch_up_items(self) -> list[dict[str, Any]]:
        rules = {lr.id: lr for lr in self.engine.rules.all()}
        items = []
        with self._lock:
            for rid, entry in self.state.rules.items():
                lr = rules.get(rid)
                if not entry.get("pending") or lr is None or not lr.runnable:
                    continue
                rule = lr.rule
                assert rule is not None
                missed = sorted(entry["pending"], key=lambda p: _instant(p) or datetime.min.replace(tzinfo=UTC))
                items.append(
                    {
                        "ruleId": rid,
                        "name": self.engine.catch_up_name(rule),
                        "missed": missed,
                        "count": len(missed),
                        "capped": bool(entry.get("capped")),
                        "createsObjects": any(
                            isinstance(a, CreateFromTemplateAction) for a in rule.actions
                        ),
                    }
                )
        return sorted(items, key=lambda i: (i["name"].casefold(), i["ruleId"]))

    def answer(self, rule_id: str, choice: str) -> list[dict[str, Any]]:
        """Run ``all`` / the ``latest`` / none (``skip``) of a rule's missed occurrences.

        Raises `KeyError` when the rule has nothing pending.
        """
        return self.answer_counted(rule_id, choice)[0]

    def answer_counted(self, rule_id: str, choice: str) -> tuple[list[dict[str, Any]], int]:
        """`answer`'s runs and how many occurrences went to the agent jobs (M21: an agent
        schedule's runs are queued, never run in the request)."""
        lr = self.engine.rules.get(rule_id)
        with self._lock:
            entry = self.state.rules.get(rule_id)
            if lr is None or not lr.runnable or entry is None or not entry.get("pending"):
                raise KeyError(rule_id)
            pending = sorted(i for i in (_instant(p) for p in entry["pending"]) if i is not None)
            chosen = pending if choice == "all" else pending[-1:] if choice == "latest" else []
            done = _instant(entry.get("lastDone"))
            newest = pending[-1]
            entry["lastDone"] = _stamp(max(newest, done) if done else newest)
            entry["pending"] = []
            entry["capped"] = False
            self._save()  # recorded before anything runs: each occurrence at most once
        self.engine.announce_catch_up()
        if not chosen:
            return [self.engine.log_skipped_catch_up(lr, newest)], 0
        runs: list[dict[str, Any]] = []
        queued = 0
        for inst in chosen:
            run = self.engine.run_scheduled(lr, inst, catch_up=True)
            if run is None:
                queued += 1
            else:
                runs.append(run)
        return runs, queued

    def owe(self, rule_id: str, instants: list[datetime]) -> None:
        """Put occurrences back into the rule's ``pending`` (M21: agent runs the space closed on),
        the newest `MAX_PENDING`, so the catch-up asks. A rule with no entry (turned off or
        deleted meanwhile) owes nothing."""
        if not instants:
            return
        with self._lock:
            entry = self.state.rules.get(rule_id)
            if entry is None:
                return
            found = sorted(set(instants))
            if not _merge_pending(entry, found[-MAX_PENDING:], len(found) > MAX_PENDING):
                return
            self._save()
        self.engine.announce_catch_up()


# -- placeholders --------------------------------------------------------------------------


def expand_placeholders(
    text: str, space: Space, path: str | None, from_rel: str | None, instant: datetime
) -> str:
    """``{title}``, ``{link}`` and ``{date:FMT}`` in ``text``; anything else is kept as written."""

    def sub(m: re.Match[str]) -> str:
        if m[1] == "title":
            if path is None:
                return ""
            with space._lock:
                summary = space._summaries.get(path)
            return summary.title if summary is not None else ""
        if m[1] == "link":
            if path is None:
                return ""
            return f"[[{space._link_text(path, from_rel or path)}]]"
        try:
            return format_date(m[2], to_local(instant, space.tz))
        except TemplateError:
            return m[0]

    return _PLACEHOLDER_RE.sub(sub, text)


# -- the engine ---------------------------------------------------------------------------


class RuleRefused(Exception):
    """A button press or catch-up the route refuses (``status`` 404, 422 or 423)."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


class _ActionFailed(Exception):
    pass


class _LazyMap(Mapping[str, str]):
    """A mapping built on first use (object ids -> paths, Tag ids -> titles)."""

    def __init__(self, build: Callable[[], dict[str, str]]) -> None:
        self._build = build
        self._data: dict[str, str] | None = None

    def _get(self) -> dict[str, str]:
        if self._data is None:
            self._data = self._build()
        return self._data

    def __getitem__(self, key: str) -> str:
        return self._get()[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._get())

    def __len__(self) -> int:
        return len(self._get())


_STOP = object()


class AutomationEngine:
    """Queues write notices, runs matching rules on one worker thread, logs every run."""

    def __init__(
        self,
        space: Space,
        announce: Callable[[ChangeEvent], None],
        notifier: Notifier,
        interval: float = 30.0,
        *,
        base_url: Callable[[], str | None] = lambda: None,
    ) -> None:
        from .schedulerun import AgentJobs  # late: schedulerun imports this module

        self.space = space
        self.announce = announce
        self.notifier = notifier
        self.rules = RuleCache(space)
        self.scheduler = AutomationScheduler(self, interval)
        self.agent_jobs = AgentJobs(self, base_url=base_url)
        """M21: agent schedule runs, one at a time on their own thread."""
        self._queue: deque[Any] = deque()
        self._cond = threading.Condition()
        self._busy = 0
        """Notices queued or being handled (for `wait_idle`)."""
        self._worker: threading.Thread | None = None
        self._running = False
        self.stop_wait = STOP_WAIT
        self._log_lock = threading.Lock()
        self._unflushed: dict[str, list[dict[str, Any]]] = {}
        self._last_flush = time.monotonic()

    # -- lifecycle --

    def start(self) -> None:
        with self._cond:
            if self._running:
                return
            self._running = True
        self.prune_logs()
        self.sync_schedule_index()
        self._worker = threading.Thread(target=self._work, name="object-automation-runs", daemon=True)
        self._worker.start()
        self.agent_jobs.start()
        self.scheduler.start()

    def stop(self) -> None:
        """Quit: drop the triggered runs that haven't started (our choice: one log line), let
        the one in progress finish (waiting at most `stop_wait` seconds), write the logs.

        M21: the scheduler stops first, then the agent jobs (which give what they couldn't run back
        to the catch-up), then this worker."""
        self.scheduler.stop()
        self.agent_jobs.stop()
        with self._cond:
            if not self._running:
                return
            self._running = False
            dropped = sum(1 for item in self._queue if item is not _STOP)
            self._queue.clear()
            self._busy -= dropped
            self._queue.append(_STOP)
            self._cond.notify_all()
        if dropped:
            log.info("Automations: %d queued run(s) not started before quitting were dropped", dropped)
        worker, self._worker = self._worker, None
        if worker is not None:
            worker.join(self.stop_wait)
            if worker.is_alive():
                log.warning("Automations: a run was still going when the app quit")
        self.flush_logs()

    def prune_logs(self) -> None:
        """Remove the run logs of rules that are gone (deleted outside the app, not in the
        trash). Only ``<id>.json`` files in this space's log folder (in the state dir)."""
        try:
            folder = run_log_path(self.space.root, "x").parent
            if not folder.is_dir():
                return
            known = {lr.id for lr in self.rules.all()}
            trash = self.space.trash
            known |= {trash.automation_id(t) for t in trash.automation_trash_ids()}
            for p in folder.glob("*.json"):
                if p.stem not in known and p.is_file():
                    try:
                        run_log_path(self.space.root, p.stem)
                    except ValueError:
                        continue  # not a name a log is written under
                    p.unlink(missing_ok=True)
        except OSError:
            log.exception("Automations: could not prune the run logs")

    @property
    def running(self) -> bool:
        return self._running

    # -- the queue --

    def on_write(self, notice: WriteNotice) -> None:
        """`Space.after_write`: queue the notice (an automation's own writes trigger nothing)."""
        origin = notice.origin or ""
        if origin.startswith("automation:"):
            return
        with self._cond:
            if not self._running:
                return
            self._queue.append(notice)
            self._busy += 1
            self._cond.notify_all()

    def wait_idle(self, timeout: float = 10.0) -> bool:
        """Wait until every queued notice is handled; flush the run logs. False on timeout."""
        deadline = time.monotonic() + timeout
        with self._cond:
            while self._busy:
                left = deadline - time.monotonic()
                if left <= 0:
                    return False
                self._cond.wait(left)
        self.flush_logs()
        return True

    def _work(self) -> None:
        while True:
            with self._cond:
                while not self._queue:
                    self._cond.wait(LOG_FLUSH_EVERY)
                    if not self._queue:
                        break
                item = self._queue.popleft() if self._queue else None
            if item is _STOP:
                return
            if item is None:
                self.flush_logs()
                continue
            try:
                self._handle(item)
            except Exception:
                log.exception("Automations: a triggered run failed")
            finally:
                with self._cond:
                    self._busy -= 1
                    empty = not self._queue
                    self._cond.notify_all()
            if empty or time.monotonic() - self._last_flush > LOG_FLUSH_EVERY:
                self.flush_logs()

    # -- triggers --

    def _type_id_of(self, fm: Mapping[str, Any]) -> str:
        t = fm.get("type")
        name = t.strip() if isinstance(t, str) and t.strip() else DEFAULT_TYPE
        return self.space._type_id(name)

    def _collections_of(self, fm: Mapping[str, Any]) -> set[str]:
        raw = fm.get("collections")
        items = raw if isinstance(raw, list) else [raw]
        names = [str(i) for i in items if i is not None and str(i).strip()]
        by_name, by_former = self.space._collection_lookup()
        return member_of(names, by_name, by_former)

    def _in_scope(self, scope: Scope | None, fm: Mapping[str, Any]) -> bool:
        if scope is None:
            return True
        if scope.kind == "type":
            return self._type_id_of(fm) == scope.id
        return scope.id in self._collections_of(fm)

    def _decoded(self, fm: Mapping[str, Any] | None, key: str) -> Any:
        if fm is None:
            return None
        t = self.space.type_by_id(self._type_id_of(fm))
        pdef = self.space._pdef(t, key)
        raw = fm.get(key)
        if pdef is None:
            return raw
        if pdef.type == "entity_collections":
            items = raw if isinstance(raw, list) else [raw]
            return [str(i) for i in items if i is not None and str(i).strip()]
        try:
            return decode_value(pdef, raw, dict(fm))
        except (InvalidValue, TypeError, ValueError):
            return raw

    def _fires(self, rule: AutomationRule, notice: WriteNotice, rel: str) -> bool:
        trigger = rule.trigger
        after = notice.after
        if isinstance(trigger, ObjectCreatedTrigger):
            if not self._in_scope(trigger.scope, after):
                return False
            if notice.kind == "created":
                return True
            # A collection scope also fires when a write adds the object to the collection.
            return (
                trigger.scope.kind == "collection"
                and notice.before is not None
                and trigger.scope.id not in self._collections_of(notice.before)
            )
        if isinstance(trigger, PropertyChangedTrigger):
            if notice.kind != "changed" or not self._in_scope(trigger.scope, after):
                return False
            key = trigger.propertyKey
            if notice.requested and key in notice.requested:
                # Completing a repeating Task asked for Done and wrote the reset status (M8):
                # the change the user made is the one asked for.
                after = {**after, key: notice.requested[key]}
            if self._decoded(notice.before, key) == self._decoded(after, key):
                return False
            if trigger.to is None:
                return True
            ctx = self._filter_ctx(self.space.clock(), after)
            to = trigger.to.model_dump(mode="json")
            was = match_filter(self._row(rel, notice.before or {}), to, ctx)
            return not was and match_filter(self._row(rel, after), to, ctx)
        return False

    def _current_path(self, rel: str, fm: Mapping[str, Any]) -> str | None:
        """Where the object is now (a rename moved it since the notice), or None."""
        if (self.space.root / rel).is_file():
            return rel
        oid = str(fm.get("id") or "").strip()
        if not oid:
            return None
        with self.space._lock:
            for s in self.space._summaries.values():
                if s.id == oid and s.template is None:
                    return s.path
        return None

    def _handle(self, notice: WriteNotice) -> None:
        after = notice.after
        if str(after.get("template") or "").strip():
            return  # templates are never triggering objects
        rules = sorted((lr for lr in self.rules.all() if lr.runnable), key=LoadedRule.order_key)
        rules = [
            lr
            for lr in rules
            if isinstance(lr.rule.trigger, ObjectCreatedTrigger | PropertyChangedTrigger)  # type: ignore[union-attr]
        ]
        if not rules:
            return
        for lr in rules:
            rule = lr.rule
            assert rule is not None
            try:
                if not self._fires(rule, notice, notice.path):
                    continue
                if not rule.conditions.is_empty():
                    ctx = self._filter_ctx(self.space.clock(), after)
                    if not match_group(
                        self._row(notice.path, after), rule.conditions.model_dump(mode="json"), ctx
                    ):
                        continue  # condition misses of automatic triggers aren't logged
            except Exception:
                log.exception("Automations: checking rule %s failed", lr.id)
                continue
            path = self._current_path(notice.path, after)
            self._execute(lr, rule.trigger.kind, path, self.space.clock(), None, False)

    # -- rows and filters --

    def _row(self, rel: str, fm: Mapping[str, Any]) -> dict[str, Any]:
        """The API row of the object at ``rel`` with frontmatter ``fm`` (no preview)."""
        space = self.space
        fm = dict(fm)
        with space._lock:
            current = space._raw.get(rel)
        t = fm.get("type")
        type_name = t.strip() if isinstance(t, str) and t.strip() else DEFAULT_TYPE
        of = current.of if current is not None else ObjectFile(None, "", True, None)
        raw = RawObject(path=rel, data=b"", of=of, fm=fm, readOnly=False, typeName=type_name)
        summary = space._summarize(raw)
        tdef = space.type_by_id(summary.type)
        values: dict[str, Any] = {}
        links: dict[str, list[str | None]] = {}
        for p in tdef.propertyDefinitions if tdef is not None else []:
            if p.type == "entity_collections":
                values[p.key] = list(summary.collections)
                continue
            if p.type == "entity_backlinks":
                values[p.key] = space.backlinks(rel)
                continue
            value = decode_value(p, fm.get(p.key), fm)
            if p.type == "entity":
                paths = [space.resolve(r["target"], rel) for r in value]
                for ref, path in zip(value, paths, strict=True):
                    ref["path"] = path
                links[p.key] = paths
            elif p.type == "entity_title" and value is None:
                value = summary.title
            values[p.key] = value
        if "backlinks" not in values:
            values["backlinks"] = space.backlinks(rel)
        return {"summary": asdict(summary), "values": values, "links": links}

    def _filter_ctx(self, instant: datetime, fm: Mapping[str, Any] | None = None) -> FilterCtx:
        space = self.space

        def ids() -> dict[str, str]:
            with space._lock:
                return {s.id: s.path for s in space._summaries.values() if s.id and s.template is None}

        def tags() -> dict[str, str]:
            with space._lock:
                return {
                    s.id: s.title
                    for s in space._summaries.values()
                    if s.id and s.type == "tag" and s.template is None
                }

        return FilterCtx(
            types=[type_json(t) for t in space.types],
            collections=[
                {"id": c.id, "name": c.name, "formerNames": list(c.formerNames)}
                for c in space.collections.values()
            ],
            tag_titles=_LazyMap(tags),
            now=instant,
            tz=space.tz,
            paths_by_id=_LazyMap(ids),
            view_type_ids=[self._type_id_of(fm)] if fm is not None else None,
        )

    # -- running a rule --

    def _new_run(
        self, lr: LoadedRule, kind: str, path: str | None, scheduled: datetime | None, catch_up: bool
    ) -> dict[str, Any]:
        return {
            "id": new_ulid(),
            "ruleId": lr.id,
            "at": _stamp(self.space.clock()),
            "trigger": {
                "kind": kind,
                "path": path,
                "scheduledFor": _stamp(scheduled) if scheduled is not None else None,
                "catchUp": catch_up,
            },
            "status": "ok",
            "actions": [],
            "error": None,
        }

    @staticmethod
    def _result(i: int, kind: str, status: str, path: str | None = None, detail: str | None = None) -> dict[str, Any]:
        return {"index": i, "kind": kind, "status": status, "path": path, "detail": detail}

    def _execute(
        self,
        lr: LoadedRule,
        kind: str,
        path: str | None,
        instant: datetime,
        scheduled: datetime | None,
        catch_up: bool,
        flush: bool = False,
    ) -> dict[str, Any]:
        """Run every action of the rule (object edits as one write, first); log the run."""
        rule = lr.rule
        assert rule is not None
        run = self._new_run(lr, kind, path, scheduled, catch_up)
        results: dict[int, dict[str, Any]] = {}
        if kind != "schedule" and (path is None or not (self.space.root / path).is_file()):
            run["error"] = GONE
            run["status"] = "failed"
            run["actions"] = [self._result(i, a.kind, "skipped") for i, a in enumerate(rule.actions)]
            self._log(run, flush)
            return run
        with writeorigin.acting_as(origin_for(lr.id)):
            obj = [(i, a) for i, a in enumerate(rule.actions) if a.kind in OBJECT_ACTION_KINDS]
            if obj and path is not None:
                done, path = self._object_actions(lr, path, obj, instant)
                results.update(done)
            for i, a in enumerate(rule.actions):
                if i in results:
                    continue
                try:
                    results[i] = self._other_action(lr, i, a, path, instant)
                except _ActionFailed as exc:
                    results[i] = self._result(i, a.kind, "failed", None, str(exc))
                except Exception as exc:
                    log.exception("Automations: action %d of %s failed", i, lr.id)
                    results[i] = self._result(i, a.kind, "failed", None, f"The action failed: {exc}")
        run["actions"] = [results[i] for i in range(len(rule.actions))]
        if any(r["status"] == "failed" for r in run["actions"]):
            run["status"] = "failed"
        self._log(run, flush)
        return run

    def run_scheduled(self, lr: LoadedRule, instant: datetime, catch_up: bool) -> dict[str, Any] | None:
        """One occurrence of a schedule rule, with the occurrence as the run instant. An agent
        schedule's (M21) goes to the agent jobs instead: None."""
        if lr.rule is not None and agent_action(lr.rule) is not None:
            from .schedulerun import AgentJob

            self.agent_jobs.submit(AgentJob(lr.id, instant, catch_up))
            return None
        return self._execute(lr, "schedule", None, instant, instant, catch_up, flush=True)

    def execute_agent_job(self, job: Any, cancel: threading.Event) -> dict[str, Any]:
        """Run one agent schedule occurrence (M21, on the agent jobs' thread); the logged run.

        The rule is read again: a deleted one is neither run nor logged; a turned-off or read-only
        one is logged ``skipped``. Otherwise `schedulerun.run_schedule` runs it as the rule's
        origin, its one action result is logged (flushed) and the skills it loaded go to the
        schedules index.
        """
        from . import schedulerun
        from .agentschedules import ScheduleIndex
        from .settings import read as read_settings

        lr = self.rules.get(job.rule_id)
        if lr is None:
            return {"ruleId": job.rule_id, "status": "skipped", "actions": [], "error": None}
        rule = lr.rule
        action = agent_action(rule) if rule is not None else None
        if rule is None or action is None or not rule.enabled:
            run = self._new_run(lr, "schedule", None, job.instant, job.catch_up)
            run["status"] = "skipped"
            reason = (lr.read_only_reason or CANT_READ) if rule is None else TURNED_OFF
            run["actions"] = [self._result(0, "runAgent", "skipped", None, reason)]
            self._log(run, flush=True)
            return run
        try:
            settings = read_settings()[0]
        except (ReadOnly, OSError, ValueError):  # an unreadable settings file: the defaults
            settings = {}
        run = self._new_run(lr, "schedule", None, job.instant, job.catch_up)
        with writeorigin.acting_as(origin_for(lr.id)):
            result = schedulerun.run_schedule(
                self.space, lr.id, rule.name, action, job.instant, job.catch_up,
                registry=self.agent_jobs.registry(), settings=settings, base_url=self.agent_jobs.base_url(),
                notifier=self.notifier, announce=self.announce, cancel=cancel,
            )
        run["status"] = result.status
        run["actions"] = [self._result(0, "runAgent", result.status, result.path, result.detail)]
        self._log(run, flush=True)
        if result.used_skills:
            try:
                ScheduleIndex().record_used(self.space.root, lr.id, result.used_skills)
            except OSError:
                log.exception("Automations: could not record the skills schedule %s used", lr.id)
        return run

    def log_failed_agent_job(self, job: Any, detail: str) -> dict[str, Any] | None:
        """Log an agent schedule occurrence whose run raised (M21 backstop): status ``failed``, one
        ``runAgent`` result with ``detail``. A deleted rule logs nothing: None."""
        lr = self.rules.get(job.rule_id)
        if lr is None:
            return None
        run = self._new_run(lr, "schedule", None, job.instant, job.catch_up)
        run["status"] = "failed"
        run["actions"] = [self._result(0, "runAgent", "failed", None, detail)]
        self._log(run, flush=True)
        return run

    def log_skipped_catch_up(self, lr: LoadedRule, newest: datetime) -> dict[str, Any]:
        run = self._new_run(lr, "schedule", None, newest, True)
        rule = lr.rule
        assert rule is not None
        run["status"] = "skipped"
        run["actions"] = [
            self._result(i, a.kind, "skipped", None, SKIPPED_CATCH_UP) for i, a in enumerate(rule.actions)
        ]
        self._log(run, flush=True)
        return run

    def run_button(self, rule_id: str, path: str) -> dict[str, Any]:
        """Press a button: run the rule on the object now. Raises `RuleRefused`."""
        lr = self.rules.get(rule_id)
        if lr is None:
            raise RuleRefused(404, f"No automation {rule_id!r}")
        if lr.rule is None:
            raise RuleRefused(423, lr.read_only_reason or CANT_READ)
        rule = lr.rule
        if not isinstance(rule.trigger, ButtonTrigger):
            raise RuleRefused(422, NOT_A_BUTTON)
        if not rule.enabled:
            raise RuleRefused(422, TURNED_OFF)
        try:
            rel = self.space._rel(path)
        except ValueError as exc:
            raise RuleRefused(404, f"No object at {path!r}") from exc
        if not (self.space.root / rel).is_file():
            raise RuleRefused(404, f"No object at {path!r}")
        try:
            _of, fm, _v = self.space.read(rel)
        except (KeyError, OSError) as exc:
            raise RuleRefused(404, f"No object at {path!r}") from exc
        if str(fm.get("template") or "").strip():
            raise RuleRefused(422, IN_TEMPLATE)
        if not self._in_scope(rule.trigger.scope, fm):
            raise RuleRefused(422, OUT_OF_SCOPE)
        instant = self.space.clock()
        if not rule.conditions.is_empty():
            ctx = self._filter_ctx(instant, fm)
            if not match_group(self._row(rel, fm), rule.conditions.model_dump(mode="json"), ctx):
                run = self._new_run(lr, "button", rel, None, False)
                run["status"] = "skipped"
                run["actions"] = [
                    self._result(i, a.kind, "skipped", None, MISSED_CONDITIONS)
                    for i, a in enumerate(rule.actions)
                ]
                self._log(run, flush=True)
                return run
        return self._execute(lr, "button", rel, instant, None, False, flush=True)

    # -- object actions: one write --

    def _object_actions(
        self, lr: LoadedRule, path: str, actions: list[tuple[int, Any]], instant: datetime
    ) -> tuple[dict[int, dict[str, Any]], str]:
        """Apply the object actions as one write; return their results and the object's path
        (a rename since the trigger may have moved it: the retry follows it by its id)."""
        space = self.space
        out: dict[int, dict[str, Any]] = {}
        known: Mapping[str, Any] = {}
        for attempt in range(2):
            out = {}
            if attempt:
                # Before the retry: where the object is now (a rename moves the file).
                path = self._current_path(path, known) or path
            try:
                _of, fm, version = space.read(path)
            except (KeyError, FileNotFoundError):
                moved = self._current_path(path, known) if attempt == 0 and known else None
                if moved is not None and moved != path:
                    continue
                return {i: self._result(i, a.kind, "failed", None, GONE) for i, a in actions}, path
            known = fm
            t = space._type_of(path)
            updates: dict[str, Any] = {}
            prepared: list[tuple[int, str]] = []
            tags = _str_list(fm.get("tags"))
            collections = _str_list(fm.get("collections"))
            tags0, collections0 = list(tags), list(collections)
            for i, a in actions:
                try:
                    self._prepare(a, t, fm, path, instant, updates, tags, collections)
                except _ActionFailed as exc:
                    out[i] = self._result(i, a.kind, "failed", path, str(exc))
                    continue
                prepared.append((i, a.kind))
            if tags != tags0:
                updates["tags"] = tags
            if collections != collections0:
                updates["collections"] = collections
            if not updates:
                for i, k in prepared:
                    out[i] = self._result(i, k, "ok", path)
                return out, path
            try:
                result = space.update_properties(path, updates, version)
            except Conflict:
                if attempt == 0:
                    continue
                return {**out, **{i: self._result(i, k, "failed", path, CHANGED) for i, k in prepared}}, path
            except ReadOnly as exc:
                return {**out, **{i: self._result(i, k, "failed", path, exc.reason) for i, k in prepared}}, path
            except (KeyError, FileNotFoundError):
                if attempt == 0:
                    continue  # moved meanwhile: the retry finds it by its id
                return {**out, **{i: self._result(i, k, "failed", None, GONE) for i, k in prepared}}, path
            except InvalidValue as exc:
                return {**out, **{i: self._result(i, k, "failed", path, str(exc)) for i, k in prepared}}, path
            origin = origin_for(lr.id)
            if result.version != version:
                self.announce(ChangeEvent("changed", path, result.version, origin=origin))
            for synced in result.synced:
                self.announce(ChangeEvent("changed", synced, space.cached_version(synced), origin=origin))
            for i, k in prepared:
                out[i] = self._result(i, k, "ok", path)
            return out, path
        return out, path

    def _prepare(
        self,
        a: Any,
        t: TypeDefinition | None,
        fm: dict[str, Any],
        path: str,
        instant: datetime,
        updates: dict[str, Any],
        tags: list[str],
        collections: list[str],
    ) -> None:
        """Fold one object action into the write (a later action on a key wins)."""
        space = self.space
        if a.kind in ("setProperty", "clearProperty"):
            pdef = _key_def(space, [t] if t is not None else [], a.key)
            if pdef is None:
                name = t.name if t is not None else "this object"
                raise _ActionFailed(f"“{a.key}” isn't a property of {name}.")
            if pdef.type in _READ_ONLY_KINDS or a.key in _LOCKED_KEYS:
                raise _ActionFailed(f"“{pdef.name}” can't be set by an automation.")
            if a.kind == "clearProperty":
                value: Any = None
            elif a.now:
                if pdef.type not in ("datetime", "datetimeSimple"):
                    raise _ActionFailed(f"“{pdef.name}” isn't a date.")
                value = _now_value(pdef, instant, space.tz)
            else:
                value = a.value
            if pdef.type != "entity_collections":
                try:
                    encode_value(pdef, value, fm.get(a.key), link_for=space._link_for(path))
                except InvalidValue as exc:
                    raise _ActionFailed(str(exc)) from exc
            if a.key == "tags":
                tags[:] = _str_list(value) if isinstance(value, list) else []
            elif a.key == "collections":
                collections[:] = _str_list(value) if isinstance(value, list) else []
            else:
                updates[a.key] = value
            return
        if a.kind in ("addTag", "removeTag"):
            title = self._tag_title(a.tagId)
            if title is None:
                raise _ActionFailed(NO_TAG)
            folded = title.casefold()
            has = any(x.casefold() == folded for x in tags)
            if a.kind == "addTag" and not has:
                tags.append(title)
            elif a.kind == "removeTag" and has:
                tags[:] = [x for x in tags if x.casefold() != folded]
            return
        # addToCollection / removeFromCollection
        c = space.collections.get(a.collectionId)
        if c is None or c.readOnlyReason:
            raise _ActionFailed(NO_COLLECTION)
        names = {c.name.strip().casefold(), *(f.strip().casefold() for f in c.formerNames)}
        has = any(x.strip().casefold() in names for x in collections)
        if a.kind == "addToCollection" and not has:
            if t is None or t.id not in c.typeIds:
                raise _ActionFailed(NOT_HELD)
            collections.append(c.name)
        elif a.kind == "removeFromCollection" and has:
            collections[:] = [x for x in collections if x.strip().casefold() not in names]

    def _tag_title(self, tag_id: str) -> str | None:
        with self.space._lock:
            for s in self.space._summaries.values():
                if s.type == "tag" and s.template is None and s.id == tag_id:
                    return s.title
        return None

    # -- the other actions --

    def _other_action(
        self, lr: LoadedRule, i: int, a: Any, path: str | None, instant: datetime
    ) -> dict[str, Any]:
        space = self.space
        origin = origin_for(lr.id)
        if a.kind == "createFromTemplate":
            t = space.type_by_id(a.typeId)
            if t is None:
                raise _ActionFailed(NO_TYPE)
            if a.templateId not in (None, "none") and _find_template(space, t.id, a.templateId) is None:
                raise _ActionFailed(NO_TEMPLATE)
            values: dict[str, Any] | None = None
            if a.relateVia and path is not None:
                rel_def = t.prop(a.relateVia)
                if rel_def is None or rel_def.type != "entity":
                    raise _ActionFailed(f"“{a.relateVia}” is no longer a relation of {t.name}.")
                values = {a.relateVia: [{"target": "", "path": path}]}
            title = expand_placeholders(a.title, space, path, path, instant) if a.title else ""
            had_type_file = bool(type_revision(space.root, t.id))
            try:
                new_rel, version = space.create_object(
                    t.id, title, a.templateId, values, reference=instant
                )
            except TemplateError as exc:
                raise _ActionFailed(NO_TEMPLATE if a.templateId not in (None, "none") else str(exc)) from exc
            except KeyError as exc:
                raise _ActionFailed(NO_TYPE) from exc
            except InvalidValue as exc:
                raise _ActionFailed(str(exc)) from exc
            if not had_type_file and type_revision(space.root, t.id):
                self.announce(ChangeEvent("types", t.id, None, origin=origin))
            self.announce(ChangeEvent("created", new_rel, version, origin=origin))
            if values:
                _of, fm, _v = space.read(new_rel)
                synced, _skipped = space._sync_relations(new_rel, t, {}, fm)
                for s in synced:
                    self.announce(ChangeEvent("changed", s, space.cached_version(s), origin=origin))
            return self._result(i, a.kind, "ok", new_rel)
        if a.kind == "appendToDailyNote":
            note = self._append_to_daily_note(a.text, path, instant, origin)
            return self._result(i, a.kind, "ok", note)
        if a.kind == "notify":
            if not reminders_enabled(space.root):
                return self._result(i, a.kind, "skipped", None, NOTIFY_OFF)
            title = expand_placeholders(a.title, space, path, path, instant) if a.title else ""
            body = expand_placeholders(a.body, space, path, path, instant)
            self.notifier.send(title or (lr.rule.name if lr.rule else ""), body)
            return self._result(i, a.kind, "ok", None)
        raise _ActionFailed(f"Unknown action {a.kind!r}")

    def _append_to_daily_note(self, text: str, path: str | None, instant: datetime, origin: str) -> str:
        space = self.space
        day = to_local(instant, space.tz).date().isoformat()
        note = space.daily_notes()[0].get(day)
        if note is None:
            try:
                note, version = space.create_daily_note(day)
                self.announce(ChangeEvent("created", note, version, origin=origin))
            except DailyNoteExists as exc:
                if exc.reason != "exists":
                    raise _ActionFailed(str(exc.detail)) from exc
                note = exc.path
        lines = expand_placeholders(text, space, path, note, instant)
        lines = lines.replace("\r\n", "\n").replace("\r", "\n")
        if not lines.endswith("\n"):
            lines += "\n"
        for attempt in range(2):
            try:
                of, _fm, version = space.read(note)
            except (KeyError, FileNotFoundError) as exc:
                raise _ActionFailed(GONE) from exc
            body = of.body.replace("\r\n", "\n")
            if body and not body.endswith("\n"):
                body += "\n"
            try:
                new_version = space.save_body(note, body + lines, version)
            except Conflict:
                if attempt == 0:
                    continue
                raise _ActionFailed(CHANGED) from None
            except ReadOnly as exc:
                raise _ActionFailed(exc.reason) from exc
            self.announce(ChangeEvent("changed", note, new_version, origin=origin))
            return note
        raise _ActionFailed(CHANGED)

    # -- the run log --

    def _log(self, run: dict[str, Any], flush: bool = False) -> None:
        with self._log_lock:
            self._unflushed.setdefault(run["ruleId"], []).append(run)
        if flush:
            self.flush_logs()

    def flush_logs(self) -> None:
        """Write the runs logged since the last flush; announce one ``automationRuns`` per rule."""
        with self._log_lock:
            batch, self._unflushed = self._unflushed, {}
            self._last_flush = time.monotonic()
            for rule_id, runs in batch.items():
                try:
                    p = run_log_path(self.space.root, rule_id)
                except ValueError:
                    continue
                old = _read_runs(p)
                merged = [*reversed(runs), *old][:MAX_RUNS]
                try:
                    p.parent.mkdir(parents=True, exist_ok=True)
                    atomic_write(p, dump_json({"runs": merged}))
                except OSError:
                    log.exception("Automations: could not write the run log of %s", rule_id)
        for rule_id in batch:
            self.announce(ChangeEvent("automationRuns", rule_id, None, origin=origin_for(rule_id)))

    def runs(self, rule_id: str, limit: int = MAX_RUNS) -> list[dict[str, Any]]:
        self.flush_logs()
        try:
            p = run_log_path(self.space.root, rule_id)
        except ValueError:
            return []
        return _read_runs(p)[:limit]

    def last_run(self, rule_id: str) -> dict[str, Any] | None:
        found = self.runs(rule_id, 1)
        return found[0] if found else None

    # -- for the routes --

    def rules_changed(self) -> None:
        """A route created, saved, deleted or restored a rule: schedules start counting now."""
        with self.scheduler._lock:
            changed, catch_up = self.scheduler.reconcile(self.space.clock())
            if changed:
                self.scheduler._save()
        if catch_up:
            self.announce_catch_up()
        self.sync_schedule_index()

    def sync_schedule_index(self) -> None:
        """M21: this space's agent schedules in the machine-wide schedules index (written only
        when its content changes)."""
        from .agentschedules import ScheduleIndex

        try:
            ScheduleIndex().sync_space(self.space.root, self.space.name, self.rules.all())
        except OSError:
            log.exception("Automations: could not update the agent schedules index")

    def announce_catch_up(self) -> None:
        self.announce(ChangeEvent("automationRuns", CATCH_UP_PATH, None))

    def catch_up_name(self, rule: AutomationRule) -> str:
        """A template repeat's catch-up row names the template; any other rule itself."""
        tr = rule.templateRepeat
        if tr is not None:
            summary = _find_template(self.space, tr.typeId, tr.templateId)
            if summary is not None and summary.template:
                return str(summary.template)
        return rule.name

    def create(self, payload: Mapping[str, Any]) -> LoadedRule:
        space = self.space
        data = {k: v for k, v in payload.items() if k not in API_ONLY_KEYS}
        data["schemaVersion"] = 1
        data["createdAt"] = _stamp(space.clock())
        with space._lock:
            rule = check_rule(space, data, None, self.rules.all())
            rule_id = new_ulid()
            space.store("automations").write(rule_id, rule.to_json(), "")
        self.rules_changed()
        lr = self.rules.get(rule_id)
        assert lr is not None
        return lr

    def save(self, rule_id: str, payload: Mapping[str, Any], base_revision: str) -> LoadedRule:
        """Save over a rule. Raises `KeyError`, `ReadOnly`, `RevisionConflict`, `InvalidValue`."""
        space = self.space
        store = space.store("automations")
        with space._lock:
            try:
                stored, _rev = store.read(rule_id)
            except DefinitionUnreadable as exc:
                raise ReadOnly(CANT_READ) from exc
            except ValueError as exc:
                raise KeyError(rule_id) from exc
            if stored is None:
                raise KeyError(rule_id)
            current = load_rule(rule_id, stored, _rev, None)
            if current.rule is None:
                raise ReadOnly(current.read_only_reason or CANT_READ)
            kept = {k: v for k, v in stored.items() if k not in AutomationRule.model_fields}
            data = {**kept, **{k: v for k, v in payload.items() if k not in API_ONLY_KEYS}}
            data["schemaVersion"] = 1
            data["createdAt"] = stored.get("createdAt")
            # Turning a rule off, or only on or off, isn't checked against the space: a rule
            # whose template, type or collection is gone can still be turned off and edited.
            against = True
            try:
                asked = AutomationRule.model_validate(dict(data))
            except ValidationError:
                pass  # check_rule names the problem
            else:
                only_switch = {**asked.to_json(), "enabled": None} == {
                    **current.rule.to_json(), "enabled": None}  # fmt: skip
                against = asked.enabled and not only_switch
            rule = check_rule(space, data, rule_id, self.rules.all(), against_space=against)
            store.write(rule_id, rule.to_json(), base_revision)
        self.rules_changed()
        lr = self.rules.get(rule_id)
        assert lr is not None
        return lr

    def delete(self, rule_id: str) -> str:
        self.flush_logs()
        trash_id = self.space.delete_automation(rule_id)
        self.rules_changed()
        return trash_id


def _read_runs(p: Path) -> list[dict[str, Any]]:
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    runs = data.get("runs") if isinstance(data, dict) else None
    return [r for r in runs if isinstance(r, dict)] if isinstance(runs, list) else []


def _str_list(value: Any) -> list[str]:
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    return [str(i) for i in items if i is not None and str(i).strip()]


_SYSTEM_KEYS = frozenset(
    {"title", "description", "tags", "icon", "aliases", "type", "collections", "createdAt",
     "lastUpdated", "backlinks", "coverImage", "color"}
)  # fmt: skip


def _now_value(pdef: PropertyDefinition, instant: datetime, tz: Any) -> dict[str, Any]:
    """The run instant as a date value: the local day for a day-resolution property."""
    constraints = pdef.options.get("constraints") if isinstance(pdef.options, dict) else None
    constraints = constraints if isinstance(constraints, dict) else {}
    if "day" in (constraints.get("resolutionConstraint"), constraints.get("resolutionPreference")):
        return {"start": to_local(instant, tz).date().isoformat(), "resolution": "day"}
    return {"start": _stamp(instant), "resolution": "time"}



# M21: importing agentschedules sets M18's agentskills.SCHEDULE_SKILLS whenever the app runs. A late
# import, since agentschedules imports this module's rules and schedule helpers.
from . import agentschedules as _agentschedules  # noqa: E402, F401
