"""M23 Task 3: focus lines in the daily note (``workfocus``) and today's meetings (``workday``).

Run on a copy of the overlay space (``m23_helpers.copy_space``) with the clock at
2026-11-05T10:00Z and the space time zone UTC.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

import m23_helpers
import pytest

from objectapp import workday, workfocus
from objectapp.propvalues import InvalidValue
from objectapp.space import Conflict, Space

NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
NOTE = "DailyNotes/2026-11-05.md"
BOM = b"\xef\xbb\xbf"


@pytest.fixture
def state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(path))
    return path


def _open(root: Path) -> Space:
    s = Space(root)
    s.clock = lambda: NOW
    s.tz = UTC
    return s


@pytest.fixture
def root(tmp_path: Path, state: Path) -> Path:
    return m23_helpers.copy_space(tmp_path)


@pytest.fixture
def space(root: Path) -> Space:
    return _open(root)


def _snapshot(root: Path) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    for dirpath, _dirs, files in os.walk(root):
        if ".object-cache" in Path(dirpath).relative_to(root).parts:
            continue
        for f in files:
            p = Path(dirpath) / f
            out[p.relative_to(root).as_posix()] = p.read_bytes()
    return out


def _dirs(root: Path) -> list[str]:
    return sorted(
        p.relative_to(root).as_posix()
        for p in root.rglob("*")
        if p.is_dir() and ".object-cache" not in p.relative_to(root).parts
    )


# -- parsing ------------------------------------------------------------------


def test_parse_focus_items(space: Space) -> None:
    of, _fm, _v = space.read(NOTE)
    assert workfocus.parse_focus(of.body) == [
        "Clear the jams on [[Printer jams on line 3]]",
        "Finish [[Scanner rollout]]",
        "Plan next week",
    ]
    fenced = "```\n## Focus\n- not this\n```\n\n## Focus\n\n- this one\n"
    assert workfocus.parse_focus(fenced) == ["this one"]
    assert workfocus.parse_focus("# Day\n\n### focus\n\n* small\n1. numbered\n") == [
        "small",
        "numbered",
    ]
    nested = "## Focus\n\n- parent\n  - child\n    more\n- second\n## Next\n- outside\n"
    assert workfocus.parse_focus(nested) == ["parent", "second"]
    # A sub-heading ends nothing; a heading of the same level ends the section.
    deeper = "## Focus\n\n- a\n### Detail\n- b\n## Other\n- c\n"
    assert workfocus.parse_focus(deeper) == ["a", "b"]
    assert workfocus.parse_focus("## Plan\n\n- x\n") == []


def test_focus_day_links(space: Space) -> None:
    day = workfocus.focus_day(space, "2026-11-05")
    assert day["day"] == "2026-11-05"
    assert day["notePath"] == NOTE
    assert day["hasSection"] is True
    assert day["version"] == space.read(NOTE)[2]
    lines = day["lines"]
    assert [ln["n"] for ln in lines] == [1, 2, 3]
    assert lines[0]["text"] == "Clear the jams on [[Printer jams on line 3]]"
    assert lines[0]["label"] == "Clear the jams on Printer jams on line 3"
    assert lines[0]["links"] == [
        {"target": "Printer jams on line 3", "path": "Tasks/Printer jams on line 3.md"}
    ]
    assert lines[1]["links"][0]["path"] == "Projects/Scanner rollout.md"
    assert lines[2]["links"] == []
    assert lines[2]["label"] == "Plan next week"

    # An unresolvable link has path None; [[a|b]] shows as b.
    of, _fm, version = space.read(NOTE)
    body = of.body.replace("- Plan next week", "- Ask [[Nobody here|someone]] about it")
    space.save_body(NOTE, body, version)
    third = workfocus.focus_day(space, "2026-11-05")["lines"][2]
    assert third["label"] == "Ask someone about it"
    assert third["links"] == [{"target": "Nobody here", "path": None}]


def test_focus_day_rejects_a_bad_day(space: Space) -> None:
    for bad in ("2026-13-01", "today", "2026-11-5"):
        with pytest.raises(InvalidValue):
            workfocus.focus_day(space, bad)


def test_reading_never_creates_a_note(root: Path, space: Space, state: Path) -> None:
    before = _snapshot(root)
    dirs = _dirs(root)
    state_before = sorted(p.as_posix() for p in state.rglob("*")) if state.exists() else []
    day = workfocus.focus_day(space, "2026-11-06")
    assert day == {
        "day": "2026-11-06",
        "notePath": None,
        "version": None,
        "hasSection": False,
        "lines": [],
    }
    workfocus.focus_day(space, "2026-11-05")
    workday.today(space, None)
    workday.meetings_on(space, "2026-11-06")
    assert _snapshot(root) == before
    assert _dirs(root) == dirs
    state_after = sorted(p.as_posix() for p in state.rglob("*")) if state.exists() else []
    assert state_after == state_before


# -- saving -------------------------------------------------------------------


def test_save_changes_only_focus_list_lines(root: Path, space: Space) -> None:
    before = (root / NOTE).read_bytes()
    _of, _fm, version = space.read(NOTE)
    snapshots: list[str] = []
    space.before_write = lambda rel, data, oid: snapshots.append(rel)
    out = workfocus.save_focus(space, "2026-11-05", ["  Clear the jams ", "Ship the scanner"], version)
    assert [ln["text"] for ln in out["lines"]] == ["Clear the jams", "Ship the scanner"]
    assert out["version"] != version
    assert snapshots == [NOTE]

    after = (root / NOTE).read_bytes()
    assert after.startswith(BOM)
    old_lines = before.split(b"\r\n")
    new_lines = after.split(b"\r\n")
    assert b"\n" not in after.replace(b"\r\n", b"")  # every line ending is still CRLF
    expected = []
    for line in old_lines:
        if line.startswith(b"lastUpdated:"):
            expected.append(None)  # the stamp changes
        elif line == b"- Clear the jams on [[Printer jams on line 3]]":
            expected.extend([b"- Clear the jams", b"- Ship the scanner"])
        elif line in (b"- [ ] Finish [[Scanner rollout]]", b"- Plan next week"):
            continue
        else:
            expected.append(line)
    assert len(new_lines) == len(expected)
    for got, want in zip(new_lines, expected, strict=True):
        if want is None:
            assert got.startswith(b"lastUpdated:")
        else:
            assert got == want
    assert b"## Plan" in after and b"Keep it to three." in after and b"## Notes" in after

    # A stale version is refused and writes nothing.
    with pytest.raises(Conflict):
        workfocus.save_focus(space, "2026-11-05", ["Other"], version)
    assert (root / NOTE).read_bytes() == after

    current = out["version"]
    with pytest.raises(InvalidValue, match="Write at least one line."):
        workfocus.save_focus(space, "2026-11-05", [], current)
    with pytest.raises(InvalidValue, match="Write at least one line."):
        workfocus.save_focus(space, "2026-11-05", ["  ", ""], current)
    with pytest.raises(InvalidValue, match="A focus line is one line."):
        workfocus.save_focus(space, "2026-11-05", ["one\ntwo"], current)
    with pytest.raises(InvalidValue, match="At most 20 focus lines."):
        workfocus.save_focus(space, "2026-11-05", [f"Line {i}" for i in range(21)], current)
    with pytest.raises(InvalidValue):
        workfocus.save_focus(space, "2026-11-05", ["x" * 501], current)
    assert (root / NOTE).read_bytes() == after


def test_save_creates_the_note_and_section(root: Path, space: Space) -> None:
    out = workfocus.save_focus(space, "2026-11-06", ["Start the week", "Call [[Pat Example]]"], None)
    created = root / "DailyNotes" / "2026-11-06.md"
    assert created.is_file()
    assert out["notePath"] == "DailyNotes/2026-11-06.md"
    assert out["hasSection"] is True
    assert [ln["text"] for ln in out["lines"]] == ["Start the week", "Call [[Pat Example]]"]
    assert out["lines"][1]["links"][0]["path"] == "People/Pat Example.md"
    of, _fm, version = space.read("DailyNotes/2026-11-06.md")
    assert of.body.endswith("## Focus\n\n- Start the week\n- Call [[Pat Example]]\n")
    assert out["version"] == version

    # The note exists now: a save that thinks it is missing is stale.
    with pytest.raises(Conflict):
        workfocus.save_focus(space, "2026-11-06", ["Again"], None)

    # A note without the section gets it at its end, after one blank line.
    path = "DailyNotes/2026-11-06.md"
    space.save_body(path, "Some prose.\n", version)
    version = space.read(path)[2]
    workfocus.save_focus(space, "2026-11-06", ["Only this"], version)
    assert space.read(path)[0].body == "Some prose.\n\n## Focus\n\n- Only this\n"


def test_replace_focus_shapes() -> None:
    # A section with no items gets the list right after the heading, one blank line between.
    assert (
        workfocus.replace_focus("## Focus\n## Next\ntext\n", ["a"])
        == "## Focus\n\n- a\n\n## Next\ntext\n"
    )
    assert (
        workfocus.replace_focus("## Focus\n\nProse here.\n", ["a"])
        == "## Focus\n\n- a\n\nProse here.\n"
    )
    # Nested lines under an item go with it; other lines stay.
    body = "## Focus\n\n- old\n  - child\n- older\n\nAfter.\n"
    assert workfocus.replace_focus(body, ["new"]) == "## Focus\n\n- new\n\nAfter.\n"
    assert workfocus.replace_focus("", ["a"]) == "## Focus\n\n- a\n"
    assert workfocus.replace_focus("Text", ["a"]) == "Text\n\n## Focus\n\n- a\n"
    assert workfocus.replace_focus("Text\n\n", ["a"]) == "Text\n\n## Focus\n\n- a\n"


# -- meetings -----------------------------------------------------------------


def test_meetings_on_today(root: Path, state: Path) -> None:
    standup = (root / "Meetings" / "Line 3 standup.md").read_text("utf-8")
    tpl = standup.replace("type: Meeting\n", "type: Meeting\ntemplate: Standup\n").replace(
        "01KM2300000000000000000002", "01KM2300000000000000000099"
    )
    (root / "Meetings" / "Standup template.md").write_text(tpl, "utf-8")
    space = _open(root)

    meetings = workday.meetings_on(space, "2026-11-05")
    assert [m["title"] for m in meetings] == ["Line 3 standup", "Vendor call"]
    first, second = meetings
    assert first["path"] == "Meetings/Line 3 standup.md"
    assert (first["startLocal"], first["endLocal"]) == ("09:00", "09:30")
    assert (second["startLocal"], second["endLocal"]) == ("13:00", "13:30")
    assert first["start"].startswith("2026-11-05T09:00:00")
    assert second["end"].startswith("2026-11-05T13:30:00")
    assert [m["title"] for m in workday.meetings_on(space, "2026-11-06")] == ["Tomorrow sync"]

    t = workday.today(space, None)
    assert t["day"] == "2026-11-05"
    assert t["nowLocal"] == "10:00"
    assert t["now"].startswith("2026-11-05T10:00:00")
    assert [m["title"] for m in t["meetings"]] == ["Line 3 standup", "Vendor call"]
    assert workday.today(space, "2026-11-06")["day"] == "2026-11-06"
    with pytest.raises(InvalidValue):
        workday.today(space, "not a day")


def test_fenced_code_in_focus_is_not_focus(space: Space) -> None:
    body = (
        "## Focus\n\n- Real one\n\n```\n- not focus\n1. nor this\n```\n\n"
        "~~~\n- tilde\n~~~\n\n## Notes\n\ntext\n"
    )
    assert workfocus.parse_focus(body) == ["Real one"]
    out = workfocus.replace_focus(body, ["New"])
    assert out == body.replace("- Real one\n", "- New\n")
    only = "## Focus\n\n```\n- x\n```\n"
    assert workfocus.parse_focus(only) == []
    assert workfocus.replace_focus(only, ["A"]) == "## Focus\n\n- A\n\n```\n- x\n```\n"


def test_save_uses_one_read_for_check_and_edit(root: Path, space: Space) -> None:
    _of, _fm, version = space.read(NOTE)
    real = space.read
    calls = {"n": 0}

    def read(path, *a, **k):
        out = real(path, *a, **k)
        calls["n"] += 1
        if calls["n"] == 1:  # an outside edit right after the first read
            p = root / NOTE
            p.write_bytes(p.read_bytes() + b"\r\nOutside edit\r\n")
        return out

    space.read = read  # type: ignore[method-assign]
    with pytest.raises(Conflict):
        workfocus.save_focus(space, "2026-11-05", ["Mine"], version)
    assert b"Outside edit" in (root / NOTE).read_bytes()
    assert b"- Mine" not in (root / NOTE).read_bytes()
