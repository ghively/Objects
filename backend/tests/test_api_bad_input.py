"""Malformed input answers 4xx, never 500 (audit 2026-10-28).

The ``/api/tasks/*`` routes didn't catch the `ValueError` that `Space.read` raises
for a path outside the space or not an object.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space

BAD_PATHS = ["../x.md", "/etc/passwd", "Tasks", "", "C:/x.md", "a\x00.md", "Tasks/../../x.md"]


@pytest.fixture
def client(m8_space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    return TestClient(create_app(Space(m8_space_dir), watch=False), raise_server_exceptions=False)


@pytest.mark.parametrize("path", BAD_PATHS)
def test_task_routes_refuse_bad_paths(client: TestClient, path: str):
    calls = [
        client.get("/api/tasks/overdue", params={"path": path}),
        client.get("/api/tasks/stats", params={"path": path}),
        client.post("/api/tasks/occurrence", json={"path": path, "action": "complete", "baseVersion": "x"}),
        client.put("/api/tasks/reminder", json={"path": path, "key": "date", "baseVersion": "x"}),
    ]
    assert [r.status_code // 100 for r in calls] == [4, 4, 4, 4], [r.text[:80] for r in calls]
