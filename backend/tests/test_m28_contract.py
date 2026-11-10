"""M28 Task 1: the contract of counterparts and the IT ops setup (plan
``2026-11-09-m28-itops-starter-and-relations.md``, Contract and Task 1): the counterpart option's
shape, the API-only ``counterparts`` key, and the names `counterparts.py` gives the later tasks.
"""

from __future__ import annotations

import dataclasses

import pytest
from pydantic import ValidationError

from objectapp import counterparts
from objectapp.counterparts import (
    COUNTERPART_KEY,
    COUNTERPART_KIND,
    COUNTERPART_NAME,
    COUNTERPART_SYNCED,
    COUNTERPART_TAKEN,
    NO_COUNTERPART,
    WRONG_TYPE,
    CounterpartEditRequest,
    CounterpartRow,
    CounterpartSpec,
    RelationMatch,
)
from objectapp.typemodel import (
    PropertyDefinition,
    TypeDefinition,
    normalize_options,
    option_shape_problems,
    valid_counterpart,
)


def test_counterpart_option_shape() -> None:
    assert option_shape_problems({"counterpart": "Runs"}) == ["counterpart"]
    assert option_shape_problems({"counterpart": {"name": "Runs", "key": "runs"}}) == []
    assert option_shape_problems({"counterpart": None}) == []
    for bad in (
        {"name": "", "key": "runs"},
        {"name": "Runs", "key": "has space"},
        {"name": "Runs", "key": "title"},
        {"name": "a\nb", "key": "x"},
        {"name": "x" * 61, "key": "x"},
        {"name": "Runs"},
        {"key": "runs"},
        {"name": "Runs", "key": "1runs"},
        {"name": "Runs", "key": "run-s"},
        {"name": "Runs", "key": "x" * 61},
        {"name": "Runs", "key": "backlinks"},
        {"name": "Runs", "key": "lastUpdated"},
        {"name": 3, "key": "runs"},
        ["Runs", "runs"],
        3,
    ):
        assert option_shape_problems({"counterpart": bad}) == ["counterpart"], bad
        assert not valid_counterpart(bad), bad
    assert valid_counterpart({"name": "x" * 60, "key": "x" * 60})
    assert valid_counterpart({"name": "Distilled into", "key": "distilledInto"})
    # The other option checks are unchanged.
    assert option_shape_problems({"allowedTypes": "host", "counterpart": "Runs"}) == [
        "allowedTypes",
        "counterpart",
    ]


def test_bad_counterpart_is_dropped_on_read() -> None:
    p = PropertyDefinition.from_json(
        {"id": "p1", "key": "runsOn", "name": "Runs on", "type": "entity", "options": {"counterpart": 3}}
    )
    assert "counterpart" not in p.options
    assert p.options["allowedTypes"] == []
    good = PropertyDefinition.from_json(
        {
            "id": "p2",
            "key": "runsOn",
            "name": "Runs on",
            "type": "entity",
            "options": {"allowedTypes": ["host"], "counterpart": {"name": "Runs", "key": "runs"}},
        }
    )
    assert good.options["counterpart"] == {"name": "Runs", "key": "runs"}
    assert good.to_json()["options"]["counterpart"] == {"name": "Runs", "key": "runs"}
    assert normalize_options("entity", {"counterpart": None}) == {"counterpart": None}


def test_counterparts_is_api_only() -> None:
    t = TypeDefinition.from_json(
        {
            "schemaVersion": 2,
            "id": "host",
            "name": "Host",
            "pluralName": "Hosts",
            "folder": "Hosts",
            "propertyDefinitions": [],
            "counterparts": [{"id": "counterpart:runs", "key": "runs", "name": "Runs", "type": "entity"}],
        }
    )
    assert "counterparts" not in t.extra
    assert "counterparts" not in t.to_json()


def test_texts() -> None:
    assert COUNTERPART_NAME == "Name the other side in 1 to 60 characters, on one line."
    assert COUNTERPART_KEY == "The other side's key can't be used."
    assert COUNTERPART_KIND == "Only a relation can have an other side."
    assert COUNTERPART_SYNCED == "A relation that syncs both ways can't also have a computed other side."
    assert COUNTERPART_TAKEN.format(type="Host", key="category") == (
        'Host already has a property with the key "category".'
    )
    assert NO_COUNTERPART.format(key="nope", type="Application") == (
        'This object has no "nope" relation from Application.'
    )
    assert WRONG_TYPE.format(title="Sam Example", type="Application") == (
        '"Sam Example" isn\'t of type Application.'
    )
    assert counterparts.GONE == "It's gone."
    assert counterparts.valid_counterpart is valid_counterpart


def test_shapes() -> None:
    row: CounterpartRow = {
        "key": "runs",
        "name": "Runs",
        "sourceTypeId": "application",
        "sourcePropertyKey": "runsOn",
        "paths": ["Applications/Inventory app.md"],
    }
    assert set(CounterpartRow.__annotations__) == set(row)
    spec = CounterpartSpec("application", "runsOn", "Runs on", "runs", "Runs", ("host", "container"))
    assert [f.name for f in dataclasses.fields(spec)] == [
        "source_type_id",
        "source_key",
        "source_name",
        "key",
        "name",
        "targets",
    ]
    with pytest.raises(dataclasses.FrozenInstanceError):
        spec.key = "x"  # type: ignore[misc]
    match = RelationMatch("application", "runsOn", False)
    assert [f.name for f in dataclasses.fields(match)] == ["source_type_id", "property_key", "reversed"]
    assert match == RelationMatch(source_type_id="application", property_key="runsOn", reversed=False)

    req = CounterpartEditRequest(path="Hosts/DB-TEST-01.md", key="runs", sourceTypeId="application")
    assert (req.add, req.remove, req.clientId) == ([], [], None)
    req.add.append("x")
    assert CounterpartEditRequest(path="p", key="k", sourceTypeId="s").add == []
    with pytest.raises(ValidationError):
        CounterpartEditRequest(path="p", key="k")  # type: ignore[call-arg]


def test_stubs_are_named() -> None:
    for name in (
        "counterpart_specs",
        "specs_for",
        "counterpart_defs",
        "check_type",
        "find_relation",
        "edge_label",
    ):
        assert callable(getattr(counterparts, name)), name
