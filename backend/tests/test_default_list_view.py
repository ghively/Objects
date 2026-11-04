"""Polish item 20: a type's "Default list view" (``defaultDataViewLayout`` in its JSON)."""

import difflib
from pathlib import Path

from fastapi.testclient import TestClient

from objectapp.server import create_app
from objectapp.space import Space

KEY = "defaultDataViewLayout"


def _changed(before: bytes, after: bytes) -> tuple[list[str], list[str]]:
    diff = [
        d
        for d in difflib.ndiff(before.decode().splitlines(), after.decode().splitlines())
        if d.startswith(("+ ", "- "))
    ]
    return [d[2:] for d in diff if d[0] == "-"], [d[2:] for d in diff if d[0] == "+"]


def _type(c: TestClient, type_id: str) -> dict:
    return next(t for t in c.get("/api/space").json()["types"] if t["id"] == type_id)


def _put(c: TestClient, t: dict):
    return c.put(f"/api/types/{t['id']}", json={"type": t, "baseRevision": t["revision"]})


def test_unset_setting_writes_no_key(tmp_path: Path):
    root = tmp_path / "space"
    root.mkdir()
    sp = Space(root)
    t = sp.create_type("Machine", "Machines")
    path = root / ".object" / "types" / f"{t.id}.json"
    assert KEY not in path.read_text("utf-8")
    with TestClient(create_app(sp, None, watch=False)) as c:
        data = _type(c, t.id)
        assert KEY not in data
        data["description"] = "Hosts"
        assert _put(c, data).status_code == 200
    assert KEY not in path.read_text("utf-8")


def test_setting_it_writes_only_that_key(tmp_path: Path):
    root = tmp_path / "space"
    root.mkdir()
    sp = Space(root)
    t = sp.create_type("Machine", "Machines")
    path = root / ".object" / "types" / f"{t.id}.json"
    before = path.read_bytes()
    with TestClient(create_app(sp, None, watch=False)) as c:
        data = _type(c, t.id)
        data[KEY] = "table"
        r = _put(c, data)
        assert r.status_code == 200, r.text
        assert r.json()["type"][KEY] == "table"
        removed, added = _changed(before, path.read_bytes())
        # the new key is appended; the line before it only gains its comma
        assert removed == ["  }"]
        assert added == ["  },", '  "defaultDataViewLayout": "table"']
        assert _type(c, t.id)[KEY] == "table"


def test_an_unknown_layout_is_refused(tmp_path: Path):
    root = tmp_path / "space"
    root.mkdir()
    sp = Space(root)
    t = sp.create_type("Machine", "Machines")
    with TestClient(create_app(sp, None, watch=False)) as c:
        data = _type(c, t.id)
        data[KEY] = "spiral"
        assert _put(c, data).status_code == 422
    assert KEY not in (root / ".object" / "types" / f"{t.id}.json").read_text("utf-8")


def _space_with_stored(tmp_path: Path, value: str) -> tuple[Path, Path, str]:
    """A space whose Machine type file holds ``defaultDataViewLayout: value`` (any string)."""
    root = tmp_path / "space"
    root.mkdir()
    sp = Space(root)
    t = sp.create_type("Machine", "Machines")
    path = root / ".object" / "types" / f"{t.id}.json"
    with TestClient(create_app(sp, None, watch=False)) as c:
        data = _type(c, t.id)
        data[KEY] = "table"
        assert _put(c, data).status_code == 200
    path.write_bytes(path.read_bytes().replace(b'"table"', f'"{value}"'.encode()))
    return root, path, t.id


def test_a_stored_unknown_layout_does_not_block_other_edits(tmp_path: Path):
    root, path, type_id = _space_with_stored(tmp_path, "spiral")
    before = path.read_bytes()
    with TestClient(create_app(Space(root), None, watch=False)) as c:
        data = _type(c, type_id)
        assert data[KEY] == "spiral"
        data["description"] = "Hosts"
        r = _put(c, data)
        assert r.status_code == 200, r.text
    removed, added = _changed(before, path.read_bytes())
    assert all(KEY not in line for line in removed + added)
    assert '  "defaultDataViewLayout": "spiral"' in path.read_text("utf-8").splitlines()


def test_changing_to_another_unknown_layout_is_still_refused(tmp_path: Path):
    root, path, type_id = _space_with_stored(tmp_path, "spiral")
    before = path.read_bytes()
    with TestClient(create_app(Space(root), None, watch=False)) as c:
        data = _type(c, type_id)
        data[KEY] = "helix"
        assert _put(c, data).status_code == 422
    assert path.read_bytes() == before


def test_null_unsets_the_layout(tmp_path: Path):
    root, path, type_id = _space_with_stored(tmp_path, "table")
    with TestClient(create_app(Space(root), None, watch=False)) as c:
        data = _type(c, type_id)
        data[KEY] = None
        r = _put(c, data)
        assert r.status_code == 200, r.text
        assert KEY not in r.json()["type"]
        assert KEY not in _type(c, type_id)
    assert KEY not in path.read_text("utf-8")


def test_null_unsets_a_stored_unknown_layout(tmp_path: Path):
    root, path, type_id = _space_with_stored(tmp_path, "spiral")
    with TestClient(create_app(Space(root), None, watch=False)) as c:
        data = _type(c, type_id)
        data[KEY] = None
        assert _put(c, data).status_code == 200
    assert KEY not in path.read_text("utf-8")


def test_null_on_an_unset_type_writes_nothing_for_it(tmp_path: Path):
    root = tmp_path / "space"
    root.mkdir()
    sp = Space(root)
    t = sp.create_type("Machine", "Machines")
    path = root / ".object" / "types" / f"{t.id}.json"
    with TestClient(create_app(sp, None, watch=False)) as c:
        data = _type(c, t.id)
        data[KEY] = None
        data["description"] = "Hosts"
        assert _put(c, data).status_code == 200
    assert KEY not in path.read_text("utf-8")
