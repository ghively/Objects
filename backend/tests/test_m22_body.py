"""M22 Task 5: the Activity and Work notes lines, and the resolution note.

Plan ``2026-11-05-m22-work-model.md``, Contract "Body sections" and "Resolution note". Pure
functions: nothing here touches a file except reading the synthetic fixture."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

from objectapp.frontmatter import parse_fm
from objectapp.workbody import (
    ACTIVITY,
    WORK_NOTES,
    WRAP_UP,
    WorkEvent,
    activity_lines,
    activity_text,
    append_line,
    one_line,
    stamp_local,
    work_note_lines,
    work_note_text,
)
from objectapp.workmodel import STEP_KEYS, Step
from objectapp.workresolution import WorkItemData, resolution_note

HERE = Path(__file__).resolve().parent
PRINTER = HERE / "fixtures" / "space-work" / "Tasks" / "Printer jams on line 3.md"
SPOOLER = "Restart the print spooler on PRN-TEST-01"


def _split(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    _, fm, body = text.split("---\n", 2)
    return parse_fm(fm), body


def _steps(raw: list[dict]) -> list[Step]:
    out = []
    for entry in raw:
        known = {k: (str(entry[k]) if entry.get(k) is not None else None) for k in STEP_KEYS if k in entry}
        out.append(Step(**known))
    return out


def _printer(**over) -> tuple[WorkItemData, str]:
    fm, body = _split(PRINTER)
    data = dict(
        ticket_id=fm["ticketId"],
        title=fm["title"],
        steps=_steps(fm["steps"]),
        verified=list(fm["verified"]),
        findings=fm.get("findings"),
        hypothesis=fm.get("hypothesis"),
        cause=fm.get("cause"),
        confidence=fm.get("confidence"),
        blocked_on=fm.get("blockedOn"),
        activity=activity_lines(body),
        work_notes=work_note_lines(body),
    )
    data.update(over)
    return WorkItemData(**data), body


# -- append_line ----------------------------------------------------------------------------------


def test_append_to_existing_activity_no_blank_line():
    _fm, body = _split(PRINTER)
    line = "2026-11-05 10:00 Gene marked done step 2"
    out = append_line(body, ACTIVITY, line)
    last = '- 2026-11-04 15:10 Gene answered step 1 "Which tray jams most often?": Tray 2, mostly in the morning\n'
    assert last + "- " + line + "\n\n## Work notes" in out
    wrap = body[body.index("## Wrap-up") :]
    assert out.endswith(wrap)
    assert out.replace("- " + line + "\n", "", 1) == body

    out2 = append_line(body, WORK_NOTES, "[2026-11-05] Gene: note: hi")
    assert "Tray 2, mostly in the morning\n- [2026-11-05] Gene: note: hi\n\n## Wrap-up" in out2


def test_new_sections_go_before_wrap_up():
    body = "Intro.\n\n## Wrap-up\n\nResult:: ok\n"
    out = append_line(body, ACTIVITY, "x")
    assert out == "Intro.\n\n## Activity\n\n- x\n\n## Wrap-up\n\nResult:: ok\n"

    only = "## Wrap-up\n\nResult:: ok\n"
    assert append_line(only, ACTIVITY, "x") == "## Activity\n\n- x\n\n" + only

    assert append_line("Some text.\n", ACTIVITY, "x") == "Some text.\n\n## Activity\n\n- x\n"
    assert append_line("Some text.", ACTIVITY, "x") == "Some text.\n\n## Activity\n\n- x\n"
    assert append_line("", ACTIVITY, "x") == "## Activity\n\n- x\n"

    # an existing but empty section gets a blank line after its heading
    assert append_line("## Activity\n", ACTIVITY, "x") == "## Activity\n\n- x\n"
    assert (
        append_line("## Activity\n\n## Wrap-up\n", ACTIVITY, "x")
        == "## Activity\n\n- x\n\n## Wrap-up\n"
    )


def test_heading_match():
    body = "### activity\n\n- 2026-11-01 09:00 Gene a\n"
    assert append_line(body, ACTIVITY, "b") == body + "- b\n"

    fenced = "```\n## Activity\n- not a line\n```\n"
    out = append_line(fenced, ACTIVITY, "b")
    assert out == fenced + "\n## Activity\n\n- b\n"
    assert activity_lines(fenced) == []


def test_multiline_entry_indents_later_lines():
    out = append_line("", WORK_NOTES, "[2026-11-05] Gene: note: first\nsecond")
    assert out == "## Work notes\n\n- [2026-11-05] Gene: note: first\n  second\n"
    assert WRAP_UP == "Wrap-up"


# -- texts ----------------------------------------------------------------------------------------


def _ev(kind, **kw):
    return WorkEvent(kind, "Gene", **kw)


def test_activity_texts():
    s1 = dict(n=1, step_text="Which tray jams most often?", step_kind="question")
    s2 = dict(n=2, step_text=SPOOLER, step_kind="approve")
    q = '"Which tray jams most often?"'
    sp = f'"{SPOOLER}"'
    assert activity_text(_ev("answer", **s1, text="Tray 2")) == f"Gene answered step 1 {q}: Tray 2"
    assert activity_text(_ev("done", **s1)) == f"Gene marked done step 1 {q}"
    assert activity_text(_ev("done", **s1, text="ok")) == f"Gene marked done step 1 {q}: ok"
    assert (
        activity_text(_ev("approve", **s2, not_before_local="2026-11-06 07:00"))
        == f"Gene APPROVED step 2 {sp} (not before 2026-11-06 07:00)"
    )
    assert (
        activity_text(_ev("approve", **s2, not_before_local="2026-11-06 07:00", text="go"))
        == f"Gene APPROVED step 2 {sp} (not before 2026-11-06 07:00): go"
    )
    assert activity_text(_ev("approve", **s2)) == f"Gene APPROVED step 2 {sp}"
    assert activity_text(_ev("decline", **s2)) == f"Gene declined step 2 {sp}"
    assert activity_text(_ev("decline", **s2, text="no")) == f"Gene declined step 2 {sp}: no"
    assert activity_text(_ev("run", **s2)) == f"Gene asked the agent to run step 2 {sp}"
    assert activity_text(_ev("reopen", **s2)) == f"Gene reopened step 2 {sp}"
    work = WorkEvent("complete", "Work", n=2, step_text=SPOOLER, text="Restarted\n  fine")
    assert activity_text(work) == "Work completed step 2: Restarted fine"
    assert (
        activity_text(WorkEvent("fail", "Work", n=2, text="No access"))
        == "Work could not do step 2: No access"
    )
    assert (
        activity_text(_ev("add", n=3, step_kind="agent", step_text="Run prints"))
        == 'Gene added step 3 [Agent] "Run prints"'
    )
    assert activity_text(_ev("edit", n=3, step_text="Run more")) == 'Gene edited step 3: "Run more"'
    assert activity_text(_ev("move", n=1, step_text="Run more")) == 'Gene moved step "Run more" to 1'
    assert activity_text(_ev("remove", n=3, step_text="Run more")) == 'Gene removed step 3 "Run more"'
    assert (
        activity_text(_ev("fields", fields=[("Rank", "2"), ("Hypothesis", None)]))
        == "Gene set Rank to 2; cleared Hypothesis"
    )
    assert activity_text(_ev("note", text="Called them")) == "Gene added a note: Called them"
    assert activity_text(_ev("request", text="Check logs")) == "Gene asked the agent to act: Check logs"
    assert activity_text(WorkEvent("log", "Work", text="looked at the log")) == "Work looked at the log"
    assert activity_text(_ev("close")) == "Gene closed the item"
    assert (
        activity_text(_ev("floor", floor=("add", "Line 3 printer | Photo", None)))
        == "Gene added a floor item: Line 3 printer | Photo"
    )
    assert (
        activity_text(_ev("floor", floor=("edit", "Line 3 printer | Photo", None)))
        == "Gene edited a floor item: Line 3 printer | Photo"
    )
    assert (
        activity_text(_ev("floor", floor=("collect", "Line 3 printer | Photo", "E-12")))
        == "Gene collected Line 3 printer | Photo: E-12"
    )
    assert (
        activity_text(_ev("floor", floor=("collect", "Line 3 printer | Photo", None)))
        == "Gene collected Line 3 printer | Photo"
    )
    assert (
        activity_text(_ev("floor", floor=("uncollect", "Line 3 printer | Photo", None)))
        == "Gene un-ticked Line 3 printer | Photo"
    )
    assert (
        activity_text(_ev("floor", floor=("remove", "Line 3 printer | Photo", None)))
        == "Gene removed a floor item: Line 3 printer | Photo"
    )

    long = "x" * 80
    out = activity_text(_ev("reopen", n=4, step_text=long))
    assert out == 'Gene reopened step 4 "' + "x" * 69 + '..."'


def test_several_ops_are_one_line():
    from objectapp.workbody import activity_texts

    evs = [
        _ev("add", n=1, step_kind="question", step_text="A"),
        _ev("remove", n=2, step_text="B"),
    ]
    assert activity_texts(evs) == 'Gene added step 1 [Question] "A"; removed step 2 "B"'


def test_one_line_and_stamp():
    assert one_line("  a \n b\t c  ") == "a b c"
    assert one_line("abcdef", limit=4) == "abc..."
    assert one_line("abcd", limit=4) == "abcd"
    now = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
    assert stamp_local(now, UTC) == "2026-11-05 10:00"
    assert stamp_local(now, timezone(timedelta(hours=-6))) == "2026-11-05 04:00"


def test_work_note_texts():
    q = dict(n=1, step_text="Which tray jams most often?", step_kind="question", date="2026-11-05")
    assert (
        work_note_text(_ev("answer", **q, text="Tray 2"))
        == '[2026-11-05] Gene: answered step 1 "Which tray jams most often?": Tray 2'
    )
    a = dict(n=2, step_text=SPOOLER, step_kind="approve", date="2026-11-05")
    assert work_note_text(_ev("approve", **a)) == f'[2026-11-05] Gene: approved step 2 "{SPOOLER}"'
    assert work_note_text(_ev("decline", **a)) == f'[2026-11-05] Gene: declined step 2 "{SPOOLER}"'
    assert work_note_text(_ev("done", **q)) is None
    assert (
        work_note_text(_ev("done", **q, text="did it"))
        == '[2026-11-05] Gene: marked done step 1 "Which tray jams most often?": did it'
    )
    assert work_note_text(_ev("run", **a)) is None
    assert work_note_text(_ev("reopen", **a)) is None
    assert work_note_text(_ev("note", text="Hello", date="2026-11-05")) == "[2026-11-05] Gene: note: Hello"
    assert work_note_text(_ev("request", text="Do it", date="2026-11-05")) == "[2026-11-05] Gene: request: Do it"
    assert work_note_text(WorkEvent("log", "Work", text="x", date="2026-11-05")) is None
    assert work_note_text(_ev("fields", fields=[("Rank", "2")], date="2026-11-05")) is None

    two = work_note_text(_ev("note", text="line one\r\nline two", date="2026-11-05"))
    assert two == "[2026-11-05] Gene: note: line one\nline two"
    out = append_line("## Work notes\n\n- [2026-11-04] Gene: note: a\n", WORK_NOTES, two)
    assert out.endswith("- [2026-11-05] Gene: note: line one\n  line two\n")


def test_parse_lines():
    _fm, body = _split(PRINTER)
    acts = activity_lines(body)
    assert [a["at"] for a in acts] == ["2026-11-04 14:02", "2026-11-04 15:10"]
    assert acts[1]["text"] == (
        'Gene answered step 1 "Which tray jams most often?": Tray 2, mostly in the morning'
    )
    assert acts[1]["raw"] == "2026-11-04 15:10 " + acts[1]["text"]

    skipped = "## Activity\n\n- not a stamp\n- 2026-11-01 09:00 Gene did a thing\n"
    assert [a["text"] for a in activity_lines(skipped)] == ["Gene did a thing"]

    notes = work_note_lines(body)
    assert len(notes) == 1
    assert notes[0]["date"] == "2026-11-04"
    assert notes[0]["who"] == "Gene"
    assert notes[0]["text"] == 'answered step 1 "Which tray jams most often?": Tray 2, mostly in the morning'

    multi = "## Work notes\n\n- [2026-11-05] Pat Q: note: a: b\n  more\n- free text\n"
    got = work_note_lines(multi)
    assert got[0]["who"] == "Pat Q"
    assert got[0]["text"] == "note: a: b\nmore"
    assert got[1] == {"date": "", "who": "", "text": "free text", "raw": "free text"}
    assert activity_lines("no sections") == []
    assert work_note_lines("") == []


# -- resolution note ------------------------------------------------------------------------------


def test_resolution_note_from_fixture():
    item, body = _printer()
    note = resolution_note(item, body)
    work, close = note["workNotes"], note["closeNotes"]
    assert work.startswith("Work notes: INC0012345 Printer jams on line 3\n")
    assert (
        "Reported: The printer on line 3 jams several times a day and its queue stops. "
        "Operators clear the jam and restart the printer by hand." in work
    )
    assert "Summary: Restarted the print spooler on PRN-TEST-01 and ran 20 test prints." in work
    assert "Checked:\n- The spooler log shows 3 crashes on 2026-11-03" in work
    assert "Findings: [fill in: findings]" in work
    assert (
        "Working cause: The print spooler on PRN-TEST-01 crashes when tray 2 jams. (confidence: Medium)"
        in work
    )
    assert f"Next step: {SPOOLER}" in work
    assert "Activity:\n- 2026-11-04 14:02 Gene added step 1" in work
    assert "Earlier notes:\n- [2026-11-04] Gene: answered step 1" in work

    assert close.startswith("Close notes: INC0012345 Printer jams on line 3\n")
    assert (
        "Cause: The print spooler on PRN-TEST-01 crashes when tray 2 jams. "
        "[fill in: confirm this cause before closing]" in close
    )
    assert "Fix:\n- [fill in: what was changed to fix it (host, change, date)]" in close
    assert "Verification: Spooler restarted, 20 test prints clean" in close
    assert "Prevention: none needed" in close
    assert note["gaps"] == (work + close).count("[fill in:") == 3
    assert "{" not in work + close


def test_resolution_note_cause_fix_and_redaction():
    item, body = _printer()
    steps = list(item.steps)
    steps[1] = Step(id="r8k1pd", kind="approve", state="done", text=SPOOLER)
    steps[2] = Step(id="t2n7vc", kind="agent", state="done", text="Run 20 **test** prints")
    item2, _ = _printer(
        steps=steps,
        cause="Confirmed",
        findings="The log had `token: abc123` in it and [[Spooler notes|the spooler page]].",
        blocked_on="Facilities",
    )
    note = resolution_note(item2, body)
    work, close = note["workNotes"], note["closeNotes"]
    assert "token: [redacted]" in work
    assert "abc123" not in work
    assert "the spooler page" in work and "[[" not in work
    assert "Checked:\n- Run 20 test prints\n- The spooler log shows" in work
    assert "Waiting on: Facilities" in work
    assert "Next step:" not in work
    assert "Cause: The print spooler on PRN-TEST-01 crashes when tray 2 jams.\n" in close
    assert f"Fix:\n- {SPOOLER}" in close
    assert note["gaps"] == 0

    bare = WorkItemData(ticket_id="OPS-123", title="Badge reader audit")
    empty = resolution_note(bare, "")
    assert empty["closeNotes"].startswith("Close notes: OPS-123 Badge reader audit\nCause: [fill in: root cause]")
    assert "Prevention: [fill in: what stops it happening again, or 'none needed']" in empty["closeNotes"]
    assert empty["gaps"] == 7


def test_resolution_note_follow_up_and_investigations():
    body = (
        "## Description\n\nIt broke.\n\n## Live investigation 2026-11-04\n\nlooked\n\n"
        "## Wrap-up\n\nFollow-up:: add a monitor\n"
    )
    item = WorkItemData(ticket_id="INC1", title="T", hypothesis="Disk full", cause="Unknown")
    note = resolution_note(item, body)
    assert "Investigations recorded: Live investigation 2026-11-04" in note["workNotes"]
    assert "Prevention: add a monitor" in note["closeNotes"]
    assert "Cause: [fill in: root cause; working idea on the page: Disk full]" in note["closeNotes"]
    long = WorkItemData(ticket_id="INC1", title="T", findings="y" * 500)
    assert "Findings: " + "y" * 399 + "…" in resolution_note(long, "")["workNotes"]
