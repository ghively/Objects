"""M32 fix pass, finding 11: the words a person reads in the New type dialog.

The dialog shows the back end's ``detail`` as it is, so the errors of making, renaming and
deleting a type say "type", the glossary's word, not "object type". The 404s ('There is no
object type "…"', 'There is no object at "…"') keep their wording (the plan's call 4).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space


@pytest.fixture
def c(tmp_path: Path):
    root = create_space("Notes", tmp_path)
    with TestClient(
        create_app(Space(root), None, watch=False), base_url="http://127.0.0.1", client=("127.0.0.1", 50000)
    ) as client:
        yield client


def test_a_name_in_use(c: TestClient):
    assert c.post("/api/types", json={"name": "Recipe", "pluralName": "Recipes"}).status_code == 201
    r = c.post("/api/types", json={"name": "recipe", "pluralName": "Recipes 2"})
    assert r.status_code == 422
    assert r.json()["detail"] == 'A type named "recipe" already exists.'
    r = c.post("/api/types", json={"name": "Task", "pluralName": "Chores"})
    assert r.json()["detail"] == 'A type named "Task" already exists.'


def test_a_missing_name_or_plural(c: TestClient):
    for body in ({"name": "", "pluralName": "Recipes"}, {"name": "Recipe", "pluralName": " "}):
        r = c.post("/api/types", json=body)
        assert r.status_code == 422
        assert r.json()["detail"] == "A type needs a name and a plural name."


def test_renaming_a_type(c: TestClient):
    a = c.post("/api/types", json={"name": "Recipe", "pluralName": "Recipes"}).json()
    c.post("/api/types", json={"name": "Trip", "pluralName": "Trips"})
    rev = a.pop("revision")
    r = c.put(f"/api/types/{a['id']}", json={"type": {**a, "name": "Trip"}, "baseRevision": rev})
    assert r.status_code == 422 and r.json()["detail"] == 'A type named "Trip" already exists.'
    r = c.put(f"/api/types/{a['id']}", json={"type": {**a, "name": ""}, "baseRevision": rev})
    assert r.status_code == 422 and r.json()["detail"] == "A type needs a name and a plural name."
    r = c.put(f"/api/types/{a['id']}", json={"type": {**a, "pluralName": "  "}, "baseRevision": rev})
    assert r.status_code == 422 and r.json()["detail"] == "A type needs a name and a plural name."


def test_an_unknown_gallery_entry_and_a_basic_type(c: TestClient):
    r = c.post("/api/types", json={"template": "no-such-entry"})
    assert r.status_code == 422 and r.json()["detail"] == 'Unknown type template "no-such-entry".'
    r = c.request("DELETE", "/api/types/task", params={"confirm": "true"})
    assert r.status_code == 422 and r.json()["detail"] == "Basic types cannot be deleted."


def test_the_404s_keep_their_words(c: TestClient):
    r = c.post("/api/objects", json={"typeId": "nope", "title": "x"})
    assert r.status_code == 404 and r.json()["detail"] == 'There is no object type "nope".'
    r = c.get("/api/object", params={"path": "Pages/Nope.md"})
    assert r.status_code == 404 and r.json()["detail"] == 'There is no object at "Pages/Nope.md".'
