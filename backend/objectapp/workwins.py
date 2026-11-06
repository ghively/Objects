"""M23: Wins (plan ``2026-11-05-m23-work-section.md``, Contract "Back-end modules").

`wins` is what ``GET /api/work/wins`` answers (``WorkWins``) over the last ``days`` local days
(today included, in ``space.tz``):

- ``stepsDone``: work steps with state ``done`` whose ``doneAt`` falls on the day;
- ``itemsClosed``: done work items whose ``doneAt`` (``completed``) falls on the day;
- ``objectsChanged``: the distinct objects with a version-history entry on the day, plus the
  objects whose ``lastUpdated`` is on the day (keys unified with `HistoryStore.key_for`),
  templates excluded. The window's total is the distinct objects over all its days.
- ``got``: one entry per done step (``Step {n}: {text}``) and per closed item (``Closed``),
  newest first, at most 50.

Reads only: nothing is written and no folder is created.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from .history import HistoryStore
from .localtime import to_local
from .space import Space
from .workbody import one_line
from .workread import NotWorkItem
from .workservice import WorkService

__all__ = ["MAX_GOT", "wins"]

MAX_GOT = 50
_STEP_TEXT = 70


def _instant(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return at if at.tzinfo is not None else at.replace(tzinfo=UTC)


def _template_keys(space: Space, history: HistoryStore) -> set[str]:
    out: set[str] = set()
    for t in space.types:
        try:
            templates = space.list_templates(t.id)
        except KeyError:
            continue
        for s in templates:
            out.add(history.key_for(s.path, s.id or ""))
            out.add(history._path_key(s.path))
    return out


def wins(space: Space, service: WorkService, history: HistoryStore, *, days: int = 14) -> dict:
    """The ``WorkWins`` of the last ``days`` local days (oldest first). Reads only."""
    tz = space.tz
    today = to_local(space.clock(), tz).date()
    day_list = [(today - timedelta(days=days - 1 - i)).isoformat() for i in range(days)]
    wanted = set(day_list)
    first = today - timedelta(days=days - 1)
    lo = datetime(first.year, first.month, first.day, tzinfo=tz).astimezone(UTC)
    end = today + timedelta(days=1)
    hi = datetime(end.year, end.month, end.day, tzinfo=tz).astimezone(UTC)

    def day_of(at: datetime) -> str | None:
        d = to_local(at, tz).date().isoformat()
        return d if d in wanted else None

    steps_done = dict.fromkeys(day_list, 0)
    closed = dict.fromkeys(day_list, 0)
    got: list[tuple[datetime, dict]] = []

    for item in service.items("all"):
        path, title = item["path"], item["title"]
        if item.get("done"):
            at = _instant(item.get("doneAt"))
            day = day_of(at) if at is not None else None
            if at is not None and day is not None:
                closed[day] += 1
                got.append((at, {"at": item["doneAt"], "kind": "closed", "path": path,
                                 "title": title, "text": "Closed"}))
        if not item.get("stepsFinished"):
            continue
        try:
            steps = service.item(path)["steps"]
        except (KeyError, NotWorkItem, ValueError):
            continue
        for step in steps:
            if step.get("state") != "done":
                continue
            at = _instant(step.get("doneAt"))
            day = day_of(at) if at is not None else None
            if at is None or day is None:
                continue
            steps_done[day] += 1
            got.append((at, {"at": step["doneAt"], "kind": "step", "path": path, "title": title,
                             "text": f"Step {step['n']}: {one_line(step.get('text'), _STEP_TEXT)}"}))

    excluded = _template_keys(space, history)
    changed: dict[str, set[str]] = {d: set() for d in day_list}
    for day, keys in history.changed_keys_by_day(lo, hi, tz).items():
        if day in changed:
            changed[day].update(k for k in keys if k not in excluded)
    for s in space.list():
        at = _instant(s.lastUpdated)
        day = day_of(at) if at is not None else None
        if day is not None:
            changed[day].add(history.key_for(s.path, s.id or ""))

    got.sort(key=lambda t: t[0], reverse=True)
    out_days = [
        {"day": d, "stepsDone": steps_done[d], "itemsClosed": closed[d],
         "objectsChanged": len(changed[d])}
        for d in day_list
    ]
    return {
        "days": out_days,
        "stepsDone": sum(steps_done.values()),
        "itemsClosed": sum(closed.values()),
        "objectsChanged": len(set().union(*changed.values())) if changed else 0,
        "got": [entry for _at, entry in got[:MAX_GOT]],
    }
