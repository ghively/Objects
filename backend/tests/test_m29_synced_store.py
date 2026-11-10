"""M29 Task 3: the synced facts store and its pure helpers (plan
``2026-11-09-m29-synced-facts-and-type-suggestion.md``, Contract "Synced store and helpers").
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import RLock
from unittest import mock

import pytest

from objectapp import jsonstore
from objectapp.jsonstore import JsonStore, dump_json
from objectapp.propvalues import InvalidValue
from objectapp.space import ReadOnly
from objectapp.synced import (
    Candidate,
    ItemResult,
    SyncedEntry,
    SyncedStore,
    check_match,
    encode_facts,
    find_matches,
    is_stale,
    norm,
    synced_props,
)
from objectapp.typemodel import TypeDefinition

FIXTURE = Path(__file__).parent / "fixtures" / "space-synced"
A = "2026-11-08T07:12:00.000Z"
T1 = "2026-11-09T08:00:00.000Z"
T2 = "2026-11-09T09:00:00.000Z"


def _host() -> TypeDefinition:
    data = json.loads((FIXTURE / ".object" / "types" / "host.json").read_text("utf-8"))
    return TypeDefinition.from_json(data)


def _page() -> TypeDefinition:
    data = json.loads((FIXTURE / ".object" / "types" / "page.json").read_text("utf-8"))
    return TypeDefinition.from_json(data)


def _store(root: Path) -> SyncedStore:
    return SyncedStore(JsonStore(root, "synced", {}, lock=RLock()))


def _file(root: Path, type_id: str = "host") -> Path:
    return root / ".object" / "synced" / f"{type_id}.json"


def test_synced_props_follow_the_type() -> None:
    host = _host()
    assert [p.key for p in synced_props(host)] == [
        "lastBoot",
        "diskFree",
        "patchState",
        "rebootPending",
        "lastSeen",
    ]
    assert synced_props(_page()) == []
    assert synced_props(None) == []


def test_overlay(tmp_path: Path) -> None:
    store = _store(tmp_path)
    host = _host()
    store.apply("host", {"h1": {"lastBoot": A}}, T1)

    fm = {"id": "h1", "title": "APP01", "lastBoot": "2020-01-01T00:00:00.000Z", "diskFree": 3}
    before = dict(fm)
    out = store.overlay(host, fm)
    assert out["lastBoot"] == A
    assert "diskFree" not in out  # the store has no value for it: the file's is ignored
    assert out["title"] == "APP01"
    assert fm == before  # never mutated

    no_id = {"title": "Print box", "lastBoot": A, "rebootPending": True}
    out2 = store.overlay(host, no_id)
    assert "lastBoot" not in out2 and "rebootPending" not in out2
    assert out2["title"] == "Print box"

    other = {"id": "h2", "lastBoot": A}
    assert "lastBoot" not in store.overlay(host, other)

    page_fm = {"id": "p1", "title": "APP01"}
    assert store.overlay(_page(), page_fm) is page_fm
    assert store.overlay(None, page_fm) is page_fm
    assert not _file(tmp_path, "page").exists()


def test_entry(tmp_path: Path) -> None:
    store = _store(tmp_path)
    assert store.entry("host", "h1") is None
    assert not _file(tmp_path).parent.exists()  # reading creates nothing
    store.apply("host", {"h1": {"diskFree": 12}}, T1)
    assert store.entry("host", "h1") == SyncedEntry(values={"diskFree": 12}, refreshedAt=T1)
    assert store.entry("host", None) is None
    assert store.entry("host", "h2") is None


def test_merge_keeps_other_keys(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.apply("host", {"h1": {"lastBoot": A}, "h2": {"diskFree": 7}}, T1)
    rev = store.apply("host", {"h1": {"diskFree": 41.5}}, T2)
    data = store.data("host")
    assert data["h1"] == {"values": {"lastBoot": A, "diskFree": 41.5}, "refreshedAt": T2}
    assert data["h2"] == {"values": {"diskFree": 7}, "refreshedAt": T1}
    assert rev == jsonstore.json_revision(_file(tmp_path))

    store.apply("host", {"h1": {"diskFree": None}}, T2)
    data = store.data("host")
    assert data["h1"]["values"] == {"lastBoot": A}
    assert data["h2"] == {"values": {"diskFree": 7}, "refreshedAt": T1}
    assert _file(tmp_path).read_bytes() == dump_json(
        {
            "h1": {"values": {"lastBoot": A}, "refreshedAt": T2},
            "h2": {"values": {"diskFree": 7}, "refreshedAt": T1},
        }
    )


def test_unreadable_store_is_never_rewritten(tmp_path: Path) -> None:
    path = _file(tmp_path)
    path.parent.mkdir(parents=True)
    path.write_bytes(b"{not json")
    store = _store(tmp_path)
    with pytest.raises(ReadOnly):
        store.apply("host", {"h1": {"diskFree": 1}}, T1)
    assert path.read_bytes() == b"{not json"
    assert store.data("host") == {}
    path.write_bytes(b"[1, 2]")  # valid JSON, not an object
    with pytest.raises(ReadOnly):
        store.apply("host", {"h1": {"diskFree": 1}}, T1)
    assert path.read_bytes() == b"[1, 2]"
    assert store.data("host") == {}


def test_cache_follows_the_file(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.apply("host", {"h1": {"diskFree": 1}}, T1)
    assert store.data("host")["h1"]["values"] == {"diskFree": 1}

    path = _file(tmp_path)
    path.write_bytes(dump_json({"h1": {"values": {"diskFree": 1234}, "refreshedAt": T2}}))
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000))
    with mock.patch.object(
        jsonstore, "parse_json_object", wraps=jsonstore.parse_json_object
    ) as parse:
        assert store.data("host")["h1"]["values"] == {"diskFree": 1234}
        assert store.data("host")["h1"]["values"] == {"diskFree": 1234}
    assert parse.call_count == 1  # the second read, with no change, is served from the cache

    path.unlink()
    assert store.data("host") == {}


def _candidates() -> list[Candidate]:
    return [
        Candidate("Hosts/APP01.md", "h1", "APP01", ("app01-old",), {"fqdn": "app01.example.test"}),
        Candidate("Hosts/WEB01.md", "h3", "WEB01", (), {"fqdn": "web01.example.test"}),
        Candidate("Hosts/Lab/WEB01.md", "h4", "WEB01", (), {"fqdn": "web01.lab.example.test"}),
    ]


def test_match_rules() -> None:
    c = _candidates()

    def paths(by: str, value: str, key: str | None) -> list[str]:
        return [m.path for m in find_matches(c, by, value, key)]  # type: ignore[arg-type]

    assert paths("title", " app01 ", None) == ["Hosts/APP01.md"]
    assert paths("alias", "APP01-OLD", None) == ["Hosts/APP01.md"]
    assert paths("title", "app01-old", None) == []  # an alias is not a title
    assert paths("alias", "APP01", None) == []  # a title is not an alias
    assert paths("key", "APP01.example.test", "fqdn") == ["Hosts/APP01.md"]
    assert paths("key", "app01.example.test", "ipAddress") == []
    assert paths("title", "WEB01", None) == ["Hosts/WEB01.md", "Hosts/Lab/WEB01.md"]
    assert paths("title", "", None) == []
    assert norm("  Web   01\tA ") == "web 01 a"


def test_check_match() -> None:
    host = _host()
    assert check_match(host, "name", "APP01", None) == '"by" must be title, alias or key.'
    assert check_match(host, 5, "APP01", None) == '"by" must be title, alias or key.'
    for bad in ("", "   ", "x" * 301, 5, None):
        assert check_match(host, "title", bad, None) == '"value" must be 1-300 characters.', bad
    assert check_match(host, "title", "x" * 300, None) is None
    needs_key = 'Matching by key needs "key": a text or URL property of Host.'
    assert check_match(host, "key", "app01.example.test", None) == needs_key
    assert check_match(host, "key", "app01.example.test", "nope") == needs_key
    assert check_match(host, "key", "x", "tags") == needs_key
    assert check_match(host, "key", "app01.example.test", "lastBoot") == (
        '"lastBoot" is synced: match by a property the script doesn\'t fill.'
    )
    # patchState is a label (neither text nor URL): with its synced mark lifted it still can't key
    unsynced = TypeDefinition.from_json(
        {
            **host.to_json(),
            "propertyDefinitions": [
                {k: v for k, v in p.to_json().items() if not (p.key == "patchState" and k == "synced")}
                for p in host.propertyDefinitions
            ],
        }
    )
    assert unsynced.prop("patchState").synced is None
    assert check_match(unsynced, "key", "Current", "patchState") == needs_key
    assert check_match(host, "key", "app01.example.test", "fqdn") is None
    assert check_match(host, "alias", "app01-old", None) is None
    assert check_match(host, "title", "APP01", "ignored") is None


def test_encode_facts() -> None:
    host = _host()
    out = encode_facts(
        host,
        {
            "lastBoot": {"start": "2026-11-08T07:12:00.000Z", "resolution": "time"},
            "diskFree": 41.5,
            "patchState": "Current",
            "rebootPending": False,
            "lastSeen": "2026-11-09T06:00:00Z",
        },
    )
    assert out == {
        "lastBoot": "2026-11-08T07:12:00.000Z",
        "diskFree": 41.5,
        "patchState": "Current",
        "rebootPending": False,
        "lastSeen": "2026-11-09T06:00:00.000Z",
    }
    assert json.loads(json.dumps(out)) == out
    for v in out.values():
        assert type(v) in (str, int, float, bool)
    assert encode_facts(host, {"diskFree": 12.0}) == {"diskFree": 12}
    assert encode_facts(host, {"patchState": ["pending"]}) == {"patchState": "Pending"}
    assert encode_facts(host, {"diskFree": None}) == {"diskFree": None}

    with pytest.raises(InvalidValue) as e:
        encode_facts(host, {"patchState": "Reboot required"})
    assert str(e.value) == '"Reboot required" isn\'t an option of Patch state.'
    with pytest.raises(InvalidValue) as e:
        encode_facts(host, {"fqdn": "x.example.test"})
    assert str(e.value) == '"fqdn" isn\'t a synced property of Host.'
    with pytest.raises(InvalidValue) as e:
        encode_facts(host, {"nope": 1})
    assert str(e.value) == '"nope" isn\'t a synced property of Host.'
    with pytest.raises(InvalidValue) as e:
        encode_facts(host, {"diskFree": "lots"})
    assert str(e.value) == "Expected a number."
    with pytest.raises(InvalidValue):
        encode_facts(host, {"rebootPending": "yes"})


def test_is_stale() -> None:
    now = datetime(2026, 11, 10, 12, 0, 0, tzinfo=UTC)

    def iso(dt: datetime) -> str:
        return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"

    assert is_stale(iso(now - timedelta(days=7)), 7, now) is False
    assert is_stale(iso(now - timedelta(days=7, seconds=1)), 7, now) is True
    assert is_stale(None, 7, now) is False
    assert is_stale("not a time", 7, now) is False
    assert is_stale(iso(now - timedelta(hours=25)), 1, now) is True
    assert is_stale(iso(now - timedelta(hours=23)), 1, now) is False


def test_item_result_to_api() -> None:
    assert ItemResult(0, "updated", path="Hosts/APP01.md", objectId="h1").to_api() == {
        "index": 0,
        "status": "updated",
        "path": "Hosts/APP01.md",
        "objectId": "h1",
    }
    assert ItemResult(3, "ambiguous", paths=["a.md", "b.md"], detail="2 Hosts").to_api() == {
        "index": 3,
        "status": "ambiguous",
        "paths": ["a.md", "b.md"],
        "detail": "2 Hosts",
    }
