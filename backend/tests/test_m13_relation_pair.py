"""M13: the sub-items and dependencies relation pairs (``POST /api/types/{id}/relation-pair``)."""

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.frontmatter import parse_fm
from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import SYNC_MULTI_ONLY, SYNC_NOT_ALLOWED, Space
from objectapp.typemodel import RevisionConflict, type_revision

from test_types_api import _changed_lines, _type_file, _write

STAMP = "lastUpdated: 2026-10-01T08:00:00.000Z\n"


def _story_type(space_dir: Path, extra: list[dict] | None = None) -> None:
    """A tmp `Story` type (folder `Stories`) with a text `points`."""
    types = space_dir / ".object" / "types"
    types.mkdir(parents=True, exist_ok=True)
    data = {
        "schemaVersion": 2,
        "id": "story",
        "name": "Story",
        "pluralName": "Stories",
        "folder": "Stories",
        "propertyDefinitions": [
            {"id": "points", "key": "points", "name": "Points", "type": "text"},
            *(extra or []),
        ],
    }
    (types / "story.json").write_bytes((json.dumps(data, indent=2) + "\n").encode())


def _story(space_dir: Path, title: str, extra: str = "") -> Path:
    oid = f"01JM13STORY{title.upper():0>15}"[:26]
    return _write(
        space_dir / "Stories" / f"{title}.md",
        f"---\nid: {oid}\ntype: 'Story'\ntitle: {title}\npoints: '3'\n{extra}"
        f"createdAt: 2026-10-01T08:00:00.000Z\n{STAMP}---\nBody of {title}.\n",
    )


def _rev(space: Space, type_id: str = "story") -> str:
    return type_revision(space.root, type_id)


def _md(space_dir: Path) -> dict[str, bytes]:
    return {p.relative_to(space_dir).as_posix(): p.read_bytes() for p in sorted(space_dir.rglob("*.md"))}


def _entity(prop) -> tuple[str, bool, list, bool]:
    o = prop.options
    return prop.type, o.get("isArray"), o.get("allowedTypes"), o.get("hasFixedSet")


# -- space ------------------------------------------------------------------------


def test_sub_items_pair_is_added_and_synced_without_rewriting_objects(space_dir: Path):
    _story_type(space_dir)
    _story(space_dir, "A")
    _story(space_dir, "B")
    space = Space(space_dir)
    before = _md(space_dir)

    result = space.create_relation_pair("story", "subItems", _rev(space))

    assert result.created is True
    t = result.type
    parent = next(p for p in t.propertyDefinitions if p.id == result.firstId)
    children = next(p for p in t.propertyDefinitions if p.id == result.secondId)
    assert (parent.name, children.name) == ("Parent item", "Sub-items")
    assert (parent.key, children.key) == ("parentItem", "subItems")
    assert _entity(parent) == ("entity", False, ["story"], False)
    assert _entity(children) == ("entity", True, ["story"], False)
    assert parent.options["propertySyncing"] == {"propertyIds": [children.id]}
    assert children.options["propertySyncing"] == {"propertyIds": [parent.id]}
    stored = json.loads(_type_file(space_dir, "story").read_text(encoding="utf-8"))
    assert [p["name"] for p in stored["propertyDefinitions"]] == ["Points", "Parent item", "Sub-items"]
    assert result.revision == _rev(space)
    assert _md(space_dir) == before  # no object rewritten
    # The single side is a valid synced property (a later save of the type keeps it).
    assert space.sync_problem(t, parent) is None
    assert space.sync_problem(t, children) is None


def test_second_call_reuses_the_pair_and_writes_nothing(space_dir: Path):
    _story_type(space_dir)
    space = Space(space_dir)
    first = space.create_relation_pair("story", "dependencies", _rev(space))
    assert first.created is True
    blocked = next(p for p in first.type.propertyDefinitions if p.id == first.firstId)
    blocking = next(p for p in first.type.propertyDefinitions if p.id == first.secondId)
    assert (blocked.name, blocked.key, blocking.name, blocking.key) == (
        "Blocked by", "blockedBy", "Blocking", "blocking"
    )
    assert _entity(blocked) == ("entity", True, ["story"], False)
    assert _entity(blocking) == ("entity", True, ["story"], False)
    type_bytes = _type_file(space_dir, "story").read_bytes()
    rev = _rev(space)

    again = space.create_relation_pair("story", "dependencies", rev)

    assert again.created is False and again.changed is False
    assert (again.firstId, again.secondId) == (first.firstId, first.secondId)
    assert again.revision == rev
    assert _type_file(space_dir, "story").read_bytes() == type_bytes
    # Both kinds live side by side.
    both = space.create_relation_pair("story", "subItems", rev)
    names = [p.name for p in both.type.propertyDefinitions]
    assert names == ["Points", "Blocked by", "Blocking", "Parent item", "Sub-items"]


def test_existing_matching_properties_are_linked_not_duplicated(space_dir: Path):
    _story_type(space_dir, [
        {"id": "dep1", "key": "deps", "name": "blocked  BY", "type": "entity",
         "options": {"isArray": True, "allowedTypes": ["story"], "hasFixedSet": False, "fixedSet": []}},
    ])
    space = Space(space_dir)
    result = space.create_relation_pair("story", "dependencies", _rev(space))
    assert result.firstId == "dep1" and result.created is True
    t = result.type
    assert [p.key for p in t.propertyDefinitions] == ["points", "deps", "blocking"]
    assert t.prop("deps").options["propertySyncing"] == {"propertyIds": [result.secondId]}
    assert t.prop("deps").name == "blocked  BY"  # reused as it is

    # Both there but unlinked: linked, nothing added.
    _story_type(space_dir, [
        {"id": "p1", "key": "up", "name": "Parent item", "type": "entity",
         "options": {"isArray": False, "allowedTypes": ["story"], "hasFixedSet": False, "fixedSet": []}},
        {"id": "c1", "key": "down", "name": "Sub-items", "type": "entity",
         "options": {"isArray": True, "allowedTypes": ["story"], "hasFixedSet": False, "fixedSet": []}},
    ])
    space = Space(space_dir)
    result = space.create_relation_pair("story", "subItems", _rev(space))
    assert (result.firstId, result.secondId, result.created, result.changed) == ("p1", "c1", False, True)
    assert result.type.prop("up").options["propertySyncing"] == {"propertyIds": ["c1"]}


@pytest.mark.parametrize("prop", [
    {"id": "x", "key": "x", "name": "Blocking", "type": "text"},
    {"id": "x", "key": "x", "name": "Blocking", "type": "entity",
     "options": {"isArray": True, "allowedTypes": ["page"], "hasFixedSet": False, "fixedSet": []}},
    {"id": "x", "key": "x", "name": "Blocking", "type": "entity",
     "options": {"isArray": False, "allowedTypes": ["story"], "hasFixedSet": False, "fixedSet": []}},
    {"id": "x", "key": "x", "name": "Blocking", "type": "entity",
     "options": {"isArray": True, "allowedTypes": ["story"], "hasFixedSet": False, "fixedSet": [],
                 "propertySyncing": {"propertyIds": ["other"]}}},
])
def test_same_named_property_that_does_not_match_is_422(space_dir: Path, prop: dict):
    _story_type(space_dir, [prop])
    space = Space(space_dir)
    type_bytes = _type_file(space_dir, "story").read_bytes()
    with pytest.raises(InvalidValue, match='"Blocking"'):
        space.create_relation_pair("story", "dependencies", _rev(space))
    assert _type_file(space_dir, "story").read_bytes() == type_bytes


def test_refusals(space_dir: Path):
    _story_type(space_dir)
    space = Space(space_dir)
    type_bytes = _type_file(space_dir, "story").read_bytes()
    with pytest.raises(RevisionConflict) as exc:
        space.create_relation_pair("story", "subItems", "stale")
    assert exc.value.current_revision == _rev(space)
    with pytest.raises(KeyError):
        space.create_relation_pair("nope", "subItems", "")
    with pytest.raises(InvalidValue):
        space.create_relation_pair("story", "cousins", _rev(space))
    with pytest.raises(InvalidValue, match=SYNC_NOT_ALLOWED):
        space.create_relation_pair("page", "subItems", _rev(space, "page"))
    assert _type_file(space_dir, "story").read_bytes() == type_bytes


def test_two_single_sides_never_sync(space_dir: Path):
    _story_type(space_dir, [
        {"id": "a", "key": "a", "name": "A", "type": "entity",
         "options": {"isArray": False, "allowedTypes": ["story"], "hasFixedSet": False, "fixedSet": [],
                     "propertySyncing": {"propertyIds": ["b"]}}},
        {"id": "b", "key": "b", "name": "B", "type": "entity",
         "options": {"isArray": False, "allowedTypes": ["story"], "hasFixedSet": False, "fixedSet": [],
                     "propertySyncing": {"propertyIds": ["a"]}}},
        {"id": "c", "key": "c", "name": "C", "type": "entity",
         "options": {"isArray": False, "allowedTypes": ["story"], "hasFixedSet": False, "fixedSet": []}},
    ])
    space = Space(space_dir)
    t = space.type_by_id("story")
    assert space.sync_problem(t, t.prop("a")) == SYNC_MULTI_ONLY
    # The generic sync menu still offers only lists.
    with pytest.raises(InvalidValue, match="multi-select"):
        space.set_property_sync("story", "c", None, create_name="Back", base_revision=_rev(space))


# -- syncing within one type ----------------------------------------------------------


def test_generic_sync_of_a_type_with_itself(space_dir: Path):
    _story_type(space_dir, [
        {"id": "rel", "key": "related", "name": "Related", "type": "entity",
         "options": {"isArray": True, "allowedTypes": ["story"], "hasFixedSet": False, "fixedSet": []}},
    ])
    _story(space_dir, "A", "related: ['[[B]]']\n")
    b = _story(space_dir, "B")
    b_before = b.read_bytes()
    space = Space(space_dir)
    result = space.set_property_sync("story", "rel", None, create_name="Related to", base_revision=_rev(space))
    assert [t.id for t in result.types] == ["story"]
    t = result.types[0]
    back = t.prop("relatedTo")
    assert back.options["propertySyncing"] == {"propertyIds": ["rel"]}
    assert t.prop("related").options["propertySyncing"] == {"propertyIds": [back.id]}
    assert result.rewritten == ["Stories/B.md"]
    assert _changed_lines(b_before, b.read_bytes()) == ([], ["relatedTo: ['[[A]]']\n"])


def test_blocked_by_fills_blocking_changing_only_those_lines(space_dir: Path):
    _story_type(space_dir)
    a = _story(space_dir, "A")
    b = _story(space_dir, "B")
    space = Space(space_dir)
    space.create_relation_pair("story", "dependencies", _rev(space))
    a_before, b_before = a.read_bytes(), b.read_bytes()

    out = space.update_properties(
        "Stories/A.md", {"blockedBy": [{"target": "B", "path": "Stories/B.md"}]},
        space.cached_version("Stories/A.md"),
    )

    assert out.synced == ["Stories/B.md"]
    removed, added = _changed_lines(a_before, a.read_bytes())
    assert removed == [STAMP] and len(added) == 2
    assert "blockedBy: ['[[B]]']\n" in added and any(x.startswith("lastUpdated: ") for x in added)
    removed, added = _changed_lines(b_before, b.read_bytes())
    assert removed == [STAMP] and len(added) == 2
    assert "blocking: ['[[A]]']\n" in added
    assert parse_fm(b.read_text().split("---\n")[1])["blocking"] == ["[[A]]"]

    # Removing the link clears the other side's.
    space.update_properties("Stories/A.md", {"blockedBy": []}, space.cached_version("Stories/A.md"))
    assert "[[A]]" not in b.read_text()


def test_parent_item_and_sub_items_sync_both_ways(space_dir: Path):
    _story_type(space_dir)
    for title in ("Epic", "Other", "C", "D"):
        _story(space_dir, title)
    space = Space(space_dir)
    space.create_relation_pair("story", "subItems", _rev(space))

    def fm(title: str) -> dict:
        return parse_fm((space_dir / "Stories" / f"{title}.md").read_text().split("---\n")[1])

    def ref(title: str) -> dict:
        return {"target": title, "path": f"Stories/{title}.md"}

    v = space.cached_version
    space.update_properties("Stories/C.md", {"parentItem": [ref("Epic")]}, v("Stories/C.md"))
    assert fm("C")["parentItem"] == "[[Epic]]"  # single: a plain link, not a list
    assert fm("Epic")["subItems"] == ["[[C]]"]

    space.update_properties("Stories/Epic.md", {"subItems": [ref("C"), ref("D")]}, v("Stories/Epic.md"))
    assert fm("D")["parentItem"] == "[[Epic]]"

    # Moving C to another parent takes it out of the first one's sub-items.
    space.update_properties("Stories/C.md", {"parentItem": [ref("Other")]}, v("Stories/C.md"))
    assert fm("Epic")["subItems"] == ["[[D]]"]
    assert fm("Other")["subItems"] == ["[[C]]"]


# -- route ------------------------------------------------------------------------


def _wait(published: list, count: int) -> None:
    deadline = time.monotonic() + 2
    while len(published) < count and time.monotonic() < deadline:
        time.sleep(0.01)


def test_relation_pair_route(space_dir: Path):
    _story_type(space_dir, [{"id": "t", "key": "t", "name": "Sub-items", "type": "text"}])
    _story(space_dir, "A")
    space = Space(space_dir)
    app = create_app(space, None, watch=False)
    published = []
    app.state.hub.publish = published.append
    url = "/api/types/story/relation-pair"
    with TestClient(app) as c:
        before = _md(space_dir)
        r = c.post(url, json={"kind": "dependencies", "baseRevision": "stale"})
        assert r.status_code == 409 and r.json()["currentRevision"] == _rev(space)
        r = c.post("/api/types/nope/relation-pair", json={"kind": "dependencies", "baseRevision": ""})
        assert r.status_code == 404
        r = c.post(url, json={"kind": "subItems", "baseRevision": _rev(space)})
        assert r.status_code == 422 and '"Sub-items"' in r.json()["detail"]
        r = c.post(url, json={"kind": "nope", "baseRevision": _rev(space)})
        assert r.status_code == 422
        assert published == []

        r = c.post(url, json={"kind": "dependencies", "baseRevision": _rev(space), "clientId": "w1"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"type", "firstId", "secondId", "created"}
        assert body["created"] is True
        assert body["type"]["revision"] == _rev(space)
        by_id = {p["id"]: p for p in body["type"]["propertyDefinitions"]}
        assert by_id[body["firstId"]]["name"] == "Blocked by"
        assert by_id[body["secondId"]]["name"] == "Blocking"
        _wait(published, 1)
        assert [(e.kind, e.path, e.origin) for e in published] == [("types", "story", "w1")]

        r = c.post(url, json={"kind": "dependencies", "baseRevision": _rev(space), "clientId": "w1"})
        assert r.status_code == 200
        again = r.json()
        assert again["created"] is False
        assert (again["firstId"], again["secondId"]) == (body["firstId"], body["secondId"])
        assert again["type"]["revision"] == body["type"]["revision"]
        assert _md(space_dir) == before
