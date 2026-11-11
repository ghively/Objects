"""M32 fix pass, findings 2 and 3: ticket and work fields do not stay on Task or Project once
Work is off.

One rule for the basic Task and every work type: with Work off a built-in ticket or work field
is listed only when some note of the type holds a value for it, or its stored definition differs
from the built-in one (the user changed it). The type file is never rewritten because of this,
and a save made with Work off keeps the definitions that are in the file but not listed. A type
written for its first use stores none of the fields a load tops up. Synthetic data only.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.basicsetup import basic_types
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space
from objectapp.typemodel import TypeDefinition, write_type_json
from objectapp.workfields import FIELD_KEYS, is_work_type, with_work_fields

FIXTURES = Path(__file__).parent / "fixtures"
PROJECT_KEYS = FIELD_KEYS - {"project"}


def _types_snapshot(root: Path) -> dict[str, tuple[bytes, int, int]]:
    out = {}
    for p in sorted((root / ".object" / "types").iterdir()):
        st = p.stat()
        out[p.name] = (p.read_bytes(), st.st_mtime_ns, st.st_ino)
    return out


def _stored(root: Path, type_id: str) -> list[str]:
    data = json.loads((root / ".object" / "types" / f"{type_id}.json").read_text("utf-8"))
    return [p["key"] for p in data["propertyDefinitions"]]


def _set_config(root: Path, **keys) -> None:
    path = root / ".object" / "space.json"
    data = json.loads(path.read_text("utf-8")) if path.exists() else {}
    path.write_text(json.dumps({**data, **keys}), "utf-8")


def _note(root: Path, folder: str, type_name: str, name: str, *lines: str) -> str:
    rel = f"{folder}/{name}.md"
    (root / folder).mkdir(exist_ok=True)
    extra = "".join(f"{line}\n" for line in lines)
    (root / rel).write_text(
        f"---\ntype: '{type_name}'\ntitle: '{name}'\n{extra}---\n", encoding="utf-8", newline="\n"
    )
    return rel


class App:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.space = Space(root)
        self._ctx = TestClient(
            create_app(self.space, None, watch=False), base_url="http://127.0.0.1",
            client=("127.0.0.1", 50000),
        )
        self.c = self._ctx.__enter__()

    def close(self) -> None:
        self._ctx.__exit__(None, None, None)

    def info(self) -> dict:
        return self.c.get("/api/space").json()

    def type(self, type_id: str) -> dict:
        return next(t for t in self.info()["types"] if t["id"] == type_id)

    def keys(self, type_id: str) -> set[str]:
        return {p["key"] for p in self.type(type_id)["propertyDefinitions"]} & FIELD_KEYS

    def switch(self, on: bool) -> None:
        r = self.c.put(
            "/api/space", json={"patch": {"workEnabled": on}, "baseRevision": self.info()["revision"]}
        )
        assert r.status_code == 200 and r.json()["workOn"] is on, r.text

    def save(self, t: dict, **extra):
        t = dict(t)
        rev = t.pop("revision")
        return self.c.put(f"/api/types/{t['id']}", json={"type": t, "baseRevision": rev, **extra})

    def set(self, path: str, updates: dict, remove: tuple[str, ...] = ()):
        o = self.c.get("/api/object", params={"path": path}).json()
        r = self.c.put(
            "/api/object/properties",
            json={"path": path, "updates": updates, "remove": list(remove), "baseVersion": o["version"]},
        )
        assert r.status_code == 200, r.text
        return r


@pytest.fixture
def apps():
    made: list[App] = []

    def make(root: Path) -> App:
        made.append(App(root))
        return made[-1]

    yield make
    for a in made:
        a.close()


@pytest.fixture
def plain(tmp_path: Path) -> Path:
    return create_space("Notes", tmp_path)


def old_basic_space(parent: Path) -> Path:
    """A space as "Create space" with the basic set made it before M32: its Project type file
    holds the 25 ticket and work fields and ``completed`` (`basic_types(work=True)` is that
    shape), ``space.json`` has the ``basic`` marker and no Work switch."""
    root = create_space("Old basic", parent, setup="basic")
    project = next(t for t in basic_types(work=True) if t.id == "project")
    (root / ".object" / "types" / "project.json").unlink()
    write_type_json(root, project, "")
    assert set(_stored(root, "project")) >= PROJECT_KEYS
    return root


# -- the reviewer's case A: a Task type saved while Work was on -----------------------------------


def test_a_task_type_saved_with_work_on_lists_no_empty_field_once_work_is_off(plain: Path, apps):
    a = apps(plain)
    a.switch(True)
    assert a.keys("task") == FIELD_KEYS
    t = a.type("task")
    t["color"] = "red"
    assert a.save(t).status_code == 200
    assert set(_stored(plain, "task")) >= FIELD_KEYS  # as before M32 a save with Work on stores them
    before = _types_snapshot(plain)
    a.switch(False)
    assert a.keys("task") == set()
    assert _types_snapshot(plain) == before  # listing them no more rewrote nothing
    # a new open reads the same
    b = apps(plain)
    assert b.keys("task") == set() and b.info()["workOn"] is False
    assert _types_snapshot(plain) == before
    a.switch(True)
    assert a.keys("task") == FIELD_KEYS
    assert _types_snapshot(plain) == before


def test_the_fields_are_no_longer_stuck_and_a_save_with_work_off_is_not_refused(plain: Path, apps):
    """The reviewer's `t24_stuck`: a status option added while Work is on stored every field;
    with Work off they were still listed and could not be taken off (422)."""
    a = apps(plain)
    a.switch(True)
    t = a.type("task")
    status = next(p for p in t["propertyDefinitions"] if p["key"] == "status")
    status["options"]["set"].append(
        {"id": "zz9", "text": "Waiting", "color": "gray", "statusCategory": "blocked"}
    )
    assert a.save(t).status_code == 200
    stored = _stored(plain, "task")
    a.switch(False)
    t = a.type("task")
    assert a.keys("task") == set()
    t["propertyDefinitions"] = [p for p in t["propertyDefinitions"] if p["key"] not in FIELD_KEYS]
    t["description"] = "Things to do"
    r = a.save(t, confirm=True)
    assert r.status_code == 200, r.text
    assert {p["key"] for p in r.json()["type"]["propertyDefinitions"]} & FIELD_KEYS == set()
    # the save kept the definitions the file held, in their order
    assert _stored(plain, "task") == stored
    assert json.loads((plain / ".object/types/task.json").read_text("utf-8"))["description"] == "Things to do"
    assert apps(plain).keys("task") == set()
    a.switch(True)
    assert a.keys("task") == FIELD_KEYS
    assert [p["key"] for p in a.type("task")["propertyDefinitions"]] == stored


def test_a_window_that_still_holds_every_field_saves_with_work_off(plain: Path, apps):
    a = apps(plain)
    a.switch(True)
    t = a.type("task")
    t["color"] = "red"
    assert a.save(t).status_code == 200
    held = a.type("task")  # every field, as the window listed it while Work was on
    stored = _stored(plain, "task")
    a.switch(False)
    held["description"] = "Saved late"
    r = a.save(held)
    assert r.status_code == 200, r.text
    assert _stored(plain, "task") == stored
    assert a.keys("task") == set()


# -- the reviewer's case C: the first task of an older space while Work is on ---------------------


def test_the_first_task_of_an_older_space_stores_no_ticket_field(tmp_path: Path, apps):
    root = tmp_path / "older"
    shutil.copytree(FIXTURES / "space-blocks", root)
    a = apps(root)
    a.switch(True)
    assert a.keys("task") == FIELD_KEYS
    assert not (root / ".object/types/task.json").exists()
    r = a.c.post("/api/objects", json={"typeId": "task", "title": "first"})
    assert r.status_code == 201, r.text
    assert set(_stored(root, "task")) & FIELD_KEYS == set()
    assert a.keys("task") == FIELD_KEYS  # in memory they are there while Work is on
    assert apps(root).keys("task") == FIELD_KEYS  # and a new open tops them up again
    a.switch(False)
    assert a.keys("task") == set()


# -- a space made with the basic set before M32 --------------------------------------------------


def test_a_pre_m32_basic_space_lists_no_ticket_field_on_project(tmp_path: Path, apps):
    root = old_basic_space(tmp_path)
    _note(root, "Projects", "Project", "Garden", "status: Planned")
    before = _types_snapshot(root)
    a = apps(root)
    info = a.info()
    assert info["workOn"] is False and info["workEnabled"] is None
    assert a.keys("project") == set() and a.keys("task") == set()
    project = a.type("project")
    assert {"status", "completed"} <= {p["key"] for p in project["propertyDefinitions"]}
    assert _types_snapshot(root) == before  # never write on read
    # on, off, on: the type files are byte for byte (and file for file) the same
    a.switch(True)
    assert a.keys("project") == PROJECT_KEYS and is_work_type(a.space.type_by_id("project"))
    assert [p["key"] for p in a.type("project")["propertyDefinitions"]] == _stored(root, "project")
    a.switch(False)
    assert a.keys("project") == set()
    a.switch(True)
    assert a.keys("project") == PROJECT_KEYS
    assert _types_snapshot(root) == before


def test_a_save_with_work_off_keeps_what_the_project_file_holds(tmp_path: Path, apps):
    root = old_basic_space(tmp_path)
    stored = _stored(root, "project")
    a = apps(root)
    t = a.type("project")
    assert not {p["key"] for p in t["propertyDefinitions"]} & FIELD_KEYS
    t["description"] = "Things with an end"
    t["propertyDefinitions"].append(
        {"id": "budget1", "key": "budget", "name": "Budget", "type": "number", "description": "",
         "icon": {"type": "iconify", "val": "ph-hash"}, "visibility": "alwaysShow", "options": {}}
    )
    r = a.save(t)
    assert r.status_code == 200, r.text
    answered = [p["key"] for p in r.json()["type"]["propertyDefinitions"]]
    assert "budget" in answered and not set(answered) & FIELD_KEYS
    # the file: every definition it held, in its order, and the new property
    now = _stored(root, "project")
    assert [k for k in now if k != "budget"] == stored and "budget" in now
    # removing a property the user sees still asks, and removes only that one
    t = a.type("project")
    t["propertyDefinitions"] = [p for p in t["propertyDefinitions"] if p["key"] != "budget"]
    assert a.save(t).status_code == 428
    assert a.save(t, confirm=True).status_code == 200
    assert _stored(root, "project") == stored


def test_a_changed_definition_stays_listed(tmp_path: Path, apps):
    root = old_basic_space(tmp_path)
    path = root / ".object" / "types" / "project.json"
    data = json.loads(path.read_text("utf-8"))
    for p in data["propertyDefinitions"]:
        if p["key"] == "requester":
            p["name"] = "Asked by"
        if p["key"] == "area":
            p["options"]["set"].append({"id": "garden", "text": "Garden", "color": "green", "icon": None})
    path.write_text(json.dumps(data, indent=2) + "\n", "utf-8")
    a = apps(root)
    assert a.info()["workOn"] is False
    assert a.keys("project") == {"requester", "area"}
    by_key = {p["key"]: p for p in a.type("project")["propertyDefinitions"]}
    assert by_key["requester"]["name"] == "Asked by"
    # listed where the file has them
    listed = [p["key"] for p in a.type("project")["propertyDefinitions"]]
    stored = _stored(root, "project")
    assert listed == [k for k in stored if k in listed]


def test_a_field_with_a_value_stays_listed_and_follows_its_value(tmp_path: Path, apps):
    root = old_basic_space(tmp_path)
    _set_config(root, workEnabled=False)
    rel = _note(root, "Projects", "Project", "Garden", "requester: 'Pat Example'", "rank: ''")
    before = _types_snapshot(root)
    a = apps(root)
    assert a.keys("project") == {"requester"}  # an empty text is no value
    # a value written later (a key the type does not list is written as it is)
    a.set(rel, {"ticketId": "INC0012345"})
    assert a.keys("project") == {"requester", "ticketId"}
    listed = [p["key"] for p in a.type("project")["propertyDefinitions"]]
    assert listed == [k for k in _stored(root, "project") if k in listed]  # the file's order
    assert a.type("project")["propertyDefinitions"][listed.index("ticketId")]["name"] == "Ticket ID"
    # its last value gone, the field is no longer listed; the value that stays keeps its field
    a.set(rel, {}, remove=("ticketId",))
    assert a.keys("project") == {"requester"}
    fm = a.c.get("/api/object", params={"path": rel}).json()["frontmatter"]
    assert fm["requester"] == "Pat Example"
    assert _types_snapshot(root) == before


def test_a_task_field_follows_its_value_with_work_off(plain: Path, apps):
    _set_config(plain, workEnabled=False)
    a = apps(plain)
    before = _types_snapshot(plain)
    rel = a.c.post("/api/objects", json={"typeId": "task", "title": "Call the bank"}).json()["path"]
    assert a.keys("task") == set()
    a.set(rel, {"requester": "Pat"})
    assert a.keys("task") == {"requester"}
    a.set(rel, {}, remove=("requester",))
    assert a.keys("task") == set()
    assert _types_snapshot(plain) == before


def test_add_work_fields_with_work_off_stores_them_and_lists_none(plain: Path):
    _set_config(plain, workEnabled=False)
    sp = Space(plain)
    t = sp.create_type("Request", "Requests")
    new, added, _skipped = with_work_fields(t, sp.types)
    assert set(added) >= PROJECT_KEYS
    result = sp.save_type(new, sp.refresh_type(t.id)[1])
    assert {p.key for p in result.type.propertyDefinitions} & FIELD_KEYS == set()
    assert set(_stored(plain, t.id)) >= PROJECT_KEYS
    assert sp._is_work_kind(sp.type_by_id(t.id)) and not is_work_type(sp.type_by_id(t.id))
    # a later write of the type (a template made for it) keeps them in the file
    stored = _stored(plain, t.id)
    again = TypeDefinition.from_json(sp.type_by_id(t.id).to_json())
    again.description = "Asked of IT"
    sp.save_type(again, sp.refresh_type(t.id)[1])
    assert _stored(plain, t.id) == stored
    _set_config(plain, workEnabled=True)
    assert sp.work_on() is True and is_work_type(sp.type_by_id(t.id))
    assert [p.key for p in sp.type_by_id(t.id).propertyDefinitions] == stored


def test_a_restored_work_type_is_listed_by_the_same_rule(plain: Path):
    _set_config(plain, workEnabled=False)
    sp = Space(plain)
    t = sp.create_type("Request", "Requests")
    new, _added, _skipped = with_work_fields(t, sp.types)
    sp.save_type(new, sp.refresh_type(t.id)[1])
    stored = _stored(plain, t.id)
    item = sp.delete_type(t.id, confirm=True)
    sp.restore(item.id)
    assert {p.key for p in sp.type_by_id(t.id).propertyDefinitions} & FIELD_KEYS == set()
    assert _stored(plain, t.id) == stored


def test_opening_changes_no_type_file_date(tmp_path: Path, apps):
    root = old_basic_space(tmp_path)
    os.utime(root / ".object/types/project.json", ns=(1_700_000_000_000_000_000,) * 2)
    before = _types_snapshot(root)
    a = apps(root)
    a.info()
    a.c.get("/api/type-gallery")
    assert _types_snapshot(root) == before
