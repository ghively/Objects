"""M22's pure work rules: the current step, whose turn, the stage, every allowed step move,
the step-list ops, and the ticket helpers (System from the id, Desk priority, the ticket link).

Plan ``2026-11-05-m22-work-model.md``, Contract "Pure rules". Ported 1:1 to
``frontend/src/work/stepRules.ts``; ``frontend/src/work/__fixtures__/step-cases.json`` holds the
parity rows both sides check.

No I/O: the clock (``now``) and the id source (``new_id``) are passed in. Revisions are not
checked here (the work service checks a step's id and revision before calling these); a step
that isn't in the list raises ``KeyError``.
"""

from __future__ import annotations

import copy
import re
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from .propvalues import label_lookup
from .typemodel import PropertyDefinition, status_category
from .workmodel import (
    KIND_LABELS,
    MAX_NOTE,
    MAX_STEP_TEXT,
    MAX_STEPS,
    STATE_LABELS,
    STEP_KINDS,
    Stage,
    Step,
    StepAction,
    StepKind,
    Turn,
    WorkRole,
)

__all__ = [
    "ACTIONS",
    "DONE_VISIBLE_DAYS",
    "IllegalMove",
    "allowed_actions",
    "apply_action",
    "apply_op",
    "current_index",
    "desk_says",
    "done_option",
    "infer_system",
    "is_done",
    "iso_instant",
    "normalize_desk_priority",
    "recently_done",
    "stage_of",
    "step_ref",
    "ticket_url",
    "whose_turn",
]

DONE_VISIBLE_DAYS = 14
"""Done items stay visible this many days from the status change."""

ACTIONS: tuple[StepAction, ...] = (
    "answer", "done", "approve", "decline", "run", "reopen", "complete", "fail",
)
"""Every step action, in the order ``allowed_actions`` lists them."""


class IllegalMove(ValueError):
    """A step action or op the rules refuse (HTTP 422); ``str(exc)`` is the message."""


# -- messages (our strings) -------------------------------------------------------------------

NOT_CURRENT = "Finish the steps before this one first."
WRONG_KIND = "This doesn't apply to a {Kind} step."
WRONG_STATE = "This step is already {state}."
DONE_APPROVE_NEVER_REOPENS = "A done Approve step never reopens."
ONLY_YOU = "Only you can do this to a step."
ONLY_AGENT_RESULT = "Only the agent reports a step's result."
ONLY_AGENT_APPROVE_DONE = "Only the agent marks an Approve step done."
ANSWER_NEEDS_TEXT = "An answer needs text."
SAY_WHAT_HAPPENED = "Say what happened."
NOT_BEFORE_APPROVE_ONLY = "Only an Approve step takes a Not before time."
NOT_BEFORE_BAD = "Not before is a date and time."
TEXT_TOO_LONG = f"Keep it to {MAX_NOTE} characters."
WITHDRAW_FIRST = "Withdraw the approval before changing this step."
DONE_APPROVE_FIXED = "A done Approve step can't be changed."
OPEN_ONLY_KIND = "Only an open step changes kind."
AGENTS_CANT_CHANGE = "Agents can't change an approved or done Approve step."
AGENTS_CANT_RESHAPE_APPROVE = (
    "Agents can't move or remove an Approve step, or change a step to or from Approve."
)
AGENTS_CANT_PASS_APPROVE = "Agents can't put an Agent step ahead of an Approve step."
STEP_ONE_LINE = "A step is one line."
STEP_NEEDS_TEXT = "A step needs text."
STEP_TOO_LONG = f"A step is at most {MAX_STEP_TEXT} characters."
TOO_MANY_STEPS = f"A work item holds at most {MAX_STEPS} steps."
UNKNOWN_KIND = "A step is a Question, Do, Approve or Agent step."
UNKNOWN_OP = "Unknown step change."

# (action, kind) -> (the states it starts from, the roles that may take it). ``reopen`` applies
# to every kind (a done Approve step is refused separately).
_RULES: dict[tuple[str, str], tuple[frozenset[str], frozenset[str]]] = {
    ("answer", "question"): (frozenset({"open"}), frozenset({"user"})),
    ("done", "do"): (frozenset({"open"}), frozenset({"user"})),
    ("done", "agent"): (frozenset({"open", "approved"}), frozenset({"user", "agent"})),
    ("approve", "approve"): (frozenset({"open"}), frozenset({"user"})),
    ("decline", "approve"): (frozenset({"open", "approved"}), frozenset({"user"})),
    ("run", "agent"): (frozenset({"open"}), frozenset({"user", "app"})),
    ("complete", "approve"): (frozenset({"approved"}), frozenset({"agent"})),
    ("complete", "agent"): (frozenset({"open", "approved"}), frozenset({"agent"})),
    ("fail", "approve"): (frozenset({"approved"}), frozenset({"agent"})),
    ("fail", "agent"): (frozenset({"approved"}), frozenset({"agent"})),
}
for _kind in STEP_KINDS:
    _RULES[("reopen", _kind)] = (frozenset({"approved", "declined", "done"}), frozenset({"user"}))

_ROLES_FOR_ACTION: dict[str, frozenset[str]] = {}
for (_action, _kind), (_states, _roles) in _RULES.items():
    _ROLES_FOR_ACTION[_action] = _ROLES_FOR_ACTION.get(_action, frozenset()) | _roles

_FINISHED = frozenset({"done", "declined"})


# -- small helpers ----------------------------------------------------------------------------


def iso_instant(moment: datetime) -> str:
    """``YYYY-MM-DDTHH:MM:SS.sssZ`` (UTC) for an instant; a naive one is taken as UTC."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    moment = moment.astimezone(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _parse_instant(text: str) -> datetime | None:
    try:
        moment = datetime.fromisoformat(text.strip().replace("Z", "+00:00").replace("z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def _role_message(role: WorkRole) -> str:
    return ONLY_AGENT_RESULT if role == "user" else ONLY_YOU


def _label(kind: str) -> str:
    return KIND_LABELS.get(kind, kind)  # type: ignore[call-overload]


def step_ref(step: Step, n: int) -> str:
    """How a step is addressed: its id, or ``@n`` (1-based position) when the file gives none."""
    return step.id if step.id else f"@{n}"


def _find(steps: Sequence[Step], step_id: Any) -> int:
    for i, s in enumerate(steps):
        if step_ref(s, i + 1) == step_id:
            return i
    raise KeyError(step_id)


def _copy(steps: Sequence[Step]) -> list[Step]:
    return [copy.deepcopy(s) for s in steps]


def _taken(steps: Sequence[Step]) -> set[str]:
    return {s.id for s in steps if s.id}


def _step_text(value: Any) -> str:
    """A step's text: one line, 1-500 characters (trimmed)."""
    if not isinstance(value, str):
        raise IllegalMove(STEP_NEEDS_TEXT)
    text = value.strip()
    if "\n" in text or "\r" in text:
        raise IllegalMove(STEP_ONE_LINE)
    if not text:
        raise IllegalMove(STEP_NEEDS_TEXT)
    if len(text) > MAX_STEP_TEXT:
        raise IllegalMove(STEP_TOO_LONG)
    return text


def _kind(value: Any) -> StepKind:
    kind = value.strip().lower() if isinstance(value, str) else None
    if kind not in STEP_KINDS:
        raise IllegalMove(UNKNOWN_KIND)
    return kind  # type: ignore[return-value]


# -- current step, stage, turn ----------------------------------------------------------------


def current_index(steps: Sequence[Step]) -> int | None:
    """The index of the first step that is neither Done nor Declined, or None."""
    for i, s in enumerate(steps):
        if s.state not in _FINISHED:
            return i
    return None


_STAGE_BY_TEXT: dict[str, Stage] = {
    "not started": "notStarted",
    "planned": "notStarted",
    "next up": "ready",
    "in progress": "doing",
    "on hold": "parked",
    "done": "done",
    "completed": "done",
}
_STAGE_BY_CATEGORY: dict[str, Stage] = {
    "not-started": "notStarted",
    "in-progress": "doing",
    "blocked": "parked",
    "done": "done",
}


def _fold(text: str) -> str:
    return " ".join(text.casefold().split())


def stage_of(status: str | None, status_def: PropertyDefinition | None) -> Stage:
    """The stage of a work item from Object's own status (its option text or id).

    The option's text decides (``Not Started``/``Planned``, ``Next Up``, ``In Progress``,
    ``On Hold``, ``Done``/``Completed``); any other text goes by its status category; no status
    is Not started. The Desk status never takes part.
    """
    if not isinstance(status, str) or not status.strip():
        return "notStarted"
    text, category = status, None
    if status_def is not None:
        opt = label_lookup(status_def, status)
        if opt is not None:
            text, category = opt.text, opt.statusCategory
    folded = _fold(text)
    if folded in _STAGE_BY_TEXT:
        return _STAGE_BY_TEXT[folded]
    if not isinstance(category, str) or category not in _STAGE_BY_CATEGORY:
        category = status_category(text)
    return _STAGE_BY_CATEGORY.get(category, "notStarted")


def is_done(stage: Stage) -> bool:
    """True for the Done stage."""
    return stage == "done"


def done_option(status_def: PropertyDefinition | None) -> str | None:
    """The status option text that means done: ``Done`` (Task), ``Completed`` (Project), else the
    first option whose category is done; None when the type has none."""
    if status_def is None:
        return None
    options = [o for o in status_def.options.get("set") or [] if isinstance(o, dict)]
    for opt in options:
        if _fold(str(opt.get("text", ""))) in ("done", "completed"):
            return str(opt.get("text")).strip()
    for opt in options:
        if opt.get("statusCategory") == "done" and str(opt.get("text", "")).strip():
            return str(opt.get("text")).strip()
    return None


def _desk_resolution(desk_status: str | None) -> Literal["Resolved", "Closed"] | None:
    if not isinstance(desk_status, str):
        return None
    folded = _fold(desk_status)
    if folded == "resolved":
        return "Resolved"
    if folded == "closed":
        return "Closed"
    return None


def whose_turn(stage: Stage, steps: Sequence[Step], desk_status: str | None) -> Turn:
    """Whose move it is, in this order: done stage → none; the desk says Resolved/Closed → close;
    parked → parked; no steps → none; every step finished → close; the current step decides
    (Question/Do → you, open Approve → approve, approved Approve or Agent → agent)."""
    if stage == "done":
        return "none"
    if _desk_resolution(desk_status) is not None:
        return "close"
    if stage == "parked":
        return "parked"
    if not steps:
        return "none"
    i = current_index(steps)
    if i is None:
        return "close"
    step = steps[i]
    if step.kind in ("question", "do"):
        return "you"
    if step.kind == "approve":
        return "approve" if step.state == "open" else "agent"
    return "agent"


def desk_says(stage: Stage, desk_status: str | None) -> Literal["Resolved", "Closed"] | None:
    """``Resolved``/``Closed`` when the desk resolved an item that isn't done; else None."""
    if stage == "done":
        return None
    return _desk_resolution(desk_status)


def recently_done(done_at: datetime | None, last_updated: datetime | None, now: datetime) -> bool:
    """Done within ``DONE_VISIBLE_DAYS`` (``completed``, else ``lastUpdated``); both missing → False."""
    ref = done_at or last_updated
    if ref is None:
        return False
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    return now - ref < timedelta(days=DONE_VISIBLE_DAYS)


# -- ticket helpers ---------------------------------------------------------------------------

_JIRA_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_]*-\d+$")
_PRIORITIES = {"critical": "Critical", "high": "High", "medium": "Medium", "low": "Low",
               "moderate": "Medium"}


def infer_system(ticket_id: str | None) -> Literal["Jira", "ServiceNow"] | None:
    """``ABC-123`` → Jira; any other non-empty id → ServiceNow; empty → None."""
    if not isinstance(ticket_id, str) or not ticket_id.strip():
        return None
    return "Jira" if _JIRA_ID.match(ticket_id.strip()) else "ServiceNow"


def normalize_desk_priority(text: str | None) -> str | None:
    """Desk priority as one of the four options (``Moderate`` reads as Medium); other text unchanged."""
    if not isinstance(text, str):
        return text
    return _PRIORITIES.get(_fold(text), text)


def ticket_url(system: str | None, ticket_id: str | None, link: str | None,
               jira_site: str | None) -> str | None:
    """The ticket's link: the Ticket link when set, else ``{jira site}/browse/{id}`` for Jira."""
    if isinstance(link, str) and link.strip():
        return link.strip()
    if (isinstance(system, str) and _fold(system) == "jira" and isinstance(ticket_id, str)
            and ticket_id.strip() and isinstance(jira_site, str) and jira_site.strip()):
        return f"{jira_site.strip().rstrip('/')}/browse/{ticket_id.strip()}"
    return None


# -- step actions -----------------------------------------------------------------------------


def _refusal(steps: Sequence[Step], index: int, action: str, role: str) -> str | None:
    """Why ``role`` may not take ``action`` on step ``index`` now (text aside), or None."""
    if role not in _ROLES_FOR_ACTION.get(action, frozenset()):
        return _role_message(role)  # type: ignore[arg-type]
    step = steps[index]
    cur = current_index(steps)
    if cur is not None and index > cur:
        return NOT_CURRENT
    rule = _RULES.get((action, step.kind))
    if rule is None:
        if action == "done" and step.kind == "approve" and role == "user":
            return ONLY_AGENT_APPROVE_DONE
        return WRONG_KIND.format(Kind=_label(step.kind))
    states, roles = rule
    if role not in roles:
        return _role_message(role)  # type: ignore[arg-type]
    if action == "reopen" and step.kind == "approve" and step.state == "done":
        return DONE_APPROVE_NEVER_REOPENS
    if step.state not in states:
        return WRONG_STATE.format(state=STATE_LABELS.get(step.state, step.state).lower())  # type: ignore[call-overload]
    return None


def allowed_actions(steps: Sequence[Step], index: int, role: WorkRole) -> list[StepAction]:
    """What ``role`` may do on step ``index`` now, in ``ACTIONS`` order."""
    if not 0 <= index < len(steps):
        return []
    return [a for a in ACTIONS if _refusal(steps, index, a, role) is None]


def _clean_text(text: str | None) -> str | None:
    if not isinstance(text, str):
        return None
    text = text.strip()
    if len(text) > MAX_NOTE:
        raise IllegalMove(TEXT_TOO_LONG)
    return text or None


def apply_action(steps: Sequence[Step], index: int, action: StepAction, role: WorkRole, *,
                 now: datetime, text: str | None = None, not_before: str | None = None,
                 ask: str | None = None, new_id: Callable[[set[str]], str]) -> list[Step]:
    """The step list after ``role`` takes ``action`` on step ``index`` (a new list; the input is
    untouched). Raises ``IllegalMove`` with the one message the Contract orders."""
    if not 0 <= index < len(steps):
        raise IndexError(index)
    refusal = _refusal(steps, index, action, role)
    if refusal is not None:
        raise IllegalMove(refusal)
    step_kind = steps[index].kind
    if action == "answer" and not (isinstance(text, str) and text.strip()):
        raise IllegalMove(ANSWER_NEEDS_TEXT)
    if action in ("complete", "fail") and not (isinstance(text, str) and text.strip()):
        raise IllegalMove(SAY_WHAT_HAPPENED)
    has_not_before = isinstance(not_before, str) and bool(not_before.strip())
    if has_not_before and step_kind != "approve":
        raise IllegalMove(NOT_BEFORE_APPROVE_ONLY)
    body = _clean_text(text)
    stamp = iso_instant(now)

    out = _copy(steps)
    step = out[index]
    if action == "answer":
        step.state, step.answer, step.doneAt = "done", body, stamp
    elif action == "done":
        step.state, step.doneAt = "done", stamp
        if step.kind == "agent" and body is not None:
            step.result = body
    elif action == "approve":
        step.state, step.approvedAt = "approved", stamp
        if has_not_before:
            moment = _parse_instant(not_before)  # type: ignore[arg-type]
            if moment is None:
                raise IllegalMove(NOT_BEFORE_BAD)
            step.notBefore = iso_instant(moment)
    elif action == "decline":
        step.state, step.declinedAt = "declined", stamp
    elif action == "run":
        step.state, step.approvedAt = "approved", stamp
    elif action == "reopen":
        step.state = "open"
        step.approvedAt = step.doneAt = step.declinedAt = step.notBefore = None
    elif action == "complete":
        step.state, step.result, step.doneAt = "done", body, stamp
    elif action == "fail":
        step.state, step.result = "open", body
        step.approvedAt = step.notBefore = None
        if isinstance(ask, str) and ask.strip():
            if len(out) >= MAX_STEPS:
                raise IllegalMove(TOO_MANY_STEPS)
            question = Step(id=new_id(_taken(out)), kind="question", state="open",
                            text=_step_text(ask), addedAt=stamp)
            out.insert(index, question)
    return out


# -- step-list ops ----------------------------------------------------------------------------


def _locked_for_agent(step: Step) -> bool:
    return step.kind == "approve" and step.state in ("approved", "done")


def _gate_in(steps: Sequence[Step]) -> bool:
    """True when an Approve step among ``steps`` still waits (open, or approved and not done):
    an Agent step the agent puts in front of it would run before the approval."""
    return any(s.kind == "approve" and s.state in ("open", "approved") for s in steps)


def apply_op(steps: Sequence[Step], op: Mapping[str, Any], role: WorkRole, *, now: datetime,
             new_id: Callable[[set[str]], str]) -> list[Step]:
    """The step list after one op (``add``, ``edit``, ``move``, ``remove``; a new list).

    Steps are found by id (or ``@n``); the work service has checked their revisions. ``before``
    names the step to go in front of (None/absent: at the end). Raises ``IllegalMove``, or
    ``KeyError`` for a step that isn't in the list.
    """
    if role not in ("user", "agent"):
        raise IllegalMove(ONLY_YOU)
    name = op.get("op") if isinstance(op, Mapping) else None
    out = _copy(steps)
    if name == "add":
        if len(out) >= MAX_STEPS:
            raise IllegalMove(TOO_MANY_STEPS)
        kind = _kind(op.get("kind"))
        text = _step_text(op.get("text"))
        before = op.get("before")
        at = len(out) if before is None else _find(out, before)
        if role == "agent" and kind == "agent" and _gate_in(out[at:]):
            raise IllegalMove(AGENTS_CANT_PASS_APPROVE)
        out.insert(at, Step(id=new_id(_taken(out)), kind=kind, state="open", text=text,
                            addedAt=iso_instant(now)))
        return out
    if name not in ("edit", "move", "remove"):
        raise IllegalMove(UNKNOWN_OP)
    i = _find(out, op.get("stepId"))
    step = out[i]
    if role == "agent" and _locked_for_agent(step):
        raise IllegalMove(AGENTS_CANT_CHANGE)
    # The approval gate: an agent can't take an open Approve step out of the way either (remove
    # it, move it, or turn it into another kind), nor turn a step into an Approve step.
    if role == "agent":
        if name in ("remove", "move") and step.kind == "approve":
            raise IllegalMove(AGENTS_CANT_RESHAPE_APPROVE)
        if name == "edit" and op.get("kind") is not None:
            if (step.kind == "approve") != (_kind(op.get("kind")) == "approve"):
                raise IllegalMove(AGENTS_CANT_RESHAPE_APPROVE)
    if name == "remove":
        del out[i]
        return out
    if name == "move":
        before = op.get("before")
        # ``before`` is found before the move, so ``@n`` keeps its meaning.
        target = None if before is None else out[_find(out, before)]
        if target is step:
            return out
        to = len(out) if target is None else next(j for j, s in enumerate(out) if s is target)
        if role == "agent" and step.kind == "agent" and to < i and _gate_in(out[to:i]):
            raise IllegalMove(AGENTS_CANT_PASS_APPROVE)
        out.pop(i)
        if target is None:
            out.append(step)
        else:
            out.insert(next(j for j, s in enumerate(out) if s is target), step)
        return out
    # edit
    new_kind = op.get("kind")
    new_text = op.get("text")
    if new_kind is not None:
        kind = _kind(new_kind)
        if kind != step.kind:
            if step.state != "open":
                raise IllegalMove(OPEN_ONLY_KIND)
            step.kind = kind
    if new_text is not None:
        text = _step_text(new_text)
        if text != step.text:
            if step.kind == "approve" and step.state == "done":
                raise IllegalMove(DONE_APPROVE_FIXED)
            if step.state == "approved":
                raise IllegalMove(WITHDRAW_FIRST)
            step.text = text
    return out
