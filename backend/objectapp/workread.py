"""M22: reading work items (plan ``2026-11-05-m22-work-model.md``, Task 7 and the Contract's API
types): one object's decoded work data (`item_data`), its ``WorkItemSummary`` (`summary`) and
its ``WorkItem`` (`full`), and every work item's path (`iter_work_paths`).

Reads use the space's cached raw objects (falling back to a fresh read of the file) and never
write anything: System is inferred for display only, ids are never assigned (an id-less step
is ``@n``), a list that can't be read is served with what can be read plus ``problems``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from .localtime import from_local
from .propvalues import decode_value
from .typedefs import read_raw
from .typemodel import PropertyDefinition, TypeDefinition
from .workbody import ActivityLine, WorkNoteLine, activity_lines, work_note_lines
from .workfields import TICKET_FIELDS, WORK_FIELDS, is_work_type, resolved_key
from .workmodel import NOT_WORK_ITEM, FloorItem, Stage, Step, Turn
from .workresolution import WorkItemData as ResolutionData
from .workresolution import resolution_note
from .workrules import (
    allowed_actions,
    current_index,
    desk_says,
    infer_system,
    is_done,
    iso_instant,
    normalize_desk_priority,
    recently_done,
    stage_of,
    ticket_url,
    whose_turn,
)
from .workvalues import floor_api, read_floor_at, read_steps_at, read_text_list, step_api

if TYPE_CHECKING:
    from .space import Space

__all__ = [
    "NotWorkItem",
    "WorkItemData",
    "full",
    "item_data",
    "iter_work_paths",
    "summary",
    "work_steps",
]

_KINDS: dict[str, str] = {f.key: f.kind for f in (*TICKET_FIELDS, *WORK_FIELDS)}
"""Each ticket and work field's key and the kind work logic reads it as."""
_PRIORITIES = frozenset({"Critical", "High", "Medium", "Low"})


class NotWorkItem(LookupError):
    """The object's type has no work fields (HTTP 422 ``This object has no work fields.``)."""

    def __init__(self, message: str = NOT_WORK_ITEM) -> None:
        super().__init__(message)

    def __str__(self) -> str:  # LookupError's str() would quote the message
        return str(self.args[0]) if self.args else NOT_WORK_ITEM


@dataclass
class WorkItemData(ResolutionData):
    """One work item, decoded (what `summary`, `full` and the resolution note read)."""

    path: str = ""
    object_id: str | None = None
    type_id: str = ""
    version: str = ""
    body: str = ""
    fm: dict[str, Any] = field(default_factory=dict)
    defs: dict[str, PropertyDefinition] = field(default_factory=dict)
    """The type's ticket and work fields whose kind matches (by key)."""
    fields: dict[str, Any] = field(default_factory=dict)
    steps_at: list[tuple[int, Step]] = field(default_factory=list)
    floor_at: list[tuple[int, FloorItem]] = field(default_factory=list)
    assumed: list[str] = field(default_factory=list)
    to_raise: list[str] = field(default_factory=list)
    confidence_reason: str | None = None
    rank: int | float | None = None
    area: str | None = None
    priority: str | None = None
    priority_note: str | None = None
    status: str | None = None
    stage: Stage = "notStarted"
    done: bool = False
    done_at: str | None = None
    recently_done: bool = False
    turn: Turn = "none"
    desk_says: str | None = None
    ticket: dict[str, Any] | None = None
    project_path: str | None = None
    last_touched: str = ""
    problems: list[str] = field(default_factory=list)
    steps_unreadable: bool = False
    """Fix pass H: the step list has an entry that can't be read, so every step write is refused
    (`STEPS_UNREADABLE`) until the file is fixed: the UI offers no step actions."""


# -- small helpers --------------------------------------------------------------------------------


def _instant(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def _str(value: Any) -> str | None:
    if value is None or isinstance(value, (dict, list)):
        return None
    text = str(value).strip()
    return text or None


def _first(value: Any) -> Any:
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _day(value: Any) -> str | None:
    if isinstance(value, dict) and isinstance(value.get("start"), str):
        return value["start"][:10]
    return None


def _resolved_day(t: TypeDefinition, fields: dict[str, Any], fm: dict[str, Any]) -> str | None:
    """The ticket's resolved day: ``deskResolved``, or (M31, G3) the type's own Resolved when it has
    no ``deskResolved`` (the Incident)."""
    if resolved_key(t) == "resolved":
        p = t.prop("resolved")
        assert p is not None
        return _day(decode_value(p, fm.get("resolved"), fm))
    return _day(fields.get("deskResolved"))


def _system(text: str | None, ticket_id: str | None) -> str | None:
    folded = (text or "").strip().casefold()
    if folded == "jira":
        return "Jira"
    if folded == "servicenow":
        return "ServiceNow"
    return infer_system(ticket_id)


def _raw(space: Space, rel: str):
    with space._lock:
        raw = space._raw.get(rel)
    if raw is None:
        if not (space.root / rel).is_file():
            raise KeyError(rel)
        raw = read_raw(space.root, rel)
    return raw


def work_steps(
    steps: Sequence[Step], positions: Sequence[int] | None = None, unreadable: bool = False
) -> list[dict]:
    """``WorkStep``s of a step list: the ``StepValue`` (id/rev from the step's position in the
    file) plus ``n`` (1-based), ``current`` and the user's ``actions`` (none while the list has an
    entry that can't be read: every step write is refused then; fix pass H)."""
    cur = current_index(steps)
    out: list[dict] = []
    for i, step in enumerate(steps):
        pos = positions[i] if positions is not None else i + 1
        out.append({
            **step_api(step, pos),
            "n": i + 1,
            "current": i == cur,
            "actions": [] if unreadable else allowed_actions(steps, i, "user"),
        })
    return out


# -- reading --------------------------------------------------------------------------------------


def iter_work_paths(space: Space) -> list[str]:
    """Every non-template object of a work type, by path."""
    types: dict[str, TypeDefinition | None] = {}
    out: list[str] = []
    for s in space.list():
        if s.type not in types:
            types[s.type] = space.type_by_id(s.type)
        if is_work_type(types[s.type]):
            out.append(s.path)
    return out


def item_data(space: Space, rel: str, *, now: datetime, jira_site: str | None) -> WorkItemData:
    """The decoded work data of the object at ``rel`` (`KeyError` when there is none,
    `NotWorkItem` when its type isn't a work type). Writes nothing."""
    rel = space._rel(rel)
    summary_ = space.get(rel)
    t = space.type_by_id(summary_.type)
    if not is_work_type(t):
        raise NotWorkItem()
    assert t is not None
    raw = _raw(space, rel)
    from .space import version_of  # space imports the work modules

    fm: dict[str, Any] = dict(raw.fm)
    body = raw.of.body or ""
    problems: list[str] = []

    defs: dict[str, PropertyDefinition] = {}
    for key, kind in _KINDS.items():
        p = t.prop(key)
        if p is None:
            continue
        if p.type != kind:
            problems.append(f"{p.name} is a {p.type} property, so work leaves it out.")
            continue
        defs[key] = p

    fields: dict[str, Any] = {}
    for key, p in defs.items():
        value = decode_value(p, fm.get(key), fm)
        if p.type == "label" and not (p.options or {}).get("isArray"):
            value = _first(value)
        elif p.type == "entity":
            refs = value or []
            for ref in refs:
                ref["path"] = space.resolve(ref["target"], rel)
            value = refs[0] if refs and not (p.options or {}).get("isArray") else (refs or None)
        fields[key] = value

    def text(key: str) -> str | None:
        return _str(fields.get(key))

    steps_at, step_problems = read_steps_at(fm.get("steps"))
    floor_at, floor_problems = read_floor_at(fm.get("floorItems")) if "floorItems" in defs else ([], [])
    problems += step_problems + floor_problems
    steps = [s for _n, s in steps_at]

    def text_list(key: str) -> list[str]:
        return read_text_list(fm.get(key)) if key in defs else []

    status_def = t.prop("status")
    if status_def is not None and status_def.type != "label":
        status_def = None
    status: str | None = None
    if status_def is not None:
        decoded = decode_value(status_def, fm.get("status"), fm)
        status = decoded[0] if decoded else None
    stage = stage_of(status, status_def)
    done = is_done(stage)
    done_at = _instant(fm.get("completed"))
    last_updated = _instant(fm.get("lastUpdated"))
    desk_status = text("deskStatus")
    turn = whose_turn(stage, steps, desk_status)

    priority = None
    pdef = t.prop("priority")
    if pdef is not None and pdef.type == "label":
        decoded = decode_value(pdef, fm.get("priority"), fm)
        priority = decoded[0] if decoded else None

    ticket_id = text("ticketId")
    ticket: dict[str, Any] | None = None
    if ticket_id is not None:
        system = _system(text("system"), ticket_id)
        desk_priority = normalize_desk_priority(text("deskPriority"))
        ticket = {
            "id": ticket_id,
            "system": system,
            "url": ticket_url(system, ticket_id, text("ticketLink"), jira_site),
            "deskStatus": desk_status,
            "deskPriority": desk_priority if desk_priority in _PRIORITIES else None,
            "requester": text("requester"),
            "group": text("deskGroup"),
            "location": text("deskLocation"),
            "opened": _day(fields.get("deskOpened")),
            "updated": _day(fields.get("deskUpdated")),
            "resolved": _resolved_day(t, fields, fm),
        }

    project = fields.get("project") if "project" in defs else None
    project_path = project.get("path") if isinstance(project, dict) else None

    activity = activity_lines(body)
    notes = work_note_lines(body)
    touched = last_updated
    if activity:
        try:
            at = from_local(datetime.strptime(activity[-1]["at"], "%Y-%m-%d %H:%M"), space.tz)
        except (ValueError, OverflowError):
            at = None
        if at is not None and (touched is None or at > touched):
            touched = at
    if touched is None:
        touched = _instant(fm.get("createdAt"))

    rank = fields.get("rank")
    return WorkItemData(
        ticket_id=ticket_id,
        title=summary_.title,
        steps=steps,
        verified=text_list("verified"),
        findings=text("findings"),
        hypothesis=text("hypothesis"),
        cause=text("cause"),
        confidence=text("confidence"),
        blocked_on=text("blockedOn"),
        activity=activity,
        work_notes=notes,
        path=rel,
        object_id=summary_.id,
        type_id=t.id,
        version=version_of(raw.data),
        body=body,
        fm=fm,
        defs=defs,
        fields=fields,
        steps_at=list(steps_at),
        floor_at=list(floor_at),
        assumed=text_list("assumed"),
        to_raise=text_list("toRaiseConfidence"),
        confidence_reason=text("confidenceReason"),
        rank=rank if isinstance(rank, (int, float)) and not isinstance(rank, bool) else None,
        area=text("area"),
        priority=priority,
        priority_note=text("priorityNote"),
        status=status,
        stage=stage,
        done=done,
        done_at=iso_instant(done_at) if done_at is not None else None,
        recently_done=done and recently_done(done_at, last_updated, now),
        turn=turn,
        desk_says=desk_says(stage, desk_status),
        ticket=ticket,
        project_path=project_path,
        last_touched=iso_instant(touched) if touched is not None else "",
        problems=problems,
        steps_unreadable=bool(step_problems),
    )


def summary(data: WorkItemData) -> dict:
    """The item's ``WorkItemSummary``."""
    steps = list(data.steps)
    wsteps = work_steps(steps, [n for n, _s in data.steps_at], data.steps_unreadable)
    cur = next((s for s in wsteps if s["current"]), None)
    last: ActivityLine | None = data.activity[-1] if data.activity else None
    return {
        "path": data.path,
        "objectId": data.object_id,
        "title": data.title,
        "typeId": data.type_id,
        "version": data.version,
        "ticket": data.ticket,
        "rank": data.rank,
        "area": data.area,
        "cause": data.cause,
        "priority": data.priority,
        "priorityNote": data.priority_note,
        "blockedOn": data.blocked_on,
        "confidence": data.confidence,
        "status": data.status,
        "stage": data.stage,
        "done": data.done,
        "doneAt": data.done_at,
        "recentlyDone": data.recently_done,
        "turn": data.turn,
        "deskSays": data.desk_says,
        "current": cur,
        "stepCount": len(steps),
        "stepsFinished": sum(1 for s in steps if s.state in ("done", "declined")),
        "projectPath": data.project_path,
        "lastActivity": dict(last) if last is not None else None,
        "lastTouched": data.last_touched,
        "problems": list(data.problems),
        "stepsUnreadable": data.steps_unreadable,
    }


def full(data: WorkItemData, body: str) -> dict:
    """The item's ``WorkItem`` (the resolution note for tickets only)."""
    out = summary(data)
    notes: list[WorkNoteLine] = list(data.work_notes)
    out.update({
        "fields": dict(data.fields),
        "steps": work_steps(list(data.steps), [n for n, _s in data.steps_at], data.steps_unreadable),
        "verified": list(data.verified),
        "assumed": list(data.assumed),
        "toRaiseConfidence": list(data.to_raise),
        "floorItems": [floor_api(i, n) for n, i in data.floor_at],
        "findings": data.findings,
        "hypothesis": data.hypothesis,
        "confidenceReason": data.confidence_reason,
        "activity": [dict(a) for a in reversed(list(data.activity))],
        "workNotes": [dict(n) for n in notes],
        "resolution": resolution_note(data, body) if data.ticket is not None else None,
    })
    return out

