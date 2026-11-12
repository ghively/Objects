"""M33: the two new device settings (the plan's Contract).

``greaterThanMakes`` (Settings > Editor > "Typing "> " makes": ``toggle``, the default, or
``quote``) and ``windowButtons`` (Settings > Appearance > "Window buttons": ``auto``, the
default, ``show`` or ``hide``). Device settings like ``alwaysOpenAsFullPage``: any other value is
refused (422), and a settings file written before M33 reads the defaults and is not rewritten.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp import settings
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space

# ``settings.json`` exactly as the code at ``41857f51`` (M32, before these keys) wrote it for
# ``settings.patch({"themeMode": "light", "alwaysOpenAsFullPage": False, "toggleStyle":
# "bullet", "zoom": 1.1, "appIcon": "blue", "activityName": "Sam"}, "")``.
OLD_FILE = (
    b'{\n  "themeMode": "light",\n  "alwaysOpenAsFullPage": false,\n  "toggleStyle": "bullet",\n'
    b'  "zoom": 1.1,\n  "appIcon": "blue",\n  "activityName": "Sam"\n}\n'
)
OLD_REVISION = "975626b171d7be7e2b83848dc71deb70406760d1bf51b199d8e72cdf3add2b07"


@pytest.fixture
def state(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(path))
    return path


def _stamp(path: Path) -> tuple[str, int, int]:
    st = path.stat()
    return hashlib.sha256(path.read_bytes()).hexdigest(), st.st_size, st.st_mtime_ns


def test_the_defaults(state: Path) -> None:
    assert settings.DEFAULTS["greaterThanMakes"] == "toggle"
    assert settings.DEFAULTS["windowButtons"] == "auto"
    merged, revision = settings.read()
    assert merged["greaterThanMakes"] == "toggle" and merged["windowButtons"] == "auto"
    assert revision == "" and not state.exists()  # reading makes no file


@pytest.mark.parametrize(
    ("key", "values"),
    [("greaterThanMakes", ("quote", "toggle")), ("windowButtons", ("show", "hide", "auto"))],
)
def test_each_value_saves_and_reads_back(state: Path, key: str, values: tuple[str, ...]) -> None:
    _, rev = settings.read()
    for value in values:
        merged, rev = settings.patch({key: value}, rev)
        assert merged[key] == value
        assert settings.read() == (merged, rev)
        assert json.loads((state / "settings.json").read_text("utf-8"))[key] == value


@pytest.mark.parametrize(
    ("key", "bad"),
    [
        ("greaterThanMakes", "blockquote"),
        ("greaterThanMakes", "Quote"),
        ("greaterThanMakes", ""),
        ("greaterThanMakes", None),
        ("greaterThanMakes", True),
        ("greaterThanMakes", ["quote"]),
        ("windowButtons", "automatic"),
        ("windowButtons", "Show"),
        ("windowButtons", ""),
        ("windowButtons", None),
        ("windowButtons", False),
        ("windowButtons", 1),
    ],
)
def test_any_other_value_is_refused_and_nothing_is_written(state: Path, key: str, bad) -> None:
    _, rev = settings.read()
    with pytest.raises(settings.SettingsProblem) as err:
        settings.patch({key: bad}, rev)
    assert err.value.key == key and err.value.message == f"The setting \"{key}\" can't be saved."
    assert not (state / "settings.json").exists()


def test_the_route_saves_them_and_answers_422_for_a_bad_value(state: Path, tmp_path: Path) -> None:
    root = create_space("Notes", tmp_path)
    with TestClient(create_app(Space(root), None, watch=False)) as c:
        got = c.get("/api/settings").json()
        assert got["settings"]["greaterThanMakes"] == "toggle" and got["settings"]["windowButtons"] == "auto"
        r = c.put("/api/settings", json={"patch": {"greaterThanMakes": "quote", "windowButtons": "hide"},
                                         "baseRevision": got["revision"]})
        assert r.status_code == 200, r.text
        assert r.json()["settings"]["greaterThanMakes"] == "quote" and r.json()["settings"]["windowButtons"] == "hide"
        before = _stamp(state / "settings.json")
        for patch in ({"greaterThanMakes": "callout"}, {"windowButtons": "native"}):
            bad = c.put("/api/settings", json={"patch": patch, "baseRevision": r.json()["revision"]})
            assert bad.status_code == 422, bad.text
        assert _stamp(state / "settings.json") == before
        assert c.get("/api/settings").json()["settings"]["greaterThanMakes"] == "quote"


def test_a_file_written_before_m33_reads_the_defaults_and_is_not_rewritten(state: Path, tmp_path: Path) -> None:
    state.mkdir()
    path = state / "settings.json"
    path.write_bytes(OLD_FILE)
    before = _stamp(path)
    merged, revision = settings.read()
    assert revision == OLD_REVISION  # the file's own bytes, as the old code answered
    assert merged["greaterThanMakes"] == "toggle" and merged["windowButtons"] == "auto"
    # ...and everything the file held reads as before
    assert (merged["themeMode"], merged["alwaysOpenAsFullPage"], merged["toggleStyle"]) == ("light", False, "bullet")
    assert (merged["zoom"], merged["appIcon"], merged["activityName"]) == (1.1, "blue", "Sam")
    root = create_space("Notes", tmp_path)
    with TestClient(create_app(Space(root), None, watch=False)) as c:
        got = c.get("/api/settings").json()
        assert got["revision"] == OLD_REVISION
        assert got["settings"]["greaterThanMakes"] == "toggle" and got["settings"]["windowButtons"] == "auto"
    assert _stamp(path) == before
    assert not [p.name for p in state.iterdir() if p.name.startswith("settings") and p.name != "settings.json"]
    # Saving one of them adds only its own key; the file's other keys stay as they were.
    merged, _rev = settings.patch({"greaterThanMakes": "quote"}, revision)
    stored = json.loads(path.read_text("utf-8"))
    assert stored == {**json.loads(OLD_FILE), "greaterThanMakes": "quote"}
    assert "windowButtons" not in stored and merged["windowButtons"] == "auto"


def test_a_bad_value_already_in_the_file_reads_as_the_default(state: Path) -> None:
    state.mkdir()
    path = state / "settings.json"
    path.write_text(json.dumps({"greaterThanMakes": "callout", "windowButtons": 3}), encoding="utf-8")
    before = _stamp(path)
    merged, _rev = settings.read()
    assert merged["greaterThanMakes"] == "toggle" and merged["windowButtons"] == "auto"
    assert _stamp(path) == before
