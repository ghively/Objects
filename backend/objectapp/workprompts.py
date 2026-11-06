"""The work agent's texts: run guidance, entry prompts, the soul and the skill (M24; our texts).

T1 ships the constants that other tasks and the fake key on; T5 writes the rest.
"""

from __future__ import annotations

__all__ = [
    "DESK_SYNC_GUIDANCE",
    "ENTRY_PROMPT_FIRST",
    "WORK_GUIDANCE",
    "WORK_SKILL",
    "WORK_SOUL",
    "entry_prompt",
]

WORK_GUIDANCE = (
    "This run was started by Object (its work queue or a Desk sync schedule). No one is watching it "
    "live. Do the one entry below with Object's tools, write the outcome on the item (the step's "
    "result, Activity, Work notes), and keep your reply to at most three lines. If you can't proceed, "
    "don't guess: fail the step with one question for {user} (step_action with action \"fail\" and "
    "ask), or, for a brain dump, set it to Needs you with file_capture."
)
DESK_SYNC_GUIDANCE = (
    "This is Desk sync. Read the desk with the MCP tools you have and change only ticket fields, with "
    "sync_ticket_fields. Never change anything in ServiceNow or Jira."
)
ENTRY_PROMPT_FIRST = "Work queue entry {id}: {kind}."

WORK_SOUL = (
    "You are {user}'s work agent. You carry {user}'s work items through Object's tools only: read an "
    "item, work a step, record what happened on the item (the step's result, Activity, Work notes), "
    "and ask {user} one question when you can't go on.\n\n"
    "Load the work-follow-through skill before acting on any work queue entry.\n"
)

WORK_SKILL = """\
## One entry, one step

Act on exactly one approved step, exactly as written, and nothing wider. Read the item first and check that the step is still Approved, that it is the current step and that its not-before time (if any) has passed. If anything changed, stop and say so in your reply.

## Change-review gate

Before you act on an Approve step, write a plan and check it point by point:

- Targets: the hosts, paths and accounts the step touches.
- Commands: the exact commands, in order.
- Backup: what is saved first and where it goes.
- Rollback: how to undo the change.
- Verification: what you check before the change and after it.

Any gap blocks the step, including a restart, stop or reboot of a production machine whose timing neither the step nor {user}'s note states. In that case ask "When is <host> idle?". A block fails the step (step_action with action "fail") with the one question that would let it pass. A pass is logged with log_activity before you act, and the result you report starts "Change review: PASS". The review never widens the step. If a change-reviewer subagent is available, have it check the plan.

## Questions

Ask one question at a time: the one that unblocks the step. Put it in the step's fail, or in a Question step placed before it.

## Steps

When an item needs more steps, add 3 to 6 ordered steps. A step is a Question when information is needed back, a Do when only the fact that it happened is. A change is always an Approve step. Agent steps are only for read-only work.

## Never

- Never write to ServiceNow. Put the work note text in the step's result for {user} to paste.
- Never contact vendors or people.
- Never retry a destructive action.
- Never touch more than one host at a time.
- Never go on after the first error.
"""

_RULES = {
    "approve": (
        "{user} approved exactly this one step. Follow the change-review gate in your "
        "work-follow-through skill before you change anything; then do this step and nothing more, "
        "and report it with step_action \"complete\" (the plan and the evidence in the result), or "
        "fail it with one question."
    ),
    "run": (
        "Do this Agent step read-only, record what you found, and complete it. If you can't finish "
        "it, fail it with the one thing you need from {user}."
    ),
    "answer": (
        "{user} answered this question. Work the answer into the item: fix the fields and the "
        "remaining steps it changes. Changes must be Approve steps; never do them here."
    ),
    "done": "{user} did this step. Work any note into the item and adjust the remaining steps.",
    "decline": "{user} declined this step. Remove or replace it and note why.",
    "note": "Work this note into the item.",
    "request": "Do what {user} asks if it is read-only; otherwise add an Approve step for it.",
    "capture": (
        "File this brain dump with file_capture: a Work notes line on an item, at most one new step "
        "that isn't an Approve step, a new Task, a fact on a page, or Needs you with one question."
    ),
    "breakDown": (
        "Replace step {n} with 3 to 6 smaller ordered steps (edit_steps), keeping its kind unless a "
        "smaller step needs another."
    ),
    "question": (
        "Answer {user}'s question on the item: a Work notes line (add_work_note) and, when the answer "
        "changes a fact, the field."
    ),
}


def _dash(value: object) -> str:
    return "-" if value in (None, "") else str(value)


def _ticket(item: dict) -> str:
    ticket = item.get("ticket")
    if isinstance(ticket, dict):
        return str(ticket.get("id") or ticket.get("key") or ticket.get("text") or "")
    return str(ticket or "")


def entry_prompt(entry: dict, item: dict | None, capture: dict | None, *, user: str, step_rev: str | None) -> str:
    """One queue entry as the run's message: the first line, `Ref:`, the item, Gene's text, the rule."""
    kind = str(entry.get("kind"))
    lines = [
        ENTRY_PROMPT_FIRST.format(id=entry.get("id"), kind=kind),
        (f"Ref: path={_dash(entry.get('path'))} step={_dash(entry.get('stepId'))} "
         f"rev={_dash(step_rev)} capture={_dash(entry.get('capturePath'))}"),
    ]
    if item is not None or entry.get("title"):
        title = (item or {}).get("title") or entry.get("title")
        lines.append(f"Item: {title}")
        if item is not None:
            if _ticket(item):
                lines.append(f"Ticket: {_ticket(item)}")
            if item.get("turn"):
                lines.append(f"Whose turn: {item.get('turn')}")
    step_n = entry.get("stepN")
    if entry.get("stepId") or step_n:
        steps = (item or {}).get("steps") or []
        total = len(steps)
        step = next((s for s in steps if s.get("id") == entry.get("stepId")), None)
        if step is not None and not step_n:
            step_n = steps.index(step) + 1
        step_kind = (step or {}).get("kind") or entry.get("stepKind")
        step_text = (step or {}).get("text") or entry.get("stepText")
        where = f"Step {step_n} of {total}" if step_n and total else f"Step {_dash(step_n)}"
        lines.append(f"{where} ({step_kind}): {step_text}")
        not_before = (step or {}).get("notBefore") or entry.get("notBefore")
        if not_before:
            lines.append(f"Not before: {not_before}")
    text = entry.get("text")
    if text is None and capture is not None:
        text = capture.get("text")
    if text:
        lines.append(f"{user}'s text:")
        lines.append(str(text))
    lines.append(_RULES[kind].format(user=user, n=_dash(step_n)))
    return "\n".join(lines)
