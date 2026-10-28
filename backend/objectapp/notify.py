"""Local OS notifications for reminders (no network, no account, no push service).

`system_notifier()` picks the platform's own tool:

- Windows: ``powershell.exe`` showing a WinRT toast (``ToastNotificationManager``,
  in the box on Windows 10/11).
- macOS: ``osascript`` (``display notification``).
- Linux and other Unix: ``notify-send``.

The title and body are never interpolated into script text. ``osascript`` and
``notify-send`` get them as separate argv items; PowerShell gets them through
two environment variables, because ``powershell -Command`` joins any trailing
arguments into the command text it then parses (which would let a title like
``$(...)`` run as code). The PowerShell script itself is a constant.

Anything that can't launch logs once and does nothing; a failed notification
never stops the scheduler.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Protocol

__all__ = [
    "WINDOWS_TOAST_SCRIPT",
    "FileNotifier",
    "Notifier",
    "NullNotifier",
    "SystemNotifier",
    "system_notifier",
]

log = logging.getLogger(__name__)

TITLE_ENV = "OBJECT_NOTIFY_TITLE"
BODY_ENV = "OBJECT_NOTIFY_BODY"

# PowerShell's own AppUserModelID: always registered, so the toast shows
# without installing a Start-menu shortcut for Object.
_POWERSHELL_AUMID = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"

WINDOWS_TOAST_SCRIPT = (
    "$ErrorActionPreference = 'Stop'; "
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, "
    "ContentType = WindowsRuntime] | Out-Null; "
    "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent("
    "[Windows.UI.Notifications.ToastTemplateType]::ToastText02); "
    "$texts = $xml.GetElementsByTagName('text'); "
    f"$texts.Item(0).AppendChild($xml.CreateTextNode($env:{TITLE_ENV})) | Out-Null; "
    f"$texts.Item(1).AppendChild($xml.CreateTextNode($env:{BODY_ENV})) | Out-Null; "
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml); "
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("
    f"'{_POWERSHELL_AUMID}').Show($toast)"
)
"""The constant toast script (title and body come from the environment)."""

_MAC_SCRIPT = (
    "on run argv",
    "display notification (item 2 of argv) with title (item 1 of argv)",
    "end run",
)


class Notifier(Protocol):
    def send(self, title: str, body: str) -> None: ...


Launcher = Callable[[Sequence[str], Mapping[str, str] | None], None]


def _launch(argv: Sequence[str], env: Mapping[str, str] | None) -> None:
    """Start the notification process and don't wait for it."""
    kwargs: dict = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if env is not None:
        kwargs["env"] = {**os.environ, **env}
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.Popen(list(argv), **kwargs)


def command_for(platform: str, title: str, body: str) -> tuple[list[str], dict[str, str] | None] | None:
    """(argv, extra environment) for `platform`, or None when it has no notifier."""
    if platform == "win32":
        exe = shutil.which("powershell.exe") or "powershell.exe"
        argv = [exe, "-NoProfile", "-NonInteractive", "-Command", WINDOWS_TOAST_SCRIPT]
        return argv, {TITLE_ENV: title, BODY_ENV: body}
    if platform == "darwin":
        argv = ["osascript"]
        for line in _MAC_SCRIPT:
            argv += ["-e", line]
        return [*argv, title, body], None
    if platform.startswith(("linux", "freebsd", "openbsd", "netbsd")):
        return ["notify-send", "--app-name=Object", "--", title, body], None
    return None


class SystemNotifier:
    """Sends through the platform's tool; logs the first failure and carries on."""

    def __init__(self, platform: str | None = None, launcher: Launcher | None = None) -> None:
        self.platform = platform or sys.platform
        self._launcher = launcher
        self._warned = False

    def _warn(self, message: str) -> None:
        if not self._warned:
            self._warned = True
            log.warning(message)

    def send(self, title: str, body: str) -> None:
        cmd = command_for(self.platform, title, body)
        if cmd is None:
            self._warn(f"Reminders: no notifier for platform {self.platform!r}.")
            return
        argv, env = cmd
        try:
            (self._launcher or _launch)(argv, env)
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            self._warn(f"Reminders: could not show a notification ({exc}).")


class NullNotifier:
    def send(self, title: str, body: str) -> None:
        return None


class FileNotifier:
    """Appends one JSON line per notification (the `OBJECT_FAKE_NOTIFY_FILE` test hook)."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def send(self, title: str, body: str) -> None:
        import json

        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps({"title": title, "body": body}, ensure_ascii=False) + "\n")


def system_notifier() -> Notifier:
    """The notifier for this machine."""
    return SystemNotifier()
