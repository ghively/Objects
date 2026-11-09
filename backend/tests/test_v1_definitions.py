"""The token API's type and saved-query definitions (``/api/v1/types``, ``/api/v1/queries``):
a script can list, read, make and change them while Object is open, through the same app routes
the window uses (revision conflicts, read-only definitions, version history, the Trash and the
change events all hold). Fixtures as in `test_m11_api`.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.history import HistoryStore
from objectapp.server import create_app
from objectapp.space import Space

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
BAD_TYPE = ".object/types/bad.json"


@pytest.fixture
def api(space_dir: Path):
    # A type whose file isn't JSON: the window shows it read-only (`readOnlyReason`).
    bad = space_dir / BAD_TYPE
    bad.parent.mkdir(parents=True, exist_ok=True)
    bad.write_bytes(b"{not json")
    space = Space(space_dir)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    client = TestClient(app)
    return space, client, published


def _token(client: TestClient, scope: str = "read-write", name: str = "agent") -> dict:
    res = client.post("/api/integrations/tokens", json={"name": name, "scope": scope})
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['secret']}"}


def _events(published: list, kind: str, ident: str) -> list:
    """The published events of `kind` naming `ident`, waited for: the app's routes announce
    through the running loop (`server.announce`), a moment after the answer."""
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        found = [e for e in published if e.kind == kind and e.path == ident]
        if found:
            return found
        time.sleep(0.01)
    return []


def test_read_token_lists_and_reads_definitions_but_cannot_write(api) -> None:
    _space, client, _ = api
    rw = _token(client)
    ro = _token(client, "read", "reader")
    made = client.post("/api/v1/types", headers=rw, json={"name": "Book", "pluralName": "Books"})
    assert made.status_code == 201, made.text
    tid = made.json()["id"]
    q = client.post("/api/v1/queries", headers=rw, json={"name": "Books", "definition": {"types": [{"id": tid}]}})
    assert q.status_code == 201, q.text
    qid = q.json()["id"]

    types = client.get("/api/v1/types", headers=ro)
    assert types.status_code == 200
    by_id = {t["id"]: t for t in types.json()["types"]}
    assert by_id[tid]["name"] == "Book" and by_id[tid]["revision"] and by_id[tid]["readOnlyReason"] is None
    assert "page" in by_id  # the built-in types are listed too
    one = client.get(f"/api/v1/types/{tid}", headers=ro).json()
    assert one == by_id[tid]
    queries = client.get("/api/v1/queries", headers=ro)
    assert queries.status_code == 200
    listed = {x["id"]: x for x in queries.json()["queries"]}
    assert listed[qid]["name"] == "Books" and listed[qid]["revision"]
    assert client.get(f"/api/v1/queries/{qid}", headers=ro).json()["revision"] == listed[qid]["revision"]

    for method, url, body in (
        ("POST", "/api/v1/types", {"name": "Film", "pluralName": "Films"}),
        ("PUT", f"/api/v1/types/{tid}", {"revision": by_id[tid]["revision"], "type": by_id[tid]}),
        ("DELETE", f"/api/v1/types/{tid}", None),
        ("POST", "/api/v1/queries", {"name": "Q"}),
        ("PUT", f"/api/v1/queries/{qid}", {"revision": listed[qid]["revision"], "query": listed[qid]}),
        ("DELETE", f"/api/v1/queries/{qid}", None),
    ):
        res = client.request(method, url, headers=ro, json=body)
        assert res.status_code == 403, (method, url, res.text)
        assert res.json()["detail"] == "This token can only read."
    assert client.get("/api/v1/types").status_code == 401
    assert client.get("/api/v1/queries").status_code == 401


def test_the_type_list_is_what_the_window_gets(api) -> None:
    _space, client, _ = api
    hdr = _token(client)
    client.post("/api/v1/types", headers=hdr, json={"name": "Book", "pluralName": "Books"})
    window = client.get("/api/space").json()["types"]
    assert client.get("/api/v1/types", headers=hdr).json()["types"] == window
    window_queries = client.get("/api/queries").json()
    assert client.get("/api/v1/queries", headers=hdr).json()["queries"] == window_queries


def test_read_write_token_creates_and_edits_a_type_and_a_saved_query(api) -> None:
    space, client, published = api
    with client:
        _definition_writes(space, client, published)


def _definition_writes(space: Space, client: TestClient, published: list) -> None:
    hdr = _token(client)
    made = client.post("/api/v1/types", headers=hdr, json={"name": "Book", "pluralName": "Books"})
    assert made.status_code == 201, made.text
    t = made.json()
    tid = t["id"]
    created = _events(published, "types", tid)
    assert created and created[-1].origin == "api:agent"
    history = HistoryStore(space.root)
    assert history.versions(f".object/types/{tid}.json") == []

    t["propertyDefinitions"] = [*t.get("propertyDefinitions", []), {
        "id": "author", "key": "author", "name": "Author", "type": "text", "description": "",
        "icon": None, "visibility": "alwaysShow", "options": {},
    }]  # fmt: skip
    saved = client.put(f"/api/v1/types/{tid}", headers=hdr, json={"revision": t["revision"], "type": t})
    assert saved.status_code == 200, saved.text
    assert "author" in [p["id"] for p in saved.json()["type"]["propertyDefinitions"]]
    assert saved.json()["type"]["revision"] != t["revision"]
    # The window hears of the change, and the file's previous version is kept.
    assert len(_events(published, "types", tid)) == 2
    assert len(history.versions(f".object/types/{tid}.json")) == 1
    assert client.get(f"/api/v1/types/{tid}", headers=hdr).json()["revision"] == saved.json()["type"]["revision"]

    q = client.post("/api/v1/queries", headers=hdr, json={"name": "Books", "definition": {"types": [{"id": tid}]}})
    assert q.status_code == 201, q.text
    qid = q.json()["id"]
    assert _events(published, "queries", qid)[-1].origin == "api:agent"
    got = client.get(f"/api/v1/queries/{qid}", headers=hdr).json()
    edited = client.put(
        f"/api/v1/queries/{qid}", headers=hdr, json={"revision": got["revision"], "query": {**got, "name": "Books 2"}}
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["query"]["name"] == "Books 2"
    assert len(_events(published, "queries", qid)) == 2
    assert len(history.versions(f".object/queries/{qid}.json")) == 1
    assert (space.root / ".object/queries" / f"{qid}.json").is_file()

    # A delete goes to the Trash and comes back from it.
    gone = client.delete(f"/api/v1/queries/{qid}", headers=hdr)
    assert gone.status_code == 200, gone.text
    assert not (space.root / ".object/queries" / f"{qid}.json").exists()
    assert client.get(f"/api/v1/queries/{qid}", headers=hdr).status_code == 404
    assert len(_events(published, "queries", qid)) == 3
    trash = client.get("/api/v1/trash", headers=hdr).json()["items"]
    assert any(i["id"] == gone.json()["trashId"] and i["kind"] == "query" for i in trash)
    back = client.post(f"/api/v1/trash/{gone.json()['trashId']}/restore", headers=hdr)
    assert back.status_code == 200, back.text
    assert client.get(f"/api/v1/queries/{qid}", headers=hdr).json()["name"] == "Books 2"

    activity = client.get("/api/v1/changes", headers=hdr).json()["activity"]
    assert {e["action"] for e in activity} >= {"create-type", "edit-type", "create-query", "edit-query", "delete-query"}


def test_a_stale_revision_is_refused(api) -> None:
    _space, client, _ = api
    hdr = _token(client)
    t = client.post("/api/v1/types", headers=hdr, json={"name": "Book", "pluralName": "Books"}).json()
    first = client.put(f"/api/v1/types/{t['id']}", headers=hdr, json={"revision": t["revision"], "type": {**t, "name": "Novel"}})
    assert first.status_code == 200, first.text
    stale = client.put(f"/api/v1/types/{t['id']}", headers=hdr, json={"revision": t["revision"], "type": {**t, "name": "Tome"}})
    assert stale.status_code == 409
    assert stale.json()["currentRevision"] == first.json()["type"]["revision"]
    assert stale.json()["detail"] == "The definition changed since that revision. Read it again and retry."
    assert client.get(f"/api/v1/types/{t['id']}", headers=hdr).json()["name"] == "Novel"

    q = client.post("/api/v1/queries", headers=hdr, json={"name": "Q"}).json()
    ok = client.put(f"/api/v1/queries/{q['id']}", headers=hdr, json={"revision": q["revision"], "query": {**q, "name": "Q2"}})
    assert ok.status_code == 200, ok.text
    stale = client.put(f"/api/v1/queries/{q['id']}", headers=hdr, json={"revision": q["revision"], "query": {**q, "name": "Q3"}})
    assert stale.status_code == 409 and stale.json()["currentRevision"]


def test_a_read_only_type_is_refused_and_its_file_untouched(api) -> None:
    space, client, _ = api
    hdr = _token(client)
    listed = {t["id"]: t for t in client.get("/api/v1/types", headers=hdr).json()["types"]}
    assert listed["bad"]["readOnlyReason"]
    before = (space.root / BAD_TYPE).stat().st_mtime_ns
    res = client.put(
        "/api/v1/types/bad", headers=hdr,
        json={"revision": listed["bad"]["revision"], "type": {**listed["bad"], "name": "Bad", "pluralName": "Bads"}},
    )
    assert res.status_code == 423
    assert res.json()["detail"] == listed["bad"]["readOnlyReason"]
    assert (space.root / BAD_TYPE).read_bytes() == b"{not json"
    assert (space.root / BAD_TYPE).stat().st_mtime_ns == before
