"""The M4 fixture space `space-calendar` loads as the plan describes (M4 Task 1)."""

import json
from pathlib import Path

from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.space import Space
from objectapp.textfile import decode


def _snapshot(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def _parse(data: bytes) -> dict:
    of = split_object(decode(data).text)
    assert of.fm_ok and of.frontmatter_src is not None
    return parse_fm(of.frontmatter_src)


def _fm(root: Path, rel: str) -> dict:
    return _parse((root / rel).read_bytes())


def _md_files(root: Path) -> list[Path]:
    return sorted(root.rglob("*.md"))


def test_every_md_has_frontmatter_and_unique_paths(calendar_space_dir: Path):
    files = _md_files(calendar_space_dir)
    assert files
    rels = [p.relative_to(calendar_space_dir).as_posix() for p in files]
    assert len(rels) == len({r.lower() for r in rels})
    for p in files:
        assert decode(p.read_bytes()).text.startswith("---\n"), p
        fm = _parse(p.read_bytes())
        assert isinstance(fm.get("type"), str) and fm["type"], p
        assert fm.get("title") not in (None, ""), p
    # ui.json is absent: defaults read as {}.
    assert not (calendar_space_dir / ".capacities" / "ui.json").exists()


def test_space_opens_without_writing(calendar_space_dir: Path):
    before = _snapshot(calendar_space_dir)
    Space(calendar_space_dir)
    Space(calendar_space_dir)
    assert _snapshot(calendar_space_dir) == before


def test_type_files(calendar_space_dir: Path):
    types_dir = calendar_space_dir / ".capacities" / "types"
    names = {p.stem for p in types_dir.glob("*.json")}
    assert names == {"task", "dailynote", "page", "meeting", "person", "tag", "event"}

    task = json.loads((types_dir / "task.json").read_text("utf-8"))
    by_key = {p["key"]: p for p in task["propertyDefinitions"]}
    for key in ("status", "priority", "date", "deadline", "completed", "repeat", "remind"):
        assert key in by_key, key
    assert [o["text"] for o in by_key["status"]["options"]["set"]] == [
        "Not Started", "Next Up", "In Progress", "On Hold", "Done"
    ]
    assert by_key["date"]["options"]["constraints"]["supportsReminders"] is True
    assert by_key["completed"]["visibility"] == "hidden"

    meeting = json.loads((types_dir / "meeting.json").read_text("utf-8"))
    mprops = {p["key"]: p for p in meeting["propertyDefinitions"]}
    assert mprops["when"]["type"] == "datetime"
    assert mprops["span"]["type"] == "datetime"
    assert mprops["internalStamp"]["options"]["hideCalendarEvents"] is True

    event = json.loads((types_dir / "event.json").read_text("utf-8"))
    assert event["hideFromCalendarSidebar"] is True
    assert any(p["key"] == "when" for p in event["propertyDefinitions"])

    space = Space(calendar_space_dir)
    loaded = {t.id: t for t in space.types}
    assert loaded["event"].extra.get("hideFromCalendarSidebar") is True
    assert loaded["meeting"].prop("internalStamp").options.get("hideCalendarEvents") is True


def test_expected_inventory(calendar_space_dir: Path):
    root = calendar_space_dir
    tasks = {p.relative_to(root).as_posix(): _fm(root, p.relative_to(root).as_posix())
             for p in (root / "Tasks").glob("*.md")}
    repeats = {fm.get("repeat") for fm in tasks.values()} - {None}
    assert {
        "every week",
        "every 3 days after completion",
        "every month",
        "every weekday",
        "every week until 2026-10-30",
        "weekly",
        "every day",
    } <= repeats
    reminds = {fm.get("remind") for fm in tasks.values()} - {None}
    assert {"1 day before at 09:00", "15 minutes before"} <= reminds
    dates = {str(fm.get("date")) for fm in tasks.values() if fm.get("date") is not None}
    assert {"2026-01-31", "2026-10-14", "2026-10-22", "2026-10-23T08:30:00.000Z"} <= dates
    assert any(fm.get("deadline") is not None and fm.get("date") is None for fm in tasks.values())

    weekly = next(fm for fm in tasks.values() if fm.get("repeat") == "every week"
                  and fm.get("remind") == "1 day before at 09:00")
    assert weekly.get("date") is not None
    assert any(fm.get("repeat") == "every day" and fm.get("date") is None for fm in tasks.values())
    assert any(fm.get("repeat") == "weekly" and fm.get("date") is not None for fm in tasks.values())
    timed = next(fm for fm in tasks.values() if str(fm.get("date")) == "2026-10-23T08:30:00.000Z")
    assert timed["remind"] == "15 minutes before"
    monthly = next(fm for fm in tasks.values() if fm.get("repeat") == "every month")
    assert str(monthly["date"]) == "2026-01-31"
    assert any(str(fm.get("date")) == "2026-10-14" and fm.get("status") == "Not Started"
               and fm.get("repeat") is None for fm in tasks.values())
    assert any(fm.get("status") == "Done" and str(fm.get("date")) == "2026-10-22"
               for fm in tasks.values())
    assert any(fm.get("priority") == "High" for fm in tasks.values())
    assert any("status" not in fm for fm in tasks.values())
    assert sum(1 for fm in tasks.values() if "completed" not in fm) >= len(tasks) - 1

    # Byte-level files for the status hook.
    crlf = (root / "Tasks" / "crlf bom task.md").read_bytes()
    assert crlf.startswith(b"\xef\xbb\xbf---\r\n")
    assert b"\n" not in crlf.replace(b"\r\n", b"")
    crlf_fm = _fm(root, "Tasks/crlf bom task.md")
    assert crlf_fm["repeat"] == "every week" and crlf_fm.get("date") is not None
    assert crlf_fm["status"] == "Not Started"

    no_nl = (root / "Tasks" / "no trailing newline.md").read_bytes()
    assert not no_nl.endswith(b"\n") and b"\r" not in no_nl

    quoted = (root / "Tasks" / "quoted date.md").read_bytes().decode("utf-8")
    assert "date: '2026-10-14'  # work on it\n" in quoted
    assert str(_fm(root, "Tasks/quoted date.md")["date"]) == "2026-10-14"

    # Daily notes.
    notes = {p.name: _fm(root, f"DailyNotes/{p.name}") for p in (root / "DailyNotes").glob("*.md")}
    assert set(notes) == {
        "2026-10-21.md", "2026-10-22.md", "2026-10-23.md", "Odd name.md", "2026-10-23 copy.md"
    }
    assert notes["2026-10-22.md"]["reviewed"] is True
    assert "date" not in notes["Odd name.md"] and str(notes["Odd name.md"]["title"]) == "2026-10-25"
    assert str(notes["2026-10-23 copy.md"]["date"]) == "2026-10-23"

    # Calendar edge cases.
    assert any(str(_fm(root, p.relative_to(root).as_posix()).get("createdAt"))
               == "2026-10-23T22:30:00.000Z" for p in root.rglob("*.md"))
    assert str(_fm(root, "Meetings/Offsite.md")["span"]) == "2026-10-26 -> 2026-10-28"
    assert "internalStamp" in _fm(root, "Meetings/Audit log.md")
    assert "when" in _fm(root, "Events/Concert.md")
    standup = _fm(root, "Templates/DailyNotes/Standup.md")
    assert standup["type"] == "DailyNote" and standup["template"] == "Standup"


def test_types_and_templates_load(calendar_space_dir: Path):
    space = Space(calendar_space_dir)
    paths = {s.path for s in space.list()}
    assert "Tasks/crlf bom task.md" in paths
    assert "DailyNotes/Odd name.md" in paths
    assert not any(p.startswith("Templates/") for p in paths)
    daily = next(t for t in space.types if t.name == "DailyNote")
    assert [s.path for s in space.list_templates(daily.id)] == ["Templates/DailyNotes/Standup.md"]
