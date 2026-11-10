"""M30 Task 8: the AI filing pass on a batch kept as Sources (plan ``2026-11-09-m30-entity-extraction.md``,
Task 8; Review Focus 1, 4 and 8; design 2026-11-09 sections 5 and 5a).

The six synthetic pages (`m30_helpers`) are imported into an IT ops space through ``create_app`` and
M25's routes; the pass runs through M27's routes with the fake ``claude`` (``FAKE_CLAUDE_FILING``
from `m30_helpers.decisions`), and the Entities step through the app's own `filing.Filing`.
"""

from __future__ import annotations

import copy
import json
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fake_claude import install
from fastapi.testclient import TestClient
from m15_helpers import wait_job
from m30_helpers import (
    MODIFIED,
    decisions,
    import_as_sources,
    itops_space,
    make_itops_source,
)
from objectapp import settings as device_settings
from objectapp.importers import batches, distill, entitywrite, filing, sources
from objectapp.server import create_app
from objectapp.space import Space

READ_ONLY = "Imported source"


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
    client: TestClient
    space: Space
    fil: filing.Filing
    monkeypatch: pytest.MonkeyPatch


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fake: Path):
    root = itops_space(tmp_path)
    src = make_itops_source(tmp_path)
    made: list[filing.Filing] = []
    init = filing.Filing.__init__

    def capture(self: filing.Filing, *args: Any, **kwargs: Any) -> None:
        init(self, *args, **kwargs)
        made.append(self)

    monkeypatch.setattr(filing.Filing, "__init__", capture)
    space = Space(root)
    app = create_app(space, watch=False)
    monkeypatch.setattr(filing.Filing, "__init__", init)
    assert len(made) == 1  # the app's own: the routes and these tests share its lock and worker
    with TestClient(app) as client:
        yield Env(root, src, client, space, made[0], monkeypatch)
        made[0].join()


def _import(e: Env, *, keep: bool = True, batch: str | None = None) -> str:
    r = e.client.post("/api/import/preview", json={"source": {"path": str(e.src)}, "target": "currentSpace",
                                                    "keepAsSources": keep})
    assert r.status_code == 200, r.text
    pv = r.json()
    body: dict[str, Any] = {"previewId": pv["previewId"], "mapping": pv["mapping"], "target": {"kind": "currentSpace"},
                            "keepAsSources": keep}  # fmt: skip
    if batch is not None:
        body["batch"] = batch
    r = e.client.post("/api/import/start", json=body)
    assert r.status_code == 202, r.text
    job = wait_job(e.client, r.json()["jobId"])
    assert job["phase"] == "done", job
    out = job["result"]["batch"]
    assert batches.load_batch(e.root, out)[0].get("keepAsSources") is keep
    return out


def _paths(e: Env, batch: str) -> dict[str, str]:
    """Page title -> its imported path (the pages only, not entities)."""
    _data, items = batches.load_batch(e.root, batch)
    return {it["title"]: it["path"] for it in items if it.get("path") and not it.get("entity")}


def _decide(e: Env, batch: str, edit: Callable[[str, dict[str, Any]], None] | None = None) -> dict[str, str]:
    """Set the fake claude's decisions for the batch's pages (``edit(title, decision)`` first); answers `_paths`."""
    paths = _paths(e, batch)
    by_path = {p: t for t, p in paths.items()}
    table = {}
    for p, d in decisions(paths).items():
        d = copy.deepcopy(d)
        if edit is not None:
            edit(by_path[p], d)
        table[p] = d
    e.monkeypatch.setenv("FAKE_CLAUDE_FILING", json.dumps(table))
    return paths


def _wait(e: Env, batch: str, states: set[str], timeout: float = 60) -> dict[str, Any]:
    """The status once in one of ``states``. Every wait here is for the end of a worker's run, so it
    joins the worker first: the status is read after its last save, never while it runs."""
    e.fil.join(timeout)
    end = time.monotonic() + timeout
    s: dict[str, Any] = {}
    while time.monotonic() < end:
        s = e.client.get(f"/api/import/batches/{batch}/filing").json()
        if s["state"] in states:
            return s
        time.sleep(0.05)
    raise AssertionError(s)


def _trial_and_bulk(e: Env, batch: str) -> dict[str, Any]:
    """Trial (every page), marked right, then continue: answers the trial's status."""
    assert e.client.post(f"/api/import/batches/{batch}/filing/start", json={"trial": True}).status_code == 200
    trial = _wait(e, batch, {"trial", "failed"})
    assert trial["state"] == "trial", trial
    for it in trial["trial"]["items"]:
        r = e.client.post(f"/api/import/batches/{batch}/filing/mark", json={"path": it["path"], "verdict": "right"})
        assert r.status_code == 200, r.text
    assert e.client.post(f"/api/import/batches/{batch}/filing/continue").status_code == 200
    s = _wait(e, batch, {"entities", "done", "failed"})
    assert s["state"] == "entities", s
    return trial


def _accept_all(e: Env, batch: str) -> dict[str, Any]:
    view = e.fil.entities_view(batch)
    review = {"decisions": {x["id"]: {"status": "accepted"} for x in view["entities"]}, "merges": [], "splits": []}
    return e.fil.save_entity_review(batch, review)


def _write(e: Env, batch: str) -> dict[str, Any]:
    e.fil.write_entities(batch)
    e.fil.join()
    s = _wait(e, batch, {"done", "failed"})
    assert s["state"] == "done", s
    return s


def _files(root: Path, *, skip: Path | None = None) -> dict[str, bytes]:
    out = {}
    for p in sorted(root.rglob("*")):
        if not p.is_file() or ".object-cache" in p.parts or (skip is not None and skip in p.parents):
            continue
        out[p.relative_to(root).as_posix()] = p.read_bytes()
    return out


def _md(root: Path, *, but: tuple[str, ...] = ()) -> dict[str, bytes]:
    """The space's ``.md`` files (not the batch records), but ``but``."""
    return {p: b for p, b in _files(root).items()
            if p.endswith(".md") and p not in but and not p.startswith(".object/imports/")}  # fmt: skip


def _report(e: Env, batch: str) -> str:
    return (batches.batch_dir(e.root, batch) / "report.md").read_text(encoding="utf-8")


def _of_type(e: Env, type_id: str, title: str) -> list[str]:
    return [s.path for s in e.space.list(type_id) if s.title == title]


def _counts(e: Env) -> dict[str, int]:
    out: dict[str, int] = {}
    for s in e.space.list():
        out[s.type] = out.get(s.type, 0) + 1
    return out


def _collections(e: Env, path: str) -> list[str]:
    return list(e.space.rows(None, None, [path], None, False)[0].values.get("collections") or [])


# -- the pass writes nothing -----------------------------------------------------------------------


def test_pass_and_trial_write_nothing(env: Env) -> None:
    e = env
    r = e.client.post("/api/import/batches", json={"path": str(e.src)})
    assert r.status_code == 200, r.text
    batch = r.json()["batch"]
    body = {"summary": "IT ops", "items": [
        {"id": f"u{i}", "action": "use", "group": name + "s", "name": name, "documents": 2, "properties": []}
        for i, name in enumerate(("Host", "Application", "Software", "Runbook"))]}  # fmt: skip
    from objectapp.importers import proposal

    proposal.save_proposal(e.space, batch, body)
    r = e.client.put(f"/api/import/batches/{batch}/proposal/review",
                     json={"items": [{"id": f"u{i}", "status": "accepted"} for i in range(4)]})
    assert r.status_code == 200, r.text
    assert e.client.post(f"/api/import/batches/{batch}/proposal/apply").status_code == 200
    assert _import(e, batch=batch) == batch
    paths = _decide(e, batch)
    folder = batches.batch_dir(e.root, batch)
    before = _files(e.root, skip=folder)
    types = {p: b for p, b in before.items() if p.startswith(".object/types/")}
    assert types

    trial = _trial_and_bulk(e, batch)
    items = {it["title"]: it for it in trial["trial"]["items"]}
    assert set(items) == set(paths)
    assert items["APP01"]["mainEntity"] == {"type": "Host", "name": "APP01"}
    assert {(x["type"], x["name"], x["ok"]) for x in items["APP01"]["entities"]} >= {
        ("Location", "HQ", True), ("Application", "Payroll", True), ("Software", "Windows Server 2019", True)}
    assert items["Rack notes"]["mainEntity"] is None
    s = e.client.get(f"/api/import/batches/{batch}/filing").json()
    assert s["state"] == "entities" and s["keepAsSources"] is True

    # reading the step and saving the review write only the batch's records too
    view = e.fil.entities_view(batch)
    assert view["state"] == "review" and view["sources"] == 6 and view["entities"]
    _accept_all(e, batch)
    assert _files(e.root, skip=folder) == before
    assert (folder / "filing.json").is_file() and (folder / "entities-review.json").is_file()
    stored = json.loads((folder / "filing.json").read_text(encoding="utf-8"))["results"]
    app01 = stored[paths["APP01"]]
    assert app01["mainEntity"]["name"] == "APP01" and app01["inbox"] is False
    assert not (folder / filing.INBOX_FILE).exists() or json.loads((folder / filing.INBOX_FILE).read_text()) == []


def test_prompt_lists_entity_types_on_a_source_batch(env: Env) -> None:
    e = env
    batch = _import(e)
    _decide(e, batch)
    e.client.post(f"/api/import/batches/{batch}/filing/start", json={"trial": True})
    _wait(e, batch, {"trial", "failed"})
    log = [json.loads(line) for line in (e.root.parent / "log.jsonl").read_text(encoding="utf-8").splitlines() if line]
    prompt = next(json.dumps(r) for r in log if filing.FILING_LINE in json.dumps(r))
    assert "Entity types (use these names exactly):" in prompt
    assert "- Host: " in prompt and "Runs on" in prompt and "Every page is kept as it is, as a read-only source." in prompt
    assert "- Source: " not in prompt.split("Entity types")[1]


# -- Write ---------------------------------------------------------------------------------------


def test_write_needs_every_entity_decided(env: Env) -> None:
    e = env
    batch = _import(e)
    paths = _decide(e, batch)
    as_imported = {p: (e.root / p).read_bytes() for p in paths.values()}
    _trial_and_bulk(e, batch)

    view = e.fil.entities_view(batch)
    n = view["undecided"]
    assert n == len(view["entities"]) > 0
    with pytest.raises(filing.NotAllowed, match=f"^{n} entities are still to decide.$"):
        e.fil.write_entities(batch)
    assert e.client.get(f"/api/import/batches/{batch}/filing").json()["state"] == "entities"

    _accept_all(e, batch)
    _write(e, batch)
    assert e.fil.entities_view(batch)["state"] == "written"
    report = _report(e, batch)
    assert "## AI filing" in report and "- Trial: 6 objects" in report
    assert "## Entities" in report
    assert "- Sources: 6 pages kept as Sources" in report
    written = e.fil.entities_view(batch)["written"]
    assert f"- Entities: {len(view['entities'])} accepted ({written['created']} created, 0 already in the space), " \
           f"0 turned down, {len(view['leftOut'])} not made into objects" in report
    assert f"- Links written: {written['relations']}; plain links: 1; to the Import inbox: 1" in report
    assert f"- From sources sections: {written['sections']} written, 0 left as they are (edited by you)" in report
    assert "### Sources disagree" in report
    assert "- APP01: IP address 10.0.0.5 (APP01) / 10.0.0.6 (Old APP01 notes); kept 10.0.0.5" in report
    rp = batches.load_batch(e.root, batch)[0]["reportPath"]
    page = (e.root / rp).read_text(encoding="utf-8")
    assert "## AI filing" in page and "### Sources disagree" in page
    assert {p: (e.root / p).read_bytes() for p in paths.values()} == as_imported

    # the created entities are the batch's items; the low-confidence link's subject is in the inbox
    _data, items = batches.load_batch(e.root, batch)
    made = [it for it in items if it.get("entity")]
    assert len(made) == written["created"] and all(it["action"] == "created" for it in made)
    inbox = json.loads((batches.batch_dir(e.root, batch) / filing.INBOX_FILE).read_text(encoding="utf-8"))
    runbook = _of_type(e, "runbook", "Restart Payroll")
    assert [r["path"] for r in inbox] == runbook
    assert inbox[0]["reason"] == "Link not written (low confidence): Restart Payroll Covers APP01"
    assert inbox[0]["suggestedType"] is None
    assert "Import inbox" in _collections(e, runbook[0])
    assert not any(_collections(e, p) for p in paths.values())


def test_status_never_reads_a_finished_pass_as_failed(env: Env) -> None:
    """The worker saves its last state and exits between the status' read of ``filing.json`` and its
    check of the thread: the status is the state read (``running``), never ``failed``. Deterministic:
    the read itself finishes the worker."""
    import threading

    e = env
    batch = _import(e)
    for final in ("entities", "done"):
        mode = "bulk" if final == "entities" else "entities"
        started = "running" if final == "entities" else "writing"
        rec = {"state": started, "mode": mode, "results": {}, "trialDone": True}
        e.fil._save(batch, rec)
        release = threading.Event()
        worker = threading.Thread(target=release.wait, daemon=True)
        worker.start()
        e.fil._thread = worker
        load = e.fil._load

        def racing(b: str, load: Callable[[str], dict[str, Any]] = load, release: threading.Event = release,
                   worker: threading.Thread = worker, final: str = final, mode: str = mode) -> dict[str, Any]:
            got = load(b)
            if not release.is_set():  # the worker saves its last state and exits right after this read
                e.fil._save(b, {**got, "state": final, "mode": mode})
                release.set()
                worker.join()
            return got

        e.monkeypatch.setattr(e.fil, "_load", racing)
        s = e.fil.status(batch)
        assert s["state"] == started and s["error"] is None, s
        e.monkeypatch.setattr(e.fil, "_load", load)
        assert e.fil.status(batch)["state"] == final

    e.fil._thread = None
    e.fil._save(batch, {"state": "running", "mode": "bulk", "results": {}})
    s = e.fil.status(batch)  # no thread runs it: interrupted
    assert s["state"] == "failed" and s["error"] == "The pass was interrupted.", s


def test_no_entities_still_finishes(env: Env) -> None:
    e = env
    batch = _import(e)
    paths = _paths(e, batch)
    e.monkeypatch.setenv("FAKE_CLAUDE_FILING", json.dumps({p: {"confidence": "high"} for p in paths.values()}))
    _trial_and_bulk(e, batch)
    view = e.fil.entities_view(batch)
    assert view["entities"] == [] and view["sources"] == 6 and view["undecided"] == 0
    rp = batches.load_batch(e.root, batch)[0]["reportPath"]
    before = _md(e.root, but=(rp,))
    types = {p: b for p, b in _files(e.root).items() if p.startswith(".object/types/")}
    _write(e, batch)
    assert _md(e.root, but=(rp,)) == before
    assert {p: b for p, b in _files(e.root).items() if p.startswith(".object/types/")} == types
    assert "- Entities: 0 accepted (0 created, 0 already in the space)" in _report(e, batch)
    assert "## Entities" in (e.root / rp).read_text(encoding="utf-8")


def test_batch_not_kept_as_sources_runs_as_m27(env: Env) -> None:
    e = env
    batch = _import(e, keep=False)
    paths = _paths(e, batch)

    def edit(title: str, d: dict[str, Any]) -> None:
        if title == "APP01":
            d.update(type="Host", values=[{"key": "fqdn", "value": "app01.corp.example", "quote": "FQDN: app01.corp.example"}])

    _decide(e, batch, edit)
    assert e.client.post(f"/api/import/batches/{batch}/filing/start", json={"trial": True}).status_code == 200
    trial = _wait(e, batch, {"trial", "failed"})
    assert trial["keepAsSources"] is False
    assert all("mainEntity" not in it and "entities" not in it for it in trial["trial"]["items"])
    assert e.client.post(f"/api/import/batches/{batch}/filing/continue").status_code == 200
    s = _wait(e, batch, {"done", "entities", "failed"})
    assert s["state"] == "done", s
    assert e.space.get(paths["APP01"]).type == "host"
    assert e.space.read(paths["APP01"])[1]["fqdn"] == "app01.corp.example"  # the page itself filed, as M27 does
    inbox = json.loads((batches.batch_dir(e.root, batch) / filing.INBOX_FILE).read_text(encoding="utf-8"))
    assert len(inbox) == 5  # the other pages: no approved type fits
    assert "## Entities" not in _report(e, batch) and "## AI filing" in _report(e, batch)
    for call in (lambda: e.fil.entities_view(batch), lambda: e.fil.write_entities(batch),
                 lambda: e.fil.save_entity_review(batch, {"decisions": {}})):  # fmt: skip
        with pytest.raises(filing.NotAllowed, match="didn't keep its pages as Sources"):
            call()
    with pytest.raises(KeyError):
        e.fil.entities_view("no-such-batch")


def test_rerun_not_kept_as_sources_leaves_its_sources_alone(env: Env) -> None:
    """A re-run that asks for ``keepAsSources: false`` keeps the pages Sources (call 6), so its M27
    pass may read none of them: none is eligible, the pass finishes, and no Source is written."""
    e = env
    _import(e, keep=True)
    (e.src / "Hosts" / "APP01.md").write_bytes(b"APP01 is the Payroll server at HQ. IP address: 10.0.0.9.\n")
    batch = _import(e, keep=False)
    paths = _paths(e, batch)
    assert {e.space.get(p).type for p in paths.values()} == {"source"}
    before = {p: (e.root / p).read_bytes() for p in paths.values()}
    assert e.fil.eligible(batch) == []

    def edit(title: str, d: dict[str, Any]) -> None:
        d.update(type="Host", tags=[{"value": "HQ", "quote": "at HQ"}])

    _decide(e, batch, edit)
    assert e.client.post(f"/api/import/batches/{batch}/filing/start", json={"trial": True}).status_code == 200
    e.fil.join()
    s = _wait(e, batch, {"trial", "failed", "done"})
    assert s["state"] == "trial" and s["error"] is None, s
    assert s["trial"]["items"] == []
    assert {p: (e.root / p).read_bytes() for p in paths.values()} == before
    assert not any(c.name == "Import inbox" for c in e.space.list_collections())
    # M27's apply never writes a Source, even one it is handed
    dec = {"path": paths["APP01"], "confidence": "high", "type": "Host",
           "tags": [{"value": "HQ", "quote": "at HQ"}], "values": []}  # fmt: skip
    res = filing.apply_decision(e.space, dec, allowed={paths["APP01"]}, type_names=None)
    assert res["rejected"] is True and res["inbox"] is False
    assert res["notes"] == [filing.SOURCE_NOT_FILED]
    assert {p: (e.root / p).read_bytes() for p in paths.values()} == before


# -- re-runs and the Trash -------------------------------------------------------------------------


def test_rerun_and_second_write_create_nothing_new(env: Env) -> None:
    e = env
    batch = _import(e)
    _decide(e, batch)
    _trial_and_bulk(e, batch)
    _accept_all(e, batch)
    _write(e, batch)
    with pytest.raises(filing.NotAllowed, match="written already"):
        e.fil.write_entities(batch)
    with pytest.raises(filing.NotAllowed, match="written already"):
        e.fil.save_entity_review(batch, {"decisions": {}})
    assert e.client.post(f"/api/import/batches/{batch}/filing/start", json={"trial": False}).status_code == 409

    counts = _counts(e)
    entities = [it["path"] for it in batches.load_batch(e.root, batch)[1] if it.get("entity")]
    before = {p: (e.root / p).read_bytes() for p in entities}
    old_notes = _paths(e, batch)["Old APP01 notes"]
    old_text = (e.root / old_notes).read_bytes()

    # the source changes one page (still the older one), and the agent says one more thing about APP01
    page = e.src / "Notes" / "Old APP01 notes.md"
    page.write_bytes(b"APP01 IP address: 10.0.0.6. Retired in 2025.\n")
    when = datetime.fromisoformat(MODIFIED["Notes/Old APP01 notes.md"]).replace(tzinfo=UTC).timestamp()
    os.utime(page, (when, when))
    batch2 = _import(e)
    _data2, items2 = batches.load_batch(e.root, batch2)
    assert {it["sourcePath"]: it["action"] for it in items2}["Notes/Old APP01 notes.md"] == "updated"
    assert json.loads((batches.batch_dir(e.root, batch2) / "removed.json").read_text(encoding="utf-8")) == []

    def edit(title: str, d: dict[str, Any]) -> None:
        if title == "Old APP01 notes":
            d["entities"][0]["lines"] = [{"text": "Retired in 2025.", "quote": "Retired in 2025"}]

    _decide(e, batch2, edit)
    assert e.client.post(f"/api/import/batches/{batch2}/filing/start", json={"trial": False}).status_code == 200
    assert _wait(e, batch2, {"entities", "done", "failed"})["state"] == "entities"
    view = e.fil.entities_view(batch2)
    assert view["entities"] and all(x["existing"] is not None for x in view["entities"])
    _accept_all(e, batch2)
    _write(e, batch2)
    kinds = ("host", "software", "application", "location", "runbook", "source")
    assert {k: _counts(e).get(k) for k in kinds} == {k: counts.get(k) for k in kinds}  # nothing new (but a report page)
    written = e.fil.entities_view(batch2)["written"]
    assert written["created"] == 0 and written["sections"] == 1

    app01 = _of_type(e, "host", "APP01")[0]
    for p, data in before.items():  # only the section citing the changed Source is rewritten
        if p != app01:
            assert (e.root / p).read_bytes() == data, p
    new = (e.root / app01).read_text(encoding="utf-8")
    old = before[app01].decode("utf-8")
    span_old, span_new = distill.find_section(old), distill.find_section(new)
    assert span_old is not None and span_new is not None
    assert "Retired in 2025." in new[span_new[0] : span_new[1]]
    assert old[span_old[1] :] == new[span_new[1] :]
    unstamped = [ln for ln in old[: span_old[0]].splitlines() if not ln.startswith("lastUpdated:")]
    assert unstamped == [ln for ln in new[: span_new[0]].splitlines() if not ln.startswith("lastUpdated:")]

    # the Source was updated by the re-run, its old text kept in version history
    versions = e.client.get("/api/history", params={"path": old_notes}).json()["versions"]
    texts = [e.client.get("/api/history/version", params={"path": old_notes, "id": v["id"]}).json().get("text")
             for v in versions]  # fmt: skip
    assert old_text.decode("utf-8") in texts
    assert e.space.get(old_notes).readOnlyReason == READ_ONLY


def test_rerun_lists_no_created_entity_as_removed_at_source(tmp_path: Path) -> None:
    """A re-run of a source never lists an entity a Write made as "removed at source" (writer.py)."""
    root = itops_space(tmp_path)
    src = make_itops_source(tmp_path)
    batch = import_as_sources(root, src)
    ident = "entity:software:sql server 2019"
    (root / "Software").mkdir(exist_ok=True)
    rel = "Software/SQL Server 2019.md"
    (root / rel).write_text(f"---\ntype: Software\nimportSource:\n  system: markdown\n  id: '{ident}'\n"
                            f"  batch: {batch}\n---\n", encoding="utf-8")  # fmt: skip
    folder = batches.batch_dir(root, batch)
    items = json.loads((folder / "items.json").read_text(encoding="utf-8"))
    items.append({"sourcePath": ident, "system": "markdown", "id": ident, "title": "SQL Server 2019", "path": rel,
                  "action": "created", "entity": True})  # fmt: skip
    batches.write_json(folder / "items.json", items)
    batch2 = import_as_sources(root, src)
    assert json.loads((batches.batch_dir(root, batch2) / "removed.json").read_text(encoding="utf-8")) == []
    assert (root / rel).is_file()


def test_trash_batch_takes_sources_and_created_entities_only(env: Env) -> None:
    e = env
    gene, _v = e.space.create_object("host", "app01", template_id="none", values={"ipAddress": "10.9.9.9"},
                                     body="My notes.\n")  # fmt: skip
    batch = _import(e)
    paths = _decide(e, batch)
    as_imported = {p: (e.root / p).read_bytes() for p in paths.values()}
    _trial_and_bulk(e, batch)
    _accept_all(e, batch)
    _write(e, batch)
    software = _of_type(e, "software", "SQL Server 2019")
    location = _of_type(e, "location", "HQ")
    assert len(software) == 1 and len(location) == 1
    assert e.fil.entities_view(batch)["written"]["existing"] == 1  # Gene's app01

    out = batches.trash_batch(e.space, batch)
    assert out["missing"] == 0
    for p in [*paths.values(), software[0], location[0]]:
        assert not (e.root / p).exists(), p
    assert (e.root / gene).is_file()
    trash = {t.originalPath: t for t in e.space.list_trash() if t.kind == "object"}
    assert set(paths.values()) | {software[0], location[0]} <= set(trash)
    assert gene not in trash

    source = paths["SRV-DB01"]
    for p in (software[0], source):
        e.space.restore(trash[p].id)
    assert (e.root / software[0]).is_file()
    assert (e.root / source).read_bytes() == as_imported[source]
    assert e.space.get(source).readOnlyReason == READ_ONLY


def test_low_confidence_page_keeps_its_source_out_of_the_inbox(env: Env) -> None:
    e = env
    batch = _import(e)

    def edit(title: str, d: dict[str, Any]) -> None:
        if title == "APP01":
            d["confidence"] = "low"

    paths = _decide(e, batch, edit)
    _trial_and_bulk(e, batch)
    stored = json.loads((batches.batch_dir(e.root, batch) / "filing.json").read_text(encoding="utf-8"))["results"]
    r = stored[paths["APP01"]]
    assert r["confidence"] == "low" and r["inbox"] is False and "Low confidence." in r["notes"]
    assert all(rel["confidence"] == "low" for rel in r["relations"])
    _accept_all(e, batch)
    _write(e, batch)
    assert not _collections(e, paths["APP01"])
    assert not any(_collections(e, p) for p in paths.values())
    host = _of_type(e, "host", "APP01")
    assert len(host) == 1 and host[0] != paths["APP01"]
    assert "Import inbox" in _collections(e, host[0])
    inbox = json.loads((batches.batch_dir(e.root, batch) / filing.INBOX_FILE).read_text(encoding="utf-8"))
    assert {"path": host[0], "title": "APP01", "reason": "Link not written (low confidence): APP01 Located at HQ",
            "suggestedType": None} in inbox  # fmt: skip
    assert not any(row["path"] in paths.values() for row in inbox)
    assert e.space.get(paths["APP01"]).type == sources.SOURCE_TYPE_ID


def test_failed_write_can_run_again(env: Env) -> None:
    e = env
    batch = _import(e)
    _decide(e, batch)
    _trial_and_bulk(e, batch)
    _accept_all(e, batch)
    real = entitywrite.write_entities

    def boom(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise OSError("disk full")

    e.monkeypatch.setattr(entitywrite, "write_entities", boom)
    e.fil.write_entities(batch)
    e.fil.join()
    s = _wait(e, batch, {"failed", "done"})
    assert s["state"] == "failed" and "disk full" in s["error"]
    e.monkeypatch.setattr(entitywrite, "write_entities", real)
    _write(e, batch)
    assert e.fil.entities_view(batch)["written"]["created"] > 0
