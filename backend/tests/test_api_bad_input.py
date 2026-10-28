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


@pytest.mark.parametrize("path", ["a\x00b.md", "Attachments/a\x00b.png", "a\x00"])
def test_file_with_nul_is_refused(client: TestClient, path: str):
    assert client.get("/api/file", params={"path": path}).status_code // 100 == 4


@pytest.mark.parametrize("defs", [1, 0, False, "x", "", {"a": 1}, True, 1.5])
def test_type_save_refuses_non_list_property_definitions(client: TestClient, m8_space_dir: Path, defs: object):
    task = next(t for t in client.get("/api/space").json()["types"] if t["id"] == "task")
    before = (m8_space_dir / ".object" / "types" / "task.json").read_bytes()
    res = client.put(
        "/api/types/task",
        json={"type": {"name": "N", "pluralName": "Ns", "propertyDefinitions": defs},
              "baseRevision": task["revision"]},
    )
    assert res.status_code == 422, res.text[:200]
    assert (m8_space_dir / ".object" / "types" / "task.json").read_bytes() == before
