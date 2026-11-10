"""M15 Lane B: detection, the readers, the planner and the import API end to end."""

from __future__ import annotations

import shutil
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from m15_helpers import copy_fixture, snapshot, wait_job, zip_folder
from objectapp.appstate import state_dir
from objectapp.fmcache import cache_dir_for_root
from objectapp.importers.detect import detect, read_source
from objectapp.importers.model import ImportMapping
from objectapp.importers.planner import MappingProblem, Target, plan
from objectapp.importers.source import open_source
from objectapp.server import create_app
from objectapp.space import Space


def _read(path: Path, kind: str = "auto"):
    with open_source(path) as src:
        return read_source(src, kind)


@pytest.fixture
def client(space_dir):
    app = create_app(Space(space_dir), watch=False)
    with TestClient(app) as c:
        c.space_root = space_dir  # type: ignore[attr-defined]
        yield c


def _preview(client, path, **extra):
    body = {"source": {"path": str(path), "kind": extra.pop("kind", "auto")}, **extra}
    return client.post("/api/import/preview", json=body)


def _import(client, preview: dict, target: dict, mapping: dict | None = None) -> dict:
    r = client.post(
        "/api/import/start",
        json={"previewId": preview["previewId"], "mapping": mapping or preview["mapping"], "target": target,
              "keepAsSources": False},
    )
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == "done", job
    return job


# -- detection and readers ------------------------------------------------------------


def test_detection(tmp_path):
    for name, expected in (("import-obsidian", "obsidian"), ("import-notion", "notion"), ("import-anytype", None)):
        folder = copy_fixture(name, tmp_path / name)
        with open_source(folder) as src:
            assert detect(src) == expected
        with open_source(zip_folder(folder, tmp_path / f"{name}.zip")) as src:
            assert detect(src) == expected


def test_plain_markdown_folder_warns(tmp_path):
    read = _read(copy_fixture("import-anytype", tmp_path / "any"))
    assert read.kind == "obsidian" and read.detected is None
    assert read.warnings[0].startswith("Couldn't tell where this export came from")


def test_notion_reader(tmp_path):
    read = _read(zip_folder(copy_fixture("import-notion", tmp_path / "n"), tmp_path / "Export-0123abcd-1111-2222-3333-444455556666.zip"))
    assert read.suggestedName == "Notion import"
    books = next(d for d in read.databases if d.name == "Books")
    assert books.csvPath.endswith("_all.csv")
    titles = sorted(o.title for o in read.objects if o.group == books.key)
    assert titles == ["Dune", "Loose page", "Row without page", "Untitled", "Untitled"]
    loose = next(o for o in read.objects if o.title == "Loose page")
    assert loose.fields == {"Rating": "2", "Genre": "Drama"}


def test_planner_defaults_and_mapping(tmp_path):
    read = _read(copy_fixture("import-obsidian", tmp_path / "v"))
    p = plan(read, None, Target("newSpace"))
    types = {t.key: t for t in p.plan.types}
    assert types["folder:Books"].name == "Book" and types["folder:People"].name == "Person"
    assert types["folder:Movies"].pluralName == "Movies"
    props = {pp.key: pp for pp in types["folder:Books"].properties}
    assert props["date_"].sourceName == "date"  # a reserved key gets a free one
    assert props["rating"].kind == "number"
    assert props["author"].kind == "entity"
    # Key mode: the key's values are the types; the key itself is not a property.
    p2 = plan(read, ImportMapping(typeSource="key", typeKey="status"), Target("newSpace"))
    assert {t.key for t in p2.plan.types} == {"key:reading", "page"}
    assert all(pp.sourceName != "status" for t in p2.plan.types for pp in t.properties)
    with pytest.raises(MappingProblem):
        plan(read, ImportMapping(types={"folder:Nope": {}}), Target("newSpace"))
    with pytest.raises(MappingProblem):
        plan(read, ImportMapping(properties={"folder:Books": {"nope": {}}}), Target("newSpace"))
    with pytest.raises(MappingProblem):
        plan(read, ImportMapping(types={"folder:Books": {"existingTypeId": "page"}}), Target("newSpace"))


# -- the API ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["import-notion", "import-obsidian", "import-anytype"])
@pytest.mark.parametrize("as_zip", [False, True])
def test_preview_writes_nothing(client, tmp_path, name, as_zip):
    folder = copy_fixture(name, tmp_path / "src" / name)
    source = zip_folder(folder, tmp_path / "src" / f"{name}.zip") if as_zip else folder
    assert client.app.state.search.ready.wait(30)  # the space's own start-up indexing is done
    before_src = snapshot(tmp_path / "src")
    before_space = snapshot(client.space_root)
    cache = cache_dir_for_root(client.space_root)  # the space's cache (here outside the space)
    before_cache = snapshot(cache) if cache.is_dir() else {}
    state = state_dir()
    before_state = snapshot(state) if state.is_dir() else {}
    r = _preview(client, source)
    assert r.status_code == 200, r.text
    preview = r.json()
    assert preview["container"] == ("zip" if as_zip else "folder")
    assert preview["counts"]["objects"] > 0
    r2 = _preview(client, source, mapping=preview["mapping"])
    assert r2.status_code == 200 and r2.json()["counts"] == preview["counts"]
    assert snapshot(tmp_path / "src") == before_src
    assert snapshot(client.space_root) == before_space
    assert (snapshot(cache) if cache.is_dir() else {}) == before_cache
    assert (snapshot(state) if state.is_dir() else {}) == before_state


def test_preview_errors(client, tmp_path):
    assert _preview(client, tmp_path / "missing").status_code == 404
    (tmp_path / "file.txt").write_text("x")
    assert _preview(client, tmp_path / "file.txt").status_code == 415
    folder = copy_fixture("import-obsidian", tmp_path / "v")
    r = _preview(client, folder, mapping={"types": {"folder:Nope": {"name": "x"}}})
    assert r.status_code == 422


def test_import_obsidian_into_a_new_space(client, tmp_path):
    folder = copy_fixture("import-obsidian", tmp_path / "src" / "vault")
    before = snapshot(folder)
    preview = _preview(client, folder).json()
    assert preview["kind"] == "obsidian" and preview["detected"] == "obsidian"
    job = _import(client, preview, {"kind": "newSpace", "name": "Imported", "location": str(tmp_path)})
    root = tmp_path / "Imported"
    assert job["targetPath"] == str(root)
    assert job["result"]["objects"] == 6
    assert snapshot(folder) == before  # the source is never written
    space = Space(root)
    # Links resolve to the right objects (a shared title "Dune": Books and Movies).
    home = (root / "Pages" / "Home.md").read_text()
    assert "[[Dune|the book]]" in home and "[[Emma|Emma's page]]" in home
    assert space.resolve("Dune", "Pages/Home.md") == "Books/Dune.md"
    assert space.resolve("Emma", "Pages/Home.md") == "Books/Emma.md"
    # Attachments copied, the embed rewritten.
    assert (root / "Attachments" / "cover.png").read_bytes() == (folder / "attachments" / "cover.png").read_bytes()
    assert "<!-- block: width=300 -->\n![](Attachments/cover.png)" in home
    assert "<!-- block: quote=standout -->\n> **Remember**" in home
    # Types, properties and tags.
    book = next(t for t in space.types if t.name == "Book")
    assert {p.key for p in book.propertyDefinitions} >= {"author", "rating", "status", "date_"}
    dune = space.read("Books/Dune.md")[1]
    assert dune["rating"] == 5 and dune["tags"] == ["scifi"] and dune["aliases"] == ["Arrakis"]
    assert "cssclasses" not in dune
    assert any(s.title == "scifi" and s.type == "tag" for s in space.list())
    # The report lists the skipped items.
    report = (root / "Pages" / "Import report.md").read_text()
    assert "Board.canvas" in report and "unused.txt" in report and "[[Nowhere]]" in report
    assert job["result"]["reportPath"] == "Pages/Import report.md"
    # Registered without being opened.
    from objectapp.spaces import Registry

    assert any(Path(e.path) == root.resolve() for e in Registry(state_dir()).list())


def test_import_notion_zip(client, tmp_path):
    folder = copy_fixture("import-notion", tmp_path / "n")
    z = zip_folder(folder, tmp_path / "Export-0123abcd-1111-2222-3333-444455556666.zip")
    preview = _preview(client, z).json()
    assert preview["suggestedName"] == "Notion import"
    books = next(t for t in preview["types"] if t["name"] == "Books")
    rating = next(p for p in books["properties"] if p["key"] == "rating")
    assert rating["guessedKind"] == "text"
    mapping = preview["mapping"]
    mapping["properties"][books["key"]]["rating"]["kind"] = "number"
    preview = _preview(client, z, mapping=mapping).json()
    books = next(t for t in preview["types"] if t["name"] == "Books")
    assert next(p for p in books["properties"] if p["key"] == "rating")["unconvertible"] == 1
    assert preview["counts"]["renamed"] == 1
    job = _import(client, preview, {"kind": "newSpace", "name": "From Notion", "location": str(tmp_path)})
    root = Path(job["targetPath"])
    space = Space(root)
    dune = space.read("Books/Dune.md")
    assert dune[1]["rating"] == 5 and dune[1]["read"] is True
    assert dune[1]["author"] == ["[[Frank Herbert]]"]
    assert dune[1]["createdAt"].startswith("2026-11-01")
    assert "Author: Frank Herbert" not in dune[0].body
    assert (root / "Books" / "Untitled (2).md").is_file()
    welcome = (root / "Pages" / "Welcome.md").read_text()
    assert "See [[Dune]] and our books." in welcome
    assert "![diagram](Attachments/diagram.png)" in welcome
    report = (root / "Pages" / "Import report.md").read_text()
    assert "not a number" in report and "Untitled" in report


def test_import_anytype_by_type_key(client, tmp_path):
    folder = copy_fixture("import-anytype", tmp_path / "a")
    preview = _preview(client, folder, kind="anytype").json()
    assert preview["kind"] == "anytype" and preview["detected"] is None
    assert preview["mapping"]["typeSource"] == "key" and preview["mapping"]["typeKey"] == "type"
    job = _import(client, preview, {"kind": "newSpace", "name": "Any", "location": str(tmp_path)})
    root = Path(job["targetPath"])
    assert (root / "Books" / "Dune.md").is_file()
    assert "type_" not in Space(root).read("Books/Dune.md")[1]
    # The reader is unverified against a real export: the preview and the report say so.
    assert any("hasn't been checked against a real Anytype export" in w for w in preview["warnings"])
    report = next(root.rglob("Import report.md")).read_text(encoding="utf-8")
    assert "## Warnings" in report and "real Anytype export" in report


def test_malicious_zip_writes_nothing_outside(client, tmp_path):
    import zipfile

    z = tmp_path / "evil.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("../escape.md", "# escape\n")
        zf.writestr("/abs/escape2.md", "# abs\n")
        zf.writestr("ok.md", "# ok\n\nfine\n")
    preview = _preview(client, z).json()
    assert {s["reason"] for s in preview["skipped"]} == {"unsafePath"}
    _import(client, preview, {"kind": "newSpace", "name": "Safe", "location": str(tmp_path)})
    assert not (tmp_path.parent / "escape.md").exists()
    assert not Path("/abs/escape2.md").exists()
    assert sorted(p.name for p in tmp_path.iterdir()) == ["Safe", "evil.zip", "space-sample"]


def test_changed_source_answers_409(client, tmp_path):
    folder = copy_fixture("import-anytype", tmp_path / "a")
    preview = _preview(client, folder).json()
    (folder / "New.md").write_text("# New\n")
    r = client.post(
        "/api/import/start",
        json={"previewId": preview["previewId"], "mapping": preview["mapping"],
              "target": {"kind": "newSpace", "name": "X", "location": str(tmp_path)}},
    )
    assert r.status_code == 409
    assert not (tmp_path / "X").exists()


def test_start_checks(client, tmp_path):
    folder = copy_fixture("import-anytype", tmp_path / "a")
    preview = _preview(client, folder).json()

    def start(target, preview_id=None):
        return client.post(
            "/api/import/start",
            json={"previewId": preview_id or preview["previewId"], "mapping": preview["mapping"], "target": target},
        )

    assert start({"kind": "newSpace", "name": "X", "location": str(tmp_path)}, "nope").status_code == 404
    assert start({"kind": "newSpace", "name": "  ", "location": str(tmp_path)}).status_code == 422
    assert start({"kind": "newSpace", "name": "X", "location": str(tmp_path / "none")}).status_code == 404
    (tmp_path / "Taken").mkdir()
    assert start({"kind": "newSpace", "name": "Taken", "location": str(tmp_path)}).status_code == 409
    assert start({"kind": "newSpace", "name": "Inside", "location": str(folder)}).status_code == 422
    # A source inside the open space can't be imported into it.
    inner = copy_fixture("import-anytype", client.space_root / "Pages" / "export")
    p2 = _preview(client, inner).json()
    r = client.post("/api/import/start", json={"previewId": p2["previewId"], "mapping": p2["mapping"],
                                               "target": {"kind": "currentSpace"}})
    assert r.status_code == 422
    shutil.rmtree(inner)


def test_import_into_this_space_never_overwrites(client, tmp_path):
    root = client.space_root
    folder = tmp_path / "src"
    folder.mkdir()
    existing = sorted(p for p in (root).rglob("*.md") if ".object" not in p.parts)
    victim = existing[0]
    (folder / f"{victim.stem}.md").write_text("---\nnote: imported\n---\nImported text.\n")
    (folder / "Fresh.md").write_text("Fresh text.\n")
    before = snapshot(root)
    preview = _preview(client, folder, target="currentSpace").json()
    job = _import(client, preview, {"kind": "currentSpace"})
    after = snapshot(root)
    changed = [k for k in before if after.get(k) != before[k]]
    # Only stored type files (new types, added properties) and the rebuildable cache may
    # change; no object is rewritten.
    assert all(k.startswith((".object/", ".object-cache/")) for k in changed), changed
    assert job["result"]["objects"] == 2
    assert client.get("/api/space").status_code == 200


def test_existing_type_empty_id_means_a_new_type(client, tmp_path):
    folder = tmp_path / "src"
    (folder / "Pages").mkdir(parents=True)
    (folder / "Pages" / "One.md").write_text("---\nscore: 3\n---\nOne.\n")
    p = _preview(client, folder, target="currentSpace").json()
    t = next(t for t in p["types"] if t["key"] == "folder:Pages")
    assert t["name"] == "Page" and t["existingTypeId"] == "page"  # matched by name
    mapping = p["mapping"]
    mapping["types"]["folder:Pages"]["existingTypeId"] = ""
    r = _preview(client, folder, target="currentSpace", mapping=mapping)
    assert r.status_code == 200, r.text
    t = next(t for t in r.json()["types"] if t["key"] == "folder:Pages")
    assert t["existingTypeId"] is None and t["name"] == "Page (2)"
    assert r.json()["mapping"]["types"]["folder:Pages"]["existingTypeId"] == ""  # round-trips
    # "" is accepted for a new space too (it means what omitting it means there).
    assert _preview(client, folder, mapping=mapping).status_code == 200
    job = _import(client, r.json(), {"kind": "currentSpace"}, mapping)
    assert job["result"]["types"] == 1
    assert any(t["name"] == "Page (2)" for t in client.get("/api/space").json()["types"])


def test_existing_type_gains_properties(client, tmp_path):
    space_types = client.get("/api/space").json()["types"]
    target = next(t for t in space_types if not t.get("basic") and not t.get("readOnlyReason"))
    folder = tmp_path / "src"
    (folder / "Things").mkdir(parents=True)
    (folder / "Things" / "A thing.md").write_text("---\nfreshKey: 7\n---\nA.\n")
    p = _preview(client, folder, target="currentSpace").json()
    mapping = p["mapping"]
    mapping["types"]["folder:Things"]["existingTypeId"] = target["id"]
    p = _preview(client, folder, target="currentSpace", mapping=mapping).json()
    before = {pd["key"]: pd for pd in target["propertyDefinitions"]}
    _import(client, p, {"kind": "currentSpace"}, mapping)
    after = next(t for t in client.get("/api/space").json()["types"] if t["id"] == target["id"])
    keys = {pd["key"]: pd for pd in after["propertyDefinitions"]}
    assert "freshKey" in keys
    for k, pd in before.items():
        assert keys[k]["type"] == pd["type"]


def test_one_import_at_a_time_and_cancel(client, tmp_path, monkeypatch):
    from objectapp.importers import writer

    gate = threading.Event()
    started = threading.Event()
    real = writer._objects

    def slow(*args, **kwargs):
        started.set()
        gate.wait(10)
        return real(*args, **kwargs)

    monkeypatch.setattr(writer, "_objects", slow)
    folder = copy_fixture("import-anytype", tmp_path / "a")
    preview = _preview(client, folder).json()
    r = client.post("/api/import/start", json={"previewId": preview["previewId"], "mapping": preview["mapping"],
                                               "target": {"kind": "newSpace", "name": "One", "location": str(tmp_path)}})
    assert r.status_code == 202
    job_id = r.json()["jobId"]
    assert started.wait(10)
    # The started preview's read was let go: its id answers 404; a fresh preview answers 409.
    r2 = client.post("/api/import/start", json={"previewId": preview["previewId"], "mapping": preview["mapping"],
                                                "target": {"kind": "newSpace", "name": "Two", "location": str(tmp_path)}})
    assert r2.status_code == 404
    again = _preview(client, folder).json()
    r2 = client.post("/api/import/start", json={"previewId": again["previewId"], "mapping": again["mapping"],
                                                "target": {"kind": "newSpace", "name": "Two", "location": str(tmp_path)}})
    assert r2.status_code == 409
    assert client.post(f"/api/import/jobs/{job_id}/cancel").json() == {"ok": True}
    gate.set()
    job = wait_job(client, job_id)
    assert job["phase"] == "cancelled" and job["result"]["cancelled"] is True
    assert job["result"]["objects"] == 0
    report = (tmp_path / "One" / "Pages" / "Import report.md").read_text()
    assert "stopped early" in report
    assert client.get("/api/import/jobs/nope").status_code == 404
    assert client.post("/api/import/jobs/nope/cancel").status_code == 404
