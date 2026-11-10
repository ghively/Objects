"""M31 item 9: restoring an earlier version of a type, collection or saved query definition.

``POST /api/history/definition/restore`` puts a kept version back through the space's own save
methods (revision checked, the current state kept as a version first), never a raw file write.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space

T0 = datetime(2026, 11, 10, 9, 0, tzinfo=UTC)
COLLECTION = ".object/collections/reading-list.json"
QUERY = ".object/queries/open-tasks.json"
PERSON = ".object/types/person.json"
ADA = "People/Ada Lovelace.md"
ROUTE = "/api/history/definition/restore"


class Clock:
    def __init__(self, at: datetime = T0) -> None:
        self.at = at

    def __call__(self) -> datetime:
        return self.at

    def advance(self, **kw) -> None:
        self.at += timedelta(**kw)


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def space(m8_space_dir: Path) -> Space:
    return Space(m8_space_dir)


@pytest.fixture
def client(space: Space, clock: Clock):
    app = create_app(space, watch=False)
    space.clock = clock
    space.tz = UTC
    with TestClient(app) as c:
        yield c


def versions(c: TestClient, rel: str) -> list[dict]:
    r = c.get("/api/history/definition", params={"path": rel})
    assert r.status_code == 200, r.text
    return r.json()["versions"]


def version_text(c: TestClient, rel: str, vid: str) -> str:
    return c.get("/api/history/definition/version", params={"path": rel, "id": vid}).json()["text"]


def collection(c: TestClient) -> dict:
    return next(x for x in c.get("/api/collections").json() if x["id"] == "reading-list")


def query(c: TestClient) -> dict:
    return next(x for x in c.get("/api/queries").json() if x["id"] == "open-tasks")


def person(c: TestClient) -> dict:
    return next(t for t in c.get("/api/space").json()["types"] if t["id"] == "person")


def test_restore_a_collection_version(client: TestClient, space: Space, clock: Clock):
    col = collection(client)
    r = client.put("/api/collections/reading-list", json={"collection": {**col, "name": "Shelf"}, "baseRevision": col["revision"]})
    assert r.status_code == 200, r.text
    [v1] = versions(client, COLLECTION)
    assert '"Reading list"' in version_text(client, COLLECTION, v1["id"])

    clock.advance(minutes=1)  # inside the 5-minute gap: only the restore's own version is kept
    stale = col["revision"]
    r = client.post(ROUTE, json={"path": COLLECTION, "id": v1["id"], "baseRevision": stale})
    assert r.status_code == 409, r.text
    assert r.json()["currentRevision"] == collection(client)["revision"]
    assert collection(client)["name"] == "Shelf"
    assert len(versions(client, COLLECTION)) == 1  # a refused restore keeps nothing

    current = collection(client)
    r = client.post(ROUTE, json={"path": COLLECTION, "id": v1["id"], "baseRevision": current["revision"]})
    assert r.status_code == 200, r.text
    after = collection(client)
    assert after["name"] == "Reading list"
    assert r.json()["revision"] == after["revision"]
    # The renamed state was kept first, so the restore can be undone.
    vs = versions(client, COLLECTION)
    assert len(vs) == 2
    assert '"Shelf"' in version_text(client, COLLECTION, vs[0]["id"])
    # The former name a rename recorded is kept.
    assert "Shelf" in after["formerNames"]
    on_disk = json.loads((space.root / COLLECTION).read_text())
    assert on_disk["name"] == "Reading list" and on_disk["id"] == "reading-list"


def test_restore_a_query_version(client: TestClient, space: Space, clock: Clock):
    q = query(client)
    edited = {**q, "description": "Only the urgent ones", "definition": {**q["definition"], "search": {"searchTerms": [{"text": "urgent"}], "searchMode": "auto"}}}
    r = client.put("/api/queries/open-tasks", json={"query": edited, "baseRevision": q["revision"]})
    assert r.status_code == 200, r.text
    [v1] = versions(client, QUERY)
    clock.advance(minutes=10)
    r = client.post(ROUTE, json={"path": QUERY, "id": v1["id"], "baseRevision": query(client)["revision"]})
    assert r.status_code == 200, r.text
    after = query(client)
    assert after["description"] == ""
    assert "search" not in after["definition"] or not after["definition"]["search"]
    assert after["id"] == "open-tasks"
    assert len(versions(client, QUERY)) == 2


def test_restore_a_type_version_asks_before_removing_values(client: TestClient, space: Space, clock: Clock):
    ada = space.root / ADA
    t = person(client)
    email = {
        "id": "email", "key": "email", "name": "Email", "type": "email", "description": "",
        "icon": None, "visibility": "alwaysShow", "options": {},
    }
    r = client.put("/api/types/person", json={"type": {**t, "propertyDefinitions": [*t["propertyDefinitions"], email]}, "baseRevision": t["revision"]})
    assert r.status_code == 200, r.text
    ver = client.get("/api/object", params={"path": ADA}).json()["version"]
    r = client.put("/api/object/properties", json={"path": ADA, "updates": {"email": "ada@example.com"}, "baseVersion": ver})
    assert r.status_code == 200, r.text
    [v1] = versions(client, PERSON)
    assert '"email"' not in version_text(client, PERSON, v1["id"])

    clock.advance(minutes=1)
    rev = person(client)["revision"]
    before = ada.read_bytes()
    r = client.post(ROUTE, json={"path": PERSON, "id": v1["id"], "baseRevision": rev})
    assert r.status_code == 428, r.text
    assert r.json()["affected"] == 1
    assert ada.read_bytes() == before
    assert person(client)["revision"] == rev
    kept = versions(client, PERSON)
    assert len(kept) == 2  # the current state, kept before the save was tried

    r = client.post(ROUTE, json={"path": PERSON, "id": v1["id"], "baseRevision": rev, "confirm": True})
    assert r.status_code == 200, r.text
    assert ADA in r.json()["rewritten"]
    assert "email" not in [p["key"] for p in person(client)["propertyDefinitions"]]
    assert b"email:" not in ada.read_bytes()
    # The retry kept no second copy of the same state.
    assert len(versions(client, PERSON)) == 2
    assert '"email"' in version_text(client, PERSON, versions(client, PERSON)[0]["id"])


def test_restore_refuses_bad_paths_and_unknown_versions(client: TestClient, space: Space):
    col = collection(client)
    for bad in ("Pages/Source note.md", ".object/views/page.json", ".object/types/../x.json"):
        r = client.post(ROUTE, json={"path": bad, "id": "x", "baseRevision": ""})
        assert r.status_code == 400, (bad, r.text)
    r = client.post(ROUTE, json={"path": COLLECTION, "id": "20260101T000000000Z", "baseRevision": col["revision"]})
    assert r.status_code == 404
    r = client.post(ROUTE, json={"path": ".object/collections/nothing-here.json", "id": "x", "baseRevision": ""})
    assert r.status_code == 404
    assert collection(client)["revision"] == col["revision"]
