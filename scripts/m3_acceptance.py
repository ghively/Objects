"""Milestone 3 acceptance run over HTTP (plan Task 16, Step 2).

Usage: ``uv run python scripts/m3_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the
copy to a throw-away git repo, opens it twice and serves the second `Space` on a
free ``127.0.0.1`` port. Over HTTP it then checks:

 1. opening twice and calling every M3 route that only reads changes no file;
 2. ``POST /api/rows`` returns one row per object, with the version of
    ``GET /api/object``;
 3. a collection "Tooling" joined by two objects, one already in "Other": each
    diff is the ``collections:`` line plus ``lastUpdated`` (and an inserted
    ``id:``), and the list reads ``[Other, Tooling]``;
 4. renaming "Tooling" to "Gear" rewrites only list items (``lastUpdated`` stays)
    and ``rewritten`` equals the set of changed files;
 5. delete "Gear" (428 without confirm, then confirmed with nothing skipped) and
    restore it from the Trash: every file outside ``.object/`` is
    byte-identical to before the delete;
 6. a views, a ui and a query write each change exactly one ``.object/`` file
    and no ``.md``; a second ``PUT /api/ui`` with the old revision is 409;
 7. ``POST /api/objects`` with ``values`` creates one file holding them;
 8. the M1 no-edit pass changes no file.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import re
import shutil
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

import uvicorn

from m2_acceptance import (
    HOST, Http, Run, changed_paths, check_migration, commit, free_port, git, hunk_keys, remove_tree, snapshot,
)
from objectapp.server import create_app

ALLOWED_MEMBERSHIP_KEYS = {"collections", "lastUpdated", "id"}


def md_files(paths: list[str]) -> list[str]:
    return [p for p in paths if p.lower().endswith(".md")]


def pick_members(run: Run) -> tuple[dict, dict]:
    """Two writable objects: `a` (to join "Other" first) and `b`, with their type ids."""
    _, objs = run.http("GET", "/objects")
    ok = [o for o in objs if not o.get("readOnly") and o.get("type")]
    pref = {"server": 0, "page": 1}
    ok.sort(key=lambda o: (pref.get(o["type"], 2), o["path"]))
    a = ok[0]
    b = next((o for o in ok[1:] if o["type"] != a["type"]), ok[1])
    return a, b


def put_collections(run: Run, path: str, names: list[str]) -> tuple[int, Any]:
    o = run.obj(path)
    return run.http("PUT", "/object/properties",
                    {"path": path, "updates": {"collections": names}, "baseVersion": o["version"]})


def check_open_and_reads(run: Run) -> None:
    print("\n1. Reading changes nothing")
    run.http("POST", "/rows", {})
    for t in run.types():
        run.http("GET", f"/views/{t['id']}")
    run.http("GET", "/collections")
    run.http("GET", "/queries")
    run.http("GET", "/ui")
    status = git(run.root, "status", "--porcelain", "-uall").strip()
    run.report(not status, "rows, views, collections, queries and ui GETs leave the tree clean",
               *([status] if status else []))


def check_rows(run: Run) -> None:
    print("\n2. Rows")
    _, objs = run.http("GET", "/objects")
    code, res = run.http("POST", "/rows", {})
    rows = res["rows"] if code == 200 else []
    paths = [r["summary"]["path"] for r in rows]
    same = sorted(paths) == sorted(o["path"] for o in objs)
    bad = [r["summary"]["path"] for r in rows if run.obj(r["summary"]["path"])["version"] != r["version"]]
    run.report(code == 200 and same and not bad,
               f"{len(rows)} rows for {len(objs)} objects, versions equal GET /object",
               *([f"version mismatch: {bad[:5]}"] if bad else []))


def check_membership(run: Run) -> tuple[dict, dict, dict]:
    print("\n3. Collection membership")
    a, b = pick_members(run)
    type_ids = sorted({a["type"], b["type"]})
    c1, other = run.http("POST", "/collections", {"name": "Other", "typeIds": type_ids})
    c2, tooling = run.http("POST", "/collections", {"name": "Tooling", "typeIds": type_ids})
    run.report(c1 == 201 and c2 == 201, "created Other and Tooling")
    code, _ = put_collections(run, a["path"], ["Other"])
    run.report(code == 200, f"{a['path']} joined Other")
    commit(run.root, "other")
    before = {p: run.text(p) for p in (a["path"], b["path"])}
    codes = [put_collections(run, a["path"], ["Other", "Tooling"])[0],
             put_collections(run, b["path"], ["Tooling"])[0]]
    problems = []
    for p in (a["path"], b["path"]):
        removed, added, _, _ = hunk_keys(run.root, p, before[p], run.text(p))
        extra = (removed | added) - ALLOWED_MEMBERSHIP_KEYS
        if extra:
            problems.append(f"{p}: touched {sorted(extra)}")
    line_ok = re.search(r"^collections: \[Other, Tooling\]\s*$", run.text(a["path"]), re.M) is not None
    run.report(codes == [200, 200] and not problems and line_ok,
               "each diff is the collections line (plus lastUpdated, id); list is [Other, Tooling]", *problems)
    commit(run.root, "members")
    return a, b, tooling


def check_rename(run: Run, a: dict, b: dict, tooling: dict) -> dict:
    print("\n4. Collection rename")
    before = snapshot(run.root)
    texts = {p: run.text(p) for p in (a["path"], b["path"])}
    _, cols = run.http("GET", "/collections")
    c = next(x for x in cols if x["id"] == tooling["id"])
    code, res = run.http("PUT", f"/collections/{c['id']}",
                         {"collection": {**c, "name": "Gear"}, "baseRevision": c["revision"]})
    after = snapshot(run.root)
    changed = changed_paths(before, after)
    rewritten = sorted(res.get("rewritten", [])) if code == 200 else []
    problems = []
    for p in md_files(changed):
        removed, added, _, _ = hunk_keys(run.root, p, texts.get(p, ""), run.text(p))
        if (removed | added) != {"collections"}:
            problems.append(f"{p}: touched {sorted(removed | added)}")
    run.report(code == 200 and sorted(md_files(changed)) == rewritten and not problems,
               f"{len(rewritten)} files rewritten, equal to the changed .md files; lastUpdated untouched",
               *problems, *([f"changed {md_files(changed)} vs rewritten {rewritten}"] if sorted(md_files(changed)) != rewritten else []))
    commit(run.root, "renamed")
    return c


def outside_meta(snap: dict[str, bytes]) -> dict[str, bytes]:
    return {k: v for k, v in snap.items() if not k.startswith(".object/")}


def check_delete_restore(run: Run, a: dict, tooling: dict) -> None:
    print("\n5. Collection delete and restore")
    before = outside_meta(snapshot(run.root))
    cid = tooling["id"]
    c428, _ = run.http("DELETE", f"/collections/{cid}")
    code, res = run.http("DELETE", f"/collections/{cid}", confirm="true")
    skipped = res.get("skipped") if isinstance(res, dict) else None
    run.report(c428 == 428 and code == 200 and skipped == [],
               f"delete without confirm is {c428}; confirmed delete is {code}, skipped {skipped}")
    _, trash = run.http("GET", "/trash")
    entry = next((t for t in trash if t.get("kind") == "collection" and t.get("collectionId") == cid), None)
    rcode, rres = run.http("POST", f"/trash/{entry['id']}/restore") if entry else (None, None)
    after = outside_meta(snapshot(run.root))
    diff = changed_paths(before, after)
    line_ok = re.search(r"^collections: \[Other, Gear\]\s*$", run.text(a["path"]), re.M) is not None
    run.report(entry is not None and rcode == 200 and not diff and line_ok and not (rres or {}).get("skipped"),
               "restored: every file outside .object/ is byte-identical, [Other, Gear] in its original order",
               *([str(diff)] if diff else []))


def only_meta(run: Run, before: dict[str, bytes], expect_new: bool = False) -> tuple[bool, list[str]]:
    diff = changed_paths(before, snapshot(run.root))
    ok = len(diff) == 1 and diff[0].startswith(".object/") and not md_files(diff)
    return ok, diff


def check_definition_writes(run: Run) -> None:
    print("\n6. Definition files")
    task = run.type_named("Task") or run.types()[0]
    _, got = run.http("GET", f"/views/{task['id']}")
    views = got["views"]
    views["activeTab"] = "all"
    before = snapshot(run.root)
    code, _ = run.http("PUT", f"/views/{task['id']}", {"views": views, "baseRevision": got["revision"]})
    ok, diff = only_meta(run, before)
    run.report(code == 200 and ok, f"PUT /views/{task['id']} wrote {diff}")

    _, ui0 = run.http("GET", "/ui")
    before = snapshot(run.root)
    pin = {"kind": "type", "id": task["id"]}
    code, _ = run.http("PUT", "/ui", {"patch": {"pinned": [pin]}, "baseRevision": ui0["revision"]})
    ok, diff = only_meta(run, before)
    stale, _ = run.http("PUT", "/ui", {"patch": {"pinned": []}, "baseRevision": ui0["revision"]})
    run.report(code == 200 and ok and stale == 409, f"PUT /ui wrote {diff}; stale baseRevision is {stale}")

    before = snapshot(run.root)
    code, q = run.http("POST", "/queries", {"name": "Acceptance query"})
    ok, diff = only_meta(run, before)
    run.report(code == 201 and ok, f"POST /queries wrote {diff}")
    before = snapshot(run.root)
    scode, _ = run.http("PUT", f"/queries/{q['id']}", {"query": {**q, "description": "saved"}, "baseRevision": q["revision"]})
    ok, diff = only_meta(run, before)
    run.report(scode == 200 and ok, f"PUT /queries/{q['id']} wrote {diff}")


def check_create_with_values(run: Run) -> None:
    print("\n7. Create with values")
    task = run.type_named("Task") or run.types()[0]
    label = next((d for d in task["propertyDefinitions"] if d["type"] == "label" and d.get("options", {}).get("options")), None)
    if label:
        key, value, needle = label["key"], [label["options"]["options"][0]["text"]], label["options"]["options"][0]["text"]
    else:
        key, value, needle = "description", "m3 values probe", "m3 values probe"
    before = snapshot(run.root)
    code, res = run.http("POST", "/objects", {"typeId": task["id"], "title": "M3 values probe", "values": {key: value}})
    diff = changed_paths(before, snapshot(run.root))
    holds = code == 201 and needle in run.text(res["path"])
    run.report(code == 201 and len(diff) == 1 and holds,
               f"POST /objects with values created {diff} holding {key}={value!r}")


def check_no_edit(run: Run) -> None:
    print("\n8. M1 no-edit pass")
    before = snapshot(run.root)
    _, objs = run.http("GET", "/objects")
    statuses: dict[int, int] = {}
    for s in objs:
        o = run.obj(s["path"])
        code, _ = run.http("PUT", "/object/body", {"path": s["path"], "body": o["body"], "baseVersion": o["version"]})
        statuses[code] = statuses.get(code, 0) + 1
    diff = changed_paths(before, snapshot(run.root))
    run.report(not diff and set(statuses) <= {200, 423}, f"{len(objs)} objects, statuses {statuses}, "
               f"{len(diff)} files changed", *([str(diff)] if diff else []))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m3-acceptance-"))
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git"))
    git(root, "init", "-q")
    commit(root, "base")
    original = snapshot(root)

    server = thread = None
    run: Run | None = None
    try:
        space, mig = check_migration(root, original)
        port = free_port()
        app = create_app(space, None, watch=True)
        server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=port, log_level="warning"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        http = Http(f"http://{HOST}:{port}/api")
        for _ in range(100):
            try:
                if http("GET", "/space")[0] == 200:
                    break
            except OSError:
                time.sleep(0.1)
        run = Run(root, http)
        print(f"Space copy: {root}")
        print(f"\n0. Opening twice: {mig[0]}", *mig[1:], sep="\n   ")
        run.failures += mig[0] != "ok"

        check_open_and_reads(run)
        check_rows(run)
        a, b, tooling = check_membership(run)
        c = check_rename(run, a, b, tooling)
        check_delete_restore(run, a, c)
        check_definition_writes(run)
        check_create_with_values(run)
        check_no_edit(run)
    finally:
        if server is not None:
            server.config.app.state.hub.close()
            server.should_exit = True
        if thread is not None:
            thread.join(timeout=5)
        if args.keep:
            print(f"\nKept: {root}")
        else:
            remove_tree(tmp)

    failures = run.failures if run else 1
    print("\nRESULT:", "PASS" if failures == 0 else f"FAIL ({failures})")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
