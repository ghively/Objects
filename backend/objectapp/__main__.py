"""Launcher: ``objectapp [--space PATH] [--port 8790] [--browser [--print-link]]
[--window auto|electron|pywebview] [--frame hidden|system]``.

Serves the API and the built front end on ``127.0.0.1`` only, then opens a
native window or, with ``--browser``, the default web browser.

The window (M33): ``--window auto`` (the default; ``OBJECT_WINDOW`` gives the same choice, the
option wins) uses the frameless desktop shell in ``desktop/`` (Electron) when it is installed
(``cd desktop && npm ci``), else the pywebview window; ``electron`` insists on the shell;
``pywebview`` forces the old window. The launcher stays the parent: it starts the shell as a
child with its launch JSON (``url``, ``origin``, ``stateDir``, ``icon``, ``title``, ``frame``) in
the child's environment (``OBJECT_DESKTOP_LAUNCH``), never on its command line, where other local
users could read the one-time link in the process list; and it stops the server only when the
shell has exited, so the page's last saves land. Stopped itself (Ctrl-C, SIGTERM, SIGHUP), it asks
the shell to close first (``{"kind": "quit"}`` on its stdin) and waits for it. ``--frame system`` (``OBJECT_WINDOW_FRAME``) gives the shell's window the system's
ordinary frame.

Which space opens: ``--space PATH`` when given; else the device setting's
specific start-up space (``startupSpace: 'specific'``) when that folder exists;
else the space opened last (the registry in the state dir) when it exists. A
`SpaceHost` serves it and, when the app asks to switch spaces, restarts the
server on the new folder on the same port while the window stays open.

Decision S6: the host makes one `uikey.LaunchKey` per launch (kept across space switches). The
window opens at a one-time ``/_open`` link that trades its code for the key's cookie. With
``--browser`` the browser gets the link alone: it is printed only when no browser could be opened
or with ``--print-link``, since anything that can read the terminal (or a log of it) could use a
printed link before the browser does. Pressing Enter in the launcher's terminal prints and opens
a new one (a browser that was closed lost its cookie).
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import uvicorn

from . import settings, windowhost
from .appstate import state_dir
from .server import create_app
from .space import ReadOnly, Space
from .spaces import Registry
from .uikey import HEADER, LaunchKey

HOST = "127.0.0.1"
DEFAULT_PORT = 8790
DEFAULT_STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"

# M33: the desktop shell (Electron), beside the pywebview window.
DESKTOP_DIR = Path(__file__).resolve().parents[2] / "desktop"
WINDOWS = ("auto", "electron", "pywebview")
FRAMES = ("hidden", "system")
SHELL_READY_LINE = "object-desktop: ready"
"""What the shell writes on its stdout once its window exists (``desktop/main.js``)."""
SHELL_LAUNCH_ENV = "OBJECT_DESKTOP_LAUNCH"
"""The variable of the shell's environment that holds its launch JSON (``desktop/lib/launch.js``)."""
SHELL_READY_SECONDS = 30.0
SHELL_QUIT_LINE = json.dumps({"kind": "quit"}) + "\n"
"""Written on the shell's stdin to ask it to close its windows as a person's close does
(``desktop/lib/stdinLines.js``): the page saves first, then the last requests are waited for."""
SHELL_STOP_SECONDS = 6.0
"""How long the shell gets to close once asked: the page's 3 seconds to save, the shell's 2 for
the requests still on their way, and one to spare. Only then is it terminated."""
SHELL_KILL_SECONDS = 2.0
"""After `terminate`, how long before the shell is killed."""
STOP_SIGNALS = ("SIGTERM", "SIGHUP")
"""While the shell runs these take Ctrl-C's path (where the system has them)."""
# Windows console control events (wincon.h). Ctrl-C and Ctrl-Break (0, 1) stay Python's own.
CTRL_CLOSE_EVENT = 2
CTRL_LOGOFF_EVENT = 5
CTRL_SHUTDOWN_EVENT = 6
CONSOLE_END_SECONDS = 4.5
"""Windows ends a process 5 seconds after its console is closed (and at log off or shut down);
until then the server stays up while the shell closes its windows (the page saves) and drains."""
SHELL_MISSING_MESSAGE = (
    'The desktop window is not installed. Run "cd desktop && npm ci" in the Object folder first, '
    "or use --window pywebview."
)  # our string
SHELL_FAILED_MESSAGE = "The desktop window could not be started."  # our string
SHELL_FALLBACK_MESSAGE = (
    "The desktop window could not be started; opening the pywebview window instead."
)  # our string


def build_server_config(
    space: Space,
    port: int = DEFAULT_PORT,
    static_dir: Path | None = DEFAULT_STATIC_DIR,
    on_switch: Callable[[Path], None] | None = None,
    ui_key: LaunchKey | None = None,
) -> uvicorn.Config:
    """The uvicorn config for `space`. Always bound to localhost. `ui_key`: decision S6."""
    # M21: the app's own loopback URL, for the agent schedule runs it starts.
    app = create_app(space, static_dir, on_switch=on_switch, base_url=f"http://{HOST}:{port}", ui_key=ui_key)
    # uvicorn runs off the main thread here, so it installs no signal handlers;
    # a short graceful timeout keeps a lingering connection from stalling exit.
    return uvicorn.Config(
        app, host=HOST, port=port, log_level="warning", timeout_graceful_shutdown=1
    )


def _close(server: uvicorn.Server | None) -> None:
    """Stop `server`: end its open /api/events streams first (sse_starlette only
    watches for signals, which never reach a server on a worker thread)."""
    if server is None:
        return
    app = getattr(server.config, "app", None)
    hub = getattr(getattr(app, "state", None), "hub", None)
    if hub is not None:
        hub.close()
    server.should_exit = True


class SpaceHost:
    """Serves one space at a time on ``127.0.0.1:port``; `request_switch` moves to another.

    `run` blocks: it serves `first_root` until the server exits; if
    `request_switch` was called meanwhile it serves that folder next (same port),
    otherwise it returns. `stop` ends it. `ui_key` is the launch's key (decision S6), the same
    for every space it serves.
    """

    def __init__(self, port: int = DEFAULT_PORT, static_dir: Path | None = DEFAULT_STATIC_DIR):
        self.port = port
        self.static_dir = static_dir
        self._lock = threading.Lock()
        self._server: uvicorn.Server | None = None
        self._next: Path | None = None
        self._stopping = False
        self.root: Path | None = None
        self.ui_key = LaunchKey(port)

    def run(self, first_root: Path) -> None:
        root: Path | None = Path(first_root)
        while root is not None:
            space = Space(root)
            Registry(state_dir()).register(space.root)
            server = uvicorn.Server(
                build_server_config(
                    space, self.port, self.static_dir, on_switch=self.request_switch, ui_key=self.ui_key
                )
            )
            with self._lock:
                if self._stopping:
                    return
                if self._next is not None:  # a switch arrived while this one was loading
                    root, self._next = self._next, None
                    continue
                self._server = server
                self.root = space.root
            server.run()
            with self._lock:
                self._server = None
                root = None if self._stopping else self._next
                self._next = None

    def request_switch(self, path: Path) -> None:
        """Serve `path` next: stop the current server; `run` starts the new one."""
        with self._lock:
            if self._stopping:
                return
            self._next = Path(path)
            server = self._server
        _close(server)

    def stop(self) -> None:
        with self._lock:
            self._stopping = True
            self._next = None
            server = self._server
        _close(server)


def startup_root(space_arg: Path | None) -> Path | None:
    """The folder to open first (see the module docstring), or None when there is none."""
    if space_arg is not None:
        return Path(space_arg).expanduser().resolve()
    try:
        prefs, _revision = settings.read()
    except ReadOnly:
        prefs = settings.DEFAULTS
    specific = prefs.get("startupSpacePath")
    if prefs.get("startupSpace") == "specific" and specific and Path(specific).is_dir():
        return Path(specific).resolve()
    last = Registry(state_dir()).last_opened()
    if last is not None and last.is_dir():
        return last.resolve()
    return None


def _wait_until_up(url: str, timeout: float = 10.0, thread: threading.Thread | None = None,
                   key: str | None = None) -> bool:
    """True once the server answers; False when it hasn't by `timeout` or `thread` ended first.
    `key`: the launch key, sent as the ``X-Object-Key`` header (decision S6).

    uvicorn ends its thread when it can't bind the port (another Object is running
    there), so waiting on is pointless: the launcher must not open a window on it.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            probe = urllib.request.Request(url + "api/space", headers={HEADER: key} if key else {})
            with urllib.request.urlopen(probe, timeout=1):
                return True
        except OSError:
            if thread is not None and not thread.is_alive():
                return False
            time.sleep(0.1)
    return False


def _port_taken_message(port: int) -> str:
    return (
        f"Object could not start: port {port} is already in use. "
        "Is Object already running? Close it, or pass --port to use another port."
    )


def _can_reopen() -> bool:
    return sys.stdin is not None and sys.stdin.isatty()


def _open_in_browser(key: LaunchKey, url: str, print_link: bool = False) -> None:
    """Open a fresh one-time link in the browser (decision S6). The link is printed only when no
    browser could be opened, or with `print_link` (``--print-link``, and Enter in the terminal,
    which asks for one): a printed link can be read by anything that sees the terminal."""
    link = key.open_url(url)
    opened = webbrowser.open(link)
    if print_link or not opened:
        print(f"Object is running at {url}.", flush=True)
        print(f"Open this link within 5 minutes (it works once): {link}", flush=True)
    else:
        print(f"Object is running at {url} (opened in your browser).", flush=True)
    if _can_reopen():
        print("Press Enter here for a new link.", flush=True)


def _reopen_on_enter(key: LaunchKey, url: str) -> None:
    for _line in sys.stdin:
        _open_in_browser(key, url, print_link=True)


def _webview_start_options(platform: str) -> dict:
    """``webview.start`` options for this platform.

    On Linux pywebview's GTK backend in private mode (its default) turns localStorage off
    (``enable_html5_local_storage = False``), and the UI's persisted stores (tabs, recents,
    per-space view state) then have no storage, which crashed the main pane. So Linux runs
    non-private with its web data in the state dir (``<state>/webview``). The launch key is a
    session cookie and changes every launch, so a kept cookie never opens a later run.
    Windows (Edge WebView2) keeps localStorage in private mode and stays as it was.
    """
    if platform.startswith("linux"):
        return {"private_mode": False, "storage_path": str(state_dir() / "webview")}
    return {}


def _window_icon_options(platform: str) -> dict:
    """``webview.start``'s ``icon`` for the device setting "App icon" (M31), or nothing for the
    default icon. pywebview reads it only when it starts, so a new colour shows from the next start."""
    from .appicon import startup_icon

    icon = startup_icon(platform)
    return {"icon": str(icon)} if icon is not None else {}


def _choice(option: str | None, environ: Mapping[str, str], name: str, values: tuple[str, ...]) -> str:
    """`option` when given, else the environment's `name`, else the first of `values`."""
    if option is not None:
        return option
    given = (environ.get(name) or "").strip().lower()
    if not given:
        return values[0]
    if given not in values:
        raise ValueError(f"{name} must be {', '.join(values[:-1])} or {values[-1]}.")
    return given


def window_choice(option: str | None, environ: Mapping[str, str]) -> str:
    """``--window`` (it wins), else ``OBJECT_WINDOW``, else ``auto``."""
    return _choice(option, environ, "OBJECT_WINDOW", WINDOWS)


def frame_choice(option: str | None, environ: Mapping[str, str]) -> str:
    """``--frame`` (it wins), else ``OBJECT_WINDOW_FRAME``, else ``hidden``."""
    return _choice(option, environ, "OBJECT_WINDOW_FRAME", FRAMES)


def _electron_name(platform: str) -> str:
    """The executable inside the ``electron`` package's ``dist`` (its ``install.js``)."""
    if platform.startswith("win"):
        return "electron.exe"
    if platform == "darwin":
        return "Electron.app/Contents/MacOS/Electron"
    return "electron"


def electron_binary(
    desktop_dir: Path | None = None, platform: str = sys.platform, environ: Mapping[str, str] | None = None
) -> Path | None:
    """The desktop shell's Electron executable, or None when the shell is not installed.

    Found the way the ``electron`` npm package finds it (its ``index.js``): ``path.txt`` under
    ``desktop/node_modules/electron`` names the file inside ``dist`` (the platform's usual name
    when there is no ``path.txt``); ``ELECTRON_OVERRIDE_DIST_PATH`` replaces ``dist``.
    """
    package = (DESKTOP_DIR if desktop_dir is None else Path(desktop_dir)) / "node_modules" / "electron"
    try:
        name = (package / "path.txt").read_text(encoding="utf-8").strip()
    except OSError:
        name = ""
    override = (os.environ if environ is None else environ).get("ELECTRON_OVERRIDE_DIST_PATH")
    dist = Path(override) if override else package / "dist"
    binary = dist / (name or _electron_name(platform))
    return binary if binary.is_file() else None


def shell_launch(key: LaunchKey, url: str, port: int, frame: str) -> dict[str, Any]:
    """What the shell is started with (``OBJECT_DESKTOP_LAUNCH``): its one-time link, the only
    origin it may show, where its own state lives, the "App icon" file and the frame."""
    from .appicon import desktop_icon

    icon = desktop_icon(sys.platform)
    return {
        "url": key.open_url(url),
        "origin": f"http://{HOST}:{port}",
        "stateDir": str(state_dir()),
        "icon": str(icon) if icon is not None else None,
        "title": "Object",
        "frame": frame,
    }


def _watch_ready(stream: Any, ready: threading.Event) -> None:
    """Read the shell's stdout to its end: the ready line sets `ready`; nothing is printed."""
    try:
        for line in stream:
            if line.strip() == SHELL_READY_LINE:
                ready.set()
    except (OSError, ValueError):
        pass


def _ask_shell_to_quit(stream: Any) -> bool:
    """Write the quit line on the shell's stdin, then close it; False when the pipe is gone."""
    asked = True
    try:
        stream.write(SHELL_QUIT_LINE)
        stream.flush()
    except (OSError, ValueError):
        asked = False
    try:
        stream.close()
    except (OSError, ValueError):
        pass
    return asked


def _stop_shell(child: Any, ask: bool = True) -> None:
    """Make sure the shell is gone. With `ask` it is asked first (the quit line: it closes its
    windows as a person's close does, so the page saves) and given `SHELL_STOP_SECONDS`; only
    then is it terminated, and killed if that does not end it. Without `ask` (a shell whose
    window never said it was ready) it is terminated at once."""
    if child.poll() is not None:
        return
    if ask and child.stdin is not None and _ask_shell_to_quit(child.stdin):
        try:
            child.wait(timeout=SHELL_STOP_SECONDS)
            return
        except subprocess.TimeoutExpired:
            pass
    child.terminate()
    try:
        child.wait(timeout=SHELL_KILL_SECONDS)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()


class _StopSignals:
    """While the shell runs, SIGTERM and SIGHUP (where they exist) raise KeyboardInterrupt in the
    main thread, so `kill <objectapp>` or a closed terminal takes Ctrl-C's path: the shell is
    asked to quit and waited for, then the server stops. Only the first one does: a second one
    while the shell closes is ignored, and so is one that comes once the stopping has begun
    (`quiet`). `restore` puts the old handlers back."""

    def __init__(self) -> None:
        self._old: dict[int, Any] = {}
        self._quiet = False

    def _handle(self, _signum: int, _frame: Any) -> None:
        if self._quiet:
            return
        self._quiet = True
        raise KeyboardInterrupt

    def install(self) -> None:
        if threading.current_thread() is not threading.main_thread():
            return
        for name in STOP_SIGNALS:
            number = getattr(signal, name, None)
            if number is None or number in self._old:
                continue
            try:
                self._old[number] = signal.signal(number, self._handle)
            except (OSError, ValueError):
                pass

    def quiet(self) -> None:
        self._quiet = True

    def restore(self) -> None:
        for number, previous in self._old.items():
            try:
                signal.signal(number, previous)
            except (OSError, ValueError, TypeError):
                pass
        self._old.clear()


class _ConsoleEnd:
    """Windows: the console window is closed, or the user logs off or shuts down. Windows ends
    this process when the handler returns (and 5 seconds on at the latest), so the handler asks
    the shell to quit and keeps the server up until the shell has exited (its page saved, its
    last requests drained) or `seconds` have gone, then stops the server and lets the process
    end. Ctrl-C and Ctrl-Break are left to Python (KeyboardInterrupt). Not run on Windows here:
    only its logic is tested."""

    EVENTS = (CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT)

    def __init__(
        self, child: Any, host: Any, *, seconds: float = CONSOLE_END_SECONDS,
        clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.child = child
        self.host = host
        self.seconds = seconds
        self.clock = clock
        self.sleep = sleep
        self._lock = threading.Lock()

    def __call__(self, event: int) -> bool:
        if event not in self.EVENTS:
            return False
        with self._lock:  # a second event waits for the first one's work, then ends too
            deadline = self.clock() + self.seconds
            if self.child.poll() is None and self.child.stdin is not None:
                _ask_shell_to_quit(self.child.stdin)
            while self.child.poll() is None and self.clock() < deadline:
                self.sleep(0.05)
            self.host.stop()
        return True


def _install_console_handler(
    handler: Callable[[int], bool], platform: str = sys.platform, *, kernel32: Any = None, functype: Any = None,
) -> Callable[[], None] | None:
    """Windows: `handler` becomes a console control handler (``SetConsoleCtrlHandler``); returns
    what removes it. Elsewhere, and when Windows refuses it: None."""
    if not platform.startswith("win"):
        return None
    try:
        if kernel32 is None or functype is None:
            import ctypes
            from ctypes import wintypes

            kernel32 = kernel32 or ctypes.WinDLL("kernel32", use_last_error=True)
            functype = functype or ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)
        callback = functype(lambda event: bool(handler(int(event))))
        if not kernel32.SetConsoleCtrlHandler(callback, True):
            return None
    except (AttributeError, OSError):
        return None

    def remove() -> None:
        try:
            kernel32.SetConsoleCtrlHandler(callback, False)  # `callback` is kept alive until here
        except OSError:
            pass

    return remove


def start_shell(
    binary: Path, launch: dict[str, Any], *, popen: Callable[..., Any] | None = None,
    ready_timeout: float = SHELL_READY_SECONDS,
) -> Any | None:
    """Start the desktop shell as a child; None when it cannot be started (it does not run, or
    it exits or stays silent before its window exists). Its stdout is read for the ready line
    only. Its launch (it holds the one-time link) is never printed and never on its command line:
    it is in the child's own environment, which only this user can read, and the shell removes it
    from its environment as it reads it."""
    environ = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
    environ[SHELL_LAUNCH_ENV] = json.dumps(launch)
    argv = [str(binary), str(DESKTOP_DIR)]
    try:
        child = (popen or subprocess.Popen)(
            argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=environ,
            text=True, encoding="utf-8", errors="replace",
        )
    except OSError:
        return None
    ready = threading.Event()
    threading.Thread(
        target=_watch_ready, args=(child.stdout, ready), name="objectapp-shell-output", daemon=True
    ).start()
    deadline = time.monotonic() + ready_timeout
    while not ready.wait(0.05):
        if child.poll() is not None:
            return None
        if time.monotonic() >= deadline:
            _stop_shell(child, ask=False)
            return None
    return child


def _run_shell(child: Any, key: LaunchKey) -> None:
    """Wait for the shell to exit. Meanwhile Keep on top (M23) is one JSON line on its stdin."""
    windowhost.set_opener(windowhost.line_opener(child.stdin, key.open_url))
    try:
        child.wait()
    finally:
        windowhost.set_opener(None)
        _stop_shell(child)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="objectapp", description=__doc__)
    parser.add_argument("--space", type=Path, help="space folder to open")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--browser", action="store_true", help="open in the web browser")
    parser.add_argument(
        "--print-link", action="store_true",
        help="with --browser, also print the one-time link (anyone reading the terminal could use it)",
    )
    parser.add_argument(
        "--window", choices=WINDOWS,
        help="which window: auto (the desktop shell when it is installed, else pywebview), "
        "electron or pywebview; OBJECT_WINDOW gives the same choice",
    )
    parser.add_argument(
        "--frame", choices=FRAMES,
        help="the desktop shell's window: hidden (frameless, the default) or system (the system's "
        "ordinary frame); OBJECT_WINDOW_FRAME gives the same choice",
    )
    args = parser.parse_args(argv)
    try:
        window = window_choice(args.window, os.environ)
        frame = frame_choice(args.frame, os.environ)
    except ValueError as exc:
        parser.error(str(exc))

    space_root = startup_root(args.space)
    if space_root is None:
        parser.error("Pass --space PATH the first time.")
    if not space_root.is_dir():
        parser.error(f'"{space_root}" is not a folder.')

    shell = None if args.browser or window == "pywebview" else electron_binary()
    if shell is None and window == "electron" and not args.browser:
        parser.exit(1, SHELL_MISSING_MESSAGE + "\n")

    host = SpaceHost(args.port, DEFAULT_STATIC_DIR)
    thread = threading.Thread(
        target=host.run, args=(space_root,), name="objectapp-server", daemon=True
    )
    thread.start()
    url = f"http://{HOST}:{args.port}/"
    if not _wait_until_up(url, thread=thread, key=host.ui_key.secret) and not thread.is_alive():
        # The server thread died before answering: the port is taken (uvicorn logged
        # "address already in use"). A window on that URL would show another
        # program, or nothing.
        host.stop()
        parser.exit(1, _port_taken_message(args.port) + "\n")

    signals = _StopSignals()
    try:
        if args.browser:
            _open_in_browser(host.ui_key, url, print_link=args.print_link)
            if _can_reopen():
                threading.Thread(target=_reopen_on_enter, args=(host.ui_key, url), daemon=True).start()
            thread.join()
        else:
            child = None
            if shell is not None:
                child = start_shell(shell, shell_launch(host.ui_key, url, args.port, frame))
                if child is None:
                    if window == "electron":
                        parser.exit(1, SHELL_FAILED_MESSAGE + "\n")
                    print(SHELL_FALLBACK_MESSAGE, flush=True)
            if child is not None:
                # SIGTERM / SIGHUP: as Ctrl-C, the shell is stopped (and the page saves) before
                # the server (`finally` below). Windows: a closed console, log off or shut down.
                signals.install()
                remove_console_handler = _install_console_handler(_ConsoleEnd(child, host))
                try:
                    _run_shell(child, host.ui_key)
                finally:
                    if remove_console_handler is not None:
                        remove_console_handler()
                return

            import webview

            webview.create_window("Object", host.ui_key.open_url(url), width=1440, height=900)
            # M23: Keep on top opens a small always-on-top window at /?mini=work. pywebview's
            # private mode gives each window its own cookies, so it gets its own code (S6).
            windowhost.set_opener(
                lambda u: webview.create_window(
                    "Object focus", host.ui_key.open_url(u), width=360, height=470, on_top=True
                )
            )
            webview.start(**_webview_start_options(sys.platform), **_window_icon_options(sys.platform))
    except KeyboardInterrupt:
        pass
    finally:
        signals.quiet()
        host.stop()
        thread.join(timeout=5)
        signals.restore()


if __name__ == "__main__":
    main()
