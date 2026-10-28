"""M6 Task 4: a whiteboard's sidecars in trash, restore, purge, rename and relink.

Uses the synthetic `space-whiteboard` copy (`wb_support`); `Space.delete_object`/`restore`
are not called (the integrate task wires these functions into them).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from objectapp import whiteboardtrash
from objectapp.space import Space, version_of
from objectapp.whiteboardfile import dump_board, load_board
from objectapp.whiteboardtrash import (
    board_links,
    board_text,
    free_whiteboard_stem,
    move_sidecars,
    purge_sidecars,
    relink_board,
    relink_board_file,
    restore_sidecars,
    sidecar_event_owner,
    sidecar_trash_dir,
    trash_sidecars,
)
from wb_support import copy_whiteboard_space, tree_hashes

NETWORK = "Whiteboards/Network map.md"
NETWORK_BOARD = "Whiteboards/Network map.whiteboard.json"
NETWORK_INK = "Whiteboards/Network map.ink.svg"
EMPTY = "Whiteboards/Empty board.md"
BROKEN = "Whiteboards/Broken board.md"
TRASH_ID = "01JBWTRASH0000000000000001"


@pytest.fixture
def wb_dir(tmp_path: Path) -> Path:
    return copy_whiteboard_space(tmp_path)


@pytest.fixture
def space(wb_dir: Path) -> Space:
    return Space(wb_dir)


def _bytes(root: Path, rel: str) -> bytes:
    return (root / rel).read_bytes()


# --- trash, restore, purge -------------------------------------------------------------------


def test_trash_sidecars_moves_both(space: Space, wb_dir: Path) -> None:
    board, ink = _bytes(wb_dir, NETWORK_BOARD), _bytes(wb_dir, NETWORK_INK)
    moved = trash_sidecars(space, TRASH_ID, NETWORK)
    assert moved == [NETWORK_BOARD, NETWORK_INK]
    assert not (wb_dir / NETWORK_BOARD).exists()
    assert not (wb_dir / NETWORK_INK).exists()
    assert (wb_dir / NETWORK).is_file()  # the .md is the caller's
    folder = sidecar_trash_dir(space, TRASH_ID)
    assert folder == wb_dir / ".capacities" / "trash" / "whiteboards" / TRASH_ID
    assert (folder / "board.json").read_bytes() == board
    assert (folder / "ink.svg").read_bytes() == ink
    assert space.own_deletes[NETWORK_BOARD] == version_of(board)
    assert space.own_deletes[NETWORK_INK] == version_of(ink)
    # The trash listing never mistakes the folder for an entry.
    assert space.trash.items() == []
    assert space.list_trash() == []


def test_trash_with_no_sidecars_is_noop(space: Space, wb_dir: Path) -> None:
    before = tree_hashes(wb_dir)
    assert trash_sidecars(space, TRASH_ID, EMPTY) == []
    assert tree_hashes(wb_dir) == before
    assert not sidecar_trash_dir(space, TRASH_ID).exists()


def test_trash_sidecars_rolls_back_on_failure(
    space: Space, wb_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = tree_hashes(wb_dir)
    real = whiteboardtrash.move_no_overwrite
    calls = {"n": 0}

    def flaky(src, dest):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("disk says no")
        return real(src, dest)

    monkeypatch.setattr(whiteboardtrash, "move_no_overwrite", flaky)
    with pytest.raises(OSError):
        trash_sidecars(space, TRASH_ID, NETWORK)
    assert tree_hashes(wb_dir) == before
    assert NETWORK_BOARD not in space.own_deletes


def test_unsafe_trash_id_refused(space: Space) -> None:
    with pytest.raises(ValueError):
        sidecar_trash_dir(space, "../escape")


def test_restore_sidecars_byte_identical(space: Space, wb_dir: Path) -> None:
    before = tree_hashes(wb_dir)
    trash_sidecars(space, TRASH_ID, NETWORK)
    restored = restore_sidecars(space, TRASH_ID, NETWORK)
    assert restored == [NETWORK_BOARD, NETWORK_INK]
    assert tree_hashes(wb_dir) == before  # trash folder gone too
    assert not sidecar_trash_dir(space, TRASH_ID).exists()
    assert space.own_writes[NETWORK_BOARD] == before[NETWORK_BOARD]


def test_restore_collision_follows_md_stem(space: Space, wb_dir: Path) -> None:
    board, ink = _bytes(wb_dir, NETWORK_BOARD), _bytes(wb_dir, NETWORK_INK)
    trash_sidecars(space, TRASH_ID, NETWORK)
    # The original name is taken again, so the .md came back as "Network map (2).md".
    (wb_dir / NETWORK_BOARD).write_bytes(b'{"version": 1, "nodes": {}, "edges": {}}\n')
    restored_md = free_whiteboard_stem(wb_dir, "Whiteboards", "Network map")
    assert restored_md == "Whiteboards/Network map (2).md"
    paths = restore_sidecars(space, TRASH_ID, restored_md)
    assert paths == [
        "Whiteboards/Network map (2).whiteboard.json",
        "Whiteboards/Network map (2).ink.svg",
    ]
    assert _bytes(wb_dir, paths[0]) == board
    assert _bytes(wb_dir, paths[1]) == ink


def test_restore_never_overwrites(space: Space, wb_dir: Path) -> None:
    trash_sidecars(space, TRASH_ID, NETWORK)
    squatter = b"someone else's ink\n"
    (wb_dir / NETWORK_INK).write_bytes(squatter)
    with pytest.raises(FileExistsError):
        restore_sidecars(space, TRASH_ID, NETWORK)
    assert _bytes(wb_dir, NETWORK_INK) == squatter
    assert not (wb_dir / NETWORK_BOARD).exists()  # moved back into the trash
    folder = sidecar_trash_dir(space, TRASH_ID)
    assert (folder / "board.json").is_file() and (folder / "ink.svg").is_file()


def test_free_stem_skips_orphan_sidecar(wb_dir: Path) -> None:
    (wb_dir / "Whiteboards" / "Orphan.md").write_bytes(b"---\ntitle: Orphan\n---\n")
    # "Orphan (2).md" is absent, but "Orphan (2).whiteboard.json" is an orphan sidecar.
    assert (
        free_whiteboard_stem(wb_dir, "Whiteboards", "Orphan")
        == "Whiteboards/Orphan (3).md"
    )
    assert free_whiteboard_stem(wb_dir, "Whiteboards", "Empty board") == (
        "Whiteboards/Empty board (2).md"
    )
    assert (
        free_whiteboard_stem(wb_dir, "Whiteboards", "Brand new")
        == "Whiteboards/Brand new.md"
    )
    # Case-insensitive, like unique_path.
    assert free_whiteboard_stem(wb_dir, "Whiteboards", "network MAP") == (
        "Whiteboards/network MAP (2).md"
    )


def test_free_stem_same_as_allows_own_files(wb_dir: Path) -> None:
    assert free_whiteboard_stem(
        wb_dir, "Whiteboards", "Network Map", same_as=NETWORK
    ) == ("Whiteboards/Network Map.md")
    assert free_whiteboard_stem(
        wb_dir, "Whiteboards", "Network map", same_as=EMPTY
    ) == ("Whiteboards/Network map (2).md")


def test_purge_removes_sidecars(space: Space, wb_dir: Path) -> None:
    trash_sidecars(space, TRASH_ID, NETWORK)
    purge_sidecars(space, TRASH_ID)
    assert not sidecar_trash_dir(space, TRASH_ID).exists()
    assert not (wb_dir / NETWORK_BOARD).exists()
    purge_sidecars(space, TRASH_ID)  # nothing left: still fine


# --- rename ----------------------------------------------------------------------------------


def test_move_sidecars_on_rename(space: Space, wb_dir: Path) -> None:
    board, ink = _bytes(wb_dir, NETWORK_BOARD), _bytes(wb_dir, NETWORK_INK)
    new_md = "Whiteboards/Core network.md"
    paths = move_sidecars(space, NETWORK, new_md)
    assert paths == [
        "Whiteboards/Core network.whiteboard.json",
        "Whiteboards/Core network.ink.svg",
    ]
    assert _bytes(wb_dir, paths[0]) == board and _bytes(wb_dir, paths[1]) == ink
    assert not (wb_dir / NETWORK_BOARD).exists() and not (wb_dir / NETWORK_INK).exists()
    assert space.own_deletes[NETWORK_BOARD] == version_of(board)
    assert space.own_writes[paths[1]] == version_of(ink)
    assert move_sidecars(space, EMPTY, "Whiteboards/Still empty.md") == []


def test_move_sidecars_case_only_rename(space: Space, wb_dir: Path) -> None:
    board = _bytes(wb_dir, NETWORK_BOARD)
    paths = move_sidecars(space, NETWORK, "Whiteboards/Network Map.md")
    assert paths[0] == "Whiteboards/Network Map.whiteboard.json"
    assert _bytes(wb_dir, paths[0]) == board
    names = {p.name for p in (wb_dir / "Whiteboards").iterdir()}
    assert "Network Map.whiteboard.json" in names
    assert "Network map.whiteboard.json" not in names


def test_move_sidecars_refuses_to_overwrite(space: Space, wb_dir: Path) -> None:
    before = tree_hashes(wb_dir)
    with pytest.raises(FileExistsError):
        move_sidecars(space, NETWORK, "Whiteboards/Broken board.md")
    assert tree_hashes(wb_dir) == before


def test_move_sidecars_rolls_back_on_failure(
    space: Space, wb_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = tree_hashes(wb_dir)
    real = whiteboardtrash.move_no_overwrite
    calls = {"n": 0}

    def flaky(src, dest):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("disk says no")
        return real(src, dest)

    monkeypatch.setattr(whiteboardtrash, "move_no_overwrite", flaky)
    with pytest.raises(OSError):
        move_sidecars(space, NETWORK, "Whiteboards/Core network.md")
    assert tree_hashes(wb_dir) == before  # both still at the old stem
    assert NETWORK_BOARD not in space.own_deletes
    assert "Whiteboards/Core network.whiteboard.json" not in space.own_writes


# --- relink ----------------------------------------------------------------------------------


def _with_text_link(wb_dir: Path) -> dict:
    """The Network map board with a text block that links to Router A (written to the copy)."""
    board, reason = load_board(_bytes(wb_dir, NETWORK_BOARD))
    assert reason is None
    board["blocks"]["b-text"]["markdown"] = (
        "**Network map**\nSee [[router a|the first router]] and `[[Router A]]` in code."
    )
    (wb_dir / NETWORK_BOARD).write_bytes(dump_board(board))
    return board


def test_relink_board_updates_links_only(wb_dir: Path) -> None:
    board = _with_text_link(wb_dir)
    original = json.loads(json.dumps(board))
    out = relink_board(board, {"Router A"}, "Edge router")
    assert out is not None
    assert board == original  # input untouched
    assert out["blocks"]["b-router-a"]["link"] == "[[Edge router]]"
    assert out["blocks"]["b-text"]["markdown"] == (
        "**Network map**\nSee [[Edge router|the first router]] and `[[Router A]]` in code."
    )
    # Nothing else differs.
    out["blocks"]["b-router-a"]["link"] = original["blocks"]["b-router-a"]["link"]
    out["blocks"]["b-text"]["markdown"] = original["blocks"]["b-text"]["markdown"]
    assert out == original
    assert relink_board(board, {"Nobody"}, "Somebody") is None


def test_relink_board_file_writes_atomically(space: Space, wb_dir: Path) -> None:
    _with_text_link(wb_dir)
    md_before = _bytes(wb_dir, NETWORK)
    written = relink_board_file(space, NETWORK, {"Router B"}, "Spine")
    assert written == NETWORK_BOARD
    data = _bytes(wb_dir, NETWORK_BOARD)
    assert json.loads(data)["blocks"]["b-router-b"]["link"] == "[[Spine]]"
    assert space.own_writes[NETWORK_BOARD] == version_of(data)
    assert _bytes(wb_dir, NETWORK) == md_before
    assert relink_board_file(space, NETWORK, {"Router B"}, "Spine") is None
    assert relink_board_file(space, EMPTY, {"Router B"}, "Spine") is None


def test_relink_board_file_skips_unreadable(space: Space, wb_dir: Path) -> None:
    before = tree_hashes(wb_dir)
    assert relink_board_file(space, BROKEN, {"Router A"}, "Edge router") is None
    assert (
        relink_board_file(space, "Whiteboards/Future board.md", {"Router A"}, "X")
        is None
    )
    assert tree_hashes(wb_dir) == before


def test_relink_board_file_skips_external_edit_in_between(
    space: Space, wb_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_dump = whiteboardtrash.dump_board
    external = b'{"version": 1, "nodes": {}, "edges": {}, "blocks": {}}\n'

    def dump_then_edit(board):
        (wb_dir / NETWORK_BOARD).write_bytes(external)
        return real_dump(board)

    monkeypatch.setattr(whiteboardtrash, "dump_board", dump_then_edit)
    assert relink_board_file(space, NETWORK, {"Router A"}, "Edge router") is None
    assert _bytes(wb_dir, NETWORK_BOARD) == external
    assert NETWORK_BOARD not in space.own_writes


# --- extraction ------------------------------------------------------------------------------


def test_board_links_and_text_reading_order(wb_dir: Path) -> None:
    board = _with_text_link(wb_dir)
    # readingOrder is n-text, n-router-a, n-router-b; the code span is not a link.
    assert board_links(board) == ["router a", "Router A", "Router B"]
    text = board_text(board)
    parts = text.split("\n\n")
    assert parts[0].startswith("**Network map**")
    # The rest follow top-to-bottom, left-to-right: shape row y=360 before y=480, gates last.
    assert parts[1:4] == ["Rectangle text", "Diamond text", "Star text"]
    assert parts[4:13] == [
        "NOT",
        "AND",
        "NAND",
        "OR",
        "NOR",
        "XOR",
        "XNOR",
        "HIGH",
        "LOW",
    ]
    assert parts[-1] == "uplink"  # the connector label comes after the nodes
    assert "[[Router B]]" not in text  # entity blocks aren't text


def test_board_text_without_reading_order() -> None:
    board = {
        "version": 1,
        "nodes": {
            "a": {
                "id": "a",
                "kind": "block",
                "blockId": "ba",
                "position": {"x": 300, "y": 0},
            },
            "b": {
                "id": "b",
                "kind": "block",
                "blockId": "bb",
                "position": {"x": 0, "y": 0},
            },
            "c": {
                "id": "c",
                "kind": "block",
                "blockId": "bc",
                "position": {"x": 0, "y": -50},
            },
        },
        "edges": {},
        "blocks": {
            "ba": {"type": "text", "markdown": "right"},
            "bb": {"type": "text", "markdown": "left [[X]]"},
            "bc": {"type": "text", "markdown": "top"},
            "loose": {"type": "text", "markdown": "loose"},
        },
    }
    assert board_text(board) == "top\n\nleft [[X]]\n\nright\n\nloose"
    assert board_links(board) == ["X"]


def test_sidecar_event_owner(space: Space, wb_dir: Path) -> None:
    assert sidecar_event_owner(space, NETWORK_BOARD) == NETWORK
    assert sidecar_event_owner(space, NETWORK_INK) == NETWORK
    assert sidecar_event_owner(space, "Whiteboards/Orphan (2).whiteboard.json") is None
    assert sidecar_event_owner(space, NETWORK) is None
    assert (
        sidecar_event_owner(space, "Pages/Router A.whiteboard.json") is None
    )  # not a board
    assert sidecar_event_owner(space, "Whiteboards/Network map.json") is None


def test_no_md_written(space: Space, wb_dir: Path) -> None:
    """Regression guard: nothing here writes a `.md`."""
    _with_text_link(wb_dir)
    md_before = {k: v for k, v in tree_hashes(wb_dir).items() if k.endswith(".md")}
    trash_sidecars(space, TRASH_ID, NETWORK)
    restore_sidecars(space, TRASH_ID, NETWORK)
    relink_board_file(space, NETWORK, {"Router A"}, "Edge router")
    moved = move_sidecars(space, NETWORK, "Whiteboards/Core network.md")
    move_sidecars(space, "Whiteboards/Core network.md", NETWORK)
    trash_sidecars(space, TRASH_ID, NETWORK)
    purge_sidecars(space, TRASH_ID)
    assert moved
    md_after = {k: v for k, v in tree_hashes(wb_dir).items() if k.endswith(".md")}
    assert md_after == md_before
