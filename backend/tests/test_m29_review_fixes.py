"""M29 fix pass (back end): regression tests for the whole-milestone review's findings.

Plan ``2026-11-09-m29-synced-facts-and-type-suggestion.md``. Every test runs on a copy of the
synthetic ``space-synced`` fixture.
"""

from __future__ import annotations

import json
import shutil
import threading
from datetime import UTC, datetime
from pathlib import Path

import pytest

from objectapp.space import Space

FIXTURE = Path(__file__).parent / "fixtures" / "space-synced"
NOW = datetime(2026, 11, 9, 8, 0, 0, tzinfo=UTC)

APP01 = "Hosts/APP01.md"
SRV02 = "Hosts/SRV-02.md"
PRINT = "Hosts/Print box.md"


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    dst = tmp_path / "space"
    shutil.copytree(FIXTURE, dst)
    return dst


def _space(root: Path) -> Space:
    s = Space(root)
    s.clock = lambda: NOW
    return s


def _item(by: str, value: str, values: dict, key: str | None = None) -> dict:
    match: dict = {"by": by, "value": value}
    if key is not None:
        match["key"] = key
    return {"match": match, "values": values}


def _store(root: Path) -> dict:
    return json.loads((root / ".object" / "synced" / "host.json").read_text("utf-8"))


def _id_lines(data: bytes) -> list[bytes]:
    return [line for line in data.splitlines() if line.startswith((b"id:", b"\xef\xbb\xbfid:"))]


# -- finding 1: two concurrent syncs of an id-less object -------------------------------------


@pytest.mark.parametrize("attempt", range(5))
def test_two_threads_on_an_id_less_object_keep_both_keys(root: Path, attempt: int) -> None:
    space = _space(root)
    barrier = threading.Barrier(2)
    outcomes: list = []
    errors: list = []

    def run(values: dict) -> None:
        barrier.wait()
        try:
            outcomes.append(space.sync_facts("host", [_item("title", "Print box", values)], set()))
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [
        threading.Thread(target=run, args=({"lastBoot": "2026-11-08T07:12:00.000Z"},)),
        threading.Thread(target=run, args=({"diskFree": 12},)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert errors == []
    statuses = [o.results[0].status for o in outcomes]
    details = [o.results[0].detail for o in outcomes]
    assert statuses == ["updated", "updated"], details
    ids = {o.results[0].objectId for o in outcomes}
    assert len(ids) == 1
    (object_id,) = ids
    assert _store(root)[object_id]["values"] == {
        "lastBoot": "2026-11-08T07:12:00.000Z",
        "diskFree": 12,
    }
    data = (root / PRINT).read_bytes()
    assert _id_lines(data) == [f"id: {object_id}".encode()]
    assert sum(len(o.idWrites) for o in outcomes) == 1


def test_the_one_time_id_insert_keeps_crlf_and_bom(root: Path) -> None:
    full = root / SRV02
    original = full.read_bytes()
    assert original.startswith(b"\xef\xbb\xbf") and b"\r\n" in original
    lines = original.split(b"\r\n")
    without = b"\r\n".join(line for line in lines if not line.startswith(b"id:"))
    assert without != original
    full.write_bytes(without)
    space = _space(root)
    outcome = space.sync_facts("host", [_item("title", "SRV-02", {"diskFree": 3})], set())
    assert outcome.results[0].status == "updated"
    after = full.read_bytes()
    assert after.startswith(b"\xef\xbb\xbf---\r\nid: ")
    assert b"\n" not in after.replace(b"\r\n", b"")
    assert after.replace(f"id: {outcome.results[0].objectId}\r\n".encode(), b"", 1) == without


# -- finding 4: the sync's messages are full sentences ----------------------------------------


def test_sync_messages_are_full_sentences(root: Path) -> None:
    from objectapp.propvalues import InvalidValue
    from objectapp.space import ReadOnly

    space = _space(root)
    with pytest.raises(InvalidValue, match=r"^Page has no synced properties\.$"):
        space.sync_facts("page", [], set())
    folder = root / ".object" / "synced"
    folder.mkdir(parents=True)
    (folder / "host.json").write_bytes(b"[1, 2")
    expected = "The synced facts file .object/synced/host.json is not a valid JSON object."
    with pytest.raises(ReadOnly) as raised:
        space.sync_facts("host", [_item("title", "APP01", {"diskFree": 1})], set())
    assert raised.value.reason == expected
    with pytest.raises(ReadOnly) as raised:
        space.synced.apply("host", {"01KM2900000000000000000001": {"diskFree": 1}}, "x")
    assert raised.value.reason == expected


# -- finding 5: a synced property can't start an automation ----------------------------------


def test_a_synced_property_cant_start_an_automation(root: Path) -> None:
    from objectapp.automations import check_rule
    from objectapp.propvalues import InvalidValue

    space = _space(root)
    rule = {
        "name": "Patch failed",
        "trigger": {
            "kind": "propertyChanged",
            "scope": {"kind": "type", "id": "host"},
            "propertyKey": "patchState",
        },
        "actions": [{"kind": "setProperty", "key": "fqdn", "value": "x.example.test"}],
    }
    with pytest.raises(InvalidValue) as e:
        check_rule(space, rule)
    assert str(e.value) == (
        '"Patch state" is filled by Inventory script, so a change to it can\'t start an automation.'
    )
    ordinary = {**rule, "trigger": {**rule["trigger"], "propertyKey": "ipAddress"}}
    check_rule(space, ordinary)  # an ordinary property of the type still can


# -- finding 6: change type and merge never write a synced key -------------------------------


def _add_page_disk_free(root: Path) -> None:
    """Give Page an ordinary number property "Disk free" (key ``freeSpace``) and APP01 the page
    a value for it, so a change to Host would map it onto Host's synced Disk free."""
    page_json = root / ".object" / "types" / "page.json"
    data = json.loads(page_json.read_text("utf-8"))
    data["propertyDefinitions"].append(
        {
            "id": "freeSpace",
            "key": "freeSpace",
            "name": "Disk free",
            "type": "number",
            "description": "",
            "icon": {"type": "iconify", "val": "ph-hash"},
            "visibility": "alwaysShow",
            "options": {},
        }
    )
    page_json.write_text(json.dumps(data, indent=2), "utf-8")
    _hand_type(root, "Pages/APP01.md", "freeSpace: 40")


def test_change_type_never_maps_into_or_from_a_synced_key(root: Path) -> None:
    from objectapp.changetype import mapping_sources, mapping_targets
    from objectapp.propvalues import InvalidValue

    _add_page_disk_free(root)
    _hand_type(root, APP01, "diskFree: 99")
    space = _space(root)
    host = space.type_by_id("host")
    synced_keys = {"lastBoot", "diskFree", "patchState", "rebootPending", "lastSeen"}
    assert not synced_keys & {q.key for q in mapping_targets(host)}
    assert "fqdn" in {q.key for q in mapping_targets(host)}
    _of, fm, _v = space.read(APP01)
    assert "diskFree" not in {p.key for p in mapping_sources(host, fm)}

    rows = space.suggest_change_type("Pages/APP01.md", "host")
    assert [(r.fromKey, r.toKey) for r in rows] == [("freeSpace", None)]
    before = (root / "Pages/APP01.md").read_bytes()
    _of, _fm, version = space.read("Pages/APP01.md")
    with pytest.raises(InvalidValue):
        space.change_type("Pages/APP01.md", "host", {"freeSpace": "diskFree"}, version)
    assert (root / "Pages/APP01.md").read_bytes() == before


def test_merge_never_copies_a_synced_key(root: Path) -> None:
    from objectapp.merge import merge_objects

    _hand_type(root, APP01, "diskFree: 99")
    _hand_type(root, APP01, "patchState: Failed")
    space = _space(root)
    _of, _fm, sv = space.read(APP01)
    _of, _fm, tv = space.read("Hosts/WEB01.md")
    result = merge_objects(space, APP01, "Hosts/WEB01.md", sv, tv, now=NOW)
    text = (root / "Hosts/WEB01.md").read_text("utf-8")
    assert "diskFree" not in text and "patchState" not in text
    assert "ipAddress: 10.20.0.11" in text  # an ordinary blank property is still filled
    assert "diskFree" not in result.dropped and "patchState" not in result.dropped


# -- finding 13a: a key match names the property, not "the key" ------------------------------


def test_a_key_match_detail_names_the_property(root: Path) -> None:
    full = root / "Hosts/Lab/WEB01.md"
    full.write_bytes(full.read_bytes().replace(b"web01.lab.example.test", b"web01.example.test"))
    space = _space(root)
    out = space.sync_facts(
        "host",
        [
            _item("key", "nobody.example.test", {"diskFree": 1}, key="fqdn"),
            _item("key", "web01.example.test", {"diskFree": 1}, key="fqdn"),
        ],
        set(),
    )
    assert [r.detail for r in out.results] == [
        'No Host has the FQDN "nobody.example.test".',
        '2 Hosts have the FQDN "web01.example.test".',
    ]


# -- finding 13b: a name over NAME_MAX characters matches no pattern -------------------------


def test_a_name_over_name_max_matches_no_pattern() -> None:
    from objectapp.typemodel import TypeDefinition
    from objectapp.typesuggest import NAME_MAX, SuggestContext, matches, suggest_type

    assert NAME_MAX == 300
    at_cap = "SRV-" + "x" * (NAME_MAX - 4)
    over = at_cap + "x"
    assert len(at_cap) == NAME_MAX
    assert matches(at_cap, ["SRV-*"])
    assert not matches(over, ["SRV-*"])
    assert not matches("srv-" + "é" * NAME_MAX, ["SRV-*"])  # counted in characters
    host = TypeDefinition.from_json(
        {"id": "host", "name": "Host", "pluralName": "Hosts", "namePatterns": ["SRV-*"]}
    )
    page = TypeDefinition.from_json({"id": "page", "name": "Page", "pluralName": "Pages"})
    ctx = SuggestContext(types=[page, host], last="page")
    assert suggest_type(at_cap, ctx) == ["host", "page"]
    assert suggest_type(over, ctx) == ["page"]


# -- finding 3: a hand-typed value under a synced key never shows ---------------------------


def _hand_type(root: Path, rel: str, line: str) -> None:
    """Add ``line`` to the end of the object's front matter (with the file's own line ending)."""
    full = root / rel
    data = full.read_bytes()
    eol = b"\r\n" if b"\r\n" in data else b"\n"
    head, sep, tail = data.partition(eol + b"---" + eol)
    full.write_bytes(head + eol + line.replace("\n", eol.decode()).encode() + sep + tail)


def test_calendar_ignores_a_hand_typed_synced_date(root: Path) -> None:
    space = _space(root)
    # SRV-02's file has a hand-typed `lastBoot: 2020-01-01T00:00:00.000Z`.
    cal = space.calendar("2020-01-01", "2020-01-02")
    dated = [e for day in cal["days"].values() for e in day.get("dated", [])]
    assert [e for e in dated if e["path"] == SRV02] == []

    item = _item("title", "SRV-02", {"lastBoot": "2026-11-08T07:12:00.000Z"})
    space.sync_facts("host", [item], set())
    cal = space.calendar("2026-11-08", "2026-11-08")
    dated = [e for day in cal["days"].values() for e in day.get("dated", [])]
    assert [(e["path"], e["key"]) for e in dated if e["path"] == SRV02] == [(SRV02, "lastBoot")]


def test_search_never_indexes_a_hand_typed_synced_value(root: Path, tmp_path: Path) -> None:
    from objectapp.searchindex import SearchIndex
    from objectapp.searchtext import property_text

    _hand_type(root, APP01, "patchState: Failed")
    _hand_type(root, APP01, "diskFree: 987654")
    space = _space(root)
    host = space.type_by_id("host")
    _of, fm, _version = space.read(APP01)
    text = property_text(host, fm, lambda target: target)
    assert "app01.example.test" in text
    assert "Patch state" not in text and "Failed" not in text
    assert "987654" not in text

    idx = SearchIndex(space, tmp_path / "search-cache")
    idx.start()
    try:
        assert idx.ready.wait(30)
        assert idx.search("app01.example.test")["results"]  # the index holds APP01's props
        assert [r["path"] for r in idx.search("987654")["results"]] == []
        assert [r["path"] for r in idx.search("Failed")["results"]] == []
    finally:
        idx.stop()


def test_reminders_skip_a_synced_date(root: Path) -> None:
    from objectapp import reminders

    host_json = root / ".object" / "types" / "host.json"
    data = json.loads(host_json.read_text("utf-8"))
    for p in data["propertyDefinitions"]:
        if p["key"] == "lastBoot":
            options = p.setdefault("options", {})
            options.setdefault("constraints", {})["supportsReminders"] = True
    host_json.write_text(json.dumps(data, indent=2), "utf-8")
    _hand_type(root, APP01, "lastBoot: 2026-11-20T09:00:00.000Z")
    _hand_type(root, APP01, "reminders:\n  lastBoot: 1d")
    space = _space(root)
    infos = reminders.task_infos(space)
    assert [(i.path, i.key) for i in infos if i.path == APP01] == []
