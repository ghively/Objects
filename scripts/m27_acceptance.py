"""Milestone 27 acceptance, back end (the agent workflow).

Usage: ``uv run python scripts/m27_acceptance.py [SPACE] [--keep]`` (default: ``backend/tests/fixtures/space-sample``).

Runs on a copy of a fixture space with a synthetic mixed folder (Word runbooks, Markdown notes, a
file holding a fake secret and a "Credentials" folder) and the fake ``claude``: draft batch and scan
-> schema proposal (rules checked) -> Gene's review -> Apply -> import (Leave out honoured, flagged
file excluded from AI) -> trial filing pass -> marks -> continue (bulk) -> normalise -> report with
the trial's accuracy. No real data, no network, no real agent. Ends with ``RESULT: PASS``.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

FAILS: list[str] = []


def check(name: str, ok: bool) -> None:
    print(("[ok]   " if ok else "[FAIL] ") + name)
    if not ok:
        FAILS.append(name)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("space", nargs="?", default=str(ROOT / "backend" / "tests" / "fixtures" / "space-sample"))
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args(argv)
    tmp = Path(tempfile.mkdtemp(prefix="m27-"))
    os.environ["OBJECT_STATE_DIR"] = str(tmp / "state")
    os.environ["OBJECT_CACHE_DIR"] = str(tmp / "cache")
    try:
        run(Path(args.space), tmp)
    finally:
        if not args.keep:
            shutil.rmtree(tmp, ignore_errors=True)
    print("RESULT: " + ("PASS" if not FAILS else "FAIL"))
    return 1 if FAILS else 0


def run(fixture: Path, tmp: Path) -> None:
    from docx import Document
    from fake_claude import install
    from fastapi.testclient import TestClient

    from objectapp import server
    from objectapp import settings as device_settings
    from objectapp.frontmatter import parse_fm
    from objectapp.importers import batches
    from objectapp.objfile import split_object
    from objectapp.server import create_app
    from objectapp.space import Space

    server.allowed_hosts = server.LOOPBACK_HOSTS | {"testserver"}
    space_dir = tmp / "space"
    shutil.copytree(fixture, space_dir)
    src = tmp / "mixed"
    (src / "Runbooks").mkdir(parents=True)
    (src / "Credentials").mkdir()
    (src / "Credentials" / "keys.txt").write_text("never read\n")
    for i in range(12):
        d = Document()
        d.add_heading(f"Runbook {i}", 1)
        d.add_paragraph(f"Environment: {['Prod', 'prod', 'Production'][i % 3]}")
        d.add_paragraph("Owner: Ann")
        d.save(src / "Runbooks" / f"Runbook {i}.docx")
    (src / "Runbooks" / "Secrets.md").write_text("# Secrets\n\npassword = hunter2hunter2\n")
    (src / "Notes.md").write_text("# Notes\n\nA loose note.\n")
    before = {p: p.read_bytes() for p in src.rglob("*") if p.is_file()}

    claude = install(tmp / "bin")
    _d, rev = device_settings.read()
    device_settings.patch({"claudePath": str(claude)}, rev)

    def fm(rel: str) -> dict:
        return parse_fm(split_object((space_dir / rel).read_text(encoding="utf-8")).frontmatter_src or "")

    with TestClient(create_app(Space(space_dir), watch=False)) as c:
        # 1. draft batch and scan
        r = c.post("/api/import/batches", json={"path": str(src), "leaveOut": ["Credentials"]})
        batch, scan = r.json()["batch"], r.json()["scan"]
        check("scan flags the secret by kind and line, never the value",
              "Runbooks/Secrets.md" in scan["findings"] and "hunter2" not in json.dumps(scan))
        check("Leave out is never read", scan["leftOut"] == ["Credentials/keys.txt"])

        # 2. proposal, review, apply
        body = {"summary": "Runbooks", "items": [{
            "id": "g1", "action": "create", "group": "Runbooks", "name": "Playbook", "pluralName": "Playbooks",
            "documents": 12, "examples": ["Runbooks/Runbook 0.docx"],
            "properties": [
                {"name": "Environment", "kind": "label", "share": 1.0, "options": ["Prod", "prod", "Production", "Dev"]},
                {"name": "Owner", "kind": "text", "share": 0.9},
                {"name": "Rare", "kind": "text", "share": 0.1}]},
            {"id": "g2", "action": "create", "group": "Notes", "name": "Memo", "documents": 3, "examples": [],
             "properties": [{"name": "Subject", "kind": "text", "share": 1.0}]}]}
        from objectapp.importers import proposal as P

        stored = P.save_proposal(Space(space_dir), batch, body)
        g1, g2 = stored["items"]
        check("a property under 30% is dropped, options merged with the merge shown",
              [d["name"] for d in g1["dropped"]] == ["Rare"] and g1["properties"][0]["merged"])
        check("a new type under 10 documents is a problem", bool(g2["problems"]))
        view = c.get(f"/api/import/batches/{batch}/proposal").json()
        check("GET proposal gives groups and an empty review", len(view["proposal"]["groups"]) == 2 and view["review"]["items"] == [])
        c.put(f"/api/import/batches/{batch}/proposal/review",
              json={"items": [{"id": "g1", "status": "accepted"}, {"id": "g2", "status": "accepted"}]})
        out = c.post(f"/api/import/batches/{batch}/proposal/apply").json()
        check("Apply creates the rule-passing type only", len(out["created"]) == 1 and len(out["skipped"]) == 1)

        # 3. import with the batch
        pv = c.post("/api/import/preview", json={"source": {"path": str(src), "kind": "files"}, "target": "currentSpace",
                                                 "leaveOut": ["Credentials"], "keepAsSources": False}).json()
        r = c.post("/api/import/start", json={"previewId": pv["previewId"], "mapping": pv["mapping"],
                                              "target": {"kind": "currentSpace"}, "batch": batch, "keepAsSources": False,
                                              "scan": {"leaveOut": ["Credentials"], "leaveOutFiles": [], "excludeFromAi": ["Runbooks/Secrets.md"]}})
        job_id = r.json()["jobId"]
        while (job := c.get(f"/api/import/jobs/{job_id}").json())["phase"] not in ("done", "failed"):
            time.sleep(0.05)
        check("import adopts the draft batch", job["phase"] == "done" and job["result"]["batch"] == batch)
        data, items = batches.load_batch(space_dir, batch)
        c0 = data["counts"]
        check("counts reconcile with the left-out file",
              c0["sourceItems"] == sum(c0[k] for k in ("imported", "updated", "unchanged", "changedInBoth", "leftOut", "failed")))
        secret = next(i for i in items if i["sourcePath"] == "Runbooks/Secrets.md")
        check("flagged file written with excludeFromAI", fm(secret["path"]).get("excludeFromAI") is True)
        check("nothing in Credentials was imported", not any("keys" in (i["sourcePath"]) for i in items))
        paths = {i["title"]: i["path"] for i in items if i.get("path")}

        # 4. trial
        table = {}
        for n in range(12):
            env = ["Prod", "prod", "Production"][n % 3]
            table[paths[f"Runbook {n}"]] = {
                "type": "Playbook", "confidence": "high",
                "values": [{"key": "environment", "value": "Prod", "quote": f"Environment: {env}"},
                           {"key": "owner", "value": "Ann", "quote": "Owner: Ann"}],
                "tags": [{"value": env, "quote": f"Environment: {env}"}]}
        table[paths["Runbook 0"]]["values"].append({"key": "owner", "value": "Bob", "quote": "Owner: Bob"})
        table[paths["Runbook 1"]]["confidence"] = "low"
        os.environ["FAKE_CLAUDE_FILING"] = json.dumps(table)
        check("bulk is refused before a trial",
              c.post(f"/api/import/batches/{batch}/filing/start", json={"trial": False}).status_code == 409)
        c.post(f"/api/import/batches/{batch}/filing/start", json={"trial": True})
        s = wait(c, batch, {"trial", "failed"})
        titles = {i["title"]: i for i in s["trial"]["items"]}
        check("trial covers objects not excluded from AI", s["state"] == "trial" and "Secrets" not in titles and len(titles) >= 12)
        first = titles["Runbook 0"]
        check("a value whose quote is not in the document is refused",
              [v["ok"] for v in first["values"] if v["key"] == "owner"] == [True, False])
        check("applied values are in the file", fm(first["path"]).get("environment") == "Prod")
        check("low confidence goes to the Import inbox",
              "Import inbox" in (fm(titles["Runbook 1"]["path"]).get("collections") or []))
        c.post(f"/api/import/batches/{batch}/filing/mark", json={"path": first["path"], "verdict": "right"})
        c.post(f"/api/import/batches/{batch}/filing/mark", json={"path": titles["Runbook 2"]["path"], "verdict": "right"})
        s = c.get(f"/api/import/batches/{batch}/filing").json()
        check("the share marked right is reported", s["trial"]["rightShare"] == 1.0)

        # 5. continue, normalise, report
        c.post(f"/api/import/batches/{batch}/filing/continue")
        s = wait(c, batch, {"done", "failed"})
        check("bulk pass finishes with normalise suggestions", s["state"] == "done" and any(m["kind"] == "tag" for m in s["normalise"]))
        c.post(f"/api/import/batches/{batch}/filing/normalise", json={"merges": [{"from": ["Prod", "prod", "Production"], "to": "Production"}]})
        check("normalise merges the tags", "Production" in (fm(first["path"]).get("tags") or []))
        report = (batches.batch_dir(space_dir, batch) / "report.md").read_text(encoding="utf-8")
        check("the report records the trial's accuracy", "100% right" in report and "Sensitive content scan" in report)
        check("filing again after the trial is allowed",
              c.post(f"/api/import/batches/{batch}/filing/start", json={"trial": False}).status_code == 200)

    check("the source folder is unchanged", before == {p: p.read_bytes() for p in src.rglob("*") if p.is_file()})


def wait(c, batch: str, states: set[str]) -> dict:
    end = time.monotonic() + 60
    while time.monotonic() < end:
        s = c.get(f"/api/import/batches/{batch}/filing").json()
        if s["state"] in states:
            return s
        time.sleep(0.05)
    raise SystemExit("filing pass timed out")


if __name__ == "__main__":
    sys.exit(main())
