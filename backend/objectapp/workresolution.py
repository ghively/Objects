"""M22's resolution note: two copy-ready texts for a ticket, its work notes and its close notes
(plan ``2026-11-05-m22-work-model.md``, Contract "Resolution note").

A port of the old dashboard's deterministic note builder onto Object's work model: built only
from what the item and its page already say (the ``## Description`` section, a "Suggested …
work note" quote, the steps, Verified, Findings, Hypothesis, Cause, Confidence, Blocked on, the
Activity and Work notes lines, ``## Investigation…`` headings and the ``## Wrap-up`` fields
``Result::``, ``Prevention::`` and ``Follow-up::``). Anything missing becomes a ``[fill in: …]``
gap; nothing is invented; secrets are redacted. Never stored, never sent anywhere: the page shows
the two texts with Copy buttons. No file I/O.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from .apiquery import _headings
from .workbody import ActivityLine, WorkNoteLine
from .workmodel import Step

__all__ = ["WorkItemData", "plain", "resolution_note"]

FILL = "[fill in: {}]"
_WIKILINK = re.compile(r"\[\[([^\]\|#]+)(?:#[^\]\|]*)?(?:\|([^\]]+))?\]\]")
_SECRET = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|api[_ -]?key|token|apikey|client[_ -]?secret)\b"
    r"(\s*[:=|]\s*)(\S+)"
)
_SUGGESTED = re.compile(r"(?im)^.*\bsuggested\b[^\n]*\bwork[ -]?note\b[^\n]*$")
# an Activity or Work notes line that mentions a suggested note is not the note itself
_LOG_LINE = re.compile(r"^\s*-\s*(\[\d{4}-\d{2}-\d{2}\]|\d{4}-\d{2}-\d{2} \d{2}:\d{2})")
_MAX_LIST = 8
_MAX_LINE = 400
_CONFIDENCE = {"high": "High", "medium": "Medium", "low": "Low", "n/a": "N/A", "na": "N/A"}


@dataclass
class WorkItemData:
    """The decoded parts of a work item that ``resolution_note`` reads (``workread`` builds it)."""

    ticket_id: str | None = None
    title: str = ""
    steps: Sequence[Step] = ()
    verified: Sequence[str] = ()
    findings: str | None = None
    hypothesis: str | None = None
    cause: str | None = None
    """The Cause label's text: Likely, Confirmed, Unknown, Not found, Need to ask."""
    confidence: str | None = None
    """The Confidence label's text: High, Medium, Low, N/A."""
    blocked_on: str | None = None
    activity: Sequence[ActivityLine] = field(default_factory=list)
    work_notes: Sequence[WorkNoteLine] = field(default_factory=list)


def plain(text: str | None) -> str:
    """Markdown-ish text as plain text: ``[[a|b]]`` -> ``b``, no bold, underscores or backticks."""
    s = _WIKILINK.sub(lambda m: (m.group(2) or m.group(1)).strip(), text or "")
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"(?<!\w)_(.+?)_(?!\w)", r"\1", s)
    s = s.replace("`", "")
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def _clip(text: str | None, n: int = _MAX_LINE) -> str:
    s = plain(text)
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _sections(body: str) -> list[tuple[str, int, str]]:
    """(heading, level, text) of each heading outside fenced code; text runs to the next heading
    of the same or a higher level."""
    lines = body.splitlines(keepends=True)
    hs = _headings(lines)
    out = []
    for n, (i, lvl, text) in enumerate(hs):
        end = len(lines)
        for j, lvl2, _t in hs[n + 1 :]:
            if lvl2 <= lvl:
                end = j
                break
        out.append((text, lvl, "".join(lines[i + 1 : end]).strip("\n")))
    return out


def _description(secs: list[tuple[str, int, str]]) -> str:
    txt = next((t for h, lvl, t in secs if lvl == 2 and re.match(r"description\b", h, re.I)), "")
    paras = [
        p.strip()
        for p in re.split(r"\n\s*\n", txt)
        if p.strip() and not p.strip().startswith(("#", "|", "```"))
    ]
    return _clip(" ".join(paras[:2]), 600) if paras else ""


def _suggested_note(body: str) -> str:
    """A 'Suggested … work note' already on the page: its blockquote, else its same-line text."""
    found = [m for m in _SUGGESTED.finditer(body) if not _LOG_LINE.match(m.group(0))]
    if not found:
        return ""
    m = found[-1]  # the last one is the newest
    line = m.group(0)
    after = line.split(":", 1)[1] if ":" in line else ""
    after = re.sub(r"^[\s*_]+|[\s*_]+$", "", after)
    quoted: list[str] = []
    for ln in body[m.end() :].lstrip("\n").split("\n"):
        if ln.startswith(">"):
            quoted.append(ln.lstrip(">").strip())
        elif quoted or ln.strip():
            break
    return plain(" ".join(q for q in quoted if q) or after)


def _investigations(secs: list[tuple[str, int, str]]) -> list[str]:
    return [
        plain(h)
        for h, lvl, _t in secs
        if lvl == 2 and re.match(r"(live investigation|investigation)\b", h, re.I)
    ]


def _wrap_field(body: str, name: str) -> str:
    m = re.search(r"(?im)^\s*" + name + r"::[ \t]*(.*)$", body)
    return plain(m.group(1)) if m else ""


def _bullets(items: Sequence[str], gap: str) -> str:
    kept = [_clip(x) for x in items if str(x).strip()][:_MAX_LIST]
    return "\n".join("- " + x for x in kept) if kept else "- " + FILL.format(gap)


def _redact(text: str) -> str:
    return _SECRET.sub(lambda m: f"{m.group(1)}{m.group(2)}[redacted]", text)


def resolution_note(item: WorkItemData, body: str) -> dict:
    """``ResolutionNote``: ``{workNotes, closeNotes, gaps}`` for a ticket."""
    body = body or ""
    secs = _sections(body)
    tid = (item.ticket_id or "").strip()
    title = plain(item.title)
    steps = list(item.steps)
    done = [s for s in steps if s.state == "done"]
    current = next((s for s in steps if s.state not in ("done", "declined")), None)
    checks = [s.text for s in done if s.kind == "agent"]
    changes = [s.text for s in done if s.kind in ("approve", "do")]
    verified = [v for v in item.verified if isinstance(v, str)]
    level = _CONFIDENCE.get((item.confidence or "").strip().casefold(), "")
    hyp = plain(item.hypothesis)
    findings = plain(item.findings)
    cause_key = (item.cause or "").strip().casefold()
    activity = [_clip(a["raw"] or f"{a['at']} {a['text']}") for a in item.activity][-5:]
    notes = [
        _clip(" ".join(n["raw"].split("\n")))
        for n in item.work_notes
        if not re.search(r"(?i)imported from (servicenow|jira)", n["raw"])
    ]
    sugg = _suggested_note(body)
    inv = _investigations(secs)
    desc = _description(secs)

    w = [f"Work notes: {tid} {title}".rstrip()]
    w.append("Reported: " + (desc or FILL.format("what was reported")))
    if sugg:
        w += ["", "Summary: " + sugg]
    w += ["", "Checked:", _bullets(checks + verified, "what was checked (host, log, command, date)")]
    if inv:
        w.append("Investigations recorded: " + "; ".join(inv))
    w += ["", "Findings: " + (_clip(findings) or FILL.format("findings"))]
    if hyp:
        w.append("Working cause: " + hyp + (f" (confidence: {level})" if level else ""))
    if item.blocked_on and plain(item.blocked_on):
        w.append("Waiting on: " + plain(item.blocked_on))
    if current is not None:
        w.append("Next step: " + _clip(current.text))
    if activity:
        w += ["", "Activity:", "\n".join("- " + a for a in activity)]
    if notes:
        w += ["", "Earlier notes:", "\n".join("- " + x for x in notes[-4:])]

    if hyp and cause_key == "confirmed":
        cause = hyp
    elif hyp and cause_key == "likely":
        cause = hyp + " " + FILL.format("confirm this cause before closing")
    else:
        cause = FILL.format("root cause" + (f"; working idea on the page: {hyp}" if hyp else ""))
    result = _wrap_field(body, "Result")
    follow = _wrap_field(body, "Prevention") or _wrap_field(body, "Follow-up")
    c = [
        f"Close notes: {tid} {title}".rstrip(),
        "Cause: " + cause,
        "Fix:",
        _bullets(changes, "what was changed to fix it (host, change, date)"),
        "Verification: " + (result or FILL.format("how the fix was confirmed, by whom and when")),
        "Prevention: " + (follow or FILL.format("what stops it happening again, or 'none needed'")),
    ]
    work = _redact("\n".join(w).strip())
    close = _redact("\n".join(c).strip())
    return {"workNotes": work, "closeNotes": close, "gaps": (work + close).count("[fill in:")}
