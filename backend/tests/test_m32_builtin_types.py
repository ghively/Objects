"""M32 item 8: every space can make notes, daily notes and tasks.

A new space is made with the Page (shown as "Note"), Tag, Task and DailyNote types on disk. A
space without a Task or DailyNote type has the built-in one **in memory** from load (the types
API lists it, so the app can always offer "New task"), and its file is written only with the
first task or daily note. Opening a space never writes for this.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space
from objectapp.typemodel import is_task_type, on_demand_types

STATUSES = ["Not Started", "Next Up", "In Progress", "On Hold", "Done"]


def _snapshot(root: Path) -> dict[str, bytes]:
    """Every file of the space but the rebuildable cache."""
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in root.rglob("*")
        if p.is_file() and ".object-cache" not in p.relative_to(root).parts
    }


def _type_file(root: Path, type_id: str) -> Path:
    return root / ".object" / "types" / f"{type_id}.json"


def _older_space(tmp_path: Path) -> Path:
    """A space from before M32: one page, the types its first open wrote (Page, Tag)."""
    root = tmp_path / "older"
    (root / "Pages").mkdir(parents=True)
    (root / "Pages" / "Hello.md").write_text(
        "---\nid: 01JC0000000000000000000001\ntype: 'Page'\ntitle: 'Hello'\n---\n# Hello\n",
        encoding="utf-8",
        newline="\n",
    )
    Space(root)
    assert sorted(p.stem for p in (root / ".object" / "types").glob("*.json")) == ["page", "tag"]
    return root


# -- (a) a new space ---------------------------------------------------------------------


def test_a_new_space_is_made_with_the_four_types(tmp_path: Path):
    root = create_space("Notes", tmp_path)
    files = sorted(p.stem for p in (root / ".object" / "types").glob("*.json"))
    assert files == ["dailynote", "page", "tag", "task"]
    task = json.loads(_type_file(root, "task").read_text("utf-8"))
    assert task["name"] == "Task" and task["folder"] == "Tasks" and task["basic"] is True
    status = next(p for p in task["propertyDefinitions"] if p["key"] == "status")
    assert status["options"]["isStatus"] is True
    assert [o["text"] for o in status["options"]["set"]] == STATUSES
    assert [o["statusCategory"] for o in status["options"]["set"]][-1] == "done"
    # No ticket or work field: Work is off in a new space.
    assert not {"ticketId", "steps"} & {p["key"] for p in task["propertyDefinitions"]}
    daily = json.loads(_type_file(root, "dailynote").read_text("utf-8"))
    assert daily["name"] == "DailyNote" and daily["folder"] == "DailyNotes"
    # Opening the new space writes nothing more.
    before = _snapshot(root)
    sp = Space(root)
    assert {t.id for t in sp.types} == {"dailynote", "page", "tag", "task"}
    assert _snapshot(root) == before


def test_the_starters_still_make_their_types_beside_the_four(tmp_path: Path):
    basic = create_space("Basic", tmp_path, setup="basic")
    ids = {p.stem for p in (basic / ".object" / "types").glob("*.json")}
    assert {"page", "tag", "task", "dailynote", "person", "meeting", "project", "book"} == ids
    itops = create_space("IT", tmp_path, setup="itops")
    ids = {p.stem for p in (itops / ".object" / "types").glob("*.json")}
    assert {"page", "tag", "task", "dailynote", "host", "incident"} <= ids


def test_blank_setup_of_an_empty_folder_writes_the_built_in_types(tmp_path: Path):
    """The plain start an empty folder gets (the app no longer asks): the pick is the user's
    action, so the Task and DailyNote types are written with it."""
    root = tmp_path / "fresh"
    root.mkdir()
    with TestClient(create_app(Space(root), None, watch=False)) as c:
        info = c.get("/api/space").json()
        assert {"task", "dailynote"} <= {t["id"] for t in info["types"]}
        assert not _type_file(root, "task").exists()  # in memory only until the pick
        res = c.post("/api/space/setup", json={"setup": "blank"})
        assert res.status_code == 200, res.text
        assert _type_file(root, "task").is_file() and _type_file(root, "dailynote").is_file()
        assert not _type_file(root, "person").exists()


# -- (b) an existing space without a Task or DailyNote type -------------------------------


def test_an_older_space_lists_the_built_in_types_without_writing(tmp_path: Path):
    root = _older_space(tmp_path)
    before = _snapshot(root)
    sp = Space(root)
    with TestClient(create_app(sp, None, watch=False)) as c:
        info = c.get("/api/space").json()
        by_id = {t["id"]: t for t in info["types"]}
        assert {"page", "tag", "task", "dailynote"} == set(by_id)
        task = by_id["task"]
        assert task["basic"] is True and task["revision"] == ""  # no file yet
        status = next(p for p in task["propertyDefinitions"] if p["key"] == "status")
        assert [o["text"] for o in status["options"]["set"]] == STATUSES
        assert c.get("/api/objects").status_code == 200
        assert c.get("/api/object", params={"path": "Pages/Hello.md"}).status_code == 200
        assert c.get("/api/calendar", params={"from": "2026-11-01", "to": "2026-11-30"}).status_code == 200
        assert c.get("/api/queries").status_code == 200
        assert _snapshot(root) == before  # opening, listing and reading wrote nothing

        res = c.post("/api/objects", json={"typeId": "task", "title": "Buy milk"})
        assert res.status_code == 201, res.text
        assert res.json()["path"] == "Tasks/Buy milk.md" and res.json()["typeIds"] == ["task"]
        after = _snapshot(root)
        assert set(after) - set(before) == {".object/types/task.json", "Tasks/Buy milk.md"}
        assert {k: after[k] for k in before} == before  # nothing else changed
        assert not _type_file(root, "dailynote").exists()

        # "Complete this task" works on the built-in statuses.
        done = c.put("/api/object/properties", json={
            "path": "Tasks/Buy milk.md", "updates": {"status": ["Done"]},
            "baseVersion": res.json()["version"],
        })
        assert done.status_code == 200, done.text
        text = (root / "Tasks" / "Buy milk.md").read_text("utf-8")
        assert "status: 'Done'" in text or "status: Done" in text
        assert "completed:" in text

        note = c.post("/api/daily-notes", json={"date": "2026-11-11"})
        assert note.status_code == 201, note.text
        assert note.json()["typeIds"] == ["dailynote"]
        assert _type_file(root, "dailynote").is_file()
        assert (root / "DailyNotes" / "2026-11-11.md").is_file()
    # The next open reads the written types; still one Task and one DailyNote.
    again = Space(root)
    assert sorted(t.id for t in again.types) == ["dailynote", "page", "tag", "task"]
    assert is_task_type(again.type_by_id("task"))


def test_a_type_the_user_named_task_stays_the_only_one(tmp_path: Path):
    root = _older_space(tmp_path)
    own = {
        "schemaVersion": 2, "id": "todo", "name": "Task", "pluralName": "To-dos",
        "folder": "To-dos", "basic": False, "propertyDefinitions": [],
    }
    _type_file(root, "todo").write_text(json.dumps(own), "utf-8")
    before = _snapshot(root)
    sp = Space(root)
    named = [t for t in sp.types if t.name.lower() == "task"]
    assert [t.id for t in named] == ["todo"] and sp.type_by_id("task") is None
    assert named[0].basic is False and named[0].prop("status") is None  # as before M32
    assert _snapshot(root) == before


def test_a_renamed_task_type_keeps_its_place(tmp_path: Path):
    """A space whose built-in Task was renamed (its id stays ``task``; notes typed with the
    former name still read as it) gets no second Task."""
    root = create_space("Notes", tmp_path)
    data = json.loads(_type_file(root, "task").read_text("utf-8"))
    data["name"], data["formerNames"] = "To-do", ["Task"]
    _type_file(root, "task").write_text(json.dumps(data), "utf-8")
    sp = Space(root)
    assert [t.id for t in sp.types if "task" in (t.id, t.name.lower())] == ["task"]
    assert sp.type_by_id("task").name == "To-do"


def test_on_demand_types_leaves_out_what_the_space_has():
    assert [t.id for t in on_demand_types([], [])] == ["task", "dailynote"]
    assert [t.id for t in on_demand_types(["task"], [])] == ["dailynote"]
    assert [t.id for t in on_demand_types([], ["TASK", "dailynote"])] == []
    task = on_demand_types([], [])[0]
    assert is_task_type(task) and task.prop("completed") is not None


# -- the starters stay available after the start -------------------------------------------


def test_a_starter_can_be_added_to_a_space_that_already_started(tmp_path: Path):
    root = create_space("Notes", tmp_path)
    with TestClient(create_app(Space(root), None, watch=False)) as c:
        assert c.get("/api/space").json()["needsSetup"] is False
        # The plain start is not offered twice.
        assert c.post("/api/space/setup", json={"setup": "blank"}).status_code == 409
        res = c.post("/api/space/setup", json={"setup": "basic"})
        assert res.status_code == 200, res.text
        assert {"person", "meeting", "project", "book"} <= {t["id"] for t in res.json()["types"]}
        person = _type_file(root, "person").read_bytes()
        # Again: nothing is replaced.
        assert c.post("/api/space/setup", json={"setup": "basic"}).status_code == 200
        assert _type_file(root, "person").read_bytes() == person


def test_a_starter_never_adds_a_second_type_of_a_name(tmp_path: Path):
    root = create_space("Notes", tmp_path)
    sp = Space(root)
    own = sp.create_type("Book", "Novels")
    assert own.id == "book"
    mine = sp.create_type("Human", "Humans")
    data = json.loads(_type_file(root, mine.id).read_text("utf-8"))
    data["name"] = "Person"
    _type_file(root, mine.id).write_text(json.dumps(data), "utf-8")
    sp = Space(root)
    sp.apply_setup("basic")
    assert [t.id for t in sp.types if t.name == "Person"] == [mine.id]
    assert not _type_file(root, "person").exists()
    assert sp.type_by_id("book").pluralName == "Novels"
    assert _type_file(root, "meeting").is_file()
