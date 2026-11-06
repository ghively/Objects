"""Milestone 22 acceptance run over HTTP and MCP (the work model).

Usage: ``uv run python scripts/m22_acceptance.py [SPACE] [--keep]``
(default SPACE: ``backend/tests/fixtures/space-work``)

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo (again after one open, so the checks see only what the app does), sets
``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR`` and ``OBJECT_CLOCK_FILE`` (2026-11-05T10:00:00Z) to
temporary paths outside the copy, serves ``create_app`` on a free ``127.0.0.1`` port and sets
the space's time zone to UTC (``PUT /api/settings``). A read-write token named "Work" is made
through ``/api/integrations/tokens`` (state dir only). Then it checks:

 1. reads write nothing: ``GET /api/work/items`` (both scopes), ``GET /api/work/item`` for
    every item, ``GET /api/queries`` and ``GET /api/space`` (the types) leave ``git status``
    clean;
 2. the fixture's turns and stages; the Tickets view lists Printer, Badge and Desk closed it;
 3. Gene answers Parked thing's question: one Activity and one Work notes line; the diff
    touches only ``steps``, ``lastUpdated`` and the body (the two lines and their headings);
 4. Gene approves Printer step 2; a second approve with the old rev is 409
    "This step changed. Look again.";
 5. an agent over a real stdio ``objectapp-mcp`` session: the tool list holds the eight work
    tools; ``step_action(complete)`` on Printer step 2 logs ``Work completed step 2: …``;
    Gene's ``reopen`` of it is 422 "A done Approve step never reopens."; the agent's
    ``step_action(approve)`` on step 3 fails with "Only you can do this to a step.";
    with ``--read-only`` only ``work_items`` and ``work_item`` of the work tools are listed;
 6. Badge reader (CRLF + BOM): ``done`` on its Do step keeps CRLF and the BOM; setting
    ``ticketId`` to ``OPS-124`` through ``PUT /api/object/properties`` infers System Jira;
 7. ``PUT /api/object/properties`` with ``steps`` is 422 "Steps change with the step actions.";
 8. ``POST /api/types/project/work-fields`` makes Scanner rollout a work item; the Tickets
    view's structures include ``project``;
 9. ``POST /api/work/close`` on Printer: status Done, ``completed`` stamped, the close notes
    hold ``Verification: Spooler restarted, 20 test prints clean``;
10. the clock moves to 2026-11-20: Printer (closed 15 days earlier) leaves the active list and
    stays in ``?scope=all``;
11. ``git status`` lists only the files the checks changed (the edited Tasks and the Project
    type file), nothing under ``.object/queries``; the state dir holds no work files.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from m2_acceptance import Run, changed_paths, commit, git, hunk_keys, remove_tree, snapshot
from m8_acceptance import Served
from m11_acceptance import call
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.space import Space
from objectapp.textfile import decode

REPO = Path(__file__).resolve().parents[1]
DEFAULT_SPACE = REPO / "backend" / "tests" / "fixtures" / "space-work"
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE")
NOW = "2026-11-05T10:00:00Z"
LATER = "2026-11-20T10:00:00Z"

PRINTER = "Tasks/Printer jams on line 3.md"
BADGE = "Tasks/Badge reader audit.md"
PARKED = "Tasks/Parked thing.md"
DESK = "Tasks/Desk closed it.md"
SCANNER = "Projects/Scanner rollout.md"
TOKEN_NAME = "Work"
STEP_CHANGED = "This step changed. Look again."
WORK_READ = {"work_items", "work_item"}
WORK_WRITE = {"step_action", "edit_steps", "log_activity", "add_work_note", "set_work_fields",
              "update_floor_item"}


# -- plumbing ------------------------------------------------------------------------------


def set_clock(path: Path, iso: str) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(iso, encoding="utf-8")
    os.replace(tmp, path)


def fm_of(root: Path, rel: str) -> dict:
    return parse_fm(split_object(decode((root / rel).read_bytes()).text).frontmatter_src or "")


def clean(root: Path) -> bool:
    return git(root, "status", "--porcelain", "--untracked-files=all").strip() == ""


def bearer(base: str, token: str, method: str, route: str, payload: Any = None) -> tuple[int, Any]:
    """One ``/api/v1`` call with the token (the agent's own HTTP, as objectapp-mcp makes it)."""
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + route, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body or b"null")
        except ValueError:
            return e.code, body.decode(errors="replace")


class Mcp:
    """One stdio MCP session against ``objectapp-mcp`` (as Claude Code starts it)."""

    def __init__(self, url: str, token: str, *extra: str) -> None:
        env = {**os.environ, "OBJECT_API_URL": url, "OBJECT_API_TOKEN": token}
        self.params = StdioServerParameters(
            command="uv", args=["run", "--directory", str(REPO), "objectapp-mcp", *extra], env=env
        )

    async def run(self, steps):
        async with stdio_client(self.params) as (read, write), ClientSession(read, write) as session:
            await session.initialize()
            return await steps(session)


# -- checks --------------------------------------------------------------------------------


class M22:
    def __init__(self, root: Path, run: Run, clock: Path, state: Path, url: str) -> None:
        self.root, self.run, self.clock, self.state, self.url = root, run, clock, state, url
        self.base = ""
        self.secret = ""
        self.made: set[str] = set()
        """Paths the checks changed on purpose."""

    @property
    def http(self):
        return self.run.http

    def item(self, path: str) -> dict:
        code, res = self.http("GET", "/work/item", path=path)
        assert code == 200, (path, code, res)
        return res

    def step(self, path: str, n: int) -> dict:
        return self.item(path)["steps"][n - 1]

    def items(self, scope: str | None = None) -> dict[str, dict]:
        code, res = self.http("GET", "/work/items", scope=scope)
        assert code == 200, (code, res)
        return {i["path"]: i for i in res["items"]}

    def act(self, path: str, step: dict, action: str, **extra: Any) -> tuple[int, Any]:
        body = {"path": path, "stepId": step["id"], "stepRev": step["rev"], "action": action, **extra}
        return self.http("POST", "/work/step", body)

    # 0 ---------------------------------------------------------------------------------
    def prepare(self) -> None:
        _, cur = self.http("GET", "/settings")
        code, res = self.http("PUT", "/settings", {"patch": {"timeZone": "UTC"}, "baseRevision": cur["revision"]})
        assert code == 200, (code, res)
        code, tok = self.http("POST", "/integrations/tokens", {"name": TOKEN_NAME, "scope": "read-write"})
        assert code == 201, (code, tok)
        self.secret = tok["secret"]
        self.base = git(self.root, "rev-parse", "HEAD").strip()
        print(f"   Time zone UTC; read-write token {TOKEN_NAME!r} made")

    # 1 ---------------------------------------------------------------------------------
    def reads(self) -> None:
        print("\n1. Reads write nothing")
        state_before = sorted(p.name for p in self.state.rglob("*"))
        active = self.items()
        every = self.items("all")
        bad = []
        for path in sorted(every):
            code, res = self.http("GET", "/work/item", path=path)
            if code != 200:
                bad.append(f"{path}: {code} {res}")
        for route in ("/queries", "/space"):
            code, _ = self.http("GET", route)
            if code != 200:
                bad.append(f"{route}: {code}")
        self.run.report(not bad, f"every read answered ({len(active)} active, {len(every)} in all)", *bad)
        status = git(self.root, "status", "--short").strip()
        self.run.report(not status, "git status clean after every read", *([status] if status else []))
        state_after = sorted(p.name for p in self.state.rglob("*"))
        self.run.report(state_after == state_before, "state dir unchanged by the reads",
                        *sorted(set(state_after) ^ set(state_before)))

    # 2 ---------------------------------------------------------------------------------
    def turns(self) -> None:
        print("\n2. Turns, stages and the Tickets view")
        active = self.items()
        every = self.items("all")
        titles = sorted(i["title"] for i in active.values())
        want = sorted(["Printer jams on line 3", "Badge reader audit", "Order toner", "Last week fix",
                       "Parked thing", "Desk closed it", "Hand edited"])
        self.run.report(titles == want, f"active items: {titles}")
        extra = sorted({i["title"] for i in every.values()} - set(titles))
        self.run.report(extra == ["Old cleanup"], f"scope=all adds {extra}")
        p, b, k, d = active[PRINTER], active[BADGE], active[PARKED], active[DESK]
        order = next(i for i in active.values() if i["title"] == "Order toner")
        self.run.report(p["turn"] == "approve" and p["current"]["n"] == 2 and p["stage"] == "doing",
                        f"Printer: turn {p['turn']}, current step {p['current'] and p['current']['n']}, stage {p['stage']}")
        self.run.report(k["turn"] == "parked" and k["stage"] == "parked", f"Parked thing: turn {k['turn']}, stage {k['stage']}")
        self.run.report(d["turn"] == "close" and d["deskSays"] == "Resolved" and d["status"] == "In Progress",
                        f"Desk closed it: turn {d['turn']}, desk says {d['deskSays']}, status {d['status']}")
        self.run.report(order["turn"] == "none", f"Order toner: turn {order['turn']}")
        self.run.report(b["stage"] == "notStarted" and b["turn"] == "you", f"Badge: turn {b['turn']}, stage {b['stage']}")
        self.run.report(p["ticket"]["deskPriority"] == "Medium" and p["ticket"]["system"] == "ServiceNow",
                        f"Printer desk priority {p['ticket']['deskPriority']} (Moderate), system {p['ticket']['system']}")
        self.run.report(b["ticket"]["system"] == "Jira" and "system:" not in self.run.text(BADGE),
                        f"Badge system {b['ticket']['system']} (inferred for display; the file has none)")
        code, res = bearer(self.url + "/api", self.secret, "POST", "/v1/queries/work-tickets/run", {"limit": 200})
        listed = sorted(r.get("path") for r in res.get("rows", [])) if code == 200 else res
        self.run.report(listed == sorted([PRINTER, BADGE, DESK]), f"the Tickets view lists {listed}")
        self.run.report(clean(self.root), "still nothing written")

    # 3 ---------------------------------------------------------------------------------
    def answer(self) -> None:
        print("\n3. Gene answers Parked thing's question")
        before = self.run.text(PARKED)
        q = self.step(PARKED, 1)
        code, res = self.act(PARKED, q, "answer", text="Night shift first")
        if not self.run.report(code == 200, f"answer: {code}", *([] if code == 200 else [str(res)])):
            return
        self.made.add(PARKED)
        after = self.run.text(PARKED)
        removed, added, _, _ = hunk_keys(self.root, PARKED, before, after)
        self.run.report((removed | added) <= {"steps", "lastUpdated", "<body>"},
                        f"diff keys: removed {sorted(removed)}, added {sorted(added)}")
        new_lines = [ln for ln in after.splitlines() if ln not in before.splitlines()]
        acts = [ln for ln in new_lines if ln.startswith("- 2026-11-05 10:00 Gene answered step 1")]
        notes = [ln for ln in new_lines if ln.startswith("- [2026-11-05] Gene: answered step 1")]
        bullets = [ln for ln in new_lines if ln.startswith("- ")]
        self.run.report(len(acts) == 1 and len(notes) == 1 and len(bullets) == 2,
                        f"one Activity and one Work notes line: {bullets}")
        body_new = [ln for ln in new_lines if ln.strip() and not ln.startswith((" ", "lastUpdated:"))]
        self.run.report(set(body_new) - set(bullets) <= {"## Activity", "## Work notes"},
                        f"other new body lines: {sorted(set(body_new) - set(bullets))}")
        commit(self.root, "check 3")

    # 4 ---------------------------------------------------------------------------------
    def approve(self) -> None:
        print("\n4. Gene approves Printer step 2; a second approve is refused")
        s2 = self.step(PRINTER, 2)
        code, res = self.act(PRINTER, s2, "approve")
        ok = code == 200 and res["item"]["steps"][1]["state"] == "approved"
        self.run.report(ok, f"approve: {code} {res.get('activity') if code == 200 else res}")
        self.made.add(PRINTER)
        before = (self.root / PRINTER).read_bytes()
        code, res = self.act(PRINTER, s2, "approve")
        self.run.report(code == 409 and res.get("detail") == STEP_CHANGED
                        and (self.root / PRINTER).read_bytes() == before,
                        f"second approve with the old rev: {code} {res.get('detail') if isinstance(res, dict) else res}")
        self.run.report(self.run.text(PRINTER).count("APPROVED") == 1, "one APPROVED line in the file")
        commit(self.root, "check 4")

    # 5 ---------------------------------------------------------------------------------
    def agent(self) -> None:
        print("\n5. An agent over objectapp-mcp")
        url = self.url

        async def session(s: ClientSession) -> None:
            names = {t.name for t in (await s.list_tools()).tools}
            missing = sorted((WORK_READ | WORK_WRITE) - names)
            self.run.report(not missing, f"the eight work tools are listed ({len(names)} tools)", *missing)
            ok, item = await call(s, "work_item", path=PRINTER)
            if not self.run.report(ok, "work_item(Printer)", *([] if ok else [str(item)])):
                return
            s2 = item["steps"][1]
            ok, res = await call(s, "step_action", path=PRINTER, step_id=s2["id"], step_rev=s2["rev"],
                                 action="complete", text="Spooler restarted, queue flowing")
            line = res.get("activity", "") if ok and isinstance(res, dict) else str(res)
            self.run.report(ok and "Work completed step 2: " in line, f"complete: {line}")
            s2 = self.step(PRINTER, 2)
            before = (self.root / PRINTER).read_bytes()
            code, ans = self.act(PRINTER, s2, "reopen")
            self.run.report(code == 422 and ans.get("detail") == "A done Approve step never reopens."
                            and (self.root / PRINTER).read_bytes() == before,
                            f"Gene's reopen of the done Approve step: {code} {ans}")
            s3 = self.step(PRINTER, 3)
            ok, res = await call(s, "step_action", path=PRINTER, step_id=s3["id"], step_rev=s3["rev"],
                                 action="approve")
            self.run.report(not ok and "Only you can do this to a step." in str(res),
                            f"agent approve on step 3: {res}")
            self.run.report((self.root / PRINTER).read_bytes() == before, "the refusal wrote nothing")

        asyncio.run(Mcp(url, self.secret).run(session))
        text = self.run.text(PRINTER)
        self.run.report("Work completed step 2: Spooler restarted, queue flowing" in text,
                        "the Activity line is in the file under the token's name")

        async def read_only(s: ClientSession) -> None:
            names = {t.name for t in (await s.list_tools()).tools}
            work = sorted(names & (WORK_READ | WORK_WRITE))
            self.run.report(work == sorted(WORK_READ), f"--read-only lists the work tools {work}")

        asyncio.run(Mcp(url, self.secret, "--read-only").run(read_only))
        commit(self.root, "check 5")

    # 6 ---------------------------------------------------------------------------------
    def badge(self) -> None:
        print("\n6. Badge reader (CRLF + BOM)")
        s1 = self.step(BADGE, 1)
        code, res = self.act(BADGE, s1, "done")
        self.run.report(code == 200, f"done on the Do step: {code} {res.get('activity') if code == 200 else res}")
        self.made.add(BADGE)
        raw = (self.root / BADGE).read_bytes()
        lone_lf = raw.replace(b"\r\n", b"").count(b"\n")
        bom = raw.startswith(b"\xef\xbb\xbf")
        self.run.report(bom and lone_lf == 0, f"BOM kept: {bom}; lines without CR: {lone_lf}")
        version = self.item(BADGE)["version"]
        code, res = self.http("PUT", "/object/properties",
                              {"path": BADGE, "updates": {"ticketId": "OPS-124"}, "baseVersion": version})
        fm = fm_of(self.root, BADGE)
        self.run.report(code == 200 and fm.get("ticketId") == "OPS-124" and fm.get("system") == "Jira",
                        f"ticketId OPS-124: {code}; system in the file: {fm.get('system')!r}")
        raw = (self.root / BADGE).read_bytes()
        self.run.report(raw.startswith(b"\xef\xbb\xbf") and raw.replace(b"\r\n", b"").count(b"\n") == 0,
                        "CRLF and BOM still kept after the property write")
        commit(self.root, "check 6")

    # 7 ---------------------------------------------------------------------------------
    def gate(self) -> None:
        print("\n7. Generic property writes refuse steps")
        before = (self.root / BADGE).read_bytes()
        version = self.item(BADGE)["version"]
        code, res = self.http("PUT", "/object/properties",
                              {"path": BADGE, "updates": {"steps": []}, "baseVersion": version})
        self.run.report(code == 422 and isinstance(res, dict) and res.get("detail") == "Steps change with the step actions."
                        and (self.root / BADGE).read_bytes() == before,
                        f"PUT /api/object/properties with steps: {code} {res}")

    # 8 ---------------------------------------------------------------------------------
    def add_fields(self) -> None:
        print("\n8. Add work fields to Project")
        project = self.run.type_named("Project")
        code, res = self.http("POST", "/types/project/work-fields", {"baseRevision": project["revision"]})
        self.run.report(code == 200 and "steps" in res.get("added", []),
                        f"add work fields: {code}; added {len(res.get('added', [])) if code == 200 else res}")
        self.made.add(".object/types/project.json")
        scanner = self.items().get(SCANNER)
        self.run.report(scanner is not None and scanner["turn"] == "approve",
                        f"Scanner rollout is a work item: turn {scanner and scanner['turn']}")
        _, queries = self.http("GET", "/queries")
        tickets = next((q for q in queries if q["id"] == "work-tickets"), None)
        structures = sorted(s["id"] for s in tickets["definition"]["structures"]) if tickets else []
        self.run.report("project" in structures, f"the Tickets view's structures: {structures}")
        commit(self.root, "check 8")

    # 9 ---------------------------------------------------------------------------------
    def close(self) -> None:
        print("\n9. Close Printer")
        version = self.item(PRINTER)["version"]
        code, res = self.http("POST", "/work/close", {"path": PRINTER, "baseVersion": version})
        if not self.run.report(code == 200, f"close: {code} {res.get('activity') if code == 200 else res}"):
            return
        fm = fm_of(self.root, PRINTER)
        self.run.report(fm.get("status") == "Done" and bool(fm.get("completed")),
                        f"status {fm.get('status')!r}, completed {fm.get('completed')!r}")
        notes = (res["item"].get("resolution") or {}).get("closeNotes", "")
        self.run.report("Verification: Spooler restarted, 20 test prints clean" in notes,
                        "the close notes hold the verification", *notes.splitlines()[:6])
        commit(self.root, "check 9")

    # 10 --------------------------------------------------------------------------------
    def later(self) -> None:
        print("\n10. Fifteen days later")
        set_clock(self.clock, LATER)
        active, every = self.items(), self.items("all")
        self.run.report(PRINTER not in active and PRINTER in every,
                        f"Printer in active: {PRINTER in active}; in all: {PRINTER in every}")

    # 11 --------------------------------------------------------------------------------
    def git_status(self) -> None:
        print("\n11. Only the intended files changed")
        status = git(self.root, "status", "--porcelain", "-uall")
        untracked = {ln[3:].strip().strip('"') for ln in status.splitlines() if ln.startswith("??")}
        tracked = set(git(self.root, "diff", "--name-only", self.base).splitlines())
        changed = sorted((untracked | tracked) - {""})
        extra = [c for c in changed if c not in self.made]
        missing = sorted(self.made - set(changed))
        queries = [c for c in changed if c.startswith(".object/queries")]
        self.run.report(not extra and not missing and not queries,
                        f"changed: {changed}", *([f"unexpected {extra}"] if extra else []),
                        *([f"missing {missing}"] if missing else []))
        work_state = sorted(str(p.relative_to(self.state)) for p in self.state.rglob("*")
                            if "work" in p.name.lower() and not p.name.startswith("work-queue-"))  # M24's queue
        self.run.report(not work_state, f"no work files in the state dir {work_state}")


# -- main ----------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path, nargs="?", default=DEFAULT_SPACE)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m22-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    state = tmp / "state"
    clock = tmp / "clock.txt"
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    os.environ.update({
        "OBJECT_STATE_DIR": str(state),
        "OBJECT_CACHE_DIR": str(tmp / "cache"),
        "OBJECT_CLOCK_FILE": str(clock),
    })
    set_clock(clock, NOW)
    git(root, "init", "-q")
    commit(root, "base")
    original = snapshot(root)
    Space(root)  # an older space is migrated on its first open; commit that
    opened = changed_paths(original, snapshot(root))
    commit(root, "opened once")

    served: Served | None = None
    run: Run | None = None
    try:
        served = Served(root)
        run = Run(root, served.http)
        url = served.base.removesuffix("/api")
        state.mkdir(parents=True, exist_ok=True)
        m22 = M22(root, run, clock, state, url)
        print(f"Space copy: {root}\nServed at: {url}")
        md = [p for p in opened if p.endswith(".md")]
        run.report(not md, f"opening wrote no .md file (opening changed {opened})")
        m22.prepare()
        m22.reads()
        m22.turns()
        m22.answer()
        m22.approve()
        m22.agent()
        m22.badge()
        m22.gate()
        m22.add_fields()
        m22.close()
        m22.later()
        m22.git_status()
    except Exception as exc:  # report a crash as a failure, then clean up
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
