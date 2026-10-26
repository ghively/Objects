"""Collection membership, rename cascade, delete and restore (M3 Task 4)."""

import difflib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp import space as space_mod
from objectapp.collections import CollectionDef
from objectapp.frontmatter import insert_in_list, remove_from_list
from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import Space

SERVER = "Servers/Alpha.md"
PAGE = "Pages/Alpha.md"
TASK = "Tasks/Write docs.md"


def _define(root: Path, cid: str, name: str, type_ids: list[str], **extra) -> None:
    """Write a collection definition file (before the space opens)."""
    c = CollectionDef(id=cid, name=name, typeIds=list(type_ids))
    path = root / ".capacities" / "collections" / f"{cid}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {**c.to_json(), **extra}
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _member(root: Path, rel: str, line: str, eol: str = "\n") -> bytes:
    """Add a ``collections:`` entry (``line`` may span lines) to a file's frontmatter."""
    path = root / rel
    text = path.read_bytes().decode("utf-8").replace("\r\n", "\n")
    head, sep, rest = text.partition("\n---\n")
    assert sep, rel
    out = (head + "\n" + line + sep + rest).replace("\n", eol)
    path.write_bytes(out.encode("utf-8"))
    return path.read_bytes()


def _client(space_dir: Path):
    space = Space(space_dir)
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    return space, TestClient(app), published


def _diff(before: bytes, after: bytes) -> tuple[list[str], list[str]]:
    a = before.decode().splitlines()
    b = after.decode().splitlines()
    added, removed = [], []
    for line in difflib.unified_diff(a, b, lineterm="", n=0):
        if line.startswith(("+++", "---", "@@")):
            continue
        (added if line.startswith("+") else removed).append(line[1:])
    return added, removed


def _version(space: Space, rel: str) -> str:
    return space.read(rel)[2]


def _files(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


# -- frontmatter helpers ---------------------------------------------------------------


def test_remove_from_list_forms():
    def gone(v: str) -> bool:
        return v == "Tooling"

    cases = [
        ("a: 1\ncollections: [Tooling, Other]\nz: 2\n", "a: 1\ncollections: [Other]\nz: 2\n", [0], True),
        ("a: 1\ncollections: [Other, Tooling]\nz: 2\n", "a: 1\ncollections: [Other]\nz: 2\n", [1], True),
        ("collections: [A, Tooling, B]\n", "collections: [A, B]\n", [1], True),
        ("collections: ['Tooling']\nz: 2\n", "collections: []\nz: 2\n", [0], False),
        (
            "collections:\n  - Tooling\n  - Other\nz: 2\n",
            "collections:\n  - Other\nz: 2\n",
            [0],
            True,
        ),
        ("collections:\n  - Tooling\nz: 2\n", "collections: []\nz: 2\n", [0], False),
        ("collections: ['A b', Tooling]\n", "collections: ['A b']\n", [1], True),
        (
            "a: 1\r\ncollections: [Tooling, Other]\r\nz: 2\r\n",
            "a: 1\r\ncollections: [Other]\r\nz: 2\r\n",
            [0],
            True,
        ),
        ("collections: Tooling\n", "collections: []\n", [0], False),
    ]
    for src, want, indexes, roundtrips in cases:
        out, idx = remove_from_list(src, "collections", gone)
        assert (out, idx) == (want, indexes), src
        back = insert_in_list(out, "collections", idx[0], "Tooling")
        if roundtrips:
            assert back == src, src
        else:
            assert back.replace("\r\n", "\n").startswith("collections:") or "collections" in back
    # nothing to remove, and an absent key
    assert remove_from_list("collections: [A]\n", "collections", gone) == ("collections: [A]\n", [])
    assert remove_from_list("a: 1\n", "collections", gone) == ("a: 1\n", [])
    # an emptied list comes back as a flow list
    assert insert_in_list("collections: []\nz: 2\n", "collections", 0, "Tooling") == (
        "collections: [Tooling]\nz: 2\n"
    )
    assert insert_in_list("a: 1\n", "collections", 3, "Tooling") == "a: 1\ncollections: [Tooling]\n"
    # an index past the end appends
    assert insert_in_list("collections: [A]\n", "collections", 9, "T") == "collections: [A, T]\n"


# -- adding and validating membership ----------------------------------------------------


def test_add_collection_changes_one_line(space_dir: Path):
    _define(space_dir, "tooling", "Tooling", ["server", "page"])
    space = Space(space_dir)
    space.ensure_id(SERVER)
    snap = (space_dir / SERVER).read_bytes()

    space.update_properties(SERVER, {"collections": ["Tooling"]}, _version(space, SERVER))

    added, removed = _diff(snap, (space_dir / SERVER).read_bytes())
    assert len(removed) == 1 and removed[0].startswith("lastUpdated:")
    assert len(added) == 2
    assert "collections: [Tooling]" in added
    assert any(a.startswith("lastUpdated:") for a in added)
    assert space.get(SERVER).collections == ["Tooling"]

    # An object without an id also gains the id line every stamped write inserts.
    other = space_dir.parent / "copy"
    import shutil

    shutil.copytree(space_dir, other)
    (other / ".capacities" / "collections").mkdir(exist_ok=True)
    fresh = Space(other)
    snap2 = (other / PAGE).read_bytes()
    fresh.update_properties(PAGE, {"collections": ["Tooling"]}, _version(fresh, PAGE))
    added2, removed2 = _diff(snap2, (other / PAGE).read_bytes())
    assert len(added2) == 3 and len(removed2) == 1
    assert any(a.startswith("id:") for a in added2) and "collections: [Tooling]" in added2


def test_collections_unknown_name_422(space_dir: Path):
    _define(space_dir, "tooling", "Tooling", ["server"])
    space, c, _pub = _client(space_dir)
    snap = (space_dir / SERVER).read_bytes()
    with pytest.raises(InvalidValue):
        space.update_properties(SERVER, {"collections": ["Nope"]}, _version(space, SERVER))
    with c:
        r = c.put(
            "/api/object/properties",
            json={"path": SERVER, "updates": {"collections": ["Nope"]}, "baseVersion": _version(space, SERVER)},
        )
    assert r.status_code == 422
    assert (space_dir / SERVER).read_bytes() == snap


def test_collections_wrong_type_422(space_dir: Path):
    _define(space_dir, "tooling", "Tooling", ["server", "page"])
    space, c, _pub = _client(space_dir)
    snap = (space_dir / TASK).read_bytes()
    with c:
        r = c.put(
            "/api/object/properties",
            json={"path": TASK, "updates": {"collections": ["Tooling"]}, "baseVersion": _version(space, TASK)},
        )
    assert r.status_code == 422
    assert r.json()["detail"] == "This collection doesn't hold objects of this type."
    assert (space_dir / TASK).read_bytes() == snap


def test_collections_written_with_current_name(space_dir: Path):
    _define(space_dir, "tooling", "Tooling", ["server"])
    space = Space(space_dir)
    space.update_properties(SERVER, {"collections": ["tooling", "TOOLING"]}, _version(space, SERVER))
    assert space.get(SERVER).collections == ["Tooling"]
    assert "collections: [Tooling]\n" in (space_dir / SERVER).read_text("utf-8")
    # clearing writes an empty list while the key exists
    space.update_properties(SERVER, {"collections": []}, _version(space, SERVER))
    assert "collections: []\n" in (space_dir / SERVER).read_text("utf-8")
    # ... and nothing at all when the key is absent
    before = (space_dir / PAGE).read_bytes()
    space.update_properties(PAGE, {"collections": []}, _version(space, PAGE))
    assert (space_dir / PAGE).read_bytes() == before


# -- rename cascade -----------------------------------------------------------------------


def _rename(c, to: str = "Gear"):
    made = next(x for x in c.get("/api/collections").json() if x["id"] == "tooling")
    return c.put(
        "/api/collections/tooling",
        json={
            "collection": {**made, "name": to},
            "baseRevision": made["revision"],
            "clientId": "me",
        },
    )


def test_rename_collection_rewrites_items_only(space_dir: Path):
    _define(space_dir, "tooling", "Tooling", ["server", "page"])
    flow = _member(space_dir, SERVER, "collections: [Tooling, Other]")
    block = _member(space_dir, PAGE, "collections:\n  - Other\n  - Tooling")
    space, c, published = _client(space_dir)
    with c:
        r = _rename(c)
        listed = c.get("/api/collections").json()
    assert r.status_code == 200
    body = r.json()
    assert sorted(body["rewritten"]) == [PAGE, SERVER] and body["skipped"] == []
    assert (space_dir / SERVER).read_bytes() == flow.replace(b"Tooling", b"Gear")
    assert (space_dir / PAGE).read_bytes() == block.replace(b"Tooling", b"Gear")
    assert listed[0]["name"] == "Gear" and listed[0]["formerNames"] == ["Tooling"]
    changed = {e.path for e in published if e.kind == "changed"}
    assert changed == {SERVER, PAGE}
    assert space.get(SERVER).collections == ["Gear", "Other"]


def test_rename_collection_crlf_and_quotes_kept(space_dir: Path):
    _define(space_dir, "tooling", "Tooling", ["server"])
    path = space_dir / SERVER
    path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))
    _member(space_dir, SERVER, "collections: ['Tooling']", eol="\r\n")
    space, c, _pub = _client(space_dir)
    with c:
        assert _rename(c).status_code == 200
    data = path.read_bytes()
    assert b"collections: ['Gear']\r\n" in data
    assert b"\n" not in data.replace(b"\r\n", b"")
    assert b"Tooling" not in data


def test_rename_conflict_skipped_untouched(space_dir: Path, monkeypatch):
    _define(space_dir, "tooling", "Tooling", ["server"])
    _member(space_dir, SERVER, "collections: [Tooling]")
    target = space_dir / SERVER
    space, c, _pub = _client(space_dir)
    real = space_mod.atomic_write
    written: list[bytes] = []

    def patched(path, data, check=None):
        if Path(path) == target and len(written) < 2:
            ext = target.read_bytes() + f"external {len(written)}\n".encode()
            target.write_bytes(ext)
            written.append(ext)
        return real(path, data, check=check)

    monkeypatch.setattr(space_mod, "atomic_write", patched)
    with c:
        r = _rename(c)
    assert r.status_code == 200
    body = r.json()
    assert body["rewritten"] == []
    assert [s["path"] for s in body["skipped"]] == [SERVER] and body["skipped"][0]["reason"]
    assert len(written) == 2 and target.read_bytes() == written[-1]
    assert b"collections: [Tooling]" in target.read_bytes()
    space.rescan_file(SERVER)
    # The object still resolves, through the former name.
    assert space.collection_by_name("Tooling").id == "tooling"
    assert space.rows(collection_ids=["tooling"])[0].summary.path == SERVER


# -- delete ----------------------------------------------------------------------------------


def _delete_setup(space_dir: Path):
    """Tooling holds a sole member (Servers/Alpha) and a shared one (Pages/Alpha, also in Other)."""
    _define(space_dir, "tooling", "Tooling", ["server", "page"])
    _define(space_dir, "other", "Other", ["page"])
    sole = _member(space_dir, SERVER, "collections: [Tooling]")
    shared = _member(space_dir, PAGE, "collections: [Tooling, Other]")
    return sole, shared


def test_delete_collection_requires_confirm_428(space_dir: Path):
    _delete_setup(space_dir)
    space, c, published = _client(space_dir)
    before = {p: (space_dir / p).read_bytes() for p in _files(space_dir)}
    with c:
        r = c.delete("/api/collections/tooling")
        missing = c.delete("/api/collections/nope?confirm=true")
    assert r.status_code == 428 and r.json()["affected"] == 2 and r.json()["detail"]
    assert missing.status_code == 404
    assert {p: (space_dir / p).read_bytes() for p in _files(space_dir)} == before
    assert published == []


def test_delete_collection_trashes_sole_members_only(space_dir: Path):
    _delete_setup(space_dir)
    space, c, published = _client(space_dir)
    stamp = space.get(PAGE).lastUpdated
    with c:
        r = c.delete("/api/collections/tooling?confirm=true&clientId=me")
        trash = c.get("/api/trash").json()
        listed = c.get("/api/collections").json()
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["removedFrom"] == [PAGE] and body["skipped"] == []
    assert not (space_dir / SERVER).exists()
    by_kind = {t["kind"]: t for t in trash}
    assert by_kind["object"]["originalPath"] == SERVER
    assert by_kind["object"]["collectionTrashId"] == body["trashId"] == by_kind["collection"]["id"]
    assert by_kind["collection"]["name"] == "Tooling" and by_kind["collection"]["collectionId"] == "tooling"
    text = (space_dir / PAGE).read_text("utf-8")
    assert "collections: [Other]\n" in text and "Tooling" not in text
    assert f"lastUpdated: {stamp}" in text  # unstamped
    assert [x["id"] for x in listed] == ["other"]
    assert not (space_dir / ".capacities" / "collections" / "tooling.json").exists()
    manifest = json.loads(
        (space_dir / ".capacities/trash/collections" / body["trashId"] / "manifest.json").read_text("utf-8")
    )
    assert manifest["kind"] == "collection" and manifest["collectionId"] == "tooling"
    assert manifest["removedFrom"][0]["path"] == PAGE and manifest["removedFrom"][0]["index"] == 0
    kinds = [(e.kind, e.path) for e in published]
    assert ("collections", "tooling") in kinds and ("deleted", SERVER) in kinds
    assert ("changed", PAGE) in kinds
    assert all(e.origin == "me" for e in published)


def test_delete_collection_restore_byte_identical(space_dir: Path):
    sole, shared = _delete_setup(space_dir)
    json_bytes = (space_dir / ".capacities/collections/tooling.json").read_bytes()
    space, c, published = _client(space_dir)
    with c:
        deleted = c.delete("/api/collections/tooling?confirm=true").json()
        published.clear()
        r = c.post(f"/api/trash/{deleted['trashId']}/restore?clientId=me")
        listed = c.get("/api/collections").json()
        trash = c.get("/api/trash").json()
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["paths"] == [SERVER] and body["collectionIds"] == ["tooling"] and body["skipped"] == []
    assert (space_dir / SERVER).read_bytes() == sole
    assert (space_dir / PAGE).read_bytes() == shared
    assert (space_dir / ".capacities/collections/tooling.json").read_bytes() == json_bytes
    assert sorted(x["id"] for x in listed) == ["other", "tooling"]
    assert trash == []
    kinds = {(e.kind, e.path) for e in published}
    assert ("collections", "tooling") in kinds and ("changed", PAGE) in kinds
    assert ("created", SERVER) in kinds
    assert space.get(PAGE).collections == ["Tooling", "Other"]
    assert not (space_dir / ".capacities/trash/collections" / deleted["trashId"]).exists()


def test_restore_after_member_edit_reinserts_at_index(space_dir: Path):
    _sole, shared = _delete_setup(space_dir)
    space, c, _pub = _client(space_dir)
    with c:
        deleted = c.delete("/api/collections/tooling?confirm=true").json()
        edited = (space_dir / PAGE).read_bytes() + b"\nA new paragraph.\n"
        (space_dir / PAGE).write_bytes(edited)
        r = c.post(f"/api/trash/{deleted['trashId']}/restore")
    assert r.status_code == 200 and r.json()["skipped"] == []
    text = (space_dir / PAGE).read_text("utf-8")
    assert "collections: [Tooling, Other]\n" in text
    assert text.endswith("A new paragraph.\n")


def test_delete_collection_reports_skipped_member(space_dir: Path):
    _define(space_dir, "tooling", "Tooling", ["server", "page"])
    _define(space_dir, "other", "Other", ["page"])
    _member(space_dir, SERVER, "collections: [Tooling]")
    # Invalid UTF-8 keeps the file readable for its frontmatter but read-only.
    bad = space_dir / PAGE
    bad.write_bytes(bad.read_bytes().replace(b"\n---\n", b"\ncollections: [Tooling, Other]\n---\n", 1) + b"\xff\n")
    snap = bad.read_bytes()
    space, c, _pub = _client(space_dir)
    assert space.get(PAGE).readOnly and space.get(PAGE).collections == ["Tooling", "Other"]
    with c:
        r = c.delete("/api/collections/tooling?confirm=true")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [s["path"] for s in body["skipped"]] == [PAGE] and body["skipped"][0]["reason"]
    assert body["removedFrom"] == []
    assert bad.read_bytes() == snap
    assert not (space_dir / ".capacities/collections/tooling.json").exists()
    manifest = json.loads(
        (space_dir / ".capacities/trash/collections" / body["trashId"] / "manifest.json").read_text("utf-8")
    )
    assert [s["path"] for s in manifest["skipped"]] == [PAGE]


def test_restore_refused_when_id_file_exists(space_dir: Path):
    sole, shared = _delete_setup(space_dir)
    space, c, _pub = _client(space_dir)
    with c:
        deleted = c.delete("/api/collections/tooling?confirm=true").json()
        assert space.store("collections").new_id("Tooling") == "tooling-2"
        outside = space_dir / ".capacities/collections/tooling.json"
        outside.write_text('{"id": "tooling", "name": "Elsewhere", "typeIds": []}\n', encoding="utf-8")
        after_delete = {p: (space_dir / p).read_bytes() for p in _files(space_dir)}
        r = c.post(f"/api/trash/{deleted['trashId']}/restore")
        # a live collection with the same name also refuses
        outside.unlink()
        _define(space_dir, "tooling-2", "Tooling", ["server"])
        space.reload_collections()
        r2 = c.post(f"/api/trash/{deleted['trashId']}/restore")
    assert r.status_code == 409 and r.json()["detail"] == "Its id is used by another definition."
    assert r2.status_code == 409 and r2.json()["detail"] == "A collection with this name already exists."
    assert (space_dir / ".capacities/trash/collections" / deleted["trashId"]).is_dir()
    assert not (space_dir / SERVER).exists()
    now = {p: (space_dir / p).read_bytes() for p in _files(space_dir)}
    assert now.pop(".capacities/collections/tooling-2.json")
    after_delete.pop(".capacities/collections/tooling.json")
    now.pop(".capacities/collections/tooling.json", None)
    assert now == after_delete


def test_purge_expired_covers_collections(space_dir: Path):
    _delete_setup(space_dir)
    space, c, _pub = _client(space_dir)
    with c:
        deleted = c.delete("/api/collections/tooling?confirm=true").json()
    tid = deleted["trashId"]
    folder = space_dir / ".capacities/trash/collections" / tid
    assert (folder / "before" / "0.md").is_file()
    old = (datetime.now(UTC) - timedelta(days=31)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    manifest = folder / "manifest.json"
    data = json.loads(manifest.read_text("utf-8"))
    data["deletedAt"] = old
    manifest.write_text(json.dumps(data), encoding="utf-8")
    trash_dir = space_dir / ".capacities" / "trash"
    object_entries = [p for p in trash_dir.glob("*.json")]
    assert len(object_entries) == 1
    meta = json.loads(object_entries[0].read_text("utf-8"))
    assert meta["collectionTrashId"] == tid
    meta["deletedAt"] = old
    object_entries[0].write_text(json.dumps(meta), encoding="utf-8")

    reopened = Space(space_dir)

    assert reopened.list_trash() == []
    assert not folder.exists()
    assert list(trash_dir.glob("*.md")) == [] and list(trash_dir.glob("*.json")) == []


def test_purge_collection_entry_by_id(space_dir: Path):
    _delete_setup(space_dir)
    space, c, _pub = _client(space_dir)
    with c:
        deleted = c.delete("/api/collections/tooling?confirm=true").json()
        r = c.delete(f"/api/trash/{deleted['trashId']}")
        gone = c.get("/api/trash").json()
    assert r.status_code == 200 and r.json()["purged"] == 2
    assert gone == []


# -- creating with values ------------------------------------------------------------------------


def test_create_object_with_values_single_write(space_dir: Path):
    _define(space_dir, "tooling", "Tooling", ["server", "page", "task"])
    space, c, published = _client(space_dir)
    before = _files(space_dir)
    with c:
        r = c.post(
            "/api/objects",
            json={
                "typeId": "task",
                "title": "X",
                "values": {"status": ["Not Started"], "collections": ["Tooling"]},
                "clientId": "me",
            },
        )
    assert r.status_code == 201, r.text
    path = r.json()["path"]
    created = [p for p in _files(space_dir) - before if p.endswith(".md")]
    assert created == [path]
    text = (space_dir / path).read_text("utf-8")
    assert "collections: [Tooling]\n" in text and "status: Not Started\n" in text
    assert [(e.kind, e.path) for e in published if e.kind == "created"] == [("created", path)]
    assert space.get(path).collections == ["Tooling"]


def test_create_object_with_invalid_values_writes_nothing(space_dir: Path):
    _define(space_dir, "tooling", "Tooling", ["server"])
    _space, c, _pub = _client(space_dir)
    before = _files(space_dir)
    with c:
        r = c.post("/api/objects", json={"typeId": "task", "values": {"collections": ["Tooling"]}})
    assert r.status_code == 422
    assert _files(space_dir) == before
