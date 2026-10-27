"""The Task status hook: completing, reopening and recurring in one write (M4 Task 3)."""

import difflib
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.textfile import decode

NOW = datetime(2026, 10, 23, 10, 0, 0, 123000, tzinfo=UTC)
NOW_STAMP = "2026-10-23T10:00:00.123Z"
PLUS2 = timezone(timedelta(hours=2))


@pytest.fixture
def space(calendar_space_dir: Path) -> Space:
    s = Space(calendar_space_dir)
    s.clock = lambda: NOW
    s.tz = PLUS2
    return s


def _fm(root: Path, rel: str) -> dict:
    of = split_object(decode((root / rel).read_bytes()).text)
    return parse_fm(of.frontmatter_src)


def _status(space: Space, rel: str, text: str, **more):
    _of, _fm0, version = space.read(rel)
    return space.update_properties(rel, {"status": [text], **more}, version)


def _changed_keys(before: dict, after: dict) -> set[str]:
    keys = set(before) | set(after)
    return {k for k in keys if before.get(k) != after.get(k)}


def _diff(before: bytes, after: bytes) -> tuple[list[bytes], list[bytes]]:
    """(removed lines, added lines) of a byte-level line diff (line endings kept)."""
    a, b = before.splitlines(keepends=True), after.splitlines(keepends=True)
    removed, added = [], []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if op != "equal":
            removed += a[i1:i2]
            added += b[j1:j2]
    return removed, added


def _keys_of(lines: list[bytes]) -> set[str]:
    # M8: indented lines continue a block value (the occurrence log's entries).
    texts = (ln.decode("utf-8").lstrip("﻿") for ln in lines)
    return {t.split(":", 1)[0] for t in texts if not t[:1].isspace()}


def test_complete_nonrecurring_sets_completed(space: Space, calendar_space_dir: Path):
    rel = "Tasks/Buy stamps.md"
    before = _fm(calendar_space_dir, rel)
    result = _status(space, rel, "Done")
    after = _fm(calendar_space_dir, rel)
    assert _changed_keys(before, after) == {"status", "completed", "lastUpdated"}
    assert after["status"] == "Done"
    assert after["completed"] == NOW_STAMP
    assert result.task is not None
    assert (result.task.completed, result.task.advanced, result.task.date) == (True, False, None)
    assert result.frontmatter["completed"] == NOW_STAMP


def test_complete_recurring_advances_in_one_write(space: Space, calendar_space_dir: Path):
    rel = "Tasks/Weekly review.md"
    raw_before = (calendar_space_dir / rel).read_bytes()
    _of, _fm0, version = space.read(rel)
    result = space.update_properties(rel, {"status": ["Done"]}, version)
    after = _fm(calendar_space_dir, rel)
    assert after["date"] == "2026-10-28"  # first Wednesday on or after 2026-10-23
    assert after["status"] == "Not Started"
    assert after["completed"] == NOW_STAMP
    assert after["repeat"] == "every week" and after["remind"] == "1 day before at 09:00"
    assert result.task.completed and result.task.advanced
    assert result.task.date == {"start": "2026-10-28", "resolution": "day"}
    assert result.frontmatter["date"] == "2026-10-28"
    # One write: the version moved once, from the base version to the returned one.
    assert space.read(rel)[2] == result.version != version
    removed, added = _diff(raw_before, (calendar_space_dir / rel).read_bytes())
    assert _keys_of(removed) == {"date", "lastUpdated"}  # status stays "Not Started"
    # M8: the completion also appends `<old date> completed <now>` to the occurrence log.
    assert _keys_of(added) == {"date", "lastUpdated", "completed", "occurrenceLog"}
    assert after["occurrenceLog"] == "2026-10-14 completed 2026-10-23T10:00:00Z"


def test_complete_completion_mode_uses_completion_day(space: Space, calendar_space_dir: Path):
    rel = "Tasks/Water plants.md"  # date 2026-10-22, every 3 days after completion
    result = _status(space, rel, "Done")
    after = _fm(calendar_space_dir, rel)
    assert after["date"] == "2026-10-26"  # completion day 10-23 (local) + 3
    assert after["status"] == "Not Started"
    assert result.task.advanced


def test_complete_recurring_until_ended_completes_normally(space: Space, calendar_space_dir: Path):
    rel = "Tasks/Sprint retro.md"  # date 2026-10-23, every week until 2026-10-30
    space.clock = lambda: datetime(2026, 10, 24, 9, 0, tzinfo=UTC)
    result = _status(space, rel, "Done")
    after = _fm(calendar_space_dir, rel)
    # The next would be 10-30 (kept: until is inclusive); complete again from there.
    assert after["date"] == "2026-10-30" and after["status"] == "Not Started"
    assert result.task.advanced
    result = _status(space, rel, "Done")
    after = _fm(calendar_space_dir, rel)
    assert after["status"] == "Done" and after["date"] == "2026-10-30"
    assert after["repeat"] == "every week until 2026-10-30"
    assert result.task.completed and not result.task.advanced


def test_invalid_repeat_completes_normally(space: Space, calendar_space_dir: Path):
    rel = "Tasks/Clean garage.md"  # repeat: weekly (invalid)
    before = _fm(calendar_space_dir, rel)
    result = _status(space, rel, "Done")
    after = _fm(calendar_space_dir, rel)
    assert _changed_keys(before, after) == {"status", "completed", "lastUpdated"}
    assert after["repeat"] == "weekly"
    assert result.task.completed and not result.task.advanced


def test_repeat_without_date_completes_normally(space: Space, calendar_space_dir: Path):
    rel = "Tasks/Stretch.md"  # repeat: every day, no date
    before = _fm(calendar_space_dir, rel)
    result = _status(space, rel, "Done")
    after = _fm(calendar_space_dir, rel)
    assert _changed_keys(before, after) == {"status", "completed", "lastUpdated"}
    assert "date" not in after
    assert result.task.completed and not result.task.advanced


def test_reopen_clears_completed_only(space: Space, calendar_space_dir: Path):
    rel = "Tasks/Send invoice.md"  # Done, completed set
    before = _fm(calendar_space_dir, rel)
    result = _status(space, rel, "In Progress")
    after = _fm(calendar_space_dir, rel)
    assert _changed_keys(before, after) == {"status", "completed", "lastUpdated"}
    assert "completed" not in after and after["date"] == before["date"]
    assert (result.task.completed, result.task.advanced) == (False, False)


def test_same_category_change_no_extra_keys(space: Space, calendar_space_dir: Path):
    rel = "Tasks/Buy stamps.md"
    before = _fm(calendar_space_dir, rel)
    result = _status(space, rel, "Next Up")
    after = _fm(calendar_space_dir, rel)
    assert _changed_keys(before, after) == {"status", "lastUpdated"}
    assert result.task is None
    # In progress and blocked are not done either: no hook.
    assert _status(space, rel, "On Hold").task is None


def test_explicit_date_in_same_update_wins(space: Space, calendar_space_dir: Path):
    rel = "Tasks/Weekly review.md"
    explicit = {"start": "2026-12-01", "resolution": "day"}
    result = _status(space, rel, "Done", date=explicit)
    after = _fm(calendar_space_dir, rel)
    assert after["date"] == "2026-12-01"
    assert after["status"] == "Done"  # the caller chose the date: no advance
    assert after["completed"] == NOW_STAMP
    assert result.task.completed and not result.task.advanced

    # An explicit `completed` is kept too.
    rel = "Tasks/Buy stamps.md"
    stamp = {"start": "2026-10-20T08:00:00.000Z", "resolution": "time"}
    _status(space, rel, "Done", completed=stamp)
    assert _fm(calendar_space_dir, rel)["completed"] == "2026-10-20T08:00:00.000Z"


_CASES = [
    # (file, new status, changed keys, keys whose lines are added only)
    ("Tasks/crlf bom task.md", "Done", {"date", "lastUpdated"}, {"completed", "occurrenceLog"}),
    ("Tasks/no trailing newline.md", "Done", {"lastUpdated", "status"}, {"completed"}),
    ("Tasks/quoted date.md", "Done", {"lastUpdated", "status"}, {"completed"}),
    ("Tasks/Buy stamps.md", "Done", {"lastUpdated", "status"}, {"completed"}),
    ("Tasks/Send invoice.md", "Not Started", {"lastUpdated", "status", "completed"}, set()),
    ("Tasks/Fix leak.md", "Not Started", {"lastUpdated", "status"}, set()),
]


@pytest.mark.parametrize(("rel", "status", "changed", "inserted"), _CASES)
def test_status_hook_touches_only_expected_keys(
    space: Space, calendar_space_dir: Path, rel, status, changed, inserted
):
    raw_before = (calendar_space_dir / rel).read_bytes()
    _status(space, rel, status)
    raw_after = (calendar_space_dir / rel).read_bytes()
    removed, added = _diff(raw_before, raw_after)
    removed_keys = _keys_of(removed)
    if rel == "Tasks/Send invoice.md":
        assert removed_keys == changed and _keys_of(added) == {"lastUpdated", "status"}
    else:
        assert removed_keys == changed
        assert _keys_of(added) == changed | inserted

    text_before, text_after = raw_before.decode("utf-8"), raw_after.decode("utf-8")
    if "\r\n" in text_before:
        assert raw_after.startswith(b"\xef\xbb\xbf")
        assert all(ln.endswith(b"\r\n") for ln in added)
        assert raw_after.count(b"\n") == raw_after.count(b"\r\n")
    if not text_before.endswith("\n"):
        assert not text_after.endswith("\n")
    if "occurrenceLog" in inserted:  # M8: the log follows `completed`
        fm_lines = text_after.split("---", 2)[1].splitlines()
        assert fm_lines[-3].startswith("completed: ")
        assert fm_lines[-2:] == ["occurrenceLog: |-", "  2026-10-21 completed 2026-10-23T10:00:00Z"]
    elif "completed" in inserted:
        fm_lines = text_after.split("---", 2)[1].splitlines()
        assert fm_lines[-1].startswith("completed: ")  # inserted at the end of the block
    if rel == "Tasks/quoted date.md":
        assert "date: '2026-10-14'  # work on it" in text_after


def test_recurring_advance_keeps_quotes_and_comment(space: Space, calendar_space_dir: Path):
    rel = "Tasks/quoted date.md"
    _of, _fm0, version = space.read(rel)
    space.update_properties(rel, {"repeat": "every week"}, version)
    _status(space, rel, "Done")
    text = (calendar_space_dir / rel).read_text("utf-8")
    assert "date: '2026-10-28'  # work on it\n" in text
    assert _fm(calendar_space_dir, rel)["status"] == "Not Started"


def test_completed_equals_last_updated_under_fixed_clock(space: Space, calendar_space_dir: Path):
    rel = "Tasks/Buy stamps.md"
    _status(space, rel, "Done")
    after = _fm(calendar_space_dir, rel)
    assert after["completed"] == after["lastUpdated"] == NOW_STAMP

    path, _v = space.create_object("task", "New one")
    created = _fm(calendar_space_dir, path)
    assert created["createdAt"] == created["lastUpdated"] == NOW_STAMP


def test_other_types_unaffected(space: Space, calendar_space_dir: Path):
    # A Page with a free `status` key (no definition) gets no hook.
    page = calendar_space_dir / "Pages" / "Status page.md"
    page.write_text(
        "---\ntype: 'Page'\ntitle: Status page\nstatus: Not Started\n---\n", encoding="utf-8"
    )
    space.rescan_file("Pages/Status page.md")
    _of, _fm0, version = space.read("Pages/Status page.md")
    result = space.update_properties("Pages/Status page.md", {"status": "Done"}, version)
    after = _fm(calendar_space_dir, "Pages/Status page.md")
    assert after["status"] == "Done" and "completed" not in after
    assert result.task is None


def test_custom_status_type_unaffected(space: Space, calendar_space_dir: Path):
    t, rev = space.refresh_type("meeting")
    from objectapp.typemodel import PropertyDefinition, label_options

    t.propertyDefinitions.append(
        PropertyDefinition(
            id="status", key="status", name="Status", type="label",
            options={"isArray": False, "set": label_options(["Not Started", "Done"])},
        )
    )  # fmt: skip
    space.save_type(t, rev)
    path, _v = space.create_object("meeting", "Planning")
    _of, _fm0, version = space.read(path)
    result = space.update_properties(path, {"status": ["Done"]}, version)
    assert result.task is None
    assert "completed" not in _fm(calendar_space_dir, path)


def test_time_resolution_task_advances_keeping_time(space: Space, calendar_space_dir: Path):
    rel = "Tasks/Call dentist.md"  # date 2026-10-23T08:30:00.000Z (10:30 local at +02:00)
    _of, _fm0, version = space.read(rel)
    space.update_properties(rel, {"repeat": "every day"}, version)
    result = _status(space, rel, "Done")
    after = _fm(calendar_space_dir, rel)
    # Today (local) is 10-23; the next daily occurrence on or after today is 10-24.
    assert after["date"] == "2026-10-24T08:30:00.000Z"
    assert result.task.date == {"start": "2026-10-24T08:30:00.000Z", "resolution": "time"}


def test_time_resolution_keeps_wall_clock_across_dst(calendar_space_dir: Path):
    zoneinfo = pytest.importorskip("zoneinfo")
    try:
        berlin = zoneinfo.ZoneInfo("Europe/Berlin")
    except zoneinfo.ZoneInfoNotFoundError:
        pytest.skip("tzdata has no Europe/Berlin on this machine")
    space = Space(calendar_space_dir)
    space.tz = berlin
    space.clock = lambda: datetime(2026, 10, 24, 12, 0, tzinfo=UTC)
    rel = "Tasks/Call dentist.md"  # 08:30Z on 10-23 = 10:30 CEST
    _of, _fm0, version = space.read(rel)
    space.update_properties(rel, {"repeat": "every day"}, version)
    space.clock = lambda: datetime(2026, 10, 25, 12, 0, tzinfo=UTC)
    _status(space, rel, "Done")
    # 10:30 local on 10-25 is CET (+01:00): 09:30Z.
    assert _fm(calendar_space_dir, rel)["date"] == "2026-10-25T09:30:00.000Z"


def test_put_properties_returns_task_result(space: Space, calendar_space_dir: Path):
    client = TestClient(create_app(space, None, watch=False))
    rel = "Tasks/Weekly review.md"
    obj = client.get("/api/object", params={"path": rel}).json()
    r = client.put(
        "/api/object/properties",
        json={"path": rel, "updates": {"status": ["Done"]}, "baseVersion": obj["version"]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["task"] == {
        "completed": True, "advanced": True, "date": {"start": "2026-10-28", "resolution": "day"}
    }  # fmt: skip
    assert body["frontmatter"]["date"] == "2026-10-28"
    assert body["frontmatter"]["completed"] == NOW_STAMP

    # A same-category change carries no `task`.
    r = client.put(
        "/api/object/properties",
        json={"path": rel, "updates": {"status": ["Next Up"]}, "baseVersion": body["version"]},
    )
    assert r.status_code == 200 and "task" not in r.json()
