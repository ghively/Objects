"""M28 Task 7: the type gallery's IT ops entries (plan ``2026-11-09-m28-itops-starter-and-relations.md``,
Task 7 and "Our calls" 14; design ``2026-11-09-it-ops-type-model-design.md`` section 6)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from objectapp.basicsetup import itops_types, source_type
from objectapp.counterparts import counterpart_defs
from objectapp.space import Space
from objectapp.typemodel import Icon, TypeDefinition, system_property_defs
from objectapp.typetemplates import (
    TEMPLATE_KEYS,
    TEMPLATE_QUERIES,
    build_template,
    template_catalog,
    template_query,
    template_query_fixture,
)

ITOPS_KEYS = (
    "host", "software", "application", "container", "configuration", "location", "network",
    "vendor", "script", "command", "runbook", "prompt", "incident",
)  # fmt: skip

FIXTURE = Path(__file__).parents[2] / "frontend" / "src" / "types" / "templateQueries.fixture.json"


def _starter() -> dict[str, TypeDefinition]:
    return {t.id: t for t in itops_types()}


def test_gallery_has_itops() -> None:
    cat = template_catalog([])
    keys = [c["key"] for c in cat]
    ours = [c for c in cat if c["section"] == "itOperations"]
    assert [c["key"] for c in ours] == list(ITOPS_KEYS)
    # After "Planning and reflection", before the unsectioned row.
    assert keys.index("host") == keys.index("month") + 1
    assert keys[keys.index("incident") + 1 :] == ["organization", "area"]
    assert TEMPLATE_KEYS == tuple(keys)
    # Person, Meeting and Project stay the basic entries; Source is not offered.
    assert keys.count("person") == keys.count("meeting") == keys.count("project") == 1
    assert "source" not in keys
    starter = _starter()
    for c in ours:
        t = starter[c["key"]]
        assert (c["name"], c["pluralName"], c["description"]) == (t.name, t.pluralName, t.description)
        assert c["icon"] == {"type": "iconify", "val": t.icon.val}
        assert c["color"] == t.color
        own = [p for p in t.propertyDefinitions if not p.type.startswith("entity_")]
        assert c["properties"] == [{"name": p.name, "type": p.type} for p in own]
        assert c["added"] is False
    # A space with the IT ops types has them all added (by name).
    added = {c["key"] for c in template_catalog(itops_types()) if c["added"]}
    assert set(ITOPS_KEYS) <= added


def _made(key: str, type_id: str) -> TypeDefinition:
    t = _starter()[key]
    t.id = type_id
    return t


def test_built_relations_resolve() -> None:
    types = [_made("host", "server"), _made("software", "program")]
    props = {p.key: p for p in build_template("application", types)}
    assert props["runsOn"].options["allowedTypes"] == ["server"]
    assert props["runsOn"].options["counterpart"] == {"name": "Runs", "key": "runs"}
    assert props["uses"].options["allowedTypes"] == ["program"]
    assert props["uses"].options["counterpart"] == {"name": "Used by", "key": "usedBy"}
    # No host type: any type, and the other side is kept.
    props = {p.key: p for p in build_template("application", [])}
    assert props["runsOn"].options["allowedTypes"] == []
    assert props["runsOn"].options["counterpart"] == {"name": "Runs", "key": "runs"}
    # The Sources relation points at the space's Source type when there is one.
    props = {p.key: p for p in build_template("host", [source_type()])}
    assert props["sources"].options["allowedTypes"] == [source_type().id]
    assert props["sources"].options["counterpart"] == {"name": "Distilled into", "key": "distilledInto"}
    assert props["sources"].visibility == "hideWhenEmpty"
    # Fresh definitions each time.
    a = {p.key: p.id for p in build_template("host", [])}
    b = {p.key: p.id for p in build_template("host", [])}
    # M29: Host's synced facts keep ``id == key`` (Contract); the rest are fresh.
    synced = {"lastBoot", "diskFree", "patchState", "rebootPending", "lastSeen"}
    assert a.keys() == b.keys() and all(a[k] != b[k] for k in a if k not in synced)
    assert all(a[k] == b[k] == k for k in synced)


@pytest.mark.parametrize("key", ITOPS_KEYS)
def test_queries_build(key: str) -> None:
    assert key in TEMPLATE_QUERIES
    t = TypeDefinition(
        id=key, name=key, pluralName=key, folder=key, icon=Icon("iconify", "ph-file"), color="gray",
        propertyDefinitions=[*system_property_defs(), *build_template(key, [])],
    )  # fmt: skip
    name, definition, view = template_query(key, t)
    assert name == TEMPLATE_QUERIES[key].name
    assert definition["types"] == [{"id": key}]
    assert view["viewDefinition"]["dataViewLayout"] in ("list", "table")


def test_query_names() -> None:
    assert {k: TEMPLATE_QUERIES[k].name for k in ITOPS_KEYS} == {
        "host": "Production hosts",
        "software": "Software by product",
        "application": "Live applications",
        "container": "All containers A-Z",
        "configuration": "All configurations A-Z",
        "location": "Sites",
        "network": "All networks A-Z",
        "vendor": "Contracts ending",
        "script": "Recently updated scripts",
        "command": "All commands A-Z",
        "runbook": "Runbooks to review",
        "prompt": "All prompts A-Z",
        "incident": "Open incidents",
    }
    assert TEMPLATE_QUERIES["host"].layout == "table"
    assert TEMPLATE_QUERIES["software"].sorts == (("product", "ascending"), ("version", "descending"))
    assert TEMPLATE_QUERIES["network"].layout == "table"


def test_fixture_is_current() -> None:
    fixture = json.loads(FIXTURE.read_text("utf-8"))
    assert fixture == json.loads(json.dumps(template_query_fixture(), ensure_ascii=False))
    assert set(ITOPS_KEYS) <= fixture.keys()


def test_create_itops_type_from_the_gallery(tmp_path: Path) -> None:
    space_dir = tmp_path / "s"
    space_dir.mkdir()
    sp = Space(space_dir)
    host = sp.create_type("", "", template="host")
    assert (host.name, host.pluralName, host.color) == ("Host", "Hosts", "blue")
    app = sp.create_type("", "", template="application")
    runs_on = app.prop("runsOn")
    assert runs_on is not None and runs_on.options["allowedTypes"] == [host.id]
    assert runs_on.options["counterpart"] == {"name": "Runs", "key": "runs"}
    stored = json.loads((space_dir / ".object" / "types" / f"{app.id}.json").read_text("utf-8"))
    assert stored["templateKey"] == "application"
    # The new Host gets the Application's "Runs" as its other side.
    assert [d.key for d in counterpart_defs(host.id, sp.types)] == ["runs"]


def test_gallery_type_without_a_source_type_has_no_sources(tmp_path: Path) -> None:
    """Fix pass, finding 11: with no Source type in the space, a gallery IT ops type leaves its
    Sources relation out (else it is open to any type, and whatever it links shows a "Distilled
    into" row); M30 adds it when it makes Source. With a Source type it is kept, pointing at it."""
    space_dir = tmp_path / "s"
    space_dir.mkdir()
    sp = Space(space_dir)
    host = sp.create_type("", "", template="host")
    assert host.prop("sources") is None
    stored = json.loads((space_dir / ".object" / "types" / f"{host.id}.json").read_text("utf-8"))
    assert "sources" not in [p["key"] for p in stored["propertyDefinitions"]]
    from objectapp.counterparts import counterpart_specs

    assert all(s.key != "distilledInto" for s in counterpart_specs(sp.types))
    assert host.prop("notes") is not None and host.prop("ownedBy") is not None

    with_source = tmp_path / "t"
    with_source.mkdir()
    (with_source / ".object" / "types").mkdir(parents=True)
    from objectapp.basicsetup import write_type_json

    write_type_json(with_source, source_type(), "")
    sp = Space(with_source)
    host = sp.create_type("", "", template="host")
    assert host.prop("sources") is not None
    assert host.prop("sources").options["allowedTypes"] == ["source"]
