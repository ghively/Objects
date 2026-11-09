"""`ChangeEvent.linked`: the paths whose backlinks an object change may have altered.

The Tasks dashboard (``useRows`` with ``backlinks``) used to reload every row whenever an
object outside its rows changed; with ``linked`` it refreshes only the rows named. The field
is the union of the changed file's resolved link targets before and after the change, ``None``
when the index can't say (it had not been built before the change).
"""

import asyncio
import json
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app, event_payload
from objectapp.space import Space, version_of
from objectapp.watcher import RESYNC_AFTER, RESYNC_PATH, ChangeEvent, SpaceWatcher, _collapsed

ADA = "People/Ada Lovelace.md"
BABBAGE = "People/Charles Babbage.md"
ENGINE = "Pages/Analytical Engine.md"
LOOSE = "Tasks/Loose task.md"
PAPER = "Tasks/Write paper.md"


def _client(root: Path):
    space = Space(root)
    app = create_app(space, None)
    published: list[ChangeEvent] = []
    app.state.hub.publish = published.append
    return space, TestClient(app), published


def _changed(published: list[ChangeEvent], path: str) -> ChangeEvent:
    found = [e for e in published if e.kind == "changed" and e.path == path]
    assert found, [(e.kind, e.path) for e in published]
    return found[0]


def _put_body(c: TestClient, path: str, body: str) -> None:
    v = c.get("/api/object", params={"path": path}).json()["version"]
    r = c.put("/api/object/body", json={"path": path, "body": body, "baseVersion": v})
    assert r.status_code == 200, r.text


# -- UI-originated writes (the server's announce) --------------------------------------------


def test_body_edit_adding_a_link_names_the_target(links_space_dir: Path):
    space, c, published = _client(links_space_dir)
    with c:
        assert space.backlinks(ADA)  # the index knows the links before the change
        _put_body(c, LOOSE, "See [[Ada]].\n")
        assert _changed(published, LOOSE).linked == (ADA,)


def test_body_edit_removing_a_link_names_the_old_target(links_space_dir: Path):
    space, c, published = _client(links_space_dir)
    with c:
        space.backlinks(ENGINE)
        _put_body(c, PAPER, "Nothing left.\n")
        assert _changed(published, PAPER).linked == (ENGINE,)


def test_body_edit_swapping_a_link_names_both(links_space_dir: Path):
    space, c, published = _client(links_space_dir)
    with c:
        space.backlinks(ENGINE)
        _put_body(c, PAPER, "Now about [[Ada]] instead.\n")
        assert _changed(published, PAPER).linked == (ENGINE, ADA)  # sorted by path


def test_body_edit_changing_no_links_is_an_empty_list(links_space_dir: Path):
    space, c, published = _client(links_space_dir)
    with c:
        space.backlinks(ADA)
        _put_body(c, LOOSE, "Nothing links here. Still nothing.\n")
        ev = _changed(published, LOOSE)
        assert ev.linked == ()
        assert ev.linked is not None


def test_body_edit_keeping_a_link_names_its_target(links_space_dir: Path):
    # The link text may have changed even when it resolves to the same object.
    space, c, published = _client(links_space_dir)
    with c:
        space.backlinks(ENGINE)
        _put_body(c, PAPER, "Write up [[Analytical Engine]] for the journal, soon.\n")
        assert _changed(published, PAPER).linked == (ENGINE,)


def test_entity_property_change_names_the_targets(links_space_dir: Path):
    space, c, published = _client(links_space_dir)
    with c:
        space.backlinks(ADA)
        v = c.get("/api/object", params={"path": BABBAGE}).json()["version"]
        r = c.put(
            "/api/object/properties",
            json={"path": BABBAGE, "updates": {"manager": None}, "baseVersion": v},
        )
        assert r.status_code == 200, r.text
        assert _changed(published, BABBAGE).linked == (ADA,)


def test_delete_names_the_old_targets(links_space_dir: Path):
    space, c, published = _client(links_space_dir)
    with c:
        space.backlinks(ADA)
        r = c.delete("/api/object", params={"path": BABBAGE})
        assert r.status_code == 200, r.text
        deleted = [e for e in published if e.kind == "deleted"]
        assert deleted and deleted[0].path == BABBAGE
        # Its own target (tags are not links), and itself: the objects linking to it lost that link.
        assert deleted[0].linked == (ADA, BABBAGE)


def test_unknown_before_the_index_is_built(links_space_dir: Path):
    space, c, published = _client(links_space_dir)
    with c:
        # No read of the links yet (``GET /api/object`` would build the index): unknown.
        r = c.put(
            "/api/object/body",
            json={"path": LOOSE, "body": "See [[Ada]].\n", "baseVersion": space.cached_version(LOOSE)},
        )
        assert r.status_code == 200, r.text
        assert _changed(published, LOOSE).linked is None
        published.clear()
        # The first read builds the index with that change pending; it can't tell whether the
        # change was announced yet, so the next event is unknown too, and the one after known.
        assert space.backlinks(ADA)
        _put_body(c, LOOSE, "Nothing.\n")
        assert _changed(published, LOOSE).linked is None
        published.clear()
        _put_body(c, LOOSE, "See [[Ada]] again.\n")
        assert _changed(published, LOOSE).linked == (ADA,)


def test_other_kinds_carry_no_linked(links_space_dir: Path):
    _space, c, published = _client(links_space_dir)
    with c:
        rev = c.get("/api/ui").json()["revision"]
        r = c.put("/api/ui", json={"patch": {"reminders": {"enabled": False}}, "baseRevision": rev})
        assert r.status_code == 200
        assert [e.linked for e in published if e.kind == "ui"] == [None]


# -- the serialised event ----------------------------------------------------------------------


def test_payload_holds_linked_only_when_known():
    with_links = ChangeEvent("changed", LOOSE, "v", origin="w1", linked=(ADA,))
    assert event_payload(with_links) == {
        "kind": "changed", "path": LOOSE, "version": "v", "origin": "w1", "oldPath": None,
        "linked": [ADA],
    }
    assert "linked" not in event_payload(ChangeEvent("changed", LOOSE, "v"))
    assert "linked" not in event_payload(ChangeEvent("types", "*", None))
    assert event_payload(ChangeEvent("changed", LOOSE, "v", linked=()))["linked"] == []
    json.dumps(event_payload(with_links))  # a tuple serialises as a JSON array


def test_collapse_keeps_working_with_linked():
    events = [
        ChangeEvent("changed", f"Pages/{i}.md", "v", linked=(ADA,)) for i in range(RESYNC_AFTER + 1)
    ]
    assert _collapsed(events) == [ChangeEvent("types", RESYNC_PATH, None)]
    assert _collapsed(events[:RESYNC_AFTER]) == events[:RESYNC_AFTER]


# -- external edits (the watcher) ---------------------------------------------------------------


async def _next_event(watcher: SpaceWatcher, timeout: float = 2.0) -> ChangeEvent:
    return await asyncio.wait_for(watcher.events.get(), timeout)


def _run(space_dir: Path, scenario):
    async def main():
        space = Space(space_dir)
        watcher = SpaceWatcher(space, asyncio.get_running_loop())
        watcher.start()
        try:
            await asyncio.sleep(0.2)
            return await scenario(space, watcher)
        finally:
            watcher.stop()

    return asyncio.run(main())


def test_external_edit_adding_a_link_names_the_target(links_space_dir: Path):
    target = links_space_dir / LOOSE

    async def scenario(space: Space, watcher: SpaceWatcher):
        space.backlinks(ADA)
        data = target.read_bytes().replace(b"Nothing links here.", b"See [[Ada]].")
        target.write_bytes(data)
        ev = await _next_event(watcher)
        assert ev == ChangeEvent("changed", LOOSE, version_of(data), linked=(ADA,))

    _run(links_space_dir, scenario)


def test_external_delete_names_the_old_targets(links_space_dir: Path):
    target = links_space_dir / PAPER

    async def scenario(space: Space, watcher: SpaceWatcher):
        space.backlinks(ENGINE)
        target.unlink()
        ev = await _next_event(watcher)
        assert ev == ChangeEvent("deleted", PAPER, None, linked=(ENGINE,))

    _run(links_space_dir, scenario)


def test_external_edit_before_the_index_is_built_is_unknown(links_space_dir: Path):
    target = links_space_dir / LOOSE

    async def scenario(space: Space, watcher: SpaceWatcher):
        data = target.read_bytes().replace(b"Nothing links here.", b"See [[Ada]].")
        target.write_bytes(data)
        ev = await _next_event(watcher)
        assert (ev.kind, ev.linked) == ("changed", None)

    _run(links_space_dir, scenario)


def test_sse_payload_names_linked(links_space_dir: Path):
    space = Space(links_space_dir)
    app = create_app(space, None)
    target = links_space_dir / LOOSE
    with TestClient(app) as client:
        space.backlinks(ADA)
        with client.stream("GET", "/api/events") as resp:
            assert resp.status_code == 200

            def touch():
                time.sleep(0.4)
                target.write_bytes(target.read_bytes().replace(b"Nothing links here.", b"See [[Ada]]."))

            threading.Thread(target=touch, daemon=True).start()
            event_name = None
            deadline = time.monotonic() + 5
            for line in resp.iter_lines():
                if line.startswith("event:"):
                    event_name = line.split(":", 1)[1].strip()
                elif line.startswith("data:") and event_name == "change":
                    payload = json.loads(line.split(":", 1)[1])
                    assert payload["kind"] == "changed"
                    assert payload["path"] == LOOSE
                    assert payload["linked"] == [ADA]
                    break
                if time.monotonic() > deadline:
                    pytest.fail("no change event on the SSE stream")
            app.state.hub.close()
