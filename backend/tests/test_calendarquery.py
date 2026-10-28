"""M4 Task 5: the calendar range query and the calendar/tasks/reminders ui keys."""

from __future__ import annotations

import hashlib
import os
import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.frontmatter import parse_fm
from objectapp.localtime import SystemTz
from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import Space

CLOCK = datetime(2026, 10, 23, 9, 0, tzinfo=UTC)
PLUS2 = timezone(timedelta(hours=2))


def _space(root: Path, tz=PLUS2) -> Space:
    space = Space(root)
    space.clock = lambda: CLOCK
    space.tz = tz
    return space


def _write(root: Path, rel: str, fm: str, body: str = "") -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(f"---\n{fm.strip()}\n---\n{body}", encoding="utf-8")


def _tasks(day: dict, path: str | None = None) -> list[tuple[str, str, str, bool]]:
    return [
        (e["path"], e["kind"], e["day"], e["done"])
        for e in day["tasks"]
        if path is None or e["path"] == path
    ]


def _dated_paths(day: dict) -> set[tuple[str, str]]:
    return {(e["path"], e["key"]) for e in day["dated"]}


def _hashes(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


# -- shape ------------------------------------------------------------------------


def test_range_covers_each_day(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    r = space.calendar("2026-11-20", "2026-12-05")
    assert r["from"] == "2026-11-20" and r["to"] == "2026-12-05"
    assert r["today"] == "2026-10-23"
    assert len(r["days"]) == 16
    assert list(r["days"]) == [f"2026-11-{d:02d}" for d in range(20, 31)] + [
        f"2026-12-{d:02d}" for d in range(1, 6)
    ]
    empty = r["days"]["2026-12-05"]
    assert empty["dailyNote"] is None
    for key in ("dated", "created", "updated"):
        assert empty[key] == []
    assert all(e["kind"] == "occurrence" for e in empty["tasks"])  # only recurring series reach December
    assert set(empty) == {
        "dailyNote", "tasks", "dated", "created", "updated", "backlinks", "references", "timeline"
    }


def test_daily_note_in_day(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    r = space.calendar("2026-10-20", "2026-10-26")
    days = r["days"]
    assert days["2026-10-20"]["dailyNote"] is None
    assert days["2026-10-21"]["dailyNote"] == {"path": "DailyNotes/2026-10-21.md", "reviewed": False}
    assert days["2026-10-22"]["dailyNote"] == {"path": "DailyNotes/2026-10-22.md", "reviewed": True}
    assert days["2026-10-23"]["dailyNote"]["path"] == "DailyNotes/2026-10-23.md"
    assert days["2026-10-25"]["dailyNote"]["path"] == "DailyNotes/Odd name.md"
    assert r["warnings"] == [{"day": "2026-10-23", "paths": ["DailyNotes/2026-10-23 copy.md"]}]
    for path in ("DailyNotes/2026-10-21.md", "DailyNotes/Odd name.md", "DailyNotes/2026-10-23 copy.md"):
        assert r["summaries"][path]["path"] == path
    # warnings only for days in range
    assert space.calendar("2026-10-24", "2026-10-26")["warnings"] == []


def test_dated_range_covers_each_day(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    r = space.calendar("2026-10-25", "2026-10-29")
    for d in ("2026-10-26", "2026-10-27", "2026-10-28"):
        entries = [e for e in r["days"][d]["dated"] if e["path"] == "Meetings/Offsite.md"]
        assert entries == [
            {
                "path": "Meetings/Offsite.md",
                "key": "span",
                "start": "2026-10-26",
                "end": "2026-10-28",
                "resolution": "day",
            }
        ]
    for d in ("2026-10-25", "2026-10-29"):
        assert ("Meetings/Offsite.md", "span") not in _dated_paths(r["days"][d])
    assert r["summaries"]["Meetings/Offsite.md"]["title"] == "Offsite"


def test_created_uses_local_day(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    r = space.calendar("2026-10-21", "2026-10-25")
    days = r["days"]
    # Planning: createdAt 2026-10-23T22:30Z is the 24th at +02:00 (and updated the same day)
    assert "Meetings/Planning.md" in days["2026-10-24"]["created"]
    assert "Meetings/Planning.md" not in days["2026-10-23"]["created"]
    assert all("Meetings/Planning.md" not in d["updated"] for d in days.values())
    # Reading list: created 21:59Z (23:59 local, the 22nd), updated 22:30Z on the 23rd (the 24th)
    assert "Pages/Reading list.md" in days["2026-10-22"]["created"]
    assert "Pages/Reading list.md" in days["2026-10-24"]["updated"]
    # Garden plan: created and updated on the 23rd: in created only
    assert "Pages/Garden plan.md" in days["2026-10-23"]["created"]
    assert "Pages/Garden plan.md" not in days["2026-10-23"]["updated"]
    # Daily notes and templates are in neither
    for d in days.values():
        for path in d["created"] + d["updated"]:
            assert not path.startswith("DailyNotes/")
            assert not path.startswith("Templates/")


def test_created_uses_local_day_in_both_dst_periods(calendar_space_dir: Path):
    def fake_dst_rule(naive: datetime, fold: int) -> timedelta:
        return timedelta(hours=2 if 4 <= naive.month <= 10 else 1)

    _write(
        calendar_space_dir,
        "Pages/Winter.md",
        "type: 'Page'\ntitle: Winter\ncreatedAt: 2026-01-15T23:30:00.000Z\n"
        "lastUpdated: 2026-01-15T23:30:00.000Z",
    )
    _write(
        calendar_space_dir,
        "Pages/Summer.md",
        "type: 'Page'\ntitle: Summer\ncreatedAt: 2026-07-15T22:30:00.000Z\n"
        "lastUpdated: 2026-07-15T22:30:00.000Z",
    )
    space = _space(calendar_space_dir, tz=SystemTz(offset_at=fake_dst_rule))
    winter = space.calendar("2026-01-15", "2026-01-16")["days"]
    summer = space.calendar("2026-07-15", "2026-07-16")["days"]
    assert winter["2026-01-16"]["created"] == ["Pages/Winter.md"]
    assert winter["2026-01-15"]["created"] == []
    assert summer["2026-07-16"]["created"] == ["Pages/Summer.md"]
    assert summer["2026-07-15"]["created"] == []


def test_hidden_property_and_type_excluded(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    r = space.calendar("2026-10-22", "2026-10-25")
    all_dated = {pk for d in r["days"].values() for pk in _dated_paths(d)}
    assert ("Meetings/Audit log.md", "internalStamp") not in all_dated
    assert all(p != "Events/Concert.md" for p, _k in all_dated)
    # the visible datetime is there
    assert ("Meetings/Planning.md", "when") in _dated_paths(r["days"]["2026-10-23"])


def test_task_date_and_deadline_not_in_dated(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    r = space.calendar("2026-10-14", "2026-10-31")
    for d in r["days"].values():
        for e in d["dated"]:
            assert not e["path"].startswith("Tasks/"), e
    assert ("Tasks/File taxes.md", "deadline", "2026-10-30", False) in _tasks(r["days"]["2026-10-30"])
    assert ("Tasks/Fix leak.md", "date", "2026-10-25", False) in _tasks(r["days"]["2026-10-25"])
    # DailyNote's own `date` is not a dated entry either
    assert all(not e["path"].startswith("DailyNotes/") for d in r["days"].values() for e in d["dated"])


def test_task_completed_not_in_dated(calendar_space_dir: Path):
    _write(
        calendar_space_dir,
        "Meetings/Hidden.md",
        "type: 'Meeting'\ntitle: Hidden\ncreatedAt: 2026-10-01T09:00:00.000Z\n"
        "lastUpdated: 2026-10-01T09:00:00.000Z\nsecret: 2026-10-22",
    )
    t = calendar_space_dir / ".object" / "types" / "meeting.json"
    import json

    data = json.loads(t.read_text(encoding="utf-8"))
    data["propertyDefinitions"].append(
        {
            "id": "secret",
            "key": "secret",
            "name": "Secret",
            "type": "datetimeSimple",
            "visibility": "hidden",
            "options": {},
        }
    )
    t.write_text(json.dumps(data), encoding="utf-8")
    space = _space(calendar_space_dir)
    r = space.calendar("2026-10-01", "2026-10-31")
    day = r["days"]["2026-10-22"]
    assert ("Tasks/Send invoice.md", "completed") not in _dated_paths(day)
    assert ("Meetings/Hidden.md", "secret") not in _dated_paths(day)
    keys = {e["key"] for d in r["days"].values() for e in d["dated"]}
    assert not keys & {"createdAt", "lastUpdated", "completed"}


def test_datetime_range_end_at_midnight(calendar_space_dir: Path):
    # 2026-10-25T08:00Z .. 2026-10-27T22:00Z is 10:00 on the 25th .. 00:00 on the 28th at +02:00
    _write(
        calendar_space_dir,
        "Meetings/Workshop.md",
        "type: 'Meeting'\ntitle: Workshop\ncreatedAt: 2026-10-01T09:00:00.000Z\n"
        "lastUpdated: 2026-10-01T09:00:00.000Z\n"
        "when: 2026-10-25T08:00:00.000Z -> 2026-10-27T22:00:00.000Z",
    )
    _write(
        calendar_space_dir,
        "Meetings/Backwards.md",
        "type: 'Meeting'\ntitle: Backwards\ncreatedAt: 2026-10-01T09:00:00.000Z\n"
        "lastUpdated: 2026-10-01T09:00:00.000Z\n"
        "when: 2026-10-26T08:00:00.000Z -> 2026-10-24T08:00:00.000Z",
    )
    space = _space(calendar_space_dir)
    days = space.calendar("2026-10-23", "2026-10-29")["days"]
    on = [d for d, v in days.items() if ("Meetings/Workshop.md", "when") in _dated_paths(v)]
    assert on == ["2026-10-25", "2026-10-26", "2026-10-27"]
    back = [d for d, v in days.items() if ("Meetings/Backwards.md", "when") in _dated_paths(v)]
    assert back == ["2026-10-26"]
    entry = next(e for e in days["2026-10-26"]["dated"] if e["path"] == "Meetings/Workshop.md")
    assert entry == {
        "path": "Meetings/Workshop.md",
        "key": "when",
        "start": "2026-10-25T08:00:00.000Z",
        "end": "2026-10-27T22:00:00.000Z",
        "resolution": "time",
    }


# -- tasks ------------------------------------------------------------------------


def test_overdue_only_today_and_open(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    r = space.calendar("2026-10-14", "2026-10-24")
    days = r["days"]
    path = "Tasks/Renew passport.md"
    assert _tasks(days["2026-10-23"], path) == [(path, "overdue", "2026-10-14", False)]
    assert _tasks(days["2026-10-14"], path) == [(path, "date", "2026-10-14", False)]
    for d, v in days.items():
        if d not in ("2026-10-14", "2026-10-23"):
            assert _tasks(v, path) == []
        for e in v["tasks"]:
            if e["kind"] == "overdue":
                assert d == "2026-10-23" and not e["done"]
    # the done task of the 22nd is never overdue
    assert _tasks(days["2026-10-23"], "Tasks/Send invoice.md") == []
    # today is outside the range: no overdue at all
    later = space.calendar("2026-10-24", "2026-10-31")
    assert all(e["kind"] != "overdue" for d in later["days"].values() for e in d["tasks"])


def test_occurrences_not_duplicated(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    r = space.calendar("2026-10-14", "2026-11-15")
    days = r["days"]
    weekly = "Tasks/Weekly review.md"
    entries = [(d, e["kind"]) for d, v in days.items() for e in v["tasks"] if e["path"] == weekly]
    assert ("2026-10-14", "date") in entries
    occ = [d for d, k in entries if k == "occurrence"]
    assert occ == ["2026-10-28", "2026-11-04", "2026-11-11"]  # later weeks only, never past
    assert all(k != "occurrence" or d != "2026-10-14" for d, k in entries)
    # a task dated today: the real date today, occurrences after it
    retro = "Tasks/Sprint retro.md"
    retro_entries = [(d, e["kind"]) for d, v in days.items() for e in v["tasks"] if e["path"] == retro]
    assert retro_entries == [("2026-10-23", "date"), ("2026-10-30", "occurrence")]  # until stops it
    # completion-mode recurrences produce none
    water = "Tasks/Water plants.md"
    assert all(
        e["kind"] != "occurrence" for v in days.values() for e in v["tasks"] if e["path"] == water
    )
    # an invalid repeat or one with no date produces none
    for path in ("Tasks/Clean garage.md", "Tasks/Stretch.md"):
        assert all(
            e["kind"] != "occurrence" for v in days.values() for e in v["tasks"] if e["path"] == path
        )
    # the occurrence entry shape
    e = next(e for e in days["2026-10-28"]["tasks"] if e["path"] == weekly)
    assert e == {"path": weekly, "kind": "occurrence", "day": "2026-10-28", "done": False}


def test_done_tasks_listed_with_done_flag(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    days = space.calendar("2026-10-22", "2026-10-23")["days"]
    assert _tasks(days["2026-10-22"], "Tasks/Send invoice.md") == [
        ("Tasks/Send invoice.md", "date", "2026-10-22", True)
    ]
    assert _tasks(days["2026-10-23"], "Tasks/Buy stamps.md") == [
        ("Tasks/Buy stamps.md", "date", "2026-10-23", False)
    ]


def test_time_task_day_is_local(calendar_space_dir: Path):
    _write(
        calendar_space_dir,
        "Tasks/Late call.md",
        "type: 'Task'\ntitle: Late call\ncreatedAt: 2026-10-01T09:00:00.000Z\n"
        "lastUpdated: 2026-10-01T09:00:00.000Z\nstatus: Not Started\ndate: 2026-10-23T22:30:00.000Z",
    )
    space = _space(calendar_space_dir)
    days = space.calendar("2026-10-23", "2026-10-24")["days"]
    assert _tasks(days["2026-10-24"], "Tasks/Late call.md") == [
        ("Tasks/Late call.md", "date", "2026-10-24", False)
    ]
    assert _tasks(days["2026-10-23"], "Tasks/Late call.md") == []
    # 08:30Z is 10:30 local on the 23rd
    assert _tasks(days["2026-10-23"], "Tasks/Call dentist.md") == [
        ("Tasks/Call dentist.md", "date", "2026-10-23", False)
    ]


def test_range_over_100_days_422(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    assert len(space.calendar("2026-10-01", "2027-01-08")["days"]) == 100
    with pytest.raises(InvalidValue):
        space.calendar("2026-10-01", "2027-01-09")
    for bad in ("2026-13-01", "2026-1-5", "today", ""):
        with pytest.raises(InvalidValue):
            space.calendar(bad, "2026-10-23")
    app = create_app(space, None, watch=False)
    with TestClient(app) as c:
        assert c.get("/api/calendar?from=2026-10-01&to=2027-01-09").status_code == 422
        assert c.get("/api/calendar?from=nope&to=2026-10-02").status_code == 422
        assert c.get("/api/calendar?from=2026-10-01").status_code == 422
        ok = c.get("/api/calendar?from=2026-10-20&to=2026-10-26")
        assert ok.status_code == 200, ok.text
        body = ok.json()
        assert set(body) == {"from", "to", "today", "days", "summaries", "warnings"}
        assert body["days"]["2026-10-22"]["dailyNote"]["reviewed"] is True


def test_from_after_to_422(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    with pytest.raises(InvalidValue):
        space.calendar("2026-10-24", "2026-10-23")
    assert len(space.calendar("2026-10-23", "2026-10-23")["days"]) == 1
    with TestClient(create_app(space, None, watch=False)) as c:
        assert c.get("/api/calendar?from=2026-10-24&to=2026-10-23").status_code == 422


def test_calendar_get_writes_nothing(calendar_space_dir: Path):
    before = _hashes(calendar_space_dir)
    space = _space(calendar_space_dir)
    with TestClient(create_app(space, None, watch=False)) as c:
        for f, t in (("2026-10-01", "2026-11-11"), ("2026-10-23", "2026-10-23"), ("2026-01-01", "2026-03-31")):
            assert c.get(f"/api/calendar?from={f}&to={t}").status_code == 200
    assert _hashes(calendar_space_dir) == before
    assert not (calendar_space_dir / "DailyNotes" / "2026-10-26.md").exists()


def test_month_5000_objects_under_300ms(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    base_task = space._raw["Tasks/Weekly review.md"]
    base_page = space._raw["Pages/Garden plan.md"]
    base_meeting = space._raw["Meetings/Offsite.md"]
    start = datetime(2026, 9, 1, tzinfo=UTC)
    repeats = ["every week", "every day", "every 2 weeks", "every month", None]
    for i in range(5000):
        stamp = (start + timedelta(hours=7 * i)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        day = (start + timedelta(days=i % 70)).date().isoformat()
        kind = i % 3
        if kind == 0:
            src = (
                f"id: GEN{i}\ntype: 'Task'\ntitle: Task {i}\ncreatedAt: {stamp}\nlastUpdated: {stamp}\n"
                f"status: {'Done' if i % 7 == 0 else 'Not Started'}\ndate: {day}\n"
            )
            if repeats[i % 5]:
                src += f"repeat: {repeats[i % 5]}\n"
            base, folder = base_task, "Tasks"
        elif kind == 1:
            src = f"id: GEN{i}\ntype: 'Page'\ntitle: Page {i}\ncreatedAt: {stamp}\nlastUpdated: {stamp}\n"
            base, folder = base_page, "Pages"
        else:
            src = (
                f"id: GEN{i}\ntype: 'Meeting'\ntitle: Meeting {i}\ncreatedAt: {stamp}\n"
                f"lastUpdated: {stamp}\nspan: {day} -> {day}\nwhen: {stamp}\n"
            )
            base, folder = base_meeting, "Meetings"
        rel = f"{folder}/gen {i}.md"
        raw = replace(base, path=rel, fm=parse_fm(src))
        space._raw[rel] = raw
        space._summaries[rel] = space._summarize(raw)
    assert len(space.list()) > 5000
    limit = 0.3 * (3 if os.environ.get("OBJECT_CI_SLOW") else 1)
    space.calendar("2026-10-01", "2026-11-11")  # warm up
    best = float("inf")
    for _ in range(3):
        t0 = time.perf_counter()
        r = space.calendar("2026-09-28", "2026-11-08")
        best = min(best, time.perf_counter() - t0)
    assert len(r["days"]) == 42
    assert best < limit, f"{best * 1000:.0f} ms"


# -- ui keys ----------------------------------------------------------------------


def test_ui_accepts_calendar_tasks_reminders_keys(calendar_space_dir: Path):
    space = _space(calendar_space_dir)
    with TestClient(create_app(space, None, watch=False)) as c:
        base = c.get("/api/ui").json()["revision"]
        pinned = c.put(
            "/api/ui", json={"patch": {"pinned": [{"kind": "type", "id": "task"}]}, "baseRevision": base}
        )
        assert pinned.status_code == 200, pinned.text
        rev = pinned.json()["revision"]
        calendar = {
            "weekStart": "monday",
            "daily": {"hideTasks": True, "hideCreateObjects": False, "tasksView": {"layout": "list"}},
        }
        tasks = {"activeTab": "today", "views": {"today": {"layout": "list"}}}
        r = c.put(
            "/api/ui",
            json={
                "patch": {"calendar": calendar, "tasks": tasks, "reminders": {"enabled": False}},
                "baseRevision": rev,
            },
        )
        assert r.status_code == 200, r.text
        ui = c.get("/api/ui").json()["ui"]
        assert ui["calendar"] == calendar
        assert ui["tasks"] == tasks
        assert ui["reminders"] == {"enabled": False}
        assert ui["pinned"] == [{"kind": "type", "id": "task"}]  # the other keys are kept
        rev = r.json()["revision"]
        for bad in (
            {"calendar": []},
            {"calendar": {"weekStart": "tuesday"}},
            {"calendar": {"daily": []}},
            {"calendar": {"daily": {"hideTasks": "yes"}}},
            {"calendar": {"daily": {"tasksView": "list"}}},
            {"tasks": "today"},
            {"tasks": {"activeTab": "someday"}},
            {"tasks": {"views": []}},
            {"tasks": {"views": {"today": 3}}},
            {"reminders": True},
            {"reminders": {}},
            {"reminders": {"enabled": "no"}},
        ):
            bad_r = c.put("/api/ui", json={"patch": bad, "baseRevision": rev})
            assert bad_r.status_code == 422, (bad, bad_r.text)
        unknown = c.put("/api/ui", json={"patch": {"calendarz": {}}, "baseRevision": rev})
        assert unknown.status_code == 422
        assert "Cannot patch" in unknown.json()["detail"]
        stale = c.put("/api/ui", json={"patch": {"reminders": {"enabled": True}}, "baseRevision": base})
        assert stale.status_code == 409
        assert c.get("/api/ui").json()["ui"]["reminders"] == {"enabled": False}


def test_ui_accepts_tasks_all_tab(calendar_space_dir: Path):
    # The Tasks page's "All" tab (Object's `allContent`, after Completed).
    space = _space(calendar_space_dir)
    with TestClient(create_app(space, None, watch=False)) as c:
        rev = c.get("/api/ui").json()["revision"]
        tasks = {"activeTab": "all", "views": {"all": {"layout": "list"}}}
        r = c.put("/api/ui", json={"patch": {"tasks": tasks}, "baseRevision": rev})
        assert r.status_code == 200, r.text
        assert c.get("/api/ui").json()["ui"]["tasks"] == tasks


def test_ui_accepts_hide_calendar_sidebar(calendar_space_dir: Path):
    # M7 Task 3: the calendar's "hide sidebar" toggle is stored in `ui.json`'s calendar object.
    space = _space(calendar_space_dir)
    with TestClient(create_app(space, None, watch=False)) as c:
        rev = c.get("/api/ui").json()["revision"]
        calendar = {"weekStart": "sunday", "hideCalendarSidebar": True}
        r = c.put("/api/ui", json={"patch": {"calendar": calendar}, "baseRevision": rev})
        assert r.status_code == 200, r.text
        assert c.get("/api/ui").json()["ui"]["calendar"] == calendar
        rev = r.json()["revision"]
        for bad in ("yes", 1, None, [True]):
            bad_r = c.put(
                "/api/ui",
                json={"patch": {"calendar": {"hideCalendarSidebar": bad}}, "baseRevision": rev},
            )
            assert bad_r.status_code == 422, (bad, bad_r.text)
            assert "hideCalendarSidebar" in bad_r.json()["detail"]
        assert c.get("/api/ui").json()["ui"]["calendar"] == calendar
