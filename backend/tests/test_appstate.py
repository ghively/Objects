"""M7 Task 3: the per-user app state folder (`appstate.state_dir`)."""

from __future__ import annotations

import os
from pathlib import Path

from objectapp import appstate, reminders
from objectapp.reminders import ledger_path_for


def test_state_dir_env_override_and_platform_default(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "override"))
    assert appstate.state_dir() == tmp_path / "override"
    assert not (tmp_path / "override").exists()  # a reader never creates it

    monkeypatch.delenv("OBJECT_STATE_DIR")
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "home"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.delenv("XDG_STATE_HOME", raising=False)
    if os.name == "nt":
        assert appstate.state_dir() == tmp_path / "local" / "object"
        monkeypatch.delenv("LOCALAPPDATA")
        assert appstate.state_dir() == tmp_path / "home" / "AppData" / "Local" / "object"
    else:
        assert appstate.state_dir() == tmp_path / "home" / ".local" / "state" / "object"
        monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "xdg"))
        assert appstate.state_dir() == tmp_path / "xdg" / "object"
    assert not any(tmp_path.iterdir())


def test_reminders_ledger_uses_state_dir(tmp_path: Path, monkeypatch):
    # Regression guard (green from the start): M4's ledger path is unchanged.
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    space = tmp_path / "space"
    space.mkdir()
    path = ledger_path_for(space)
    assert path.parent == tmp_path / "state" == reminders._state_dir() == appstate.state_dir()
    assert path.name.startswith("reminders-") and path.suffix == ".json"
