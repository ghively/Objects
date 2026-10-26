"""Property kind change and two-way linking (Task 6)."""

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.frontmatter import parse_fm
from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import NO_TRANSFORMATIONS, Space
from objectapp.typemodel import RevisionConflict, type_revision

from test_types_api import _changed_lines, _snapshot, _type_file, _write


def _project_type(space_dir: Path, **lead_options) -> None:
    """A tmp `Project` type: text `budget`, multi relation `lead` to Person, a `blocks` body."""
    types = space_dir / ".capacities" / "types"
    types.mkdir(parents=True, exist_ok=True)
    lead = {"isArray": True, "allowedTypes": ["person"], "hasFixedSet": False, "fixedSet": []}
    lead.update(lead_options)
    data = {
        "schemaVersion": 2,
        "id": "project",
        "name": "Project",
        "pluralName": "Projects",
        "folder": "Projects",
        "propertyDefinitions": [
            {"id": "budget", "key": "budget", "name": "Budget", "type": "text",
             "description": "Money", "icon": {"type": "iconify", "val": "ph-coins"}},
            {"id": "lead", "key": "lead", "name": "Lead", "type": "entity", "options": lead},
            {"id": "notes", "key": "notes", "name": "Notes", "type": "blocks"},
            {"id": "stage", "key": "stage", "name": "Stage", "type": "entity",
             "options": {"isArray": True, "allowedTypes": [], "hasFixedSet": False,
                         "fixedSet": []}},
        ],
    }
    (types / "project.json").write_bytes((json.dumps(data, indent=2) + "\n").encode())


def _rev(space: Space, type_id: str) -> str:
    return type_revision(space.root, type_id)


# -- change kind -----------------------------------------------------------------


def test_change_kind_creates_new_property_and_keeps_old(space_dir: Path):
    _project_type(space_dir)
    p1 = _write(space_dir / "Projects" / "P1.md",
                "---\ntype: 'Project'\ntitle: P1\nbudget: '1200.5'\n---\n")
    p2 = _write(space_dir / "Projects" / "P2.md",
                "---\ntype: 'Project'\ntitle: P2\nbudget: n/a\n---\n")
    p3 = _write(space_dir / "Projects" / "P3.md", "---\ntype: 'Project'\ntitle: P3\n---\n")
    before = {p: p.read_bytes() for p in (p1, p2, p3)}
    space = Space(space_dir)

    result = space.change_property_kind("project", "budget", "number", _rev(space, "project"))

    keys = [p.key for p in result.type.propertyDefinitions]
    assert keys[keys.index("budget") + 1] == "budget_"
    new = result.type.prop("budget_")
    assert new.id == result.newPropertyId and new.id != "budget"
    assert (new.name, new.type, new.description, new.icon.val) == (
        "Budget", "number", "Money", "ph-coins"
    )
    assert result.type.prop("budget").type == "text"  # the old property stays
    assert result.lossy == 1
    assert result.rewritten == ["Projects/P1.md"] and result.skipped == []
    # One added line, unstamped; every `budget:` line unchanged.
    assert _changed_lines(before[p1], p1.read_bytes()) == ([], ["budget_: 1200.5\n"])
    assert p2.read_bytes() == before[p2] and p3.read_bytes() == before[p3]
    assert parse_fm(p1.read_bytes().decode().split("---\n")[1])["budget_"] == 1200.5
    stored = json.loads(_type_file(space_dir, "project").read_text(encoding="utf-8"))
    assert [p["key"] for p in stored["propertyDefinitions"]] == keys
    assert result.revision == _rev(space, "project")
    assert space.type_by_id("project").prop("budget_") is not None

    # A second change of the same property takes the next free key.
    again = space.change_property_kind("project", "budget", "textBlock", _rev(space, "project"))
    assert again.type.prop("budget_2").type == "textBlock"


def test_change_kind_not_allowed_422(space_dir: Path):
    _project_type(space_dir)
    space = Space(space_dir)
    before = _snapshot(space_dir)
    with pytest.raises(InvalidValue) as err:
        space.change_property_kind("project", "notes", "number", _rev(space, "project"))
    assert str(err.value) == NO_TRANSFORMATIONS
    with pytest.raises(InvalidValue):
        space.change_property_kind("project", "budget", "text", _rev(space, "project"))
    with pytest.raises(InvalidValue):  # basic types keep their properties
        space.change_property_kind("task", "status", "text", _rev(space, "task"))
    assert _snapshot(space_dir) == before


def test_change_kind_stale_revision_409(space_dir: Path):
    _project_type(space_dir)
    space = Space(space_dir)
    with pytest.raises(RevisionConflict):
        space.change_property_kind("project", "budget", "number", "stale")
    with pytest.raises(KeyError):
        space.change_property_kind("project", "nope", "number", _rev(space, "project"))


def test_change_kind_entity_to_label_builds_options(space_dir: Path):
    _project_type(space_dir)
    p1 = _write(space_dir / "Projects" / "P1.md",
                "---\ntype: 'Project'\ntitle: P1\nstage: ['[[Draft]]', '[[Review]]']\n---\n")
    p2 = _write(space_dir / "Projects" / "P2.md",
                "---\ntype: 'Project'\ntitle: P2\nstage: '[[draft]]'\n---\n")
    space = Space(space_dir)

    result = space.change_property_kind("project", "stage", "label", _rev(space, "project"))

    new = result.type.prop("stage_")
    assert new.type == "label" and new.options["isArray"] is True
    texts = [o["text"] for o in new.options["set"]]
    assert texts == ["Draft", "Review"]
    assert all(o["id"] and o["color"] for o in new.options["set"])
    assert sorted(result.rewritten) == ["Projects/P1.md", "Projects/P2.md"]
    assert "stage_: [Draft, Review]\n" in p1.read_text()
    assert "stage_: [Draft]\n" in p2.read_text()
    assert "stage: ['[[Draft]]', '[[Review]]']\n" in p1.read_text()


# -- two-way linking -------------------------------------------------------------


def test_sync_requires_multi_without_fixed_set_422(space_dir: Path):
    for options in ({"isArray": False}, {"hasFixedSet": True}):
        _project_type(space_dir, **options)
        space = Space(space_dir)
        with pytest.raises(InvalidValue, match="multi-select"):
            space.set_property_sync(
                "project", "lead", None, create_name="Projects",
                base_revision=_rev(space, "project"),
            )


def test_sync_not_allowed_for_basic_types_422(space_dir: Path):
    _project_type(space_dir, allowedTypes=["task"])
    space = Space(space_dir)
    with pytest.raises(InvalidValue, match="basic object types"):
        space.set_property_sync(
            "project", "lead", None, create_name="Projects", base_revision=_rev(space, "project")
        )
    _project_type(space_dir, allowedTypes=[])
    space = Space(space_dir)
    with pytest.raises(InvalidValue, match="basic object types"):
        space.set_property_sync(
            "project", "lead", None, create_name="Projects", base_revision=_rev(space, "project")
        )


def test_sync_creates_counterpart(space_dir: Path):
    _project_type(space_dir)
    space = Space(space_dir)

    result = space.set_property_sync(
        "project", "lead", None, create_name="Projects", base_revision=_rev(space, "project")
    )

    by_id = {t.id: t for t in result.types}
    assert set(by_id) == {"project", "person"}
    counterpart = by_id["person"].prop("projects")
    assert counterpart is not None and counterpart.name == "Projects"
    assert counterpart.type == "entity"
    assert counterpart.options["isArray"] is True
    assert counterpart.options["allowedTypes"] == ["project"]
    assert counterpart.options["propertySyncing"] == {"propertyIds": ["lead"]}
    assert by_id["project"].prop("lead").options["propertySyncing"] == {
        "propertyIds": [counterpart.id]
    }
    person = json.loads(_type_file(space_dir, "person").read_text(encoding="utf-8"))
    assert any(p["key"] == "projects" for p in person["propertyDefinitions"])
    project = json.loads(_type_file(space_dir, "project").read_text(encoding="utf-8"))
    lead = next(p for p in project["propertyDefinitions"] if p["key"] == "lead")
    assert lead["options"]["propertySyncing"] == {"propertyIds": [counterpart.id]}
    assert result.rewritten == [] and result.skipped == []

    # Linking an edit now syncs through the new counterpart.
    p9 = _write(space_dir / "Projects" / "P9.md", "---\ntype: 'Project'\ntitle: P9\n---\n")
    space.rescan_file("Projects/P9.md")
    version = space.cached_version("Projects/P9.md")
    out = space.update_properties("Projects/P9.md", {"lead": ["Ada Lovelace"]}, version)
    assert out.synced == ["People/Ada Lovelace.md"]
    assert "projects: ['[[P9]]']" in (space_dir / "People" / "Ada Lovelace.md").read_text()
    assert p9.exists()

    # Unlinking clears both sides and rewrites nothing.
    before = _snapshot(space_dir)
    off = space.set_property_sync("project", "lead", None, base_revision=_rev(space, "project"))
    assert off.rewritten == []
    by_id = {t.id: t for t in off.types}
    assert "propertySyncing" not in by_id["project"].prop("lead").options
    assert by_id["person"].prop("projects").options.get("propertySyncing", {}).get(
        "propertyIds", []
    ) == []
    after = _snapshot(space_dir)
    changed = {k for k in after if after[k] != before.get(k)}
    assert changed == {".capacities/types/project.json", ".capacities/types/person.json"}


def test_sync_with_existing_target_property(space_dir: Path):
    _project_type(space_dir)
    space = Space(space_dir)
    space.set_property_sync(
        "project", "lead", None, create_name="Led", base_revision=_rev(space, "project")
    )
    led = space.type_by_id("person").prop("led")
    space.set_property_sync("project", "lead", None, base_revision=_rev(space, "project"))
    result = space.set_property_sync(
        "project", "lead", led.id, base_revision=_rev(space, "project")
    )
    by_id = {t.id: t for t in result.types}
    assert by_id["project"].prop("lead").options["propertySyncing"] == {"propertyIds": [led.id]}
    assert by_id["person"].prop("led").options["propertySyncing"] == {"propertyIds": ["lead"]}
    # A target that isn't a multi relation back to Project is refused.
    with pytest.raises(InvalidValue):
        space.set_property_sync(
            "project", "lead", "website", base_revision=_rev(space, "project")
        )
    with pytest.raises(KeyError):
        space.set_property_sync("project", "lead", "nope", base_revision=_rev(space, "project"))


def test_sync_backfills_existing_links(space_dir: Path):
    _project_type(space_dir)
    p1 = _write(space_dir / "Projects" / "Apollo.md",
                "---\ntype: 'Project'\ntitle: Apollo\nlead: ['[[Ada Lovelace]]']\n---\n")
    _write(space_dir / "Projects" / "Gemini.md",
           "---\ntype: 'Project'\ntitle: Gemini\nlead: ['[[Ada Lovelace]]', '[[Nobody]]']\n---\n")
    ada = space_dir / "People" / "Ada Lovelace.md"
    ada_before = ada.read_bytes()
    p1_before = p1.read_bytes()
    space = Space(space_dir)

    result = space.set_property_sync(
        "project", "lead", None, create_name="Projects", base_revision=_rev(space, "project")
    )

    assert result.rewritten == ["People/Ada Lovelace.md"] and result.skipped == []
    # One added line, no lastUpdated stamp.
    assert _changed_lines(ada_before, ada.read_bytes()) == (
        [], ["projects: ['[[Apollo]]', '[[Gemini]]']\n"]
    )
    assert p1.read_bytes() == p1_before


def test_sync_backfill_skips_readonly(space_dir: Path):
    _project_type(space_dir)
    _write(space_dir / "Projects" / "Apollo.md",
           "---\ntype: 'Project'\ntitle: Apollo\nlead: ['[[Ada Lovelace]]']\n---\n")
    ada = _write(space_dir / "People" / "Ada Lovelace.md",
                 "---\ntype: 'Person'\ntitle: [Ada Lovelace\n---\n")
    _write(space_dir / "People" / "Grace Hopper.md", "---\ntype: 'Person'\ntitle: Grace Hopper\n---\n")
    before = ada.read_bytes()
    space = Space(space_dir)

    result = space.set_property_sync(
        "project", "lead", None, create_name="Projects", base_revision=_rev(space, "project")
    )

    assert result.rewritten == []
    assert [s.path for s in result.skipped] == ["People/Ada Lovelace.md"]
    assert result.skipped[0].reason
    assert ada.read_bytes() == before
    # The definitions are linked anyway.
    assert space.type_by_id("person").prop("projects") is not None


def test_sync_stale_revision_409(space_dir: Path):
    _project_type(space_dir)
    space = Space(space_dir)
    with pytest.raises(RevisionConflict):
        space.set_property_sync("project", "lead", None, create_name="X", base_revision="stale")


# -- routes ----------------------------------------------------------------------


def _wait(published: list, count: int) -> None:
    deadline = time.monotonic() + 2
    while len(published) < count and time.monotonic() < deadline:
        time.sleep(0.01)


def test_kind_and_sync_routes(space_dir: Path):
    _project_type(space_dir)
    _write(space_dir / "Projects" / "Apollo.md",
           "---\ntype: 'Project'\ntitle: Apollo\nbudget: '7'\nlead: ['[[Ada Lovelace]]']\n---\n")
    space = Space(space_dir)
    app = create_app(space, None, watch=False)
    published = []
    app.state.hub.publish = published.append
    with TestClient(app) as c:
        url = "/api/types/project/properties/budget/change-kind"
        r = c.post(url, json={"toType": "number", "baseRevision": "stale"})
        assert r.status_code == 409 and r.json()["currentRevision"] == _rev(space, "project")
        r = c.post("/api/types/project/properties/notes/change-kind",
                   json={"toType": "number", "baseRevision": _rev(space, "project")})
        assert r.status_code == 422 and r.json()["detail"] == NO_TRANSFORMATIONS

        r = c.post(url, json={"toType": "number", "baseRevision": _rev(space, "project"),
                              "clientId": "w1"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"type", "newPropertyId", "rewritten", "skipped", "lossy"}
        assert body["type"]["revision"] == _rev(space, "project")
        assert body["rewritten"] == ["Projects/Apollo.md"] and body["lossy"] == 0
        assert any(p["id"] == body["newPropertyId"] for p in body["type"]["propertyDefinitions"])
        _wait(published, 2)
        assert {(e.kind, e.path, e.origin) for e in published} == {
            ("types", "project", "w1"),
            ("changed", "Projects/Apollo.md", "w1"),
        }

        published.clear()
        url = "/api/types/project/properties/lead/sync"
        r = c.post(url, json={"targetPropertyId": None, "createName": "Projects",
                              "baseRevision": _rev(space, "project"), "clientId": "w2"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"types", "rewritten", "skipped"}
        assert {t["id"] for t in body["types"]} == {"project", "person"}
        assert all(t["revision"] == _rev(space, t["id"]) for t in body["types"])
        assert body["rewritten"] == ["People/Ada Lovelace.md"]
        _wait(published, 3)
        assert {(e.kind, e.path, e.origin) for e in published} == {
            ("types", "project", "w2"),
            ("types", "person", "w2"),
            ("changed", "People/Ada Lovelace.md", "w2"),
        }
        r = c.post("/api/types/project/properties/stage/sync",
                   json={"targetPropertyId": None, "createName": "X",
                         "baseRevision": _rev(space, "project")})
        assert r.status_code == 422 and r.json()["detail"]
        r = c.post("/api/types/nope/properties/x/sync",
                   json={"targetPropertyId": None, "baseRevision": ""})
        assert r.status_code == 404
