"""Milestone 24 acceptance run over HTTP (the brain dump, the work agent and its loop).

Usage: ``PYTHONPATH=scripts:backend uv run python scripts/m24_acceptance.py [SPACE] [--keep]``
(default SPACE: ``backend/tests/fixtures/space-work`` with ``space-work-m23`` copied over it)

Copies SPACE (and the overlay) to a temporary folder (the originals are never touched), commits the
copy to a throw-away git repo, points ``HOME`` at a temporary home that holds the synthetic
``change-reviewer`` (so ``~/.claude`` is never read), sets ``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR``,
``OBJECT_CLOCK_FILE`` (2026-11-05T10:00:00Z), ``OBJECT_FAKE_NOTIFY_FILE`` and ``FAKE_CLAUDE_LOG`` to
temporary paths, serves ``create_app`` on a free ``127.0.0.1`` port and points ``claudePath`` at the
fake ``claude`` (``backend/tests/fake_claude.py``; ``FAKE_CLAUDE_WORK_ACTIONS`` scripts what each queue
entry kind does). No model runs. Then it checks:

 1. Create the Work agent: it exists with the shell on, the ``work-follow-through`` skill and the copied
    ``change-reviewer`` file;
 2. brain dump with the switch off: the Capture object exists at once (Status New), a ``capture`` entry
    waits, and no CLI started;
 3. switch on: the capture is Filed to a new Task, the capture file stays, the run had no ``Bash``
    allowed and ``Bash`` disallowed;
 4. approve through ``POST /api/work/step``: one run with ``Bash`` allowed, the step is Done with
    "Change review: PASS", the entry is ``done``;
 5. auto-run: the Agent step now current runs once (``auto``, ``work-read``); the fake fails it with an
    ask, a Question is inserted before it and the entry shows as failed in ``GET /work/agent``;
 6. withdraw: approve then reopen with the switch off, the entry is withdrawn and never runs;
 7. prefixes: ``Question about INC0012345: ...`` and ``Break down OPS-123 step 1: ...`` link the right
    items and run ``question`` / ``breakDown`` entries (a note lands; the step becomes three);
 8. guards: a ``work-read`` token's ``POST /api/v1/object/properties`` is 403 "This run is read-only.";
 9. timeout: after a restart with ``OBJECT_TEST_WORK_TIMEOUT=3`` (the queue survives it) a ``FAKE:wait``
    capture fails ``TIMED_OUT``; Retry queues it again and it files;
10. Desk sync: set up off, 07:00 every weekday; run by the schedule tick it uses purpose ``work-sync``,
    changes Desk status only and never Object's own status;
11. no write on read: every ``GET`` route above leaves the space copy's bytes and the state dir alone.

Each check prints ``[ok]`` or ``[FAIL]``; ends with ``RESULT: PASS`` or exits non-zero.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from m2_acceptance import Run, commit, git, remove_tree, snapshot
from m8_acceptance import Served
from m22_acceptance import BADGE, PRINTER, bearer, fm_of, set_clock
from objectapp.space import Space
from objectapp.tokens import TokenStore
from objectapp.workagentmodel import TIMED_OUT

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend" / "tests"))

from fake_claude import install  # noqa: E402
FIXTURES = REPO / "backend" / "tests" / "fixtures"
DEFAULT_SPACE = FIXTURES / "space-work"
OVERLAY = FIXTURES / "space-work-m23"
HOME_FIXTURE = FIXTURES / "home-reviewer"
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE", "OBJECT_FAKE_NOTIFY_FILE",
         "FAKE_CLAUDE_LOG", "FAKE_CLAUDE_WORK_ACTIONS", "OBJECT_TEST_WORK_TIMEOUT", "HOME", "USERPROFILE")
NOW = "2026-11-05T10:00:00Z"
CAPTURE_TEXT = "Order more toner for line 3"
PASS_TEXT = "Change review: PASS. Spooler restarted."
READ_ONLY = "This run is read-only."
CLIENT = "m24-acceptance"


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def step_call(action: str, text: str, **extra: Any) -> dict:
    return {"server": "object", "tool": "step_action",
            "args": {"path": "{path}", "step_id": "{stepId}", "step_rev": "{stepRev}", "action": action,
                     "text": text, **extra}}


def work_actions() -> dict[str, list[dict]]:
    """What the fake does per queue entry kind (``FAKE_CLAUDE_WORK_ACTIONS``)."""
    return {
        "capture": [{"server": "object-agent", "tool": "file_capture",
                     "args": {"capture": "{capture}", "outcome": "task", "task_title": "Order more toner"}}],
        "approve": [step_call("complete", PASS_TEXT)],
        "run": [step_call("fail", "Can't read the log", ask="Which log should I read?")],
        "question": [{"server": "object", "tool": "add_work_note",
                      "args": {"path": "{path}", "text": "It is tray 2."}}],
        "breakDown": [{"server": "object", "tool": "edit_steps", "args": {"path": "{path}", "ops": [
            {"op": "add", "kind": "do", "text": f"Smaller {n}", "before": "{stepId}"} for n in (1, 2, 3)
        ] + [{"op": "remove", "stepId": "{stepId}", "stepRev": "{stepRev}"}]}}],
    }


class M24:
    def __init__(self, root: Path, run: Run, state: Path, clock: Path, log: Path, tmp: Path) -> None:
        self.root, self.run, self.state, self.clock, self.log, self.tmp = root, run, state, clock, log, tmp
        self.served: Served | None = None
        self.agent: dict = {}

    # -- plumbing ---------------------------------------------------------------------
    def http(self, *a, **k):
        return self.run.http(*a, **k)

    @property
    def url(self) -> str:
        assert self.served is not None
        return self.served.base.removesuffix("/api")

    def runs(self) -> list[dict]:
        if not self.log.exists():
            return []
        return [json.loads(x) for x in self.log.read_text(encoding="utf-8").splitlines() if x]

    def entries(self) -> list[dict]:
        files = sorted(self.state.glob("work-queue-*.json"))
        if not files:
            return []
        return json.loads(files[0].read_text(encoding="utf-8")).get("entries", [])

    def idle(self) -> bool:
        code, out = self.http("POST", "/_test/work/idle")
        return code == 200 and out.get("idle") is True

    def item(self, path: str) -> dict:
        code, item = self.http("GET", "/work/item", path=path)
        assert code == 200, (path, code, item)
        return item

    def step(self, path: str, step_id: str, action: str, **extra: Any) -> tuple[int, Any]:
        s = next(s for s in self.item(path)["steps"] if s["id"] == step_id)
        return self.http("POST", "/work/step", {"path": path, "stepId": step_id, "stepRev": s["rev"],
                                                "action": action, "clientId": CLIENT, **extra})

    def settings_status(self) -> dict:
        code, st = self.http("GET", "/work/agent-settings")
        assert code == 200, (code, st)
        return st

    def put_settings(self, **body: Any) -> tuple[int, Any]:
        st = self.settings_status()
        return self.http("PUT", "/work/agent-settings",
                         {**body, "baseRevision": st["settingsRevision"], "clientId": CLIENT})

    def capture(self, text: str, **extra: Any) -> dict:
        code, res = self.http("POST", "/work/captures", {"text": text, "fromView": "now", **extra})
        assert code == 201, (code, res)
        return res["capture"]

    def captures(self, status: str | None = None) -> list[dict]:
        code, res = self.http("GET", "/work/captures", **({"status": status} if status else {}))
        assert code == 200, (code, res)
        return res["captures"]

    def entries_of(self, **match: Any) -> list[dict]:
        return [e for e in self.entries() if all(e.get(k) == v for k, v in match.items())]

    # 0 ---------------------------------------------------------------------------------
    def prepare(self) -> None:
        _, cur = self.http("GET", "/settings")
        code, res = self.http("PUT", "/settings", {
            "patch": {"timeZone": "UTC", "claudePath": os.environ["FAKE_CLAUDE_PATH"]},
            "baseRevision": cur["revision"],
        })
        assert code == 200, (code, res)
        print("   Time zone UTC; claudePath is the fake claude")

    # 1 ---------------------------------------------------------------------------------
    def create_agent(self) -> None:
        print("\n1. Create the Work agent")
        code, info = self.http("GET", "/work/agent/create-info")
        home = Path(os.environ["HOME"])
        self.run.report(code == 200 and info["name"] == "Work"
                        and info["changeReviewer"] == str(home / ".claude" / "agents" / "change-reviewer.md"),
                        f"create-info offers the change-reviewer: {info}")
        code, res = self.http("POST", "/work/agent/create", {"copyChangeReviewer": True, "clientId": CLIENT})
        if not self.run.report(code == 201, f"create: {code}", *([] if code == 201 else [str(res)])):
            raise SystemExit
        self.agent = res["agent"]
        folder = Path(self.agent["folder"])
        self.run.report(self.agent["name"] == "Work" and "Bash" not in (self.agent.get("toolsOff") or []),
                        f"agent Work exists with the shell on (toolsOff {self.agent.get('toolsOff')})")
        skill = folder / ".claude" / "skills" / "work-follow-through" / "SKILL.md"
        self.run.report(skill.is_file(), "the work-follow-through skill is in the agent's folder")
        self.run.report((folder / ".claude" / "agents" / "change-reviewer.md").is_file(),
                        "the change-reviewer file was copied")
        st = res["settings"]
        self.run.report(st["agentId"] == self.agent["id"] and st["acts"] is False and st["problem"] is None,
                        f"the setting points at it; the switch is off ({st['agentId']}, acts {st['acts']})")
        code, again = self.http("POST", "/work/agent/create", {"copyChangeReviewer": False})
        self.run.report(code == 409, f"a second create is refused: {code}")
        # steer the auto-run off until check 5 so each check sees only its own runs
        code, st = self.put_settings(autoRun=False)
        self.run.report(code == 200 and st["autoRun"] is False, "Agent runs by itself switched off for now")

    # 2 ---------------------------------------------------------------------------------
    def brain_dump(self) -> None:
        print("\n2. Brain dump with the switch off")
        cap = self.capture(CAPTURE_TEXT)
        self.cap_path = cap["path"]
        self.run.report((self.root / self.cap_path).is_file() and cap["status"] == "new",
                        f"the Capture object exists at once, Status {cap['status']}: {self.cap_path}")
        fm = fm_of(self.root, self.cap_path)
        self.run.report(fm.get("captureStatus") in ("New", "new") or "New" in str(fm.get("captureStatus")),
                        f"the file holds Status New: {fm.get('captureStatus')}")
        pend = self.entries_of(kind="capture", state="pending")
        self.run.report(len(pend) == 1 and pend[0].get("capturePath") == self.cap_path,
                        f"one pending capture entry: {[(e['kind'], e['state']) for e in self.entries()]}")
        time.sleep(0.5)
        self.run.report(not self.runs(), "no CLI started")
        rows = self.http("GET", "/work/agent")[1]["rows"]
        self.run.report(len(rows) == 1 and rows[0]["state"] == "pending" and rows[0]["reason"] == "Brain dump",
                        f"the Agent queue holds it: {[(r['reason'], r['state']) for r in rows]}")

    # 3 ---------------------------------------------------------------------------------
    def switch_on(self) -> None:
        print("\n3. Switch on and filing")
        os.environ["FAKE_CLAUDE_WORK_ACTIONS"] = json.dumps(work_actions())
        code, st = self.put_settings(acts=True)
        self.run.report(code == 200 and st["acts"] is True, f"PUT agent-settings acts: {code}")
        self.run.report(self.idle(), "the queue went idle")
        cap = next((c for c in self.captures() if c["path"] == self.cap_path), None)
        filed = cap and cap.get("filedTo")
        self.run.report(bool(cap) and cap["status"] == "filed" and bool(filed)
                        and (self.root / filed["path"]).is_file(),
                        f"the capture is Filed to {filed and filed.get('path')}")
        task = fm_of(self.root, filed["path"]) if filed else {}
        self.run.report(task.get("title") == "Order more toner", f"the new Task is {task.get('title')!r}")
        self.run.report((self.root / self.cap_path).is_file(), "the capture file still exists")
        runs = self.runs()
        r = runs[0] if runs else {}
        self.run.report(len(runs) == 1 and "Bash" not in (r.get("allowed") or [])
                        and "Bash" in (r.get("disallowed") or []),
                        f"the filing run: Bash not allowed, disallowed (allowed {len(r.get('allowed') or [])} tools)")
        [e] = self.entries_of(kind="capture") or [{}]
        self.run.report(e.get("state") == "done" and e.get("purpose") == "work-file",
                        f"the entry is {e.get('state')}, purpose {e.get('purpose')}")
        self.filed_task = filed["path"] if filed else None

    # 4 ---------------------------------------------------------------------------------
    def approve(self) -> None:
        print("\n4. Approve a step")
        before = len(self.runs())
        steps = self.item(PRINTER)["steps"]
        appr = next(s for s in steps if s["kind"] == "approve" and s["state"] == "open")
        self.approve_id = appr["id"]
        code, res = self.step(PRINTER, appr["id"], "approve")
        self.run.report(code == 200, f"POST /work/step approve: {code}")
        self.run.report(self.idle(), "the queue went idle")
        mine = self.runs()[before:]
        self.run.report(len(mine) == 1 and "Bash" in (mine[0].get("allowed") or []),
                        f"one run, Bash allowed ({len(mine)} runs)")
        [e] = self.entries_of(kind="approve") or [{}]
        self.run.report(e.get("state") == "done" and e.get("purpose") == "work",
                        f"the entry is {e.get('state')}, purpose {e.get('purpose')}", str(e.get("reason") or ""))
        s = next(s for s in self.item(PRINTER)["steps"] if s["id"] == appr["id"])
        self.run.report(s["state"] == "done" and str(s.get("result") or "").startswith("Change review: PASS"),
                        f"the step is {s['state']}: {s.get('result')}")

    # 5 ---------------------------------------------------------------------------------
    def auto_run(self) -> None:
        print("\n5. Auto-run of an Agent step")
        before = len(self.runs())
        code, st = self.put_settings(autoRun=True)
        self.run.report(code == 200 and st["autoRun"] is True, "Agent runs by itself switched on")
        self.run.report(self.idle(), "the queue went idle")
        runs = self.entries_of(kind="run")
        self.run.report(len(runs) == 1 and runs[0].get("auto") is True and runs[0].get("purpose") == "work-read",
                        f"one auto run, purpose work-read: {[(e.get('auto'), e.get('purpose')) for e in runs]}")
        e = runs[0] if runs else {}
        self.run.report(e.get("state") == "failed" and "Can't read the log" in str(e.get("reason")),
                        f"it failed with the ask: {e.get('state')} {e.get('reason')!r}")
        mine = self.runs()[before:]
        self.run.report(len(mine) == 1 and "Bash" not in (mine[0].get("allowed") or []),
                        "the read-only run had no Bash allowed")
        steps = self.item(PRINTER)["steps"]
        texts = [s["text"] for s in steps]
        agent_step = next(s for s in steps if s["kind"] == "agent")
        q = steps[texts.index("Which log should I read?")] if "Which log should I read?" in texts else None
        self.run.report(q is not None and q["kind"] == "question" and steps.index(q) == steps.index(agent_step) - 1,
                        "a Question is inserted before the Agent step")
        rows = self.http("GET", "/work/agent")[1]["rows"]
        failed = [r for r in rows if r["state"] == "failed"]
        self.run.report(any("Can't read the log" in str(r["error"]) for r in failed),
                        f"GET /work/agent rows shows it failed: {[(r['reason'], r['state']) for r in failed]}")
        self.run.report(self.idle() and len(self.entries_of(kind="run")) == 1, "it is not run again")

    # 6 ---------------------------------------------------------------------------------
    def withdraw(self) -> None:
        print("\n6. Withdraw")
        code, st = self.put_settings(acts=False)
        self.run.report(code == 200 and st["acts"] is False, "switch off")
        first = next(s for s in self.item(BADGE)["steps"] if s["state"] == "open")
        code, res = self.http("POST", "/work/steps", {"path": BADGE, "clientId": CLIENT, "ops": [
            {"op": "add", "kind": "approve", "text": "Restart the badge reader service", "before": first["id"]}]})
        self.run.report(code == 200, f"added an Approve step to Badge reader audit: {code}")
        new = next(s for s in self.item(BADGE)["steps"] if s["text"] == "Restart the badge reader service")
        code, res = self.step(BADGE, new["id"], "approve")
        mine = self.entries_of(path=BADGE, kind="approve")
        self.run.report(len(mine) == 1 and mine[0]["state"] == "pending",
                        f"approved ({code}): one pending entry", *([] if code == 200 else [str(res)]))
        self.step(BADGE, new["id"], "reopen")
        mine = self.entries_of(path=BADGE, kind="approve")
        self.run.report(len(mine) == 1 and mine[0]["state"] == "withdrawn", f"reopened: {mine[0]['state']}")
        before = len(self.runs())
        code, st = self.put_settings(acts=True)
        self.run.report(self.idle() and len(self.runs()) == before,
                        "switched on: the withdrawn entry never runs")
        self.run.report(self.entries_of(path=BADGE, kind="approve")[0]["state"] == "withdrawn", "still withdrawn")

    # 7 ---------------------------------------------------------------------------------
    def prefixes(self) -> None:
        print("\n7. Prefixes")
        q = self.capture("Question about INC0012345: which tray jams?")
        self.run.report(q.get("linkedPath") == PRINTER, f"the question links Printer: {q.get('linkedPath')}")
        self.run.report(self.idle(), "idle")
        [qe] = self.entries_of(kind="question") or [{}]
        self.run.report(qe.get("state") == "done" and qe.get("purpose") == "work-read" and qe.get("path") == PRINTER,
                        f"a question entry ran read-only on Printer: {qe.get('state')} {qe.get('purpose')}")
        notes = "\n".join(a["text"] for a in self.item(PRINTER)["activity"])
        self.run.report("It is tray 2." in notes, "the answer landed as a work note")
        got = next((c for c in self.captures() if c["path"] == q["path"]), {})
        self.run.report(got.get("status") == "filed" and (got.get("filedTo") or {}).get("path") == PRINTER,
                        f"the question capture is Filed to Printer: {got.get('status')}")
        steps = self.item(BADGE)["steps"]
        s1 = next(s for s in steps if s["kind"] == "do" and s["state"] == "open")
        b = self.capture(f"Break down OPS-123 step {steps.index(s1) + 1}: {s1['text']}")
        self.run.report(b.get("linkedPath") == BADGE, f"the break down links Badge: {b.get('linkedPath')}")
        self.run.report(self.idle(), "idle")
        [be] = self.entries_of(kind="breakDown") or [{}]
        self.run.report(be.get("state") == "done" and be.get("stepId") == s1["id"],
                        f"a breakDown entry ran for step 1: {be.get('state')} {be.get('reason')}")
        texts = [s["text"] for s in self.item(BADGE)["steps"]]
        self.run.report(all(f"Smaller {n}" in texts for n in (1, 2, 3)) and s1["text"] not in texts,
                        f"the step became three smaller steps: {texts}")

    # 8 ---------------------------------------------------------------------------------
    def guards(self) -> None:
        print("\n8. Read-only guards")
        _rec, secret = TokenStore(self.root).ephemeral("Run", "read-write", agent=self.agent["id"],
                                                       chat="m24-acceptance", purpose="work-read")
        try:
            version = self.http("GET", "/object", path=PRINTER)[1]["version"]
            code, res = bearer(self.url + "/api", secret, "POST", "/v1/object/properties",
                               {"path": PRINTER, "version": version, "set": {"title": "x"}})
        finally:
            TokenStore.drop_ephemeral(secret)
        self.run.report(code == 403 and isinstance(res, dict) and res.get("detail") == READ_ONLY,
                        f"a work-read token's property write: {code} {res}")

    # 9 ---------------------------------------------------------------------------------
    def timeout(self) -> None:
        print("\n9. Timeout, restart and Retry")
        code, st = self.put_settings(acts=False)
        waiting = self.capture("FAKE:wait for the go file")
        pend = self.entries_of(capturePath=waiting["path"])
        self.run.report(len(pend) == 1 and pend[0]["state"] == "pending", "a capture waits in the queue")
        # restart the app with a 3 s run limit; the queue and the settings are on disk
        assert self.served is not None
        self.served.stop()
        os.environ["OBJECT_TEST_WORK_TIMEOUT"] = "3"
        self.served = Served(self.root)
        self.run.http = self.served.http
        again = self.entries_of(capturePath=waiting["path"])
        self.run.report(len(again) == 1 and again[0]["id"] == pend[0]["id"] and again[0]["state"] == "pending",
                        "the queue survived the restart")
        rows = self.http("GET", "/work/agent")[1]["rows"]
        self.run.report(any(r["id"] == pend[0]["id"] for r in rows), "the restarted app lists it")
        started = time.monotonic()
        self.put_settings(acts=True)
        self.run.report(self.idle(), "idle")
        [e] = self.entries_of(capturePath=waiting["path"]) or [{}]
        self.run.report(e.get("state") == "failed" and e.get("reason") == TIMED_OUT
                        and 2 < time.monotonic() - started < 25,
                        f"the entry failed: {e.get('state')} {e.get('reason')!r}")
        # let the retry's run finish: the fake waits for <log>.go
        Path(str(self.log) + ".go").touch()
        code, res = self.http("POST", "/work/agent/retry", {"id": e.get("id")})
        self.run.report(code == 200, f"Retry: {code}")
        self.run.report(self.idle(), "idle")
        retried = [x for x in self.entries_of(capturePath=waiting["path"]) if x.get("retryOf") == e.get("id")]
        self.run.report(len(retried) == 1 and retried[0]["attempt"] == 2 and retried[0]["state"] == "done",
                        f"Retry queued it again and it ran: {[(x['attempt'], x['state']) for x in retried]}")
        got = next((c for c in self.captures() if c["path"] == waiting["path"]), {})
        self.run.report(got.get("status") == "filed", f"the capture is {got.get('status')}")

    # 10 --------------------------------------------------------------------------------
    def desk_sync(self) -> None:
        print("\n10. Desk sync")
        code, st = self.http("GET", "/work/desk-sync")
        self.run.report(code == 200 and st["ruleId"] is None, "no Desk sync rule before the setup")
        code, st = self.http("POST", "/work/desk-sync/setup", {})
        rid = st.get("ruleId") if code == 201 else None
        self.run.report(code == 201 and rid and st["enabled"] is False and st["repeat"] == "every weekday"
                        and st["time"] == "07:00", f"setup: {code} {st}")
        rule_file = self.root / ".object" / "automations" / f"{rid}.json"
        rule = json.loads(rule_file.read_text(encoding="utf-8")) if rule_file.is_file() else {}
        self.run.report(rule.get("name") == "Desk sync" and rule.get("enabled") is False,
                        f"the rule file is Desk sync, off: {rule.get('name')} {rule.get('enabled')}")
        if not rid:
            return
        before_status = fm_of(self.root, PRINTER).get("status")
        version = self.http("GET", "/object", path=PRINTER)[1]["version"]
        call = {"path": PRINTER, "version": version, "values": {"deskStatus": "Resolved"}}
        marker = "FAKE:mcp:object-agent:sync_ticket_fields:" + json.dumps(call)
        _c, current = self.http("GET", f"/automations/{rid}")
        body = {k: v for k, v in current.items() if k not in ("id", "revision", "readOnlyReason", "lastRun")}
        body["enabled"] = True
        body["actions"] = [{**body["actions"][0], "prompt": body["actions"][0]["prompt"] + "\n" + marker}]
        code, _r = self.http("PUT", f"/automations/{rid}", {"rule": body, "baseRevision": current["revision"],
                                                            "clientId": CLIENT})
        self.run.report(code == 200, f"the rule switched on (with a scripted marker): {code}")
        before = len(self.runs())
        now = datetime.fromisoformat(self.clock.read_text(encoding="utf-8").replace("Z", "+00:00"))
        goal = datetime(2026, 11, 6, 7, 0, 30, tzinfo=UTC)  # a Friday
        while now < goal:
            now = min(goal, now + timedelta(minutes=5))
            set_clock(self.clock, iso(now))
            self.http("POST", "/_test/tick")
        for _ in range(60):
            code, out = self.http("POST", "/_test/agent-schedules/idle")
            if code == 200 and out.get("idle") is True:
                break
        mine = self.runs()[before:]
        self.run.report(len(mine) == 1 and "Desk sync." in (mine[0].get("prompt") or ""),
                        f"the schedule ran once ({len(mine)} runs)")
        fm = fm_of(self.root, PRINTER)
        self.run.report(fm.get("deskStatus") == "Resolved",
                        f"sync_ticket_fields (work-sync) set Desk status: {fm.get('deskStatus')}")
        self.run.report(fm.get("status") == before_status, f"Object's own status is unchanged: {fm.get('status')}")
        self.run.report("Work set Desk status to Resolved" in "\n".join(a["text"] for a in self.item(PRINTER)["activity"]),
                        "the Activity line says so")
        st = self.http("GET", "/work/desk-sync")[1]
        self.run.report(st["enabled"] is True and bool((st["lastRun"] or {}).get("status")),
                        f"the status shows the last run: {st['lastRun']}")

    # 11 --------------------------------------------------------------------------------
    def reads(self) -> None:
        print("\n11. Reads write nothing")
        assert self.idle()
        before = snapshot(self.root)
        state_before = self.state_snapshot()
        gets = ["/work/agent", "/work/captures", "/work/agent-settings", "/work/agent/create-info",
                "/work/read-tools", "/work/desk-sync", "/work/board", "/work/items"]
        bad = []
        for route in gets:
            code, _ = self.http("GET", route)
            if code != 200:
                bad.append(f"{route}: {code}")
        for status in ("new", "filed", "needsYou"):
            code, _ = self.http("GET", "/work/captures", status=status)
            if code != 200:
                bad.append(f"captures {status}: {code}")
        self.run.report(not bad, f"every M24 read answered ({len(gets) + 3} calls)", *bad)
        self.run.report(snapshot(self.root) == before, "the space copy's bytes are unchanged")
        self.run.report(self.state_snapshot() == state_before, "the state dir is unchanged")

    def state_snapshot(self) -> dict[str, int]:
        return {str(p.relative_to(self.state)): (p.stat().st_size if p.is_file() else -1)
                for p in sorted(self.state.rglob("*"))}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path, nargs="?", default=DEFAULT_SPACE)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m24-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    if src == DEFAULT_SPACE.resolve():
        shutil.copytree(OVERLAY, root, dirs_exist_ok=True)
    home = tmp / "home"
    shutil.copytree(HOME_FIXTURE, home)
    state, clock, log = tmp / "state", tmp / "clock.txt", tmp / "claude-log.jsonl"
    saved_env = {k: os.environ.get(k) for k in (*HOOKS, "FAKE_CLAUDE_PATH")}
    fake = install(tmp / "bin")
    for k in HOOKS:
        os.environ.pop(k, None)
    os.environ.update({
        "OBJECT_STATE_DIR": str(state), "OBJECT_CACHE_DIR": str(tmp / "cache"),
        "OBJECT_CLOCK_FILE": str(clock), "OBJECT_FAKE_NOTIFY_FILE": str(tmp / "notify.jsonl"),
        "FAKE_CLAUDE_LOG": str(log), "FAKE_CLAUDE_PATH": str(fake),
        "HOME": str(home), "USERPROFILE": str(home),
    })
    set_clock(clock, NOW)
    state.mkdir(parents=True, exist_ok=True)
    git(root, "init", "-q")
    commit(root, "base")
    Space(root)  # an older space is migrated on its first open; commit that
    commit(root, "opened once")

    m24: M24 | None = None
    run: Run | None = None
    try:
        served = Served(root)
        run = Run(root, served.http)
        m24 = M24(root, run, state, clock, log, tmp)
        m24.served = served
        print(f"Space copy: {root}\nServed at: {served.base}\nFake claude: {fake}")
        m24.prepare()
        m24.create_agent()
        m24.brain_dump()
        m24.switch_on()
        m24.approve()
        m24.auto_run()
        m24.withdraw()
        m24.prefixes()
        m24.guards()
        m24.timeout()
        m24.desk_sync()
        m24.reads()
    except Exception as exc:  # report a crash as a failure, then clean up
        if run is not None:
            run.report(False, f"the run stopped: {exc!r}")
        raise
    finally:
        Path(str(log) + ".go").touch()
        if m24 is not None and m24.served is not None:
            m24.served.stop()
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
