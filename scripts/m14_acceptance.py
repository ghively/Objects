"""Milestone 14 acceptance run over HTTP (local automations).

Usage: ``uv run python scripts/m14_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo, opens it twice and serves it with ``create_app`` (watcher on) on a free
``127.0.0.1`` port. ``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR``, ``OBJECT_CLOCK_FILE`` (starting
2026-11-02T08:00:00Z, a Monday) and ``OBJECT_FAKE_NOTIFY_FILE`` point at temporary paths
outside the copy; the space's time zone is set to UTC through ``PUT /api/settings``. The
run makes a type "M14 Chore" with a "Stage" label (To do, Done) and a day-resolution
"Done on" date (``POST /api/types``, ``PUT /api/types/{id}``). Over HTTP it checks:

 1. listing the rules, the catch-up and a schedule tick on a space with no rules write
    nothing (``git status`` clean, no automation state);
 2. "Stage changes to Done -> set Done on to today" (on a type the run makes, since basic
    types take no new properties): the edit stamps the day, the diff is limited to the
    edited key and the stamp, and the run is logged;
 3. "a Task is created -> add a tag, append a line to the daily note": both happen, the
    daily note is made for the day;
 4. a button rule run on a Task (clears Done on) works; on a Page it is 422;
 5. a weekly template repeat (every Monday 09:00) runs at its time once (the clock moves
    past 09:00 in steps a running app would see);
 6. the app is stopped, the clock moves three weeks on and the app starts again: the
    catch-up lists the three missed Mondays and nothing has run; "Run all" makes three
    objects titled by their own Mondays and empties the list;
 7. an external edit of a matching file (status to Done) and an external new Task file
    trigger nothing (the watcher sees both);
 8. no rule's write triggered another rule (rules watching the stamp and the tags never ran);
 9. ``git status`` shows only the intended files: the rule files, the template, the type
    files, the objects the checks and the rules made, and the daily note; the state lives in
    the state dir.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

import uvicorn
from m2_acceptance import (
    HOST,
    Http,
    Run,
    _def,
    _opt,
    changed_paths,
    check_migration,
    commit,
    free_port,
    git,
    hunk_keys,
    remove_tree,
    snapshot,
)
from objectapp.appstate import space_key, state_dir
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import Registry
from objectapp.textfile import decode

NOW = "2026-11-02T08:00:00Z"  # a Monday
TODAY = "2026-11-02"
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE", "OBJECT_FAKE_NOTIFY_FILE")


# -- plumbing ------------------------------------------------------------------------------


def set_clock(path: Path, iso: str) -> None:
    """Replace the clock file atomically (a half-written file reads as the system clock)."""
    tmp = path.with_suffix(".tmp")
    tmp.write_text(iso, encoding="utf-8")
    os.replace(tmp, path)


def wait_up(http: Http) -> None:
    for _ in range(400):
        try:
            if http("GET", "/space")[0] == 200:
                return
        except OSError:
            pass
        time.sleep(0.05)


class Served:
    """One `Space` served on a free port with the app's lifespan (watcher, schedulers, engine)."""

    def __init__(self, root: Path, space: Space | None = None) -> None:
        self.space = space or Space(root)
        self.port = free_port()
        app = create_app(self.space, None, watch=True)
        self.server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=self.port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        self.http = Http(f"http://{HOST}:{self.port}/api")
        wait_up(self.http)

    def stop(self) -> None:
        self.server.config.app.state.hub.close()
        self.server.should_exit = True
        self.thread.join(timeout=15)


def fm_of(root: Path, rel: str) -> dict:
    return parse_fm(split_object(decode((root / rel).read_bytes()).text).frontmatter_src or "")


def automation_state() -> list[str]:
    folder = state_dir()
    if not folder.is_dir():
        return []
    return sorted(p.name for p in folder.iterdir() if p.name.startswith("automation"))


# -- checks --------------------------------------------------------------------------------


class M14:
    def __init__(self, root: Path, run: Run, clock: Path) -> None:
        self.root = root
        self.run = run
        self.clock = clock
        self.task_id = "task"
        self.done_id = ""
        self.made: set[str] = set()
        """Paths the checks and the rules made or edited on purpose."""
        self.rules: dict[str, str] = {}

    @property
    def http(self) -> Http:
        return self.run.http

    def idle(self) -> None:
        code, res = self.http("POST", "/_test/automations/idle")
        assert code == 200 and res == {"idle": True}, (code, res)

    def rule(self, name: str, body: dict[str, Any]) -> str:
        code, res = self.http("POST", "/automations", {"rule": {"name": name, **body}})
        assert code == 201, (name, code, res)
        self.rules[name] = res["id"]
        self.made.add(f".object/automations/{res['id']}.json")
        return res["id"]

    def runs(self, name: str) -> list[dict]:
        code, res = self.http("GET", f"/automations/{self.rules[name]}/runs")
        assert code == 200, (code, res)
        return res["runs"]

    def props(self, rel: str, updates: dict[str, Any]) -> None:
        version = self.run.obj(rel)["version"]
        code, res = self.http("PUT", "/object/properties", {"path": rel, "updates": updates, "baseVersion": version})
        assert code == 200, (code, res)

    def create(self, type_id: str, title: str) -> str:
        code, res = self.http("POST", "/objects", {"typeId": type_id, "title": title})
        assert code == 201, (code, res)
        self.made.add(res["path"])
        return res["path"]

    # 0 ---------------------------------------------------------------------------------
    def prepare(self) -> None:
        _, cur = self.http("GET", "/settings")
        code, res = self.http("PUT", "/settings", {"patch": {"timeZone": "UTC"}, "baseRevision": cur["revision"]})
        assert code == 200, (code, res)
        t = self.run.type_named("Task")
        assert t is not None, "the space has no Task type"
        self.task_id = t["id"]
        # Basic types take no new properties, so the stamp check runs on a type of our own
        # with a "Stage" label (To do / Done) and a day-resolution "Done on" date.
        code, chore = self.http("POST", "/types", {"name": "M14 Chore", "pluralName": "M14 Chores"})
        assert code == 201, (code, chore)
        self.chore_id = chore["id"]
        todo, done = _opt("To do"), {**_opt("Done"), "color": "green"}
        chore["propertyDefinitions"] += [
            _def("stage", "Stage", "label", {"set": [todo, done]}),
            _def("doneOn", "Done on", "datetime", {"constraints": {"resolutionPreference": "day"}}),
        ]
        code, res = self.run.save_type(chore, confirm=True)
        assert code == 200, (code, res)
        self.done_id, self.done_text = done["id"], done["text"]
        commit(self.root, "types prepared")
        self.base = git(self.root, "rev-parse", "HEAD").strip()
        print(f"   Made the type 'M14 Chore' ({self.chore_id}) with Stage (To do, Done) and Done on (by day)")

    # 1 ---------------------------------------------------------------------------------
    def reads(self) -> None:
        print("\n1. Reading the rules and a tick on a space with none write nothing")
        before = snapshot(self.root)
        codes = {
            "list": self.http("GET", "/automations")[0],
            "catch-up": self.http("GET", "/automations/catch-up")[0],
            "tick": self.http("POST", "/_test/tick")[0],
        }
        diff = changed_paths(before, snapshot(self.root))
        status = git(self.root, "status", "--porcelain", "-uall").strip()
        state = automation_state()
        self.run.report(set(codes.values()) == {200} and not diff and not status and not state,
                        f"codes {codes}, {len(diff)} files changed, automation state {state}", *diff)

    # set-up for 8: rules that must never run, made before anything else happens
    def watchers(self) -> None:
        scope = {"kind": "type", "id": self.task_id}
        self.rule("M14 watches Done on", {
            "trigger": {"kind": "propertyChanged", "scope": {"kind": "type", "id": self.chore_id},
                        "propertyKey": "doneOn", "to": None},
            "actions": [{"kind": "notify", "title": "", "body": "Done on changed on {title}"}],
        })
        self.rule("M14 watches tags", {
            "trigger": {"kind": "propertyChanged", "scope": scope, "propertyKey": "tags", "to": None},
            "actions": [{"kind": "appendToDailyNote", "text": "- tags changed on {link}"}],
        })

    # 2 ---------------------------------------------------------------------------------
    def stamp(self) -> None:
        print("\n2. Stage changes to Done: Done on is set to today")
        scope = {"kind": "type", "id": self.chore_id}
        self.rule("M14 stamp", {
            "trigger": {"kind": "propertyChanged", "scope": scope, "propertyKey": "stage",
                        "to": {"type": "filter", "propertyId": "stage", "option": "contains",
                               "referenceValue": [self.done_id]}},
            "actions": [{"kind": "setProperty", "key": "doneOn", "now": True}],
        })  # fmt: skip
        self.task = self.create(self.chore_id, "M14 report")
        self.idle()
        commit(self.root, "report task")
        before = (self.root / self.task).read_bytes().decode("utf-8")
        self.props(self.task, {"stage": self.done_text})
        self.idle()
        after = (self.root / self.task).read_bytes().decode("utf-8")
        removed, added, _, _ = hunk_keys(self.root, self.task, before, after)
        allowed = {"stage", "doneOn", "lastUpdated"}
        runs = self.runs("M14 stamp")
        self.run.report(
            fm_of(self.root, self.task).get("doneOn") == TODAY and (removed | added) <= allowed
            and len(runs) == 1 and runs[0]["status"] == "ok",
            f"doneOn {fm_of(self.root, self.task).get('doneOn')!r}, changed keys {sorted(removed | added)}, "
            f"{len(runs)} run(s)",
        )

    # 3 ---------------------------------------------------------------------------------
    def creation(self) -> None:
        print("\n3. A Task is created: a tag is added and the daily note gets a line")
        code, res = self.http("POST", "/tags/ensure", {"name": "M14 new"})
        assert code == 200, (code, res)
        tag_path = res["path"]
        self.made.add(tag_path)
        tag = self.run.obj(tag_path)["summary"]
        self.rule("M14 on create", {
            "trigger": {"kind": "objectCreated", "scope": {"kind": "type", "id": self.task_id}},
            "actions": [
                {"kind": "addTag", "tagId": tag["id"]},
                {"kind": "appendToDailyNote", "text": "- Created {link} on {date:YYYY-MM-DD}"},
            ],
        })
        made = self.create(self.task_id, "M14 created")
        self.idle()
        runs = self.runs("M14 on create")
        note = runs[0]["actions"][1]["path"] if runs and runs[0]["actions"][1]["path"] else ""
        if note:
            self.made.add(note)
        tags = fm_of(self.root, made).get("tags") or []
        text = (self.root / note).read_bytes().decode("utf-8") if note else ""
        self.run.report(
            len(runs) == 1 and runs[0]["status"] == "ok" and tag["title"] in tags
            and f"- Created [[M14 created]] on {TODAY}" in text and TODAY in note,
            f"tags {tags}, daily note {note!r}, run {runs[0]['status'] if runs else None}",
        )

    # 4 ---------------------------------------------------------------------------------
    def button(self) -> None:
        print("\n4. A button rule runs on one object")
        rid = self.rule("M14 button", {
            "trigger": {"kind": "button", "scope": {"kind": "type", "id": self.chore_id}},
            "actions": [{"kind": "clearProperty", "key": "doneOn"}],
        })
        code, run = self.http("POST", f"/automations/{rid}/run", {"path": self.task})
        cleared = "doneOn" not in fm_of(self.root, self.task) or fm_of(self.root, self.task)["doneOn"] in (None, "")
        page = self.create("page", "M14 page") if self.run.type_named("Page") else None
        page_code = self.http("POST", f"/automations/{rid}/run", {"path": page})[0] if page else 422
        self.run.report(code == 200 and run["status"] == "ok" and cleared and page_code == 422,
                        f"run {code} {run.get('status') if isinstance(run, dict) else run}, Done on cleared "
                        f"{cleared}, on a Page {page_code}")

    # 5 ---------------------------------------------------------------------------------
    def weekly(self) -> None:
        print("\n5. A weekly template repeat runs at its time once")
        code, res = self.http("POST", f"/types/{self.task_id}/templates", {"name": "M14 weekly"})
        assert code == 201, (code, res)
        self.template = res["path"]
        self.made.add(self.template)
        tid = self.run.obj(self.template)["summary"]["id"]
        self.rule("Repeat M14 weekly", {
            "trigger": {"kind": "schedule", "repeat": "every week", "time": "09:00", "start": TODAY},
            "actions": [{"kind": "createFromTemplate", "typeId": self.task_id, "templateId": tid,
                         "title": "Weekly {date:YYYY-MM-DD}"}],
            "templateRepeat": {"typeId": self.task_id, "templateId": tid},
        })  # fmt: skip
        for instant in ("2026-11-02T08:59:40Z", "2026-11-02T09:00:05Z", "2026-11-02T09:00:30Z"):
            set_clock(self.clock, instant)
            self.http("POST", "/_test/tick")
        self.idle()
        runs = self.runs("Repeat M14 weekly")
        made = [r["actions"][0]["path"] for r in runs if r["status"] == "ok"]
        self.made.update(p for p in made if p)
        titles = [fm_of(self.root, p).get("title") for p in made if p]
        self.run.report(len(runs) == 1 and titles == [f"Weekly {TODAY}"],
                        f"{len(runs)} run(s), made {titles}")

    # 6 ---------------------------------------------------------------------------------
    def restart(self, served: Served) -> Served:
        print("\n6. Three weeks closed: the catch-up asks, then runs all")
        served.stop()
        set_clock(self.clock, "2026-11-23T10:00:00Z")
        served = Served(self.root)
        self.run.http = served.http
        _, res = self.http("GET", "/automations/catch-up")
        items = res["items"]
        listed = [(i["name"], i["count"]) for i in items]
        weekly = [p.name for p in self.root.rglob("Weekly 2026-*.md")]
        ok = listed == [("M14 weekly", 3)] and len(weekly) == 1
        code, res = self.http("POST", "/automations/catch-up",
                              {"ruleId": self.rules["Repeat M14 weekly"], "choice": "all"})
        paths = [r["actions"][0]["path"] for r in res.get("runs", [])] if code == 200 else []
        self.made.update(p for p in paths if p)
        titles = sorted(fm_of(self.root, p).get("title") for p in paths if p)
        after = self.http("GET", "/automations/catch-up")[1]["items"]
        ok = ok and code == 200 and titles == ["Weekly 2026-11-09", "Weekly 2026-11-16", "Weekly 2026-11-23"]
        self.run.report(ok and after == [],
                        f"listed {listed} with {len(weekly)} weekly object(s) before; run all {code} made {titles}; "
                        f"left {len(after)}")
        return served

    # 7 ---------------------------------------------------------------------------------
    def external(self) -> None:
        print("\n7. External edits trigger nothing")
        target = self.create(self.chore_id, "M14 outside")
        self.idle()
        stamp_runs = len(self.runs("M14 stamp"))
        create_runs = len(self.runs("M14 on create"))
        p = self.root / target
        text = p.read_bytes().decode("utf-8")
        lines = [ln for ln in text.split("\n") if not ln.startswith("stage:")]
        lines.insert(lines.index("---", 1), f"stage: {self.done_text}")
        p.write_bytes("\n".join(lines).encode("utf-8"))
        outside = self.root / "Tasks" / "M14 from outside.md"
        task_type = self.run.type_named("Task")
        outside.parent.mkdir(parents=True, exist_ok=True)
        outside.write_text(f"---\ntype: '{task_type['name'] if task_type else 'Task'}'\ntitle: M14 from outside\n---\n",
                           encoding="utf-8")
        self.made.update({target, "Tasks/M14 from outside.md"})
        seen = False
        for _ in range(200):
            o = self.run.obj(target)
            listed = self.http("GET", "/object", path="Tasks/M14 from outside.md")[0] == 200
            if o["frontmatter"].get("stage") in (self.done_text, [self.done_text]) and listed:
                seen = True
                break
            time.sleep(0.05)
        time.sleep(0.5)
        self.idle()
        self.run.report(
            seen and len(self.runs("M14 stamp")) == stamp_runs and len(self.runs("M14 on create")) == create_runs
            and not fm_of(self.root, target).get("doneOn"),
            f"watcher saw both {seen}; stamp runs {stamp_runs} -> {len(self.runs('M14 stamp'))}, "
            f"create runs {create_runs} -> {len(self.runs('M14 on create'))}",
        )

    # 8 ---------------------------------------------------------------------------------
    def no_chains(self) -> None:
        print("\n8. No rule's write triggered another rule")
        a, b = len(self.runs("M14 watches Done on")), len(self.runs("M14 watches tags"))
        self.run.report(a == 0 and b == 0, f"runs of the stamp watcher {a}, of the tags watcher {b}")

    # 9 ---------------------------------------------------------------------------------
    def git_status(self) -> None:
        print("\n9. Only the intended files changed")
        status = git(self.root, "status", "--porcelain", "-uall")
        untracked = {ln[3:].strip().strip('"') for ln in status.splitlines() if ln.startswith("??")}
        tracked = set(git(self.root, "diff", "--name-only", self.base).splitlines())
        changed = sorted((untracked | tracked) - {""})
        extra = [c for c in changed
                 if c not in self.made and not c.startswith(".object/types/") and not c.startswith(".object/trash/")]
        in_space = [c for c in changed if "automation-logs" in c or Path(c).name.startswith("automations-")]
        state = automation_state()
        key = space_key(self.root)
        expected_state = {f"automations-{key}.json", f"automation-logs-{key}"}
        self.run.report(not extra and not in_space and set(state) == expected_state,
                        f"{len(changed)} changed path(s); unexpected {extra}; state dir {state}", *extra)


# -- main ----------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m14-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    clock = tmp / "clock.txt"
    os.environ.update({
        "OBJECT_STATE_DIR": str(tmp / "state"),
        "OBJECT_CACHE_DIR": str(tmp / "cache"),
        "OBJECT_CLOCK_FILE": str(clock),
        "OBJECT_FAKE_NOTIFY_FILE": str(tmp / "notifications.jsonl"),
    })
    set_clock(clock, NOW)
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
        m14 = M14(root, run, clock)
        print(f"Space copy: {root}")
        print(f"\n0. Opening twice: {mig[0]}", *mig[1:], sep="\n   ")
        run.failures += mig[0] != "ok"
        m14.prepare()
        m14.reads()
        m14.watchers()
        m14.stamp()
        m14.creation()
        m14.button()
        m14.weekly()
        served = m14.restart(served)
        m14.external()
        m14.no_chains()
        m14.git_status()
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
