"""M29 Task 5: the IT ops starter's synced facts (Host) and name patterns (Host, Network,
Software). Plan ``2026-11-09-m29-synced-facts-and-type-suggestion.md``, Contract "The starter's
patterns and synced facts"."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.basicsetup import itops_types, write_itops_types
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.typemodel import SyncedSpec, load_types, synced_problems
from objectapp.typesuggest import pattern_problems
from objectapp.typetemplates import get_template

PATTERNS = {
    "host": ["{ip}", "{fqdn}", "SRV-*", "@@##", "@@@##", "@@@@##", "@*-##"],
    "network": ["{cidr}"],
    "software": ["{version}"],
}
SYNCED = [
    ("lastBoot", "Last boot", "datetime"),
    ("diskFree", "Disk free", "number"),
    ("patchState", "Patch state", "label"),
    ("rebootPending", "Reboot pending", "boolean"),
    ("lastSeen", "Last seen", "datetime"),
]
INVENTORY = SyncedSpec("Inventory script", 7)
TIME = {"constraints": {"resolutionPreference": "time", "endTimeSettings": "notAllowed"}}

M28_FIXTURE = Path(__file__).parent / "fixtures" / "space-itops"


def _types():
    return {t.id: t for t in itops_types()}


def _check_host_synced(props) -> None:
    """`props` (Host's property definitions, in order) end with the five synced facts."""
    tail = props[-5:]
    assert [(p.key, p.name, p.type) for p in tail] == SYNCED
    for p in tail:
        assert p.synced == INVENTORY, p.key
        assert p.id == p.key
        assert p.visibility == "alwaysShow"
    assert [p.key for p in props if p.synced is not None] == [k for k, _, _ in SYNCED]
    by_key = {p.key: p for p in tail}
    assert by_key["lastBoot"].options == TIME
    assert by_key["lastSeen"].options == TIME
    assert by_key["diskFree"].description == "Free disk space, in GB"
    patch = by_key["patchState"]
    assert patch.options["isArray"] is False
    assert [(o["text"], o["color"]) for o in patch.options["set"]] == [
        ("Current", "green"),
        ("Pending", "amber"),
        ("Failed", "red"),
        ("Unknown", "gray"),
    ]


def test_host_synced_facts():
    types = _types()
    _check_host_synced(types["host"].propertyDefinitions)
    for tid, t in types.items():
        if tid != "host":
            assert all(p.synced is None for p in t.propertyDefinitions), tid
    # The M28 properties come first, unchanged in order.
    keys = [p.key for p in types["host"].propertyDefinitions]
    assert keys.index("notes") < keys.index("lastBoot")


def test_starter_patterns():
    for tid, t in _types().items():
        assert t.namePatterns == PATTERNS.get(tid, []), tid
        assert pattern_problems(t.namePatterns) == [], tid
        if tid not in PATTERNS:
            assert "namePatterns" not in t.to_json(), tid


def test_written_types_roundtrip(tmp_path: Path):
    write_itops_types(tmp_path)
    loaded, unreadable = load_types(tmp_path)
    assert unreadable == []
    by_id = {t.id: t for t in loaded}
    made = _types()
    for tid, t in made.items():
        got = by_id[tid]
        assert got.namePatterns == t.namePatterns, tid
        assert [(p.key, p.synced) for p in got.propertyDefinitions] == [
            (p.key, p.synced) for p in t.propertyDefinitions
        ], tid
        raw = json.loads((tmp_path / ".object" / "types" / f"{tid}.json").read_text("utf-8"))
        for entry in raw["propertyDefinitions"]:
            assert synced_problems(entry) == [], (tid, entry.get("key"))
        if tid in PATTERNS:
            assert raw["namePatterns"] == PATTERNS[tid]
    host = json.loads((tmp_path / ".object" / "types" / "host.json").read_text("utf-8"))
    last = host["propertyDefinitions"][-1]
    assert last["key"] == "lastSeen"
    assert last["synced"] == {"source": "Inventory script", "staleAfterDays": 7}


def test_gallery_template_carries_the_patterns():
    for key in ("host", "network", "software"):
        tpl = get_template(key)
        assert tpl is not None
        assert list(tpl.namePatterns) == PATTERNS[key]
    for key in ("application", "runbook", "person"):
        assert get_template(key).namePatterns == ()  # type: ignore[union-attr]
    # The gallery's Host carries the synced facts (its properties are the starter's).
    _check_host_synced(get_template("host").props())  # type: ignore[union-attr]


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    root = tmp_path / "space"
    root.mkdir()
    space = Space(root)
    with TestClient(create_app(space, None, watch=False)) as c:
        yield c, root


def test_gallery_host_has_synced_facts(client):
    c, root = client
    res = c.post("/api/types", json={"name": "Host", "pluralName": "Hosts", "template": "host"})
    assert res.status_code in (200, 201), res.text
    tid = res.json()["id"]
    raw = json.loads((root / ".object" / "types" / f"{tid}.json").read_text("utf-8"))
    synced = [p for p in raw["propertyDefinitions"] if "synced" in p]
    assert [(p["key"], p["name"], p["type"]) for p in synced] == SYNCED
    assert all(p["synced"] == {"source": "Inventory script", "staleAfterDays": 7} for p in synced)
    assert raw["propertyDefinitions"][-5:] == synced


def test_gallery_host_has_synced_facts_and_patterns(client):
    c, root = client
    res = c.post("/api/types", json={"name": "Host", "pluralName": "Hosts", "template": "host"})
    assert res.status_code in (200, 201), res.text
    tid = res.json()["id"]
    raw = json.loads((root / ".object" / "types" / f"{tid}.json").read_text("utf-8"))
    synced = [p for p in raw["propertyDefinitions"] if "synced" in p]
    assert [(p["key"], p["name"], p["type"]) for p in synced] == SYNCED
    assert raw.get("namePatterns") == PATTERNS["host"]
    for key, plural in (("network", "Networks"), ("software", "Software")):
        res = c.post("/api/types", json={"name": key.title(), "pluralName": plural, "template": key})
        assert res.status_code in (200, 201), res.text
        assert res.json().get("namePatterns") == PATTERNS[key]


def test_existing_host_type_is_not_topped_up(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """An M28-era space (the M28 fixture: Host without synced facts or patterns) opens, lists
    its rows and serves its types without any change to its type files."""
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    root = tmp_path / "space"
    shutil.copytree(M28_FIXTURE, root)
    types_dir = root / ".object" / "types"
    host = json.loads((types_dir / "host.json").read_text("utf-8"))
    assert "namePatterns" not in host
    assert not any("synced" in p for p in host["propertyDefinitions"])
    before = {p.name: p.read_bytes() for p in types_dir.glob("*.json")}
    space = Space(root)
    with TestClient(create_app(space, None, watch=False)) as c:
        assert c.get("/api/space").status_code == 200
        assert c.post("/api/rows", json={"typeIds": ["host"]}).status_code == 200
    Space(root)
    after = {p.name: p.read_bytes() for p in types_dir.glob("*.json")}
    assert after == before
    loaded = next(t for t in space.types if t.id == "host")
    assert loaded.namePatterns == []
    assert all(p.synced is None for p in loaded.propertyDefinitions)
