"""M30 Task 1: the contract of entity extraction and distillation (plan
``2026-11-09-m30-entity-extraction.md``, Contract and Task 1): the names, constants and shapes the
five new modules give the later tasks, and the synthetic IT ops source and space of `m30_helpers`.
"""

from __future__ import annotations

import dataclasses
import json
import os
import typing
from datetime import UTC, datetime

import pytest
from m30_helpers import (
    MODIFIED,
    PAGES,
    decisions,
    import_as_sources,
    itops_space,
    make_itops_source,
    result,
    simple_lines,
    simple_pick,
    t4_landed,
)

from objectapp.importers import distill, entities, entitycheck, entitywrite, sources
from objectapp.space import Space


def test_contract_names() -> None:
    assert entitycheck.MIN_PAGES == 2
    assert entitycheck.MAX_LINE == 200
    assert entities.STATUSES == ("accepted", "renamed", "rejected")
    assert entities.REVIEW_FILE == "entities-review.json"
    assert entitywrite.WRITTEN_FILE == "entities-written.json"
    assert sources.SOURCE_TYPE_ID == "source"
    assert sources.SOURCE_READ_ONLY == "Imported source"
    assert sources.SYSTEM_LABELS == {
        "sharepoint": "SharePoint", "wiki": "Wiki", "notion": "Notion", "obsidian": "Obsidian",
        "anytype": "Anytype", "files": "Files", "markdown": "Markdown",
    }  # fmt: skip
    assert distill.SECTION_OPEN == "<!-- group from-sources -->"
    assert distill.SECTION_CLOSE == "<!-- /group -->"
    assert distill.SECTION_HEADING == "## From sources"
    assert distill.DISAGREE_HEADING == "Sources disagree:"
    assert distill.ALSO_LINKED == "Also linked:"
    assert distill.MAX_LINES == 12
    assert distill.DISTILLED_DIR == "distilled"
    assert issubclass(distill.SectionEdited, Exception)
    assert issubclass(entities.ReviewInvalid, ValueError)

    assert [f.name for f in dataclasses.fields(entities.Entity)] == [
        "id", "typeId", "type", "name", "aliases", "keys", "pages", "mainPages", "values", "lines",
        "confidence", "joinedByAgent", "rule", "category", "existing",
    ]  # fmt: skip
    assert [f.name for f in dataclasses.fields(entities.Resolution)] == [
        "entities", "leftOut", "suggestedMerges", "relations", "pages",
    ]  # fmt: skip
    assert set(typing.get_type_hints(distill.SourceRef)) == {"path", "quote", "modified"}
    assert set(typing.get_type_hints(distill.PickedValue)) == {"value", "sources", "conflict"}
    assert set(typing.get_type_hints(distill.SummaryLine)) == {"text", "sources"}

    # the functions the later tasks fill (stubs raising NotImplementedError until then)
    for mod, names in (
        (entitycheck, ["check_candidates"]),
        (entities, ["norm_name", "resolve", "load_review", "save_review", "accepted", "undecided", "view"]),
        (sources, ["keep_as_sources", "ensure_source_type", "category_for", "system_label",
                   "is_imported_source", "is_source_batch"]),
        (distill, ["pick_values", "summary_lines", "build_section", "find_section", "replace_section",
                   "section_hash", "load_record", "save_record"]),
        (entitywrite, ["write_entities"]),
    ):
        for name in names:
            assert callable(getattr(mod, name)), (mod.__name__, name)


def test_itops_source_and_space(tmp_path) -> None:
    src = make_itops_source(tmp_path)
    files = sorted(p.relative_to(src).as_posix() for p in src.rglob("*") if p.is_file())
    assert files == sorted(PAGES) and len(files) == 6
    raw = (src / "Hosts" / "SRV-DB01.md").read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf") and b"\r\n" in raw and b"\n" not in raw.replace(b"\r\n", b"")
    assert "SQL Server 2019" in raw.decode("utf-8-sig")
    for rel, when in MODIFIED.items():
        assert datetime.fromtimestamp(os.stat(src / rel).st_mtime, UTC).date().isoformat() == when
    assert MODIFIED["Hosts/APP01.md"] == "2026-10-01" and MODIFIED["Notes/Old APP01 notes.md"] == "2025-06-01"

    root = itops_space(tmp_path)
    sp = Space(root)
    names = {t.name for t in sp.types}
    assert {"Host", "Software", "Application", "Location", "Runbook", "Source"} <= names
    host = sp.type_by_id("host")
    assert host is not None
    prop = host.prop("sources")
    assert prop is not None and prop.options["counterpart"] == {"name": "Distilled into", "key": "distilledInto"}
    assert prop.options["allowedTypes"] == ["source"]


def test_decisions_and_result_shapes() -> None:
    paths = {title: f"Imported/{title}.md" for title in (
        "APP01", "SRV-DB01", "Payroll", "Restart Payroll", "Rack notes", "Old APP01 notes")}  # fmt: skip
    table = decisions(paths)
    assert set(table) == set(paths.values())
    json.dumps(table)  # what FAKE_CLAUDE_FILING carries
    app01 = table["Imported/APP01.md"]
    assert app01["mainEntity"]["type"] == "Host" and app01["mainEntity"]["name"] == "APP01"
    assert app01["type"] is None and app01["values"] == [] and app01["links"] == []
    assert table["Imported/Rack notes.md"]["mainEntity"] is None
    assert any(m["names"] == ["SQL 2019", "SQL Server 2019"] for m in table["Imported/Payroll.md"]["merges"])

    r = result("Imported/APP01.md", mainEntity={"type": "Host", "name": "APP01"},
               relations=[{"subject": "Payroll", "relation": "Runs on", "object": "APP01"}])
    assert r["path"] == r["origPath"] == "Imported/APP01.md" and r["title"] == "APP01"
    main = r["mainEntity"]
    assert main["typeId"] == "host" and main["main"] is True and main["ok"] is True
    assert main["aliases"] == [] and main["values"] == [] and main["lines"] == [] and main["confidence"] == "high"
    rel = r["relations"][0]
    assert rel["ok"] is True and rel["plain"] is False and rel["confidence"] == "high"
    assert r["entities"] == [] and r["merges"] == []
    assert result("x.md", confidence="low", entities=[{"type": "Software", "name": "SQL 2019"}])["entities"][0]["confidence"] == "low"


def test_simple_pick_reference() -> None:
    found = {
        "ipAddress": [
            {"value": "10.0.0.6", "quote": "IP address: 10.0.0.6", "page": "S/Old.md", "modified": "2025-06-01T00:00:00Z"},
            {"value": "10.0.0.5", "quote": "IP address: 10.0.0.5", "page": "S/APP01.md", "modified": "2026-10-01T00:00:00Z"},
        ],
        "fqdn": [
            {"value": "app01.corp.example", "quote": "q1", "page": "S/APP01.md", "modified": "2026-10-01T00:00:00Z"},
            {"value": "APP01.corp.example", "quote": "q2", "page": "S/B.md", "modified": None},
        ],
    }
    picked = simple_pick(found, {"S/APP01.md"})
    assert picked["ipAddress"]["value"] == "10.0.0.5"
    assert picked["ipAddress"]["conflict"] == [{"value": "10.0.0.6", "sources": [
        {"path": "S/Old.md", "quote": "IP address: 10.0.0.6", "modified": "2025-06-01T00:00:00Z"}]}]
    assert picked["fqdn"]["conflict"] is None and len(picked["fqdn"]["sources"]) == 2
    tie = simple_pick({"k": [{"value": "a", "quote": "", "page": "S/Z.md", "modified": None},
                             {"value": "b", "quote": "", "page": "S/Y.md", "modified": None}]}, {"S/Z.md"})
    assert tie["k"]["value"] == "a"
    lines = simple_lines([{"text": "Runs Payroll.", "quote": "q", "page": "S/B.md", "modified": None},
                          {"text": "runs payroll", "quote": "q", "page": "S/A.md", "modified": None}], set())
    assert len(lines) == 1 and [s["path"] for s in lines[0]["sources"]] == ["S/A.md", "S/B.md"]


@pytest.mark.xfail(not t4_landed(), reason="Keep pages as Sources lands in M30 Task 4", strict=True)
def test_import_as_sources(tmp_path) -> None:
    root = itops_space(tmp_path)
    batch = import_as_sources(root, make_itops_source(tmp_path))
    assert sources.is_source_batch(root, batch)
