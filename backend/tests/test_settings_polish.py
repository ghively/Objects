"""Polish 2026-11-03: device settings keys added after M8 (zoom, editor options)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from objectapp import settings

# Object's desktop zoom factor (electron-settings.ts `zoom`, default 1.0).
POLISH_DEFAULTS = {
    "zoom": 1.0,
}


@pytest.fixture
def state(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(path))
    return path


def test_polish_defaults(state: Path):
    merged, _ = settings.read()
    for key, value in POLISH_DEFAULTS.items():
        assert merged[key] == value


@pytest.mark.parametrize("value", [0.6, 0.65, 1, 1.0, 1.25, 1.5])
def test_zoom_accepts_object_range(state: Path, value):
    merged, _ = settings.patch({"zoom": value}, "")
    assert merged["zoom"] == value


@pytest.mark.parametrize("value", [0.55, 1.55, 0, -1, "1", True, None, float("nan"), float("inf")])
def test_zoom_rejects_out_of_range(state: Path, value):
    with pytest.raises(settings.SettingsProblem):
        settings.patch({"zoom": value}, "")


def test_zoom_bad_value_in_file_reads_as_default(state: Path):
    state.mkdir()
    (state / "settings.json").write_text(json.dumps({"zoom": 9}), encoding="utf-8")
    merged, _ = settings.read()
    assert merged["zoom"] == 1.0
