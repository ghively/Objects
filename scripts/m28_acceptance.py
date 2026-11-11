"""Milestone 28 acceptance run over HTTP (the IT ops starter and two-way relations).

Usage: ``uv run python scripts/m28_acceptance.py [SPACE] [--keep]``
(default SPACE: ``backend/tests/fixtures/space-itops``)

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo (again after one open, so the checks see only what the app does), sets
``OBJECT_STATE_DIR`` and ``OBJECT_CACHE_DIR`` to temporary paths outside the copy and serves
``create_app`` on a free ``127.0.0.1`` port. No agent runs, so the fake ``claude`` is not
needed. The checks (run in this order; the plan's checks 6 and 7, the rows and the graph, run
before the counterpart edits, which change the links they read):

 1. reads write nothing: ``GET /api/space``, ``GET /api/object`` of every object,
    ``POST /api/rows``, ``GET /api/graph`` and ``GET /api/type-gallery`` leave ``git status``
    clean;
 2. ``POST /api/spaces {"name": "Ops", "location": <temp>, "setup": "itops"}``: the new folder
    has the 17 IT ops types (beside Page, Tag, Task, DailyNote; M32), 16 templates and 30 tags; a new empty folder, served, with
    ``POST /api/space/setup {"setup": "itops"}`` gets the same; a second call is 200 and writes nothing, ``blank`` is 409 (M32);
 3. APP-TEST-01's counterparts: Runs (Inventory app, inventory-web), Documented in (Restart the
    inventory app); Rack A's Contains lists APP-TEST-01; Windows Server 2022's Installed on
    lists both hosts;
 4. ``POST /api/rows {"typeIds": ["host"]}``: APP-TEST-01's ``values.runs`` has two EntityRefs;
 5. ``GET /api/graph``: the Inventory app <-> APP-TEST-01 pair is labelled ``Runs on``;
 6. ``POST /api/object/counterpart`` adds Inventory app to DB-TEST-01's Runs: only
    ``Applications/Inventory app.md`` changed, keys ``runsOn`` and ``lastUpdated``
    (``hunk_keys``); DB-TEST-01's file unchanged;
 7. removing it again from APP-TEST-01's Runs (CRLF + BOM): APP-TEST-01's bytes unchanged,
    Inventory app's ``runsOn`` is ``[[DB-TEST-01]]`` alone;
 8. ``PUT /api/types/application`` with ``runsOn``'s counterpart key ``category`` is 422
    ``Host already has a property with the key "category".``; the type file unchanged;
 9. ``GET /api/v1/object`` with a read token made through ``/api/integrations/tokens``:
    ``counterparts`` present;
10. ``git status`` lists only the files the checks changed (Inventory app), nothing in
    ``.object/``.

Checks 6 and 10 set aside one write that is not M28's: a space with no ``spaceId`` in
``.object/space.json`` (the fixture) gets it on the first app write (the version history's
snapshot, 2026-11-08), never on open. The run accepts ``space.json`` when that added key is its
only change, and says so; any other change to it fails. Check 1 counts every file.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from m2_acceptance import Run, changed_paths, commit, git, hunk_keys, remove_tree, snapshot
from m8_acceptance import Served
from objectapp.basicsetup import ITOPS_TAGS, ITOPS_TYPE_IDS
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.space import Space
from objectapp.textfile import decode

REPO = Path(__file__).resolve().parents[1]
DEFAULT_SPACE = REPO / "backend" / "tests" / "fixtures" / "space-itops"
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR")

APP01 = "Hosts/APP-TEST-01.md"
DB01 = "Hosts/DB-TEST-01.md"
INVENTORY = "Applications/Inventory app.md"
WEB = "Containers/inventory-web.md"
RUNBOOK = "Runbooks/Restart the inventory app.md"
RACK_A = "Locations/Rack A.md"
WINDOWS = "Software/Windows Server 2022.md"
APPLICATION_JSON = ".object/types/application.json"
TAKEN = 'Host already has a property with the key "category".'
ALREADY = "This space already has a starting point."


# -- plumbing ------------------------------------------------------------------------------


def fm_of(root: Path, rel: str) -> dict:
    return parse_fm(split_object(decode((root / rel).read_bytes()).text).frontmatter_src or "")


def porcelain(root: Path) -> list[str]:
    out = git(root, "status", "--porcelain", "--untracked-files=all")
    return [line[3:].strip('"') for line in out.splitlines() if line.strip()]


def only_space_id_added(root: Path) -> bool:
    """True when ``.object/space.json`` differs from HEAD only by an added ``spaceId``.

    The space's stable id (2026-11-08, `spaceconfig.ensure_space_id`) is written on the first
    app write to a space that has none (the version history snapshot), never on open; the
    fixture has none, so the first counterpart edit adds it. That one key is not M28's write.
    """
    try:
        before = json.loads(git(root, "show", "HEAD:.object/space.json"))
        after = json.loads((root / ".object" / "space.json").read_text("utf-8"))
    except (OSError, ValueError, subprocess.CalledProcessError):
        return False
    return "spaceId" not in before and "spaceId" in after and {
        k: v for k, v in after.items() if k != "spaceId"
    } == before


def written(root: Path) -> tuple[list[str], list[str]]:
    """(``git status`` paths but a ``space.json`` that only gained its ``spaceId``, notes)."""
    dirty = porcelain(root)
    if ".object/space.json" in dirty and only_space_id_added(root):
        return [p for p in dirty if p != ".object/space.json"], [
            ".object/space.json gained only its spaceId (the history's first write; not counted)"
        ]
    return dirty, []


def bearer(base: str, token: str, route: str, **query: str) -> tuple[int, Any]:
    """One ``/api/v1`` GET with the token (as an agent's own HTTP makes it)."""
    from urllib.parse import urlencode

    req = urllib.request.Request(base + route + ("?" + urlencode(query) if query else ""))
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body or b"null")
        except ValueError:
            return e.code, body.decode(errors="replace")


def setup_files(root: Path) -> tuple[set[str], list[str], list[str]]:
    """(type ids, template paths, tag paths) a starting point wrote into ``root``."""
    types = {p.stem for p in (root / ".object" / "types").glob("*.json")}
    templates = sorted(p.relative_to(root).as_posix() for p in (root / "Templates").rglob("*.md"))
    tags = sorted(p.relative_to(root).as_posix() for p in (root / "Tags").glob("*.md"))
    return types, templates, tags


def merged(rows: list[dict]) -> dict[str, tuple[str, set[str]]]:
    """Counterpart rows merged by key, as the object page shows them: key -> (name, paths)."""
    out: dict[str, tuple[str, set[str]]] = {}
    for r in rows:
        name, paths = out.get(r["key"], (r["name"], set()))
        out[r["key"]] = (name, paths | set(r["paths"]))
    return out


# -- checks --------------------------------------------------------------------------------


class M28:
    def __init__(self, root: Path, run: Run, tmp: Path, url: str) -> None:
        self.root, self.run, self.tmp, self.url = root, run, tmp, url
        self.http = run.http

    # 1 ---------------------------------------------------------------------------------
    def reads(self) -> None:
        print("\n1. Reads write nothing")
        code, info = self.http("GET", "/space")
        ok = code == 200
        code, objs = self.http("GET", "/objects")
        ok = ok and code == 200
        bad = []
        for o in objs:
            c, _ = self.http("GET", "/object", path=o["path"])
            if c != 200:
                bad.append(f"{o['path']}: {c}")
        type_ids = [t["id"] for t in info["types"]]
        c_rows, _ = self.http("POST", "/rows", {"typeIds": type_ids})
        c_graph, _ = self.http("GET", "/graph")
        c_gallery, _ = self.http("GET", "/type-gallery")
        dirty = porcelain(self.root)
        self.run.report(
            ok and not bad and (c_rows, c_graph, c_gallery) == (200, 200, 200) and not dirty,
            f"GET /api/space, GET /api/object x{len(objs)}, POST /api/rows, GET /api/graph and "
            "GET /api/type-gallery leave git status clean",
            *(f"failed: {b}" for b in bad),
            *([f"rows {c_rows}, graph {c_graph}, gallery {c_gallery}"] if (c_rows, c_graph, c_gallery) != (200, 200, 200) else []),
            *(f"changed: {p}" for p in dirty),
        )

    # 2 ---------------------------------------------------------------------------------
    def setup(self) -> None:
        print("\n2. IT operations as a starting point")
        want_types = set(ITOPS_TYPE_IDS)
        want_tags = sorted(f"Tags/{n}.md" for n in ITOPS_TAGS)
        loc = self.tmp / "new-spaces"
        loc.mkdir()
        code, res = self.http("POST", "/spaces", {"name": "Ops", "location": str(loc), "setup": "itops"})
        if not self.run.report(code == 201, "POST /api/spaces with setup itops is 201", f"{code} {res}"):
            return
        created = Path(res["path"])
        types, templates, tags = setup_files(created)
        space_json = json.loads((created / ".object" / "space.json").read_text("utf-8"))
        # M32: beside the four types every new space starts with.
        starting = {"page", "tag", "task", "dailynote"}
        self.run.report(
            types == want_types | starting and len(templates) == 16 and tags == want_tags
            and space_json.get("setup") == "itops",
            "the new space has the 17 IT ops types (and Page, Tag, Task, DailyNote), 16 templates and 30 seed "
            "tags, setup itops",
            f"types {len(types)}, templates {len(templates)}, tags {len(tags)}, setup {space_json.get('setup')!r}",
        )

        empty = self.tmp / "empty-space"
        empty.mkdir()
        served = Served(empty)
        try:
            c1, info = served.http("POST", "/space/setup", {"setup": "itops"})
            before_again = setup_files(empty)
            # M32: the starter can be added again (from the type gallery): nothing is replaced or
            # added; only the plain start is refused once the space has one.
            c2, again = served.http("POST", "/space/setup", {"setup": "itops"})
            c3, plain = served.http("POST", "/space/setup", {"setup": "blank"})
        finally:
            served.stop()
        types, templates, tags = setup_files(empty)
        self.run.report(
            c1 == 200 and want_types <= types and len(templates) == 16 and tags == want_tags
            and isinstance(info, dict) and info.get("needsSetup") is False,
            "an empty folder with POST /api/space/setup itops gets the same types, templates and tags",
            f"{c1}; IT ops types {len(want_types & types)}, templates {len(templates)}, tags {len(tags)}",
        )
        self.run.report(c2 == 200 and (types, templates, tags) == before_again,
                        "a second itops setup is 200 and writes nothing more", f"{c2}")
        detail = plain.get("detail") if isinstance(plain, dict) else plain
        self.run.report(c3 == 409 and detail == ALREADY, "the plain start is 409 once the space has one",
                        f"{c3} {plain}")

    # 3 ---------------------------------------------------------------------------------
    def counterparts(self) -> None:
        print("\n3. Counterparts on the target objects")
        rows = merged(self.run.obj(APP01).get("counterparts") or [])
        runs = rows.get("runs")
        documented = rows.get("documentedIn")
        self.run.report(
            runs == ("Runs", {INVENTORY, WEB}) and documented == ("Documented in", {RUNBOOK}),
            "APP-TEST-01: Runs lists Inventory app and inventory-web; Documented in lists the runbook",
            f"runs {runs}, documentedIn {documented}",
        )
        contains = merged(self.run.obj(RACK_A).get("counterparts") or []).get("contains")
        self.run.report(contains == ("Contains", {APP01}), "Rack A: Contains lists APP-TEST-01", f"{contains}")
        installed = merged(self.run.obj(WINDOWS).get("counterparts") or []).get("installedOn")
        self.run.report(
            installed == ("Installed on", {APP01, DB01}),
            "Windows Server 2022: Installed on lists both hosts",
            f"{installed}",
        )

    # 4 ---------------------------------------------------------------------------------
    def rows(self) -> None:
        print("\n4. Rows carry counterpart values")
        code, res = self.http("POST", "/rows", {"typeIds": ["host"]})
        row = next((r for r in res.get("rows", []) if r["summary"]["path"] == APP01), None) if code == 200 else None
        runs = row["values"].get("runs") if row else None
        want = [{"target": "Inventory app", "path": INVENTORY}, {"target": "inventory-web", "path": WEB}]
        self.run.report(runs == want, "APP-TEST-01's values.runs holds the two EntityRefs", f"{code} {runs}")

    # 5 ---------------------------------------------------------------------------------
    def graph(self) -> None:
        print("\n5. The graph labels relation edges")
        code, data = self.http("GET", "/graph")
        label = "<no pair>"
        if code == 200:
            nodes, flat, labels = data["nodes"], data["links"], data.get("linkLabels") or []
            for k in range(len(flat) // 2):
                pair = {nodes[flat[2 * k]]["path"], nodes[flat[2 * k + 1]]["path"]}
                if pair == {INVENTORY, APP01}:
                    label = labels[k] if k < len(labels) else "<missing>"
        self.run.report(label == "Runs on", "the Inventory app <-> APP-TEST-01 pair is labelled Runs on", f"{code} {label!r}")

    # 6 ---------------------------------------------------------------------------------
    def add_edit(self) -> None:
        print("\n6. Adding from the computed side writes only the stored side")
        before = self.run.text(INVENTORY)
        db_before = (self.root / DB01).read_bytes()
        code, res = self.http("POST", "/object/counterpart", {
            "path": DB01, "key": "runs", "sourceTypeId": "application", "add": [INVENTORY], "remove": [],
        })
        wrote = [w["path"] for w in res.get("written", [])] if code == 200 else []
        dirty, notes = written(self.root)
        removed, added, _, _ = hunk_keys(self.root, INVENTORY, before, self.run.text(INVENTORY))
        keys = removed | added
        runs_on = fm_of(self.root, INVENTORY).get("runsOn")
        self.run.report(
            code == 200 and wrote == [INVENTORY] and dirty == [INVENTORY]
            and keys <= {"runsOn", "lastUpdated"} and "runsOn" in added
            and runs_on == ["[[APP-TEST-01]]", "[[DB-TEST-01]]"],
            "POST /api/object/counterpart changes only Inventory app's runsOn and lastUpdated",
            f"{code}; written {wrote}; git status {dirty}; hunk keys {sorted(keys)}; runsOn {runs_on}",
            *notes,
        )
        self.run.report((self.root / DB01).read_bytes() == db_before, "DB-TEST-01's file is unchanged")

    # 7 ---------------------------------------------------------------------------------
    def remove_edit(self) -> None:
        print("\n7. Removing from a CRLF + BOM target")
        app_before = (self.root / APP01).read_bytes()
        code, res = self.http("POST", "/object/counterpart", {
            "path": APP01, "key": "runs", "sourceTypeId": "application", "add": [], "remove": [INVENTORY],
        })
        runs_on = fm_of(self.root, INVENTORY).get("runsOn")
        app_after = (self.root / APP01).read_bytes()
        self.run.report(
            code == 200 and app_after == app_before and app_before.startswith(b"\xef\xbb\xbf")
            and runs_on == ["[[DB-TEST-01]]"],
            "APP-TEST-01's bytes (CRLF + BOM) are unchanged; Inventory app's runsOn is DB-TEST-01 alone",
            f"{code} {res if code != 200 else ''}; runsOn {runs_on}",
        )

    # 8 ---------------------------------------------------------------------------------
    def type_save(self) -> None:
        print("\n8. A counterpart key taken on the target is refused")
        file_before = (self.root / APPLICATION_JSON).read_bytes()
        t = copy.deepcopy(next(t for t in self.run.types() if t["id"] == "application"))
        prop = next(p for p in t["propertyDefinitions"] if p["key"] == "runsOn")
        prop["options"]["counterpart"] = {"name": "Runs", "key": "category"}
        code, res = self.run.save_type(t)
        detail = res.get("detail") if isinstance(res, dict) else res
        self.run.report(code == 422 and detail == TAKEN, f"PUT /api/types/application is 422 {TAKEN}", f"{code} {res}")
        self.run.report((self.root / APPLICATION_JSON).read_bytes() == file_before, "the type file is unchanged")

    # 9 ---------------------------------------------------------------------------------
    def v1(self) -> None:
        print("\n9. /api/v1 reads carry counterparts")
        code, tok = self.http("POST", "/integrations/tokens", {"name": "M28 read", "scope": "read"})
        if not self.run.report(code == 201, "a read token is made", *([] if code == 201 else [f"{code} {tok}"])):
            return
        code, body = bearer(self.url + "/api", tok["secret"], "/v1/object", path=APP01)
        rows = body.get("counterparts") if code == 200 and isinstance(body, dict) else None
        self.run.report(
            bool(rows) and any(r["key"] == "runs" for r in rows),
            "GET /api/v1/object of APP-TEST-01 has counterparts",
            f"{code}; {len(rows or [])} rows",
        )

    # 10 --------------------------------------------------------------------------------
    def git_status(self) -> None:
        print("\n10. git status")
        dirty, notes = written(self.root)
        self.run.report(
            dirty == [INVENTORY] and not any(p.startswith(".object/") for p in dirty),
            "git status lists only Applications/Inventory app.md, nothing in .object/",
            *(f"changed: {p}" for p in dirty),
            *notes,
        )


# -- main ----------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path, nargs="?", default=DEFAULT_SPACE)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m28-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    os.environ.update({"OBJECT_STATE_DIR": str(tmp / "state"), "OBJECT_CACHE_DIR": str(tmp / "cache")})
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
        m28 = M28(root, run, tmp, url)
        m28.reads()
        m28.setup()
        m28.counterparts()
        m28.rows()
        m28.graph()
        m28.add_edit()
        m28.remove_edit()
        m28.type_save()
        m28.v1()
        m28.git_status()
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
