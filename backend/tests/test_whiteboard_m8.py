"""M8 Task 20: whiteboard media and web-link blocks, and the entity block's optional ``view``.

The board file's ``blocks`` gain ``{"type": "media", "path": "Attachments/<file>"}`` and
``{"type": "weblink", "url": "https://…", "title"?: "…"}``. A media path must stay inside the
space (relative, no ``..``, no dot-folder); a web link must be ``http``/``https``. Web links
are never fetched: the board stores only what the user typed. Unknown keys are kept.
"""

from __future__ import annotations

import copy
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from objectapp.space import Space
from objectapp.whiteboardapi import whiteboard_router
from objectapp.whiteboardfile import (
    ENTITY_VIEWS,
    BoardInvalid,
    dump_board,
    load_board,
    validate_board,
)
from objectapp.whiteboardtrash import board_links, board_text
from wb_support import copy_whiteboard_space, tree_hashes

EMPTY = "Whiteboards/Empty board.md"


def media_board() -> dict:
    return {
        "version": 1,
        "nodes": {
            "m1": {
                "id": "m1",
                "kind": "block",
                "blockId": "bm1",
                "position": {"x": 0, "y": 0},
                "width": 420,
                "height": 300,
                "headless": True,
            },
            "w1": {
                "id": "w1",
                "kind": "block",
                "blockId": "bw1",
                "position": {"x": 0, "y": 360},
                "width": 360,
                "height": 90,
            },
            "w2": {
                "id": "w2",
                "kind": "block",
                "blockId": "bw2",
                "position": {"x": 0, "y": 480},
            },
            "e1": {
                "id": "e1",
                "kind": "block",
                "blockId": "be1",
                "position": {"x": 600, "y": 0},
            },
        },
        "edges": {},
        "blocks": {
            "bm1": {"type": "media", "path": "Attachments/diagram.png"},
            "bw1": {
                "type": "weblink",
                "url": "https://example.org/guide",
                "title": "The guide",
            },
            "bw2": {"type": "weblink", "url": "http://example.com/plain"},
            "be1": {"type": "entity", "link": "[[Router A]]", "view": "wideCard"},
        },
    }


@pytest.fixture
def ctx(tmp_path):
    root = copy_whiteboard_space(tmp_path)
    space = Space(root)
    events: list = []
    app = FastAPI()
    app.include_router(whiteboard_router(space, events.append))
    return space, TestClient(app), events, root


# --- validation ------------------------------------------------------------------------------


def test_media_and_weblink_blocks_validate():
    board = media_board()
    validate_board(board)
    loaded, reason = load_board(dump_board(board))
    assert reason is None
    assert loaded == board
    # Every media kind is just a path: the kind comes from the extension, as for attachments.
    for path in (
        "Attachments/report.pdf",
        "Attachments/voice memo.m4a",
        "Attachments/clip.mp4",
        "Attachments/archive.zip",
        "Attachments/sub/folder/x.png",
        "Files/notes.txt",
    ):
        b = media_board()
        b["blocks"]["bm1"]["path"] = path
        validate_board(b)
    # The entity block's optional view: Link block / Small card / Wide card / Embed.
    assert ENTITY_VIEWS == frozenset({"inline", "smallCard", "wideCard", "embed"})
    for view in sorted(ENTITY_VIEWS):
        b = media_board()
        b["blocks"]["be1"]["view"] = view
        validate_board(b)
    b = media_board()
    del b["blocks"]["be1"]["view"]
    validate_board(b)
    for bad_view in ("card", "", 3, None):
        b = media_board()
        b["blocks"]["be1"]["view"] = bad_view
        with pytest.raises(BoardInvalid):
            validate_board(b)
    # A web link title must be text; a media block must have a path.
    b = media_board()
    b["blocks"]["bw1"]["title"] = 5
    with pytest.raises(BoardInvalid):
        validate_board(b)
    b = media_board()
    del b["blocks"]["bm1"]["path"]
    with pytest.raises(BoardInvalid):
        validate_board(b)


@pytest.mark.parametrize(
    "path",
    [
        "",
        "/etc/passwd",
        "\\\\server\\share\\x.png",
        "C:/Users/x.png",
        "c:\\x.png",
        "../outside.png",
        "Attachments/../../outside.png",
        "Attachments/..",
        "Attachments\\..\\..\\x.png",
        "./Attachments/x.png",
        ".object/trash/x.png",
        "Attachments/.hidden/x.png",
        "Attachments/",
        "Attachments//x.png",
        "file:///etc/passwd",
        "https://example.org/x.png",
        "Attachments/x\x00.png",
    ],
)
def test_media_path_outside_space_422(ctx, path):
    _space, client, events, root = ctx
    before = tree_hashes(root)
    board = media_board()
    board["blocks"]["bm1"]["path"] = path
    with pytest.raises(BoardInvalid):
        validate_board(board)
    r = client.put("/api/whiteboard", json={"path": EMPTY, "board": board, "baseRevision": ""})
    assert r.status_code == 422, r.text
    assert isinstance(r.json()["detail"], str)
    assert tree_hashes(root) == before
    assert events == []


@pytest.mark.parametrize(
    "url",
    [
        "",
        "example.org",
        "ftp://example.org/x",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/html,hi",
        "mailto:a@example.org",
        "https://",
        "http:///path",
        "https://exa mple.org/",
        "https://example.org/\nx",
        42,
        None,
    ],
)
def test_non_http_weblink_422(ctx, url):
    _space, client, events, root = ctx
    before = tree_hashes(root)
    board = media_board()
    board["blocks"]["bw1"]["url"] = url
    with pytest.raises(BoardInvalid):
        validate_board(board)
    r = client.put("/api/whiteboard", json={"path": EMPTY, "board": board, "baseRevision": ""})
    assert r.status_code == 422, r.text
    assert tree_hashes(root) == before
    assert events == []


def test_weblink_schemes_are_case_insensitive_and_kept_as_typed():
    board = media_board()
    board["blocks"]["bw1"]["url"] = "HTTPS://Example.org/Path?q=1#frag"
    validate_board(board)
    loaded, reason = load_board(dump_board(board))
    assert reason is None
    assert loaded["blocks"]["bw1"]["url"] == "HTTPS://Example.org/Path?q=1#frag"


def test_unknown_keys_kept_with_media(ctx):
    _space, client, _events, root = ctx
    board = media_board()
    board["x-board-future"] = {"a": 1}
    board["nodes"]["m1"]["x-node-future"] = [1, 2]
    board["blocks"]["bm1"]["x-media-future"] = "kept"
    board["blocks"]["bm1"]["caption"] = "A caption"
    board["blocks"]["bw1"]["x-weblink-future"] = True
    board["blocks"]["be1"]["x-entity-future"] = 3
    expected = copy.deepcopy(board)
    r = client.put("/api/whiteboard", json={"path": EMPTY, "board": board, "baseRevision": ""})
    assert r.status_code == 200, r.text
    on_disk = json.loads((root / "Whiteboards" / "Empty board.whiteboard.json").read_text("utf-8"))
    assert on_disk == expected
    got = client.get("/api/whiteboard", params={"path": EMPTY}).json()
    assert got["board"] == expected
    assert "readOnlyReason" not in got


def test_board_text_includes_weblink_title():
    board = media_board()
    text = board_text(board)
    parts = text.split("\n\n")
    # Reading order: top-to-bottom, left-to-right; media blocks add no text.
    assert parts == [
        "The guide\nhttps://example.org/guide",
        "http://example.com/plain",
    ]
    assert "diagram.png" not in text
    # Media paths and web links are not object links; the entity block still is.
    assert board_links(board) == ["Router A"]


def test_board_with_media_opens_without_writing(ctx):
    _space, client, events, root = ctx
    r = client.put(
        "/api/whiteboard", json={"path": EMPTY, "board": media_board(), "baseRevision": ""}
    )
    assert r.status_code == 200
    events.clear()
    before = tree_hashes(root)
    for _ in range(2):
        assert client.get("/api/whiteboard", params={"path": EMPTY}).status_code == 200
    assert tree_hashes(root) == before
    assert events == []
