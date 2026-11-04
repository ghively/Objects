"""The sidebar's Object Types sort: ``PUT /api/ui`` takes ``objectsSectionSortOption``
(``objectsSectionSortOption``: ``alphabetical`` | ``manual``) and ``workspace``
(the space's ``workspace``; its ``objects`` section's ``ids`` hold the manual order).
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space


def _client(root: Path):
    space = Space(root)
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    return TestClient(app)


def test_objects_section_sort_roundtrip_and_422(space_dir: Path):
    c = _client(space_dir)
    with c:
        rev = c.get("/api/ui").json()["revision"]
        patch = {"objectsSectionSortOption": "manual", "workspace": {"objects": {"ids": ["b", "queries", "a"]}}}
        r = c.put("/api/ui", json={"patch": patch, "baseRevision": rev})
        assert r.status_code == 200, r.text
        got = c.get("/api/ui").json()
        assert got["ui"]["objectsSectionSortOption"] == "manual"
        assert got["ui"]["workspace"] == {"objects": {"ids": ["b", "queries", "a"]}}
        rev = got["revision"]
        bad_patches = [
            {"objectsSectionSortOption": "byDate"},
            {"objectsSectionSortOption": 1},
            {"workspace": []},
            {"workspace": {"objects": {"ids": "a"}}},
            {"workspace": {"objects": {"ids": ["a", 2]}}},
            {"workspace": {"objects": {"ids": ["a", "a"]}}},
            {"workspace": {"other": {"ids": []}}},
        ]
        for bad in bad_patches:
            r = c.put("/api/ui", json={"patch": bad, "baseRevision": rev})
            assert r.status_code == 422, bad
        assert c.get("/api/ui").json()["revision"] == rev
        r = c.put("/api/ui", json={"patch": {"objectsSectionSortOption": "alphabetical"}, "baseRevision": rev})
        assert r.status_code == 200
        assert r.json()["ui"]["workspace"] == {"objects": {"ids": ["b", "queries", "a"]}}
