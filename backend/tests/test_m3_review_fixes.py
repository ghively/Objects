"""Fixes from the M3 whole-milestone review (collections, queries, views, ui.json)."""

import json
import threading
from pathlib import Path

from fastapi.testclient import TestClient

from objectapp.changetype import MappingRow, save_change_type_preference
from objectapp.collections import CollectionDef
from objectapp.server import create_app
from objectapp.space import Space

SERVER = "Servers/Alpha.md"
PAGE = "Pages/Alpha.md"


def _client(space_dir: Path):
    space = Space(space_dir)
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    return space, TestClient(app), published


def _define(root: Path, cid: str, name: str, type_ids: list[str], **extra) -> Path:
    c = CollectionDef(id=cid, name=name, typeIds=list(type_ids))
    path = root / ".object" / "collections" / f"{cid}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({**c.to_json(), **extra}, indent=2) + "\n", encoding="utf-8")
    return path


def _member(root: Path, rel: str, line: str) -> bytes:
    path = root / rel
    text = path.read_bytes().decode("utf-8")
    head, sep, rest = text.partition("\n---\n")
    assert sep, rel
    path.write_bytes((head + "\n" + line + sep + rest).encode("utf-8"))
    return path.read_bytes()


def _files(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


# -- delete and restore report every file they touch ----------------------------------


def test_delete_collection_reports_deleted_and_restore_reports_rewritten(space_dir: Path):
    _define(space_dir, "tooling", "Tooling", ["server", "page"])
    _define(space_dir, "other", "Other", ["page"])
    _member(space_dir, SERVER, "collections: [Tooling]")
    _member(space_dir, PAGE, "collections: [Tooling, Other]")
    _space, c, _pub = _client(space_dir)
    with c:
        deleted = c.delete("/api/collections/tooling?confirm=true").json()
        restored = c.post(f"/api/trash/{deleted['trashId']}/restore").json()
    assert deleted["deleted"] == [SERVER]
    assert deleted["removedFrom"] == [PAGE]
    assert restored["rewritten"] == [PAGE]
    assert restored["paths"] == [SERVER]


def test_restore_of_object_reports_empty_rewritten(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        c.delete("/api/object", params={"path": PAGE})
        trash_id = c.get("/api/trash").json()[0]["id"]
        body = c.post(f"/api/trash/{trash_id}/restore").json()
    assert body["rewritten"] == []


# -- a definition's id is its file name ----------------------------------------------


def test_duplicated_collection_file_keeps_its_own_id(space_dir: Path):
    orig = _define(space_dir, "orig", "Orig", ["page"])
    dup = _define(space_dir, "dup", "Dup", ["page"])
    data = json.loads(dup.read_text("utf-8"))
    data["id"] = "orig"  # a copy of orig.json, renamed
    dup.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    orig_bytes = orig.read_bytes()
    _space, c, _pub = _client(space_dir)
    with c:
        listed = c.get("/api/collections").json()
        by_id = {x["id"]: x for x in listed}
        assert sorted(by_id) == ["dup", "orig"]
        assert by_id["dup"]["name"] == "Dup" and by_id["orig"]["name"] == "Orig"
        assert by_id["dup"]["revision"] != by_id["orig"]["revision"]
        dup_def = {**by_id["dup"], "description": "edited"}
        r = c.put(
            "/api/collections/dup",
            json={"collection": dup_def, "baseRevision": by_id["dup"]["revision"]},
        )
    assert r.status_code == 200, r.text
    assert orig.read_bytes() == orig_bytes
    assert json.loads(dup.read_text("utf-8"))["description"] == "edited"


def test_duplicated_query_file_keeps_its_own_id(space_dir: Path):
    folder = space_dir / ".object" / "queries"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "orig.json").write_text(json.dumps({"id": "orig", "name": "Orig"}), encoding="utf-8")
    (folder / "copy.json").write_text(json.dumps({"id": "orig", "name": "Copy"}), encoding="utf-8")
    orig_bytes = (folder / "orig.json").read_bytes()
    _space, c, _pub = _client(space_dir)
    with c:
        listed = {q["id"]: q for q in c.get("/api/queries").json()}
        assert sorted(listed) == ["copy", "orig"]
        assert listed["copy"]["revision"]
        r = c.put(
            "/api/queries/copy",
            json={"query": {**listed["copy"], "description": "x"}, "baseRevision": listed["copy"]["revision"]},
        )
    assert r.status_code == 200, r.text
    assert (folder / "orig.json").read_bytes() == orig_bytes


# -- a query file without an id can be restored ------------------------------------------


def test_query_without_id_deletes_and_restores_byte_identical(space_dir: Path):
    folder = space_dir / ".object" / "queries"
    folder.mkdir(parents=True, exist_ok=True)
    live = folder / "hand.json"
    live.write_bytes(b'{"name": "Hand made"}\r\n')
    original = live.read_bytes()
    _space, c, published = _client(space_dir)
    with c:
        trash_id = c.delete("/api/queries/hand").json()["trashId"]
        assert not live.exists()
        entries = c.get("/api/trash").json()
        assert [(e["kind"], e["queryId"], e["originalPath"]) for e in entries] == [
            ("query", "hand", ".object/queries/hand.json")
        ]
        r = c.post(f"/api/trash/{trash_id}/restore")
        assert r.status_code == 200, r.text
        assert r.json()["queryIds"] == ["hand"]
        assert c.get("/api/trash").json() == []
    assert live.read_bytes() == original
    assert not any(p.name.endswith(".meta.json") for p in (space_dir / ".object/trash").rglob("*"))


def test_purging_a_query_entry_removes_its_record(space_dir: Path):
    folder = space_dir / ".object" / "queries"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "hand.json").write_text('{"name": "Hand made"}', encoding="utf-8")
    _space, c, _pub = _client(space_dir)
    with c:
        trash_id = c.delete("/api/queries/hand").json()["trashId"]
        assert c.delete(f"/api/trash/{trash_id}").json() == {"purged": 1}
    assert list((space_dir / ".object/trash/queries").iterdir()) == []


# -- sole members --------------------------------------------------------------------


def test_member_also_in_unreadable_collection_is_not_trashed(space_dir: Path):
    _define(space_dir, "tooling", "Tooling", ["server"])
    broken = space_dir / ".object" / "collections" / "broken.json"
    broken.write_text('{"name": "Broken", ', encoding="utf-8")
    _member(space_dir, SERVER, "collections: [Tooling, Broken]")
    space, c, _pub = _client(space_dir)
    with c:
        r = c.delete("/api/collections/tooling?confirm=true")
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == [] and r.json()["removedFrom"] == [SERVER]
    assert (space_dir / SERVER).exists()
    assert "collections: [Broken]" in (space_dir / SERVER).read_text("utf-8")
    assert broken.read_text("utf-8") == '{"name": "Broken", '


def test_member_with_unknown_collection_name_is_not_trashed(space_dir: Path):
    _define(space_dir, "tooling", "Tooling", ["server"])
    _member(space_dir, SERVER, "collections: [Tooling, Somewhere else]")
    _space, c, _pub = _client(space_dir)
    with c:
        body = c.delete("/api/collections/tooling?confirm=true").json()
    assert body["deleted"] == [] and body["removedFrom"] == [SERVER]
    assert (space_dir / SERVER).exists()


# -- views and ui.json normalised on read, shape-checked on write ---------------------


def test_partial_views_file_is_filled_on_read_without_writing(space_dir: Path):
    views = space_dir / ".object" / "views" / "task.json"
    views.parent.mkdir(parents=True, exist_ok=True)
    views.write_text('{"activeTab": "all", "custom": 1}', encoding="utf-8")
    before = views.read_bytes()
    _space, c, _pub = _client(space_dir)
    with c:
        body = c.get("/api/views/task").json()
    v = body["views"]
    assert v["activeTab"] == "all" and v["custom"] == 1
    assert v["all"]["viewDefinition"]["dataViewLayout"]
    assert v["all"]["filterGroup"]["elements"] == [] and v["all"]["sorts"] == []
    assert isinstance(v["dashboard"]["sections"], list) and v["dashboard"]["sections"]
    assert v["dashboard"]["removedSections"] == []
    assert views.read_bytes() == before


def test_views_sections_without_key_dropped_and_layout_kept(space_dir: Path):
    views = space_dir / ".object" / "views" / "task.json"
    views.parent.mkdir(parents=True, exist_ok=True)
    views.write_text(
        json.dumps(
            {
                "all": {"viewDefinition": {"dataViewLayout": "table"}},
                "dashboard": {"sections": [{"key": "queries"}, {"nokey": 1}, "x"]},
            }
        ),
        encoding="utf-8",
    )
    _space, c, _pub = _client(space_dir)
    with c:
        v = c.get("/api/views/task").json()["views"]
    assert v["all"]["viewDefinition"]["dataViewLayout"] == "table"
    assert v["dashboard"]["sections"] == [{"key": "queries", "collapsed": False}]


def test_put_views_rejects_bad_shapes(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        bad = [
            {"all": "x"},
            {"dashboard": []},
            {"dashboard": {"sections": "x"}},
            {"dashboard": {"sections": [{"collapsed": True}]}},
        ]
        for views in bad:
            r = c.put("/api/views/task", json={"views": views, "baseRevision": ""})
            assert r.status_code == 422, views
    assert not (space_dir / ".object" / "views" / "task.json").exists()


def test_put_ui_rejects_bad_shapes(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        for patch in (
            {"pinned": "x"},
            {"pinned": [{"kind": "object"}]},
            {"sections": {"a": 1}},
            {"sections": [{"id": "s", "items": "x"}]},
        ):
            r = c.put("/api/ui", json={"patch": patch, "baseRevision": ""})
            assert r.status_code == 422, patch
        ok = c.put("/api/ui", json={"patch": {"sections": [{"id": "s", "name": "S"}]}, "baseRevision": ""})
    assert ok.status_code == 200, ok.text


def test_views_of_type_whose_id_is_not_a_file_name(space_dir: Path):
    types = space_dir / ".object" / "types"
    types.mkdir(parents=True, exist_ok=True)
    (types / "My Thing.json").write_text(
        json.dumps({"id": "My Thing", "name": "My Thing", "folder": "Things", "propertyDefinitions": []}),
        encoding="utf-8",
    )
    space, c, _pub = _client(space_dir)
    assert space.type_by_id("My Thing") is not None
    with c:
        got = c.get("/api/views/My Thing")
        put = c.put("/api/views/My Thing", json={"views": {}, "baseRevision": ""})
    assert got.status_code == 200 and got.json()["views"]["all"]
    assert got.json()["readOnlyReason"]
    assert put.status_code == 422


# -- change-type preference is written under the space's lock -----------------------------


def test_change_type_preference_takes_the_given_lock(space_dir: Path):
    lock = threading.RLock()
    done = threading.Event()

    def save():
        save_change_type_preference(space_dir, "page", "task", [MappingRow("a", "b", False)], None, lock=lock)
        done.set()

    with lock:
        t = threading.Thread(target=save)
        t.start()
        assert not done.wait(0.2)  # blocked while another writer holds the lock
    t.join(5)
    assert done.is_set()
    ui = json.loads((space_dir / ".object" / "ui.json").read_text("utf-8"))
    assert ui["changeTypePreferences"]["page"]["task"] == {"a": "b"}
