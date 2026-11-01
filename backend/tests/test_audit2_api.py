"""Audit 2026-11-01, second fix pass (API, search, calendar, whiteboard back end)."""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import calendarquery, server
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


# -- GET /api/graph: ETag on every 200, 304 while the graph is unchanged ----------------


@pytest.fixture
def links_client(links_space_dir: Path, tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    return TestClient(create_app(Space(links_space_dir), watch=False), raise_server_exceptions=False)


def _save_body(c: TestClient, path: str, edit) -> None:
    obj = c.get("/api/object", params={"path": path}).json()
    r = c.put(
        "/api/object/body",
        json={"path": path, "body": edit(obj["body"]), "baseVersion": obj["version"]},
    )
    assert r.status_code == 200, r.text


def test_graph_answers_304_until_it_changes(links_client: TestClient):
    c = links_client
    r = c.get("/api/graph")
    assert r.status_code == 200
    etag = r.headers["etag"]
    assert etag.startswith('"') and etag.endswith('"')
    assert "no-cache" in r.headers.get("cache-control", "")
    again = c.get("/api/graph", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.headers["etag"] == etag and again.content == b""
    assert c.get("/api/graph", headers={"If-None-Match": f'W/{etag}, "other"'}).status_code == 304
    assert c.get("/api/graph", headers={"If-None-Match": '"other"'}).status_code == 200
    # A body edit that changes no link, title or flag leaves the graph as it was.
    _save_body(c, "Pages/Notes on mentions.md", lambda b: b + "\nMore words.\n")
    assert c.get("/api/graph", headers={"If-None-Match": etag}).status_code == 304
    # A new link changes it.
    _save_body(c, "Pages/Notes on mentions.md", lambda b: b + "\nSee [[Charles Babbage]].\n")
    r2 = c.get("/api/graph", headers={"If-None-Match": etag})
    assert r2.status_code == 200 and r2.headers["etag"] != etag
    assert r2.json() == c.get("/api/graph").json()
    assert c.get("/api/graph", headers={"If-None-Match": r2.headers["etag"]}).status_code == 304


def test_graph_etag_follows_a_title_change(links_client: TestClient):
    c = links_client
    path = "Pages/Notes on mentions.md"
    etag = c.get("/api/graph").headers["etag"]
    version = c.get("/api/object", params={"path": path}).json()["version"]
    r = c.post(
        "/api/object/rename", json={"path": path, "title": "Renamed notes", "baseVersion": version}
    )
    assert r.status_code == 200, r.text
    r = c.get("/api/graph", headers={"If-None-Match": etag})
    assert r.status_code == 200 and r.headers["etag"] != etag
    assert "Renamed notes" in {n["title"] for n in r.json()["nodes"]}


# -- /api/calendar: summaries for what the client reads them for; the lock only to snapshot --


def _calendar_space(root: Path) -> Space:
    space = Space(root)
    space.clock = lambda: datetime(2026, 10, 27, 9, 0, tzinfo=UTC)
    space.tz = timezone(timedelta(hours=2))
    return space


def test_calendar_summaries_cover_notes_tasks_and_dated_only(calendar_space_dir: Path):
    p = calendar_space_dir / "Pages" / "Linker.md"
    p.write_text(
        "---\nid: 01JBQ4Z7S3N8V2K5D9X6AUDIT2\ntype: 'Page'\ntitle: Linker\n"
        "createdAt: 2026-10-22T08:00:00.000Z\nlastUpdated: 2026-10-23T08:00:00.000Z\n---\n"
        "See [[2026-10-22]].\n",
        encoding="utf-8",
    )
    r = _calendar_space(calendar_space_dir).calendar("2026-10-20", "2026-10-28")
    shown: set[str] = set()
    other: set[str] = set()
    for day in r["days"].values():
        if day["dailyNote"]:
            shown.add(day["dailyNote"]["path"])
        shown.update(e["path"] for e in day["tasks"])
        shown.update(e["path"] for e in day["dated"])
        other.update(day["created"])
        other.update(day["updated"])
        other.update(day["backlinks"])
        other.update(e["path"] for e in day["references"])
        other.update(e["path"] for e in day["timeline"])
    for w in r["warnings"]:
        shown.update(w["paths"])
    assert "Pages/Linker.md" in other
    assert set(r["summaries"]) == shown
    for path, s in r["summaries"].items():
        assert s["path"] == path


def test_calendar_computes_outside_the_space_lock(calendar_space_dir: Path, monkeypatch):
    space = _calendar_space(calendar_space_dir)
    held: list[bool] = []
    real_task, real_stamps = calendarquery._Query.task, calendarquery._Query.stamps

    def task(self, *args):
        held.append(space._lock._is_owned())
        return real_task(self, *args)

    def stamps(self, *args):
        held.append(space._lock._is_owned())
        return real_stamps(self, *args)

    monkeypatch.setattr(calendarquery._Query, "task", task)
    monkeypatch.setattr(calendarquery._Query, "stamps", stamps)
    space.calendar("2026-10-20", "2026-10-28")
    assert held and not any(held)
