"""Polish item 21: the "Add new object type" gallery (Capacities' type templates)."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.typetemplates import TEMPLATE_KEYS, template_catalog

GALLERY = (
    "meeting", "person", "project", "atomicNote", "definition", "book", "film", "tvSeries",
    "podcast", "day", "week", "month", "organization", "area",
)  # fmt: skip


def _stored(space_dir: Path, type_id: str) -> dict:
    return json.loads((space_dir / ".capacities" / "types" / f"{type_id}.json").read_text("utf-8"))


def test_the_gallery_has_capacities_templates_in_order():
    assert TEMPLATE_KEYS == GALLERY
    cat = template_catalog([])
    assert [c["name"] for c in cat][:3] == ["Meeting", "Person", "Project"]
    day = next(c for c in cat if c["key"] == "day")
    assert day["pluralName"] == "Days"
    assert day["description"] == "Log a day with energy, mood, and what stood out."
    assert [p["name"] for p in day["properties"]] == [
        "Date", "Energy", "Mood", "Highlight of the day", "Grateful For", "Content",
    ]  # fmt: skip
    assert {c["section"] for c in cat} == {"useCases", "research", "media", "planningAndReflection", None}


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
    day = sp.create_type("", "", template="day")
    assert all(p.type != "entity" for p in day.propertyDefinitions)


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
