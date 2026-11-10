"""M29 Task 6: ``POST /api/v1/synced/{typeId}``, the ``sync`` scope and the type-save checks.

Plan ``2026-11-09-m29-synced-facts-and-type-suggestion.md``, Task 6 and Review Focus 1, 3 and 4.
Every test runs `create_app` (no ``ui_key``) over a copy of the synthetic ``space-synced``
fixture; tokens are made through `TokenStore`.
"""

from __future__ import annotations

import json
import shutil
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore
from objectapp.typemodel import type_revision

FIXTURE = Path(__file__).parent / "fixtures" / "space-synced"
NOW = datetime(2026, 11, 9, 8, 0, 0, tzinfo=UTC)
STAMP = "2026-11-09T08:00:00.000Z"

APP01 = "Hosts/APP01.md"
SRV02 = "Hosts/SRV-02.md"
PRINT = "Hosts/Print box.md"
WEB01 = "Hosts/WEB01.md"
LAB_WEB01 = "Hosts/Lab/WEB01.md"
PAGE_APP01 = "Pages/APP01.md"
SYNC_ONLY = "This token can only write synced facts."
CANT_SYNC = "This token can't write synced facts."


@dataclass
class Env:
    root: Path
    space: Space
    client: TestClient
    published: list
    history: list


def _copy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    root = tmp_path / "space"
    shutil.copytree(FIXTURE, root)
    return root


def _open(root: Path):
    space = Space(root)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    history: list = []
    keep = space.before_write

    def before_write(rel, data, object_id=None):
        history.append(rel)
        if keep is not None:
            keep(rel, data, object_id)

    space.before_write = before_write
    return space, app, published, history


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = _copy(tmp_path, monkeypatch)
    space, app, published, history = _open(root)
    with TestClient(app) as client:
        yield Env(root, space, client, published, history)


def _token(root: Path, scope: str, name: str = "Inventory") -> dict:
    _record, secret = TokenStore(root).create(name, scope)
    return {"Authorization": f"Bearer {secret}"}


def _item(by: str, value, values: dict, key: str | None = None) -> dict:
    match: dict = {"by": by, "value": value}
    if key is not None:
        match["key"] = key
    return {"match": match, "values": values}


def _sync(env: Env, hdr: dict, items, type_id: str = "host"):
    return env.client.post(f"/api/v1/synced/{type_id}", headers=hdr, json={"items": items})


def _store(root: Path) -> dict:
    return json.loads((root / ".object" / "synced" / "host.json").read_text("utf-8"))


def _files(root: Path) -> dict[str, bytes]:
    """Every ``.md`` and every type JSON of the space."""
    out = {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*.md")}
    for p in (root / ".object" / "types").glob("*.json"):
        out[p.relative_to(root).as_posix()] = p.read_bytes()
    return out


def _wait(published: list, pred, count: int) -> list:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        got = [e for e in published if pred(e)]
        if len(got) >= count:
            return got
        time.sleep(0.01)
    return [e for e in published if pred(e)]


SEVEN = [
    _item("title", "APP01", {"diskFree": 12}),
    _item("alias", "PRN-TEST-01", {"rebootPending": True}),
    _item("key", "app01.example.test", {"patchState": "Current"}, key="fqdn"),
    _item("title", "WEB01", {"diskFree": 3}),
    _item("title", "Gateway", {"diskFree": 3}),
    _item("title", "Host template", {"diskFree": 3}),
    _item("title", "SRV-02", {"diskFree": "lots"}),
]


def test_scope_rules(env: Env) -> None:
    one = [_item("title", "APP01", {"diskFree": 12})]
    sync = _token(env.root, "sync")
    res = _sync(env, sync, one)
    assert res.status_code == 200, res.text
    assert res.json()["updated"] == 1
    who = env.client.get("/api/v1/whoami", headers=sync).json()
    assert who["scope"] == "sync" and who["name"] == "Inventory"
    assert env.client.get("/api/v1/schema", headers=sync).status_code == 200
    assert env.client.get(f"/api/v1/object?path={APP01}", headers=sync).status_code == 200
    version = env.space.cached_version(APP01)
    res = env.client.post(
        "/api/v1/object/properties",
        headers=sync,
        json={"path": APP01, "version": version, "set": {"ipAddress": "10.20.0.12"}},
    )
    assert res.status_code == 403 and res.json()["detail"] == SYNC_ONLY
    res = env.client.post("/api/v1/objects", headers=sync, json={"type": "Page", "title": "X"})
    assert res.status_code == 403 and res.json()["detail"] == SYNC_ONLY

    read = _token(env.root, "read", "Reader")
    res = _sync(env, read, one)
    assert res.status_code == 403 and res.json()["detail"] == CANT_SYNC
    res = env.client.post(
        "/api/v1/object/properties",
        headers=read,
        json={"path": APP01, "version": version, "set": {"ipAddress": "10.20.0.12"}},
    )
    assert res.status_code == 403 and res.json()["detail"] == "This token can only read."

    rw = _token(env.root, "read-write", "Writer")
    assert _sync(env, rw, one).status_code == 200
    res = env.client.post("/api/v1/synced/host", json={"items": one})
    assert res.status_code == 401 and isinstance(res.json()["detail"], str)

    made = env.client.post("/api/integrations/tokens", json={"name": "Script", "scope": "sync"})
    assert made.status_code == 201 and made.json()["token"]["scope"] == "sync"
    bad = env.client.post("/api/integrations/tokens", json={"name": "Script", "scope": "admin"})
    assert bad.status_code == 422 and bad.json()["detail"] == "scope must be read, read-write or sync."


def test_item_results(env: Env) -> None:
    hdr = _token(env.root, "sync")
    res = _sync(env, hdr, SEVEN)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["type"] == "host" and body["refreshedAt"] == STAMP
    assert body["revision"] == env.space.synced.revision("host")
    assert body["updated"] == 3
    results = body["results"]
    assert [(r["index"], r["status"]) for r in results] == [
        (0, "updated"),
        (1, "updated"),
        (2, "updated"),
        (3, "ambiguous"),
        (4, "notFound"),
        (5, "notFound"),
        (6, "invalid"),
    ]
    assert results[0]["path"] == APP01 and results[0]["objectId"] == "01KM2900000000000000000001"
    assert results[1]["path"] == PRINT and results[1]["objectId"]
    assert results[2]["path"] == APP01
    assert sorted(results[3]["paths"]) == sorted([WEB01, LAB_WEB01])
    assert results[3]["detail"] == '2 Hosts have the title "WEB01".'
    assert results[4]["detail"] == 'No Host has the title "Gateway".'
    assert results[5]["detail"] == 'No Host has the title "Host template".'
    assert results[6]["detail"] == "Expected a number."
    assert "paths" not in results[0] and "detail" not in results[0]  # None fields left out

    by_name = _sync(env, hdr, [_item("title", "SRV-02", {"diskFree": 40})], type_id="Host")
    assert by_name.status_code == 200 and by_name.json()["results"][0]["status"] == "updated"

    nope = _sync(env, hdr, [], type_id="nope")
    assert nope.status_code == 404 and nope.json()["detail"] == 'There is no object type "nope".'
    page = _sync(env, hdr, [], type_id="page")
    assert page.status_code == 422 and page.json()["detail"] == "Page has no synced properties."
    many = _sync(env, hdr, [_item("title", "APP01", {"diskFree": 1})] * 1001)
    assert many.status_code == 422 and many.json()["detail"] == "At most 1000 items per call."
    for bad in ({"items": "x"}, {"things": []}, [1, 2]):
        res = env.client.post("/api/v1/synced/host", headers=hdr, json=bad)
        assert res.status_code == 422 and isinstance(res.json()["detail"], str), bad
    res = env.client.post(
        "/api/v1/synced/host", headers={**hdr, "content-type": "application/json"}, content=b"{nope"
    )
    assert res.status_code == 422 and isinstance(res.json()["detail"], str)
    # A malformed item is that item's "invalid"; the others still land.
    res = _sync(env, hdr, ["x", {"match": {"by": 5}}, _item("title", "APP01", {"diskFree": 7})])
    assert [r["status"] for r in res.json()["results"]] == ["invalid", "invalid", "updated"]
    assert _store(env.root)["01KM2900000000000000000001"]["values"]["diskFree"] == 7


def test_sync_never_touches_md_files(env: Env) -> None:
    root = env.root
    before = _files(root)
    srv02 = before[SRV02]
    assert srv02.startswith(b"\xef\xbb\xbf") and b"\r\n" in srv02
    hdr = _token(root, "sync")
    everything = {
        "lastBoot": "2026-11-08T07:12:00.000Z",
        "diskFree": 20,
        "patchState": "Pending",
        "rebootPending": False,
        "lastSeen": "2026-11-09T07:55:00.000Z",
    }
    first = _sync(
        env,
        hdr,
        [
            _item("title", "APP01", everything),
            _item("alias", "PRN-TEST-01", everything),
            _item("title", "SRV-02", everything),
            _item("key", "web01.example.test", everything, key="fqdn"),
            _item("key", "web01.lab.example.test", everything, key="fqdn"),
        ],
    )
    assert first.json()["updated"] == 5, first.text
    print_id = env.space.get(PRINT).id
    after = _files(root)
    assert {k for k in after if after[k] != before.get(k)} == {PRINT}
    old_lines = before[PRINT].decode().splitlines(keepends=True)
    new_lines = after[PRINT].decode().splitlines(keepends=True)
    assert new_lines[1] == f"id: {print_id}\n"
    assert [new_lines[0], *new_lines[2:]] == old_lines  # one id line and nothing else

    second = _sync(env, hdr, [_item("alias", "prn-test-01", {"diskFree": 9})])
    assert second.json()["updated"] == 1
    third = _sync(env, hdr, [_item("title", "SRV-02", {"lastBoot": None})])
    assert third.json()["updated"] == 1
    assert _files(root) == after
    assert (root / SRV02).read_bytes() == srv02  # CRLF and the BOM kept
    assert [rel for rel in env.history if rel.endswith(".md")] == []  # no version kept
    store = _store(root)
    assert store[print_id]["values"]["diskFree"] == 9
    assert "lastBoot" not in store["01KM2900000000000000000002"]["values"]
    assert store["01KM2900000000000000000002"]["values"]["diskFree"] == 20


def test_two_threads_keep_both_keys(env: Env) -> None:
    hdr = _token(env.root, "sync")
    barrier = threading.Barrier(2)
    answers: list = []

    def run(values: dict) -> None:
        barrier.wait()
        answers.append(_sync(env, hdr, [_item("title", "APP01", values)]).status_code)

    threads = [
        threading.Thread(target=run, args=({"lastBoot": "2026-11-08T07:12:00.000Z"},)),
        threading.Thread(target=run, args=({"diskFree": 12},)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert answers == [200, 200]
    values = _store(env.root)["01KM2900000000000000000001"]["values"]
    assert values == {"lastBoot": "2026-11-08T07:12:00.000Z", "diskFree": 12}


def test_events_and_activity(env: Env) -> None:
    hdr = _token(env.root, "sync", "Inventory")
    items = [_item("title", "APP01", {"diskFree": 12}), _item("alias", "PRN-TEST-01", {"diskFree": 1})]
    first = _sync(env, hdr, items).json()
    kinds = ("synced", "changed")
    got = _wait(env.published, lambda e: e.kind in kinds, 2)
    assert [(e.kind, e.path) for e in got] == [("changed", PRINT), ("synced", "host")]
    synced = got[1]
    assert synced.version == first["revision"] and synced.origin == "api:Inventory"
    assert got[0].origin == "api:Inventory"
    assert got[0].version == env.space.cached_version(PRINT)

    items[0]["values"]["diskFree"] = 13
    second = _sync(env, hdr, items).json()
    got = _wait(env.published, lambda e: e.kind in kinds, 3)
    assert [(e.kind, e.path) for e in got][2:] == [("synced", "host")]  # no second id write
    assert got[2].version == second["revision"] != first["revision"]

    nothing = _sync(env, hdr, [_item("title", "Nobody", {"diskFree": 1})]).json()
    assert nothing["updated"] == 0
    time.sleep(0.1)
    assert len([e for e in env.published if e.kind in kinds]) == 3  # nothing updated: no event

    log = env.client.get("/api/v1/changes", headers=hdr).json()["activity"]
    syncs = [e for e in log if e["action"] == "sync"]
    assert len(syncs) == 3
    assert {e["path"] for e in syncs} == {".object/synced/host.json"}
    assert [e["count"] for e in syncs] == [2, 2, 0]
    assert {e["token"] for e in syncs} == {"Inventory"}


def test_object_read_and_rows(env: Env) -> None:
    hdr = _token(env.root, "sync")
    before = env.client.get(f"/api/object?path={APP01}").json()
    assert before["synced"] == {
        "refreshedAt": None,
        "values": {
            "lastBoot": None,
            "diskFree": None,
            "patchState": [],
            "rebootPending": False,
            "lastSeen": None,
        },
    }
    out = _sync(env, hdr, [_item("title", "APP01", {"diskFree": 12, "patchState": "Current"})]).json()
    detail = env.client.get(f"/api/object?path={APP01}").json()
    assert detail["synced"]["values"]["diskFree"] == 12
    assert detail["synced"]["refreshedAt"] == out["refreshedAt"] == STAMP
    assert "diskFree" not in detail["frontmatter"]

    srv = env.client.get(f"/api/object?path={SRV02}").json()
    assert srv["frontmatter"]["lastBoot"] == "2020-01-01T00:00:00.000Z"  # the file's own line
    assert srv["synced"]["values"]["lastBoot"] is None  # ignored for display

    rows = env.client.post("/api/rows", json={"typeIds": ["host"]}).json()["rows"]
    by_path = {r["summary"]["path"]: r for r in rows}
    assert by_path[APP01]["syncedAt"] == STAMP
    assert by_path[APP01]["values"]["diskFree"] == 12
    for key in ("lastBoot", "diskFree", "patchState", "rebootPending", "lastSeen"):
        # decoded as the rows decode them
        assert detail["synced"]["values"][key] == by_path[APP01]["values"][key], key
    assert by_path[APP01]["values"]["patchState"]  # the "Current" option
    assert by_path[SRV02]["syncedAt"] is None
    page = env.client.get(f"/api/object?path={PAGE_APP01}").json()
    assert "synced" not in page

    # The v1 reads built on the rows: an agent sees the facts and when they were refreshed.
    q = env.client.post("/api/v1/query", headers=hdr, json={"typeIds": ["Host"]}).json()["rows"]
    v1_rows = {r["path"]: r for r in q}
    assert v1_rows[APP01]["values"]["diskFree"] == 12 and v1_rows[APP01]["syncedAt"] == STAMP
    assert v1_rows[SRV02]["syncedAt"] is None and v1_rows[SRV02]["values"]["lastBoot"] is None
    for route in ("/api/v1/object", "/api/v1/object/peek"):
        got = env.client.get(f"{route}?path={APP01}", headers=hdr).json()
        assert got["values"]["diskFree"] == 12 and got["syncedAt"] == STAMP, route
        assert "syncedAt" not in env.client.get(f"{route}?path={PAGE_APP01}", headers=hdr).json()


def test_rollup_reads_related_synced_values(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """`Computer.obj`: a rollup or formula over a related Host's synced property sees the
    store's value, never the related file's own line (SRV-02's hand-typed ``lastBoot``)."""
    root = _copy(tmp_path, monkeypatch)
    host_json = root / ".object" / "types" / "host.json"
    data = json.loads(host_json.read_text("utf-8"))
    data["propertyDefinitions"] += [
        {
            "id": "peers",
            "key": "peers",
            "name": "Peers",
            "type": "entity",
            "options": {"isArray": True, "allowedTypes": ["host"], "hasFixedSet": False, "fixedSet": []},
        },
        {
            "id": "peerBoot",
            "key": "peerBoot",
            "name": "Peer boot",
            "type": "rollup",
            "options": {"relationId": "peers", "targetId": "lastBoot", "calc": "earliestDate"},
        },
        {
            "id": "peerDisk",
            "key": "peerDisk",
            "name": "Peer disk",
            "type": "rollup",
            "options": {"relationId": "peers", "targetId": "diskFree", "calc": "sum"},
        },
    ]
    host_json.write_text(json.dumps(data, indent=2), "utf-8")
    lab = root / LAB_WEB01
    lab.write_text(
        lab.read_text("utf-8").replace("fqdn: web01.lab.example.test\n",
                                       'fqdn: web01.lab.example.test\npeers:\n  - "[[SRV-02]]"\n'),
        "utf-8",
    )
    space, app, _published, _history = _open(root)
    with TestClient(app) as client:
        def computed() -> dict:
            return client.get(f"/api/object?path={LAB_WEB01}").json()["computed"]

        def row() -> dict:
            rows = client.post("/api/rows", json={"typeIds": ["host"]}).json()["rows"]
            return next(r for r in rows if r["summary"]["path"] == LAB_WEB01)["values"]

        assert "2020" not in json.dumps(computed()["peerBoot"])  # the file's line is ignored
        assert "2020" not in json.dumps(row()["peerBoot"])
        hdr = _token(root, "sync")
        res = _sync_client(client, hdr, [
            _item("title", "SRV-02", {"lastBoot": "2026-11-08T07:12:00.000Z", "diskFree": 40}),
        ])
        assert res.json()["updated"] == 1
        got = computed()
        assert "2026-11-08" in json.dumps(got["peerBoot"])
        assert got["peerDisk"]["value"] == 40
        assert "2026-11-08" in json.dumps(row()["peerBoot"])
        assert row()["peerDisk"]["value"] == 40


def _sync_client(client: TestClient, hdr: dict, items: list):
    return client.post("/api/v1/synced/host", headers=hdr, json={"items": items})


def test_unreadable_store_is_423(env: Env) -> None:
    folder = env.root / ".object" / "synced"
    folder.mkdir(parents=True)
    broken = folder / "host.json"
    broken.write_bytes(b'{"01KM2900000000000000000001": {"values": ')
    md_before = _files(env.root)
    hdr = _token(env.root, "sync")
    res = _sync(env, hdr, [_item("alias", "PRN-TEST-01", {"diskFree": 1})])
    assert res.status_code == 423
    assert isinstance(res.json()["detail"], str) and res.json()["reason"] == res.json()["detail"]
    assert broken.read_bytes() == b'{"01KM2900000000000000000001": {"values": '
    assert _files(env.root) == md_before  # not even the id line


def test_store_edited_outside_mid_call_is_retried(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    """`SyncedStore.apply` raises `RevisionConflict` when the file changes between its read and
    its write: the route tries once more, and answers 409 (a string detail) when it keeps
    changing."""
    from objectapp.typemodel import RevisionConflict

    hdr = _token(env.root, "sync")
    store = env.space.synced
    real = store.apply
    calls = {"n": 0}

    def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RevisionConflict("x")
        return real(*args, **kwargs)

    monkeypatch.setattr(store, "apply", flaky)
    res = _sync(env, hdr, [_item("alias", "PRN-TEST-01", {"diskFree": 1})])
    assert res.status_code == 200 and res.json()["updated"] == 1
    got = _wait(env.published, lambda e: e.kind in ("synced", "changed"), 2)
    assert [(e.kind, e.path) for e in got] == [("changed", PRINT), ("synced", "host")]

    def always(*args, **kwargs):
        raise RevisionConflict("x")

    monkeypatch.setattr(store, "apply", always)
    res = _sync(env, hdr, [_item("title", "APP01", {"diskFree": 1})])
    assert res.status_code == 409 and isinstance(res.json()["detail"], str)


def test_type_save_checks(env: Env) -> None:
    host_json = env.root / ".object" / "types" / "host.json"

    def put(change) -> object:
        data = json.loads(host_json.read_text("utf-8"))
        change(data)
        return env.client.put(
            "/api/types/host",
            json={"type": data, "baseRevision": type_revision(env.root, "host")},
        )

    before = host_json.read_bytes()
    res = put(lambda d: d.update(namePatterns=["{foo}"]))
    assert res.status_code == 422
    assert res.json()["detail"] == (
        "\"{foo}\" isn't a name pattern. Use *, ?, #, @ or one of {ip}, {cidr}, {fqdn}, {version}."
    )
    res = put(lambda d: d.update(namePatterns="SRV-*"))
    assert res.status_code == 422 and isinstance(res.json()["detail"], str)
    res = put(lambda d: d.update(namePatterns=[f"SRV-{i}*" for i in range(21)]))
    assert res.status_code == 422 and res.json()["detail"] == "A type can have at most 20 name patterns."

    def mark_tags(d: dict) -> None:
        tags = next(p for p in d["propertyDefinitions"] if p["key"] == "tags")
        tags["synced"] = {"source": "Inventory script", "staleAfterDays": 7}

    res = put(mark_tags)
    assert res.status_code == 422
    assert res.json()["detail"] == (
        '"Tags" can\'t be synced: only text, URL, number, checkbox, date and label properties can.'
    )

    def bad_stale(d: dict) -> None:
        disk = next(p for p in d["propertyDefinitions"] if p["key"] == "diskFree")
        disk["synced"] = {"source": "Inventory script", "staleAfterDays": 0}

    res = put(bad_stale)
    assert res.status_code == 422
    assert res.json()["detail"] == '"Stale after" of "Disk free" must be a whole number of days from 1 to 365.'
    assert host_json.read_bytes() == before  # nothing written by a refused save

    def good(d: dict) -> None:
        d["namePatterns"] = ["SRV-*", "{ip}"]
        d["propertyDefinitions"].append(
            {
                "id": "owner",
                "key": "owner",
                "name": "Owner",
                "type": "text",
                "synced": {"source": "CMDB export", "staleAfterDays": 30},
            }
        )

    res = put(good)
    assert res.status_code == 200, res.text
    saved = json.loads(host_json.read_text("utf-8"))
    assert saved["namePatterns"] == ["SRV-*", "{ip}"]
    owner = next(p for p in saved["propertyDefinitions"] if p["key"] == "owner")
    assert owner["synced"] == {"source": "CMDB export", "staleAfterDays": 30}
