"""M6 Task 13: whiteboards wired into the app (router, trash, rename, watcher, ui, indexes).

Everything runs through `create_app` on a copy of the synthetic `space-whiteboard`.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import whiteboardtrash
from objectapp.media import list_images
from objectapp.roles import role_of
from objectapp.server import create_app
from objectapp.space import Space, version_of
from objectapp.typemodel import TypeDefinition
from objectapp.watcher import ChangeEvent, SpaceWatcher
from objectapp.whiteboardfile import dump_board
from objectapp.whiteboardstore import whiteboard_type
from wb_support import copy_whiteboard_space, tree_hashes

NETWORK = "Whiteboards/Network map.md"
NETWORK_BOARD = "Whiteboards/Network map.whiteboard.json"
NETWORK_INK = "Whiteboards/Network map.ink.svg"
EMPTY = "Whiteboards/Empty board.md"
ROUTER_A = "Pages/Router A.md"


@pytest.fixture
def wb_dir(tmp_path: Path) -> Path:
    return copy_whiteboard_space(tmp_path)


def _client(root: Path) -> tuple[Space, TestClient, list[ChangeEvent]]:
    space = Space(root)
    app = create_app(space, None, watch=False)
    events: list[ChangeEvent] = []
    app.state.hub.publish = events.append
    return space, TestClient(app), events


def _wait_for(events: list[ChangeEvent], pred, timeout: float = 3.0) -> bool:
    """Events are published on the app's loop (running inside ``with client``)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(pred(e) for e in events):
            return True
        time.sleep(0.02)
    return False


def _bytes(root: Path, *rels: str) -> dict[str, bytes]:
    return {rel: (root / rel).read_bytes() for rel in rels}


def _version(root: Path, rel: str) -> str:
    return version_of((root / rel).read_bytes())


def _delete(client: TestClient, root: Path, path: str) -> str:
    r = client.delete(
        "/api/object", params={"path": path, "baseVersion": _version(root, path)}
    )
    assert r.status_code == 200, r.text
    return r.json()["trashId"]


def test_router_mounted(wb_dir: Path):
    _space, c, _events = _client(wb_dir)
    r = c.get("/api/whiteboard", params={"path": NETWORK})
    assert r.status_code == 200
    assert r.json()["revision"] == _version(wb_dir, NETWORK_BOARD)
    assert c.get("/api/whiteboard/ink", params={"path": NETWORK}).status_code == 200
    r = c.post("/api/whiteboards", json={"title": "Fresh"})
    assert r.status_code == 201
    assert r.json()["path"] == "Whiteboards/Fresh.md"


def test_delete_whiteboard_trashes_sidecars(wb_dir: Path):
    space, c, _events = _client(wb_dir)
    before = _bytes(wb_dir, NETWORK, NETWORK_BOARD, NETWORK_INK)
    trash_id = _delete(c, wb_dir, NETWORK)
    for rel in before:
        assert not (wb_dir / rel).exists()
    folder = whiteboardtrash.sidecar_trash_dir(space, trash_id)
    assert (folder / "board.json").read_bytes() == before[NETWORK_BOARD]
    assert (folder / "ink.svg").read_bytes() == before[NETWORK_INK]
    # The trash lists one entry for the board, not one per sidecar.
    assert [i["id"] for i in c.get("/api/trash").json()] == [trash_id]


def test_restore_whiteboard_byte_identical(wb_dir: Path):
    _space, c, _events = _client(wb_dir)
    before = _bytes(wb_dir, NETWORK, NETWORK_BOARD, NETWORK_INK)
    trash_id = _delete(c, wb_dir, NETWORK)
    r = c.post(f"/api/trash/{trash_id}/restore")
    assert r.status_code == 200, r.text
    assert r.json()["paths"] == [NETWORK]
    assert _bytes(wb_dir, *before) == before


def test_restore_whiteboard_collision_takes_one_stem(wb_dir: Path):
    _space, c, _events = _client(wb_dir)
    before = _bytes(wb_dir, NETWORK, NETWORK_BOARD, NETWORK_INK)
    trash_id = _delete(c, wb_dir, NETWORK)
    # The title is taken again, and an orphan "(2)" sidecar sits in the folder.
    assert c.post("/api/whiteboards", json={"title": "Network map"}).status_code == 201
    orphan = wb_dir / "Whiteboards/Network map (2).ink.svg"
    orphan.write_bytes(b"orphan")
    r = c.post(f"/api/trash/{trash_id}/restore")
    assert r.status_code == 200, r.text
    assert r.json()["paths"] == ["Whiteboards/Network map (3).md"]
    assert (wb_dir / "Whiteboards/Network map (3).md").read_bytes() == before[NETWORK]
    assert (wb_dir / "Whiteboards/Network map (3).whiteboard.json").read_bytes() == before[
        NETWORK_BOARD
    ]
    assert (wb_dir / "Whiteboards/Network map (3).ink.svg").read_bytes() == before[NETWORK_INK]
    assert orphan.read_bytes() == b"orphan"


def test_create_whiteboard_never_adopts_orphan_sidecar(wb_dir: Path):
    _space, c, _events = _client(wb_dir)
    assert (wb_dir / "Whiteboards/Orphan (2).whiteboard.json").is_file()
    first = c.post("/api/whiteboards", json={"title": "Orphan"})
    assert first.status_code == 201 and first.json()["path"] == "Whiteboards/Orphan.md"
    second = c.post("/api/whiteboards", json={"title": "Orphan"})
    assert second.status_code == 201
    path = second.json()["path"]
    assert path == "Whiteboards/Orphan (3).md"
    r = c.get("/api/whiteboard", params={"path": path})
    assert r.status_code == 200
    assert r.json()["revision"] == ""
    assert r.json()["board"]["nodes"] == {}


def test_restore_whiteboard_without_sidecars_never_adopts_orphan(wb_dir: Path):
    _space, c, _events = _client(wb_dir)
    before = _bytes(wb_dir, EMPTY)
    trash_id = _delete(c, wb_dir, EMPTY)
    assert c.post("/api/whiteboards", json={"title": "Empty board"}).status_code == 201
    orphan = wb_dir / "Whiteboards/Empty board (2).ink.svg"
    orphan.write_bytes(b"orphan")
    r = c.post(f"/api/trash/{trash_id}/restore")
    assert r.status_code == 200, r.text
    assert r.json()["paths"] == ["Whiteboards/Empty board (3).md"]
    assert (wb_dir / "Whiteboards/Empty board (3).md").read_bytes() == before[EMPTY]
    assert not (wb_dir / "Whiteboards/Empty board (3).ink.svg").exists()
    assert orphan.read_bytes() == b"orphan"


def test_purge_and_expiry_remove_sidecars(wb_dir: Path):
    space, c, _events = _client(wb_dir)
    first = _delete(c, wb_dir, NETWORK)
    folder = whiteboardtrash.sidecar_trash_dir(space, first)
    assert folder.is_dir()
    assert c.delete(f"/api/trash/{first}").status_code == 200
    assert not folder.exists()
    # Expiry (30 days) goes through the same purge.
    second = _delete(c, wb_dir, "Whiteboards/Dotted v1.2 plan.md")
    folder = whiteboardtrash.sidecar_trash_dir(space, second)
    assert folder.is_dir()
    meta_file = space.trash.object_meta_file(second)
    meta = json.loads(meta_file.read_text("utf-8"))
    meta["deletedAt"] = "2020-01-01T00:00:00.000Z"
    meta_file.write_text(json.dumps(meta), "utf-8")
    assert space.purge_expired(space.clock() + timedelta(days=1)) == 1
    assert not folder.exists()
    assert not (space.trash.dir / "whiteboards").exists()


def test_type_delete_trashes_board_sidecars(wb_dir: Path):
    space = Space(wb_dir)
    t = whiteboard_type(space)
    assert t is not None
    boards = [s.path for s in space.list(t.id)]
    before = {
        rel: (wb_dir / rel).read_bytes()
        for rel in tree_hashes(wb_dir)
        if rel.startswith("Whiteboards/") and not rel.startswith("Whiteboards/Orphan")
    }
    item = space.trash_type(t, boards)
    assert not any((wb_dir / rel).exists() for rel in before)
    assert (wb_dir / "Whiteboards/Orphan (2).whiteboard.json").exists()  # not a board's
    restored = space.restore(item.id)
    assert sorted(restored["paths"]) == sorted(boards)
    assert {rel: (wb_dir / rel).read_bytes() for rel in before} == before


def test_rename_whiteboard_moves_sidecars(wb_dir: Path):
    _space, c, events = _client(wb_dir)
    board, ink = _bytes(wb_dir, NETWORK_BOARD, NETWORK_INK).values()
    with c:
        r = c.post(
            "/api/object/rename",
            json={"path": NETWORK, "title": "Core map", "baseVersion": _version(wb_dir, NETWORK)},
        )
        assert _wait_for(events, lambda e: e.kind == "renamed")
    assert r.status_code == 200, r.text
    assert r.json()["path"] == "Whiteboards/Core map.md"
    assert (wb_dir / "Whiteboards/Core map.whiteboard.json").read_bytes() == board
    assert (wb_dir / "Whiteboards/Core map.ink.svg").read_bytes() == ink
    assert not (wb_dir / NETWORK_BOARD).exists() and not (wb_dir / NETWORK_INK).exists()
    assert c.get("/api/whiteboard", params={"path": "Whiteboards/Core map.md"}).json()[
        "revision"
    ] == version_of(board)


def test_rename_whiteboard_rolls_back_when_sidecars_cannot_move(
    wb_dir: Path, monkeypatch: pytest.MonkeyPatch
):
    space, c, _events = _client(wb_dir)
    board, ink = _bytes(wb_dir, NETWORK_BOARD, NETWORK_INK).values()

    def refuse(_space, _old, _new):
        raise PermissionError("locked")

    monkeypatch.setattr(whiteboardtrash, "move_sidecars", refuse)
    r = c.post(
        "/api/object/rename",
        json={"path": NETWORK, "title": "Core map", "baseVersion": _version(wb_dir, NETWORK)},
    )
    assert r.status_code == 200, r.text
    assert r.json()["path"] == NETWORK  # the file keeps its old name
    assert space.get(NETWORK).title == "Core map"  # the title change stands
    assert not (wb_dir / "Whiteboards/Core map.md").exists()
    assert (wb_dir / NETWORK_BOARD).read_bytes() == board
    assert (wb_dir / NETWORK_INK).read_bytes() == ink


def test_rename_target_object_relinks_board(wb_dir: Path):
    _space, c, events = _client(wb_dir)
    md_before = (wb_dir / NETWORK).read_bytes()
    board_before = json.loads((wb_dir / NETWORK_BOARD).read_text("utf-8"))
    with c:
        r = c.post(
            "/api/object/rename",
            json={"path": ROUTER_A, "title": "Router Alpha", "baseVersion": _version(wb_dir, ROUTER_A)},
        )
        assert _wait_for(events, lambda e: e == ChangeEvent("whiteboard", NETWORK, None))
    assert r.status_code == 200, r.text
    assert NETWORK_BOARD in r.json()["relinked"]
    after = json.loads((wb_dir / NETWORK_BOARD).read_text("utf-8"))
    expected = json.loads(json.dumps(board_before))
    expected["blocks"]["b-router-a"]["link"] = "[[Router Alpha]]"
    assert after == expected  # only that link changed
    assert (wb_dir / NETWORK_BOARD).read_bytes() == dump_board(expected)
    assert (wb_dir / NETWORK).read_bytes() == md_before


def test_change_type_refused_for_whiteboards(wb_dir: Path):
    _space, c, _events = _client(wb_dir)
    r = c.get("/api/object/change-type", params={"path": NETWORK, "typeId": "page"})
    assert r.status_code == 422
    assert r.json()["detail"] == "The type of a Whiteboard object can't be changed"
    r = c.get("/api/object/change-type", params={"path": ROUTER_A, "typeId": "whiteboard"})
    assert r.status_code == 422
    assert r.json()["detail"] == "An object can't be changed to a Whiteboard"


def test_watcher_announces_external_sidecar_change(wb_dir: Path):
    async def main():
        space = Space(wb_dir)
        watcher = SpaceWatcher(space, asyncio.get_running_loop())
        watcher.start()
        try:
            await asyncio.sleep(0.2)
            board = json.loads((wb_dir / NETWORK_BOARD).read_text("utf-8"))
            board["blocks"]["b-text"]["markdown"] = "Edited in another editor"
            data = dump_board(board)
            (wb_dir / NETWORK_BOARD).write_bytes(data)
            ev = await asyncio.wait_for(watcher.events.get(), 3)
            assert ev == ChangeEvent("whiteboard", NETWORK, version_of(data))
            # The app's own board save stays quiet.
            from objectapp.whiteboardstore import save_board

            board["blocks"]["b-text"]["markdown"] = "Saved by the app"
            await asyncio.to_thread(save_board, space, NETWORK, board, version_of(data))
            # An orphan sidecar (no board .md) announces nothing either.
            (wb_dir / "Whiteboards/Orphan (2).whiteboard.json").write_bytes(b"{}")
            await asyncio.sleep(0.8)
            assert watcher.events.empty()
        finally:
            watcher.stop()

    asyncio.run(main())


def test_ui_accepts_whiteboard_key(wb_dir: Path):
    _space, c, _events = _client(wb_dir)
    rev = c.get("/api/ui").json()["revision"]
    r = c.put(
        "/api/ui",
        json={"patch": {"whiteboard": {"isEngineeringMode": True}}, "baseRevision": rev},
    )
    assert r.status_code == 200, r.text
    assert r.json()["ui"]["whiteboard"] == {"isEngineeringMode": True}
    rev = r.json()["revision"]
    for bad in ({"isEngineeringMode": "yes"}, {"zoom": True}, []):
        r = c.put("/api/ui", json={"patch": {"whiteboard": bad}, "baseRevision": rev})
        assert r.status_code == 422


def test_ink_svg_not_listed_as_image(wb_dir: Path):
    (wb_dir / "Attachments").mkdir()
    (wb_dir / "Attachments/diagram.svg").write_bytes(b"<svg xmlns='http://www.w3.org/2000/svg'/>")
    paths = [i["path"] for i in list_images(wb_dir)]
    assert paths == ["Attachments/diagram.svg"]
    _space, c, _events = _client(wb_dir)
    assert c.get("/api/file", params={"path": NETWORK_INK}).status_code == 404
    assert c.get("/api/file", params={"path": "Attachments/diagram.svg"}).status_code == 200
    assert [i["path"] for i in c.get("/api/images").json()] == ["Attachments/diagram.svg"]


def test_whiteboard_is_basic_with_icon():
    t = TypeDefinition.from_json({"id": "whiteboard", "name": "Whiteboard"})
    assert t.basic is True
    assert t.icon.val == "ph-presentation"


def test_whiteboard_role(wb_dir: Path):
    space = Space(wb_dir)
    assert role_of(whiteboard_type(space)) == "whiteboard"


def test_board_links_reach_backlinks_and_search(wb_dir: Path):
    space, c, _events = _client(wb_dir)
    with c:
        assert c.app.state.search.ready.wait(30)
        # The fixture board already links Router A through an entity block.
        assert NETWORK in [b["path"] for b in space.backlinks(ROUTER_A)]
        assert EMPTY not in [b["path"] for b in space.backlinks(ROUTER_A)]
        board = {
            "version": 1,
            "nodes": {"n1": {"id": "n1", "kind": "block", "blockId": "b1", "position": {"x": 0, "y": 0}}},
            "edges": {},
            "blocks": {"b1": {"type": "text", "markdown": "See [[Router A]] for quokkaword"}},
        }
        r = c.put("/api/whiteboard", json={"path": EMPTY, "board": board, "baseRevision": ""})
        assert r.status_code == 200, r.text
        assert EMPTY in [b["path"] for b in space.backlinks(ROUTER_A)]
        deadline = time.monotonic() + 10
        found: list[str] = []
        while time.monotonic() < deadline:
            res = c.get("/api/search", params={"q": "quokkaword"}).json()
            found = [x["path"] for x in res["results"]]
            if EMPTY in found:
                break
            time.sleep(0.1)
        assert EMPTY in found
    # The .md was never written by the board save.
    assert "quokkaword" not in (wb_dir / EMPTY).read_text("utf-8")
