"""M15 review fixes (back end): one test (or a few) per finding, numbered as in the review."""

from __future__ import annotations

import io
import json
import random
import threading
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from m15_helpers import FIXTURES, copy_fixture, snapshot, wait_job
from objectapp.appstate import state_dir
from objectapp.importers import markdown
from objectapp.importers.detect import read_source
from objectapp.importers.model import ImportMapping, SkippedItem
from objectapp.importers.planner import MappingProblem, Target, _singular, importable_type, plan
from objectapp.importers.readmodel import SourceIndex
from objectapp.importers.report import build_report
from objectapp.importers.source import LimitExceeded, open_source
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.watcher import RESYNC_PATH, ChangeEvent

ID = "0123456789abcdef0123456789abcdef"


def _read(path: Path, kind: str = "auto"):
    with open_source(path) as src:
        return read_source(src, kind)


@pytest.fixture
def client(space_dir):
    app = create_app(Space(space_dir), watch=False)
    with TestClient(app) as c:
        c.space_root = space_dir  # type: ignore[attr-defined]
        c.app_ref = app  # type: ignore[attr-defined]
        yield c


def _preview(client, path, **extra):
    body = {"source": {"path": str(path), "kind": extra.pop("kind", "auto")}, "keepAsSources": False, **extra}
    return client.post("/api/import/preview", json=body)


def _start(client, preview: dict, target: dict, mapping: dict | None = None):
    return client.post(
        "/api/import/start",
        json={"previewId": preview["previewId"], "mapping": mapping or preview["mapping"], "target": target,
              "keepAsSources": False},
    )


def _import(client, preview: dict, target: dict, mapping: dict | None = None, phase: str = "done") -> dict:
    r = _start(client, preview, target, mapping)
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == phase, job
    return job


def _hooks(pages, files, csvs=()):
    idx = SourceIndex(list(pages), list(files), list(csvs))
    return markdown.Hooks(
        idx.resolve_href,
        idx.resolve_wiki,
        object_link=lambda t, _f: (t[:-3], t[:-3].rsplit("/", 1)[-1]),
        attachment_path=lambda t: "Attachments/" + t.rsplit("/", 1)[-1],
    )


# -- 1. link destinations with parentheses -------------------------------------------


def test_1_link_destinations_keep_balanced_parentheses():
    page = f"Notes (2021) {ID}.md"
    hooks = _hooks([page, "Home.md"], ["img (1).png"])
    out = markdown.convert(f"See [Notes (2021)](Notes%20(2021)%20{ID}.md) here.", "Home.md", hooks)
    assert out.text == f"See [[Notes (2021) {ID}|Notes (2021)]] here."
    assert [(lk.kind, lk.target) for lk in out.links] == [("object", page)]
    img = markdown.convert("![x](img%20(1).png) after", "Home.md", hooks)
    assert img.text == "![x](Attachments/img%20%281%29.png) after"
    # A destination with an unbalanced parenthesis is still not a link; a title still works.
    assert markdown.convert("[x](a(b.md)", "Home.md", hooks).text == "[x](a(b.md)"
    assert markdown.convert('[x](Home.md "The (home)")', "Home.md", hooks).text == "[[Home|x]]"


def test_1_notion_import_with_parentheses_end_to_end(client, tmp_path):
    src = tmp_path / "n"
    src.mkdir()
    (src / f"Home {'1' * 32}.md").write_text(
        f"# Home\n\nSee [Notes (2021)](Notes%20(2021)%20{ID}.md) and ![pic](Home%20{'1' * 32}/img%20(1).png).\n"
    )
    (src / f"Home {'1' * 32}").mkdir()
    (src / f"Home {'1' * 32}" / "img (1).png").write_bytes(b"\x89PNG data")
    (src / f"Notes (2021) {ID}.md").write_text("# Notes (2021)\n\nbody\n")
    preview = _preview(client, src).json()
    assert preview["kind"] == "notion" and preview["counts"]["unresolvedLinks"] == 0
    job = _import(client, preview, {"kind": "newSpace", "name": "Paren", "location": str(tmp_path)})
    home = (Path(job["targetPath"]) / "Pages" / "Home.md").read_text()
    assert "See [[Notes (2021)]] and ![pic](Attachments/img%20%281%29.png)." in home


# -- 2. one resync, no origin, when an import into this space ends --------------------


def _published(client) -> list[ChangeEvent]:
    events: list[ChangeEvent] = []
    client.app_ref.state.hub.publish = events.append
    return events


def _settle(events: list, count: int, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while len(events) < count and time.monotonic() < deadline:
        time.sleep(0.02)
    time.sleep(0.1)  # and nothing more arrives


def test_2_import_into_this_space_announces_one_resync(client, tmp_path):
    events = _published(client)
    folder = copy_fixture("import-obsidian", tmp_path / "vault")
    preview = _preview(client, folder, target="currentSpace").json()
    r = client.post(  # the dialog sends no clientId; one sent anyway changes nothing
        "/api/import/start",
        json={"previewId": preview["previewId"], "mapping": preview["mapping"],
              "target": {"kind": "currentSpace"}, "clientId": "me", "keepAsSources": False},
    )
    assert r.status_code == 202
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == "done" and job["result"]["objects"] > 1
    _settle(events, 1)
    assert events == [ChangeEvent("types", RESYNC_PATH, None, origin=None)]


def test_2_stopped_import_announces_one_resync(client, tmp_path, monkeypatch):
    from objectapp.importers import jobs

    calls = {"n": 0}

    def cancelled(self):
        calls["n"] += 1
        return calls["n"] > 3

    monkeypatch.setattr(jobs.JobHandle, "cancelled", cancelled)
    events = _published(client)
    folder = copy_fixture("import-obsidian", tmp_path / "vault")
    preview = _preview(client, folder, target="currentSpace").json()
    job = _import(client, preview, {"kind": "currentSpace"}, phase="cancelled")
    assert job["result"]["reportPath"]
    # fix pass H: the result says how many of the failed were not written because it stopped (like the report)
    assert job["result"]["notWritten"] > 0 and job["result"]["failed"] >= job["result"]["notWritten"]
    _settle(events, 1)
    assert events == [ChangeEvent("types", RESYNC_PATH, None, origin=None)]


def test_2_nothing_written_announces_nothing(client, tmp_path, monkeypatch):
    from objectapp.importers import writer
    from objectapp.importers.source import SourceMissing

    def gone(_path):
        raise SourceMissing("gone")

    events = _published(client)
    folder = copy_fixture("import-anytype", tmp_path / "a")
    preview = _preview(client, folder, target="currentSpace").json()
    monkeypatch.setattr(writer, "open_source", gone)
    _import(client, preview, {"kind": "currentSpace"}, phase="failed")
    _settle(events, 1, timeout=0.3)
    assert events == []


# -- 3. nested zips: no quadratic re-reading, nothing written --------------------------


def _nested(tmp_path: Path, n: int, outer_mode: int) -> Path:
    buf = io.BytesIO()
    rnd = random.Random(1)
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as inner:
        for i in range(n):
            inner.writestr(f"Page {i} {i:032x}.md", f"# Page {i}\n\n" + rnd.randbytes(3000).hex())
    z = tmp_path / "Export-abc.zip"
    with zipfile.ZipFile(z, "w", outer_mode) as zf:
        zf.writestr("Export-abc-Part-1.zip", buf.getvalue())
        zf.writestr("Top.md", "# Top\n")
    return z


@pytest.mark.parametrize("outer_mode", [zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED])
def test_3_nested_zip_under_the_cap_is_read_in_memory(tmp_path, outer_mode):
    z = _nested(tmp_path, 40, outer_mode)
    before = sorted(p.name for p in tmp_path.iterdir())
    with open_source(z) as src:
        assert len(src.files) == 41
        names = list(src.files)
        random.Random(2).shuffle(names)
        for rel in names:
            assert src.read(rel, 1 << 20).startswith(b"# ")
        assert isinstance(src._zips[1].fp, io.BytesIO)
    assert sorted(p.name for p in tmp_path.iterdir()) == before  # no temporary files


def test_3_nested_zip_over_the_cap_reads_backwards_cheaply(tmp_path, monkeypatch):
    from objectapp.importers import source as source_mod

    z = _nested(tmp_path, 300, zipfile.ZIP_DEFLATED)
    monkeypatch.setattr(source_mod, "NESTED_IN_MEMORY", 1024)
    monkeypatch.setattr(source_mod, "CHECKPOINT_EVERY", 16 * 1024)
    with zipfile.ZipFile(z) as zf:
        inner_size = zf.getinfo("Export-abc-Part-1.zip").file_size
        expected = {}
        with zipfile.ZipFile(io.BytesIO(zf.read("Export-abc-Part-1.zip"))) as inner:
            for info in inner.infolist():
                expected[info.filename] = inner.read(info)
    with open_source(z) as src:
        stream = src._handles[-1]
        assert isinstance(stream, source_mod.SeekableInflate)
        for rel in reversed([r for r in src.files if r != "Top.md"]):
            assert src.read(rel, 1 << 20) == expected[rel]
        # Reading every entry backwards inflates a few times the inner zip; starting over
        # for each entry (what reading through the outer zip did) would be about 150 times.
        assert stream.inflated < 10 * inner_size


# -- 5. types that can't take imported pages -----------------------------------------


def _whiteboard_space(tmp_path: Path) -> Path:
    import shutil

    root = tmp_path / "wb"
    shutil.copytree(FIXTURES / "space-whiteboard", root)
    for tid, name, plural in (
        ("image", "Image", "Images"), ("dailynote", "DailyNote", "Daily notes"), ("gizmo", "Gizmo", "Gizmos"),
    ):
        (root / ".object" / "types" / f"{tid}.json").write_text(
            json.dumps({"id": tid, "name": name, "pluralName": plural, "folder": plural, "basic": True,
                        "propertyDefinitions": []})
        )
    return root


def test_5_special_types_are_not_matched_by_name(tmp_path):
    space = Space(_whiteboard_space(tmp_path))
    by_id = {t.id: t for t in space.types}
    assert not importable_type(by_id["whiteboard"]) and not importable_type(by_id["tag"])
    assert not importable_type(by_id["image"]) and not importable_type(by_id["dailynote"])
    assert not importable_type(by_id["gizmo"])  # any basic type but Page and Task
    assert importable_type(by_id["page"]) and importable_type(by_id["person"])
    src = tmp_path / "v"
    for folder in ("Whiteboards", "Tags", "Images", "DailyNotes", "Persons"):
        (src / folder).mkdir(parents=True)
        (src / folder / f"In {folder}.md").write_text("hello\n")
    p = plan(_read(src), None, Target("currentSpace", space))
    got = {t.key: (t.name, t.existingTypeId) for t in p.plan.types}
    assert got["folder:Whiteboards"] == ("Whiteboard (2)", None)
    assert got["folder:Tags"] == ("Tag (2)", None)
    assert got["folder:Images"] == ("Image (2)", None)
    assert got["folder:DailyNotes"] == ("DailyNote (2)", None)
    assert got["folder:Persons"] == ("Person", "person")
    for tid in ("whiteboard", "tag", "image", "dailynote"):
        with pytest.raises(MappingProblem, match=by_id[tid].name):
            plan(_read(src), ImportMapping(types={"folder:Persons": {"existingTypeId": tid}}),
                 Target("currentSpace", space))


def test_duplicate_page_names_link_to_the_nearest():
    """Fix pass H: [[Dune]] with Books/Dune and Movies/Dune goes to the one in the linking page's folder
    (then the deepest shared folder), not to whichever path sorts first."""
    idx = SourceIndex(["Books/Dune.md", "Movies/Dune.md", "Movies/Watchlist.md", "Movies/Lists/Best.md", "Home.md",
                       "Books/Reading.md"], [], [])
    assert idx.page("Dune", "Movies/Watchlist.md") == "Movies/Dune.md"
    assert idx.page("Dune", "Movies/Lists/Best.md") == "Movies/Dune.md"
    assert idx.page("Dune", "Books/Reading.md") == "Books/Dune.md"
    assert idx.page("Dune", "Home.md") == "Books/Dune.md"  # no nearer one: shortest path, as before
    assert idx.page("Books/Dune", "Movies/Watchlist.md") == "Books/Dune.md"  # an exact path always wins


def test_people_folder_joins_the_person_type(tmp_path):
    """Fix pass H: an Obsidian 'People' folder joins Person instead of becoming 'People (2)'; a folder named
    like an existing type's plural joins that type even when the plain rule misses (Indices -> Index)."""
    space = Space(_whiteboard_space(tmp_path))
    index = space.create_type("Index", "Indices", None, None)
    src = tmp_path / "v"
    for folder in ("People", "Indices"):
        (src / folder).mkdir(parents=True)
        (src / folder / f"In {folder}.md").write_text("hello\n")
    p = plan(_read(src), None, Target("currentSpace", space))
    got = {t.key: (t.name, t.existingTypeId) for t in p.plan.types}
    assert got["folder:People"] == ("Person", "person")
    assert got["folder:Indices"] == ("Index", index.id)


def test_5_explicit_special_type_answers_422(tmp_path):
    root = _whiteboard_space(tmp_path)
    app = create_app(Space(root), watch=False)
    src = tmp_path / "v"
    (src / "Boards").mkdir(parents=True)
    (src / "Boards" / "B.md").write_text("hello\n")
    with TestClient(app) as c:
        p = _preview(c, src, target="currentSpace").json()
        mapping = p["mapping"]
        mapping["types"]["folder:Boards"]["existingTypeId"] = "whiteboard"
        r = _preview(c, src, target="currentSpace", mapping=mapping)
        assert r.status_code == 422 and "Whiteboard" in r.json()["detail"]
        r = _start(c, p, {"kind": "currentSpace"}, mapping)
        assert r.status_code == 422 and "Whiteboard" in r.json()["detail"]


# -- 6. the Attachments folder is listed once -----------------------------------------


def test_6_attachments_folder_listed_once(client, tmp_path, monkeypatch):
    from objectapp.importers import writer

    src = tmp_path / "v"
    (src / "files").mkdir(parents=True)
    for i in range(6):
        (src / "files" / f"img{i}.png").write_bytes(b"png" + bytes([i]))
    (src / "Gallery.md").write_text("\n\n".join(f"![[img{i}.png]]" for i in range(6)) + "\n")
    calls = {"n": 0}
    real = writer._names_in

    def counting(path):
        calls["n"] += 1
        return real(path)

    preview = _preview(client, src, target="currentSpace").json()
    # Taken meanwhile: the next free name is used, and the page links to it.
    (client.space_root / "Attachments").mkdir(exist_ok=True)
    (client.space_root / "Attachments" / "img0.png").write_bytes(b"theirs")
    monkeypatch.setattr(writer, "_names_in", counting)
    _import(client, preview, {"kind": "currentSpace"})
    assert calls["n"] == 1
    assert (client.space_root / "Attachments" / "img0.png").read_bytes() == b"theirs"
    assert (client.space_root / "Attachments" / "img0 (2).png").read_bytes() == b"png\x00"
    gallery = next(client.space_root.rglob("Gallery.md")).read_text()
    assert "![](Attachments/img0%20%282%29.png)" in gallery


# -- 7. an escaped pipe in a table ----------------------------------------------------


def test_7_escaped_pipe_is_the_alias_separator():
    hooks = _hooks(["Books/Dune.md", "Home.md"], ["img.png"])
    out = markdown.convert("| a | [[Dune\\|the book]] |\n|---|---|", "Home.md", hooks)
    assert out.text == "| a | [[Books/Dune\\|the book]] |\n|---|---|"
    assert [(lk.kind, lk.target, lk.text) for lk in out.links] == [("object", "Books/Dune.md", "the book")]
    out = markdown.convert("| [[Dune#Plot\\|plot]] | ![[img.png\\|300]] |", "Home.md", hooks)
    assert out.text == "| [[Books/Dune#Plot\\|plot]] | ![](Attachments/img.png) |"


# -- 8. type folders that differ only in case -----------------------------------------


def test_8_type_folders_unique_ignoring_case(tmp_path):
    src = tmp_path / "kc"
    for d, value in (("d1", "book"), ("d2", "Book")):
        (src / d).mkdir(parents=True)
        (src / d / "X.md").write_text(f"---\ntype: {value}\n---\nx\n")
    (src / "c.md").write_text("# Home\n\n[[d1/X]] [[d2/X]]\n")
    p = plan(_read(src, "anytype"), ImportMapping(typeSource="key", typeKey="type"), Target("newSpace"))
    folders = [tw.folder for tw in p.type_writes.values()]
    assert len({f.casefold() for f in folders}) == len(folders)
    paths = [o.targetPath for o in p.plan.objects]
    assert len({x.casefold() for x in paths}) == len(paths)
    second = next(t for t in p.plan.types if t.key == "key:Book")
    assert second.name == "Book (2)" and second.pluralName == "Books (2)"
    # Each link names its own object.
    assert p.object_link("d1/X.md", "c.md")[0] != p.object_link("d2/X.md", "c.md")[0]


def test_8_planned_names_are_free_ignoring_folder_case(tmp_path):
    space = Space(copy_fixture("space-sample", tmp_path / "s"))
    page = space.type_by_id("page")
    folder = page.folder.strip("/")
    (space.root / folder / "Taken.md").write_text("---\ntitle: Taken\n---\n")
    src = tmp_path / "v"
    src.mkdir()
    (src / "Taken.md").write_text("hello\n")
    p = plan(_read(src), ImportMapping(typeSource="none"), Target("currentSpace", space))
    assert p.plan.objects[0].targetPath == f"{folder}/Taken (2).md"


# -- 9. the object limit is checked while rows are read -------------------------------


def test_9_csv_rows_counted_while_reading(tmp_path, monkeypatch):
    from objectapp.importers import notion

    monkeypatch.setattr(notion, "MAX_OBJECTS", 10)
    src = tmp_path / "csv"
    src.mkdir()
    (src / f"Big {'a' * 32}.csv").write_text("Name,Tag\n" + "".join(f"r{i},x\n" for i in range(1000)))
    (src / f"Home {'b' * 32}.md").write_text("# Home\n")
    seen = {"rows": 0}
    real = notion._rows

    def counting(text):
        for row in real(text):
            seen["rows"] += 1
            yield row

    monkeypatch.setattr(notion, "_rows", counting)
    with pytest.raises(LimitExceeded):
        _read(src, "notion")
    assert seen["rows"] < 20


# -- 10, 11, 13. the report after a race, a stop and a write that fails -----------------


def test_10_fallback_rename_is_reported(client, tmp_path, monkeypatch):
    from objectapp.importers import writer

    src = tmp_path / "v"
    src.mkdir()
    (src / "Fresh.md").write_text("hello\n")
    preview = _preview(client, src, target="currentSpace").json()
    planned = preview["samples"][0]["path"]
    real = writer._objects

    def taken_meanwhile(planned_import, space, state, source):
        # Someone writes the planned file between the plan and the write.
        (space.root / planned).parent.mkdir(parents=True, exist_ok=True)
        (space.root / planned).write_text("---\ntitle: Fresh\n---\nmine\n")
        return real(planned_import, space, state, source)

    monkeypatch.setattr(writer, "_objects", taken_meanwhile)
    job = _import(client, preview, {"kind": "currentSpace"})
    assert (client.space_root / planned).read_text().endswith("mine\n")
    report = (client.space_root / job["result"]["reportPath"]).read_text()
    assert f"`Fresh` was written as [[{planned[:-3]} (2)]]" in report


def test_11_and_o6_cancel_mid_write(client, tmp_path, monkeypatch):
    from objectapp.importers import jobs

    placed = {"n": 0}
    real = Space.place_new

    def counting(self, rel, data):
        placed["n"] += 1
        return real(self, rel, data)

    monkeypatch.setattr(Space, "place_new", counting)
    monkeypatch.setattr(jobs.JobHandle, "cancelled", lambda self: placed["n"] >= 2)
    folder = copy_fixture("import-obsidian", tmp_path / "vault")
    preview = _preview(client, folder).json()
    job = _import(client, preview, {"kind": "newSpace", "name": "Half", "location": str(tmp_path)}, phase="cancelled")
    root = tmp_path / "Half"
    written = job["result"]["objects"]
    assert 0 < written < preview["counts"]["objects"]
    report = (root / "Pages" / "Import report.md").read_text()
    assert "stopped early" in report
    assert "Links to objects that weren't imported stay unresolved." in report
    # Every file written is whole: each object parses and has its id.
    space = Space(root)
    assert len([s for s in space.list() if s.type not in ("tag",) and s.title != "Import report"]) == written
    for s in space.list():
        assert space.read(s.path)[1].get("id")


def test_13_a_file_that_cant_be_written_is_skipped(client, tmp_path, monkeypatch):
    src = tmp_path / "v"
    src.mkdir()
    for name in ("One", "Two", "Three"):
        (src / f"{name}.md").write_text(f"{name}\n")
    preview = _preview(client, src).json()
    real = Space.place_new

    def flaky(self, rel, data):
        if rel.endswith("Two.md"):
            raise OSError(36, "File name too long")
        return real(self, rel, data)

    monkeypatch.setattr(Space, "place_new", flaky)
    job = _import(client, preview, {"kind": "newSpace", "name": "Flaky", "location": str(tmp_path)})
    assert job["result"]["objects"] == 2
    report = (tmp_path / "Flaky" / "Pages" / "Import report.md").read_text()
    assert "`Two.md`" in report and "File name too long" in report


# -- 12. a source gone before the job writes leaves no empty space ---------------------


def test_12_failed_start_creates_no_space(client, tmp_path, monkeypatch):
    from objectapp.importers import writer
    from objectapp.importers.source import SourceMissing

    folder = copy_fixture("import-anytype", tmp_path / "a")
    preview = _preview(client, folder).json()
    real = writer.open_source

    def gone(_path):
        raise SourceMissing("gone")

    monkeypatch.setattr(writer, "open_source", gone)
    job = _import(client, preview, {"kind": "newSpace", "name": "Retry", "location": str(tmp_path)}, phase="failed")
    assert job["error"]
    assert not (tmp_path / "Retry").exists()
    from objectapp.spaces import Registry

    assert not any(Path(e.path).name == "Retry" for e in Registry(state_dir()).list())
    monkeypatch.setattr(writer, "open_source", real)
    preview = _preview(client, folder).json()
    _import(client, preview, {"kind": "newSpace", "name": "Retry", "location": str(tmp_path)})


# -- 14. a Markdown link's #heading is kept -------------------------------------------


def test_14_markdown_link_heading_kept():
    hooks = _hooks(["Emma.md", "Home.md"], [])
    out = markdown.convert("[x](Emma.md#Plot) [Emma](Emma.md#Plot%20twist) [y](Emma.md#a]b)", "Home.md", hooks)
    assert out.text == "[[Emma#Plot|x]] [[Emma#Plot twist]] [[Emma|y]]"
    assert out.links[0].heading == "#Plot"


# -- 15. the preview cache --------------------------------------------------------------


def test_15_previews_of_several_sources_can_start(client, tmp_path, monkeypatch):
    from objectapp import api_import

    sources = []
    for i in range(4):
        folder = tmp_path / f"s{i}"
        folder.mkdir()
        (folder / f"Note {i}.md").write_text("hello\n")
        sources.append(folder)
    previews = [_preview(client, s).json() for s in sources]
    # The new spaces get their own folder: on a case-insensitive file system (Windows,
    # macOS) a space "S1" next to the source "s1" is the same name, and is refused (409).
    spaces = tmp_path / "spaces"
    spaces.mkdir()
    # The oldest of four reads is gone (three kept); the others start.
    assert _start(client, previews[0], {"kind": "newSpace", "name": "S0", "location": str(spaces)}).status_code == 404
    r = _start(client, previews[1], {"kind": "newSpace", "name": "S1", "location": str(spaces)})
    assert r.status_code == 202
    wait_job(client, r.json()["jobId"])
    # Its read was dropped when the import started.
    assert _start(client, previews[1], {"kind": "newSpace", "name": "S1b", "location": str(spaces)}).status_code == 404
    # A re-preview of the same source reuses its read; an expired read answers 404.
    again = _preview(client, sources[2]).json()
    assert again["counts"] == previews[2]["counts"]
    real = time.monotonic
    monkeypatch.setattr(api_import.time, "monotonic", lambda: real() + api_import.READ_TTL + 1)
    assert _start(client, previews[3], {"kind": "newSpace", "name": "S3", "location": str(spaces)}).status_code == 404


# -- 16. Obsidian's system keys ignore case ---------------------------------------------


def test_16_system_keys_ignore_case(tmp_path):
    src = tmp_path / "v"
    src.mkdir()
    (src / "A.md").write_text("---\nTags: [Big, '#small']\nAliases: Ay\nTitle: The A\nDescription: d\n---\nbody\n")
    o = _read(src).objects[0]
    assert o.title == "The A"
    assert o.system["tags"] == ["Big", "small"] and o.system["aliases"] == ["Ay"]
    assert o.system["description"] == "d"
    assert o.fields == {}


# -- O2. singular names ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("plural", "singular"),
    [
        ("Movies", "Movie"), ("Classes", "Class"), ("Boxes", "Box"), ("Watches", "Watch"),
        ("Wishes", "Wish"), ("Stories", "Story"), ("Books", "Book"), ("People", "Person"),
        ("PEOPLE", "PERSON"), ("Key People", "Key Person"), ("Children", "Child"), ("Women", "Woman"),
        ("Series", "Series"), ("Status", "Status"), ("News", "News"), ("Analysis", "Analysis"),
        ("Bus", "Bus"), ("Glass", "Glass"), ("STORIES", "STORY"), ("s", "s"), ("ies", "ies"),
        ("Notes", "Note"), ("Cookies", "Cookie"), ("Address", "Address"), ("Taxes", "Tax"),
    ],
)
def test_o2_singular(plural, singular):
    assert _singular(plural) == singular


# -- O5. counts in the report -----------------------------------------------------------


def test_o5_report_counts_singular():
    body = build_report(
        title="Import report", source_path="/x", kind="obsidian", when="now",
        counts={"objects": 1, "types": 1, "attachments": 1, "tags": 1},
        skipped=[], renamed=[], unresolved=[], not_converted=[], link_for=lambda _s: None,
    )
    assert "Imported 1 object, 1 type, 1 attachment and 1 tag." in body
    body = build_report(
        title="Import report", source_path="/x", kind="obsidian", when="now",
        counts={"objects": 2, "types": 0, "attachments": 3, "tags": 1000},
        skipped=[SkippedItem(path="a", reason="emptyFile")], renamed=[], unresolved=[], not_converted=[],
        link_for=lambda _s: None,
    )
    assert "Imported 2 objects, 0 types, 3 attachments and 1,000 tags." in body


# -- O6. drive letters and backslashes in zip names, end to end ------------------------


def test_o6_backslash_and_drive_letter_zip_names(client, tmp_path):
    z = tmp_path / "win.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("C:\\evil.md", "# evil\n")
        zf.writestr("c:evil2.md", "# evil2\n")
        zf.writestr("..\\evil3.md", "# evil3\n")
        zf.writestr("Notes\\Sub\\Deep.md", "# Deep\n\n![](pic.png) [[Top]]\n")
        zf.writestr("Notes\\Sub\\pic.png", b"\x89PNG")
        zf.writestr("Top.md", "# Top\n\n[[Deep]]\n")
    before = sorted(p.name for p in tmp_path.iterdir())
    preview = _preview(client, z).json()
    assert sorted(s["path"] for s in preview["skipped"] if s["reason"] == "unsafePath") == [
        "../evil3.md", "C:/evil.md", "c:evil2.md"
    ]
    job = _import(client, preview, {"kind": "newSpace", "name": "Win", "location": str(tmp_path)})
    root = tmp_path / "Win"
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted([*before, "Win"])
    deep = (root / "Notes" / "Deep.md").read_text()
    assert "![](Attachments/pic.png)" in deep and "[[Top]]" in deep
    assert (root / "Attachments" / "pic.png").read_bytes() == b"\x89PNG"
    assert not list(root.rglob("evil*"))
    assert job["result"]["objects"] == 2


def test_o6_snapshot_includes_the_cache(tmp_path):
    (tmp_path / ".object-cache").mkdir()
    (tmp_path / ".object-cache" / "x").write_text("y")
    assert ".object-cache/x" in snapshot(tmp_path)


def test_preview_cache_lru_is_thread_safe(client, tmp_path):
    """Previews from several threads at once (the dialog's debounce racing a slow re-preview)."""
    folders = []
    for i in range(5):
        f = tmp_path / f"t{i}"
        f.mkdir()
        (f / "N.md").write_text("x\n")
        folders.append(f)
    codes: list[int] = []

    def go(f):
        codes.append(_preview(client, f).status_code)

    threads = [threading.Thread(target=go, args=(f,)) for f in folders]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert codes == [200] * 5
