"""M28 Task 4: computed counterparts (specs, the link index and rows).

Plan ``docs/superpowers/plans/2026-11-09-m28-itops-starter-and-relations.md``, Contract
"Counterparts" and Review Focus 3 and 4; design ``2026-11-09-it-ops-type-model-design.md``
section 2. Every test runs on a copy of the ``space-itops`` fixture.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from objectapp.basicsetup import itops_types
from objectapp.counterparts import (
    COUNTERPART_KIND,
    COUNTERPART_SYNCED,
    COUNTERPART_TAKEN,
    RelationMatch,
    check_type,
    counterpart_defs,
    counterpart_specs,
    edge_label,
    find_relation,
    specs_for,
)
from objectapp.space import Space, version_of
from objectapp.typemodel import PropertyDefinition, TypeDefinition

FIXTURE = Path(__file__).parent / "fixtures" / "space-itops"

APP01 = "Hosts/APP-TEST-01.md"
DB01 = "Hosts/DB-TEST-01.md"
INVENTORY = "Applications/Inventory app.md"
OLD_APP = "Applications/Old app.md"
WEB = "Containers/inventory-web.md"
RUNBOOK = "Runbooks/Restart the inventory app.md"
INCIDENT = "Incidents/Inventory app slow.md"
RACK_NOTES = "Pages/Rack notes.md"

ENTITY_IDS = (
    "host", "software", "application", "container", "configuration", "location", "network",
    "person", "vendor",
)


@pytest.fixture
def itops_dir(tmp_path: Path) -> Path:
    dst = tmp_path / "space-itops"
    shutil.copytree(FIXTURE, dst)
    return dst


def _rows(space: Space, path: str) -> dict[tuple[str, str], dict]:
    """``(key, sourceTypeId) -> row`` of `path`'s counterparts (one row per source type)."""
    out: dict[tuple[str, str], dict] = {}
    for row in space.links.counterparts(path):
        k = (row["key"], row["sourceTypeId"])
        assert k not in out, k
        out[k] = row
    return out


def _paths(space: Space, path: str) -> dict[tuple[str, str], list[str]]:
    return {k: r["paths"] for k, r in _rows(space, path).items()}


def _write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8", newline="\n")


def _object(type_name: str, title: str, fm: str, oid: str) -> str:
    return (
        f"---\nid: {oid}\ntype: {type_name}\ntitle: {title}\n"
        "createdAt: 2026-11-09T09:00:00.000Z\nlastUpdated: 2026-11-09T09:00:00.000Z\n"
        f"{fm}---\n\nBody.\n"
    )


# -- the index ------------------------------------------------------------------------------


def test_host_rows(itops_dir: Path) -> None:
    space = Space(itops_dir)
    rows = _rows(space, APP01)
    assert {k: (r["sourcePropertyKey"], r["paths"]) for k, r in rows.items()} == {
        ("runs", "application"): ("runsOn", [INVENTORY]),
        ("runs", "container"): ("runsOn", [WEB]),  # by its alias, [[app01]]
        ("configuredBy", "configuration"): ("appliesTo", []),
        ("documentedIn", "script"): ("covers", []),
        ("documentedIn", "runbook"): ("covers", [RUNBOOK]),
        ("affectedBy", "project"): ("affects", []),
        ("affectedBy", "incident"): ("affects", []),
    }
    # "Documented in" from Command: a source open to any type, with no value, gives no row.
    assert ("documentedIn", "command") not in rows
    assert rows[("runs", "application")]["name"] == "Runs"
    assert rows[("documentedIn", "runbook")]["name"] == "Documented in"
    assert _paths(space, DB01)[("configuredBy", "configuration")] == ["Configurations/Backup schedule.md"]


def test_other_targets(itops_dir: Path) -> None:
    space = Space(itops_dir)
    windows = _paths(space, "Software/Windows Server 2022.md")
    assert windows[("installedOn", "host")] == [APP01, DB01]
    sql = _paths(space, "Software/SQL Server 2019.md")
    assert sql[("usedBy", "application")] == [INVENTORY]
    assert sql[("installedOn", "host")] == []
    main = _paths(space, "Locations/Main site.md")
    assert main[("contains", "location")] == ["Locations/Rack A.md"]
    assert main[("contains", "network")] == ["Networks/Server VLAN.md"]
    assert main[("contains", "host")] == []
    rack = _paths(space, "Locations/Rack A.md")
    # The Host template links to Rack A too; templates never count.
    assert rack[("contains", "host")] == [APP01]
    assert _paths(space, "People/Sam Example.md")[("owns", "application")] == [INVENTORY]
    app = _paths(space, INVENTORY)
    assert app[("containers", "container")] == [WEB]
    assert app[("affectedBy", "incident")] == [INCIDENT]
    assert app[("affectedBy", "project")] == []
    assert app[("documentedIn", "runbook")] == [RUNBOOK]


def test_only_resolved_relation_values_count(itops_dir: Path) -> None:
    # A self link (an Application running on itself; a Location part of itself) and a path-form link.
    _write(itops_dir, "Applications/Self app.md", _object(
        "Application", "Self app", "runsOn:\n  - '[[Self app]]'\n", "01KM2800000000000000000090"))
    _write(itops_dir, "Locations/Loop.md", _object(
        "Location", "Loop", "partOf: '[[Loop]]'\n", "01KM2800000000000000000091"))
    _write(itops_dir, "Applications/Path app.md", _object(
        "Application", "Path app", "runsOn:\n  - '[[Hosts/DB-TEST-01]]'\n", "01KM2800000000000000000092"))
    space = Space(itops_dir)
    every = [p for p, s in space._summaries.items() if s.template is None]

    def holders(src: str) -> list[str]:
        return [p for p in every for r in space.links.counterparts(p) if src in r["paths"]]

    # A Page's body link and its `runsOn` key (Page has no such relation) add nothing.
    assert holders(RACK_NOTES) == []
    assert RACK_NOTES in space.links.backlinks(APP01)  # still a plain backlink
    assert RACK_NOTES in space.links.backlinks(DB01)
    # An unresolved target adds nothing anywhere.
    assert holders(OLD_APP) == []
    # A self link adds nothing.
    assert holders("Applications/Self app.md") == []
    assert _paths(space, "Locations/Loop.md")[("contains", "location")] == []
    # The path form counts.
    assert _paths(space, DB01)[("runs", "application")] == ["Applications/Path app.md"]
    assert holders("Applications/Path app.md") == [DB01]


def test_rename_keeps_rows(itops_dir: Path) -> None:
    space = Space(itops_dir)
    assert _paths(space, APP01)[("runs", "application")] == [INVENTORY]
    result = space.rename_object(APP01, "APP-TEST-09", version_of(space._raw[APP01].data))
    assert result.path == "Hosts/APP-TEST-09.md"
    after = _paths(space, result.path)
    assert after[("runs", "application")] == [INVENTORY]
    assert after[("runs", "container")] == [WEB]
    assert _rows(space, APP01) == {}


def test_bad_counterparts_are_dropped_and_stored_keys_win(itops_dir: Path) -> None:
    app_json = itops_dir / ".object" / "types" / "application.json"
    data = json.loads(app_json.read_text(encoding="utf-8"))
    runs_on = next(p for p in data["propertyDefinitions"] if p["key"] == "runsOn")
    runs_on["options"]["counterpart"] = "Runs"
    app_json.write_text(json.dumps(data, indent=2), encoding="utf-8")
    space = Space(itops_dir)
    rows = _rows(space, APP01)
    assert ("runs", "application") not in rows
    assert rows[("runs", "container")]["paths"] == [WEB]
    assert "counterpart" not in space.type_by_id("application").prop("runsOn").options

    # A stored `runs` on Host wins over every "Runs" counterpart.
    host_json = itops_dir / ".object" / "types" / "host.json"
    data = json.loads(host_json.read_text(encoding="utf-8"))
    data["propertyDefinitions"].append(
        {"id": "runs", "key": "runs", "name": "Runs", "type": "text", "options": {}}
    )
    host_json.write_text(json.dumps(data, indent=2), encoding="utf-8")
    host_md = itops_dir / APP01
    raw = host_md.read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf---\r\n")
    host_md.write_bytes(raw.replace(b"category: Server\r\n", b"category: Server\r\nruns: hand typed\r\n"))
    space = Space(itops_dir)
    rows = _rows(space, APP01)
    assert not any(k == "runs" for k, _src in rows)
    assert [s.key for s in specs_for("host", space.types) if s.key == "runs"] == []
    assert "runs" not in [p.key for p in counterpart_defs("host", space.types)]
    row = next(r for r in space.rows(["host"], None, None, None, False) if r.summary.path == APP01)
    assert row.values["runs"] == "hand typed"
    assert "runs" not in row.links
    # Container still names "Runs" for Host; nothing breaks, nothing is written.
    assert host_md.read_bytes().count(b"runs: hand typed") == 1


# -- the pure functions ---------------------------------------------------------------------


def test_counterpart_specs() -> None:
    types = itops_types()
    specs = counterpart_specs(types)
    runs = [s for s in specs if s.key == "runs"]
    assert [(s.source_type_id, s.source_key, s.source_name, s.name, s.targets) for s in runs] == [
        ("application", "runsOn", "Runs on", "Runs", ("host", "container")),
        ("container", "runsOn", "Runs on", "Runs", ("host",)),
    ]
    command = next(s for s in specs if s.source_type_id == "command")
    assert command.targets == ()
    # Prompt's "Used on" has no counterpart.
    assert not any(s.source_type_id == "prompt" for s in specs)
    # Every source type with its counterparts, as the Contract table lists them.
    assert {(s.source_type_id, s.source_key, s.key) for s in specs} == {
        ("application", "runsOn", "runs"), ("container", "runsOn", "runs"),
        ("application", "uses", "usedBy"), ("host", "operatingSystem", "installedOn"),
        ("configuration", "appliesTo", "configuredBy"), ("script", "covers", "documentedIn"),
        ("command", "covers", "documentedIn"), ("runbook", "covers", "documentedIn"),
        ("host", "locatedAt", "contains"), ("network", "locatedAt", "contains"),
        ("location", "partOf", "contains"), ("host", "ownedBy", "owns"),
        ("application", "ownedBy", "owns"), ("container", "partOf", "containers"),
        ("project", "affects", "affectedBy"), ("incident", "affects", "affectedBy"),
        *{(tid, "sources", "distilledInto") for tid in ENTITY_IDS},
    }
    # A synced relation gets no computed other side.
    t = next(t for t in types if t.id == "application")
    t.prop("uses").options["propertySyncing"] = {"propertyIds": ["x"]}
    assert not any(s.source_key == "uses" for s in counterpart_specs(types))


def test_counterpart_defs() -> None:
    types = itops_types()
    defs = counterpart_defs("host", types)
    assert [d.key for d in defs] == ["runs", "configuredBy", "documentedIn", "affectedBy"]
    by_key = {d.key: d for d in defs}
    runs = by_key["runs"]
    assert runs.id == "counterpart:runs"
    assert runs.name == "Runs"
    assert runs.type == "entity"
    assert runs.description == ""
    assert runs.icon is not None and runs.icon.to_json() == {"type": "iconify", "val": "ph-arrows-left-right"}
    assert runs.visibility == "hideWhenEmpty"
    assert runs.options["isArray"] is True
    assert runs.options["hasFixedSet"] is False
    assert runs.options["fixedSet"] == []
    assert runs.options["allowedTypes"] == ["application", "container"]
    assert runs.options["counterpartOf"] == [
        {"typeId": "application", "key": "runsOn"},
        {"typeId": "container", "key": "runsOn"},
    ]
    assert by_key["documentedIn"].options["counterpartOf"] == [
        {"typeId": "script", "key": "covers"},
        {"typeId": "command", "key": "covers"},
        {"typeId": "runbook", "key": "covers"},
    ]
    assert by_key["documentedIn"].name == "Documented in"
    assert all(d.visibility == "hideWhenEmpty" for d in defs)
    source = counterpart_defs("source", types)
    assert [d.key for d in source] == ["distilledInto"]
    assert source[0].name == "Distilled into"
    assert source[0].options["counterpartOf"] == [{"typeId": t, "key": "sources"} for t in ENTITY_IDS]
    assert counterpart_defs("nope", types) == []
    # Pure: the types are left as they were.
    assert [d.to_json() for d in counterpart_defs("host", types)] == [d.to_json() for d in defs]


def test_rows_carry_counterparts(itops_dir: Path) -> None:
    space = Space(itops_dir)
    rows = {r.summary.path: r for r in space.rows(["host"], None, None, None, False)}
    row = rows[APP01]
    assert row.values["runs"] == [
        {"target": "Inventory app", "path": INVENTORY},
        {"target": "inventory-web", "path": WEB},
    ]
    assert row.links["runs"] == [INVENTORY, WEB]
    assert row.values["documentedIn"] == [{"target": "Restart the inventory app", "path": RUNBOOK}]
    assert row.values["configuredBy"] == []
    assert row.values["affectedBy"] == []
    # The stored relations are as before.
    assert row.values["operatingSystem"] == [
        {"target": "Windows Server 2022", "path": "Software/Windows Server 2022.md"}
    ]
    assert rows[DB01].values["configuredBy"] == [
        {"target": "Backup schedule", "path": "Configurations/Backup schedule.md"}
    ]
    # A type nothing points at gets no counterpart values.
    page = next(r for r in space.rows(["page"], None, None, None, False) if r.summary.path == RACK_NOTES)
    assert "runs" not in page.values


def test_check_type() -> None:
    types = itops_types()
    by_id = {t.id: t for t in types}
    for t in types:
        assert check_type(t, types) is None, t.id

    label = PropertyDefinition.from_json(
        {"id": "k", "key": "k", "name": "K", "type": "label",
         "options": {"set": [], "counterpart": {"name": "Other", "key": "other"}}}
    )
    host = TypeDefinition.from_json(by_id["host"].to_json())
    host.propertyDefinitions.append(label)
    assert check_type(host, types) == COUNTERPART_KIND

    app = TypeDefinition.from_json(by_id["application"].to_json())
    app.prop("uses").options["propertySyncing"] = {"propertyIds": ["x"]}
    assert check_type(app, types) == COUNTERPART_SYNCED

    app = TypeDefinition.from_json(by_id["application"].to_json())
    app.prop("runsOn").options["counterpart"] = {"name": "Runs", "key": "category"}
    assert check_type(app, types) == COUNTERPART_TAKEN.format(type="Host", key="category")

    # A self-targeting relation is checked against the type as it is being saved.
    loc = TypeDefinition.from_json(by_id["location"].to_json())
    loc.prop("partOf").options["counterpart"] = {"name": "Contains", "key": "kind"}
    assert check_type(loc, types) == COUNTERPART_TAKEN.format(type="Location", key="kind")
    # An "any" relation is never refused for a key some type holds.
    cmd = TypeDefinition.from_json(by_id["command"].to_json())
    cmd.prop("covers").options["counterpart"] = {"name": "Documented in", "key": "category"}
    assert check_type(cmd, types) is None


def test_find_relation() -> None:
    types = itops_types()
    assert find_relation(types, "application", "host", "runs on") == RelationMatch("application", "runsOn", False)
    assert find_relation(types, "host", "application", "Runs") == RelationMatch("application", "runsOn", True)
    assert find_relation(types, "host", "location", "Contains") is None
    assert find_relation(types, "location", "host", "Contains") == RelationMatch("host", "locatedAt", True)
    assert find_relation(types, "host", "container", "runs") == RelationMatch("container", "runsOn", True)
    assert find_relation(types, "application", "page", "Runs on") is None
    assert find_relation(types, "page", "host", "Documented in") is None
    assert find_relation(types, "host", "command", "documented in") == RelationMatch("command", "covers", True)


def test_edge_label() -> None:
    types = {t.id: t for t in itops_types()}
    page = TypeDefinition.from_json(
        {"id": "page", "name": "Page", "pluralName": "Pages", "folder": "Pages",
         "icon": {"type": "iconify", "val": "ph-file"}, "color": "gray", "propertyDefinitions": []}
    )
    assert edge_label(types["application"], ["runsOn", "uses"]) == "Runs on · Uses"
    assert edge_label(types["application"], ["uses", "runsOn", "uses"]) == "Uses · Runs on"
    assert edge_label(page, ["runsOn"]) is None
    assert edge_label(None, ["runsOn"]) is None
    assert edge_label(types["application"], []) is None
    assert edge_label(types["host"], ["category"]) is None  # not a relation
