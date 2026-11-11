"""M7 Task 3: `.object/space.json` (name, icon, description, hideTaskManagement)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import spaceconfig
from objectapp.server import create_app
from objectapp.space import ReadOnly, Space
from objectapp.typemodel import RevisionConflict


def _tree(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _client(root: Path) -> TestClient:
    return TestClient(create_app(Space(root), None, watch=False))


def test_space_json_absent_reads_folder_name(blocks_space_dir: Path):
    before = _tree(blocks_space_dir)
    assert not (blocks_space_dir / ".object" / "space.json").exists()
    space = Space(blocks_space_dir)
    assert space.name == "space-blocks"
    with TestClient(create_app(space, None, watch=False)) as c:
        info = c.get("/api/space").json()
    assert info["name"] == "space-blocks"
    assert info["root"] == str(blocks_space_dir.resolve())
    assert info["icon"] is None and info["description"] is None
    assert info["hideTaskManagement"] is False and info["revision"] == ""
    assert isinstance(info["types"], list) and info["types"]
    assert _tree(blocks_space_dir) == before
    assert spaceconfig.read(blocks_space_dir) == ({}, "", None)


def test_patch_space_creates_only_space_json(blocks_space_dir: Path):
    before = _tree(blocks_space_dir)
    with _client(blocks_space_dir) as c:
        r = c.put(
            "/api/space",
            json={
                "patch": {"name": "  Lab notes ", "icon": "🧪", "description": "Bench work", "hideTaskManagement": True},
                "baseRevision": "",
                "clientId": "c1",
            },
        )
        assert r.status_code == 200, r.text
        info = r.json()
        assert info["name"] == "Lab notes"
        assert info["icon"] == "🧪" and info["description"] == "Bench work"
        assert info["hideTaskManagement"] is True
        assert info["revision"] and info["types"]
        assert c.get("/api/space").json()["revision"] == info["revision"]
    after = _tree(blocks_space_dir)
    assert set(after) - set(before) == {".object/space.json"}
    assert {k: v for k, v in after.items() if k in before} == before
    raw = (blocks_space_dir / ".object" / "space.json").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == info["revision"]
    assert json.loads(raw) == {
        "name": "Lab notes",
        "icon": "🧪",
        "description": "Bench work",
        "hideTaskManagement": True,
    }
    assert Space(blocks_space_dir).name == "Lab notes"


def test_patch_space_keeps_unknown_keys(tmp_path: Path):
    root = tmp_path / "s"
    (root / ".object").mkdir(parents=True)
    path = root / ".object" / "space.json"
    path.write_text(json.dumps({"name": "Old", "colour": "teal", "extra": {"a": 1}}), encoding="utf-8")
    _data, rev, err = spaceconfig.read(root)
    assert err is None
    data, new_rev = spaceconfig.patch(root, {"icon": None, "name": "New"}, rev)
    assert new_rev != rev
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stored == {"name": "New", "colour": "teal", "extra": {"a": 1}, "icon": None}
    assert data == stored
    space = Space(root)
    assert space.name == "New"
    # `name` is re-read on access.
    spaceconfig.patch(root, {"name": "Newer"}, new_rev)
    assert space.name == "Newer"


def test_stale_revision_409(blocks_space_dir: Path):
    with _client(blocks_space_dir) as c:
        first = c.put("/api/space", json={"patch": {"name": "A"}, "baseRevision": ""})
        assert first.status_code == 200
        stale = c.put("/api/space", json={"patch": {"name": "B"}, "baseRevision": ""})
        assert stale.status_code == 409
        assert stale.json()["currentRevision"] == first.json()["revision"]
        assert c.get("/api/space").json()["name"] == "A"
    with pytest.raises(RevisionConflict):
        spaceconfig.patch(blocks_space_dir, {"name": "C"}, "not-the-revision")


def test_unreadable_space_json_423_not_replaced(blocks_space_dir: Path):
    path = blocks_space_dir / ".object" / "space.json"
    path.write_bytes(b"{not json\r\n")
    rev = hashlib.sha256(path.read_bytes()).hexdigest()
    with _client(blocks_space_dir) as c:
        info = c.get("/api/space").json()
        assert info["name"] == "space-blocks" and info["revision"] == rev
        r = c.put("/api/space", json={"patch": {"name": "X"}, "baseRevision": rev})
        assert r.status_code == 423
    assert path.read_bytes() == b"{not json\r\n"
    with pytest.raises(ReadOnly):
        spaceconfig.patch(blocks_space_dir, {"name": "X"}, rev)
    path.write_bytes(b"[1, 2]\n")
    with pytest.raises(ReadOnly):
        spaceconfig.patch(blocks_space_dir, {"name": "X"}, hashlib.sha256(b"[1, 2]\n").hexdigest())
    assert path.read_bytes() == b"[1, 2]\n"


@pytest.mark.parametrize(
    "patch",
    [
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 121},
        {"name": 5},
        {"icon": 3},
        {"description": ["a"]},
        {"hideTaskManagement": "yes"},
        {"workEnabled": "yes"},
        {"workEnabled": None},
        {"colour": "teal"},
    ],
)
def test_empty_or_long_name_422(blocks_space_dir: Path, patch):
    before = _tree(blocks_space_dir)
    with _client(blocks_space_dir) as c:
        r = c.put("/api/space", json={"patch": patch, "baseRevision": ""})
        assert r.status_code == 422, r.text
        key = next(iter(patch))
        if key not in spaceconfig.PATCH_KEYS:  # an unknown key is told apart from a bad value
            assert r.json()["detail"] == f'There is no setting named "{key}".'
        elif key != "name":
            assert r.json()["detail"] == f"The setting \"{key}\" can't be saved."
        else:
            assert r.json()["detail"]
    assert _tree(blocks_space_dir) == before
    # Exactly 120 characters is fine.
    spaceconfig.patch(blocks_space_dir, {"name": "y" * 120}, "")
    assert Space(blocks_space_dir).name == "y" * 120


def test_name_change_does_not_rename_folder(blocks_space_dir: Path):
    before = _tree(blocks_space_dir)
    with _client(blocks_space_dir) as c:
        r = c.put("/api/space", json={"patch": {"name": "Renamed space"}, "baseRevision": ""})
        assert r.status_code == 200
        assert r.json()["root"] == str(blocks_space_dir.resolve())
    assert blocks_space_dir.is_dir()
    assert not (blocks_space_dir.parent / "Renamed space").exists()
    after = _tree(blocks_space_dir)
    after.pop(".object/space.json")
    assert after == before


# -- M32 contract: the Work switch (`workEnabled` stored, `workOn` effective) --


def test_work_switch_absent_reads_off_and_writes_nothing(blocks_space_dir: Path):
    before = _tree(blocks_space_dir)
    with _client(blocks_space_dir) as c:
        info = c.get("/api/space").json()
    assert info["workEnabled"] is None and info["workOn"] is False
    fields = spaceconfig.space_fields(blocks_space_dir)
    assert fields["workEnabled"] is None and fields["workOn"] is False
    assert _tree(blocks_space_dir) == before


def test_work_switch_set_changes_only_space_json(blocks_space_dir: Path):
    before = _tree(blocks_space_dir)
    with _client(blocks_space_dir) as c:
        on = c.put("/api/space", json={"patch": {"workEnabled": True}, "baseRevision": ""})
        assert on.status_code == 200, on.text
        assert on.json()["workEnabled"] is True and on.json()["workOn"] is True
        assert c.get("/api/space").json()["workOn"] is True
        off = c.put(
            "/api/space", json={"patch": {"workEnabled": False}, "baseRevision": on.json()["revision"]}
        )
        assert off.status_code == 200, off.text
        assert off.json()["workEnabled"] is False and off.json()["workOn"] is False
    after = _tree(blocks_space_dir)
    assert set(after) - set(before) == {".object/space.json"}
    assert {k: v for k, v in after.items() if k in before} == before  # no .md file, no type file
    assert json.loads((blocks_space_dir / ".object" / "space.json").read_bytes()) == {"workEnabled": False}


def test_work_switch_hand_edited_value_reads_as_absent(tmp_path: Path):
    (tmp_path / ".object").mkdir()
    (tmp_path / ".object" / "space.json").write_text('{"workEnabled": "yes"}', encoding="utf-8")
    fields = spaceconfig.space_fields(tmp_path)
    assert fields["workEnabled"] is None and fields["workOn"] is False
    assert spaceconfig.work_on({"workEnabled": True}) is True
    assert spaceconfig.work_on({"workEnabled": False}) is False
    assert spaceconfig.work_on({}) is False
