"""M22 Task 4: the ticket and work fields, topping up Task, "Add work fields", Project."""

from __future__ import annotations

import copy
import json
import shutil
from pathlib import Path

import pytest
from objectapp.basicsetup import basic_types
from objectapp.typemodel import TypeDefinition, load_types, topup_task_type
from objectapp.typetemplates import build_template
from objectapp.workfields import (
    FIELD_KEYS,
    TICKET_FIELDS,
    TICKET_KEYS,
    WORK_FIELDS,
    WORK_KEYS,
    field_defs,
    is_work_type,
    project_type_ids,
    topup_work_fields,
    with_work_fields,
    work_type_ids,
)

FIXTURE = Path(__file__).parent / "fixtures" / "space-work"

TICKET_TABLE = [
    ("ticketId", "Ticket ID", "text"),
    ("system", "System", "label"),
    ("ticketLink", "Ticket link", "url"),
    ("deskStatus", "Desk status", "label"),
    ("deskPriority", "Desk priority", "label"),
    ("requester", "Requester", "text"),
    ("deskGroup", "Group", "text"),
    ("deskLocation", "Location", "text"),
    ("deskOpened", "Opened", "datetime"),
    ("deskUpdated", "Desk updated", "datetime"),
    ("deskResolved", "Resolved", "datetime"),
]

WORK_TABLE = [
    ("rank", "Rank", "number"),
    ("area", "Area", "label"),
    ("cause", "Cause", "label"),
    ("priorityNote", "Priority note", "text"),
    ("blockedOn", "Blocked on", "text"),
    ("findings", "Findings", "textBlock"),
    ("hypothesis", "Hypothesis", "textBlock"),
    ("confidence", "Confidence", "label"),
    ("confidenceReason", "Confidence reason", "text"),
    ("verified", "Verified", "textList"),
    ("assumed", "Assumed", "textList"),
    ("toRaiseConfidence", "To raise confidence", "textList"),
    ("floorItems", "Floor items", "floorItems"),
    ("steps", "Steps", "steps"),
    ("project", "Project", "entity"),
]

OPTIONS = {
    "system": [("ServiceNow", "green"), ("Jira", "blue")],
    "deskStatus": [
        ("Open", "gray"), ("In progress", "blue"), ("Active", "sky"), ("Blocked", "red"),
        ("Waiting response", "amber"), ("Resolved", "green"), ("Closed", "gray"),
    ],
    "deskPriority": [("Critical", "red"), ("High", "amber"), ("Medium", "yellow"), ("Low", "gray")],
    "cause": [
        ("Likely", "amber"), ("Confirmed", "green"), ("Unknown", "gray"), ("Not found", "purple"),
        ("Need to ask", "sky"),
    ],
    "confidence": [("High", "green"), ("Medium", "amber"), ("Low", "red"), ("N/A", "gray")],
}  # fmt: skip


def _types(root: Path) -> list[TypeDefinition]:
    types, unreadable = load_types(root)
    assert not unreadable
    return types


def _snapshot(root: Path) -> dict[str, bytes]:
    d = root / ".object" / "types"
    return {p.name: p.read_bytes() for p in sorted(d.iterdir())}


@pytest.fixture
def space(tmp_path: Path) -> Path:
    dst = tmp_path / "space"
    shutil.copytree(FIXTURE, dst)
    return dst


def test_field_tables():
    assert [(f.key, f.name, f.kind) for f in TICKET_FIELDS] == TICKET_TABLE
    assert [(f.key, f.name, f.kind) for f in WORK_FIELDS] == WORK_TABLE
    assert TICKET_KEYS == {k for k, _, _ in TICKET_TABLE}
    assert WORK_KEYS == {k for k, _, _ in WORK_TABLE} and "project" in WORK_KEYS
    assert FIELD_KEYS == TICKET_KEYS | WORK_KEYS
    assert [f.key for f in (*TICKET_FIELDS, *WORK_FIELDS) if f.task_only] == ["project"]

    defs = {p.key: p for p in field_defs(task=True, project_type_ids=["project"])}
    assert list(defs) == [k for k, _, _ in TICKET_TABLE + WORK_TABLE]
    for key, p in defs.items():
        assert p.id == key
        assert p.visibility == ("alwaysShow" if key == "steps" else "hideWhenEmpty")
    for key, expected in OPTIONS.items():
        opts = defs[key].options
        assert opts["isArray"] is False
        assert [(o["text"], o["color"]) for o in opts["set"]] == expected
    assert [o["id"] for o in defs["cause"].options["set"]][3] == "not-found"
    assert [o["id"] for o in defs["confidence"].options["set"]][3] == "n-a"
    assert defs["deskStatus"].options["set"][4]["id"] == "waiting-response"
    assert defs["area"].options == {"isArray": False, "set": []}
    for key in ("deskOpened", "deskUpdated", "deskResolved"):
        assert defs[key].options["constraints"] == {
            "resolutionPreference": "day", "endTimeSettings": "notAllowed"}
    assert defs["project"].options["isArray"] is False
    assert defs["project"].options["allowedTypes"] == ["project"]
    assert "project" not in {p.key for p in field_defs(task=False, project_type_ids=["project"])}
    # each call gives fresh definitions
    a = field_defs(task=True, project_type_ids=[])
    a[0].name = "changed"
    assert field_defs(task=True, project_type_ids=[])[0].name == "Ticket ID"


def test_task_topup_in_memory(space: Path):
    before = _snapshot(space)
    types = _types(space)
    task = next(t for t in types if t.id == "task")
    assert not is_work_type(task)
    have = [p.key for p in task.propertyDefinitions]
    assert topup_work_fields(task, types) is task
    keys = [p.key for p in task.propertyDefinitions]
    assert keys == have + [k for k, _, _ in TICKET_TABLE + WORK_TABLE]
    assert task.prop("project").options["allowedTypes"] == ["project"]
    assert is_work_type(task)
    assert work_type_ids(types) == ["task"]
    assert project_type_ids(types) == ["project"]
    again = len(task.propertyDefinitions)
    topup_work_fields(task, types)
    assert len(task.propertyDefinitions) == again
    assert _snapshot(space) == before  # nothing written

    # no Project type: the relation allows any type
    bare = copy.deepcopy(next(t for t in _types(space) if t.id == "task"))
    no_projects = [t for t in types if t.id != "project"]
    topup_work_fields(bare, no_projects)
    assert bare.prop("project").options["allowedTypes"] == []

    # a Task that already has `area` as text keeps it
    own = copy.deepcopy(next(t for t in _types(space) if t.id == "task"))
    data = own.to_json()
    data["propertyDefinitions"].append(
        {"id": "area", "key": "area", "name": "Area", "type": "text", "options": {}})
    own = TypeDefinition.from_json(data)
    topup_work_fields(own, types)
    assert own.prop("area").type == "text"
    assert sum(p.key == "area" for p in own.propertyDefinitions) == 1
    assert is_work_type(own)
    assert _snapshot(space) == before

    # any other type comes back untouched
    page = next(t for t in types if t.id == "page")
    n = len(page.propertyDefinitions)
    topup_work_fields(page, types)
    assert len(page.propertyDefinitions) == n


def test_topup_after_task_fields(space: Path):
    types = _types(space)
    task = topup_task_type(next(t for t in types if t.id == "task"))
    topup_work_fields(task, types)
    keys = [p.key for p in task.propertyDefinitions]
    assert len(keys) == len(set(keys))
    assert task.prop("completed").type == "datetimeSimple"


def _request_type() -> TypeDefinition:
    return TypeDefinition.from_json({
        "schemaVersion": 2, "id": "request", "name": "Request", "pluralName": "Requests",
        "folder": "Requests", "basic": False,
        "propertyDefinitions": [
            {"id": "location", "key": "location", "name": "Location", "type": "text",
             "options": {}},
        ],
    })  # fmt: skip


def test_with_work_fields_on_a_custom_type(space: Path):
    types = _types(space)
    req = _request_type()
    types.append(req)
    assert not is_work_type(req)
    original = req.to_json()
    out, added, skipped = with_work_fields(req, types)
    assert req.to_json() == original  # a copy; the input is untouched
    assert not is_work_type(req) and is_work_type(out)
    expected = [k for k, _, _ in TICKET_TABLE + WORK_TABLE if k not in ("deskLocation", "project")]
    assert added == [*expected, "status", "completed"]
    assert skipped == [
        {"key": "deskLocation", "name": "Location", "reason": "A property with this name exists"}]
    keys = [p.key for p in out.propertyDefinitions]
    assert keys == ["location", *added]
    status = out.prop("status")
    assert status.type == "label" and "isStatus" not in status.options
    assert [(o["text"], o["color"]) for o in status.options["set"]] == [
        ("Not Started", "red"), ("Next Up", "yellow"), ("In Progress", "blue"),
        ("On Hold", "pink"), ("Done", "green")]
    completed = out.prop("completed")
    assert completed.type == "datetimeSimple" and completed.visibility == "hidden"
    assert completed.options["constraints"]["resolutionPreference"] == "time"
    assert out.prop("project") is None

    # a second run adds nothing; a key with another kind is skipped
    again, added2, skipped2 = with_work_fields(out, types)
    assert added2 == [] and [p.key for p in again.propertyDefinitions] == keys
    clash = TypeDefinition.from_json({
        "schemaVersion": 2, "id": "c", "name": "C", "pluralName": "Cs", "folder": "Cs",
        "propertyDefinitions": [
            {"id": "rank", "key": "rank", "name": "Position", "type": "text", "options": {}},
            {"id": "status", "key": "status", "name": "Status", "type": "label",
             "options": {"isArray": False, "set": []}},
        ],
    })  # fmt: skip
    out3, added3, skipped3 = with_work_fields(clash, types)
    assert {"key": "rank", "name": "Rank", "reason": "A property with this key exists"} in skipped3
    assert "status" not in added3 and out3.prop("status").options["set"] == []
    assert "completed" in added3


def test_project_from_basic_setup_and_gallery(space: Path):
    project = next(t for t in basic_types(work=True) if t.id == "project")
    keys = [p.key for p in project.propertyDefinitions]
    work = [k for k, _, _ in TICKET_TABLE + WORK_TABLE if k != "project"]
    assert keys[keys.index("notes") + 1:] == [*work, "completed"]
    assert project.prop("project") is None
    assert project.prop("completed").visibility == "hidden"
    assert is_work_type(project)
    data = project.to_json()
    assert TypeDefinition.from_json(json.loads(json.dumps(data))).to_json() == data

    gallery = build_template("project", [], work=True)
    gkeys = [p.key for p in gallery]
    assert gkeys[gkeys.index("notes") + 1:] == [*work, "completed"]
    assert "project" not in gkeys
    made = TypeDefinition.from_json({
        "schemaVersion": 2, "id": "proj2", "name": "Project", "pluralName": "Projects",
        "folder": "Projects", "propertyDefinitions": [p.to_json() for p in gallery],
    })  # fmt: skip
    assert is_work_type(made)

    # the fixture's pre-M22 Project type has no work fields until "Add work fields"
    old = next(t for t in _types(space) if t.id == "project")
    assert not is_work_type(old)
