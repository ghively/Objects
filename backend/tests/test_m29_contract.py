"""M29 Task 1: the contract of synced facts and type suggestion (plan
``2026-11-09-m29-synced-facts-and-type-suggestion.md``, Contract and Task 1): the synced mark and
name patterns in the type model, the ``sync`` token scope, the names the stubs give the later
tasks, and the synthetic ``space-synced`` fixture.
"""

from __future__ import annotations

import dataclasses
import json
import re
import typing
from pathlib import Path

import pytest

from objectapp import api_v1_synced, synced, typesuggest
from objectapp.tokens import SCOPE_MESSAGE, SCOPES, TokenStore
from objectapp.typemodel import (
    MAX_STALE_DAYS,
    MAX_SYNC_SOURCE,
    SYNCABLE_KINDS,
    SYNCED_STALE_DEFAULT,
    PropertyDefinition,
    SyncedSpec,
    TypeDefinition,
    synced_problems,
)
from objectapp.watcher import ChangeEvent

FIXTURE = Path(__file__).parent / "fixtures" / "space-synced"


def _entry(**over: object) -> dict:
    out: dict = {"id": "p1", "key": "diskFree", "name": "Disk free", "type": "number"}
    out.update(over)
    return out


def test_synced_spec_roundtrip() -> None:
    p = PropertyDefinition.from_json(_entry(synced={"source": "Inventory script"}))
    assert p.synced == SyncedSpec("Inventory script", 7)
    assert p.to_json()["synced"] == {"source": "Inventory script", "staleAfterDays": 7}
    assert "synced" not in p.extra
    p2 = PropertyDefinition.from_json(_entry(synced={"source": "Inventory script", "staleAfterDays": 3}))
    assert p2.synced == SyncedSpec("Inventory script", 3)
    assert SyncedSpec.parse({"source": "Inventory script", "staleAfterDays": 3}).to_json() == {
        "source": "Inventory script",
        "staleAfterDays": 3,
    }

    plain = PropertyDefinition.from_json(_entry())
    assert plain.synced is None
    assert "synced" not in plain.to_json()

    bad = PropertyDefinition.from_json(_entry(synced="yes"))
    assert bad.synced is None
    assert bad.extra["synced"] == "yes"
    assert bad.to_json()["synced"] == "yes"
    for malformed in ("yes", 3, [], {}, {"source": ""}, {"source": 5}, {"source": "x", "staleAfterDays": "7"}):
        assert SyncedSpec.parse(malformed) is None, malformed

    assert (SYNCED_STALE_DEFAULT, MAX_SYNC_SOURCE, MAX_STALE_DAYS) == (7, 60, 365)
    assert SYNCABLE_KINDS == frozenset(
        {"text", "url", "number", "boolean", "datetime", "datetimeSimple", "label"}
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        SyncedSpec("x").source = "y"  # type: ignore[misc]


def _type(**over: object) -> dict:
    out: dict = {
        "schemaVersion": 2,
        "id": "host",
        "name": "Host",
        "pluralName": "Hosts",
        "folder": "Hosts",
        "propertyDefinitions": [],
    }
    out.update(over)
    return out


def test_name_patterns_roundtrip() -> None:
    empty = TypeDefinition.from_json(_type())
    assert empty.namePatterns == []
    assert "namePatterns" not in empty.to_json()
    assert "namePatterns" not in TypeDefinition.from_json(_type(namePatterns=[])).to_json()

    t = TypeDefinition.from_json(_type(namePatterns=["{ip}", 5]))
    assert t.namePatterns == ["{ip}", 5]
    assert "namePatterns" not in t.extra
    assert t.to_json()["namePatterns"] == ["{ip}", 5]
    assert t.to_api("r")["namePatterns"] == ["{ip}", 5]

    odd = TypeDefinition.from_json(_type(namePatterns="SRV-*"))
    assert odd.namePatterns == []
    assert odd.to_json()["namePatterns"] == "SRV-*"


def test_synced_problems() -> None:
    assert synced_problems(_entry()) == []
    assert synced_problems(_entry(synced=None)) == []
    assert synced_problems(_entry(synced={"source": "Inventory script"})) == []
    for kind in sorted(SYNCABLE_KINDS):
        assert synced_problems(_entry(type=kind, synced={"source": "Inventory script"})) == [], kind

    kind_msg = (
        '"Disk free" can\'t be synced: only text, URL, number, checkbox, date and label '
        "properties can."
    )
    source_msg = 'The source of "Disk free" must be 1-60 characters on one line.'
    stale_msg = '"Stale after" of "Disk free" must be a whole number of days from 1 to 365.'
    assert synced_problems(_entry(type="entity", synced={"source": "Inventory script"})) == [kind_msg]
    for source in ("", "   ", "a\nb", "x" * 61, 5, None):
        assert synced_problems(_entry(synced={"source": source})) == [source_msg], source
    assert synced_problems(_entry(synced="yes")) == [source_msg]
    assert synced_problems(_entry(synced={"source": "x" * 60})) == []
    for days in (0, 366, -1, 1.5, "7", True):
        assert synced_problems(_entry(synced={"source": "Inventory script", "staleAfterDays": days})) == [
            stale_msg
        ], days
    for days in (1, 365):
        assert synced_problems(_entry(synced={"source": "Inventory script", "staleAfterDays": days})) == []
    # A property without a name is named by its key.
    unnamed = {"key": "diskFree", "type": "relation", "synced": {"source": "Inventory script"}}
    assert synced_problems(unnamed) == [kind_msg.replace("Disk free", "diskFree")]


def test_scopes(tmp_path: Path) -> None:
    assert SCOPES == ("read", "read-write", "sync")
    assert SCOPE_MESSAGE == "scope must be read, read-write or sync."
    store = TokenStore(tmp_path / "space", folder=tmp_path / "state")
    record, secret = store.create("Inventory", "sync")
    assert record.scope == "sync"
    assert [t.scope for t in store.list()] == ["sync"]
    assert store.verify(secret) is not None
    with pytest.raises(ValueError, match=re.escape(SCOPE_MESSAGE)):
        store.create("Admin", "admin")
    with pytest.raises(ValueError, match=re.escape(SCOPE_MESSAGE)):
        store.ephemeral("Turn", "admin")


def test_synced_change_kind() -> None:
    kinds = typing.get_args(ChangeEvent.__annotations__["kind"])
    if not kinds:  # postponed annotations
        kinds = typing.get_args(typing.get_type_hints(ChangeEvent)["kind"])
    assert "synced" in kinds
    assert ChangeEvent("synced", "host", "rev1").linked is None


def test_stubs_are_named() -> None:
    assert (synced.FOLDER, synced.MAX_ITEMS, synced.MAX_MATCH_VALUE) == ("synced", 1000, 300)
    assert typing.get_args(synced.MatchBy) == ("title", "alias", "key")
    assert typing.get_args(synced.ItemStatus) == ("updated", "notFound", "ambiguous", "invalid")
    entry = synced.SyncedEntry(values={"diskFree": 12}, refreshedAt="2026-11-09T08:00:00.000Z")
    with pytest.raises(dataclasses.FrozenInstanceError):
        entry.refreshedAt = "x"  # type: ignore[misc]
    assert [f.name for f in dataclasses.fields(synced.Candidate)] == [
        "path",
        "objectId",
        "title",
        "aliases",
        "keys",
    ]
    result = synced.ItemResult(index=0, status="updated")
    assert (result.path, result.objectId, result.paths, result.detail) == (None, None, None, None)
    assert [f.name for f in dataclasses.fields(synced.SyncOutcome)] == [
        "typeId",
        "refreshedAt",
        "revision",
        "results",
        "idWrites",
    ]
    for name in (
        "synced_props",
        "is_stale",
        "norm",
        "find_matches",
        "check_match",
        "encode_facts",
    ):
        assert callable(getattr(synced, name)), name
    for name in ("data", "entry", "overlay", "apply"):
        assert callable(getattr(synced.SyncedStore, name)), name
    assert synced.SYNCED_READ_ONLY.format(name="Disk free", source="Inventory script") == (
        '"Disk free" is filled by Inventory script and can\'t be edited.'
    )

    assert (typesuggest.MAX_PATTERNS, typesuggest.MAX_PATTERN) == (20, 100)
    assert typesuggest.TOKENS == ("{ip}", "{cidr}", "{fqdn}", "{version}")
    ctx = typesuggest.SuggestContext(types=[])
    assert (tuple(ctx.allowed), tuple(ctx.scope), ctx.last) == ((), (), None)
    for name in ("compile_pattern", "pattern_problems", "matches", "suggest_type"):
        assert callable(getattr(typesuggest, name)), name

    assert callable(api_v1_synced.router)


def test_fixture_space_is_synthetic() -> None:
    files = sorted(p for p in FIXTURE.rglob("*") if p.is_file())
    rel = {p.relative_to(FIXTURE).as_posix() for p in files}
    assert {
        ".object/types/host.json",
        ".object/types/network.json",
        ".object/types/software.json",
        "Hosts/APP01.md",
        "Hosts/SRV-02.md",
        "Hosts/Print box.md",
        "Hosts/WEB01.md",
        "Hosts/Lab/WEB01.md",
        "Hosts/Gateway.md",
        "Pages/APP01.md",
        "Hosts/Templates/Host template.md",
    } <= rel
    allowed_stems = {"APP01", "SRV-02", "Print box", "WEB01", "Gateway", "Host template"}
    assert {p.stem for p in files if p.suffix == ".md"} <= allowed_stems
    for p in files:
        text = p.read_bytes().decode("utf-8-sig")
        for host in re.findall(r"\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,}\b", text.lower()):
            assert host.endswith(".example.test"), (p, host)
        for ip in re.findall(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", text):
            assert ip.startswith("10.20."), (p, ip)
        assert not re.search(r"[\w.+-]+@[\w-]+\.[a-z]", text), p  # no e-mail addresses

    srv = (FIXTURE / "Hosts" / "SRV-02.md").read_bytes()
    assert srv.startswith(b"\xef\xbb\xbf")
    assert b"\r\n" in srv and b"\n" not in srv.replace(b"\r\n", b"")
    assert b"lastBoot: 2020-01-01T00:00:00.000Z\r\n" in srv
    assert b"\nid: " in srv

    assert not re.search(r"(?m)^id:", (FIXTURE / "Hosts" / "Print box.md").read_text("utf-8"))
    assert "PRN-TEST-01" in (FIXTURE / "Hosts" / "Print box.md").read_text("utf-8")
    assert "excludeFromAI: true" in (FIXTURE / "Hosts" / "Gateway.md").read_text("utf-8")
    template = (FIXTURE / "Hosts" / "Templates" / "Host template.md").read_text("utf-8")
    assert "template: Host template" in template
    app01 = (FIXTURE / "Hosts" / "APP01.md").read_text("utf-8")
    assert "fqdn: app01.example.test" in app01 and "app01-old" in app01
    assert "type: Page" in (FIXTURE / "Pages" / "APP01.md").read_text("utf-8")

    def load(name: str) -> TypeDefinition:
        return TypeDefinition.from_json(json.loads((FIXTURE / ".object" / "types" / name).read_text("utf-8")))

    host = load("host.json")
    assert host.namePatterns == ["{ip}", "{fqdn}", "SRV-*", "@@##", "@@@##", "@@@@##", "@*-##"]
    assert [(p.key, p.type) for p in host.propertyDefinitions if p.key in ("fqdn", "ipAddress")] == [
        ("ipAddress", "text"),
        ("fqdn", "text"),
    ]
    facts = [(p.key, p.name, p.type) for p in host.propertyDefinitions if p.synced is not None]
    assert facts == [
        ("lastBoot", "Last boot", "datetime"),
        ("diskFree", "Disk free", "number"),
        ("patchState", "Patch state", "label"),
        ("rebootPending", "Reboot pending", "boolean"),
        ("lastSeen", "Last seen", "datetime"),
    ]
    for p in host.propertyDefinitions:
        if p.synced is not None:
            assert p.synced == SyncedSpec("Inventory script", 7)
            assert p.id == p.key and p.visibility == "alwaysShow"
            assert synced_problems(p.to_json()) == []
    patch = host.prop("patchState")
    assert patch is not None and patch.options["isArray"] is False
    assert [(o["text"], o["color"]) for o in patch.options["set"]] == [
        ("Current", "green"),
        ("Pending", "amber"),
        ("Failed", "red"),
        ("Unknown", "gray"),
    ]
    assert host.prop("diskFree").description == "Free disk space, in GB"  # type: ignore[union-attr]
    for key in ("lastBoot", "lastSeen"):
        assert host.prop(key).options["constraints"] == {  # type: ignore[union-attr]
            "resolutionPreference": "time",
            "endTimeSettings": "notAllowed",
        }
    assert load("network.json").namePatterns == ["{cidr}"]
    assert load("software.json").namePatterns == ["{version}"]
