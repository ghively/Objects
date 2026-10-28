"""Live backlinks on `GET /api/object`, the `graph` ui key and the M5 wiring (M5 Task 2)."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.searchindex import SearchIndex
from objectapp.server import create_app
from objectapp.space import Space

ADA = "People/Ada Lovelace.md"


def _client(root: Path, watch: bool = False):
    space = Space(root)
    app = create_app(space, None, watch=watch)
    app.state.hub.publish = lambda _e: None
    return space, app, TestClient(app)


def test_object_route_returns_backlinks(links_space_dir: Path):
    space, _app, c = _client(links_space_dir)
    with c:
        body = c.get("/api/object", params={"path": ADA}).json()
        assert body["backlinks"] == space.backlinks(ADA)
        paths = [r["path"] for r in body["backlinks"]]
        assert "Pages/Analytical Engine.md" in paths
        assert paths.count("Pages/Analytical Engine.md") == 1
        assert {
            "target": "Charles Babbage",
            "path": "People/Charles Babbage.md",
        } in body["backlinks"]
        none = c.get("/api/object", params={"path": "Tasks/Loose task.md"}).json()
        assert none["backlinks"] == []
        # A new link shows on the next read.
        rel = "Tasks/Loose task.md"
        v = c.get("/api/object", params={"path": rel}).json()["version"]
        r = c.put(
            "/api/object/body",
            json={"path": rel, "body": "See [[Ada]].\n", "baseVersion": v},
        )
        assert r.status_code == 200
        after = c.get("/api/object", params={"path": ADA}).json()["backlinks"]
        assert {"target": "Loose task", "path": rel} in after


def test_ui_graph_key(links_space_dir: Path):
    _space, _app, c = _client(links_space_dir)
    with c:
        rev = c.get("/api/ui").json()["revision"]
        r = c.put(
            "/api/ui",
            json={"patch": {"reminders": {"enabled": False}}, "baseRevision": rev},
        )
        assert r.status_code == 200
        rev = r.json()["revision"]
        graph = {
            "filterStructureIds": ["person"],
            "excludeStructureIds": [],
            "showCompletedTasks": True,
            "showMinimalNodes": False,
            "hideLargeNodes": True,
            "hideDates": True,
            "hideIndirectLinks": False,
            "showTagsNetwork": False,
            "showSpaceTagsNetwork": True,
        }
        r = c.put("/api/ui", json={"patch": {"graph": graph}, "baseRevision": rev})
        assert r.status_code == 200, r.text
        ui = r.json()["ui"]
        assert ui["graph"] == graph
        assert ui["reminders"] == {"enabled": False}
        rev = r.json()["revision"]
        assert c.get("/api/ui").json()["ui"]["graph"] == graph

        bad = c.put(
            "/api/ui", json={"patch": {"graph": {"zoom": 2}}, "baseRevision": rev}
        )
        assert bad.status_code == 422
        assert bad.json()["detail"] == "Cannot patch: graph.zoom"
        bad = c.put(
            "/api/ui",
            json={"patch": {"graph": {"hideDates": "yes"}}, "baseRevision": rev},
        )
        assert bad.status_code == 422
        assert bad.json()["detail"] == "graph.hideDates must be true or false."
        bad = c.put(
            "/api/ui",
            json={"patch": {"graph": {"filterStructureIds": [1]}}, "baseRevision": rev},
        )
        assert bad.status_code == 422
        bad = c.put("/api/ui", json={"patch": {"graph": []}, "baseRevision": rev})
        assert bad.status_code == 422
        stale = c.put("/api/ui", json={"patch": {"graph": {}}, "baseRevision": "stale"})
        assert stale.status_code == 409

        r = c.put(
            "/api/ui",
            json={"patch": {"tasks": {"activeTab": "source", "views": {"source": {}}}},
                  "baseRevision": rev},
        )  # fmt: skip
        assert r.status_code == 200, r.text
        assert r.json()["ui"]["tasks"]["activeTab"] == "source"
        assert r.json()["ui"]["graph"] == graph


@pytest.mark.parametrize("watch", [False, True])
def test_routers_mounted_and_search_stub_started(
    links_space_dir: Path, watch: bool, monkeypatch
):
    calls: list[str] = []
    real_start, real_stop = SearchIndex.start, SearchIndex.stop

    def start(self):
        calls.append("start")
        return real_start(self)

    def stop(self):
        calls.append("stop")
        return real_stop(self)

    monkeypatch.setattr(SearchIndex, "start", start)
    monkeypatch.setattr(SearchIndex, "stop", stop)
    _space, app, c = _client(links_space_dir, watch=watch)
    search = app.state.search
    assert isinstance(search, SearchIndex)
    assert calls == []
    with c:
        assert calls == ["start"]
        assert search.ready.wait(10)
        assert c.get("/api/object", params={"path": ADA}).status_code == 200
        # The three M5 routers are mounted under /api (no routes of their own yet is fine).
        assert c.get("/api/space").status_code == 200
    assert calls == ["start", "stop"]
