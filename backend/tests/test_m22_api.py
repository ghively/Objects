"""M22 Task 8: the app's work routes (``api_work``), "Add work fields", the Jira site and
the Activity name (plan ``2026-11-05-m22-work-model.md``, Contract "Routes").

TestClient over ``create_app`` on a copy of ``space-work`` committed to a throw-away git repo
(so ``git status`` shows any write); the clock is 2026-11-05T10:00Z and the time zone UTC.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import threading
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import BASIC_LOCKED, Space

FIXTURE = Path(__file__).parent / "fixtures" / "space-work"
NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
PRINTER = "Tasks/Printer jams on line 3.md"
BADGE = "Tasks/Badge reader audit.md"
PARKED = "Tasks/Parked thing.md"
SCANNER = "Projects/Scanner rollout.md"
BAD_BYTES = "Tasks/Bad bytes.md"
STEP_CHANGED = "This step changed. Look again."
ITEM_FIELDS = {
    "fields", "steps", "verified", "assumed", "toRaiseConfidence", "floorItems", "findings",
    "hypothesis", "confidenceReason", "activity", "workNotes", "resolution", "path", "title",
    "turn", "stage", "ticket", "current", "problems", "version",
}
RESULT_KEYS = {"version", "frontmatter", "body", "item", "synced", "activity", "workNote"}


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
         "-c", "core.autocrlf=false", *args],
        cwd=root, check=True, capture_output=True, text=True,
    ).stdout


class Env:
    def __init__(self, root: Path, state: Path, space: Space, client: TestClient,
                 published: list) -> None:
        self.root, self.state, self.space, self.c, self.published = (
            root, state, space, client, published
        )

    def status(self) -> str:
        return _git(self.root, "status", "--porcelain", "--untracked-files=all")

    def state_files(self) -> list[str]:
        if not self.state.exists():
            return []
        return sorted(str(p.relative_to(self.state)) for p in self.state.rglob("*"))

    def item(self, path: str) -> dict:
        res = self.c.get("/api/work/item", params={"path": path})
        assert res.status_code == 200, res.text
        return res.json()

    def step(self, path: str, n: int) -> dict:
        return self.item(path)["steps"][n - 1]


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Env:
    state = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(state))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.delenv("OBJECT_CLOCK_FILE", raising=False)
    root = tmp_path / "space"
    shutil.copytree(FIXTURE, root)
    # A work item whose file can't be saved (bytes that aren't UTF-8): every write is 423.
    (root / BAD_BYTES).write_bytes(b"---\ntype: Task\n---\n\x80 not text\n")
    _git(root, "init", "-q")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "fixture")
    space = Space(root)
    space.clock = lambda: NOW
    space.tz = UTC
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    return Env(root, state, space, TestClient(app), published)


def _approve(e: Env, rev: str, step_id: str, client_id: str | None = None):
    return e.c.post("/api/work/step", json={
        "path": PRINTER, "stepId": step_id, "stepRev": rev, "action": "approve",
        "clientId": client_id,
    })


# -- Review Focus 5: reads write nothing ------------------------------------------------------


def test_reads_write_nothing(env: Env) -> None:
    before_state = env.state_files()
    assert env.status() == ""
    items = env.c.get("/api/work/items")
    assert items.status_code == 200
    every = env.c.get("/api/work/items", params={"scope": "all"})
    assert every.status_code == 200
    paths = {i["path"] for i in every.json()["items"]}
    assert PRINTER in paths and BADGE in paths
    for path in sorted(paths):
        res = env.c.get("/api/work/item", params={"path": path})
        assert res.status_code == 200, (path, res.text)
    for route in ("/api/queries", "/api/space", "/api/settings"):
        assert env.c.get(route).status_code == 200, route
    assert env.c.get("/api/types/task/templates").status_code == 200
    assert env.status() == ""
    assert env.state_files() == before_state
    assert env.published == []


# -- Review Focus 4: two actions on one step --------------------------------------------------


def test_second_action_on_the_same_step_is_409(env: Env) -> None:
    step2 = env.step(PRINTER, 2)
    assert step2["kind"] == "approve" and step2["state"] == "open"
    barrier = threading.Barrier(2)
    answers: list = []

    def press() -> None:
        barrier.wait()
        answers.append(_approve(env, step2["rev"], step2["id"]))

    threads = [threading.Thread(target=press) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    codes = sorted(r.status_code for r in answers)
    assert codes == [200, 409], [r.text for r in answers]
    lost = next(r for r in answers if r.status_code == 409).json()
    assert lost["detail"] == STEP_CHANGED
    assert lost["step"]["state"] == "approved"
    assert lost["currentVersion"]
    text = (env.root / PRINTER).read_text(encoding="utf-8")
    assert text.count("APPROVED") == 1

    # The per-step check isn't the object version: step 3, fresh rev, is refused by the rules.
    step3 = env.step(PRINTER, 3)
    res = env.c.post("/api/work/step", json={
        "path": PRINTER, "stepId": step3["id"], "stepRev": step3["rev"], "action": "run",
    })
    assert res.status_code == 422
    assert res.json()["detail"] == "Finish the steps before this one first."


# -- route shapes -----------------------------------------------------------------------------


def _changed(e: Env) -> list[tuple[str, str, str | None]]:
    # M24's work queue announces `workQueue` on a step action; this test is about the object.
    return [(ev.kind, ev.path, ev.origin) for ev in e.published if ev.kind != "workQueue"]


def test_route_shapes(env: Env) -> None:
    with env.c:  # the lifespan runs the event hub's loop
        _test_route_shapes(env)


def _test_route_shapes(env: Env) -> None:
    e = env
    items = e.c.get("/api/work/items").json()
    assert set(items) == {"items"}
    printer = next(i for i in items["items"] if i["path"] == PRINTER)
    assert printer["turn"] == "approve" and printer["ticket"]["id"] == "INC0012345"

    item = e.item(PRINTER)
    assert ITEM_FIELDS <= set(item)
    assert item["resolution"] is not None

    # A step action.
    step2 = item["steps"][1]
    e.published.clear()
    res = _approve(e, step2["rev"], step2["id"], "win-1")
    assert res.status_code == 200, res.text
    out = res.json()
    assert set(out) == RESULT_KEYS
    assert out["activity"].endswith('Gene APPROVED step 2 "Restart the print spooler on PRN-TEST-01"')
    assert out["workNote"].startswith("[2026-11-05] Gene: approved step 2")
    assert out["item"]["steps"][1]["state"] == "approved"
    assert _changed(e) == [("changed", PRINTER, "win-1")]
    assert [ev for ev in e.published if ev.kind != "workQueue"][0].version == out["version"]

    # Step ops, in one write.
    e.published.clear()
    res = e.c.post("/api/work/steps", json={
        "path": PARKED, "ops": [{"op": "add", "kind": "do", "text": "Call the vendor"}],
        "clientId": "win-1",
    })
    assert res.status_code == 200, res.text
    assert set(res.json()) == RESULT_KEYS
    assert [s["text"] for s in res.json()["item"]["steps"]][-1] == "Call the vendor"
    assert _changed(e) == [("changed", PARKED, "win-1")]
    # A stale step in an op is 409 with the step.
    step = res.json()["item"]["steps"][0]
    stale = e.c.post("/api/work/steps", json={
        "path": PARKED, "ops": [{"op": "edit", "stepId": step["id"], "stepRev": "000000000000",
                                 "text": "Other"}],
    })
    assert stale.status_code == 409
    assert stale.json()["detail"] == STEP_CHANGED and "step" in stale.json()

    # Fields: stale version is 409 with the item text; a good write is one event.
    badge = e.item(BADGE)
    stale = e.c.post("/api/work/fields", json={
        "path": BADGE, "baseVersion": "nope", "set": {"rank": 2},
    })
    assert stale.status_code == 409
    assert stale.json() == {"currentVersion": badge["version"],
                            "detail": "This item changed. Look again."}
    e.published.clear()
    res = e.c.post("/api/work/fields", json={
        "path": BADGE, "baseVersion": badge["version"], "set": {"rank": 2}, "clientId": "win-2",
    })
    assert res.status_code == 200, res.text
    assert set(res.json()) == RESULT_KEYS
    assert res.json()["activity"].endswith("Gene set Rank to 2")
    assert _changed(e) == [("changed", BADGE, "win-2")]
    bad = e.c.post("/api/work/fields", json={
        "path": BADGE, "baseVersion": res.json()["version"], "set": {"status": "Done"},
    })
    assert bad.status_code == 422 and bad.json()["detail"] == "status isn't a work field."

    # Notes.
    e.published.clear()
    res = e.c.post("/api/work/note", json={"path": BADGE, "kind": "note", "text": "Checked the door",
                                           "clientId": "win-3"})
    assert res.status_code == 200, res.text
    assert res.json()["activity"].endswith("Gene added a note: Checked the door")
    assert _changed(e) == [("changed", BADGE, "win-3")]
    empty = e.c.post("/api/work/note", json={"path": BADGE, "text": "  "})
    assert empty.status_code == 422 and empty.json()["detail"] == "A note needs text."

    # Floor items.
    res = e.c.post("/api/work/floor", json={"path": BADGE, "op": "add", "place": "Door 4",
                                            "what": "Reader serial"})
    assert res.status_code == 200, res.text
    floor = res.json()["item"]["floorItems"][0]
    stale = e.c.post("/api/work/floor", json={"path": BADGE, "op": "collect",
                                              "itemId": floor["id"], "itemRev": "000000000000"})
    assert stale.status_code == 409
    assert stale.json()["detail"] == "This floor item changed. Look again."
    assert stale.json()["currentVersion"] == res.json()["version"]

    # Close.
    version = e.item(PRINTER)["version"]
    e.published.clear()
    res = e.c.post("/api/work/close", json={"path": PRINTER, "baseVersion": version,
                                            "clientId": "win-4"})
    assert res.status_code == 200, res.text
    assert res.json()["frontmatter"]["status"] == "Done"
    assert _changed(e) == [("changed", PRINTER, "win-4")]
    again = e.c.post("/api/work/close", json={"path": PRINTER, "baseVersion": res.json()["version"]})
    assert again.status_code == 422 and again.json()["detail"] == "This item is already done."
    stale = e.c.post("/api/work/close", json={"path": BADGE, "baseVersion": "nope"})
    assert stale.status_code == 409 and stale.json()["currentVersion"]

    # Not a work item, missing, read-only.
    page = e.c.post("/api/objects", json={"typeId": "page", "title": "Plain page"})
    assert page.status_code == 201, page.text
    page_path = page.json()["path"]
    for res in (
        e.c.get("/api/work/item", params={"path": page_path}),
        e.c.post("/api/work/note", json={"path": page_path, "text": "x"}),
    ):
        assert res.status_code == 422 and res.json()["detail"] == "This object has no work fields."
    for res in (
        e.c.get("/api/work/item", params={"path": "Tasks/Nothing here.md"}),
        e.c.post("/api/work/note", json={"path": "Tasks/Nothing here.md", "text": "x"}),
        e.c.post("/api/work/step", json={"path": "Tasks/Nothing here.md", "stepId": "a",
                                         "stepRev": "b", "action": "done"}),
    ):
        assert res.status_code == 404, res.text
    before = (e.root / BAD_BYTES).read_bytes()
    locked = e.c.post("/api/work/note", json={"path": BAD_BYTES, "text": "x"})
    assert locked.status_code == 423 and locked.json()["detail"]
    assert (e.root / BAD_BYTES).read_bytes() == before


# -- Add work fields --------------------------------------------------------------------------


def test_add_work_fields_route(env: Env) -> None:
    with env.c:  # the lifespan runs the event hub's loop
        _test_add_work_fields_route(env)


def _test_add_work_fields_route(env: Env) -> None:
    e = env
    types = {t["id"]: t for t in e.c.get("/api/space").json()["types"]}
    project = types["project"]
    assert not any(p["key"] == "steps" for p in project["propertyDefinitions"])
    assert SCANNER not in {i["path"] for i in e.c.get("/api/work/items").json()["items"]}
    tickets = next(q for q in e.c.get("/api/queries").json() if q["id"] == "work-tickets")
    assert tickets["builtIn"] == "tickets"
    assert [s["id"] for s in tickets["definition"]["types"]] == ["task"]

    stale = e.c.post("/api/types/project/work-fields", json={"baseRevision": "nope"})
    assert stale.status_code == 409
    assert stale.json() == {"currentRevision": project["revision"]}

    e.published.clear()
    res = e.c.post("/api/types/project/work-fields",
                   json={"baseRevision": project["revision"], "clientId": "win-1"})
    assert res.status_code == 200, res.text
    out = res.json()
    assert set(out) == {"type", "added", "skipped"}
    from objectapp.workfields import TICKET_FIELDS, WORK_FIELDS

    expected = [f.key for f in (*TICKET_FIELDS, *WORK_FIELDS) if f.key != "project"]
    assert out["added"] == [*expected, "completed"]
    assert out["skipped"] == []
    keys = [p["key"] for p in out["type"]["propertyDefinitions"]]
    assert "steps" in keys and "completed" in keys and "project" not in keys
    stored = (e.root / ".object/types/project.json").read_text(encoding="utf-8")
    assert '"steps"' in stored and '"completed"' in stored
    assert [(ev.kind, ev.path, ev.origin) for ev in e.published] == [
        ("types", "project", "win-1"), ("queries", "work-tickets", "win-1"),
    ]
    assert e.published[0].version == out["type"]["revision"]

    again = e.c.post("/api/types/project/work-fields",
                     json={"baseRevision": out["type"]["revision"]})
    assert again.status_code == 200, again.text
    assert again.json()["added"] == []

    basic = e.c.post("/api/types/page/work-fields", json={"baseRevision": ""})
    assert basic.status_code == 422 and basic.json()["detail"] == BASIC_LOCKED
    missing = e.c.post("/api/types/nothing/work-fields", json={"baseRevision": ""})
    assert missing.status_code == 404

    tickets = next(q for q in e.c.get("/api/queries").json() if q["id"] == "work-tickets")
    assert sorted(s["id"] for s in tickets["definition"]["types"]) == ["project", "task"]
    scanner = next(i for i in e.c.get("/api/work/items").json()["items"] if i["path"] == SCANNER)
    assert scanner["turn"] == "approve"


def test_tickets_view_cannot_be_deleted(env: Env) -> None:
    res = env.c.delete("/api/queries/work-tickets")
    assert res.status_code == 422
    assert res.json()["detail"] == "The Tickets view is built in."
    q = next(q for q in env.c.get("/api/queries").json() if q["id"] == "work-tickets")
    saved = env.c.put("/api/queries/work-tickets", json={"query": q, "baseRevision": ""})
    assert saved.status_code == 200, saved.text
    assert saved.json()["query"]["builtIn"] == "tickets"


# -- settings ---------------------------------------------------------------------------------


def test_settings(env: Env) -> None:
    e = env
    space = e.c.get("/api/space").json()
    assert space["jiraSite"] is None
    res = e.c.put("/api/space", json={"patch": {"jiraSite": "https://example.atlassian.net"},
                                      "baseRevision": space["revision"]})
    assert res.status_code == 200, res.text
    assert res.json()["jiraSite"] == "https://example.atlassian.net"
    badge = e.item(BADGE)
    assert badge["ticket"]["url"] == "https://example.atlassian.net/browse/OPS-123"

    bad = e.c.put("/api/space", json={"patch": {"jiraSite": "ftp://x"},
                                      "baseRevision": res.json()["revision"]})
    assert bad.status_code == 422
    assert bad.json()["detail"] == "The Jira site is a web address (https://…)."
    long = e.c.put("/api/space", json={"patch": {"jiraSite": "https://" + "a" * 300},
                                       "baseRevision": res.json()["revision"]})
    assert long.status_code == 422
    cleared = e.c.put("/api/space", json={"patch": {"jiraSite": None},
                                          "baseRevision": res.json()["revision"]})
    assert cleared.status_code == 200 and cleared.json()["jiraSite"] is None
    # A hand-edited site that isn't a web address never becomes a ticket link.
    import json as _json

    cfg = e.root / ".object" / "space.json"
    data = _json.loads(cfg.read_text(encoding="utf-8")) if cfg.exists() else {}
    cfg.parent.mkdir(exist_ok=True)
    cfg.write_text(_json.dumps({**data, "jiraSite": "javascript:alert(1)//"}), encoding="utf-8")
    assert e.item(BADGE)["ticket"]["url"] is None
    cfg.write_text(_json.dumps({**data, "jiraSite": None}), encoding="utf-8")

    settings = e.c.get("/api/settings").json()
    assert settings["settings"]["activityName"] == "Gene"
    res = e.c.put("/api/settings", json={"patch": {"activityName": "Pat"},
                                         "baseRevision": settings["revision"]})
    assert res.status_code == 200, res.text
    for value in ("", "a" * 61, "two\nlines", 3):
        bad = e.c.put("/api/settings", json={"patch": {"activityName": value},
                                             "baseRevision": res.json()["revision"]})
        assert bad.status_code == 422, value

    q = e.step(PARKED, 1)
    assert q["kind"] == "question"
    answered = e.c.post("/api/work/step", json={
        "path": PARKED, "stepId": q["id"], "stepRev": q["rev"], "action": "answer",
        "text": "Next week",
    })
    assert answered.status_code == 200, answered.text
    assert " Pat answered step 1 " in f" {answered.json()['activity']}"
    assert os.environ["OBJECT_STATE_DIR"]  # the settings file went to the temp state dir
