"""M28 Task 5: the counterpart routes (``GET /api/object`` and ``GET /api/space`` carry them,
``POST /api/object/counterpart`` edits them, ``/api/v1`` reads carry them) and Review Focus 2
(reads write nothing).

Plan ``docs/superpowers/plans/2026-11-09-m28-itops-starter-and-relations.md``, Contract
"Routes and events". ``create_app`` on a copy of ``space-itops`` committed to a throw-away git
repo, no ``ui_key``.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.watcher import ChangeEvent

FIXTURE = Path(__file__).parent / "fixtures" / "space-itops"

APP01 = "Hosts/APP-TEST-01.md"
DB01 = "Hosts/DB-TEST-01.md"
INVENTORY = "Applications/Inventory app.md"
WEB = "Containers/inventory-web.md"
SAM = "People/Sam Example.md"


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
         "-c", "core.autocrlf=false", *args],
        cwd=root, check=True, capture_output=True, text=True,
    ).stdout


class Env:
    def __init__(self, root: Path, state: Path, space: Space, client: TestClient,
                 published: list[ChangeEvent]) -> None:
        self.root, self.state, self.space, self.c, self.published = (
            root, state, space, client, published
        )

    def status(self) -> str:
        return _git(self.root, "status", "--porcelain", "--untracked-files=all")

    def snapshot(self) -> dict[str, bytes]:
        return {
            str(p.relative_to(self.root)): p.read_bytes()
            for p in sorted(self.root.rglob("*"))
            if p.is_file() and ".git" not in p.relative_to(self.root).parts
        }

    def state_files(self) -> list[str]:
        if not self.state.exists():
            return []
        return sorted(str(p.relative_to(self.state)) for p in self.state.rglob("*"))


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Env:
    state = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(state))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.delenv("OBJECT_CLOCK_FILE", raising=False)
    root = tmp_path / "space"
    shutil.copytree(FIXTURE, root)
    _git(root, "init", "-q")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "fixture")
    space = Space(root)
    app = create_app(space, None, watch=False)
    published: list[ChangeEvent] = []
    app.state.hub.publish = published.append
    return Env(root, state, space, TestClient(app), published)


def _token(c: TestClient, scope: str = "read") -> dict[str, str]:
    res = c.post("/api/integrations/tokens", json={"name": "agent", "scope": scope})
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['secret']}"}


def _wait_for(published: list[ChangeEvent], path: str) -> ChangeEvent:
    for _ in range(100):
        found = [e for e in published if e.kind == "changed" and e.path == path]
        if found:
            return found[0]
        time.sleep(0.02)
    raise AssertionError([(e.kind, e.path) for e in published])


def test_object_has_counterparts(env: Env) -> None:
    res = env.c.get("/api/object", params={"path": APP01})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["counterparts"] == env.space.counterparts(APP01)
    runs = [r for r in body["counterparts"] if r["key"] == "runs"]
    assert {r["sourceTypeId"]: r["paths"] for r in runs} == {
        "application": [INVENTORY], "container": [WEB],
    }


def test_space_types_have_counterpart_defs(env: Env) -> None:
    types = {t["id"]: t for t in env.c.get("/api/space").json()["types"]}
    host = types["host"]
    keys = [d["key"] for d in host["counterparts"]]
    assert sorted(keys) == sorted(["runs", "configuredBy", "documentedIn", "affectedBy"])
    # First seen over the space's types (sorted by name), then their properties.
    assert keys == [d.key for d in env.space.counterpart_defs("host")]
    assert host["counterparts"] == [d.to_json() for d in env.space.counterpart_defs("host")]
    runs = next(d for d in host["counterparts"] if d["key"] == "runs")
    assert runs["id"] == "counterpart:runs" and runs["type"] == "entity"
    assert runs["options"]["counterpartOf"] == [
        {"typeId": "application", "key": "runsOn"}, {"typeId": "container", "key": "runsOn"},
    ]
    assert types["page"]["counterparts"] == []

    # Saving the served JSON back never writes the computed definitions.
    res = env.c.put("/api/types/host", json={"type": host, "baseRevision": host["revision"]})
    assert res.status_code == 200, res.text
    saved = json.loads((env.root / ".object" / "types" / "host.json").read_text(encoding="utf-8"))
    assert "counterparts" not in saved


def test_type_saves_answer_with_counterpart_defs(env: Env) -> None:
    """Fix pass, finding 6: ``PUT /api/types/{id}`` and ``POST /api/types`` answer the type as
    ``GET /api/space`` serves it (``counterparts`` included), so the window keeps the rows."""
    host = next(t for t in env.c.get("/api/space").json()["types"] if t["id"] == "host")
    host["description"] = "Changed."
    res = env.c.put("/api/types/host", json={"type": host, "baseRevision": host["revision"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body) == {"type", "rewritten", "skipped"}
    served = next(t for t in env.c.get("/api/space").json()["types"] if t["id"] == "host")
    assert body["type"] == served
    assert [d["key"] for d in body["type"]["counterparts"]] == [d["key"] for d in host["counterparts"]]

    res = env.c.post("/api/types", json={"name": "Place", "pluralName": "Places", "template": "location"})
    assert res.status_code == 201, res.text
    made = res.json()
    served = next(t for t in env.c.get("/api/space").json()["types"] if t["id"] == made["id"])
    assert made == served
    assert [(d["key"], d["options"]["counterpartOf"]) for d in made["counterparts"]] == [
        ("contains", [{"typeId": made["id"], "key": "partOf"}]),
    ]
    res = env.c.post("/api/types", json={"name": "Widget", "pluralName": "Widgets"})
    assert res.status_code == 201, res.text
    assert res.json()["counterparts"] == []


def test_post_counterpart(env: Env) -> None:
    with env.c:
        env.space.backlinks(DB01)  # the index is built before the change
        res = env.c.post("/api/object/counterpart", json={
            "path": DB01, "key": "runs", "sourceTypeId": "application",
            "add": [INVENTORY], "remove": [], "clientId": "window-1",
        })
        assert res.status_code == 200, res.text
        body = res.json()
        assert set(body) == {"counterparts", "written", "skipped"}
        version = env.space.cached_version(INVENTORY)
        assert body["written"] == [{"path": INVENTORY, "version": version}]
        assert body["skipped"] == []
        assert body["counterparts"] == env.space.counterparts(DB01)
        runs = [r for r in body["counterparts"] if r["key"] == "runs" and r["sourceTypeId"] == "application"]
        assert runs[0]["paths"] == [INVENTORY]
        event = _wait_for(env.published, INVENTORY)
        assert event.version == version and event.origin == "window-1"
        assert DB01 in (event.linked or ())
    # Only the stored side's file changed (a write's version history also gives the space its
    # `spaceId` in `.object/space.json`, as every property write does).
    changed = [line[3:].strip('"') for line in env.status().splitlines()]
    assert [p for p in changed if not p.startswith(".object/")] == [INVENTORY]

    missing = env.c.post("/api/object/counterpart", json={
        "path": "Hosts/Nobody.md", "key": "runs", "sourceTypeId": "application", "add": [INVENTORY],
    })
    assert missing.status_code == 404
    assert missing.json()["detail"] == 'There is no object at "Hosts/Nobody.md".'
    nope = env.c.post("/api/object/counterpart", json={
        "path": APP01, "key": "nope", "sourceTypeId": "application", "add": [INVENTORY],
    })
    assert nope.status_code == 422
    assert nope.json()["detail"] == 'This object has no "nope" relation from Application.'
    wrong = env.c.post("/api/object/counterpart", json={
        "path": APP01, "key": "runs", "sourceTypeId": "application", "add": [SAM],
    })
    assert wrong.status_code == 422
    assert wrong.json()["detail"] == '"Sam Example" isn\'t of type Application.'
    gone = env.c.post("/api/object/counterpart", json={
        "path": APP01, "key": "runs", "sourceTypeId": "application", "add": ["Applications/Gone.md"],
    })
    assert gone.status_code == 200
    assert gone.json()["skipped"] == [{"path": "Applications/Gone.md", "reason": "It's gone."}]
    assert gone.json()["written"] == []


def test_v1_object_counterparts(env: Env) -> None:
    headers = _token(env.c)
    res = env.c.get("/api/v1/object", params={"path": APP01}, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["values"]["runs"] == [
        {"target": "Inventory app", "path": INVENTORY},
        {"target": "inventory-web", "path": WEB},
    ]
    assert body["counterparts"] == env.space.counterparts(APP01)
    peek = env.c.get("/api/v1/object/peek", params={"path": APP01}, headers=headers).json()
    assert peek["values"]["runs"] == body["values"]["runs"]
    assert peek["counterparts"] == body["counterparts"]

    # A container excluded from AI is in neither the values nor the rows.
    web = env.root / WEB
    web.write_text(
        web.read_text(encoding="utf-8").replace("title: inventory-web\n", "title: inventory-web\nexcludeFromAI: true\n"),
        encoding="utf-8",
    )
    env.space.rescan_file(WEB)
    for route in ("/api/v1/object", "/api/v1/object/peek"):
        out = env.c.get(route, params={"path": APP01}, headers=headers).json()
        assert out["values"]["runs"] == [{"target": "Inventory app", "path": INVENTORY}]
        assert all(WEB not in r["paths"] for r in out["counterparts"])
        container = [r for r in out["counterparts"] if r["key"] == "runs" and r["sourceTypeId"] == "container"]
        assert container == [] or container[0]["paths"] == []


# -- Review Focus 2: reads write nothing -------------------------------------------------------


def test_reads_write_nothing(env: Env) -> None:
    headers = _token(env.c)
    assert env.status() == ""
    before = env.snapshot()
    before_state = env.state_files()

    assert env.c.get("/api/space").status_code == 200
    paths = sorted(
        str(p.relative_to(env.root)) for p in env.root.rglob("*.md")
        if ".git" not in p.relative_to(env.root).parts
    )
    assert APP01 in paths and len(paths) > 20
    for path in paths:
        res = env.c.get("/api/object", params={"path": path})
        assert res.status_code == 200, (path, res.text)
        assert "counterparts" in res.json()
    rows = env.c.post("/api/rows", json={"preview": True})
    assert rows.status_code == 200
    assert any("runs" in r["values"] for r in rows.json()["rows"])
    assert env.c.get("/api/graph").status_code == 200
    assert env.c.get("/api/type-gallery").status_code == 200
    for path in (APP01, DB01, INVENTORY, "Software/Windows Server 2022.md", "Locations/Main site.md"):
        assert env.c.get("/api/v1/object", params={"path": path}, headers=headers).status_code == 200
        assert env.c.get("/api/v1/object/peek", params={"path": path}, headers=headers).status_code == 200

    assert env.status() == ""
    assert env.snapshot() == before
    assert env.state_files() == before_state
    assert [e for e in env.published if e.kind in ("changed", "created", "deleted")] == []
