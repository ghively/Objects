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


# -- uploads named like a whiteboard's sidecar files are refused --------------------------


@pytest.mark.parametrize(
    "name", ["Board.ink.svg", "Board.whiteboard.json", "b.INK.SVG", "dir/x.Whiteboard.Json", "x.ink.svg "]
)
@pytest.mark.parametrize("route", ["/api/attachments", "/api/images"])
def test_sidecar_named_uploads_answer_415(client: TestClient, space_dir: Path, name: str, route: str):
    body = b"<svg xmlns='http://www.w3.org/2000/svg'/>" if "svg" in name.lower() else b"{}"
    before = client.get("/api/attachments").json()
    r = client.post(route, params={"name": name}, content=body, headers={"content-type": "application/octet-stream"})
    assert r.status_code == 415, r.text
    if route == "/api/attachments" or name.lower().endswith(".svg"):
        assert "whiteboard" in r.json()["detail"]  # else: not an image either
    assert client.get("/api/attachments").json() == before
    folder = space_dir / "Attachments"
    assert not folder.exists() or not [
        p for p in folder.iterdir() if p.name.lower().endswith((".ink.svg", ".whiteboard.json"))
    ]


def test_other_svg_and_json_uploads_still_work(client: TestClient):
    octet = {"content-type": "application/octet-stream"}
    svg = b"<svg xmlns='http://www.w3.org/2000/svg'/>"
    assert client.post("/api/attachments", params={"name": "ink.svg"}, content=svg, headers=octet).status_code == 201
    assert client.post("/api/images", params={"name": "diagram.svg"}, content=svg, headers=octet).status_code == 201
    r = client.post("/api/attachments", params={"name": "whiteboard.json"}, content=b"{}", headers=octet)
    assert r.status_code == 201


# -- a whiteboard sidecar locked by another program answers "in use", not a bare 500 -----


def _locked(*_a, **_k):
    exc = PermissionError(13, "The process cannot access the file")
    exc.winerror = 32  # a Windows sharing violation
    raise exc


@pytest.mark.parametrize("route", ["board", "ink"])
def test_locked_whiteboard_files_answer_in_use(tmp_path: Path, monkeypatch, route: str):
    from objectapp import whiteboardapi
    from wb_support import copy_whiteboard_space

    root = copy_whiteboard_space(tmp_path)
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    c = TestClient(create_app(Space(root), watch=False), raise_server_exceptions=False)
    path = "Whiteboards/Empty board.md"
    url = "/api/whiteboard" if route == "board" else "/api/whiteboard/ink"
    for name in ("read_board", "read_ink", "save_board", "save_ink"):
        monkeypatch.setattr(whiteboardapi, name, _locked)
    r = c.get(url, params={"path": path})
    assert r.status_code == 503 and "in use" in r.json()["detail"], r.text
    payload = {"board": {"nodes": [], "edges": []}} if route == "board" else {"strokes": []}
    r = c.put(url, json={"path": path, "baseRevision": "", **payload})
    assert r.status_code == 503 and "in use" in r.json()["detail"], r.text

    def denied(*_a, **_k):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(whiteboardapi, "read_board" if route == "board" else "read_ink", denied)
    r = c.get(url, params={"path": path})
    assert r.status_code == 503 and "in use" not in r.json()["detail"]


# -- EventHub: a bounded queue per subscriber; overflow becomes one resync event --------


def test_event_hub_bounds_a_slow_subscriber():
    import asyncio

    from objectapp.server import EventHub
    from objectapp.watcher import ChangeEvent

    async def main() -> None:
        hub = EventHub()
        hub.loop = asyncio.get_running_loop()
        stream = hub.subscribe()
        first = asyncio.ensure_future(stream.__anext__())
        await asyncio.sleep(0)
        hub.publish(ChangeEvent("changed", "p-first", "v", origin="me"))
        assert (await first).path == "p-first"
        (q,) = hub._subscribers
        sizes = []
        for i in range(2500):
            hub.publish(ChangeEvent("changed", f"p{i}", "v", origin="me"))
            sizes.append(q.qsize())
        assert max(sizes) <= server.EVENT_QUEUE_MAX == 1000
        got = [await stream.__anext__() for _ in range(q.qsize())]
        # The resync the client sends itself after a reconnect (`api/client.ts` RESYNC_EVENTS).
        # (M14 added "automations", M17 "agents" and "agentChats", M18 "agentLearning", M19
        # "mcpServers", M23 "work" and "workQueue".)
        kinds = ("types", "views", "ui", "collections", "queries", "automations", "agents", "agentChats",
                 "agentLearning", "work", "workQueue", "mcpServers")
        resync = [ChangeEvent(k, "*", None) for k in kinds]
        assert got[:12] == resync and all(e.origin is None for e in got[:12])
        # 1,000 fill the queue; p1000 drops them for the resync (12), p1001..p1988 fill it
        # again, p1989 drops those, and p1990..p2499 follow the second resync.
        assert [e.path for e in got[12:]] == [f"p{i}" for i in range(1990, 2500)]
        # A full queue still ends when the hub closes.
        for i in range(1000):
            hub.publish(ChangeEvent("changed", f"q{i}", "v"))
        hub.close()
        rest = [e async for e in stream]
        assert len(rest) <= 1000

    asyncio.run(main())


# -- spaces.normalize: a name component's limit is the file system's own -----------------


def test_component_limit_counts_utf16_units_on_windows(monkeypatch):
    from objectapp import spaces

    cjk = "文" * 200  # 200 UTF-16 units, 600 UTF-8 bytes
    emoji = "\U0001f600" * 128  # 256 UTF-16 units (surrogate pairs), 512 bytes
    monkeypatch.setattr(spaces.os, "name", "nt")
    assert not spaces._component_too_long(cjk)
    assert not spaces._component_too_long("x" * 255)
    assert spaces._component_too_long("x" * 256)
    assert spaces._component_too_long(emoji)
    assert not spaces._component_too_long("\U0001f600" * 127)
    monkeypatch.setattr(spaces.os, "name", "posix")
    assert spaces._component_too_long(cjk)
    assert not spaces._component_too_long("文" * 85)  # 255 bytes
    assert spaces._component_too_long("文" * 86)
    assert not spaces._component_too_long("x" * 255)


@pytest.mark.skipif(os.name == "nt", reason="a POSIX path")
def test_normalize_takes_an_undecodable_posix_name(tmp_path: Path):
    from objectapp import spaces

    bad = os.fsdecode(os.fsencode(str(tmp_path)) + b"/caf\xe9")
    assert spaces.normalize(bad) == Path(bad).resolve()
    with pytest.raises(ValueError):
        spaces.normalize(str(tmp_path / ("文" * 86)))


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
