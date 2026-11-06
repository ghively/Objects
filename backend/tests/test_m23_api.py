"""M23 Task 6: the Work section's routes (``api_work_section``) and the keep-on-top window
(plan ``2026-11-05-m23-work-section.md``, Contract "Routes").

TestClient over ``create_app`` on a copy of the overlay space (``m23_helpers.copy_space``)
committed to a throw-away git repo (so ``git status`` shows any write); the clock is
2026-11-05T10:00Z and the time zone UTC; ``workAlertFolder`` points at a copy of the
monitoring fixtures, set through ``PUT /api/settings``.
"""

from __future__ import annotations

import subprocess
from datetime import UTC, datetime
from pathlib import Path

import m23_helpers
import pytest
from fastapi.testclient import TestClient
from objectapp import api_work_section, windowhost, workseams
from objectapp.space import ReadOnly, Space
from objectapp.workseams import SeamRefused, WorkSeams

NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
PRINTER = "Tasks/Printer jams on line 3.md"
NOTE = "DailyNotes/2026-11-05.md"
FOCUS_CHANGED = "Today's note changed. Look again."
FLOOR_CHANGED = "This floor item changed. Look again."


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
         "-c", "core.autocrlf=false", *args],
        cwd=root, check=True, capture_output=True, text=True,
    ).stdout


class Env:
    def __init__(self, root: Path, state: Path, space: Space, client: TestClient,
                 published: list, monitoring: Path) -> None:
        self.root, self.state, self.space, self.c = root, state, space, client
        self.published, self.monitoring = published, monitoring

    def status(self) -> str:
        return _git(self.root, "status", "--porcelain", "--untracked-files=all")

    def state_files(self) -> list[str]:
        if not self.state.exists():
            return []
        return sorted(str(p.relative_to(self.state)) for p in self.state.rglob("*"))

    def events(self) -> list[tuple[str, str, str | None]]:
        return [(e.kind, e.path, e.origin) for e in self.published]


class _NowLoop:
    """Stands in for the hub's event loop (no lifespan runs): publish at once."""

    def is_running(self) -> bool:
        return True

    def call_soon_threadsafe(self, fn, *args) -> None:
        fn(*args)


def _make(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Env:
    from objectapp.server import create_app

    state = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(state))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.delenv("OBJECT_CLOCK_FILE", raising=False)
    root = m23_helpers.copy_space(tmp_path)
    mon = m23_helpers.monitoring(tmp_path)
    _git(root, "init", "-q")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "fixture")
    space = Space(root)
    space.clock = lambda: NOW
    space.tz = UTC
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    app.state.hub.loop = _NowLoop()
    client = TestClient(app)
    rev = client.get("/api/settings").json()["revision"]
    res = client.put("/api/settings", json={
        "patch": {"workAlertFolder": str(mon)}, "baseRevision": rev,
    })
    assert res.status_code == 200, res.text
    return Env(root, state, space, client, published, mon)


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Env:
    windowhost.set_opener(None)
    yield _make(tmp_path, monkeypatch)
    windowhost.set_opener(None)


# -- Reads write nothing ------------------------------------------------------------------


def test_reads_write_nothing(env: Env) -> None:
    assert env.status() == ""
    before = env.state_files()
    env.published.clear()
    for url in (
        "/api/work/board", "/api/work/board?scope=all", "/api/work/focus",
        "/api/work/focus?day=2026-11-06", "/api/work/today", "/api/work/wins",
        "/api/work/alerts", "/api/work/agent", "/api/work/captures",
        "/api/work/floor/general", "/api/work/keep-on-top",
    ):
        res = env.c.get(url)
        assert res.status_code == 200, (url, res.text)
    assert env.status() == ""
    assert env.state_files() == before
    assert env.published == []
    assert not (env.root / "DailyNotes" / "2026-11-06.md").exists()


# -- Board and focus ----------------------------------------------------------------------


def test_board_and_focus_routes(env: Env) -> None:
    board = env.c.get("/api/work/board").json()
    assert set(board) == {"items", "now", "today", "timeZone"}
    assert board["today"] == "2026-11-05"
    paths = [i["path"] for i in board["items"]]
    assert PRINTER in paths
    printer = next(i for i in board["items"] if i["path"] == PRINTER)
    for key in ("typeName", "isProject", "steps", "floorItems", "hypothesis", "deadline",
                "blockedOnPeople"):
        assert key in printer
    assert "activity" not in printer and "fields" not in printer
    every = env.c.get("/api/work/board", params={"scope": "all"}).json()
    assert len(every["items"]) > len(board["items"])
    assert env.c.get("/api/work/board", params={"scope": "nope"}).status_code == 422

    focus = env.c.get("/api/work/focus").json()
    assert focus["day"] == "2026-11-05" and focus["notePath"] == NOTE
    assert [line["n"] for line in focus["lines"]] == [1, 2, 3]
    assert env.c.get("/api/work/focus", params={"day": "2026-13-01"}).status_code == 422

    # A stale version: 409 with the current one and the focus text.
    res = env.c.put("/api/work/focus", json={
        "day": "2026-11-05", "lines": ["Clear the jams"], "baseVersion": "stale",
    })
    assert res.status_code == 409, res.text
    assert res.json() == {"currentVersion": focus["version"], "detail": FOCUS_CHANGED}

    env.published.clear()
    res = env.c.put("/api/work/focus", json={
        "day": "2026-11-05", "lines": ["Clear the jams", "Ship the scanner"],
        "baseVersion": focus["version"], "clientId": "win-1",
    })
    assert res.status_code == 200, res.text
    out = res.json()
    assert [line["text"] for line in out["lines"]] == ["Clear the jams", "Ship the scanner"]
    assert out["version"] != focus["version"]
    assert env.events() == [("changed", NOTE, "win-1")]
    assert env.published[0].version == out["version"]

    # Bad lines and a bad day: 422.
    res = env.c.put("/api/work/focus", json={
        "day": "2026-11-05", "lines": [], "baseVersion": out["version"],
    })
    assert res.status_code == 422 and res.json()["detail"] == "Write at least one line."
    res = env.c.put("/api/work/focus", json={
        "day": "2026-13-01", "lines": ["x"], "baseVersion": None,
    })
    assert res.status_code == 422

    # A note that can't be saved: 423.
    def refuse(*_a, **_k):
        raise ReadOnly("This note can't be saved.")

    env.space.save_body = refuse  # type: ignore[method-assign]
    res = env.c.put("/api/work/focus", json={
        "day": "2026-11-05", "lines": ["Clear the jams"], "baseVersion": out["version"],
    })
    assert res.status_code == 423, res.text
    assert res.json()["detail"] == "This note can't be saved."


def test_focus_save_creates_the_note(env: Env) -> None:
    env.published.clear()
    res = env.c.put("/api/work/focus", json={
        "day": "2026-11-06", "lines": ["Plan the week"], "baseVersion": None, "clientId": "w",
    })
    assert res.status_code == 200, res.text
    out = res.json()
    path = out["notePath"]
    assert path and (env.root / path).is_file()
    kinds = [(k, p) for k, p, _o in env.events()]
    assert ("created", path) in kinds and ("changed", path) in kinds


def test_today_and_wins_routes(env: Env) -> None:
    today = env.c.get("/api/work/today").json()
    assert today["day"] == "2026-11-05" and today["nowLocal"] == "10:00"
    assert [m["title"] for m in today["meetings"]] == ["Line 3 standup", "Vendor call"]
    assert env.c.get("/api/work/today", params={"day": "bad"}).status_code == 422
    wins = env.c.get("/api/work/wins").json()
    assert len(wins["days"]) == 14 and wins["days"][-1]["day"] == "2026-11-05"
    assert len(env.c.get("/api/work/wins", params={"days": 3}).json()["days"]) == 3
    assert env.c.get("/api/work/wins", params={"days": 0}).status_code == 422
    assert env.c.get("/api/work/wins", params={"days": 32}).status_code == 422


# -- Alerts -------------------------------------------------------------------------------


def test_alert_routes(env: Env) -> None:
    empty = env.c.get("/api/work/alerts").json()
    assert empty["alerts"] == [] and empty["typeExists"] is False
    assert empty["folder"] == str(env.monitoring)

    env.published.clear()
    res = env.c.post("/api/work/alerts/scan", json={"clientId": "w"})
    assert res.status_code == 200, res.text
    out = res.json()
    assert set(out) == {"report", "alerts"}
    assert out["report"]["files"] == 3 and out["report"]["created"] == 2
    assert out["report"]["errors"][0].startswith("Can't read broken.json")
    assert out["alerts"]["typeExists"] is True
    assert out["alerts"]["counts"] == {"Critical": 1, "Warning": 1, "Info": 0}
    assert [a["severity"] for a in out["alerts"]["alerts"]] == ["Critical", "Warning"]
    assert [k for k, _p, _o in env.events()].count("types") == 1

    # "Add the Alert type" when it exists: created False, no event.
    env.published.clear()
    res = env.c.post("/api/work/alert-type", json={"clientId": "w"})
    assert res.status_code == 200, res.text
    assert res.json()["created"] is False and res.json()["type"]["name"] == "Alert"
    assert env.published == []


def test_alert_type_route_creates_once(env: Env) -> None:
    env.published.clear()
    first = env.c.post("/api/work/alert-type", json={"clientId": "w"})
    assert first.status_code == 200, first.text
    assert first.json()["created"] is True
    t = first.json()["type"]
    assert t["name"] == "Alert"
    assert "alertKey" in [p["key"] for p in t["propertyDefinitions"]]
    second = env.c.post("/api/work/alert-type", json={})
    assert second.status_code == 200 and second.json()["created"] is False
    assert env.events() == [("types", t["id"], "w")]


# -- The general floor list ----------------------------------------------------------------


def test_floor_general_routes(env: Env) -> None:
    env.published.clear()
    res = env.c.post("/api/work/floor/general", json={
        "op": "add", "place": "Line 3", "what": "Photo of the panel", "clientId": "w",
    })
    assert res.status_code == 200, res.text
    added = res.json()
    assert len(added["items"]) == 1 and added["revision"]
    item = added["items"][0]
    assert env.events() == [("work", "floor", "w")]
    assert env.published[0].version == added["revision"]

    res = env.c.post("/api/work/floor/general", json={
        "op": "collect", "itemId": item["id"], "itemRev": item["rev"], "found": "E-12",
        "clientId": "w",
    })
    assert res.status_code == 200, res.text
    assert res.json()["items"][0]["collected"] == "2026-11-05"
    assert [k for k, _p, _o in env.events()] == ["work", "work"]

    env.published.clear()
    res = env.c.post("/api/work/floor/general", json={
        "op": "remove", "itemId": item["id"], "itemRev": item["rev"],
    })
    assert res.status_code == 409
    assert res.json() == {"detail": FLOOR_CHANGED}
    res = env.c.post("/api/work/floor/general", json={"op": "add"})
    assert res.status_code == 422
    assert env.published == []
    assert env.c.post("/api/work/floor/general", json={"op": "burn"}).status_code == 422
    assert env.c.get("/api/work/floor/general").json()["items"][0]["found"] == "E-12"


# -- The M24 seams ------------------------------------------------------------------------


def test_seams_until_m24(env: Env) -> None:
    board = env.c.get("/api/work/board").json()["items"]
    agent = env.c.get("/api/work/agent")
    assert agent.status_code == 200
    a = agent.json()
    assert a["available"] is False and a["rows"] == []
    assert a["carrying"] == sum(1 for i in board if i["turn"] == "agent")
    assert a["note"] == "The agent loop comes with M24."
    res = env.c.put("/api/work/agent/acts", json={"on": True})
    assert res.status_code == 501 and res.json() == {"detail": "The agent loop comes with M24."}
    res = env.c.post("/api/work/agent/retry", json={"id": "q1"})
    assert res.status_code == 501 and res.json() == {"detail": "The agent loop comes with M24."}
    res = env.c.post("/api/work/captures", json={"text": "x", "fromView": "now"})
    assert res.status_code == 501
    assert res.json() == {"detail": "Saving a brain dump comes with M24."}
    res = env.c.get("/api/work/captures", params={"status": "needsYou"})
    assert res.status_code == 200 and res.json() == {"captures": []}
    assert env.status() == ""


class _FakeAgent:
    def __init__(self) -> None:
        self.calls: list = []

    def status(self, space, board):
        return {"available": True, "agentName": "Helper", "actsOnApprovals": False,
                "carrying": len(board), "rows": [], "note": None}

    def set_acts(self, space, on):
        self.calls.append(("acts", on))
        if on:
            raise SeamRefused(422, "x")
        return {**self.status(space, []), "actsOnApprovals": on}

    def retry(self, space, entry_id):
        self.calls.append(("retry", entry_id))
        if entry_id == "gone":
            raise KeyError(entry_id)
        raise SeamRefused(409, "This step changed. Look again.")


class _FakeCaptures:
    def save(self, space, req, now):
        from objectapp.propvalues import InvalidValue

        if not req.text.strip():
            raise InvalidValue("Write something first.")
        return {"path": "Captures/x.md", "text": req.text, "status": "new", "question": None,
                "capturedAt": now.isoformat(), "linkedPath": req.linkedPath}

    def list(self, space, status):
        return [{"path": "Captures/x.md", "text": "x", "status": status or "new",
                 "question": None, "capturedAt": "2026-11-05T10:00:00Z", "linkedPath": None}]


def test_filled_seams(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_agent = _FakeAgent()
    monkeypatch.setattr(
        "objectapp.server.build_seams",
        lambda space, service: WorkSeams(fake_agent, _FakeCaptures()),
    )
    e = _make(tmp_path, monkeypatch)
    a = e.c.get("/api/work/agent").json()
    assert a["available"] is True and a["agentName"] == "Helper"
    res = e.c.put("/api/work/agent/acts", json={"on": False})
    assert res.status_code == 200 and res.json()["actsOnApprovals"] is False
    res = e.c.put("/api/work/agent/acts", json={"on": True})
    assert res.status_code == 422 and res.json() == {"detail": "x"}
    res = e.c.post("/api/work/agent/retry", json={"id": "q1"})
    assert res.status_code == 409
    assert res.json() == {"detail": "This step changed. Look again."}
    assert e.c.post("/api/work/agent/retry", json={"id": "gone"}).status_code == 404
    res = e.c.post("/api/work/captures", json={
        "text": "Tray 2 again", "fromView": "now", "linkedPath": PRINTER,
    })
    assert res.status_code == 201, res.text
    assert res.json()["capture"]["linkedPath"] == PRINTER
    assert e.c.post("/api/work/captures", json={"text": " ", "fromView": "now"}).status_code == 422
    res = e.c.get("/api/work/captures", params={"status": "filed"})
    assert res.json()["captures"][0]["status"] == "filed"
    assert e.c.get("/api/work/captures", params={"status": "bad"}).status_code == 422


# -- Keep on top --------------------------------------------------------------------------


def test_keep_on_top_routes(env: Env) -> None:
    assert env.c.get("/api/work/keep-on-top").json() == {"window": False}
    res = env.c.post("/api/work/keep-on-top", json={})
    assert res.status_code == 501
    assert res.json() == {"detail": "Keep on top needs the Object window."}
    opened: list[str] = []
    windowhost.set_opener(opened.append)
    assert env.c.get("/api/work/keep-on-top").json() == {"window": True}
    res = env.c.post("/api/work/keep-on-top", json={})
    assert res.status_code == 204
    assert opened == ["http://testserver/?mini=work"]


# -- Step actions stay M22's ---------------------------------------------------------------


def test_step_actions_still_go_through_m22(env: Env) -> None:
    item = env.c.get("/api/work/item", params={"path": PRINTER}).json()
    step2 = item["steps"][1]
    res = env.c.post("/api/work/step", json={
        "path": PRINTER, "stepId": step2["id"], "stepRev": step2["rev"], "action": "approve",
    })
    assert res.status_code == 200, res.text
    board = env.c.get("/api/work/board").json()
    printer = next(i for i in board["items"] if i["path"] == PRINTER)
    assert printer["turn"] == "agent"

    r = api_work_section.router(
        _ctx(env), None,  # type: ignore[arg-type]  # building the router calls neither
        workseams.WorkSeams(workseams.NoAgent(), workseams.NoCaptures()), None,  # type: ignore[arg-type]
    )
    paths = [route.path for route in r.routes]
    for banned in ("/work/step", "/work/steps", "/work/fields"):
        assert banned not in paths
    assert "/work/board" in paths


def _ctx(env: Env):
    from objectapp.apictx import ApiContext

    return ApiContext(space=env.space, announce=lambda _e: None, search=None)  # type: ignore[arg-type]
