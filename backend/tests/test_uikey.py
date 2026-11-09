"""Decision S6 (2026-11-08): the per-launch key the UI carries on every ``/api`` request.

The launcher makes one `LaunchKey` per run; the window (or browser) gets it as an HttpOnly cookie
from ``/_open?code=<one-time code>``, so ``fetch``, ``EventSource``, downloads and images carry it
with no frontend code. ``/api/v1`` with a bearer token keeps its own auth; the static bundle stays
open; the index page without the key is a short "not connected" page. ``create_app`` without a
key (tests, acceptance scripts) has no check.
"""

from __future__ import annotations

import socket
import sys
import types
import urllib.error
import urllib.request
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import __main__ as launcher
from objectapp import uikey, windowhost
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore
from objectapp.uikey import LaunchKey
from starlette.websockets import WebSocketDisconnect

PORT = 8812


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def static(tmp_path: Path) -> Path:
    folder = tmp_path / "dist"
    (folder / "assets").mkdir(parents=True)
    (folder / "index.html").write_text("<!doctype html><title>Object</title><div id=root></div>", "utf-8")
    (folder / "assets" / "app.js").write_text("console.log(1)", "utf-8")
    return folder


@pytest.fixture
def keyed(space_dir: Path, static: Path):
    clock = Clock()
    key = LaunchKey(PORT, clock=clock)
    app = create_app(Space(space_dir), static, watch=False, ui_key=key)
    with TestClient(app, base_url="http://127.0.0.1:8812") as client:
        yield client, key, clock


def test_api_without_the_key_is_refused(keyed) -> None:
    client, _key, _clock = keyed
    res = client.get("/api/space")
    assert res.status_code == 401
    assert res.json() == {"detail": "Only Object's own window can use this."}
    assert client.post("/api/ai/chat", json={}).status_code == 401
    assert client.get("/api/events").status_code == 401


def test_the_cookie_or_the_header_lets_a_request_through(keyed) -> None:
    client, key, _clock = keyed
    assert client.get("/api/space", headers={"X-Object-Key": key.secret}).status_code == 200
    assert client.get("/api/space", headers={"X-Object-Key": "wrong"}).status_code == 401
    client.cookies.set(key.cookie_name, key.secret)
    assert client.get("/api/space").status_code == 200
    client.cookies.set(key.cookie_name, "wrong")
    assert client.get("/api/space").status_code == 401


def test_open_trades_a_one_time_code_for_the_cookie(keyed) -> None:
    client, key, _clock = keyed
    code = key.issue()
    res = client.get(f"/_open?code={code}&next=/%3Fmini%3Dwork", follow_redirects=False)
    assert res.status_code == 303 and res.headers["location"] == "/?mini=work"
    cookie = res.headers["set-cookie"]
    assert cookie.startswith(f"object-ui-{PORT}={key.secret};")
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie and "Path=/" in cookie
    assert "Max-Age" not in cookie and "expires" not in cookie.lower()  # gone with the window
    assert client.get("/api/space").status_code == 200  # the client kept the cookie
    # spent: the same code again sets nothing
    client.cookies.clear()
    again = client.get(f"/_open?code={code}", follow_redirects=False)
    assert again.status_code == 303 and again.headers["location"] == "/"
    assert "set-cookie" not in again.headers
    assert client.get("/api/space").status_code == 401


def test_codes_expire_and_next_stays_on_this_site(keyed) -> None:
    client, key, clock = keyed
    code = key.issue()
    clock.now += uikey.CODE_SECONDS + 1
    res = client.get(f"/_open?code={code}", follow_redirects=False)
    assert "set-cookie" not in res.headers
    for bad in ("//evil.example/", "https://evil.example/", "/\\evil", "evil"):
        res = client.get("/_open", params={"code": key.issue(), "next": bad}, follow_redirects=False)
        assert res.headers["location"] == "/", bad


def test_static_files_stay_open_and_the_page_says_when_it_is_not_connected(keyed) -> None:
    client, key, _clock = keyed
    assert client.get("/assets/app.js").status_code == 200
    page = client.get("/")
    assert page.status_code == 401 and page.headers["content-type"].startswith("text/html")
    assert "isn't connected to Object" in page.text and "<div id=root>" not in page.text
    assert client.get("/index.html").status_code == 401
    client.cookies.set(key.cookie_name, key.secret)
    assert "<div id=root>" in client.get("/").text


def test_v1_with_a_bearer_token_keeps_its_own_auth(keyed, space_dir: Path) -> None:
    client, _key, _clock = keyed
    _record, secret = TokenStore(space_dir).create("agent", "read")
    assert client.get("/api/v1/schema", headers={"Authorization": f"Bearer {secret}"}).status_code == 200
    assert client.get("/api/v1/schema", headers={"Authorization": "Bearer nope"}).status_code == 401
    # without any Authorization header it is an /api request like the others
    assert client.get("/api/v1/schema").json() == {"detail": "Only Object's own window can use this."}


def test_websockets_under_api_need_the_key_too(keyed) -> None:
    client, _key, _clock = keyed
    with pytest.raises(WebSocketDisconnect) as closed, client.websocket_connect("/api/anything"):
        pass
    assert closed.value.code == 1008


def test_no_key_no_check(space_dir: Path) -> None:
    """Tests and the acceptance scripts serve `create_app` without a key."""
    with TestClient(create_app(Space(space_dir), None, watch=False)) as client:
        assert client.get("/api/space").status_code == 200


def test_open_url_for_a_full_url_keeps_its_path_and_query() -> None:
    key = LaunchKey(PORT)
    url = key.open_url("http://127.0.0.1:8812/?mini=work")
    assert url.startswith("http://127.0.0.1:8812/_open?code=")
    assert url.endswith("&next=/%3Fmini%3Dwork")
    assert LaunchKey(PORT).secret != key.secret  # per launch


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def test_the_launcher_opens_each_window_at_its_own_one_time_link(tmp_path: Path, monkeypatch) -> None:
    """The pywebview window and the keep-on-top window each open at an ``/_open`` link whose
    code gives the cookie once; the launcher's start-up probe gets through with the header."""
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    root = tmp_path / "space"
    root.mkdir()
    (root / "Note.md").write_text("Body\n", encoding="utf-8")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    opened: list[str] = []
    answers: list[tuple[int, str | None]] = []

    def create_window(title, url, **_kw):
        opened.append(url)

    def start():
        windowhost.open_window(f"http://127.0.0.1:{port}/?mini=work")
        for url in opened:
            req = urllib.request.Request(url)
            opener = urllib.request.build_opener(_NoRedirect)
            try:
                opener.open(req, timeout=5)
            except urllib.error.HTTPError as res:
                answers.append((res.code, res.headers.get("set-cookie")))

    monkeypatch.setitem(sys.modules, "webview", types.SimpleNamespace(create_window=create_window, start=start))
    launcher.main(["--space", str(root), "--port", str(port)])
    windowhost.set_opener(None)
    assert [u.split("?")[0] for u in opened] == [f"http://127.0.0.1:{port}/_open"] * 2
    assert opened[0].endswith("&next=/") and opened[1].endswith("&next=/%3Fmini%3Dwork")
    assert opened[0] != opened[1]
    assert [code for code, _c in answers] == [303, 303]
    assert all(c and c.startswith(f"object-ui-{port}=") and "HttpOnly" in c for _code, c in answers)
