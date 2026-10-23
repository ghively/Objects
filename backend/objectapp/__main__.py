"""Launcher: ``objectapp --space PATH [--port 8790] [--browser]``.

Serves the API and the built front end on ``127.0.0.1`` only, then opens a
native window (pywebview) or, with ``--browser``, the default web browser.
"""

from __future__ import annotations

import argparse
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

from .server import create_app
from .space import Space

HOST = "127.0.0.1"
DEFAULT_PORT = 8790
DEFAULT_STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def build_server_config(
    space: Space, port: int = DEFAULT_PORT, static_dir: Path | None = DEFAULT_STATIC_DIR
) -> uvicorn.Config:
    """The uvicorn config for `space`. Always bound to localhost."""
    app = create_app(space, static_dir)
    # uvicorn runs off the main thread here, so it installs no signal handlers;
    # a short graceful timeout keeps a lingering connection from stalling exit.
    return uvicorn.Config(
        app, host=HOST, port=port, log_level="warning", timeout_graceful_shutdown=1
    )


def _wait_until_up(url: str, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url + "api/space", timeout=1):
                return
        except OSError:
            time.sleep(0.1)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="objectapp", description=__doc__)
    parser.add_argument("--space", required=True, type=Path, help="space folder to open")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--browser", action="store_true", help="open in the web browser")
    args = parser.parse_args(argv)

    space_root = args.space.resolve()
    if not space_root.is_dir():
        parser.error(f"Not a folder: {space_root}")

    server = uvicorn.Server(build_server_config(Space(space_root), port=args.port))
    thread = threading.Thread(target=server.run, name="objectapp-server", daemon=True)
    thread.start()
    url = f"http://{HOST}:{args.port}/"
    _wait_until_up(url)

    try:
        if args.browser:
            webbrowser.open(url)
            thread.join()
        else:
            import webview

            webview.create_window("Object", url, width=1440, height=900)
            webview.start()
    except KeyboardInterrupt:
        pass
    finally:
        # End the open /api/events streams first: sse_starlette only watches for
        # signals, which never reach a server running on a worker thread.
        server.config.app.state.hub.close()
        server.should_exit = True
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
