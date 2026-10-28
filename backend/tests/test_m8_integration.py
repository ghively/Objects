"""M8 Task 31 integration fixes: the week start reaches the completion hook and the calendar,
recordings (`.weba`) are audio, and a board relinked by a rename keeps a version.

`space-m8`, clock 2026-10-27T10:00:00Z (a Tuesday), the space's zone UTC.
"""

from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.frontmatter import parse_fm
from objectapp.media import kind_of
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.textfile import decode

NOW = datetime(2026, 10, 27, 10, 0, 0, tzinfo=UTC)


@pytest.fixture
def client(m8_space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    space = Space(m8_space_dir)
    app = create_app(space, watch=False)
    space.clock = lambda: NOW
    space.tz = UTC
    with TestClient(app) as c:
        yield c


def _write_task(root: Path, title: str, day: str, repeat: str) -> str:
    rel = f"Tasks/{title}.md"
    (root / rel).write_text(
        "---\nid: 01JC8M8INTEGRATION00000001\ntype: 'Task'\n"
        f"title: {title}\ncreatedAt: 2026-10-01T08:00:00.000Z\nlastUpdated: 2026-10-01T08:00:00.000Z\n"
        f"status: Not Started\ndate: {day}\nrepeat: {repeat}\n---\n",
        encoding="utf-8",
    )
    return rel


def _fm(root: Path, rel: str) -> dict:
    return parse_fm(split_object(decode((root / rel).read_bytes()).text).frontmatter_src)


def _version(client: TestClient, rel: str) -> str:
    return client.get("/api/object", params={"path": rel}).json()["version"]


@pytest.mark.parametrize(("week_start", "nxt"), [("monday", "2026-11-01"), ("sunday", "2026-11-08")])
def test_completion_hook_uses_week_start(client, m8_space_dir: Path, week_start: str, nxt: str):
    ui = m8_space_dir / ".capacities" / "ui.json"
    ui.write_text('{"calendar": {"weekStart": "%s"}}' % week_start, encoding="utf-8")
    rel = _write_task(m8_space_dir, "Fortnightly", "2026-10-26", "every 2 weeks on mon, sun")
    r = client.put(
        "/api/object/properties",
        json={"path": rel, "updates": {"status": ["Done"]}, "baseVersion": _version(client, rel)},
    )
    assert r.status_code == 200, r.text
    assert _fm(m8_space_dir, rel)["date"] == nxt


def test_calendar_occurrences_use_week_start(m8_space_dir: Path, tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    (m8_space_dir / ".capacities" / "ui.json").write_text(
        '{"calendar": {"weekStart": "sunday"}}', encoding="utf-8"
    )
    rel = _write_task(m8_space_dir, "Fortnightly", "2026-10-26", "every 2 weeks on mon, sun")
    space = Space(m8_space_dir)  # opened after the task exists, so it is listed
    app = create_app(space, watch=False)
    space.clock = lambda: NOW
    space.tz = UTC
    with TestClient(app) as client:
        r = client.get("/api/calendar", params={"from": "2026-10-28", "to": "2026-11-10"})
    assert r.status_code == 200, r.text
    days = [d for d, v in r.json()["days"].items() if any(t["path"] == rel for t in v["tasks"])]
    assert days == ["2026-11-08", "2026-11-09"]


def test_recording_extension_is_audio():
    assert kind_of("Recording 2026-10-27 09-05.weba") == "audio"
    assert kind_of("clip.webm") == "video"  # unchanged


def test_board_relink_keeps_a_version(client, m8_space_dir: Path):
    board = "Whiteboards/Media board.md"
    sidecar = m8_space_dir / "Whiteboards" / "Media board.whiteboard.json"
    raw = sidecar.read_bytes()
    sidecar.write_bytes(raw.replace(b'"A locked note."', b'"See [[Merge source]]."'))
    saved = sidecar.read_bytes()
    assert client.get("/api/history", params={"path": board}).json()["versions"] == []
    src = "Pages/Merge source.md"
    r = client.post(
        "/api/object/rename",
        json={"path": src, "title": "Merge source renamed", "baseVersion": _version(client, src)},
    )
    assert r.status_code == 200, r.text
    assert b"[[Merge source renamed]]" in sidecar.read_bytes()
    versions = client.get("/api/history", params={"path": board}).json()["versions"]
    assert len(versions) == 1 and versions[0]["kind"] == "whiteboard"
    # Restoring that version brings the pre-relink sidecar back.
    md_version = _version(client, board)
    r = client.post("/api/history/restore", json={"path": board, "id": versions[0]["id"], "baseVersion": md_version})
    assert r.status_code == 200, r.text
    assert sidecar.read_bytes() == saved
