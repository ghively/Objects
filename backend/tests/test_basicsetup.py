"""M8 Task 8: "Start with basic setup" writes the Person, Meeting, Project and Book types."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.basicsetup import basic_types
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space
from objectapp.typemodel import TypeDefinition
from objectapp.workfields import FIELD_KEYS


@pytest.fixture
def state(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(path))
    return path


def _files(root: Path) -> list[str]:
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())


def test_basic_setup_writes_four_types(tmp_path: Path, state: Path):
    parent = tmp_path / "parent"
    parent.mkdir()
    made = create_space("Basic", parent, setup="basic")
    # M32: beside the four types every new space starts with (Page, Tag, Task, DailyNote).
    assert _files(made) == [
        ".object/space.json",
        ".object/types/book.json",
        ".object/types/dailynote.json",
        ".object/types/meeting.json",
        ".object/types/page.json",
        ".object/types/person.json",
        ".object/types/project.json",
        ".object/types/tag.json",
        ".object/types/task.json",
    ]
    loaded = {}
    for tid in ("person", "meeting", "project", "book"):
        data = json.loads((made / ".object" / "types" / f"{tid}.json").read_text("utf-8"))
        t = TypeDefinition.from_json(data)
        assert t.to_json() == data  # round-trips through the type model unchanged
        loaded[tid] = t
    assert [(t.name, t.pluralName, t.folder) for t in loaded.values()] == [
        ("Person", "People", "People"),
        ("Meeting", "Meetings", "Meetings"),
        ("Project", "Projects", "Projects"),
        ("Book", "Books", "Books"),
    ]
    assert loaded["person"].description == "A page for each person you know or work with."
    custom = {
        tid: [(p.name, p.type) for p in t.propertyDefinitions
              if not p.type.startswith("entity_")]
        for tid, t in loaded.items()
    }
    assert custom["person"] == [
        ("Picture", "coverImage"), ("Category", "label"), ("Organizations", "entity"),
        ("Projects", "entity"), ("Meetings", "entity"), ("Notes", "blocks"),
    ]
    assert custom["meeting"] == [
        ("Date", "datetime"), ("Type", "label"), ("Attendees", "entity"), ("Project", "entity"),
        ("Reviewed", "boolean"), ("Cover image", "coverImage"), ("Notes", "blocks"),
    ]
    # M32: a new space has Work off, so its Project ends with Notes (no ticket field).
    assert custom["project"] == [
        ("Status", "label"), ("Type", "label"), ("Timeframe", "datetime"),
        ("Collaborators", "entity"), ("Organizations", "entity"), ("Meetings", "entity"),
        ("Cover image", "coverImage"), ("Notes", "blocks"),
    ]
    with_work = next(t for t in basic_types(work=True) if t.id == "project")
    assert [(p.name, p.type) for p in with_work.propertyDefinitions
            if not p.type.startswith("entity_")] == [
        *custom["project"],
        # M22: the ticket and work fields (no Project relation), then the hidden Completed;
        # M32: only while Work is on for the space.
        ("Ticket ID", "text"), ("System", "label"), ("Ticket link", "url"),
        ("Desk status", "label"), ("Desk priority", "label"), ("Requester", "text"),
        ("Group", "text"), ("Location", "text"), ("Opened", "datetime"),
        ("Desk updated", "datetime"), ("Resolved", "datetime"),
        ("Rank", "number"), ("Area", "label"), ("Cause", "label"), ("Priority note", "text"),
        ("Blocked on", "text"), ("Findings", "textBlock"), ("Hypothesis", "textBlock"),
        ("Confidence", "label"), ("Confidence reason", "text"), ("Verified", "textList"),
        ("Assumed", "textList"), ("To raise confidence", "textList"),
        ("Floor items", "floorItems"), ("Steps", "steps"), ("Completed", "datetimeSimple"),
    ]
    assert custom["book"] == [
        ("Authors", "entity"), ("Genre", "label"), ("Type", "label"), ("Rating", "number"),
        ("Reading timeline", "datetime"), ("Cover image", "coverImage"), ("Notes", "blocks"),
    ]
    person = loaded["person"]
    assert person.prop("category").options["isArray"] is True
    assert person.prop("projects").options["allowedTypes"] == ["project"]
    assert person.prop("organizations").options["allowedTypes"] == []
    status = loaded["project"].prop("status").options
    # Only the basic Task status sets isStatus; Project's is a plain label.
    assert "isStatus" not in status
    assert [o["text"] for o in status["set"]] == ["Planned", "In Progress", "On Hold", "Completed"]
    assert all("statusCategory" not in o for o in status["set"])
    rating = loaded["book"].prop("rating").options["numberFormat"]
    assert rating["type"] == "progress" and rating["options"]["progress"]["steps"] == 5
    assert loaded["project"].prop("timeframe").options["constraints"]["endTimePreference"] is True


def test_basic_setup_via_route_and_space_opens(tmp_path: Path, state: Path):
    current = tmp_path / "current"
    (current / ".object").mkdir(parents=True)
    parent = tmp_path / "parent"
    parent.mkdir()
    with TestClient(create_app(Space(current), watch=False)) as client:
        r = client.post(
            "/api/spaces", json={"name": "Started", "location": str(parent), "setup": "basic"}
        )
        assert r.status_code == 201, r.text
    made = Path(r.json()["path"])
    # M32: the four basic-setup types beside Page, Tag, Task and DailyNote.
    assert len(list((made / ".object" / "types").glob("*.json"))) == 8
    names = {t.name for t in Space(made).types}
    assert {"Person", "Meeting", "Project", "Book"} <= names


STARTING = [
    ".object/space.json",
    ".object/types/dailynote.json",
    ".object/types/page.json",
    ".object/types/tag.json",
    ".object/types/task.json",
]


def test_blank_setup_writes_the_starting_types(tmp_path: Path, state: Path):
    """M32: a plain new space holds its config and the four types every space starts with."""
    parent = tmp_path / "parent"
    parent.mkdir()
    made = create_space("Blank", parent)
    assert _files(made) == STARTING
    made2 = create_space("Blank two", parent, setup="blank")
    assert _files(made2) == STARTING


def test_basic_types_have_fresh_property_ids():
    # M22: the work fields keep `id == key` (as the Task fields), so they are left out here.
    a, b = basic_types(), basic_types()

    def ids(types):
        return {p.id for t in types for p in t.propertyDefinitions
                if p.type in ("label", "entity") and p.key not in FIELD_KEYS}

    ids_a, ids_b = ids(a), ids(b)
    assert ids_a and not ids_a & ids_b
