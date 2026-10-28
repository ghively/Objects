"""The local API only answers its own pages (audit 2026-10-28 #1).

A foreign ``Host`` (DNS rebinding) is refused on every request, a foreign ``Origin``
on every state-changing one, and uploads need ``application/octet-stream`` so a
"simple" cross-site ``text/plain`` POST can never write a file.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import server
from objectapp.server import create_app
from objectapp.space import Space

BASE = "http://127.0.0.1:8790"
OCTET = {"content-type": "application/octet-stream"}


@pytest.fixture
def client(space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    return TestClient(create_app(Space(space_dir), watch=False), base_url=BASE)


def test_production_hosts_are_loopback_only():
    assert server.LOOPBACK_HOSTS == frozenset({"127.0.0.1", "localhost", "::1"})


@pytest.mark.parametrize("host", ["127.0.0.1:8790", "localhost:8790", "localhost:5173", "[::1]:8790", "LOCALHOST"])
def test_loopback_host_is_served(client: TestClient, host: str):
    assert client.get("/api/space", headers={"host": host}).status_code == 200


@pytest.mark.parametrize("host", ["evil.example", "evil.example:8790", "127.0.0.1.evil.example", "", "[::1"])
def test_foreign_host_is_refused(client: TestClient, host: str):
    assert client.get("/api/space", headers={"host": host}).status_code == 403
    res = client.post("/api/spaces/delete", json={"path": "x", "permanent": True}, headers={"host": host})
    assert res.status_code == 403


def test_foreign_origin_cannot_write(client: TestClient, space_dir: Path):
    before = sorted(p.name for p in (space_dir).rglob("*"))
    for origin in ["http://evil.example", "https://evil.example", "null", "http://127.0.0.1:9999",
                   "http://localhost:8790"]:
        res = client.post("/api/attachments", params={"name": "evil.exe"}, content=b"MZ",
                          headers={**OCTET, "origin": origin})
        assert res.status_code == 403, origin
        res = client.post("/api/objects", json={"typeId": "page", "title": "x"}, headers={"origin": origin})
        assert res.status_code == 403, origin
    assert sorted(p.name for p in (space_dir).rglob("*")) == before


def test_same_origin_can_write(client: TestClient):
    res = client.post("/api/attachments", params={"name": "a.bin"}, content=b"x",
                      headers={**OCTET, "origin": BASE})
    assert res.status_code == 201
    # The Vite dev server proxies with the page's Host, so Origin still matches it.
    res = client.post("/api/attachments", params={"name": "b.bin"}, content=b"x",
                      headers={**OCTET, "origin": "http://localhost:5173", "host": "localhost:5173"})
    assert res.status_code == 201


def test_foreign_origin_may_not_read_either_way_but_get_is_not_a_write(client: TestClient):
    # Reads are guarded by the Host check and the browser's same-origin policy (no CORS
    # headers are ever sent); a cross-origin GET gets no CORS grant.
    res = client.get("/api/objects", headers={"origin": "https://evil.example"})
    assert "access-control-allow-origin" not in res.headers


@pytest.mark.parametrize("route,name", [("/api/attachments", "x.html"), ("/api/images", "evil.svg")])
@pytest.mark.parametrize("ctype", [None, "text/plain", "application/x-www-form-urlencoded",
                                   "multipart/form-data; boundary=x", "text/plain;charset=UTF-8"])
def test_upload_needs_octet_stream(client: TestClient, space_dir: Path, route: str, name: str, ctype: str | None):
    headers = {} if ctype is None else {"content-type": ctype}
    res = client.post(route, params={"name": name}, content=b"<svg/>", headers=headers)
    assert res.status_code == 415
    assert not (space_dir / "Attachments" / name).exists()
