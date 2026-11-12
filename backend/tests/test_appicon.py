"""M31 item 15a: Appearance "App icon": the window icon in the chosen colour (``appicon``)."""

from __future__ import annotations

import json

import pytest
from PIL import Image

from objectapp import appicon


def test_colours_match_the_setting_choices():
    from objectapp.settings import _CHOICES

    assert set(appicon.COLORS) == set(_CHOICES["appIcon"]) - {"default"}


def test_icon_svg_fills_the_bolt_with_the_colour():
    svg = appicon.icon_svg("red")
    assert svg.startswith("<svg")
    assert f'fill="{appicon.COLORS["red"]}"' in svg
    assert appicon.BOLT_PATH in svg


def test_default_and_unknown_colours_have_no_window_icon(tmp_path):
    assert appicon.window_icon("default", tmp_path, "linux") is None
    assert appicon.window_icon("teal", tmp_path, "linux") is None
    assert list(tmp_path.iterdir()) == []


def test_window_icon_is_a_png_in_the_colour_on_linux(tmp_path):
    path = appicon.window_icon("blue", tmp_path, "linux")
    assert path == tmp_path / "app-icon-blue.png"
    with Image.open(path) as img:
        assert img.size == (appicon.ICON_SIZE, appicon.ICON_SIZE)
        rgba = img.convert("RGBA")
        # The middle of the bolt is the colour; a corner is transparent.
        r, g, b, a = rgba.getpixel((appicon.ICON_SIZE // 2, appicon.ICON_SIZE // 2))
        assert a == 255
        assert "#{:02x}{:02x}{:02x}".format(r, g, b) == appicon.COLORS["blue"]
        assert rgba.getpixel((1, appicon.ICON_SIZE - 2))[3] == 0


def test_window_icon_is_an_ico_on_windows(tmp_path):
    path = appicon.window_icon("green", tmp_path, "win32")
    assert path == tmp_path / "app-icon-green.ico"
    assert path.read_bytes()[:4] == b"\x00\x00\x01\x00"


def test_window_icon_reuses_the_file(tmp_path):
    first = appicon.window_icon("pink", tmp_path, "linux")
    stamp = first.stat().st_mtime_ns
    assert appicon.window_icon("pink", tmp_path, "linux") == first
    assert first.stat().st_mtime_ns == stamp


@pytest.fixture
def state(tmp_path, monkeypatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    return tmp_path / "state"


def test_startup_icon_reads_the_device_setting(state):
    assert appicon.startup_icon("linux") is None  # no settings file: the default icon
    state.mkdir()
    (state / "settings.json").write_text(json.dumps({"appIcon": "orange"}), encoding="utf-8")
    path = appicon.startup_icon("linux")
    assert path == state / "app-icon" / "app-icon-orange.png"
    assert path.is_file()


def test_startup_icon_never_fails_the_launch(state):
    state.mkdir()
    (state / "settings.json").write_text("{not json", encoding="utf-8")
    assert appicon.startup_icon("linux") is None


def test_launcher_passes_the_window_icon(state):
    from objectapp import __main__ as launcher

    assert launcher._window_icon_options("linux") == {}
    state.mkdir()
    (state / "settings.json").write_text(json.dumps({"appIcon": "purple"}), encoding="utf-8")
    assert launcher._window_icon_options("linux") == {"icon": str(state / "app-icon" / "app-icon-purple.png")}


def test_desktop_shell_always_gets_an_icon_file(state):
    """M33: the desktop shell would show its own icon with none, so `default` is Object's bolt."""
    path = appicon.desktop_icon("linux")
    assert path == state / "app-icon" / "app-icon-default.png"
    with Image.open(path) as img:
        r, g, b, a = img.convert("RGBA").getpixel((appicon.ICON_SIZE // 2, appicon.ICON_SIZE // 2))
        assert a == 255 and "#{:02x}{:02x}{:02x}".format(r, g, b) == appicon.DEFAULT_FILL
    assert appicon.desktop_icon("win32") == state / "app-icon" / "app-icon-default.ico"

    (state / "settings.json").write_text(json.dumps({"appIcon": "green"}), encoding="utf-8")
    assert appicon.desktop_icon("linux") == state / "app-icon" / "app-icon-green.png"
    assert appicon.desktop_icon("darwin") == state / "app-icon" / "app-icon-green.png"
    # The pywebview window is as it was: no icon for `default`.
    (state / "settings.json").write_text(json.dumps({"appIcon": "default"}), encoding="utf-8")
    assert appicon.startup_icon("linux") is None


def test_desktop_icon_never_fails_the_launch(state):
    state.mkdir()
    (state / "settings.json").write_text("{not json", encoding="utf-8")
    assert appicon.desktop_icon("linux") is None
