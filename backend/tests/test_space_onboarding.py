"""Fix pass H2 item 2: a new or empty folder opened with ``objectapp --space`` offers M8's
"Pick a starting point" (Start with basic setup / Empty space), as "Create new space" does.

``GET /api/space`` says ``needsSetup`` while ``space.json`` has no ``setup`` marker, no basic type
file exists and the folder holds no visible file; ``POST /api/space/setup`` applies the pick and
records it. Nothing is written before the pick.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space


def _tree(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


def _client(root: Path) -> TestClient:
    return TestClient(create_app(Space(root), None, watch=False))


def test_empty_folder_needs_setup_and_nothing_is_written(tmp_path: Path):
    root = tmp_path / "fresh"
    root.mkdir()
    with _client(root) as c:
        before = _tree(root)
        assert c.get("/api/space").json()["needsSetup"] is True
        assert _tree(root) == before


def test_basic_pick_writes_the_basic_types_and_the_marker(tmp_path: Path):
    root = tmp_path / "fresh"
    root.mkdir()
    with _client(root) as c:
        res = c.post("/api/space/setup", json={"setup": "basic"})
        assert res.status_code == 200, res.text
        info = res.json()
        assert info["needsSetup"] is False
        ids = {t["id"] for t in info["types"]}
        assert {"person", "meeting", "project", "book"} <= ids
        assert json.loads((root / ".object" / "space.json").read_text())["setup"] == "basic"
        # Asked once: a second pick is refused and changes nothing.
        assert c.post("/api/space/setup", json={"setup": "blank"}).status_code == 409


def test_blank_pick_writes_only_the_marker(tmp_path: Path):
    root = tmp_path / "fresh"
    root.mkdir()
    with _client(root) as c:
        res = c.post("/api/space/setup", json={"setup": "blank"})
        assert res.status_code == 200
        assert res.json()["needsSetup"] is False
        assert not (root / ".object" / "types" / "person.json").exists()
        assert json.loads((root / ".object" / "space.json").read_text())["setup"] == "blank"


def test_unknown_setup_is_refused(tmp_path: Path):
    root = tmp_path / "fresh"
    root.mkdir()
    with _client(root) as c:
        assert c.post("/api/space/setup", json={"setup": "everything"}).status_code == 422
        assert c.get("/api/space").json()["needsSetup"] is True


def test_a_space_with_notes_is_not_asked(blocks_space_dir: Path):
    with _client(blocks_space_dir) as c:
        assert c.get("/api/space").json()["needsSetup"] is False
        assert c.post("/api/space/setup", json={"setup": "basic"}).status_code == 409


def test_create_space_records_the_pick(tmp_path: Path):
    for setup in ("blank", "basic"):
        root = create_space(f"S {setup}", tmp_path, setup)
        assert json.loads((root / ".object" / "space.json").read_text())["setup"] == setup
        with _client(root) as c:
            assert c.get("/api/space").json()["needsSetup"] is False


def test_an_older_basic_space_without_marker_is_not_asked(tmp_path: Path):
    root = create_space("Old", tmp_path, "basic")
    data = json.loads((root / ".object" / "space.json").read_text())
    data.pop("setup")
    (root / ".object" / "space.json").write_text(json.dumps(data))
    with _client(root) as c:
        assert c.get("/api/space").json()["needsSetup"] is False
