"""Deleting a type and its saved queries (polish follow-up, our choice).

A saved query whose only type is the deleted one goes to the Trash with the type and comes back
with it. A query that names other types too (or excludes the type) drops the deleted id from its
list, and a restore puts the id back where it was. No live query is left pointing at a type id
that no longer exists, so a later type that reuses the id is never picked up by an old query, and
no query's types list is emptied (an empty list would mean every type).
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import ConfirmRequired, Space


def _definition(entries, exclude=None):
    d = {
        "types": entries,
        "filterGroup": {"type": "filterGroup", "operator": "and", "elements": []},
        "sorts": [],
        "groupBy": None,
    }
    if exclude is not None:
        d["excludeTypeIds"] = exclude
    return d


def _query_file(space_dir: Path, qid: str) -> Path:
    return space_dir / ".object" / "queries" / f"{qid}.json"


def _live(space: Space) -> dict[str, dict]:
    return {q.id: q.definition for q in space.list_queries()}


def _scope_paths(space: Space, definition: dict) -> list[str]:
    """The paths the query's type scope fetches (the front end's `queryScope` with no search)."""
    ids = [s["id"] for s in definition["types"]]
    return [r.summary.path for r in space.rows(ids or None)]


def test_only_type_query_goes_to_the_trash_and_comes_back(space_dir: Path):
    space = Space(space_dir)
    q = space.create_query("My servers", _definition([{"id": "server"}]))
    before = _query_file(space_dir, q.id).read_bytes()

    item = space.delete_type("server", confirm=True)

    assert q.id not in _live(space)
    assert not _query_file(space_dir, q.id).exists()
    restored = space.restore(item.id)
    assert restored["queryIds"] == [q.id]
    assert _query_file(space_dir, q.id).read_bytes() == before
    assert _live(space)[q.id]["types"] == [{"id": "server"}]


def test_a_new_type_reusing_the_id_is_not_picked_up_by_the_old_query(space_dir: Path):
    """The bug: the old query kept "server" and silently matched the new type's objects."""
    space = Space(space_dir)
    q = space.create_query("My servers", _definition([{"id": "server"}]))
    space.delete_type("server", confirm=True)

    t = space.create_type("Server", "Servers")
    assert t.id == "server"  # the id is free again once the old type is in the Trash
    space.create_object("server", "Beta")

    assert q.id not in _live(space)
    assert all(qd["types"] != [{"id": "server"}] for qd in _live(space).values())


def test_multi_type_query_drops_the_id_and_restore_puts_it_back(space_dir: Path):
    space = Space(space_dir)
    entries = [{"id": "server", "collectionIds": []}, {"id": "person"}]
    q = space.create_query("Servers and people", _definition(entries))
    before = _query_file(space_dir, q.id).read_bytes()
    people_before = _scope_paths(space, _live(space)[q.id])

    item = space.delete_type("server", confirm=True)

    after = _live(space)[q.id]
    assert after["types"] == [{"id": "person"}]
    # Same results as before for what is left: the people; the servers are in the Trash.
    assert _scope_paths(space, after) == [
        p for p in people_before if not p.startswith("Servers/")
    ]
    assert _scope_paths(space, after)  # never empty-means-everything, never nothing

    space.restore(item.id)
    assert _query_file(space_dir, q.id).read_bytes() == before


def test_excluded_type_is_dropped_and_restored(space_dir: Path):
    space = Space(space_dir)
    d = _definition([], exclude=["person", "server"])
    d["search"] = {"searchTerms": [{"text": "alpha"}]}
    q = space.create_query(None, d)
    before = _query_file(space_dir, q.id).read_bytes()

    item = space.delete_type("server", confirm=True)
    assert _live(space)[q.id]["excludeTypeIds"] == ["person"]
    assert _live(space)[q.id]["types"] == []  # it named no type before either

    space.restore(item.id)
    assert _query_file(space_dir, q.id).read_bytes() == before


def test_queries_not_naming_the_type_are_untouched(space_dir: Path):
    space = Space(space_dir)
    other = space.create_query("People", _definition([{"id": "person"}]))
    every = space.create_query(None, _definition([]))
    files = {
        qid: _query_file(space_dir, qid).read_bytes() for qid in (other.id, every.id)
    }

    space.delete_type("server", confirm=True)

    assert {qid: _query_file(space_dir, qid).read_bytes() for qid in files} == files


def test_unreadable_query_file_is_left_alone(space_dir: Path):
    space = Space(space_dir)
    path = _query_file(space_dir, "broken")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'{"definition": {"types": [{"id": "server"}]')
    space.delete_type("server", confirm=True)
    assert path.read_bytes() == b'{"definition": {"types": [{"id": "server"}]'


def test_restore_under_a_new_id_when_the_old_one_is_taken(space_dir: Path):
    space = Space(space_dir)
    q = space.create_query("My servers", _definition([{"id": "server"}]))
    item = space.delete_type("server", confirm=True)
    # Something else took the id meanwhile (an external file): it is never overwritten.
    taken = _query_file(space_dir, q.id)
    taken.write_text(
        json.dumps({"name": "Other", "definition": _definition([])}), encoding="utf-8"
    )

    restored = space.restore(item.id)

    (new_id,) = restored["queryIds"]
    assert new_id != q.id
    assert json.loads(taken.read_text(encoding="utf-8"))["name"] == "Other"
    assert _live(space)[new_id]["types"] == [{"id": "server"}]


def test_new_query_ids_avoid_ones_held_in_a_type_trash_entry(space_dir: Path):
    space = Space(space_dir)
    q = space.create_query("My servers", _definition([{"id": "server"}]))
    space.delete_type("server", confirm=True)
    again = space.create_query("My servers", _definition([{"id": "person"}]))
    assert again.id != q.id


def test_purge_removes_the_trashed_queries(space_dir: Path):
    space = Space(space_dir)
    q = space.create_query("My servers", _definition([{"id": "server"}]))
    item = space.delete_type("server", confirm=True)
    space.purge(item.id)
    assert q.id not in _live(space)
    assert not space.trash.type_dir(item.id).exists()


def test_restoring_one_object_brings_the_type_queries_back(space_dir: Path):
    space = Space(space_dir)
    q = space.create_query("My servers", _definition([{"id": "server"}]))
    space.delete_type("server", confirm=True)
    obj = next(i for i in space.list_trash() if i.kind == "object")
    restored = space.restore(obj.id)
    assert restored["queryIds"] == [q.id]
    assert q.id in _live(space)


def test_starter_template_query_follows_its_type(space_dir: Path):
    space = Space(space_dir)
    t = space.create_type("", "", template="area")
    (q,) = [
        x for x in space.list_queries() if x.definition["types"] == [{"id": t.id}]
    ]
    item = space.delete_type(t.id, confirm=True)
    assert q.id not in _live(space)
    space.restore(item.id)
    assert _live(space)[q.id]["types"] == [{"id": t.id}]


def test_confirm_text_counts_the_queries(space_dir: Path):
    space = Space(space_dir)
    space.create_query("My servers", _definition([{"id": "server"}]))
    space.create_query("Both", _definition([{"id": "server"}, {"id": "person"}]))
    with pytest.raises(ConfirmRequired) as err:
        space.delete_type("server", confirm=False)
    assert "1 saved query" in err.value.detail
    assert "1 other query" in err.value.detail


def test_api_delete_and_restore_announce_the_queries(space_dir: Path):
    space = Space(space_dir)
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    with TestClient(app) as c:
        only = c.post(
            "/api/queries",
            json={"name": "Mine", "definition": _definition([{"id": "server"}])},
        ).json()
        both = c.post(
            "/api/queries",
            json={
                "name": "Both",
                "definition": _definition([{"id": "server"}, {"id": "person"}]),
            },
        ).json()
        published.clear()
        r = c.delete("/api/types/server", params={"confirm": "true"})
        assert r.status_code == 200
        assert sorted(r.json()["queryIds"]) == sorted([only["id"], both["id"]])
        announced = {e.path for e in published if e.kind == "queries"}
        assert announced == {only["id"], both["id"]}
        ids = [q["id"] for q in c.get("/api/queries").json()]
        assert only["id"] not in ids and both["id"] in ids

        published.clear()
        r = c.post(f"/api/trash/{r.json()['trashId']}/restore")
        assert sorted(r.json()["queryIds"]) == sorted([only["id"], both["id"]])
        assert {e.path for e in published if e.kind == "queries"} == {
            only["id"],
            both["id"],
        }
