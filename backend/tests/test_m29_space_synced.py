"""M29 Task 4: synced facts in the space: the overlay, the read-only keys, the sync, the exports.

Plan ``2026-11-09-m29-synced-facts-and-type-suggestion.md``, Task 4 and Review Focus 1, 2 and 3.
Every test runs on a copy of the synthetic ``space-synced`` fixture.
"""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest

from objectapp.automations import AutomationEngine, _ActionFailed, check_rule
from objectapp.automations_model import AutomationRule
from objectapp.export import ExportOptions, export_object, export_properties
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.propvalues import InvalidValue
from objectapp.space import ReadOnly, Space, version_of
from objectapp.synced import SyncOutcome

FIXTURE = Path(__file__).parent / "fixtures" / "space-synced"
NOW = datetime(2026, 11, 9, 8, 0, 0, tzinfo=UTC)
STAMP = "2026-11-09T08:00:00.000Z"

APP01 = "Hosts/APP01.md"
SRV02 = "Hosts/SRV-02.md"
PRINT = "Hosts/Print box.md"
WEB01 = "Hosts/WEB01.md"
LAB_WEB01 = "Hosts/Lab/WEB01.md"
GATEWAY = "Hosts/Gateway.md"
PAGE_APP01 = "Pages/APP01.md"
TEMPLATE = "Hosts/Templates/Host template.md"
HIDDEN = {GATEWAY, TEMPLATE}
READ_ONLY_DISK = '"Disk free" is filled by Inventory script and can\'t be edited.'


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


def _snapshot(root: Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file() and ".object-cache" not in p.relative_to(root).parts
    }


def _item(by: str, value: str, values: dict, key: str | None = None) -> dict:
    match: dict = {"by": by, "value": value}
    if key is not None:
        match["key"] = key
    return {"match": match, "values": values}


def _row(space: Space, path: str):
    return next(r for r in space.rows() if r.summary.path == path)


def _store(root: Path) -> dict:
    return json.loads((root / ".object" / "synced" / "host.json").read_text("utf-8"))


def test_opening_and_reading_write_nothing(root: Path) -> None:
    before = _snapshot(root)
    space = _space(root)
    rows = space.rows()
    assert {r.summary.path for r in rows} >= {APP01, SRV02, PRINT, WEB01, LAB_WEB01, PAGE_APP01}
    for summary in [*space.list(), space.get(TEMPLATE)]:
        _of, fm, _v = space.read(summary.path)
        space.synced_fm(summary, fm)
    for path in (APP01, SRV02):
        export_object(space, path, False, ExportOptions(format="html"))
        export_object(space, path, False, ExportOptions(format="md"))
        export_properties(space, path)
    assert not (root / ".object" / "synced").exists()
    assert _snapshot(root) == before


def test_front_matter_value_under_a_synced_key_is_ignored(root: Path) -> None:
    space = _space(root)
    raw_before = (root / SRV02).read_bytes()
    row = _row(space, SRV02)
    assert row.values["lastBoot"] is None
    assert row.syncedAt is None
    _of, fm, _v = space.read(SRV02)
    assert fm["lastBoot"] == "2020-01-01T00:00:00.000Z"  # the file's own front matter
    assert "lastBoot" not in space.synced_fm(space.get(SRV02), fm)

    out = space.sync_facts(
        "host", [_item("title", "SRV-02", {"lastBoot": "2026-11-08T07:12:00.000Z"})], HIDDEN
    )
    assert out.results[0].status == "updated"
    row = _row(space, SRV02)
    assert row.values["lastBoot"] == {"start": "2026-11-08T07:12:00.000Z", "resolution": "time"}
    assert row.syncedAt == STAMP
    assert (root / SRV02).read_bytes() == raw_before  # the hand-typed line stays, untouched
    assert b"lastBoot: 2020-01-01T00:00:00.000Z\r\n" in (root / SRV02).read_bytes()


def test_rows_and_computed_use_synced_values(root: Path) -> None:
    host_json = root / ".object" / "types" / "host.json"
    data = json.loads(host_json.read_text("utf-8"))
    data["propertyDefinitions"].append(
        {
            "id": "doubleDisk",
            "key": "doubleDisk",
            "name": "Double disk",
            "type": "formula",
            "options": {"expression": 'prop("Disk free") * 2'},
        }
    )
    host_json.write_text(json.dumps(data, indent=2), "utf-8")
    space = _space(root)
    assert _row(space, APP01).values["diskFree"] is None

    out = space.sync_facts("host", [_item("title", "APP01", {"diskFree": 12})], HIDDEN)
    assert isinstance(out, SyncOutcome)
    row = _row(space, APP01)
    assert row.values["diskFree"] == 12
    assert row.syncedAt == out.refreshedAt == STAMP
    assert row.values["doubleDisk"]["value"] == 24
    assert _row(space, WEB01).syncedAt is None  # a Host with no entry yet
    page = _row(space, PAGE_APP01)
    assert page.syncedAt is None
    assert "diskFree" not in page.values


def test_synced_keys_refused_on_every_write_path(root: Path) -> None:
    space = _space(root)
    before = _snapshot(root)
    version = version_of((root / APP01).read_bytes())
    with pytest.raises(InvalidValue) as e:
        space.update_properties(APP01, {"diskFree": 5}, version)
    assert str(e.value) == READ_ONLY_DISK
    with pytest.raises(InvalidValue) as e:
        space.update_properties(APP01, {}, version, remove=["diskFree"])
    assert str(e.value) == READ_ONLY_DISK
    with pytest.raises(InvalidValue) as e:
        space.update_properties(SRV02, {}, version_of((root / SRV02).read_bytes()), remove=["lastBoot"])
    assert str(e.value) == '"Last boot" is filled by Inventory script and can\'t be edited.'
    with pytest.raises(InvalidValue) as e:
        space.write_work(APP01, version, updates={"patchState": "Failed"})
    assert str(e.value) == '"Patch state" is filled by Inventory script and can\'t be edited.'
    with pytest.raises(InvalidValue) as e:
        space.create_object("host", "SRV-03", values={"diskFree": 5})
    assert str(e.value) == READ_ONLY_DISK

    rule = {
        "name": "Mark failed",
        "trigger": {"kind": "button", "scope": {"kind": "type", "id": "host"}},
        "actions": [{"kind": "setProperty", "key": "patchState", "value": "Failed"}],
    }
    with pytest.raises(InvalidValue) as e:
        check_rule(space, rule)
    assert str(e.value) == 'Action 1: "Patch state" can\'t be set by an automation.'
    clear = {**rule, "actions": [{"kind": "clearProperty", "key": "diskFree"}]}
    with pytest.raises(InvalidValue) as e:
        check_rule(space, clear)
    assert str(e.value) == 'Action 1: "Disk free" can\'t be set by an automation.'

    engine = AutomationEngine(space, lambda _e: None, notifier=None)  # type: ignore[arg-type]
    action = AutomationRule.model_validate(rule).actions[0]
    _of, fm, _v = space.read(APP01)
    with pytest.raises(_ActionFailed) as e2:
        engine._prepare(action, space.type_by_id("host"), fm, APP01, NOW, {}, [], [])
    assert str(e2.value) == "“Patch state” can't be set by an automation."

    # an ordinary property of the same object still writes
    assert _snapshot(root) == before
    space.update_properties(APP01, {"ipAddress": "10.20.0.12"}, version)
    assert b"ipAddress: 10.20.0.12\n" in (root / APP01).read_bytes()


def test_sync_facts_outcomes(root: Path) -> None:
    space = _space(root)
    before = _snapshot(root)
    items = [
        _item("title", "APP01", {"diskFree": 12}),
        _item("alias", "PRN-TEST-01", {"rebootPending": True}),
        _item("key", "app01.example.test", {"patchState": "Current"}, key="fqdn"),
        _item("title", "WEB01", {"diskFree": 3}),
        _item("title", "Gateway", {"diskFree": 3}),
        _item("title", "Host template", {"diskFree": 3}),
        _item("title", "SRV-02", {"diskFree": "lots"}),
    ]
    out = space.sync_facts("host", items, HIDDEN)
    assert out.typeId == "host"
    assert out.refreshedAt == STAMP
    got = [(r.index, r.status, r.path) for r in out.results]
    assert got == [
        (0, "updated", APP01),
        (1, "updated", PRINT),
        (2, "updated", APP01),
        (3, "ambiguous", None),
        (4, "notFound", None),
        (5, "notFound", None),
        (6, "invalid", None),
    ]
    app_id = space.get(APP01).id
    assert out.results[0].objectId == app_id == "01KM2900000000000000000001"
    assert sorted(out.results[3].paths) == sorted([WEB01, LAB_WEB01])
    assert out.results[3].detail == '2 Hosts have the title "WEB01".'
    assert out.results[4].detail == 'No Host has the title "Gateway".'
    assert out.results[5].detail == 'No Host has the title "Host template".'
    assert out.results[6].detail == "Expected a number."

    print_id = space.get(PRINT).id
    assert print_id and out.results[1].objectId == print_id
    assert len(out.idWrites) == 1 and out.idWrites[0][0] == PRINT
    assert out.idWrites[0][1] == version_of((root / PRINT).read_bytes())

    store = _store(root)
    assert set(store) == {app_id, print_id}
    assert store[app_id] == {"values": {"diskFree": 12, "patchState": "Current"}, "refreshedAt": STAMP}
    assert store[print_id] == {"values": {"rebootPending": True}, "refreshedAt": STAMP}
    assert out.revision == space.synced._store.revision("host")

    after = _snapshot(root)
    changed = {k for k in after if after.get(k) != before.get(k)}
    assert changed == {PRINT, ".object/synced/host.json"}
    old_lines = before[PRINT].decode().splitlines(keepends=True)
    new_lines = after[PRINT].decode().splitlines(keepends=True)
    assert new_lines[0] == "---\n"
    assert new_lines[1] == f"id: {print_id}\n"
    assert [new_lines[0], *new_lines[2:]] == old_lines  # one id line and nothing else

    print_bytes = (root / PRINT).read_bytes()
    out2 = space.sync_facts("host", [_item("alias", "prn-test-01", {"diskFree": 9})], HIDDEN)
    assert out2.results[0].status == "updated" and out2.idWrites == []
    assert (root / PRINT).read_bytes() == print_bytes
    assert _store(root)[print_id]["values"] == {"rebootPending": True, "diskFree": 9}


def test_sync_merges_items_and_none_removes(root: Path) -> None:
    space = _space(root)
    space.sync_facts(
        "host",
        [
            _item("title", "APP01", {"diskFree": 12, "patchState": "Pending"}),
            _item("title", "app01", {"patchState": "Current"}),
        ],
        HIDDEN,
    )
    app_id = space.get(APP01).id
    assert _store(root)[app_id]["values"] == {"diskFree": 12, "patchState": "Current"}
    space.sync_facts("host", [_item("title", "APP01", {"diskFree": None})], HIDDEN)
    assert _store(root)[app_id]["values"] == {"patchState": "Current"}
    assert _row(space, APP01).values["diskFree"] is None


def test_sync_with_nothing_updated_writes_nothing(root: Path) -> None:
    space = _space(root)
    before = _snapshot(root)
    out = space.sync_facts("host", [_item("title", "Nope", {"diskFree": 1})], HIDDEN)
    assert [r.status for r in out.results] == ["notFound"]
    assert out.revision == ""
    assert _snapshot(root) == before


def test_sync_limits(root: Path) -> None:
    space = _space(root)
    with pytest.raises(InvalidValue) as e:
        space.sync_facts("page", [], HIDDEN)
    assert str(e.value) == "Page has no synced properties."
    with pytest.raises(InvalidValue) as e:
        space.sync_facts("host", [_item("title", "APP01", {})] * 1001, HIDDEN)
    assert str(e.value) == "At most 1000 items per call."
    with pytest.raises(KeyError):
        space.sync_facts("nope", [], HIDDEN)
    assert space.sync_facts("Host", [_item("title", "APP01", {"diskFree": 1})], HIDDEN).typeId == "host"


def test_unreadable_store_refuses_before_any_id_write(root: Path) -> None:
    space = _space(root)
    store = root / ".object" / "synced" / "host.json"
    store.parent.mkdir(parents=True)
    store.write_bytes(b"{not json")
    before = _snapshot(root)
    with pytest.raises(ReadOnly):
        space.sync_facts("host", [_item("title", "Print box", {"diskFree": 1})], HIDDEN)
    assert _snapshot(root) == before


def test_exports_include_synced_values(root: Path) -> None:
    space = _space(root)
    space.sync_facts(
        "host",
        [
            _item("title", "APP01", {"diskFree": 12, "patchState": "Current"}),
            _item("title", "SRV-02", {"lastBoot": "2026-11-08T07:12:00.000Z"}),
        ],
        HIDDEN,
    )
    disk = {p["key"]: p for p in export_properties(space, APP01)}
    assert disk["diskFree"]["empty"] is False
    assert disk["lastBoot"]["empty"] is True

    html = export_object(space, APP01, False, ExportOptions(format="html")).data.decode("utf-8")
    assert "Disk free" in html and "12" in html
    assert "Current" in html

    on_disk = (root / APP01).read_bytes()
    md = export_object(space, APP01, False, ExportOptions(format="md")).data
    assert b"diskFree" not in on_disk
    fm = parse_fm(split_object(md.decode("utf-8")).frontmatter_src or "")
    assert fm["diskFree"] == 12
    assert fm["patchState"] == "Current"
    assert fm["fqdn"] == "app01.example.test"
    assert (root / APP01).read_bytes() == on_disk

    srv = export_object(space, SRV02, False, ExportOptions(format="md")).data
    assert srv.startswith(b"\xef\xbb\xbf---\r\n")
    assert b"\n" not in srv.replace(b"\r\n", b"")
    text = srv[3:].decode("utf-8").replace("\r\n", "\n")
    srv_fm = parse_fm(split_object(text).frontmatter_src or "")
    assert srv_fm["lastBoot"] == "2026-11-08T07:12:00.000Z"  # the store's, not the hand-typed one
    assert text.count("lastBoot:") == 1

    # an object with no synced values exports its own bytes, and a hand-typed value is dropped
    web = export_object(space, WEB01, False, ExportOptions(format="md")).data
    assert web == (root / WEB01).read_bytes()
