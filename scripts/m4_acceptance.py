"""Milestone 4 acceptance run over HTTP (plan Task 16, Step 2).

Usage: ``uv run python scripts/m4_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the
copy to a throw-away git repo and serves it on a free ``127.0.0.1`` port with
the Task 6 test hooks set:

- ``OBJECT_CLOCK_FILE``: the script writes an ISO UTC instant there to move time;
- ``OBJECT_FAKE_NOTIFY_FILE``: a fake notifier that appends notifications to a
  file (the real OS notifier is never called) and enables ``POST /api/_test/tick``;
- ``OBJECT_STATE_DIR``: a temporary folder for the reminder ledger.

"Today" is the machine's local day. Over HTTP it checks:

 1. starting twice and calling every M4 read route (``GET /api/calendar`` over a
    month, ``POST /api/rows`` over Tasks) changes no file; no daily note exists
    for today;
 2. ``POST /api/daily-notes`` for today creates exactly ``DailyNotes/<today>.md``
    with the Task 4 shape (plus the DailyNote type JSON when it was only
    inferred); a second call is 409 with its path;
 3. a Task's ``date``, ``repeat: every week`` and ``remind: 1 day before at
    09:00`` set through ``PUT /api/object/properties`` give one line per key
    plus ``lastUpdated`` (and ``id``);
 4. completing it changes only ``status``, ``date``, ``completed`` and
    ``lastUpdated``; ``date`` is the next occurrence on or after today, the
    status is Not Started and the response says ``advanced``;
 5. completing a non-recurring task changes ``status``, ``completed`` and
    ``lastUpdated``; reopening removes ``completed`` only;
 6. ``GET /api/calendar`` lists the daily note, the task on its date and its later
    occurrences, an object created just after local midnight on the right day,
    a date range on each of its days, and no hidden or ``hideCalendarEvents``
    property;
 7. the scheduler (clock advanced, then ``POST /api/_test/tick``) fires the
    reminder once to the fake notifier, leaves the space clean, and does not
    fire it again after a restart;
 8. ``PUT /api/ui`` with ``calendar``/``tasks`` keys changes only
    ``.object/ui.json``; a stale revision is 409;
 9. the M1 no-edit pass changes no file.

Tasks, daily notes and a probe type are created over the API, so it also works on
a copy of a real export. Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero
on any failure.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
import threading
import time
from datetime import UTC, date, datetime, timedelta
from datetime import time as dtime
from pathlib import Path
from typing import Any

import uvicorn

from m2_acceptance import (
    HOST, Http, Run, _def, _opt, changed_paths, check_migration, commit, free_port, git, hunk_keys, remove_tree, snapshot,
)
from objectapp.server import create_app
from objectapp.space import Space

TASK4_KEYS = ["id", "type", "title", "createdAt", "lastUpdated", "date", "reviewed"]


# -- plumbing ---------------------------------------------------------------------


class Server:
    """One app on a free port; `stop` runs the lifespan shutdown (the scheduler records lastRunning)."""

    def __init__(self, root: Path, space: Space | None = None) -> None:
        self.space = space or Space(root)
        port = free_port()
        app = create_app(self.space, None, watch=True)
        self.server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        self.http = Http(f"http://{HOST}:{port}/api")
        for _ in range(100):
            try:
                if self.http("GET", "/space")[0] == 200:
                    break
            except OSError:
                time.sleep(0.1)

    def stop(self) -> None:
        self.server.config.app.state.hub.close()
        self.server.should_exit = True
        self.thread.join(timeout=10)


class Clock:
    def __init__(self, path: Path) -> None:
        self.path = path

    def set_local(self, day: date, hh: int, mm: int, ss: int = 0) -> datetime:
        local = datetime.combine(day, dtime(hh, mm, ss)).astimezone()  # the machine's zone
        self.path.write_text(local.astimezone(UTC).isoformat(), encoding="utf-8")
        return local


def frontmatter_keys(text: str) -> list[str]:
    lines = text.replace("\r\n", "\n").split("\n")
    out = []
    for line in lines[1:]:
        if line == "---":
            break
        if line and not line[0].isspace() and ":" in line:
            out.append(line.split(":", 1)[0])
    return out


def fm_value(text: str, key: str) -> str | None:
    for line in text.replace("\r\n", "\n").split("\n")[1:]:
        if line == "---":
            break
        if line.startswith(key + ":"):
            return line.split(":", 1)[1].strip().strip("'\"")
    return None


def day_s(d: date) -> str:
    return d.isoformat()


def status_texts(task_type: dict) -> tuple[str, str]:
    """(a done option text, the first not-started option text) of the Task status."""
    sdef = next((d for d in task_type["propertyDefinitions"] if d["type"] == "label"
                 and (d.get("options", {}).get("isStatus") or d["key"] == "status")), None)
    opts = (sdef or {}).get("options", {}).get("set") or []
    done = next((o["text"] for o in opts if o.get("statusCategory") == "done"), "Done")
    open_ = next((o["text"] for o in opts if o.get("statusCategory", "not-started") == "not-started"), "Not Started")
    return done, open_


class M4:
    def __init__(self, root: Path, run: Run, clock: Clock, notify_file: Path) -> None:
        self.root = root
        self.run = run
        self.clock = clock
        self.notify_file = notify_file
        self.today = date.today()
        self.note_day = self.today

    @property
    def http(self) -> Http:
        return self.run.http

    def task_type(self) -> dict:
        t = self.run.type_named("Task")
        assert t is not None, "the space has no Task type"
        return t

    def ensure_done_option(self) -> None:
        """Give the Task status a done-category option when it has none (an inferred status set).

        Opening keeps a type's own options, so a space whose tasks never used a done
        status has no option to complete with; this adds "Done" the way the type
        settings would, before the task checks.
        """
        t = self.task_type()
        sdef = next((d for d in t["propertyDefinitions"] if d["type"] == "label"
                     and (d.get("options", {}).get("isStatus") or d["key"] == "status")), None)
        if sdef is None:
            return
        opts = sdef.setdefault("options", {}).setdefault("set", [])
        if any(o.get("statusCategory") == "done" for o in opts):
            return
        opts.append({**_opt("Done"), "color": "green", "statusCategory": "done"})
        code, res = self.run.save_type(t, confirm=True)
        assert code == 200, (code, res)
        commit(self.root, "status Done option")
        print("         the Task status had no done option: added 'Done' through PUT /api/types/{id}")

    def new_task(self, title: str) -> str:
        code, res = self.http("POST", "/objects", {"typeId": self.task_type()["id"], "title": title, "templateId": "none"})
        assert code == 201, (code, res)
        commit(self.root, f"task {title}")
        return res["path"]

    def put(self, path: str, updates: dict, remove: list[str] | None = None) -> tuple[int, Any]:
        o = self.run.obj(path)
        body: dict[str, Any] = {"path": path, "updates": updates, "baseVersion": o["version"]}
        if remove:
            body["remove"] = remove
        return self.http("PUT", "/object/properties", body)

    def calendar(self, a: date, b: date) -> dict:
        code, res = self.http("GET", "/calendar", **{"from": day_s(a), "to": day_s(b)})
        assert code == 200, (code, res)
        return res

    # 1 -------------------------------------------------------------------------
    def reads(self, label: str) -> None:
        first = self.today.replace(day=1)
        last = (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        cal = self.calendar(first, last)
        code, _ = self.http("POST", "/rows", {"typeIds": [self.task_type()["id"]]})
        self.http("GET", "/ui")
        status = git(self.root, "status", "--porcelain", "-uall").strip()
        self.run.report(code == 200 and not status, f"{label}: calendar over {first}..{last} and rows over Tasks leave the tree clean",
                        *([status] if status else []))
        if (cal["days"].get(day_s(self.today)) or {}).get("dailyNote"):
            # A real export may already have today's note: use the next free day for check 2.
            d = self.today + timedelta(days=1)
            while (self.calendar(d, d)["days"][day_s(d)]).get("dailyNote"):
                d += timedelta(days=1)
            self.note_day = d
            print(f"         today already has a daily note; check 2 uses {d}")
        else:
            self.run.report(not (self.root / "DailyNotes" / f"{self.today}.md").exists(),
                            f"{label}: no daily note exists for today ({self.today})")

    # 2 -------------------------------------------------------------------------
    def daily_note(self) -> str:
        print("\n2. Daily note")
        type_file_before = {p for p in snapshot(self.root) if p.startswith(".object/types/")}
        before = snapshot(self.root)
        code, res = self.http("POST", "/daily-notes", {"date": day_s(self.note_day)})
        diff = changed_paths(before, snapshot(self.root))
        path = res.get("path") if isinstance(res, dict) else None
        want = f"DailyNotes/{self.note_day}.md"
        extra = [p for p in diff if p != want]
        types_ok = all(p.startswith(".object/types/") and p not in type_file_before for p in extra)
        type_note = f" (plus {extra})" if extra else ""
        shape = frontmatter_keys(self.run.text(want)) if path == want else []
        values_ok = path == want and fm_value(self.run.text(want), "date") == day_s(self.note_day) \
            and fm_value(self.run.text(want), "reviewed") == "false"
        self.run.report(code == 201 and path == want and want in diff and types_ok and len(extra) <= 1,
                        f"POST /daily-notes is {code} and wrote {want}{type_note}", *([str(res)] if code != 201 else []))
        self.run.report(shape == TASK4_KEYS and values_ok, f"frontmatter keys {shape}",
                        *([f"expected {TASK4_KEYS}, date {self.note_day}, reviewed false"] if shape != TASK4_KEYS or not values_ok else []))
        commit(self.root, "daily note")
        before = snapshot(self.root)
        c2, r2 = self.http("POST", "/daily-notes", {"date": day_s(self.note_day)})
        diff2 = changed_paths(before, snapshot(self.root))
        self.run.report(c2 == 409 and isinstance(r2, dict) and r2.get("path") == want and not diff2,
                        f"a second POST is {c2} with path {r2.get('path') if isinstance(r2, dict) else r2!r}, nothing written")
        return want

    # 3 -------------------------------------------------------------------------
    def recurring_setup(self) -> tuple[str, date]:
        print("\n3. Task date, repeat and remind")
        self.ensure_done_option()
        path = self.new_task("M4 weekly probe")
        start = self.today - timedelta(days=3)
        before = self.run.text(path)
        code, res = self.put(path, {"date": {"start": day_s(start), "resolution": "day"},
                                    "repeat": "every week", "remind": "1 day before at 09:00"})
        removed, added, n_rem, n_add = hunk_keys(self.root, path, before, self.run.text(path))
        keys = removed | added
        new_keys = added - removed
        line_counts_ok = n_add - n_rem == len(new_keys) and n_add <= len(keys)
        ok = code == 200 and {"date", "repeat", "remind"} <= added and keys <= {"date", "repeat", "remind", "lastUpdated", "id"}
        text = self.run.text(path)
        values_ok = fm_value(text, "repeat") == "every week" and fm_value(text, "remind") == "1 day before at 09:00" \
            and fm_value(text, "date") == day_s(start)
        self.run.report(ok and line_counts_ok and values_ok,
                        f"diff touches {sorted(keys)} with {n_add} added / {n_rem} removed lines",
                        *([str(res)] if code != 200 else []))
        commit(self.root, "recurring set")
        return path, start

    # 4 -------------------------------------------------------------------------
    def recurring_complete(self, path: str, start: date) -> date:
        print("\n4. Completing a recurring task")
        done, open_ = status_texts(self.task_type())
        before = self.run.text(path)
        code, res = self.put(path, {"status": [done]})
        text = self.run.text(path)
        removed, added, _, _ = hunk_keys(self.root, path, before, text)
        keys = removed | added
        expected = start
        while expected < self.today or expected == start:
            expected += timedelta(days=7)
        task = (res or {}).get("task") if code == 200 else None
        new_date = fm_value(text, "date")
        self.run.report(code == 200 and keys <= {"status", "date", "completed", "lastUpdated"}
                        and {"date", "completed"} <= added,
                        f"diff touches {sorted(keys)}", *([str(res)] if code != 200 else []))
        self.run.report(new_date == day_s(expected) and fm_value(text, "status") == open_
                        and bool(task and task.get("advanced") and task.get("completed")),
                        f"date {start} -> {new_date} (expected {expected}), status {fm_value(text, 'status')!r}, task {task}")
        commit(self.root, "recurring done")
        return expected

    # 5 -------------------------------------------------------------------------
    def plain_complete_reopen(self) -> None:
        print("\n5. Completing and reopening a non-recurring task")
        done, open_ = status_texts(self.task_type())
        path = self.new_task("M4 one-off probe")
        before = self.run.text(path)
        code, res = self.put(path, {"status": [done]})
        text = self.run.text(path)
        removed, added, _, _ = hunk_keys(self.root, path, before, text)
        keys = removed | added
        task = (res or {}).get("task") if code == 200 else None
        self.run.report(code == 200 and keys <= {"status", "completed", "lastUpdated"} and {"status", "completed"} <= added
                        and fm_value(text, "status") == done and bool(task and task.get("completed") and not task.get("advanced")),
                        f"complete: diff touches {sorted(keys)}, task {task}", *([str(res)] if code != 200 else []))
        commit(self.root, "one-off done")
        before = text
        code, res = self.put(path, {"status": [open_]})
        text = self.run.text(path)
        removed, added, _, _ = hunk_keys(self.root, path, before, text)
        keys = removed | added
        task = (res or {}).get("task") if code == 200 else None
        self.run.report(code == 200 and keys <= {"status", "completed", "lastUpdated"} and "completed" in removed
                        and "completed" not in added and fm_value(text, "completed") is None
                        and bool(task and not task.get("completed")),
                        f"reopen: diff touches {sorted(keys)}, completed removed, task {task}")
        commit(self.root, "one-off reopened")

    # 6 -------------------------------------------------------------------------
    def calendar_contents(self, note: str, weekly: str, next_day: date) -> None:
        print("\n6. Calendar range")
        code, t = self.http("POST", "/types", {"name": "M4 Probe", "pluralName": "M4 Probes"})
        assert code == 201, (code, t)
        defs = list(t["propertyDefinitions"])
        defs.append(_def("when", "When", "datetimeSimple"))
        defs.append({**_def("secret", "Secret", "datetimeSimple"), "visibility": "hidden"})
        defs.append(_def("quiet", "Quiet", "datetimeSimple", {"hideCalendarEvents": True}))
        t["propertyDefinitions"] = defs
        code, res = self.run.save_type(t, confirm=True)
        assert code == 200, (code, res)
        commit(self.root, "probe type")
        d1, d3 = self.today + timedelta(days=1), self.today + timedelta(days=3)
        midnight = self.clock.set_local(self.today, 0, 0, 30)
        code, res = self.http("POST", "/objects", {
            "typeId": t["id"], "title": "M4 midnight probe", "templateId": "none",
            "values": {"when": {"start": day_s(d1), "end": day_s(d3), "resolution": "day"},
                       "secret": {"start": day_s(d1), "resolution": "day"},
                       "quiet": {"start": day_s(d1 + timedelta(days=1)), "resolution": "day"}}})
        assert code == 201, (code, res)
        probe = res["path"]
        commit(self.root, "midnight probe")
        self.clock.set_local(self.today, 10, 0)
        first = self.today.replace(day=1)
        last = self.today + timedelta(days=35)
        cal = self.calendar(first, last)
        days = cal["days"]

        dn = days[day_s(self.note_day)]["dailyNote"] if day_s(self.note_day) in days else None
        self.run.report(bool(dn and dn["path"] == note), f"{self.note_day} has daily note {dn}")
        own = days[day_s(next_day)]["tasks"]
        on_date = any(e["path"] == weekly and e["kind"] == "date" for e in own)
        occ = [d for d, v in sorted(days.items()) if any(e["path"] == weekly and e["kind"] == "occurrence" for e in v["tasks"])]
        want_occ = [day_s(next_day + timedelta(days=7 * k)) for k in range(1, 6) if next_day + timedelta(days=7 * k) <= last]
        self.run.report(on_date and occ == want_occ, f"weekly task on {next_day} (date) and occurrences {occ}",
                        *([f"expected occurrences {want_occ}"] if occ != want_occ else []))
        created_on = [d for d, v in days.items() if probe in v["created"]]
        self.run.report(created_on == [day_s(self.today)],
                        f"object created at {midnight.strftime('%Y-%m-%d %H:%M:%S %z')} local is listed as created on {created_on}")
        when_days = sorted(d for d, v in days.items() if any(e["path"] == probe and e["key"] == "when" for e in v["dated"]))
        want_when = [day_s(d1 + timedelta(days=k)) for k in range(3)]
        self.run.report(when_days == want_when, f"the range {d1}..{d3} is on {when_days}")
        hidden = sorted({e["key"] for v in days.values() for e in v["dated"] if e["path"] == probe and e["key"] != "when"})
        self.run.report(not hidden and probe in cal["summaries"],
                        f"hidden and hideCalendarEvents properties listed: {hidden or 'none'}")
        status = git(self.root, "status", "--porcelain", "-uall").strip()
        self.run.report(not status, "the calendar query wrote nothing", *([status] if status else []))

    # 7 -------------------------------------------------------------------------
    def notifications(self, title: str) -> int:
        if not self.notify_file.exists():
            return 0
        lines = [json.loads(line) for line in self.notify_file.read_text("utf-8").splitlines() if line.strip()]
        return sum(1 for n in lines if n.get("title") == title)

    def reminder_setup(self) -> tuple[str, date]:
        path = self.new_task("M4 reminder probe")
        due_day = self.today + timedelta(days=2)
        code, res = self.put(path, {"date": {"start": day_s(due_day), "resolution": "day"}, "remind": "1 day before at 09:00"})
        assert code == 200, (code, res)
        commit(self.root, "reminder set")
        return path, due_day

    def reminder_fire(self, path: str, due_day: date) -> None:
        print("\n7. Reminder scheduler")
        title = "M4 reminder probe"
        trigger_day = due_day - timedelta(days=1)
        before = self.notifications(title)
        self.clock.set_local(trigger_day, 8, 59, 0)
        self.http("POST", "/_test/tick")
        early = self.notifications(title)
        self.clock.set_local(trigger_day, 9, 0, 30)
        code, res = self.http("POST", "/_test/tick")
        c2, _ = self.http("POST", "/_test/tick")
        fired = self.notifications(title)
        self.run.report(code == 200 and c2 == 200 and before == 0 and early == 0 and fired == 1,
                        f"no notification at 08:59 ({early}); one at 09:00:30 ({fired}); a second tick adds none")
        status = git(self.root, "status", "--porcelain", "-uall").strip()
        self.run.report(not status, "the space is clean after firing (the ledger is in OBJECT_STATE_DIR)",
                        *([status] if status else []))
        state = Path(os.environ["OBJECT_STATE_DIR"])
        ledgers = sorted(p.name for p in state.glob("reminders-*.json"))
        self.run.report(bool(ledgers), f"ledger written outside the space: {ledgers}")

    def reminder_after_restart(self) -> None:
        title = "M4 reminder probe"
        self.http("POST", "/_test/tick")
        time.sleep(0.5)
        n = self.notifications(title)
        status = git(self.root, "status", "--porcelain", "-uall").strip()
        self.run.report(n == 1 and not status, f"after a restart: {n} notification in all, space clean")

    # 8 -------------------------------------------------------------------------
    def ui_keys(self) -> None:
        print("\n8. ui.json")
        _, ui0 = self.http("GET", "/ui")
        before = snapshot(self.root)
        patch = {"calendar": {"weekStart": "monday", "daily": {"hideUpdated": True}},
                 "tasks": {"activeTab": "today", "views": {}}}
        code, res = self.http("PUT", "/ui", {"patch": patch, "baseRevision": ui0["revision"]})
        diff = changed_paths(before, snapshot(self.root))
        stale, _ = self.http("PUT", "/ui", {"patch": {"reminders": {"enabled": True}}, "baseRevision": ui0["revision"]})
        _, ui1 = self.http("GET", "/ui")
        kept = ui1["ui"].get("calendar", {}).get("weekStart") == "monday" and ui1["ui"].get("tasks", {}).get("activeTab") == "today"
        self.run.report(code == 200 and diff == [".object/ui.json"] and stale == 409 and kept,
                        f"PUT /ui wrote {diff}; stale baseRevision is {stale}", *([str(res)] if code != 200 else []))
        commit(self.root, "ui")

    # 9 -------------------------------------------------------------------------
    def no_edit(self) -> None:
        print("\n9. M1 no-edit pass")
        before = snapshot(self.root)
        _, objs = self.http("GET", "/objects")
        statuses: dict[int, int] = {}
        for s in objs:
            o = self.run.obj(s["path"])
            code, _ = self.http("PUT", "/object/body", {"path": s["path"], "body": o["body"], "baseVersion": o["version"]})
            statuses[code] = statuses.get(code, 0) + 1
        diff = changed_paths(before, snapshot(self.root))
        self.run.report(not diff and set(statuses) <= {200, 423},
                        f"{len(objs)} objects, statuses {statuses}, {len(diff)} files changed", *([str(diff)] if diff else []))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m4-acceptance-"))
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git"))
    hooks = tmp / "hooks"
    (hooks / "state").mkdir(parents=True)
    clock = Clock(hooks / "clock.txt")
    notify_file = hooks / "notifications.jsonl"
    saved_env = {k: os.environ.get(k) for k in ("OBJECT_CLOCK_FILE", "OBJECT_FAKE_NOTIFY_FILE", "OBJECT_STATE_DIR")}
    os.environ["OBJECT_CLOCK_FILE"] = str(clock.path)
    os.environ["OBJECT_FAKE_NOTIFY_FILE"] = str(notify_file)
    os.environ["OBJECT_STATE_DIR"] = str(hooks / "state")
    clock.set_local(date.today(), 10, 0)

    git(root, "init", "-q")
    commit(root, "base")
    original = snapshot(root)

    srv: Server | None = None
    run: Run | None = None
    try:
        space, mig = check_migration(root, original)
        srv = Server(root, space)
        run = Run(root, srv.http)
        m4 = M4(root, run, clock, notify_file)
        print(f"Space copy: {root}")
        print(f"Today (local): {m4.today}")
        print(f"\n0. Opening twice: {mig[0]}", *mig[1:], sep="\n   ")
        run.failures += mig[0] != "ok"

        print("\n1. Reading changes nothing")
        m4.reads("first start")
        srv.stop()
        srv = Server(root)
        run.http = srv.http
        m4.reads("second start")

        note = m4.daily_note()
        weekly, start = m4.recurring_setup()
        next_day = m4.recurring_complete(weekly, start)
        m4.plain_complete_reopen()
        m4.calendar_contents(note, weekly, next_day)
        rem, due_day = m4.reminder_setup()
        m4.reminder_fire(rem, due_day)
        srv.stop()
        srv = Server(root)
        run.http = srv.http
        m4.reminder_after_restart()
        m4.ui_keys()
        m4.no_edit()
    finally:
        if srv is not None:
            srv.stop()
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        if args.keep:
            print(f"\nKept: {tmp}")
        else:
            remove_tree(tmp)

    failures = run.failures if run else 1
    print("\nRESULT:", "PASS" if failures == 0 else f"FAIL ({failures})")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
