"""M7 Task 3: device settings in `<state dir>/settings.json`."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import settings
from objectapp.server import create_app
from objectapp.space import ReadOnly, Space
from objectapp.typemodel import RevisionConflict

CONTRACT_DEFAULTS = {
    "themeMode": "dark",
    "lightTheme": "light",
    "darkTheme": "dark",
    "font": "sans-serif",
    "monochromeTags": False,
    "monochromeTypeLabels": False,
    "toggleStyle": "toggle",
    "disableNumberedListTransformation": False,
    "disableSpellcheck": False,
    "alwaysOpenAsFullPage": False,
    "hideEntityIconsOnInlineLinks": False,
    "hideOutlinerLines": False,
    "twentyFourHourTime": False,
    "dateFormatting": "localized",
    "openOnStart": {},
    "startupSpace": "lastOpened",
    "startupSpacePath": None,
}


@pytest.fixture
def state(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(path))
    return path


def _tree(root: Path) -> dict[str, str]:
    if not root.exists():
        return {}
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def test_settings_defaults_without_file(state: Path):
    assert settings.DEFAULTS == CONTRACT_DEFAULTS
    merged, revision = settings.read()
    assert merged == CONTRACT_DEFAULTS and revision == ""
    assert not state.exists()  # a read never creates the folder or the file
    merged["openOnStart"]["x"] = {"mode": "today"}
    assert settings.DEFAULTS["openOnStart"] == {}  # callers get a copy


def test_settings_patch_round_trip_and_unknown_kept(state: Path):
    state.mkdir()
    (state / "settings.json").write_text(json.dumps({"future": [1, 2], "font": "serif"}), encoding="utf-8")
    merged, rev = settings.read()
    assert merged["font"] == "serif" and "future" not in merged
    patch = {
        "themeMode": "light",
        "lightTheme": "lightDimmed",
        "twentyFourHourTime": True,
        "openOnStart": {"/spaces/a": {"mode": "specificObject", "path": "Pages/A.md"}, "/b": {"mode": "today"}},
        "startupSpace": "specific",
        "startupSpacePath": "/spaces/a",
    }
    merged, new_rev = settings.patch(patch, rev)
    assert new_rev and new_rev != rev
    assert merged == {**CONTRACT_DEFAULTS, "font": "serif", **patch}
    assert settings.read() == (merged, new_rev)
    stored = json.loads((state / "settings.json").read_text(encoding="utf-8"))
    assert stored == {"future": [1, 2], "font": "serif", **patch}
    # Top-level keys are replaced, not merged.
    merged, _ = settings.patch({"openOnStart": {}, "startupSpacePath": None}, new_rev)
    assert merged["openOnStart"] == {} and merged["startupSpacePath"] is None


def test_settings_patch_route_round_trip(state: Path, blocks_space_dir: Path):
    with TestClient(create_app(Space(blocks_space_dir), None, watch=False)) as c:
        got = c.get("/api/settings").json()
        assert got == {"settings": CONTRACT_DEFAULTS, "revision": ""}
        r = c.put("/api/settings", json={"patch": {"darkTheme": "darkDimmed"}, "baseRevision": ""})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["settings"]["darkTheme"] == "darkDimmed" and body["revision"]
        assert c.get("/api/settings").json() == body


@pytest.mark.parametrize(
    "patch",
    [
        {"themeMode": "sepia"},
        {"lightTheme": "dark"},
        {"darkTheme": 1},
        {"font": "comic"},
        {"toggleStyle": None},
        {"dateFormatting": "ISO"},
        {"startupSpace": "first"},
        {"monochromeTags": "true"},
        {"disableSpellcheck": 0},
        {"startupSpacePath": 7},
        {"openOnStart": []},
        {"openOnStart": {"/a": "today"}},
        {"openOnStart": {"/a": {"mode": "tomorrow"}}},
        {"openOnStart": {"/a": {"mode": "specificObject", "path": 3}}},
        {"openOnStart": {"/a": {"mode": "today", "extra": True}}},
        {"language": "de"},
    ],
)
def test_settings_bad_shape_422(state: Path, blocks_space_dir: Path, patch):
    key = next(iter(patch))
    with pytest.raises(settings.SettingsProblem):
        settings.patch(patch, "")
    with TestClient(create_app(Space(blocks_space_dir), None, watch=False)) as c:
        r = c.put("/api/settings", json={"patch": patch, "baseRevision": ""})
        assert r.status_code == 422, r.text
        assert r.json()["detail"] == f"Cannot patch: {key}"
    assert not (state / "settings.json").exists()


def test_settings_stale_409(state: Path, blocks_space_dir: Path):
    _, rev = settings.patch({"font": "monospace"}, "")
    with pytest.raises(RevisionConflict):
        settings.patch({"font": "serif"}, "")
    with TestClient(create_app(Space(blocks_space_dir), None, watch=False)) as c:
        r = c.put("/api/settings", json={"patch": {"font": "serif"}, "baseRevision": "old"})
        assert r.status_code == 409
        assert r.json()["currentRevision"] == rev
    assert settings.read()[0]["font"] == "monospace"


def test_settings_unreadable_423_not_replaced(state: Path, blocks_space_dir: Path):
    state.mkdir()
    path = state / "settings.json"
    path.write_bytes(b"not json")
    rev = hashlib.sha256(b"not json").hexdigest()
    with pytest.raises(ReadOnly):
        settings.read()
    with pytest.raises(ReadOnly):
        settings.patch({"font": "serif"}, rev)
    with TestClient(create_app(Space(blocks_space_dir), None, watch=False)) as c:
        assert c.get("/api/settings").status_code == 423
        assert c.put("/api/settings", json={"patch": {"font": "serif"}, "baseRevision": rev}).status_code == 423
    assert path.read_bytes() == b"not json"


def test_settings_file_lives_in_state_dir(state: Path, blocks_space_dir: Path):
    before = _tree(blocks_space_dir)
    with TestClient(create_app(Space(blocks_space_dir), None, watch=False)) as c:
        r = c.put("/api/settings", json={"patch": {"hideOutlinerLines": True}, "baseRevision": ""})
        assert r.status_code == 200
    assert settings.settings_path() == state / "settings.json"
    assert (state / "settings.json").is_file()
    assert _tree(blocks_space_dir) == before


def test_get_space_and_settings_write_nothing(state: Path, blocks_space_dir: Path):
    # The app lifespan's M4 reminder scheduler keeps its ledger in the state dir; the
    # snapshot is taken once the app is up, so only the GETs are measured.
    space_before = _tree(blocks_space_dir)
    with TestClient(create_app(Space(blocks_space_dir), None, watch=False)) as c:
        state_before = _tree(state)
        for _ in range(2):
            assert c.get("/api/space").status_code == 200
            assert c.get("/api/settings").status_code == 200
        assert _tree(state) == state_before
    assert _tree(blocks_space_dir) == space_before
    assert not (blocks_space_dir / ".capacities" / "space.json").exists()
    assert not (state / "settings.json").exists()

    # With both files present, reading still changes neither.
    settings.patch({"font": "serif"}, "")
    (blocks_space_dir / ".capacities" / "space.json").write_bytes(b'{"name": "S"}\r\n')
    space_before = _tree(blocks_space_dir)
    with TestClient(create_app(Space(blocks_space_dir), None, watch=False)) as c:
        state_before = _tree(state)
        assert c.get("/api/space").json()["name"] == "S"
        assert c.get("/api/settings").json()["settings"]["font"] == "serif"
        assert _tree(state) == state_before
    assert _tree(blocks_space_dir) == space_before
