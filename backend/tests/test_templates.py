"""Per-type templates (Task 9). Templates are created in a tmp copy of the space."""

import copy
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.templates import TemplateError, expand_title, resolve_date_variable
from objectapp.typemodel import PropertyDefinition, type_revision


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode())
    return path


def _snapshot(space_dir: Path) -> dict[str, bytes]:
    return {
        p.relative_to(space_dir).as_posix(): p.read_bytes()
        for p in sorted(space_dir.rglob("*"))
        if p.is_file()
    }


def _fm(space_dir: Path, rel: str) -> dict:
    of = split_object((space_dir / rel).read_text(encoding="utf-8"))
    return parse_fm(of.frontmatter_src or "")


def _body(space_dir: Path, rel: str) -> str:
    return split_object((space_dir / rel).read_text(encoding="utf-8")).body


def _set_default(space: Space, type_id: str, template_id: str | None) -> None:
    t = copy.deepcopy(space.type_by_id(type_id))
    t.templates["defaultTemplateId"] = template_id
    if template_id and template_id not in t.templates["ids"]:
        t.templates["ids"].append(template_id)
    space.save_type(t, type_revision(space.root, type_id))


def _bug_template(space_dir: Path) -> Path:
    return _write(
        space_dir / "Templates" / "Misc" / "Bug.md",
        "---\nid: 01TEMPLATEBUG0000000000000\ntype: 'Task'\ntemplate: Bug\n"
        "status: Not Started\ntags: [Bugs]\ncreatedAt: 2020-01-01T00:00:00.000Z\n"
        "lastUpdated: 2020-01-01T00:00:00.000Z\n---\n## Steps\n\n- \n",
    )


def test_create_template_registers_in_type(space_dir: Path):
    space = Space(space_dir)
    path, version = space.create_template("task", "Bug report")

    assert path == "Templates/Tasks/Bug report.md"
    fm = _fm(space_dir, path)
    assert fm["type"] == "Task"
    assert fm["template"] == "Bug report"
    assert fm["id"]
    assert space.type_by_id("task").templates["ids"] == [fm["id"]]
    stored = (space_dir / ".object" / "types" / "task.json").read_text(encoding="utf-8")
    assert fm["id"] in stored
    assert [s.path for s in space.list_templates("task")] == [path]
    assert space.get(path).template == "Bug report"
    assert version


def test_template_discovered_by_type_key(space_dir: Path):
    _bug_template(space_dir)
    Space(space_dir)  # first open: the type JSON is written
    before = _snapshot(space_dir)
    space = Space(space_dir)
    assert _snapshot(space_dir) == before  # opening writes nothing
    assert [s.path for s in space.list_templates("task")] == ["Templates/Misc/Bug.md"]
    assert all(t.name.lower() != "misc" for t in space.types)
    assert space.type_by_id("task").templates["ids"] == []  # discovered in memory only
    assert _snapshot(space_dir) == before


def test_templates_excluded_from_list_resolve_and_counts(space_dir: Path):
    _bug_template(space_dir)
    _write(
        space_dir / "Templates" / "Tasks" / "Write docs.md",
        "---\nid: 01TEMPLATEDOC0000000000000\ntype: 'Task'\ntemplate: Docs\n"
        "custom_only_in_template: 3\n---\n",
    )
    space = Space(space_dir)
    paths = [s.path for s in space.list()]
    assert not any(p.startswith("Templates/") for p in paths)
    assert not any(s.path.startswith("Templates/") for s in space.list("task"))
    assert space.resolve("Bug", None) is None
    assert space.resolve("Write docs", None) == "Tasks/Write docs.md"
    task = space.type_by_id("task")
    assert task.prop("custom_only_in_template") is None
    assert len(space.list_templates("task")) == 2


def test_default_template_applied_on_create(space_dir: Path):
    _bug_template(space_dir)
    space = Space(space_dir)
    _set_default(space, "task", "01TEMPLATEBUG0000000000000")

    path, _version = space.create_object("task", "Printer jams")
    fm = _fm(space_dir, path)
    assert fm["status"] == "Not Started"
    assert fm["tags"] == ["Bugs"]
    assert "template" not in fm
    assert fm["id"] != "01TEMPLATEBUG0000000000000"
    assert fm["createdAt"] != "2020-01-01T00:00:00.000Z"
    assert _body(space_dir, path) == "## Steps\n\n- \n"
    assert space.get(path).template is None


def test_template_none_skips_default(space_dir: Path):
    _bug_template(space_dir)
    space = Space(space_dir)
    _set_default(space, "task", "01TEMPLATEBUG0000000000000")

    path, _ = space.create_object("task", "Printer jams", "none")
    fm = _fm(space_dir, path)
    assert "status" not in fm
    assert _body(space_dir, path) == "# Printer jams\n"


def test_title_date_placeholder(space_dir: Path):
    created = datetime(2026, 10, 23, 14, 5)
    assert expand_title("Meeting {date:YYYY-MM-DD}", created) == "Meeting 2026-10-23"
    assert expand_title("{date:dddd, MMMM D YY HH:mm}", created) == "Friday, October 23 26 14:05"
    assert expand_title("{date:ddd MMM M/D}", created) == "Fri Oct 10/23"

    _write(
        space_dir / "Templates" / "Pages" / "Meeting.md",
        "---\nid: 01TEMPLATEMEET000000000000\ntype: 'Page'\ntemplate: Meeting\n"
        "title: 'Meeting {date:YYYY-MM-DD}'\n---\n",
    )
    space = Space(space_dir)
    path, _ = space.create_object("page", "", "01TEMPLATEMEET000000000000")
    today = datetime.now().strftime("%Y-%m-%d")
    assert path == f"Pages/Meeting {today}.md"
    assert _fm(space_dir, path)["title"] == f"Meeting {today}"


def test_bad_date_format_422(space_dir: Path):
    with pytest.raises(TemplateError):
        expand_title("Meeting {date:YYYY-QQ}", datetime(2026, 10, 23))

    _write(
        space_dir / "Templates" / "Pages" / "Bad.md",
        "---\nid: 01TEMPLATEBAD0000000000000\ntype: 'Page'\ntemplate: Bad\n"
        "title: 'Meeting {date:YYYY-QQ}'\n---\n",
    )
    client = TestClient(create_app(Space(space_dir), watch=False))
    res = client.post(
        "/api/objects", json={"typeId": "page", "templateId": "01TEMPLATEBAD0000000000000"}
    )
    assert res.status_code == 422
    assert res.json()["detail"] == "Could not apply the template"


def test_date_variable_week_range():
    created = datetime(2026, 10, 23, 9, 0)
    assert resolve_date_variable("day", created) == "2026-10-23"
    assert resolve_date_variable("week", created) == "2026-10-19 -> 2026-10-25"
    assert resolve_date_variable("month", created) == "2026-10-01 -> 2026-10-31"
    assert resolve_date_variable("year", created) == "2026-01-01 -> 2026-12-31"
    with pytest.raises(TemplateError):
        resolve_date_variable("decade", created)


def _meeting_type(space: Space) -> None:
    space.create_type("Meeting", "Meetings")
    t = copy.deepcopy(space.type_by_id("meeting"))
    t.propertyDefinitions += [
        PropertyDefinition.from_json(
            {"id": "when", "key": "when", "name": "When", "type": "datetime"}
        ),
        PropertyDefinition.from_json(
            {"id": "due", "key": "due", "name": "Due", "type": "datetimeSimple"}
        ),
    ]
    space.save_type(t, type_revision(space.root, "meeting"))


def test_creation_variable_on_datetime_simple_422(space_dir: Path):
    space = Space(space_dir)
    _meeting_type(space)
    _write(
        space_dir / "Templates" / "Meetings" / "Weekly.md",
        "---\nid: 01TEMPLATEWEEK000000000000\ntype: 'Meeting'\ntemplate: Weekly\n"
        "when: '{creation:week}'\n---\n",
    )
    _write(
        space_dir / "Templates" / "Meetings" / "Due.md",
        "---\nid: 01TEMPLATEDUE0000000000000\ntype: 'Meeting'\ntemplate: Due\n"
        "due: '{creation:day}'\n---\n",
    )
    space = Space(space_dir)
    path, _ = space.create_object("meeting", "Sync", "01TEMPLATEWEEK000000000000")
    assert " -> " in str(_fm(space_dir, path)["when"])

    before = _snapshot(space_dir)
    with pytest.raises(TemplateError):
        space.create_object("meeting", "Sync 2", "01TEMPLATEDUE0000000000000")
    assert _snapshot(space_dir) == before

    client = TestClient(create_app(space, watch=False))
    version = space.cached_version(path)
    res = client.post(
        "/api/object/apply-template",
        json={"path": path, "templateId": "01TEMPLATEDUE0000000000000", "baseVersion": version},
    )
    assert res.status_code == 422
    assert space.cached_version(path) == version


def test_apply_overwrites_props_and_appends_body(space_dir: Path):
    _bug_template(space_dir)
    space = Space(space_dir)
    rel = "Tasks/Write docs.md"
    _of, _fm0, version = space.read(rel)
    client = TestClient(create_app(space, watch=False))
    res = client.post(
        "/api/object/apply-template",
        json={"path": rel, "templateId": "01TEMPLATEBUG0000000000000", "baseVersion": version},
    )
    assert res.status_code == 200, res.text
    fm = _fm(space_dir, rel)
    assert fm["status"] == "Not Started"
    assert fm["tags"] == ["Bugs"]
    assert "template" not in fm
    assert fm["createdAt"] == "2026-03-01T09:00:00.000Z"
    assert fm["lastUpdated"] != "2020-01-01T00:00:00.000Z"
    assert fm["lastUpdated"] != "2026-03-02T10:00:00.000Z"
    assert fm["id"] != "01TEMPLATEBUG0000000000000"
    assert _body(space_dir, rel) == (
        "\nWrite the user guide. See [[Ada Lovelace]].\n\n## Steps\n\n- \n"
    )
    assert res.json()["version"] == space.cached_version(rel)

    # A body that is only `# Title` is replaced.
    path, version = space.create_object("task", "Fresh", "none")
    space.apply_template(path, "01TEMPLATEBUG0000000000000", version)
    assert _body(space_dir, path) == "## Steps\n\n- \n"

    # A stale version is a conflict.
    res = client.post(
        "/api/object/apply-template",
        json={"path": rel, "templateId": "01TEMPLATEBUG0000000000000", "baseVersion": version},
    )
    assert res.status_code == 409


def test_templates_not_allowed_for_tag_422(space_dir: Path):
    space = Space(space_dir)
    client = TestClient(create_app(space, watch=False))
    tag = next(t for t in space.types if t.name == "Tag")
    res = client.post(f"/api/types/{tag.id}/templates", json={"name": "Nope"})
    assert res.status_code == 422
    assert not (space_dir / "Templates").exists()


def test_template_routes_and_delete_unregisters(space_dir: Path):
    space = Space(space_dir)
    client = TestClient(create_app(space, watch=False))
    res = client.post("/api/types/task/templates", json={"name": "Bug"})
    assert res.status_code == 201
    path = res.json()["path"]
    listed = client.get("/api/types/task/templates").json()
    assert [s["path"] for s in listed] == [path]
    tid = listed[0]["id"]
    assert listed[0]["template"] == "Bug"
    _set_default(space, "task", tid)

    res = client.delete("/api/object", params={"path": path})
    assert res.status_code == 200
    task = space.type_by_id("task")
    assert tid not in task.templates["ids"]
    assert task.templates["defaultTemplateId"] is None
    assert client.get("/api/types/task/templates").json() == []


def test_restoring_a_deleted_template_re_registers_it(space_dir: Path):
    # Audit 2026-11-01: delete unregisters the template; restore must register it again,
    # in its old place in `templates.ids` and as the default when it was.
    space = Space(space_dir)
    first, _ = space.create_template("task", "First")
    middle, _ = space.create_template("task", "Middle")
    last, _ = space.create_template("task", "Last")
    mid_id = space.get(middle).id
    _set_default(space, "task", mid_id)
    order = list(space.type_by_id("task").templates["ids"])
    assert order.index(mid_id) == 1

    item = space.delete_object(middle)
    task = space.type_by_id("task")
    assert mid_id not in task.templates["ids"] and task.templates["defaultTemplateId"] is None

    restored = space.restore(item.id)
    assert restored["paths"] == [middle]
    task = space.type_by_id("task")
    assert task.templates["ids"] == order
    assert task.templates["defaultTemplateId"] == mid_id
    assert [s.path for s in space.list_templates("task")] == [first, middle, last]
    # The type file carries the registration too (re-read from disk).
    assert space._stored_type("task").templates["defaultTemplateId"] == mid_id

    # A template that was registered but not the default comes back without becoming it.
    item = space.delete_object(last)
    space.restore(item.id)
    task = space.type_by_id("task")
    assert task.templates["ids"] == order and task.templates["defaultTemplateId"] == mid_id
