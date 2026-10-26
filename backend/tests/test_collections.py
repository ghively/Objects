"""Collections: model and CRUD (M3 Task 3)."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from objectapp.collections import default_collection_views
from objectapp.server import create_app
from objectapp.space import Space


def _client(space_dir: Path):
    space = Space(space_dir)
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    return space, TestClient(app), published


def _files(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


def _create(c, name="Tooling", type_ids=("server",), **extra):
    return c.post("/api/collections", json={"name": name, "typeIds": list(type_ids), **extra})


def test_create_collection_writes_one_file(space_dir: Path):
    space, c, published = _client(space_dir)
    before = _files(space_dir)
    with c:
        r = _create(c)
    assert r.status_code == 201
    body = r.json()
    assert body["id"] == "tooling" and body["name"] == "Tooling" and body["typeIds"] == ["server"]
    assert body["revision"] and body["readOnlyReason"] is None
    assert _files(space_dir) - before == {".capacities/collections/tooling.json"}
    assert before - _files(space_dir) == set()
    assert [(e.kind, e.path) for e in published] == [("collections", "tooling")]
    assert space.collection_by_name("tooling").id == "tooling"


def test_create_default_name_new_collection(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        first = _create(c, "").json()
        second = _create(c, "  ").json()
    assert first["name"] == "New Collection" and second["name"] == "New Collection 2"
    assert first["id"] == "new-collection" and second["id"] == "new-collection-2"


def test_duplicate_name_case_insensitive_422(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        _create(c, "Tooling")
        r = _create(c, "tooling")
    assert r.status_code == 422
    assert r.json()["detail"] == "A collection with this name already exists."


def test_unknown_type_422(space_dir: Path):
    space, c, _pub = _client(space_dir)
    with c:
        r = _create(c, "Ghosts", ["nope"])
    assert r.status_code == 422
    assert not (space_dir / ".capacities" / "collections").exists()
    assert space.list_collections() == []


def test_save_keeps_unknown_keys_and_checks_revision(space_dir: Path):
    _space, c, published = _client(space_dir)
    path = space_dir / ".capacities" / "collections" / "tooling.json"
    with c:
        made = _create(c).json()
        stored = json.loads(path.read_text("utf-8"))
        stored["zzz"] = {"a": 1}
        path.write_text(json.dumps(stored), encoding="utf-8")
        # Our copy is now stale: the file changed outside the app.
        stale = c.put(
            "/api/collections/tooling",
            json={"collection": {**made, "description": "Gear"}, "baseRevision": made["revision"]},
        )
        assert stale.status_code == 409 and stale.json()["currentRevision"]
        fresh = c.get("/api/collections").json()[0]
        assert fresh["zzz"] == {"a": 1}
        ok = c.put(
            "/api/collections/tooling",
            json={
                "collection": {**fresh, "description": "Gear"},
                "baseRevision": fresh["revision"],
                "clientId": "me",
            },
        )
    assert ok.status_code == 200
    out = ok.json()
    assert out["rewritten"] == [] and out["skipped"] == []
    assert out["collection"]["description"] == "Gear" and out["collection"]["zzz"] == {"a": 1}
    on_disk = json.loads(path.read_text("utf-8"))
    assert on_disk["zzz"] == {"a": 1} and on_disk["description"] == "Gear"
    assert "revision" not in on_disk and "readOnlyReason" not in on_disk
    last = published[-1]
    assert (last.kind, last.path, last.origin) == ("collections", "tooling", "me")


def test_save_unknown_collection_404(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        r = c.put("/api/collections/nope", json={"collection": {"name": "X"}, "baseRevision": ""})
    assert r.status_code == 404


def test_collection_by_former_name(space_dir: Path):
    space, c, _pub = _client(space_dir)
    with c:
        made = _create(c, "Tooling").json()
        c.put(
            "/api/collections/tooling",
            json={
                "collection": {**made, "name": "Gear", "formerNames": ["Tooling"]},
                "baseRevision": made["revision"],
            },
        )
    assert space.collection_by_name("gear").id == "tooling"
    assert space.collection_by_name("TOOLING").id == "tooling"
    assert space.collection_by_name("Other") is None


def test_list_unreadable_collection_readonly(space_dir: Path):
    path = space_dir / ".capacities" / "collections" / "bad.json"
    path.parent.mkdir(parents=True)
    path.write_bytes(b'{"id":')
    space, c, published = _client(space_dir)
    mtime = path.stat().st_mtime_ns
    with c:
        listed = c.get("/api/collections").json()
        r = c.put("/api/collections/bad", json={"collection": {"name": "Bad"}, "baseRevision": ""})
    assert [x["id"] for x in listed] == ["bad"] and listed[0]["readOnlyReason"]
    assert r.status_code == 423
    assert path.read_bytes() == b'{"id":' and path.stat().st_mtime_ns == mtime
    assert space.collection_by_name("bad") is None
    assert published == []


def test_collection_default_views_pinned_only(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        made = _create(c).json()
    assert made["views"]["dashboard"]["sections"] == [{"key": "pinned", "collapsed": False}]
    assert made["views"] == default_collection_views()
    assert made["pinned"] == {"ids": [], "isHidden": False}
    assert made["templates"] == {"ids": [], "defaultTemplateId": None}


def test_saved_unknown_type_kept_new_unknown_422(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    path = space_dir / ".capacities" / "collections" / "tooling.json"
    with c:
        _create(c)
        # A type that has since been deleted stays in the stored typeIds.
        stored = json.loads(path.read_text("utf-8"))
        stored["typeIds"] = ["server", "gone"]
        path.write_text(json.dumps(stored), encoding="utf-8")
        fresh = c.get("/api/collections").json()[0]
        ok = c.put(
            "/api/collections/tooling",
            json={"collection": {**fresh, "description": "x"}, "baseRevision": fresh["revision"]},
        )
        assert ok.status_code == 200 and ok.json()["collection"]["typeIds"] == ["server", "gone"]
        rev = ok.json()["collection"]["revision"]
        bad = c.put(
            "/api/collections/tooling",
            json={
                "collection": {**fresh, "typeIds": ["server", "gone", "other"]},
                "baseRevision": rev,
            },
        )
    assert bad.status_code == 422
