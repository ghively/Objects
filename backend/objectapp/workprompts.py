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

WORK_SOUL = ""   # T5
WORK_SKILL = ""  # T5


def entry_prompt(entry: dict, item: dict | None, capture: dict | None, *, user: str, step_rev: str | None) -> str:
    raise NotImplementedError("M24 T5")
