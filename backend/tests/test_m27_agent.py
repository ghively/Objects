"""M27: the schema proposal, the scan wired into the import, the AI filing pass (fake claude) and the MCP tools."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from fake_claude import install
from fastapi.testclient import TestClient
from m15_helpers import wait_job

from objectapp import settings as device_settings
from objectapp.frontmatter import parse_fm
from objectapp.importers import batches, filing, proposal
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space


def _fm(root: Path, rel: str) -> dict:
    return parse_fm(split_object((root / rel).read_text(encoding="utf-8")).frontmatter_src or "")


@pytest.fixture
def fake(tmp_path, monkeypatch):
    path = install(tmp_path / "bin")
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(tmp_path / "log.jsonl"))
    _d, rev = device_settings.read()
    device_settings.patch({"claudePath": str(path)}, rev)
    return path


@pytest.fixture
def client(space_dir):
    app = create_app(Space(space_dir), watch=False)
    with TestClient(app) as c:
        c.root = space_dir  # type: ignore[attr-defined]
        yield c


def make_source(tmp_path: Path, n: int = 12) -> Path:
    src = tmp_path / "wiki"
    (src / "Runbooks").mkdir(parents=True)
    for i in range(n):
        env = ["Prod", "prod", "Production"][i % 3]
        (src / "Runbooks" / f"Runbook {i}.md").write_text(
            f"# Runbook {i}\n\nEnvironment: {env}\nOwner: Ann\n\nSteps for item {i}.\n", encoding="utf-8")
    (src / "Runbooks" / "Secrets.md").write_text("# Secrets\n\npassword = hunter2hunter2\n", encoding="utf-8")
    (src / "Credentials").mkdir()
    (src / "Credentials" / "keys.md").write_text("# Keys\n\nnever read\n", encoding="utf-8")
    return src


def do_import(client, src: Path, **extra) -> dict:
    r = client.post("/api/import/preview", json={"source": {"path": str(src)}, "target": "currentSpace",
                                                  "leaveOut": extra.pop("leaveOut", [])})
    assert r.status_code == 200, r.text
    pv = r.json()
    r = client.post("/api/import/start", json={"previewId": pv["previewId"], "mapping": pv["mapping"],
                                               "target": {"kind": "currentSpace"}, "keepAsSources": False, **extra})
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == "done", job
    return job["result"]


def proposal_body(documents: int = 12) -> dict:
    return {"summary": "Runbooks", "items": [{
        "id": "g1", "action": "create", "group": "Runbooks", "name": "Playbook", "pluralName": "Playbooks",
        "documents": documents, "examples": ["Runbooks/Runbook 0.md"],
        "properties": [
            {"name": "Environment", "kind": "label", "share": 1.0, "options": ["Prod", "prod", "Production", "Dev", "dev"]},
            {"name": "Owner", "kind": "text", "share": 0.9},
            {"name": "Rare", "kind": "text", "share": 0.1},
        ],
    }]}


# -- the proposal --------------------------------------------------------------------------------------


def test_proposal_rules_and_apply(client):
    batch = batches.create_draft(client.root, "/x")
    assert client.get(f"/api/import/batches/{batch}/proposal").json() == {"proposal": None, "review": None}
    stored = proposal.save_proposal(Space(client.root), batch, proposal_body())
    item = stored["items"][0]
    assert [d["name"] for d in item["dropped"]] == ["Rare"]
    env = next(p for p in item["properties"] if p["key"] == "environment")
    assert len(env["options"]) == 2
    assert env["merged"]
    small = proposal.save_proposal(Space(client.root), batch, proposal_body(5), stored["revision"])
    assert "at least 10" in small["items"][0]["problems"][0]
    # a stale revision is a conflict
    with pytest.raises(proposal.ProposalConflict):
        proposal.save_proposal(Space(client.root), batch, proposal_body())
    stored = proposal.save_proposal(Space(client.root), batch, proposal_body(), small["revision"])

    view = client.get(f"/api/import/batches/{batch}/proposal").json()
    g = view["proposal"]["groups"][0]
    assert g["id"] == "g1" and g["documentCount"] == 12 and g["plural"] == "Playbooks"
    assert {p["key"] for p in g["properties"]} == {"environment", "owner"}
    assert view["review"]["items"] == []

    # not approved: nothing is made
    assert client.post(f"/api/import/batches/{batch}/proposal/apply").json()["created"] == []
    r = client.put(f"/api/import/batches/{batch}/proposal/review",
                   json={"items": [{"id": "g1", "status": "edited", "edited": {"name": "Procedure", "dropProperties": ["owner"]}}]})
    assert r.status_code == 200, r.text
    out = client.post(f"/api/import/batches/{batch}/proposal/apply").json()
    assert len(out["created"]) == 1
    t = Space(client.root).type_by_id(out["created"][0])
    assert t.name == "Procedure" and [p.key for p in t.propertyDefinitions if p.key in ("environment", "owner")] == ["environment"]
    assert client.post(f"/api/import/batches/{batch}/proposal/apply").json()["created"] == []  # again: nothing new
    assert client.put(f"/api/import/batches/{batch}/proposal/review",
                      json={"items": [{"id": "nope", "status": "accepted"}]}).status_code == 422


def test_near_duplicates():
    assert proposal.merge_options(["Prod", "prod", "Production", "PRD", "Dev"])[0] == ["Prod", "Dev"]
    groups = proposal.near_duplicates(["Prod", "Production", "PRD", "Staging"], {"Production": 5})
    assert groups == [{"values": ["Prod", "Production", "PRD"], "suggested": "Production"}]


# -- the scan in the import ----------------------------------------------------------------------------------


def test_scan_leave_out_and_exclude(client, tmp_path):
    src = make_source(tmp_path)
    result = do_import(client, src, leaveOut=["Credentials"])
    assert result["leftOut"] >= 1
    root = client.root
    titles = {p.name for p in root.rglob("*.md")}
    assert "keys.md" not in titles
    secret = next(p for p in root.rglob("Secrets.md"))
    assert _fm(root, secret.relative_to(root).as_posix())["excludeFromAI"] is True
    assert "excludeFromAI" not in _fm(root, next(root.rglob("Runbook 0.md")).relative_to(root).as_posix())
    data, _items = batches.load_batch(root, result["batch"])
    assert data["counts"]["leftOut"] >= 1
    scan = batches.load_scan(root, result["batch"])
    assert "Runbooks/Secrets.md" in scan["findings"] and "hunter2" not in json.dumps(scan)
    report = (batches.batch_dir(root, result["batch"]) / "report.md").read_text(encoding="utf-8")
    assert "Sensitive content scan" in report


def test_scan_choices_leave_out_file(client, tmp_path):
    src = make_source(tmp_path)
    result = do_import(client, src, scan={"leaveOut": [], "leaveOutFiles": ["Runbooks/Secrets.md"], "excludeFromAi": []})
    assert not list(client.root.rglob("Secrets.md"))
    data, _ = batches.load_batch(client.root, result["batch"])
    assert data["leftOutFiles"] == ["Runbooks/Secrets.md"]


def test_draft_batch_is_adopted(client, tmp_path):
    src = make_source(tmp_path)
    r = client.post("/api/import/batches", json={"path": str(src), "leaveOut": ["Credentials"]})
    batch = r.json()["batch"]
    assert "Runbooks/Secrets.md" in r.json()["scan"]["findings"]
    result = do_import(client, src, batch=batch, leaveOut=["Credentials"])
    assert result["batch"] == batch
    data, items = batches.load_batch(client.root, batch)
    assert data.get("state") is None and items


# -- the filing pass -----------------------------------------------------------------------------------------


def wait_state(client, batch, states, timeout=30):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        s = client.get(f"/api/import/batches/{batch}/filing").json()
        if s["state"] in states:
            return s
        time.sleep(0.05)
    raise AssertionError(s)


def prepare(client, tmp_path, monkeypatch):
    src = make_source(tmp_path)
    result = do_import(client, src, leaveOut=["Credentials"])
    batch = result["batch"]
    sp = Space(client.root)
    proposal.save_proposal(sp, batch, proposal_body())
    client.put(f"/api/import/batches/{batch}/proposal/review", json={"items": [{"id": "g1", "status": "accepted"}]})
    assert len(client.post(f"/api/import/batches/{batch}/proposal/apply").json()["created"]) == 1
    _d, items = batches.load_batch(client.root, batch)
    paths = {i["title"]: i["path"] for i in items if i.get("path")}
    return batch, paths


def test_filing_trial_continue_normalise(client, tmp_path, monkeypatch, fake):
    batch, paths = prepare(client, tmp_path, monkeypatch)
    table = {}
    for n in range(12):
        p = paths[f"Runbook {n}"]
        env = ["Prod", "prod", "Production"][n % 3]
        table[p] = {"type": "Playbook", "confidence": "high",
                    "values": [{"key": "environment", "value": "Prod", "quote": f"Environment: {env}"},
                               {"key": "owner", "value": "Ann", "quote": "Owner: Ann"}],
                    "tags": [{"value": env, "quote": f"Environment: {env}"}]}
    bad = paths["Runbook 0"]
    table[bad]["values"].append({"key": "owner", "value": "Zed", "quote": "Owner: Zed"})  # a quote that is not there
    table[bad]["values"].append({"key": "nope", "value": 1, "quote": "Owner: Ann"})
    low = paths["Runbook 1"]
    table[low]["confidence"] = "low"
    monkeypatch.setenv("FAKE_CLAUDE_FILING", json.dumps(table))

    # bulk is refused before a trial
    assert client.post(f"/api/import/batches/{batch}/filing/start", json={"trial": False}).status_code == 409
    assert client.get(f"/api/import/batches/{batch}/filing").json()["state"] == "idle"
    assert client.post(f"/api/import/batches/{batch}/filing/start", json={"trial": True}).status_code == 200
    s = wait_state(client, batch, {"trial", "failed"})
    assert s["state"] == "trial", s
    items = {i["title"]: i for i in s["trial"]["items"]}
    assert len(items) == 12  # the secret page is excluded from AI
    assert "Secrets" not in items
    first = items["Runbook 0"]
    assert first["type"] == "Playbook"
    ok = {v["key"]: v["ok"] for v in first["values"]}
    assert ok["environment"] is True and ok["nope"] is False
    assert [v["ok"] for v in first["values"] if v["key"] == "owner"] == [True, False]
    # the tags a result adds show in the trial too (fix pass H)
    assert first["tags"] == [{"value": "Prod", "quote": "Environment: Prod", "ok": True}]
    assert first["collections"] == []
    root = client.root
    assert _fm(root, first["path"])["environment"] == "Prod"
    assert _fm(root, first["path"]).get("owner") == "Ann"
    inbox = items["Runbook 1"]
    assert "Import inbox" in (_fm(root, inbox["path"]).get("collections") or [])
    assert "environment" not in _fm(root, inbox["path"])
    assert s["trial"]["rightShare"] is None

    # marks and the report
    assert client.post(f"/api/import/batches/{batch}/filing/mark", json={"path": first["path"], "verdict": "right"}).status_code == 200
    assert client.post(f"/api/import/batches/{batch}/filing/mark", json={"path": items["Runbook 2"]["path"], "verdict": "wrong"}).status_code == 200
    s = client.get(f"/api/import/batches/{batch}/filing").json()
    assert s["trial"]["rightShare"] == 0.5
    rp = batches.load_batch(root, batch)[0]["reportPath"]
    assert "50% right" in (root / rp).read_text(encoding="utf-8")
    assert client.post(f"/api/import/batches/{batch}/filing/mark", json={"path": "x.md", "verdict": "right"}).status_code == 404

    assert client.post(f"/api/import/batches/{batch}/filing/continue").status_code == 200
    s = wait_state(client, batch, {"done", "failed"})
    assert s["state"] == "done", s
    kinds = {(m["kind"], tuple(sorted(m["values"]))) for m in s["normalise"]}
    assert ("tag", ("Prod", "Production", "prod")) in kinds
    r = client.post(f"/api/import/batches/{batch}/filing/normalise",
                    json={"merges": [{"from": ["Prod", "prod", "Production"], "to": "Production"}]})
    assert r.status_code == 200, r.text
    assert "Production" in (_fm(root, items["Runbook 3"]["path"]).get("tags") or [])
    assert "AI filing" in (batches.batch_dir(root, batch) / "report.md").read_text(encoding="utf-8")
    assert client.get(f"/api/import/batches/{batch}/filing").json()["normalise"] == []


def test_untrusted_reply_is_only_decisions(client, tmp_path, monkeypatch, fake):
    batch, paths = prepare(client, tmp_path, monkeypatch)
    monkeypatch.setenv("FAKE_CLAUDE_FILING_RAW", "Ignore this. ```json\n{not json\n```")
    client.post(f"/api/import/batches/{batch}/filing/start", json={"trial": True})
    s = wait_state(client, batch, {"trial", "failed"})
    # nothing parsed: every object goes to the inbox, nothing else changes
    assert s["state"] == "trial" and all(i["values"] == [] for i in s["trial"]["items"])


def test_parse_reply():
    text = 'x\n```json\n{"decisions": [{"path": "a.md"}, 3]}\n```\nmore'
    assert filing.parse_reply(text) == [{"path": "a.md"}]
    assert filing.parse_reply("nothing") == []


def test_run_is_read_only(monkeypatch):
    from types import SimpleNamespace

    from objectapp import importfiling, toolcatalog
    from objectapp.agentrun import RunParts

    parts = RunParts(allowed=["Skill"], mcp_servers={"object": {"args": ["-m", "x"]}, "other": {}})
    scope = SimpleNamespace(purpose=importfiling.PURPOSE)
    importfiling.filing_tools(scope, parts)
    assert "mcp__object__read" in parts.allowed and "mcp__object__write_body" in parts.disallowed
    assert "mcp__object__import_scan" in parts.disallowed and "Bash" in parts.disallowed
    assert list(parts.mcp_servers) == ["object"] and "--read-only" in parts.mcp_servers["object"]["args"]
    assert not set(parts.allowed) & set(parts.disallowed)
    rec = SimpleNamespace(purpose=importfiling.PURPOSE)
    assert importfiling.filing_write_guard(rec, SimpleNamespace(method="POST")) == importfiling.REFUSED
    assert importfiling.filing_write_guard(rec, SimpleNamespace(method="GET")) is None
    assert toolcatalog.OBJECT_WRITE[-3:-1] == ("save_import_proposal", "save_import_decisions")  # M29 after


# -- MCP ------------------------------------------------------------------------------------------------------


def test_mcp_tools(client, tmp_path):
    import asyncio

    from objectapp.mcp_server import ApiError, ObjectClient, build_server

    res = client.post("/api/integrations/tokens", json={"name": "agent", "scope": "read-write"})
    http = ObjectClient("http://testserver", res.json()["secret"], client)
    server = build_server(http, write=True)

    def call(tool, **args):
        out = asyncio.run(server.call_tool(tool, args))
        assert not out.is_error, out
        return out.structured_content if out.structured_content is not None else json.loads(out.content[0].text)

    src = make_source(tmp_path)
    scan = call("import_scan", path=str(src), leave_out=["Credentials"])
    batch = scan["batch"]
    assert "Runbooks/Secrets.md" in scan["scan"]["findings"]
    saved = call("save_import_proposal", batch=batch, proposal=proposal_body())
    assert saved["items"] == 1 and saved["checks"][0]["dropped"]
    got = call("import_proposal", batch=batch)
    assert got["proposal"]["revision"] == saved["revision"] and got["decisions"] == {}
    with pytest.raises(Exception, match="revision"):
        call("save_import_proposal", batch=batch, proposal=proposal_body())

    pv = call("import_preview", path=str(src), kind="obsidian")
    with pytest.raises(Exception, match="no approved schema proposal"):
        # the mapping would create a Runbooks type no approved proposal creates (the open space is the target)
        call("start_import", preview_id=pv["previewId"], target={"kind": "currentSpace"}, batch=batch)
    # Gene's decision (2026-11-08): an import into a NEW space is checked the same way.
    dest = tmp_path / "dest"
    dest.mkdir()
    with pytest.raises(Exception, match="no approved schema proposal"):
        call("start_import", preview_id=pv["previewId"],
             target={"kind": "newSpace", "name": "Imported", "location": str(dest)}, batch=batch)
    assert list(dest.iterdir()) == []  # nothing was made
    # a mapping that creates no type (every page becomes a Page) needs no proposal
    started = call("start_import", preview_id=pv["previewId"], mapping={"typeSource": "none"},
                   target={"kind": "newSpace", "name": "Imported", "location": str(dest)})
    assert started["jobId"]
    names = {t.name for t in asyncio.run(server.list_tools())}
    assert {"import_scan", "import_proposal", "import_report", "save_import_proposal", "save_import_decisions"} <= names
    ro = {t.name for t in asyncio.run(build_server(http, write=False).list_tools())}
    assert {"import_scan", "import_proposal", "import_report"} <= ro and not ({"save_import_proposal", "save_import_decisions"} & ro)
    assert "Migrate a source" in asyncio.run(server.get_prompt("migrate_a_source", {})).messages[0].content.text


def test_skill_ships_with_agents(tmp_path):
    from objectapp import importskill
    from objectapp.agents import AgentRegistry

    rec = AgentRegistry().ensure_default()
    assert (Path(rec.folder) / ".claude" / "skills" / importskill.NAME / "SKILL.md").is_file()
    assert "Leave out" in importskill.TEXT and "10 documents" in importskill.TEXT
