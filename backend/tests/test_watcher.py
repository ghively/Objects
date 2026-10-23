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
