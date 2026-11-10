"""Milestone 29 acceptance run over HTTP and MCP (synced facts and type suggestion).

Usage: ``uv run python scripts/m29_acceptance.py [SPACE] [--keep]``
(default SPACE: ``backend/tests/fixtures/space-synced``)

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo (again after one open, so the checks see only what the app does), sets
``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR`` and ``OBJECT_CLOCK_FILE`` (2026-11-09T10:00:00Z) to
temporary paths outside the copy and serves ``create_app`` on a free ``127.0.0.1`` port. No
agent runs, so no ``claude`` (real or fake) is started. The checks:

 1. reads write nothing: ``GET /api/space`` (the types; the app has no ``GET /api/types``),
    ``GET /api/types/host/templates``, ``POST /api/rows`` and ``GET /api/object`` of every Host
    leave ``git status`` clean, and there is no ``.object/synced/``;
 2. a ``sync`` token made through ``POST /api/integrations/tokens {scope: "sync"}``;
    ``POST /api/v1/synced/host`` with the fixture's seven items answers updated x3, ambiguous,
    notFound x2 and invalid, in item order;
 3. ``git status`` after the sync lists only ``Hosts/Print box.md`` (its ``id`` line, by
    ``hunk_keys``) and ``.object/synced/host.json``; a second sync changes only
    ``.object/synced/host.json``; ``SRV-02.md`` still has CRLF and the BOM;
 4. ``GET /api/object`` of SRV-02 shows the store's ``lastBoot``, not the file's 2020 value;
    ``PUT /api/object/properties {diskFree}`` is 422
    ``"Disk free" is filled by Inventory script and can't be edited.``;
 5. the sync token on ``POST /api/v1/object/properties`` is 403
    ``This token can only write synced facts.``;
 6. over a stdio ``objectapp-mcp`` session with the sync token: the tool list has the read
    tools and ``sync_facts`` and no other write tool; ``sync_facts("Host", ...)`` updates
    APP01's ``diskFree``;
 7. the clock moves to 2026-11-17 (8 days on): APP01's row ``syncedAt`` is unchanged and older
    than 7 days (the UI marks it Stale);
 8. ``PUT /api/types/host`` with ``namePatterns: ["{foo}"]`` is 422; the type file unchanged;
 9. ``git status`` lists nothing else; the state dir holds the token file and the activity
    log only.

A space with no ``spaceId`` in ``.object/space.json`` gets it on the first app write (the
version history's snapshot, 2026-11-08), never on open; that one added key is not M29's write,
and the run says so when it sees it. Any other change to ``space.json`` fails.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

from m2_acceptance import Run, changed_paths, commit, git, hunk_keys, remove_tree, snapshot
from m8_acceptance import Served
from objectapp.space import Space
from objectapp.synced import is_stale
from objectapp.toolcatalog import OBJECT_READ, OBJECT_WRITE

REPO = Path(__file__).resolve().parents[1]
DEFAULT_SPACE = REPO / "backend" / "tests" / "fixtures" / "space-synced"
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE")
START = "2026-11-09T10:00:00Z"
LATER = "2026-11-17T10:00:00Z"

APP01 = "Hosts/APP01.md"
SRV02 = "Hosts/SRV-02.md"
PRINT = "Hosts/Print box.md"
WEB01 = "Hosts/WEB01.md"
LAB_WEB01 = "Hosts/Lab/WEB01.md"
STORE = ".object/synced/host.json"
HOST_JSON = ".object/types/host.json"
SPACE_JSON = ".object/space.json"
READ_ONLY = '"Disk free" is filled by Inventory script and can\'t be edited.'
SYNC_ONLY = "This token can only write synced facts."
BOOT = "2026-11-08T07:12:00.000Z"
STATE_FILES = {"api-tokens.json", "api-activity.jsonl"}


def item(by: str, value: Any, values: dict, key: str | None = None) -> dict:
    match: dict[str, Any] = {"by": by, "value": value}
    if key is not None:
        match["key"] = key
    return {"match": match, "values": values}


SEVEN = [
    item("title", "APP01", {"diskFree": 12}),
    item("alias", "PRN-TEST-01", {"rebootPending": True}),
    item("key", "app01.example.test", {"patchState": "Current"}, key="fqdn"),
    item("title", "WEB01", {"diskFree": 3}),
    item("title", "Gateway", {"diskFree": 3}),
    item("title", "Host template", {"diskFree": 3}),
    item("title", "SRV-02", {"diskFree": "lots"}),
]
WANT_STATUSES = ["updated", "updated", "updated", "ambiguous", "notFound", "notFound", "invalid"]


# -- plumbing ------------------------------------------------------------------------------


def porcelain(root: Path) -> list[str]:
    out = git(root, "status", "--porcelain", "--untracked-files=all")
    return sorted(line[3:].strip('"') for line in out.splitlines() if line.strip())


def only_space_id_added(root: Path) -> bool:
    """True when ``.object/space.json`` differs from HEAD only by an added ``spaceId`` (or is
    new and holds only that key): the history's first write, not M29's."""
    try:
        after = json.loads((root / SPACE_JSON).read_text("utf-8"))
    except (OSError, ValueError):
        return False
    try:
        before = json.loads(git(root, "show", f"HEAD:{SPACE_JSON}"))
    except (subprocess.CalledProcessError, ValueError):
        before = {}
    return "spaceId" not in before and "spaceId" in after and {
        k: v for k, v in after.items() if k != "spaceId"
    } == before


def written(root: Path) -> tuple[list[str], list[str]]:
    """(``git status`` paths but a ``space.json`` that only gained its ``spaceId``, notes)."""
    dirty = porcelain(root)
    if SPACE_JSON in dirty and only_space_id_added(root):
        return [p for p in dirty if p != SPACE_JSON], [
            ".object/space.json gained only its spaceId (the history's first write; not counted)"
        ]
    return dirty, []


def bearer(base: str, token: str, method: str, route: str, payload: Any = None) -> tuple[int, Any]:
    """One ``/api/v1`` call with the token (as a script's own HTTP makes it)."""
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


def detail(res: Any) -> Any:
    return res.get("detail") if isinstance(res, dict) else res


class Mcp:
    """One stdio MCP session against ``objectapp-mcp`` (as Claude Code starts it)."""

    def __init__(self, url: str, token: str) -> None:
        env = {**os.environ, "OBJECT_API_URL": url, "OBJECT_API_TOKEN": token}
        self.params = StdioServerParameters(
            command="uv", args=["run", "--directory", str(REPO), "objectapp-mcp"], env=env
        )

    async def run(self, steps):
        async with stdio_client(self.params) as (read, write), ClientSession(read, write) as session:
            await session.initialize()
            return await steps(session)


async def call(session: ClientSession, name: str, **args: Any) -> tuple[bool, Any]:
    """(ok, answer) of one tool call; the answer is the JSON it returned, or the error text."""
    res = await session.call_tool(name, args)
    text = " ".join(getattr(c, "text", "") for c in res.content)
    if res.is_error:
        return False, text
    if res.structured_content is not None:
        out = res.structured_content
        return True, out.get("result", out) if set(out) == {"result"} else out
    try:
        return True, json.loads(text)
    except ValueError:
        return True, text


# -- checks --------------------------------------------------------------------------------


class M29:
    def __init__(self, root: Path, run: Run, clock: Path, state: Path, url: str) -> None:
        self.root, self.run, self.clock, self.state, self.url = root, run, clock, state, url
        self.http = run.http
        self.v1 = url + "/api/v1"
        self.secret = ""

    def hosts(self) -> list[str]:
        code, objs = self.http("GET", "/objects", type="host")
        assert code == 200, (code, objs)
        return sorted(o["path"] for o in objs)

    def row(self, path: str) -> dict | None:
        code, res = self.http("POST", "/rows", {"typeIds": ["host"]})
        assert code == 200, (code, res)
        return next((r for r in res.get("rows", []) if r["summary"]["path"] == path), None)

    def sync(self, items: list[dict]) -> tuple[int, Any]:
        return bearer(self.v1, self.secret, "POST", "/synced/host", {"items": items})

    # 1 ---------------------------------------------------------------------------------
    def reads(self) -> None:
        print("\n1. Reads write nothing")
        c_space, _ = self.http("GET", "/space")
        c_tpl, _ = self.http("GET", "/types/host/templates")
        c_types = c_space if c_tpl == 200 else c_tpl
        c_rows, _ = self.http("POST", "/rows", {"typeIds": ["host"]})
        hosts = self.hosts()
        bad = []
        for path in hosts:
            code, res = self.http("GET", "/object", path=path)
            if code != 200:
                bad.append(f"{path}: {code} {res}")
        dirty = porcelain(self.root)
        synced_dir = (self.root / ".object" / "synced").exists()
        self.run.report(
            (c_types, c_rows) == (200, 200) and not bad and not dirty and not synced_dir,
            f"GET /api/space, GET /api/types/host/templates, POST /api/rows and GET /api/object x{len(hosts)} "
            "leave git status clean; "
            "no .object/synced/",
            *([f"space {c_space}, templates {c_tpl}, rows {c_rows}"] if (c_types, c_rows) != (200, 200) else []),
            *bad,
            *(f"changed: {p}" for p in dirty),
            *([".object/synced/ exists"] if synced_dir else []),
        )

    # 2 ---------------------------------------------------------------------------------
    def first_sync(self) -> None:
        print("\n2. A sync token and the first sync")
        code, tok = self.http("POST", "/integrations/tokens", {"name": "Inventory script", "scope": "sync"})
        ok = code == 201 and isinstance(tok, dict) and tok.get("token", {}).get("scope") == "sync"
        if not self.run.report(ok, "POST /api/integrations/tokens {scope: sync} is 201 with scope sync",
                               *([] if ok else [f"{code} {tok}"])):
            return
        self.secret = tok["secret"]
        code, who = bearer(self.v1, self.secret, "GET", "/whoami")
        self.run.report(
            code == 200 and isinstance(who, dict) and who.get("scope") == "sync",
            "GET /api/v1/whoami answers scope sync", f"{code} {who}",
        )
        self.print_before = (self.root / PRINT).read_text("utf-8")
        code, res = self.sync(SEVEN)
        results = res.get("results", []) if code == 200 and isinstance(res, dict) else []
        statuses = [r.get("status") for r in results]
        self.run.report(
            code == 200 and statuses == WANT_STATUSES and res.get("updated") == 3,
            "POST /api/v1/synced/host answers updated x3, ambiguous, notFound x2, invalid (in order)",
            f"{code}; {statuses}; updated {res.get('updated') if isinstance(res, dict) else res}",
        )
        if len(results) != 7:
            return
        paths = [r.get("path") for r in results[:3]]
        amb = sorted(results[3].get("paths") or [])
        notes = [r.get("detail") for r in results[3:]]
        want_notes = [
            '2 Hosts have the title "WEB01".',
            'No Host has the title "Gateway".',
            'No Host has the title "Host template".',
            "Expected a number.",
        ]
        self.run.report(
            paths == [APP01, PRINT, APP01] and amb == sorted([WEB01, LAB_WEB01]) and notes == want_notes,
            "APP01 (never Pages/APP01.md), Print box by alias, APP01 by fqdn; both WEB01s; the details",
            f"paths {paths}; ambiguous {amb}; details {notes}",
        )
        store = json.loads((self.root / STORE).read_text("utf-8"))
        app = store.get("01KM2900000000000000000001", {}).get("values")
        self.run.report(
            app == {"diskFree": 12, "patchState": "Current"} and len(store) == 2,
            "the store holds APP01 {diskFree 12, patchState Current} and Print box",
            f"APP01 {app}; {len(store)} objects",
        )

    # 3 ---------------------------------------------------------------------------------
    def files(self) -> None:
        print("\n3. A sync writes only the store (and one id line)")
        dirty, notes = written(self.root)
        removed, added, n_rem, n_add = hunk_keys(
            self.root, PRINT, self.print_before, (self.root / PRINT).read_text("utf-8")
        )
        self.run.report(
            dirty == sorted([STORE, PRINT]) and added == {"id"} and n_add == 1 and n_rem == 0,
            "git status lists only Hosts/Print box.md (one added id line) and .object/synced/host.json",
            f"git status {dirty}; Print box hunk keys -{sorted(removed)} ({n_rem}) +{sorted(added)} ({n_add})",
            *notes,
        )
        commit(self.root, "after the first sync")
        md_before = {p: (self.root / p).read_bytes() for p in self.hosts() + ["Pages/APP01.md"]}
        code, res = self.sync([
            item("title", "SRV-02", {"lastBoot": BOOT, "patchState": "Pending"}),
            item("title", "Print box", {"diskFree": 40}),
        ])
        dirty, notes = written(self.root)
        md_same = all((self.root / p).read_bytes() == b for p, b in md_before.items())
        self.run.report(
            code == 200 and isinstance(res, dict) and res.get("updated") == 2 and dirty == [STORE] and md_same,
            "a second sync (SRV-02 and Print box) changes only .object/synced/host.json",
            f"{code}; updated {res.get('updated') if isinstance(res, dict) else res}; git status {dirty}",
            *notes,
        )
        srv = (self.root / SRV02).read_bytes()
        crlf = srv.count(b"\r\n") > 0 and srv.count(b"\n") == srv.count(b"\r\n")
        self.run.report(srv.startswith(b"\xef\xbb\xbf") and crlf, "SRV-02.md still has CRLF and the BOM")
        commit(self.root, "after the second sync")

    # 4 ---------------------------------------------------------------------------------
    def read_only(self) -> None:
        print("\n4. The store wins, and synced values can't be edited")
        o = self.run.obj(SRV02)
        boot = (o.get("synced") or {}).get("values", {}).get("lastBoot")
        file_boot = (o.get("frontmatter") or {}).get("lastBoot")
        self.run.report(
            isinstance(boot, dict) and boot.get("start") == BOOT and file_boot == "2020-01-01T00:00:00.000Z",
            "GET /api/object of SRV-02 shows the store's lastBoot, not the file's 2020 value",
            f"synced {boot}; file {file_boot}",
        )
        app = self.run.obj(APP01)
        before = (self.root / APP01).read_bytes()
        code, res = self.http("PUT", "/object/properties",
                              {"path": APP01, "updates": {"diskFree": 5}, "baseVersion": app["version"]})
        self.run.report(
            code == 422 and detail(res) == READ_ONLY and (self.root / APP01).read_bytes() == before,
            f"PUT /api/object/properties {{diskFree}} is 422 {READ_ONLY}; APP01.md unchanged",
            f"{code} {res}",
        )

    # 5 ---------------------------------------------------------------------------------
    def sync_token_writes(self) -> None:
        print("\n5. A sync token writes only synced facts")
        version = self.run.obj(APP01)["version"]
        before = (self.root / APP01).read_bytes()
        code, res = bearer(self.v1, self.secret, "POST", "/object/properties",
                           {"path": APP01, "version": version, "set": {"ipAddress": "10.20.0.12"}})
        self.run.report(
            code == 403 and detail(res) == SYNC_ONLY and (self.root / APP01).read_bytes() == before,
            f"POST /api/v1/object/properties with the sync token is 403 {SYNC_ONLY}",
            f"{code} {res}",
        )

    # 6 ---------------------------------------------------------------------------------
    def mcp(self) -> None:
        print("\n6. sync_facts over objectapp-mcp with the sync token")
        async def steps(s: ClientSession) -> tuple[set[str], tuple[bool, Any]]:
            names = {t.name for t in (await s.list_tools()).tools}
            answer = await call(s, "sync_facts", type="Host", items=[
                item("title", "APP01", {"diskFree": 41.5}),
            ])
            return names, answer

        try:
            names, (ok, res) = asyncio.run(Mcp(self.url, self.secret).run(steps))
        except Exception as exc:  # noqa: BLE001 - a session that can't start is a failure
            self.run.report(False, "an objectapp-mcp session starts", repr(exc))
            return
        writes = (set(OBJECT_WRITE) - {"sync_facts"}) & names
        missing = set(OBJECT_READ) - names
        self.run.report(
            "sync_facts" in names and not writes and not missing,
            "the tool list has every read tool and sync_facts, and no other write tool",
            f"{len(names)} tools; missing reads {sorted(missing)}; other writes {sorted(writes)}",
        )
        disk = (self.run.obj(APP01).get("synced") or {}).get("values", {}).get("diskFree")
        statuses = [r.get("status") for r in res.get("results", [])] if ok and isinstance(res, dict) else res
        self.run.report(
            ok and statuses == ["updated"] and disk == 41.5,
            "sync_facts(\"Host\", ...) updates APP01's diskFree to 41.5",
            f"{statuses}; diskFree {disk}",
        )

    # 7 ---------------------------------------------------------------------------------
    def stale(self) -> None:
        print("\n7. Eight days on, APP01's facts are stale")
        before = (self.row(APP01) or {}).get("syncedAt")
        self.clock.write_text(LATER, encoding="utf-8")
        after = (self.row(APP01) or {}).get("syncedAt")
        now = datetime(2026, 11, 17, 10, 0, 0, tzinfo=UTC)
        self.run.report(
            before is not None and after == before and is_stale(after, 7, now),
            "APP01's row syncedAt is unchanged by the clock and older than 7 days (Stale)",
            f"syncedAt {before} -> {after}; now {LATER}",
        )

    # 8 ---------------------------------------------------------------------------------
    def type_save(self) -> None:
        print("\n8. A bad name pattern is refused on save")
        file_before = (self.root / HOST_JSON).read_bytes()
        t = copy.deepcopy(next(t for t in self.run.types() if t["id"] == "host"))
        t["namePatterns"] = ["{foo}"]
        code, res = self.run.save_type(t)
        self.run.report(
            code == 422 and isinstance(detail(res), str) and "{foo}" in detail(res),
            "PUT /api/types/host with namePatterns [\"{foo}\"] is 422", f"{code} {res}",
        )
        self.run.report((self.root / HOST_JSON).read_bytes() == file_before, "the type file is unchanged")

    # 9 ---------------------------------------------------------------------------------
    def git_status(self) -> None:
        print("\n9. git status and the state dir")
        dirty, notes = written(self.root)
        self.run.report(
            dirty == [STORE], "git status lists only .object/synced/host.json since the second sync",
            *(f"changed: {p}" for p in dirty), *notes,
        )
        names = {p.name for p in self.state.iterdir() if p.is_file()} if self.state.is_dir() else set()
        dirs = sorted(p.name for p in self.state.iterdir() if p.is_dir()) if self.state.is_dir() else []
        self.run.report(
            names == STATE_FILES and not dirs,
            "the state dir holds api-tokens.json and api-activity.jsonl only",
            f"files {sorted(names)}; folders {dirs}",
        )
        lines = (self.state / "api-activity.jsonl").read_text("utf-8").splitlines() if self.state.is_dir() else []
        syncs = [json.loads(x) for x in lines if x.strip()]
        syncs = [e for e in syncs if e.get("action") == "sync"]
        self.run.report(len(syncs) == 3, "one activity entry per sync call (3)", f"{len(syncs)} sync entries")


# -- main ----------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path, nargs="?", default=DEFAULT_SPACE)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m29-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    state = tmp / "state"
    clock = tmp / "clock.txt"
    clock.write_text(START, encoding="utf-8")
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    os.environ.update({
        "OBJECT_STATE_DIR": str(state), "OBJECT_CACHE_DIR": str(tmp / "cache"), "OBJECT_CLOCK_FILE": str(clock),
    })
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
        print(f"Space copy: {root}\nServed at: {url}")
        md = [p for p in opened if p.endswith(".md")]
        run.report(not md, f"opening wrote no .md file (opening changed {opened})")
        m29 = M29(root, run, clock, state, url)
        m29.reads()
        m29.first_sync()
        if m29.secret:
            m29.files()
            m29.read_only()
            m29.sync_token_writes()
            m29.mcp()
            m29.stale()
        m29.type_save()
        m29.git_status()
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
