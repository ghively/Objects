"""Launcher: ``objectapp [--space PATH] [--port 8790] [--browser]``.

Serves the API and the built front end on ``127.0.0.1`` only, then opens a
native window (pywebview) or, with ``--browser``, the default web browser.

Which space opens: ``--space PATH`` when given; else the device setting's
specific start-up space (``startupSpace: 'specific'``) when that folder exists;
else the space opened last (the registry in the state dir) when it exists. A
`SpaceHost` serves it and, when the app asks to switch spaces, restarts the
server on the new folder on the same port while the window stays open.
"""

from __future__ import annotations

import argparse
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

HOST = "127.0.0.1"
DEFAULT_PORT = 8790
DEFAULT_STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def build_server_config(
    space: Space,
    port: int = DEFAULT_PORT,
    static_dir: Path | None = DEFAULT_STATIC_DIR,
    on_switch: Callable[[Path], None] | None = None,
) -> uvicorn.Config:
    """The uvicorn config for `space`. Always bound to localhost."""
    # M21: the app's own loopback URL, for the agent schedule runs it starts.
    app = create_app(space, static_dir, on_switch=on_switch, base_url=f"http://{HOST}:{port}")
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
    otherwise it returns. `stop` ends it.
    """

    def __init__(self, port: int = DEFAULT_PORT, static_dir: Path | None = DEFAULT_STATIC_DIR):
        self.port = port
        self.static_dir = static_dir
        self._lock = threading.Lock()
        self._server: uvicorn.Server | None = None
        self._next: Path | None = None
        self._stopping = False
        self.root: Path | None = None

    def run(self, first_root: Path) -> None:
        root: Path | None = Path(first_root)
        while root is not None:
            space = Space(root)
            Registry(state_dir()).register(space.root)
            server = uvicorn.Server(
                build_server_config(
                    space, self.port, self.static_dir, on_switch=self.request_switch
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


def _wait_until_up(url: str, timeout: float = 10.0, thread: threading.Thread | None = None) -> bool:
    """True once the server answers; False when it hasn't by `timeout` or `thread` ended first.

    uvicorn ends its thread when it can't bind the port (another Object is running
    there), so waiting on is pointless: the launcher must not open a window on it.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url + "api/space", timeout=1):
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


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="objectapp", description=__doc__)
    parser.add_argument("--space", type=Path, help="space folder to open")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--browser", action="store_true", help="open in the web browser")
    args = parser.parse_args(argv)

    space_root = startup_root(args.space)
    if space_root is None:
        parser.error("Pass --space PATH the first time.")
    if not space_root.is_dir():
        parser.error(f"Not a folder: {space_root}")

    host = SpaceHost(args.port, DEFAULT_STATIC_DIR)
    thread = threading.Thread(
        target=host.run, args=(space_root,), name="objectapp-server", daemon=True
    )
    thread.start()
    url = f"http://{HOST}:{args.port}/"
    if not _wait_until_up(url, thread=thread) and not thread.is_alive():
        # The server thread died before answering: the port is taken (uvicorn logged
        # "address already in use"). A window on that URL would show another
        # program, or nothing.
        host.stop()
        parser.exit(1, _port_taken_message(args.port) + "\n")

    try:
        if args.browser:
            webbrowser.open(url)
            thread.join()
        else:
            import webview

            webview.create_window("Object", url, width=1440, height=900)
            # M23: Keep on top opens a small always-on-top window at /?mini=work.
            windowhost.set_opener(
                lambda u: webview.create_window(
                    "Object focus", u, width=360, height=470, on_top=True
                )
            )
            webview.start()
    except KeyboardInterrupt:
        pass
    finally:
        host.stop()
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
