"""M22 Task 1: the work model contract (constants, records, request bodies), the three new
property kinds' icons and default options, the stub routers, and the synthetic fixtures
(``fixtures/space-work`` and the shared ``step-cases.json``)."""

from __future__ import annotations

import inspect
import json
import re
from pathlib import Path

import pytest
from fastapi import APIRouter
from pydantic import ValidationError

from objectapp import api_v1_work, api_work
from objectapp.typemodel import PROPERTY_ICONS, PropertyDefinition, _default_options
from objectapp.workmodel import (
    FLOOR_CHANGED,
    FLOOR_KEYS,
    ITEM_CHANGED,
    KIND_LABELS,
    MAX_FLOOR,
    MAX_LIST,
    MAX_LIST_TEXT,
    MAX_NOTE,
    MAX_STEP_TEXT,
    MAX_STEPS,
    NOT_WORK_ITEM,
    STAGE_LABELS,
    STATE_LABELS,
    STEP_CHANGED,
    STEP_KEYS,
    STEP_KINDS,
    STEP_STATES,
    ActivityRequest,
    CloseRequest,
    FieldsRequest,
    FloorItem,
    FloorRequest,
    NoteRequest,
    Step,
    StepRequest,
    StepsRequest,
    WorkFieldsTypeRequest,
)

HERE = Path(__file__).resolve().parent
SPACE = HERE / "fixtures" / "space-work"
REPO = HERE.parent.parent
STEP_CASES = REPO / "frontend" / "src" / "work" / "__fixtures__" / "step-cases.json"


def test_models_and_constants() -> None:
    assert STEP_CHANGED == "This step changed. Look again."
    assert ITEM_CHANGED == "This item changed. Look again."
    assert FLOOR_CHANGED == "This floor item changed. Look again."
    assert NOT_WORK_ITEM == "This object has no work fields."
    assert STEP_KEYS == (
        "id", "kind", "state", "text", "notBefore", "answer", "result",
        "addedAt", "approvedAt", "doneAt", "declinedAt",
    )  # fmt: skip
    assert FLOOR_KEYS == ("id", "place", "what", "collected", "found")
    assert STEP_KINDS == ("question", "do", "approve", "agent")
    assert STEP_STATES == ("open", "approved", "done", "declined")
    assert KIND_LABELS == {"question": "Question", "do": "Do", "approve": "Approve", "agent": "Agent"}
    assert STATE_LABELS == {"open": "Open", "approved": "Approved", "done": "Done", "declined": "Declined"}
    assert STAGE_LABELS == {
        "notStarted": "Not started", "ready": "Ready", "doing": "Doing",
        "parked": "Waiting / parked", "done": "Done",
    }  # fmt: skip
    assert MAX_STEPS == MAX_FLOOR == MAX_LIST == 50
    assert MAX_STEP_TEXT == MAX_LIST_TEXT == 500
    assert MAX_NOTE == 8000

    # The records: unknown keys kept apart, in order.
    s = Step(id=None, kind="do", state="open", text="Check the cable")
    assert s.notBefore is None and s.answer is None and s.result is None and s.extra == {}
    assert Step("q4m2xa", "question", "done", "x", extra={"owner": "line lead"}).extra == {"owner": "line lead"}
    f = FloorItem(id=None, place="Line 3 printer", what=None)
    assert f.collected is None and f.found is None and f.extra == {}

    # The request bodies parse the Contract's JSON.
    r = StepRequest.model_validate(
        {"path": "Tasks/Printer jams on line 3.md", "stepId": "r8k1pd", "stepRev": "0123456789ab",
         "action": "approve", "notBefore": "2026-11-06T07:00:00.000Z", "clientId": "c1"}
    )  # fmt: skip
    assert r.action == "approve" and r.text is None and r.ask is None
    with pytest.raises(ValidationError):
        StepRequest.model_validate({"path": "a.md", "stepId": "x", "stepRev": "y", "action": "withdraw"})
    ops = [{"op": "add", "kind": "approve", "text": "Restart it", "before": None},
           {"op": "move", "stepId": "q4m2xa", "stepRev": "0123456789ab", "before": None}]  # fmt: skip
    assert StepsRequest.model_validate({"path": "a.md", "ops": ops}).ops == ops
    fr = FieldsRequest.model_validate({"path": "a.md", "baseVersion": "v1", "set": {"rank": 2}})
    assert fr.set == {"rank": 2} and fr.remove == [] and fr.clientId is None
    assert FieldsRequest.model_validate({"path": "a.md", "baseVersion": "v1"}).set == {}
    assert NoteRequest.model_validate({"path": "a.md", "text": "Called the desk"}).kind == "note"
    assert NoteRequest.model_validate({"path": "a.md", "kind": "request", "text": "x"}).kind == "request"
    with pytest.raises(ValidationError):
        NoteRequest.model_validate({"path": "a.md", "kind": "log", "text": "x"})
    assert ActivityRequest.model_validate({"path": "a.md", "text": "Looked at the log"}).text == "Looked at the log"
    assert CloseRequest.model_validate({"path": "a.md", "baseVersion": "v1"}).baseVersion == "v1"
    fl = FloorRequest.model_validate(
        {"path": "a.md", "op": "collect", "itemId": "f3k9wz", "itemRev": "0123456789ab",
         "found": "Code E-12 on the panel"}
    )  # fmt: skip
    assert fl.op == "collect" and fl.place is None
    with pytest.raises(ValidationError):
        FloorRequest.model_validate({"path": "a.md", "op": "tick"})
    assert WorkFieldsTypeRequest.model_validate({"baseRevision": ""}).baseRevision == ""


def test_icons_and_default_options() -> None:
    assert PROPERTY_ICONS["steps"] == "ph-list-checks"
    assert PROPERTY_ICONS["textList"] == "ph-list-bullets"
    assert PROPERTY_ICONS["floorItems"] == "ph-clipboard-text"
    for kind in ("steps", "textList", "floorItems"):
        assert _default_options(kind, None) == {}
        d = PropertyDefinition.from_json({"id": kind, "key": kind, "name": kind, "type": kind})
        assert d.type == kind and d.options == {}


def test_stub_routers() -> None:
    # T8 and T9 filled the stubs, which now need a real context (their routes are tested in
    # test_m22_api.py and test_m22_mcp.py); the Contract's signature stands.
    for module in (api_work, api_v1_work):
        sig = inspect.signature(module.router)
        assert list(sig.parameters) == ["ctx", "service"], module.__name__
        assert sig.return_annotation in (APIRouter, "APIRouter"), module.__name__


def _texts() -> dict[str, str]:
    return {
        p.relative_to(SPACE).as_posix(): p.read_bytes().decode("utf-8-sig")
        for p in sorted(SPACE.rglob("*"))
        if p.is_file()
    }


def test_fixture_space_is_synthetic() -> None:
    files = _texts()
    md = {k for k in files if k.endswith(".md")}
    assert md == {
        "Tasks/Printer jams on line 3.md", "Tasks/Badge reader audit.md", "Tasks/Order toner.md",
        "Tasks/Old cleanup.md", "Tasks/Last week fix.md", "Tasks/Parked thing.md",
        "Tasks/Hand edited.md", "Tasks/Desk closed it.md", "Projects/Scanner rollout.md",
    }  # fmt: skip
    assert set(files) - md == {
        ".object/types/page.json", ".object/types/tag.json", ".object/types/task.json",
        ".object/types/project.json",
    }  # fmt: skip
    everything = "\n".join(files.values())
    # No real ticket, host, person, company or address.
    assert not re.search(r"(?i)cpi|card ?group|@[a-z0-9-]+\.[a-z]", everything)
    assert set(re.findall(r"\b[A-Z]{2,}-[A-Z]+-\d+\b", everything)) <= {"PRN-TEST-01"}
    assert set(re.findall(r"\b(?:INC|RITM|SCTASK|CHG)\d+\b", everything)) <= {"INC0012345", "INC0012346"}
    assert set(re.findall(r"(?m)^requester: (.*)$", everything)) == {"Sam Sample"}
    assert set(re.findall(r"(?m)^- \d{4}-\d\d-\d\d \d\d:\d\d (\S+) ", everything)) == {"Gene"}

    # The Badge reader file is CRLF with a UTF-8 BOM; every other object file is LF.
    raw = (SPACE / "Tasks" / "Badge reader audit.md").read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf---\r\n")
    assert b"\r\n" in raw and raw.count(b"\n") == raw.count(b"\r\n")
    for rel in md - {"Tasks/Badge reader audit.md"}:
        data = (SPACE / rel).read_bytes()
        assert b"\r" not in data and not data.startswith(b"\xef\xbb\xbf"), rel

    # The pieces later tasks rely on.
    printer = files["Tasks/Printer jams on line 3.md"]
    for needle in ("ticketId: INC0012345", "system: ServiceNow", "deskStatus: In progress",
                   "deskPriority: Moderate", "rank: 1", "area: Printers", "## Description",
                   "## Activity", "## Work notes", "## Wrap-up",
                   "Result:: Spooler restarted, 20 test prints clean", "Prevention:: none needed",
                   "Suggested ServiceNow work note:\n> "):  # fmt: skip
        assert needle in printer, needle
    assert printer.index("## Activity") < printer.index("## Work notes") < printer.index("## Wrap-up")
    badge = files["Tasks/Badge reader audit.md"]
    assert "ticketId: OPS-123" in badge and "system:" not in badge and "## Activity" not in badge
    hand = files["Tasks/Hand edited.md"]
    assert "kind: maybe" in hand and "owner: line lead" in hand and "id:" not in hand.split("steps:")[1]
    project = json.loads(files[".object/types/project.json"])
    assert project["id"] == "project"
    assert "steps" not in {p["key"] for p in project["propertyDefinitions"]}


def test_step_cases_cover_the_rules() -> None:
    rows = json.loads(STEP_CASES.read_text(encoding="utf-8"))
    assert len(rows) >= 40
    keys = {"name", "steps", "status", "statusOptions", "deskStatus", "role", "index", "action", "expect"}
    names = [r["name"] for r in rows]
    assert len(names) == len(set(names))
    for r in rows:
        assert keys <= set(r), r["name"]
        e = r["expect"]
        assert {"current", "stage", "turn", "actions"} <= set(e), r["name"]
        assert ("result" in e) != ("error" in e), r["name"]
    errors = {r["expect"].get("error") for r in rows}
    for message in (
        "Finish the steps before this one first.", "This doesn't apply to a Do step.",
        "This step is already approved.", "A done Approve step never reopens.",
        "Only you can do this to a step.", "Only the agent reports a step's result.",
        "Only the agent marks an Approve step done.", "An answer needs text.", "Say what happened.",
        "Only an Approve step takes a Not before time.",
    ):  # fmt: skip
        assert message in errors, message
    done = {(r["role"], r["action"]) for r in rows if "result" in r["expect"]}
    assert done >= {
        ("user", "answer"), ("user", "done"), ("agent", "done"), ("user", "approve"),
        ("user", "decline"), ("user", "run"), ("app", "run"), ("user", "reopen"),
        ("agent", "complete"), ("agent", "fail"),
    }  # fmt: skip
    assert {r["expect"]["stage"] for r in rows} == set(STAGE_LABELS)
    assert {r["expect"]["turn"] for r in rows} >= {"you", "approve", "agent", "parked", "close", "none"}
