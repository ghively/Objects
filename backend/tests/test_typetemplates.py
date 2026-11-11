"""Polish item 21: the "Add new object type" gallery (the starter type templates)."""

import json
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.typetemplates import (
    TEMPLATE_KEYS,
    TEMPLATE_QUERIES,
    template_catalog,
    template_query_fixture,
)

GALLERY = (
    "meeting", "person", "project", "atomicNote", "definition", "book", "film", "tvSeries",
    "podcast", "week", "month",
    # M28: the IT ops entries (`test_m28_gallery.py`).
    "host", "software", "application", "container", "configuration", "location", "network",
    "vendor", "script", "command", "runbook", "prompt", "incident",
    "organization", "area",
)  # fmt: skip


def _stored(space_dir: Path, type_id: str) -> dict:
    return json.loads((space_dir / ".object" / "types" / f"{type_id}.json").read_text("utf-8"))


def test_the_gallery_has_the_starter_templates_in_order():
    assert TEMPLATE_KEYS == GALLERY
    cat = template_catalog([])
    assert [c["name"] for c in cat][:3] == ["Meeting", "Person", "Project"]
    # Fix pass 2026-11-09: no Day template (the built-in daily note is the one note per day);
    # Week and Month are for periodic reviews.
    assert all(c["name"] != "Day" for c in cat)
    week = next(c for c in cat if c["key"] == "week")
    assert week["pluralName"] == "Weeks" and week["section"] == "planningAndReflection"
    assert week["description"] == "One entry per week, for weekly reviews and plans. Daily notes already cover each day."
    assert [p["name"] for p in week["properties"]] == ["Date", "Notes"]
    month = next(c for c in cat if c["key"] == "month")
    assert month["description"] == "One entry per month, for monthly reviews and plans."
    assert [p["name"] for p in month["properties"]] == ["Date", "Notes"]
    assert {c["section"] for c in cat} == {
        "useCases", "research", "media", "planningAndReflection", "itOperations", None
    }


def test_a_day_type_made_from_the_old_template_keeps_working(tmp_path: Path):
    """A space whose Day type was made from the gallery's Day template (its file carries
    ``templateKey: day`` and its own definitions) opens and lists as before; the gallery just no
    longer offers it, so nothing new is made from the key."""
    space_dir = tmp_path / "s"
    space_dir.mkdir()
    sp = Space(space_dir)
    t = sp.create_type("Day", "Days")
    file = space_dir / ".object" / "types" / f"{t.id}.json"
    data = _stored(space_dir, t.id)
    data["templateKey"] = "day"
    file.write_text(json.dumps(data), "utf-8")
    reopened = Space(space_dir)
    day = reopened.type_by_id(t.id)
    assert day is not None and day.extra["templateKey"] == "day"
    assert [p["name"] for p in template_catalog(list(reopened.types)) if p["added"]] == []
    with pytest.raises(InvalidValue, match='Unknown object type template "day"'):
        reopened.create_type("", "", template="day")


@pytest.mark.parametrize("key", GALLERY)
def test_create_from_each_template(tmp_path: Path, key: str):
    space_dir = tmp_path / "empty"
    space_dir.mkdir()
    sp = Space(space_dir)
    t = sp.create_type("", "", template=key)
    data = _stored(space_dir, t.id)
    assert data["templateKey"] == key
    assert any(p["type"] == "blocks" for p in data["propertyDefinitions"])
    assert [p["key"] for p in data["propertyDefinitions"]][0] == "title"
    # every property key is unique
    keys = [p["key"] for p in data["propertyDefinitions"]]
    assert len(keys) == len(set(keys))


def _allowed(t, key):
    return next(p for p in t.propertyDefinitions if p.key == key).options["allowedTypes"]


def test_template_relations_point_at_the_type_named_like_their_target(space_dir: Path):
    sp = Space(space_dir)  # the sample space has a "Person" type, but no Project or Meeting type
    org = sp.create_type("", "", template="organization")
    assert _allowed(org, "people") == ["person"]
    assert _allowed(org, "projects") == []  # no Project type: any type
    meeting = sp.create_type("", "", template="meeting")
    assert _allowed(meeting, "attendees") == ["person"]
    film = sp.create_type("", "", template="film")
    assert _allowed(film, "director") == ["person"]
    week = sp.create_type("", "", template="week")
    assert all(p.type != "entity" for p in week.propertyDefinitions)


def test_template_relations_find_types_made_from_a_template(space_dir: Path):
    sp = Space(space_dir)
    meeting = sp.create_type("", "", template="meeting")
    assert meeting.extra["templateKey"] == "meeting"
    assert _allowed(meeting, "project") == []
    project = sp.create_type("", "", template="project")
    assert _allowed(project, "meetings") == [meeting.id]


def test_template_without_target_allows_any_type(tmp_path: Path):
    root = tmp_path / "empty"
    root.mkdir()
    sp = Space(root)
    film = sp.create_type("", "", template="film")
    assert _allowed(film, "director") == []


def test_template_name_in_use_is_refused(space_dir: Path):
    sp = Space(space_dir)
    sp.create_type("", "", template="area")
    with pytest.raises(InvalidValue):
        sp.create_type("", "", template="area")


def test_unknown_template_is_refused(space_dir: Path):
    with pytest.raises(InvalidValue):
        Space(space_dir).create_type("", "", template="nope")


def test_api_gallery_and_create(space_dir: Path):
    with TestClient(create_app(Space(space_dir), None, watch=False)) as c:
        gallery = c.get("/api/type-gallery").json()
        assert [g["key"] for g in gallery] == list(GALLERY)
        assert not next(g for g in gallery if g["key"] == "film")["added"]
        r = c.post("/api/types", json={"template": "film"})
        assert r.status_code == 201, r.text
        assert r.json()["name"] == "Film" and r.json()["templateKey"] == "film"
        gallery = c.get("/api/type-gallery").json()
        assert next(g for g in gallery if g["key"] == "film")["added"]
        assert c.post("/api/types", json={"template": "film"}).status_code == 422


# -- the templates' saved queries ---------------------------------------------------

# The filter operators per property kind (the frontend's FILTER_OPTIONS, the ones used here).
_OPS = {
    "datetime": {"is", "isNotEmpty", "isEmpty", "startIsNotEmpty", "endIsEmpty", "endIsNotEmpty"},
    "label": {"contains", "notContains", "isEmpty", "isNotEmpty"},
    "number": {"equal", "notEqual", "greaterEqual", "greater", "smallerEqual", "smaller"},
}
_SORTS = {"ascending", "descending", "ascendingExists", "descendingExists"}
_LAYOUTS = {"list", "grid", "wall", "table", "embed", "kanban"}

FIXTURE = Path(__file__).parents[2] / "frontend" / "src" / "types" / "templateQueries.fixture.json"


def _queries(space_dir: Path) -> list[dict]:
    qdir = space_dir / ".object" / "queries"
    return [json.loads(p.read_text("utf-8")) for p in sorted(qdir.glob("*.json"))] if qdir.is_dir() else []


def test_every_template_has_a_query():
    assert set(TEMPLATE_QUERIES) == set(GALLERY)


@pytest.mark.parametrize("key", GALLERY)
def test_template_creates_one_valid_query(tmp_path: Path, key: str):
    space_dir = tmp_path / "s"
    space_dir.mkdir()
    sp = Space(space_dir)
    t = sp.create_type("", "", template=key)
    [q] = _queries(space_dir)
    assert q["name"] == TEMPLATE_QUERIES[key].name and q["titleIsCustom"] is True
    d = q["definition"]
    assert d["types"] == [{"id": t.id}]
    props = {p.key: p for p in t.propertyDefinitions}
    for f in d["filterGroup"]["elements"]:
        assert f["type"] == "filter" and f["typeId"] == t.id
        p = props[f["propertyId"]]  # only properties the template created
        assert f["option"] in _OPS[p.type], (p.type, f["option"])
        if p.type == "label":
            ids = {o["id"] for o in p.options["set"]}
            assert f["referenceValue"] and set(f["referenceValue"]) <= ids
    for s in d["sorts"]:
        assert s["propertyId"] in props and s["option"] in _SORTS
    assert q["view"]["viewDefinition"]["dataViewLayout"] in _LAYOUTS
    # it reads back as a valid query
    # M22: a Project is a work type, so the built-in Tickets view lists beside it.
    [loaded] = [x for x in sp.list_queries() if x.id != "work-tickets"]
    assert loaded.readOnlyReason is None and loaded.definition == d


def test_a_blank_type_creates_no_query(tmp_path: Path):
    space_dir = tmp_path / "s"
    space_dir.mkdir()
    Space(space_dir).create_type("Machine", "Machines")
    assert _queries(space_dir) == []
    assert not (space_dir / ".object" / "queries").exists()


def test_api_create_from_template_lists_its_query(space_dir: Path):
    with TestClient(create_app(Space(space_dir), None, watch=False)) as c:
        before = {q["id"] for q in c.get("/api/queries").json()}
        assert c.post("/api/types", json={"template": "book"}).status_code == 201
        new = [q for q in c.get("/api/queries").json() if q["id"] not in before]
        assert [q["name"] for q in new] == ["Currently reading"]
        before = {q["id"] for q in c.get("/api/queries").json()}
        assert c.post("/api/types", json={"name": "Gadget", "pluralName": "Gadgets"}).status_code == 201
        assert {q["id"] for q in c.get("/api/queries").json()} == before


def test_the_frontend_fixture_matches_the_templates():
    """The frontend evaluates each template's query on rows (`templateQueries.test.ts`) from this
    fixture. Regenerate with ``OBJECT_WRITE_FIXTURES=1``."""
    fresh = json.dumps(template_query_fixture(), indent=2, ensure_ascii=False) + "\n"
    if os.environ.get("OBJECT_WRITE_FIXTURES") == "1":
        FIXTURE.write_text(fresh, "utf-8", newline="\n")
    assert json.loads(FIXTURE.read_text("utf-8")) == json.loads(fresh)


# -- a template query that can't be built never half-creates the type ---------------


def test_a_template_query_with_a_missing_option_still_creates_the_type(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    from objectapp import typetemplates
    from objectapp.typetemplates import Option, TemplateQuery

    broken = TemplateQuery("Lost projects", (("status", "contains", Option("No such option")),))
    monkeypatch.setitem(typetemplates.TEMPLATE_QUERIES, "project", broken)
    space_dir = tmp_path / "s"
    space_dir.mkdir()
    sp = Space(space_dir)
    app = create_app(sp, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    with TestClient(app) as c:
        r = c.post("/api/types", json={"template": "project", "clientId": "w1"})
        assert r.status_code == 201, r.text
        type_id = r.json()["id"]
        deadline = time.monotonic() + 2
        while not published and time.monotonic() < deadline:
            time.sleep(0.01)
        assert ("types", type_id, "w1") in {(e.kind, e.path, e.origin) for e in published}
        assert any(t["id"] == type_id for t in c.get("/api/space").json()["types"])
        # M32: Work is off for this space: its Project has no ticket field and no Tickets view.
        assert [q["id"] for q in c.get("/api/queries").json()] == []
    assert _stored(space_dir, type_id)["templateKey"] == "project"
    assert _queries(space_dir) == []
    assert "Lost projects" in caplog.text


def test_re_adding_a_deleted_template_type_does_not_duplicate_its_query(tmp_path: Path):
    space_dir = tmp_path / "s"
    space_dir.mkdir()
    sp = Space(space_dir)
    t = sp.create_type("", "", template="book")
    sp.delete_type(t.id, confirm=True)
    # Its query (of only this type) went to the Trash with it.
    assert _queries(space_dir) == []
    again = sp.create_type("", "", template="book")
    assert again.id == t.id
    assert [q["name"] for q in _queries(space_dir)] == ["Currently reading"]
    # A query of that name already over the id (here: a file put back by hand) is not made twice.
    sp.delete_type(again.id, confirm=True)
    (space_dir / ".object" / "queries" / "by-hand.json").write_text(
        json.dumps({"name": "Currently reading", "definition": {"types": [{"id": t.id}]}}),
        encoding="utf-8",
    )
    sp.create_type("", "", template="book")
    assert [q["name"] for q in _queries(space_dir)] == ["Currently reading"]


def test_a_same_named_query_of_another_type_does_not_block_the_template_query(tmp_path: Path):
    space_dir = tmp_path / "s"
    space_dir.mkdir()
    sp = Space(space_dir)
    sp.create_query("Currently reading", {"types": [{"id": "page"}]})
    sp.create_type("", "", template="book")
    assert [q["name"] for q in _queries(space_dir)] == ["Currently reading"] * 2


def test_a_template_query_the_space_refuses_still_creates_the_type(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    def refuse(self, definition, stored_type_ids):
        raise InvalidValue("refused")

    monkeypatch.setattr(Space, "_check_query_definition", refuse)
    space_dir = tmp_path / "s"
    space_dir.mkdir()
    sp = Space(space_dir)
    t = sp.create_type("", "", template="book")
    assert sp.type_by_id(t.id) is not None
    assert _stored(space_dir, t.id)["templateKey"] == "book"
    assert _queries(space_dir) == []
