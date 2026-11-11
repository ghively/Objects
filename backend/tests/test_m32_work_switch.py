"""M32 item 10 (back end): the Work switch.

``space.json``'s ``workEnabled`` (true / false) wins. Absent, Work reads as **on** when the space
already holds work data (a Capture or an Alert type, a value for a ticket or work field on a
Task or a work type's note, or the IT operations starter) and **off** otherwise; reading it
never writes.

With Work off the built-in Task is not topped up with the ticket and work fields in memory, and
(the fix pass, `test_m32_fix_fields.py`) a ticket or work field is listed on the Task or a work
type only when some note of the type holds a value for it or its stored definition was changed
(Steps and Project follow the same rule); the Tickets saved search is not listed; the work hook
of a property write and the Work loop's notice do not run. With Work on everything is as before
M32.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import server, spaceconfig
from objectapp.alerttype import ensure_alert_type
from objectapp.basicsetup import basic_types
from objectapp.captures import ensure_capture_type
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space
from objectapp.typemodel import PROPERTY_ICONS
from objectapp.typetemplates import build_template, template_catalog
from objectapp.watcher import ChangeEvent
from objectapp.workfields import (
    FIELD_KEYS,
    TICKET_KEYS,
    field_defs,
    is_work_type,
    with_work_fields,
)
from objectapp.workview import TICKETS_ID

FIXTURES = Path(__file__).parent / "fixtures"
TASK_KEYS = {"status", "priority", "date", "deadline", "completed", "repeat", "remind", "occurrenceLog"}


def _snapshot(root: Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in root.rglob("*")
        if p.is_file() and ".object-cache" not in p.relative_to(root).parts
    }


def _task(root: Path, name: str, *lines: str) -> str:
    rel = f"Tasks/{name}.md"
    (root / "Tasks").mkdir(exist_ok=True)
    extra = "".join(f"{line}\n" for line in lines)
    (root / rel).write_text(
        f"---\ntype: 'Task'\ntitle: '{name}'\n{extra}---\n# {name}\n", encoding="utf-8", newline="\n"
    )
    return rel


def _work_keys(space: Space, type_id: str = "task") -> set[str]:
    return {p.key for p in space.type_by_id(type_id).propertyDefinitions} & FIELD_KEYS


def _config(root: Path) -> dict:
    return json.loads((root / ".object" / "space.json").read_text("utf-8"))


def _set_config(root: Path, **keys) -> None:
    path = root / ".object" / "space.json"
    data = json.loads(path.read_text("utf-8")) if path.exists() else {}
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps({**data, **keys}), "utf-8")


@pytest.fixture
def plain(tmp_path: Path) -> Path:
    """A new space: notes, daily notes and tasks; no work data."""
    return create_space("Notes", tmp_path)


# -- the default ---------------------------------------------------------------------------


def test_work_on_is_the_stored_value_else_the_default():
    assert spaceconfig.work_on({}) is False
    assert spaceconfig.work_on({}, has_work_data=True) is True
    assert spaceconfig.work_on({"setup": "itops"}) is True  # the IT operations starter
    assert spaceconfig.work_on({"setup": "basic"}) is False
    assert spaceconfig.work_on({"workEnabled": False, "setup": "itops"}, has_work_data=True) is False
    assert spaceconfig.work_on({"workEnabled": True}) is True
    assert spaceconfig.work_on({"workEnabled": "yes"}) is False  # not a switch value: the default


def test_a_new_space_has_work_off_and_reading_writes_nothing(plain: Path):
    before = _snapshot(plain)
    sp = Space(plain)
    assert sp.work_on() is False
    with TestClient(create_app(sp, None, watch=False)) as c:
        info = c.get("/api/space").json()
        assert info["workEnabled"] is None and info["workOn"] is False
        task = next(t for t in info["types"] if t["id"] == "task")
        keys = {p["key"] for p in task["propertyDefinitions"]}
        assert TASK_KEYS <= keys and not keys & FIELD_KEYS
        assert [q["id"] for q in c.get("/api/queries").json()] == []
    assert _snapshot(plain) == before


def test_a_ticket_id_on_a_task_turns_the_default_on(plain: Path):
    _task(plain, "Printer", "ticketId: 'INC0012345'")
    before = _snapshot(plain)
    sp = Space(plain)
    assert sp.work_on() is True
    assert _work_keys(sp) == FIELD_KEYS and is_work_type(sp.type_by_id("task"))
    assert [q.id for q in sp.list_queries()] == [TICKETS_ID]
    with TestClient(create_app(sp, None, watch=False)) as c:
        info = c.get("/api/space").json()
        assert info["workEnabled"] is None and info["workOn"] is True
    assert _snapshot(plain) == before  # the default is computed, never stored


def test_an_empty_ticket_id_is_not_work_data(plain: Path):
    _task(plain, "Plain", "ticketId: ''")
    assert Space(plain).work_on() is False


def test_the_default_follows_a_ticket_id_written_later(plain: Path):
    sp = Space(plain)
    rel, version = sp.create_object("task", "A task")
    assert sp.work_on() is False
    sp.update_properties(rel, {"ticketId": "ABC-12"}, version)
    assert sp.work_on() is True and _work_keys(sp) == FIELD_KEYS
    _obj, _fm, version = sp.read(rel)
    sp.update_properties(rel, {}, version, remove=["ticketId"])
    assert sp.work_on() is False and _work_keys(sp) == set()


def test_a_capture_or_an_alert_type_turns_the_default_on(plain: Path, tmp_path: Path):
    sp = Space(plain)
    assert sp.work_on() is False
    ensure_capture_type(sp)
    assert sp.work_on() is True
    assert Space(plain).work_on() is True
    other = create_space("Other", tmp_path)
    sp2 = Space(other)
    ensure_alert_type(sp2)
    assert sp2.work_on() is True and Space(other).work_on() is True


def test_the_it_starter_turns_work_on(tmp_path: Path):
    made = create_space("IT", tmp_path, setup="itops")
    assert _config(made)["workEnabled"] is True
    assert Space(made).work_on() is True
    # A space the starter made before M32 has the marker only: on by default.
    older = tmp_path / "older"
    shutil.copytree(FIXTURES / "space-itops", older)
    assert "workEnabled" not in _config(older)
    assert Space(older).work_on() is True
    # The starter applied to an empty folder, and added later to a space that started plain.
    fresh = tmp_path / "fresh"
    fresh.mkdir()
    sp = Space(fresh)
    sp.apply_setup("itops")
    assert _config(fresh)["workEnabled"] is True and sp.work_on() is True
    plain = create_space("Plain", tmp_path)
    sp = Space(plain)
    sp.apply_setup("itops")
    assert _config(plain)["workEnabled"] is True and sp.work_on() is True and _work_keys(sp) == FIELD_KEYS


def test_the_it_starter_keeps_a_switch_the_user_set(tmp_path: Path):
    plain = create_space("Plain", tmp_path)
    _set_config(plain, workEnabled=False)
    sp = Space(plain)
    sp.apply_setup("itops")
    assert _config(plain)["workEnabled"] is False and sp.work_on() is False
    assert _config(plain)["setup"] == "itops"


def test_the_stored_switch_wins_over_work_data(plain: Path):
    _task(plain, "Printer", "ticketId: 'INC0012345'")
    _set_config(plain, workEnabled=False)
    sp = Space(plain)
    assert sp.work_on() is False
    assert _work_keys(sp) == {"ticketId"}  # the one field that has a value stays


# -- the fields with Work off -----------------------------------------------------------------


def test_a_field_with_a_value_or_changed_in_the_type_stays(plain: Path):
    """The fix pass (findings 2 and 3): a definition saved in ``task.json`` as the built-in one
    is no reason to list the field (it used to be); one the user changed is."""
    # `rank` is saved in task.json renamed, `area` as the built-in one; `blockedOn` and `steps`
    # have values; the rest have neither.
    path = plain / ".object" / "types" / "task.json"
    data = json.loads(path.read_text("utf-8"))
    icon = {"type": "iconify", "val": PROPERTY_ICONS["number"]}
    data["propertyDefinitions"].append(
        {"id": "rank", "key": "rank", "name": "Order", "type": "number", "description": "",
         "icon": icon, "visibility": "hideWhenEmpty", "options": {}}
    )
    data["propertyDefinitions"].append(
        next(d for d in field_defs(task=True, project_type_ids=[]) if d.key == "area").to_json()
    )
    path.write_text(json.dumps(data, indent=2) + "\n", "utf-8")
    _task(plain, "Waiting", "blockedOn: 'Pat'", "steps:", "  - 'Ask Pat'")
    _task(plain, "Bare", "confidence: ''")  # an empty value is no value
    _set_config(plain, workEnabled=False)  # the values are work data: the default would be on
    before = _snapshot(plain)
    sp = Space(plain)
    assert sp.work_on() is False
    assert _work_keys(sp) == {"rank", "blockedOn", "steps"}
    assert sp.type_by_id("task").prop("rank").name == "Order"
    blocked = sp.type_by_id("task").prop("blockedOn")
    assert (blocked.name, blocked.type, blocked.id) == ("Blocked on", "text", "blockedOn")
    assert sp.type_by_id("task").prop("steps").type == "steps"
    assert _snapshot(plain) == before


def test_the_switch_adds_and_takes_the_fields_in_memory_only(plain: Path):
    _task(plain, "Waiting", "blockedOn: 'Pat'")
    _set_config(plain, workEnabled=False)  # a value on a Task is work data: the default is on
    before = _snapshot(plain)
    sp = Space(plain)
    with TestClient(create_app(sp, None, watch=False)) as c:

        def keys() -> set[str]:
            task = next(t for t in c.get("/api/space").json()["types"] if t["id"] == "task")
            return {p["key"] for p in task["propertyDefinitions"]} & FIELD_KEYS

        assert keys() == {"blockedOn"}
        revision = c.get("/api/space").json()["revision"]
        on = c.put("/api/space", json={"patch": {"workEnabled": True}, "baseRevision": revision})
        assert on.status_code == 200 and on.json()["workOn"] is True
        assert keys() == FIELD_KEYS
        assert [q["id"] for q in c.get("/api/queries").json()] == [TICKETS_ID]
        off = c.put("/api/space", json={"patch": {"workEnabled": False},
                                        "baseRevision": on.json()["revision"]})
        assert off.status_code == 200 and off.json()["workOn"] is False
        assert keys() == {"blockedOn"}
        assert c.get("/api/queries").json() == []
    after = _snapshot(plain)
    # Only space.json changed: no note and no type file.
    assert set(after) == set(before)
    assert {k for k in before if after[k] != before[k]} == {".object/space.json"}


def test_a_value_written_outside_the_app_shows_its_field(plain: Path):
    _set_config(plain, workEnabled=False)
    sp = Space(plain)
    assert _work_keys(sp) == set()
    rel = _task(plain, "From a script", "requester: 'Pat Example'")
    sp.rescan_file(rel)
    assert _work_keys(sp) == {"requester"}
    assert sp.type_by_id("task").prop("requester").name == "Requester"


def test_saving_the_task_type_with_work_off_writes_no_work_field(plain: Path):
    """A window that still holds the Task as Work-on listed it (every field) saves it after
    Work was turned off: the fields without a value are left out, nothing is refused."""
    _task(plain, "Waiting", "blockedOn: 'Pat'")
    _set_config(plain, workEnabled=True)
    sp = Space(plain)
    t, rev = sp.refresh_type("task")
    held = json.loads(json.dumps(t.to_json()))
    assert {p["key"] for p in held["propertyDefinitions"]} >= FIELD_KEYS
    _set_config(plain, workEnabled=False)
    assert sp.work_on() is False
    from objectapp.typemodel import TypeDefinition

    edited = TypeDefinition.from_json(held)
    edited.description = "Things to do"
    sp.save_type(edited, rev)
    stored = json.loads((plain / ".object" / "types" / "task.json").read_text("utf-8"))
    assert stored["description"] == "Things to do"
    assert {p["key"] for p in stored["propertyDefinitions"]} & FIELD_KEYS == {"blockedOn"}
    assert "blockedOn: 'Pat'" in (plain / "Tasks" / "Waiting.md").read_text("utf-8")


def test_work_on_is_as_before_m32(plain: Path):
    _set_config(plain, workEnabled=True)
    sp = Space(plain)
    task = sp.type_by_id("task")
    assert _work_keys(sp) == FIELD_KEYS and is_work_type(task)
    assert task.prop("project").options["allowedTypes"] == []
    assert [q.id for q in sp.list_queries()] == [TICKETS_ID]


# -- the hook and the loop ----------------------------------------------------------------------


def _work_type_space(root: Path) -> tuple[Space, str]:
    """A space with a user type that has the work fields saved ("Add work fields")."""
    sp = Space(root)
    t = sp.create_type("Request", "Requests")
    new, _added, _skipped = with_work_fields(t, sp.types)
    sp.save_type(new, sp.refresh_type(t.id)[1])
    return sp, t.id


def test_the_work_hook_runs_only_with_work_on(plain: Path):
    _set_config(plain, workEnabled=False)
    sp, type_id = _work_type_space(plain)
    # Its saved fields stay in its file with Work off; none is listed while none has a value.
    assert sp._is_work_kind(sp.type_by_id(type_id)) and _work_keys(sp, type_id) == set()
    rel, version = sp.create_object(type_id, "Reset a password")
    sp.update_properties(rel, {"ticketId": "ABC-12"}, version)
    assert "system" not in sp.read(rel)[1]
    _set_config(plain, workEnabled=True)
    rel2, version = sp.create_object(type_id, "Order a badge")
    sp.update_properties(rel2, {"ticketId": "ABC-13"}, version)
    assert sp.read(rel2)[1]["system"] == "Jira"


def test_a_work_service_write_keeps_its_hook_with_work_off(plain: Path):
    """The work routes answer as before when they are called, for a type that lists its Steps
    (with Work off: some note of the type has a step)."""
    _set_config(plain, workEnabled=False)
    sp, type_id = _work_type_space(plain)
    (plain / "Requests").mkdir(exist_ok=True)
    (plain / "Requests" / "Badge.md").write_text(
        "---\ntype: 'Request'\ntitle: 'Badge'\nsteps:\n  - 'Ask Pat'\n---\n", "utf-8", newline="\n"
    )
    sp.rescan_file("Requests/Badge.md")
    assert is_work_type(sp.type_by_id(type_id))
    rel, _version = sp.create_object(type_id, "Reset a password")
    sp.write_work(rel, None, updates={"ticketId": "ABC-12"})
    assert sp.read(rel)[1]["system"] == "Jira"


def test_the_work_loop_hears_edits_only_with_work_on(plain: Path, monkeypatch: pytest.MonkeyPatch):
    seen: list[ChangeEvent] = []
    monkeypatch.setattr(server, "on_change_event", lambda space, event: seen.append(event))
    rel = _task(plain, "Loose")
    sp = Space(plain)
    with TestClient(create_app(sp, None, watch=False)) as c:

        def edit(text: str) -> None:
            v = c.get("/api/object", params={"path": rel}).json()["version"]
            r = c.put("/api/object/properties", json={
                "path": rel, "updates": {"description": text}, "baseVersion": v, "clientId": "w1",
            })
            assert r.status_code == 200, r.text

        edit("off")
        assert seen == []
        info = c.get("/api/space").json()
        c.put("/api/space", json={"patch": {"workEnabled": True}, "baseRevision": info["revision"]})
        edit("on")
        assert [e.path for e in seen] == [rel]


# -- Project: the basic starter and the gallery ---------------------------------------------------


def test_the_basic_project_has_ticket_fields_only_with_work_on(tmp_path: Path):
    def keys(types) -> set[str]:
        project = next(t for t in types if t.id == "project")
        return {p.key for p in project.propertyDefinitions}

    assert not keys(basic_types()) & (FIELD_KEYS | {"completed"})
    assert keys(basic_types(work=True)) >= (FIELD_KEYS - {"project"}) | {"completed"}

    made = create_space("Basic", tmp_path, setup="basic")
    stored = json.loads((made / ".object" / "types" / "project.json").read_text("utf-8"))
    assert not {p["key"] for p in stored["propertyDefinitions"]} & TICKET_KEYS
    assert [p["name"] for p in stored["propertyDefinitions"] if not p["type"].startswith("entity_")] == [
        "Status", "Type", "Timeframe", "Collaborators", "Organizations", "Meetings", "Cover image", "Notes",
    ]

    plain = create_space("Plain", tmp_path)
    sp = Space(plain)
    sp.apply_setup("basic")
    assert not _work_keys(sp, "project") and not is_work_type(sp.type_by_id("project"))

    working = create_space("Working", tmp_path)
    _set_config(working, workEnabled=True)
    sp = Space(working)
    sp.apply_setup("basic")
    assert _work_keys(sp, "project") == FIELD_KEYS - {"project"}
    assert is_work_type(sp.type_by_id("project"))


def test_the_gallery_project_follows_the_switch(tmp_path: Path):
    assert not {p.key for p in build_template("project", [])} & FIELD_KEYS
    assert {p.key for p in build_template("project", [], work=True)} >= TICKET_KEYS
    off = next(c for c in template_catalog([]) if c["key"] == "project")
    on = next(c for c in template_catalog([], work=True) if c["key"] == "project")
    assert "Ticket ID" not in [p["name"] for p in off["properties"]]
    assert "Ticket ID" in [p["name"] for p in on["properties"]]

    plain = create_space("Plain", tmp_path)
    with TestClient(create_app(Space(plain), None, watch=False)) as c:
        listed = next(t for t in c.get("/api/type-gallery").json() if t["key"] == "project")
        assert "Ticket ID" not in [p["name"] for p in listed["properties"]]
        made = c.post("/api/types", json={"template": "project"})
        assert made.status_code == 201, made.text
    stored = json.loads((plain / ".object" / "types" / "project.json").read_text("utf-8"))
    assert not {p["key"] for p in stored["propertyDefinitions"]} & FIELD_KEYS

    working = create_space("Working", tmp_path)
    _set_config(working, workEnabled=True)
    with TestClient(create_app(Space(working), None, watch=False)) as c:
        assert c.post("/api/types", json={"template": "project"}).status_code == 201
    stored = json.loads((working / ".object" / "types" / "project.json").read_text("utf-8"))
    assert {p["key"] for p in stored["propertyDefinitions"]} >= TICKET_KEYS
