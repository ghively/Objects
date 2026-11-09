"""M23: the general floor list (plan ``2026-11-05-m23-work-section.md``, Contract "Storage" and
"General floor").

Things to collect on the floor that belong to no work item live in
``.object/work/floor.json`` (``space.store("work")``, id ``floor``):
``{"schemaVersion": 1, "items": [<M22 floor mapping>]}``. The keys, codec, caps, ids, revisions
and op rules are M22's, as `WorkService.floor` applies them; the list has no Activity. A
missing file reads as no items and is created by the first ``add``; reads write nothing.
"""

from __future__ import annotations

from typing import Any, Literal

from .jsonstore import DefinitionUnreadable, json_revision
from .propvalues import InvalidValue
from .space import ReadOnly, Space
from .typemodel import RevisionConflict
from .workbody import stamp_local
from .workmodel import MAX_FLOOR, MAX_NOTE, FloorItem
from .workservice import FLOOR_NEEDS, NOTE_TOO_LONG, FloorItemChanged, _floor_text
from .workvalues import encode_floor, floor_api, floor_rev, new_id, read_floor_at, read_floor_strict

__all__ = ["FLOOR_ID", "FloorOp", "general_floor", "general_floor_op"]

FLOOR_ID = "floor"
SCHEMA_VERSION = 1
FloorOp = Literal["add", "edit", "collect", "uncollect", "remove"]
_OPS = ("add", "edit", "collect", "uncollect", "remove")
_RETRIES = 3


def _store(space: Space):
    return space.store("work")


def _answer(items: list[tuple[int, FloorItem]], revision: str) -> dict:
    return {"items": [floor_api(i, n) for n, i in items], "revision": revision}


def general_floor(space: Space) -> dict:
    """The ``GeneralFloor``: ``{"items": [FloorItemValue], "revision"}``; a missing file is
    ``{"items": [], "revision": ""}``. Reads only (an unreadable file reads as no items)."""
    store = _store(space)
    try:
        data, revision = store.read(FLOOR_ID)
    except DefinitionUnreadable:
        return {"items": [], "revision": json_revision(store.path(FLOOR_ID))}
    if data is None:
        return {"items": [], "revision": ""}
    items, _problems = read_floor_at(data.get("items"))
    return _answer(items, revision)


def general_floor_op(space: Space, op: FloorOp, *, item_id: str | None = None,
                     item_rev: str | None = None, place: str | None = None,
                     what: str | None = None, found: str | None = None) -> dict:
    """Add, edit, collect, un-collect or remove a general floor item; the new ``GeneralFloor``.

    `InvalidValue` for a bad request (M22's messages), `FloorItemChanged` for a stale
    ``item_rev`` or a gone item, `ReadOnly` when the file can't be read.
    """
    if op not in _OPS:
        raise InvalidValue("Unknown floor item change.")
    place_t, what_t = _floor_text(place, "the place"), _floor_text(what, "what to collect")
    if found is not None and not isinstance(found, str):
        raise InvalidValue('Expected text for "found".')
    found_t = found.strip() if isinstance(found, str) and found.strip() else None
    if found_t is not None and len(found_t) > MAX_NOTE:
        raise InvalidValue(NOTE_TOO_LONG)
    store = _store(space)
    for attempt in range(_RETRIES):
        try:
            data, revision = store.read(FLOOR_ID)
        except DefinitionUnreadable as exc:
            raise ReadOnly(exc.error) from None
        data = dict(data or {})
        items = read_floor_strict(data.get("items"))
        if op == "add":
            if place_t is None and what_t is None:
                raise InvalidValue(FLOOR_NEEDS)
            if len(items) >= MAX_FLOOR:
                raise InvalidValue(f"At most {MAX_FLOOR} floor items.")
            items.append(FloorItem(id=new_id({i.id for i in items if i.id}), place=place_t,
                                   what=what_t, found=found_t))
        else:
            i = next(
                (k for k, it in enumerate(items) if (it.id or f"@{k + 1}") == item_id), None
            )
            if i is None or floor_rev(items[i], i + 1) != item_rev:
                raise FloorItemChanged(revision)
            item = items[i]
            if op == "remove":
                del items[i]
            elif op == "edit":
                if place is not None:
                    item.place = place_t
                if what is not None:
                    item.what = what_t
                if found is not None:
                    item.found = found_t
                if item.place is None and item.what is None:
                    raise InvalidValue(FLOOR_NEEDS)
            elif op == "collect":
                item.collected = stamp_local(space.clock(), space.tz)[:10]
                if found_t is not None:
                    item.found = found_t
            else:  # uncollect
                item.collected = None
        encoded: list[dict[str, Any]] = encode_floor(items) or []
        out = {
            "schemaVersion": data.get("schemaVersion", SCHEMA_VERSION),
            "items": encoded,
            **{k: v for k, v in data.items() if k not in ("schemaVersion", "items")},
        }
        try:
            new_revision = store.write(FLOOR_ID, out, revision)
        except RevisionConflict:
            if attempt == _RETRIES - 1:
                raise FloorItemChanged(json_revision(store.path(FLOOR_ID))) from None
            continue  # another write landed between the read and the write: look again
        written, _problems = read_floor_at(encoded)
        return _answer(written, new_revision)
    raise AssertionError("unreachable")
