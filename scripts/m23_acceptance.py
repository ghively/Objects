"""Milestone 23 acceptance run over HTTP (the Work section's routes).

Usage: ``uv run python scripts/m23_acceptance.py [SPACE] [--keep]``
(default SPACE: ``backend/tests/fixtures/space-work`` with ``space-work-m23`` copied over it)

Copies SPACE (and the overlay) and ``backend/tests/fixtures/monitoring`` to a temporary folder
(the originals are never touched), commits the space copy to a throw-away git repo, sets
``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR`` and ``OBJECT_CLOCK_FILE`` (2026-11-05T10:00:00Z) to
temporary paths outside the copy, serves ``create_app`` on a free ``127.0.0.1`` port, sets the
space's time zone to UTC and ``workAlertFolder`` to the monitoring copy (``PUT /api/settings``).
No agent runs, so the fake ``claude`` is not needed. Then it checks:

 1. reads write nothing: every M23 ``GET`` route leaves ``git status`` and the state dir alone;
 2. the board: Printer's turn is ``approve``, Waiting on Pat has a deadline and a person it is
    blocked on, Scanner firmware's project path shows after "Add work fields" on Project;
 3. focus: a save changes only the Focus list lines and ``lastUpdated``, CRLF and BOM kept; an old
    version is 409; a save for 2026-11-06 creates that note;
 4. today: the two meetings of the day, 09:00-09:30 and 13:00-13:30;
 5. a step action: approve Printer step 2 makes the turn ``agent``; the same rev again is 409
    "This step changed. Look again."; reopening it with the new rev puts it back to ``approve``;
 6. alerts: a scan creates two Alert objects and the Alert type, the toner message holds
    ``[redacted]``, ``backup-check`` is stale, ``broken.json`` is an error; a second scan writes
    nothing; removing ``toner`` from the file and scanning sets its Cleared at only;
 7. the general floor: add and collect keep one collected item in ``.object/work/floor.json``;
 8. wins: after a step and a close, today's ``itemsClosed`` is 1 and ``stepsDone`` is at least 1;
 9. the seams: the agent status is unavailable, a capture is 501, keep on top is 501;
10. ``git status`` lists only the files the checks changed, and the state dir holds no work file
    besides the alert history.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

from m2_acceptance import Run, changed_paths, commit, git, hunk_keys, remove_tree, snapshot
from m8_acceptance import Served
from m22_acceptance import BADGE, PRINTER, STEP_CHANGED, clean, fm_of, set_clock
from objectapp.space import Space

REPO = Path(__file__).resolve().parents[1]
FIXTURES = REPO / "backend" / "tests" / "fixtures"
DEFAULT_SPACE = FIXTURES / "space-work"
OVERLAY = FIXTURES / "space-work-m23"
MONITORING = FIXTURES / "monitoring"
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE")
NOW = "2026-11-05T10:00:00Z"

NOTE = "DailyNotes/2026-11-05.md"
WAITING = "Tasks/Waiting on Pat.md"
SCANNER_TASK = "Tasks/Scanner firmware.md"
SCANNER = "Projects/Scanner rollout.md"
FOCUS_CHANGED = "Today's note changed. Look again."
GETS = ("/work/board", "/work/focus", "/work/today", "/work/wins", "/work/alerts", "/work/agent",
        "/work/captures", "/work/floor/general", "/work/keep-on-top")


class M23:
    def __init__(self, root: Path, run: Run, state: Path, mon: Path) -> None:
        self.root, self.run, self.state, self.mon = root, run, state, mon
        self.made: set[str] = set()
        """Paths the checks changed on purpose."""

    def http(self, *a, **k):
        return self.run.http(*a, **k)

    def state_files(self) -> list[str]:
        return sorted(str(p.relative_to(self.state)) for p in self.state.rglob("*"))

    def board(self, scope: str | None = None) -> dict[str, dict]:
        code, res = self.http("GET", "/work/board", scope=scope)
        assert code == 200, (code, res)
        return {i["path"]: i for i in res["items"]}

    # 0 ---------------------------------------------------------------------------------
    def prepare(self) -> None:
        _, cur = self.http("GET", "/settings")
        code, res = self.http("PUT", "/settings", {
            "patch": {"timeZone": "UTC", "workAlertFolder": str(self.mon)},
            "baseRevision": cur["revision"],
        })
        assert code == 200, (code, res)
        self.base = git(self.root, "rev-parse", "HEAD").strip()
        print("   Time zone UTC; alert folder set to the monitoring copy")

    # 1 ---------------------------------------------------------------------------------
    def reads(self) -> None:
        print("\n1. Reads write nothing")
        before = self.state_files()
        bad = []
        for route in GETS:
            code, _ = self.http("GET", route)
            if code != 200:
                bad.append(f"{route}: {code}")
        for route, q in (("/work/board", {"scope": "all"}), ("/work/focus", {"day": "2026-11-06"})):
            code, _ = self.http("GET", route, **q)
            if code != 200:
                bad.append(f"{route} {q}: {code}")
        self.run.report(not bad, f"every M23 read answered ({len(GETS) + 2} routes)", *bad)
        self.run.report(clean(self.root), "git status clean after every read")
        self.run.report(self.state_files() == before, "state dir unchanged by the reads")
        self.run.report(not (self.root / "DailyNotes" / "2026-11-06.md").exists(),
                        "reading tomorrow's focus created no note")

    # 2 ---------------------------------------------------------------------------------
    def board_check(self) -> None:
        print("\n2. The board")
        items = self.board()
        p = items[PRINTER]
        self.run.report(p["turn"] == "approve", f"Printer turn {p['turn']}")
        w = items.get(WAITING)
        self.run.report(w is not None and bool(w["deadline"]) and any(
            b["title"] == "Pat Example" for b in w["blockedOnPeople"]),
            f"Waiting on Pat: deadline {w and w['deadline']}, blocked on {w and w['blockedOnPeople']}")
        self.run.report("activity" not in p and "fields" not in p, "the board carries no Activity or fields")
        code, res = self.http("GET", "/space")
        project = next(t for t in res["types"] if t["name"] == "Project")
        code, res = self.http("POST", "/types/project/work-fields", {"baseRevision": project["revision"]})
        self.run.report(code == 200, f"add work fields to Project: {code}")
        self.made.add(".object/types/project.json")
        s = self.board().get(SCANNER)
        task = self.board().get(SCANNER_TASK)
        self.run.report(task is not None and task.get("projectPath") == SCANNER,
                        f"Scanner firmware's projectPath: {task and task.get('projectPath')}")
        self.run.report(s is not None and s["isProject"], "Scanner rollout is on the board as a project")
        commit(self.root, "check 2")

    # 3 ---------------------------------------------------------------------------------
    def focus(self) -> None:
        print("\n3. Focus lines")
        code, f = self.http("GET", "/work/focus")
        self.run.report(code == 200 and f["notePath"] == NOTE and [ln["n"] for ln in f["lines"]] == [1, 2, 3],
                        f"3 focus lines: {[ln['text'] for ln in f['lines']]}")
        before = self.run.text(NOTE)
        raw_before = (self.root / NOTE).read_bytes()
        lines = ["Clear the jams on [[Printer jams on line 3]]", "Ship the scanner"]
        code, out = self.http("PUT", "/work/focus", {"day": "2026-11-05", "lines": lines,
                                                      "baseVersion": f["version"], "clientId": "acc"})
        if not self.run.report(code == 200, f"save: {code}", *([] if code == 200 else [str(out)])):
            return
        self.made.add(NOTE)
        after = self.run.text(NOTE)
        removed, added, _, _ = hunk_keys(self.root, NOTE, before, after)
        gone = [ln for ln in before.splitlines() if ln not in after.splitlines() and ln.strip()]
        new = [ln for ln in after.splitlines() if ln not in before.splitlines() and ln.strip()]
        ok = all(re.match(r"^\s{0,3}([-*+]|\d+[.)])\s", ln) or ln.startswith("lastUpdated:") for ln in gone + new)
        self.run.report(ok, f"only Focus list lines and lastUpdated changed: -{gone} +{new}")
        raw = (self.root / NOTE).read_bytes()
        self.run.report(raw.startswith(b"\xef\xbb\xbf") == raw_before.startswith(b"\xef\xbb\xbf")
                        and (b"\r\n" in raw) == (b"\r\n" in raw_before),
                        "BOM and line endings as before")
        self.run.report("Keep it to three." in after and "## Notes" in after, "the other text is kept")
        stale = (self.root / NOTE).read_bytes()
        code, res = self.http("PUT", "/work/focus", {"day": "2026-11-05", "lines": ["x"], "baseVersion": f["version"]})
        self.run.report(code == 409 and res.get("detail") == FOCUS_CHANGED
                        and (self.root / NOTE).read_bytes() == stale,
                        f"the old version: {code} {res.get('detail') if isinstance(res, dict) else res}")
        code, res = self.http("PUT", "/work/focus", {"day": "2026-11-06", "lines": ["Plan the week"], "baseVersion": None})
        made = res.get("notePath") if code == 200 else None
        self.run.report(code == 200 and made and (self.root / made).is_file(), f"a save for 2026-11-06 made {made}")
        if made:
            self.made.add(made)
        commit(self.root, "check 3")

    # 4 ---------------------------------------------------------------------------------
    def today(self) -> None:
        print("\n4. Today's meetings")
        code, t = self.http("GET", "/work/today")
        spans = [(m["title"], m["startLocal"], m["endLocal"]) for m in t["meetings"]] if code == 200 else t
        self.run.report(code == 200 and len(t["meetings"]) == 2 and t["nowLocal"] == "10:00",
                        f"meetings {spans}")
        times = sorted((m["startLocal"], m["endLocal"]) for m in t["meetings"])
        self.run.report(times == [("09:00", "09:30"), ("13:00", "13:30")], f"times {times}")

    # 5 ---------------------------------------------------------------------------------
    def step_action(self) -> None:
        print("\n5. A step action through M22")

        def step2() -> dict:
            code, item = self.http("GET", "/work/item", path=PRINTER)
            return item["steps"][1]

        s2 = step2()
        body = {"path": PRINTER, "stepId": s2["id"], "stepRev": s2["rev"], "action": "approve"}
        code, res = self.http("POST", "/work/step", body)
        self.run.report(code == 200 and self.board()[PRINTER]["turn"] == "agent",
                        f"approve: {code}; the board turn is {self.board()[PRINTER]['turn']}")
        self.made.add(PRINTER)
        code, res = self.http("POST", "/work/step", body)
        self.run.report(code == 409 and res.get("detail") == STEP_CHANGED,
                        f"same rev again: {code} {res.get('detail') if isinstance(res, dict) else res}")
        s2 = step2()
        code, res = self.http("POST", "/work/step", {"path": PRINTER, "stepId": s2["id"],
                                                     "stepRev": s2["rev"], "action": "reopen"})
        self.run.report(code == 200 and self.board()[PRINTER]["turn"] == "approve",
                        f"reopen (Undo): {code}; turn {self.board()[PRINTER]['turn']}")
        commit(self.root, "check 5")

    # 6 ---------------------------------------------------------------------------------
    def alerts(self) -> None:
        print("\n6. Alerts and the folder watch")
        code, out = self.http("POST", "/work/alerts/scan", {"clientId": "acc"})
        if not self.run.report(code == 200, f"scan: {code}", *([] if code == 200 else [str(out)])):
            return
        rep = out["report"]
        status = git(self.root, "status", "--porcelain", "-uall").splitlines()
        paths = sorted(ln[3:].strip().strip('"') for ln in status)
        alerts = [p for p in paths if p.startswith("Alerts/") or "alert" in p.lower()]
        self.run.report(rep["created"] == 2 and len(alerts) == 3, f"created {rep['created']}; files {alerts}")
        self.made.update(alerts)
        self.run.report(out["alerts"]["counts"] == {"Critical": 1, "Warning": 1, "Info": 0},
                        f"counts {out['alerts']['counts']}")
        texts = " ".join(self.run.text(p) for p in alerts if p.endswith(".md"))
        self.run.report("[redacted]" in texts, "the toner message holds [redacted]")
        self.run.report(any("broken.json" in e for e in rep["errors"]), f"errors {rep['errors']}")
        stale = [s["source"] for s in out["alerts"]["sources"] if s["stale"]]
        self.run.report("backup-check" in stale, f"stale sources {stale} (broken.json is unreadable, so it counts too)")
        commit(self.root, "check 6a")
        code, out = self.http("POST", "/work/alerts/scan", {})
        self.run.report(code == 200 and out["report"]["created"] == 0 and clean(self.root),
                        "a second scan writes nothing")
        src = self.mon / "printer-watch.json"
        data = json.loads(src.read_text(encoding="utf-8"))
        text = json.dumps(self.strip_toner(data))
        src.write_text(text, encoding="utf-8")
        code, out = self.http("POST", "/work/alerts/scan", {})
        changed = [ln[3:].strip().strip('"') for ln in git(self.root, "status", "--porcelain", "-uall").splitlines()]
        diff = git(self.root, "diff", "-U0")
        lines = [ln for ln in diff.splitlines() if ln[:1] in "+-" and not ln.startswith(("+++", "---"))]
        keys = {ln[1:].split(":")[0].strip() for ln in lines}
        self.run.report(code == 200 and len(changed) == 1 and keys <= {"clearedAt", "lastUpdated"} and "clearedAt" in keys,
                        f"toner removed: one file changed, keys {sorted(keys)}")
        commit(self.root, "check 6b")

    @staticmethod
    def strip_toner(data):
        if isinstance(data, dict):
            return {k: M23.strip_toner(v) for k, v in data.items() if k != "toner"}
        if isinstance(data, list):
            return [M23.strip_toner(v) for v in data if not (isinstance(v, dict) and v.get("key") == "toner")]
        return data

    # 7 ---------------------------------------------------------------------------------
    def floor(self) -> None:
        print("\n7. The general floor list")
        code, a = self.http("POST", "/work/floor/general", {"op": "add", "place": "Line 3", "what": "Photo of the panel"})
        item = a["items"][0] if code == 200 else None
        code, c = self.http("POST", "/work/floor/general", {"op": "collect", "itemId": item["id"],
                                                             "itemRev": item["rev"], "found": "E-12"})
        self.made.add(".object/work/floor.json")
        stored = json.loads((self.root / ".object" / "work" / "floor.json").read_text(encoding="utf-8"))
        items = stored["items"] if isinstance(stored, dict) else stored
        self.run.report(code == 200 and len(items) == 1 and json.dumps(items).count("2026-11-05") >= 1,
                        f"floor.json holds {len(items)} item, collected 2026-11-05")
        commit(self.root, "check 7")

    # 8 ---------------------------------------------------------------------------------
    def wins(self) -> None:
        print("\n8. Wins")
        code, item = self.http("GET", "/work/item", path=BADGE)
        s1 = item["steps"][0]
        code, res = self.http("POST", "/work/step", {"path": BADGE, "stepId": s1["id"],
                                                     "stepRev": s1["rev"], "action": "done"})
        self.run.report(code == 200, f"Badge reader's Do step done: {code}")
        code, item = self.http("GET", "/work/item", path=BADGE)
        code, res = self.http("POST", "/work/close", {"path": BADGE, "baseVersion": item["version"]})
        self.run.report(code == 200, f"close Badge reader: {code}", *([] if code == 200 else [str(res)]))
        self.made.add(BADGE)
        code, w = self.http("GET", "/work/wins")
        day = w["days"][-1]
        self.run.report(day["itemsClosed"] == 1 and day["stepsDone"] >= 1,
                        f"today: {day['stepsDone']} steps done, {day['itemsClosed']} items closed")
        commit(self.root, "check 8")

    # 9 ---------------------------------------------------------------------------------
    def seams(self) -> None:
        print("\n9. The agent and capture routes (M24 fills M23's seams)")
        code, a = self.http("GET", "/work/agent")
        carrying = sum(1 for i in self.board().values() if i["turn"] == "agent")
        self.run.report(code == 200 and a["available"] is True and a["carrying"] == carrying,
                        f"agent: available {a.get('available')}, carrying {a.get('carrying')} (board {carrying})")
        code, r = self.http("POST", "/work/captures", {"text": "x", "fromView": "now"})
        path = r.get("capture", {}).get("path") if isinstance(r, dict) else None
        self.run.report(code == 201 and path, f"capture saved: {code} {path}")
        if path:
            self.made.add(path)
            self.made.add(".object/types/capture.json")
        code, r = self.http("POST", "/work/keep-on-top", {})
        self.run.report(code == 501 and r.get("detail") == "Keep on top needs the Object window.", f"keep on top: {code} {r}")

    # 10 --------------------------------------------------------------------------------
    def git_status(self) -> None:
        print("\n10. Only the intended files changed")
        status = git(self.root, "status", "--porcelain", "-uall")
        untracked = {ln[3:].strip().strip('"') for ln in status.splitlines() if ln.startswith("??")}
        tracked = set(git(self.root, "diff", "--name-only", self.base).splitlines())
        changed = sorted((untracked | tracked) - {""})
        extra = [c for c in changed if c not in self.made]
        missing = sorted(self.made - set(changed))
        self.run.report(not extra and not missing, f"{len(changed)} files changed",
                        *([f"unexpected {extra}"] if extra else []), *([f"missing {missing}"] if missing else []))
        work = sorted(f for f in self.state_files() if "work" in f.lower() and not f.startswith(("work-alerts-", "work-queue-"))
                      and "history" not in f.lower() and not f.endswith("/"))
        work = [f for f in work if Path(self.state, f).is_file()]
        self.run.report(not work, f"no other work files in the state dir {work}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path, nargs="?", default=DEFAULT_SPACE)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m23-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    mon = tmp / "monitoring"
    shutil.copytree(MONITORING, mon)
    state = tmp / "state"
    clock = tmp / "clock.txt"
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    os.environ.update({"OBJECT_STATE_DIR": str(state), "OBJECT_CACHE_DIR": str(tmp / "cache"),
                       "OBJECT_CLOCK_FILE": str(clock)})
    set_clock(clock, NOW)
    git(root, "init", "-q")
    commit(root, "base")
    original = snapshot(root)
    Space(root)
    opened = changed_paths(original, snapshot(root))
    commit(root, "opened once")

    served: Served | None = None
    run: Run | None = None
    try:
        served = Served(root)
        run = Run(root, served.http)
        state.mkdir(parents=True, exist_ok=True)
        m23 = M23(root, run, state, mon)
        print(f"Space copy: {root}\nServed at: {served.base}")
        md = [p for p in opened if p.endswith(".md")]
        run.report(not md, f"opening wrote no .md file (opening changed {opened})")
        m23.prepare()
        m23.reads()
        m23.board_check()
        m23.focus()
        m23.today()
        m23.step_action()
        m23.alerts()
        m23.floor()
        m23.wins()
        m23.seams()
        m23.git_status()
    except Exception as exc:
        if run is not None:
            run.report(False, f"the run stopped: {exc!r}")
        raise
    finally:
        if served is not None:
            served.stop()
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
    sys.exit(main())
