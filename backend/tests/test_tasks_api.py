"""The M8 task routes (Task 11): occurrence log, Skip, Excuse, catch-up, overdue and Task Stats.

`space-m8`, clock 2026-10-27T10:00:00Z (a Tuesday), the space's zone UTC.
"""

import difflib
import json
import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.textfile import decode
from objectapp.typemodel import topup_task_type

NOW = datetime(2026, 10, 27, 10, 0, 0, 123000, tzinfo=UTC)
AT = "2026-10-27T10:00:00Z"
NOW_STAMP = "2026-10-27T10:00:00.123Z"


@pytest.fixture
def space(m8_space_dir: Path) -> Space:
    return Space(m8_space_dir)


@pytest.fixture
def client(space: Space):
    app = create_app(space, watch=False)
    space.clock = lambda: NOW
    space.tz = UTC
    with TestClient(app) as c:
        yield c


def _fm(root: Path, rel: str) -> dict:
    return parse_fm(split_object(decode((root / rel).read_bytes()).text).frontmatter_src)


def _version(client: TestClient, rel: str) -> str:
    r = client.get("/api/object", params={"path": rel})
    assert r.status_code == 200, r.text
    return r.json()["version"]


def _occurrence(client: TestClient, rel: str, action: str, catch_up: str | None = None, **more):
    body = {"path": rel, "action": action, "baseVersion": _version(client, rel), **more}
    if catch_up:
        body["catchUp"] = catch_up
    return client.post("/api/tasks/occurrence", json=body)


def _log(root: Path, rel: str) -> list[str]:
    raw = _fm(root, rel).get("occurrenceLog")
    return raw.split("\n") if raw else []


def _diff_keys(before: bytes, after: bytes) -> tuple[set[str], set[str]]:
    """(keys of removed lines, keys of added lines); indented lines belong to the key above."""
    a, b = before.splitlines(keepends=True), after.splitlines(keepends=True)

    def keys(lines: list[bytes], i1: int, i2: int) -> set[str]:
        out = set()
        for i in range(i1, i2):
            j = i
            while j > 0 and lines[j][:1].isspace():
                j -= 1
            out.add(lines[j].decode("utf-8").lstrip("﻿").split(":", 1)[0])
        return out

    removed, added = set(), set()
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if op != "equal":
            removed |= keys(a, i1, i2)
            added |= keys(b, j1, j2)
    return removed, added


def _write_task(root: Path, name: str, date: str, repeat: str, log: list[str] | None = None,
                created: str = "2026-10-01T08:00:00.000Z") -> str:
    rel = f"Tasks/{name}.md"
    lines = [
        "---", "type: 'Task'", f"title: {name}", f"createdAt: {created}",
        f"lastUpdated: {created}", "status: Not Started", f"date: {date}", f"repeat: {repeat}",
    ]  # fmt: skip
    if log:
        lines += ["occurrenceLog: |-", *(f"  {ln}" for ln in log)]
    lines += ["---", "", "Body.", ""]
    (root / rel).write_text("\n".join(lines), encoding="utf-8")
    return rel


# -- completing through M4's path ---------------------------------------------------------


def test_complete_appends_one_log_line(client: TestClient, m8_space_dir: Path):
    rel = "Tasks/Weekly review.md"  # every week on mon, fri; date 2026-10-30
    before = (m8_space_dir / rel).read_bytes()
    r = client.put(
        "/api/object/properties",
        json={"path": rel, "updates": {"status": ["Done"]}, "baseVersion": _version(client, rel)},
    )
    assert r.status_code == 200, r.text
    fm = _fm(m8_space_dir, rel)
    assert fm["occurrenceLog"] == f"2026-10-30 completed {AT}"  # one line, the old date
    assert fm["date"] == "2026-11-02" and fm["status"] == "Not Started"
    assert fm["completed"] == NOW_STAMP
    removed, added = _diff_keys(before, (m8_space_dir / rel).read_bytes())
    assert removed <= {"date", "lastUpdated"}
    assert added == {"date", "lastUpdated", "completed", "occurrenceLog"}

    # Reopening never removes a line; completing again adds exactly one more.
    v = r.json()["version"]
    r = client.put("/api/object/properties",
                   json={"path": rel, "updates": {"status": ["Done"]}, "baseVersion": v})  # fmt: skip
    assert _log(m8_space_dir, rel) == [f"2026-10-30 completed {AT}", f"2026-11-02 completed {AT}"]
    v = r.json()["version"]
    client.put("/api/object/properties",
               json={"path": rel, "updates": {"status": ["In Progress"]}, "baseVersion": v})  # fmt: skip
    assert len(_log(m8_space_dir, rel)) == 2

    # A task that doesn't repeat gets no log.
    rel2 = "Tasks/Submit report.md"
    client.put("/api/object/properties", json={
        "path": rel2, "updates": {"status": ["Done"]}, "baseVersion": _version(client, rel2)})  # fmt: skip
    assert "occurrenceLog" not in _fm(m8_space_dir, rel2)


def test_complete_keeps_the_garbage_line(client: TestClient, m8_space_dir: Path):
    rel = "Tasks/Broken log.md"
    r = _occurrence(client, rel, "complete")
    assert r.status_code == 200, r.text
    assert _log(m8_space_dir, rel) == [
        "2026-10-25 completed 2026-10-25T09:00:00Z",
        "not a log line at all",
        "2026-10-26 completed 2026-10-26T09:00:00Z",
        f"2026-10-27 completed {AT}",
    ]


# -- Skip and Excuse --------------------------------------------------------------------------


def test_skip_and_excuse_advance_and_log(client: TestClient, m8_space_dir: Path):
    rel = "Tasks/Weekly review.md"  # date 2026-10-30 (a Friday), not overdue
    before = (m8_space_dir / rel).read_bytes()
    r = _occurrence(client, rel, "skip", clientId="c1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["task"] == {
        "completed": False, "advanced": True, "date": {"start": "2026-11-02", "resolution": "day"}
    }  # fmt: skip
    fm = _fm(m8_space_dir, rel)
    assert fm["date"] == "2026-11-02" and fm["status"] == "Not Started"
    assert "completed" not in fm
    assert fm["occurrenceLog"] == f"2026-10-30 skipped {AT}"
    assert body["frontmatter"]["occurrenceLog"] == fm["occurrenceLog"]
    removed, added = _diff_keys(before, (m8_space_dir / rel).read_bytes())
    assert removed == {"date", "lastUpdated"}
    assert added == {"date", "lastUpdated", "occurrenceLog"}

    r = _occurrence(client, rel, "excuse")
    assert r.status_code == 200, r.text
    assert _fm(m8_space_dir, rel)["date"] == "2026-11-06"
    assert _log(m8_space_dir, rel) == [f"2026-10-30 skipped {AT}", f"2026-11-02 excused {AT}"]

    rel = "Tasks/Pay rent.md"  # every month on the last day; 2026-10-31
    assert _occurrence(client, rel, "excuse").status_code == 200
    fm = _fm(m8_space_dir, rel)
    assert fm["date"] == "2026-11-30" and fm["occurrenceLog"] == f"2026-10-31 excused {AT}"


def test_complete_by_route_sets_status_and_completed(client: TestClient, m8_space_dir: Path):
    rel = "Tasks/Board meeting.md"  # every month on the 2nd tuesday; 2026-11-10
    before = (m8_space_dir / rel).read_bytes()
    r = _occurrence(client, rel, "complete")
    assert r.status_code == 200, r.text
    assert r.json()["task"]["completed"] is True and r.json()["task"]["advanced"] is True
    fm = _fm(m8_space_dir, rel)
    assert fm["date"] == "2026-12-08" and fm["status"] == "Not Started"
    assert fm["completed"] == NOW_STAMP
    assert fm["occurrenceLog"] == f"2026-11-10 completed {AT}"
    removed, added = _diff_keys(before, (m8_space_dir / rel).read_bytes())
    assert removed <= {"date", "status", "lastUpdated"}
    assert added <= {"date", "status", "completed", "occurrenceLog", "lastUpdated"}


# -- overdue and catch-up -------------------------------------------------------------------


def test_overdue_counts_missed(client: TestClient):
    r = client.get("/api/tasks/overdue", params={"path": "Tasks/Water plants.md"})
    assert r.status_code == 200, r.text
    assert r.json() == {
        "count": 3,
        "capped": False,
        "missed": ["2026-10-24", "2026-10-25", "2026-10-26"],
        "current": {"start": "2026-10-24", "resolution": "day"},
        "today": "2026-10-27",
    }
    # Due today or later: nothing is missed.
    r = client.get("/api/tasks/overdue", params={"path": "Tasks/Broken log.md"})
    assert (r.json()["count"], r.json()["missed"]) == (0, [])
    assert client.get("/api/tasks/overdue", params={"path": "Tasks/Nope.md"}).status_code == 404
    r = client.get("/api/tasks/overdue", params={"path": "Tasks/Submit report.md"})
    assert r.status_code == 422  # not recurring


def test_overdue_capped_at_99(client: TestClient, m8_space_dir: Path):
    rel = _write_task(m8_space_dir, "Old habit", "2026-01-01", "every day")
    r = client.get("/api/tasks/overdue", params={"path": rel})
    assert r.status_code == 200, r.text
    info = r.json()
    assert (info["count"], info["capped"], len(info["missed"])) == (99, True, 99)
    # The 99 most recent (Gene, audit 2026-11-01), not the oldest.
    assert (info["missed"][0], info["missed"][-1]) == ("2026-07-20", "2026-10-26")
    # Exactly 99 is not capped.
    rel = _write_task(m8_space_dir, "Ninety nine", "2026-07-20", "every day")  # 07-20 .. 10-26
    info = client.get("/api/tasks/overdue", params={"path": rel}).json()
    assert (info["count"], info["capped"]) == (99, False)


_CATCH_UP = [
    # (action, catchUp, logged dates, next date)
    ("complete", "advanceOne", ["2026-10-24"], "2026-10-25"),
    ("complete", "catchUpBeforeNow", ["2026-10-26"], "2026-10-27"),
    ("complete", "catchUpThroughNow", ["2026-10-24", "2026-10-25", "2026-10-26"], "2026-10-27"),
    ("skip", "advanceOne", ["2026-10-24"], "2026-10-25"),
    ("skip", "catchUpBeforeNow", ["2026-10-26"], "2026-10-27"),
    ("skip", "catchUpThroughNow", ["2026-10-24", "2026-10-25", "2026-10-26"], "2026-10-27"),
    ("excuse", "advanceOne", ["2026-10-24"], "2026-10-25"),
    ("excuse", "catchUpBeforeNow", ["2026-10-26"], "2026-10-27"),
]
_WORD = {"complete": "completed", "skip": "skipped", "excuse": "excused"}


@pytest.mark.parametrize(("action", "catch_up", "dates", "nxt"), _CATCH_UP)
def test_catch_up_choices(client: TestClient, m8_space_dir: Path, action, catch_up, dates, nxt):
    rel = "Tasks/Water plants.md"  # every day, date 2026-10-24: 24, 25, 26 missed
    old = _log(m8_space_dir, rel)
    before = (m8_space_dir / rel).read_bytes()
    r = _occurrence(client, rel, action, catch_up)
    assert r.status_code == 200, r.text
    fm = _fm(m8_space_dir, rel)
    assert fm["date"] == nxt
    assert _log(m8_space_dir, rel) == [*old, *(f"{d} {_WORD[action]} {AT}" for d in dates)]
    assert fm["status"] == "Not Started"
    assert ("completed" in fm) == (action == "complete")
    removed, added = _diff_keys(before, (m8_space_dir / rel).read_bytes())
    allowed = {"date", "status", "completed", "occurrenceLog", "lastUpdated"}
    assert removed <= allowed and added <= allowed
    # The old log lines are untouched bytes.
    text = (m8_space_dir / rel).read_text("utf-8")
    assert "occurrenceLog: |-\n" + "".join(f"  {ln}\n" for ln in old) in text


def test_catch_up_logs_at_most_the_99_most_recent(client: TestClient, m8_space_dir: Path):
    """Audit 2026-11-01 (Gene: cap at 99): a daily task dated 1800 wrote a 10,001-line log."""
    rel = _write_task(m8_space_dir, "Ancient daily", "1800-01-01", "every day")
    info = client.get("/api/tasks/overdue", params={"path": rel}).json()
    assert (info["count"], info["capped"]) == (99, True)
    assert (info["missed"][0], info["missed"][-1]) == ("2026-07-20", "2026-10-26")
    r = _occurrence(client, rel, "skip", "catchUpThroughNow")
    assert r.status_code == 200, r.text
    log = _log(m8_space_dir, rel)
    assert len(log) == 99
    assert log[0].startswith("2026-07-20") and log[-1].startswith("2026-10-26")
    assert r.json()["frontmatter"]["date"] == "2026-10-27"
    assert (m8_space_dir / rel).stat().st_size < 8_000
    # catchUpBeforeNow still logs the most recent missed occurrence only.
    rel = _write_task(m8_space_dir, "Ancient weekly", "1800-01-07", "every week")
    r = _occurrence(client, rel, "complete", "catchUpBeforeNow")
    assert r.status_code == 200, r.text
    assert [ln[:10] for ln in _log(m8_space_dir, rel)] == ["2026-10-20"]


def test_catch_up_bad_choices_422(client: TestClient, m8_space_dir: Path):
    rel = "Tasks/Water plants.md"
    before = (m8_space_dir / rel).read_bytes()
    assert _occurrence(client, rel, "excuse", "catchUpThroughNow").status_code == 422
    assert _occurrence(client, rel, "finish").status_code == 422
    assert _occurrence(client, rel, "skip", "everything").status_code == 422
    assert _occurrence(client, "Tasks/Submit report.md", "skip").status_code == 422
    assert _occurrence(client, "Tasks/Stretch.md", "skip", "catchUpBeforeNow").status_code == 422
    assert (m8_space_dir / rel).read_bytes() == before


def test_completion_mode_has_no_overdue_422(client: TestClient, m8_space_dir: Path):
    rel = "Tasks/Stretch.md"  # every day after completion
    r = client.get("/api/tasks/overdue", params={"path": rel})
    assert r.status_code == 422
    # Its occurrences still log, and the next date counts from the action's day.
    r = _occurrence(client, rel, "skip")
    assert r.status_code == 200, r.text
    fm = _fm(m8_space_dir, rel)
    assert fm["date"] == "2026-10-28" and fm["occurrenceLog"] == f"2026-10-27 skipped {AT}"


def test_occurrence_stale_409(client: TestClient, m8_space_dir: Path):
    rel = "Tasks/Water plants.md"
    before = (m8_space_dir / rel).read_bytes()
    r = client.post("/api/tasks/occurrence",
                    json={"path": rel, "action": "skip", "baseVersion": "stale"})  # fmt: skip
    assert r.status_code == 409
    assert r.json()["currentVersion"] == _version(client, rel)
    assert (m8_space_dir / rel).read_bytes() == before
    r = client.post("/api/tasks/occurrence",
                    json={"path": "Tasks/Nope.md", "action": "skip", "baseVersion": "x"})  # fmt: skip
    assert r.status_code == 404


# -- Task Stats -----------------------------------------------------------------------------


def test_stats_streak_rate_and_cells(client: TestClient):
    # Water plants: created 10-01, every day, date 10-24; log 21 completed, 22 skipped,
    # 23 completed; so 10-01..10-20 and 10-24..10-26 are missed and today is scheduled.
    r = client.get("/api/tasks/stats", params={"path": "Tasks/Water plants.md"})
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["unit"] == "day"
    assert (s["currentStreak"], s["bestStreak"], s["completions"]) == (0, 1, 2)
    assert s["completionRate"] == pytest.approx(2 / (2 + 1 + 23))
    assert s["atRisk"] is False
    cells = s["cells"]
    assert len(cells) == 30
    assert cells[0] == {"scheduled": "2026-10-02", "state": "missed"}
    by_day = {c["scheduled"]: c["state"] for c in cells}
    assert [by_day[f"2026-10-{d}"] for d in range(21, 28)] == [
        "completed", "skipped", "completed", "missed", "missed", "missed", "future"
    ]  # fmt: skip
    assert [c["scheduled"] for c in cells[-4:]] == ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]
    assert {c["state"] for c in cells[-4:]} == {"future"}

    # Broken log: the garbage line is ignored; two done in a row, today pending: at risk.
    s = client.get("/api/tasks/stats", params={"path": "Tasks/Broken log.md"}).json()
    assert (s["currentStreak"], s["bestStreak"], s["completions"], s["atRisk"]) == (2, 2, 2, True)

    # A weekly rule counts weeks. Created 10-01 with no log: its 8 Mondays and Fridays up to
    # today are missed and the grid's front is padded with the rule's earlier dates.
    s = client.get("/api/tasks/stats", params={"path": "Tasks/Weekly review.md"}).json()
    assert s["unit"] == "week" and s["completionRate"] == 0.0
    states = [c["state"] for c in s["cells"]]
    assert states == ["none"] * 18 + ["missed"] * 8 + ["future"] * 4
    assert [c["scheduled"] for c in s["cells"][18:20]] == ["2026-10-02", "2026-10-05"]
    assert [c["scheduled"] for c in s["cells"][-4:]] == ["2026-10-30", "2026-11-02", "2026-11-06", "2026-11-09"]


def test_stats_pads_before_history(client: TestClient, m8_space_dir: Path):
    rel = _write_task(m8_space_dir, "Fresh habit", "2026-10-27", "every day",
                      created="2026-10-27T08:00:00.000Z")  # fmt: skip
    s = client.get("/api/tasks/stats", params={"path": rel}).json()
    states = [c["state"] for c in s["cells"]]
    assert states == ["none"] * 25 + ["future"] * 5
    assert s["cells"][0]["scheduled"] == "2026-10-02"
    assert (s["currentStreak"], s["completions"], s["completionRate"], s["atRisk"]) == (0, 0, None, False)


def test_excused_keeps_streak_and_leaves_rate(client: TestClient, m8_space_dir: Path):
    rel = _write_task(
        m8_space_dir, "Meditate", "2026-10-27", "every day",
        log=["2026-10-24 completed 2026-10-24T08:00:00Z", "2026-10-25 excused 2026-10-25T08:00:00Z",
             "2026-10-26 completed 2026-10-26T08:00:00Z"],
        created="2026-10-24T07:00:00.000Z",
    )  # fmt: skip
    s = client.get("/api/tasks/stats", params={"path": rel}).json()
    assert (s["currentStreak"], s["bestStreak"], s["completions"]) == (3, 3, 2)
    assert s["completionRate"] == 1.0  # the excused day is left out
    assert s["atRisk"] is True  # today is scheduled, not done, streak above 0
    assert _occurrence(client, rel, "complete").status_code == 200
    s = client.get("/api/tasks/stats", params={"path": rel}).json()
    assert (s["currentStreak"], s["atRisk"]) == (4, False)
    # A skip resets the streak.
    assert _occurrence(client, rel, "skip").status_code == 200  # skips 10-28
    s = client.get("/api/tasks/stats", params={"path": rel}).json()
    assert s["currentStreak"] == 0 and s["bestStreak"] == 4
    assert s["completionRate"] == pytest.approx(3 / 4)


def test_stats_and_overdue_write_nothing(client: TestClient, m8_space_dir: Path):
    state_dir = Path(os.environ["OBJECT_STATE_DIR"]) if os.environ.get("OBJECT_STATE_DIR") else None

    def snapshot() -> dict[str, tuple[bytes, int]]:
        out = {}
        for root in (m8_space_dir, state_dir):
            if root is None or not root.exists():
                continue
            for p in sorted(root.rglob("*")):
                if p.is_file():
                    out[str(p)] = (p.read_bytes(), p.stat().st_mtime_ns)
        return out

    before = snapshot()
    for rel in ("Tasks/Water plants.md", "Tasks/Broken log.md", "Tasks/Weekly review.md",
                "Tasks/Pay rent.md", "Tasks/Anniversary.md", "Tasks/Stretch.md"):  # fmt: skip
        client.get("/api/tasks/stats", params={"path": rel})
        client.get("/api/tasks/overdue", params={"path": rel})
    assert snapshot() == before


# -- removing the recurrence; the type's hidden field ---------------------------------------


def test_remove_recurrence_removes_log(client: TestClient, m8_space_dir: Path):
    rel = "Tasks/Water plants.md"
    before = (m8_space_dir / rel).read_bytes()
    r = client.put(
        "/api/object/properties",
        json={"path": rel, "updates": {}, "remove": ["repeat", "occurrenceLog"],
              "baseVersion": _version(client, rel)},
    )  # fmt: skip
    assert r.status_code == 200, r.text
    after = (m8_space_dir / rel).read_bytes()
    fm = _fm(m8_space_dir, rel)
    assert "repeat" not in fm and "occurrenceLog" not in fm
    removed, added = _diff_keys(before, after)
    assert removed == {"repeat", "occurrenceLog", "lastUpdated"}
    assert added == {"lastUpdated"}


def test_delete_log_entry_changes_only_its_line(client: TestClient, m8_space_dir: Path):
    """The Completion Log's delete writes the remaining lines: the block keeps its style."""
    rel = "Tasks/Water plants.md"
    path = m8_space_dir / rel
    path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))  # CRLF is kept too
    before = path.read_bytes()
    lines = _log(m8_space_dir, rel)
    assert len(lines) == 3
    kept = [lines[0], lines[2]]
    r = client.put(
        "/api/object/properties",
        json={"path": rel, "updates": {"occurrenceLog": "\n".join(kept)},
              "baseVersion": _version(client, rel)},
    )  # fmt: skip
    assert r.status_code == 200, r.text
    after = path.read_bytes()
    a, b = before.split(b"\r\n"), after.split(b"\r\n")
    changes = [
        (op, a[i1:i2], b[j1:j2])
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b).get_opcodes()
        if op != "equal"
    ]
    assert [c for c in changes if not c[1][0].startswith(b"lastUpdated:")] == [
        ("delete", [b"  " + lines[1].encode()], [])
    ]
    assert after.count(b"\r\n") == before.count(b"\r\n") - 1
    assert b"\n" not in after.replace(b"\r\n", b"")
    assert _log(m8_space_dir, rel) == kept


def test_topup_adds_occurrence_log_once(space: Space, m8_space_dir: Path):
    path = m8_space_dir / ".capacities" / "types" / "task.json"
    stored = path.read_bytes()
    assert b"occurrenceLog" not in stored
    t = space.type_by_id("task")
    keys = [p.key for p in t.propertyDefinitions]
    assert keys.count("occurrenceLog") == 1 and keys[-1] == "occurrenceLog"
    log = t.prop("occurrenceLog")
    assert (log.type, log.name, log.visibility) == ("text", "Occurrence log", "hidden")
    topup_task_type(t)
    assert [p.key for p in t.propertyDefinitions].count("occurrenceLog") == 1
    assert path.read_bytes() == stored  # in memory only

    # A type that already defines it keeps its own definition.
    data = json.loads(stored)
    data["propertyDefinitions"].append(
        {"id": "occurrenceLog", "key": "occurrenceLog", "name": "History", "type": "text",
         "description": "", "icon": {"type": "iconify", "val": "ph-text-aa"},
         "visibility": "alwaysShow", "options": {}}
    )  # fmt: skip
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    t2, _rev = space.refresh_type("task")
    defs = [p for p in t2.propertyDefinitions if p.key == "occurrenceLog"]
    assert len(defs) == 1 and defs[0].name == "History" and defs[0].visibility == "alwaysShow"


def test_time_resolution_occurrences_log_instants(client: TestClient, m8_space_dir: Path):
    rel = _write_task(m8_space_dir, "Morning pills", "2026-10-25T07:00:00.000Z", "every day")
    info = client.get("/api/tasks/overdue", params={"path": rel}).json()
    assert info["missed"] == ["2026-10-25T07:00:00Z", "2026-10-26T07:00:00Z"]
    assert info["current"] == {"start": "2026-10-25T07:00:00.000Z", "resolution": "time"}
    r = _occurrence(client, rel, "complete", "catchUpBeforeNow")
    assert r.status_code == 200, r.text
    fm = _fm(m8_space_dir, rel)
    assert fm["date"] == "2026-10-27T07:00:00.000Z"
    assert fm["occurrenceLog"] == f"2026-10-26T07:00:00Z completed {AT}"
    s = client.get("/api/tasks/stats", params={"path": rel}).json()
    by_day = {c["scheduled"][:10]: c["state"] for c in s["cells"]}
    assert (by_day["2026-10-25"], by_day["2026-10-26"], by_day["2026-10-27"]) == (
        "missed", "completed", "future"
    )  # fmt: skip
