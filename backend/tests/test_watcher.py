import asyncio
import json
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.server import create_app
from objectapp.space import Space, version_of
from objectapp.watcher import ChangeEvent, SpaceWatcher

QUIET = 0.8  # seconds to wait when asserting that nothing happens


async def _next_event(watcher: SpaceWatcher, timeout: float = 2.0) -> ChangeEvent:
    return await asyncio.wait_for(watcher.events.get(), timeout)


async def _drain(watcher: SpaceWatcher, seconds: float) -> list[ChangeEvent]:
    await asyncio.sleep(seconds)
    out = []
    while not watcher.events.empty():
        out.append(watcher.events.get_nowait())
    return out


def _run(space_dir: Path, scenario):
    """Run `scenario(space, watcher)` with a started watcher on a fresh loop."""

    async def main():
        space = Space(space_dir)
        watcher = SpaceWatcher(space, asyncio.get_running_loop())
        watcher.start()
        try:
            await asyncio.sleep(0.2)  # let the observer settle
            return await scenario(space, watcher)
        finally:
            watcher.stop()

    return asyncio.run(main())


def test_external_edit_emits_changed(space_dir: Path):
    target = space_dir / "Pages" / "Alpha.md"

    async def scenario(space: Space, watcher: SpaceWatcher):
        assert space.get("Pages/Alpha.md").title == "Alpha"
        data = target.read_bytes().replace(b"title: Alpha", b"title: Alpha renamed")
        target.write_bytes(data)
        ev = await _next_event(watcher)
        assert ev == ChangeEvent(kind="changed", path="Pages/Alpha.md", version=version_of(data))
        assert space.get("Pages/Alpha.md").title == "Alpha renamed"
        # Debounced: one burst of writes is one event.
        assert await _drain(watcher, QUIET) == []

    _run(space_dir, scenario)


def test_own_save_emits_nothing(space_dir: Path):
    async def scenario(space: Space, watcher: SpaceWatcher):
        of, _fm, version = space.read("Tasks/Fix printer.md")
        await asyncio.to_thread(space.save_body, "Tasks/Fix printer.md", of.body + "More.\n", version)
        assert await _drain(watcher, QUIET) == []
        # The watcher is still alive for external edits afterwards.
        target = space_dir / "Tasks" / "Fix printer.md"
        target.write_bytes(target.read_bytes() + b"external\r\n")
        ev = await _next_event(watcher)
        assert (ev.kind, ev.path) == ("changed", "Tasks/Fix printer.md")

    _run(space_dir, scenario)


def test_new_file_emits_created_and_is_listed(space_dir: Path):
    async def scenario(space: Space, watcher: SpaceWatcher):
        new = space_dir / "Pages" / "Fresh.md"
        data = b"---\ntype: Page\ntitle: Fresh one\n---\n\nHello.\n"
        new.write_bytes(data)
        ev = await _next_event(watcher)
        assert ev == ChangeEvent(kind="created", path="Pages/Fresh.md", version=version_of(data))
        assert "Pages/Fresh.md" in [s.path for s in space.list("page")]
        assert space.get("Pages/Fresh.md").title == "Fresh one"

        new.unlink()
        ev = await _next_event(watcher)
        assert ev == ChangeEvent(kind="deleted", path="Pages/Fresh.md", version=None)
        assert "Pages/Fresh.md" not in [s.path for s in space.list()]

    _run(space_dir, scenario)


def test_ignored_folders_silent(space_dir: Path):
    async def scenario(space: Space, watcher: SpaceWatcher):
        (space_dir / ".capacities-cache" / "ignored.md").write_text("changed\n")
        (space_dir / ".capacities-cache" / "new.md").write_text("new\n")
        (space_dir / ".hidden" / "secret.md").write_text("changed\n")
        types_dir = space_dir / ".capacities" / "types"
        types_dir.mkdir(parents=True, exist_ok=True)
        (types_dir / "x.json").write_text("{}")
        (space_dir / "Pages" / "notes.txt").write_text("not an object\n")
        (space_dir / "Pages" / ".dotfile.md").write_text("hidden\n")
        assert await _drain(watcher, QUIET) == []
        assert all(not s.path.startswith(".") for s in space.list())

    _run(space_dir, scenario)


def test_sse_streams_change_events(space_dir: Path):
    space = Space(space_dir)
    app = create_app(space, None)
    target = space_dir / "People" / "Ada Lovelace.md"
    with TestClient(app) as client:
        with client.stream("GET", "/api/events") as resp:
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/event-stream")

            def touch():
                time.sleep(0.4)
                target.write_bytes(target.read_bytes() + b"\nAppended.\n")

            threading.Thread(target=touch, daemon=True).start()
            event_name = None
            deadline = time.monotonic() + 5
            for line in resp.iter_lines():
                if line.startswith("event:"):
                    event_name = line.split(":", 1)[1].strip()
                elif line.startswith("data:") and event_name == "change":
                    payload = json.loads(line.split(":", 1)[1])
                    assert payload["kind"] == "changed"
                    assert payload["path"] == "People/Ada Lovelace.md"
                    assert payload["version"] == version_of(target.read_bytes())
                    break
                if time.monotonic() > deadline:
                    pytest.fail("no change event on the SSE stream")
            app.state.hub.close()


def test_watcher_silent_for_property_update_and_sync(space_dir: Path):
    from test_properties import _synced_space

    _synced_space(space_dir)

    async def scenario(space: Space, watcher: SpaceWatcher):
        _of, _fm, version = space.read("A/A1.md")
        result = await asyncio.to_thread(
            space.update_properties, "A/A1.md", {"rel": ["B1"]}, version
        )
        assert result.synced == ["B/B1.md"]
        assert await _drain(watcher, QUIET) == []

    _run(space_dir, scenario)


def test_change_event_has_old_path_and_new_kinds():
    ev = ChangeEvent(kind="renamed", path="People/Ada King.md", version="v", oldPath="People/Ada.md")
    assert ev.oldPath == "People/Ada.md"
    assert ChangeEvent(kind="types", path="task", version=None).oldPath is None


def test_own_delete_emits_no_event(space_dir: Path):
    async def scenario(space: Space, watcher: SpaceWatcher):
        item = await asyncio.to_thread(space.delete_object, "Pages/Alpha.md")
        assert await _drain(watcher, QUIET) == []
        await asyncio.to_thread(space.restore, item.id)
        assert await _drain(watcher, QUIET) == []
        # External deletes are still reported.
        (space_dir / "Pages" / "Alpha.md").unlink()
        ev = await _next_event(watcher)
        assert ev == ChangeEvent(kind="deleted", path="Pages/Alpha.md", version=None)

    _run(space_dir, scenario)


def test_create_emits_no_watcher_event(space_dir: Path):
    async def scenario(space: Space, watcher: SpaceWatcher):
        path, _version = await asyncio.to_thread(space.create_object, "task", "Plan sprint")
        assert path == "Tasks/Plan sprint.md"
        assert await _drain(watcher, QUIET) == []

    _run(space_dir, scenario)


def test_watcher_silent_for_type_cascade(space_dir: Path):
    import copy

    from objectapp.typemodel import type_revision

    async def scenario(space: Space, watcher: SpaceWatcher):
        t = copy.deepcopy(space.type_by_id("server"))
        t.name = "Machine"
        t.propertyDefinitions = [p for p in t.propertyDefinitions if p.key != "cores"]
        result = await asyncio.to_thread(
            space.save_type, t, type_revision(space.root, "server"), True
        )
        assert result.rewritten == ["Servers/Alpha.md"]
        assert await _drain(watcher, QUIET) == []
        await asyncio.to_thread(space.delete_type, "server", True)
        assert await _drain(watcher, QUIET) == []

    _run(space_dir, scenario)


def test_watcher_silent_for_rename_and_relinked_referrer(space_dir: Path):
    async def scenario(space: Space, watcher: SpaceWatcher):
        _of, _fm, version = space.read("People/Ada Lovelace.md")
        result = await asyncio.to_thread(
            space.rename_object, "People/Ada Lovelace.md", "Ada King", version
        )
        assert result.path == "People/Ada King.md"
        assert result.relinked == ["Servers/Alpha.md", "Tasks/Write docs.md"]
        assert await _drain(watcher, QUIET) == []
        # A case-only rename is silent too.
        result = await asyncio.to_thread(
            space.rename_object, result.path, "Ada king", result.version
        )
        assert result.path == "People/Ada king.md"
        assert await _drain(watcher, QUIET) == []
        assert [s.path for s in space.list() if s.path.startswith("People/")] == [
            "People/Ada king.md"
        ]
        # External edits are still reported.
        target = space_dir / "People" / "Ada king.md"
        target.write_bytes(target.read_bytes() + b"external\n")
        ev = await _next_event(watcher)
        assert (ev.kind, ev.path) == ("changed", "People/Ada king.md")

    _run(space_dir, scenario)


def test_relpath_survives_vanished_parent(space_dir: Path, monkeypatch):
    """Emptying the Trash removes a type's folder while watchdog still reports files in it.

    On Windows `Path.resolve()` then raises OSError (WinError 1168), which used to kill
    the watcher thread, so no external change was reported after "Empty Trash".
    """
    space = Space(space_dir)
    watcher = SpaceWatcher(space, asyncio.new_event_loop())

    def boom(self, strict=False):
        raise OSError(1168, "Element not found")

    monkeypatch.setattr(Path, "resolve", boom)
    gone = space.root / ".capacities" / "trash" / "types" / "X" / "manifest.json"
    assert watcher._relpath(str(gone)) is None
    assert watcher._relpath(str(space.root / "Pages" / "Gone.md")) == "Pages/Gone.md"
    watcher._touch_folder(str(space.root / "Pages"))  # must not raise
    watcher.stop()
