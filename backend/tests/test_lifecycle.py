"""Create, delete and trash for objects and types (Task 4)."""

import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import Conflict, Space, safe_filename, unique_path, version_of

_ID_RE = re.compile(r"[0-9A-HJKMNP-TV-Z]{26}")
_STAMP_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z")


def _normalised(data: bytes) -> str:
    text = _ID_RE.sub("<ulid>", data.decode(), count=1)
    return _STAMP_RE.sub("<t>", text)


def _trash_dir(space_dir: Path) -> Path:
    return space_dir / ".object" / "trash"


# -- create ----------------------------------------------------------------------


def test_create_writes_minimal_frontmatter(space_dir: Path):
    space = Space(space_dir)
    path, version = space.create_object("task", "Plan sprint")

    assert path == "Tasks/Plan sprint.md"
    data = (space_dir / path).read_bytes()
    assert version == version_of(data)
    assert _normalised(data) == (
        "---\nid: <ulid>\ntype: 'Task'\ntitle: Plan sprint\ncreatedAt: <t>\n"
        "lastUpdated: <t>\n---\n# Plan sprint\n"
    )
    stamps = _STAMP_RE.findall(data.decode())
    assert stamps[0] == stamps[1]
    summary = space.get(path)
    assert (summary.title, summary.type) == ("Plan sprint", "task")
    assert path in [s.path for s in space.list("task")]


def test_create_collision_suffix(space_dir: Path):
    space = Space(space_dir)
    path, _ = space.create_object("task", "Write docs")
    assert path == "Tasks/Write docs (2).md"
    path, _ = space.create_object("task", "Write docs")
    assert path == "Tasks/Write docs (3).md"


def test_safe_filename_matches_export():
    assert safe_filename('What if? A/B: "test" <1|2>') == "What if"
    assert safe_filename("?Why") == "Why"
    assert safe_filename("***") == "Untitled"
    assert safe_filename("") == "Untitled"
    assert safe_filename("  spaced   out  title.  ") == "spaced out title"
    assert len(safe_filename("x" * 200)) == 120


def test_unique_path_case_only_rename_keeps_own_path(space_dir: Path):
    assert unique_path(space_dir, "Tasks", "write docs") == "Tasks/write docs (2).md"
    assert (
        unique_path(space_dir, "Tasks", "write docs", same_as="Tasks/Write docs.md")
        == "Tasks/write docs.md"
    )


def test_create_untitled(space_dir: Path):
    space = Space(space_dir)
    path, _ = space.create_object("page")
    assert path == "Pages/Untitled.md"
    assert _normalised((space_dir / path).read_bytes()) == (
        "---\nid: <ulid>\ntype: 'Page'\ncreatedAt: <t>\nlastUpdated: <t>\n---\n"
    )
    assert space.get(path).title == "Untitled"
    path2, _ = space.create_object("page", "")
    assert path2 == "Pages/Untitled (2).md"
    assert space.get(path2).title == "Untitled"


def test_create_unknown_type_404(space_dir: Path):
    space = Space(space_dir)
    with pytest.raises(KeyError):
        space.create_object("nope", "X")
    client = TestClient(create_app(space, None, watch=False))
    resp = client.post("/api/objects", json={"typeId": "nope", "title": "X"})
    assert resp.status_code == 404


def test_create_creates_folder_and_persists_inferred_type(space_dir: Path):
    Space(space_dir)  # the first open writes the type JSON it found then
    (space_dir / "Gadgets").mkdir()
    (space_dir / "Gadgets" / "Widget.md").write_bytes(b"---\ntype: 'Gadget'\ntitle: Widget\n---\n")
    space = Space(space_dir)
    type_file = space_dir / ".object" / "types" / "gadget.json"
    assert not type_file.exists()
    (space_dir / "Gadgets" / "Widget.md").unlink()
    (space_dir / "Gadgets").rmdir()

    path, _ = space.create_object("gadget", "Sprocket")

    assert path == "Gadgets/Sprocket.md"
    assert type_file.is_file()
    assert json.loads(type_file.read_text())["name"] == "Gadget"


def test_create_route_201_and_quotes_title(space_dir: Path):
    space = Space(space_dir)
    client = TestClient(create_app(space, None, watch=False))
    resp = client.post("/api/objects", json={"typeId": "page", "title": "a: b", "clientId": "c1"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["path"] == "Pages/a.md"
    data = (space_dir / body["path"]).read_bytes()
    assert body["version"] == version_of(data)
    assert "title: 'a: b'\n" in data.decode()
    assert data.decode().endswith("---\n# a: b\n")


# -- delete ----------------------------------------------------------------------


def test_delete_moves_to_trash_and_unlists(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Write docs.md"
    before = target.read_bytes()

    item = space.delete_object("Tasks/Write docs.md")

    assert not target.exists()
    assert "Tasks/Write docs.md" not in [s.path for s in space.list()]
    assert (_trash_dir(space_dir) / f"{item.id}.md").read_bytes() == before
    meta = json.loads((_trash_dir(space_dir) / f"{item.id}.json").read_text())
    assert meta["id"] == item.id
    assert meta["kind"] == "object"
    assert meta["originalPath"] == "Tasks/Write docs.md"
    assert meta["title"] == "Write docs"
    assert meta["type"] == "task"
    assert _STAMP_RE.fullmatch(meta["deletedAt"])
    assert [(i.id, i.kind, i.title) for i in space.list_trash()] == [
        (item.id, "object", "Write docs")
    ]


def test_delete_stale_version_409(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Write docs.md"
    before = target.read_bytes()
    with pytest.raises(Conflict) as exc:
        space.delete_object("Tasks/Write docs.md", base_version="0" * 64)
    assert exc.value.current_version == version_of(before)
    assert target.read_bytes() == before
    assert space.list_trash() == []

    client = TestClient(create_app(space, None, watch=False))
    resp = client.delete(
        "/api/object", params={"path": "Tasks/Write docs.md", "baseVersion": "0" * 64}
    )
    assert resp.status_code == 409
    assert resp.json()["currentVersion"] == version_of(before)
    resp = client.delete(
        "/api/object",
        params={"path": "Tasks/Write docs.md", "baseVersion": version_of(before)},
    )
    assert resp.status_code == 200
    assert resp.json()["trashId"] == space.list_trash()[0].id
    assert client.delete("/api/object", params={"path": "Tasks/Write docs.md"}).status_code == 404


def test_delete_readonly_allowed(space_dir: Path):
    space = Space(space_dir)
    before = (space_dir / "Pages" / "Bad yaml.md").read_bytes()
    item = space.delete_object("Pages/Bad yaml.md")
    assert not (space_dir / "Pages" / "Bad yaml.md").exists()
    assert (_trash_dir(space_dir) / f"{item.id}.md").read_bytes() == before


def test_delete_leaves_links_dangling(space_dir: Path):
    space = Space(space_dir)
    referrer = space_dir / "Tasks" / "Write docs.md"
    before = referrer.read_bytes()
    assert space.resolve("Ada Lovelace", "Tasks/Write docs.md") == "People/Ada Lovelace.md"

    space.delete_object("People/Ada Lovelace.md")

    assert space.resolve("Ada Lovelace", "Tasks/Write docs.md") is None
    assert referrer.read_bytes() == before


# -- restore ---------------------------------------------------------------------


def test_restore_returns_to_original_path(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Write docs.md"
    before = target.read_bytes()
    item = space.delete_object("Tasks/Write docs.md")

    result = space.restore(item.id)

    assert result == {"paths": ["Tasks/Write docs.md"], "typeIds": []}
    assert target.read_bytes() == before
    assert space.get("Tasks/Write docs.md").title == "Write docs"
    assert space.list_trash() == []
    assert not any(_trash_dir(space_dir).glob("*.md"))
    assert not any(_trash_dir(space_dir).glob("*.json"))


def test_restore_collision_suffix(space_dir: Path):
    space = Space(space_dir)
    before = (space_dir / "Tasks" / "Write docs.md").read_bytes()
    item = space.delete_object("Tasks/Write docs.md")
    space.create_object("task", "Write docs")

    result = space.restore(item.id)

    assert result["paths"] == ["Tasks/Write docs (2).md"]
    assert (space_dir / "Tasks" / "Write docs (2).md").read_bytes() == before


def test_restore_unknown_id_404(space_dir: Path):
    space = Space(space_dir)
    with pytest.raises(KeyError):
        space.restore("nope")
    client = TestClient(create_app(space, None, watch=False))
    assert client.post("/api/trash/nope/restore").status_code == 404
    assert client.delete("/api/trash/nope").status_code == 404


def _gizmo_space(space_dir: Path) -> dict[str, bytes]:
    """A tmp type Gizmo with two objects and a template; Holder relates to it."""
    types = space_dir / ".object" / "types"
    types.mkdir(parents=True)
    gizmo = {
        "schemaVersion": 2,
        "id": "gizmo",
        "name": "Gizmo",
        "pluralName": "Gizmos",
        "folder": "Gizmos",
        "propertyDefinitions": [],
    }
    holder = {
        "schemaVersion": 2,
        "id": "holder",
        "name": "Holder",
        "pluralName": "Holders",
        "folder": "Holders",
        "propertyDefinitions": [
            {
                "id": "parts",
                "key": "parts",
                "name": "Parts",
                "type": "entity",
                "options": {
                    "isArray": True,
                    "allowedTypes": ["gizmo", "page"],
                    "hasFixedSet": False,
                    "fixedSet": [],
                },
            }
        ],
    }
    (types / "gizmo.json").write_bytes((json.dumps(gizmo, indent=2) + "\n").encode())
    (types / "holder.json").write_bytes((json.dumps(holder, indent=2) + "\n").encode())
    files = {
        "Gizmos/G1.md": b"---\ntype: 'Gizmo'\ntitle: G1\n---\nOne.\n",
        "Gizmos/G2.md": b"---\r\ntype: Gizmo\r\ntitle: G2\r\n---\r\nTwo.\r\n",
        "Templates/Gizmos/Gizmo template.md": (
            b"---\ntype: 'Gizmo'\ntemplate: Gizmo template\n---\nTemplate body.\n"
        ),
    }
    for rel, data in files.items():
        (space_dir / rel).parent.mkdir(parents=True, exist_ok=True)
        (space_dir / rel).write_bytes(data)
    return files


def _allowed(space_dir: Path) -> list[str]:
    holder = json.loads((space_dir / ".object" / "types" / "holder.json").read_text())
    return holder["propertyDefinitions"][0]["options"]["allowedTypes"]


def _trash_gizmo(space: Space):
    t = space.type_by_id("gizmo")
    assert t is not None
    return space.trash_type(t, ["Gizmos/G1.md", "Gizmos/G2.md"])


def test_trash_type_moves_type_objects_and_templates(space_dir: Path):
    files = _gizmo_space(space_dir)
    space = Space(space_dir)

    item = _trash_gizmo(space)

    assert item.kind == "type"
    assert item.title == "Gizmo"
    assert item.objectCount == 2
    for rel in files:
        assert not (space_dir / rel).exists()
    assert not (space_dir / ".object" / "types" / "gizmo.json").exists()
    assert space.type_by_id("gizmo") is None
    assert _allowed(space_dir) == ["page"]
    manifest = json.loads(
        (_trash_dir(space_dir) / "types" / item.id / "manifest.json").read_text()
    )
    assert manifest["kind"] == "type"
    assert manifest["typeId"] == "gizmo"
    assert manifest["name"] == "Gizmo"
    assert len(manifest["objectTrashIds"]) == 2
    assert manifest["allowedTypesRefs"] == [{"typeId": "holder", "propertyId": "parts"}]
    listed = space.list_trash()
    assert sorted(i.kind for i in listed) == ["object", "object", "type"]
    assert {i.typeTrashId for i in listed if i.kind == "object"} == {item.id}


def test_restore_type_restores_objects_and_templates(space_dir: Path):
    files = _gizmo_space(space_dir)
    type_json = (space_dir / ".object" / "types" / "gizmo.json").read_bytes()
    space = Space(space_dir)
    item = _trash_gizmo(space)

    result = space.restore(item.id)

    for rel, data in files.items():
        assert (space_dir / rel).read_bytes() == data
    assert (space_dir / ".object" / "types" / "gizmo.json").read_bytes() == type_json
    assert sorted(result["paths"]) == sorted(files)
    assert "gizmo" in result["typeIds"]
    assert space.type_by_id("gizmo") is not None
    assert _allowed(space_dir) == ["page", "gizmo"]
    assert space.get("Gizmos/G1.md").type == "gizmo"
    assert space.list_trash() == []
    assert not (_trash_dir(space_dir) / "types" / item.id).exists()


def test_restore_object_of_trashed_type_restores_type_only(space_dir: Path):
    files = _gizmo_space(space_dir)
    space = Space(space_dir)
    item = _trash_gizmo(space)
    g1 = next(i for i in space.list_trash() if i.originalPath == "Gizmos/G1.md")

    result = space.restore(g1.id)

    assert result["paths"] == ["Gizmos/G1.md", "Templates/Gizmos/Gizmo template.md"]
    assert result["typeIds"][0] == "gizmo"
    assert (space_dir / "Gizmos" / "G1.md").read_bytes() == files["Gizmos/G1.md"]
    assert not (space_dir / "Gizmos" / "G2.md").exists()
    assert space.type_by_id("gizmo") is not None
    assert (space_dir / ".object" / "types" / "gizmo.json").is_file()
    assert _allowed(space_dir) == ["page", "gizmo"]
    remaining = space.list_trash()
    assert [i.originalPath for i in remaining] == ["Gizmos/G2.md"]
    assert not (_trash_dir(space_dir) / "types" / item.id).exists()
    # The remaining object restores on its own now that the type is back.
    space.restore(remaining[0].id)
    assert (space_dir / "Gizmos" / "G2.md").read_bytes() == files["Gizmos/G2.md"]


# -- purge -----------------------------------------------------------------------


def _age(space_dir: Path, trash_id: str, days: float) -> None:
    meta_path = _trash_dir(space_dir) / f"{trash_id}.json"
    meta = json.loads(meta_path.read_text())
    when = datetime.now(UTC) - timedelta(days=days)
    meta["deletedAt"] = when.strftime("%Y-%m-%dT%H:%M:%S.") + f"{when.microsecond // 1000:03d}Z"
    meta_path.write_text(json.dumps(meta))


def test_purge_expired_30_days(space_dir: Path):
    space = Space(space_dir)
    old = space.delete_object("Tasks/Write docs.md")
    recent = space.delete_object("Pages/Alpha.md")
    _age(space_dir, old.id, 31)
    _age(space_dir, recent.id, 29)

    Space(space_dir)  # purge_expired runs when the space opens

    assert not (_trash_dir(space_dir) / f"{old.id}.md").exists()
    assert not (_trash_dir(space_dir) / f"{old.id}.json").exists()
    assert (_trash_dir(space_dir) / f"{recent.id}.md").exists()

    later = datetime.now(UTC) + timedelta(days=2)
    assert space.purge_expired(later) == 1
    assert space.list_trash() == []


def test_purge_and_empty_trash(space_dir: Path):
    files = _gizmo_space(space_dir)
    space = Space(space_dir)
    one = space.delete_object("Tasks/Write docs.md")
    item = _trash_gizmo(space)

    assert space.purge(one.id) == 1
    assert len(space.list_trash()) == 3
    assert space.purge(item.id) == 3  # the type and its objects
    assert space.list_trash() == []
    assert not any((_trash_dir(space_dir) / "types").iterdir())
    for rel in files:
        assert not (space_dir / rel).exists()

    space.delete_object("Pages/Alpha.md")
    assert space.empty_trash() == 1
    assert space.list_trash() == []
    with pytest.raises(KeyError):
        space.purge(one.id)


def test_trash_routes(space_dir: Path):
    space = Space(space_dir)
    client = TestClient(create_app(space, None, watch=False))
    trash_id = client.delete(
        "/api/object", params={"path": "Tasks/Write docs.md", "clientId": "c1"}
    ).json()["trashId"]

    listed = client.get("/api/trash").json()
    assert [(i["id"], i["kind"], i["originalPath"]) for i in listed] == [
        (trash_id, "object", "Tasks/Write docs.md")
    ]
    assert listed[0]["type"] == "task"

    resp = client.post(f"/api/trash/{trash_id}/restore", params={"clientId": "c1"})
    assert resp.status_code == 200
    assert resp.json() == {"paths": ["Tasks/Write docs.md"], "typeIds": [], "rewritten": []}

    client.delete("/api/object", params={"path": "Tasks/Write docs.md"})
    client.delete("/api/object", params={"path": "Pages/Alpha.md"})
    one = client.get("/api/trash").json()[0]["id"]
    assert client.delete(f"/api/trash/{one}").json() == {"purged": 1}
    assert client.delete("/api/trash").json() == {"purged": 1}
    assert client.get("/api/trash").json() == []


def test_restore_type_refuses_when_a_type_now_has_its_id(space_dir: Path):
    files = _gizmo_space(space_dir)
    type_json = (space_dir / ".object" / "types" / "gizmo.json").read_bytes()
    space = Space(space_dir)
    item = _trash_gizmo(space)
    fresh = space.create_type("Gizmo", "Gizmos")
    assert fresh.id == "gizmo"
    fresh_json = (space_dir / ".object" / "types" / "gizmo.json").read_bytes()
    g1 = next(i for i in space.list_trash() if i.originalPath == "Gizmos/G1.md")

    for trash_id in (item.id, g1.id):
        with pytest.raises(InvalidValue, match="already exists"):
            space.restore(trash_id)

    # Nothing moved: the new type is intact and the old definition is still in the trash.
    assert (space_dir / ".object" / "types" / "gizmo.json").read_bytes() == fresh_json
    assert (_trash_dir(space_dir) / "types" / item.id / "type.json").read_bytes() == type_json
    assert not (space_dir / "Gizmos" / "G1.md").exists()
    assert len(space.list_trash()) == 3
    assert files
