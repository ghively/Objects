"""M33 choice 5, the importers: an import no longer adds ``# <title>`` to what it writes.

Until M33 the importer put that line above every page without a first heading of its own (M15's
rule), above an image's and an original-only file's line, above a File object's empty text and
above its own report. The title is in the front matter, and the app shows it above the text, so
those notes read their title twice. A new import writes none of them; a source page that opens
with its own heading keeps it.

A re-run of an import made before M33 changes nothing because of it: a re-run compares the
source (``importSource.contentHash``), never the text it would write, so a note whose source is
as it was is left byte for byte, old heading included (`m33_helpers.as_before_m33` makes the
space the old code left). A source page that really changed is updated as before, and is then
written the new way: that one note loses the added line (its earlier text is in version
history). Synthetic sources only.
"""

from __future__ import annotations

import json
import shutil
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from m15_helpers import FIXTURES, copy_fixture, snapshot, wait_job, zip_folder
from m33_helpers import as_before_m33, body_of, stamped, title_on_top
from test_m25_provenance import PNG, fake_readers, make_files

from objectapp import titleheadings
from objectapp.frontmatter import parse_fm
from objectapp.history import HistoryStore
from objectapp.importers.notion import page_heading
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space


@pytest.fixture
def root(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    made = create_space("Notes", tmp_path)
    HistoryStore(made).migrate()  # a space that has been used has its id (else the first kept version adds it)
    return made


@contextmanager
def opened(root: Path):
    with TestClient(create_app(Space(root), None, watch=False)) as c:
        yield c


def run(client, source: Path, *, target=None, keep_as_sources: bool = False, **extra) -> dict:
    """Preview and import ``source``; the job's result."""
    kind = "newSpace" if target else "currentSpace"
    r = client.post("/api/import/preview", json={"source": {"path": str(source)}, "target": kind,
                                                  "keepAsSources": keep_as_sources})
    assert r.status_code == 200, r.text
    pv = r.json()
    r = client.post("/api/import/start", json={
        "previewId": pv["previewId"], "mapping": pv["mapping"], "target": target or {"kind": "currentSpace"},
        "keepAsSources": keep_as_sources, **extra})
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == "done", job
    return job["result"]


def items(root: Path, batch: str) -> list[dict]:
    return json.loads((root / ".object" / "imports" / batch / "items.json").read_text("utf-8"))


def created(root: Path, batch: str) -> dict[str, dict]:
    """Space path -> the batch's item, for each object the batch created."""
    return {i["path"]: i for i in items(root, batch) if i.get("action") == "created" and i.get("path")}


def title_of(root: Path, rel: str) -> str:
    return str(parse_fm(split_object((root / rel).read_text("utf-8")).frontmatter_src or "")["title"])


def source_heading(source: Path, item: dict) -> str | None:
    """The first heading of the item's own source page, when it has a page that opens with one."""
    path = source / item["sourcePath"]
    if not path.is_file() or path.suffix.lower() != ".md":
        return None
    return page_heading(split_object(path.read_text("utf-8-sig").replace("\r\n", "\n")).body)


def new_files(before: dict, after: dict) -> list[str]:
    return sorted(set(after) - set(before))


def changed_files(before: dict, after: dict) -> list[str]:
    return sorted(p for p in before if after.get(p) != before[p])


BOOK_TYPE = ".object/types/book.json"
"""Not M33's: a re-run of the Obsidian fixture gives the Book type one more "Date" property
(``date_2``, then ``date_3``) each time, at ``41857f51`` as well (the page's ``date`` key is planned
as a new property again). No note is touched by it; reported with M33, left for its own fix."""


def only_the_reruns_own_files(root: Path, before: dict, result: dict, but: tuple[str, ...] = ()) -> None:
    """Nothing that existed changed (bytes, size, modification time), and the only new files
    are the re-run's report page and its batch records."""
    after = stamped(root)
    assert [p for p in changed_files(before, after) if p not in but] == []
    records = f".object/imports/{result['batch']}/"
    assert [p for p in new_files(before, after) if not p.startswith(records)] == [result["reportPath"]]


# -- a new import -----------------------------------------------------------------------------


@pytest.mark.parametrize("fixture", ["import-obsidian", "import-notion", "import-anytype"])
@pytest.mark.parametrize("zipped", [False, True])
def test_a_new_import_adds_no_heading(root: Path, tmp_path: Path, fixture: str, zipped: bool) -> None:
    folder = copy_fixture(fixture, tmp_path / "Source")
    source = zip_folder(folder, tmp_path / "Source.zip") if zipped else folder
    before = snapshot(folder)
    with opened(root) as c:
        res = run(c, source)
        made = created(root, res["batch"])
        assert len(made) == res["objects"] > 2
        with_own = without = 0
        for rel, item in made.items():
            body = body_of(root, rel)
            own = source_heading(folder, item)
            if own is None:
                # nothing above the page's own text; a row or a page with no text has none
                assert page_heading(body) is None, rel
                assert titleheadings.title_line(body, title_of(root, rel)) is None, rel
                without += 1
            else:
                assert page_heading(body) == own, rel  # its own first heading is kept
                with_own += 1
        if fixture == "import-anytype":
            assert (with_own, without) == (len(made), 0)  # every page of that export opens with its title
        else:
            assert without > 0
        if fixture == "import-notion":
            assert with_own > 0  # a Notion page opens with its title as a heading: kept as exported
        # the report page shows its title once, too
        report = body_of(root, res["reportPath"])
        assert report.startswith("- Source: ") and "# Import report" not in report
        # what Settings counts afterwards is only the pages whose own heading is their title
        counted = c.get("/api/space/title-headings").json()["count"]
        assert counted == sum(1 for rel in made if titleheadings.title_line(body_of(root, rel), title_of(root, rel)))
        assert counted <= with_own
    assert snapshot(folder) == before  # the source is only read


def test_pages_rows_and_empty_pages(root: Path, tmp_path: Path) -> None:
    """A Markdown folder, by page: text only, its own heading, a heading that is not its title,
    front matter only, an empty file."""
    src = tmp_path / "Folder"
    src.mkdir()
    (src / "Plain.md").write_text("Just text.\n\nSecond paragraph.\n", encoding="utf-8")
    (src / "Own.md").write_text("# Own\n\nIts own heading, the same as its name.\n", encoding="utf-8")
    (src / "Other.md").write_text("# A different heading\n\nText.\n", encoding="utf-8")
    (src / "Later.md").write_text("Intro.\n\n# Later\n\nText.\n", encoding="utf-8")
    (src / "Blank first.md").write_text("\n\nText after two blank lines.\n", encoding="utf-8")
    (src / "Props.md").write_text("---\nstatus: open\n---\n", encoding="utf-8")
    (src / "Windows.md").write_bytes(b"Line one.\r\nLine two.\r\n")
    with opened(root) as c:
        res = run(c, src)
        by_title = {title_of(root, rel): body_of(root, rel) for rel in created(root, res["batch"])}
        assert by_title == {
            "Plain": "Just text.\n\nSecond paragraph.\n",
            "Own": "# Own\n\nIts own heading, the same as its name.\n",
            "Other": "# A different heading\n\nText.\n",
            "Later": "Intro.\n\n# Later\n\nText.\n",
            "Blank first": "Text after two blank lines.\n",
            "Props": "",
            "Windows": "Line one.\nLine two.\n",
        }
        assert c.get("/api/space/title-headings").json() == {"count": 1}  # "Own", by its own heading


def test_rows_of_a_table_have_an_empty_text(root: Path, tmp_path: Path) -> None:
    """A Notion database row with no page of its own (a CSV row): the note is its properties."""
    src = tmp_path / "Export"
    src.mkdir()
    db = "Gear 0123456789abcdef0123456789abcdef"
    (src / f"{db}.csv").write_text("Name,Weight\nTent,2\nStove,1\n", encoding="utf-8")
    with opened(root) as c:
        res = run(c, src)
        made = created(root, res["batch"])
        assert sorted(title_of(root, rel) for rel in made) == ["Stove", "Tent"]
        for rel in made:
            assert (root / rel).read_text("utf-8").endswith("---\n") and body_of(root, rel) == ""
        assert c.get("/api/space/title-headings").json() == {"count": 0}


def test_files_images_and_originals(root: Path, tmp_path: Path, monkeypatch) -> None:
    fake_readers(monkeypatch)
    src = make_files(tmp_path)
    (src / "photo.png").write_bytes(PNG)
    with opened(root) as c:
        res = run(c, src, keepOriginals="fileObjects")
        made = created(root, res["batch"])
        by_id = {item["id"]: body_of(root, rel) for rel, item in made.items()}
        # a readable page: the reader's text, nothing above it
        assert by_id["01ABC"].startswith("Heading text\n\n![](Attachments/image1.png)\n\nSecond paragraph.\n")
        assert by_id["notes.txt"].startswith("plain text note\n")
        # a PDF: the original first, then its text
        assert by_id["Manual.pdf"].startswith("![[Attachments/Originals/Manual.pdf]]\n\nExtracted pdf text\n")
        # original only: the line that shows the original
        assert by_id["Runbooks/Network.vsdx"].startswith("![[Attachments/Originals/Network.vsdx]]\n")
        # an image is an Image object whose text is the picture
        assert by_id["photo.png"] == "![](Attachments/Originals/photo.png)\n"
        # a Markdown page with its own heading keeps it
        assert by_id["Readme.md"].startswith("# Readme\n\n")
        # "Keep originals as File objects": the File object has no text
        originals = {i: b for i, b in by_id.items() if i.endswith("#original")}
        assert len(originals) >= 3 and set(originals.values()) == {""}
        for rel in made:
            if made[rel]["id"] != "Readme.md":
                assert page_heading(body_of(root, rel)) is None, rel
        assert c.get("/api/space/title-headings").json() == {"count": 1}  # the Readme, by its own heading


def test_a_page_kept_as_a_source_is_still_its_own_bytes(root: Path, tmp_path: Path) -> None:
    src = tmp_path / "Folder"
    src.mkdir()
    (src / "Plain.md").write_bytes(b"Just text.\r\n")
    (src / "Own.md").write_bytes(b"# Own\n\nText.\n")
    with opened(root) as c:
        res = run(c, src, keep_as_sources=True)
        made = created(root, res["batch"])
        assert len(made) == 2
        for rel, item in made.items():
            assert (root / rel).read_bytes().endswith((src / item["sourcePath"]).read_bytes())
        assert c.get("/api/space/title-headings").json() == {"count": 0}  # a Source is never counted
        before = stamped(root)
        again = run(c, src, keep_as_sources=True)
        assert (again["objects"], again["updated"], again["unchanged"]) == (0, 0, 2)
        only_the_reruns_own_files(root, before, again)


def test_a_remodel_adds_no_heading(tmp_path: Path, monkeypatch) -> None:
    """A space read as the source of an import into a new space (M31): each note's text goes over
    as it is, a note made since M32 (no heading) and an older one (its heading) alike."""
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    old = tmp_path / "IT ops test"
    shutil.copytree(FIXTURES / "space-itops", old)
    (tmp_path / "out").mkdir()
    with opened(old) as c:
        made_now = c.post("/api/objects", json={"typeId": "page", "title": "Made since M32", "appendBody": "Its text."})
        assert made_now.status_code == 201
        older = c.post("/api/objects", json={"typeId": "page", "title": "Made before", "templateId": "none",
                                             "body": "# Made before\n\nIts text.\n"})
        assert older.status_code == 201
        empty = c.post("/api/objects", json={"typeId": "page", "title": "No text"})
        assert empty.status_code == 201
        before = snapshot(old)
        res = run(c, old, target={"kind": "newSpace", "name": "Remodel", "location": str(tmp_path / "out")})
    new = tmp_path / "out" / "Remodel"
    made = created(new, res["batch"])
    assert len(made) == res["objects"] > 10
    for rel, item in made.items():
        assert body_of(new, rel).strip("\n") == body_of(old, item["sourcePath"]).strip("\n"), rel
    assert body_of(new, "Pages/Made since M32.md") == "Its text.\n"
    assert body_of(new, "Pages/No text.md") == ""
    assert body_of(new, "Pages/Made before.md") == "# Made before\n\nIts text.\n"
    assert snapshot(old) == before


# -- a re-run of an import made before M33 ----------------------------------------------------


def _old_import(root: Path, source: Path, **extra) -> tuple[dict, list[str]]:
    """Import ``source`` and leave the space as the code before M33 left it: (result, the notes
    that got the added heading)."""
    with opened(root) as c:
        res = run(c, source, **extra)
    headed = as_before_m33(root, res["batch"])
    return res, headed


@pytest.mark.parametrize("fixture", ["import-obsidian", "import-notion", "import-anytype"])
@pytest.mark.parametrize("zipped", [False, True])
def test_a_rerun_of_an_older_import_changes_no_file(root: Path, tmp_path: Path, fixture: str, zipped: bool) -> None:
    folder = copy_fixture(fixture, tmp_path / "Source")
    source = zip_folder(folder, tmp_path / "Source.zip") if zipped else folder
    first, headed = _old_import(root, source)
    # what the old rule headed: the pages without a first heading of their own, and the report
    assert first["reportPath"] in headed
    assert len(headed) >= {"import-obsidian": 5, "import-notion": 2, "import-anytype": 1}[fixture]
    but = (BOOK_TYPE,) if fixture == "import-obsidian" else ()
    for rel in headed:
        assert body_of(root, rel).startswith(f"# {title_of(root, rel)}\n"), rel
    before = stamped(root)
    with opened(root) as c:
        assert c.get("/api/space/title-headings").json()["count"] >= len(headed)
        second = run(c, source)
        assert (second["objects"], second["updated"], second["changedInBoth"], second["failed"]) == (0, 0, 0, 0)
        assert second["unchanged"] == first["objects"]
        only_the_reruns_own_files(root, before, second, but)
        assert {i["action"] for i in items(root, second["batch"])} == {"unchanged"}
        # and a third time
        before = stamped(root)
        third = run(c, source)
        assert (third["objects"], third["updated"], third["unchanged"]) == (0, 0, first["objects"])
        only_the_reruns_own_files(root, before, third, but)


def test_a_rerun_of_older_files_images_and_originals_changes_no_file(root: Path, tmp_path: Path, monkeypatch) -> None:
    fake_readers(monkeypatch)
    src = make_files(tmp_path)
    (src / "photo.png").write_bytes(PNG)
    first, headed = _old_import(root, src, keepOriginals="fileObjects")
    assert len(headed) >= 9  # the pages, the image, the File objects, the report
    before = stamped(root)
    with opened(root) as c:
        second = run(c, src, keepOriginals="fileObjects")
        assert (second["objects"], second["updated"], second["changedInBoth"]) == (0, 0, 0)
        assert second["unchanged"] == first["objects"]
        only_the_reruns_own_files(root, before, second)


def _folder(tmp_path: Path) -> Path:
    src = tmp_path / "Folder"
    src.mkdir()
    for name in ("Alpha", "Beta", "Gamma"):
        (src / f"{name}.md").write_text(f"{name}, version one.\n", encoding="utf-8")
    (src / "Own.md").write_text("# Own\n\nVersion one.\n", encoding="utf-8")
    return src


def test_a_changed_source_page_is_updated_and_written_the_new_way(root: Path, tmp_path: Path) -> None:
    src = _folder(tmp_path)
    first, _headed = _old_import(root, src)
    paths = {title_of(root, rel): rel for rel in created(root, first["batch"])}
    assert body_of(root, paths["Alpha"]) == "# Alpha\n\nAlpha, version one.\n"
    old_alpha = (root / paths["Alpha"]).read_bytes()
    before = stamped(root)
    (src / "Alpha.md").write_text("Alpha, version two.\n", encoding="utf-8")
    (src / "Own.md").write_text("# Own\n\nVersion two.\n", encoding="utf-8")
    with opened(root) as c:
        second = run(c, src)
        assert (second["objects"], second["updated"], second["unchanged"], second["changedInBoth"]) == (0, 2, 2, 0)
        # the updated note is written as a new import writes it: the added line is gone from it
        assert body_of(root, paths["Alpha"]) == "Alpha, version two.\n"
        assert body_of(root, paths["Own"]) == "# Own\n\nVersion two.\n"  # its own heading stays
        # its earlier text, heading included, is in version history
        versions = c.get("/api/history", params={"path": paths["Alpha"]}).json()["versions"]
        texts = [c.get("/api/history/version", params={"path": paths["Alpha"], "id": v["id"]}).json()["text"] for v in versions]
        assert old_alpha.decode("utf-8") in texts
        # the notes whose source did not change keep every byte, the old heading included
        after = stamped(root)
        assert changed_files(before, after) == sorted([paths["Alpha"], paths["Own"]])
        assert body_of(root, paths["Beta"]) == "# Beta\n\nBeta, version one.\n"
        # the id and the creation time of the updated note are kept
        fm_old = parse_fm(split_object(old_alpha.decode()).frontmatter_src)
        fm_new = parse_fm(split_object((root / paths["Alpha"]).read_text("utf-8")).frontmatter_src)
        assert (fm_new["id"], fm_new["createdAt"]) == (fm_old["id"], fm_old["createdAt"])


def test_after_the_headings_are_removed_a_rerun_still_changes_nothing(root: Path, tmp_path: Path) -> None:
    """"Remove those headings" on notes an older import made, then the import run again: the
    source is as it was, so nothing is written (the headings do not come back). A source page
    that changes afterwards is "changed in both", as for any note edited in Object: the removal
    counts as the person's edit, so the note is not overwritten."""
    src = _folder(tmp_path)
    first, _headed = _old_import(root, src)
    paths = {title_of(root, rel): rel for rel in created(root, first["batch"])}
    with opened(root) as c:
        assert c.get("/api/space/title-headings").json() == {"count": 5}  # four notes and the report
        assert c.post("/api/space/title-headings/remove").json() == {"changed": 5}
        assert body_of(root, paths["Alpha"]) == "Alpha, version one.\n"
        assert body_of(root, paths["Own"]) == "Version one.\n"  # its own heading repeated the title too
        before = stamped(root)
        second = run(c, src)
        assert (second["objects"], second["updated"], second["unchanged"], second["changedInBoth"]) == (0, 0, 4, 0)
        only_the_reruns_own_files(root, before, second)
        assert c.get("/api/space/title-headings").json() == {"count": 0}
        (src / "Alpha.md").write_text("Alpha, version two.\n", encoding="utf-8")
        before = stamped(root)
        third = run(c, src)
        assert (third["updated"], third["unchanged"], third["changedInBoth"]) == (0, 3, 1)
        assert changed_files(before, stamped(root)) == []  # the note is left; the new text waits in the batch
        assert body_of(root, paths["Alpha"]) == "Alpha, version one.\n"


def test_the_helper_writes_what_the_old_rule_wrote() -> None:
    assert title_on_top("", "T") == "# T\n"
    assert title_on_top("Text.\n", "T") == "# T\n\nText.\n"
    assert title_on_top("# Own\n\nText.\n", "T") == "# Own\n\nText.\n"
    assert title_on_top("## Sub\n", "T") == "# T\n\n## Sub\n"
