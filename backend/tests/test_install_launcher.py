"""M33: ``scripts/install-launcher.py`` writes a launcher entry for the current user (a Linux
``.desktop`` file, a Windows Start menu shortcut, a macOS ``.command`` file) that runs
``uv run objectapp --space <folder>``. Nothing is installed for real here: everything is written
under a temporary home, and PowerShell is a fake that records its script."""

from __future__ import annotations

import importlib.util
import stat
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "install-launcher.py"


@pytest.fixture(scope="module")
def launcher():
    spec = importlib.util.spec_from_file_location("install_launcher", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def place(tmp_path: Path):
    home = tmp_path / "home"
    home.mkdir()
    space = tmp_path / "My notes"
    space.mkdir()
    repo = tmp_path / "Object repo"
    repo.mkdir()
    return {"home": home, "space": space, "repo": repo, "uv": "/usr/bin/uv", "environ": {}}


class FakePowerShell:
    def __init__(self, code: int = 0) -> None:
        self.code = code
        self.scripts: list[str] = []

    def __call__(self, script: str) -> int:
        self.scripts.append(script)
        return self.code


# -- Linux -------------------------------------------------------------------------------------


def test_linux_writes_a_desktop_entry_for_the_current_user(launcher, place) -> None:
    icon = place["home"] / "icon.png"
    path = launcher.install("linux", name="Object", icon=icon, **place)
    assert path == place["home"] / ".local" / "share" / "applications" / "object.desktop"
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    assert lines[0] == "[Desktop Entry]"
    assert "Type=Application" in lines
    assert "Name=Object" in lines
    assert f'Exec=/usr/bin/uv run --directory "{place["repo"]}" objectapp --space "{place["space"]}"' in lines
    assert f"Icon={icon}" in lines
    assert "Terminal=false" in lines
    # The shell's window class (desktop/main.js: app.setDesktopName('object.desktop')), so the
    # taskbar groups the window under this entry.
    assert "StartupWMClass=object" in lines
    assert "X-Object-Launcher=install-launcher.py" in lines
    assert text.endswith("\n")


def test_linux_honours_xdg_data_home_and_the_name(launcher, place) -> None:
    place["environ"] = {"XDG_DATA_HOME": str(place["home"] / "data")}
    path = launcher.install("linux", name="Notes at home", icon=None, **place)
    assert path == place["home"] / "data" / "applications" / "object.desktop"
    lines = path.read_text(encoding="utf-8").splitlines()
    assert "Name=Notes at home" in lines
    assert not any(line.startswith("Icon=") for line in lines)


def test_desktop_entry_quotes_what_the_format_reserves(launcher) -> None:
    text = launcher.desktop_entry(
        "Object", Path("/opt/object"), Path('/home/a b/50% "notes" $x\\y'), None, "uv"
    )
    (exec_line,) = [line for line in text.splitlines() if line.startswith("Exec=")]
    assert exec_line == (
        'Exec=uv run --directory /opt/object objectapp --space "/home/a b/50%% \\\\"notes\\\\" \\\\$x\\\\\\\\y"'
    )


def test_linux_refuses_a_file_it_did_not_write_unless_forced(launcher, place) -> None:
    path = place["home"] / ".local" / "share" / "applications" / "object.desktop"
    path.parent.mkdir(parents=True)
    path.write_text("[Desktop Entry]\nName=Someone else's\n", encoding="utf-8")
    with pytest.raises(launcher.Refused, match="was not written by this script"):
        launcher.install("linux", name="Object", icon=None, **place)
    assert path.read_text(encoding="utf-8") == "[Desktop Entry]\nName=Someone else's\n"
    with pytest.raises(launcher.Refused, match="was not written by this script"):
        launcher.remove("linux", name="Object", **_where(place))
    assert path.is_file()

    launcher.install("linux", name="Object", icon=None, force=True, **place)
    assert "X-Object-Launcher=install-launcher.py" in path.read_text(encoding="utf-8")
    # Its own file is replaced without --force, and removed.
    launcher.install("linux", name="Renamed", icon=None, **place)
    assert "Name=Renamed" in path.read_text(encoding="utf-8")
    assert launcher.remove("linux", name="Object", **_where(place)) == path
    assert not path.exists()
    assert launcher.remove("linux", name="Object", **_where(place)) is None


def _where(place: dict) -> dict:
    return {"home": place["home"], "environ": place["environ"]}


# -- macOS -------------------------------------------------------------------------------------


def test_macos_writes_a_command_file_in_applications(launcher, place) -> None:
    path = launcher.install("darwin", name="Object", icon=None, **place)
    assert path == place["home"] / "Applications" / "Object.command"
    text = path.read_text(encoding="utf-8")
    assert text.splitlines()[0] == "#!/bin/sh"
    assert "# Object launcher (install-launcher.py)" in text
    assert text.splitlines()[-1] == (
        f"exec /usr/bin/uv run --directory '{place['repo']}' objectapp --space '{place['space']}'"
    )
    assert path.stat().st_mode & stat.S_IXUSR


def test_macos_refuses_and_removes_like_linux(launcher, place) -> None:
    path = place["home"] / "Applications" / "Object.command"
    path.parent.mkdir()
    path.write_text("#!/bin/sh\necho mine\n", encoding="utf-8")
    with pytest.raises(launcher.Refused):
        launcher.install("darwin", name="Object", icon=None, **place)
    launcher.install("darwin", name="Object", icon=None, force=True, **place)
    assert launcher.remove("darwin", name="Object", **_where(place)) == path
    assert not path.exists()


# -- Windows -----------------------------------------------------------------------------------


def test_windows_makes_a_start_menu_shortcut_through_powershell(launcher, place) -> None:
    place["environ"] = {"APPDATA": str(place["home"] / "AppData" / "Roaming")}
    place["uv"] = r"C:\Tools\uv.exe"
    place["repo"] = Path(r"C:\Git\Objects")
    place["space"] = Path(r"C:\Users\Gene's notes")
    powershell = FakePowerShell()
    path = launcher.install("win32", name="Object", icon=Path(r"C:\state\app-icon-default.ico"),
                            powershell=powershell, **place)
    lnk = place["home"] / "AppData" / "Roaming" / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Object.lnk"
    assert path == lnk
    (script,) = powershell.scripts
    assert "New-Object -ComObject WScript.Shell" in script
    assert f"$path = '{lnk}'" in script
    assert "$link.TargetPath = 'powershell.exe'" in script
    # The console never shows: PowerShell starts hidden, the shortcut starts minimised.
    assert "$link.WindowStyle = 7" in script
    assert (
        "$link.Arguments = '-NoProfile -WindowStyle Hidden -Command \"& ''C:\\Tools\\uv.exe'' run --directory "
        "''C:\\Git\\Objects'' objectapp --space ''C:\\Users\\Gene''''s notes''\"'"
    ) in script
    assert "$link.WorkingDirectory = 'C:\\Git\\Objects'" in script
    assert "$link.IconLocation = 'C:\\state\\app-icon-default.ico,0'" in script
    assert "$link.Description = 'Object launcher (install-launcher.py)'" in script
    # It refuses a shortcut it did not write: the script checks the Description first.
    assert "if ((Test-Path -LiteralPath $path) -and $shell.CreateShortcut($path).Description -ne $marker) { exit 3 }" in script
    assert script.index("exit 3") < script.index("$link.Save()")


def test_windows_refusal_force_and_remove(launcher, place) -> None:
    place["environ"] = {"APPDATA": str(place["home"] / "Roaming")}
    with pytest.raises(launcher.Refused, match="was not written by this script"):
        launcher.install("win32", name="Object", icon=None, powershell=FakePowerShell(3), **place)
    forced = FakePowerShell()
    launcher.install("win32", name="Object", icon=None, force=True, powershell=forced, **place)
    assert "exit 3" not in forced.scripts[0]
    assert "IconLocation" not in forced.scripts[0]

    removing = FakePowerShell()
    lnk = place["home"] / "Roaming" / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Object.lnk"
    assert launcher.remove("win32", name="Object", powershell=removing, **_where(place)) == lnk
    assert "Remove-Item -LiteralPath $path" in removing.scripts[0]
    assert "$link.Save()" not in removing.scripts[0]
    assert launcher.remove("win32", name="Object", powershell=FakePowerShell(4), **_where(place)) is None
    with pytest.raises(launcher.Refused):
        launcher.remove("win32", name="Object", powershell=FakePowerShell(3), **_where(place))
    with pytest.raises(launcher.Refused, match="PowerShell"):
        launcher.install("win32", name="Object", icon=None, powershell=FakePowerShell(1), **place)


# -- the command line --------------------------------------------------------------------------


def test_the_script_prints_what_it_wrote_and_what_it_runs(launcher, place, monkeypatch, capsys) -> None:
    monkeypatch.setattr(launcher.sys, "platform", "linux")
    monkeypatch.setattr(launcher.Path, "home", classmethod(lambda cls: place["home"]))
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    monkeypatch.setattr(launcher, "_icon", lambda platform, repo: None)
    monkeypatch.setattr(launcher.shutil, "which", lambda name: "/usr/bin/uv")
    assert launcher.main(["--space", str(place["space"])]) == 0
    path = place["home"] / ".local" / "share" / "applications" / "object.desktop"
    out = capsys.readouterr().out
    assert f"Wrote {path}" in out
    assert f"It runs: /usr/bin/uv run --directory {launcher.REPO} objectapp --space {place['space']}" in out
    assert "Name=Object" in path.read_text(encoding="utf-8")

    assert launcher.main(["--space", str(place["space"]), "--remove"]) == 0
    assert f"Removed {path}" in capsys.readouterr().out
    assert launcher.main(["--space", str(place["space"]), "--remove"]) == 0
    assert "Nothing to remove" in capsys.readouterr().out


def test_the_script_refuses_plainly(launcher, place, monkeypatch, capsys) -> None:
    monkeypatch.setattr(launcher.sys, "platform", "linux")
    monkeypatch.setattr(launcher.Path, "home", classmethod(lambda cls: place["home"]))
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    monkeypatch.setattr(launcher, "_icon", lambda platform, repo: None)
    with pytest.raises(SystemExit):
        launcher.main([])  # --space is required
    capsys.readouterr()
    assert launcher.main(["--space", str(place["home"] / "missing")]) == 1
    assert "is not a folder" in capsys.readouterr().err
    assert launcher.main(["--space", str(place["space"]), "--name", "a/b"]) == 1
    assert "name" in capsys.readouterr().err
    path = place["home"] / ".local" / "share" / "applications" / "object.desktop"
    path.parent.mkdir(parents=True)
    path.write_text("[Desktop Entry]\n", encoding="utf-8")
    assert launcher.main(["--space", str(place["space"])]) == 1
    assert "--force" in capsys.readouterr().err
    assert launcher.main(["--space", str(place["space"]), "--force"]) == 0


def test_a_system_without_a_launcher_is_said_plainly(launcher, place) -> None:
    with pytest.raises(launcher.Refused, match="Linux, Windows and macOS"):
        launcher.install("freebsd14", name="Object", icon=None, **place)
