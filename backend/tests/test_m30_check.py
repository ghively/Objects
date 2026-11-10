"""M30 Task 2: checking one filing decision's entity candidates against its page (plan
``2026-11-09-m30-entity-extraction.md``, Task 2; Review Focus 6).

The space is ``itops_space``; each page's document is M27's ``filing._doc_text`` of that page as an
object of the space (the synthetic source's six pages, written as Page objects here so the check
runs before Task 4 imports them as Sources). The decisions are ``m30_helpers``' ``FAKE_CLAUDE_FILING``
table.
"""

from __future__ import annotations

import copy
from pathlib import Path, PurePosixPath
from typing import Any

import pytest
from m30_helpers import PAGES, decisions, itops_space

from objectapp.importers import entitycheck, filing
from objectapp.space import Space


@pytest.fixture
def setup(tmp_path: Path) -> tuple[Space, dict[str, tuple[str, str, str]], dict[str, dict[str, Any]]]:
    """(space, title -> (path, doc, title), the decisions keyed by imported path)."""
    space = Space(itops_space(tmp_path))
    pages: dict[str, tuple[str, str, str]] = {}
    for rel, text in PAGES.items():
        title = PurePosixPath(rel).stem
        path, _v = space.create_object("page", title, body=text)
        of, fm, _version = space.read(path)
        pages[title] = (path, filing._doc_text(of, fm, title), title)
    table = decisions({title: path for title, (path, _d, _t) in pages.items()})
    return space, pages, table


def _check(setup: Any, title: str, decision: dict[str, Any] | None = None) -> dict[str, Any]:
    space, pages, table = setup
    path, doc, page_title = pages[title]
    d = copy.deepcopy(decision if decision is not None else table[path])
    d.setdefault("path", path)
    return entitycheck.check_candidates(space, d, doc, path, page_title)


def _by_name(checked: dict[str, Any], name: str) -> dict[str, Any]:
    return next(e for e in checked["entities"] if e["name"] == name)


def _value(entity: dict[str, Any], key: str) -> dict[str, Any]:
    return next(v for v in entity["values"] if v["key"] == key)


def _rel(checked: dict[str, Any], relation: str, obj: str) -> dict[str, Any]:
    return next(r for r in checked["relations"] if r["relation"] == relation and r["object"] == obj)


def _decision(**fields: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"confidence": "high", "tags": [], "collections": [], "type": None, "values": [],
                           "links": [], "mainEntity": None, "entities": [], "relations": [], "merges": []}
    out.update(fields)
    return out


def test_valid_candidates_pass(setup: Any) -> None:
    app01 = _check(setup, "APP01")
    main = app01["mainEntity"]
    assert main["ok"] is True and "reason" not in main
    assert main["main"] is True
    assert main["type"] == "Host" and main["typeId"] == "host"
    assert main["name"] == "APP01"
    assert main["aliases"] == ["app01.corp.example"]
    assert main["confidence"] == "high"
    fqdn, ip = _value(main, "fqdn"), _value(main, "ipAddress")
    assert (fqdn["ok"], fqdn["value"]) == (True, "app01.corp.example")
    assert (ip["ok"], ip["value"]) == (True, "10.0.0.5")
    assert main["lines"] == [{"text": "The Payroll server at HQ.", "quote": "APP01 is the Payroll server at HQ", "ok": True}]
    assert all(e["ok"] and e["main"] is False for e in app01["entities"])
    assert {e["name"] for e in app01["entities"]} == {"HQ", "Payroll", "Windows Server 2019"}
    located = _rel(app01, "Located at", "HQ")
    assert located["ok"] is True and located["plain"] is False

    payroll = _check(setup, "Payroll")
    runs_on = _rel(payroll, "Runs on", "APP01")
    assert runs_on["ok"] is True and runs_on["plain"] is False
    assert runs_on["subject"] == "Payroll" and runs_on["quote"] == "Payroll runs on APP01"
    assert runs_on["confidence"] == "high"
    uses = _rel(payroll, "Uses", "SQL 2019")
    assert uses["ok"] is True and uses["plain"] is False
    assert payroll["merges"] == [{"typeId": "software", "names": ["SQL 2019", "SQL Server 2019"], "ok": True}]

    runbook = _check(setup, "Restart Payroll")["mainEntity"]
    assert runbook["ok"] is True and runbook["main"] is True
    assert (runbook["type"], runbook["typeId"], runbook["name"]) == ("Runbook", "runbook", "Restart Payroll")

    # a page mainly about nothing has no main entity; its mentions are still checked
    rack = _check(setup, "Rack notes")
    assert rack["mainEntity"] is None
    assert {e["name"] for e in rack["entities"] if e["ok"]} == {"Rack 4", "HQ", "Server", "VM"}


def test_invented_aliases_names_lines_relations_and_synced_values_refused(setup: Any) -> None:
    _space, pages, table = setup
    srv = dict(table[pages["SRV-DB01"][0]])
    srv["entities"] = [
        {"type": "Software", "name": "SQL Server 2019", "aliases": ["MSSQL 2019", "SQL Server 2019"], "values": [],
         "lines": []},
        {"type": "Application", "name": "Billing", "aliases": [], "values": [], "lines": []},
        {"type": "Source", "name": "SRV-DB01", "aliases": [], "values": [], "lines": []},
        {"type": "Gizmo", "name": "SRV-DB01", "aliases": [], "values": [], "lines": []},
    ]
    srv["mainEntity"] = {
        "type": "Host", "name": "SRV-DB01", "aliases": [],
        "values": [{"key": "lastBoot", "value": "2026-10-01", "quote": "SRV-DB01 holds the Payroll database"},
                   {"key": "sources", "value": ["SRV-DB01"], "quote": "SRV-DB01 holds the Payroll database"},
                   {"key": "operatingSystem", "value": "SQL Server 2019", "quote": "on SQL Server 2019"},
                   {"key": "fqdn", "value": "srv-db01.corp.example", "quote": "SRV-DB01 holds the Payroll database"},
                   {"key": "nope", "value": "x", "quote": "SRV-DB01 holds"}],
        "lines": [{"text": "It is in Denver.", "quote": "APP01 is in Denver"},
                  {"text": "Two\nlines.", "quote": "SRV-DB01 holds the Payroll database"},
                  {"text": "x" * (entitycheck.MAX_LINE + 1), "quote": "SRV-DB01 holds the Payroll database"},
                  {"text": "A fourth line, dropped.", "quote": "SRV-DB01 holds the Payroll database"}],
    }  # fmt: skip
    checked = _check(setup, "SRV-DB01", srv)

    sql = _by_name(checked, "SQL Server 2019")
    assert sql["ok"] is True
    assert sql["aliases"] == []  # "MSSQL 2019" is not in the page, and the name is no alias of itself
    billing = _by_name(checked, "Billing")
    assert billing["ok"] is False and billing["reason"] == "the name is not in the page"
    source = next(e for e in checked["entities"] if e["type"] == "Source")
    assert source["ok"] is False and source["reason"] == "a Source is made by the import, not distilled"
    gizmo = next(e for e in checked["entities"] if e["type"] == "Gizmo")
    assert gizmo["ok"] is False and gizmo["reason"] == "no such type"

    main = checked["mainEntity"]
    assert main["ok"] is True  # its bad values and lines don't make the entity itself fail
    assert _value(main, "lastBoot") == {"key": "lastBoot", "value": "2026-10-01",
                                        "quote": "SRV-DB01 holds the Payroll database", "ok": False,
                                        "reason": "synced; not filled by the import"}  # fmt: skip
    assert _value(main, "sources")["reason"] == "the import sets Sources"
    assert _value(main, "operatingSystem")["reason"] == "relations go in relations"
    assert _value(main, "fqdn")["reason"] == "the quote does not say it"
    assert _value(main, "nope")["reason"] == "not a property of the type"
    assert len(main["lines"]) == 3  # at most three per candidate, the rest dropped
    denver, two, long_ = main["lines"]
    assert denver["ok"] is False and denver["reason"] == "the quote is not in the document"
    assert two["ok"] is False and two["reason"] == "a summary line is one short sentence"
    assert long_["ok"] is False and long_["reason"] == "a summary line is one short sentence"

    payroll = dict(table[pages["Payroll"][0]])
    payroll["relations"] = [
        {"subject": "SRV-DB01", "relation": "Runs on", "object": "APP01", "quote": "Payroll runs on APP01",
         "confidence": "high"},
        {"subject": "Payroll", "relation": "Runs on", "object": "Denver", "quote": "Payroll runs on APP01",
         "confidence": "high"},
        {"subject": "Payroll", "relation": "Runs on", "object": "APP01", "quote": "runs on APP01 in Denver",
         "confidence": "high"},
    ]  # fmt: skip
    checked = _check(setup, "Payroll", payroll)
    both, other_object, not_there = checked["relations"]
    assert both["ok"] is False and both["reason"] == "the quote does not name both sides"
    assert other_object["ok"] is False and other_object["reason"] == "the quote does not say it"
    assert not_there["ok"] is False and not_there["reason"] == "the quote is not in the document"


def test_relation_subject_named_by_an_alias(setup: Any) -> None:
    """A subject that isn't the page's main entity must be named in the quote, by its name or an alias."""
    d = _decision(
        mainEntity=None,
        entities=[{"type": "Host", "name": "APP01", "aliases": ["app01.corp.example"], "values": [], "lines": []},
                  {"type": "Location", "name": "HQ", "aliases": [], "values": [], "lines": []}],
        relations=[{"subject": "APP01", "relation": "Located at", "object": "HQ",
                    "quote": "the Payroll server at HQ", "confidence": "high"},
                   {"subject": "APP01", "relation": "Located at", "object": "HQ",
                    "quote": "APP01 is the Payroll server at HQ", "confidence": "high"}],
    )  # fmt: skip
    unnamed, named = _check(setup, "APP01", d)["relations"]
    assert unnamed["ok"] is False and unnamed["reason"] == "the quote does not name both sides"
    assert named["ok"] is True


def test_relation_outside_named_set_is_plain(setup: Any) -> None:
    payroll = _check(setup, "Payroll")
    backs_up = _rel(payroll, "backs up to", "SRV-DB01")
    assert backs_up["ok"] is True
    assert backs_up["plain"] is True


def test_counterpart_name_accepted(setup: Any) -> None:
    d = _decision(
        mainEntity={"type": "Host", "name": "APP01", "aliases": [], "values": [], "lines": []},
        entities=[{"type": "Application", "name": "Payroll", "aliases": [], "values": [], "lines": []}],
        relations=[{"subject": "APP01", "relation": "Runs", "object": "Payroll",
                    "quote": "APP01 is the Payroll server", "confidence": "high"}],
    )  # fmt: skip
    (runs,) = _check(setup, "APP01", d)["relations"]
    assert runs["ok"] is True
    assert runs["plain"] is False


def test_confidence_defaults_to_decision(setup: Any) -> None:
    _space, pages, table = setup
    d = dict(table[pages["Rack notes"][0]])
    d["confidence"] = "low"
    d["entities"] = [*d["entities"], {"type": "Location", "name": "HQ", "aliases": [], "values": [], "lines": [],
                                      "confidence": "medium"},
                     {"type": "Location", "name": "HQ", "aliases": [], "values": [], "lines": [],
                      "confidence": "certain"}]  # fmt: skip
    d["relations"] = [{"subject": "Rack 4", "relation": "Part of", "object": "HQ", "quote": "Rack 4 at HQ"}]
    checked = _check(setup, "Rack notes", d)
    assert [e["confidence"] for e in checked["entities"]] == ["low", "low", "low", "low", "medium", "low"]
    assert checked["relations"][0]["confidence"] == "low"
    assert checked["relations"][0]["ok"] is True and checked["relations"][0]["plain"] is False


def test_merges_need_two_names_and_a_type(setup: Any) -> None:
    d = _decision(merges=[{"type": "Software", "names": ["SQL 2019"]},
                          {"type": "Gizmo", "names": ["SQL 2019", "SQL Server 2019"]},
                          {"type": "Source", "names": ["APP01", "Old APP01 notes"]},
                          {"type": "Software", "names": ["SQL 2019", "SQL Server 2019"]}])  # fmt: skip
    short, gizmo, source, good = _check(setup, "Payroll", d)["merges"]
    assert short["ok"] is False and short["reason"] == "a merge needs at least two names"
    assert gizmo["ok"] is False and gizmo["reason"] == "no such type"
    assert source["ok"] is False and source["reason"] == "a Source is made by the import, not distilled"
    assert good == {"typeId": "software", "names": ["SQL 2019", "SQL Server 2019"], "ok": True}


def test_check_reads_only(setup: Any) -> None:
    space, pages, _table = setup
    root = space.root

    def snapshot() -> dict[str, bytes]:
        return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()
                and ".object-cache" not in p.parts}

    before = snapshot()
    for title in pages:
        _check(setup, title)
    assert snapshot() == before
