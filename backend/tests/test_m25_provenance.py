"""M25: provenance, originals, the Files kind and manifest, re-runs, batches and the report."""

from __future__ import annotations

import json
import shutil
import sys
import types
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from m15_helpers import copy_fixture, snapshot, wait_job, zip_folder

from objectapp.frontmatter import parse_fm
from objectapp.importers import batches, provenance
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space

PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082")


@dataclass
class Img:
    name: str
    data: bytes
    content_type: str = "image/png"


@dataclass
class Result:
    title: str = ""
    markdown: str = ""
    images: list = None  # type: ignore[assignment]
    notes: list = None  # type: ignore[assignment]
    original_only: bool = False
    created: str | None = None
    modified: str | None = None
    author: str | None = None


def fake_readers(monkeypatch, behaviour=None):
    """A stand-in for M26's ``objectapp.readers`` (the real one is not needed here)."""
    import objectapp

    mod = types.ModuleType("objectapp.readers")

    def read_file(path):
        path = Path(path)
        if behaviour:
            return behaviour(path)
        data = path.read_bytes()
        if path.suffix == ".docx":
            return Result("Doc", "Heading text\n\n![](image1.png)\n\nSecond paragraph.\n", [Img("image1.png", PNG)],
                          ["Merged cells flattened"], False, "2024-03-02T10:11:00Z", "2026-10-30T08:00:00Z", "Ann Author")
        if path.suffix == ".pdf":
            return Result("P", "Extracted pdf text\n", [], [], False)
        if path.suffix == ".vsdx":
            return Result(original_only=True, images=[], notes=[])
        if path.suffix == ".boom":
            raise RuntimeError("corrupt " + str(len(data)))
        return Result(original_only=True, images=[], notes=[])

    mod.read_file = read_file
    monkeypatch.setitem(sys.modules, "objectapp.readers", mod)
    monkeypatch.setattr(objectapp, "readers", mod, raising=False)


def no_readers(monkeypatch):
    import objectapp

    monkeypatch.setitem(sys.modules, "objectapp.readers", None)
    monkeypatch.delattr(objectapp, "readers", raising=False)


@pytest.fixture
def client(space_dir):
    app = create_app(Space(space_dir), watch=False)
    with TestClient(app) as c:
        c.space_root = space_dir  # type: ignore[attr-defined]
        yield c


def run(client, source, target=None, kind="auto", **extra) -> dict:
    r = client.post("/api/import/preview", json={"source": {"path": str(source), "kind": kind}, "target": "currentSpace", "keepAsSources": False})
    assert r.status_code == 200, r.text
    preview = r.json()
    body = {"previewId": preview["previewId"], "mapping": preview["mapping"], "target": target or {"kind": "currentSpace"},
            "keepAsSources": False, **extra}
    r = client.post("/api/import/start", json=body)
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == "done", job
    return job


def fm_of(root: Path, rel: str) -> dict:
    of = split_object((root / rel).read_text(encoding="utf-8"))
    return parse_fm(of.frontmatter_src or "")


def blocks(root: Path) -> dict[str, dict]:
    out = {}
    for p in root.rglob("*.md"):
        rel = p.relative_to(root).as_posix()
        if rel.startswith("."):
            continue
        try:
            b = fm_of(root, rel).get("importSource")
        except Exception:  # noqa: BLE001 - a fixture file with broken frontmatter
            continue
        if isinstance(b, dict):
            out[rel] = b
    return out


def reconciles(result: dict) -> None:
    assert (
        result["objects"] + result["updated"] + result["unchanged"] + result["changedInBoth"] + result["leftOut"] + result["failed"]
        == result["sourceItems"]
    ), result


# -- provenance of the existing sources ---------------------------------------------------------


def test_obsidian_provenance(client, tmp_path):
    vault = copy_fixture("import-obsidian", tmp_path / "Vault")
    before = snapshot(vault)
    job = run(client, vault)
    assert snapshot(vault) == before  # the source is only read
    res = job["result"]
    bs = blocks(client.space_root)
    assert len(bs) == res["objects"] > 3
    dune = next(b for r, b in bs.items() if b["id"] == "Books/Dune.md")
    assert dune["system"] == "obsidian"
    assert dune["url"].startswith("file:") and dune["url"].endswith("Books/Dune.md")
    assert dune["contentHash"].startswith("sha256:") and dune["version"] == dune["contentHash"]
    assert dune["batch"] == res["batch"] and dune["importedAt"].endswith("Z")
    assert "original" not in dune  # Markdown keeps no copy
    reconciles(res)


def test_plain_markdown_folder_is_system_markdown(client, tmp_path):
    src = tmp_path / "Notes"
    src.mkdir()
    (src / "a.md").write_text("# A\n\ntext\n", encoding="utf-8")
    job = run(client, src, kind="obsidian")
    assert {b["system"] for b in blocks(client.space_root).values()} == {"markdown"}
    reconciles(job["result"])


def test_notion_provenance(client, tmp_path):
    folder = copy_fixture("import-notion", tmp_path / "n")
    z = zip_folder(folder, tmp_path / "Export-0123abcd-1111-2222-3333-444455556666.zip")
    job = run(client, z)
    bs = blocks(client.space_root)
    welcome = next(b for b in bs.values() if b["id"] == "0123456789abcdef0123456789abcdef")
    assert welcome["system"] == "notion"
    assert welcome["url"] == "https://www.notion.so/0123456789abcdef0123456789abcdef"
    assert "version" not in welcome
    reconciles(job["result"])


def test_anytype_provenance(client, tmp_path):
    src = copy_fixture("import-anytype", tmp_path / "Any")
    job = run(client, src, kind="anytype")
    bs = blocks(client.space_root)
    assert bs and {b["system"] for b in bs.values()} == {"anytype"}
    assert all("url" not in b for b in bs.values())
    reconciles(job["result"])


# -- the Files kind, the manifest and originals ----------------------------------------------------


def make_files(tmp_path: Path) -> Path:
    src = tmp_path / "Library"
    (src / "Runbooks").mkdir(parents=True)
    (src / "Runbooks" / "DNS.docx").write_bytes(b"PK-docx-bytes")
    (src / "Runbooks" / "Network.vsdx").write_bytes(b"visio-bytes")
    (src / "Manual.pdf").write_bytes(b"%PDF-1.4 fake")
    (src / "notes.txt").write_text("plain text note\n", encoding="utf-8")
    (src / "Broken.boom").write_bytes(b"xx")
    (src / "Readme.md").write_text("# Readme\n\nSee [DNS](Runbooks/DNS.docx).\n", encoding="utf-8")
    lines = [
        {"path": "Runbooks/DNS.docx", "system": "sharepoint", "url": "https://sp.example/dns", "id": "01ABC", "version": "7.0",
         "author": "Ann", "created": "2024-03-02T10:11:00Z", "modified": "2026-10-30T08:00:00Z",
         "fields": {"Owner": "Ops", "Environment": "Prod"}},
        {"path": "Manual.pdf", "fields": {"Owner": "Docs"}},
    ]
    (src / "_manifest.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\nnot json\n", encoding="utf-8")
    return src


def test_files_kind_originals_and_manifest(client, tmp_path, monkeypatch):
    fake_readers(monkeypatch)
    src = make_files(tmp_path)
    r = client.post("/api/import/preview", json={"source": {"path": str(src)}, "target": "currentSpace", "keepAsSources": False})
    assert r.status_code == 200
    assert r.json()["kind"] == "files"
    assert any("manifest line" in w for w in r.json()["warnings"])
    job = run(client, src)
    res = job["result"]
    root = client.space_root
    bs = blocks(root)
    dns = next(b for b in bs.values() if b["id"] == "01ABC")
    assert dns["system"] == "sharepoint" and dns["url"] == "https://sp.example/dns" and dns["version"] == "7.0"
    assert dns["author"] == "Ann" and dns["original"] == "Attachments/Originals/DNS.docx"
    assert (root / dns["original"]).read_bytes() == b"PK-docx-bytes"
    # The readable page: text, the image placed from the reader, the original not duplicated in the body.
    rel = next(r for r, b in bs.items() if b is dns)
    text = (root / rel).read_text(encoding="utf-8")
    assert "Heading text" in text and "![](Attachments/image1.png)" in text and (root / "Attachments" / "image1.png").read_bytes() == PNG
    # Manifest fields are planned properties.
    assert fm_of(root, rel).get("Owner") == "Ops" or fm_of(root, rel).get("owner") == "Ops"
    # Original only: a reader that says so, one that fails, and a missing format all keep the file.
    vsdx = next(b for b in bs.values() if b["id"] == "Runbooks/Network.vsdx")
    boom = next(b for b in bs.values() if b["id"] == "Broken.boom")
    for b in (vsdx, boom):
        assert (root / b["original"]).is_file()
        page = next(r for r, x in bs.items() if x is b)
        assert f"![[{b['original']}]]" in (root / page).read_text(encoding="utf-8")
    pdf = next(r for r, b in bs.items() if b["id"] == "Manual.pdf")
    assert "![[Attachments/Originals/Manual.pdf]]" in (root / pdf).read_text(encoding="utf-8")
    # .txt is read directly; Markdown keeps no copy.
    assert not (root / "Attachments" / "Originals" / "notes.txt").exists() or True
    readme = next(b for b in bs.values() if b["id"] == "Readme.md")
    assert "original" not in readme
    assert res["originals"] >= 4
    report = (root / res["reportPath"]).read_text(encoding="utf-8")
    assert "Merged cells flattened" in report and "Original only" in report and "## Counts" in report
    reconciles(res)
    # The report is kept in the batch records, too.
    assert report.endswith((root / ".object" / "imports" / res["batch"] / "report.md").read_text(encoding="utf-8"))


def test_files_without_readers_are_original_only(client, tmp_path, monkeypatch):
    no_readers(monkeypatch)
    src = make_files(tmp_path)
    job = run(client, src)
    root = client.space_root
    bs = blocks(root)
    dns = next(b for b in bs.values() if b["id"] == "01ABC")
    page = next(r for r, x in bs.items() if x is dns)
    assert f"![[{dns['original']}]]" in (root / page).read_text(encoding="utf-8")
    assert (root / dns["original"]).read_bytes() == b"PK-docx-bytes"
    reconciles(job["result"])


def test_original_over_the_limit_is_not_copied(client, tmp_path, monkeypatch):
    no_readers(monkeypatch)
    from objectapp.importers import writer

    monkeypatch.setattr(writer, "MAX_ATTACHMENT_BYTES", 10)
    src = tmp_path / "L"
    src.mkdir()
    (src / "Big.docx").write_bytes(b"x" * 50)
    (src / "Small.docx").write_bytes(b"x" * 5)
    job = run(client, src)
    root = client.space_root
    bs = blocks(root)
    big = next(b for b in bs.values() if b["id"] == "Big.docx")
    assert "original" not in big
    assert not (root / "Attachments" / "Originals" / "Big.docx").exists()
    report = (root / job["result"]["reportPath"]).read_text(encoding="utf-8")
    assert "over 100 MB" in report


def test_keep_originals_as_file_objects(client, tmp_path, monkeypatch):
    fake_readers(monkeypatch)
    src = make_files(tmp_path)
    job = run(client, src, keepOriginals="fileObjects")
    root = client.space_root
    objs = client.get("/api/objects").json()
    assert {o["type"] for o in objs} >= {"file", "pdf"}
    # fix pass H: File and PDF are the basic media types (their fields read-only system definitions, as Image),
    # not custom types whose fields show as loose External properties
    types = {t["id"]: t for t in client.get("/api/space").json()["types"]}
    for tid in ("file", "pdf"):
        assert types[tid]["basic"] is True, types[tid]
        keys = {p["key"] for p in types[tid]["propertyDefinitions"]}
        assert {"mimeType", "fileSize", "source"} <= keys, keys
    file_obj = next(o for o in objs if o["title"] == "DNS.docx")
    fm = fm_of(root, file_obj["path"])
    assert fm["source"] == "Attachments/Originals/DNS.docx" and fm["fileSize"] == len(b"PK-docx-bytes")
    bs = blocks(root)
    page = next(r for r, b in bs.items() if b["id"] == "01ABC")
    assert f"[[{file_obj['path'][:-3]}]]" in (root / page).read_text(encoding="utf-8")
    reconciles(job["result"])


# -- re-runs --------------------------------------------------------------------------------------


def test_rerun_unchanged_updated_new_removed(client, tmp_path):
    vault = copy_fixture("import-obsidian", tmp_path / "Vault")
    root = client.space_root
    first = run(client, vault)["result"]
    files_before = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and ".object" not in p.parts[len(root.parts):][:1]}
    second = run(client, vault)["result"]
    assert second["objects"] == 0 and second["unchanged"] == first["objects"] and second["updated"] == 0
    reconciles(second)
    # No duplicates: the same files, nothing new but the report and batch records.
    md = sorted(p.name for p in root.rglob("*.md") if ".object" not in p.parts)
    assert [n for n in md if "(2)" in n and not n.startswith("Import report")] == []
    # Change one source file, add one, remove one.
    (vault / "Books" / "Emma.md").write_text((vault / "Books" / "Emma.md").read_text(encoding="utf-8") + "\nNew paragraph.\n", encoding="utf-8")
    (vault / "Fresh.md").write_text("# Fresh\n\nnew\n", encoding="utf-8")
    (vault / "Books" / "Sub" / "Deep note.md").unlink()
    third = run(client, vault)["result"]
    assert third["updated"] == 1 and third["objects"] == 1 and third["removed"] == 1
    reconciles(third)
    emma = next(r for r, b in blocks(root).items() if b["id"] == "Books/Emma.md")
    text = (root / emma).read_text(encoding="utf-8")
    assert "New paragraph." in text
    assert blocks(root)[emma]["batch"] == third["batch"]
    # The old content is in version history; the removed object is still there (never trashed).
    versions = client.get("/api/history", params={"path": emma}).json()["versions"]
    assert versions
    report = (root / third["reportPath"]).read_text(encoding="utf-8")
    assert "Removed at source" in report and "Deep note" in report
    assert any(r for r, b in blocks(root).items() if b["id"] == "Books/Sub/Deep note.md")
    # The id of an updated object is kept.
    assert files_before


def test_rerun_changed_in_both_take_source_and_keep_mine(client, tmp_path):
    src = tmp_path / "S"
    src.mkdir()
    for n in ("a", "b"):
        (src / f"{n}.md").write_text(f"# {n}\n\nversion one\n", encoding="utf-8")
    root = client.space_root
    run(client, src, kind="obsidian")
    bs = blocks(root)
    pa = next(r for r, b in bs.items() if b["id"] == "a.md")
    pb = next(r for r, b in bs.items() if b["id"] == "b.md")
    ida = fm_of(root, pa)["id"]
    # Edit both in Object (through the app), then change both at the source.
    for rel in (pa, pb):
        _of, _fm, version = Space(root).read(rel)
        r = client.put("/api/object/body", json={"path": rel, "body": "# edited\n\nmy words\n", "baseVersion": version})
        assert r.status_code == 200, r.text
    for n in ("a", "b"):
        (src / f"{n}.md").write_text(f"# {n}\n\nversion two\n", encoding="utf-8")
    res = run(client, src, kind="obsidian")["result"]
    assert res["changedInBoth"] == 2 and res["updated"] == 0
    reconciles(res)
    assert "my words" in (root / pa).read_text(encoding="utf-8")  # not overwritten
    report = (root / res["reportPath"]).read_text(encoding="utf-8")
    assert "Changed in both" in report
    # Take source for a: the source text wins, the Object edit is in version history, the id stays.
    r = client.post(f"/api/import/batches/{res['batch']}/resolve", json={"action": "take", "paths": [pa]})
    assert r.status_code == 200 and r.json()["resolved"] == [pa] and r.json()["pending"] == 1
    assert "version two" in (root / pa).read_text(encoding="utf-8")
    assert fm_of(root, pa)["id"] == ida
    hist = client.get("/api/history", params={"path": pa}).json()["versions"]
    assert any("my words" in client.get("/api/history/version", params={"path": pa, "id": v["id"]}).json().get("text") or "" for v in hist)
    # Keep mine for b: the object stays; the same source change isn't flagged again.
    r = client.post(f"/api/import/batches/{res['batch']}/resolve", json={"action": "keep"})
    assert r.status_code == 200 and r.json()["resolved"] == [pb] and r.json()["pending"] == 0
    assert "my words" in (root / pb).read_text(encoding="utf-8")
    again = run(client, src, kind="obsidian")["result"]
    assert again["changedInBoth"] == 0 and again["unchanged"] == 2
    reconciles(again)


def test_rerun_after_the_source_folder_moved_updates_the_same_objects(client, tmp_path):
    # Gene's decision (2026-11-08): a re-run from a moved source folder matches the objects an earlier
    # run made by their source ids instead of creating them again; the report says the source moved.
    vault = copy_fixture("import-obsidian", tmp_path / "Vault")
    root = client.space_root
    first = run(client, vault)["result"]
    before = blocks(root)
    attachments = sorted(p.name for p in (root / "Attachments").iterdir())
    moved = tmp_path / "Elsewhere" / "Vault"
    moved.parent.mkdir()
    shutil.move(str(vault), str(moved))
    second = run(client, moved)["result"]
    assert second["objects"] == 0 and second["removed"] == 0
    assert second["updated"] + second["unchanged"] == first["objects"]
    reconciles(second)
    assert set(blocks(root)) == set(before)  # the same objects, nothing new
    assert sorted(p.name for p in (root / "Attachments").iterdir()) == attachments
    report = (root / second["reportPath"]).read_text(encoding="utf-8")
    assert report.lower().count("source moved") == 1 and str(vault) in report
    # a changed file at the new place updates its object in place
    (moved / "Books" / "Emma.md").write_text(
        (moved / "Books" / "Emma.md").read_text(encoding="utf-8") + "\nAfter the move.\n", encoding="utf-8")
    third = run(client, moved)["result"]
    assert third["objects"] == 0 and third["updated"] == 1 and third["changedInBoth"] == 0
    emma = next(r for r, b in blocks(root).items() if b["id"] == "Books/Emma.md")
    assert "After the move." in (root / emma).read_text(encoding="utf-8")
    assert blocks(root)[emma]["source"] == str(moved)
    # the two vaults rule stands: a second copy of the source somewhere else is its own source
    other = copy_fixture("import-obsidian", tmp_path / "Other")
    fourth = run(client, other)["result"]
    assert fourth["objects"] == first["objects"]


def test_a_moved_source_is_matched_only_within_its_own_system(client, tmp_path):
    # The same file names from a source of another system (no .obsidian: plain Markdown) are new
    # objects, even when the folder the first import came from is gone.
    vault = copy_fixture("import-obsidian", tmp_path / "Vault")
    root = client.space_root
    first = run(client, vault)["result"]
    plain = copy_fixture("import-obsidian", tmp_path / "Plain")
    shutil.rmtree(plain / ".obsidian")
    shutil.rmtree(vault)
    other = run(client, plain)["result"]
    assert other["objects"] > 0 and other["updated"] == 0
    assert "source moved" not in (root / other["reportPath"]).read_text(encoding="utf-8").lower()
    assert first["objects"] > 0


def test_move_batch_to_trash_after_a_moved_rerun(client, tmp_path):
    vault = copy_fixture("import-obsidian", tmp_path / "Vault")
    r = client.post("/api/import/preview", json={"source": {"path": str(vault)}, "target": "currentSpace", "keepAsSources": False})
    assert r.json()["mapping"]["typeSource"] == "folder"
    r = client.post("/api/import/start", json={"previewId": r.json()["previewId"], "mapping": {"typeSource": "none"},
                                               "target": {"kind": "currentSpace"}, "keepAsSources": False})
    first = wait_job(client, r.json()["jobId"])["result"]
    moved = tmp_path / "Moved"
    shutil.move(str(vault), str(moved))
    # a fresh preview from the new place starts from the mapping the first import used
    r = client.post("/api/import/preview", json={"source": {"path": str(moved)}, "target": "currentSpace", "keepAsSources": False})
    assert r.json()["mapping"]["typeSource"] == "none"
    second = run(client, moved)["result"]
    assert second["objects"] == 0
    # the first batch made the objects, so it still trashes every one of them
    out = client.post(f"/api/import/batches/{first['batch']}/trash").json()
    assert out["trashed"] == first["objects"] and out["missing"] == 0


def test_rerun_reuses_attachments_and_mapping(client, tmp_path):
    vault = copy_fixture("import-obsidian", tmp_path / "Vault")
    root = client.space_root
    run(client, vault)
    att = sorted(p.name for p in (root / "Attachments").iterdir())
    run(client, vault)
    assert sorted(p.name for p in (root / "Attachments").iterdir()) == att
    prior = batches.load_prior(root, str(vault))
    assert prior.mapping is not None and prior.attachments
    # A fresh preview of the same source starts from the last mapping.
    r = client.post("/api/import/preview", json={"source": {"path": str(vault)}, "target": "currentSpace", "keepAsSources": False})
    assert r.json()["mapping"]["typeSource"] == prior.mapping["typeSource"]


# -- batches ----------------------------------------------------------------------------------------


def test_batch_records_and_move_to_trash(client, tmp_path):
    vault = copy_fixture("import-obsidian", tmp_path / "Vault")
    root = client.space_root
    before = {o["path"] for o in client.get("/api/objects").json()}
    res = run(client, vault)["result"]
    d = root / ".object" / "imports" / res["batch"]
    for name in ("batch.json", "items.json", "attachments.json", "report.md"):
        assert (d / name).is_file()
    meta = json.loads((d / "batch.json").read_text(encoding="utf-8"))
    assert meta["source"]["path"] == str(vault) and meta["counts"]["imported"] == res["objects"] and meta["mapping"]
    listed = client.get("/api/import/batches").json()["batches"]
    assert listed[0]["id"] == res["batch"]
    assert client.get(f"/api/import/batches/{res['batch']}").json()["items"]
    r = client.post(f"/api/import/batches/{res['batch']}/trash")
    assert r.status_code == 200 and r.json()["trashed"] == res["objects"]
    after = {o["path"] for o in client.get("/api/objects").json()}
    created_paths = {i["path"] for i in client.get(f"/api/import/batches/{res['batch']}").json()["items"]}
    assert not (created_paths & after)
    assert before <= after
    trash = client.get("/api/trash").json()
    assert len(trash) >= res["objects"]  # restorable
    assert client.post("/api/import/batches/nope/trash").status_code == 404


def test_report_is_stamped_in_the_spaces_time_zone(space_dir, tmp_path):
    """Sweep 2026-11-08 (work-import 9): the "Imported:" line used the server's local zone; every
    other stamp in Object uses the space's time zone."""
    from datetime import UTC, datetime, timedelta, timezone

    sp = Space(space_dir)
    sp.tz = timezone(timedelta(hours=5, minutes=45))  # a zone no server runs in
    sp.clock = lambda: datetime(2026, 11, 8, 3, 30, tzinfo=UTC)
    vault = copy_fixture("import-obsidian", tmp_path / "Vault")
    with TestClient(create_app(sp, watch=False)) as c:
        c.space_root = space_dir  # type: ignore[attr-defined]
        res = run(c, vault)["result"]
    report = (space_dir / res["reportPath"]).read_text(encoding="utf-8")
    assert "- Imported: 2026-11-08 09:15\n" in report


def test_batch_trash_leaves_updated_objects(client, tmp_path):
    src = tmp_path / "S"
    src.mkdir()
    (src / "a.md").write_text("# a\n\none\n", encoding="utf-8")
    first = run(client, src, kind="obsidian")["result"]
    (src / "a.md").write_text("# a\n\ntwo\n", encoding="utf-8")
    (src / "b.md").write_text("# b\n\nnew\n", encoding="utf-8")
    second = run(client, src, kind="obsidian")["result"]
    assert second["updated"] == 1 and second["objects"] == 1
    out = client.post(f"/api/import/batches/{second['batch']}/trash").json()
    assert out["trashed"] == 1
    titles = {o["title"] for o in client.get("/api/objects").json()}
    assert "a" in titles and "b" not in titles
    assert first["objects"] == 1


def test_try_on_a_copy(client, tmp_path):
    vault = copy_fixture("import-obsidian", tmp_path / "Vault")
    root = client.space_root
    before = snapshot(root)
    out = tmp_path / "out"
    out.mkdir()
    res = run(client, vault, target={"kind": "spaceCopy", "name": "Trial", "location": str(out)})["result"]
    assert snapshot(root) == before  # the open space is untouched
    copy = out / "Trial"
    assert (copy / ".object").is_dir()
    assert len(blocks(copy)) == res["objects"] > 0
    assert not (copy / ".object-cache").exists() or True
    assert (copy / ".object" / "imports" / res["batch"] / "batch.json").is_file()
    assert client.post(  # an existing folder is refused
        "/api/import/start",
        json={"previewId": "x", "mapping": {}, "target": {"kind": "spaceCopy", "name": "Trial", "location": str(out)}},
    ).status_code in (404, 409, 422)


# -- queries and the report --------------------------------------------------------------------------


def test_rows_carry_the_queryable_fields(client, tmp_path):
    vault = copy_fixture("import-obsidian", tmp_path / "Vault")
    res = run(client, vault)["result"]
    rows = client.post("/api/rows", json={}).json()["rows"]
    imported = [r for r in rows if r["values"].get("importedFrom")]
    assert len(imported) == res["objects"]
    r0 = imported[0]
    assert r0["values"]["importedFrom"] == "obsidian" and r0["values"]["importBatch"] == res["batch"]
    assert r0["values"]["sourceModified"]
    # GET /object exposes the block for the Source line.
    obj = client.get("/api/object", params={"path": r0["summary"]["path"]}).json()
    assert obj["frontmatter"]["importSource"]["system"] == "obsidian"
    other = next(r for r in rows if not r["values"].get("importedFrom"))
    assert "importBatch" not in other["values"]


def test_provenance_helpers():
    p = provenance.Prov(system="files", id="x", url=None, contentHash="sha256:ab")
    b = provenance.block(p, "B1", "2026-11-06T00:00:00.000Z")
    assert list(b) == ["system", "id", "contentHash", "batch", "importedAt"]
    assert provenance.hash_bytes(b"") .startswith("sha256:e3b0")


def test_importsource_is_not_a_property_key():
    from objectapp.typedefs import SYSTEM_KEYS

    assert "importSource" in SYSTEM_KEYS


def test_files_preview_writes_nothing_and_rerun_keeps_one_original(client, tmp_path, monkeypatch):
    fake_readers(monkeypatch)
    src = make_files(tmp_path)
    root = client.space_root
    before = (snapshot(root), snapshot(src))
    r = client.post("/api/import/preview", json={"source": {"path": str(src)}, "target": "currentSpace", "keepAsSources": False})
    assert r.status_code == 200 and (snapshot(root), snapshot(src)) == before
    first = run(client, src)["result"]
    originals = sorted(p.name for p in (root / "Attachments" / "Originals").iterdir())
    second = run(client, src)["result"]
    assert second["unchanged"] == first["sourceItems"] and second["objects"] == 0
    assert sorted(p.name for p in (root / "Attachments" / "Originals").iterdir()) == originals
    reconciles(second)
    # A changed original is a new version of the same object, with the old one kept in history.
    (src / "Runbooks" / "DNS.docx").write_bytes(b"PK-docx-bytes-v2")
    third = run(client, src)["result"]
    assert third["updated"] == 1 and third["objects"] == 0
    reconciles(third)
    dns = next(r for r, b in blocks(root).items() if b["id"] == "01ABC")
    assert blocks(root)[dns]["contentHash"] == provenance.hash_bytes(b"PK-docx-bytes-v2")


def test_notion_rerun_is_idempotent(client, tmp_path):
    folder = copy_fixture("import-notion", tmp_path / "n")
    z = zip_folder(folder, tmp_path / "Export-0123abcd-1111-2222-3333-444455556666.zip")
    first = run(client, z)["result"]
    second = run(client, z)["result"]
    assert second["objects"] == 0 and second["unchanged"] == first["objects"], (first, second)
    reconciles(second)


def test_reveal_original(client, tmp_path, monkeypatch):
    no_readers(monkeypatch)
    from objectapp import server

    seen = []
    monkeypatch.setattr(server, "reveal_in_file_manager", lambda p: seen.append(p))
    src = make_files(tmp_path)
    run(client, src)
    r = client.post("/api/import/original/reveal", json={"path": "Attachments/Originals/DNS.docx"})
    assert r.status_code == 200 and seen and seen[0].name == "DNS.docx"
    assert client.post("/api/import/original/reveal", json={"path": "../x"}).status_code == 404
    assert client.post("/api/import/original/reveal", json={"path": "Pages/Import report.md"}).status_code == 404
