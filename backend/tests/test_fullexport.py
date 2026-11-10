"""M31 item 1: Full Export (catalog section 1, General, "Full Export").

The export tree (`fullexport.run_full_export`): one dated folder per run, one folder per space,
each object's Markdown as the single-object export writes it (`export._markdown`), media with
"Include media", the two link and heading options, every space with "All Spaces", nothing
written inside any space and a destination inside a space refused. And the automated export
(`fullexport.AutoFullExport`) on a fake clock.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from objectapp import export, fmcache, fullexport
from objectapp.export import ExportOptions
from objectapp.fullexport import (
    AutoFullExport,
    FullExportOptions,
    Refused,
    check_destination,
    export_folder_name,
    run_full_export,
)
from objectapp.space import Space

FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 10, 14, 30)


def _tree(root: Path) -> dict[str, str]:
    """Every file under ``root`` (dot-folders included) with its hash."""
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _copy(name: str, tmp_path: Path, as_name: str | None = None) -> Path:
    dest = tmp_path / (as_name or name)
    shutil.copytree(FIXTURES / name, dest)
    return dest


@pytest.fixture
def links_space(tmp_path: Path) -> Path:
    """A small synthetic space: links between pages, an attachment, a template, the trash."""
    root = tmp_path / "Linky"
    (root / ".object" / "trash").mkdir(parents=True)
    (root / ".object" / "space.json").write_text(json.dumps({"name": "Linky"}), "utf-8")
    (root / ".object" / "trash" / "gone.md").write_text("---\ntitle: Gone\n---\nTrashed.\n", "utf-8")
    (root / "Pages").mkdir()
    (root / "Notes").mkdir()
    (root / "Attachments").mkdir()
    (root / "Templates").mkdir()
    (root / "Pages" / "Home.md").write_bytes(
        b"\xef\xbb\xbf---\r\ntype: Page\r\ntitle: Home\r\n---\r\nSee [[Deep note]] and [[Nowhere]].\r\n"
        b"![[Attachments/pic.png]]\r\n"
    )
    (root / "Notes" / "Deep note.md").write_bytes(b"---\ntype: Page\ntitle: Deep note\n---\n# Deep note\n\nBack to [[Home]].\n")
    (root / "Attachments" / "pic.png").write_bytes(b"\x89PNG pic")
    (root / "Attachments" / "unused.pdf").write_bytes(b"%PDF unused")
    (root / "Templates" / "Meeting.md").write_bytes(b"---\ntype: Page\ntitle: Meeting\ntemplate: Meeting\n---\nAgenda\n")
    return root


def _only(folder: Path) -> Path:
    items = [p for p in folder.iterdir()]
    assert len(items) == 1, items
    return items[0]


# -- the tree ------------------------------------------------------------------------------


def test_export_folder_is_dated_and_holds_one_folder_per_space(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    res = run_full_export([("Linky", links_space)], dest, FullExportOptions(), NOW)
    top = _only(dest)
    assert top.name == "Object export Linky 2026-11-10 1430"
    assert res.folder == str(top)
    assert [p.name for p in top.iterdir()] == ["Linky"]
    assert res.objects == 2 and res.spaces[0].objects == 2
    assert res.spaces[0].folder == "Linky"


def test_a_second_run_in_the_same_minute_gets_a_fresh_folder(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    run_full_export([("Linky", links_space)], dest, FullExportOptions(), NOW)
    res = run_full_export([("Linky", links_space)], dest, FullExportOptions(), NOW)
    assert Path(res.folder).name == "Object export Linky 2026-11-10 1430 (2)"
    assert sorted(p.name for p in dest.iterdir()) == [
        "Object export Linky 2026-11-10 1430",
        "Object export Linky 2026-11-10 1430 (2)",
    ]


@pytest.mark.parametrize("fixture", ["space-sample", "space-synced", "space-whiteboard", "space-itops"])
@pytest.mark.parametrize(
    "wikilinks,title_heading", [(True, False), (False, False), (True, True), (False, True)]
)
def test_markdown_bytes_are_the_single_object_exports(tmp_path: Path, fixture: str, wikilinks: bool, title_heading: bool):
    """Each file is what `export._markdown` writes for the object at its own path."""
    root = _copy(fixture, tmp_path)
    dest = tmp_path / "out"
    dest.mkdir()
    run_full_export(
        [("S", root)], dest, FullExportOptions(media=False, wikilinks=wikilinks, title_heading=title_heading), NOW
    )
    out = _only(dest) / "S"
    space = Space(root)
    opts = ExportOptions(wikilinks=wikilinks, title_h1=title_heading)
    expected = {
        s.path: export._markdown(space, s.path, opts, s.path) for s in space.list()
    }
    got = {p.relative_to(out).as_posix(): p.read_bytes() for p in out.rglob("*") if p.is_file()}
    assert got.keys() == expected.keys()
    for rel, data in expected.items():
        assert got[rel] == data, rel


def test_default_export_is_each_file_as_it_is(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    run_full_export([("Linky", links_space)], dest, FullExportOptions(media=False, wikilinks=True), NOW)
    out = _only(dest) / "Linky"
    assert (out / "Pages" / "Home.md").read_bytes() == (links_space / "Pages" / "Home.md").read_bytes()
    assert (out / "Notes" / "Deep note.md").read_bytes() == (links_space / "Notes" / "Deep note.md").read_bytes()


def test_links_as_wikilinks_off_writes_relative_markdown_links(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    run_full_export([("Linky", links_space)], dest, FullExportOptions(media=True, wikilinks=False), NOW)
    out = _only(dest) / "Linky"
    home = (out / "Pages" / "Home.md").read_bytes()
    # BOM and CRLF kept; the link resolves inside the export; an unresolved one is its text.
    assert home.startswith(b"\xef\xbb\xbf---\r\n")
    assert b"See [Deep note](../Notes/Deep%20note.md) and Nowhere.\r\n" in home
    assert b"![](../Attachments/pic.png)" in home
    assert (out / "Pages" / "../Notes/Deep note.md").is_file()
    assert b"Back to [Home](../Pages/Home.md)." in (out / "Notes" / "Deep note.md").read_bytes()


def test_links_as_wikilinks_on_keeps_them(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    run_full_export([("Linky", links_space)], dest, FullExportOptions(wikilinks=True), NOW)
    home = (_only(dest) / "Linky" / "Pages" / "Home.md").read_bytes()
    assert b"See [[Deep note]] and [[Nowhere]]." in home


def test_title_heading_option(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    run_full_export([("Linky", links_space)], dest, FullExportOptions(wikilinks=True, title_heading=True), NOW)
    out = _only(dest) / "Linky"
    home = (out / "Pages" / "Home.md").read_bytes()
    assert home.startswith(b"\xef\xbb\xbf---\r\ntype: Page\r\ntitle: Home\r\n---\r\n# Home\r\n\r\nSee [[Deep note]]")
    # A page that already starts with its title as heading 1 gets no second one.
    deep = (out / "Notes" / "Deep note.md").read_bytes()
    assert deep.count(b"# Deep note") == 1


def test_include_media_copies_attachments_and_referenced_files(links_space: Path, tmp_path: Path):
    (links_space / "Notes" / "diagram.svg").write_bytes(b"<svg/>")
    (links_space / "Notes" / "Deep note.md").write_bytes(
        b"---\ntype: Page\ntitle: Deep note\n---\n![d](diagram.svg)\n"
    )
    dest = tmp_path / "out"
    dest.mkdir()
    res = run_full_export([("Linky", links_space)], dest, FullExportOptions(media=True), NOW)
    out = _only(dest) / "Linky"
    assert (out / "Attachments" / "pic.png").read_bytes() == b"\x89PNG pic"
    assert (out / "Attachments" / "unused.pdf").read_bytes() == b"%PDF unused"
    assert (out / "Notes" / "diagram.svg").read_bytes() == b"<svg/>"
    assert res.media == 3 and res.spaces[0].media == 3


def test_media_left_out_without_include_media(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    res = run_full_export([("Linky", links_space)], dest, FullExportOptions(media=False), NOW)
    out = _only(dest) / "Linky"
    assert not (out / "Attachments").exists()
    assert res.media == 0


def test_whiteboard_sidecars_go_with_the_media(tmp_path: Path):
    root = _copy("space-whiteboard", tmp_path)
    dest = tmp_path / "out"
    dest.mkdir()
    run_full_export([("Boards", root)], dest, FullExportOptions(media=True), NOW)
    out = _only(dest) / "Boards"
    assert (out / "Whiteboards" / "Broken board.whiteboard.json").read_bytes() == (
        root / "Whiteboards" / "Broken board.whiteboard.json"
    ).read_bytes()


def test_templates_trash_and_object_folder_are_left_out(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    run_full_export([("Linky", links_space)], dest, FullExportOptions(media=True), NOW)
    out = _only(dest) / "Linky"
    files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
    assert files == ["Attachments/pic.png", "Attachments/unused.pdf", "Notes/Deep note.md", "Pages/Home.md"]


def test_objects_excluded_from_ai_are_exported(links_space: Path, tmp_path: Path):
    (links_space / "Pages" / "Private.md").write_bytes(b"---\ntype: Page\ntitle: Private\nexcludeFromAi: true\n---\nMine.\n")
    dest = tmp_path / "out"
    dest.mkdir()
    run_full_export([("Linky", links_space)], dest, FullExportOptions(), NOW)
    assert (_only(dest) / "Linky" / "Pages" / "Private.md").is_file()


def test_all_spaces_one_folder_each(links_space: Path, tmp_path: Path):
    other = _copy("space-sample", tmp_path, "Sample")
    twin = _copy("space-whiteboard", tmp_path, "Twin")
    dest = tmp_path / "out"
    dest.mkdir()
    res = run_full_export(
        [("Linky", links_space), ("Sample", other), ("Linky", twin)], dest, FullExportOptions(media=False), NOW
    )
    top = _only(dest)
    assert top.name == "Object export All Spaces 2026-11-10 1430"
    assert sorted(p.name for p in top.iterdir()) == ["Linky", "Linky (2)", "Sample"]
    assert [s.folder for s in res.spaces] == ["Linky", "Sample", "Linky (2)"]
    assert (top / "Sample" / "Pages" / "Alpha.md").read_bytes() == (other / "Pages" / "Alpha.md").read_bytes()
    assert res.objects == sum(s.objects for s in res.spaces)


def test_nothing_is_written_in_any_space(links_space: Path, tmp_path: Path, monkeypatch):
    """Not an object, not ``.object``, not the frontmatter cache (the default, in the space)."""
    monkeypatch.delenv("OBJECT_CACHE_DIR", raising=False)
    other = _copy("space-synced", tmp_path, "Synced")
    before = (_tree(links_space), _tree(other))
    dest = tmp_path / "out"
    dest.mkdir()
    for wikilinks in (True, False):
        run_full_export(
            [("Linky", links_space), ("Synced", other)],
            dest,
            FullExportOptions(media=True, wikilinks=wikilinks, title_heading=True),
            NOW,
        )
    fmcache.flush_all()
    assert (_tree(links_space), _tree(other)) == before
    assert not (links_space / ".object-cache").exists()


def test_refuses_a_folder_inside_a_space(links_space: Path, tmp_path: Path):
    other = _copy("space-sample", tmp_path, "Sample")
    for inside in (links_space, links_space / "Pages"):
        with pytest.raises(Refused, match="outside your spaces"):
            run_full_export([("Linky", links_space)], inside, FullExportOptions(), NOW)
    # Inside a space that is not being exported (a registered one).
    with pytest.raises(Refused, match="outside your spaces"):
        run_full_export([("Linky", links_space)], other / "Pages", FullExportOptions(), NOW, all_spaces=[other])
    # Inside any folder holding ``.object`` (a space this device doesn't list).
    loose = tmp_path / "Loose"
    (loose / ".object").mkdir(parents=True)
    (loose / "Sub").mkdir()
    with pytest.raises(Refused, match="outside your spaces"):
        run_full_export([("Linky", links_space)], loose / "Sub", FullExportOptions(), NOW)
    assert not any(p.name.startswith("Object export") for p in links_space.rglob("*"))


def test_check_destination_messages(tmp_path: Path):
    with pytest.raises(Refused, match="Pick a folder for the export."):
        check_destination(None, [])
    with pytest.raises(Refused, match=r"Pick a folder \(a full path\)."):
        check_destination("relative/folder", [])
    with pytest.raises(Refused, match="isn't there"):
        check_destination(str(tmp_path / "missing"), [])
    assert check_destination(str(tmp_path), []) == tmp_path.resolve()


def test_a_failed_export_leaves_nothing_behind(links_space: Path, tmp_path: Path, monkeypatch):
    dest = tmp_path / "out"
    dest.mkdir()

    def boom(*_a, **_k):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(fullexport, "_object_markdown", boom)
    with pytest.raises(OSError):
        run_full_export([("Linky", links_space)], dest, FullExportOptions(), NOW)
    assert list(dest.iterdir()) == []


def test_progress_counts_every_file(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    seen: list[tuple[int, int]] = []
    run_full_export([("Linky", links_space)], dest, FullExportOptions(media=True), NOW, progress=lambda d, t: seen.append((d, t)))
    assert seen[0] == (0, 4) and seen[-1] == (4, 4)


def test_folder_name():
    assert export_folder_name("Work", datetime(2026, 1, 2, 3, 4)) == "Object export Work 2026-01-02 0304"
    assert export_folder_name("a/b: c", NOW) == "Object export a"


# -- the automated export (fake clock) ------------------------------------------------------


class _Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def _auto(links_space: Path, state: Path, settings: dict, clock: _Clock, others: list[Path] | None = None):
    def spaces(scope: str):
        if scope == "all":
            return [("Linky", links_space), *((p.name, p) for p in (others or []))]
        return [("Linky", links_space)]

    return AutoFullExport(
        settings=lambda: settings,
        spaces=spaces,
        all_spaces=lambda: [links_space, *(others or [])],
        clock=clock,
        state_dir=lambda: state,
        local=lambda d: d.replace(tzinfo=None),
    )


def _on(folder: Path | None, **extra) -> dict:
    return {
        "fullExportAuto": True,
        "fullExportScope": "current",
        "fullExportFolder": str(folder) if folder else None,
        "fullExportInterval": "daily",
        "fullExportMedia": True,
        "fullExportWikilinks": False,
        "fullExportTitleHeading": False,
        **extra,
    }


def test_auto_off_never_runs(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    auto = _auto(links_space, tmp_path / "state", {**_on(dest), "fullExportAuto": False}, _Clock(datetime(2026, 11, 10, 9, tzinfo=UTC)))
    assert auto.tick() is None
    assert list(dest.iterdir()) == []
    assert auto.status()["enabled"] is False and auto.status()["nextRun"] is None


def test_auto_daily_runs_once_per_day_and_records_the_last_run(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    state = tmp_path / "state"
    clock = _Clock(datetime(2026, 11, 10, 9, 5, tzinfo=UTC))
    auto = _auto(links_space, state, _on(dest), clock)
    first = auto.tick()
    assert first is not None and Path(first.folder).name == "Object export Linky 2026-11-10 0905"
    rec = json.loads((state / "full-export.json").read_text("utf-8"))
    assert rec["lastRun"] == "2026-11-10T09:05:00Z" and rec["lastFolder"] == first.folder
    clock.now += timedelta(hours=23)
    assert auto.tick() is None
    clock.now += timedelta(hours=1)
    second = auto.tick()
    assert second is not None and Path(second.folder).name == "Object export Linky 2026-11-11 0905"
    assert len(list(dest.iterdir())) == 2
    st = auto.status()
    assert st["lastRun"] == "2026-11-11T09:05:00Z" and st["nextRun"] == "2026-11-12T09:05:00Z"


def test_auto_weekly(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    clock = _Clock(datetime(2026, 11, 10, 9, tzinfo=UTC))
    auto = _auto(links_space, tmp_path / "state", _on(dest, fullExportInterval="weekly"), clock)
    assert auto.tick() is not None
    clock.now += timedelta(days=6, hours=23)
    assert auto.tick() is None
    clock.now += timedelta(hours=1)
    assert auto.tick() is not None


def test_auto_all_spaces_uses_the_options(links_space: Path, tmp_path: Path):
    other = _copy("space-sample", tmp_path, "Sample")
    dest = tmp_path / "out"
    dest.mkdir()
    auto = _auto(
        links_space,
        tmp_path / "state",
        _on(dest, fullExportScope="all", fullExportMedia=False, fullExportTitleHeading=True),
        _Clock(datetime(2026, 11, 10, 9, tzinfo=UTC)),
        [other],
    )
    res = auto.tick()
    assert res is not None and Path(res.folder).name.startswith("Object export All Spaces ")
    top = Path(res.folder)
    assert sorted(p.name for p in top.iterdir()) == ["Linky", "Sample"]
    assert not (top / "Linky" / "Attachments").exists()
    assert b"# Home" in (top / "Linky" / "Pages" / "Home.md").read_bytes()


def test_auto_skips_when_the_folder_is_unset_or_missing(links_space: Path, tmp_path: Path):
    clock = _Clock(datetime(2026, 11, 10, 9, tzinfo=UTC))
    unset = _auto(links_space, tmp_path / "state", _on(None), clock)
    assert unset.tick() is None
    assert unset.status()["blocked"] == "Pick a folder for the automated exports."
    missing = tmp_path / "gone"
    gone = _auto(links_space, tmp_path / "state", _on(missing), clock)
    assert gone.tick() is None
    assert gone.status()["blocked"] == f"The folder {missing} isn't there."
    inside = _auto(links_space, tmp_path / "state", _on(links_space / "Pages"), clock)
    assert inside.tick() is None
    assert "outside your spaces" in inside.status()["blocked"]
    assert not (tmp_path / "state" / "full-export.json").exists()
    assert not missing.exists()


def test_auto_never_runs_twice_at_once(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    auto = _auto(links_space, tmp_path / "state", _on(dest), _Clock(datetime(2026, 11, 10, 9, tzinfo=UTC)))
    with fullexport._RUN_LOCK:  # another export (manual or automated) is running
        assert auto.tick() is None
    assert list(dest.iterdir()) == []
    assert auto.tick() is not None


def test_auto_failure_is_recorded_and_retried_later(links_space: Path, tmp_path: Path, monkeypatch):
    dest = tmp_path / "out"
    dest.mkdir()
    state = tmp_path / "state"
    clock = _Clock(datetime(2026, 11, 10, 9, tzinfo=UTC))
    auto = _auto(links_space, state, _on(dest), clock)

    def boom(*_a, **_k):
        raise OSError(13, "Permission denied")

    monkeypatch.setattr(fullexport, "_object_markdown", boom)
    assert auto.tick() is None
    st = auto.status()
    assert st["lastError"] == "Permission denied" and st["lastRun"] is None
    assert st["nextRun"] == "2026-11-10T10:00:00Z"
    clock.now += timedelta(minutes=30)
    monkeypatch.undo()
    assert auto.tick() is None  # not before the hour is up
    clock.now += timedelta(minutes=30)
    assert auto.tick() is not None
    assert auto.status()["lastError"] is None


def test_auto_timer_checks_from_start_and_stops(links_space: Path, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    ran = threading.Event()
    auto = _auto(links_space, tmp_path / "state", _on(dest), _Clock(datetime(2026, 11, 10, 9, tzinfo=UTC)))
    real = auto.tick

    def tick(now=None):
        out = real(now)
        ran.set()
        return out

    auto.tick = tick  # type: ignore[method-assign]
    auto.start()
    try:
        assert ran.wait(5)
    finally:
        auto.stop()
    assert len(list(dest.iterdir())) == 1


def test_auto_first_run_with_a_moving_clock(links_space: Path, tmp_path: Path):
    """Never run: due at the tick's own instant, even when the clock moves between reads."""
    dest = tmp_path / "out"
    dest.mkdir()
    auto = AutoFullExport(
        settings=lambda: _on(dest),
        spaces=lambda scope: [("Linky", links_space)],
        all_spaces=lambda: [links_space],
        clock=lambda: datetime.now(UTC),
        state_dir=lambda: tmp_path / "state",
    )
    assert auto.tick() is not None
    assert len(list(dest.iterdir())) == 1
