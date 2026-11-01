"""Audit 2026-11-01, second fix pass (API, search, calendar, whiteboard back end)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import server
from objectapp.server import create_app
from objectapp.space import Space


@pytest.fixture
def client(space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    return TestClient(create_app(Space(space_dir), watch=False), raise_server_exceptions=False)


# -- _display_safe copies only what holds undecodable bytes ------------------------------


def test_display_safe_returns_clean_input_unchanged():
    value = {"rows": [{"path": "Pages/A.md", "values": {"n": 1, "t": ["x", "é"]}}]}
    assert server._display_safe(value) is value


def test_display_safe_replaces_surrogate_escapes():
    bad = b"Pages/B \xff.md".decode("utf-8", errors="surrogateescape")
    value = {"rows": [{"path": bad}, {"path": "Pages/A.md"}], bad: 1}
    out = server._display_safe(value)
    assert out == {"rows": [{"path": "Pages/B �.md"}, {"path": "Pages/A.md"}], "Pages/B �.md": 1}
    assert value["rows"][0]["path"] == bad  # the input is not changed


def test_big_reads_do_not_copy_a_clean_response(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    calls = []
    real = server._display_safe
    monkeypatch.setattr(server, "_display_safe", lambda v: calls.append(1) or real(v))
    for r in (
        client.get("/api/objects"),
        client.post("/api/rows", json={}),
        client.get("/api/calendar", params={"from": "2026-10-01", "to": "2026-10-31"}),
        client.get("/api/graph"),
    ):
        assert r.status_code == 200, r.text
    assert calls == []


@pytest.mark.skipif(os.name == "nt", reason="undecodable file names are a POSIX case")
def test_big_reads_show_an_undecodable_file_name(space_dir: Path, tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    raw = os.fsencode(space_dir) + b"/Bad \xff name.md"
    with open(raw, "wb") as f:
        f.write(b"# Heading\n\nbody\n")
    c = TestClient(create_app(Space(space_dir), watch=False), raise_server_exceptions=False)
    r = c.get("/api/objects")
    assert r.status_code == 200
    assert "Bad � name.md" in {o["path"] for o in r.json()}
    r = c.post("/api/rows", json={})
    assert r.status_code == 200
    assert "Bad � name.md" in {row["summary"]["path"] for row in r.json()["rows"]}
    assert c.get("/api/graph").status_code == 200
