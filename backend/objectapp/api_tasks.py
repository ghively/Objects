"""The task routes (M8 Tasks 11 and 12 fill this router; M8 Task 2 mounted it empty).

- ``GET /api/tasks/overdue?path=`` -> ``OverdueInfo`` (reads only; Task 11)
- ``POST /api/tasks/occurrence`` ``{path, action, catchUp?, baseVersion, clientId?}``
  -> M2's ``UpdateResult`` shape with ``task`` set (Task 11)
- ``GET /api/tasks/stats?path=`` -> ``TaskStats`` (reads only; Task 11)
- ``PUT /api/tasks/reminder`` ``{path, key, remind, baseVersion, clientId?}`` -> ``UpdateResult`` (Task 12):
  the Task ``date`` keeps M4's ``remind`` key; any other date property with
  ``supportsReminders`` gets one line in the frontmatter map ``reminders``
  (removing the last entry removes the key)

The rules are the plan's Global Constraints "Occurrence actions" and "Task
Stats". An action is one `Space.update_properties` call that writes ``date``,
``occurrenceLog`` and, for a completion, ``status`` and ``completed`` (plus
M2's ``lastUpdated``); the status hook then sees no category change for Skip
and Excuse, and finds the log already written for a completion.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, tzinfo
from typing import Any, Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .frontmatter import (
    FrontmatterError,
    _key_spans,
    _lines,
    _load_rt,
    _render,
    delete_keys,
    parse_fm,
    set_keys,
)
from .localtime import to_local
from .propvalues import InvalidValue, decode_value
from .recurrence import next_date, scheduled_between, step, week_start_of
from .reminders import REMINDERS_KEY, supports_reminders
from .taskhook import (
    DONE,
    TaskResult,
    _category,
    _current_date,
    _date_api,
    _first_not_started,
    stamp,
    status_key_of,
)
from .tasklog import (
    LOG_KEY,
    LogEntry,
    entry_day,
    format_entry,
    format_scheduled,
    log_value,
    parse_log,
)
from .taskmodel import RepeatRule, format_remind, parse_remind, parse_repeat
from .typemodel import PropertyDefinition, TypeDefinition, is_task_type
from .watcher import ChangeEvent

__all__ = ["OVERDUE_CAP", "overdue_info", "router", "set_map_entry", "task_stats"]

OVERDUE_CAP = 99
GRID_PAST = 26
GRID_FUTURE = 4
_ONE_DAY = timedelta(days=1)
_PERIOD_DAYS = {"day": 1, "weekday": 3, "week": 7, "month": 31, "year": 366}

DateLike = date | datetime
CellState = Literal["completed", "excused", "skipped", "missed", "future", "none"]
_LOGGED_ACTION = {"complete": "completed", "skip": "skipped", "excuse": "excused"}


class Problem(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class TaskState:
    rel: str
    fm: dict
    version: str
    type: TypeDefinition
    status_def: PropertyDefinition | None
    date_def: PropertyDefinition | None
    rule: RepeatRule
    current: DateLike | None
    date_value: dict[str, Any] | None


def _norm(path: str) -> str:
    return path.replace("\\", "/").strip("/")


def load_task(space: Any, path: str) -> TaskState:
    """The recurring Task at ``path``; `Problem` 404 / 422 otherwise. Reads only."""
    rel = _norm(path)
    try:
        _of, fm, version = space.read(rel)
    except (KeyError, FileNotFoundError, IsADirectoryError, NotADirectoryError):
        raise Problem(404, f"No object at {path!r}") from None
    except ValueError as exc:  # outside the space, or not an object
        raise Problem(400, str(exc)) from None
    t = space._type_of(rel)
    if not is_task_type(t):
        raise Problem(422, "Not a recurring task")
    raw = fm.get("repeat")
    rule = parse_repeat(raw) if isinstance(raw, str) else None
    if rule is None:
        raise Problem(422, "Not a recurring task")
    date_def = t.prop("date")
    value = decode_value(date_def, fm.get("date"), fm) if date_def is not None else None
    current = _current_date(value) if isinstance(value, dict) else None
    return TaskState(
        rel, fm, version, t, status_key_of(t), date_def, rule, current,
        value if current is not None else None,
    )  # fmt: skip


def _day(d: DateLike, tz: tzinfo) -> date:
    return to_local(d, tz).date() if isinstance(d, datetime) else d


def _safe_shift(d: date, days: int) -> date:
    try:
        return d + timedelta(days=days)
    except OverflowError:
        return date.max if days > 0 else date.min


def _missed(
    rule: RepeatRule, current: DateLike, today: date, tz: tzinfo, week_start: str, limit: int
) -> list[DateLike]:
    """The newest `limit` scheduled dates from ``current`` up to yesterday, oldest first
    (by due date only). Capacities shows at most 99 missed occurrences (`OVERDUE_CAP`);
    Gene: the most recent ones (audit 2026-11-01)."""
    cur_day = _day(current, tz)
    if rule.mode != "dueDate" or cur_day >= today:
        return []
    return scheduled_between(
        rule, current, cur_day, today - _ONE_DAY, tz, week_start, limit, newest=True
    )


def overdue_info(state: TaskState, now: datetime, tz: tzinfo, week_start: str) -> dict[str, Any]:
    """`OverdueInfo`: the missed occurrences, at most 99 (``capped`` when there are more)."""
    today = to_local(now, tz).date()
    missed: list[DateLike] = []
    if state.current is not None:
        missed = _missed(state.rule, state.current, today, tz, week_start, OVERDUE_CAP + 1)
    capped = len(missed) > OVERDUE_CAP
    missed = missed[-OVERDUE_CAP:]
    return {
        "count": len(missed),
        "capped": capped,
        "missed": [format_scheduled(d) for d in missed],
        "current": state.date_value,
        "today": today.isoformat(),
    }


# -- the occurrence action ------------------------------------------------------------


def _done_option(sdef: PropertyDefinition) -> str | None:
    for opt in sdef.options.get("set") or []:
        if isinstance(opt, dict) and _category(sdef, str(opt.get("text", ""))) == DONE:
            return str(opt.get("text"))
    return None


def _step_once(rule: RepeatRule, d: DateLike, tz: tzinfo, week_start: str) -> DateLike | None:
    try:
        nxt = step(rule, d, tz, week_start)
    except (OverflowError, ValueError):
        return None
    until = rule.until_date
    if until is not None and _day(nxt, tz) > until:
        return None
    return nxt


def plan_occurrence(
    state: TaskState,
    action: str,
    catch_up: str,
    now: datetime,
    tz: tzinfo,
    week_start: str,
) -> tuple[list[DateLike], DateLike | None]:
    """(the scheduled dates the action logs, the next ``date`` or None when the series ended)."""
    rule, current = state.rule, state.current
    assert current is not None
    today = to_local(now, tz).date()
    if rule.mode == "completionDate":
        if catch_up != "advanceOne":
            raise Problem(422, "Catching up needs a by-due-date rule")
        return [current], next_date(rule, current, now, today, tz, week_start)
    if catch_up == "advanceOne":
        return [current], _step_once(rule, current, tz, week_start)
    # At most the 99 most recent missed occurrences are logged (Capacities' cap; a daily
    # task dated 1800 otherwise wrote a 10,001-line log).
    missed = _missed(rule, current, today, tz, week_start, OVERDUE_CAP)
    nxt = next_date(rule, current, now, today, tz, week_start)
    if catch_up == "catchUpBeforeNow":
        return [missed[-1] if missed else current], nxt
    # catchUpThroughNow
    return (missed or [current]), nxt


class OccurrenceRequest(BaseModel):
    path: str
    action: str
    catchUp: str | None = None
    baseVersion: str
    clientId: str | None = None


# -- Task Stats ------------------------------------------------------------------------


@dataclass
class _Occ:
    day: date
    scheduled: str
    state: CellState


def _created_day(raw: Any, tz: tzinfo) -> date | None:
    if isinstance(raw, datetime):
        return _day(raw if raw.tzinfo else raw.replace(tzinfo=tz), tz)
    if isinstance(raw, date):
        return raw
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return _day(dt, tz) if dt.tzinfo else dt.date()


def _schedule(
    rule: RepeatRule, current: DateLike | None, start: date, end: date, tz: tzinfo, ws: str
) -> list[DateLike]:
    if current is None or rule.mode != "dueDate" or end < start:
        return []
    return scheduled_between(rule, current, start, end, tz, ws, limit=100_000)


def task_stats(
    rule: RepeatRule,
    current: DateLike | None,
    entries: list[LogEntry],
    created: date | None,
    now: datetime,
    tz: tzinfo,
    week_start: str,
) -> dict[str, Any]:
    """`TaskStats` from the rule, the current ``date``, the log and ``createdAt``'s day.

    The history starts at the first log entry or the creation day, whichever is
    earlier (and never after the current date). A logged occurrence has its
    logged state (the last line for a day wins); a scheduled date without a line
    is missed before today and future from today. The streak is the run of
    completed or excused occurrences ending at the latest resolved one (today's
    counts once it is logged); the rate leaves excused out.
    """
    today = to_local(now, tz).date()
    logged: dict[date, _Occ] = {}
    for e in entries:
        d = entry_day(e.scheduled, tz)
        logged[d] = _Occ(d, e.scheduled, e.action)  # type: ignore[arg-type]
    starts = [*logged, *([created] if created else [])]
    cur_day = _day(current, tz) if current is not None else None
    if cur_day is not None:
        starts.append(cur_day)
    start = min(starts) if starts else today
    period = _PERIOD_DAYS.get(rule.unit, 31) * max(1, rule.every)

    occ: dict[date, _Occ] = dict(logged)
    scheduled_days: set[date] = set()
    for d in _schedule(rule, current, start, today, tz, week_start):
        day = _day(d, tz)
        scheduled_days.add(day)
        if day not in occ:
            occ[day] = _Occ(day, format_scheduled(d), "missed" if day < today else "future")
    future: list[_Occ] = []
    ahead = _safe_shift(today, period * (GRID_FUTURE + 1) + 7)
    for d in _schedule(rule, current, _safe_shift(today, 1), ahead, tz, week_start):
        day = _day(d, tz)
        if day not in occ:
            future.append(_Occ(day, format_scheduled(d), "future"))
        if len(future) >= GRID_FUTURE:
            break

    ordered = sorted(occ.values(), key=lambda o: o.day)
    resolved = [o for o in ordered if o.state != "future"]
    streak = 0
    for o in reversed(resolved):
        if o.state not in ("completed", "excused"):
            break
        streak += 1
    best = run = 0
    for o in resolved:
        run = run + 1 if o.state in ("completed", "excused") else 0
        best = max(best, run)
    completed = sum(o.state == "completed" for o in resolved)
    against = sum(o.state in ("skipped", "missed") for o in resolved)
    rate = completed / (completed + against) if completed + against else None
    at_risk = today in scheduled_days and today not in logged and streak > 0

    past = [o for o in ordered if o.day <= today]
    later = sorted([*(o for o in ordered if o.day > today), *future], key=lambda o: o.day)
    cells = past[-GRID_PAST:]
    if len(cells) < GRID_PAST:  # before the history: the rule's dates, "No occurrence"
        first = cells[0].day if cells else start
        pad_from = _safe_shift(first, -(period * (GRID_PAST + 1) + 7))
        pad = [
            _Occ(_day(d, tz), format_scheduled(d), "none")
            for d in _schedule(rule, current, pad_from, _safe_shift(first, -1), tz, week_start)
        ]
        need = GRID_PAST - len(cells)
        cells = [*pad[max(0, len(pad) - need) :], *cells]
    cells = [*cells, *later[:GRID_FUTURE]]
    return {
        "unit": "day" if rule.unit == "weekday" else rule.unit,
        "currentStreak": streak,
        "bestStreak": best,
        "completions": completed,
        "completionRate": rate,
        "atRisk": at_risk,
        "cells": [{"scheduled": o.scheduled, "state": o.state} for o in cells],
    }


# -- reminders on other date properties --------------------------------------------------


def set_map_entry(src: str, map_key: str, entry: str, value: str | None) -> str:
    """Frontmatter ``src`` with one entry of the block map ``map_key`` set or removed.

    Only that entry's line changes (a new entry is one line after the last one,
    at the entries' indent); removing the last entry removes ``map_key``; a
    missing map is appended as ``map_key:`` plus the entry. A flow-style or
    non-map value is rewritten whole as a block map (our choice). Raises
    `FrontmatterError` for frontmatter that isn't a YAML mapping.
    """
    fm = parse_fm(src) if src.strip() else {}
    current = fm.get(map_key)
    if not isinstance(current, dict):
        if value is None:
            return src
        return set_keys(src, {map_key: {entry: value}})
    if value is None and entry not in current:
        return src
    if value is None and len(current) == 1:
        return delete_keys(src, [map_key])
    data = _load_rt(src)
    node = data.get(map_key) if data is not None else None
    if data is None or data.fa.flow_style() or node is None or node.fa.flow_style():
        merged = {str(k): v for k, v in current.items()}
        if value is None:
            merged.pop(entry, None)
        else:
            merged[entry] = value
        return set_keys(src, {map_key: merged})
    lines = _lines(src)
    _start, end = _key_spans(data, lines)[map_key]
    rows = sorted((node.lc.key(k)[0], node.lc.key(k)[1], str(k)) for k in node)
    indent = " " * rows[0][1]
    new = [indent + line for line in _render(entry, value)] if value is not None else []
    for i, (row, _col, k) in enumerate(rows):
        if k != entry:
            continue
        stop = rows[i + 1][0] if i + 1 < len(rows) else end
        while stop > row + 1 and lines[stop - 1].strip() == "":
            stop -= 1
        return "".join([*lines[:row], *new, *lines[stop:]])
    return "".join([*lines[:end], *new, *lines[end:]])


class ReminderRequest(BaseModel):
    path: str
    key: str
    remind: str | None = None
    baseVersion: str
    clientId: str | None = None


def _resolution(pdef: PropertyDefinition, fm: dict) -> str:
    """The date's resolution; with no date, the definition's ``resolutionPreference`` (our choice)."""
    value = decode_value(pdef, fm.get(pdef.key), fm)
    if isinstance(value, dict) and value.get("resolution") in ("day", "time"):
        return value["resolution"]
    constraints = pdef.options.get("constraints") or {}
    return "time" if constraints.get("resolutionPreference") == "time" else "day"


# -- the router ------------------------------------------------------------------------


def _problem(exc: Problem) -> JSONResponse:
    return JSONResponse({"detail": exc.detail}, status_code=exc.status)


def router(ctx: ApiContext) -> APIRouter:
    """The task routes, mounted on the app's `/api` router (so no prefix here)."""
    r = APIRouter()
    space = ctx.space

    def week_start() -> str:
        return week_start_of(space.root)

    @r.get("/tasks/overdue")
    def get_overdue(path: str):
        try:
            state = load_task(space, path)
            if state.rule.mode != "dueDate":
                raise Problem(422, "Not a recurring by-due-date task")
        except Problem as exc:
            return _problem(exc)
        return overdue_info(state, space.clock(), space.tz, week_start())

    @r.get("/tasks/stats")
    def get_stats(path: str):
        try:
            state = load_task(space, path)
        except Problem as exc:
            return _problem(exc)
        tz = space.tz
        return task_stats(
            state.rule,
            state.current,
            parse_log(state.fm.get(LOG_KEY)),
            _created_day(state.fm.get("createdAt"), tz),
            space.clock(),
            tz,
            week_start(),
        )

    @r.post("/tasks/occurrence")
    def post_occurrence(req: OccurrenceRequest):
        from .server import _display_safe  # lazy: server.py imports this module
        from .space import Conflict, ReadOnly

        action = req.action
        catch_up = req.catchUp or "advanceOne"
        try:
            if action not in _LOGGED_ACTION:
                raise Problem(422, f"Unknown action {action!r}")
            if catch_up not in ("advanceOne", "catchUpBeforeNow", "catchUpThroughNow"):
                raise Problem(422, f"Unknown catch-up choice {catch_up!r}")
            if action == "excuse" and catch_up == "catchUpThroughNow":
                raise Problem(422, "Excuse offers only this occurrence or all missed before today")
            state = load_task(space, req.path)
            if state.version != req.baseVersion:
                return JSONResponse({"currentVersion": state.version}, status_code=409)
            if state.current is None or state.date_def is None:
                raise Problem(422, "The recurring task has no date")
            now = space.clock()
            tz = space.tz
            acted, nxt = plan_occurrence(state, action, catch_up, now, tz, week_start())
        except Problem as exc:
            return _problem(exc)

        logged = _LOGGED_ACTION[action]
        lines = [format_entry(d, logged, now) for d in acted]
        updates: dict[str, Any] = {LOG_KEY: log_value(state.fm.get(LOG_KEY), lines)}
        value = _date_api(nxt) if nxt is not None else None
        if value is not None:
            updates["date"] = value
        if action == "complete" and state.status_def is not None:
            reset = _first_not_started(state.status_def)
            done = _done_option(state.status_def)
            text = reset if (value is not None and reset is not None) else done
            if value is not None and reset is None:  # nothing to reset to: completes normally
                updates.pop("date", None)
                value = None
            if text is not None:
                updates[state.status_def.key] = [text]
            updates["completed"] = {"start": stamp(now), "resolution": "time"}
        try:
            result = space.update_properties(state.rel, updates, req.baseVersion)
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return JSONResponse({"detail": str(exc)}, status_code=422)
        except (KeyError, FileNotFoundError):
            return JSONResponse({"detail": f"No object at {req.path!r}"}, status_code=404)
        if result.version != req.baseVersion:
            ctx.announce(ChangeEvent("changed", state.rel, result.version, origin=req.clientId))
        for path in result.synced:
            ctx.announce(
                ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId)
            )
        task = TaskResult(completed=action == "complete", advanced=value is not None, date=value)
        return _display_safe(
            {
                "version": result.version,
                "frontmatter": result.frontmatter,
                "links": result.links,
                "synced": result.synced,
                "skipped": [asdict(s) for s in result.skipped],
                "task": task.to_api(),
            }
        )

    @r.put("/tasks/reminder")
    def put_reminder(req: ReminderRequest):
        from .server import _display_safe  # lazy: server.py imports this module
        from .space import Conflict, ReadOnly

        rel = _norm(req.path)
        try:
            _of, fm, version = space.read(rel)
        except (KeyError, FileNotFoundError, IsADirectoryError, NotADirectoryError):
            return JSONResponse({"detail": f"No object at {req.path!r}"}, status_code=404)
        except ValueError as exc:  # outside the space, or not an object
            return JSONResponse({"detail": str(exc)}, status_code=400)
        t = space._type_of(rel)
        pdef = t.prop(req.key) if t is not None else None
        if pdef is None or not supports_reminders(pdef):
            return JSONResponse(
                {"detail": f"{req.key!r} is not a date property that supports reminders"},
                status_code=422,
            )
        if version != req.baseVersion:
            return JSONResponse({"currentVersion": version}, status_code=409)
        text: str | None = None
        if req.remind is not None and req.remind.strip():
            resolution = _resolution(pdef, fm)
            rule = parse_remind(req.remind, resolution)  # type: ignore[arg-type]
            if rule is None:
                return JSONResponse(
                    {"detail": f"{req.remind!r} doesn't fit a {resolution} date"}, status_code=422
                )
            text = format_remind(rule, resolution)  # type: ignore[arg-type]
        try:
            if is_task_type(t) and req.key == "date":  # M4's `remind` key
                if text is None:
                    result = space.update_properties(rel, {}, req.baseVersion, remove=["remind"])
                else:
                    result = space.update_properties(rel, {"remind": text}, req.baseVersion)
                new_version, out_fm = result.version, result.frontmatter
                links, synced = result.links, result.synced
                skipped = [asdict(s) for s in result.skipped]
            else:
                key = req.key

                def edit(src: str, _fm: dict) -> str:
                    return set_map_entry(src, REMINDERS_KEY, key, text)

                new_version = space._write(rel, req.baseVersion, space._fm_edit(edit))
                _of, out_fm, _v = space.read(rel)
                links, synced, skipped = space.links_of(rel, out_fm), [], []
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except FrontmatterError as exc:
            return JSONResponse({"reason": str(exc), "detail": str(exc)}, status_code=423)
        except InvalidValue as exc:
            return JSONResponse({"detail": str(exc)}, status_code=422)
        except (KeyError, FileNotFoundError):
            return JSONResponse({"detail": f"No object at {req.path!r}"}, status_code=404)
        if new_version != req.baseVersion:
            ctx.announce(ChangeEvent("changed", rel, new_version, origin=req.clientId))
        for path in synced:
            ctx.announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        return _display_safe(
            {
                "version": new_version,
                "frontmatter": out_fm,
                "links": links,
                "synced": synced,
                "skipped": skipped,
            }
        )

    return r

