"""The server's ``announce`` hands every change event to the Work loop (`workloop.on_change_event`),
so Gene's own edit of a work item (decision S3, fix pass 2026-11-09) is seen by the loop that
holds it. The loop's own behaviour is tested in ``test_m24_loop.py``."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import server
from objectapp.space import Space
from objectapp.watcher import ChangeEvent

LOOSE = "Tasks/Loose task.md"


def test_announce_hands_every_change_event_to_the_work_loop(links_space_dir: Path, monkeypatch: pytest.MonkeyPatch):
    seen: list[tuple[Space, ChangeEvent]] = []
    monkeypatch.setattr(server, "on_change_event", lambda space, event: seen.append((space, event)))
    space = Space(links_space_dir)
    app = server.create_app(space, None)
    with TestClient(app) as c:
        v = c.get("/api/object", params={"path": LOOSE}).json()["version"]
        r = c.put(
            "/api/object/properties",
            json={"path": LOOSE, "updates": {"description": "edited"}, "baseVersion": v, "clientId": "3f1c2b4e-window"},
        )
        assert r.status_code == 200, r.text
    changed = [(s, e) for s, e in seen if e.kind == "changed" and e.path == LOOSE]
    assert changed and changed[0][0] is space
    assert changed[0][1].origin == "3f1c2b4e-window"
