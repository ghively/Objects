"""M30 test helpers (plan ``2026-11-09-m30-entity-extraction.md``, Task 1): the synthetic IT ops
source, a ``space-sample`` copy with the IT ops setup, an import kept as Sources, the fake
``claude``'s filing decisions for the six pages, and filing results with checked candidates.

Everything is synthetic (hosts ``APP01``, ``SRV-DB01``; "SQL Server 2019"; "Payroll"; "HQ";
``10.0.0.x``).

`simple_pick` and `simple_lines` are reference implementations of the Contract's rules for
`distill.pick_values` and `distill.summary_lines`, for T3's tests while those are stubs
(`use_simple_distill`); T5's commit deletes the three and points their users at `distill`.
"""

from __future__ import annotations

import os
import shutil
import unicodedata
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi.testclient import TestClient
from m15_helpers import wait_job

from objectapp.importers import batches, distill, filing, sources
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


def t4_landed() -> bool:
    """Whether M30 Task 4 (Keep pages as Sources) is built: `import_as_sources`' tests xfail until then."""
    try:
        sources.keep_as_sources(None, False, False)
    except NotImplementedError:
        return False
    return True


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


# -- reference rules for distill (until T5) ------------------------------------------------------------


def _when(modified: str | None) -> float:
    """A Source's modified time as a number (None and unreadable oldest)."""
    if not modified:
        return float("-inf")
    try:
        t = datetime.fromisoformat(modified)
    except ValueError:
        return float("-inf")
    return (t if t.tzinfo else t.replace(tzinfo=UTC)).timestamp()


def _ref(row: dict[str, Any]) -> distill.SourceRef:
    return {"path": row["page"], "quote": row.get("quote") or "", "modified": row.get("modified")}


def _order(rows: list[dict[str, Any]], main_pages: set[str]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda r: (r["page"] not in main_pages, r["page"]))


def simple_pick(found: dict[str, list[dict[str, Any]]], main_pages: set[str]) -> dict[str, distill.PickedValue]:
    """Reference `distill.pick_values`: values equal by ``filing._norm(str(value))`` are one value with
    every Source that says it; the value whose newest Source is the most recent wins (None oldest),
    a main page's then the smallest path on a tie; the others are its ``conflict``."""
    out: dict[str, distill.PickedValue] = {}
    for key, rows in found.items():
        groups: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            groups.setdefault(filing._norm(str(row["value"])), []).append(row)

        def rank(members: list[dict[str, Any]]) -> tuple[float, bool, str]:
            newest = max(_when(m.get("modified")) for m in members)
            return (-newest, not any(m["page"] in main_pages for m in members), min(m["page"] for m in members))

        ordered = sorted(groups.values(), key=rank)
        win, rest = ordered[0], ordered[1:]
        top = min(win, key=lambda m: (-_when(m.get("modified")), m["page"] not in main_pages, m["page"]))
        out[key] = {
            "value": top["value"],
            "sources": [_ref(m) for m in _order(win, main_pages)],
            "conflict": [{"value": g[0]["value"], "sources": [_ref(m) for m in _order(g, main_pages)]} for g in rest]
            or None,
        }
    return out


def _norm_line(text: str) -> str:
    t = " ".join(unicodedata.normalize("NFKC", text).casefold().split())
    return t.strip(".,;:()[]\"' ")


def simple_lines(found: list[dict[str, Any]], main_pages: set[str]) -> list[distill.SummaryLine]:
    """Reference `distill.summary_lines`: lines equal by their normalised text merge their Sources;
    main pages' lines first, then by the newest Source, then text; at most `distill.MAX_LINES`."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in found:
        groups.setdefault(_norm_line(str(row["text"])), []).append(row)

    def rank(members: list[dict[str, Any]]) -> tuple[bool, float, str]:
        return (not any(m["page"] in main_pages for m in members),
                -max(_when(m.get("modified")) for m in members), members[0]["text"])

    out: list[distill.SummaryLine] = []
    for members in sorted(groups.values(), key=rank)[: distill.MAX_LINES]:
        out.append({"text": members[0]["text"], "sources": [_ref(m) for m in _order(members, main_pages)]})
    return out


def use_simple_distill(monkeypatch: Any) -> None:
    """Point `distill.pick_values` and `distill.summary_lines` at the reference rules while they are stubs."""
    try:
        distill.pick_values({}, set())
    except NotImplementedError:
        monkeypatch.setattr(distill, "pick_values", simple_pick)
        monkeypatch.setattr(distill, "summary_lines", simple_lines)
