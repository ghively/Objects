"""Audit 2026-11-01 (whiteboard back end): sidecar BOM/CRLF kept; a board whose ``.md`` is
malformed or untyped still opens (read-only) when its ``<stem>.whiteboard.json`` is intact.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from objectapp import whiteboardstore as ws
from objectapp.space import Space
from objectapp.whiteboardapi import whiteboard_router
from objectapp.whiteboardfile import board_rel, encode_like_sidecar, ink_rel, load_board
from objectapp.whiteboardink import load_ink
from wb_support import copy_whiteboard_space, tree_hashes

NETWORK = "Whiteboards/Network map.md"
BOM = b"\xef\xbb\xbf"
T0 = datetime(2026, 10, 28, 12, 0, 0, tzinfo=UTC)


@pytest.fixture
def ctx(tmp_path: Path):
    root = copy_whiteboard_space(tmp_path)
    space = Space(root)
    space.clock = lambda: T0
    app = FastAPI()
    app.include_router(whiteboard_router(space, lambda _e: None))
    return space, TestClient(app, raise_server_exceptions=False), root


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stroke(sid: str = "s1") -> dict:
    return {"id": sid, "tool": "pen", "color": "#112233", "width": 2, "points": [[1, 2, 0.5]], "d": "M1 2"}


# -- sidecar BOM and CRLF are kept ---------------------------------------------------------


def test_encode_like_sidecar():
    assert encode_like_sidecar(None, b"{\n}\n") == b"{\n}\n"
    assert encode_like_sidecar(b"{}", b"{\n}\n") == b"{\n}\n"
    assert encode_like_sidecar(b"{\r\n}", b"{\n}\n") == b"{\r\n}\r\n"
    assert encode_like_sidecar(BOM + b"{}", b"{\n}\n") == BOM + b"{\n}\n"
    assert encode_like_sidecar(BOM + b"{\r\n}", b"{\n}\n") == BOM + b"{\r\n}\r\n"


def test_board_sidecar_keeps_bom_and_crlf(ctx):
    _space, client, root = ctx
    sidecar = root / board_rel(NETWORK)
    sidecar.write_bytes(BOM + sidecar.read_bytes().replace(b"\n", b"\r\n"))
    res = client.get("/api/whiteboard", params={"path": NETWORK}).json()
    assert "readOnlyReason" not in res
    board = res["board"]
    board["nodes"]["n-text"]["position"]["x"] = 61
    saved = client.put(
        "/api/whiteboard", json={"path": NETWORK, "board": board, "baseRevision": res["revision"]}
    )
    assert saved.status_code == 200, saved.text
    out = sidecar.read_bytes()
    assert out.startswith(BOM)
    assert b"\r\n" in out and b"\n" not in out.replace(b"\r\n", b"")
    assert saved.json()["revision"] == sha(out)  # the revision is of the bytes written
    reloaded, reason = load_board(out)
    assert reason is None and reloaded["nodes"]["n-text"]["position"]["x"] == 61


def test_ink_sidecar_keeps_bom_and_crlf(ctx):
    _space, client, root = ctx
    sidecar = root / ink_rel(NETWORK)
    sidecar.write_bytes(BOM + sidecar.read_bytes().replace(b"\n", b"\r\n"))
    res = client.get("/api/whiteboard/ink", params={"path": NETWORK}).json()
    assert "readOnlyReason" not in res, res
    strokes = [*res["strokes"], stroke("s-new")]
    saved = client.put(
        "/api/whiteboard/ink", json={"path": NETWORK, "strokes": strokes, "baseRevision": res["revision"]}
    )
    assert saved.status_code == 200, saved.text
    out = sidecar.read_bytes()
    assert out.startswith(BOM) and b"\r\n" in out
    assert saved.json()["revision"] == sha(out)
    reloaded, reason = load_ink(out)
    assert reason is None and [s["id"] for s in reloaded][-1] == "s-new"


# -- a board whose .md is malformed or untyped is served read-only ---------------------------

MALFORMED = "---\nid: 01JBW6WB000000000000000001\ntype: 'Whiteboard'\ntitle: [unclosed\n---\n"
NO_FRONTMATTER = "Just a body, no frontmatter.\n"


@pytest.mark.parametrize("content", [MALFORMED, NO_FRONTMATTER], ids=["malformed", "none"])
def test_board_with_unreadable_md_opens_read_only(ctx, content: str):
    space, client, root = ctx
    (root / NETWORK).write_text(content, encoding="utf-8")
    space = Space(root)
    space.clock = lambda: T0
    app = FastAPI()
    app.include_router(whiteboard_router(space, lambda _e: None))
    client = TestClient(app, raise_server_exceptions=False)
    before = tree_hashes(root)

    res = client.get("/api/whiteboard", params={"path": NETWORK})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["readOnlyReason"] and "read-only" in body["readOnlyReason"]
    assert "n-text" in body["board"]["nodes"]  # the canvas is intact
    ink = client.get("/api/whiteboard/ink", params={"path": NETWORK})
    assert ink.status_code == 200 and ink.json()["readOnlyReason"]
    assert ink.json()["strokes"]

    board = body["board"]
    board["nodes"]["n-text"]["position"]["x"] = 61
    saved = client.put(
        "/api/whiteboard", json={"path": NETWORK, "board": board, "baseRevision": body["revision"]}
    )
    assert saved.status_code == 423, saved.text
    assert saved.json()["reason"] == body["readOnlyReason"]
    strokes = client.put(
        "/api/whiteboard/ink",
        json={"path": NETWORK, "strokes": [stroke()], "baseRevision": ink.json()["revision"]},
    )
    assert strokes.status_code == 423
    assert tree_hashes(root) == before  # nothing written


def test_untyped_object_without_a_sidecar_is_still_422(ctx):
    space, client, root = ctx
    (root / "Whiteboards" / "Loose.md").write_text(NO_FRONTMATTER, encoding="utf-8")
    space.rescan_file("Whiteboards/Loose.md")
    res = client.get("/api/whiteboard", params={"path": "Whiteboards/Loose.md"})
    assert res.status_code == 422
    with pytest.raises(ws.NotAWhiteboard):
        ws.read_board(space, "Whiteboards/Loose.md")
