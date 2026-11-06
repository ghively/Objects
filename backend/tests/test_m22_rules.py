"""M22 Task 2: the pure step rules (current step, whose turn, stage, moves, ticket helpers).

The parity rows in ``frontend/src/work/__fixtures__/step-cases.json`` are shared with the TS port
(``frontend/src/work/stepRules.ts``), row for row."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from objectapp.typemodel import PropertyDefinition, label_options
from objectapp.workmodel import STEP_KEYS, Step
from objectapp.workrules import (
    DONE_VISIBLE_DAYS,
    IllegalMove,
    allowed_actions,
    apply_action,
    apply_op,
    current_index,
    desk_says,
    done_option,
    infer_system,
    is_done,
    normalize_desk_priority,
    recently_done,
    stage_of,
    ticket_url,
    whose_turn,
)

HERE = Path(__file__).resolve().parent
CASES = json.loads(
    (HERE.parents[1] / "frontend" / "src" / "work" / "__fixtures__" / "step-cases.json").read_text(
        encoding="utf-8"
    )
)
NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)

TASK_TEXTS = ["Not Started", "Next Up", "In Progress", "On Hold", "Done"]
PROJECT_TEXTS = ["Planned", "In Progress", "On Hold", "Completed"]


def _ids():
    counter = iter(range(1, 10_000))

    def new_id(taken: set[str]) -> str:
        while True:
            cand = f"n{next(counter):05d}"
            if cand not in taken:
                return cand

    return new_id


def status_def(options: list[dict] | None) -> PropertyDefinition | None:
    if options is None:
        return None
    return PropertyDefinition.from_json(
        {
            "id": "status",
            "key": "status",
            "name": "Status",
            "type": "label",
            "options": {"isArray": False, "isStatus": True, "set": options},
        }
    )


def task_status() -> PropertyDefinition:
    return status_def(label_options(TASK_TEXTS, status=True))


def project_status() -> PropertyDefinition:
    return status_def(label_options(PROJECT_TEXTS, status=True))


def to_step(d: dict) -> Step:
    known = {k: d.get(k) for k in STEP_KEYS if k in d}
    return Step(**known, extra={k: v for k, v in d.items() if k not in STEP_KEYS})


def S(kind: str, state: str = "open", text: str | None = None, sid: str | None = None, **kw) -> Step:
    return Step(id=sid, kind=kind, state=state, text=text or f"{kind} step", **kw)


def steps_of(*specs: tuple[str, str]) -> list[Step]:
    return [S(k, s, sid=f"s{i:05d}") for i, (k, s) in enumerate(specs, 1)]


# -- parity -----------------------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_parity_cases(case):
    steps = [to_step(s) for s in case["steps"]]
    sdef = status_def(case.get("statusOptions"))
    exp = case["expect"]
    stage = stage_of(case["status"], sdef)
    assert current_index(steps) == exp["current"]
    assert stage == exp["stage"]
    assert whose_turn(stage, steps, case["deskStatus"]) == exp["turn"]
    assert allowed_actions(steps, case["index"], case["role"]) == exp["actions"]
    call = lambda: apply_action(  # noqa: E731
        steps,
        case["index"],
        case["action"],
        case["role"],
        now=NOW,
        text=case.get("text"),
        not_before=case.get("notBefore"),
        ask=case.get("ask"),
        new_id=_ids(),
    )
    if "error" in exp:
        with pytest.raises(IllegalMove) as err:
            call()
        assert str(err.value) == exp["error"]
    else:
        after = call()
        assert [s.state for s in after] == exp["result"]
    # The input is never mutated.
    assert [s.state for s in steps] == [s["state"] for s in case["steps"]]


def test_parity_fixture_is_big_enough():
    assert len(CASES) >= 40


# -- current step and turn --------------------------------------------------------------------


def test_current_step_skips_done_and_declined():
    steps = steps_of(("do", "done"), ("approve", "declined"), ("do", "open"), ("do", "open"))
    assert current_index(steps) == 2
    assert current_index(steps_of(("do", "done"), ("approve", "declined"))) is None
    assert current_index([]) is None
    assert current_index(steps_of(("approve", "approved"), ("do", "open"))) == 0


def test_turn_order():
    open_do = steps_of(("do", "open"))
    assert whose_turn("done", open_do, None) == "none"
    assert whose_turn("done", open_do, "Resolved") == "none"
    assert whose_turn("doing", open_do, "Resolved") == "close"
    assert whose_turn("doing", open_do, "closed") == "close"
    assert whose_turn("parked", open_do, None) == "parked"
    assert whose_turn("parked", open_do, "Closed") == "close"
    assert whose_turn("doing", [], None) == "none"
    assert whose_turn("doing", steps_of(("do", "done"), ("approve", "declined")), None) == "close"
    assert whose_turn("doing", steps_of(("question", "open")), None) == "you"
    assert whose_turn("ready", steps_of(("do", "open")), None) == "you"
    assert whose_turn("doing", steps_of(("approve", "open")), None) == "approve"
    assert whose_turn("doing", steps_of(("approve", "approved")), None) == "agent"
    assert whose_turn("doing", steps_of(("agent", "open")), None) == "agent"
    assert whose_turn("notStarted", steps_of(("agent", "approved")), "In progress") == "agent"


def test_stage_texts():
    task, project = task_status(), project_status()
    assert stage_of("Not Started", task) == "notStarted"
    assert stage_of("Planned", project) == "notStarted"
    assert stage_of("Next Up", task) == "ready"
    assert stage_of("In Progress", task) == "doing"
    assert stage_of("In Progress", project) == "doing"
    assert stage_of("On Hold", task) == "parked"
    assert stage_of("On Hold", project) == "parked"
    assert stage_of("Done", task) == "done"
    assert stage_of("Completed", project) == "done"
    custom = status_def([{"id": "someday", "text": "Someday", "statusCategory": "not-started"}])
    assert stage_of("Someday", custom) == "notStarted"
    assert stage_of(None, task) == "notStarted"
    assert stage_of(None, None) == "notStarted"
    assert stage_of("  in progress ", None) == "doing"
    # An option id reads as its option.
    assert stage_of("on-hold", task) == "parked"
    assert is_done("done") and not is_done("doing")


def test_done_option():
    assert done_option(task_status()) == "Done"
    assert done_option(project_status()) == "Completed"
    assert done_option(status_def([{"id": "shipped", "text": "Shipped", "statusCategory": "done"}])) == "Shipped"
    assert done_option(status_def([{"id": "a", "text": "A", "statusCategory": "not-started"}])) is None
    assert done_option(None) is None


# -- the gate ---------------------------------------------------------------------------------


def _raises(msg: str, steps, index, action, role, **kw):
    with pytest.raises(IllegalMove) as err:
        apply_action(steps, index, action, role, now=NOW, new_id=_ids(), **kw)
    assert str(err.value) == msg


def test_gate():
    only_you = "Only you can do this to a step."
    _raises(only_you, steps_of(("approve", "open")), 0, "approve", "agent")
    _raises(only_you, steps_of(("approve", "open")), 0, "decline", "agent")
    _raises(only_you, steps_of(("approve", "approved")), 0, "reopen", "agent")
    _raises(only_you, steps_of(("question", "open")), 0, "answer", "agent", text="x")
    _raises(only_you, steps_of(("do", "open")), 0, "done", "agent")
    _raises("Only the agent reports a step's result.", steps_of(("approve", "approved")), 0,
            "complete", "user", text="x")
    _raises("Only the agent reports a step's result.", steps_of(("agent", "approved")), 0,
            "fail", "user", text="x")
    _raises("Only the agent marks an Approve step done.", steps_of(("approve", "approved")), 0,
            "done", "user")
    _raises("A done Approve step never reopens.", steps_of(("approve", "done")), 0, "reopen", "user")
    # Object itself may only run.
    agent_open = steps_of(("agent", "open"))
    assert allowed_actions(agent_open, 0, "app") == ["run"]
    for action in ("answer", "done", "approve", "decline", "reopen", "complete", "fail"):
        _raises(only_you, agent_open, 0, action, "app", text="x")
    after = apply_action(agent_open, 0, "run", "app", now=NOW, new_id=_ids())
    assert after[0].state == "approved"
    assert after[0].approvedAt == "2026-11-05T10:00:00.000Z"
    # Nobody approves on the agent's behalf: the agent's moves on an open Approve step are none.
    assert allowed_actions(steps_of(("approve", "open")), 0, "agent") == []


def test_not_current():
    steps = steps_of(("question", "open"), ("do", "open"), ("approve", "open"))
    _raises("Finish the steps before this one first.", steps, 2, "approve", "user")
    assert allowed_actions(steps, 2, "user") == []
    earlier = steps_of(("do", "done"), ("do", "done"), ("question", "open"))
    assert current_index(earlier) == 2
    after = apply_action(earlier, 0, "reopen", "user", now=NOW, new_id=_ids())
    assert [s.state for s in after] == ["open", "done", "open"]
    assert current_index(after) == 0


def test_action_effects():
    answered = apply_action(steps_of(("question", "open")), 0, "answer", "user", now=NOW,
                            text="  Tray 2\nmostly mornings  ", new_id=_ids())[0]
    assert (answered.state, answered.answer, answered.doneAt) == (
        "done", "Tray 2\nmostly mornings", "2026-11-05T10:00:00.000Z")
    approved = apply_action(steps_of(("approve", "open")), 0, "approve", "user", now=NOW,
                            not_before="2026-11-06T07:00:00Z", new_id=_ids())[0]
    assert approved.state == "approved"
    assert approved.approvedAt == "2026-11-05T10:00:00.000Z"
    assert approved.notBefore == "2026-11-06T07:00:00.000Z"
    with pytest.raises(IllegalMove):
        apply_action(steps_of(("approve", "open")), 0, "approve", "user", now=NOW,
                     not_before="tomorrow", new_id=_ids())
    declined = apply_action([approved], 0, "decline", "user", now=NOW, text="Not now", new_id=_ids())[0]
    assert (declined.state, declined.declinedAt) == ("declined", "2026-11-05T10:00:00.000Z")
    reopened = apply_action([approved], 0, "reopen", "user", now=NOW, new_id=_ids())[0]
    assert reopened.state == "open"
    assert (reopened.approvedAt, reopened.notBefore, reopened.doneAt, reopened.declinedAt) == (None,) * 4
    done_q = Step(id="a1b2c3", kind="question", state="done", text="Q", answer="A",
                  doneAt="2026-11-04T10:00:00.000Z", extra={"owner": "line lead"})
    back = apply_action([done_q], 0, "reopen", "user", now=NOW, new_id=_ids())[0]
    assert (back.state, back.answer, back.doneAt, back.extra) == ("open", "A", None, {"owner": "line lead"})
    completed = apply_action([approved], 0, "complete", "agent", now=NOW, text="Spooler restarted",
                             new_id=_ids())[0]
    assert (completed.state, completed.result, completed.doneAt) == (
        "done", "Spooler restarted", "2026-11-05T10:00:00.000Z")
    agent_done = apply_action(steps_of(("agent", "open")), 0, "done", "user", now=NOW,
                              text="Looked myself", new_id=_ids())[0]
    assert (agent_done.state, agent_done.result) == ("done", "Looked myself")
    do_done = apply_action(steps_of(("do", "open")), 0, "done", "user", now=NOW, text="fine",
                           new_id=_ids())[0]
    assert do_done.result is None


def test_fail_with_ask_inserts_question_before():
    steps = [S("question", "done", sid="s00001"),
             S("approve", "approved", sid="s00002", approvedAt="2026-11-05T09:00:00.000Z",
               notBefore="2026-11-05T09:30:00.000Z")]
    after = apply_action(steps, 1, "fail", "agent", now=NOW, text="Two hosts match",
                         ask="Which host?", new_id=_ids())
    assert [(s.kind, s.state) for s in after] == [("question", "done"), ("question", "open"),
                                                   ("approve", "open")]
    asked = after[1]
    assert asked.text == "Which host?"
    assert asked.id == "n00001"
    assert asked.addedAt == "2026-11-05T10:00:00.000Z"
    failed = after[2]
    assert (failed.result, failed.approvedAt, failed.notBefore) == ("Two hosts match", None, None)
    assert whose_turn("doing", after, None) == "you"
    # Without ask nothing is inserted.
    plain = apply_action(steps, 1, "fail", "agent", now=NOW, text="No answer", new_id=_ids())
    assert [s.state for s in plain] == ["done", "open"]


def test_answer_and_result_cap():
    with pytest.raises(IllegalMove):
        apply_action(steps_of(("question", "open")), 0, "answer", "user", now=NOW,
                     text="x" * 8001, new_id=_ids())
    ok = apply_action(steps_of(("question", "open")), 0, "answer", "user", now=NOW,
                      text="x" * 8000, new_id=_ids())
    assert len(ok[0].answer) == 8000


# -- ops --------------------------------------------------------------------------------------


def test_ops_add_edit_move_remove():
    steps = steps_of(("question", "done"), ("do", "open"))
    added = apply_op(steps, {"op": "add", "kind": "approve", "text": " Restart the spooler "}, "user",
                     now=NOW, new_id=_ids())
    assert [(s.kind, s.state, s.text) for s in added][-1] == ("approve", "open", "Restart the spooler")
    assert added[-1].id == "n00001" and added[-1].addedAt == "2026-11-05T10:00:00.000Z"
    before = apply_op(steps, {"op": "add", "kind": "do", "text": "First", "before": "s00002"}, "user",
                      now=NOW, new_id=_ids())
    assert [s.text for s in before] == ["question step", "First", "do step"]
    edited = apply_op(steps, {"op": "edit", "stepId": "s00002", "stepRev": "x", "text": "Clean rollers",
                              "kind": "agent"}, "user", now=NOW, new_id=_ids())
    assert (edited[1].text, edited[1].kind) == ("Clean rollers", "agent")
    moved = apply_op(steps, {"op": "move", "stepId": "s00002", "stepRev": "x", "before": "s00001"},
                     "user", now=NOW, new_id=_ids())
    assert [s.id for s in moved] == ["s00002", "s00001"]
    last = apply_op(moved, {"op": "move", "stepId": "s00002", "stepRev": "x", "before": None}, "user",
                    now=NOW, new_id=_ids())
    assert [s.id for s in last] == ["s00001", "s00002"]
    removed = apply_op(steps, {"op": "remove", "stepId": "s00001", "stepRev": "x"}, "user", now=NOW,
                       new_id=_ids())
    assert [s.id for s in removed] == ["s00002"]
    # An id-less step is addressed by its position.
    nameless = [S("do"), S("question")]
    gone = apply_op(nameless, {"op": "remove", "stepId": "@2", "stepRev": "x"}, "user", now=NOW,
                    new_id=_ids())
    assert [s.kind for s in gone] == ["do"]
    assert [s.state for s in steps] == ["done", "open"]  # input untouched


def test_edit_rules():
    approved = steps_of(("approve", "approved"))
    with pytest.raises(IllegalMove, match="^Withdraw the approval before changing this step.$"):
        apply_op(approved, {"op": "edit", "stepId": "s00001", "stepRev": "x", "text": "Other"}, "user",
                 now=NOW, new_id=_ids())
    with pytest.raises(IllegalMove, match="^A done Approve step can't be changed.$"):
        apply_op(steps_of(("approve", "done")), {"op": "edit", "stepId": "s00001", "stepRev": "x",
                                                 "text": "Other"}, "user", now=NOW, new_id=_ids())
    with pytest.raises(IllegalMove, match="^Only an open step changes kind.$"):
        apply_op(steps_of(("do", "done")), {"op": "edit", "stepId": "s00001", "stepRev": "x",
                                            "kind": "agent"}, "user", now=NOW, new_id=_ids())
    agents = "^Agents can't change an approved or done Approve step.$"
    for op in ({"op": "remove", "stepId": "s00001", "stepRev": "x"},
               {"op": "move", "stepId": "s00001", "stepRev": "x", "before": None},
               {"op": "edit", "stepId": "s00001", "stepRev": "x", "text": "Other"}):
        with pytest.raises(IllegalMove, match=agents):
            apply_op(approved, op, "agent", now=NOW, new_id=_ids())
        with pytest.raises(IllegalMove, match=agents):
            apply_op(steps_of(("approve", "done")), op, "agent", now=NOW, new_id=_ids())
    # An agent may still change an open Approve step and remove its own steps.
    assert apply_op(steps_of(("approve", "open")), {"op": "remove", "stepId": "s00001", "stepRev": "x"},
                    "agent", now=NOW, new_id=_ids()) == []
    with pytest.raises(IllegalMove, match="^A step is one line.$"):
        apply_op([], {"op": "add", "kind": "do", "text": "one\ntwo"}, "user", now=NOW, new_id=_ids())
    with pytest.raises(IllegalMove, match="^A step is one line.$"):
        apply_op(steps_of(("do", "open")), {"op": "edit", "stepId": "s00001", "stepRev": "x",
                                            "text": "one\ntwo"}, "user", now=NOW, new_id=_ids())
    with pytest.raises(IllegalMove):
        apply_op([], {"op": "add", "kind": "do", "text": "   "}, "user", now=NOW, new_id=_ids())
    with pytest.raises(IllegalMove):
        apply_op([], {"op": "add", "kind": "do", "text": "x" * 501}, "user", now=NOW, new_id=_ids())
    with pytest.raises(IllegalMove):
        apply_op([], {"op": "add", "kind": "maybe", "text": "x"}, "user", now=NOW, new_id=_ids())
    fifty = [S("do", sid=f"s{i:05d}") for i in range(50)]
    with pytest.raises(IllegalMove) as err:
        apply_op(fifty, {"op": "add", "kind": "do", "text": "one more"}, "user", now=NOW, new_id=_ids())
    assert "50" in str(err.value)
    with pytest.raises(IllegalMove, match="^Only you can do this to a step.$"):
        apply_op([], {"op": "add", "kind": "do", "text": "x"}, "app", now=NOW, new_id=_ids())
    with pytest.raises(KeyError):
        apply_op(steps_of(("do", "open")), {"op": "remove", "stepId": "zzzzzz", "stepRev": "x"}, "user",
                 now=NOW, new_id=_ids())


# -- ticket helpers ---------------------------------------------------------------------------


def test_system_priority_and_link():
    assert infer_system("OPS-123") == "Jira"
    assert infer_system("INC0012345") == "ServiceNow"
    assert infer_system("  ") is None
    assert infer_system(None) is None
    assert infer_system("ops-7") == "Jira"
    assert infer_system(" OPS-123 ") == "Jira"
    assert normalize_desk_priority("moderate") == "Medium"
    assert normalize_desk_priority("Moderate") == "Medium"
    assert normalize_desk_priority("high") == "High"
    assert normalize_desk_priority("P1 - urgent") == "P1 - urgent"
    assert normalize_desk_priority(None) is None
    site = "https://example.atlassian.net/"
    assert ticket_url("Jira", "OPS-123", None, site) == "https://example.atlassian.net/browse/OPS-123"
    assert ticket_url("Jira", "OPS-123", "https://other.example/x", site) == "https://other.example/x"
    assert ticket_url("ServiceNow", "INC0012345", None, site) is None
    assert ticket_url("ServiceNow", "INC0012345", "https://desk.example/INC0012345", None) == (
        "https://desk.example/INC0012345")
    assert ticket_url("Jira", "OPS-123", None, None) is None


def test_recently_done_14_days():
    assert DONE_VISIBLE_DAYS == 14
    assert recently_done(NOW - timedelta(days=13, hours=23), None, NOW) is True
    assert recently_done(NOW - timedelta(days=14), None, NOW) is False
    assert recently_done(None, NOW - timedelta(days=2), NOW) is True
    assert recently_done(None, NOW - timedelta(days=20), NOW) is False
    assert recently_done(NOW - timedelta(days=20), NOW, NOW) is False
    assert recently_done(None, None, NOW) is False


def test_desk_status_never_changes_stage():
    task = task_status()
    assert stage_of("In Progress", task) == "doing"
    assert desk_says("doing", "Resolved") == "Resolved"
    assert desk_says("parked", "closed") == "Closed"
    assert desk_says("done", "Resolved") is None
    assert desk_says("doing", "In progress") is None
    assert desk_says("doing", None) is None
