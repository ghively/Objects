"""M30 Task 3: resolution, values from all Sources, the entity rule and Gene's review (plan
``2026-11-09-m30-entity-extraction.md``, Task 3; design 2026-11-09 sections 5 and 5a).

The six synthetic pages are written into an IT ops space as Sources (type Source, an ``importSource``
block with the page's modified time), and the filing results are built with `m30_helpers.result`
(checked candidates), so these tests need neither the import (T4) nor the agent.
"""

from __future__ import annotations

import json
from pathlib import Path, PurePosixPath
from typing import Any

import pytest
from m30_helpers import MODIFIED, PAGES, decisions, itops_space, result

from objectapp.importers import batches, entities
from objectapp.space import Space

IMPORTED_AT = "2026-11-09T10:00:00.000Z"


def _when(day: str) -> str:
    return f"{day}T00:00:00.000Z"


def _source_space(base: Path, modified: dict[str, str] | None = None) -> tuple[Path, dict[str, str]]:
    """An IT ops space holding the six pages as imported Sources; (root, title -> path)."""
    base.mkdir(parents=True, exist_ok=True)
    root = itops_space(base)
    paths: dict[str, str] = {}
    for rel, text in PAGES.items():
        title = PurePosixPath(rel).stem
        path = f"Sources/{title}.md"
        fm = "\n".join([
            "---", "type: Source", f"title: {json.dumps(title)}", "importSource:", "  system: files",
            f"  id: {json.dumps(rel)}", f"  modified: {json.dumps(_when((modified or MODIFIED)[rel]))}",
            "  batch: b1", f"  importedAt: {json.dumps(IMPORTED_AT)}", "---",
        ])  # fmt: skip
        f = root / path
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(f"{fm}\n{text}\n", encoding="utf-8")
        paths[title] = path
    return root, paths


def _results(paths: dict[str, str]) -> dict[str, dict[str, Any]]:
    """The checked filing results of the six pages (the fake claude's decisions, all passing)."""
    out: dict[str, dict[str, Any]] = {}
    for path, d in decisions(paths).items():
        rels = [dict(r, plain=True) if r["relation"] == "backs up to" else r for r in d["relations"]]
        out[path] = result(path, confidence=d["confidence"], mainEntity=d["mainEntity"], entities=d["entities"],
                           relations=rels, merges=d["merges"])  # fmt: skip
    return out


def _all(res: entities.Resolution) -> list[entities.Entity]:
    return [*res.entities, *res.leftOut]


def _by_name(res: entities.Resolution, type_id: str, name: str) -> entities.Entity:
    return next(e for e in _all(res) if e.typeId == type_id and e.name == name)


def _snapshot(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_names_and_aliases_merge_within_a_type(tmp_path: Path) -> None:
    assert entities.norm_name("  SQL   Server 2019. ") == "sql server 2019"
    assert entities.norm_name('"(APP01)"') == "app01"
    assert entities.norm_name("ＡＰＰ０１") == "app01"  # NFKC: full-width letters

    root, paths = _source_space(tmp_path)
    db, payroll = paths["SRV-DB01"], paths["Payroll"]
    results = {
        db: result(db, entities=[{"type": "Software", "name": "SQL Server 2019", "aliases": ["SQL 2019"]},
                                 {"type": "Host", "name": "Payroll"}]),
        payroll: result(payroll, mainEntity={"type": "Application", "name": "Payroll"},
                        entities=[{"type": "Software", "name": "sql 2019 "}]),
    }  # fmt: skip
    res = entities.resolve(Space(root), results)

    software = [e for e in _all(res) if e.typeId == "software"]
    assert len(software) == 1
    sw = software[0]
    assert sw.id == "software:sql 2019"
    assert sw.name == "SQL Server 2019" and sw.aliases == ["SQL 2019"]
    assert sw.keys == {"sql 2019", "sql server 2019"}
    assert sw.pages == sorted([db, payroll]) and sw.mainPages == []
    assert sw.rule == "pages" and sw.joinedByAgent is False and sw in res.entities

    # a Host "Payroll" and an Application "Payroll" stay two entities
    ids = {e.id for e in _all(res)}
    assert {"host:payroll", "application:payroll"} <= ids
    assert _by_name(res, "application", "Payroll").rule == "own"
    assert _by_name(res, "host", "Payroll").rule is None
    assert res.pages == [db, payroll]


def test_agent_merge_is_applied_and_offered_as_split(tmp_path: Path) -> None:
    root, paths = _source_space(tmp_path)
    sp = Space(root)
    db, payroll, restart = paths["SRV-DB01"], paths["Payroll"], paths["Restart Payroll"]
    merge = {"type": "Software", "names": ["MSSQL 2019", "SQL Server 2019"]}

    def results(*, merges: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        return {
            db: result(db, entities=[{"type": "Software", "name": "SQL Server 2019", "aliases": ["SQL 2019"]}]),
            payroll: result(payroll, entities=[{"type": "Software", "name": "SQL 2019"}],
                            merges=[{"type": "Software", "names": ["SQL 2019", "SQL Server 2019"]}]),
            restart: result(restart, entities=[{"type": "Software", "name": "MSSQL 2019"}], merges=merges),
        }  # fmt: skip

    # without the agent's merge: two entities, and a merge of names already joined marks nothing
    res = entities.resolve(sp, results(merges=[]))
    assert sorted(e.id for e in _all(res)) == ["software:mssql 2019", "software:sql 2019"]
    assert not any(e.joinedByAgent for e in _all(res))

    # a merge that isn't ok is not applied
    res = entities.resolve(sp, results(merges=[{**merge, "ok": False}]))
    assert len(_all(res)) == 2

    res = entities.resolve(sp, results(merges=[merge]))
    assert len(_all(res)) == 1
    sw = res.entities[0]
    assert sw.id == "software:mssql 2019" and sw.keys == {"mssql 2019", "sql 2019", "sql server 2019"}
    assert sw.name == "SQL Server 2019" and sw.aliases == ["SQL 2019", "MSSQL 2019"]
    assert sw.joinedByAgent is True and sw.pages == sorted([db, payroll, restart])

    # Gene's split takes the agent's name back out
    res = entities.resolve(sp, results(merges=[merge]), {"splits": [{"id": sw.id, "names": ["MSSQL 2019"]}]})
    assert sorted(e.id for e in _all(res)) == ["software:mssql 2019", "software:sql 2019"]
    assert not any(e.joinedByAgent for e in _all(res))
    assert _by_name(res, "software", "MSSQL 2019").pages == [restart]


def test_categories_and_single_mentions_are_left_out(tmp_path: Path) -> None:
    root, paths = _source_space(tmp_path)
    results = _results(paths)
    rack, payroll = paths["Rack notes"], paths["Payroll"]
    # "Docker" is a seed tag (a category even with a value); "Docker 24" is Software (properties of its own);
    # "Wiki" is an option of Source's System, which is not a category (call 17, refined): on two pages, kept
    results[rack]["entities"] += result(rack, entities=[
        {"type": "Software", "name": "Docker", "values": [{"key": "version", "value": "24"}]},
        {"type": "Software", "name": "Docker 24", "values": [{"key": "version", "value": "24"}]},
        {"type": "Application", "name": "Wiki"},
    ])["entities"]  # fmt: skip
    results[payroll]["entities"] += result(payroll, entities=[{"type": "Application", "name": "Wiki"}])["entities"]
    res = entities.resolve(Space(root), results)

    left = {e.name: e for e in res.leftOut}
    assert set(left) == {"Server", "VM", "Rack 4", "Windows Server 2019", "Docker"}
    assert left["Server"].category is True and left["Server"].typeId == "host"  # Host's Category option
    assert left["VM"].category is True  # a seed tag
    assert left["Docker"].category is True and left["Docker"].rule == "properties"
    assert left["Rack 4"].category is False and left["Rack 4"].rule is None
    assert left["Windows Server 2019"].rule is None

    kept = {e.name: e for e in res.entities}
    assert set(kept) == {"APP01", "SRV-DB01", "Payroll", "HQ", "Restart Payroll", "SQL Server 2019", "Docker 24", "Wiki"}
    assert kept["Wiki"].rule == "pages" and not kept["Wiki"].category
    assert kept["HQ"].rule == "pages" and kept["HQ"].pages == sorted([paths["APP01"], rack])
    assert kept["Docker 24"].rule == "properties" and not kept["Docker 24"].category
    assert kept["Restart Payroll"].rule == "own" and kept["Restart Payroll"].typeId == "runbook"
    assert not any(e.category for e in res.entities)


def test_only_category_kind_and_environment_options_are_categories(tmp_path: Path) -> None:
    """A category is an option of a Category, Kind or Environment label (any type but Source), or a
    tag: Host's Roles ("DHCP"), Script's Language ("Python") and Source's Category ("Ticket") are not."""
    root, paths = _source_space(tmp_path)
    results = _results(paths)
    rack, payroll = paths["Rack notes"], paths["Payroll"]
    both = [{"type": "Application", "name": "DHCP"}, {"type": "Application", "name": "Ticket"},
            {"type": "Host", "name": "Production"}, {"type": "Location", "name": "Building"}]
    results[rack]["entities"] += result(rack, entities=both)["entities"]
    results[payroll]["entities"] += result(payroll, entities=[
        *both, {"type": "Software", "name": "Python", "values": [{"key": "version", "value": "3"}]}])["entities"]
    res = entities.resolve(Space(root), results)
    kept = {e.name: e for e in res.entities}
    left = {e.name: e for e in res.leftOut}
    assert {"DHCP", "Ticket", "Python"} <= set(kept)
    assert not any(kept[n].category for n in ("DHCP", "Ticket", "Python"))
    assert left["Production"].category is True  # Host's Environment
    assert left["Building"].category is True  # Location's Kind
    assert left["Server"].category is True  # Host's Category


def test_distilled_from_every_page(tmp_path: Path) -> None:
    root, paths = _source_space(tmp_path)
    res = entities.resolve(Space(root), _results(paths))
    app01 = _by_name(res, "host", "APP01")
    assert app01 in res.entities and app01.id == "host:app01"
    assert app01.rule == "own" and app01.mainPages == [paths["APP01"]]
    assert app01.pages == [paths["APP01"], paths["Old APP01 notes"], paths["Payroll"], paths["Restart Payroll"]]
    assert app01.aliases == ["app01.corp.example"]
    assert [ln["text"] for ln in app01.lines] == ["The Payroll server at HQ.", "Payroll runs on it."]
    assert [s["path"] for s in app01.lines[0]["sources"]] == [paths["APP01"]]
    assert app01.confidence == "high" and app01.existing is None

    sql = _by_name(res, "software", "SQL Server 2019")
    assert sql.aliases == ["SQL 2019"] and sql.joinedByAgent is True  # the agent's merge on Payroll's page
    assert sql.pages == sorted([paths["SRV-DB01"], paths["Payroll"], paths["Restart Payroll"]])
    payroll = _by_name(res, "application", "Payroll")
    assert payroll.pages[0] == paths["Payroll"] and len(payroll.pages) == 4

    assert res.pages == list(_results(paths))
    assert len(res.relations) == 7
    assert all(r["page"] in res.pages for r in res.relations)
    assert {r["relation"] for r in res.relations if r["page"] == paths["Payroll"]} == {"Runs on", "Uses", "backs up to"}


def test_newest_source_wins_and_conflict_kept(tmp_path: Path) -> None:
    def ref(path: str, quote: str, day: str) -> dict[str, Any]:
        return {"path": path, "quote": quote, "modified": _when(day)}

    root, paths = _source_space(tmp_path / "one")
    app01, old, payroll = paths["APP01"], paths["Old APP01 notes"], paths["Payroll"]
    results = _results(paths)
    # the same FQDN from a second page (another case), and a value that failed its check
    results[old]["entities"][0]["values"].append(
        {"key": "fqdn", "value": "APP01.corp.example", "quote": "APP01.corp.example", "ok": True})
    results[payroll]["entities"][0]["values"].append(
        {"key": "ipAddress", "value": "10.0.0.9", "quote": "", "ok": False, "reason": "no quote"})
    res = entities.resolve(Space(root), results)
    host = _by_name(res, "host", "APP01")
    ip = host.values["ipAddress"]
    assert ip["value"] == "10.0.0.5"
    assert ip["sources"] == [ref(app01, "IP address: 10.0.0.5", "2026-10-01")]
    assert ip["conflict"] == [{"value": "10.0.0.6", "sources": [ref(old, "APP01 IP address: 10.0.0.6", "2025-06-01")]}]
    fqdn = host.values["fqdn"]
    assert fqdn["conflict"] is None and [s["path"] for s in fqdn["sources"]] == [app01, old]

    # swap the two pages' modified times: the old notes are now the newer Source
    swapped = {**MODIFIED, "Hosts/APP01.md": MODIFIED["Notes/Old APP01 notes.md"],
               "Notes/Old APP01 notes.md": MODIFIED["Hosts/APP01.md"]}  # fmt: skip
    root2, paths2 = _source_space(tmp_path / "two", swapped)
    res = entities.resolve(Space(root2), _results(paths2))
    ip = _by_name(res, "host", "APP01").values["ipAddress"]
    assert ip["value"] == "10.0.0.6"
    assert ip["conflict"] == [{"value": "10.0.0.5", "sources": [ref(paths2["APP01"], "IP address: 10.0.0.5", "2025-06-01")]}]


def test_existing_object_found(tmp_path: Path) -> None:
    root, paths = _source_space(tmp_path / "one")
    # without one, the batch's own Source titled "APP01" is never the existing object
    res = entities.resolve(Space(root), _results(paths))
    assert all(e.existing is None for e in _all(res))

    (root / "Hosts").mkdir(exist_ok=True)
    (root / "Hosts" / "app01.md").write_text("---\ntype: Host\ntitle: app01\n---\nGene's own host.\n", encoding="utf-8")
    (root / "Hosts" / "Database server.md").write_text(
        "---\ntype: Host\ntitle: Database server\naliases: [SRV-DB01]\n---\n", encoding="utf-8")
    (root / "Software").mkdir(exist_ok=True)
    (root / "Software" / "APP01.md").write_text("---\ntype: Software\ntitle: APP01\n---\n", encoding="utf-8")
    res = entities.resolve(Space(root), _results(paths))
    assert _by_name(res, "host", "APP01").existing == "Hosts/app01.md"  # never Software/APP01.md: another type
    assert _by_name(res, "host", "SRV-DB01").existing == "Hosts/Database server.md"  # by its alias
    assert _by_name(res, "application", "Payroll").existing is None  # Sources/Payroll.md is a Source


def test_review_ops_and_ids(tmp_path: Path) -> None:
    root, paths = _source_space(tmp_path)
    sp = Space(root)
    a, b, c = paths["SRV-DB01"], paths["Payroll"], paths["Restart Payroll"]
    version = [{"key": "version", "value": "2019"}]
    results = {
        a: result(a, mainEntity={"type": "Host", "name": "SRV-DB01"},
                  entities=[{"type": "Software", "name": "SQL Server 2019", "aliases": ["SQL 2019"], "values": version}]),
        b: result(b, mainEntity={"type": "Application", "name": "Payroll"},
                  entities=[{"type": "Software", "name": "SQL 2019", "values": version},
                            {"type": "Host", "name": "SRV-DB01"}]),
        c: result(c, mainEntity={"type": "Runbook", "name": "Restart Payroll"},
                  entities=[{"type": "Software", "name": "MS SQL 2019", "values": version}]),
    }  # fmt: skip
    for batch in ("b1", "b2"):
        batches.batch_dir(root, batch).mkdir(parents=True)
    before = _snapshot(root)

    res = entities.resolve(sp, results)
    assert sorted(e.id for e in res.entities) == [
        "application:payroll", "host:srv-db01", "runbook:restart payroll", "software:ms sql 2019", "software:sql 2019"]  # fmt: skip

    review = {
        "merges": [["software:sql 2019", "software:ms sql 2019"]],
        "splits": [{"id": "software:ms sql 2019", "names": ["SQL 2019"]}],
        "decisions": {
            "software:ms sql 2019": {"status": "renamed", "name": "  SQL Server 2019 Standard "},
            "host:srv-db01": {"status": "rejected"},
            "application:payroll": {"status": "accepted", "name": None},
            "software:sql 2019": {"status": "accepted"},  # the entity's id before the merge: gone
        },
    }
    stored = entities.save_review(sp, "b1", review, results)
    assert stored["decisions"] == {
        "software:ms sql 2019": {"status": "renamed", "name": "SQL Server 2019 Standard"},
        "host:srv-db01": {"status": "rejected"},
        "application:payroll": {"status": "accepted"},
    }
    assert stored["merges"] == review["merges"] and stored["splits"] == review["splits"]
    loaded = entities.load_review(root, "b1")
    assert loaded == stored
    assert json.loads((batches.batch_dir(root, "b1") / entities.REVIEW_FILE).read_text(encoding="utf-8")) == stored

    res = entities.resolve(sp, results, loaded)
    sw = {e.id: e for e in res.entities if e.typeId == "software"}
    assert set(sw) == {"software:ms sql 2019", "software:sql 2019"}
    merged, split_off = sw["software:ms sql 2019"], sw["software:sql 2019"]
    assert merged.keys == {"ms sql 2019", "sql server 2019"} and merged.name == "SQL Server 2019"
    assert merged.aliases == ["MS SQL 2019"] and merged.pages == sorted([a, c])
    assert split_off.keys == {"sql 2019"} and split_off.pages == [b] and split_off.rule == "properties"
    assert {(e.id, name) for e, name in entities.accepted(res, loaded)} == {
        ("application:payroll", "Payroll"), ("software:ms sql 2019", "SQL Server 2019 Standard")}  # fmt: skip
    assert sorted(entities.undecided(res, loaded)) == ["runbook:restart payroll", "software:sql 2019"]

    # refused reviews (422), and the file stays as it was
    bad = [
        {"decisions": {"software:nope": {"status": "accepted"}}},
        {"decisions": {"host:srv-db01": {"status": "maybe"}}},
        {"decisions": {"host:srv-db01": {"status": "renamed", "name": "  "}}},
        {"merges": [["software:sql 2019", "host:srv-db01"]]},
        {"splits": [{"id": "software:sql 2019", "names": ["Nope"]}]},
        {"splits": [{"id": "software:nope", "names": ["SQL 2019"]}]},
    ]
    for r in bad:
        with pytest.raises(entities.ReviewInvalid):
            entities.save_review(sp, "b1", r, results)
    assert entities.load_review(root, "b1") == stored

    # a split that hands the old id to the split-off part: the rest keeps the decision, the split-off starts undecided
    two = {a: results[a], b: results[b]}
    entities.save_review(sp, "b2", {"decisions": {"software:sql 2019": {"status": "accepted"}}}, two)
    stored2 = entities.save_review(sp, "b2", {"decisions": {"software:sql 2019": {"status": "accepted"}},
                                              "splits": [{"id": "software:sql 2019", "names": ["SQL 2019"]}]}, two)
    assert stored2["decisions"] == {"software:sql server 2019": {"status": "accepted"}}
    res2 = entities.resolve(sp, two, stored2)
    assert entities.undecided(res2, stored2) == ["application:payroll", "host:srv-db01", "software:sql 2019"]

    after = _snapshot(root)
    changed = {k for k in before.keys() | after.keys() if before.get(k) != after.get(k)}
    assert changed == {f".object/imports/{x}/{entities.REVIEW_FILE}" for x in ("b1", "b2")}


def test_view_shape_and_reads_write_nothing(tmp_path: Path) -> None:
    root, paths = _source_space(tmp_path)
    sp = Space(root)
    results = _results(paths)
    folder = batches.batch_dir(root, "b1")
    folder.mkdir(parents=True)
    batches.write_json(folder / "batch.json", {"id": "b1", "keepAsSources": True})
    batches.write_json(folder / "items.json", [{"sourcePath": f"{t}.md", "title": t, "path": p, "action": "created"}
                                               for t, p in paths.items()])  # fmt: skip
    before = _snapshot(root)

    v = entities.view(sp, "b1", results, "entities")
    assert set(v) == {"state", "entities", "leftOut", "suggestedMerges", "relations", "sources", "conflicts",
                      "review", "undecided", "written", "writeError"}  # fmt: skip
    assert v["state"] == "review" and v["writeError"] is None
    failed = entities.view(sp, "b1", results, "failed", "disk full")
    assert failed["state"] == "review" and failed["writeError"] == "disk full"
    assert entities.view(sp, "b1", results, "entities", "disk full")["writeError"] is None
    assert [(e["type"], e["name"]) for e in v["entities"]] == [
        ("Application", "Payroll"), ("Host", "APP01"), ("Host", "SRV-DB01"), ("Location", "HQ"),
        ("Runbook", "Restart Payroll"), ("Software", "SQL Server 2019")]  # fmt: skip
    assert v["undecided"] == 6 and v["sources"] == 6 and v["conflicts"] == 1
    assert v["relations"] == {"total": 7, "lowConfidence": 1, "plain": 1}
    assert v["review"] == {"decisions": {}, "merges": [], "splits": []}
    assert v["written"] is None and v["suggestedMerges"] == []
    assert v["leftOut"] == [
        {"id": "host:server", "type": "Host", "name": "Server", "pages": 1, "reason": "category"},
        {"id": "host:vm", "type": "Host", "name": "VM", "pages": 1, "reason": "category"},
        {"id": "location:rack 4", "type": "Location", "name": "Rack 4", "pages": 1, "reason": "text"},
        {"id": "software:windows server 2019", "type": "Software", "name": "Windows Server 2019", "pages": 1,
         "reason": "text"},
    ]  # fmt: skip

    app01 = v["entities"][1]
    assert set(app01) == {"id", "typeId", "type", "name", "aliases", "pages", "mainPages", "values", "summary",
                          "confidence", "joinedByAgent", "existing", "rule", "decision"}  # fmt: skip
    assert app01["id"] == "host:app01" and app01["typeId"] == "host" and app01["aliases"] == ["app01.corp.example"]
    assert app01["pages"][0] == {"path": paths["APP01"], "title": "APP01"} and len(app01["pages"]) == 4
    assert app01["mainPages"] == [paths["APP01"]]
    assert app01["summary"] == ["The Payroll server at HQ.", "Payroll runs on it."]
    assert app01["rule"] == "own" and app01["confidence"] == "high"
    assert app01["existing"] is None and app01["decision"] is None and app01["joinedByAgent"] is False
    values = {x["key"]: x for x in app01["values"]}
    assert [x["key"] for x in app01["values"]] == ["ipAddress", "fqdn"]  # the type's property order
    assert values["ipAddress"] == {
        "key": "ipAddress", "name": "IP address", "value": "10.0.0.5",
        "sources": [{"path": paths["APP01"], "title": "APP01", "quote": "IP address: 10.0.0.5"}],
        "conflict": [{"value": "10.0.0.6", "sources": [
            {"path": paths["Old APP01 notes"], "title": "Old APP01 notes", "quote": "APP01 IP address: 10.0.0.6"}]}],
    }  # fmt: skip
    assert values["fqdn"]["conflict"] is None and values["fqdn"]["name"] == "FQDN"
    assert v["entities"][5]["joinedByAgent"] is True

    # states, a saved decision, a low-confidence side, a near-duplicate and a finished write
    assert entities.view(sp, "b1", results, "running")["state"] == "collecting"
    assert entities.view(sp, "b1", results, "writing")["state"] == "writing"
    for r in (results[paths["APP01"]], results[paths["Rack notes"]]):
        hq = next(e for e in r["entities"] if e["name"] == "HQ")
        hq["confidence"] = "low"
    v = entities.view(sp, "b1", results, "entities")
    assert v["relations"]["lowConfidence"] == 2  # APP01 "Located at" HQ: HQ is low

    assert _snapshot(root) == before  # reads write nothing

    rack = paths["Rack notes"]
    results[rack]["entities"] += result(rack, entities=[{"type": "Host", "name": "SRV DB01"}])["entities"]
    entities.save_review(sp, "b1", {"decisions": {"host:app01": {"status": "accepted"}}}, results)
    outcome = {"created": 6, "existing": 0, "relations": 5, "plainLinks": 1, "relationsInbox": 1, "sections": 6,
               "sectionsLeft": 0, "conflicts": 1, "failed": []}  # fmt: skip
    batches.write_json(batches.batch_dir(root, "b1") / "entities-written.json",
                       {"placed": {}, "done": {}, "outcome": outcome})
    v = entities.view(sp, "b1", results, "done")
    assert v["state"] == "written" and v["written"] == outcome
    assert v["entities"][1]["decision"] == {"status": "accepted"} and v["undecided"] == 5
    assert v["suggestedMerges"] == [{"ids": ["host:srv-db01", "host:srv db01"], "names": ["SRV-DB01", "SRV DB01"]}]
