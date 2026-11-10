"""M31 item 5: remodel an existing space (IT ops design section 6: "a run of the extraction
workflow against that space as the source, written into a new space or a copy. The original space
is never changed").

The open space's own folder is an import source: ``.object/`` and ``.object-cache/`` are skipped
(as every dot folder is), its ``Templates/`` too; each object's ``type`` names its type (the
mapping's ``typeSource: key``), ``createdAt`` and ``lastUpdated`` are its dates, ``id``,
``template`` and an earlier ``importSource`` are left out, and every other key is a property, as
for any Markdown folder. The original space is unchanged byte for byte.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from m15_helpers import FIXTURES, snapshot, wait_job

from objectapp.frontmatter import parse_fm
from objectapp.importers.detect import SPACE_SOURCE
from objectapp.server import create_app
from objectapp.space import Space


@pytest.fixture
def opened(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    root = tmp_path / "IT ops test"
    shutil.copytree(FIXTURES / "space-itops", root)
    space = Space(root)
    app = create_app(space, watch=False)
    with TestClient(app) as client:
        yield root, client


def _fm(path: Path) -> dict:
    text = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    return parse_fm(text.split("---\n", 2)[1])


def test_remodel_the_open_space_into_a_new_space(tmp_path: Path, opened) -> None:
    root, client = opened
    before = snapshot(root)
    r = client.post("/api/import/preview", json={"source": {"path": str(root)}, "target": "newSpace",
                                                  "keepAsSources": False})
    assert r.status_code == 200, r.text
    pv = r.json()
    assert pv["mapping"]["typeSource"] == "key" and pv["mapping"]["typeKey"] == "type"
    assert SPACE_SOURCE in pv["warnings"]
    names = {t["name"] for t in pv["types"]}
    assert {"Host", "Application", "Incident", "Location", "Software"} <= names
    for t in pv["types"]:
        props = {p["sourceName"] for p in t["properties"]}
        assert not props & {"id", "type", "template", "createdAt", "lastUpdated", "importSource"}, t["name"]
    skipped = {(s["path"], s["reason"]) for s in pv["skipped"]}
    assert (".object/", "appSettings") in skipped and ("Templates/", "unsupported") in skipped
    assert not any(o["sourcePath"].startswith("Templates/") for o in pv["samples"])
    assert pv["counts"]["objects"] == 16

    (tmp_path / "out").mkdir()
    r = client.post("/api/import/start", json={
        "previewId": pv["previewId"], "mapping": pv["mapping"], "keepAsSources": False,
        "target": {"kind": "newSpace", "name": "IT ops remodel", "location": str(tmp_path / "out")}})
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == "done", job
    new = tmp_path / "out" / "IT ops remodel"
    host = new / "Hosts" / "APP-TEST-01.md"
    fm = _fm(host)
    # Each type keeps its plural (its folder) from the space's own types; a Page stays a Page.
    assert (new / "Software" / "SQL Server 2019.md").is_file() and (new / "People" / "Sam Example.md").is_file()
    assert (new / "Pages" / "Rack notes.md").is_file()
    assert fm["locatedAt"] == "[[Rack A]]"
    assert fm["type"] == "Host"
    assert fm["createdAt"] == _fm(root / "Hosts" / "APP-TEST-01.md")["createdAt"]
    assert fm["id"] != _fm(root / "Hosts" / "APP-TEST-01.md")["id"]
    assert fm["importSource"]["id"] == "Hosts/APP-TEST-01.md"
    incident = Space(new).type_by_id("incident")
    assert incident is not None and incident.name == "Incident"
    assert not list(new.glob("Templates/**/*.md"))
    # The original space never changes.
    assert snapshot(root) == before


def test_a_folder_without_space_json_reads_as_before(tmp_path: Path) -> None:
    """Only a folder with ``.object/space.json`` is read as a space; any other keeps the folder rules."""
    from objectapp.importers.detect import read_source
    from objectapp.importers.source import open_source

    src = tmp_path / "notes"
    (src / "Hosts").mkdir(parents=True)
    (src / "Hosts" / "A.md").write_text("---\ntype: Host\nid: x1\n---\n\nA.\n", encoding="utf-8")
    with open_source(src) as s:
        read = read_source(s)
    assert not s.is_space and read.defaultTypeSource == "folder" and SPACE_SOURCE not in read.warnings
    assert set(read.objects[0].fields) == {"type", "id"}
    (src / ".object").mkdir()
    (src / ".object" / "space.json").write_text('{"name": "Notes"}', encoding="utf-8")
    with open_source(src) as s:
        read = read_source(s)
    assert s.is_space and read.defaultTypeSource == "key" and read.defaultTypeKey == "type"
    assert set(read.objects[0].fields) == {"type"}
