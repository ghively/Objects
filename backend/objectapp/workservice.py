"""M22: the work service, the one write API for work items (plan
``2026-11-05-m22-work-model.md``, Contract "The service").

The app routes (``api_work``), the agent routes (``api_v1_work``) and the ``objectapp-mcp``
tools all call this service. Every write is **one** `Space.write_work` call: the changed
property lines plus the ``## Activity`` (and ``## Work notes``) lines, in one atomic, stamped
write. Step and floor actions check their own item's id and revision under the space lock
(a stale one raises `StepChanged` / `FloorItemChanged`, HTTP 409); field writes and Close
check the object's version (`Conflict`). The rules are `workrules`; the codec `workvalues`;
the line texts `workbody`. Reads (`items`, `item`) write nothing.

Listeners added with `add_work_listener` hear a `WorkNotice` after each write, outside the
lock, in order; a raising listener is logged and never fails the call.
"""

from __future__ import annotations

import copy
import logging
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from .propvalues import InvalidValue, decode_value, label_lookup
from .space import Conflict, Space
from .typemodel import RevisionConflict, _option_id
from .workbody import (
    ACTIVITY,
    WORK_NOTES,
    WorkEvent,
    activity_text,
    activity_texts,
    append_line,
    floor_label,
    one_line,
    stamp_local,
    withdraw_text,
    work_note_text,
)
from .workfields import FIELD_KEYS, is_work_type
from .workmodel import (
    FLOOR_CHANGED,
    MAX_FLOOR,
    MAX_LIST_TEXT,
    MAX_NOTE,
    STEP_CHANGED,
    FloorItem,
    Step,
    StepAction,
    StepKind,
    StepState,
    WorkRole,
)
from .workread import NotWorkItem, full, item_data, iter_work_paths, summary, work_steps
from .workrules import (
    IllegalMove,
    apply_action,
    apply_op,
    done_option,
    is_done,
    normalize_desk_priority,
    stage_of,
    step_ref,
)
from .workvalues import (
    encode_floor,
    encode_steps,
    floor_rev,
    new_id,
    read_floor_strict,
    read_steps_strict,
    step_rev,
)

__all__ = [
    "Actor",
    "FloorItemChanged",
    "NotWorkItem",
    "StepChanged",
    "WorkNotice",
    "WorkService",
    "add_work_listener",
    "in_work_write",
]

log = logging.getLogger(__name__)

_writing = threading.local()


def in_work_write() -> bool:
    """True while this thread is inside a `WorkService` write (a `Space.add_listener` listener
    can tell the service's writes, which a `WorkNotice` follows, from any other write)."""
    return bool(getattr(_writing, "depth", 0))

NOTE_NEEDS_TEXT = "A note needs text."
ALREADY_DONE = "This item is already done."
NO_DONE_STATUS = "This type has no done status."
NOT_A_FIELD = 'The field "{key}" isn'"'"'t a work field.'
NOTE_TOO_LONG = f"Keep it to {MAX_NOTE} characters."
FLOOR_NEEDS = "A floor item needs a place or what to collect."  # as `workvalues.floor_from_api`
_FIELD_WRITE_KEYS = FIELD_KEYS - {"steps", "floorItems"}
_RETRIES = 3
"""How often a write without a base version is tried again after a concurrent write."""


@dataclass(frozen=True)
class Actor:
    """Who writes: ``Actor("user", <activityName>)``, ``Actor("agent", <token name>)`` or
    ``Actor("app", "Object")``. ``name`` is the ``<who>`` of the Activity line."""

    role: WorkRole
    name: str


class StepChanged(Exception):
    """The step changed since it was read (HTTP 409 ``This step changed. Look again.``).

    ``step`` is the step as it is now (a ``WorkStep``; None when it is gone)."""

    def __init__(self, step: dict | None = None, current_version: str = "") -> None:
        super().__init__(STEP_CHANGED)
        self.step = step
        self.current_version = current_version


class FloorItemChanged(Exception):
    """The floor item changed since it was read (HTTP 409)."""

    def __init__(self, current_version: str = "") -> None:
        super().__init__(FLOOR_CHANGED)
        self.current_version = current_version


@dataclass(frozen=True)
class WorkNotice:
    """What a listener hears after one work write.

    ``event``: a step action, ``add``/``edit``/``move``/``remove`` (one notice per step op),
    ``note``, ``request``, ``log``, ``fields``, ``close`` or ``floor``. The step fields are
    None for events that aren't about a step."""

    path: str
    object_id: str | None
    event: str
    step_id: str | None
    n: int | None
    kind: StepKind | None
    step_text: str | None
    before: StepState | None
    after: StepState | None
    by: Actor
    text: str | None
    not_before: str | None
    at: datetime
    version: str


_listeners: list[Callable[[Space, WorkNotice], None]] = []
_listeners_lock = threading.Lock()


def add_work_listener(fn: Callable[[Space, WorkNotice], None]) -> Callable[[], None]:
    """Hear every work write; returns the function that unsubscribes ``fn``."""
    with _listeners_lock:
        _listeners.append(fn)

    def unsubscribe() -> None:
        with _listeners_lock:
            if fn in _listeners:
                _listeners.remove(fn)

    return unsubscribe


def _notify(space: Space, notices: Iterable[WorkNotice]) -> None:
    with _listeners_lock:
        listeners = list(_listeners)
    for notice in notices:
        for fn in listeners:
            try:
                fn(space, notice)
            except Exception:
                log.exception("A work listener failed on %s %s", notice.event, notice.path)


class _Stale(Exception):
    """Raised inside a write callback: the step (or floor item) at ``ref`` changed."""

    def __init__(self, ref: str | None) -> None:
        super().__init__(ref)
        self.ref = ref


@dataclass
class _Lines:
    """The Activity and Work notes texts one write appends (filled by its callbacks)."""

    activity: str | None = None
    note: str | None = None


def _instant(text: str | None) -> datetime | None:
    if not isinstance(text, str) or not text.strip():
        return None
    try:
        return datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def _find(steps: list[Step], ref: str) -> int | None:
    for i, s in enumerate(steps):
        if step_ref(s, i + 1) == ref:
            return i
    return None


def _note_text(text: Any) -> str:
    if not isinstance(text, str) or not text.strip():
        raise InvalidValue(NOTE_NEEDS_TEXT)
    text = text.strip()
    if len(text) > MAX_NOTE:
        raise InvalidValue(NOTE_TOO_LONG)
    return text


def _floor_text(value: Any, what: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise InvalidValue(f"Expected text for {what}.")
    text = value.strip()
    if "\n" in text or "\r" in text:
        raise InvalidValue(f"Keep {what} to one line.")
    if len(text) > MAX_LIST_TEXT:
        raise InvalidValue(f"Keep {what} to at most {MAX_LIST_TEXT} characters.")
    return text or None


class WorkService:
    """Reads and every write of work items over one space."""

    def __init__(
        self, space: Space, *, jira_site: Callable[[], str | None], user_name: Callable[[], str]
    ) -> None:
        self.space = space
        self.jira_site = jira_site
        self.user_name = user_name

    # -- reads --------------------------------------------------------------------------------

    def _data(self, path: str):
        return item_data(self.space, path, now=self.space.clock(), jira_site=self.jira_site())

    def items(self, scope: Literal["active", "all"] = "active") -> list[dict]:
        """Every work item's ``WorkItemSummary`` (``active``: not done, or done within the last
        14 days), by rank (none last), then title."""
        now = self.space.clock()
        site = self.jira_site()
        out: list[dict] = []
        for rel in iter_work_paths(self.space):
            try:
                data = item_data(self.space, rel, now=now, jira_site=site)
            except (KeyError, NotWorkItem, ValueError):
                continue  # gone or changed type since the listing
            if scope == "active" and data.done and not data.recently_done:
                continue
            out.append(summary(data))
        out.sort(key=lambda i: (i["rank"] is None, i["rank"] or 0, i["title"].casefold(),
                                i["path"]))
        return out

    def item(self, path: str) -> dict:
        """The ``WorkItem`` at ``path`` (`KeyError`, `NotWorkItem`)."""
        data = self._data(path)
        return full(data, data.body)

    # -- the write ----------------------------------------------------------------------------

    def _write(
        self,
        rel: str,
        base_version: str | None,
        lines: _Lines,
        *,
        updates: dict[str, Any] | None = None,
        remove: Iterable[str] = (),
        raw: Callable[[dict], dict[str, Any]] | None = None,
        body: Callable[[str, dict], str | None] | None = None,
    ):
        """One `Space.write_work`; ``body`` returns the event lines' body (None: no lines).

        A write without a base version is tried again when another write landed between its
        read and its replace (the callbacks then see the new file)."""

        def body_fn(text: str, fm_after: dict) -> str:
            lines.activity = lines.note = None
            out = body(text, fm_after) if body is not None else None
            return text if out is None else out

        attempts = _RETRIES if base_version is None else 1
        _writing.depth = getattr(_writing, "depth", 0) + 1
        try:
            for attempt in range(attempts):
                try:
                    return self.space.write_work(
                        rel, base_version, updates=updates, remove=remove, raw=raw, body=body_fn
                    )
                except Conflict:
                    if attempt + 1 >= attempts:
                        raise
        finally:
            _writing.depth -= 1
        raise AssertionError("unreachable")

    def _append(self, text: str, lines: _Lines, event: WorkEvent, now: datetime,
                activity: str | None = None) -> str:
        """``text`` with the event's Activity line (and Work notes line, if any) appended."""
        lines.activity = f"{stamp_local(now, self.space.tz)} {activity or activity_text(event)}"
        text = append_line(text, ACTIVITY, lines.activity)
        lines.note = work_note_text(event)
        if lines.note is not None:
            text = append_line(text, WORK_NOTES, lines.note)
        return text

    def _result(self, rel: str, outcome, lines: _Lines) -> dict:
        data = self._data(rel)
        return {
            "version": outcome.version,
            "frontmatter": outcome.frontmatter,
            "body": outcome.body,
            "item": full(data, outcome.body),
            "synced": list(outcome.synced),
            "activity": lines.activity,
            "workNote": lines.note,
        }

    def _check(self, path: str) -> str:
        rel = self.space._rel(path)
        t = self.space.type_by_id(self.space.get(rel).type)
        if not is_work_type(t):
            raise NotWorkItem()
        return rel

    def _notice(self, rel: str, event: str, actor: Actor, now: datetime, version: str,
                **kw: Any) -> WorkNotice:
        values: dict[str, Any] = {
            "step_id": None, "n": None, "kind": None, "step_text": None, "before": None,
            "after": None, "text": None, "not_before": None,
        }
        values.update(kw)
        try:
            object_id = self.space.get(rel).id
        except KeyError:
            object_id = None
        return WorkNotice(path=rel, object_id=object_id, event=event, by=actor, at=now,
                          version=version, **values)

    def _day(self, now: datetime) -> str:
        return stamp_local(now, self.space.tz)[:10]

    def _current_version(self, rel: str) -> str:
        try:
            return self.space.read(rel)[2]
        except KeyError:
            return ""

    # -- step actions -------------------------------------------------------------------------

    def step(self, path: str, step_id: str, step_rev: str, action: StepAction, actor: Actor, *,
             text: str | None = None, not_before: str | None = None,
             ask: str | None = None) -> dict:
        """Take ``action`` on the step ``step_id`` at revision ``step_rev``: a ``WorkWriteResult``.

        Raises `StepChanged` (stale or gone), `IllegalMove` (the rules), `UnreadableList`,
        `KeyError`, `NotWorkItem`, `ReadOnly`."""
        rel = self._check(path)
        now = self.space.clock()
        lines = _Lines()
        seen: dict[str, Any] = {}

        def raw(fm: dict) -> dict[str, Any]:
            steps = read_steps_strict(fm.get("steps"))
            i = _find(steps, step_id)
            if i is None or step_rev_of(steps, i) != step_rev:
                seen["stale"] = steps
                raise _Stale(step_id)
            new = apply_action(steps, i, action, actor.role, now=now, text=text,
                               not_before=not_before, ask=ask, new_id=new_id)
            encoded = encode_steps(new) or []
            j = i + 1 if len(new) > len(steps) else i  # `fail` with `ask` inserts before it
            old = steps[i]
            after = new[j]
            seen.update(
                n=i + 1, before=old.state, after=after.state, kind=old.kind, step_text=old.text,
                id=encoded[j]["id"] if j < len(encoded) else old.id,
                not_before=after.notBefore if action == "approve" else None,
            )
            return {"steps": encoded}

        def body(text_: str, _fm: dict) -> str:
            nb = _instant(seen.get("not_before"))
            event = WorkEvent(
                kind=action, who=actor.name, n=seen["n"], step_text=seen["step_text"],
                step_kind=seen["kind"], text=text,
                not_before_local=stamp_local(nb, self.space.tz) if nb is not None else None,
                date=self._day(now),
            )
            # Fix pass H: reopening an approved step is the Withdraw button: log it as such.
            withdrew = action == "reopen" and seen.get("before") == "approved"
            return self._append(text_, lines, event, now, activity=withdraw_text(event) if withdrew else None)

        try:
            outcome = self._write(rel, None, lines, raw=raw, body=body)
        except _Stale:
            steps = seen.get("stale") or []
            i = _find(steps, step_id)
            step = work_steps(steps)[i] if i is not None else None
            raise StepChanged(step, self._current_version(rel)) from None
        result = self._result(rel, outcome, lines)
        _notify(self.space, [self._notice(
            rel, action, actor, now, outcome.version, step_id=seen["id"], n=seen["n"],
            kind=seen["kind"], step_text=seen["step_text"], before=seen["before"],
            after=seen["after"], text=text, not_before=seen["not_before"],
        )])
        return result

    def withdraw_approval(self, path: str, step_id: str, result: str, why: str | None = None) -> dict | None:
        """Object's own move of an approved step back to Open once the run it started ended failed
        (M24; Gene, 2026-11-08): the approval is spent, so the user approves again before a retry.
        ``result`` is shown on the step (its ``result``); ``why`` (the run's failure reason) goes
        into the Activity line. Answers a ``WorkWriteResult``, or None when the step isn't approved
        any more (nothing is written). Raises `KeyError`, `NotWorkItem`, `ReadOnly`."""
        rel = self._check(path)
        now = self.space.clock()
        actor = Actor("app", "Object")
        lines = _Lines()
        seen: dict[str, Any] = {}

        def raw(fm: dict) -> dict[str, Any]:
            steps = read_steps_strict(fm.get("steps"))
            i = _find(steps, step_id)
            if i is None or steps[i].state != "approved":
                raise _Stale(step_id)
            new = [copy.copy(s) for s in steps]
            step = new[i]
            step.state = "open"
            step.approvedAt = step.notBefore = None
            step.result = one_line(result, MAX_NOTE) or None
            seen.update(n=i + 1, kind=step.kind, step_text=step.text, id=step.id)
            return {"steps": encode_steps(new) or []}

        def body(text_: str, _fm: dict) -> str:
            event = WorkEvent(kind="reopen", who=actor.name, n=seen["n"], step_text=seen["step_text"],
                              step_kind=seen["kind"], text=None, not_before_local=None, date=self._day(now))
            detail = one_line(why or "", 300).rstrip(".")
            detail = f" ({detail})" if detail else ""
            return self._append(text_, lines, event, now, activity=activity_text(event) + detail)

        try:
            outcome = self._write(rel, None, lines, raw=raw, body=body)
        except _Stale:
            return None
        out = self._result(rel, outcome, lines)
        _notify(self.space, [self._notice(
            rel, "reopen", actor, now, outcome.version, step_id=seen["id"], n=seen["n"], kind=seen["kind"],
            step_text=seen["step_text"], before="approved", after="open",
        )])
        return out

    def edit_steps(self, path: str, ops: list[dict], actor: Actor) -> dict:
        """Apply step ops (``add``, ``edit``, ``move``, ``remove``) in order, in one write."""
        rel = self._check(path)
        if not isinstance(ops, list) or not ops or not all(isinstance(o, dict) for o in ops):
            raise IllegalMove("Unknown step change.")
        now = self.space.clock()
        lines = _Lines()
        events: list[WorkEvent] = []
        notices: list[dict[str, Any]] = []

        def raw(fm: dict) -> dict[str, Any]:
            events.clear()
            notices.clear()
            steps = read_steps_strict(fm.get("steps"))
            # Every named step must be at its revision in the list as read.
            for op in ops:
                ref = op.get("stepId")
                if op.get("op") == "add":
                    continue
                i = _find(steps, ref) if isinstance(ref, str) else None
                if i is None or step_rev_of(steps, i) != op.get("stepRev"):
                    raise _Stale(ref if isinstance(ref, str) else None)
            # Id-less steps get their ids now, so `@n` refs keep meaning the step they named.
            refs: dict[str, str] = {}
            taken = {s.id for s in steps if s.id}
            for i, s in enumerate(steps):
                if not s.id:
                    s.id = new_id(taken)
                    taken.add(s.id)
                    refs[f"@{i + 1}"] = s.id
            for op in ops:
                op = dict(op)
                for key in ("stepId", "before"):
                    if isinstance(op.get(key), str) and op[key] in refs:
                        op[key] = refs[op[key]]
                name = op.get("op")
                before_ids = {s.id for s in steps}
                target = next((s for s in steps if s.id == op.get("stepId")), None)
                pos = steps.index(target) + 1 if target is not None else None
                try:
                    new = apply_op(steps, op, actor.role, now=now, new_id=new_id)
                except KeyError:
                    raise _Stale(op.get("stepId")) from None
                if name == "add":
                    added = next(s for s in new if s.id not in before_ids)
                    n = new.index(added) + 1
                    events.append(WorkEvent(kind="add", who=actor.name, n=n,
                                            step_text=added.text, step_kind=added.kind))
                    notices.append(dict(step_id=added.id, n=n, kind=added.kind,
                                        step_text=added.text, after="open"))
                else:
                    assert target is not None and pos is not None
                    moved = next((s for s in new if s.id == target.id), None)
                    n = new.index(moved) + 1 if moved is not None else pos
                    shown = moved if moved is not None else target
                    events.append(WorkEvent(kind=name, who=actor.name, n=n,
                                            step_text=shown.text, step_kind=shown.kind))
                    notices.append(dict(step_id=target.id, n=n, kind=shown.kind,
                                        step_text=shown.text, before=target.state,
                                        after=moved.state if moved is not None else None))
                steps = new
            return {"steps": encode_steps(steps)}

        def body(text_: str, _fm: dict) -> str:
            return self._append(text_, lines, events[0], now, activity=activity_texts(events))

        try:
            outcome = self._write(rel, None, lines, raw=raw, body=body)
        except _Stale as exc:
            steps_now = []
            try:
                steps_now = read_steps_strict(self.space.read(rel)[1].get("steps"))
            except Exception:
                steps_now = []
            i = _find(steps_now, exc.ref) if exc.ref else None
            step = work_steps(steps_now)[i] if i is not None else None
            raise StepChanged(step, self._current_version(rel)) from None
        result = self._result(rel, outcome, lines)
        _notify(self.space, [
            self._notice(rel, ev.kind, actor, now, outcome.version, **kw)
            for ev, kw in zip(events, notices, strict=True)
        ])
        return result

    # -- fields, close, notes -----------------------------------------------------------------

    def _add_area_option(self, type_id: str, text: str) -> None:
        """Add ``text`` to the type's Area options (a type save, one retry on a conflict)."""
        for attempt in range(2):
            t, rev = self.space.refresh_type(type_id)
            if t is None:
                raise KeyError(type_id)
            p = t.prop("area")
            if p is None or p.type != "label" or label_lookup(p, text) is not None:
                return
            new = copy.deepcopy(t)
            area = new.prop("area")
            assert area is not None
            options = [o for o in area.options.get("set") or [] if isinstance(o, dict)]
            taken = {str(o.get("id")) for o in options}
            options.append({"id": _option_id(text, taken), "text": text, "color": "gray",
                            "icon": None})
            area.options["set"] = options
            try:
                self.space.save_type(new, rev)
                return
            except RevisionConflict:
                if attempt:
                    raise

    def fields(self, path: str, base_version: str, set_: dict[str, Any], remove: list[str],
               actor: Actor, *, own: Iterable[str] = ()) -> dict:
        """Set and remove ticket and work fields (not ``steps``, ``floorItems`` or ``status``).

        ``own`` (M31, G3): the type's own properties this call may also set, beside the fields
        (Desk sync's ``resolved`` on an Incident, `desksync.apply_ticket_fields`).

        Raises `InvalidValue` (422), `Conflict` (a stale ``base_version``), `KeyError`,
        `NotWorkItem`, `ReadOnly`."""
        rel = self._check(path)
        set_ = dict(set_ or {})
        remove = list(remove or [])
        t = self.space.type_by_id(self.space.get(rel).type)
        assert t is not None
        allowed = _FIELD_WRITE_KEYS | set(own)
        for key in (*set_, *remove):
            p = t.prop(key)
            if key not in allowed or p is None:
                raise InvalidValue(NOT_A_FIELD.format(key=key))
        if "deskPriority" in set_:
            v = set_["deskPriority"]
            set_["deskPriority"] = (
                [normalize_desk_priority(x) if isinstance(x, str) else x for x in v]
                if isinstance(v, list) else normalize_desk_priority(v)
            )
        area = set_.get("area")
        area_text = area[0] if isinstance(area, list) and area else area
        if isinstance(area_text, str) and area_text.strip():
            current = self.space.read(rel)[2]
            if current != base_version:
                raise Conflict(current)
            self._add_area_option(t.id, area_text.strip())
            t = self.space.type_by_id(t.id) or t
        now = self.space.clock()
        lines = _Lines()
        before: dict[str, Any] = {}
        changed: list[tuple[str, str | None]] = []

        def raw(fm: dict) -> dict[str, Any]:
            before.clear()
            before.update(fm)
            return {}

        def body(text_: str, fm_after: dict) -> str | None:
            changed.clear()
            for key in (*set_, *remove):
                if key in [k for k, _v in changed]:
                    continue
                p = t.prop(key)
                assert p is not None
                old = decode_value(p, before.get(key), before)
                new = decode_value(p, fm_after.get(key), fm_after)
                if old == new:
                    continue
                changed.append((p.name, self._render(p, new, rel)))
            if not changed:
                return None
            event = WorkEvent(kind="fields", who=actor.name, fields=list(changed),
                              date=self._day(now))
            return self._append(text_, lines, event, now)

        outcome = self._write(rel, base_version, lines, updates=set_, remove=remove, raw=raw,
                              body=body)
        result = self._result(rel, outcome, lines)
        if lines.activity is not None:
            _notify(self.space, [self._notice(rel, "fields", actor, now, outcome.version)])
        return result

    def _render(self, p, value: Any, rel: str) -> str | None:
        """A field's value for its Activity line; None when it is empty (cleared)."""
        if value is None or value == [] or value == "":
            return None
        kind = p.type
        if kind == "textList":
            return f"{len(value)} items"
        if kind == "label":
            return ", ".join(str(v) for v in value)
        if kind == "number":
            return str(value)
        if kind in ("datetime", "datetimeSimple"):
            start = value.get("start") if isinstance(value, dict) else None
            return start[:10] if isinstance(start, str) else None
        if kind == "entity":
            titles = []
            for ref in value:
                target = self.space.resolve(ref.get("target"), rel)
                try:
                    titles.append(self.space.get(target).title if target else ref.get("target"))
                except KeyError:
                    titles.append(ref.get("target"))
            return ", ".join(str(x) for x in titles if x) or None
        return one_line(str(value), 60)

    def close(self, path: str, base_version: str, actor: Actor) -> dict:
        """Set the status to its done option (``Done``, ``Completed``)."""
        rel = self._check(path)
        t = self.space.type_by_id(self.space.get(rel).type)
        assert t is not None
        sdef = t.prop("status")
        if sdef is not None and sdef.type != "label":
            sdef = None
        option = done_option(sdef)
        if sdef is None or option is None:
            raise InvalidValue(NO_DONE_STATUS)
        _of, fm, current = self.space.read(rel)
        if current != base_version:
            raise Conflict(current)
        status = decode_value(sdef, fm.get(sdef.key), fm)
        if is_done(stage_of(status[0] if status else None, sdef)):
            raise InvalidValue(ALREADY_DONE)
        now = self.space.clock()
        lines = _Lines()

        def body(text_: str, _fm: dict) -> str:
            return self._append(text_, lines, WorkEvent(kind="close", who=actor.name,
                                                       date=self._day(now)), now)

        outcome = self._write(rel, base_version, lines, updates={sdef.key: [option]}, body=body)
        result = self._result(rel, outcome, lines)
        _notify(self.space, [self._notice(rel, "close", actor, now, outcome.version)])
        return result

    def note(self, path: str, kind: Literal["note", "request"], text: str, actor: Actor) -> dict:
        """A note (or a request to the agent): an Activity and a Work notes line. No version."""
        rel = self._check(path)
        if kind not in ("note", "request"):
            raise InvalidValue("A note is a note or a request.")
        text = _note_text(text)
        return self._lines_only(rel, kind, text, actor)

    def log(self, path: str, text: str, actor: Actor) -> dict:
        """An agent's own Activity line (``<who> <text>``). No version."""
        rel = self._check(path)
        return self._lines_only(rel, "log", _note_text(text), actor)

    def _lines_only(self, rel: str, kind: str, text: str, actor: Actor) -> dict:
        now = self.space.clock()
        lines = _Lines()

        def body(text_: str, _fm: dict) -> str:
            event = WorkEvent(kind=kind, who=actor.name, text=text, date=self._day(now))
            return self._append(text_, lines, event, now)

        outcome = self._write(rel, None, lines, body=body)
        result = self._result(rel, outcome, lines)
        _notify(self.space, [self._notice(rel, kind, actor, now, outcome.version, text=text)])
        return result

    # -- floor items --------------------------------------------------------------------------

    def floor(self, path: str, op: Literal["add", "edit", "collect", "uncollect", "remove"],
              actor: Actor, *, item_id: str | None = None, item_rev: str | None = None,
              place: str | None = None, what: str | None = None,
              found: str | None = None) -> dict:
        """Add, edit, collect (tick, with what was found), un-tick or remove a floor item."""
        rel = self._check(path)
        t = self.space.type_by_id(self.space.get(rel).type)
        p = t.prop("floorItems") if t is not None else None
        if p is None or p.type != "floorItems":
            raise InvalidValue(NOT_A_FIELD.format(key="floorItems"))
        if op not in ("add", "edit", "collect", "uncollect", "remove"):
            raise InvalidValue("Unknown floor item change.")
        place_t, what_t = _floor_text(place, "the place"), _floor_text(what, "what to collect")
        if found is not None and not isinstance(found, str):
            raise InvalidValue('Expected text for "found".')
        found_t = found.strip() if isinstance(found, str) and found.strip() else None
        if found_t is not None and len(found_t) > MAX_NOTE:
            raise InvalidValue(NOTE_TOO_LONG)
        now = self.space.clock()
        day = self._day(now)
        lines = _Lines()
        seen: dict[str, Any] = {}

        def raw(fm: dict) -> dict[str, Any]:
            items = read_floor_strict(fm.get("floorItems"))
            if op == "add":
                if place_t is None and what_t is None:
                    raise InvalidValue(FLOOR_NEEDS)
                if len(items) >= MAX_FLOOR:
                    raise InvalidValue(f"At most {MAX_FLOOR} floor items.")
                item = FloorItem(id=new_id({i.id for i in items if i.id}), place=place_t,
                                 what=what_t, found=found_t)
                items.append(item)
                seen["label"] = floor_label(item.place, item.what)
                return {"floorItems": encode_floor(items)}
            i = next(
                (k for k, it in enumerate(items) if (it.id or f"@{k + 1}") == item_id), None
            )
            if i is None or floor_rev(items[i], i + 1) != item_rev:
                raise _Stale(item_id)
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
                item.collected = day
                if found_t is not None:
                    item.found = found_t
            else:  # uncollect
                item.collected = None
            seen["label"] = floor_label(item.place, item.what)
            seen["found"] = item.found if op == "collect" else None
            return {"floorItems": encode_floor(items)}

        def body(text_: str, _fm: dict) -> str:
            event = WorkEvent(kind="floor", who=actor.name, date=day,
                              floor=(op, seen["label"], seen.get("found")))
            return self._append(text_, lines, event, now)

        try:
            outcome = self._write(rel, None, lines, raw=raw, body=body)
        except _Stale:
            raise FloorItemChanged(self._current_version(rel)) from None
        result = self._result(rel, outcome, lines)
        _notify(self.space, [self._notice(rel, "floor", actor, now, outcome.version,
                                          text=found_t)])
        return result


def step_rev_of(steps: list[Step], i: int) -> str:
    """The revision of ``steps[i]`` (its 1-based position for an id-less step)."""
    return step_rev(steps[i], i + 1)
