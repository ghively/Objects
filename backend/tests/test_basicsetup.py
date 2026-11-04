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
    assert _files(made) == [
        ".object/space.json",
        ".object/types/book.json",
        ".object/types/meeting.json",
        ".object/types/person.json",
        ".object/types/project.json",
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
    assert loaded["person"].description == "Keep notes on people you meet, work with, or follow."
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
    assert custom["project"] == [
        ("Status", "label"), ("Type", "label"), ("Timeframe", "datetime"),
        ("Collaborators", "entity"), ("Organizations", "entity"), ("Meetings", "entity"),
        ("Cover image", "coverImage"), ("Notes", "blocks"),
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
    assert len(list((made / ".object" / "types").glob("*.json"))) == 4
    names = {t.name for t in Space(made).types}
    assert {"Person", "Meeting", "Project", "Book"} <= names


def test_blank_setup_unchanged(tmp_path: Path, state: Path):
    """Regression guard (green from the start)."""
    parent = tmp_path / "parent"
    parent.mkdir()
    made = create_space("Blank", parent)
    assert _files(made) == [".object/space.json"]
    made2 = create_space("Blank two", parent, setup="blank")
    assert _files(made2) == [".object/space.json"]


def test_basic_types_have_fresh_property_ids():
    a, b = basic_types(), basic_types()
    ids_a = {p.id for t in a for p in t.propertyDefinitions if p.type in ("label", "entity")}
    ids_b = {p.id for t in b for p in t.propertyDefinitions if p.type in ("label", "entity")}
    assert ids_a and not ids_a & ids_b
