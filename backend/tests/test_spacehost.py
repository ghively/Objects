"""M7 Task 4: the launcher's `SpaceHost` restarts the server on another space, same port."""

from __future__ import annotations

import json
import socket
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from objectapp.__main__ import SpaceHost


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(url: str):
    with urllib.request.urlopen(url, timeout=2) as resp:
        return json.loads(resp.read())


def _post(url: str, body: dict):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.status, json.loads(resp.read())


def _wait_for_root(base: str, root: Path, timeout: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if _get(base + "api/space")["root"] == str(root):
                return True
        except (OSError, urllib.error.URLError, ValueError):
            pass
        time.sleep(0.1)
    return False


def test_host_restarts_on_new_space(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    first = tmp_path / "first"
    second = tmp_path / "second"
    for root in (first, second):
        root.mkdir()
        (root / "Note.md").write_text("Body\n", encoding="utf-8")

    port = _free_port()
    base = f"http://127.0.0.1:{port}/"
    host = SpaceHost(port=port, static_dir=None)
    thread = threading.Thread(target=host.run, args=(first,), daemon=True)
    thread.start()
    try:
        assert _wait_for_root(base, first.resolve())
        status, body = _post(base + "api/spaces/switch", {"path": str(second)})
        assert status == 202 and body == {"path": str(second.resolve())}
        assert _wait_for_root(base, second.resolve())
        spaces = _get(base + "api/spaces")["spaces"]
        assert [s["path"] for s in spaces] == [str(first.resolve()), str(second.resolve())]
        assert [s["current"] for s in spaces] == [False, True]
    finally:
        host.stop()
        thread.join(timeout=10)
    assert not thread.is_alive()
