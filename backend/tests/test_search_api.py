"""The search routes (M5 Task 3)."""

from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space

ADA = "People/Ada Lovelace.md"
DIFF = "Projects/Difference Engine.md"
ENGINE = "Pages/Analytical Engine.md"


def _client(root: Path):
    space = Space(root)
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    return space, app, TestClient(app)


def _ready(app) -> None:
    assert app.state.search.ready.wait(30)


def _paths(body: dict) -> list[str]:
    return [r["path"] for r in body["results"]]


def _snapshot(root: Path) -> dict[str, tuple[bytes, int]]:
    return {
        p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def test_search_route_returns_contract_shape(links_space_dir: Path):
    _space, app, c = _client(links_space_dir)
    with c:
        _ready(app)
        r = c.get("/api/search", params={"q": "Countess"})
        assert r.status_code == 200
        body = r.json()
        assert set(body) == {"results", "partial"}
        assert body["partial"] is False
        hit = body["results"][0]
        assert hit["path"] == ADA
        assert set(hit) == {
            "path",
            "title",
            "type",
            "icon",
            "tags",
            "score",
            "titleMatches",
            "highlights",
        }
        assert hit["type"] == "person"
        assert any(h["field"] == "aliases" for h in hit["highlights"])
        assert c.get("/api/search", params={"q": ""}).json()["results"] == []
        assert c.get("/api/search").json() == {"results": [], "partial": False}


def test_search_route_filters_and_mode(links_space_dir: Path):
    _space, app, c = _client(links_space_dir)
    with c:
        _ready(app)
        only = c.get(
            "/api/search", params=[("q", "engine"), ("type", "project")]
        ).json()
        assert _paths(only) == [DIFF]
        # Repeated type parameters; an unknown type id is ignored.
        both = c.get(
            "/api/search",
            params=[
                ("q", "engine"),
                ("type", "project"),
                ("type", "page"),
                ("type", "nope"),
            ],
        ).json()
        assert set(_paths(both)) >= {DIFF, ENGINE}
        assert all(r["type"] in {"project", "page"} for r in both["results"])
        unknown_only = c.get(
            "/api/search", params=[("q", "engine"), ("type", "nope")]
        ).json()
        assert DIFF in _paths(unknown_only) and ENGINE in _paths(unknown_only)
        excl = c.get(
            "/api/search",
            params=[
                ("q", "engine"),
                ("excludeType", "project"),
                ("excludeType", "person"),
            ],
        ).json()
        assert DIFF not in _paths(excl)
        assert all(r["type"] not in {"project", "person"} for r in excl["results"])
        tagged = c.get("/api/search", params={"q": "engine", "tag": "History"}).json()
        assert DIFF in _paths(tagged) and ENGINE not in _paths(tagged)
        title = c.get("/api/search", params={"q": "difference", "mode": "title"}).json()
        assert _paths(title) == [DIFF]
        limited = c.get("/api/search", params={"q": "e", "limit": "1"}).json()
        assert len(limited["results"]) == 1


def test_search_route_422s(links_space_dir: Path):
    _space, _app, c = _client(links_space_dir)
    with c:
        assert (
            c.get("/api/search", params={"q": "x", "mode": "fullText"}).status_code
            == 422
        )
        assert (
            c.get("/api/search", params={"q": "x", "mode": "semantic"}).status_code
            == 422
        )
        for bad in ("0", "201", "-1", "abc", "1.5"):
            r = c.get("/api/search", params={"q": "x", "limit": bad})
            assert r.status_code == 422, bad
            assert "limit" in r.json()["detail"]
        assert (
            c.get("/api/search", params={"q": "x", "limit": "200"}).status_code == 200
        )
        assert c.get("/api/search", params={"q": "a" * 200}).status_code == 200
        long = c.get("/api/search", params={"q": "a" * 201})
        assert long.status_code == 422
        assert "200" in long.json()["detail"]


def test_reindex_route_rebuilds(links_space_dir: Path):
    _space, app, c = _client(links_space_dir)
    with c:
        _ready(app)
        assert ADA in _paths(c.get("/api/search", params={"q": "Countess"}).json())
        r = c.post("/api/search/reindex", json={"clientId": "c1"})
        assert r.status_code == 202
        assert r.json() == {"started": True}
        # partial until the rebuild is done; then results again.
        assert app.state.search.ready.wait(10)
        deadline = time.monotonic() + 5
        body = c.get("/api/search", params={"q": "Countess"}).json()
        while (
            body["partial"] or ADA not in _paths(body)
        ) and time.monotonic() < deadline:
            time.sleep(0.05)
            body = c.get("/api/search", params={"q": "Countess"}).json()
        assert body["partial"] is False
        assert ADA in _paths(body)
        assert c.post("/api/search/reindex").status_code == 202


def test_reindex_reports_partial_while_rebuilding(links_space_dir: Path):
    _space, app, c = _client(links_space_dir)
    with c:
        _ready(app)
        app.state.search.reindex()
        # reindex() clears `ready` at once, so the very next search is honest.
        assert c.get("/api/search", params={"q": "Ada"}).json()["partial"] is True
        assert app.state.search.ready.wait(10)


def test_search_routes_write_nothing_to_space(
    links_space_dir: Path, tmp_path: Path, monkeypatch
):
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache-outside"))
    before = _snapshot(links_space_dir)
    _space, app, c = _client(links_space_dir)
    with c:
        _ready(app)
        for q in ("Ada", "engine", "difference", "cafe", "Countess", "zzz"):
            assert c.get("/api/search", params={"q": q}).status_code == 200
        c.get("/api/search", params={"q": "x", "mode": "bad"})
        assert c.post("/api/search/reindex", json={}).status_code == 202
        assert app.state.search.ready.wait(10)
        time.sleep(0.3)
    assert _snapshot(links_space_dir) == before
    assert any((tmp_path / "cache-outside").rglob("search.sqlite"))
