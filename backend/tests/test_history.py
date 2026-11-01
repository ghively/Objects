"""M8 Task 4: version history for objects and whiteboards (store, hook and routes).

`space-m8` copies; the clock is set per test (``space.clock``); the state dir is the
autouse per-test `OBJECT_STATE_DIR`.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.frontmatter import parse_fm
from objectapp.history import MAX_VERSIONS, HistoryStore, keep_identity
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space, version_of
from objectapp.textfile import decode

T0 = datetime(2026, 10, 27, 10, 0, 0, tzinfo=UTC)
PAGE = "Pages/Source note.md"
CRLF = "Pages/CRLF M8.md"
BOARD = "Whiteboards/Media board.md"
BOARD_JSON = "Whiteboards/Media board.whiteboard.json"
INK = "Whiteboards/Media board.ink.svg"


class Clock:
    def __init__(self, at: datetime = T0) -> None:
        self.at = at

    def __call__(self) -> datetime:
        return self.at

    def advance(self, **kw) -> None:
        self.at += timedelta(**kw)


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def space(m8_space_dir: Path) -> Space:
    return Space(m8_space_dir)


@pytest.fixture
def client(space: Space, clock: Clock):
    app = create_app(space, watch=False)
    space.clock = clock
    space.tz = UTC
    with TestClient(app) as c:
        yield c


def _state() -> Path:
    return Path(os.environ["OBJECT_STATE_DIR"])


def _tree(root: Path) -> dict[str, str]:
    if not root.exists():
        return {}
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _version(client: TestClient, rel: str) -> str:
    r = client.get("/api/object", params={"path": rel})
    assert r.status_code == 200, r.text
    return r.json()["version"]


def _save_body(client: TestClient, rel: str, body: str):
    r = client.put(
        "/api/object/body", json={"path": rel, "body": body, "baseVersion": _version(client, rel)}
    )
    assert r.status_code == 200, r.text
    return r.json()["version"]


def _versions(client: TestClient, rel: str) -> list[dict]:
    r = client.get("/api/history", params={"path": rel})
    assert r.status_code == 200, r.text
    return r.json()["versions"]


def _content(client: TestClient, rel: str, vid: str):
    r = client.get("/api/history/version", params={"path": rel, "id": vid})
    assert r.status_code == 200, r.text
    return r.json()["text"]


def _restore(client: TestClient, rel: str, vid: str, base: str):
    return client.post("/api/history/restore", json={"path": rel, "id": vid, "baseVersion": base})


def _fm(root: Path, rel: str) -> dict:
    return parse_fm(split_object(decode((root / rel).read_bytes()).text).frontmatter_src)


def _board(client: TestClient) -> dict:
    r = client.get("/api/whiteboard", params={"path": BOARD})
    assert r.status_code == 200, r.text
    return r.json()


# --- snapshots -----------------------------------------------------------------------------


def test_snapshot_only_before_app_writes(client, space, clock):
    original = (space.root / PAGE).read_bytes()
    assert _versions(client, PAGE) == []
    _save_body(client, PAGE, "First edit.\n")
    versions = _versions(client, PAGE)
    assert len(versions) == 1
    assert versions[0]["kind"] == "object" and versions[0]["number"] == 1
    assert versions[0]["title"] == "Source note"
    assert versions[0]["size"] == len(original)
    # The version holds the bytes from before the save.
    assert _content(client, PAGE, versions[0]["id"]) == decode(original).text

    clock.advance(minutes=4)
    _save_body(client, PAGE, "Second edit.\n")
    assert len(_versions(client, PAGE)) == 1  # inside 5 minutes: one typing session

    clock.advance(minutes=2)
    before_third = (space.root / PAGE).read_bytes()
    _save_body(client, PAGE, "Third edit.\n")
    versions = _versions(client, PAGE)
    assert len(versions) == 2
    assert _content(client, PAGE, versions[0]["id"]) == decode(before_third).text


def test_no_snapshot_on_create(client, space):
    r = client.post("/api/objects", json={"typeId": "page", "title": "Brand new"})
    assert r.status_code in (200, 201), r.text
    rel = r.json()["path"]
    assert _versions(client, rel) == []


def test_history_reads_write_nothing(client, space, clock):
    _save_body(client, PAGE, "An edit.\n")
    vid = _versions(client, PAGE)[0]["id"]
    space_before, state_before = _tree(space.root), _tree(_state())
    for _ in range(2):
        _versions(client, PAGE)
        _content(client, PAGE, vid)
        _versions(client, BOARD)
        client.get("/api/history", params={"path": "Pages/Day links.md"})
        client.get("/api/history/version", params={"path": PAGE, "id": "nope"})
    assert _tree(space.root) == space_before
    assert _tree(_state()) == state_before


def test_history_reads_create_no_state_folder(client, space):
    assert not (_state() / "history").exists()
    assert _versions(client, PAGE) == []
    assert not (_state() / "history").exists()


def test_history_lives_in_state_dir(client, space, clock):
    space_before = set(_tree(space.root))
    _save_body(client, PAGE, "An edit.\n")
    after = set(_tree(space.root))
    assert after == space_before  # only the object itself changed; nothing new in the space
    key_dir = (
        _state() / "history" / hashlib.sha1(str(space.root).encode()).hexdigest()[:16]
        / "01JC8M80000000000000000010"
    )
    index = json.loads((key_dir / "index.json").read_bytes())
    assert len(index) == 1
    entry = index[0]
    assert set(entry) >= {"id", "at", "rel", "files"}
    # The first version is stored whole, gzipped (audit 2026-11-01: cheap snapshots).
    assert entry["rel"] == PAGE and entry["files"] == [entry["id"] + ".md.gz"]
    assert (key_dir / entry["files"][0]).is_file()


def test_versions_numbered_oldest_first_listed_newest_first(client, space, clock):
    for i in range(3):
        _save_body(client, PAGE, f"Edit {i}.\n")
        clock.advance(minutes=6)
    versions = _versions(client, PAGE)
    assert [v["number"] for v in versions] == [3, 2, 1]
    ats = [v["at"] for v in versions]
    assert ats == sorted(ats, reverse=True)
    assert len({v["id"] for v in versions}) == 3


def test_prune_at_200(tmp_path, m8_space_dir):
    store = HistoryStore(m8_space_dir)
    data = (m8_space_dir / PAGE).read_bytes()
    first = None
    for i in range(MAX_VERSIONS + 1):
        vid = store.snapshot(PAGE, data + str(i).encode(), T0 + timedelta(minutes=6 * i))
        first = first or vid
    versions = store.versions(PAGE)
    assert len(versions) == MAX_VERSIONS
    assert first not in {v["id"] for v in versions}
    assert versions[-1]["number"] == 1
    assert store.content(PAGE, versions[-1]["id"])["text"].endswith("1")
    for v in versions:  # every kept version still reads back, deltas included
        assert store.content(PAGE, v["id"])["text"].endswith(str(v["number"]))
    folder = next((store.dir).iterdir())
    index = json.loads((folder / "index.json").read_bytes())
    assert len(index) == MAX_VERSIONS
    stored = {name for e in index for name in e["files"]}
    assert {p.name for p in folder.iterdir()} == stored | {"index.json"}  # no orphan files


def test_snapshot_parses_once_and_reads_nothing_for_an_object(m8_space_dir, monkeypatch):
    """Audit 2026-11-01 B1: `snapshot` parsed the frontmatter 3x and read the file twice."""
    from objectapp import history

    store = HistoryStore(m8_space_dir)
    data = (m8_space_dir / PAGE).read_bytes()
    parses, reads = [], []
    real_fm_of, real_read = history._fm_of, history._read
    monkeypatch.setattr(history, "_fm_of", lambda d: parses.append(d) or real_fm_of(d))
    monkeypatch.setattr(history, "_read", lambda p: reads.append(p) or real_read(p))
    for i in range(3):
        vid = store.snapshot(PAGE, data + str(i).encode(), T0 + timedelta(minutes=6 * i))
        assert vid
    assert len(parses) == 3  # one per snapshot: the bytes being kept are the file's
    # The object file itself is never re-read (only the history's own files are).
    assert all(p.is_relative_to(store.dir) for p in reads)
    # A caller that already knows the id spares the parse too.
    parses.clear()
    object_id = parse_fm(split_object(decode(data).text).frontmatter_src)["id"]
    assert store.snapshot(PAGE, data, T0 + timedelta(minutes=30), object_id=object_id)
    assert parses == []
    assert len(store.versions(PAGE)) == 4  # all under one key


def test_a_save_through_the_space_hands_the_id_to_the_snapshot(client, space, monkeypatch):
    """Re-measured after the fix pass: the hook parsed the frontmatter once per rewritten file."""
    from objectapp import history

    parses = []
    real_fm_of = history._fm_of
    monkeypatch.setattr(history, "_fm_of", lambda d: parses.append(d) or real_fm_of(d))
    _save_body(client, PAGE, "Saved with the id known.\n")
    assert parses == []


def test_history_follows_rename_by_id(client, space, clock):
    _save_body(client, PAGE, "Before the rename.\n")
    clock.advance(minutes=6)
    r = client.post(
        "/api/object/rename",
        json={"path": PAGE, "title": "Renamed note", "baseVersion": _version(client, PAGE)},
    )
    assert r.status_code == 200, r.text
    new_rel = r.json()["path"]
    assert new_rel != PAGE
    versions = _versions(client, new_rel)
    assert len(versions) == 2  # the body save's and the rename's
    assert {v["title"] for v in versions} == {"Source note"}


def test_object_without_id_keyed_by_path(client, space, clock):
    rel = "Pages/No id.md"
    (space.root / rel).write_bytes(b"---\ntype: 'Page'\ntitle: No id\n---\n\nPlain.\n")
    space.rescan_file(rel)
    store = HistoryStore(space.root)
    vid = store.snapshot(rel, (space.root / rel).read_bytes(), T0)
    key = "path-" + hashlib.sha1(rel.encode()).hexdigest()[:16]
    assert (store.dir / key / f"{vid}.md.gz").is_file()
    # A stamped save inserts an id; the earlier version is still listed for the object.
    clock.advance(minutes=6)
    _save_body(client, rel, "Now with an id.\n")
    assert _fm(space.root, rel).get("id")
    versions = _versions(client, rel)
    assert len(versions) == 2
    assert versions[-1]["id"] == vid


# --- restore -------------------------------------------------------------------------------


def test_restore_puts_bytes_back(client, space, clock):
    original = (space.root / PAGE).read_bytes()
    _save_body(client, PAGE, "Changed.\n")
    vid = _versions(client, PAGE)[0]["id"]
    r = _restore(client, PAGE, vid, _version(client, PAGE))
    assert r.status_code == 200, r.text
    assert (space.root / PAGE).read_bytes() == original
    assert r.json() == {"version": version_of(original)}
    assert _version(client, PAGE) == version_of(original)


def test_restore_keeps_current_as_version(client, space, clock):
    _save_body(client, PAGE, "Changed.\n")
    changed = (space.root / PAGE).read_bytes()
    vid = _versions(client, PAGE)[0]["id"]
    clock.advance(minutes=1)  # inside 5 minutes: the restore keeps the current state anyway
    r = _restore(client, PAGE, vid, version_of(changed))
    assert r.status_code == 200, r.text
    versions = _versions(client, PAGE)
    assert len(versions) == 2
    assert _content(client, PAGE, versions[0]["id"]) == decode(changed).text


def test_restore_keeps_title_and_id(client, space, clock):
    _save_body(client, PAGE, "Changed.\n")
    vid = _versions(client, PAGE)[0]["id"]
    clock.advance(minutes=6)
    r = client.post(
        "/api/object/rename",
        json={"path": PAGE, "title": "New name", "baseVersion": _version(client, PAGE)},
    )
    new_rel = r.json()["path"]
    full = space.root / new_rel
    r = _restore(client, new_rel, vid, _version(client, new_rel))
    assert r.status_code == 200, r.text
    fm = _fm(space.root, new_rel)
    assert fm["title"] == "New name"
    assert fm["id"] == "01JC8M80000000000000000010"
    assert (space.root / new_rel).is_file() and not (space.root / PAGE).exists()
    text = decode(full.read_bytes()).text
    assert "The referenced block lives here." in text  # the old body is back


def test_keep_identity_replaces_only_id_and_title_lines():
    old = b"---\r\nid: OLD\r\ntitle: Old\r\nother: 1\r\n---\r\n\r\nOld body.\r\n"
    current = b"---\nid: NEW\ntitle: New\nother: 2\n---\n\nNew body.\n"
    assert keep_identity(old, current) == (
        b"---\r\nid: NEW\r\ntitle: New\r\nother: 1\r\n---\r\n\r\nOld body.\r\n"
    )
    assert keep_identity(old, old) == old


def test_restore_stale_409(client, space, clock):
    _save_body(client, PAGE, "Changed.\n")
    vid = _versions(client, PAGE)[0]["id"]
    before = (space.root / PAGE).read_bytes()
    state_before = _tree(_state())
    r = _restore(client, PAGE, vid, "stale")
    assert r.status_code == 409
    assert r.json()["currentVersion"] == version_of(before)
    assert (space.root / PAGE).read_bytes() == before
    assert _tree(_state()) == state_before


def test_restore_unknown_404(client, space):
    assert _restore(client, PAGE, "nope", _version(client, PAGE)).status_code == 404
    assert client.get("/api/history", params={"path": "Pages/Nothing.md"}).status_code == 404
    assert (
        client.get("/api/history/version", params={"path": PAGE, "id": "nope"}).status_code
        == 404
    )


def test_restore_crlf_bom_kept(client, space, clock):
    original = (space.root / CRLF).read_bytes()
    assert original.startswith(b"\xef\xbb\xbf") and b"\r\n" in original
    _save_body(client, CRLF, "Changed body.\n")
    vid = _versions(client, CRLF)[0]["id"]
    clock.advance(minutes=6)
    r = client.post(
        "/api/object/rename",
        json={"path": CRLF, "title": "CRLF renamed", "baseVersion": _version(client, CRLF)},
    )
    rel = r.json()["path"]
    r = _restore(client, rel, vid, _version(client, rel))
    assert r.status_code == 200, r.text
    data = (space.root / rel).read_bytes()
    assert data.startswith(b"\xef\xbb\xbf")
    assert b"\n" not in data.replace(b"\r\n", b"")
    # Only the title line differs from the original bytes.
    assert data == original.replace(b"title: CRLF M8\r\n", b"title: CRLF renamed\r\n")


# --- whiteboards ---------------------------------------------------------------------------


def test_board_and_ink_snapshots_and_restore(client, space, clock):
    board_before = (space.root / BOARD_JSON).read_bytes()
    ink_before = (space.root / INK).read_bytes()
    current = _board(client)
    board = current["board"]
    board["nodes"].pop(next(iter(board["nodes"])))
    r = client.put(
        "/api/whiteboard", json={"path": BOARD, "board": board, "baseRevision": current["revision"]}
    )
    assert r.status_code == 200, r.text
    clock.advance(minutes=6)
    ink = client.get("/api/whiteboard/ink", params={"path": BOARD}).json()
    r = client.put(
        "/api/whiteboard/ink",
        json={"path": BOARD, "strokes": [], "baseRevision": ink["revision"]},
    )
    assert r.status_code == 200, r.text
    versions = _versions(client, BOARD)
    assert len(versions) == 2
    assert {v["kind"] for v in versions} == {"whiteboard"}
    oldest = versions[-1]
    assert _content(client, BOARD, oldest["id"]) is None

    board_rev = _board(client)["revision"]
    r = _restore(client, BOARD, oldest["id"], board_rev)
    assert r.status_code == 200, r.text
    assert (space.root / BOARD_JSON).read_bytes() == board_before
    assert (space.root / INK).read_bytes() == ink_before
    assert r.json() == {
        "revision": version_of(board_before),
        "version": version_of((space.root / BOARD).read_bytes()),
    }
    assert len(_versions(client, BOARD)) == 3  # the state before the restore was kept

    assert _restore(client, BOARD, oldest["id"], "stale").status_code == 409


# --- other writers -------------------------------------------------------------------------


def test_relink_and_property_writes_snapshot_referrers(client, space, clock):
    source = "Pages/Merge source.md"
    referrer = "Pages/Refers to source.md"
    referrer_before = (space.root / referrer).read_bytes()
    r = client.post(
        "/api/object/rename",
        json={"path": source, "title": "Merge origin", "baseVersion": _version(client, source)},
    )
    assert r.status_code == 200, r.text
    assert referrer in r.json()["relinked"]
    versions = _versions(client, referrer)
    assert len(versions) == 1
    assert _content(client, referrer, versions[0]["id"]) == decode(referrer_before).text

    other = "Pages/Day links.md"
    r = client.put(
        "/api/object/properties",
        json={"path": other, "updates": {"description": "Now described"}, "baseVersion": _version(client, other)},
    )
    assert r.status_code == 200, r.text
    assert len(_versions(client, other)) == 1


def test_hook_failure_never_stops_a_write(client, space, monkeypatch):
    def boom(rel, data, object_id=None):
        raise OSError("disk full")

    space.before_write = boom
    _save_body(client, PAGE, "Still saved.\n")
    assert "Still saved." in (space.root / PAGE).read_text(encoding="utf-8")
