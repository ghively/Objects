"""M30 Task 4: Keep pages as Sources (plan ``2026-11-09-m30-entity-extraction.md``): the option and
its default, the Source type, read-only imported Sources (byte-identical to the import) and re-runs.

The synthetic IT ops source (`m30_helpers.make_itops_source`) is imported through ``create_app``
and M25's routes.
"""

from __future__ import annotations

import json
import shutil
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from m15_helpers import wait_job
from m30_helpers import CRLF_BOM, FIXTURES, import_as_sources, itops_space, make_itops_source

from objectapp import references
from objectapp.basicsetup import source_type
from objectapp.importers import batches, sources
from objectapp.importers.sources import category_for, keep_as_sources, system_label
from objectapp.server import create_app
from objectapp.space import ReadOnly, Space, version_of
from objectapp.textfile import BOM
from objectapp.typemodel import TypeDefinition

READ_ONLY = "Imported source"


def _sample_space(tmp_path: Path) -> Path:
    root = tmp_path / "plain-space"
    shutil.copytree(FIXTURES / "space-sample", root)
    return root


def _run(client: TestClient, src: Path, preview: dict | None = None, start: dict | None = None) -> tuple[str, dict]:
    """Preview ``src`` into the open space and start the import; (batch, batch.json)."""
    r = client.post("/api/import/preview", json={"source": {"path": str(src)}, "target": "currentSpace", **(preview or {})})
    assert r.status_code == 200, r.text
    pv = r.json()
    r = client.post("/api/import/start", json={"previewId": pv["previewId"], "mapping": pv["mapping"],
                                               "target": {"kind": "currentSpace"}, **(start or {})})
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == "done", job
    batch = job["result"]["batch"]
    data, _items = batches.load_batch(Path(client.app.state.root), batch)  # set by `app_on`
    return batch, data


def _items(root: Path, batch: str) -> dict[str, dict]:
    """The batch's created/updated items by source path."""
    _data, items = batches.load_batch(root, batch)
    return {it["sourcePath"]: it for it in items if it.get("path")}


def _types_dir(root: Path) -> dict[str, bytes]:
    return {p.name: p.read_bytes() for p in sorted((root / ".object" / "types").glob("*.json"))}


@pytest.fixture
def app_on():
    """``app_on(root)`` -> (client, space) on a fresh app, closed after the test."""
    opened: list[TestClient] = []

    def make(root: Path) -> tuple[TestClient, Space]:
        space = Space(root)
        app = create_app(space, watch=False)
        app.state.root = str(root)
        client = TestClient(app)
        client.__enter__()
        opened.append(client)
        return client, space

    yield make
    for c in opened:
        c.__exit__(None, None, None)


def test_option_defaults_and_values(tmp_path, app_on) -> None:
    assert keep_as_sources(None, False, False) is True
    assert keep_as_sources(None, True, False) is True
    assert keep_as_sources(None, False, True) is True
    assert keep_as_sources(False, True, True) is False
    assert keep_as_sources(True, False, False) is True

    # A plain start without the field keeps every page as a Source.
    root = _sample_space(tmp_path / "a")
    client, space = app_on(root)
    before = _types_dir(root)
    batch, data = _run(client, make_itops_source(tmp_path / "a"))
    assert data["keepAsSources"] is True
    items = _items(root, batch)
    assert len(items) == 6
    for it in items.values():
        assert space.get(it["path"]).type == "source", it
        assert it["path"].startswith("Sources/")
    assert set(_types_dir(root)) == set(before) | {"source.json"}  # no mapped type was made

    # keepAsSources: false files the pages into their mapped types, as imports do today.
    root = _sample_space(tmp_path / "b")
    client, space = app_on(root)
    batch, data = _run(client, make_itops_source(tmp_path / "b"), start={"keepAsSources": False})
    assert data["keepAsSources"] is False
    items = _items(root, batch)
    assert {space.get(it["path"]).type for it in items.values()}.isdisjoint({"source"})
    assert space.type_by_id("source") is None
    assert not (root / "Sources").exists()

    # keepAsSources: true: every page a Source, no mapped type made, recorded true.
    root = _sample_space(tmp_path / "c")
    client, space = app_on(root)
    before = _types_dir(root)
    batch, data = _run(client, make_itops_source(tmp_path / "c"), preview={"keepAsSources": True},
                       start={"keepAsSources": True})
    assert data["keepAsSources"] is True
    assert all(space.get(it["path"]).type == "source" for it in _items(root, batch).values())
    assert set(_types_dir(root)) == set(before) | {"source.json"}

    # A v1 start_import (requireApproved) without the field makes Sources.
    root = _sample_space(tmp_path / "d")
    client, space = app_on(root)
    secret = client.post("/api/integrations/tokens", json={"name": "agent", "scope": "read-write"}).json()["secret"]
    auth = {"Authorization": f"Bearer {secret}"}
    src = make_itops_source(tmp_path / "d")
    r = client.post("/api/v1/import/preview", json={"path": str(src), "target": "currentSpace"}, headers=auth)
    assert r.status_code == 200, r.text
    r = client.post("/api/v1/import/start", json={"previewId": r.json()["previewId"], "target": "currentSpace"},
                    headers=auth)
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == "done", job
    batch = job["result"]["batch"]
    assert sources.is_source_batch(root, batch)
    assert all(space.get(it["path"]).type == "source" for it in _items(root, batch).values())

    # A re-preview with keepAsSources: true plans one type, Source; without it, the mapped types.
    root = _sample_space(tmp_path / "e")
    client, _space = app_on(root)
    src = make_itops_source(tmp_path / "e")
    pv = client.post("/api/import/preview", json={"source": {"path": str(src)}, "target": "currentSpace"}).json()
    assert "Source" not in [t["name"] for t in pv["types"]]
    again = client.post("/api/import/preview", json={"source": {"path": str(src)}, "target": "currentSpace",
                                                     "mapping": pv["mapping"], "keepAsSources": True})
    assert again.status_code == 200, again.text
    planned = again.json()
    assert [t["name"] for t in planned["types"]] == ["Source"]
    assert planned["types"][0]["objectCount"] == 6
    assert planned["mapping"] == pv["mapping"]  # kept as given, not applied
    back = client.post("/api/import/preview", json={"source": {"path": str(src)}, "target": "currentSpace",
                                                    "mapping": planned["mapping"], "keepAsSources": False})
    assert [t["name"] for t in back.json()["types"]] == [t["name"] for t in pv["types"]]


def _strip_ids(value):
    if isinstance(value, dict):
        return {k: _strip_ids(v) for k, v in value.items() if k != "id"}
    if isinstance(value, list):
        return [_strip_ids(v) for v in value]
    return value


def test_source_type_created_once_in_any_space(tmp_path, app_on) -> None:
    root = _sample_space(tmp_path)
    assert not (root / ".object" / "types" / "source.json").exists()
    client, space = app_on(root)
    _batch, data = _run(client, make_itops_source(tmp_path), preview={"keepAsSources": True})
    stored = json.loads((root / ".object" / "types" / "source.json").read_text("utf-8"))
    written = TypeDefinition.from_json(stored, fallback_id="source").to_json()
    expected = source_type().to_json()
    assert written["id"] == expected["id"] == "source"
    assert _strip_ids(written["propertyDefinitions"]) == _strip_ids(expected["propertyDefinitions"])
    assert {k: v for k, v in written.items() if k != "propertyDefinitions"} == {
        k: v for k, v in expected.items() if k != "propertyDefinitions"
    }
    assert data["types"] == 1

    # A second import kept as Sources (another source) writes no type.
    other = tmp_path / "other"
    (other / "Notes").mkdir(parents=True)
    (other / "Notes" / "Patch night.md").write_text("Patch night is the second Tuesday.\n", "utf-8")
    types = _types_dir(root)
    _batch, data = _run(client, other)
    assert _types_dir(root) == types
    assert data["types"] == 0

    # In an IT ops space (it has Source already) it writes no type.
    ops = itops_space(tmp_path / "ops")
    types = _types_dir(ops)
    batch = import_as_sources(ops, make_itops_source(tmp_path / "ops"))
    assert _types_dir(ops) == types
    assert batches.load_batch(ops, batch)[0]["types"] == 0


def _body_after_fence(data: bytes) -> bytes:
    """The bytes after the closing frontmatter fence of an object file."""
    text = data[len(BOM):] if data.startswith(BOM) else data
    first = text.index(b"\n") + 1
    closing = text.index(b"\n---", first - 1) + 1
    return text[text.index(b"\n", closing) + 1:]


def test_source_is_byte_identical_to_the_import(tmp_path, app_on) -> None:
    root = itops_space(tmp_path)
    src = make_itops_source(tmp_path)
    page = b"---\nowner: Ops\nos: Linux\n---\nSRV-WEB01 serves the intranet.\n\n- [x] patched\n"
    (src / "Hosts" / "SRV-WEB01.md").write_bytes(page)
    source_json = (root / ".object" / "types" / "source.json").read_bytes()
    client, space = app_on(root)
    batch = import_as_sources(root, src, client)
    items = _items(root, batch)

    rel = items[CRLF_BOM]["path"]
    assert rel.startswith(space.type_by_id("source").folder.strip("/") + "/")
    data = (root / rel).read_bytes()
    original = (src / CRLF_BOM).read_bytes()
    assert data.startswith(BOM) and b"\r\n" in data and b"\n" not in data.replace(b"\r\n", b"")
    assert _body_after_fence(data) == original[len(BOM):]
    assert version_of(data) == items[CRLF_BOM]["version"]  # what the writer wrote
    _of, fm, _v = space.read(rel)
    assert fm["type"] == "Source" and fm["category"] == "Note" and fm["system"] == "Markdown"
    assert space.get(rel).type == "source"

    web = items["Hosts/SRV-WEB01.md"]["path"]
    web_data = (root / web).read_bytes()
    assert _body_after_fence(web_data) == page[page.index(b"---\n", 4) + 4:]
    _of, fm, _v = space.read(web)
    declared = {p.key for p in space.type_by_id("source").propertyDefinitions}
    assert fm["owner"] == "Ops" and fm["os"] == "Linux"
    assert {"owner", "os"}.isdisjoint(declared)
    assert (root / ".object" / "types" / "source.json").read_bytes() == source_json  # Source not extended

    # Reads write nothing: the bytes are still what the writer wrote.
    assert client.get("/api/object", params={"path": rel}).status_code == 200
    client.get("/api/objects")
    Space(root)
    for sp, it in items.items():
        assert version_of((root / it["path"]).read_bytes()) == it["version"], sp


def test_imported_source_is_read_only(tmp_path, app_on) -> None:
    root = itops_space(tmp_path)
    src = make_itops_source(tmp_path)
    client, space = app_on(root)
    batch = import_as_sources(root, src, client)
    items = _items(root, batch)
    rel = items["Runbooks/Restart Payroll.md"]["path"]
    host, _hv = space.create_object("host", "APP01")
    before = (root / rel).read_bytes()
    version = version_of(before)

    got = client.get("/api/object", params={"path": rel}).json()
    assert got["summary"]["readOnly"] is True
    assert got["summary"]["readOnlyReason"] == READ_ONLY

    with pytest.raises(ReadOnly, match=READ_ONLY):
        space.update_properties(rel, {"category": "Document"}, version)
    r = client.put("/api/object/body", json={"path": rel, "body": "Edited.\n", "baseVersion": version})
    assert r.status_code == 423 and r.json()["reason"] == READ_ONLY
    r = client.post("/api/object/rename", json={"path": rel, "title": "Restart it", "baseVersion": version})
    assert r.status_code == 423 and r.json()["reason"] == READ_ONLY
    r = client.post("/api/object/change-type", json={"path": rel, "typeId": "runbook", "baseVersion": version})
    assert r.status_code == 423 and r.json()["reason"] == READ_ONLY
    of, _fm, _v = space.read(rel)
    start = of.body.index("APP01")
    with pytest.raises(ReadOnly, match=READ_ONLY):
        references.link_mention(space, rel, host, start, start + len("APP01"), "APP01", version)
    secret = client.post("/api/integrations/tokens", json={"name": "agent", "scope": "read-write"}).json()["secret"]
    r = client.post("/api/v1/object/properties", json={"path": rel, "version": version, "set": {"category": "Document"}},
                    headers={"Authorization": f"Bearer {secret}"})
    assert r.status_code == 423 and READ_ONLY in r.text
    with pytest.raises(ReadOnly, match=READ_ONLY):  # a version restore puts bytes back this way
        space._write_exact(rel, version, b"---\ntype: 'Source'\n---\nOld text.\n")
    assert (root / rel).read_bytes() == before

    # Adding an entity from the Source's "Distilled into" row writes only the entity.
    r = client.post("/api/object/counterpart", json={"path": rel, "key": "distilledInto", "sourceTypeId": "host",
                                                     "add": [host]})
    assert r.status_code == 200, r.text
    assert [w["path"] for w in r.json()["written"]] == [host]
    assert space.read(host)[1]["sources"]
    assert (root / rel).read_bytes() == before

    # A Source made by hand (no importSource) is editable.
    own, own_v = space.create_object("source", "My own note")
    assert space.get(own).readOnly is False
    space.update_properties(own, {"category": "Note"}, own_v)
    assert space.read(own)[1]["category"] == "Note"

    # Move to Trash and Restore work, the bytes unchanged.
    r = client.delete("/api/object", params={"path": rel})
    assert r.status_code == 200, r.text
    assert not (root / rel).exists()
    r = client.post(f"/api/trash/{r.json()['trashId']}/restore")
    assert r.status_code == 200, r.text
    assert (root / rel).read_bytes() == before
    assert space.get(rel).readOnlyReason == READ_ONLY


def test_source_writes_is_per_thread(tmp_path) -> None:
    root = itops_space(tmp_path)
    batch = import_as_sources(root, make_itops_source(tmp_path))
    space = Space(root)
    rel = _items(root, batch)["Notes/Rack notes.md"]["path"]
    version = version_of((root / rel).read_bytes())
    other: list[BaseException | None] = []

    def elsewhere() -> None:
        try:
            space.update_properties(rel, {"category": "Document"}, version)
            other.append(None)
        except BaseException as exc:  # noqa: BLE001 - the test reads it
            other.append(exc)

    with space.source_writes():
        t = threading.Thread(target=elsewhere)
        t.start()
        t.join()
        with space.source_writes():  # nests
            pass
        result = space.update_properties(rel, {"category": "Document"}, version)
    assert isinstance(other[0], ReadOnly) and other[0].reason == READ_ONLY
    assert result.version != version
    assert space.read(rel)[1]["category"] == "Document"
    with pytest.raises(ReadOnly, match=READ_ONLY):  # outside again
        space.update_properties(rel, {"category": "Note"}, result.version)


@pytest.mark.parametrize(
    ("block", "path", "expected"),
    [
        ({"system": "files", "original": "Attachments/Originals/Runbook.docx"}, "Runbook.docx", "Document"),
        ({"system": "files"}, "Budget.XLSX", "Spreadsheet"),
        ({"system": "files"}, "Deck.pptx", "Presentation"),
        ({"system": "files"}, "Manual.pdf", "PDF"),
        ({"system": "files"}, "Rack.vsdx", "Diagram"),
        ({"system": "files"}, "Outage.eml", "Email"),
        ({"system": "files"}, "Intranet/Home.aspx", "Web page"),
        ({"system": "files"}, "Photos/Rack.jpg", "Image"),
        ({"system": "wiki"}, "Hosts/APP01.md", "Wiki page"),
        ({"system": "sharepoint"}, "Hosts/APP01.md", "Wiki page"),
        ({"system": "obsidian"}, "Hosts/APP01.md", "Note"),
        ({"system": "markdown"}, "Hosts/APP01.md", "Note"),
        ({"system": "elsewhere"}, "Hosts/APP01.md", None),
    ],
)
def test_category_for(block, path, expected) -> None:
    assert category_for(block, path) == expected


def test_system_label() -> None:
    assert system_label({"system": "markdown"}) == "Markdown"
    assert system_label({"system": "sharepoint"}) == "SharePoint"
    assert system_label({"system": "elsewhere"}) is None
    assert system_label({}) is None


def test_rerun_updates_source_with_history(tmp_path, app_on) -> None:
    root = itops_space(tmp_path)
    src = make_itops_source(tmp_path)
    client, space = app_on(root)
    batch = import_as_sources(root, src, client)
    rel = _items(root, batch)["Hosts/APP01.md"]["path"]
    first = (root / rel).read_bytes()
    _of, fm0, _v = space.read(rel)
    types = _types_dir(root)

    new_text = b"APP01 is the Payroll server at HQ. IP address: 10.0.0.7.\n"
    (src / "Hosts" / "APP01.md").write_bytes(new_text)
    batch2 = import_as_sources(root, src, client)
    assert _items(root, batch2)["Hosts/APP01.md"]["action"] == "updated"
    data = (root / rel).read_bytes()
    assert _body_after_fence(data) == new_text
    _of, fm, _v = space.read(rel)
    for key in ("type", "id", "category", "system"):
        assert fm[key] == fm0[key], key
    assert fm["importSource"]["batch"] == batch2
    assert space.get(rel).readOnlyReason == READ_ONLY
    versions = client.get("/api/history", params={"path": rel}).json()["versions"]
    texts = [client.get("/api/history/version", params={"path": rel, "id": v["id"]}).json().get("text") for v in versions]
    assert first.decode("utf-8") in texts

    # A re-run with keepAsSources: false still updates it as a Source (and files nothing into a type).
    newer = b"APP01 is the Payroll server at HQ. IP address: 10.0.0.8.\n"
    (src / "Hosts" / "APP01.md").write_bytes(newer)
    _batch3, data3 = _run(client, src, preview={"keepAsSources": False}, start={"keepAsSources": False})
    assert data3["keepAsSources"] is False
    assert _body_after_fence((root / rel).read_bytes()) == newer
    _of, fm, _v = space.read(rel)
    assert fm["type"] == "Source" and fm["id"] == fm0["id"] and fm["category"] == fm0["category"]
    assert space.get(rel).readOnlyReason == READ_ONLY
    assert _types_dir(root) == types
    assert all(space.get(p).type == "source" for p in (it["path"] for it in _items(root, _batch3).values()))


def _history_texts(client: TestClient, rel: str) -> list[str]:
    versions = client.get("/api/history", params={"path": rel}).json()["versions"]
    return [client.get("/api/history/version", params={"path": rel, "id": v["id"]}).json().get("text") or ""
            for v in versions]


def test_rerun_writes_the_new_source_bytes_exactly(tmp_path, app_on) -> None:
    """A re-run's Source is the new source's bytes, whatever the old file's line endings and BOM."""
    root = itops_space(tmp_path)
    src = make_itops_source(tmp_path)
    client, space = app_on(root)
    batch = import_as_sources(root, src, client)
    rel = _items(root, batch)[CRLF_BOM]["path"]
    first = (root / rel).read_bytes()
    assert first.startswith(BOM) and b"\r\n" in first

    # Mixed endings, still with a BOM: the body is the new bytes, each line ending as the source has it.
    mixed = BOM + b"SRV-DB01 holds Payroll.\r\nLine two\nLine three\r\n"
    (src / CRLF_BOM).write_bytes(mixed)
    batch2 = import_as_sources(root, src, client)
    item = _items(root, batch2)[CRLF_BOM]
    assert item["action"] == "updated"
    data = (root / rel).read_bytes()
    assert data.startswith(BOM)
    assert _body_after_fence(data) == mixed[len(BOM):]
    assert version_of(data) == item["version"]
    assert any("SRV-DB01 holds the Payroll database" in t for t in _history_texts(client, rel))  # the old text kept

    # The source drops its BOM and CRLF: so does the Source.
    plain = b"SRV-DB01 holds Payroll, LF now.\n"
    (src / CRLF_BOM).write_bytes(plain)
    batch3 = import_as_sources(root, src, client)
    data = (root / rel).read_bytes()
    assert not data.startswith(BOM) and b"\r\n" not in data
    assert _body_after_fence(data) == plain
    assert version_of(data) == _items(root, batch3)[CRLF_BOM]["version"]
    _of, fm, _v = space.read(rel)
    assert fm["type"] == "Source" and fm["category"] == "Note"
    assert space.get(rel).readOnlyReason == READ_ONLY
    assert any("Line two" in t for t in _history_texts(client, rel))


def _mcp_call(client: TestClient, tool: str, **args):
    """Call an MCP tool through the app (``ApiError`` with the app's answer when it refuses)."""
    import asyncio

    from mcp.server.mcpserver.exceptions import ToolError
    from objectapp.mcp_server import ApiError, ObjectClient, build_server

    secret = client.post("/api/integrations/tokens", json={"name": "mcp", "scope": "read-write"}).json()["secret"]
    server = build_server(ObjectClient("http://testserver", secret, client))
    try:
        out = asyncio.run(server.call_tool(tool, args))
    except ToolError as exc:
        raise ApiError(str(exc)) from exc
    if out.is_error:
        raise ApiError(" ".join(getattr(c, "text", "") for c in out.content))
    return out.structured_content if out.structured_content is not None else json.loads(out.content[0].text)


def test_version_restore_of_a_source_is_refused(tmp_path, app_on) -> None:
    from objectapp.mcp_server import ApiError

    root = itops_space(tmp_path)
    src = make_itops_source(tmp_path)
    client, space = app_on(root)
    batch = import_as_sources(root, src, client)
    rel = _items(root, batch)["Hosts/APP01.md"]["path"]
    (src / "Hosts" / "APP01.md").write_bytes(b"APP01 changed.\n")
    import_as_sources(root, src, client)
    versions = client.get("/api/history", params={"path": rel}).json()["versions"]
    assert versions
    before = (root / rel).read_bytes()
    version = version_of(before)

    r = client.post("/api/history/restore", json={"path": rel, "id": versions[-1]["id"], "baseVersion": version})
    assert r.status_code == 423, r.text
    assert r.json()["reason"] == READ_ONLY and r.json()["detail"]
    assert (root / rel).read_bytes() == before
    assert client.get("/api/history", params={"path": rel}).json()["versions"] == versions  # no entry for nothing

    secret = client.post("/api/integrations/tokens", json={"name": "agent", "scope": "read-write"}).json()["secret"]
    r = client.post("/api/v1/history/restore", json={"path": rel, "versionId": versions[-1]["id"], "version": version},
                    headers={"Authorization": f"Bearer {secret}"})
    assert r.status_code == 423, r.text
    assert r.json()["reason"] == READ_ONLY
    with pytest.raises(ApiError, match=f"423: {READ_ONLY}"):
        _mcp_call(client, "restore_version", path=rel, version_id=versions[-1]["id"], version=version)
    assert (root / rel).read_bytes() == before
    assert client.get("/api/history", params={"path": rel}).json()["versions"] == versions


def test_vcs_file_restore_of_a_source_is_refused(tmp_path, app_on, monkeypatch) -> None:
    from objectapp import vcs

    if not vcs.available():
        pytest.skip("git is not installed")
    cfg = tmp_path / "gitconfig"
    cfg.write_text("")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(cfg))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.delenv(vcs.GIT_ENV, raising=False)
    root = itops_space(tmp_path)
    src = make_itops_source(tmp_path)
    client, _space = app_on(root)
    assert client.post("/api/vcs/enable", json={"target": "space"}).status_code == 200
    batch = import_as_sources(root, src, client)
    rel = _items(root, batch)["Hosts/APP01.md"]["path"]
    assert client.post("/api/vcs/commit", json={"target": "space"}).status_code == 200
    (src / "Hosts" / "APP01.md").write_bytes(b"APP01 changed.\n")
    import_as_sources(root, src, client)
    assert client.post("/api/vcs/commit", json={"target": "space"}).status_code == 200
    file_versions = client.get("/api/vcs/file-log", params={"path": rel}).json()["versions"]
    assert len(file_versions) == 2
    before = (root / rel).read_bytes()
    r = client.post("/api/vcs/file-restore", json={"path": rel, "sha": file_versions[-1]["sha"],
                                                    "baseVersion": version_of(before)})
    assert r.status_code == 423, r.text
    assert r.json()["reason"] == READ_ONLY and r.json()["detail"]
    assert (root / rel).read_bytes() == before
