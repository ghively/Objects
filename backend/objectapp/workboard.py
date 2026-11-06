"""M23: the work board (plan ``2026-11-05-m23-work-section.md``, Contract "Back-end modules").

`board` is what ``GET /api/work/board`` answers: every work item of the scope, in
`WorkService.items` order, as a ``WorkBoardItem`` (M22's ``WorkItemSummary`` plus its steps,
floor items, Hypothesis, type name, whether it is a Project, its deadline and the people its
Blocked on names). The front end computes every view from it. Reads only: nothing is written.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from .localtime import to_local
from .propvalues import decode_value
from .space import Space
from .typemodel import TypeDefinition
from .typetemplates import template_for
from .workread import NotWorkItem, _raw
from .workrules import iso_instant
from .workservice import WorkService

__all__ = ["board", "board_item"]

_SUMMARY_KEYS = (
    "path", "objectId", "title", "typeId", "version", "ticket", "rank", "area", "cause",
    "priority", "priorityNote", "blockedOn", "confidence", "status", "stage", "done", "doneAt",
    "recentlyDone", "turn", "deskSays", "current", "stepCount", "stepsFinished", "projectPath",
    "lastActivity", "lastTouched", "problems",
)
"""Every ``WorkItemSummary`` key (`workread.summary`)."""
_DEADLINE_KINDS = frozenset({"date", "datetime", "datetimeSimple"})
_LINK_RE = re.compile(r"\[\[([^\[\]|]+)(?:\|[^\[\]]*)?\]\]")


def _type_name(t: TypeDefinition | None, fallback: str) -> str:
    return t.name if t is not None and t.name else fallback


def _is_person(t: TypeDefinition | None) -> bool:
    return t is not None and (t.id == "person" or template_for(t) == "person")


def _deadline(space: Space, path: str, t: TypeDefinition | None) -> str | None:
    p = t.prop("deadline") if t is not None else None
    if p is None or p.type not in _DEADLINE_KINDS:
        return None
    try:
        raw = _raw(space, path)
    except KeyError:
        return None
    value = decode_value(p, raw.fm.get("deadline"), raw.fm)
    if isinstance(value, list):
        value = value[0] if value else None
    start = value.get("start") if isinstance(value, dict) else None
    if not isinstance(start, str) or len(start) < 10:
        return None
    if len(start) > 10:  # an instant: the local day it falls on
        try:
            moment = datetime.fromisoformat(start.replace("Z", "+00:00"))
        except ValueError:
            return start[:10]
        if moment.tzinfo is not None:
            return to_local(moment, space.tz).date().isoformat()
    return start[:10]


def _blocked_on_people(space: Space, path: str, blocked_on: Any) -> list[dict]:
    if not isinstance(blocked_on, str) or "[[" not in blocked_on:
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for m in _LINK_RE.finditer(blocked_on):
        target = space.resolve(m.group(1).strip(), path)
        if target is None or target in seen:
            continue
        try:
            s = space.get(target)
        except KeyError:
            continue
        if not _is_person(space.type_by_id(s.type)):
            continue
        seen.add(target)
        out.append({"path": target, "title": s.title})
    return out


def board_item(space: Space, item: dict) -> dict:
    """The ``WorkBoardItem`` of M22's ``WorkItem`` dict ``item`` (reads only)."""
    path = item["path"]
    t = space.type_by_id(item.get("typeId") or "")
    out = {key: item.get(key) for key in _SUMMARY_KEYS}
    out.update({
        "steps": list(item.get("steps") or []),
        "floorItems": list(item.get("floorItems") or []),
        "hypothesis": item.get("hypothesis"),
        "typeName": _type_name(t, item.get("typeId") or ""),
        "isProject": t is not None and template_for(t) == "project",
        "deadline": _deadline(space, path, t),
        "blockedOnPeople": _blocked_on_people(space, path, item.get("blockedOn")),
    })
    return out


def _zone_name(space: Space, now: datetime) -> str:
    key = getattr(space.tz, "key", None)
    if isinstance(key, str) and key:
        return key
    return space.tz.tzname(now) or "local"


def board(space: Space, service: WorkService, scope: Literal["active", "all"]) -> dict:
    """The ``WorkBoard`` of ``scope``; items in ``service.items(scope)`` order. Writes nothing."""
    now = space.clock()
    items: list[dict] = []
    for summary_ in service.items(scope):
        try:
            full = service.item(summary_["path"])
        except (KeyError, NotWorkItem, ValueError):
            continue  # gone or changed type since the listing
        items.append(board_item(space, full))
    return {
        "items": items,
        "now": iso_instant(now),
        "today": to_local(now, space.tz).date().isoformat(),
        "timeZone": _zone_name(space, now),
    }
