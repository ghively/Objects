"""M8 Task 6: Merge into object / Merge into tag (`merge.py`, ``POST /api/object/merge``).

`space-m8` copies; the clock is fixed per test; the state dir is the autouse `OBJECT_STATE_DIR`.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import merge as merge_mod
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.textfile import decode

T0 = datetime(2026, 10, 27, 10, 0, 0, tzinfo=UTC)
SOURCE = "Pages/Merge source.md"
TARGET = "Pages/Merge target.md"
REFERS = "Pages/Refers to source.md"
OLD_TAG = "Tags/Old tag.md"
NEW_TAG = "Tags/New tag.md"
ADA = "People/Ada Lovelace.md"
BOARD = "Whiteboards/Media board.md"


@pytest.fixture
def space(m8_space_dir: Path) -> Space:
    return Space(m8_space_dir)


@pytest.fixture
def client(space: Space):
    app = create_app(space, watch=False)
    space.clock = lambda: T0
    space.tz = UTC
    with TestClient(app) as c:
        yield c


def _version(client: TestClient, rel: str) -> str:
    r = client.get("/api/object", params={"path": rel})
    assert r.status_code == 200, r.text
    return r.json()["version"]


def _tree(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file() and ".object-cache" not in p.parts
    }


def _fm_body(root: Path, rel: str) -> tuple[dict, str]:
    of = split_object(decode((root / rel).read_bytes()).text)
    return parse_fm(of.frontmatter_src or ""), of.body


def _merge(client: TestClient, source: str, target: str, **extra):
    body = {
        "source": source,
        "target": target,
        "sourceVersion": _version(client, source),
        "targetVersion": _version(client, target),
        "confirm": True,
        **extra,
    }
    return client.post("/api/object/merge", json=body)


def test_merge_requires_confirm_428(client: TestClient, space: Space):
    before = _tree(space.root)
    r = _merge(client, SOURCE, TARGET, confirm=False)
    assert r.status_code == 428
    r = client.post(
        "/api/object/merge",
        json={
            "source": SOURCE,
            "target": TARGET,
            "sourceVersion": _version(client, SOURCE),
            "targetVersion": _version(client, TARGET),
        },
    )
    assert r.status_code == 428
    assert _tree(space.root) == before


def test_merge_values_lists_and_body(client: TestClient, space: Space):
    # A key the Page type lacks: dropped and listed.
    src = space.root / SOURCE
    src.write_bytes(src.read_bytes().replace(b"when:", b"rating: 5\nwhen:"))
    space.rescan_file(SOURCE)
    r = _merge(client, SOURCE, TARGET)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["target"] == TARGET
    assert out["dropped"] == ["rating"]
    assert out["version"] == _version(client, TARGET)
    fm, body = _fm_body(space.root, TARGET)
    assert fm["description"] == "Target summary"  # single value kept
    assert fm["title"] == "Merge target"
    assert fm["id"] == "01JC8M80000000000000000014"
    assert str(fm["when"]).startswith("2026-10-20T09:00")  # empty filled
    assert fm["tags"] == ["Old tag", "New tag"]  # lists unioned, target first
    assert fm["aliases"] == ["Target alias", "Source alias"]
    assert fm["related"] == ["[[Blocks M8]]", "[[Source note]]"]
    assert "rating" not in fm
    assert body == "\nTarget body paragraph.\n\nSource body paragraph.\n"


TASK = "Tasks/Shelf task.md"


def _write_task(space: Space, collections: str) -> None:
    (space.root / TASK).write_bytes(
        (
            f"---\ntype: 'Task'\ntitle: Shelf task\ncollections: {collections}\n---\n\n"
            "To do.\n"
        ).encode()
    )
    space.rescan_file(TASK)


def test_merge_drops_a_collection_the_target_type_is_not_in(client: TestClient, space: Space):
    # Sweep 2026-11-08: a Task in a Tasks-only collection merged into a Page answered 422.
    space.create_collection("Task shelf", ["task"], None)
    _write_task(space, "[Task shelf]")
    r = _merge(client, TASK, TARGET)
    assert r.status_code == 200, r.text
    assert r.json()["dropped"] == ["collections"]
    fm, body = _fm_body(space.root, TARGET)
    assert "collections" not in fm
    assert body.endswith("Target body paragraph.\n\nTo do.\n")
    assert not (space.root / TASK).exists()


def test_merge_drops_a_collection_that_no_longer_exists(client: TestClient, space: Space):
    _write_task(space, "[Ghost]")
    r = _merge(client, TASK, TARGET)
    assert r.status_code == 200, r.text
    assert r.json()["dropped"] == ["collections"]
    assert "collections" not in _fm_body(space.root, TARGET)[0]


def test_merge_keeps_the_collections_the_target_may_join(client: TestClient, space: Space):
    # The target's own collection (whatever its types) and one holding Pages are kept.
    space.create_collection("Task shelf", ["task"], None)
    tgt = space.root / TARGET
    tgt.write_bytes(tgt.read_bytes().replace(b"tags:", b"collections: [Task shelf]\ntags:"))
    space.rescan_file(TARGET)
    _write_task(space, "[Ghost, Reading list, task shelf]")
    r = _merge(client, TASK, TARGET)
    assert r.status_code == 200, r.text
    assert r.json()["dropped"] == ["collections"]
    assert _fm_body(space.root, TARGET)[0]["collections"] == ["Task shelf", "Reading list"]


def test_merge_unions_collections_without_dropping_when_all_fit(client: TestClient, space: Space):
    src = space.root / SOURCE
    src.write_bytes(src.read_bytes().replace(b"tags:", b"collections: [Reading list]\ntags:"))
    space.rescan_file(SOURCE)
    r = _merge(client, SOURCE, TARGET)
    assert r.status_code == 200, r.text
    assert r.json()["dropped"] == []
    assert _fm_body(space.root, TARGET)[0]["collections"] == ["Reading list"]


def test_merge_relinks_and_trashes_source(client: TestClient, space: Space):
    refers = space.root / REFERS
    old = refers.read_bytes()
    untouched = {
        rel: (space.root / rel).read_bytes()
        for rel in ("Pages/Source note.md", "Pages/Blocks M8.md", NEW_TAG)
    }
    r = _merge(client, SOURCE, TARGET)
    assert r.status_code == 200, r.text
    out = r.json()
    assert REFERS in out["relinked"]
    assert not (space.root / SOURCE).exists()
    new = refers.read_bytes()
    # Only the two links change, byte for byte.
    assert new == old.replace(b"[[Merge source]]", b"[[Merge target]]")
    for rel, data in untouched.items():
        assert (space.root / rel).read_bytes() == data
    trash = client.get("/api/trash").json()
    ids = [t["id"] for t in (trash["items"] if isinstance(trash, dict) else trash)]
    assert out["trashId"] in ids


def test_merge_restore_from_trash(client: TestClient, space: Space):
    original = (space.root / SOURCE).read_bytes()
    r = _merge(client, SOURCE, TARGET)
    assert r.status_code == 200, r.text
    r2 = client.post(f"/api/trash/{r.json()['trashId']}/restore")
    assert r2.status_code == 200, r2.text
    assert (space.root / SOURCE).read_bytes() == original


def test_merge_tag_rewrites_tag_lists(client: TestClient, space: Space):
    ada_before = (space.root / ADA).read_bytes()
    # Merge source holds New tag; Merge target holds Old tag; Ada holds Old tag.
    # Give Merge target both, so the merged list holds New tag once.
    tgt = space.root / TARGET
    tgt.write_bytes(tgt.read_bytes().replace(b"tags: [Old tag]", b"tags: [Old tag, New tag]"))
    space.rescan_file(TARGET)
    r = _merge(client, OLD_TAG, NEW_TAG)
    assert r.status_code == 200, r.text
    out = r.json()
    assert ADA in out["relinked"] and TARGET in out["relinked"]
    assert (space.root / ADA).read_bytes() == ada_before.replace(
        b"tags: [Old tag]", b"tags: [New tag]"
    )
    fm, _ = _fm_body(space.root, TARGET)
    assert fm["tags"] == ["New tag"]
    assert not (space.root / OLD_TAG).exists()
    fm_tag, _ = _fm_body(space.root, NEW_TAG)
    assert fm_tag["color"] == "bg-blue"  # single value kept


def test_merge_into_self_or_cross_kind_422(client: TestClient, space: Space):
    before = _tree(space.root)
    assert _merge(client, SOURCE, SOURCE).status_code == 422
    assert _merge(client, OLD_TAG, TARGET).status_code == 422
    assert _merge(client, SOURCE, NEW_TAG).status_code == 422
    assert _merge(client, SOURCE, BOARD).status_code == 422
    assert _tree(space.root) == before


def test_merge_stale_409_changes_nothing(client: TestClient, space: Space):
    before = _tree(space.root)
    sv, tv = _version(client, SOURCE), _version(client, TARGET)
    for body in (
        {"sourceVersion": "stale", "targetVersion": tv},
        {"sourceVersion": sv, "targetVersion": "stale"},
    ):
        r = client.post(
            "/api/object/merge",
            json={"source": SOURCE, "target": TARGET, "confirm": True, **body},
        )
        assert r.status_code == 409
        assert r.json()["currentVersion"] in (sv, tv)
    assert _tree(space.root) == before


def test_merge_over_limit_413(client: TestClient, space: Space, monkeypatch):
    monkeypatch.setattr(merge_mod, "MERGE_LIMIT", 0)
    before = _tree(space.root)
    r = _merge(client, SOURCE, TARGET)
    assert r.status_code == 413
    assert r.json()["limit"] == 0
    assert _tree(space.root) == before
    assert merge_mod.MERGE_LIMIT == 0


def test_merge_limit_is_5000():
    # A fresh import keeps the documented value (the test above patches the module attribute).
    import importlib

    assert importlib.reload(merge_mod).MERGE_LIMIT == 5000


def test_merge_relinks_boards(client: TestClient, space: Space):
    board_json = space.root / "Whiteboards/Media board.whiteboard.json"
    data = json.loads(board_json.read_text("utf-8"))
    data["blocks"]["b-note"]["markdown"] = "See [[Merge source]]"
    board_json.write_text(json.dumps(data, indent=2), "utf-8")
    space.rescan_file(BOARD)
    r = _merge(client, SOURCE, TARGET)
    assert r.status_code == 200, r.text
    assert "Whiteboards/Media board.whiteboard.json" in r.json()["relinked"]
    text = board_json.read_text("utf-8")
    assert "[[Merge target]]" in text and "[[Merge source]]" not in text


def test_merge_announces_and_missing_404(client: TestClient, space: Space):
    r = _merge(client, SOURCE, TARGET)
    assert r.status_code == 200
    r = client.post(
        "/api/object/merge",
        json={
            "source": "Pages/Nope.md",
            "target": TARGET,
            "sourceVersion": "x",
            "targetVersion": "y",
            "confirm": True,
        },
    )
    assert r.status_code == 404


def _synced_types(root: Path) -> None:
    """Types A and B whose `rel` relations sync with each other (two-way)."""
    types = root / ".object" / "types"
    types.mkdir(parents=True, exist_ok=True)
    for tid, name, other in (("a", "A", "b"), ("b", "B", "a")):
        data = {
            "schemaVersion": 2,
            "id": tid,
            "name": name,
            "pluralName": name,
            "folder": name,
            "propertyDefinitions": [
                {
                    "id": f"rel-{tid}",
                    "key": "rel",
                    "name": "Rel",
                    "type": "entity",
                    "options": {
                        "isArray": True,
                        "allowedTypes": [other],
                        "hasFixedSet": False,
                        "fixedSet": [],
                        "propertySyncing": {"propertyIds": [f"rel-{other}"]},
                    },
                }
            ],
        }
        (types / f"{tid}.json").write_bytes((json.dumps(data, indent=2) + "\n").encode())
    files = {
        "A/Src.md": "rel:\n  - '[[X]]'\n  - '[[Y]]'\n",
        "A/Dst.md": "",
        "B/X.md": "rel:\n  - '[[Src]]'\n",
        "B/Y.md": "",  # out of sync: Src names Y, Y doesn't name Src
    }
    for rel, extra in files.items():
        folder, title = rel[:-3].split("/")
        (root / folder).mkdir(exist_ok=True)
        (root / rel).write_bytes(
            f"---\ntype: '{folder}'\ntitle: {title}\n{extra}"
            "lastUpdated: 2026-01-01T00:00:00.000Z\n---\n".encode()
        )


def test_merge_synced_relation_no_duplicate_and_announced(m8_space_dir: Path):
    _synced_types(m8_space_dir)
    space = Space(m8_space_dir)
    app = create_app(space, watch=False)
    space.clock = lambda: T0
    space.tz = UTC
    with TestClient(app) as c:
        r = _merge(c, "A/Src.md", "A/Dst.md")
    assert r.status_code == 200, r.text
    data = r.json()

    dst_fm, _ = _fm_body(m8_space_dir, "A/Dst.md")
    assert dst_fm["rel"] == ["[[X]]", "[[Y]]"]
    x_fm, _ = _fm_body(m8_space_dir, "B/X.md")
    assert x_fm["rel"] == ["[[Dst]]"]  # relinked once, no second link from the sync
    y_fm, _ = _fm_body(m8_space_dir, "B/Y.md")
    assert y_fm["rel"] == ["[[Dst]]"]  # added by the sync
    assert "B/X.md" in data["relinked"]
    assert "B/Y.md" in data["relinked"]  # the synced file is reported (and announced)
    assert data["skipped"] == []
