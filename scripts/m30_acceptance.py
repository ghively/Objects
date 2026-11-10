"""Milestone 30 acceptance, back end (entity extraction and distillation).

Usage: ``uv run python scripts/m30_acceptance.py [SPACE] [--keep]``
(default SPACE: ``backend/tests/fixtures/space-sample``)

Copies SPACE to a temporary folder (SPACE itself is never touched: its hash is compared before
and after), applies M28's IT ops setup, adds Gene's own Host "app01" (``ipAddress: 10.9.9.9``,
body "My notes.") and a page outside the import that mentions APP01, and writes the synthetic
source (`m30_helpers.make_itops_source`: APP01, SRV-DB01, Payroll, Restart Payroll, Rack notes,
Old APP01 notes; one more synthetic sentence in Rack notes, "SRV DB01 sits in it too.", so the
entity list has a suggested merge). ``OBJECT_STATE_DIR`` and ``OBJECT_CACHE_DIR`` point at
temporary folders and everything runs through ``create_app`` and the fake ``claude``
(``FAKE_CLAUDE_FILING`` from `m30_helpers.decisions`). No real data, no network, no real agent.

 1. a plain import (``keepAsSources: false``) into a scratch copy files the pages into their
    mapped types; a start without the field keeps them as Sources (the default is on);
 2. draft batch and scan; the proposal (use Host, Application, Software, Runbook; create
    "Server" with Host's properties: its problem and the offer "Use Host, with a category");
    review; Apply leaves "Server" out and writes no type;
 3. the import with ``keepAsSources: true``: six Sources, read-only "Imported source", each
    file's version recorded in the batch;
 4. trial (6 pages, each with its main entity and mentions), marks, continue: the batch waits
    in ``entities``; nothing outside the batch's records changed;
 5. the Entities view (SQL 2019 and SQL Server 2019 one entity; Server and VM categories; Rack 4
    text; APP01 from four Sources with the IP conflict, Gene's app01 found; ``sources: 6``);
    ``GET`` (the app's and ``/api/v1``) writes nothing;
 6. the review: merge the suggested pair, split SQL 2019 off, accept, rename one, turn one down;
    Write is refused while entities are undecided and while another import runs; Write -> done;
 7. after Write: Sources byte-identical and read-only; created entities and their provenance;
    Gene's app01 reused (his IP and notes kept, "From sources" on top citing Sources as links,
    the IP conflict listed); Sources relation and "Distilled into"; Payroll "Runs on" APP01 and
    APP01's "Runs"; "backs up to" a plain link; unlinked mentions (a Source's and a page's);
    the Import inbox; the report;
 8. a re-run with one changed page: its Source updated (old text in version history), only the
    section citing it rewritten, nothing new created;
 9. Move batch to Trash: the Sources and the created entities, not Gene's object; Restore;
10. the fixture folder is unchanged.

Each check prints ``[ok]`` or ``[FAIL]``; ends with ``RESULT: PASS`` or exits non-zero.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))
sys.path.insert(0, str(REPO / "backend" / "tests"))
sys.path.insert(0, str(REPO / "scripts"))

from m2_acceptance import Run, remove_tree, snapshot

DEFAULT_SPACE = REPO / "backend" / "tests" / "fixtures" / "space-sample"
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "FAKE_CLAUDE_FILING")
READ_ONLY = "Imported source"
OFFER = "Use Host, with a category"
LOOKALIKE = "It has the same properties as Host."
GENE = "Hosts/app01.md"
OPS_LOG = "Pages/Ops log.md"
RACK_EXTRA = "Rack 4 at HQ holds a Server and a VM. SRV DB01 sits in it too."
RENAMED = "Microsoft SQL Server 2019"
HOST_PROPS = [
    *({"name": n, "kind": k, "share": 1.0} for n, k in (
        ("IP address", "text"), ("FQDN", "text"), ("Last boot", "datetime"), ("Disk free", "number"),
        ("Reboot pending", "boolean"), ("Last seen", "datetime"))),
    *({"name": n, "kind": "label", "share": 1.0, "options": ["X"]}
      for n in ("Category", "Roles", "Department", "Environment", "Patch state")),
    *({"name": n, "kind": "entity", "target": t, "share": 1.0} for n, t in (
        ("Operating system", "Software"), ("Located at", "Location"), ("Network", "Network"), ("Owned by", "Person"))),
]
"""Every specific property of Host, by name and kind (M31 fix pass: a look-alike shares most of both
types' specific properties)."""


# -- plumbing ------------------------------------------------------------------------------


class ClientHttp:
    """`m2_acceptance.Run`'s ``http`` over a ``TestClient`` (routes under ``/api``)."""

    def __init__(self, client: Any) -> None:
        self.client = client

    def __call__(self, method: str, route: str, payload: Any = None, **query: Any) -> tuple[int, Any]:
        q = {k: v for k, v in query.items() if v is not None}
        r = self.client.request(method, "/api" + route, params=q or None, json=payload)
        try:
            return r.status_code, r.json()
        except ValueError:
            return r.status_code, r.text


def outside(snap: dict[str, bytes], folder: str) -> dict[str, bytes]:
    """``snap`` without the files under ``folder`` (a batch's records)."""
    return {p: b for p, b in snap.items() if not p.startswith(folder + "/")}


def set_mtime(path: Path, day: str) -> None:
    when = datetime.fromisoformat(day).replace(tzinfo=UTC).timestamp()
    os.utime(path, (when, when))


def section_of(body: str) -> str | None:
    from objectapp.importers import distill

    try:
        span = distill.find_section(body)
    except distill.SectionEdited:
        return None
    return body[span[0] : span[1]] if span else None


def links_in(text: str) -> list[str]:
    """The ``[[target|label]]`` / ``[[target]]`` links of ``text``, as written."""
    out, i = [], 0
    while (start := text.find("[[", i)) != -1:
        end = text.find("]]", start)
        if end == -1:
            break
        out.append(text[start : end + 2])
        i = end + 2
    return out


def target_of(link: str) -> str:
    return link.removeprefix("[[").removesuffix("]]").split("|", 1)[0]


# -- the run -------------------------------------------------------------------------------


class M30:
    def __init__(self, root: Path, src: Path, tmp: Path, run: Run, client: Any) -> None:
        self.root, self.src, self.tmp, self.run, self.client = root, src, tmp, run, client
        self.http = run.http
        self.batch = ""
        self.paths: dict[str, str] = {}  # page title -> its Source's path
        self.items: dict[str, dict] = {}  # Source path -> its item in the batch
        self.view: dict = {}
        self.ids: dict[str, str] = {}  # entity name -> id, after the review
        self.created: dict[str, str] = {}  # entity name -> path, made by the Write
        self.auth: dict[str, str] = {}

    # helpers ------------------------------------------------------------------------------
    def wait(self, batch: str, states: set[str], timeout: float = 90) -> dict:
        end = time.monotonic() + timeout
        s: dict = {}
        while time.monotonic() < end:
            s = self.client.get(f"/api/import/batches/{batch}/filing").json()
            if s.get("state") in states:
                return s
            time.sleep(0.05)
        raise SystemExit(f"the filing pass did not reach {states}: {s}")

    def start_import(self, client: Any, keep: bool | None, batch: str | None = None) -> tuple[str, dict]:
        """Preview and import ``self.src`` (``keepAsSources`` left out when ``keep`` is None)."""
        extra = {} if keep is None else {"keepAsSources": keep}
        r = client.post("/api/import/preview", json={"source": {"path": str(self.src)}, "target": "currentSpace", **extra})
        assert r.status_code == 200, r.text
        pv = r.json()
        body = {"previewId": pv["previewId"], "mapping": pv["mapping"], "target": {"kind": "currentSpace"}, **extra}
        if batch:
            body["batch"] = batch
        r = client.post("/api/import/start", json=body)
        assert r.status_code == 202, r.text
        end = time.monotonic() + 60
        while (job := client.get(f"/api/import/jobs/{r.json()['jobId']}").json())["phase"] not in ("done", "failed"):
            if time.monotonic() > end:
                raise SystemExit("the import job timed out")
            time.sleep(0.02)
        return (job.get("result") or {}).get("batch", ""), job

    def table(self, paths: dict[str, str], edit: Any = None) -> None:
        """Set the fake claude's decisions for the pages at ``paths`` (title -> path)."""
        from m30_helpers import decisions

        by_path = {p: t for t, p in paths.items()}
        table = {}
        for p, d in decisions(paths).items():
            d = copy.deepcopy(d)
            if by_path[p] == "Rack notes":  # the extra synthetic sentence's mention
                d["entities"].append({"type": "Host", "name": "SRV DB01", "aliases": [], "values": [], "lines": []})
            if edit is not None:
                edit(by_path[p], d)
            table[p] = d
        os.environ["FAKE_CLAUDE_FILING"] = json.dumps(table)

    def rows(self, *paths: str) -> dict[str, dict]:
        code, res = self.http("POST", "/rows", {"paths": list(paths), "preview": False})
        assert code == 200, res
        return {r["summary"]["path"]: r["values"] for r in res["rows"]}

    def counterpart(self, path: str, name: str) -> set[str]:
        return {p for r in self.run.obj(path).get("counterparts") or [] if r["name"] == name for p in r["paths"]}

    def entities(self, batch: str | None = None) -> tuple[int, dict]:
        return self.http("GET", f"/import/batches/{batch or self.batch}/entities")

    def by_name(self, view: dict) -> dict[str, dict]:
        return {e["name"]: e for e in view["entities"]}

    # 1 ------------------------------------------------------------------------------------
    def plain_import(self, scratch: Path, default: Path) -> None:
        print("\n1. Keep pages as Sources: off when asked, on by default")
        from fastapi.testclient import TestClient

        from objectapp.importers import batches
        from objectapp.server import create_app
        from objectapp.space import Space

        with TestClient(create_app(Space(scratch), watch=False)) as c:
            batch, job = self.start_import(c, False)
            data, items = batches.load_batch(scratch, batch) if batch else ({}, [])
            objs = {o["path"]: o for o in c.get("/api/objects").json()}
            made = [it["path"] for it in items if it.get("path")]
            types = sorted({objs[p]["type"] for p in made if p in objs})
            self.run.report(
                job["phase"] == "done" and data.get("keepAsSources") is False and len(made) == 6
                and "source" not in types and not any(p.startswith("Sources/") for p in made),
                "a plain import sent with keepAsSources: false files the six pages into their mapped types",
                f"{job['phase']}; keepAsSources {data.get('keepAsSources')!r}; {len(made)} pages; types {types}",
            )
        with TestClient(create_app(Space(default), watch=False)) as c:
            batch, job = self.start_import(c, None)
            data, items = batches.load_batch(default, batch) if batch else ({}, [])
            objs = {o["path"]: o for o in c.get("/api/objects").json()}
            types = sorted({objs[it["path"]]["type"] for it in items if it.get("path") in objs})
            self.run.report(
                job["phase"] == "done" and data.get("keepAsSources") is True and types == ["source"],
                "a start that leaves keepAsSources out keeps every page as a Source (the default is on)",
                f"{job['phase']}; keepAsSources {data.get('keepAsSources')!r}; types {types}",
            )

    # 2 ------------------------------------------------------------------------------------
    def proposal(self) -> None:
        print("\n2. Draft batch, scan and the schema proposal")
        code, res = self.http("POST", "/import/batches", {"path": str(self.src)})
        if not self.run.report(code == 200, "POST /api/import/batches makes a draft batch with its scan", f"{code} {res}"):
            raise SystemExit("no draft batch")
        self.batch = res["batch"]
        self.run.report(res["scan"].get("findings") == {}, "the scan finds nothing sensitive", f"{res['scan'].get('findings')}")

        r = self.client.post("/api/integrations/tokens", json={"name": "M30 agent", "scope": "read-write"})
        self.auth = {"Authorization": f"Bearer {r.json()['secret']}"}
        items = [{"id": f"u{i}", "action": "use", "group": plural, "name": name, "documents": 1, "properties": []}
                 for i, (name, plural) in enumerate((("Host", "Hosts"), ("Application", "Apps"),
                                                     ("Software", "Software"), ("Runbook", "Runbooks")))]  # fmt: skip
        items.append({"id": "g1", "action": "create", "group": "Server", "name": "Server", "documents": 10,
                      "examples": ["Hosts/APP01.md"], "properties": HOST_PROPS})  # fmt: skip
        types_before = {p: b for p, b in snapshot(self.root).items() if p.startswith(".object/types/")}
        r = self.client.post("/api/v1/import/proposal", headers=self.auth,
                             json={"batch": self.batch, "proposal": {"summary": "IT ops pages", "items": items}})
        self.run.report(r.status_code == 200, "the agent saves the proposal over /api/v1", f"{r.status_code} {r.text[:200]}")
        code, view = self.http("GET", f"/import/batches/{self.batch}/proposal")
        groups = {g["id"]: g for g in view["proposal"]["groups"]} if code == 200 else {}
        server = groups.get("g1", {})
        offer = server.get("offer") or {}
        self.run.report(
            LOOKALIKE in (server.get("problems") or []) and offer.get("label") == OFFER
            and offer.get("typeId") == "host" and offer.get("category") == "Server",
            f'create "Server" with Host\'s properties shows "{LOOKALIKE}" and offers "{OFFER}"',
            f"problems {server.get('problems')}; offer {offer}",
        )
        self.run.report(all(not groups.get(f"u{i}", {}).get("problems") for i in range(4)),
                        "using Host, Application, Software and Runbook raises no problem")
        code, _ = self.http("PUT", f"/import/batches/{self.batch}/proposal/review",
                            {"items": [{"id": i["id"], "status": "accepted"} for i in items]})
        code2, out = self.http("POST", f"/import/batches/{self.batch}/proposal/apply")
        types_after = {p: b for p, b in snapshot(self.root).items() if p.startswith(".object/types/")}
        skipped = [s.get("id") for s in out.get("skipped", [])] if code2 == 200 else []
        self.run.report(
            code == 200 and code2 == 200 and out["created"] == [] and out["extended"] == [] and skipped == ["g1"]
            and types_after == types_before,
            'Apply leaves "Server" out and writes no type',
            f"{code}/{code2}; created {out.get('created')}; extended {out.get('extended')}; skipped {skipped}; "
            f"type files changed: {sorted(set(types_after.items()) ^ set(types_before.items()))[:3]}",
        )

    # 3 ------------------------------------------------------------------------------------
    def source_import(self) -> None:
        print("\n3. The import with Keep pages as Sources")
        from objectapp.importers import batches
        from objectapp.space import version_of

        batch, job = self.start_import(self.client, True, batch=self.batch)
        data, items = batches.load_batch(self.root, self.batch)
        made = [it for it in items if it.get("path")]
        self.items = {it["path"]: it for it in made}
        self.paths = {it["title"]: it["path"] for it in made}
        self.run.report(job["phase"] == "done" and batch == self.batch and data.get("keepAsSources") is True,
                        "the import adopts the draft batch and records keepAsSources: true",
                        f"{job['phase']}; batch {batch}; keepAsSources {data.get('keepAsSources')!r}")
        bad = []
        for p, it in self.items.items():
            s = self.run.obj(p)["summary"]
            if s["type"] != "source" or not s.get("readOnly") or s.get("readOnlyReason") != READ_ONLY:
                bad.append(f"{p}: {s['type']} {s.get('readOnly')} {s.get('readOnlyReason')}")
            if version_of((self.root / p).read_bytes()) != it.get("version"):
                bad.append(f"{p}: version not as recorded")
        self.run.report(len(self.items) == 6 and all(p.startswith("Sources/") for p in self.items) and not bad,
                        f'six Sources in Sources/, read-only "{READ_ONLY}", each version recorded',
                        f"{sorted(self.items)}", *bad)
        srv = self.paths.get("SRV-DB01", "")
        raw = (self.root / srv).read_bytes() if srv else b""
        self.run.report(raw.startswith(b"\xef\xbb\xbf") and b"\r\n" in raw.split(b"---", 2)[-1],
                        "the CRLF + BOM page is kept with its CRLF and BOM")

    # 4 ------------------------------------------------------------------------------------
    def trial_and_bulk(self) -> None:
        print("\n4. Trial, marks and the bulk pass")
        folder = f".object/imports/{self.batch}"
        before = outside(snapshot(self.root), folder)
        self.table(self.paths)
        code, _ = self.http("POST", f"/import/batches/{self.batch}/filing/start", {"trial": True})
        s = self.wait(self.batch, {"trial", "failed"})
        items = {it["title"]: it for it in s["trial"]["items"]}
        app01 = items.get("APP01", {})
        mentions = {(e["type"], e["name"]) for e in app01.get("entities") or [] if e["ok"]}
        self.run.report(
            code == 200 and s["state"] == "trial" and set(items) == set(self.paths)
            and app01.get("mainEntity") == {"type": "Host", "name": "APP01"}
            and {("Location", "HQ"), ("Application", "Payroll")} <= mentions
            and items.get("Rack notes", {}).get("mainEntity", "x") is None and s.get("keepAsSources") is True,
            "the trial covers the 6 pages, each with its main entity and mentions",
            f"{s['state']}; {sorted(items)}; APP01 about {app01.get('mainEntity')}, mentions {sorted(mentions)}",
        )
        for it in s["trial"]["items"]:
            self.http("POST", f"/import/batches/{self.batch}/filing/mark", {"path": it["path"], "verdict": "right"})
        code, _ = self.http("POST", f"/import/batches/{self.batch}/filing/continue")
        s = self.wait(self.batch, {"entities", "done", "failed"})
        self.run.report(code == 200 and s["state"] == "entities", "after Continue the batch waits in the entities state",
                        f"{code} {s['state']} {s.get('error') or ''}")
        after = outside(snapshot(self.root), folder)
        changed = sorted(k for k in before.keys() | after.keys() if before.get(k) != after.get(k))
        self.run.report(not changed, "the trial and the bulk pass changed nothing outside the batch's records",
                        *(f"changed: {p}" for p in changed))

    # 5 ------------------------------------------------------------------------------------
    def entities_view(self) -> None:
        print("\n5. The Entities step")
        before = snapshot(self.root)
        code, view = self.entities()
        r = self.client.get("/api/v1/import/entities", params={"batch": self.batch}, headers=self.auth)
        after = snapshot(self.root)
        changed = sorted(k for k in before.keys() | after.keys() if before.get(k) != after.get(k))
        self.run.report(code == 200 and r.status_code == 200 and r.json() == view and not changed,
                        "GET of the entities view (app and /api/v1) writes nothing",
                        f"{code} {r.status_code}", *(f"changed: {p}" for p in changed))
        if code != 200:
            raise SystemExit("no entities view")
        self.view = view
        names = self.by_name(view)
        left = {e["name"]: e["reason"] for e in view["leftOut"]}
        sql = names.get("SQL Server 2019", {})
        self.run.report(view["state"] == "review" and view["sources"] == 6, "the view is in review with sources: 6",
                        f"{view['state']} {view['sources']}")
        self.run.report(sql.get("aliases") == ["SQL 2019"] and "SQL 2019" not in names and sql.get("joinedByAgent") is True,
                        "SQL 2019 and SQL Server 2019 are one entity (merged by the agent)",
                        f"{sql.get('name')} {sql.get('aliases')} {sql.get('joinedByAgent')}")
        self.run.report(left.get("Server") == "category" and left.get("VM") == "category" and left.get("Rack 4") == "text"
                        and "Server" not in names and "VM" not in names,
                        'the categories "Server" and "VM" and the one-off "Rack 4" are not made into objects', f"{left}")
        app01 = names.get("APP01", {})
        pages = {p["title"] for p in app01.get("pages") or []}
        ip = next((v for v in app01.get("values") or [] if v["key"] == "ipAddress"), {})
        others = [c["value"] for c in ip.get("conflict") or []]
        self.run.report(
            pages == {"APP01", "Payroll", "Restart Payroll", "Old APP01 notes"} and ip.get("value") == "10.0.0.5"
            and others == ["10.0.0.6"] and (app01.get("existing") or {}).get("path") == GENE and view["conflicts"] == 1,
            "APP01 is distilled from four Sources, 10.0.0.5 kept over 10.0.0.6, Gene's app01 found",
            f"pages {sorted(pages)}; ip {ip.get('value')} vs {others}; existing {app01.get('existing')}",
        )
        sugg = view["suggestedMerges"]
        self.run.report([s["names"] for s in sugg] == [["SRV-DB01", "SRV DB01"]],
                        "SRV-DB01 and SRV DB01 are suggested as the same thing", f"{sugg}")

    # 6 ------------------------------------------------------------------------------------
    def review_and_write(self) -> None:
        print("\n6. The review and Write")
        from objectapp.importers.jobs import Jobs

        base = f"/import/batches/{self.batch}/entities"
        sql_id = self.by_name(self.view)["SQL Server 2019"]["id"]
        ops = {"merges": [self.view["suggestedMerges"][0]["ids"]], "splits": [{"id": sql_id, "names": ["SQL 2019"]}]}
        code, out = self.http("PUT", f"{base}/review", {"decisions": {"host:app01": {"status": "accepted"}}, **ops})
        view = out.get("view", {}) if code == 200 else {}
        names = self.by_name(view) if view else {}
        left = {e["name"] for e in view.get("leftOut", [])}
        srv = names.get("SRV-DB01", {})
        self.run.report(
            code == 200 and srv.get("aliases") == ["SRV DB01"] and len(srv.get("pages") or []) == 3
            and "SQL 2019" in left and names.get("SQL Server 2019", {}).get("aliases") == []
            and view.get("undecided") == len(view.get("entities", [])) - 1,
            "the suggested merge joins SRV DB01 into SRV-DB01; Split moves SQL 2019 out",
            f"{code}; SRV-DB01 {srv.get('aliases')} {len(srv.get('pages') or [])} pages; left out {sorted(left)}; "
            f"undecided {view.get('undecided')}",
        )
        n = view.get("undecided")
        code, res = self.http("POST", f"{base}/write", {})
        self.run.report(code == 409 and res.get("detail") == f"{n} entities are still to decide.",
                        "Write is refused while entities are still to decide", f"{code} {res}")

        decisions: dict[str, dict] = {}
        for name, e in names.items():
            if name == "SQL Server 2019":
                decisions[e["id"]] = {"status": "renamed", "name": RENAMED}
            elif name == "HQ":
                decisions[e["id"]] = {"status": "rejected"}
            else:
                decisions[e["id"]] = {"status": "accepted"}
        code, out = self.http("PUT", f"{base}/review", {"decisions": decisions, **ops})
        code2, again = self.entities()
        kept = {e["id"]: e["decision"] for e in again.get("entities", [])} if code2 == 200 else {}
        self.run.report(code == 200 and out["view"]["undecided"] == 0 and kept == decisions,
                        "accept, rename and turn down decide the rest; the review survives a reopen",
                        f"{code}; undecided {out.get('view', {}).get('undecided')}; reread {kept == decisions}")
        self.view = again
        self.ids = {n: e["id"] for n, e in self.by_name(again).items()}

        real = Jobs.running
        Jobs.running = lambda self: True  # type: ignore[method-assign]
        try:
            code, res = self.http("POST", f"{base}/write", {})
        finally:
            Jobs.running = real  # type: ignore[method-assign]
        state = self.client.get(f"/api/import/batches/{self.batch}/filing").json()["state"]
        self.run.report(code == 409 and res.get("detail") == "Another import is running." and state == "entities",
                        "Write is refused (409) while another import runs", f"{code} {res} {state}")

        code, res = self.http("POST", f"{base}/write", {})
        s = self.wait(self.batch, {"done", "failed"})
        code2, view = self.entities()
        w = view.get("written") or {}
        self.run.report(
            code == 202 and s["state"] == "done" and view.get("state") == "written"
            and w.get("created") == 4 and w.get("existing") == 1 and not w.get("failed"),
            "Write finishes: 4 entities created, 1 already in the space",
            f"{code} {s['state']} {s.get('error') or ''}; {w}",
        )

    # 7 ------------------------------------------------------------------------------------
    def after_write(self) -> None:
        print("\n7. After Write")
        from objectapp.importers import batches
        from objectapp.space import version_of

        # the Sources
        bad = [p for p, it in self.items.items() if version_of((self.root / p).read_bytes()) != it["version"]]
        self.run.report(not bad, "every Source is byte-identical to its recorded version", *bad)
        app01_src = self.paths["APP01"]
        version = self.run.obj(app01_src)["version"]
        code, res = self.http("PUT", "/object/properties",
                              {"path": app01_src, "updates": {"category": "Document"}, "baseVersion": version})
        self.run.report(code == 423 and isinstance(res, dict) and res.get("reason") == READ_ONLY,
                        f'a property edit on a Source answers "{READ_ONLY}"', f"{code} {res}")

        # the created entities
        _data, items = batches.load_batch(self.root, self.batch)
        made = {it["title"]: it for it in items if it.get("entity")}
        want = {"Payroll": "application", "SRV-DB01": "host", "Restart Payroll": "runbook", RENAMED: "software"}
        bad = []
        for title, type_id in want.items():
            it = made.get(title)
            if it is None or it.get("action") != "created":
                bad.append(f"{title}: no created item")
                continue
            o = self.run.obj(it["path"])
            block = o["frontmatter"].get("importSource") or {}
            if o["summary"]["type"] != type_id or block.get("id") != it["id"] or block.get("batch") != self.batch \
                    or not str(block.get("id")).startswith(f"entity:{type_id}:"):  # fmt: skip
                bad.append(f"{title}: {o['summary']['type']} {block}")
            self.created[title] = it["path"]
        self.run.report(set(made) == set(want) and not bad,
                        f"the created entities ({', '.join(sorted(want))}) carry their importSource and items",
                        f"made {sorted(made)}", *bad)
        locations = [o["title"] for o in self.http("GET", "/objects", type="location")[1]]
        software = [o["title"] for o in self.http("GET", "/objects", type="software")[1]]
        self.run.report("HQ" not in locations and "SQL 2019" not in software,
                        "the turned-down HQ and the split-off SQL 2019 are not objects", f"{locations} {software}")

        # Gene's app01
        o = self.run.obj(GENE)
        body = o["body"]
        sec = section_of(body) or ""
        fm = o["frontmatter"]
        self.run.report(
            fm.get("ipAddress") == "10.9.9.9" and fm.get("fqdn") == "app01.corp.example" and "importSource" not in fm
            and sec and body == sec + "My notes.\n",
            'Gene\'s app01 is reused: his IP kept, FQDN filled, "My notes." below the new "From sources" section',
            f"ip {fm.get('ipAddress')}; fqdn {fm.get('fqdn')}; body {body!r}",
        )
        cited ={self.resolve(target_of(lk), GENE) for lk in links_in(sec)}
        disagree = [ln for ln in sec.splitlines() if ln.startswith("- IP address:")]
        self.run.report(
            sec.startswith("<!-- group from-sources -->\n## From sources\n") and cited
            and cited <= set(self.paths.values()) and "Sources disagree:" in sec and disagree
            and "10.0.0.5" in disagree[0] and "10.0.0.6" in disagree[0] and "[[Old APP01 notes]]" in disagree[0],
            "its section cites Sources as links and lists the IP conflict",
            f"cites {sorted(c or '?' for c in cited)}; {disagree}",
        )

        # the Sources relation and Distilled into
        entity_paths = {**self.created, "APP01": GENE}
        values = self.rows(*entity_paths.values(), *self.paths.values())
        bad = []
        distilled: dict[str, set[str]] = {p: set() for p in self.paths.values()}
        for e in self.view["entities"]:
            if e["decision"]["status"] == "rejected":
                continue
            title = RENAMED if e["name"] == "SQL Server 2019" else e["name"]
            path = entity_paths[title]
            got = [r["path"] for r in values[path].get("sources") or []]
            want_pages = [p["path"] for p in e["pages"]]
            if sorted(got) != sorted(want_pages):
                bad.append(f"{title}: sources {got} != {want_pages}")
            for p in want_pages:
                distilled[p].add(path)
        for src, ents in distilled.items():
            row = self.counterpart(src, "Distilled into")
            if row != ents:
                bad.append(f"{src}: Distilled into {sorted(row)} != {sorted(ents)}")
        self.run.report(not bad, 'each entity\'s Sources lists its Sources; each Source\'s "Distilled into" lists its entities',
                        *bad)

        payroll = self.created["Payroll"]
        runs_on = [r["path"] for r in values[payroll].get("runsOn") or []]
        runs = self.counterpart(GENE, "Runs")
        gene_text = (self.root / GENE).read_text(encoding="utf-8")
        self.run.report(runs_on == [GENE] and runs == {payroll} and "runsOn" not in gene_text,
                        'Payroll stores "Runs on" APP01; APP01\'s computed "Runs" row lists Payroll',
                        f"runsOn {runs_on}; Runs {sorted(runs)}")
        psec = section_of(self.run.obj(payroll)["body"]) or ""
        also = [ln for ln in psec.splitlines() if ln.startswith("Also linked:")]
        target = links_in(also[0])[0] if also else ""
        self.run.report(
            len(also) == 1 and also[0].endswith("(backs up to)") and self.resolve(target_of(target), payroll)
            == self.created["SRV-DB01"],
            '"backs up to" is a plain link in Payroll\'s section, to the SRV-DB01 entity (not its Source)',
            f"{also}",
        )

        # unlinked mentions, the inbox, the report
        code, refs = self.http("GET", "/references", path=GENE)
        found = {m["path"] for m in refs.get("mentions") or []} if code == 200 else set()
        restart = self.paths["Restart Payroll"]
        self.run.report(restart in found and b"Restart Payroll on APP01:" in (self.root / restart).read_bytes(),
                        "the Restart Payroll Source's mentions of APP01 stay unlinked and are listed under APP01",
                        f"{code} {sorted(found)}")
        self.run.report(OPS_LOG in found, "a page outside the import still lists as an unlinked mention of APP01")
        runbook = self.created["Restart Payroll"]
        inbox = [p for p, v in values.items() if "Import inbox" in (v.get("collections") or [])]
        self.run.report(inbox == [runbook] and not any(values[p].get("collections") for p in self.paths.values()),
                        "the low-confidence link's subject (Restart Payroll) is in the Import inbox; no Source is",
                        f"{inbox}")
        data, _items = batches.load_batch(self.root, self.batch)
        report = (batches.batch_dir(self.root, self.batch) / "report.md").read_text(encoding="utf-8")
        tail = report.split("### Sources disagree", 1)[-1]
        page = (self.root / data["reportPath"]).read_text(encoding="utf-8") if data.get("reportPath") else ""
        self.run.report("## Entities" in report and "### Sources disagree" in report and "10.0.0.5" in tail
                        and "10.0.0.6" in tail and "### Sources disagree" in page,
                        "the report (and its page) lists the IP conflict under Sources disagree",
                        f"report page {data.get('reportPath')}")

    def resolve(self, target: str, from_path: str) -> str | None:
        from objectapp.space import Space

        return Space(self.root).resolve(target, from_path)

    # 8 ------------------------------------------------------------------------------------
    def rerun(self) -> None:
        print("\n8. A re-run with one changed page")
        from objectapp.importers import batches, distill

        old = self.paths["Old APP01 notes"]
        old_text = (self.root / old).read_text(encoding="utf-8")
        page = self.src / "Notes" / "Old APP01 notes.md"
        page.write_bytes(b"APP01 IP address: 10.0.0.6. Retired in 2025.\n")
        set_mtime(page, "2025-06-01")
        entity_files = {p: (self.root / p).read_bytes() for p in [*self.created.values(), GENE]}
        batch2, job = self.start_import(self.client, True)
        _data, items2 = batches.load_batch(self.root, batch2)
        actions = {it["sourcePath"]: it["action"] for it in items2}
        text = (self.root / old).read_text(encoding="utf-8")
        versions = self.client.get("/api/history", params={"path": old}).json().get("versions") or []
        texts = [self.client.get("/api/history/version", params={"path": old, "id": v["id"]}).json().get("text")
                 for v in versions]  # fmt: skip
        self.run.report(
            job["phase"] == "done" and actions.get("Notes/Old APP01 notes.md") == "updated"
            and "Retired in 2025." in text and old_text in texts
            and self.run.obj(old)["summary"].get("readOnlyReason") == READ_ONLY,
            "the re-run updates the changed page's Source, its old text in version history, still read-only",
            f"{job['phase']}; {actions}; {len(versions)} versions",
        )
        paths2 = {it["title"]: it["path"] for it in items2 if it.get("path")}

        def edit(title: str, d: dict) -> None:
            if title == "Old APP01 notes":
                d["entities"][0]["lines"] = [{"text": "Retired in 2025.", "quote": "Retired in 2025"}]

        self.table(paths2, edit)
        code, _ = self.http("POST", f"/import/batches/{batch2}/filing/start", {"trial": False})
        s = self.wait(batch2, {"entities", "done", "failed"})
        base = f"/import/batches/{batch2}/entities"
        code2, view = self.entities(batch2)
        if not self.run.report(code == 200 and s["state"] == "entities" and code2 == 200,
                               "the re-run's pass waits in the entities state", f"{code} {s['state']} {code2}"):
            return
        sql_id = self.by_name(view)["SQL Server 2019"]["id"]
        ops = {"merges": [view["suggestedMerges"][0]["ids"]] if view["suggestedMerges"] else [],
               "splits": [{"id": sql_id, "names": ["SQL 2019"]}]}
        code, out = self.http("PUT", f"{base}/review", {"decisions": {}, **ops})
        view = out.get("view", {})
        names = self.by_name(view)
        found = {n: (e.get("existing") or {}).get("path") for n, e in names.items()}
        want = {"APP01": GENE, "Payroll": self.created["Payroll"], "SRV-DB01": self.created["SRV-DB01"],
                "Restart Payroll": self.created["Restart Payroll"], "SQL Server 2019": self.created[RENAMED]}
        self.run.report({n: found.get(n) for n in want} == want,
                        "the re-run finds every entity the first Write placed (the renamed one included)",
                        f"{found}")
        decisions = {e["id"]: {"status": "accepted" if e.get("existing") else "rejected"} for e in view["entities"]}
        self.http("PUT", f"{base}/review", {"decisions": decisions, **ops})
        code, _ = self.http("POST", f"{base}/write", {})
        s = self.wait(batch2, {"done", "failed"})
        w = self.entities(batch2)[1].get("written") or {}
        changed = sorted(p for p, b in entity_files.items() if (self.root / p).read_bytes() != b)
        self.run.report(code == 202 and s["state"] == "done" and w.get("created") == 0 and w.get("sections") == 1
                        and changed == [GENE],
                        "Write creates nothing new and rewrites only the section citing the changed Source",
                        f"{code} {s['state']}; {w}; changed {changed}")
        before = entity_files[GENE].decode("utf-8")
        after = (self.root / GENE).read_text(encoding="utf-8")
        a0, a1 = distill.find_section(after) or (0, 0)
        b0, b1 = distill.find_section(before) or (0, 0)
        head_same = [ln for ln in before[:b0].splitlines() if not ln.startswith("lastUpdated:")] == \
            [ln for ln in after[:a0].splitlines() if not ln.startswith("lastUpdated:")]  # fmt: skip
        self.run.report("Retired in 2025." in after[a0:a1] and after[a1:] == before[b1:] == "My notes.\n" and head_same,
                        "APP01's new line is in its section; Gene's notes and properties are untouched")

    # 9 ------------------------------------------------------------------------------------
    def trash(self) -> None:
        print("\n9. Move batch to Trash")
        from objectapp.space import version_of

        code, out = self.http("POST", f"/import/batches/{self.batch}/trash")
        gone = [*self.paths.values(), *self.created.values()]
        left = [p for p in gone if (self.root / p).exists()]
        trash = {t["originalPath"]: t for t in self.http("GET", "/trash")[1] if t["kind"] == "object"}
        self.run.report(
            code == 200 and out.get("missing") == 0 and not left and set(gone) <= set(trash)
            and (self.root / GENE).is_file() and GENE not in trash,
            "Move batch to Trash moves the six Sources and the four created entities, not Gene's app01",
            f"{code} {out}; still there {left}",
        )
        src = self.paths["SRV-DB01"]
        ok = all(self.http("POST", f"/trash/{trash[p]['id']}/restore")[0] == 200 for p in (src, self.created["SRV-DB01"])
                 if p in trash)  # fmt: skip
        self.run.report(
            ok and version_of((self.root / src).read_bytes()) == self.items[src]["version"]
            and self.run.obj(src)["summary"].get("readOnlyReason") == READ_ONLY
            and (self.root / self.created["SRV-DB01"]).is_file(),
            "Restore brings a Source back byte-identical and read-only, and an entity back",
        )


# -- main ----------------------------------------------------------------------------------


def prepare(fixture: Path, tmp: Path) -> tuple[Path, Path, Path, Path]:
    """(the space, the scratch copy, the default copy, the source), all under ``tmp``."""
    from m30_helpers import make_itops_source

    from objectapp.space import Space

    root = tmp / "space"
    shutil.copytree(fixture, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    Space(root).apply_setup("itops")
    scratch, default = tmp / "scratch", tmp / "default"
    shutil.copytree(root, scratch)
    shutil.copytree(root, default)
    space = Space(root)
    space.create_object("host", "app01", template_id="none", values={"ipAddress": "10.9.9.9"}, body="My notes.\n")
    (root / OPS_LOG).parent.mkdir(exist_ok=True)
    (root / OPS_LOG).write_text("# Ops log\n\nChecked APP01 today.\n", encoding="utf-8")
    src = make_itops_source(tmp)
    rack = src / "Notes" / "Rack notes.md"
    rack.write_bytes((RACK_EXTRA + "\n").encode("utf-8"))
    set_mtime(rack, "2026-07-01")
    return root, scratch, default, src


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path, nargs="?", default=DEFAULT_SPACE)
    ap.add_argument("--keep", action="store_true", help="keep the temporary folder")
    args = ap.parse_args(argv)
    fixture = args.space.resolve()
    if not fixture.is_dir():
        ap.error(f"Not a folder: {fixture}")
    fixture_before = snapshot(fixture)

    tmp = Path(tempfile.mkdtemp(prefix="m30-acceptance-")).resolve()
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    os.environ.update({"OBJECT_STATE_DIR": str(tmp / "state"), "OBJECT_CACHE_DIR": str(tmp / "cache")})
    run: Run | None = None
    try:
        from fake_claude import install
        from fastapi.testclient import TestClient

        from objectapp import server
        from objectapp import settings as device_settings
        from objectapp.server import create_app
        from objectapp.space import Space

        server.allowed_hosts = server.LOOPBACK_HOSTS | {"testserver"}
        claude = install(tmp / "bin")
        _d, rev = device_settings.read()
        device_settings.patch({"claudePath": str(claude)}, rev)
        root, scratch, default, src = prepare(fixture, tmp)
        print(f"Space copy: {root}\nSource: {src}")
        with TestClient(create_app(Space(root), watch=False)) as client:
            run = Run(root, ClientHttp(client))
            m30 = M30(root, src, tmp, run, client)
            m30.plain_import(scratch, default)
            m30.proposal()
            m30.source_import()
            m30.trial_and_bulk()
            m30.entities_view()
            m30.review_and_write()
            m30.after_write()
            m30.rerun()
            m30.trash()
        print("\n10. The fixture")
        run.report(snapshot(fixture) == fixture_before, "the fixture folder is unchanged")
    except Exception as exc:  # report a crash as a failure, then clean up
        if run is not None:
            run.report(False, f"the run stopped: {exc!r}")
        raise
    finally:
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        if args.keep:
            print(f"\nKept: {tmp}")
        else:
            remove_tree(tmp)

    failures = run.failures if run else 1
    print("\nRESULT:", "PASS" if failures == 0 else f"FAIL ({failures})")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
