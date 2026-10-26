"""Daily notes: one per date, as `DailyNotes/YYYY-MM-DD.md`, with templates (M4 Task 4)."""

import threading
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.frontmatter import parse_fm
from objectapp.localtime import from_local
from objectapp.objfile import split_object
from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import DailyNoteExists, Space
from objectapp.textfile import decode

NOW = datetime(2026, 10, 23, 9, 0, 0, tzinfo=UTC)
NOW_STAMP = "2026-10-23T09:00:00.000Z"
PLUS2 = timezone(timedelta(hours=2))
STANDUP_ID = "01JBQ4Z7S3N8V2K5D9X6T1STND"


@pytest.fixture
def space(calendar_space_dir: Path) -> Space:
    s = Space(calendar_space_dir)
    s.clock = lambda: NOW
    s.tz = PLUS2
    return s


def _snapshot(root: Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in root.rglob("*")
        if p.is_file()
    }


def _split(root: Path, rel: str):
    of = split_object(decode((root / rel).read_bytes()).text)
    return of, parse_fm(of.frontmatter_src)


def _write(root: Path, rel: str, text: str) -> None:
    full = root / rel
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(text.encode("utf-8"))


def test_create_daily_note_shape(space: Space, calendar_space_dir: Path):
    path, version = space.create_daily_note("2026-10-27")
    assert path == "DailyNotes/2026-10-27.md"
    of, fm = _split(calendar_space_dir, path)
    assert list(fm) == [
        "id",
        "type",
        "title",
        "createdAt",
        "lastUpdated",
        "date",
        "reviewed",
    ]
    assert fm["type"] == "DailyNote"
    assert fm["title"] == "2026-10-27"
    assert fm["date"] == "2026-10-27"
    assert fm["reviewed"] is False
    assert fm["createdAt"] == fm["lastUpdated"] == NOW_STAMP
    assert isinstance(fm["id"], str) and len(fm["id"]) == 26
    assert of.body == ""
    assert version == space.read(path)[2]
    # The note is indexed straight away.
    assert space.daily_notes()[0]["2026-10-27"] == path


def test_second_create_409_with_path(space: Space):
    with pytest.raises(DailyNoteExists) as exc:
        space.create_daily_note("2026-10-21")
    assert exc.value.path == "DailyNotes/2026-10-21.md"
    # A note with no `date` key, identified by its title.
    with pytest.raises(DailyNoteExists) as exc:
        space.create_daily_note("2026-10-25")
    assert exc.value.path == "DailyNotes/Odd name.md"


def test_second_create_409_identified_by_stem(space: Space, calendar_space_dir: Path):
    _write(
        calendar_space_dir,
        "DailyNotes/Archive/2026-10-29.md",
        "---\ntype: 'DailyNote'\ntitle: Thursday\n---\n",
    )
    space.rescan_file("DailyNotes/Archive/2026-10-29.md")
    with pytest.raises(DailyNoteExists) as exc:
        space.create_daily_note("2026-10-29")
    assert exc.value.path == "DailyNotes/Archive/2026-10-29.md"


def test_concurrent_create_one_file(space: Space, calendar_space_dir: Path):
    results: list[object] = []
    barrier = threading.Barrier(2)

    def run() -> None:
        barrier.wait()
        try:
            results.append(space.create_daily_note("2026-10-30"))
        except DailyNoteExists as exc:
            results.append(exc)

    threads = [threading.Thread(target=run) for _ in range(2)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    made = sorted(
        p.name for p in (calendar_space_dir / "DailyNotes").glob("2026-10-30*")
    )
    assert made == ["2026-10-30.md"]
    errors = [r for r in results if isinstance(r, DailyNoteExists)]
    assert len(errors) == 1 and errors[0].path == "DailyNotes/2026-10-30.md"


def test_concurrent_routes_one_file(calendar_space_dir: Path):
    space = Space(calendar_space_dir)
    client = TestClient(create_app(space, None))
    codes: list[int] = []
    barrier = threading.Barrier(2)

    def run() -> None:
        barrier.wait()
        codes.append(
            client.post("/api/daily-notes", json={"date": "2026-10-31"}).status_code
        )

    threads = [threading.Thread(target=run) for _ in range(2)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert sorted(codes) == [201, 409]
    assert [
        p.name for p in (calendar_space_dir / "DailyNotes").glob("2026-10-31*")
    ] == ["2026-10-31.md"]


@pytest.mark.parametrize("bad", ["2026-13-01", "2026-1-5", "today", "", "2026-02-30"])
def test_malformed_day_422(space: Space, calendar_space_dir: Path, bad: str):
    before = _snapshot(calendar_space_dir)
    with pytest.raises(InvalidValue):
        space.create_daily_note(bad)
    assert _snapshot(calendar_space_dir) == before
    client = TestClient(create_app(space, None))
    assert client.post("/api/daily-notes", json={"date": bad}).status_code == 422


def test_template_applied_title_date_kept(space: Space, calendar_space_dir: Path):
    path, _ = space.create_daily_note("2026-10-27", STANDUP_ID)
    of, fm = _split(calendar_space_dir, path)
    assert fm["title"] == "2026-10-27"
    assert fm["date"] == "2026-10-27"
    assert fm["reviewed"] is False
    assert fm["tags"] == ["Standup"]
    assert "template" not in fm
    assert of.body.startswith("## Yesterday")
    assert "## Blockers" in of.body


def test_unknown_template_422_writes_nothing(space: Space, calendar_space_dir: Path):
    from objectapp.templates import TemplateError

    before = _snapshot(calendar_space_dir)
    with pytest.raises(TemplateError):
        space.create_daily_note("2026-10-27", "no-such-template")
    assert _snapshot(calendar_space_dir) == before


def _set_default_template(space: Space, template_id: str | None) -> None:
    t = space.type_by_id("dailynote")
    assert t is not None
    t.templates = {**t.templates, "defaultTemplateId": template_id}


def test_default_template_used_when_set(space: Space, calendar_space_dir: Path):
    _set_default_template(space, STANDUP_ID)
    path, _ = space.create_daily_note("2026-10-27")
    of, fm = _split(calendar_space_dir, path)
    assert fm["tags"] == ["Standup"] and "## Today" in of.body


def test_none_template_skips_it(space: Space, calendar_space_dir: Path):
    _set_default_template(space, STANDUP_ID)
    path, _ = space.create_daily_note("2026-10-27", "none")
    of, fm = _split(calendar_space_dir, path)
    assert "tags" not in fm and of.body == ""


def test_day_from_date_title_or_stem(space: Space, calendar_space_dir: Path):
    with space._lock:
        raws = dict(space._raw)
    assert space.daily_note_day(raws["DailyNotes/Odd name.md"]) == "2026-10-25"
    assert space.daily_note_day(raws["DailyNotes/2026-10-22.md"]) == "2026-10-22"
    _write(
        calendar_space_dir,
        "DailyNotes/Loose thoughts.md",
        "---\ntype: 'DailyNote'\ntitle: Loose thoughts\n---\n",
    )
    space.rescan_file("DailyNotes/Loose thoughts.md")
    with space._lock:
        loose = space._raw["DailyNotes/Loose thoughts.md"]
    assert space.daily_note_day(loose) is None
    index, dups = space.daily_notes()
    assert "DailyNotes/Loose thoughts.md" not in index.values()
    assert all("DailyNotes/Loose thoughts.md" not in paths for _d, paths in dups)
    assert index["2026-10-25"] == "DailyNotes/Odd name.md"


def test_duplicates_reported(space: Space, calendar_space_dir: Path):
    before = _snapshot(calendar_space_dir)
    index, dups = space.daily_notes()
    assert index["2026-10-23"] == "DailyNotes/2026-10-23.md"
    assert dups == [("2026-10-23", ["DailyNotes/2026-10-23 copy.md"])]
    assert index == {
        "2026-10-21": "DailyNotes/2026-10-21.md",
        "2026-10-22": "DailyNotes/2026-10-22.md",
        "2026-10-23": "DailyNotes/2026-10-23.md",
        "2026-10-25": "DailyNotes/Odd name.md",
    }
    # Reported, never merged or deleted.
    assert _snapshot(calendar_space_dir) == before


def test_templates_and_other_types_not_indexed(space: Space):
    index, dups = space.daily_notes()
    paths = set(index.values()) | {p for _d, ps in dups for p in ps}
    assert "Templates/DailyNotes/Standup.md" not in paths
    assert all(p.startswith("DailyNotes/") for p in paths)


@pytest.mark.parametrize(
    "text",
    [
        "---\ntype: 'Page'\ntitle: 2026-10-28\n---\n",  # another type
        # A daily note whose own date is another day (the stem would name the
        # 28th, but `date` wins): the file does not map to the 28th.
        "---\ntype: 'DailyNote'\ntitle: Notes\ndate: 2026-09-01\n---\n",
    ],
)
def test_name_collision_with_unindexed_file_409_no_suffix_file(
    space: Space, calendar_space_dir: Path, text: str
):
    rel = "DailyNotes/2026-10-28.md"
    _write(calendar_space_dir, rel, text)
    before = _snapshot(calendar_space_dir)
    with pytest.raises(DailyNoteExists) as exc:
        space.create_daily_note("2026-10-28")
    assert exc.value.path == rel
    assert exc.value.detail == "A file with that name already exists."
    assert _snapshot(calendar_space_dir) == before
    assert not (calendar_space_dir / "DailyNotes" / "2026-10-28 2.md").exists()
    client = TestClient(create_app(space, None))
    res = client.post("/api/daily-notes", json={"date": "2026-10-28"})
    assert res.status_code == 409
    assert res.json() == {
        "detail": "A file with that name already exists.",
        "path": rel,
    }


def test_unseen_daily_note_file_is_existing(space: Space, calendar_space_dir: Path):
    # A note the watcher has not reported yet: the create-exclusive write catches it.
    rel = "DailyNotes/2026-10-28.md"
    _write(calendar_space_dir, rel, "---\ntype: 'DailyNote'\ndate: 2026-10-28\n---\n")
    with pytest.raises(DailyNoteExists) as exc:
        space.create_daily_note("2026-10-28")
    assert exc.value.path == rel
    assert exc.value.detail == "There is already a daily note for this day."


def test_note_in_subfolder_counts_as_existing(space: Space, calendar_space_dir: Path):
    rel = "DailyNotes/2026/2026-11-05.md"
    _write(
        calendar_space_dir,
        rel,
        "---\ntype: 'DailyNote'\ntitle: 2026-11-05\ndate: 2026-11-05\nreviewed: false\n---\n",
    )
    space.rescan_file(rel)
    with pytest.raises(DailyNoteExists) as exc:
        space.create_daily_note("2026-11-05")
    assert exc.value.path == rel
    assert not (calendar_space_dir / "DailyNotes" / "2026-11-05.md").exists()


def test_template_reference_instant_is_target_day(
    space: Space, calendar_space_dir: Path
):
    seen: list[datetime | None] = []
    original = space._template_edit

    def spy(t, tmpl, created=None):
        seen.append(created)
        return original(t, tmpl, created)

    space._template_edit = spy  # type: ignore[method-assign]
    path, _ = space.create_daily_note("2026-11-02", STANDUP_ID)
    assert len(seen) == 1 and seen[0] is not None
    expected = from_local(datetime(2026, 11, 2), PLUS2)  # noqa: DTZ001
    assert seen[0] == expected
    assert seen[0].astimezone(PLUS2).replace(tzinfo=None) == datetime(2026, 11, 2)  # noqa: DTZ001
    _of, fm = _split(calendar_space_dir, path)
    assert fm["title"] == "2026-11-02" and fm["date"] == "2026-11-02"


def test_no_daily_note_created_on_open(tmp_path: Path):
    # Regression guard (green from the start).
    root = tmp_path / "empty"
    (root / "Pages").mkdir(parents=True)
    (root / "Pages" / "One.md").write_bytes(b"---\ntype: 'Page'\ntitle: One\n---\n")
    Space(root)
    before = _snapshot(root)
    Space(root)
    assert _snapshot(root) == before
    assert not (root / "DailyNotes").exists()


def test_create_in_space_without_daily_note_type(tmp_path: Path):
    root = tmp_path / "fresh"
    (root / "Pages").mkdir(parents=True)
    (root / "Pages" / "One.md").write_bytes(b"---\ntype: 'Page'\ntitle: One\n---\n")
    space = Space(root)
    space.clock = lambda: NOW
    space.tz = PLUS2
    client = TestClient(create_app(space, None))
    res = client.post("/api/daily-notes", json={"date": "2026-10-27"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["path"] == "DailyNotes/2026-10-27.md"
    assert body["typeIds"] == ["dailynote"]
    assert (root / ".object" / "types" / "dailynote.json").is_file()
    # A second create of another day writes no type again.
    res = client.post("/api/daily-notes", json={"date": "2026-10-28"})
    assert res.status_code == 201 and res.json()["typeIds"] == []


def test_route_created_and_409(space: Space, calendar_space_dir: Path):
    client = TestClient(create_app(space, None))
    res = client.post(
        "/api/daily-notes",
        json={"date": "2026-10-27", "templateId": None, "clientId": "c1"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["path"] == "DailyNotes/2026-10-27.md"
    assert body["version"] == space.read(body["path"])[2]
    assert body["typeIds"] == []
    res = client.post("/api/daily-notes", json={"date": "2026-10-27"})
    assert res.status_code == 409
    assert res.json() == {
        "detail": "There is already a daily note for this day.",
        "path": "DailyNotes/2026-10-27.md",
    }
    res = client.post(
        "/api/daily-notes", json={"date": "2026-10-29", "templateId": "nope"}
    )
    assert res.status_code == 422
    assert not (calendar_space_dir / "DailyNotes" / "2026-10-29.md").exists()


def test_daily_note_templates_allowed(space: Space):
    templates = space.list_templates("dailynote")
    assert [s.path for s in templates] == ["Templates/DailyNotes/Standup.md"]
    path, _ = space.create_template("dailynote", "Evening")
    assert path == "Templates/DailyNotes/Evening.md"


def test_daily_note_title_stays_locked(space: Space):
    # Regression guard (green from the start).
    _of, _fm, version = space.read("DailyNotes/2026-10-21.md")
    with pytest.raises(InvalidValue):
        space.rename_object("DailyNotes/2026-10-21.md", "Something else", version)


def test_reviewed_toggle_is_a_property_write(space: Space, calendar_space_dir: Path):
    rel = "DailyNotes/2026-10-21.md"
    before = (calendar_space_dir / rel).read_bytes().decode("utf-8").splitlines()
    _of, _fm, version = space.read(rel)
    space.update_properties(rel, {"reviewed": True}, version)
    after = (calendar_space_dir / rel).read_bytes().decode("utf-8").splitlines()
    assert len(before) == len(after)
    changed = {(a, b) for a, b in zip(before, after, strict=True) if a != b}
    assert changed == {
        ("reviewed: false", "reviewed: true"),
        ("lastUpdated: 2026-10-21T06:45:00.000Z", f"lastUpdated: {NOW_STAMP}"),
    }
