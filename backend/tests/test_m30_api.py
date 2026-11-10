"""M30 Task 9: the entities routes, the MCP tools and the skill (plan ``2026-11-09-m30-entity-extraction.md``,
Task 9; the Contract's "Routes" and "MCP" tables; design 2026-11-09 sections 5, 5a and 5b).

The six synthetic pages (`m30_helpers`) are imported into an IT ops space through ``create_app``;
the filing pass runs through M27's routes with the fake ``claude`` (``FAKE_CLAUDE_FILING`` from
`m30_helpers.decisions`), then the Entities step through the routes T9 adds.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fake_claude import install
from fastapi.testclient import TestClient
from m15_helpers import wait_job
from m30_helpers import decisions, itops_space, make_itops_source
from objectapp import importfiling, importskill, toolcatalog
from objectapp import settings as device_settings
from objectapp.agentrun import RunParts
from objectapp.importers import batches, filing, proposal
from objectapp.importers.jobs import Jobs
from objectapp.mcp_server import ObjectClient, build_server
from objectapp.server import create_app
from objectapp.space import Space

NOT_SOURCES = "This import didn't keep its pages as Sources."


@pytest.fixture
def fake(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = install(tmp_path / "bin")
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(tmp_path / "log.jsonl"))
    _d, rev = device_settings.read()
    device_settings.patch({"claudePath": str(path)}, rev)
    return path


@dataclass
class Env:
    root: Path
    src: Path
    tmp: Path
    client: TestClient
    monkeypatch: pytest.MonkeyPatch


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fake: Path):
    root = itops_space(tmp_path)
    src = make_itops_source(tmp_path)
    app = create_app(Space(root), watch=False)
    with TestClient(app) as client:
        yield Env(root, src, tmp_path, client, monkeypatch)


def _import(e: Env, *, keep: bool = True, src: Path | None = None) -> str:
    src = src or e.src
    r = e.client.post("/api/import/preview", json={"source": {"path": str(src)}, "target": "currentSpace",
                                                    "keepAsSources": keep})
    assert r.status_code == 200, r.text
    pv = r.json()
    r = e.client.post("/api/import/start", json={"previewId": pv["previewId"], "mapping": pv["mapping"],
                                                  "target": {"kind": "currentSpace"}, "keepAsSources": keep})
    assert r.status_code == 202, r.text
    job = wait_job(e.client, r.json()["jobId"])
    assert job["phase"] == "done", job
    return job["result"]["batch"]


def _decide(e: Env, batch: str) -> None:
    _data, items = batches.load_batch(e.root, batch)
    paths = {it["title"]: it["path"] for it in items if it.get("path") and not it.get("entity")}
    e.monkeypatch.setenv("FAKE_CLAUDE_FILING", json.dumps(decisions(paths)))


def _wait(e: Env, batch: str, states: set[str], timeout: float = 60) -> dict[str, Any]:
    end = time.monotonic() + timeout
    s: dict[str, Any] = {}
    while time.monotonic() < end:
        s = e.client.get(f"/api/import/batches/{batch}/filing").json()
        if s["state"] in states:
            return s
        time.sleep(0.05)
    raise AssertionError(s)


def _to_entities(e: Env, batch: str) -> None:
    """Trial (every page), marked right, then the bulk pass: the batch waits in ``entities``."""
    _decide(e, batch)
    assert e.client.post(f"/api/import/batches/{batch}/filing/start", json={"trial": True}).status_code == 200
    trial = _wait(e, batch, {"trial", "failed"})
    assert trial["state"] == "trial", trial
    for it in trial["trial"]["items"]:
        e.client.post(f"/api/import/batches/{batch}/filing/mark", json={"path": it["path"], "verdict": "right"})
    assert e.client.post(f"/api/import/batches/{batch}/filing/continue").status_code == 200
    assert _wait(e, batch, {"entities", "done", "failed"})["state"] == "entities"


def _accept_all(view: dict[str, Any]) -> dict[str, Any]:
    return {"decisions": {x["id"]: {"status": "accepted"} for x in view["entities"]}, "merges": [], "splits": []}


def _files(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*"))
            if p.is_file() and ".object-cache" not in p.parts}  # fmt: skip


def _token(e: Env, scope: str = "read") -> dict[str, str]:
    secret = e.client.post("/api/integrations/tokens", json={"name": f"agent-{scope}", "scope": scope}).json()["secret"]
    return {"Authorization": f"Bearer {secret}"}


def _mcp(e: Env, *, write: bool = True):
    secret = e.client.post("/api/integrations/tokens", json={"name": "mcp", "scope": "read-write"}).json()["secret"]
    server = build_server(ObjectClient("http://testserver", secret, e.client), write=write)

    def call(tool: str, **args: Any) -> Any:
        out = asyncio.run(server.call_tool(tool, args))
        assert not out.is_error, out
        return out.structured_content if out.structured_content is not None else json.loads(out.content[0].text)

    return server, call


# -- the routes --------------------------------------------------------------------------------


def test_entities_routes(env: Env) -> None:
    e = env
    batch = _import(e)
    _to_entities(e, batch)
    base = f"/api/import/batches/{batch}/entities"

    r = e.client.get(base)
    assert r.status_code == 200, r.text
    view = r.json()
    assert view["state"] == "review" and view["entities"] and view["sources"] == 6
    assert view["undecided"] == len(view["entities"]) and view["written"] is None

    r = e.client.put(f"{base}/review", json={"decisions": {"host:nope": {"status": "accepted"}}, "merges": [], "splits": []})
    assert r.status_code == 422, r.text
    r = e.client.put(f"{base}/review", json={"decisions": {view["entities"][0]["id"]: {"status": "maybe"}}})
    assert r.status_code == 422, r.text
    r = e.client.put(f"{base}/review", json={"decisions": {view["entities"][0]["id"]: {"status": "renamed", "name": " "}}})
    assert r.status_code == 422, r.text

    # Write is refused while entities are still to decide
    r = e.client.post(f"{base}/write", json={})
    assert r.status_code == 409 and r.json()["detail"] == f"{view['undecided']} entities are still to decide."

    r = e.client.put(f"{base}/review", json=_accept_all(view))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["ok"] is True and out["view"]["undecided"] == 0 and out["view"]["state"] == "review"
    assert all(x["decision"] == {"status": "accepted"} for x in out["view"]["entities"])

    r = e.client.post(f"{base}/write", json={})
    assert r.status_code == 202 and r.json() == {"ok": True}
    assert _wait(e, batch, {"done", "failed"})["state"] == "done"
    written = e.client.get(base).json()
    assert written["state"] == "written" and written["written"]["created"] >= 1

    r = e.client.post(f"{base}/write", json={})
    assert r.status_code == 409 and r.json()["detail"] == filing.WRITTEN_ALREADY
    r = e.client.put(f"{base}/review", json=_accept_all(view))
    assert r.status_code == 409 and r.json()["detail"] == filing.WRITTEN_ALREADY

    # an unknown batch
    for method, tail, body in (("GET", "", None), ("PUT", "/review", _accept_all(view)), ("POST", "/write", {})):
        r = e.client.request(method, f"/api/import/batches/nope/entities{tail}", json=body)
        assert r.status_code == 404, (method, tail, r.text)

    # a batch not kept as Sources
    other = e.tmp / "other"
    other.mkdir()
    plain = _import(e, keep=False, src=make_itops_source(other))
    assert batches.load_batch(e.root, plain)[0]["keepAsSources"] is False
    pbase = f"/api/import/batches/{plain}/entities"
    for method, tail, body in (("GET", "", None), ("PUT", "/review", _accept_all(view)), ("POST", "/write", {})):
        r = e.client.request(method, f"{pbase}{tail}", json=body)
        assert r.status_code == 409 and r.json()["detail"] == NOT_SOURCES, (method, tail, r.text)


def test_write_refused_while_import_runs(env: Env) -> None:
    e = env
    batch = _import(e)
    _to_entities(e, batch)
    view = e.client.get(f"/api/import/batches/{batch}/entities").json()
    assert e.client.put(f"/api/import/batches/{batch}/entities/review", json=_accept_all(view)).status_code == 200
    e.monkeypatch.setattr(Jobs, "running", lambda self: True)
    r = e.client.post(f"/api/import/batches/{batch}/entities/write", json={})
    assert r.status_code == 409 and r.json()["detail"] == "Another import is running."
    assert e.client.get(f"/api/import/batches/{batch}/filing").json()["state"] == "entities"


def test_reads_write_nothing(env: Env) -> None:
    e = env
    batch = _import(e)
    _to_entities(e, batch)
    before = _files(e.root)
    auth = _token(e)
    assert _files(e.root) == before  # the token store lives outside the space
    assert e.client.get(f"/api/import/batches/{batch}/entities").status_code == 200
    r = e.client.get("/api/v1/import/entities", params={"batch": batch}, headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "review" and r.json()["sources"] == 6
    assert e.client.get(f"/api/import/batches/{batch}/filing").status_code == 200
    assert _files(e.root) == before

    # the v1 read: 404 and 409 as the app's route, a token needed
    assert e.client.get("/api/v1/import/entities", params={"batch": "nope"}, headers=auth).status_code == 404
    draft = e.client.post("/api/import/batches", json={"path": str(e.src)}).json()["batch"]
    r = e.client.get("/api/v1/import/entities", params={"batch": draft}, headers=auth)
    assert r.status_code == 409 and r.json()["detail"] == NOT_SOURCES
    assert e.client.get("/api/v1/import/entities", params={"batch": batch}).status_code == 401


# -- MCP -------------------------------------------------------------------------------------


def test_mcp_start_import_keeps_sources_by_default(env: Env) -> None:
    e = env
    _server, call = _mcp(e)
    pv = call("import_preview", path=str(e.src))
    job = call("start_import", preview_id=pv["previewId"], target={"kind": "currentSpace"})["jobId"]
    done = wait_job(e.client, job)
    assert done["phase"] == "done", done
    assert batches.load_batch(e.root, done["result"]["batch"])[0]["keepAsSources"] is True

    other = e.tmp / "other"
    other.mkdir()
    pv = call("import_preview", path=str(make_itops_source(other)))
    job = call("start_import", preview_id=pv["previewId"], target={"kind": "currentSpace"},
               mapping={"typeSource": "none"}, keep_as_sources=False)["jobId"]
    done = wait_job(e.client, job)
    assert done["phase"] == "done", done
    assert batches.load_batch(e.root, done["result"]["batch"])[0]["keepAsSources"] is False


def test_mcp_import_preview_takes_the_target(env: Env) -> None:
    """A re-run into the open space, not kept as Sources: the preview plans for the open space (its
    types), as `start_import`'s target says, so the start finds every type it maps to."""
    e = env
    _server, call = _mcp(e)
    pv = call("import_preview", path=str(e.src))
    done = wait_job(e.client, call("start_import", preview_id=pv["previewId"], target={"kind": "currentSpace"})["jobId"])
    assert done["phase"] == "done", done

    pv = call("import_preview", path=str(e.src), keep_as_sources=False, target={"kind": "currentSpace"})
    job = call("start_import", preview_id=pv["previewId"], target={"kind": "currentSpace"}, keep_as_sources=False)
    done = wait_job(e.client, job["jobId"])
    assert done["phase"] == "done", done
    assert batches.load_batch(e.root, done["result"]["batch"])[0]["keepAsSources"] is False

    # the v1 route takes the target as start_import does ({"kind": ...}) or as its kind alone
    for target in ({"kind": "currentSpace"}, "currentSpace"):
        r = e.client.post("/api/v1/import/preview", headers=_token(e),
                          json={"path": str(e.src), "keepAsSources": False, "target": target})
        assert r.status_code == 200, r.text
    r = e.client.post("/api/v1/import/preview", headers=_token(e), json={"path": str(e.src), "target": {"kind": 1}})
    assert r.status_code == 200, r.text  # an unknown kind: a new space, as before


def test_mcp_import_entities_is_read_only(env: Env) -> None:
    e = env
    assert "import_entities" in toolcatalog.OBJECT_READ and "import_entities" not in toolcatalog.OBJECT_WRITE
    assert not [t for t in toolcatalog.OBJECT_WRITE if "entit" in t or "source" in t]
    server, call = _mcp(e)
    tools = {t.name: t for t in asyncio.run(server.list_tools())}
    assert tools["import_entities"].annotations.read_only_hint is True
    ro, _call = _mcp(e, write=False)
    assert "import_entities" in {t.name for t in asyncio.run(ro.list_tools())}

    batch = _import(e)
    view = call("import_entities", batch=batch)
    assert view["state"] == "collecting" and view["entities"] == [] and view["written"] is None
    with pytest.raises(Exception, match="No such import batch"):
        call("import_entities", batch="nope")

    parts = RunParts(allowed=[], mcp_servers={"object": {"args": []}})
    importfiling.filing_tools(SimpleNamespace(purpose=importfiling.PURPOSE), parts)
    assert "mcp__object__import_entities" not in parts.allowed
    assert "mcp__object__import_entities" in parts.disallowed


# -- the proposal's offer ------------------------------------------------------------------------


def test_proposal_offer_roundtrip(env: Env) -> None:
    e = env
    props = [{"name": "IP address", "kind": "text", "share": 1.0}, {"name": "FQDN", "kind": "text", "share": 0.9},
             {"name": "Operating system", "kind": "text", "share": 0.8}]
    batch = e.client.post("/api/import/batches", json={"path": str(e.src)}).json()["batch"]
    proposal.save_proposal(Space(e.root), batch, {"summary": "", "items": [
        {"id": "g1", "action": "create", "group": "Kiosk", "name": "Kiosk", "documents": 10,
         "examples": ["Wiki/Kiosk 1.md"], "properties": props}]})  # fmt: skip
    groups = e.client.get(f"/api/import/batches/{batch}/proposal").json()["proposal"]["groups"]
    assert groups[0]["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Kiosk"}

    r = e.client.put(f"/api/import/batches/{batch}/proposal/review",
                     json={"items": [{"id": "g1", "status": "edited", "edited": {"useType": "host", "category": "Kiosk"}}]})
    assert r.status_code == 200, r.text
    r = e.client.post(f"/api/import/batches/{batch}/proposal/apply")
    assert r.status_code == 200, r.text
    assert r.json()["created"] == [] and r.json()["extended"] == ["host"]
    options = [o["text"] for o in Space(e.root).type_by_id("host").prop("category").options["set"]]
    assert options[-1] == "Kiosk"


# -- the skill -----------------------------------------------------------------------------------


def test_skill_states_the_rules() -> None:
    text = importskill.TEXT
    for words in ("Keep pages as Sources", "exists on its own", "more than one page", "properties of its own",
                  "never entities", "read-only Sources", "newest Source wins", "Use", "with a category",
                  "import_entities(batch)", "an option of a type's Category, Kind or Environment"):
        assert words in text, words


def test_skill_states_the_order_for_both_kinds_of_batch() -> None:
    """The app's order: on a batch kept as Sources, Entities right after the bulk pass, then normalise,
    and no links pass; otherwise normalise, then links last."""
    text = importskill.TEXT
    bulk = text[text.index("## 6. Bulk pass"):text.index("## 7. Entities")]
    ents = text[text.index("## 7. Entities"):text.index("## 8. Report")]
    assert "On a batch not kept as Sources" in bulk and "Links between objects are filled last" in bulk
    assert "On a batch kept as Sources, nothing is filed and there is no links pass" in bulk
    assert "the Entities stage comes next, then normalise" in bulk
    assert "right after the bulk pass, before normalise" in ents
    assert ents.index("import_entities(batch)") < ents.index("merges near-duplicate tags and option values")
