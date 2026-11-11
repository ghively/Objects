"""M22: the work hooks inside ``Space`` writes (``update_properties`` and ``write_work``).

Plan ``2026-11-05-m22-work-model.md``, Contract "Hooks inside Space". ``on_work_write`` runs
after the Task status hook and edits what is about to be written (``sets``/``removals``, the
encoded values ``set_keys`` writes), for a **work type** only:

1. When the write sets ``ticketId`` to a non-empty text, ``system`` is empty in the file and
   the caller didn't set or remove it, ``system`` is set from the id's shape
   (`workrules.infer_system`: ``ABC-123`` is Jira, anything else ServiceNow).
2. For a work type that isn't the basic Task (whose ``completed`` the Task hook keeps), a
   ``status`` crossing into the Done stage sets ``completed`` to the write's instant, and
   crossing out of it removes ``completed`` (unless the caller set or removed it).

Never reads or writes a file.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .propvalues import InvalidValue, decode_value, encode_value
from .taskhook import stamp
from .typemodel import PropertyDefinition, TypeDefinition, is_task_type
from .workfields import is_work_type
from .workrules import infer_system, is_done, stage_of

__all__ = ["STEPS_GATED", "on_work_write"]

STEPS_GATED = "Steps change with the step actions."
"""Why a generic property write can't change ``steps`` (``propvalues.GATED_KINDS``)."""

_COMPLETED_KINDS = frozenset({"datetimeSimple", "datetime"})


def _first_text(raw: Any) -> str | None:
    if isinstance(raw, (list, tuple)):
        raw = raw[0] if raw else None
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def _empty(raw: Any) -> bool:
    return _first_text(raw) is None


def _infer_system(t: TypeDefinition, fm: dict, sets: dict[str, Any], explicit: set[str]) -> None:
    if "ticketId" not in sets or "system" in explicit or "system" in sets:
        return
    if not _empty(fm.get("system")):
        return
    system = infer_system(_first_text(sets["ticketId"]))
    if system is None:
        return
    pdef = t.prop("system")
    if pdef is None:
        sets["system"] = system
        return
    if pdef.type != "label":
        return  # a System of another kind is the user's own field: left alone
    try:
        sets["system"] = encode_value(pdef, [system], fm.get("system"))
    except InvalidValue:
        return  # the type's System has no such option


def _status_def(t: TypeDefinition) -> PropertyDefinition | None:
    p = t.prop("status")
    return p if p is not None and p.type == "label" else None


def _stamp_completed(
    t: TypeDefinition, fm: dict, sets: dict[str, Any], removals: list[str], now: datetime,
    explicit: set[str],
) -> None:
    if is_task_type(t):
        return  # the Task hook (`taskhook.on_status_change`) keeps Task's `completed`
    sdef = _status_def(t)
    if sdef is None or (sdef.key not in sets and sdef.key not in removals):
        return
    completed = t.prop("completed")
    if completed is not None and completed.type not in _COMPLETED_KINDS:
        return
    before = decode_value(sdef, fm.get(sdef.key), fm)
    was_done = is_done(stage_of(before[0] if before else None, sdef))
    after = _first_text(sets[sdef.key]) if sdef.key in sets else None
    now_done = is_done(stage_of(after, sdef))
    if was_done == now_done or "completed" in explicit:
        return
    if now_done:
        sets["completed"] = stamp(now)
    elif "completed" in fm:
        removals.append("completed")


def on_work_write(
    t: TypeDefinition | None,
    fm: dict,
    sets: dict,
    removals: list[str],
    now: datetime,
    explicit: set[str],
    *,
    system: bool = True,
    work_type: bool | None = None,
) -> None:
    """Infer System and stamp ``completed`` for a work type; edit ``sets``/``removals`` in place.

    ``fm`` is the front matter before the write, ``sets`` the encoded values about to be
    written, ``removals`` the keys about to be removed and ``explicit`` the keys the caller
    itself sets or removes (those keep the caller's value).

    M32: a plain property write made while Work is off for the space passes ``system`` False
    (no System is inferred) and says itself whether ``t`` is a work type (``work_type``: with
    Work off its Steps may be in its file without being listed); ``completed`` is stamped and
    cleared whatever the switch says.
    """
    if t is None or not (is_work_type(t) if work_type is None else work_type):
        return
    if system:
        _infer_system(t, fm, sets, explicit)
    _stamp_completed(t, fm, sets, removals, now, explicit)
