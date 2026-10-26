"""The JSON definition store, per-type views and ui.json routes (M3 Task 1)."""

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.jsonstore import JsonStore, default_views, json_revision
from objectapp.server import create_app
from objectapp.space import ReadOnly, Space
from objectapp.typemodel import RevisionConflict


def _snapshot(root: Path) -> dict[str, tuple[bytes, int]]:
    return {
        p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _store(space_dir: Path, folder: str = "collections") -> JsonStore:
    return JsonStore(space_dir, folder, {})


def _client(space_dir: Path):
    space = Space(space_dir)
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    return space, TestClient(app), published


def _wait(published: list, count: int) -> None:
    deadline = time.monotonic() + 2
    while len(published) < count and time.monotonic() < deadline:
        time.sleep(0.01)


def test_store_roundtrip_keeps_unknown_keys(space_dir: Path):
    store = _store(space_dir)
    rev = store.write("x", {"id": "x", "name": "X", "foo": {"bar": 1}}, "")
    data, revision = store.read("x")
    assert data == {"id": "x", "name": "X", "foo": {"bar": 1}}
    assert revision == rev == json_revision(store.path("x"))
    raw = store.path("x").read_bytes()
    assert raw.endswith(b"\n") and not raw.endswith(b"\n\n")
    assert raw.decode().startswith('{\n  "id": "x"')


def test_store_revision_conflict(space_dir: Path):
    store = _store(space_dir)
    rev = store.write("x", {"id": "x", "n": 1}, "")
    store.write("x", {"id": "x", "n": 2}, rev)
    before = store.path("x").read_bytes()
    with pytest.raises(RevisionConflict) as exc:
        store.write("x", {"id": "x", "n": 3}, rev)
    assert exc.value.current_revision == json_revision(store.path("x"))
    assert store.path("x").read_bytes() == before
    with pytest.raises(RevisionConflict):  # creating over an existing file is a conflict too
        store.write("x", {"id": "x"}, "")


def test_unparseable_definition_untouched_423(space_dir: Path):
    store = _store(space_dir, "queries")
    path = store.path("q")
    path.parent.mkdir(parents=True)
    path.write_bytes(b'{"id":')
    mtime = path.stat().st_mtime_ns
    listed = store.list()
    assert [(i, d) for i, d, _r, _e in listed] == [("q", None)]
    assert listed[0][3]  # the error is reported
    with pytest.raises(ReadOnly):
        store.write("q", {"id": "q"}, json_revision(path))
    assert path.read_bytes() == b'{"id":' and path.stat().st_mtime_ns == mtime


def test_new_id_unique_slug(space_dir: Path):
    store = _store(space_dir)
    first = store.new_id("Reading List")
    assert first == "reading-list"
    store.write(first, {"id": first}, "")
    second = store.new_id("Reading List")
    assert second == "reading-list-2"
    store.write(second, {"id": second}, "")
    assert store.new_id("Reading List") == "reading-list-3"
    held = JsonStore(space_dir, "collections", {}, trash_ids=lambda: {"inbox", "inbox-2"})
    assert held.new_id("Inbox") == "inbox-3"


def test_get_views_defaults_without_writing(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        body = c.get("/api/views/task").json()
    assert body["revision"] == ""
    keys = [s["key"] for s in body["views"]["dashboard"]["sections"]]
    assert keys == ["recentlyAccessed", "collections", "queries", "inNoCollection", "notTagged"]
    assert body["views"]["activeTab"] == "all"
    assert body["views"]["all"]["viewDefinition"] == {"dataViewLayout": "list"}
    assert not (space_dir / ".object" / "views").exists()


def test_default_views_layout_and_tag_section(space_dir: Path):
    space = Space(space_dir)
    page = default_views(space.type_by_id("page"))
    assert page["all"]["viewDefinition"]["dataViewLayout"] == "list"
    weblink = next((t for t in space.types if t.name == "Weblink"), None)
    if weblink is not None:
        assert default_views(weblink)["all"]["viewDefinition"]["dataViewLayout"] == "grid"
    tagless = space.type_by_id("page")
    assert any(p.key == "tags" for p in tagless.propertyDefinitions)
    tagless = type(tagless).from_json({**tagless.to_json(), "propertyDefinitions": []}, fallback_id="x")
    keys = [s["key"] for s in default_views(tagless)["dashboard"]["sections"]]
    assert "notTagged" not in keys


def test_views_write_only_views_file(space_dir: Path):
    space, c, published = _client(space_dir)
    with c:
        body = c.get("/api/views/task").json()
        before = _snapshot(space_dir)
        views = {**body["views"], "activeTab": "overview"}
        r = c.put(
            "/api/views/task", json={"views": views, "baseRevision": "", "clientId": "w1"}
        )
        assert r.status_code == 200, r.text
        after = _snapshot(space_dir)
        _wait(published, 1)
    assert set(after) - set(before) == {".object/views/task.json"}
    for name, snap in before.items():
        assert after[name] == snap
    assert r.json()["revision"] == json_revision(space_dir / ".object" / "views" / "task.json")
    assert [(e.kind, e.path, e.origin) for e in published] == [("views", "task", "w1")]
    assert c.get("/api/views/task").json()["views"]["activeTab"] == "overview"
    assert space.type_by_id("task") is not None


def test_views_put_stale_revision_409(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        views = c.get("/api/views/task").json()["views"]
        first = c.put("/api/views/task", json={"views": views, "baseRevision": ""})
        assert first.status_code == 200
        stale = c.put("/api/views/task", json={"views": views, "baseRevision": ""})
        assert stale.status_code == 409
        assert stale.json() == {"currentRevision": first.json()["revision"]}
        assert c.put("/api/views/nope", json={"views": {}, "baseRevision": ""}).status_code == 404
        assert c.get("/api/views/nope").status_code == 404


def test_ui_patch_keeps_other_keys(space_dir: Path):
    ui = space_dir / ".object" / "ui.json"
    ui.parent.mkdir(parents=True, exist_ok=True)
    stored = {"changeTypePreferences": {"a": {"b": {"k": "v"}}}, "zzz": 1}
    ui.write_text(json.dumps(stored), encoding="utf-8")
    _space, c, published = _client(space_dir)
    with c:
        got = c.get("/api/ui").json()
        assert got["ui"]["pinned"] == [] and got["ui"]["allNotesLayout"] == "list"
        pin = {"kind": "type", "id": "task"}
        r = c.put(
            "/api/ui",
            json={"patch": {"pinned": [pin]}, "baseRevision": got["revision"], "clientId": "w1"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["revision"] == json_revision(ui)
        _wait(published, 1)
    saved = json.loads(ui.read_text(encoding="utf-8"))
    assert saved == {**stored, "pinned": [pin]}
    assert [(e.kind, e.path, e.origin) for e in published] == [("ui", "ui.json", "w1")]


def test_ui_patch_unknown_key_422(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        r = c.put("/api/ui", json={"patch": {"workspaceOrder": []}, "baseRevision": ""})
    assert r.status_code == 422
    assert not (space_dir / ".object" / "ui.json").exists()


def test_ui_patch_unreadable_refused(space_dir: Path):
    ui = space_dir / ".object" / "ui.json"
    ui.parent.mkdir(parents=True, exist_ok=True)
    ui.write_bytes(b"{nope")
    mtime = ui.stat().st_mtime_ns
    _space, c, _pub = _client(space_dir)
    with c:
        got = c.get("/api/ui").json()
        assert got["readOnlyReason"]
        r = c.put("/api/ui", json={"patch": {"pinned": []}, "baseRevision": got["revision"]})
    assert r.status_code == 423
    assert ui.read_bytes() == b"{nope" and ui.stat().st_mtime_ns == mtime


def test_ui_put_stale_revision_409(space_dir: Path):
    _space, c, _pub = _client(space_dir)
    with c:
        base = c.get("/api/ui").json()["revision"]
        assert base == ""
        one = {"kind": "type", "id": "task"}
        two = {"kind": "type", "id": "page"}
        first = c.put("/api/ui", json={"patch": {"pinned": [one]}, "baseRevision": base})
        assert first.status_code == 200
        second = c.put("/api/ui", json={"patch": {"pinned": [two]}, "baseRevision": base})
        assert second.status_code == 409
        assert second.json() == {"currentRevision": first.json()["revision"]}
    ui = json.loads((space_dir / ".object" / "ui.json").read_text(encoding="utf-8"))
    assert ui["pinned"] == [one]


def test_change_type_preference_still_goes_through_ui_state(space_dir: Path):
    from objectapp.changetype import MappingRow, load_ui, save_change_type_preference

    own: dict[str, str] = {}
    assert save_change_type_preference(space_dir, "a", "b", [MappingRow("k", "v", False)], own)
    assert load_ui(space_dir)["changeTypePreferences"] == {"a": {"b": {"k": "v"}}}
    assert own[".object/ui.json"] == json_revision(space_dir / ".object" / "ui.json")


def test_open_twice_writes_nothing(space_dir: Path):
    space, c, _pub = _client(space_dir)
    with c:
        for t in space.types:
            assert c.get(f"/api/views/{t.id}").status_code == 200
        assert c.get("/api/ui").status_code == 200
        assert c.get("/api/collections").json() == []
    first = _snapshot(space_dir)
    space2, c2, _pub2 = _client(space_dir)
    with c2:
        for t in space2.types:
            assert c2.get(f"/api/views/{t.id}").status_code == 200
        assert c2.get("/api/ui").status_code == 200
        assert c2.get("/api/collections").json() == []
    assert _snapshot(space_dir) == first
    assert not (space_dir / ".object" / "views").exists()
    assert not (space_dir / ".object" / "collections").exists()
    assert not (space_dir / ".object" / "ui.json").exists()


def test_type_trash_carries_views_file(space_dir: Path):
    space, c, _pub = _client(space_dir)
    with c:
        views = c.get("/api/views/person").json()["views"]
        assert c.put("/api/views/person", json={"views": views, "baseRevision": ""}).status_code == 200
        live = space_dir / ".object" / "views" / "person.json"
        original = live.read_bytes()
        r = c.delete("/api/types/person?confirm=true")
        assert r.status_code == 200, r.text
        assert not live.exists()
        restored = c.post(f"/api/trash/{r.json()['trashId']}/restore")
        assert restored.status_code == 200, restored.text
    assert live.read_bytes() == original


def test_type_restore_keeps_live_views_file(space_dir: Path):
    space, c, _pub = _client(space_dir)
    with c:
        views = c.get("/api/views/person").json()["views"]
        c.put("/api/views/person", json={"views": views, "baseRevision": ""})
        live = space_dir / ".object" / "views" / "person.json"
        trash_id = c.delete("/api/types/person?confirm=true").json()["trashId"]
        live.parent.mkdir(parents=True, exist_ok=True)
        live.write_text('{"made": "later"}', encoding="utf-8")
        assert c.post(f"/api/trash/{trash_id}/restore").status_code == 200
    assert json.loads(live.read_text(encoding="utf-8")) == {"made": "later"}


def test_json_revision_missing_is_empty(tmp_path: Path):
    assert json_revision(tmp_path / "nope.json") == ""
