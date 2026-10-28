"""M6 Task 2: the board JSON format (`whiteboardfile`)."""

from __future__ import annotations

import copy
import json

import pytest
from objectapp.whiteboardfile import (
    NEWER_VERSION_REASON,
    BoardInvalid,
    board_rel,
    dump_board,
    empty_board,
    ink_rel,
    load_board,
    sidecar_owner,
    sidecar_rels,
    validate_board,
)
from wb_support import FIXTURE

WB = FIXTURE / "Whiteboards"


def _raw(name: str) -> bytes:
    return (WB / f"{name}.whiteboard.json").read_bytes()


def _board(name: str = "Network map") -> dict:
    return json.loads(_raw(name).decode("utf-8"))


def test_sidecar_names():
    assert board_rel("Whiteboards/Network map.md") == "Whiteboards/Network map.whiteboard.json"
    assert ink_rel("Whiteboards/Network map.md") == "Whiteboards/Network map.ink.svg"
    assert board_rel("Whiteboards/Dotted v1.2 plan.md") == "Whiteboards/Dotted v1.2 plan.whiteboard.json"
    assert ink_rel("Whiteboards/Dotted v1.2 plan.md") == "Whiteboards/Dotted v1.2 plan.ink.svg"
    assert board_rel("Whiteboards/Odd.whiteboard.md") == "Whiteboards/Odd.whiteboard.whiteboard.json"
    assert sidecar_rels("Whiteboards/A.md") == ("Whiteboards/A.whiteboard.json", "Whiteboards/A.ink.svg")
    with pytest.raises(ValueError):
        board_rel("Whiteboards/A.txt")


def test_sidecar_owner_maps_back_and_ignores_others():
    for md in ("Whiteboards/Network map.md", "Whiteboards/Dotted v1.2 plan.md", "Whiteboards/Odd.whiteboard.md", "Top.md"):
        board, ink = sidecar_rels(md)
        assert sidecar_owner(board) == md
        assert sidecar_owner(ink) == md
    assert sidecar_owner("Whiteboards/Orphan (2).whiteboard.json") == "Whiteboards/Orphan (2).md"
    for other in ("Whiteboards/Network map.md", "Pages/x.json", "a.svg", ".object/types/whiteboard.json", "Whiteboards/.whiteboard.json", ".ink.svg"):
        assert sidecar_owner(other) is None


@pytest.mark.parametrize("name", ["Network map", "Dotted v1.2 plan"])
def test_validate_accepts_fixture_board(name):
    validate_board(_board(name))
    board, reason = load_board(_raw(name))
    assert reason is None
    assert board == _board(name)


def _break(mutate):
    board = copy.deepcopy(_board())
    mutate(board)
    return board


BAD_BOARDS = {
    "unknown kind": lambda b: b["nodes"]["n-text"].update(kind="sticker"),
    "unknown shape": lambda b: b["nodes"]["n-shape-star"].update(shape="hexagon"),
    "key id mismatch": lambda b: b["nodes"]["n-text"].update(id="other"),
    "edge to missing node": lambda b: b["edges"]["e-default"].update(target="n-missing"),
    "missing blockId": lambda b: b["nodes"]["n-text"].update(blockId="b-missing"),
    "nan": lambda b: b["nodes"]["n-text"]["position"].update(x=float("nan")),
    "negative width": lambda b: b["nodes"]["n-text"].update(width=-5),
    "entity link without brackets": lambda b: b["blocks"]["b-router-a"].update(link="Router A"),
    "non-list readingOrder": lambda b: b.update(readingOrder="n-text"),
    "bad fill": lambda b: b["nodes"]["n-shape-rectangle"].update(fillColor="blue"),
    "bad edge colour": lambda b: b["edges"]["e-default"].update(color="bg-red"),
    "bad marker": lambda b: b["edges"]["e-default"].update(markerEnd="triangle"),
    "bool as number": lambda b: b["nodes"]["n-text"].update(z=True),
    "nodes not a record": lambda b: b.update(nodes=[]),
    "version 2 on save": lambda b: b.update(version=2),
    "zero height block": lambda b: b["nodes"]["n-text"].update(height=0),
}


@pytest.mark.parametrize("case", sorted(BAD_BOARDS))
def test_validate_rejects_bad_boards(case):
    with pytest.raises(BoardInvalid) as info:
        validate_board(_break(BAD_BOARDS[case]))
    assert info.value.detail and info.value.detail.endswith(".")


def test_edge_to_missing_node_message():
    with pytest.raises(BoardInvalid) as info:
        validate_board(_break(BAD_BOARDS["edge to missing node"]))
    assert info.value.detail == "Edge e-default points to a node that doesn't exist."


def test_point_may_have_zero_size():
    board = _break(lambda b: b["nodes"]["n-point-1"].update(width=0, height=0))
    validate_board(board)


def test_arrow_closed_and_deprecated_label_accepted():
    board = _board()
    assert board["edges"]["e-cornered"]["markerEnd"] == "arrowClosed"
    assert board["edges"]["e-curved"]["label"] == "legacy label"
    validate_board(board)


def test_unknown_keys_kept():
    board, _ = load_board(_raw("Network map"))
    again = json.loads(dump_board(board))
    assert again["x-future"] == 1
    assert again["nodes"]["n-text"]["x-future"] == 1
    assert again["edges"]["e-default"]["x-future"] == 1


def test_dump_is_stable():
    board, _ = load_board(_raw("Network map"))
    out = dump_board(board)
    assert out == _raw("Network map")  # the fixture is in our format
    assert out.endswith(b"\n") and b"\r" not in out
    assert out.startswith(b'{\n  "version": 1,')
    assert dump_board(json.loads(out)) == out
    board["blocks"]["b-text"]["markdown"] = "Grüße — 日本"
    text = dump_board(board).decode("utf-8")
    assert "Grüße — 日本" in text


def test_unreadable_and_future_boards_read_only():
    board, reason = load_board(_raw("Broken board"))
    assert board == empty_board()
    assert reason and reason.startswith("This whiteboard's file can't be read, so it opens read-only: ")
    board, reason = load_board(_raw("Future board"))
    assert board == empty_board()
    assert reason == NEWER_VERSION_REASON
    for data in (b"[]", b'"x"', b"\xff\xfe", json.dumps(_break(BAD_BOARDS["unknown kind"])).encode()):
        board, reason = load_board(data)
        assert board == empty_board() and reason


def test_board_without_blocks_reads_with_empty_blocks():
    board, reason = load_board(b'{"version": 1, "nodes": {}, "edges": {}}')
    assert reason is None
    assert board == empty_board()


def test_empty_board_shape():
    assert empty_board() == {"version": 1, "nodes": {}, "edges": {}, "blocks": {}}
    assert empty_board() is not empty_board()
    validate_board(empty_board())
    assert dump_board(empty_board()) == b'{\n  "version": 1,\n  "nodes": {},\n  "edges": {},\n  "blocks": {}\n}\n'
