"""Saved queries: model, CRUD, trash (M3 Task 5)."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from objectapp.ids import new_ulid
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.trash import ulid_time

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _client(space_dir: Path):
    space = Space(space_dir)
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    return space, TestClient(app), published


def _files(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


def _bytes(root: Path) -> dict[str, bytes]:
    return {p: (root / p).read_bytes() for p in _files(root)}


def _old_ulid(days: int) -> str:
    """A ULID whose timestamp is `days` days ago."""
    ms = int((datetime.now(UTC) - timedelta(days=days)).timestamp() * 1000)
    value = ms << 80
    chars = []
    for _ in range(26):
        chars.append(_CROCKFORD[value & 0x1F])
        value >>= 5
    return "".join(reversed(chars))


def _listed(c) -> list:
    """``GET /api/queries`` without M22's built-in Tickets view (listed in every space whose
    basic Task type, topped up with the work fields, makes it a work type)."""
    return [q for q in c.get("/api/queries").json() if q["id"] != "work-tickets"]


def _create(c, name="Open tasks", **extra):
    return c.post("/api/queries", json={"name": name, **extra})


def test_create_query_writes_one_file_and_event(space_dir: Path):
    space, c, published = _client(space_dir)
    before = _files(space_dir)
    definition = {
        "structures": [{"id": "task"}],
        "filterGroup": {"type": "filterGroup", "operator": "and", "elements": []},
        "sorts": [],
        "groupBy": None,
        "limit": {"size": 10},
    }
    with c:
        r = _create(c, "Open tasks", definition=definition, view={"viewDefinition": {"dataViewLayout": "table"}})
        listed = _listed(c)
    assert r.status_code == 201
    body = r.json()
    assert body["id"] == "open-tasks" and body["name"] == "Open tasks"
    assert body["titleIsCustom"] is True and body["schemaVersion"] == 1
    assert body["definition"]["limit"] == {"size": 10}
    assert body["view"]["viewDefinition"]["dataViewLayout"] == "table"
    assert body["revision"] and body["readOnlyReason"] is None
    assert _files(space_dir) - before == {".object/queries/open-tasks.json"}
    assert before - _files(space_dir) == set()
    assert [(e.kind, e.path) for e in published] == [("queries", "open-tasks")]
    assert [q["id"] for q in listed] == ["open-tasks"]
    stored = (space_dir / ".object/queries/open-tasks.json").read_text("utf-8")
    assert stored.endswith("\n") and '\n  "id"' in stored


def test_create_query_defaults(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        first = c.post("/api/queries", json={}).json()
        second = c.post("/api/queries", json={"name": "  "}).json()
    assert first["name"] == "New Query" and first["titleIsCustom"] is False
    assert first["id"] == "new-query" and second["id"] == "new-query-2"
    assert first["definition"] == {
        "structures": [],
        "filterGroup": {"type": "filterGroup", "operator": "and", "elements": []},
        "sorts": [],
        "groupBy": None,
    }
    assert first["view"] == {"viewDefinition": {"dataViewLayout": "list"}}


def test_query_validation_422(space_dir: Path):
    _space, c, published = _client(space_dir)
    before = _files(space_dir)

    def bad(**definition):
        return _create(c, "Bad", definition={"structures": [], **definition})

    with c:
        unknown = bad(structures=[{"id": "nope"}])
        unknown_excl = bad(excludeStructureIds=["nope"])
        zero = bad(limit={"size": 0})
        seven = bad(limit={"size": 7})
        six_terms = bad(search={"searchTerms": [{"text": f"term{i}"} for i in range(6)], "searchMode": "auto"})
        ok_limit = _create(c, "Fine", definition={"structures": [], "limit": {"size": 25}})
        ok_terms = _create(
            c, "Five", definition={"structures": [], "search": {"searchTerms": [{"text": "ab"}] * 5, "searchMode": "auto"}}
        )
    for r in (unknown, unknown_excl, zero, seven, six_terms):
        assert r.status_code == 422, r.text
        assert r.json()["detail"]
    assert ok_limit.status_code == 201 and ok_terms.status_code == 201
    assert _files(space_dir) - before == {
        ".object/queries/fine.json",
        ".object/queries/five.json",
    }
    assert [e.path for e in published] == ["fine", "five"]


def test_save_query_revision_conflict(space_dir: Path):
    _space, c, published = _client(space_dir)
    path = space_dir / ".object" / "queries" / "open-tasks.json"
    with c:
        made = _create(c).json()
        edited = {**made, "name": "Open work", "zzz": {"a": 1}}
        ok = c.put("/api/queries/open-tasks", json={"query": edited, "baseRevision": made["revision"]})
        stale = c.put("/api/queries/open-tasks", json={"query": edited, "baseRevision": made["revision"]})
        missing = c.put("/api/queries/nope", json={"query": made, "baseRevision": ""})
    assert ok.status_code == 200
    saved = ok.json()["query"]
    assert saved["name"] == "Open work" and saved["id"] == "open-tasks" and saved["revision"] != made["revision"]
    assert json.loads(path.read_text("utf-8"))["zzz"] == {"a": 1}
    assert stale.status_code == 409 and stale.json()["currentRevision"] == saved["revision"]
    assert missing.status_code == 404
    assert [(e.kind, e.path) for e in published] == [("queries", "open-tasks")] * 2


def test_save_unknown_type_kept_new_unknown_422(space_dir: Path):
    """A stored type id that no longer exists saves unchanged; a new unknown one is refused."""
    qdir = space_dir / ".object" / "queries"
    qdir.mkdir(parents=True)
    stored = {"id": "old", "name": "Old", "definition": {"structures": [{"id": "gone"}], "excludeStructureIds": ["gone2"]}}
    (qdir / "old.json").write_text(json.dumps(stored), encoding="utf-8")
    _space, c, _pub = _client(space_dir)
    with c:
        q = c.get("/api/queries").json()[0]
        same = c.put("/api/queries/old", json={"query": q, "baseRevision": q["revision"]})
        q2 = same.json()["query"]
        q2["definition"]["structures"].append({"id": "another"})
        more = c.put("/api/queries/old", json={"query": q2, "baseRevision": q2["revision"]})
    assert same.status_code == 200, same.text
    assert more.status_code == 422


def test_unreadable_query_listed_readonly_and_untouched(space_dir: Path):
    qdir = space_dir / ".object" / "queries"
    qdir.mkdir(parents=True)
    (qdir / "q.json").write_text('{"id":', encoding="utf-8")
    _space, c, _pub = _client(space_dir)
    before = _bytes(space_dir)
    with c:
        listed = c.get("/api/queries").json()
        put = c.put("/api/queries/q", json={"query": {"name": "x"}, "baseRevision": ""})
        delete = c.delete("/api/queries/q")
    assert listed[0]["id"] == "q" and listed[0]["readOnlyReason"]
    assert put.status_code == 423 and delete.status_code == 423
    assert _bytes(space_dir) == before


def test_delete_query_restorable(space_dir: Path):
    space, c, published = _client(space_dir)
    live = space_dir / ".object" / "queries" / "open-tasks.json"
    with c:
        made = _create(c, definition={"structures": [{"id": "task"}]}).json()
        original = live.read_bytes()
        published.clear()
        r = c.delete("/api/queries/open-tasks")
        assert r.status_code == 200
        trash_id = r.json()["trashId"]
        assert not live.exists()
        assert (space_dir / ".object/trash/queries" / f"{trash_id}.json").read_bytes() == original
        entries = c.get("/api/trash").json()
        assert [(e["kind"], e["id"], e["queryId"], e["name"]) for e in entries] == [
            ("query", trash_id, "open-tasks", "Open tasks")
        ]
        assert _listed(c) == []
        assert [(e.kind, e.path) for e in published] == [("queries", "open-tasks")]
        published.clear()
        restored = c.post(f"/api/trash/{trash_id}/restore")
        assert restored.status_code == 200, restored.text
        assert restored.json() == {
            "paths": [],
            "typeIds": [],
            "collectionIds": [],
            "queryIds": ["open-tasks"],
            "skipped": [],
            "rewritten": [],
        }
        assert c.get("/api/trash").json() == []
        again = _listed(c)
        missing = c.delete("/api/queries/open-tasks-9")
    assert live.read_bytes() == original
    assert [q["revision"] for q in again] == [made["revision"]]
    assert [(e.kind, e.path) for e in published] == [("queries", "open-tasks")]
    assert missing.status_code == 404
    assert not (space_dir / ".object/trash/queries" / f"{trash_id}.json").exists()


def test_query_id_not_reused_while_trashed(space_dir: Path):
    space, c, _pub = _client(space_dir)
    live = space_dir / ".object" / "queries"
    with c:
        _create(c, "Open tasks")
        trash_id = c.delete("/api/queries/open-tasks").json()["trashId"]
        second = _create(c, "Open tasks").json()
        assert second["id"] == "open-tasks-2"
        restored = c.post(f"/api/trash/{trash_id}/restore")
        assert restored.status_code == 200
        assert (live / "open-tasks.json").is_file()
        # Delete again, then create the id outside the app: the restore is refused.
        trash_id = c.delete("/api/queries/open-tasks").json()["trashId"]
        (live / "open-tasks.json").write_text('{"id": "open-tasks", "name": "External"}', encoding="utf-8")
        snapshot = _bytes(space_dir)
        refused = c.post(f"/api/trash/{trash_id}/restore")
    assert refused.status_code == 409
    assert refused.json()["detail"] == "Its id is used by another definition."
    assert _bytes(space_dir) == snapshot
    assert not (live / "open-tasks-3.json").exists()


def test_title_is_custom_inferred_on_load(space_dir: Path):
    qdir = space_dir / ".object" / "queries"
    qdir.mkdir(parents=True)
    (qdir / "mine.json").write_text(json.dumps({"id": "mine", "name": "Mine"}), encoding="utf-8")
    (qdir / "blank.json").write_text(json.dumps({"id": "blank", "name": ""}), encoding="utf-8")
    (qdir / "explicit.json").write_text(
        json.dumps({"id": "explicit", "name": "Auto", "titleIsCustom": False}), encoding="utf-8"
    )
    _space, c, _pub = _client(space_dir)
    with c:
        listed = {q["id"]: q for q in c.get("/api/queries").json()}
    assert listed["mine"]["titleIsCustom"] is True
    assert listed["blank"]["titleIsCustom"] is False
    assert listed["explicit"]["titleIsCustom"] is False
    assert listed["mine"]["definition"]["structures"] == []
    assert listed["mine"]["view"] == {"viewDefinition": {"dataViewLayout": "list"}}


def test_view_filter_keys_kept_but_never_read(space_dir: Path):
    qdir = space_dir / ".object" / "queries"
    qdir.mkdir(parents=True)
    stored = {
        "id": "v",
        "name": "V",
        "view": {"viewDefinition": {"dataViewLayout": "grid"}, "sorts": [{"propertyId": "x"}], "showDataViewDetails": True},
        "definition": {"structures": [], "sorts": []},
    }
    (qdir / "v.json").write_text(json.dumps(stored), encoding="utf-8")
    _space, c, _pub = _client(space_dir)
    with c:
        q = _listed(c)[0]
        saved = c.put("/api/queries/v", json={"query": q, "baseRevision": q["revision"]}).json()["query"]
    assert q["definition"]["sorts"] == []
    assert saved["view"]["sorts"] == [{"propertyId": "x"}]
    assert saved["view"]["showDataViewDetails"] is True


def test_ulid_time_roundtrip():
    when = ulid_time(new_ulid())
    assert when is not None and abs((datetime.now(UTC) - when).total_seconds()) < 5
    assert ulid_time("nope") is None


def test_purge_expired_covers_queries(space_dir: Path):
    space, c, _pub = _client(space_dir)
    with c:
        _create(c, "Old one")
        _create(c, "Fresh one")
        old_trash = c.delete("/api/queries/old-one").json()["trashId"]
        fresh_trash = c.delete("/api/queries/fresh-one").json()["trashId"]
    tdir = space_dir / ".object" / "trash" / "queries"
    aged = tdir / f"{_old_ulid(31)}.json"
    (tdir / f"{old_trash}.json").rename(aged)

    reopened = Space(space_dir)

    assert [i.id for i in reopened.list_trash()] == [fresh_trash]
    assert not aged.exists() and (tdir / f"{fresh_trash}.json").is_file()


def test_purge_query_entry_by_id(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        _create(c)
        trash_id = c.delete("/api/queries/open-tasks").json()["trashId"]
        r = c.delete(f"/api/trash/{trash_id}")
        gone = c.get("/api/trash").json()
        again = c.delete(f"/api/trash/{trash_id}")
    assert r.status_code == 200 and r.json()["purged"] == 1
    assert gone == [] and again.status_code == 404


def test_queries_not_in_objects(space_dir: Path):
    space, c, _pub = _client(space_dir)
    with c:
        objects = c.get("/api/objects").json()
        rows = c.post("/api/rows", json={}).json()["rows"]
        types = c.get("/api/space").json()["types"]
        _create(c, "One")
        _create(c, "Two", definition={"structures": [{"id": "task"}]})
        assert c.get("/api/objects").json() == objects
        assert c.post("/api/rows", json={}).json()["rows"] == rows
        assert c.get("/api/space").json()["types"] == types
    assert len(objects) == len(space.list())
