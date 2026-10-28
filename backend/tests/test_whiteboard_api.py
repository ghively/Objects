"""M6 Task 3: the whiteboard store, the Whiteboard type and the routes (`whiteboardapi`).

The router is mounted on a bare `FastAPI()` so nothing here depends on `server.py`.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from objectapp import whiteboardstore
from objectapp.space import Space, version_of
from objectapp.typemodel import TypeDefinition
from objectapp.whiteboardapi import whiteboard_router
from objectapp.whiteboardfile import NEWER_VERSION_REASON, dump_board, empty_board
from objectapp.whiteboardink import INK_READ_ONLY_REASON, dump_ink
from objectapp.whiteboardstore import (
    BoardConflict,
    save_board,
    whiteboard_type_json,
    whiteboard_ui_problem,
)
from wb_support import FIXTURE, copy_whiteboard_space, tree_hashes

NETWORK = "Whiteboards/Network map.md"
EMPTY = "Whiteboards/Empty board.md"
BROKEN = "Whiteboards/Broken board.md"
FUTURE = "Whiteboards/Future board.md"
FOREIGN = "Whiteboards/Foreign ink.md"
DOTTED = "Whiteboards/Dotted v1.2 plan.md"
BOARDS = [NETWORK, EMPTY, BROKEN, FUTURE, FOREIGN, DOTTED]

STROKES = [
    {
        "id": "s1",
        "tool": "pen",
        "color": "#3f80eb",
        "width": 4,
        "points": [[10.5, 20.25, 0.2], [30, 40, 0.555], [50, 60, 1]],
        "d": "M 10 20 L 30 40 L 50 60 Z",
    },
    {
        "id": "s2",
        "tool": "highlighter",
        "color": "#daaa14",
        "width": 16,
        "points": [[100, 100, 0.5], [200, 120, 0.5]],
        "d": "M100,92L200,112L200,128L100,108Z",
    },
]


def small_board(text: str = "Hello") -> dict:
    return {
        "version": 1,
        "nodes": {
            "n1": {
                "id": "n1",
                "kind": "block",
                "blockId": "b1",
                "position": {"x": 30, "y": 60},
                "width": 420,
                "height": 60,
                "x-future": {"kept": True},
            }
        },
        "edges": {},
        "blocks": {"b1": {"type": "text", "markdown": text}},
    }


@pytest.fixture
def wb_dir(tmp_path):
    return copy_whiteboard_space(tmp_path)


@pytest.fixture
def ctx(wb_dir):
    space = Space(wb_dir)
    events: list = []
    app = FastAPI()
    app.include_router(whiteboard_router(space, events.append))
    return space, TestClient(app), events, wb_dir


def rev_of(path: Path) -> str:
    return version_of(path.read_bytes())


def board_file(root: Path, md: str) -> Path:
    return root / (md[: -len(".md")] + ".whiteboard.json")


def ink_file(root: Path, md: str) -> Path:
    return root / (md[: -len(".md")] + ".ink.svg")


# --- mounting and reading ------------------------------------------------------------------


def test_router_mounts_standalone(ctx):
    space, client, _events, _root = ctx
    router = whiteboard_router(space, lambda _e: None)
    routes = {(r.path, m) for r in router.routes for m in r.methods}
    assert routes == {
        ("/api/whiteboard", "GET"),
        ("/api/whiteboard", "PUT"),
        ("/api/whiteboard/ink", "GET"),
        ("/api/whiteboard/ink", "PUT"),
        ("/api/whiteboards", "POST"),
    }
    assert client.get("/api/whiteboard", params={"path": NETWORK}).status_code == 200


def test_get_board_writes_nothing(ctx):
    _space, client, events, root = ctx
    before = tree_hashes(root)
    for path in BOARDS:
        r = client.get("/api/whiteboard", params={"path": path})
        assert r.status_code == 200, (path, r.text)
        assert r.json()["path"] == path
    assert tree_hashes(root) == before
    assert events == []
    body = client.get("/api/whiteboard", params={"path": NETWORK}).json()
    assert body["revision"] == rev_of(board_file(root, NETWORK))
    assert "readOnlyReason" not in body
    assert body["board"]["x-future"] == 1
    assert len(body["board"]["nodes"]) > 20


def test_get_missing_board_returns_empty_and_creates_nothing(ctx):
    _space, client, _events, root = ctx
    before = tree_hashes(root)
    body = client.get("/api/whiteboard", params={"path": EMPTY}).json()
    assert body == {"path": EMPTY, "board": empty_board(), "revision": ""}
    ink = client.get("/api/whiteboard/ink", params={"path": EMPTY}).json()
    assert ink == {"path": EMPTY, "strokes": [], "revision": ""}
    assert not board_file(root, EMPTY).exists()
    assert not ink_file(root, EMPTY).exists()
    assert tree_hashes(root) == before


def test_get_ink_writes_nothing(ctx):
    _space, client, _events, root = ctx
    before = tree_hashes(root)
    for path in BOARDS:
        assert (
            client.get("/api/whiteboard/ink", params={"path": path}).status_code == 200
        )
    body = client.get("/api/whiteboard/ink", params={"path": NETWORK}).json()
    assert len(body["strokes"]) == 4
    assert body["revision"] == rev_of(ink_file(root, NETWORK))
    assert "readOnlyReason" not in body
    assert tree_hashes(root) == before


def test_get_unreadable_board_has_reason(ctx):
    _space, client, _events, root = ctx
    broken = client.get("/api/whiteboard", params={"path": BROKEN}).json()
    assert broken["board"] == empty_board()
    assert broken["readOnlyReason"].startswith("This whiteboard's file can't be read")
    assert broken["revision"] == rev_of(board_file(root, BROKEN))
    future = client.get("/api/whiteboard", params={"path": FUTURE}).json()
    assert future["board"] == empty_board()
    assert future["readOnlyReason"] == NEWER_VERSION_REASON


def test_get_foreign_ink_has_reason(ctx):
    _space, client, _events, root = ctx
    body = client.get("/api/whiteboard/ink", params={"path": FOREIGN}).json()
    assert body["strokes"] == []
    assert body["readOnlyReason"] == INK_READ_ONLY_REASON
    assert body["revision"] == rev_of(ink_file(root, FOREIGN))


# --- saving --------------------------------------------------------------------------------


def test_save_board_writes_only_its_file(ctx):
    _space, client, _events, root = ctx
    before = tree_hashes(root)
    base = rev_of(board_file(root, NETWORK))
    board = client.get("/api/whiteboard", params={"path": NETWORK}).json()["board"]
    board["nodes"]["moved"] = {
        "id": "moved",
        "kind": "point",
        "position": {"x": 1, "y": 2},
    }
    r = client.put(
        "/api/whiteboard", json={"path": NETWORK, "board": board, "baseRevision": base}
    )
    assert r.status_code == 200, r.text
    after = tree_hashes(root)
    changed = {k for k in before.keys() | after.keys() if before.get(k) != after.get(k)}
    # M9 Task 5: the board's .md gets a new lastUpdated stamp (see test_whiteboard_m9).
    assert changed == {"Whiteboards/Network map.whiteboard.json", NETWORK}
    data = board_file(root, NETWORK).read_bytes()
    assert data == dump_board(board)
    assert r.json() == {"revision": version_of(data), "mdVersion": rev_of(root / NETWORK)}


def test_md_bytes_never_change_on_board_save(ctx):
    """Regression guard: green as soon as saving works; listed for the review.

    M9 Task 5: only the .md's lastUpdated line changes, once within a minute.
    """
    _space, client, _events, root = ctx
    md = (root / EMPTY).read_bytes()
    r = client.put(
        "/api/whiteboard",
        json={"path": EMPTY, "board": small_board(), "baseRevision": ""},
    )
    assert r.status_code == 200
    rev = r.json()["revision"]
    r = client.put(
        "/api/whiteboard",
        json={"path": EMPTY, "board": small_board("Two"), "baseRevision": rev},
    )
    assert r.status_code == 200
    r = client.put(
        "/api/whiteboard/ink",
        json={"path": EMPTY, "strokes": STROKES, "baseRevision": ""},
    )
    assert r.status_code == 200
    old_lines = md.splitlines(keepends=True)
    new_lines = (root / EMPTY).read_bytes().splitlines(keepends=True)
    differ = [i for i, (a, b) in enumerate(zip(old_lines, new_lines, strict=True)) if a != b]
    assert len(differ) == 1 and new_lines[differ[0]].startswith(b"lastUpdated: ")
    assert r.json()["mdVersion"] == rev_of(root / EMPTY)


def test_save_stale_revision_409_nothing_written(ctx):
    _space, client, events, root = ctx
    before = tree_hashes(root)
    current = rev_of(board_file(root, NETWORK))
    r = client.put(
        "/api/whiteboard",
        json={"path": NETWORK, "board": small_board(), "baseRevision": "0" * 64},
    )
    assert r.status_code == 409
    assert r.json() == {"currentRevision": current}
    r = client.put(
        "/api/whiteboard/ink",
        json={"path": NETWORK, "strokes": STROKES, "baseRevision": "0" * 64},
    )
    assert r.status_code == 409
    assert r.json() == {"currentRevision": rev_of(ink_file(root, NETWORK))}
    assert tree_hashes(root) == before
    assert events == []


def test_create_requires_empty_base(ctx):
    _space, client, _events, root = ctx
    before = tree_hashes(root)
    # '' on an existing file: the file must not exist yet.
    r = client.put(
        "/api/whiteboard",
        json={"path": NETWORK, "board": small_board(), "baseRevision": ""},
    )
    assert r.status_code == 409
    assert r.json()["currentRevision"] == rev_of(board_file(root, NETWORK))
    # A non-empty base on a missing file.
    r = client.put(
        "/api/whiteboard",
        json={"path": EMPTY, "board": small_board(), "baseRevision": "a" * 64},
    )
    assert r.status_code == 409
    assert r.json() == {"currentRevision": ""}
    r = client.put(
        "/api/whiteboard/ink",
        json={"path": EMPTY, "strokes": STROKES, "baseRevision": "a" * 64},
    )
    assert r.status_code == 409
    assert tree_hashes(root) == before
    # '' on a missing file creates it.
    r = client.put(
        "/api/whiteboard",
        json={"path": EMPTY, "board": small_board(), "baseRevision": ""},
    )
    assert r.status_code == 200
    assert board_file(root, EMPTY).read_bytes() == dump_board(small_board())


def test_save_invalid_422_nothing_written(ctx):
    _space, client, events, root = ctx
    before = tree_hashes(root)
    bad = small_board()
    bad["edges"]["e1"] = {"id": "e1", "source": "n1", "target": "nope"}
    r = client.put(
        "/api/whiteboard", json={"path": EMPTY, "board": bad, "baseRevision": ""}
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "Edge e1 points to a node that doesn't exist."
    r = client.put(
        "/api/whiteboard", json={"path": EMPTY, "board": [1, 2], "baseRevision": ""}
    )
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str)
    bad_ink = [dict(STROKES[0], color="blue")]
    r = client.put(
        "/api/whiteboard/ink",
        json={"path": EMPTY, "strokes": bad_ink, "baseRevision": ""},
    )
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str)
    assert tree_hashes(root) == before
    assert events == []


def test_save_over_unreadable_423_file_untouched(ctx):
    _space, client, events, root = ctx
    before = tree_hashes(root)
    for md in (BROKEN, FUTURE):
        rev = rev_of(board_file(root, md))
        for base in (rev, ""):
            r = client.put(
                "/api/whiteboard",
                json={"path": md, "board": small_board(), "baseRevision": base},
            )
            assert r.status_code == 423, (md, r.text)
            assert r.json()["reason"]
            assert r.json()["detail"] == r.json()["reason"]
    rev = rev_of(ink_file(root, FOREIGN))
    r = client.put(
        "/api/whiteboard/ink",
        json={"path": FOREIGN, "strokes": STROKES, "baseRevision": rev},
    )
    assert r.status_code == 423
    assert r.json()["reason"] == INK_READ_ONLY_REASON
    assert tree_hashes(root) == before
    assert events == []


def test_save_is_atomic_temp_then_replace(ctx, monkeypatch):
    space, _client, _events, root = ctx
    target = board_file(root, NETWORK)
    old = target.read_bytes()

    def boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        save_board(space, NETWORK, small_board(), version_of(old))
    monkeypatch.undo()
    assert target.read_bytes() == old
    leftovers = [p.name for p in target.parent.iterdir() if p.name.endswith(".tmp")]
    assert leftovers == []
    assert "Whiteboards/Network map.whiteboard.json" not in space.own_writes


def test_own_writes_recorded(ctx):
    space, client, _events, root = ctx
    r = client.put(
        "/api/whiteboard",
        json={"path": EMPTY, "board": small_board(), "baseRevision": ""},
    )
    assert (
        space.own_writes["Whiteboards/Empty board.whiteboard.json"]
        == r.json()["revision"]
    )
    r = client.put(
        "/api/whiteboard/ink",
        json={"path": EMPTY, "strokes": STROKES, "baseRevision": ""},
    )
    assert space.own_writes["Whiteboards/Empty board.ink.svg"] == r.json()["revision"]
    assert r.json()["revision"] == rev_of(ink_file(root, EMPTY))


def test_announces_whiteboard_event_with_origin(ctx):
    _space, client, events, _root = ctx
    r = client.put(
        "/api/whiteboard",
        json={
            "path": EMPTY,
            "board": small_board(),
            "baseRevision": "",
            "clientId": "c-1",
        },
    )
    r2 = client.put(
        "/api/whiteboard/ink",
        json={"path": EMPTY, "strokes": STROKES, "baseRevision": "", "clientId": "c-2"},
    )
    # M9 Task 5: the first save also stamps the .md (announced `changed`); the second,
    # within a minute, leaves it alone.
    assert [(e.kind, e.path, e.version, e.origin) for e in events] == [
        ("whiteboard", EMPTY, r.json()["revision"], "c-1"),
        ("changed", EMPTY, r.json()["mdVersion"], "c-1"),
        ("whiteboard", EMPTY, r2.json()["revision"], "c-2"),
    ]


def test_ink_save_and_get_round_trip(ctx):
    _space, client, _events, root = ctx
    r = client.put(
        "/api/whiteboard/ink",
        json={"path": EMPTY, "strokes": STROKES, "baseRevision": ""},
    )
    assert r.status_code == 200, r.text
    assert ink_file(root, EMPTY).read_bytes() == dump_ink(STROKES)
    body = client.get("/api/whiteboard/ink", params={"path": EMPTY}).json()
    assert body["revision"] == r.json()["revision"]
    got = [
        {k: s[k] for k in ("id", "tool", "color", "width", "points", "d")}
        for s in body["strokes"]
    ]
    assert got == STROKES
    # Zero strokes write the empty SVG; the file is never deleted by a save.
    r = client.put(
        "/api/whiteboard/ink",
        json={"path": EMPTY, "strokes": [], "baseRevision": body["revision"]},
    )
    assert r.status_code == 200
    assert ink_file(root, EMPTY).read_bytes() == dump_ink([])


def test_not_a_whiteboard_422(ctx):
    _space, client, _events, root = ctx
    before = tree_hashes(root)
    page = "Pages/Router A.md"
    assert client.get("/api/whiteboard", params={"path": page}).status_code == 422
    assert client.get("/api/whiteboard/ink", params={"path": page}).status_code == 422
    r = client.put(
        "/api/whiteboard",
        json={"path": page, "board": small_board(), "baseRevision": ""},
    )
    assert r.status_code == 422
    r = client.put(
        "/api/whiteboard/ink",
        json={"path": page, "strokes": STROKES, "baseRevision": ""},
    )
    assert r.status_code == 422
    assert (
        client.get("/api/whiteboard", params={"path": "Pages/Nope.md"}).status_code
        == 404
    )
    r = client.put(
        "/api/whiteboard",
        json={"path": "Pages/Nope.md", "board": small_board(), "baseRevision": ""},
    )
    assert r.status_code == 404
    assert tree_hashes(root) == before


def test_outside_space_400(ctx):
    _space, client, _events, root = ctx
    before = tree_hashes(root)
    for path in (
        "../outside.md",
        "/etc/passwd.md",
        "Whiteboards/Network map.whiteboard.json",
    ):
        assert client.get("/api/whiteboard", params={"path": path}).status_code == 400
        assert (
            client.get("/api/whiteboard/ink", params={"path": path}).status_code == 400
        )
        r = client.put(
            "/api/whiteboard",
            json={"path": path, "board": small_board(), "baseRevision": ""},
        )
        assert r.status_code == 400
    assert tree_hashes(root) == before


# --- creating ------------------------------------------------------------------------------


def test_create_whiteboard_writes_md_only(ctx):
    _space, client, events, root = ctx
    before = tree_hashes(root)
    r = client.post(
        "/api/whiteboards", json={"title": "Office plan", "clientId": "c-9"}
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["path"] == "Whiteboards/Office plan.md"
    assert body["typeIds"] == []
    after = tree_hashes(root)
    assert set(after) - set(before) == {"Whiteboards/Office plan.md"}
    assert all(after[k] == v for k, v in before.items())
    text = (root / body["path"]).read_text(encoding="utf-8")
    assert "type: 'Whiteboard'" in text
    assert "title: Office plan" in text
    assert body["version"] == rev_of(root / body["path"])
    assert [(e.kind, e.path, e.origin) for e in events] == [
        ("created", body["path"], "c-9")
    ]
    # No title: "Untitled", as M1.
    r = client.post("/api/whiteboards", json={"title": "   "})
    assert r.status_code == 201
    assert r.json()["path"] == "Whiteboards/Untitled.md"


def test_create_whiteboard_persists_inferred_type_once(tmp_path):
    root = copy_whiteboard_space(tmp_path)
    (root / ".object" / "types" / "whiteboard.json").unlink()
    space = Space(root)
    events: list = []
    app = FastAPI()
    app.include_router(whiteboard_router(space, events.append))
    client = TestClient(app)
    type_file = root / ".object" / "types" / "whiteboard.json"

    r = client.post("/api/whiteboards", json={"title": "First", "clientId": "c"})
    assert r.status_code == 201, r.text
    assert r.json()["typeIds"] == ["whiteboard"]
    assert [(e.kind, e.path) for e in events] == [
        ("types", "whiteboard"),
        ("created", r.json()["path"]),
    ]
    stored = json.loads(type_file.read_text(encoding="utf-8"))
    assert stored["name"] == "Whiteboard"
    assert stored["icon"] == {"type": "iconify", "val": "ph-presentation"}
    assert stored["basic"] is True
    assert stored["wideLayoutMode"] is True
    first = type_file.read_bytes()

    r = client.post("/api/whiteboards", json={"title": "Second"})
    assert r.status_code == 201
    assert r.json()["typeIds"] == []
    assert type_file.read_bytes() == first


def test_create_whiteboard_in_space_without_any_whiteboard(tmp_path):
    root = copy_whiteboard_space(tmp_path)
    shutil.rmtree(root / "Whiteboards")
    (root / ".object" / "types" / "whiteboard.json").unlink()
    space = Space(root)
    assert whiteboardstore.whiteboard_type(space) is None
    before = tree_hashes(root)
    t = whiteboardstore.ensure_whiteboard_type(space)
    assert t.id == "whiteboard"
    assert tree_hashes(root) == before  # ensuring never writes
    path, _version, type_ids = whiteboardstore.create_whiteboard(space, "Fresh")
    assert path == "Whiteboards/Fresh.md"
    assert type_ids == ["whiteboard"]
    assert whiteboardstore.is_whiteboard(space, path)


def test_whiteboard_type_matches_reference():
    data = whiteboard_type_json()
    # basicStructures.ts RootWhiteboard: "Whiteboard" / "Whiteboards", ph-presentation,
    # labelColor 'neutral' (our gray), wideLayoutMode true.
    assert data["id"] == "whiteboard"
    assert data["name"] == "Whiteboard"
    assert data["pluralName"] == "Whiteboards"
    assert data["folder"] == "Whiteboards"
    assert data["icon"] == {"type": "iconify", "val": "ph-presentation"}
    assert data["color"] == "gray"
    assert data["basic"] is True
    assert data["wideLayoutMode"] is True
    assert [p["key"] for p in data["propertyDefinitions"]] == [
        "title",
        "description",
        "icon",
        "tags",
        "lastUpdated",
        "createdAt",
    ]
    fixture = json.loads(
        (FIXTURE / ".object" / "types" / "whiteboard.json").read_text(
            encoding="utf-8"
        )
    )
    assert (
        TypeDefinition.from_json(data).to_json()
        == TypeDefinition.from_json(fixture).to_json()
    )


def test_is_whiteboard(ctx):
    space, _client, _events, _root = ctx
    assert whiteboardstore.is_whiteboard(space, NETWORK)
    assert not whiteboardstore.is_whiteboard(space, "Pages/Router A.md")
    assert not whiteboardstore.is_whiteboard(space, "Pages/Nope.md")
    assert not whiteboardstore.is_whiteboard(space, "../x.md")


def test_whiteboard_ui_problem_shapes():
    assert whiteboard_ui_problem({}) is None
    assert (
        whiteboard_ui_problem({"isSnappingToGrid": False, "isEngineeringMode": True})
        is None
    )
    assert (
        whiteboard_ui_problem({k: True for k in whiteboardstore.WHITEBOARD_UI_KEYS})
        is None
    )
    message = "whiteboard must be an object of true/false settings."
    assert whiteboard_ui_problem(None) == message
    assert whiteboard_ui_problem([]) == message
    assert whiteboard_ui_problem({"isShowingDots": "yes"}) == message
    assert whiteboard_ui_problem({"isZoomingOnScroll": 1}) == message
    assert whiteboard_ui_problem({"gridSize": True}) == message


def test_concurrent_saves_one_wins(ctx):
    _space, _client, events, root = ctx
    base = rev_of(board_file(root, NETWORK))
    boards = [small_board("one"), small_board("two")]
    results: list = [None, None]
    barrier = threading.Barrier(2)

    def run(i: int) -> None:
        client = TestClient(_client.app)
        barrier.wait()
        results[i] = client.put(
            "/api/whiteboard",
            json={"path": NETWORK, "board": boards[i], "baseRevision": base},
        )

    threads = [threading.Thread(target=run, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 409]
    winner = next(i for i, r in enumerate(results) if r.status_code == 200)
    assert board_file(root, NETWORK).read_bytes() == dump_board(boards[winner])
    loser = results[1 - winner]
    assert loser.json() == {"currentRevision": results[winner].json()["revision"]}
    assert [e.kind for e in events] == ["whiteboard", "changed"]  # M9: the .md stamp


def test_store_conflict_carries_current_revision(ctx):
    space, _client, _events, root = ctx
    with pytest.raises(BoardConflict) as info:
        save_board(space, NETWORK, small_board(), "stale")
    assert info.value.current_revision == rev_of(board_file(root, NETWORK))
