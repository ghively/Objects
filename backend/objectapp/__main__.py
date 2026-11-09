"""Launcher: ``objectapp [--space PATH] [--port 8790] [--browser [--print-link]]``.

Serves the API and the built front end on ``127.0.0.1`` only, then opens a
native window (pywebview) or, with ``--browser``, the default web browser.

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
import sys
import threading
import time
import urllib.request
import webbrowser
from collections.abc import Callable
from pathlib import Path

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


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="objectapp", description=__doc__)
    parser.add_argument("--space", type=Path, help="space folder to open")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--browser", action="store_true", help="open in the web browser")
    parser.add_argument(
        "--print-link", action="store_true",
        help="with --browser, also print the one-time link (anyone reading the terminal could use it)",
    )
    args = parser.parse_args(argv)

    space_root = startup_root(args.space)
    if space_root is None:
        parser.error("Pass --space PATH the first time.")
    if not space_root.is_dir():
        parser.error(f'"{space_root}" is not a folder.')

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

    try:
        if args.browser:
            _open_in_browser(host.ui_key, url, print_link=args.print_link)
            if _can_reopen():
                threading.Thread(target=_reopen_on_enter, args=(host.ui_key, url), daemon=True).start()
            thread.join()
        else:
            import webview

            webview.create_window("Object", host.ui_key.open_url(url), width=1440, height=900)
            # M23: Keep on top opens a small always-on-top window at /?mini=work. pywebview's
            # private mode gives each window its own cookies, so it gets its own code (S6).
            windowhost.set_opener(
                lambda u: webview.create_window(
                    "Object focus", host.ui_key.open_url(u), width=360, height=470, on_top=True
                )
            )
            webview.start(**_webview_start_options(sys.platform))
    except KeyboardInterrupt:
        pass
    finally:
        host.stop()
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
