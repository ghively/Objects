"""M22's body sections: the ``## Activity`` and ``## Work notes`` lines every work write appends
(plan ``2026-11-05-m22-work-model.md``, Contract "Body sections").

An Activity line is ``- YYYY-MM-DD HH:MM <who> <what>`` (space time zone), a Work notes line is
``- [YYYY-MM-DD] <who>: <verb> step n "<step>": <text>``. Both are append-only on disk. The wording
is ported from the old dashboard, with the agent's own name in place of the old agent's.

Pure text functions over an LF body (``Space._write`` restores CRLF and the BOM). No file I/O.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, tzinfo
from typing import TypedDict

from .apiquery import _FENCE, _find
from .workmodel import KIND_LABELS, StepKind

__all__ = [
    "ACTIVITY",
    "WORK_NOTES",
    "WRAP_UP",
    "ActivityLine",
    "WorkEvent",
    "WorkNoteLine",
    "activity_lines",
    "activity_text",
    "activity_texts",
    "append_line",
    "floor_label",
    "one_line",
    "stamp_local",
    "work_note_lines",
    "work_note_text",
]

ACTIVITY = "Activity"
WORK_NOTES = "Work notes"
WRAP_UP = "Wrap-up"


class ActivityLine(TypedDict):
    at: str
    """``YYYY-MM-DD HH:MM``, space time."""
    text: str
    """``<who> <what>``."""
    raw: str
    """The line as on disk, without its ``- ``."""


class WorkNoteLine(TypedDict):
    date: str
    """``YYYY-MM-DD``, or ``""`` for a hand-written note without the ``[date]`` form."""
    who: str
    text: str
    raw: str
    """The note as on disk, without its ``- `` (later lines joined with ``\\n``, unindented)."""


@dataclass(frozen=True)
class WorkEvent:
    """What one work write did, for its Activity and Work notes lines.

    ``kind``: a step action (``answer`` … ``fail``), a step op (``add``, ``edit``, ``move``,
    ``remove``), ``fields``, ``note``, ``request``, ``log``, ``close`` or ``floor``.
    ``fields``: ``(name, rendered value)`` pairs, the value None when the field was cleared.
    ``floor``: ``(op, label, found)``, op one of ``add|edit|collect|uncollect|remove`` and label
    ``floor_label(place, what)``. ``date``: the space-time day for the Work notes line.
    """

    kind: str
    who: str
    n: int | None = None
    step_text: str | None = None
    step_kind: StepKind | None = None
    text: str | None = None
    not_before_local: str | None = None
    fields: Sequence[tuple[str, str | None]] = ()
    floor: tuple[str, str, str | None] | None = None
    date: str = ""


# -- small helpers --------------------------------------------------------------------------------


def one_line(text: str | None, limit: int = 200) -> str:
    """``text`` with its whitespace collapsed, cut to ``limit - 1`` characters plus ``...``."""
    t = re.sub(r"\s+", " ", text or "").strip()
    return t if len(t) <= limit else t[: limit - 1] + "..."


def stamp_local(now: datetime, tz: tzinfo) -> str:
    """``YYYY-MM-DD HH:MM`` of ``now`` in the space's time zone."""
    return now.astimezone(tz).strftime("%Y-%m-%d %H:%M")


def floor_label(place: str | None, what: str | None) -> str:
    """``place | what`` for a floor item's Activity line (a missing side is left out)."""
    parts = [p.strip() for p in (place, what) if p and p.strip()]
    return one_line(" | ".join(parts))


def _step(ev: WorkEvent) -> str:
    return f'step {ev.n} "{one_line(ev.step_text, 70)}"'


def _detail(ev: WorkEvent) -> str:
    return f": {one_line(ev.text)}" if ev.text and ev.text.strip() else ""


# -- texts ----------------------------------------------------------------------------------------

_STEP_VERBS = {
    "answer": "answered",
    "done": "marked done",
    "approve": "APPROVED",
    "decline": "declined",
}
_NOTE_VERBS = {
    "answer": "answered",
    "done": "marked done",
    "approve": "approved",
    "decline": "declined",
}
_FLOOR_VERBS = {
    "add": "added a floor item:",
    "edit": "edited a floor item:",
    "collect": "collected",
    "uncollect": "un-ticked",
    "remove": "removed a floor item:",
}


def activity_text(event: WorkEvent) -> str:
    """The ``<who> <what>`` part of the event's Activity line (Contract's Activity table)."""
    ev, who = event, event.who
    k = ev.kind
    if k in ("answer", "done", "decline"):
        return f"{who} {_STEP_VERBS[k]} {_step(ev)}{_detail(ev)}"
    if k == "approve":
        nb = f" (not before {ev.not_before_local})" if ev.not_before_local else ""
        return f"{who} APPROVED {_step(ev)}{nb}{_detail(ev)}"
    if k == "run":
        return f"{who} asked the agent to run {_step(ev)}"
    if k == "reopen":
        return f"{who} reopened {_step(ev)}"
    if k == "complete":
        return f"{who} completed step {ev.n}: {one_line(ev.text)}"
    if k == "fail":
        return f"{who} could not do step {ev.n}: {one_line(ev.text)}"
    if k == "add":
        label = KIND_LABELS.get(ev.step_kind, ev.step_kind or "") if ev.step_kind else ""
        return f'{who} added step {ev.n} [{label}] "{one_line(ev.step_text, 70)}"'
    if k == "edit":
        return f'{who} edited step {ev.n}: "{one_line(ev.step_text, 70)}"'
    if k == "move":
        return f'{who} moved step "{one_line(ev.step_text, 70)}" to {ev.n}'
    if k == "remove":
        return f'{who} removed step {ev.n} "{one_line(ev.step_text, 70)}"'
    if k == "fields":
        parts = [
            f"set {name} to {one_line(value)}" if value is not None else f"cleared {name}"
            for name, value in ev.fields
        ]
        return f"{who} " + "; ".join(parts)
    if k == "note":
        return f"{who} added a note: {one_line(ev.text)}"
    if k == "request":
        return f"{who} asked the agent to act: {one_line(ev.text)}"
    if k == "log":
        return f"{who} {one_line(ev.text)}"
    if k == "close":
        return f"{who} closed the item"
    if k == "floor" and ev.floor is not None:
        op, label, found = ev.floor
        tail = f": {one_line(found)}" if op == "collect" and found and found.strip() else ""
        return f"{who} {_FLOOR_VERBS[op]} {label}{tail}"
    raise ValueError(f"Unknown work event {k!r}")


def activity_texts(events: Sequence[WorkEvent]) -> str:
    """Several events of one write (step ops) as one line, joined with ``; ``, ``<who>`` only on
    the first."""
    out: list[str] = []
    for i, ev in enumerate(events):
        text = activity_text(ev)
        if i and text.startswith(ev.who + " "):
            text = text[len(ev.who) + 1 :]
        out.append(text)
    return "; ".join(out)


def work_note_text(event: WorkEvent) -> str | None:
    """The ``[date] who: …`` part of the event's Work notes line, or None when it has none: an
    answer, done, approve or decline with text, every approve and decline, and every note and
    request. A multi-line text keeps its lines (``append_line`` indents the later ones)."""
    ev = event
    text = "\n".join(ln.rstrip() for ln in (ev.text or "").replace("\r\n", "\n").split("\n")).strip()
    head = f"[{ev.date}] {ev.who}: "
    if ev.kind in ("note", "request"):
        return head + f"{ev.kind}: {text}"
    if ev.kind not in _NOTE_VERBS:
        return None
    if not text and ev.kind not in ("approve", "decline"):
        return None
    line = head + f"{_NOTE_VERBS[ev.kind]} {_step(ev)}"
    return line + (f": {text}" if text else "")


# -- appending ------------------------------------------------------------------------------------


# A later line of an entry that would open a block of its own (a code fence or a heading: the two
# spaces of indent are within CommonMark's three) gets a backslash, so it stays text in the list
# item and an unbalanced fence can't swallow the sections after it.
_OPENS_BLOCK = re.compile(r"^(\s*)(`{3,}|~{3,}|#{1,6}(?:\s|$))")
_ESCAPED_BLOCK = re.compile(r"^\\(`{3,}|~{3,}|#{1,6}(?:\s|$))")


def _continuation(part: str) -> str:
    return "  " + _OPENS_BLOCK.sub(lambda m: m.group(1) + "\\" + m.group(2), part, count=1)


def _entry(line: str) -> list[str]:
    parts = line.replace("\r\n", "\n").split("\n")
    return ["- " + parts[0] + "\n"] + [_continuation(p) + "\n" for p in parts[1:]]


_FENCE_RUN = re.compile(r"^ {0,3}(`{3,}|~{3,})")


def _open_fence(lines: list[str]) -> str | None:
    """The fence (its full run of backticks or tildes) that is still open at the end of
    ``lines``, read the way ``_find`` reads fences; None when every fence is closed."""
    fence: str | None = None
    run = ""
    for line in lines:
        bare = line.rstrip("\r\n")
        m = _FENCE.match(bare)
        if not m:
            continue
        if fence is None:
            fence = m.group(1)
            run = _FENCE_RUN.match(bare).group(1)  # type: ignore[union-attr]
        elif m.group(1) == fence:
            fence = None
    return run if fence is not None else None


def append_line(body: str, heading: str, line: str) -> str:
    """``body`` with ``- <line>`` after the last non-blank line of the ``heading`` section (any
    level, case-insensitive, outside fenced code), with no blank line between list lines.

    A missing section is created as ``## <heading>``, a blank line and the line: before the
    ``Wrap-up`` heading when there is one (one blank line after it), else at the end of the body
    after one blank line. Later lines of a multi-line ``line`` are indented two spaces (one that
    would open a code fence or a heading gets a backslash in front). A body that ends inside a code
    fence (a pasted log never closed) gets the closing fence first, so the new section is a section
    (the fence ran to the end anyway, so the text in it reads the same).
    """
    lines = body.splitlines(keepends=True)
    entry = _entry(line)
    span = _find(lines, heading)
    if span is not None:
        start, end = span
        insert = end
        while insert > start + 1 and lines[insert - 1].strip() == "":
            insert -= 1
        before = lines[:insert]
        if not before[-1].endswith("\n"):
            before[-1] += "\n"
        gap = ["\n"] if insert == start + 1 else []
        rest = lines[insert:]
        after = ["\n"] if rest and rest[0].strip() != "" else []
        return "".join(before + gap + entry + after + rest)

    block = [f"## {heading}\n", "\n", *entry]
    wrap = _find(lines, WRAP_UP)
    if wrap is not None:
        at = wrap[0]
        before = lines[:at]
        if before and not before[-1].endswith("\n"):
            before[-1] += "\n"
        lead = ["\n"] if before and before[-1].strip() != "" else []
        return "".join(before + lead + block + ["\n"] + lines[at:])
    if not body:
        return "".join(block)
    if not body.endswith("\n"):
        body += "\n"
    fence = _open_fence(lines)
    if fence is not None:
        body += fence + "\n"
    if not body.endswith("\n\n"):
        body += "\n"
    return body + "".join(block)


# -- reading --------------------------------------------------------------------------------------

_ACTIVITY_LINE = re.compile(r"^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) (.*\S)\s*$")
_NOTE_LINE = re.compile(r"^- (.*)$")
_NOTE_DATED = re.compile(r"^\[(\d{4}-\d{2}-\d{2})\] (.*)$", re.S)


def _section_lines(body: str, heading: str) -> list[str]:
    lines = body.splitlines(keepends=True)
    span = _find(lines, heading)
    if span is None:
        return []
    start, end = span
    # Lines under a sub-heading are read too: ``append_line`` appends at the end of the whole
    # section, so they can be the newest lines. The sub-heading lines themselves match no line form.
    return [ln.rstrip("\r\n") for ln in lines[start + 1 : end]]


def activity_lines(body: str) -> list[ActivityLine]:
    """The ``## Activity`` lines, oldest first (as on disk). A line that doesn't start with a
    ``YYYY-MM-DD HH:MM`` stamp is skipped."""
    out: list[ActivityLine] = []
    for ln in _section_lines(body, ACTIVITY):
        m = _ACTIVITY_LINE.match(ln)
        if m:
            out.append({"at": m.group(1), "text": m.group(2), "raw": ln[2:].rstrip()})
    return out


def work_note_lines(body: str) -> list[WorkNoteLine]:
    """The ``## Work notes`` entries, oldest first. ``[date] who: text`` is split at the first
    ``: ``; any other top-level ``- `` line is kept with an empty date and who; lines indented
    under an entry continue it."""
    out: list[WorkNoteLine] = []
    current: list[str] | None = None
    entries: list[list[str]] = []
    for ln in _section_lines(body, WORK_NOTES):
        m = _NOTE_LINE.match(ln)
        if m:
            current = [m.group(1).rstrip()]
            entries.append(current)
        elif current is not None and ln.startswith("  ") and ln.strip():
            current.append(_ESCAPED_BLOCK.sub(r"\1", ln.strip(), count=1))
        else:
            current = None
    for parts in entries:
        raw = "\n".join(parts)
        d = _NOTE_DATED.match(raw)
        if d and ": " in d.group(2):
            who, text = d.group(2).split(": ", 1)
            out.append({"date": d.group(1), "who": who.strip(), "text": text, "raw": raw})
        else:
            out.append({"date": "", "who": "", "text": raw, "raw": raw})
    return out
