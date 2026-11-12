"""Write a launcher entry for Object, for the current user (M33).

    uv run python scripts/install-launcher.py --space <folder> [--name Object] [--force]
    uv run python scripts/install-launcher.py --space <folder> --remove

The entry runs ``uv run --directory <this repository> objectapp --space <folder>``:

- Linux: ``~/.local/share/applications/object.desktop`` (``$XDG_DATA_HOME`` when set). Its
  ``StartupWMClass`` is the desktop window's class, so the taskbar groups the window under it.
- Windows: a Start menu shortcut, ``<name>.lnk``, made through PowerShell's ``WScript.Shell``;
  the console window stays hidden.
- macOS: ``~/Applications/<name>.command``.

Run by hand, never by the app. It prints what it wrote. It replaces only a file it wrote itself
(it marks its files); ``--force`` replaces whatever is there. ``--remove`` takes the entry away.
"""

from __future__ import annotations

import argparse
import os
import re
import shlex
import shutil
import subprocess
import sys
from collections.abc import Callable, Mapping
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MARKER = "install-launcher.py"
DESKTOP_MARKER = f"X-Object-Launcher={MARKER}"
COMMENT_MARKER = f"Object launcher ({MARKER})"
WM_CLASS = "object"
"""The desktop window's class (``desktop/main.js``: ``app.setDesktopName('object.desktop')``)."""

NOT_OURS = 3
MISSING = 4


class Refused(Exception):
    """The script will not do this; the message says why, plainly."""


def launch_command(repo: Path, space: Path, uv: str) -> list[str]:
    return [uv, "run", "--directory", str(repo), "objectapp", "--space", str(space)]


def _check_name(name: str) -> str:
    if not name.strip() or re.search(r'[\\/:*?"<>|\x00-\x1f]', name):
        raise Refused(f'The name "{name}" cannot be used: leave out \\ / : * ? " < > | and line breaks.')
    return name.strip()


_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _shown(text: str) -> str:
    """`text` with its control characters written as escapes (a message stays one line)."""
    return _CONTROL.sub(lambda m: f"\\x{ord(m.group()):02x}", text)


def _check_paths(space: Path, repo: Path, uv: str, icon: Path | None) -> None:
    """Refuse a path with a line break or another control character, on every system: in a Linux
    entry a line break starts a new key (``Exec=``, ``Type=``), and the other two systems' files
    are lines too. Checked before anything is written."""
    for what, value in (("The space folder", space), ("This repository's folder", repo), ("uv", uv), ("The icon", icon)):
        if value is not None and _CONTROL.search(str(value)):
            raise Refused(
                f'{what} "{_shown(str(value))}" cannot be used in a launcher: its path holds a line break or '
                "another control character. Rename it first."
            )


def _not_ours(path: Path) -> Refused:
    return Refused(f'"{path}" was not written by this script. Pass --force to replace it.')


def _write(path: Path, text: str, marker: str, force: bool, mode: int = 0o644) -> Path:
    if path.exists() and not force and marker not in path.read_text(encoding="utf-8", errors="replace"):
        raise _not_ours(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.chmod(mode)
    tmp.replace(path)
    return path


def _remove(path: Path, marker: str, force: bool) -> Path | None:
    if not path.exists():
        return None
    if not force and marker not in path.read_text(encoding="utf-8", errors="replace"):
        raise _not_ours(path)
    path.unlink()
    return path


# -- Linux -------------------------------------------------------------------------------------

_EXEC_RESERVED = set(" \t\n\"'\\><~|&;$*?#()`")


def _exec_arg(arg: str) -> str:
    """One argument of a desktop entry's ``Exec`` (Desktop Entry Specification, "The Exec key")."""
    if arg == "" or any(c in _EXEC_RESERVED for c in arg):
        arg = '"' + re.sub(r'(["`$\\])', r"\\\1", arg) + '"'
    return arg.replace("\\", "\\\\").replace("%", "%%")


def desktop_entry(name: str, repo: Path, space: Path, icon: Path | None, uv: str) -> str:
    lines = [
        "[Desktop Entry]",
        "Type=Application",
        f"Name={name.replace(chr(92), chr(92) * 2)}",
        "Comment=Notes in plain Markdown files, on this computer",
        "Exec=" + " ".join(_exec_arg(a) for a in launch_command(repo, space, uv)),
    ]
    if icon is not None:
        lines.append(f"Icon={icon}")
    lines += [
        "Terminal=false",
        "Categories=Office;",
        f"StartupWMClass={WM_CLASS}",
        "StartupNotify=true",
        DESKTOP_MARKER,
    ]
    return "\n".join(lines) + "\n"


def linux_path(home: Path, environ: Mapping[str, str]) -> Path:
    data = environ.get("XDG_DATA_HOME")
    return (Path(data) if data else home / ".local" / "share") / "applications" / "object.desktop"


# -- macOS -------------------------------------------------------------------------------------


def _sh(text: str) -> str:
    """`text` as one single-quoted word of a POSIX shell."""
    return "'" + text.replace("'", "'\"'\"'") + "'"


def command_file(repo: Path, space: Path, uv: str) -> str:
    return (
        "#!/bin/sh\n"
        f"# {COMMENT_MARKER}\n"
        f"exec {shlex.quote(uv)} run --directory {_sh(str(repo))} objectapp --space {_sh(str(space))}\n"
    )


def mac_path(home: Path, name: str) -> Path:
    return home / "Applications" / f"{name}.command"


# -- Windows -----------------------------------------------------------------------------------


def _ps(text: str) -> str:
    """`text` as a PowerShell single-quoted literal."""
    return "'" + text.replace("'", "''") + "'"


def windows_path(home: Path, environ: Mapping[str, str], name: str) -> Path:
    appdata = environ.get("APPDATA")
    base = Path(appdata) if appdata else home / "AppData" / "Roaming"
    return base / "Microsoft" / "Windows" / "Start Menu" / "Programs" / f"{name}.lnk"


def shortcut_script(lnk: Path, repo: Path, space: Path, icon: Path | None, uv: str, force: bool) -> str:
    """The PowerShell that makes the shortcut. The shortcut starts PowerShell hidden (and itself
    minimised), which runs the launch command, so no console window shows."""
    inner = f"& {_ps(uv)} run --directory {_ps(str(repo))} objectapp --space {_ps(str(space))}"
    arguments = f'-NoProfile -WindowStyle Hidden -Command "{inner}"'
    lines = [
        "$ErrorActionPreference = 'Stop'",
        f"$path = {_ps(str(lnk))}",
        f"$marker = {_ps(COMMENT_MARKER)}",
        "$shell = New-Object -ComObject WScript.Shell",
    ]
    if not force:
        lines.append(
            "if ((Test-Path -LiteralPath $path) -and $shell.CreateShortcut($path).Description -ne $marker) "
            f"{{ exit {NOT_OURS} }}"
        )
    lines += [
        "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null",
        "$link = $shell.CreateShortcut($path)",
        "$link.TargetPath = 'powershell.exe'",
        f"$link.Arguments = {_ps(arguments)}",
        f"$link.WorkingDirectory = {_ps(str(repo))}",
        "$link.WindowStyle = 7",
    ]
    if icon is not None:
        lines.append(f"$link.IconLocation = {_ps(str(icon) + ',0')}")
    lines += [f"$link.Description = {_ps(COMMENT_MARKER)}", "$link.Save()"]
    return "\n".join(lines) + "\n"


def remove_shortcut_script(lnk: Path, force: bool) -> str:
    lines = [
        "$ErrorActionPreference = 'Stop'",
        f"$path = {_ps(str(lnk))}",
        f"$marker = {_ps(COMMENT_MARKER)}",
        f"if (-not (Test-Path -LiteralPath $path)) {{ exit {MISSING} }}",
    ]
    if not force:
        lines += [
            "$shell = New-Object -ComObject WScript.Shell",
            f"if ($shell.CreateShortcut($path).Description -ne $marker) {{ exit {NOT_OURS} }}",
        ]
    lines.append("Remove-Item -LiteralPath $path")
    return "\n".join(lines) + "\n"


def run_powershell(script: str) -> int:
    done = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
        input=script, text=True, check=False,
    )
    return done.returncode


# -- install and remove ------------------------------------------------------------------------


def _kind(platform: str) -> str:
    if platform.startswith("linux"):
        return "linux"
    if platform.startswith("win"):
        return "windows"
    if platform == "darwin":
        return "mac"
    raise Refused("This script writes a launcher for Linux, Windows and macOS only.")


def install(
    platform: str, *, space: Path, name: str, repo: Path, home: Path, environ: Mapping[str, str], uv: str,
    icon: Path | None, force: bool = False, powershell: Callable[[str], int] = run_powershell,
) -> Path:
    """Write the entry for `platform`; the file it wrote."""
    kind = _kind(platform)
    name = _check_name(name)
    _check_paths(space, repo, uv, icon)
    if kind == "linux":
        return _write(linux_path(home, environ), desktop_entry(name, repo, space, icon, uv), DESKTOP_MARKER, force)
    if kind == "mac":
        return _write(mac_path(home, name), command_file(repo, space, uv), COMMENT_MARKER, force, mode=0o755)
    lnk = windows_path(home, environ, name)
    code = powershell(shortcut_script(lnk, repo, space, icon, uv, force))
    if code == NOT_OURS:
        raise _not_ours(lnk)
    if code != 0:
        raise Refused(f"PowerShell could not make the shortcut (it ended with {code}).")
    return lnk


def remove(
    platform: str, *, name: str, home: Path, environ: Mapping[str, str], force: bool = False,
    powershell: Callable[[str], int] = run_powershell,
) -> Path | None:
    """Take the entry away; the file removed, or None when there was none."""
    kind = _kind(platform)
    name = _check_name(name)
    if kind == "linux":
        return _remove(linux_path(home, environ), DESKTOP_MARKER, force)
    if kind == "mac":
        return _remove(mac_path(home, name), COMMENT_MARKER, force)
    lnk = windows_path(home, environ, name)
    code = powershell(remove_shortcut_script(lnk, force))
    if code == MISSING:
        return None
    if code == NOT_OURS:
        raise _not_ours(lnk)
    if code != 0:
        raise Refused(f"PowerShell could not remove the shortcut (it ended with {code}).")
    return lnk


def _icon(platform: str, repo: Path) -> Path | None:
    """The "App icon" device setting's file (as the desktop window shows it), else Object's own
    icon from the repository on Linux, else none."""
    try:
        sys.path.insert(0, str(repo / "backend"))
        from objectapp.appicon import desktop_icon

        icon = desktop_icon(platform)
    except Exception:  # noqa: BLE001 - a launcher without an icon still launches
        icon = None
    if icon is None and platform.startswith("linux"):
        fallback = repo / "frontend" / "public" / "favicon.svg"
        icon = fallback if fallback.is_file() else None
    return icon


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--space", type=Path, required=True, help="the space folder the launcher opens")
    parser.add_argument("--name", default="Object", help='the entry\'s name (default "Object")')
    parser.add_argument("--remove", action="store_true", help="take the launcher entry away")
    parser.add_argument("--force", action="store_true", help="replace or remove a file this script did not write")
    args = parser.parse_args(argv)
    home = Path.home()
    try:
        if args.remove:
            gone = remove(sys.platform, name=args.name, home=home, environ=os.environ, force=args.force)
            print(f"Removed {gone}" if gone is not None else "Nothing to remove: there is no launcher entry.")
            return 0
        space = args.space.expanduser().resolve()
        if not space.is_dir():
            raise Refused(f'"{space}" is not a folder.')
        uv = shutil.which("uv") or "uv"
        path = install(
            sys.platform, space=space, name=args.name, repo=REPO, home=home, environ=os.environ, uv=uv,
            icon=_icon(sys.platform, REPO), force=args.force,
        )
    except Refused as refused:
        print(str(refused), file=sys.stderr)
        return 1
    print(f"Wrote {path}")
    print("It runs: " + " ".join(launch_command(REPO, space, uv)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
