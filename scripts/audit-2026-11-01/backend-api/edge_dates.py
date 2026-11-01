"""Reminder / recurrence / calendar edge cases: ancient and far dates, DST, leap days,
huge reminder offsets, and the cost of each.

Run: ``uv run python scripts/audit-2026-11-01/backend-api/edge_dates.py``
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import make_client  # noqa: E402


def write_task(root: Path, name: str, fm: str, body: str = "") -> str:
    p = root / "Tasks" / f"{name}.md"
    p.write_text(f"---\ntype: 'Task'\ntitle: {name}\ncreatedAt: 2026-10-01T08:00:00.000Z\nlastUpdated: 2026-10-01T08:00:00.000Z\nstatus: Not Started\n{fm}\n---\n{body}", encoding="utf-8")
    return f"Tasks/{name}.md"


def timed(client, label, method, url, **kw):
    t = time.perf_counter()
    r = client.request(method, url, **kw)
    dt = time.perf_counter() - t
    body = r.text[:160].replace("\n", " ")
    print(f"  {label:58} {r.status_code} {dt*1000:9.1f} ms  {body}")
    return r


def main() -> None:
    root = None
    # Build the space first, then the app (the scan reads the files at start-up).
    import shutil
    from harness import FIXTURES, fresh_dir
    root = fresh_dir("space") / "space-m8"
    shutil.copytree(FIXTURES / "space-m8", root)
    ancient = write_task(root, "Ancient daily", "date: 1800-01-01\nrepeat: every day")
    ancient_t = write_task(root, "Ancient daily timed", "date: 1800-01-01T09:00:00.000Z\nrepeat: every day")
    far = write_task(root, "Far future", "date: 9999-12-31\nrepeat: every day\nremind: 1 day before at 09:00")
    leap = write_task(root, "Leap day", "date: 2028-02-29\nrepeat: every year")
    leap_on = write_task(root, "Leap on", "date: 2028-02-29\nrepeat: every year on february 29")
    monthly31 = write_task(root, "Monthly 31", "date: 2026-01-31\nrepeat: every month on the 31st")
    dst = write_task(root, "DST", "date: 2026-03-07T02:30:00.000Z\nrepeat: every day\nremind: 30 minutes before")
    hugeremind = write_task(root, "Huge remind", "date: 2026-11-05\nremind: 999999999999999999 days before at 09:00")
    weekday = write_task(root, "Weekday old", "date: 2000-01-03\nrepeat: every weekday")
    yearly_old = write_task(root, "Yearly old", "date: 0001-01-01\nrepeat: every year")
    client, _ = make_client(root, OBJECT_FAKE_NOTIFY_FILE=str(root.parent / "notify.txt"))
    client.app.state.space.tz = __import__("zoneinfo").ZoneInfo("America/New_York")

    print("== calendar ==")
    timed(client, "calendar normal month", "GET", "/api/calendar", params={"from": "2026-11-01", "to": "2026-11-30"})
    timed(client, "calendar year 1", "GET", "/api/calendar", params={"from": "0001-01-01", "to": "0001-01-31"})
    timed(client, "calendar year 9999 end", "GET", "/api/calendar", params={"from": "9999-12-01", "to": "9999-12-31"})
    timed(client, "calendar leap 2028-02", "GET", "/api/calendar", params={"from": "2028-02-01", "to": "2028-03-01"})
    timed(client, "calendar 2026-02-30", "GET", "/api/calendar", params={"from": "2026-02-30", "to": "2026-03-01"})
    timed(client, "calendar from>to", "GET", "/api/calendar", params={"from": "2026-03-02", "to": "2026-03-01"})
    timed(client, "calendar 101 days", "GET", "/api/calendar", params={"from": "2026-01-01", "to": "2026-04-11"})
    timed(client, "calendar +00:00 forms", "GET", "/api/calendar", params={"from": " 2026-11-01 ", "to": "2026-11-30T00:00"})

    print("\n== tasks ==")
    for p in (ancient, ancient_t, far, leap, leap_on, monthly31, weekday, yearly_old):
        timed(client, f"overdue {p}", "GET", "/api/tasks/overdue", params={"path": p})
        timed(client, f"stats {p}", "GET", "/api/tasks/stats", params={"path": p})
    for p in (ancient, ancient_t, weekday):
        v = client.get("/api/object", params={"path": p}).json()["version"]
        r = timed(client, f"occurrence complete advanceOne {p}", "POST", "/api/tasks/occurrence",
                  json={"path": p, "action": "complete", "catchUp": "advanceOne", "baseVersion": v})
        v = r.json().get("version", v)
        r = timed(client, f"occurrence complete catchUpThroughNow {p}", "POST", "/api/tasks/occurrence",
                  json={"path": p, "action": "skip", "catchUp": "catchUpThroughNow", "baseVersion": v})
        if r.status_code == 200:
            log = r.json()["frontmatter"].get("occurrenceLog", "")
            print(f"     occurrenceLog lines: {len(str(log).splitlines())}, file size {len((root / p).read_bytes())} bytes")
    v = client.get("/api/object", params={"path": far}).json()["version"]
    timed(client, "occurrence complete far future", "POST", "/api/tasks/occurrence", json={"path": far, "action": "complete", "baseVersion": v})
    v = client.get("/api/object", params={"path": monthly31}).json()["version"]
    timed(client, "occurrence complete monthly 31 (Jan->?)", "POST", "/api/tasks/occurrence", json={"path": monthly31, "action": "complete", "catchUp": "advanceOne", "baseVersion": v})
    v = client.get("/api/object", params={"path": leap_on}).json()["version"]
    timed(client, "occurrence complete leap on feb 29", "POST", "/api/tasks/occurrence", json={"path": leap_on, "action": "complete", "catchUp": "advanceOne", "baseVersion": v})

    print("\n== reminders ==")
    for remind in ["999999999999999999 days before at 09:00", "1 day before at 24:00", "1 day before at 9:60", "0 days before at 09:00",
                   "99999999999999999999999 minutes before", "at time", "on the day at 02:30", "-1 days before at 09:00", " ", "1 day before at 09:00\n"]:
        v = client.get("/api/object", params={"path": hugeremind}).json()["version"]
        timed(client, f"set remind {remind[:35]!r}", "PUT", "/api/tasks/reminder", json={"path": hugeremind, "key": "date", "remind": remind, "baseVersion": v})
    # the scheduler tick with every reminder in the space
    timed(client, "reminder tick", "POST", "/api/_test/tick")
    # a date value that isn't a date
    v = client.get("/api/object", params={"path": hugeremind}).json()["version"]
    for val in [{"start": "9999-99-99", "resolution": "day"}, {"start": "0001-01-01T00:00:00Z", "resolution": "time"}, {"start": "2026-11-05", "end": "2026-11-01", "resolution": "day"},
                {"start": "2026-11-05T25:00:00Z", "resolution": "time"}, {"start": "+10000-01-01", "resolution": "day"}, "2026-11-05", 20261105, {"start": "2026-11-05", "resolution": "week"}]:
        r = timed(client, f"set date {str(val)[:40]!r}", "PUT", "/api/object/properties", json={"path": hugeremind, "updates": {"date": val}, "baseVersion": v})
        v = r.json().get("version", v)
    timed(client, "calendar after odd dates", "GET", "/api/calendar", params={"from": "2026-11-01", "to": "2026-11-30"})
    timed(client, "reminder tick after odd dates", "POST", "/api/_test/tick")

    print("\n== daily notes ==")
    for d in ["2026-02-30", "0001-01-01", "9999-12-31", "2026-1-1", "2026-11-05T10:00", " 2026-11-05", "20261105"]:
        timed(client, f"daily note {d!r}", "POST", "/api/daily-notes", json={"date": d})
    client.__exit__(None, None, None)


if __name__ == "__main__":
    main()
