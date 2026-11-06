"""Milestone 21 acceptance run: agent schedules.

Usage: ``uv run python scripts/m21_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo (again after one open, which migrates an old space) and serves it with
``create_app(..., base_url=...)`` on a free ``127.0.0.1`` port. ``OBJECT_STATE_DIR``,
``OBJECT_CACHE_DIR``, ``OBJECT_CLOCK_FILE`` (starting 2026-11-09T08:50:00Z, a Monday),
``OBJECT_FAKE_NOTIFY_FILE`` and ``FAKE_CLAUDE_LOG`` point at temporary paths. No model runs: the
``claudePath`` setting points at ``backend/tests/fake_claude.py``; its ``FAKE:mcp`` markers call
the agent's real tools through the real ``object-agent`` server. The space's time zone is UTC.
The agent "Researcher" is made with ``POST /api/agents`` (``memoryReviewEvery: 1``), with the
skills ``weekly-report``, ``notes`` and ``old-notes`` written as agent-made folders. Checks:

 1. made from the agent page's route: ``POST /api/automations`` with a ``runAgent`` schedule
    "Weekly review" answers 201; the rule file is under ``.object/automations/``;
    ``agent-schedules.json`` lists it under the copy's space key;
 2. runs on time as a chat: the clock moves to 09:00:30 (in steps a running app sees), a tick and
    ``_test/agent-schedules/idle``; the fake ran in Researcher's folder with "Review 2026-11-09" and
    the schedule guidance; the transcript has ``schedule.ruleId``; the AI Chat "Weekly review
    2026-11-09" has ``agent: Researcher``; the run log shows ``ok`` with the chat's path; one
    notification titled "Weekly review";
 3. no review after the schedule run; a chat turn afterwards does start one;
 4. the agent schedules itself: a chat turn's ``schedule_manage`` calls create "Daily digest",
    list it, turn it off and delete it to the Trash; the default agent's turn can't see or change
    it; ``POST /api/v1/automations`` with a ``runAgent`` rule answers 422;
 5. curator protection: ``SCHEDULE_SKILLS`` holds ``weekly-report`` (named in the prompt), then
    ``notes`` after a run of a second schedule with ``FAKE:skilltool:notes``; the deterministic
    pass 40 days on keeps both and archives the unprotected ``old-notes``;
 6. closing mid-run is never lost: a ``FAKE:wait`` schedule runs, the server stops; the run log
    shows ``failed`` "Stopped because the space was closed."; on the next start the catch-up
    lists it with count 1 and nothing ran; "Only the latest" runs it once and empties the list;
 7. missed while closed: three weeks on, the catch-up lists "Weekly review" with count 3; "Run
    all" answers at once with ``queued: 3``; three chats dated 2026-11-16, -23 and -30;
 8. Settings and the other space: ``GET /api/automations`` lists every schedule with its
    ``lastRun``; a second space in the same state dir has an empty catch-up, runs nothing, and
    ``agent-schedules.json`` keeps the first space's entries;
 9. files: ``git status`` of the copy shows only the rule files, their trash entries, the AI Chat
    type file and the chat files; opening the copy once more without a tick changes nothing
    (``git status`` and the index's mtime kept).

Each check prints ``[ok]`` or ``[FAIL]``; ``RESULT: PASS`` at the end; exits non-zero on any
failure.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import uvicorn
from m2_acceptance import HOST, Http, Run, commit, free_port, git, remove_tree
from m10_acceptance import runs, sse
from m14_acceptance import fm_of, set_clock, wait_up
from objectapp import agentskills, curator, schedulerun, transcripts
from objectapp.agentmodel import SESSIONS_DIR, AgentInput
from objectapp.agents import AgentRegistry
from objectapp.agentschedules import INDEX_FILE
from objectapp.appstate import space_key, state_dir
from objectapp.server import create_app
from objectapp.space import Space

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend" / "tests"))
from fake_claude import install

HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE", "OBJECT_FAKE_NOTIFY_FILE",
         "FAKE_CLAUDE_LOG", "FAKE_CLAUDE_REVIEW_ACTIONS")
START = datetime(2026, 11, 9, 8, 50, tzinfo=UTC)  # a Monday
REVIEW_LINE = "Look back over this chat."
CLIENT = "m21-acceptance"


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def mcp(tool: str, args: dict[str, Any]) -> str:
    return f"FAKE:mcp:object-agent:{tool}:{json.dumps(args)}"


def results(events: list[dict]) -> list[str]:
    return [str(e.get("result") or "") for e in events if e.get("type") == "tool" and "result" in e]


def as_json(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return None


class Served:
    """One `Space` served on a free port with the app's lifespan, told its own loopback URL."""

    def __init__(self, root: Path) -> None:
        self.space = Space(root)
        self.port = free_port()
        app = create_app(self.space, None, watch=True, base_url=f"http://{HOST}:{self.port}")
        self.app = app
        self.server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=self.port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        self.base = f"http://{HOST}:{self.port}/api"
        self.http = Http(self.base)
        wait_up(self.http)

    def stop(self) -> None:
        self.server.config.app.state.hub.close()
        self.server.should_exit = True
        self.thread.join(timeout=30)


def skill(folder: Path, name: str, description: str) -> None:
    d = folder / ".claude" / "skills" / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\ncreated_by: agent\n---\n\n# {name}\n\nSynthetic skill.\n",
        encoding="utf-8")


def pid_alive(pid: int) -> bool:
    if os.name == "nt":
        import subprocess

        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True, check=False)
        return str(pid) in out.stdout
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def main(argv: list[str] | None = None) -> int:  # noqa: C901, PLR0915 - one long script, as M14's and M18's
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m21-acceptance-")).resolve()
    root = tmp / src.name
    other = tmp / "second" / src.name
    state = tmp / "state"
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    shutil.copytree(src, other, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    log = tmp / "claude-log.jsonl"
    go = Path(str(log) + ".go")
    clock = tmp / "clock.txt"
    notified = tmp / "notify.jsonl"
    set_clock(clock, iso(START))
    for k in HOOKS:
        os.environ.pop(k, None)
    os.environ.update({
        "OBJECT_STATE_DIR": str(state),
        "OBJECT_CACHE_DIR": str(tmp / "cache"),
        "OBJECT_CLOCK_FILE": str(clock),
        "OBJECT_FAKE_NOTIFY_FILE": str(notified),
        "FAKE_CLAUDE_LOG": str(log),
    })
    fake = install(tmp / "bin")
    git(root, "init", "-q")
    commit(root, "base")
    Space(root)  # a space from before M2 is migrated on its first open; commit that
    commit(root, "opened once")
    Space(other)

    served: Served | None = None
    run: Run | None = None
    holder: dict[str, Served | None] = {"s": None}

    def serve(where: Path = root) -> Served:
        s = Served(where)
        holder["s"] = s
        if run is not None:
            run.http = s.http
        return s

    def stop() -> None:
        s = holder["s"]
        holder["s"] = None
        if s is not None:
            s.stop()

    try:
        served = serve()
        run = Run(root, served.http)
        print(f"Space copy: {root}\nServed at: {served.base}\nFake claude: {fake}")

        def http(method: str, route: str, payload: Any = None, **query: Any) -> tuple[int, Any]:
            return run.http(method, route, payload, **query)

        _, current = http("GET", "/settings")
        code, _s = http("PUT", "/settings", {"patch": {"claudePath": str(fake), "timeZone": "UTC"},
                                             "baseRevision": current["revision"]})
        if code != 200:
            run.report(False, f"PUT /api/settings: {code} {_s}")
            raise SystemExit
        code, made = http("POST", "/agents", {"agent": {"name": "Researcher"}, "instructions": "You look things up.",
                                              "location": None, "clientId": CLIENT})
        if code != 201:
            run.report(False, f"POST /api/agents Researcher: {code} {made}")
            raise SystemExit
        rid = made["id"]
        folder = Path(made["folder"]).resolve()
        reg = AgentRegistry()
        reg.save(rid, AgentInput(name="Researcher", learning={"memoryReviewEvery": 1, "skillReviewEvery": 1}),
                 reg.get(rid).revision)
        skill(folder, "weekly-report", "Write the weekly report")
        skill(folder, "notes", "Tidy notes")
        skill(folder, "old-notes", "Never used")
        print(f"Researcher: {rid} at {folder}")
        key = space_key(served.space.root)
        index_file = state_dir() / INDEX_FILE

        def index() -> dict[str, Any]:
            try:
                return json.loads(index_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return {}

        def tick() -> dict[str, Any]:
            code, out = http("POST", "/_test/tick")
            return out if code == 200 else {}

        def idle() -> bool:
            code, out = http("POST", "/_test/agent-schedules/idle")
            return code == 200 and out.get("idle") is True

        def reviews_idle() -> None:
            http("POST", "/_test/reviews/idle")

        def walk_to(moment: datetime) -> None:
            """Move the clock in steps of at most 5 minutes with a tick each (a running app's view)."""
            now = datetime.fromisoformat(clock.read_text(encoding="utf-8").replace("Z", "+00:00"))
            while now < moment:
                now = min(moment, now + timedelta(minutes=5))
                set_clock(clock, iso(now))
                tick()

        def schedule(name: str, prompt: str, repeat: str, time_: str, **over: Any) -> dict[str, Any]:
            rule = {"name": name, "trigger": {"kind": "schedule", "repeat": repeat, "time": time_,
                                              "start": "2026-11-09"},
                    "actions": [{"kind": "runAgent", "agentId": rid, "prompt": prompt, "model": None}]}
            rule.update(over)
            return rule

        def create(rule: dict[str, Any]) -> tuple[int, Any]:
            return http("POST", "/automations", {"rule": rule, "clientId": CLIENT})

        def set_enabled(rule_id: str, enabled: bool) -> int:
            _c, rule = http("GET", f"/automations/{rule_id}")
            body = {k: v for k, v in rule.items() if k not in ("id", "revision", "readOnlyReason", "lastRun")}
            code, _r = http("PUT", f"/automations/{rule_id}", {"rule": {**body, "enabled": enabled},
                                                               "baseRevision": rule["revision"], "clientId": CLIENT})
            return code

        def runs_of(rule_id: str) -> list[dict[str, Any]]:
            code, out = http("GET", f"/automations/{rule_id}/runs")
            return out.get("runs", []) if code == 200 else []

        def catch_up() -> dict[str, dict[str, Any]]:
            code, out = http("GET", "/automations/catch-up")
            return {i["ruleId"]: i for i in out.get("items", [])} if code == 200 else {}

        def notes_sent() -> list[dict[str, Any]]:
            if not notified.exists():
                return []
            return [json.loads(x) for x in notified.read_text(encoding="utf-8").splitlines() if x]

        def chats_of(agent_folder: Path) -> list[list[dict[str, Any]]]:
            sessions = agent_folder / SESSIONS_DIR
            if not sessions.is_dir():
                return []
            return [transcripts.raw_lines(agent_folder, p.stem) for p in sorted(sessions.glob("*.jsonl"))]

        def scheduled_chats(rule_id: str) -> list[list[dict[str, Any]]]:
            return [c for c in chats_of(folder) if c and (c[0].get("schedule") or {}).get("ruleId") == rule_id]

        def review_runs() -> list[dict]:
            return [r for r in runs(log) if (r.get("prompt") or "").startswith(REVIEW_LINE)]

        def turn(prompt: str, agent: str) -> list[dict]:
            body = {"mode": "chat", "prompt": prompt, "contextPaths": [], "history": [], "agentId": agent}
            code, raw, events = sse(served_base(), body)
            if code != 200 or not events or events[-1].get("type") != "done":
                print(f"  turn failed: {code} {events[-1:] if events else raw[:200]}")
            return events

        def served_base() -> str:
            s = holder["s"]
            assert s is not None
            return s.base

        chat_paths: set[str] = set()

        # 1 -------------------------------------------------------------------------------------
        print("\n1. Made from the agent page's route")
        code, weekly = create(schedule("Weekly review", "Review {date:YYYY-MM-DD} with /weekly-report",
                                       "every week on monday", "09:00"))
        wid = weekly.get("id", "?") if isinstance(weekly, dict) else "?"
        rule_file = root / ".object" / "automations" / f"{wid}.json"
        on_disk = json.loads(rule_file.read_text(encoding="utf-8")) if rule_file.is_file() else {}
        run.report(code == 201 and (on_disk.get("actions") or [{}])[0].get("agentId") == rid,
                   f"POST /api/automations answers 201 and the rule file holds the agent: {code} {rule_file.name}")
        entries = ((index().get("spaces") or {}).get(key) or {}).get("schedules") or {}
        run.report(wid in entries and entries[wid].get("agentId") == rid,
                   f"agent-schedules.json lists it under the copy's space key: {sorted(entries)}")

        # 2 -------------------------------------------------------------------------------------
        print("\n2. Runs on time as a chat")
        before = len(runs(log))
        walk_to(datetime(2026, 11, 9, 9, 0, 30, tzinfo=UTC))
        run.report(idle(), "POST /api/_test/agent-schedules/idle: the run ended")
        mine = runs(log)[before:]
        first = mine[0] if mine else {}
        run.report(len(mine) == 1 and Path(first.get("cwd", "")).resolve() == folder
                   and "Review 2026-11-09" in (first.get("prompt") or ""),
                   f"the fake ran once in Researcher's folder with 'Review 2026-11-09': {len(mine)} runs")
        run.report(schedulerun.SCHEDULE_GUIDANCE in (first.get("appendPrompt") or ""),
                   "appendPrompt holds the schedule guidance")
        sched = scheduled_chats(wid)
        run.report(len(sched) == 1 and sched[0][0]["schedule"].get("scheduledFor") == "2026-11-09T09:00:00.000Z"
                   and sched[0][0]["schedule"].get("catchUp") is False,
                   f"a transcript has schedule.ruleId: {[c[0].get('schedule') for c in sched]}")
        logged = runs_of(wid)
        act = ((logged[0].get("actions") or [{}])[0]) if logged else {}
        path = act.get("path") or ""
        if path:
            chat_paths.add(path)
        fm = fm_of(root, path) if path and (root / path).is_file() else {}
        run.report("Weekly review 2026-11-09" in path and fm.get("agent") == "Researcher",
                   f"the AI Chat 'Weekly review 2026-11-09' has agent: Researcher: {path} {fm.get('agent')}")
        run.report(len(logged) == 1 and logged[0].get("status") == "ok" and act.get("kind") == "runAgent"
                   and act.get("detail") == schedulerun.SAVED,
                   f"the run log shows ok with the chat's path: {[(r.get('status'), r.get('actions')) for r in logged]}")
        sent = notes_sent()
        run.report(len(sent) == 1 and sent[0].get("title") == "Weekly review",
                   f"one notification titled 'Weekly review': {sent}")

        # 3 -------------------------------------------------------------------------------------
        print("\n3. No review")
        reviews_idle()
        run.report(not review_runs(), f"no review ran after the schedule run: {len(review_runs())}")
        turn("Hello", rid)
        reviews_idle()
        run.report(len(review_runs()) == 1, f"a chat turn afterwards does start one: {len(review_runs())}")

        # 4 -------------------------------------------------------------------------------------
        print("\n4. The agent schedules itself")
        events = turn(mcp("schedule_manage", {"action": "create", "name": "Daily digest", "prompt": "Sum up today",
                                              "repeat": "every day", "time": "18:00"}) + "\n"
                      + mcp("schedule_manage", {"action": "list"}), rid)
        out = [as_json(r) for r in results(events)]
        created = out[0] if out and isinstance(out[0], dict) else {}
        did = created.get("id", "?")
        listed = out[1] if len(out) > 1 and isinstance(out[1], dict) else {}
        names = [s.get("name") for s in listed.get("schedules", [])]
        run.report(created.get("name") == "Daily digest" and created.get("enabled") is True
                   and created.get("time") == "18:00" and bool(created.get("nextRun")),
                   f"schedule_manage create answers the schedule: {str(created)[:160]}")
        digest_file = root / ".object" / "automations" / f"{did}.json"
        digest = json.loads(digest_file.read_text(encoding="utf-8")) if digest_file.is_file() else {}
        run.report((digest.get("actions") or [{}])[0].get("agentId") == rid, "its rule file names Researcher")
        run.report("Daily digest" in names and "Weekly review" in names, f"list shows it: {names}")
        events = turn(mcp("schedule_manage", {"action": "list"}) + "\n"
                      + mcp("schedule_manage", {"action": "update", "schedule_id": did, "enabled": False}), "assistant")
        out = results(events)
        theirs = as_json(out[0]) if out else None
        run.report(isinstance(theirs, dict) and theirs.get("schedules") == [],
                   f"the default agent's list doesn't show it: {out[:1]}")
        run.report(len(out) > 1 and "404" in out[1], f"the default agent's update is 404: {out[1:2]}")
        events = turn(mcp("schedule_manage", {"action": "update", "schedule_id": did, "enabled": False}) + "\n"
                      + mcp("schedule_manage", {"action": "delete", "schedule_id": did}), rid)
        out = [as_json(r) for r in results(events)]
        off = out[0] if out and isinstance(out[0], dict) else {}
        trashed = out[1] if len(out) > 1 and isinstance(out[1], dict) else {}
        run.report(off.get("enabled") is False and off.get("time") == "18:00",
                   f"update turns it off and keeps the rest: {str(off)[:120]}")
        _c, trash = http("GET", "/trash")
        items = trash if isinstance(trash, list) else []
        entry = next((i for i in items if i.get("id") == trashed.get("trashId")), {})
        run.report(bool(trashed.get("trashId")) and not digest_file.exists() and bool(entry),
                   f"delete moves it to the Trash: {trashed} {str(entry)[:120]}")
        events = turn("FAKE:mcp:object:create_automation:" + json.dumps({"rule": schedule(
            "Sneaky", "Hi", "every day", "07:00")}), rid)
        out = results(events)
        run.report(bool(out) and "422" in out[0] and "Agent schedules are made with schedule_manage." in out[0],
                   f"POST /api/v1/automations with a runAgent rule answers 422: {out[:1]}")

        # 5 -------------------------------------------------------------------------------------
        print("\n5. Curator protection")
        protected = agentskills.SCHEDULE_SKILLS(folder)
        run.report("weekly-report" in protected and "notes" not in protected,
                   f"SCHEDULE_SKILLS holds weekly-report (named in the prompt): {sorted(protected)}")
        code, notes_rule = create(schedule("Notes digest", "FAKE:skilltool:notes\nTidy up", "every day", "10:00"))
        nid = notes_rule.get("id", "?") if isinstance(notes_rule, dict) else "?"
        walk_to(datetime(2026, 11, 9, 10, 0, 30, tzinfo=UTC))
        idle()
        nlog = runs_of(nid)
        if nlog and (nlog[0].get("actions") or [{}])[0].get("path"):
            chat_paths.add(nlog[0]["actions"][0]["path"])
        protected = agentskills.SCHEDULE_SKILLS(folder)
        run.report(code == 201 and bool(nlog) and nlog[0].get("status") == "ok" and "notes" in protected,
                   f"after a run with FAKE:skilltool:notes it holds notes too: {sorted(protected)}")
        set_enabled(nid, False)  # kept (protection holds on or off) but owes nothing later
        run.report("notes" in agentskills.SCHEDULE_SKILLS(folder), "a turned-off schedule still protects")
        now = datetime(2026, 11, 9, 10, 1, tzinfo=UTC)
        curator.deterministic_pass(folder, now, run_id="m21-a")  # stamps createdAt on first sight
        curator.deterministic_pass(folder, now + timedelta(days=40), run_id="m21-b")
        states = {s.name: s.state for s in agentskills.list_skills(folder)}
        archived = (folder / ".object-agent" / "skills-archive" / "old-notes").is_dir()
        run.report(states.get("weekly-report") == "active" and states.get("notes") == "active",
                   f"the pass 40 days on leaves both active: {states}")
        run.report(archived and "old-notes" not in states, f"the unprotected old-notes is archived: {archived}")

        # 6 -------------------------------------------------------------------------------------
        print("\n6. Closing mid-run is never lost")
        go.unlink(missing_ok=True)
        code, long_rule = create(schedule("Long job", "FAKE:wait Long job", "every day", "11:00"))
        lid = long_rule.get("id", "?") if isinstance(long_rule, dict) else "?"
        before = len(runs(log))
        walk_to(datetime(2026, 11, 9, 11, 0, 30, tzinfo=UTC))
        deadline = time.monotonic() + 30
        while len(runs(log)) <= before and time.monotonic() < deadline:
            time.sleep(0.1)
        waiting = runs(log)[before:]
        pid = waiting[0].get("pid") if waiting else None
        stop()
        run.report(bool(waiting) and pid is not None and not pid_alive(pid),
                   f"the server stopped while it ran; the fake is gone: pid {pid}")
        n_runs = len(runs(log))
        served = serve()
        llog = runs_of(lid)
        run.report(bool(llog) and llog[0].get("status") == "failed"
                   and (llog[0].get("actions") or [{}])[0].get("detail") == schedulerun.STOPPED,
                   f"the run log shows failed '{schedulerun.STOPPED}': {[(r.get('status'), r.get('actions')) for r in llog]}")
        items = catch_up()
        time.sleep(1.0)
        run.report(items.get(lid, {}).get("count") == 1 and len(runs(log)) == n_runs,
                   f"after a restart the catch-up lists it with count 1 and nothing ran: {list(items.values())}")
        go.write_text("go", encoding="utf-8")
        code, answer = http("POST", "/automations/catch-up", {"ruleId": lid, "choice": "latest", "clientId": CLIENT})
        idle()
        llog = runs_of(lid)
        run.report(code == 200 and answer.get("queued") == 1 and llog[0].get("status") == "ok"
                   and len(runs(log)) == n_runs + 1 and lid not in catch_up(),
                   f"'Only the latest' runs it once and the catch-up is empty: {code} {answer}")
        if llog and (llog[0].get("actions") or [{}])[0].get("path"):
            chat_paths.add(llog[0]["actions"][0]["path"])
        set_enabled(lid, False)

        # 7 -------------------------------------------------------------------------------------
        print("\n7. Missed while closed")
        stop()
        set_clock(clock, iso(datetime(2026, 11, 30, 11, 0, 30, tzinfo=UTC)))
        n_runs = len(runs(log))
        served = serve()
        items = catch_up()
        run.report(items.get(wid, {}).get("count") == 3 and items[wid].get("name") == "Weekly review"
                   and len(runs(log)) == n_runs,
                   f"the catch-up lists 'Weekly review' with count 3: {list(items.values())}")
        t0 = time.monotonic()
        code, answer = http("POST", "/automations/catch-up", {"ruleId": wid, "choice": "all", "clientId": CLIENT})
        took = time.monotonic() - t0
        run.report(code == 200 and answer == {"runs": [], "queued": 3} and took < 2,
                   f"'Run all' answers at once with queued 3: {code} {answer} in {took:.2f} s")
        idle()
        sched = scheduled_chats(wid)
        days = sorted(c[0]["schedule"]["scheduledFor"][:10] for c in sched if c[0]["schedule"].get("catchUp"))
        titles = []
        for r in runs_of(wid):
            p = (r.get("actions") or [{}])[0].get("path")
            if p:
                chat_paths.add(p)
                titles.append(Path(p).stem)
        run.report(days == ["2026-11-16", "2026-11-23", "2026-11-30"]
                   and all(any(d in t for t in titles) for d in days) and wid not in catch_up(),
                   f"three chats dated by occurrence: {days} {sorted(titles)}")

        # 8 -------------------------------------------------------------------------------------
        print("\n8. Settings and the other space")
        _c, rules = http("GET", "/automations")
        rules = rules if isinstance(rules, list) else []
        mine = {r["id"]: r for r in rules}
        run.report({wid, nid, lid} <= set(mine) and all(mine[i].get("lastRun") for i in (wid, nid, lid)),
                   f"GET /api/automations lists every schedule with its lastRun: "
                   f"{[(r['name'], (r.get('lastRun') or {}).get('status')) for r in rules]}")
        stop()
        n_runs = len(runs(log))
        served = serve(other)
        tick()
        jobs = tick().get("agentJobs")
        items = catch_up()
        idle()
        run.report(not items and jobs == 0 and len(runs(log)) == n_runs,
                   f"the second space's catch-up is empty and it runs nothing: {items} {jobs}")
        kept = ((index().get("spaces") or {}).get(key) or {}).get("schedules") or {}
        run.report({wid, nid, lid} <= set(kept), f"agent-schedules.json keeps the first space's entries: {sorted(kept)}")
        stop()

        # 9 -------------------------------------------------------------------------------------
        print("\n9. Files")
        status = git(root, "status", "--porcelain", "--untracked-files=all").splitlines()
        changed = [line[3:].strip().strip('"') for line in status]

        def expected(p: str) -> bool:
            return (p.startswith((".object/automations/", ".object/trash/", ".object/types/"))
                    or p in chat_paths)

        stray = [p for p in changed if not expected(p)]
        types_changed = [p for p in changed if p.startswith(".object/types/")]
        run.report(not stray and len(chat_paths) == 6 and all(p in changed for p in chat_paths)
                   and len(types_changed) <= 1,
                   f"git status shows only the rule files, trash entries, the AI Chat type and the {len(chat_paths)} "
                   f"chats: {len(changed)} paths", *stray[:10], *types_changed)
        mtime = index_file.stat().st_mtime_ns
        served = serve()
        http("GET", "/space")
        http("GET", "/automations")
        http("GET", "/automations/catch-up")
        http("GET", f"/agents/{rid}/chats")
        stop()
        again = git(root, "status", "--porcelain", "--untracked-files=all").splitlines()
        run.report(again == status and index_file.stat().st_mtime_ns == mtime,
                   "opening the copy again without a tick changes nothing (git status, the index mtime)")
    except SystemExit:
        pass
    finally:
        go.write_text("go", encoding="utf-8")
        stop()
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
