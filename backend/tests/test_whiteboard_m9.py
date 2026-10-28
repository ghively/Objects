"""M9 Task 5: whiteboard edits bump the board's ``lastUpdated``.

``lastUpdated`` is component-level in Capacities (``component.model.ts``) and the canvas is
component data, so a board or ink save also stamps the board's ``.md`` (Gene's choice,
reversing M6). Only the ``lastUpdated`` line changes, at most once a minute (our choice),
and the stamp takes no version-history snapshot (our choice). The save answers
``mdVersion`` (the ``.md``'s version after the bump) and ``mdBaseVersion`` (the version the
stamp started from) only when the stamp wrote the disk.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from objectapp.space import Space
from objectapp.whiteboardapi import whiteboard_router
from objectapp.whiteboardfile import board_rel
from wb_support import copy_whiteboard_space, tree_hashes

NETWORK = "Whiteboards/Network map.md"
EMPTY = "Whiteboards/Empty board.md"
T0 = datetime(2026, 10, 28, 12, 0, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> datetime:
        return self.now


def stamp(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def small_board(text: str = "Hello") -> dict:
    return {
        "version": 1,
        "nodes": {
            "n1": {"id": "n1", "kind": "block", "blockId": "b1", "position": {"x": 30, "y": 60}}
        },
        "edges": {},
        "blocks": {"b1": {"type": "text", "markdown": text}},
    }


def stroke(sid: str = "s1") -> dict:
    return {"id": sid, "tool": "pen", "color": "#112233", "width": 2, "points": [[1, 2, 0.5]], "d": "M1 2"}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def ctx(tmp_path):
    root = copy_whiteboard_space(tmp_path)
    space = Space(root)
    clock = Clock()
    space.clock = clock
    events: list = []
    app = FastAPI()
    app.include_router(whiteboard_router(space, events.append))
    return space, TestClient(app), events, root, clock


def put_board(c: TestClient, root: Path, path: str, text: str = "Hello", client_id: str = "w1"):
    sidecar = root / board_rel(path)
    base = sha(sidecar.read_bytes()) if sidecar.exists() else ""
    return c.put(
        "/api/whiteboard",
        json={"path": path, "board": small_board(text), "baseRevision": base, "clientId": client_id},
    )


def changed_files(before: dict, after: dict) -> set[str]:
    return {k for k in before.keys() | after.keys() if before.get(k) != after.get(k)}


def test_board_save_bumps_md_last_updated_only_that_line(ctx):
    _space, c, _events, root, _clock = ctx
    md_before = (root / NETWORK).read_bytes()
    before = tree_hashes(root)
    r = put_board(c, root, NETWORK)
    assert r.status_code == 200, r.text
    after = tree_hashes(root)
    assert changed_files(before, after) == {NETWORK, "Whiteboards/Network map.whiteboard.json"}
    md_after = (root / NETWORK).read_bytes()
    assert md_after == md_before.replace(
        b"lastUpdated: 2026-10-20T09:00:00.000Z\n", f"lastUpdated: {stamp(T0)}\n".encode()
    )
    assert md_after != md_before


def test_bump_throttled_under_60s(ctx):
    space, c, _events, root, clock = ctx
    assert put_board(c, root, NETWORK, "one").status_code == 200
    first = (root / NETWORK).read_bytes()
    clock.now = T0 + timedelta(seconds=59)
    assert put_board(c, root, NETWORK, "two").status_code == 200
    assert (root / NETWORK).read_bytes() == first
    clock.now = T0 + timedelta(seconds=60)
    assert put_board(c, root, NETWORK, "three").status_code == 200
    assert f"lastUpdated: {stamp(clock.now)}\n".encode() in (root / NETWORK).read_bytes()
    assert space.get(NETWORK).lastUpdated == stamp(clock.now)


def test_ink_save_bumps(ctx):
    _space, c, _events, root, _clock = ctx
    before = tree_hashes(root)
    r = c.put("/api/whiteboard/ink", json={"path": EMPTY, "strokes": [stroke()], "baseRevision": ""})
    assert r.status_code == 200, r.text
    after = tree_hashes(root)
    assert changed_files(before, after) == {EMPTY, "Whiteboards/Empty board.ink.svg"}
    assert f"lastUpdated: {stamp(T0)}\n".encode() in (root / EMPTY).read_bytes()


def test_bump_keeps_crlf_bom(ctx):
    space, c, _events, root, _clock = ctx
    md = root / EMPTY
    crlf = b"\xef\xbb\xbf" + md.read_bytes().replace(b"\n", b"\r\n")
    md.write_bytes(crlf)
    space.rescan_file(EMPTY)
    assert put_board(c, root, EMPTY).status_code == 200
    assert md.read_bytes() == crlf.replace(
        b"lastUpdated: 2026-10-20T09:00:00.000Z\r\n", f"lastUpdated: {stamp(T0)}\r\n".encode()
    )


def test_bump_takes_no_history_version(ctx):
    space, c, _events, root, _clock = ctx
    seen: list[str] = []
    space.before_write = lambda rel, _data: seen.append(rel)
    assert put_board(c, root, NETWORK).status_code == 200
    assert NETWORK not in seen
    assert seen == ["Whiteboards/Network map.whiteboard.json"]


def test_save_returns_md_version(ctx):
    space, c, events, root, clock = ctx
    md_before = sha((root / NETWORK).read_bytes())
    r = put_board(c, root, NETWORK)
    assert r.status_code == 200
    md_version = sha((root / NETWORK).read_bytes())
    sidecar = sha((root / board_rel(NETWORK)).read_bytes())
    assert r.json() == {"revision": sidecar, "mdVersion": md_version, "mdBaseVersion": md_before}
    assert space.cached_version(NETWORK) == md_version
    assert [(e.kind, e.path, e.version, e.origin) for e in events] == [
        ("whiteboard", NETWORK, sidecar, "w1"),
        ("changed", NETWORK, md_version, "w1"),
    ]
    # Throttled: the .md is unchanged, no mdVersion, no `changed`.
    events.clear()
    clock.now = T0 + timedelta(seconds=10)
    r = c.put("/api/whiteboard/ink", json={"path": NETWORK, "strokes": [stroke()],
                                           "baseRevision": sha((root / "Whiteboards/Network map.ink.svg").read_bytes())})
    assert r.status_code == 200, r.text
    assert "mdVersion" not in r.json() and "mdBaseVersion" not in r.json()
    assert [e.kind for e in events] == ["whiteboard"]


def test_failed_save_does_not_bump(ctx):
    _space, c, _events, root, _clock = ctx
    md_before = (root / NETWORK).read_bytes()
    r = c.put("/api/whiteboard", json={"path": NETWORK, "board": small_board(), "baseRevision": "stale"})
    assert r.status_code == 409
    assert (root / NETWORK).read_bytes() == md_before


def test_read_only_md_still_saves_board(ctx):
    space, c, _events, root, _clock = ctx
    md = root / EMPTY
    # Malformed YAML would make the .md read-only, but then it isn't a known whiteboard;
    # a non-UTF-8 byte in the body keeps the type and makes the file read-only.
    md.write_bytes(md.read_bytes() + b"\xff\n")
    space.rescan_file(EMPTY)
    before = md.read_bytes()
    r = put_board(c, root, EMPTY)
    assert r.status_code == 200, r.text
    assert md.read_bytes() == before
    assert "mdVersion" not in r.json()


def test_md_base_version_is_the_disk_version_the_stamp_started_from(ctx):
    # Another window or editor changed the body; this window hasn't loaded it. The save
    # reports that disk version as the stamp's base, so a client holding an older version
    # does not adopt mdVersion (its next Notes save meets a 409 instead of overwriting).
    _space, c, _events, root, _clock = ctx
    md = root / NETWORK
    md.write_bytes(md.read_bytes() + b"\nAn external paragraph.\n")
    external = sha(md.read_bytes())
    r = put_board(c, root, NETWORK)
    assert r.status_code == 200, r.text
    assert r.json()["mdBaseVersion"] == external
    assert r.json()["mdVersion"] == sha(md.read_bytes())
    assert b"An external paragraph." in md.read_bytes()


def test_throttled_stamp_with_stale_cache_announces_nothing(ctx):
    # The cached version is stale (an external write not yet rescanned) and the stamp is
    # throttled: nothing was written, so no `changed` and no mdVersion.
    _space, c, events, root, clock = ctx
    assert put_board(c, root, NETWORK, "one").status_code == 200
    md = root / NETWORK
    md.write_bytes(md.read_bytes() + b"\nAn external paragraph.\n")
    events.clear()
    clock.now = T0 + timedelta(seconds=5)
    r = put_board(c, root, NETWORK, "two")
    assert r.status_code == 200, r.text
    assert "mdVersion" not in r.json()
    assert [e.kind for e in events] == ["whiteboard"]


def _set_last_updated(space: Space, root: Path, value: str) -> None:
    md = root / NETWORK
    md.write_bytes(
        md.read_bytes().replace(
            b"lastUpdated: 2026-10-20T09:00:00.000Z\n", f"lastUpdated: {value}\n".encode()
        )
    )
    space.rescan_file(NETWORK)


def test_naive_last_updated_is_local_time(ctx):
    # East of UTC: a time-zone-less stamp an hour ago (local time) must not read as an hour ahead.
    space, c, _events, root, _clock = ctx
    space.tz = timezone(timedelta(hours=10))
    _set_last_updated(space, root, "2026-10-28T21:00:00")  # 11:00Z, an hour before T0
    assert put_board(c, root, NETWORK).status_code == 200
    assert f"lastUpdated: {stamp(T0)}\n".encode() in (root / NETWORK).read_bytes()


def test_naive_last_updated_recent_is_throttled(ctx):
    space, c, _events, root, _clock = ctx
    space.tz = timezone(timedelta(hours=10))
    _set_last_updated(space, root, "2026-10-28T21:59:30")  # 11:59:30Z, 30 s before T0
    before = (root / NETWORK).read_bytes()
    assert put_board(c, root, NETWORK).status_code == 200
    assert (root / NETWORK).read_bytes() == before


def test_last_updated_in_the_future_is_replaced(ctx):
    space, c, _events, root, _clock = ctx
    _set_last_updated(space, root, "2026-10-28T12:00:30.000Z")  # 30 s after T0
    assert put_board(c, root, NETWORK).status_code == 200
    assert f"lastUpdated: {stamp(T0)}\n".encode() in (root / NETWORK).read_bytes()
