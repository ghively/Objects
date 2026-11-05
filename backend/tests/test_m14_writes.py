"""M14: the write funnel's ``after_write`` hook (`WriteNotice`), the write origin, and the
``button`` property kind (no value, read-only)."""

from __future__ import annotations

from pathlib import Path

import pytest
from m14support import NOW, REPORT, m14_space
from objectapp import writeorigin
from objectapp.propvalues import InvalidValue, decode_value
from objectapp.relink import rewrite_tag_lists
from objectapp.space import Space, WriteNotice
from objectapp.typemodel import PropertyDefinition


@pytest.fixture
def space(tmp_path: Path) -> Space:
    s = Space(m14_space(tmp_path))
    s.clock = lambda: NOW
    return s


def record(space: Space) -> list[WriteNotice]:
    seen: list[WriteNotice] = []
    space.after_write = seen.append
    return seen


def version(space: Space, path: str) -> str:
    return space.read(path)[2]


def test_a_property_edit_is_one_changed_notice_with_before_and_after(space: Space):
    seen = record(space)
    space.update_properties(REPORT, {"priority": "High"}, version(space, REPORT))
    assert len(seen) == 1
    n = seen[0]
    assert (n.kind, n.path, n.origin) == ("changed", REPORT, None)
    assert n.before is not None and "priority" not in n.before
    assert n.after["priority"] == "High" and n.after["status"] == "In Progress"


def test_body_saves_unstamped_rewrites_and_unchanged_edits_are_silent(space: Space):
    seen = record(space)
    space.save_body(REPORT, "New body\n", version(space, REPORT))
    space.update_properties(REPORT, {}, version(space, REPORT))  # nothing changes
    space.ensure_id("Pages/Day links.md")  # unstamped
    edit = space._fm_edit(lambda src, fm: rewrite_tag_lists(src, fm, "Old tag", "Older tag"))
    space._rewrite_other("Pages/Day links.md", edit)  # unstamped type-driven rewrite
    assert seen == []


def test_the_create_paths_announce_created(space: Space):
    seen = record(space)
    task, _ = space.create_object("task", "Fresh")
    copy, _v, _synced = space.duplicate_object(REPORT)
    note, _ = space.create_daily_note("2026-11-05")
    tag, created = space.ensure_tag("Brand new tag")
    assert created
    assert [(n.kind, n.path) for n in seen] == [
        ("created", task),
        ("created", copy),
        ("created", note),
        ("created", tag),
    ]
    assert all(n.before is None for n in seen)
    assert seen[0].after["title"] == "Fresh"
    seen.clear()
    space.ensure_tag("brand NEW tag")  # exists: no create, no notice
    assert seen == []


def test_templates_and_restores_are_silent(space: Space):
    seen = record(space)
    space.create_template("task", "Weekly")
    path, _ = space.create_object("task", "Doomed")
    seen.clear()
    item = space.delete_object(path, version(space, path))
    space.restore(item.id)
    assert seen == []


def test_a_version_restore_is_silent(space: Space):
    seen = record(space)
    data = (space.root / REPORT).read_bytes()
    space.update_properties(REPORT, {"priority": "Low"}, version(space, REPORT))
    seen.clear()
    assert space._write_exact(REPORT, version(space, REPORT), data)
    assert seen == []


def test_the_origin_rides_along_on_the_same_thread(space: Space):
    seen = record(space)
    with writeorigin.acting_as("automation:R1"):
        space.update_properties(REPORT, {"priority": "Low"}, version(space, REPORT))
        space.create_object("page", "Made by a rule")
    space.update_properties(REPORT, {"priority": "High"}, version(space, REPORT))
    assert [n.origin for n in seen] == ["automation:R1", "automation:R1", None]
    assert writeorigin.current() is None


def test_a_failing_hook_never_stops_the_write(space: Space):
    def boom(_notice: WriteNotice) -> None:
        raise RuntimeError("no")

    space.after_write = boom
    result = space.update_properties(REPORT, {"priority": "Low"}, version(space, REPORT))
    assert result.frontmatter["priority"] == "Low"
    path, _ = space.create_object("task", "Still made")
    assert (space.root / path).is_file()


def test_rename_and_relation_sync_are_changed_notices(space: Space):
    seen = record(space)
    space.rename_object(REPORT, "Submit the report", version(space, REPORT))
    assert seen and seen[0].kind == "changed" and seen[0].after["title"] == "Submit the report"
    seen.clear()
    page, _ = space.create_object("page", "Notes page")
    seen.clear()
    space.update_properties(page, {"related": [{"target": "Submit the report", "path": None}]},
                            version(space, page))  # fmt: skip
    paths = [n.path for n in seen]
    assert page in paths and any(p.startswith("Tasks/Submit the report") for p in paths)


def test_button_properties_hold_no_value():
    pdef = PropertyDefinition(id="go", key="go", name="Go", type="button", options={"ruleId": None})
    assert decode_value(pdef, "anything") is None
    from objectapp.propvalues import encode_value

    with pytest.raises(InvalidValue):
        encode_value(pdef, None)


def test_put_properties_refuses_a_button_key(space: Space):
    t = space.type_by_id("task")
    assert t is not None
    t.propertyDefinitions.append(
        PropertyDefinition(id="go", key="go", name="Go", type="button", options={"ruleId": None})
    )
    with pytest.raises(InvalidValue):
        space.update_properties(REPORT, {"go": None}, version(space, REPORT))


def test_a_rename_or_type_change_is_announced_once_the_file_has_moved(space: Space):
    # Review M14 #3: the notice of the stamped write inside a rename (or a type change) is
    # handed on only when the whole locked operation is over, so whoever gets it finds the
    # object at its new path (and the space's lock is free).
    seen: list[tuple[WriteNotice, bool, bool]] = []

    def hook(n: WriteNotice) -> None:
        seen.append((n, (space.root / n.path).is_file(), space._lock._is_owned()))

    space.after_write = hook
    space.rename_object(REPORT, "Submit the report", version(space, REPORT))
    assert [(n.kind, n.path, on_disk, held) for n, on_disk, held in seen] == [
        ("changed", REPORT, False, False)]  # fmt: skip
    assert (space.root / "Tasks/Submit the report.md").is_file()
    seen.clear()
    moved = "Tasks/Submit the report.md"
    result = space.change_type(moved, "page", {}, version(space, moved))
    assert result.path.startswith("Pages/")
    assert [(n.kind, on_disk, held) for n, on_disk, held in seen] == [("changed", False, False)]
    assert seen[0][0].after["type"] == "Page"


def test_notices_wait_for_the_outermost_lock(space: Space):
    seen = record(space)
    with space._lock:
        with space._lock:
            space.update_properties(REPORT, {"priority": "Low"}, version(space, REPORT))
        assert seen == []
    assert [n.after["priority"] for n in seen] == ["Low"]
    # A write outside any lock is announced at once, as before.
    space.update_properties(REPORT, {"priority": "High"}, version(space, REPORT))
    assert [n.after["priority"] for n in seen] == ["Low", "High"]


@pytest.mark.parametrize("path", ["Tasks/Pay rent.md", "Tasks/Stretch.md"])
def test_completing_a_repeating_task_carries_the_requested_status(space: Space, path: str):
    # Review M14 #4: completing a repeating Task resets its status in the same write; the
    # notice carries the status the caller asked for, so "changes to Done" can still match.
    seen = record(space)
    result = space.update_properties(path, {"status": "Done"}, version(space, path))
    assert result.task is not None and result.task.advanced
    assert len(seen) == 1
    n = seen[0]
    assert n.after["status"] == "Not Started"
    assert n.requested == {"status": "Done"}
    seen.clear()
    space.update_properties(path, {"priority": "High"}, version(space, path))
    assert seen[0].requested is None
