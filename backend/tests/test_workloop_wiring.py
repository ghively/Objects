"""The server's body and property save routes hand their change event to the Work loop
(`workloop.on_change_event`), so Gene's own edit of a work item (decision S3, fix pass 2026-11-09)
is seen by the loop that holds it; other routes' announces (a rename's relinked objects, a
relation sync) don't reach it. The loop's own behaviour is tested in ``test_m24_loop.py``."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import server
from objectapp.space import Space
from objectapp.watcher import ChangeEvent

LOOSE = "Tasks/Loose task.md"


def _work_on(root: Path) -> None:
    """M32: the loop is told of edits only while Work is on for the space; this fixture holds no
    work data, so the switch is set (``test_m32_work_switch.py`` covers Work off)."""
    (root / ".object").mkdir(exist_ok=True)
    (root / ".object" / "space.json").write_text(json.dumps({"workEnabled": True}), "utf-8")


def test_announce_hands_every_change_event_to_the_work_loop(links_space_dir: Path, monkeypatch: pytest.MonkeyPatch):
    seen: list[tuple[Space, ChangeEvent]] = []
    monkeypatch.setattr(server, "on_change_event", lambda space, event: seen.append((space, event)))
    _work_on(links_space_dir)
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


def test_a_rename_does_not_reach_the_work_loop(links_space_dir: Path, monkeypatch: pytest.MonkeyPatch):
    """Renaming Ada relinks the objects that link to her; those announces carry the window's
    origin but are not Gene's action on them (review finding 2)."""
    seen: list[ChangeEvent] = []
    monkeypatch.setattr(server, "on_change_event", lambda space, event: seen.append(event))
    _work_on(links_space_dir)
    space = Space(links_space_dir)
    app = server.create_app(space, None)
    with TestClient(app) as c:
        assert space.backlinks("People/Ada Lovelace.md")
        v = c.get("/api/object", params={"path": "People/Ada Lovelace.md"}).json()["version"]
        r = c.post(
            "/api/object/rename",
            json={"path": "People/Ada Lovelace.md", "title": "Ada King", "baseVersion": v, "clientId": "3f1c2b4e-window"},
        )
        assert r.status_code == 200, r.text
    assert seen == []
