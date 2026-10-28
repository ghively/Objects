"""Milestone 8 acceptance run over HTTP (plan Task 31, Step 2).

Usage: ``uv run python scripts/m8_acceptance.py SPACE [--keep] [--skip-roundtrip]``

Copies SPACE to a temporary folder (SPACE itself is never touched). Objects the checks need that
the space lacks are copied in from the synthetic ``space-m8`` fixture *before* the copy is
committed (the seeds are listed in the output; a space with no Task type also gets space-m8's
``task.json``), so the run works on any fixture and on a copy of a real export. The copy is
committed to a throw-away git repo, opened twice and served with ``create_app`` on a free
``127.0.0.1`` port. ``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR``, ``OBJECT_CLOCK_FILE``
(2026-10-27T10:00:00Z), ``OBJECT_FAKE_NOTIFY_FILE``, ``OBJECT_FAKE_OPEN_FILE`` and
``OBJECT_FAKE_TRASH_FILE`` point at temporary paths outside the copy. Over HTTP it checks:

 1. starting twice and calling every M8 read route (``/api/tasks/overdue``, ``/api/tasks/stats``,
    ``/api/calendar``, ``/api/block``, ``/api/block/references``, ``/api/history``,
    ``/api/history/version``, ``/api/search?mode=fullText``, ``/api/references``) changes no
    file (``git status`` clean) and creates nothing in the state dir but M7's ``spaces.json``
    (and M4's reminder ledger, which the scheduler keeps);
 2. recurrence (the space's time zone set to UTC through ``PUT /api/settings``): the overdue
    info and the stats of ``Water plants`` match the documented numbers; Skip, Excuse and each
    catch-up choice on copies of ``Water plants`` give the documented ``date`` and log lines
    and a diff limited to ``date``, ``status``, ``completed``, ``occurrenceLog`` and
    ``lastUpdated``; a stale action is 409; completing ``Weekly review`` ("every week on mon,
    fri") moves it to the rule's next date;
 3. the ``deadline`` reminder of ``Submit report`` fires once through ``/api/_test/tick``;
 4. history: a body save keeps one version in the state dir and none in the space; a restore
    brings the bytes back (``title``/``id`` are kept, here unchanged) and keeps the current
    state as a version; a stale restore is 409;
 5. merge: without ``confirm`` 428; with it the target has the merged values and body,
    ``Refers to source`` links the target and nothing else in it changed, the source is in
    the trash and restores byte for byte;
 6. spaces: create with ``setup: basic`` writes the Person, Meeting, Project and Book types;
    deleting the current space is 409; deleting another goes to the fake trash; with the trash
    ``unavailable`` 428, then ``permanent`` removes it;
 7. whiteboards: a board with media and web-link blocks round-trips (unknown keys kept); a
    media path outside the space and a non-http(s) URL are 422 and change nothing;
 8. the editor round trip: ``OBJECT_ROUNDTRIP_SPACE=<copy> npx vitest run
    src/editor/roundtrip.space.test.ts`` (in ``frontend/``) passes;
 9. the M1 no-edit pass over HTTP: 0 files changed.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

import uvicorn

from m2_acceptance import (
    HOST, Http, Run, _opt, changed_paths, check_migration, commit, free_port, git, remove_tree, snapshot,
)
from m7_acceptance import PNG, raw
from objectapp.appstate import state_dir
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import Registry
from objectapp.textfile import decode

REPO = Path(__file__).resolve().parents[1]
FRONTEND = REPO / "frontend"
SPACE_M8 = REPO / "backend" / "tests" / "fixtures" / "space-m8"

NOW = "2026-10-27T10:00:00Z"
AT = "2026-10-27T10:00:00Z"  # how a log line writes NOW
WATER = "Tasks/Water plants.md"
SEEDS = [
    WATER,
    "Tasks/Weekly review.md",
    "Tasks/Submit report.md",
    "Pages/Merge source.md",
    "Pages/Merge target.md",
    "Pages/Refers to source.md",
    "Pages/Source note.md",
]
# (action, catchUp, logged dates, next date): the plan's "Occurrence actions" on Water plants
# (every day, date 2026-10-24, so the 24th to the 26th are missed on the 27th).
CATCH_UP = [
    ("complete", "advanceOne", ["2026-10-24"], "2026-10-25"),
    ("complete", "catchUpBeforeNow", ["2026-10-26"], "2026-10-27"),
    ("complete", "catchUpThroughNow", ["2026-10-24", "2026-10-25", "2026-10-26"], "2026-10-27"),
    ("skip", "advanceOne", ["2026-10-24"], "2026-10-25"),
    ("skip", "catchUpBeforeNow", ["2026-10-26"], "2026-10-27"),
    ("skip", "catchUpThroughNow", ["2026-10-24", "2026-10-25", "2026-10-26"], "2026-10-27"),
    ("excuse", "advanceOne", ["2026-10-24"], "2026-10-25"),
    ("excuse", "catchUpBeforeNow", ["2026-10-26"], "2026-10-27"),
]
WORD = {"complete": "completed", "skip": "skipped", "excuse": "excused"}
ACTION_KEYS = {"date", "status", "completed", "occurrenceLog", "lastUpdated"}
BLOCK_ID = re.compile(r" \^([A-Za-z0-9][A-Za-z0-9-]*)\r?$", re.M)


# -- plumbing ------------------------------------------------------------------------------


def set_clock(path: Path, iso: str) -> None:
    path.write_text(iso, encoding="utf-8")


def wait_up(http: Http) -> None:
    for _ in range(400):
        try:
            if http("GET", "/space")[0] == 200:
                return
        except OSError:
            pass
        time.sleep(0.05)


class Served:
    """One `Space` served on a free port with the app's lifespan (watcher, scheduler, index)."""

    def __init__(self, root: Path, space: Space | None = None) -> None:
        self.space = space or Space(root)
        self.port = free_port()
        app = create_app(self.space, None, watch=True)
        self.server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=self.port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        self.base = f"http://{HOST}:{self.port}/api"
        self.http = Http(self.base)
        wait_up(self.http)

    def stop(self) -> None:
        self.server.config.app.state.hub.close()
        self.server.should_exit = True
        self.thread.join(timeout=10)


def fm_of(root: Path, rel: str) -> dict:
    return parse_fm(split_object(decode((root / rel).read_bytes()).text).frontmatter_src)


def body_of(root: Path, rel: str) -> str:
    return split_object(decode((root / rel).read_bytes()).text).body


def log_lines(root: Path, rel: str) -> list[str]:
    raw_log = fm_of(root, rel).get("occurrenceLog")
    return raw_log.split("\n") if isinstance(raw_log, str) and raw_log else []


def diff_keys(before: bytes, after: bytes) -> tuple[set[str], set[str]]:
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

    removed: set[str] = set()
    added: set[str] = set()
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if op != "equal":
            removed |= keys(a, i1, i2)
            added |= keys(b, j1, j2)
    return removed, added


def state_files() -> list[str]:
    folder = state_dir()
    return sorted(p.name for p in folder.iterdir()) if folder.is_dir() else []


def extra_state(names: list[str], allowed: set[str]) -> list[str]:
    return [n for n in names if n not in allowed and not (n.startswith("reminders-") and n.endswith(".json"))]


def type_names(root: Path) -> set[str]:
    out = set()
    for f in (root / ".capacities" / "types").glob("*.json"):
        try:
            name = json.loads(f.read_text("utf-8")).get("name")
        except (OSError, ValueError):
            continue
        if isinstance(name, str):
            out.add(name.lower())
    return out


def alias(root: Path, rel: str) -> str:
    """Where seed `rel` lives in this copy: `rel` itself unless the space has a different object
    there (only tasks are moved aside, as `<stem> (M8).md`; the merge pages keep their names)."""
    dest = root / rel
    if not rel.startswith("Tasks/") or not dest.exists() or dest.read_bytes() == (SPACE_M8 / rel).read_bytes():
        return rel
    return rel[: -len(".md")] + " (M8).md"


def seed(root: Path) -> list[str]:
    """Copy the space-m8 objects the checks need into the copy (only those it lacks)."""
    added = []
    if "task" not in type_names(root):
        dest = root / ".capacities" / "types" / "task.json"
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SPACE_M8 / ".capacities" / "types" / "task.json", dest)
            added.append(".capacities/types/task.json")
    for rel in SEEDS:
        dest = root / alias(root, rel)
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            text = (SPACE_M8 / rel).read_bytes()
            if dest != root / rel:  # the space has its own object by that name: retitle ours
                stem = dest.stem
                text = re.sub(rb"(?m)^title: .*$", f"title: {stem}".encode(), text, count=1)
                text = re.sub(rb"(?m)^id: .*$", b"id: 01JC8M8ACCEPTANCEALIAS" + str(SEEDS.index(rel)).zfill(3).encode(),
                              text, count=1)
            dest.write_bytes(text)
            added.append(dest.relative_to(root).as_posix())
    # Copies of Water plants for the catch-up cases (one file each, unique id and title).
    src = (root / alias(root, WATER)).read_text("utf-8")
    for i, _case in enumerate(CATCH_UP, 1):
        rel = f"Tasks/Water plants c{i}.md"
        text = re.sub(r"(?m)^id: .*$", f"id: 01JC8M8ACCEPTANCE000000{i:03d}", src, count=1)
        text = re.sub(r"(?m)^title: .*$", f"title: Water plants c{i}", text, count=1)
        (root / rel).write_text(text, encoding="utf-8", newline="")
        added.append(rel)
    return added


def block_ref(root: Path) -> tuple[str, str] | None:
    """(path, id) of the first `.md` holding a `^id` block id (Source note's when seeded)."""
    preferred = root / "Pages/Source note.md"
    files = [preferred, *sorted(root.rglob("*.md"))]
    for f in files:
        rel = f.relative_to(root)
        if rel.parts[0].startswith(".") or not f.is_file():
            continue
        m = BLOCK_ID.search(f.read_bytes().decode("utf-8", "replace"))
        if m:
            return rel.as_posix(), m.group(1)
    return None


# -- checks --------------------------------------------------------------------------------


class M8:
    def __init__(self, root: Path, run: Run, tmp: Path, clock: Path, notify: Path) -> None:
        self.root = root
        self.run = run
        self.tmp = tmp
        self.clock = clock
        self.notify = notify
        self.water = alias(root, WATER)
        self.weekly = alias(root, "Tasks/Weekly review.md")
        self.report_task = alias(root, "Tasks/Submit report.md")
        self.done_text = "Done"
        self.reset_text = "Not Started"

    def prepare_task_type(self) -> None:
        """Make the space's Task type able to run the checks, the way its settings would.

        A status with no done option gets "Done" (as M4's acceptance does), and a ``deadline``
        without "supports reminders" gets it turned on. Each change is one `PUT /api/types/{id}`
        and is printed.
        """
        t = self.run.type_named("Task")
        assert t is not None, "the space has no Task type"
        changed = []
        sdef = next((d for d in t["propertyDefinitions"] if d["type"] == "label"
                     and ((d.get("options") or {}).get("isStatus") or d["key"] == "status")), None)
        if sdef is not None:
            if not isinstance(sdef.get("options"), dict):
                sdef["options"] = {}
            opts = sdef["options"].get("set")
            if not isinstance(opts, list):
                opts = sdef["options"]["set"] = []
            done = [o for o in opts if o.get("statusCategory") == "done"]
            if not done:
                opts.append({**_opt("Done"), "color": "green", "statusCategory": "done"})
                done = opts[-1:]
                changed.append("status: added a 'Done' option")
            self.done_text = done[0]["text"]
            first = next((o for o in opts if o.get("statusCategory") == "not-started"), None)
            if first is not None:
                self.reset_text = first["text"]
        ddef = next((d for d in t["propertyDefinitions"] if d["key"] == "deadline"), None)
        if ddef is not None:
            if not isinstance(ddef.get("options"), dict):
                ddef["options"] = {}
            cons = ddef["options"].setdefault("constraints", {})
            if not cons.get("supportsReminders"):
                cons["supportsReminders"] = True
                changed.append("deadline: turned on 'supports reminders'")
        if changed:
            code, res = self.run.save_type(t, confirm=True)
            assert code == 200, (code, res)
            commit(self.root, "task type prepared")
        print("   Task type:", "; ".join(changed) if changed else "nothing to prepare",
              f"(done option {self.done_text!r}, reset to {self.reset_text!r})")

    @property
    def http(self) -> Http:
        return self.run.http

    def version(self, rel: str) -> str:
        return self.run.obj(rel)["version"]

    # 1 ---------------------------------------------------------------------------------
    def reads(self, label: str) -> None:
        before = snapshot(self.root)
        state_before = state_files()
        ref = block_ref(self.root)
        codes: dict[str, set[int]] = {}

        def call(name: str, route: str, **q: Any) -> None:
            codes.setdefault(name, set()).add(self.http("GET", route, **q)[0])

        for _ in range(2):
            call("/tasks/overdue", "/tasks/overdue", path=self.water)
            call("/tasks/stats", "/tasks/stats", path=self.water)
            call("/calendar", "/calendar", **{"from": "2026-10-20", "to": "2026-11-03"})
            if ref:
                call("/block", "/block", path=ref[0], id=ref[1])
                call("/block/references", "/block/references", path=ref[0], id=ref[1])
            call("/history", "/history", path=self.water)
            call("/history/version (none yet: 404)", "/history/version", path=self.water, id="20261027T100000Z")
            call("/search fullText", "/search", q="paragraph", mode="fullText")
            call("/references", "/references", path="Pages/Merge source.md")
        time.sleep(0.4)
        diff = changed_paths(before, snapshot(self.root))
        status = git(self.root, "status", "--porcelain", "-uall").strip()
        names = state_files()
        extra = extra_state(names, {"spaces.json"})
        bad = {k: sorted(v) for k, v in codes.items() if v != ({404} if "404" in k else {200})}
        self.run.report(
            not diff and not status and not extra and not bad and bool(ref),
            f"{label}: {len(codes)} routes read twice (block {ref}); statuses {bad or 'as expected'}; "
            f"{len(diff)} files changed; state dir {state_before} -> {names}",
            *diff, *([status] if status else []), *extra,
        )

    # 2 ---------------------------------------------------------------------------------
    def recurrence(self) -> None:
        print("\n2. Recurrence: overdue, stats, Skip, Excuse, catch-up, custom rule")
        _, cur = self.http("GET", "/settings")
        code, res = self.http("PUT", "/settings", {"patch": {"timeZone": "UTC"}, "baseRevision": cur["revision"]})
        self.run.report(code == 200 and not git(self.root, "status", "--porcelain", "-uall").strip(),
                        f"time zone set to UTC through PUT /api/settings: {code}; space unchanged")

        code, info = self.http("GET", "/tasks/overdue", path=self.water)
        want = {"count": 3, "capped": False, "missed": ["2026-10-24", "2026-10-25", "2026-10-26"],
                "current": {"start": "2026-10-24", "resolution": "day"}, "today": "2026-10-27"}
        self.run.report(code == 200 and info == want, f"overdue: {code} {info}")

        code, s = self.http("GET", "/tasks/stats", path=self.water)
        if code == 200:
            cells = s["cells"]
            by_day = {c["scheduled"]: c["state"] for c in cells}
            got = (s["unit"], s["currentStreak"], s["bestStreak"], s["completions"], round(s["completionRate"], 6),
                   s["atRisk"], len(cells), [by_day.get(f"2026-10-{d}") for d in range(21, 28)])
        else:
            got = (code, s)
        exp = ("day", 0, 1, 2, round(2 / 26, 6), False, 30,
               ["completed", "skipped", "completed", "missed", "missed", "missed", "future"])
        self.run.report(got == exp, f"stats: {got}")

        problems = []
        for i, (action, catch_up, dates, nxt) in enumerate(CATCH_UP, 1):
            rel = f"Tasks/Water plants c{i}.md"
            old = log_lines(self.root, rel)
            before = (self.root / rel).read_bytes()
            snap = snapshot(self.root)
            code, res = self.http("POST", "/tasks/occurrence", {"path": rel, "action": action, "catchUp": catch_up,
                                                                "baseVersion": self.version(rel)})
            fm = fm_of(self.root, rel)
            lines = log_lines(self.root, rel)
            removed, added = diff_keys(before, (self.root / rel).read_bytes())
            changed = changed_paths(snap, snapshot(self.root))
            ok = (code == 200 and fm.get("date") == nxt and lines == [*old, *(f"{d} {WORD[action]} {AT}" for d in dates)]
                  and fm.get("status") == self.reset_text and ("completed" in fm) == (action == "complete")
                  and removed <= ACTION_KEYS and added <= ACTION_KEYS and changed == [rel])
            if not ok:
                problems.append(f"{action}/{catch_up}: {code} date {fm.get('date')} (want {nxt}); "
                                f"new lines {lines[len(old):]}; keys -{sorted(removed)} +{sorted(added)}; files {changed}")
        self.run.report(not problems, f"{len(CATCH_UP)} Skip/Excuse/complete catch-up cases: dates, log lines, "
                        "diff limited to the action's keys", *problems)
        commit(self.root, "occurrence actions")

        water = self.water
        before = (self.root / water).read_bytes()
        code, _ = self.http("POST", "/tasks/occurrence", {"path": water, "action": "skip", "baseVersion": "stale"})
        code2, _ = self.http("POST", "/tasks/occurrence", {"path": water, "action": "excuse",
                                                           "catchUp": "catchUpThroughNow", "baseVersion": self.version(water)})
        self.run.report(code == 409 and code2 == 422 and (self.root / water).read_bytes() == before,
                        f"stale action {code}; excuse with catchUpThroughNow {code2}; file unchanged")

        rel = self.weekly
        o = self.run.obj(rel)
        before = (self.root / rel).read_bytes()
        code, res = self.http("PUT", "/object/properties", {"path": rel, "updates": {"status": [self.done_text]},
                                                           "baseVersion": o["version"]})
        fm = fm_of(self.root, rel)
        removed, added = diff_keys(before, (self.root / rel).read_bytes())
        self.run.report(
            code == 200 and fm.get("date") == "2026-11-02" and fm.get("status") == self.reset_text
            and log_lines(self.root, rel)[-1:] == [f"2026-10-30 completed {AT}"]
            and removed <= ACTION_KEYS and added <= ACTION_KEYS,
            f"'every week on mon, fri' from 2026-10-30 completes to {fm.get('date')} (want 2026-11-02); "
            f"keys -{sorted(removed)} +{sorted(added)}",
        )
        commit(self.root, "weekly review")

    # 3 ---------------------------------------------------------------------------------
    def notifications(self, title: str) -> int:
        if not self.notify.exists():
            return 0
        rows = [json.loads(x) for x in self.notify.read_text("utf-8").splitlines() if x.strip()]
        return sum(1 for n in rows if n.get("title") == title)

    def reminder(self) -> None:
        print("\n3. A deadline reminder")
        title = fm_of(self.root, self.report_task).get("title", "Submit report")
        before = self.notifications(title)
        set_clock(self.clock, "2026-10-28T08:59:00Z")
        self.http("POST", "/_test/tick")
        early = self.notifications(title)
        set_clock(self.clock, "2026-10-28T09:00:30Z")
        code, _ = self.http("POST", "/_test/tick")
        code2, _ = self.http("POST", "/_test/tick")
        fired = self.notifications(title)
        status = git(self.root, "status", "--porcelain", "-uall").strip()
        self.run.report(code == 200 and code2 == 200 and before == 0 and early == 0 and fired == 1 and not status,
                        f"'1 day before at 09:00' on deadline 2026-10-29: none at 08:59 ({early}), one at 09:00:30 "
                        f"({fired}), a second tick adds none; space clean {not status}")
        set_clock(self.clock, NOW)

    # 4 ---------------------------------------------------------------------------------
    def history(self) -> None:
        print("\n4. Version history")
        rel = "Pages/Source note.md"
        original = (self.root / rel).read_bytes()
        o = self.run.obj(rel)
        snap = snapshot(self.root)
        code, res = self.http("PUT", "/object/body", {"path": rel, "body": o["body"].rstrip("\n") + "\n\nM8 history probe.\n",
                                                     "baseVersion": o["version"]})
        changed = changed_paths(snap, snapshot(self.root))
        _, hist = self.http("GET", "/history", path=rel)
        versions = hist.get("versions", []) if isinstance(hist, dict) else []
        hist_dir = state_dir() / "history"
        stored = [p for p in hist_dir.rglob("*") if p.is_file()] if hist_dir.is_dir() else []
        in_space = [p for p in changed if "history" in p.lower()]
        self.run.report(code == 200 and len(versions) == 1 and changed == [rel] and bool(stored) and not in_space,
                        f"body save {code}: {len(versions)} version, {len(stored)} files under the state dir's "
                        f"history/, space changes {changed}")
        commit(self.root, "history probe")
        vid = versions[0]["id"] if versions else ""
        code, content = self.http("GET", "/history/version", path=rel, id=vid)
        self.run.report(code == 200 and isinstance(content, dict) and content.get("text") is not None
                        and "M8 history probe." not in content["text"], f"version text: {code}")
        stale = self.version(rel)
        code, res = self.http("POST", "/history/restore", {"path": rel, "id": vid, "baseVersion": stale})
        restored = (self.root / rel).read_bytes()
        _, hist = self.http("GET", "/history", path=rel)
        n_after = len(hist.get("versions", [])) if isinstance(hist, dict) else 0
        self.run.report(code == 200 and restored == original and n_after == 2,
                        f"restore {code}: bytes back {restored == original}; versions now {n_after} "
                        "(the current state kept first)")
        commit(self.root, "restored")
        code, _ = self.http("POST", "/history/restore", {"path": rel, "id": vid, "baseVersion": stale})
        self.run.report(code == 409 and (self.root / rel).read_bytes() == restored, f"stale restore: {code}")

    # 5 ---------------------------------------------------------------------------------
    def merge(self) -> None:
        print("\n5. Merge")
        src, tgt, ref = "Pages/Merge source.md", "Pages/Merge target.md", "Pages/Refers to source.md"
        src_bytes = (self.root / src).read_bytes()
        ref_before = (self.root / ref).read_bytes()
        body = {"source": src, "target": tgt, "sourceVersion": self.version(src), "targetVersion": self.version(tgt)}
        snap = snapshot(self.root)
        code, _ = self.http("POST", "/object/merge", body)
        self.run.report(code == 428 and not changed_paths(snap, snapshot(self.root)), f"without confirm: {code}")
        code, res = self.http("POST", "/object/merge", {**body, "confirm": True})
        fm = fm_of(self.root, tgt) if (self.root / tgt).is_file() else {}
        tbody = body_of(self.root, tgt) if (self.root / tgt).is_file() else ""
        tags = [str(t) for t in fm.get("tags") or []]
        aliases = [str(a) for a in fm.get("aliases") or []]
        ok_values = (fm.get("description") == "Target summary" and tags[:2] == ["Old tag", "New tag"]
                     and aliases == ["Target alias", "Source alias"]
                     and tbody.rstrip("\n").endswith("Target body paragraph.\n\nSource body paragraph."))
        self.run.report(code == 200 and ok_values and not (self.root / src).exists(),
                        f"merge {code}: description {fm.get('description')!r}, tags {tags}, aliases {aliases}, "
                        f"body appended {tbody.rstrip().endswith('Source body paragraph.')}; "
                        f"dropped {res.get('dropped') if isinstance(res, dict) else res}")
        new = (self.root / ref).read_bytes().decode("utf-8").splitlines()
        old = ref_before.decode("utf-8").splitlines()
        stray = [f"{a!r} -> {b!r}" for a, b in zip(old, new, strict=False)
                 if a != b and not a.startswith("lastUpdated:") and b.replace("Merge target", "Merge source") != a]
        self.run.report(len(old) == len(new) and not stray and "[[Merge target]]" in "\n".join(new)
                        and "Merge source" not in "\n".join(new),
                        f"'Refers to source' relinked to the target, nothing else changed "
                        f"(relinked: {res.get('relinked') if isinstance(res, dict) else '?'})", *stray)
        trash_id = res.get("trashId") if isinstance(res, dict) else None
        _, trash = self.http("GET", "/trash")
        listed = any(isinstance(t, dict) and t.get("id") == trash_id for t in trash or [])
        commit(self.root, "merged")
        code, _ = self.http("POST", f"/trash/{trash_id}/restore")
        back = (self.root / src).read_bytes() if (self.root / src).is_file() else b""
        self.run.report(listed and code == 200 and back == src_bytes,
                        f"source in the trash ({listed}); restore {code}; bytes identical {back == src_bytes}")
        commit(self.root, "merge source restored")

    # 6 ---------------------------------------------------------------------------------
    def spaces(self, served_root: Path) -> None:
        print("\n6. Spaces: basic setup and deleting a space folder")
        location = self.tmp / "m8-spaces"
        location.mkdir(exist_ok=True)
        code, res = self.http("POST", "/spaces", {"name": "M8 basic", "location": str(location), "setup": "basic"})
        folder = Path(res.get("path", "")) if isinstance(res, dict) else Path()
        names = type_names(folder) if code == 201 else set()
        self.run.report(code == 201 and {"person", "meeting", "project", "book"} <= names,
                        f"create with setup 'basic': {code}; types {sorted(names)}")
        code, _ = self.http("POST", "/spaces/delete", {"path": str(served_root)})
        self.run.report(code == 409 and served_root.is_dir(), f"deleting the current space: {code}")
        fake = Path(os.environ["OBJECT_FAKE_TRASH_FILE"])
        code, res = self.http("POST", "/spaces/delete", {"path": str(folder)})
        recorded = fake.read_text("utf-8").splitlines() if fake.is_file() else []
        _, listed = self.http("GET", "/spaces")
        still = str(folder) in [e["path"] for e in listed["spaces"]]
        self.run.report(code == 200 and res == {"trashed": True} and not folder.exists() and str(folder) in recorded
                        and not still, f"delete another: {code} {res}; folder gone {not folder.exists()}; "
                        f"fake trash {recorded}; left the registry {not still}")
        code, res = self.http("POST", "/spaces", {"name": "M8 doomed", "location": str(location)})
        doomed = Path(res.get("path", "")) if isinstance(res, dict) else Path()
        saved = os.environ["OBJECT_FAKE_TRASH_FILE"]
        os.environ["OBJECT_FAKE_TRASH_FILE"] = "unavailable"
        try:
            code1, _ = self.http("POST", "/spaces/delete", {"path": str(doomed)})
            kept = doomed.is_dir()
            code2, res2 = self.http("POST", "/spaces/delete", {"path": str(doomed), "permanent": True})
        finally:
            os.environ["OBJECT_FAKE_TRASH_FILE"] = saved
        self.run.report(code == 201 and code1 == 428 and kept and code2 == 200 and res2 == {"trashed": False}
                        and not doomed.exists(),
                        f"trash unavailable: {code1} (folder kept {kept}); permanent: {code2} {res2}, "
                        f"folder gone {not doomed.exists()}")
        self.run.report(not git(self.root, "status", "--porcelain", "-uall").strip(), "the served space is unchanged")

    # 7 ---------------------------------------------------------------------------------
    def whiteboards(self, base: str) -> None:
        print("\n7. Whiteboards: media and web-link blocks")
        code, _h, body = raw(base, "POST", "/attachments", PNG, {"Content-Type": "application/octet-stream"},
                             name="m8 pixel.png")
        media = json.loads(body).get("path") if code == 201 else "Attachments/m8 pixel.png"
        code, res = self.http("POST", "/whiteboards", {"title": "M8 media board"})
        path = res.get("path") if isinstance(res, dict) else None
        commit(self.root, "board created")
        _, cur = self.http("GET", "/whiteboard", path=path)
        board = cur["board"]
        board.setdefault("nodes", {})
        board.setdefault("blocks", {})
        board["blocks"].update({
            "m8-media": {"type": "media", "path": media, "x-m8-future": {"kept": True}},
            "m8-link": {"type": "weblink", "url": "https://example.com/m8", "title": "Example"},
        })
        for i, bid in enumerate(("m8-media", "m8-link")):
            board["nodes"][f"n-{bid}"] = {"id": f"n-{bid}", "kind": "block", "position": {"x": 300 * i, "y": 0},
                                          "width": 240, "height": 160, "z": 10 + i, "blockId": bid}
        code, saved = self.http("PUT", "/whiteboard", {"path": path, "board": board, "baseRevision": cur["revision"]})
        _, again = self.http("GET", "/whiteboard", path=path)
        blocks = again["board"].get("blocks", {})
        ok = (code == 200 and blocks.get("m8-media") == board["blocks"]["m8-media"]
              and blocks.get("m8-link") == board["blocks"]["m8-link"])
        self.run.report(ok, f"save {code}; media and web-link blocks read back equal (unknown key kept)")
        commit(self.root, "board saved")
        snap = snapshot(self.root)
        bad = json.loads(json.dumps(again["board"]))
        bad["blocks"]["m8-media"]["path"] = "../outside.png"
        code1, _ = self.http("PUT", "/whiteboard", {"path": path, "board": bad, "baseRevision": again["revision"]})
        bad2 = json.loads(json.dumps(again["board"]))
        bad2["blocks"]["m8-link"]["url"] = "file:///etc/passwd"
        code2, _ = self.http("PUT", "/whiteboard", {"path": path, "board": bad2, "baseRevision": again["revision"]})
        self.run.report(code1 == 422 and code2 == 422 and not changed_paths(snap, snapshot(self.root)),
                        f"media path outside the space {code1}; non-http(s) URL {code2}; nothing changed")

    # 8 ---------------------------------------------------------------------------------
    def roundtrip(self) -> None:
        print("\n8. Editor round trip (roundtrip.space.test.ts)")
        before = snapshot(self.root)
        npx = shutil.which("npx") or "npx"
        proc = subprocess.run(
            [npx, "vitest", "run", "src/editor/roundtrip.space.test.ts"],
            cwd=FRONTEND, env={**os.environ, "OBJECT_ROUNDTRIP_SPACE": str(self.root)},
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        out = proc.stdout + proc.stderr
        tail = [ln for ln in out.splitlines() if "Tests" in ln or "differ" in ln or "FAIL" in ln][-8:]
        summary = [ln for ln in out.splitlines() if ln.strip().startswith("Tests")]
        ran = bool(summary) and "passed" in summary[-1] and "failed" not in summary[-1] and "skipped" not in summary[-1]
        self.run.report(proc.returncode == 0 and ran and not changed_paths(before, snapshot(self.root)),
                        f"vitest exit {proc.returncode}", *tail)

    # 9 ---------------------------------------------------------------------------------
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
                        f"{len(objs)} objects, statuses {statuses}, {len(diff)} files changed", *diff)


# -- main ----------------------------------------------------------------------------------

HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE", "OBJECT_FAKE_NOTIFY_FILE",
         "OBJECT_FAKE_OPEN_FILE", "OBJECT_FAKE_TRASH_FILE")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    ap.add_argument("--skip-roundtrip", action="store_true", help="skip check 8 (needs frontend/node_modules)")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m8-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".capacities-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    clock = tmp / "clock.txt"
    notify = tmp / "notifications.jsonl"
    os.environ.update({
        "OBJECT_STATE_DIR": str(tmp / "state"),
        "OBJECT_CACHE_DIR": str(tmp / "cache"),
        "OBJECT_CLOCK_FILE": str(clock),
        "OBJECT_FAKE_NOTIFY_FILE": str(notify),
        "OBJECT_FAKE_OPEN_FILE": str(tmp / "opened.txt"),
        "OBJECT_FAKE_TRASH_FILE": str(tmp / "trashed.txt"),
    })
    set_clock(clock, NOW)
    seeded = seed(root)
    git(root, "init", "-q")
    commit(root, "base")
    original = snapshot(root)

    served: Served | None = None
    run: Run | None = None
    try:
        space, mig = check_migration(root, original)
        Registry(state_dir()).register(root)  # what the launcher does before serving
        served = Served(root, space)
        run = Run(root, served.http)
        m8 = M8(root, run, tmp, clock, notify)
        print(f"Space copy: {root}")
        print(f"Seeded from space-m8: {len(seeded)} files", *[f"  {s}" for s in seeded], sep="\n   ")
        print(f"\n0. Opening twice: {mig[0]}", *mig[1:], sep="\n   ")
        run.failures += mig[0] != "ok"
        m8.prepare_task_type()

        print("\n1. Reading every M8 route writes nothing")
        m8.reads("first start")
        served.stop()
        served = Served(root)
        run.http = served.http
        m8.reads("second start")

        m8.recurrence()
        m8.reminder()
        m8.history()
        m8.merge()
        m8.spaces(root)
        m8.whiteboards(served.base)
        if args.skip_roundtrip:
            print("\n8. Editor round trip: skipped (--skip-roundtrip)")
        else:
            m8.roundtrip()
        m8.no_edit()
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
