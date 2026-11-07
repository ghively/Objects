"""M27 fix pass: re-run matching, scan choices over MCP, filing safety, batch trash, re-run side effects."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from m15_helpers import wait_job
from test_m25_provenance import blocks, fake_readers, run

from objectapp.server import create_app
from objectapp.space import Space


@pytest.fixture
def client(space_dir):
    app = create_app(Space(space_dir), watch=False)
    with TestClient(app) as c:
        c.space_root = c.root = space_dir  # type: ignore[attr-defined]
        yield c


def vault(tmp_path: Path, name: str, text: str) -> Path:
    v = tmp_path / name
    (v / "Notes").mkdir(parents=True)
    (v / "Notes" / "Meeting.md").write_text(f"# Meeting\n\n{text}\n", encoding="utf-8")
    return v


# -- 1. re-run matching knows which source an object came from ------------------------------------


def test_same_relative_path_in_another_source_is_a_new_object(client, tmp_path):
    a, b = vault(tmp_path, "VaultA", "from A"), vault(tmp_path, "VaultB", "from B")
    root = client.space_root
    first = run(client, a)["result"]
    second = run(client, b)["result"]
    assert first["objects"] == 1 and second["objects"] == 1 and second["updated"] == 0 and second["changedInBoth"] == 0
    texts = sorted((root / r).read_text(encoding="utf-8") for r in blocks(root))
    assert any("from A" in t for t in texts) and any("from B" in t for t in texts)
    # Each source still re-runs onto its own object.
    again = run(client, a)["result"]
    assert again["unchanged"] == 1 and again["objects"] == 0


def test_two_manifest_rows_with_one_id_are_not_collapsed(client, tmp_path, monkeypatch):
    fake_readers(monkeypatch)
    src = tmp_path / "Lib"
    src.mkdir()
    (src / "One.txt").write_text("first file\n", encoding="utf-8")
    (src / "Two.txt").write_text("second file\n", encoding="utf-8")
    rows = [{"path": "One.txt", "system": "sharepoint", "id": "SAME", "url": "https://sp.example/1"},
            {"path": "Two.txt", "system": "sharepoint", "id": "SAME", "url": "https://sp.example/2"}]
    (src / "_manifest.jsonl").write_text("\n".join(json.dumps(x) for x in rows) + "\n", encoding="utf-8")
    root = client.space_root
    first = run(client, src)["result"]
    assert first["objects"] == 2
    report = (root / first["reportPath"]).read_text(encoding="utf-8")
    assert "same id" in report.lower() and "Two.txt" in report
    ids = [b["id"] for b in blocks(root).values()]
    assert len(set(ids)) == 2
    second = run(client, src)["result"]
    assert second["unchanged"] == 2 and second["objects"] == 0 and second["updated"] == 0


# -- 2 and 3. scan choices over the MCP routes -----------------------------------------------------

from test_m27_agent import _fm, make_source  # noqa: E402


def v1(client):
    res = client.post("/api/integrations/tokens", json={"name": "agent", "scope": "read-write"})
    headers = {"Authorization": f"Bearer {res.json()['secret']}"}

    def preview(path, **extra):
        r = client.post("/api/v1/import/preview", headers=headers, json={"path": str(path), "kind": "obsidian", **extra})
        assert r.status_code == 200, r.text
        return r.json()

    def start(pv, tmp_path, name="Copy", **extra):
        target = {"kind": "newSpace", "name": name, "location": str(tmp_path)}
        r = client.post("/api/v1/import/start", headers=headers, json={"previewId": pv["previewId"], "target": target, **extra})
        assert r.status_code == 202, r.text
        job = wait_job(client, r.json()["jobId"])
        assert job["phase"] == "done", job
        return job["result"], tmp_path / name

    return preview, start


def test_mcp_scan_choices_without_exclude_list_still_exclude_flagged(client, tmp_path):
    preview, start = v1(client)
    src = make_source(tmp_path / "s")
    out = tmp_path / "out"
    out.mkdir()
    result, space = start(preview(src), out, scan={"leaveOut": ["Credentials"]})
    secret = next(space.rglob("Secrets.md"))
    assert _fm(space, secret.relative_to(space).as_posix())["excludeFromAI"] is True
    assert not list(space.rglob("keys.md"))


def test_mcp_leave_out_is_applied_at_preview_and_start(client, tmp_path):
    preview, start = v1(client)
    src = make_source(tmp_path / "s")
    out = tmp_path / "out"
    out.mkdir()
    pv = preview(src, leaveOut=["Credentials"])
    assert "Credentials" not in [f for f, _n in pv["folders"]]
    # patterns first given at start are applied to what the preview already read
    result, space = start(preview(src, leaveOut=["Credentials"]), out, scan={"leaveOut": ["Runbooks/Runbook 1*"]})
    names = {p.name for p in space.rglob("*.md")}
    assert "keys.md" not in names
    assert "Runbook 1.md" not in names and "Runbook 10.md" not in names and "Runbook 2.md" in names
    assert result["leftOut"] >= 3


def test_left_out_patterns_of_the_draft_batch_apply_at_start(client, tmp_path):
    preview, start = v1(client)
    src = make_source(tmp_path / "s")
    out = tmp_path / "out"
    out.mkdir()
    res = client.post("/api/import/batches", json={"path": str(src), "leaveOut": ["Credentials"]}).json()
    result, space = start(preview(src), out, batch=res["batch"])
    assert not list(space.rglob("keys.md"))


def test_rerun_keeps_exclude_from_ai(client, tmp_path):
    from test_m27_agent import do_import

    src = make_source(tmp_path)
    root = client.space_root
    do_import(client, src)
    rel = next(p for p in root.rglob("Secrets.md")).relative_to(root).as_posix()
    assert _fm(root, rel)["excludeFromAI"] is True
    (src / "Runbooks" / "Secrets.md").write_text("# Secrets\n\nrotated and removed\n", encoding="utf-8")
    second = do_import(client, src)
    assert second["updated"] == 1
    assert _fm(root, rel)["excludeFromAI"] is True


# -- 4. zip sources are scanned, long lines are scanned in chunks ---------------------------------

import zipfile  # noqa: E402

from objectapp.importscan import scan_text, scan_tree  # noqa: E402

AWS = "AKIA" + "FAKEFAKEFAKEFAKE"


def test_long_lines_are_scanned_in_chunks():
    assert [(f.kind, f.line) for f in scan_text("x" * 30000 + f" {AWS}\nok\n")] == [("api-key", 1)]
    assert [(f.kind, f.line) for f in scan_text(("y" * 19990) + f" {AWS}")] == [("api-key", 1)]  # across a chunk edge


def make_zip(tmp_path: Path) -> Path:
    z = tmp_path / "export.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("Notes/ok.md", "# ok\n\nnothing here\n")
        f.writestr("Notes/bad.md", f"# bad\n\nkey {AWS}\n")
        f.writestr("../evil.md", f"key {AWS}\n")
        f.writestr("img.png", b"\x89PNG\x00\x00")
    return z


def test_zip_members_are_scanned(tmp_path):
    report = scan_tree(make_zip(tmp_path))
    assert list(report.findings) == ["Notes/bad.md"]
    assert [(f.kind, f.line) for f in report.findings["Notes/bad.md"]] == [("api-key", 3)]
    assert report.scanned == 2 and report.unscanned >= 2  # the png and the unsafe name are not scanned
    assert scan_tree(make_zip(tmp_path), ["Notes/bad.md"]).findings == {}


def test_a_binary_file_is_not_reported_as_scanned(tmp_path):
    p = tmp_path / "x.bin"
    p.write_bytes(b"\x00\x01\x02")
    report = scan_tree(p)
    assert report.scanned == 0 and report.unscanned == 1


def test_draft_and_import_of_a_zip_use_the_scan(client, tmp_path):
    from test_m27_agent import do_import

    z = make_zip(tmp_path)
    res = client.post("/api/import/batches", json={"path": str(z)}).json()
    assert list(res["scan"]["findings"]) == ["Notes/bad.md"]
    result = do_import(client, z)
    root = client.space_root
    bad = next(p for p in root.rglob("bad.md"))
    assert _fm(root, bad.relative_to(root).as_posix())["excludeFromAI"] is True
    ok = next(p for p in root.rglob("ok.md"))
    assert "excludeFromAI" not in _fm(root, ok.relative_to(root).as_posix())
    from objectapp.importers import batches

    assert "Notes/bad.md" in batches.load_scan(root, result["batch"])["findings"]


# -- 11. import_scan never overwrites a finished batch's scan --------------------------------------


def test_import_scan_refuses_a_finished_batch(client, tmp_path):
    from test_m27_agent import do_import

    from objectapp.importers import batches

    src = make_source(tmp_path)
    result = do_import(client, src)
    before = batches.load_scan(client.space_root, result["batch"])
    assert before and before["choices"]
    res = client.post("/api/integrations/tokens", json={"name": "agent", "scope": "read-write"})
    headers = {"Authorization": f"Bearer {res.json()['secret']}"}
    r = client.post("/api/v1/import/scan", headers=headers, json={"path": str(src), "batch": result["batch"]})
    assert r.status_code == 409, r.text
    assert batches.load_scan(client.space_root, result["batch"]) == before


# -- 5. the filing pass only fills what is empty and leaves edited objects alone ---------------------


def _filing_setup(client, tmp_path, monkeypatch):
    from test_m27_agent import prepare

    return prepare(client, tmp_path, monkeypatch)


def _decision(path, **extra):
    return {"path": path, "type": "Playbook", "confidence": "high", **extra}


def test_filing_does_not_overwrite_a_value_that_is_set(client, tmp_path, monkeypatch):
    from objectapp.importers import filing

    batch, paths = _filing_setup(client, tmp_path, monkeypatch)
    sp = Space(client.space_root)
    p = paths["Runbook 0"]
    p = filing.apply_decision(sp, _decision(p), allowed={p}, type_names={"playbook"})["path"]  # the type only
    version = sp.read(p)[2]
    sp.update_properties(p, {"owner": "Gene"}, version)
    res = filing.apply_decision(sp, _decision(p, values=[
        {"key": "owner", "value": "Ann", "quote": "Owner: Ann"},
        {"key": "environment", "value": "Prod", "quote": "Environment: Prod"}]), allowed={p}, type_names={"playbook"})
    ok = {v["key"]: v["ok"] for v in res["values"]}
    assert ok == {"owner": False, "environment": True}
    assert "already has a value" in next(v for v in res["values"] if v["key"] == "owner")["reason"]
    assert _fm(client.space_root, res["path"])["owner"] == "Gene"


def test_filing_skips_objects_edited_since_the_import(client, tmp_path, monkeypatch):
    from objectapp.importers import filing

    batch, paths = _filing_setup(client, tmp_path, monkeypatch)
    sp = Space(client.space_root)
    fil = filing.Filing(sp)
    assert paths["Runbook 0"] in fil.eligible(batch)
    of, _fm_, version = sp.read(paths["Runbook 0"])
    sp.save_body(paths["Runbook 0"], of.body + "\nMy own note.\n", version)
    eligible = fil.eligible(batch)
    assert paths["Runbook 0"] not in eligible and paths["Runbook 1"] in eligible


# -- 8. quotes must say it; no proposal means no type change ----------------------------------------


def test_boolean_and_short_quotes_are_not_accepted():
    from objectapp.importers.filing import _check_quote, _norm

    doc = _norm("Reviewed: yes\nEnvironment: Prod\nA note about A")
    assert _check_quote(doc, True, "Environment: Prod", "boolean") is not None  # says nothing about yes/no
    assert _check_quote(doc, True, "Reviewed: yes", "boolean") is None
    assert _check_quote(doc, False, "Reviewed: yes", "boolean") is not None
    assert _check_quote(doc, "A", "A", "text") is not None  # too short to be evidence
    assert _check_quote(doc, "Prod", "Environment: Prod", "text") is None


def test_without_a_proposal_the_pass_changes_no_type(client, tmp_path):
    from test_m27_agent import do_import

    from objectapp.importers import batches, filing

    result = do_import(client, make_source(tmp_path))
    sp = Space(client.space_root)
    _d, items = batches.load_batch(client.space_root, result["batch"])
    path = next(i["path"] for i in items if i["title"] == "Runbook 0")
    before = sp.get(path).type
    for wanted in ("Task", "Tag", "Page"):
        res = filing.apply_decision(sp, {"path": path, "type": wanted, "confidence": "high"}, allowed={path}, type_names=None)
        assert res["inbox"] is True and res["path"] == path, wanted
        assert sp.get(path).type == before


# -- 6. Move batch to Trash finds objects that moved and reports the ones it can't ------------------


def test_trash_batch_follows_moved_objects_and_reports_missing(client, tmp_path):
    from test_m25_provenance import run as run_import

    from objectapp.importers import batches

    src = tmp_path / "S"
    src.mkdir()
    for n in "abc":
        (src / f"{n}.md").write_text(f"# {n}\n\ntext {n}\n", encoding="utf-8")
    result = run_import(client, src, kind="obsidian")["result"]
    root = client.space_root
    _d, items = batches.load_batch(root, result["batch"])
    path_of = {i["title"]: i["path"] for i in items}
    from objectapp.space import version_of

    old = path_of["a"]
    r = client.post("/api/object/change-type", json={
        "path": old, "typeId": "task", "mapping": {}, "baseVersion": version_of((root / old).read_bytes())})
    assert r.status_code == 200, r.text
    assert r.json()["path"] != old  # a moved to another folder
    assert client.delete("/api/object", params={"path": path_of["b"]}).status_code == 200  # b was trashed by hand
    # an item whose object is nowhere (a phantom row)
    items.append({"sourcePath": "z.md", "system": "obsidian", "id": "z.md", "title": "z", "path": "Pages/z.md", "action": "created"})
    batches.write_json(batches.batch_dir(root, result["batch"]) / "items.json", items)

    out = client.post(f"/api/import/batches/{result['batch']}/trash").json()
    assert out["trashed"] == 2 and out["alreadyTrashed"] == 1  # a (found by its id) and c; b was trashed before
    assert out["notFound"] == ["Pages/z.md"] and out["missing"] == 1
    data, _ = batches.load_batch(root, result["batch"])
    assert "trashedAt" not in data  # not complete: one object was not found
    titles = {o["title"] for o in client.get("/api/objects").json()}
    assert not ({"a", "b", "c"} & titles)
    # trying again does not touch what is done, and reports the same missing one
    again = client.post(f"/api/import/batches/{result['batch']}/trash").json()
    assert again["trashed"] == 0 and again["notFound"] == ["Pages/z.md"]


def test_trash_batch_complete_is_stamped(client, tmp_path):
    from test_m25_provenance import run as run_import

    from objectapp.importers import batches

    src = tmp_path / "S"
    src.mkdir()
    (src / "a.md").write_text("# a\n\ntext\n", encoding="utf-8")
    result = run_import(client, src, kind="obsidian")["result"]
    out = client.post(f"/api/import/batches/{result['batch']}/trash").json()
    assert out["trashed"] == 1 and out["notFound"] == []
    assert batches.load_batch(client.space_root, result["batch"])[0]["trashedAt"]
