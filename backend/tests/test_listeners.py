"""`Space.add_listener`: every change to the scan is announced (M5 Task 2)."""

import copy
import logging
from pathlib import Path

from objectapp.space import Space, SpaceChange
from objectapp.typemodel import type_revision

REL = "Pages/Dangling.md"


def _record(space: Space) -> list[SpaceChange]:
    seen: list[SpaceChange] = []
    space.add_listener(seen.append)
    return seen


def test_listener_fires_on_every_change(links_space_dir: Path):
    space = Space(links_space_dir)
    seen = _record(space)

    # A write.
    space.save_body(REL, "Edited.\n", space.cached_version(REL))
    assert seen == [SpaceChange("object", REL)]

    # A rename: the old path and the new one (plus relinked referrers, if any).
    seen.clear()
    new = space.rename_object(REL, "Dangling two", space.cached_version(REL)).path
    assert SpaceChange("object", REL) in seen
    assert SpaceChange("object", new) in seen

    # A delete to the trash.
    seen.clear()
    item = space.delete_object(new, space.cached_version(new))
    assert SpaceChange("object", new) in seen
    assert new not in space._summaries

    # A restore.
    seen.clear()
    space.restore(item.id)
    assert SpaceChange("object", new) in seen

    # An external change, as the watcher reports it.
    seen.clear()
    (links_space_dir / new).write_text(
        "---\ntype: 'Page'\ntitle: Outside\n---\n\nHi\n", "utf-8"
    )
    space.rescan_file(new)
    assert seen == [SpaceChange("object", new)]
    # The file gone, as the watcher reports it.
    seen.clear()
    (links_space_dir / new).unlink()
    space.rescan_file(new)
    assert seen == [SpaceChange("object", new)]

    # A type save.
    seen.clear()
    t, rev = space.refresh_type("person")
    edited = copy.deepcopy(t)
    edited.description = "People we know"
    space.save_type(edited, rev)
    assert SpaceChange("types", None) in seen


def test_unsubscribe_stops_calls(links_space_dir: Path):
    space = Space(links_space_dir)
    seen: list[SpaceChange] = []
    off = space.add_listener(seen.append)
    off()
    off()
    space.save_body(REL, "Edited.\n", space.cached_version(REL))
    assert seen == []


def test_raising_listener_is_logged_and_write_succeeds(links_space_dir: Path, caplog):
    space = Space(links_space_dir)

    def boom(_change):
        raise RuntimeError("listener failed")

    space.add_listener(boom)
    seen = _record(space)
    with caplog.at_level(logging.ERROR):
        version = space.save_body(REL, "Still saved.\n", space.cached_version(REL))
    assert version == space.cached_version(REL)
    assert (links_space_dir / REL).read_text("utf-8").endswith("Still saved.\n")
    assert seen == [SpaceChange("object", REL)]
    assert "listener" in caplog.text


def test_type_created_fires_types(links_space_dir: Path):
    space = Space(links_space_dir)
    seen = _record(space)
    t = space.create_type("Book", "Books")
    assert SpaceChange("types", None) in seen
    assert type_revision(space.root, t.id)
