"""M32 fix pass, finding 4: what counts as "this space has work data" (the Work default while
no switch is stored).

Work data is a value for a built-in ticket or work field on a note of the basic Task or of a work
type, a Capture or an Alert type, or the IT operations starter's marker. A ``ticketId`` on a note
of any other type is the user's own property; steps or a work note's fields on a task count
without a Ticket ID. The answer is a flag kept where notes are indexed, not a scan per request.
Synthetic data only.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from objectapp.basicsetup import basic_types
from objectapp.space import Space
from objectapp.spaces import create_space
from objectapp.typemodel import write_type_json
from objectapp.workfields import FIELD_KEYS, is_work_type


def _note(root: Path, folder: str, type_name: str, name: str, *lines: str) -> str:
    rel = f"{folder}/{name}.md"
    (root / folder).mkdir(exist_ok=True)
    extra = "".join(f"{line}\n" for line in lines)
    (root / rel).write_text(
        f"---\ntype: '{type_name}'\ntitle: '{name}'\n{extra}---\n", encoding="utf-8", newline="\n"
    )
    return rel


def _snapshot(root: Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in root.rglob("*")
        if p.is_file() and ".object-cache" not in p.relative_to(root).parts
    }


@pytest.fixture
def plain(tmp_path: Path) -> Path:
    return create_space("Notes", tmp_path)


def test_a_ticket_id_on_a_type_of_the_users_own_is_not_work_data(plain: Path):
    """A "Flight" type with a "Ticket ID" property used to turn Work on."""
    _note(plain, "Flights", "Flight", "To Lisbon", "ticketId: 'TP1337'", "seat: '14C'")
    _note(plain, "Pages", "Page", "Printer", "ticketId: 'INC0012345'")
    before = _snapshot(plain)
    sp = Space(plain)
    assert sp.work_on() is False
    assert {p.key for p in sp.type_by_id("task").propertyDefinitions} & FIELD_KEYS == set()
    assert sp.list_queries() == []
    assert _snapshot(plain) == before


def test_a_ticket_id_put_on_a_note_through_the_app_is_not_work_data(plain: Path):
    sp = Space(plain)
    rel, version = sp.create_object("page", "Printer")
    sp.update_properties(rel, {"ticketId": "INC0012345"}, version)
    assert sp.read(rel)[1]["ticketId"] == "INC0012345"
    assert sp.work_on() is False


@pytest.mark.parametrize(
    "lines",
    [
        ("ticketId: 'INC0012345'",),
        ("steps:", "  - 'Ask Pat'"),  # steps, no Ticket ID: used to read as off
        ("requester: 'Pat Example'",),
        ("blockedOn: 'the vendor'",),
        ("rank: 3",),
    ],
)
def test_a_value_for_a_ticket_or_work_field_on_a_task_is_work_data(plain: Path, lines):
    _note(plain, "Tasks", "Task", "Printer", *lines)
    before = _snapshot(plain)
    sp = Space(plain)
    assert sp.work_on() is True
    assert {p.key for p in sp.type_by_id("task").propertyDefinitions} >= FIELD_KEYS
    assert _snapshot(plain) == before


def test_an_empty_value_is_not_work_data(plain: Path):
    _note(plain, "Tasks", "Task", "Plain", "ticketId: ''", "steps: []", "requester:")
    assert Space(plain).work_on() is False


def test_a_value_on_a_work_types_note_is_work_data(tmp_path: Path):
    """A Project the basic set made before M32 is a work type by its file."""
    root = create_space("Old basic", tmp_path, setup="basic")
    project = next(t for t in basic_types(work=True) if t.id == "project")
    (root / ".object" / "types" / "project.json").unlink()
    write_type_json(root, project, "")
    assert Space(root).work_on() is False  # the fields alone, with no value, are not work data
    rel = _note(root, "Projects", "Project", "Garden", "requester: 'Pat Example'")
    sp = Space(root)
    assert sp.work_on() is True and is_work_type(sp.type_by_id("project"))
    # Project (the relation to a Project) is the Task's field, not a work type's own
    (root / rel).unlink()
    _note(root, "Projects", "Project", "Shed", "project: '[[Garden]]'")
    assert Space(root).work_on() is False
    _note(root, "Tasks", "Task", "Dig", "project: '[[Shed]]'")
    assert Space(root).work_on() is True


def test_the_default_follows_the_data_as_it_is_written(plain: Path):
    sp = Space(plain)
    rel, version = sp.create_object("task", "Printer")
    assert sp.work_on() is False
    sp.update_properties(rel, {"ticketId": "INC0012345"}, version)
    assert sp.work_on() is True
    version = sp.read(rel)[2]
    sp.update_properties(rel, {}, version, remove=["ticketId"])
    assert sp.work_on() is False
    # a value written outside the app, then the file renamed, retyped and deleted
    out = _note(plain, "Tasks", "Task", "Outside", "steps:", "  - 'Ask Pat'")
    sp.rescan_file(out)
    assert sp.work_on() is True
    version = sp.read(out)[2]
    new_rel = sp.rename_object(out, "Outside again", version).path
    assert new_rel != out
    assert sp.work_on() is True
    (plain / new_rel).write_text(
        (plain / new_rel).read_text("utf-8").replace("type: 'Task'", "type: 'Page'"), "utf-8"
    )
    sp.rescan_file(new_rel)
    assert sp.work_on() is False  # steps on a Page are no work data
    (plain / new_rel).write_text(
        (plain / new_rel).read_text("utf-8").replace("type: 'Page'", "type: 'Task'"), "utf-8"
    )
    sp.rescan_file(new_rel)
    assert sp.work_on() is True
    (plain / new_rel).unlink()
    sp.rescan_file(new_rel)
    assert sp.work_on() is False
    assert "workEnabled" not in json.loads((plain / ".object/space.json").read_text("utf-8"))


def test_asking_is_a_lookup_not_a_scan(plain: Path, monkeypatch: pytest.MonkeyPatch):
    for i in range(40):
        _note(plain, "Flights", "Flight", f"Flight {i}", f"ticketId: 'TP{i}'")
    sp = Space(plain)
    assert sp.work_on() is False
    calls: list[int] = []
    real = Space._find_work_data
    monkeypatch.setattr(Space, "_find_work_data", lambda self: calls.append(1) or real(self))
    for _ in range(500):
        assert sp.work_on() is False
    assert calls == []
    # an edit that changes no ticket or work value does not ask for the answer again
    rel, version = sp.create_object("page", "A note")
    calls.clear()
    sp.update_properties(rel, {"description": "plain"}, version)
    sp.save_body(rel, "Some text.\n", sp.read(rel)[2])
    assert sp.work_on() is False and calls == []
    # one that does, asks once
    sp.update_properties(rel, {"ticketId": "X-1"}, sp.read(rel)[2])
    for _ in range(50):
        assert sp.work_on() is False
    assert len(calls) == 1
