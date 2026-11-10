"""M30 test helpers (plan ``2026-11-09-m30-entity-extraction.md``, Task 1): the synthetic IT ops
source, a ``space-sample`` copy with the IT ops setup, an import kept as Sources, the fake
``claude``'s filing decisions for the six pages, and filing results with checked candidates.

Everything is synthetic (hosts ``APP01``, ``SRV-DB01``; "SQL Server 2019"; "Payroll"; "HQ";
``10.0.0.x``).
"""

from __future__ import annotations

import os
import shutil
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi.testclient import TestClient
from m15_helpers import wait_job

from objectapp.importers import batches
from objectapp.server import create_app
from objectapp.space import Space

FIXTURES = Path(__file__).parent / "fixtures"

PAGES: dict[str, str] = {
    "Hosts/APP01.md": "APP01 is the Payroll server at HQ. It runs Windows Server 2019. FQDN: app01.corp.example. IP address: 10.0.0.5.",
    "Hosts/SRV-DB01.md": "SRV-DB01 holds the Payroll database on SQL Server 2019.",
    "Apps/Payroll.md": "Payroll runs on APP01 and uses SQL 2019. Payroll backs up to SRV-DB01.",
    "Runbooks/Restart Payroll.md": "Restart Payroll on APP01: stop the service, check SQL Server 2019, start it. Not APP010. `APP01` in code. See [[APP01]].",
    "Notes/Rack notes.md": "Rack 4 at HQ holds a Server and a VM.",
    "Notes/Old APP01 notes.md": "APP01 IP address: 10.0.0.6.",
}
"""The synthetic source's pages (source-relative path -> text)."""

CRLF_BOM = "Hosts/SRV-DB01.md"
"""The page written with CRLF line endings and a BOM."""

MODIFIED: dict[str, str] = {
    "Hosts/APP01.md": "2026-10-01",
    "Hosts/SRV-DB01.md": "2026-09-15",
    "Apps/Payroll.md": "2026-09-20",
    "Runbooks/Restart Payroll.md": "2026-08-01",
    "Notes/Rack notes.md": "2026-07-01",
    "Notes/Old APP01 notes.md": "2025-06-01",
}
"""Each page's modified date (UTC midnight, set with ``os.utime``): APP01's page is newer than the old notes."""


def make_itops_source(tmp_path: Path) -> Path:
    """Write the six synthetic pages into ``tmp_path/itops-source`` and set their modified times."""
    src = tmp_path / "itops-source"
    for rel, text in PAGES.items():
        f = src / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        if rel == CRLF_BOM:
            f.write_bytes(b"\xef\xbb\xbf" + (text + "\r\n").encode("utf-8"))
        else:
            f.write_bytes((text + "\n").encode("utf-8"))
        when = datetime.fromisoformat(MODIFIED[rel]).replace(tzinfo=UTC).timestamp()
        os.utime(f, (when, when))
    return src


def itops_space(tmp_path: Path) -> Path:
    """A copy of ``space-sample`` (``tmp_path/itops-space``) with M28's IT ops setup applied."""
    root = tmp_path / "itops-space"
    shutil.copytree(FIXTURES / "space-sample", root)
    Space(root).apply_setup("itops")
    return root


def import_as_sources(space_root: Path, source: Path, client: TestClient | None = None) -> str:
    """Run M25's import of ``source`` into ``space_root`` with ``keepAsSources: true``; answers the batch.

    Uses ``client`` (an app on ``space_root``) when given, else its own app. Fails unless the batch
    records ``keepAsSources: true`` (so its tests xfail until Task 4)."""
    if client is None:
        app = create_app(Space(space_root), watch=False)
        with TestClient(app) as own:
            return import_as_sources(space_root, source, own)
    r = client.post("/api/import/preview", json={"source": {"path": str(source)}, "target": "currentSpace",
                                                  "keepAsSources": True})
    assert r.status_code == 200, r.text
    pv = r.json()
    r = client.post("/api/import/start", json={"previewId": pv["previewId"], "mapping": pv["mapping"],
                                               "target": {"kind": "currentSpace"}, "keepAsSources": True})
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == "done", job
    batch = job["result"]["batch"]
    data, _items = batches.load_batch(space_root, batch)
    assert data.get("keepAsSources") is True, "the import did not keep its pages as Sources"
    return batch


# -- the fake claude's decisions -----------------------------------------------------------------


def _v(key: str, value: Any, quote: str) -> dict[str, Any]:
    return {"key": key, "value": value, "quote": quote}


def _line(text: str, quote: str) -> dict[str, str]:
    return {"text": text, "quote": quote}


def _rel(subject: str, relation: str, obj: str, quote: str, confidence: str = "high") -> dict[str, str]:
    return {"subject": subject, "relation": relation, "object": obj, "quote": quote, "confidence": confidence}


def _decision(main: dict[str, Any] | None, entities: list[dict[str, Any]], relations: list[dict[str, Any]],
              merges: list[dict[str, Any]] | None = None, confidence: str = "high") -> dict[str, Any]:
    return {"confidence": confidence, "tags": [], "collections": [], "type": None, "values": [], "links": [],
            "mainEntity": main, "entities": entities, "relations": relations, "merges": merges or []}


def _decisions_by_page() -> dict[str, dict[str, Any]]:
    """Per source page, what the agent returns on a batch kept as Sources (the Contract's decision)."""
    return {
        "Hosts/APP01.md": _decision(
            {"type": "Host", "name": "APP01", "aliases": ["app01.corp.example"],
             "values": [_v("fqdn", "app01.corp.example", "FQDN: app01.corp.example"),
                        _v("ipAddress", "10.0.0.5", "IP address: 10.0.0.5")],
             "lines": [_line("The Payroll server at HQ.", "APP01 is the Payroll server at HQ")]},
            [{"type": "Location", "name": "HQ", "aliases": [], "values": [], "lines": []},
             {"type": "Application", "name": "Payroll", "aliases": [], "values": [],
              "lines": [_line("Runs on APP01.", "APP01 is the Payroll server")]},
             {"type": "Software", "name": "Windows Server 2019", "aliases": [], "values": [], "lines": []}],
            [_rel("APP01", "Located at", "HQ", "APP01 is the Payroll server at HQ"),
             _rel("APP01", "Operating system", "Windows Server 2019", "It runs Windows Server 2019")],
        ),
        "Hosts/SRV-DB01.md": _decision(
            {"type": "Host", "name": "SRV-DB01", "aliases": [], "values": [],
             "lines": [_line("Holds the Payroll database.", "SRV-DB01 holds the Payroll database")]},
            [{"type": "Software", "name": "SQL Server 2019", "aliases": [], "values": [_v("version", "2019", "SQL Server 2019")],
              "lines": [_line("The Payroll database runs on it.", "the Payroll database on SQL Server 2019")]},
             {"type": "Application", "name": "Payroll", "aliases": [], "values": [], "lines": []}],
            [],
        ),
        "Apps/Payroll.md": _decision(
            {"type": "Application", "name": "Payroll", "aliases": [], "values": [],
             "lines": [_line("Runs on APP01 and uses SQL 2019.", "Payroll runs on APP01 and uses SQL 2019")]},
            [{"type": "Host", "name": "APP01", "aliases": [], "values": [],
              "lines": [_line("Payroll runs on it.", "Payroll runs on APP01")]},
             {"type": "Software", "name": "SQL 2019", "aliases": [], "values": [], "lines": []},
             {"type": "Host", "name": "SRV-DB01", "aliases": [], "values": [], "lines": []}],
            [_rel("Payroll", "Runs on", "APP01", "Payroll runs on APP01"),
             _rel("Payroll", "Uses", "SQL 2019", "Payroll runs on APP01 and uses SQL 2019"),
             _rel("Payroll", "backs up to", "SRV-DB01", "Payroll backs up to SRV-DB01")],
            [{"type": "Software", "names": ["SQL 2019", "SQL Server 2019"]}],
        ),
        "Runbooks/Restart Payroll.md": _decision(
            {"type": "Runbook", "name": "Restart Payroll", "aliases": [], "values": [],
             "lines": [_line("Stop the service, check SQL Server 2019, start it.",
                             "stop the service, check SQL Server 2019, start it")]},
            [{"type": "Host", "name": "APP01", "aliases": [], "values": [], "lines": []},
             {"type": "Application", "name": "Payroll", "aliases": [], "values": [], "lines": []},
             {"type": "Software", "name": "SQL Server 2019", "aliases": [], "values": [], "lines": []}],
            [_rel("Restart Payroll", "Covers", "Payroll", "Restart Payroll on APP01"),
             _rel("Restart Payroll", "Covers", "APP01", "Restart Payroll on APP01", confidence="low")],
        ),
        "Notes/Rack notes.md": _decision(
            None,
            [{"type": "Location", "name": "Rack 4", "aliases": [], "values": [], "lines": []},
             {"type": "Location", "name": "HQ", "aliases": [], "values": [], "lines": []},
             {"type": "Host", "name": "Server", "aliases": [], "values": [], "lines": []},
             {"type": "Host", "name": "VM", "aliases": [], "values": [], "lines": []}],
            [],
            confidence="medium",
        ),
        "Notes/Old APP01 notes.md": _decision(
            None,
            [{"type": "Host", "name": "APP01", "aliases": [], "values": [_v("ipAddress", "10.0.0.6", "APP01 IP address: 10.0.0.6")],
              "lines": []}],
            [],
        ),
    }  # fmt: skip


def decisions(paths: dict[str, str]) -> dict[str, dict[str, Any]]:
    """The ``FAKE_CLAUDE_FILING`` table for the synthetic pages, keyed by imported path.

    ``paths`` maps each page's title (``"APP01"``) or source path (``"Hosts/APP01.md"``) to the
    path it was imported to (as ``items.json`` lists it); pages it doesn't name are left out."""
    out: dict[str, dict[str, Any]] = {}
    for rel, d in _decisions_by_page().items():
        imported = paths.get(PurePosixPath(rel).stem) or paths.get(rel)
        if imported:
            out[imported] = d
    return out


# -- filing results with checked candidates ------------------------------------------------------------


def _checked_entity(e: dict[str, Any], confidence: str, main: bool) -> dict[str, Any]:
    out = {"typeId": str(e.get("type") or "").casefold(), "type": e.get("type"), "name": e.get("name"),
           "aliases": [], "values": [], "lines": [], "confidence": confidence, "main": main, "ok": True}
    out.update(e)
    out["values"] = [{"quote": "", "ok": True, **v} for v in out["values"]]
    out["lines"] = [{"quote": "", "ok": True, **ln} for ln in out["lines"]]
    return out


def result(path: str, **checked: Any) -> dict[str, Any]:
    """A filing result (M27's record) for ``path`` with checked candidates (T2's shapes), for tests
    that skip the agent. ``checked`` overrides any field; ``mainEntity``, ``entities`` and
    ``relations`` may be partial: the rest is filled as a passing candidate (``typeId`` the type's
    name casefolded, as the IT ops types' ids are; ``confidence`` the result's)."""
    conf = checked.get("confidence", "high")
    out: dict[str, Any] = {
        "path": path, "origPath": path, "title": PurePosixPath(path).stem, "type": None, "confidence": conf,
        "values": [], "tags": [], "collections": [], "links": [], "inbox": False, "notes": [],
        "mainEntity": None, "entities": [], "relations": [], "merges": [],
    }  # fmt: skip
    out.update(checked)
    if out["mainEntity"] is not None:
        out["mainEntity"] = _checked_entity(out["mainEntity"], conf, True)
    out["entities"] = [_checked_entity(e, conf, False) for e in out["entities"]]
    out["relations"] = [{"quote": "", "confidence": conf, "plain": False, "ok": True, **r} for r in out["relations"]]
    out["merges"] = [{"typeId": str(m.get("type") or "").casefold(), "ok": True, **m} for m in out["merges"]]
    return out
