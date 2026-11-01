"""Whiteboard back-end audit repros (read-only audit; runs on a copy of space-whiteboard)."""
from __future__ import annotations

import json
import shutil
import sys
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, "/home/user/Objects/backend/tests")
from wb_support import copy_whiteboard_space  # noqa: E402

from objectapp.space import Space  # noqa: E402
from objectapp import whiteboardstore as ws  # noqa: E402
from objectapp.whiteboardfile import board_rel, ink_rel, load_board  # noqa: E402

NETWORK = "Whiteboards/Network map.md"
EMPTY = "Whiteboards/Empty board.md"
T0 = datetime(2026, 10, 28, 12, 0, 0, tzinfo=UTC)


@pytest.fixture
def root(tmp_path):
    return copy_whiteboard_space(tmp_path)


def mk(root, now=T0):
    s = Space(root)
    s.clock = lambda: now
    return s


def small(text="Hello"):
    return {
        "version": 1,
        "nodes": {"n1": {"id": "n1", "kind": "block", "blockId": "b1", "position": {"x": 30.5, "y": 60}}},
        "edges": {},
        "blocks": {"b1": {"type": "text", "markdown": text}},
    }


# --- 1. the .md stamp against odd frontmatter / line endings -------------------------------

@pytest.mark.parametrize(
    "name,content",
    [
        ("crlf", "---\r\nid: 01JBW6WB000000000000000006\r\ntype: 'Whiteboard'\r\ntitle: Empty board\r\ncreatedAt: 2026-10-20T09:00:00.000Z\r\nlastUpdated: 2026-10-20T09:00:00.000Z\r\n---\r\n\r\nbody\r\n"),
        ("bom", "﻿---\nid: 01JBW6WB000000000000000006\ntype: 'Whiteboard'\ntitle: Empty board\nlastUpdated: 2026-10-20T09:00:00.000Z\n---\n"),
        ("no-lastupdated", "---\nid: 01JBW6WB000000000000000006\ntype: 'Whiteboard'\ntitle: Empty board\n---\nbody\n"),
        ("no-frontmatter", "Just a body\n"),
        ("flow-mapping", "---\n{id: 01JBW6WB000000000000000006, type: Whiteboard, title: Empty board, lastUpdated: 2026-10-20T09:00:00.000Z}\n---\n"),
        ("folded-lastupdated", "---\nid: 01JBW6WB000000000000000006\ntype: 'Whiteboard'\ntitle: Empty board\nlastUpdated: >\n  2026-10-20T09:00:00.000Z\n---\n"),
        ("dup-key", "---\nid: 01JBW6WB000000000000000006\ntype: 'Whiteboard'\ntitle: Empty board\nlastUpdated: 2026-10-20T09:00:00.000Z\nlastUpdated: 2026-10-21T09:00:00.000Z\n---\n"),
        ("malformed", "---\nid: 01JBW6WB000000000000000006\ntype: 'Whiteboard'\ntitle: [unclosed\nlastUpdated: 2026-10-20T09:00:00.000Z\n---\n"),
        ("future-stamp", "---\nid: 01JBW6WB000000000000000006\ntype: 'Whiteboard'\ntitle: Empty board\nlastUpdated: 2099-01-01T00:00:00.000Z\n---\n"),
    ],
)
def test_touch_md_variants(root, name, content):
    md = root / EMPTY
    md.write_bytes(content.encode("utf-8"))
    space = mk(root)
    before = md.read_bytes()
    try:
        saved = ws.save_board(space, EMPTY, small(), "")
    except Exception as exc:  # noqa: BLE001
        pytest.fail(f"{name}: save_board raised {type(exc).__name__}: {exc}; sidecar exists={ (root / board_rel(EMPTY)).exists() }")
    after = md.read_bytes()
    print(f"\n[{name}] bumped={saved.md_bumped} changed_md={before != after}")
    print(after.decode("utf-8", "replace"))
    if before != after:
        # only the lastUpdated line may differ; line endings and BOM kept
        assert after.startswith(b"\xef\xbb\xbf") == before.startswith(b"\xef\xbb\xbf"), f"{name}: BOM changed"
        assert (b"\r\n" in after) == (b"\r\n" in before), f"{name}: line endings changed"
        bl = before.replace(b"\r\n", b"\n").split(b"\n")
        al = after.replace(b"\r\n", b"\n").split(b"\n")
        diff = [(x, y) for x, y in zip(bl, al) if x != y]
        print("diff lines:", diff, "len", len(bl), len(al))
        assert len(al) - len(bl) in (0, 1, 2, 3), f"{name}: line count changed a lot"
        assert all(b"lastUpdated" in x or b"lastUpdated" in y for x, y in diff), f"{name}: other lines changed: {diff}"


# --- 2. sidecar BOM / CRLF round trip ----------------------------------------------------

def test_sidecar_bom_crlf_kept(root):
    bp = root / board_rel(NETWORK)
    raw = bp.read_bytes()
    bom_crlf = b"\xef\xbb\xbf" + raw.replace(b"\n", b"\r\n")
    bp.write_bytes(bom_crlf)
    space = mk(root)
    res = ws.read_board(space, NETWORK)
    assert "readOnlyReason" not in res, res.get("readOnlyReason")
    board = res["board"]
    board["nodes"]["n-text"]["position"]["x"] = 61
    ws.save_board(space, NETWORK, board, res["revision"])
    out = bp.read_bytes()
    print("BOM kept:", out.startswith(b"\xef\xbb\xbf"), "CRLF kept:", b"\r\n" in out)
    assert out.startswith(b"\xef\xbb\xbf") and b"\r\n" in out


# --- 3. unknown keys and number precision round trip --------------------------------------

def test_unknown_keys_and_precision(root):
    space = mk(root)
    res = ws.read_board(space, NETWORK)
    board = res["board"]
    board["x-top"] = {"a": [1, 2, {"b": None}]}
    board["nodes"]["n-text"]["position"]["x"] = 0.1 + 0.2
    board["nodes"]["n-text"]["position"]["y"] = 123456789.123456789
    board["nodes"]["n-text"]["rotation"] = 1e-7
    board["nodes"]["n-text"]["x-nested"] = {"k": [1.5, "s"]}
    board["viewport"] = {"x": -1234.5678, "y": 0, "zoom": 0.33333333333333331, "x-vp": True}
    saved = ws.save_board(space, NETWORK, board, res["revision"])
    again = ws.read_board(space, NETWORK)
    assert again["revision"] == saved.revision
    b2 = again["board"]
    assert b2["x-top"] == board["x-top"]
    assert b2["nodes"]["n-text"]["position"]["x"] == 0.1 + 0.2
    assert b2["nodes"]["n-text"]["position"]["y"] == 123456789.123456789
    assert b2["nodes"]["n-text"]["rotation"] == 1e-7
    assert b2["nodes"]["n-text"]["x-nested"] == {"k": [1.5, "s"]}
    assert b2["nodes"]["n-text"]["x-future"] == 1
    assert b2["viewport"] == board["viewport"]
    # a second identical save is a no-op write? (bytes identical -> no history snapshot)
    saved2 = ws.save_board(space, NETWORK, b2, again["revision"])
    assert saved2.revision == saved.revision


def test_ink_precision_roundtrip(root):
    space = mk(root)
    strokes = [{
        "id": "A", "tool": "pen", "color": "#abcdef", "width": 4.125,
        "points": [[0.004, -0.004, 0.0004], [1e-7, 123456.789, 1.0], [12.345, 6.785, 0.5]],
        "d": "M 0 0 Q 1 1 2 2 Z",
    }]
    saved = ws.save_ink(space, EMPTY, strokes, "")
    back = ws.read_ink(space, EMPTY)
    print(json.dumps(back["strokes"]))
    s = back["strokes"][0]
    assert s["d"] == strokes[0]["d"]
    assert "colorName" not in s
    # these show the rounding the file applies (2 decimals / 3 for pressure / width 2)
    print("width", s["width"], "points", s["points"])
    assert s["width"] == 4.13 or s["width"] == 4.12
    assert s["points"][1] == [0, 123456.79, 1]


# --- 4. trash / restore of a board with ink + media -----------------------------------------

def test_trash_restore_board_with_ink_and_media(root):
    (root / "Attachments").mkdir(exist_ok=True)
    (root / "Attachments" / "pic.png").write_bytes(b"\x89PNG fake")
    space = mk(root)
    res = ws.read_board(space, NETWORK)
    board = res["board"]
    board["nodes"]["n-media"] = {"id": "n-media", "kind": "block", "blockId": "b-media", "position": {"x": 0, "y": 0}, "width": 200, "height": 100}
    board["blocks"]["b-media"] = {"type": "media", "path": "Attachments/pic.png"}
    ws.save_board(space, NETWORK, board, res["revision"])
    b_bytes = (root / board_rel(NETWORK)).read_bytes()
    i_bytes = (root / ink_rel(NETWORK)).read_bytes()
    md_bytes = (root / NETWORK).read_bytes()
    item = space.delete_object(NETWORK)
    assert not (root / board_rel(NETWORK)).exists() and not (root / ink_rel(NETWORK)).exists()
    assert (root / "Attachments" / "pic.png").exists()
    tdir = root / ".object" / "trash" / "whiteboards" / item.id
    assert (tdir / "board.json").read_bytes() == b_bytes
    assert (tdir / "ink.svg").read_bytes() == i_bytes
    # an orphan sidecar appears at the old stem meanwhile -> restore must not adopt it
    (root / ink_rel(NETWORK)).write_bytes(b"<svg/>")
    out = space.restore(item.id)
    path = out["paths"][0]
    print("restored to", path)
    assert path != NETWORK
    assert (root / board_rel(path)).read_bytes() == b_bytes
    assert (root / ink_rel(path)).read_bytes() == i_bytes
    assert (root / path).read_bytes() == md_bytes
    assert not tdir.exists()
    again = ws.read_board(space, path)
    assert "readOnlyReason" not in again
    assert again["board"]["blocks"]["b-media"]["path"] == "Attachments/pic.png"


# --- 5. rename moves sidecars and relinks other boards -------------------------------------

def test_rename_moves_sidecars_and_relinks(root):
    space = mk(root)
    v = space.get(NETWORK)
    from objectapp.space import version_of
    base = version_of((root / NETWORK).read_bytes())
    res = space.rename_object(NETWORK, "Net map 2", base)
    print(res)
    assert (root / board_rel(res.path)).exists() and (root / ink_rel(res.path)).exists()
    assert not (root / board_rel(NETWORK)).exists()
    # rename a page linked from the board: entity block link rewritten
    ra = "Pages/Router A.md"
    base_a = version_of((root / ra).read_bytes())
    res2 = space.rename_object(ra, "Router Alpha", base_a)
    bd = ws.read_board(space, res.path)["board"]
    links = [b.get("link") for b in bd["blocks"].values() if b.get("type") == "entity"]
    print(links, res2.relinked)
    assert any("Router Alpha" in (l or "") for l in links)


# --- 6. concurrent saves with one base: exactly one wins ----------------------------------

def test_concurrent_saves(root):
    space = mk(root)
    res = ws.read_board(space, NETWORK)
    results = []

    def go(i):
        b = json.loads(json.dumps(res["board"]))
        b["nodes"]["n-text"]["position"]["x"] = 100 + i
        try:
            results.append(("ok", ws.save_board(space, NETWORK, b, res["revision"]).revision))
        except ws.BoardConflict as e:
            results.append(("409", e.current_revision))

    ts = [threading.Thread(target=go, args=(i,)) for i in range(6)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    oks = [r for r in results if r[0] == "ok"]
    print(results)
    assert len(oks) == 1
    assert load_board((root / board_rel(NETWORK)).read_bytes())[1] is None


# --- 7. a board whose .md is malformed --------------------------------------------------

def test_malformed_md_board_readable(root):
    (root / EMPTY).write_text("---\nid: 01JBW6WB000000000000000006\ntype: 'Whiteboard'\ntitle: [unclosed\n---\n", encoding="utf-8")
    space = mk(root)
    print("summary:", space.get(EMPTY))
    try:
        r = ws.read_board(space, EMPTY)
        print("read ok", r.get("readOnlyReason"))
        ws.save_board(space, EMPTY, small(), "")
        print("save ok; md after:", (root / EMPTY).read_text())
    except Exception as exc:  # noqa: BLE001
        print("raised", type(exc).__name__, exc)
        pytest.fail(str(exc))


# --- 8. throttle: second save within 60 s does not stamp; the stamp uses the given clock ---

def test_throttle(root):
    space = mk(root)
    s1 = ws.save_board(space, EMPTY, small("a"), "")
    assert s1.md_bumped
    s2 = ws.save_board(space, EMPTY, small("b"), s1.revision)
    assert not s2.md_bumped
    space.clock = lambda: T0 + timedelta(seconds=61)
    s3 = ws.save_board(space, EMPTY, small("c"), s2.revision)
    assert s3.md_bumped
