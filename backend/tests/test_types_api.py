"""The type definition API: create, save with cascading rewrites, delete (Task 5)."""

import copy
import difflib
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import ConfirmRequired, ReadOnly, Skip, Space
from objectapp.typemodel import (
    LabelOption,
    PropertyDefinition,
    RevisionConflict,
    TypeReadOnly,
    type_revision,
)

from test_properties import _external_writes


def _changed_lines(before: bytes, after: bytes) -> tuple[list[str], list[str]]:
    old = before.decode().splitlines(keepends=True)
    new = after.decode().splitlines(keepends=True)
    diff = [d for d in difflib.ndiff(old, new) if d.startswith(("+ ", "- "))]
    return [d[2:] for d in diff if d.startswith("- ")], [d[2:] for d in diff if d.startswith("+ ")]


def _edit(space: Space, type_id: str):
    """A deep copy of the stored type, to change and save."""
    return copy.deepcopy(space.type_by_id(type_id))


def _save(space: Space, t, confirm: bool = False):
    return space.save_type(t, type_revision(space.root, t.id), confirm=confirm)


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode())
    return path


def _type_file(space_dir: Path, type_id: str) -> Path:
    return space_dir / ".capacities" / "types" / f"{type_id}.json"


def _snapshot(space_dir: Path) -> dict[str, bytes]:
    return {
        p.relative_to(space_dir).as_posix(): p.read_bytes()
        for p in sorted(space_dir.rglob("*"))
        if p.is_file()
    }


def _group_type(space_dir: Path) -> None:
    """A tmp `Group` type with a multi label `topics` and a multi relation `members`."""
    types = space_dir / ".capacities" / "types"
    types.mkdir(parents=True, exist_ok=True)
    data = {
        "schemaVersion": 2,
        "id": "group",
        "name": "Group",
        "pluralName": "Groups",
        "folder": "Groups",
        "propertyDefinitions": [
            {
                "id": "topics",
                "key": "topics",
                "name": "Topics",
                "type": "label",
                "options": {
                    "isArray": True,
                    "set": [
                        {"id": "a", "text": "A", "color": "blue", "icon": None},
                        {"id": "b", "text": "B", "color": "red", "icon": None},
                        {"id": "c", "text": "C", "color": "green", "icon": None},
                    ],
                },
            },
            {
                "id": "members",
                "key": "members",
                "name": "Members",
                "type": "entity",
                "options": {
                    "isArray": True,
                    "allowedTypes": [],
                    "hasFixedSet": False,
                    "fixedSet": [],
                },
            },
        ],
    }
    (types / "group.json").write_bytes((json.dumps(data, indent=2) + "\n").encode())


# -- create ----------------------------------------------------------------------


def test_create_type_seeds_tags_and_content(space_dir: Path):
    space = Space(space_dir)
    t = space.create_type("Project", "Projects")

    assert (t.id, t.name, t.pluralName, t.folder) == ("project", "Project", "Projects", "Projects")
    assert (t.icon.type, t.icon.val, t.color) == ("iconify", "ph-note-pencil", "gray")
    keys = [p.key for p in t.propertyDefinitions]
    assert keys[:8] == [
        "title", "collections", "description", "createdAt", "lastUpdated", "tags", "icon", "aliases"
    ]
    content = [p for p in t.propertyDefinitions if p.type == "blocks"]
    assert [(p.name, p.key) for p in content] == [("Content", "content")]
    assert space.type_by_id("project") is t
    stored = json.loads(_type_file(space_dir, "project").read_text(encoding="utf-8"))
    assert stored["name"] == "Project" and stored["folder"] == "Projects"
    assert not (space_dir / "Projects").exists()  # the folder comes with the first object

    # The id is unique; a name already in use is refused.
    other = space.create_type("Project!", "Projects!", icon="ph-rocket", color="blue")
    assert other.id == "project-2" and other.icon.val == "ph-rocket" and other.color == "blue"
    with pytest.raises(InvalidValue):
        space.create_type("project", "Projects")


def test_create_type_requires_name_and_plural_422(space_dir: Path):
    space = Space(space_dir)
    with pytest.raises(InvalidValue):
        space.create_type("", "Things")
    with pytest.raises(InvalidValue):
        space.create_type("Thing", "  ")
    with pytest.raises(InvalidValue):
        space.create_type("Thing", "Things", color="not-a-colour")
    assert space.type_by_id("thing") is None
    with TestClient(create_app(space, None, watch=False)) as c:
        assert c.post("/api/types", json={"name": "", "pluralName": "X"}).status_code == 422
        r = c.post("/api/types", json={"name": "Thing", "pluralName": "Things"})
        assert r.status_code == 201, r.text
        assert r.json()["id"] == "thing" and r.json()["revision"]


# -- rename ----------------------------------------------------------------------


def test_rename_type_rewrites_type_lines_unstamped(space_dir: Path):
    space = Space(space_dir)
    alpha = space_dir / "Servers" / "Alpha.md"
    before = alpha.read_bytes()

    t = _edit(space, "server")
    t.name = "Machine"
    t.pluralName = "Machines"
    result = _save(space, t)

    assert result.rewritten == ["Servers/Alpha.md"] and result.skipped == []
    removed, added = _changed_lines(before, alpha.read_bytes())
    assert (removed, added) == (["type: 'Server'\n"], ["type: 'Machine'\n"])
    assert result.type.name == "Machine" and result.type.folder == "Servers"
    assert result.type.formerNames == ["Server"]
    assert result.revision == type_revision(space.root, "server")
    stored = json.loads(_type_file(space_dir, "server").read_text(encoding="utf-8"))
    assert (stored["name"], stored["folder"], stored["formerNames"]) == (
        "Machine", "Servers", ["Server"]
    )
    assert not (space_dir / "Machines").exists()
    assert space.get("Servers/Alpha.md").type == "server"
    assert space.type_by_id("server").name == "Machine"


def test_former_name_still_resolves(space_dir: Path, monkeypatch):
    space = Space(space_dir)
    alpha = space_dir / "Servers" / "Alpha.md"
    before = alpha.read_bytes()
    real = space._write

    def locked(rel, base_version, edit, stamp=True):
        if rel == "Servers/Alpha.md":
            raise ReadOnly("The file is locked")
        return real(rel, base_version, edit, stamp=stamp)

    monkeypatch.setattr(space, "_write", locked)
    t = _edit(space, "server")
    t.name = "Machine"
    result = _save(space, t)

    assert result.rewritten == []
    assert result.skipped == [Skip("Servers/Alpha.md", "The file is locked")]
    assert alpha.read_bytes() == before
    assert "Servers/Alpha.md" in [s.path for s in space.list("server")]
    reopened = Space(space_dir)
    assert reopened.type_by_id("server").name == "Machine"
    assert reopened._type_id("Server") == "server"
    assert "Servers/Alpha.md" in [s.path for s in reopened.list("server")]


def test_rename_type_rewrites_its_templates(space_dir: Path):
    rack = _write(
        space_dir / "Templates" / "Servers" / "Rack.md",
        "---\ntype: 'Server'\ntemplate: Rack\ntitle: Rack\n---\n",
    )
    space = Space(space_dir)
    t = _edit(space, "server")
    t.name = "Machine"
    result = _save(space, t)

    assert sorted(result.rewritten) == ["Servers/Alpha.md", "Templates/Servers/Rack.md"]
    assert rack.read_bytes() == b"---\ntype: 'Machine'\ntemplate: Rack\ntitle: Rack\n---\n"


def test_rename_to_existing_type_name_422(space_dir: Path):
    space = Space(space_dir)
    t = _edit(space, "server")
    t.name = "person"
    with pytest.raises(InvalidValue):
        _save(space, t)


# -- labels ----------------------------------------------------------------------


def test_rename_label_option_rewrites_one_line_each(space_dir: Path):
    space = Space(space_dir)
    docs = space_dir / "Tasks" / "Write docs.md"
    printer = space_dir / "Tasks" / "Fix printer.md"
    before, printer_before = docs.read_bytes(), printer.read_bytes()

    t = _edit(space, "task")
    status = t.prop("status")
    for opt in status.options["set"]:
        if opt["text"] == "Not Started":
            opt["text"] = "Todo"
    result = _save(space, t)

    assert result.rewritten == ["Tasks/Write docs.md"]
    removed, added = _changed_lines(before, docs.read_bytes())
    assert (removed, added) == (["status: Not Started\n"], ["status: Todo\n"])
    assert printer.read_bytes() == printer_before


def test_delete_label_option_in_use_requires_confirm(space_dir: Path):
    space = Space(space_dir)
    docs = space_dir / "Tasks" / "Write docs.md"
    before = docs.read_bytes()
    t = _edit(space, "task")
    status = t.prop("status")
    status.options["set"] = [o for o in status.options["set"] if o["text"] != "Not Started"]

    with pytest.raises(ConfirmRequired) as err:
        _save(space, t)
    assert err.value.affected == 1
    assert docs.read_bytes() == before

    result = _save(space, t, confirm=True)
    assert result.rewritten == ["Tasks/Write docs.md"]
    assert _changed_lines(before, docs.read_bytes()) == (
        ["status: Not Started\n"],
        ["status: null\n"],
    )


def test_delete_unused_label_option_needs_no_confirm(space_dir: Path):
    space = Space(space_dir)
    t = _edit(space, "task")
    t.prop("status").options["set"].append(
        {"id": "gone", "text": "Gone", "color": "red", "icon": None, "statusCategory": "done"}
    )
    _save(space, t)
    t = _edit(space, "task")
    t.prop("status").options["set"] = [
        o for o in t.prop("status").options["set"] if o["id"] != "gone"
    ]
    assert _save(space, t).rewritten == []


def test_basic_type_options_editable_properties_locked(space_dir: Path):
    space = Space(space_dir)
    t = _edit(space, "task")
    status = t.prop("status")
    status.options["set"].append(
        LabelOption("blocked", "Blocked", "pink", statusCategory="blocked").to_json()
    )
    status.options["set"][0]["color"] = "teal"
    status.visibility = "hideWhenEmpty"
    result = _save(space, t)
    saved = result.type.prop("status")
    assert saved.visibility == "hideWhenEmpty"
    assert [o["text"] for o in saved.options["set"]][-1] == "Blocked"
    assert saved.options["set"][0]["color"] == "teal"

    added = _edit(space, "task")
    added.propertyDefinitions.append(
        PropertyDefinition(id="effort", key="effort", name="Effort", type="number")
    )
    removed = _edit(space, "task")
    removed.propertyDefinitions = [p for p in removed.propertyDefinitions if p.key != "status"]
    multi = _edit(space, "task")
    multi.prop("status").options["isArray"] = True
    renamed = _edit(space, "task")
    renamed.name = "Todo"
    for t in (added, removed, multi, renamed):
        with pytest.raises(InvalidValue, match="basic object types"):
            _save(space, t)


def test_label_multi_to_single_keeps_first(space_dir: Path):
    _group_type(space_dir)
    one = _write(space_dir / "Groups" / "One.md", "---\ntype: 'Group'\ntopics: [A, B]\n---\n")
    two = _write(space_dir / "Groups" / "Two.md", "---\ntype: 'Group'\ntopics: [C]\n---\n")
    space = Space(space_dir)
    t = _edit(space, "group")
    t.prop("topics").options["isArray"] = False

    with pytest.raises(ConfirmRequired) as err:
        _save(space, t)
    assert err.value.affected == 1
    assert one.read_bytes() == b"---\ntype: 'Group'\ntopics: [A, B]\n---\n"

    result = _save(space, t, confirm=True)
    assert result.rewritten == ["Groups/One.md"]
    assert one.read_bytes() == b"---\ntype: 'Group'\ntopics: A\n---\n"
    assert two.read_bytes() == b"---\ntype: 'Group'\ntopics: [C]\n---\n"
    assert result.type.prop("topics").options["isArray"] is False


def test_single_to_multi_rewrites_nothing(space_dir: Path):
    _group_type(space_dir)
    _write(space_dir / "Groups" / "One.md", "---\ntype: 'Group'\ntopics: [A, B]\n---\n")
    space = Space(space_dir)
    t = _edit(space, "group")
    t.prop("topics").options["isArray"] = False
    _save(space, t, confirm=True)
    t = _edit(space, "group")
    t.prop("topics").options["isArray"] = True
    assert _save(space, t).rewritten == []


# -- relations -------------------------------------------------------------------


def test_entity_multi_to_single_requires_confirm_and_keeps_first(space_dir: Path):
    _group_type(space_dir)
    team = _write(
        space_dir / "Groups" / "Team.md",
        "---\ntype: 'Group'\nmembers: ['[[Ada Lovelace]]', '[[Alpha]]']\n---\n",
    )
    space = Space(space_dir)
    t = _edit(space, "group")
    t.prop("members").options["isArray"] = False

    with pytest.raises(ConfirmRequired) as err:
        _save(space, t)
    assert err.value.affected == 1

    result = _save(space, t, confirm=True)
    assert result.rewritten == ["Groups/Team.md"]
    assert team.read_bytes() == b"---\ntype: 'Group'\nmembers: '[[Ada Lovelace]]'\n---\n"


def test_entity_allowed_types_change_strips_links(space_dir: Path):
    _group_type(space_dir)
    team = _write(
        space_dir / "Groups" / "Team.md",
        "---\ntype: 'Group'\nmembers: ['[[Ada Lovelace]]', '[[Alpha]]', '[[Nobody]]']\n---\n",
    )
    space = Space(space_dir)
    assert space.resolve("Alpha", "Groups/Team.md") == "Servers/Alpha.md"
    t = _edit(space, "group")
    t.prop("members").options["allowedTypes"] = ["person"]

    with pytest.raises(ConfirmRequired) as err:
        _save(space, t)
    assert err.value.affected == 1

    _save(space, t, confirm=True)
    assert team.read_bytes() == (
        b"---\ntype: 'Group'\nmembers: ['[[Ada Lovelace]]', '[[Nobody]]']\n---\n"
    )


def test_fixed_set_enforced_with_confirm(space_dir: Path):
    _group_type(space_dir)
    team = _write(
        space_dir / "Groups" / "Team.md",
        "---\ntype: 'Group'\nmembers: ['[[Ada Lovelace]]', '[[Alpha]]']\n---\n",
    )
    space = Space(space_dir)
    ada_id, _ = space.ensure_id("People/Ada Lovelace.md")

    bogus = _edit(space, "group")
    bogus.prop("members").options.update(hasFixedSet=True, fixedSet=["NOT-AN-ID"])
    with pytest.raises(InvalidValue):
        _save(space, bogus, confirm=True)

    t = _edit(space, "group")
    t.prop("members").options.update(hasFixedSet=True, fixedSet=[ada_id])
    with pytest.raises(ConfirmRequired) as err:
        _save(space, t)
    assert err.value.affected == 1
    _save(space, t, confirm=True)
    assert team.read_bytes() == b"---\ntype: 'Group'\nmembers: ['[[Ada Lovelace]]']\n---\n"


def test_sync_rules_validated_422(space_dir: Path):
    _group_type(space_dir)
    space = Space(space_dir)
    t = _edit(space, "group")
    t.prop("members").options.update(
        isArray=False, allowedTypes=["person"], propertySyncing={"propertyIds": ["website"]}
    )
    with pytest.raises(InvalidValue, match="multi-select"):
        _save(space, t, confirm=True)
    t = _edit(space, "group")
    t.prop("members").options.update(
        allowedTypes=["task"], propertySyncing={"propertyIds": ["status"]}
    )
    with pytest.raises(InvalidValue, match="basic object types"):
        _save(space, t, confirm=True)


# -- property definitions ----------------------------------------------------------


def test_delete_property_requires_confirm_428(space_dir: Path):
    _write(space_dir / "Servers" / "Beta.md", "---\ntype: 'Server'\ntitle: Beta\ncores: 4\n---\n")
    space = Space(space_dir)
    before = _snapshot(space_dir)
    t = _edit(space, "server")
    t.propertyDefinitions = [p for p in t.propertyDefinitions if p.key != "cores"]

    with pytest.raises(ConfirmRequired) as err:
        _save(space, t)
    assert err.value.affected == 2
    assert _snapshot(space_dir) == before


def test_delete_property_strips_key_with_confirm(space_dir: Path):
    beta = _write(
        space_dir / "Servers" / "Beta.md", "---\ntype: 'Server'\ntitle: Beta\ncores: 4\n---\n"
    )
    space = Space(space_dir)
    alpha = space_dir / "Servers" / "Alpha.md"
    alpha_before = alpha.read_bytes()
    t = _edit(space, "server")
    t.propertyDefinitions = [p for p in t.propertyDefinitions if p.key != "cores"]

    result = _save(space, t, confirm=True)
    assert sorted(result.rewritten) == ["Servers/Alpha.md", "Servers/Beta.md"]
    assert _changed_lines(alpha_before, alpha.read_bytes()) == (["cores: 8\n"], [])
    assert beta.read_bytes() == b"---\ntype: 'Server'\ntitle: Beta\n---\n"
    assert result.type.prop("cores") is None


def test_add_property_key_rules(space_dir: Path):
    space = Space(space_dir)
    t = _edit(space, "server")
    t.propertyDefinitions.append(
        PropertyDefinition(id="ram", key="ram", name="RAM", type="number")
    )
    assert _save(space, t).type.prop("ram").name == "RAM"
    for key in ("type", "cores", ""):
        bad = _edit(space, "server")
        bad.propertyDefinitions.append(
            PropertyDefinition(id=f"new-{key}", key=key, name="X", type="text")
        )
        with pytest.raises(InvalidValue):
            _save(space, bad)


def test_change_key_rejected_422(space_dir: Path):
    space = Space(space_dir)
    t = _edit(space, "server")
    t.prop("cores").key = "cpus"
    with pytest.raises(InvalidValue):
        _save(space, t)


def test_change_property_type_via_put_422(space_dir: Path):
    space = Space(space_dir)
    t = _edit(space, "server")
    t.prop("cores").type = "text"
    with pytest.raises(InvalidValue):
        _save(space, t)


def test_rename_property_changes_name_only(space_dir: Path):
    space = Space(space_dir)
    before = _snapshot(space_dir)
    t = _edit(space, "server")
    t.prop("cores").name = "CPU cores"
    result = _save(space, t)
    assert result.rewritten == []
    after = _snapshot(space_dir)
    changed = {k for k in after if after[k] != before.get(k)}
    assert changed == {".capacities/types/server.json"}
    assert result.type.prop("cores").key == "cores"


def test_rewrite_conflict_retried_then_skipped(space_dir: Path, monkeypatch):
    space = Space(space_dir)
    alpha = space_dir / "Servers" / "Alpha.md"

    written = _external_writes(monkeypatch, alpha, 1)
    t = _edit(space, "server")
    t.propertyDefinitions = [p for p in t.propertyDefinitions if p.key != "cores"]
    result = _save(space, t, confirm=True)
    assert len(written) == 1
    assert result.rewritten == ["Servers/Alpha.md"] and result.skipped == []
    text = alpha.read_bytes().decode()
    assert "external 0\n" in text and "cores:" not in text

    written = _external_writes(monkeypatch, alpha, 2)
    t = _edit(space, "server")
    t.propertyDefinitions = [p for p in t.propertyDefinitions if p.key != "owner"]
    result = _save(space, t, confirm=True)
    assert len(written) == 2
    assert result.rewritten == []
    assert [s.path for s in result.skipped] == ["Servers/Alpha.md"]
    assert alpha.read_bytes() == written[-1]
    # The type is saved even though one file could not be rewritten.
    assert space.type_by_id("server").prop("owner") is None


def test_save_type_stale_revision_409(space_dir: Path):
    space = Space(space_dir)
    before = _type_file(space_dir, "server").read_bytes()
    t = _edit(space, "server")
    t.description = "Racks"
    with pytest.raises(RevisionConflict) as err:
        space.save_type(t, "stale")
    assert err.value.current_revision == type_revision(space.root, "server")
    assert _type_file(space_dir, "server").read_bytes() == before

    with TestClient(create_app(space, None, watch=False)) as c:
        r = c.put(
            "/api/types/server", json={"type": t.to_api("stale"), "baseRevision": "stale"}
        )
        assert r.status_code == 409
        assert r.json()["currentRevision"] == type_revision(space.root, "server")


def test_save_inferred_type_first_time(space_dir: Path):
    types = space_dir / ".capacities" / "types"
    types.mkdir(parents=True)
    space = Space(space_dir)
    assert type_revision(space.root, "server") == ""
    t = _edit(space, "server")
    t.description = "Racks"
    result = space.save_type(t, "")
    assert result.revision == type_revision(space.root, "server") != ""


def test_save_unreadable_type_423(space_dir: Path):
    types = space_dir / ".capacities" / "types"
    types.mkdir(parents=True)
    (types / "server.json").write_bytes(b'{"id": "server",')
    space = Space(space_dir)
    t = _edit(space, "server")
    assert t.readOnlyReason
    t.readOnlyReason = None
    t.description = "x"
    with pytest.raises(TypeReadOnly):
        space.save_type(t, type_revision(space.root, "server"))
    assert (types / "server.json").read_bytes() == b'{"id": "server",'
    with TestClient(create_app(space, None, watch=False)) as c:
        r = c.put(
            "/api/types/server",
            json={"type": t.to_api(), "baseRevision": type_revision(space.root, "server")},
        )
        assert r.status_code == 423


def test_save_unknown_type_404(space_dir: Path):
    space = Space(space_dir)
    with TestClient(create_app(space, None, watch=False)) as c:
        t = _edit(space, "server")
        r = c.put("/api/types/nope", json={"type": t.to_api(), "baseRevision": ""})
        assert r.status_code == 404


# -- delete ----------------------------------------------------------------------


def test_delete_type_moves_objects_to_trash(space_dir: Path):
    space = Space(space_dir)
    person = _edit(space, "person")
    person.propertyDefinitions.append(
        PropertyDefinition(
            id="servers",
            key="servers",
            name="Servers",
            type="entity",
            options={"isArray": True, "allowedTypes": ["server"], "hasFixedSet": False,
                     "fixedSet": []},
        )
    )
    _save(space, person)

    with pytest.raises(ConfirmRequired) as err:
        space.delete_type("server", confirm=False)
    assert err.value.affected == 1
    assert (space_dir / "Servers" / "Alpha.md").is_file()

    item = space.delete_type("server", confirm=True)
    assert item.kind == "type" and item.objectCount == 1
    assert not (space_dir / "Servers" / "Alpha.md").exists()
    trashed = [i for i in space.list_trash() if i.kind == "object"]
    assert [i.originalPath for i in trashed] == ["Servers/Alpha.md"]
    assert space.type_by_id("server") is None
    assert space.type_by_id("person").prop("servers").options["allowedTypes"] == []
    stored = json.loads(_type_file(space_dir, "person").read_text(encoding="utf-8"))
    rel = next(p for p in stored["propertyDefinitions"] if p["key"] == "servers")
    assert rel["options"]["allowedTypes"] == []

    space.restore(item.id)
    assert space.type_by_id("person").prop("servers").options["allowedTypes"] == ["server"]


def test_delete_basic_type_422(space_dir: Path):
    space = Space(space_dir)
    for type_id in ("page", "tag", "task"):
        with pytest.raises(InvalidValue):
            space.delete_type(type_id, confirm=True)
        assert space.type_by_id(type_id) is not None


# -- routes ----------------------------------------------------------------------


def _wait(published: list, count: int) -> None:
    deadline = time.monotonic() + 2
    while len(published) < count and time.monotonic() < deadline:
        time.sleep(0.01)


def test_types_event_announced(space_dir: Path):
    _write(space_dir / "Servers" / "Beta.md", "---\ntype: 'Server'\ntitle: Beta\ncores: 4\n---\n")
    space = Space(space_dir)
    app = create_app(space, None, watch=False)
    published = []
    app.state.hub.publish = published.append
    with TestClient(app) as c:
        types = {t["id"]: t for t in c.get("/api/space").json()["types"]}
        server = types["server"]
        server["name"] = "Machine"
        r = c.put(
            "/api/types/server",
            json={"type": server, "baseRevision": server["revision"], "clientId": "w1"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"type", "rewritten", "skipped"}
        assert body["type"]["name"] == "Machine" and body["type"]["formerNames"] == ["Server"]
        assert body["type"]["revision"] == type_revision(space.root, "server")
        assert sorted(body["rewritten"]) == ["Servers/Alpha.md", "Servers/Beta.md"]
        _wait(published, 3)
        assert {(e.kind, e.path, e.origin) for e in published} == {
            ("types", "server", "w1"),
            ("changed", "Servers/Alpha.md", "w1"),
            ("changed", "Servers/Beta.md", "w1"),
        }

        # 428 until confirmed.
        machine = body["type"]
        machine["propertyDefinitions"] = [
            p for p in machine["propertyDefinitions"] if p["key"] != "cores"
        ]
        req = {"type": machine, "baseRevision": machine["revision"], "clientId": "w1"}
        r = c.put("/api/types/server", json=req)
        assert r.status_code == 428
        assert r.json()["affected"] == 2 and r.json()["detail"]
        r = c.put("/api/types/server", json={**req, "confirm": True})
        assert r.status_code == 200, r.text

        r = c.put(
            "/api/types/server",
            json={"type": {**r.json()["type"], "name": ""}, "baseRevision": r.json()["type"]["revision"]},
        )
        assert r.status_code == 422 and r.json()["detail"]

        published.clear()
        r = c.post("/api/types", json={"name": "Project", "pluralName": "Projects", "clientId": "w2"})
        assert r.status_code == 201, r.text
        _wait(published, 1)
        assert [(e.kind, e.path, e.origin) for e in published] == [("types", "project", "w2")]

        published.clear()
        r = c.delete("/api/types/server", params={"clientId": "w3"})
        assert r.status_code == 428 and r.json()["affected"] == 2
        assert c.delete("/api/types/task", params={"confirm": "true"}).status_code == 422
        assert c.delete("/api/types/nope", params={"confirm": "true"}).status_code == 404
        r = c.delete("/api/types/server", params={"confirm": "true", "clientId": "w3"})
        assert r.status_code == 200, r.text
        assert r.json()["trashId"]
        assert r.json()["typeIds"] == ["server"]
        assert sorted(r.json()["paths"]) == ["Servers/Alpha.md", "Servers/Beta.md"]
        _wait(published, 3)
        assert {(e.kind, e.path, e.origin) for e in published} == {
            ("types", "server", "w3"),
            ("deleted", "Servers/Alpha.md", "w3"),
            ("deleted", "Servers/Beta.md", "w3"),
        }
        ids = [t["id"] for t in c.get("/api/space").json()["types"]]
        assert "server" not in ids and "project" in ids


def test_external_type_edit_is_served_and_kept_by_the_next_save(space_dir: Path):
    space = Space(space_dir)
    client = TestClient(create_app(space, None, watch=False))
    t = space.create_type("Gadget", "Gadgets")
    path = space_dir / ".capacities" / "types" / f"{t.id}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["description"] = "Edited outside the app"
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    served = next(x for x in client.get("/api/space").json()["types"] if x["id"] == t.id)
    assert served["description"] == "Edited outside the app"
    assert served["revision"] == type_revision(space_dir, t.id)

    r = client.put(
        f"/api/types/{t.id}",
        json={"type": {**served, "color": "blue"}, "baseRevision": served["revision"]},
    )
    assert r.status_code == 200, r.text
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["description"] == "Edited outside the app"
    assert saved["color"] == "blue"


def test_tightened_relation_keeps_comments_and_quotes_of_kept_links(space_dir: Path):
    _group_type(space_dir)
    team = _write(
        space_dir / "Groups" / "Team.md",
        "---\ntype: 'Group'\nmembers:\n  - '[[Ada Lovelace]]'   # lead dev\n"
        '  - "[[Alpha]]"\n  - "[[Nobody]]"\n---\n',
    )
    space = Space(space_dir)
    t = _edit(space, "group")
    t.prop("members").options["allowedTypes"] = ["person"]
    _save(space, t, confirm=True)
    assert team.read_text(encoding="utf-8") == (
        "---\ntype: 'Group'\nmembers:\n  - '[[Ada Lovelace]]'   # lead dev\n"
        '  - "[[Nobody]]"\n---\n'
    )


def test_deleted_label_option_keeps_the_rest_of_the_list_bytes(space_dir: Path):
    _group_type(space_dir)
    team = _write(
        space_dir / "Groups" / "Team.md",
        "---\ntype: 'Group'\ntopics: ['A', \"B\", C]  # note\n---\n",
    )
    space = Space(space_dir)
    t = _edit(space, "group")
    t.prop("topics").options["set"] = [o for o in t.prop("topics").options["set"] if o["text"] != "C"]
    _save(space, t, confirm=True)
    assert team.read_text(encoding="utf-8") == "---\ntype: 'Group'\ntopics: ['A', \"B\"]  # note\n---\n"


def test_badly_shaped_property_options_are_422_not_500(space_dir: Path):
    _group_type(space_dir)
    space = Space(space_dir)
    client = TestClient(create_app(space, None, watch=False))
    served = next(x for x in client.get("/api/space").json()["types"] if x["id"] == "group")
    for bad in (
        {"allowedTypes": "server", "fixedSet": 5},
        {"numberFormat": "x"},
        {"set": ["A"]},
        {"propertySyncing": {"propertyIds": "x"}},
    ):
        props = [
            {**p, "options": {**p["options"], **bad}} if p["key"] == "members" else p
            for p in served["propertyDefinitions"]
        ]
        r = client.put(
            "/api/types/group",
            json={"type": {**served, "propertyDefinitions": props}, "baseRevision": served["revision"]},
        )
        assert r.status_code == 422, (bad, r.text)
        assert "Invalid options for Members" in r.json()["detail"]


def test_badly_shaped_options_in_a_type_file_are_normalised_on_load(space_dir: Path):
    _group_type(space_dir)
    path = space_dir / ".capacities" / "types" / "group.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    for p in data["propertyDefinitions"]:
        if p["key"] == "members":
            p["options"].update(allowedTypes="server", fixedSet=5, numberFormat="x")
    path.write_text(json.dumps(data), encoding="utf-8")
    members = Space(space_dir).type_by_id("group").prop("members")
    assert members.options["allowedTypes"] == []
    assert members.options["fixedSet"] == []
    assert "numberFormat" not in members.options
