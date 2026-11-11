"""M8 Task 2: the new device settings keys, the Time zone setting and the M8 routers."""

from __future__ import annotations

import copy
from datetime import timedelta, timezone
from pathlib import Path

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from objectapp import (
    api_blocks,
    api_history,
    api_merge,
    api_spaces_m8,
    api_tasks,
    settings,
)
from objectapp.server import create_app
from objectapp.space import Space

M8_DEFAULTS = {
    "language": "en",
    "decimalSeparator": "automatic",
    "timeZone": None,
    "backlinkSectionsDefault": {
        "backlinks": "open",
        "relatedContent": "open",
        "unlinkedMentions": "open",
    },
    "backlinkContentView": "embed",
    "relatedContentHiddenTypes": [],
    "nestedBacklinkView": "showBlockContainingBacklink",
    "presentation": {
        "hideCoverImage": False,
        "hideProgressIndicator": False,
        "hideTitle": False,
        "footerLeft": "",
        "footerRight": "",
    },
}

M8_ROUTERS = (api_tasks, api_history, api_blocks, api_merge, api_spaces_m8)


@pytest.fixture
def state(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(path))
    return path


def _space(tmp_path: Path, name: str = "space") -> Space:
    root = tmp_path / name
    root.mkdir(exist_ok=True)
    return Space(root)


def _put(client: TestClient, patch: dict, base: str | None = None):
    if base is None:
        base = client.get("/api/settings").json()["revision"]
    return client.put("/api/settings", json={"patch": patch, "baseRevision": base})


def test_m8_defaults(state: Path):
    for key, value in M8_DEFAULTS.items():
        assert settings.DEFAULTS[key] == value, key
    merged, revision = settings.read()
    assert {k: merged[k] for k in M8_DEFAULTS} == M8_DEFAULTS and revision == ""
    assert not state.exists()
    merged["presentation"]["footerLeft"] = "changed"
    merged["relatedContentHiddenTypes"].append("x")
    assert settings.DEFAULTS["presentation"]["footerLeft"] == ""
    assert settings.DEFAULTS["relatedContentHiddenTypes"] == []


GOOD = {
    "language": "pt-br",
    "decimalSeparator": "comma",
    "timeZone": "Europe/Berlin",
    "backlinkSectionsDefault": {"backlinks": "closed", "relatedContent": "hidden", "unlinkedMentions": "open"},
    "backlinkContentView": "wideCard",
    "relatedContentHiddenTypes": ["task", "dailynote"],
    "nestedBacklinkView": "showFullPathAbove",
    "presentation": {
        "hideCoverImage": True,
        "hideProgressIndicator": False,
        "hideTitle": True,
        "footerLeft": "Left",
        "footerRight": "Right",
    },
}

BAD = {
    "language": ["fr-ca", "EN", None, 1],
    "decimalSeparator": ["period", None, True],
    "timeZone": ["Mars/Base", "", " Europe/Berlin", "../etc/passwd", "/etc/localtime", 5, "America"],
    "backlinkSectionsDefault": [
        None,
        "open",
        {"backlinks": "open", "relatedContent": "open"},
        {"backlinks": "open", "relatedContent": "open", "unlinkedMentions": "shut"},
        {"backlinks": "open", "relatedContent": "open", "unlinkedMentions": "open", "x": "open"},
    ],
    "backlinkContentView": ["card", None],
    "relatedContentHiddenTypes": ["task", [1], None, {"task": True}],
    "nestedBacklinkView": ["showFullPath", None],
    "presentation": [
        None,
        {**M8_DEFAULTS["presentation"], "hideTitle": "yes"},
        {**M8_DEFAULTS["presentation"], "footerLeft": None},
        {k: v for k, v in M8_DEFAULTS["presentation"].items() if k != "footerRight"},
        {**M8_DEFAULTS["presentation"], "extra": 1},
    ],
}


def test_m8_keys_shape_checks(state: Path, tmp_path: Path):
    assert set(GOOD) == set(M8_DEFAULTS) == set(BAD)
    client = TestClient(create_app(_space(tmp_path), watch=False))
    with client:
        for key, values in BAD.items():
            for value in values:
                r = _put(client, {key: value})
                assert r.status_code == 422, (key, value)
                assert r.json()["detail"] == f"The setting \"{key}\" can't be saved."
        assert not (state / "settings.json").exists()  # nothing written on a 422

        r = _put(client, copy.deepcopy(GOOD))
        assert r.status_code == 200, r.text
        got = r.json()["settings"]
        assert {k: got[k] for k in GOOD} == GOOD
        assert client.get("/api/settings").json()["settings"] == got

        # A hand-edited file with a bad value reads as the default for that key only.
        path = settings.settings_path()
        path.write_text('{"timeZone": "Mars/Base", "language": "de"}', encoding="utf-8")
        merged = client.get("/api/settings").json()["settings"]
        assert merged["timeZone"] is None and merged["language"] == "de"


def _today(client: TestClient) -> str:
    r = client.get("/api/calendar", params={"from": "2026-10-27", "to": "2026-10-28"})
    assert r.status_code == 200, r.text
    return r.json()["today"]


def test_time_zone_setting_applies_to_space_tz(state: Path, tmp_path: Path, monkeypatch):
    clock = tmp_path / "clock.txt"
    clock.write_text("2026-10-27T23:30:00Z", encoding="utf-8")
    monkeypatch.setenv("OBJECT_CLOCK_FILE", str(clock))
    space = _space(tmp_path)
    device = timezone(timedelta(hours=-5))  # the "device" zone for this test
    space.tz = device
    client = TestClient(create_app(space, watch=False))
    with client:
        assert _today(client) == "2026-10-27"
        r = _put(client, {"timeZone": "Europe/Berlin"})
        assert r.status_code == 200, r.text
        assert space.tz.key == "Europe/Berlin"
        assert _today(client) == "2026-10-28"
        # An unknown zone is refused and leaves the running zone alone.
        assert _put(client, {"timeZone": "Mars/Base"}).status_code == 422
        assert _today(client) == "2026-10-28"
        r = _put(client, {"timeZone": None})
        assert r.status_code == 200
        assert space.tz is device
        assert _today(client) == "2026-10-27"

    # At start-up the saved zone applies before any request.
    settings.patch({"timeZone": "Asia/Tokyo"}, settings.read()[1])
    space2 = _space(tmp_path)
    with TestClient(create_app(space2, watch=False)) as client2:
        assert space2.tz.key == "Asia/Tokyo"
        assert _today(client2) == "2026-10-28"


def test_m8_routers_mounted(state: Path, tmp_path: Path, monkeypatch):
    # The stubs are empty routers today: an unknown path under each prefix is 404, not 405.
    with TestClient(create_app(_space(tmp_path), watch=False)) as client:
        for path in ("/api/tasks/nope", "/api/history/nope", "/api/block/nope",
                     "/api/object/merge/nope", "/api/spaces/delete/nope"):
            assert client.get(path).status_code == 404, path
            assert client.post(path, json={}).status_code == 404, path

    # Each module's `router(ctx)` is called once with the app's context and included under /api.
    seen = []
    for module in M8_ROUTERS:
        name = module.__name__.rsplit(".", 1)[1]

        def probe(ctx, _name=name):
            seen.append((_name, ctx))
            r = APIRouter()

            @r.get(f"/_probe/{_name}")
            def _probe():
                return {"module": _name, "hasSettingsHook": callable(ctx.settings_changed)}

            return r

        monkeypatch.setattr(module, "router", probe)
    space = _space(tmp_path)
    with TestClient(create_app(space, watch=False)) as client:
        for module in M8_ROUTERS:
            name = module.__name__.rsplit(".", 1)[1]
            r = client.get(f"/api/_probe/{name}")
            assert r.status_code == 200, name
            assert r.json() == {"module": name, "hasSettingsHook": True}
    assert sorted(n for n, _ in seen) == sorted(m.__name__.rsplit(".", 1)[1] for m in M8_ROUTERS)
    assert all(ctx.space is space for _, ctx in seen)


def test_create_space_setup_parameter(state: Path, tmp_path: Path):
    from objectapp.spaces import create_space

    parent = tmp_path / "parent"
    parent.mkdir()
    made = create_space("Plain", parent, setup="blank")
    # M32: a new space also holds the types every space starts with.
    assert sorted(p.relative_to(made).as_posix() for p in made.rglob("*")) == [
        ".object", ".object/space.json", ".object/types",
        ".object/types/dailynote.json", ".object/types/page.json",
        ".object/types/tag.json", ".object/types/task.json",
    ]  # fmt: skip
    # M8 Task 8 filled `basic` (see test_basicsetup.py); an unknown setup makes nothing.
    with pytest.raises(ValueError):
        create_space("Fancy", parent, setup="fancy")
    assert not (parent / "Fancy").exists()

    with TestClient(create_app(_space(tmp_path, "current"), watch=False)) as client:
        r = client.post("/api/spaces", json={"name": "Via route", "location": str(parent), "setup": "blank"})
        assert r.status_code == 201, r.text
        r = client.post("/api/spaces", json={"name": "Odd", "location": str(parent), "setup": "fancy"})
        assert r.status_code == 422
        assert not (parent / "Odd").exists()
