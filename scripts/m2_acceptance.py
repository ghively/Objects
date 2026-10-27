"""Milestone 2 acceptance run over HTTP (plan Task 20, Step 2).

Usage: ``uv run python scripts/m2_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched) and commits
the copy to a throw-away git repo *before* the app opens it, so the first
open's writes show up in ``git status``. Then it opens the space twice and
serves the second `Space` on a free ``127.0.0.1`` port, and checks:

 1. migration: v2 type files (and v1 backups when the space had v1 files), no
    ``.md`` file changed, and a second open changes nothing at all;
 2. one property of each kind, through ``PUT /api/object/properties``: the
    ``git diff -U0`` hunks touch only that key's lines, plus ``lastUpdated``
    and ``id``; an absent key only adds lines; ``kickoff`` keeps its timestamp
    form;
 3. renaming "Ada Lovelace" to "Ada King" relinks exactly the files whose
    changed lines differ only in link text;
 4. changing ``Pages/Notes.md`` to Task moves it to ``Tasks/Meeting notes.md``
    with an ``id`` that survives the move;
 5. Task's default template is applied on create; delete, restore, empty Trash;
 6. ensuring the tag "Math" and renaming it rewrites the ``tags:`` lines;
 7. a label option rename needs no confirm; deleting an in-use option is 428,
    then 200 with confirm;
 8. renaming the type Server to Machine rewrites every ``type:`` line; deleting
    a type and restoring it from the Trash gives back the same bytes;
 9. the M1 no-edit pass changes no file;
10. lists objects whose file stem differs from ``safe_filename(title)`` and icon
    ids whose Iconify prefix isn't bundled (both must be empty on the samples).

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
Fixture-specific objects that a space lacks are created over the API first,
so the run also works on a copy of a real export.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Any

import uvicorn

from objectapp.server import create_app
from objectapp.space import Space, safe_filename

HOST = "127.0.0.1"
BUNDLED_ICON_PREFIXES = ("vscode-icons", "ph")  # frontend/src/components/Icon.tsx
_KEY_LINE = re.compile(r"^([A-Za-z_][\w-]*)\s*:")
_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", re.M)


# -- plumbing ------------------------------------------------------------------


def remove_tree(path: Path) -> None:
    """Delete `path`; git marks its object files read-only, which Windows refuses to delete."""

    def writable_then_retry(func, p, _exc):
        os.chmod(p, stat.S_IWRITE)
        func(p)

    shutil.rmtree(path, onexc=writable_then_retry)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


class Http:
    def __init__(self, base: str) -> None:
        self.base = base

    def __call__(self, method: str, route: str, payload: Any = None, **query: Any) -> tuple[int, Any]:
        q = {k: v for k, v in query.items() if v is not None}
        url = self.base + route + ("?" + urllib.parse.urlencode(q) if q else "")
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
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


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.quotepath=false",
         "-c", "user.name=m2", "-c", "user.email=m2@localhost", *args],
        cwd=repo, check=True, capture_output=True, text=True, encoding="utf-8",
    ).stdout


def commit(repo: Path, msg: str) -> None:
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "--allow-empty", "-m", msg)


def snapshot(root: Path, skip_trash: bool = False) -> dict[str, bytes]:
    out = {}
    for p in root.rglob("*"):
        rel = p.relative_to(root)
        if not p.is_file() or rel.parts[0] in (".git", ".object-cache"):  # the cache is derived data (M5)
            continue
        if skip_trash and rel.as_posix().startswith(".object/trash/"):
            continue
        out[rel.as_posix()] = p.read_bytes()
    return out


def changed_paths(a: dict[str, bytes], b: dict[str, bytes]) -> list[str]:
    return sorted(k for k in a.keys() | b.keys() if a.get(k) != b.get(k))


def key_map(text: str) -> dict[int, str]:
    """1-based line number → the frontmatter key whose span holds it (`---` / `<body>` otherwise)."""
    lines = text.split("\n")
    out: dict[int, str] = {}
    if not lines or lines[0].rstrip("\r").lstrip("﻿") != "---":
        return {i + 1: "<body>" for i in range(len(lines))}
    out[1] = "---"
    current = "<fm>"
    end = None
    for i in range(1, len(lines)):
        s = lines[i].rstrip("\r")
        if s == "---":
            out[i + 1] = "---"
            end = i
            break
        m = _KEY_LINE.match(s)
        if m:
            current = m.group(1)
        out[i + 1] = current
    for i in range((end or len(lines)) + 1, len(lines)):
        out[i + 1] = "<body>"
    return out


def hunk_keys(repo: Path, path: str, before: str, after: str) -> tuple[set[str], set[str], int, int]:
    """Keys of the removed and the added lines of `path`'s uncommitted diff, and their counts."""
    diff = git(repo, "diff", "-U0", "--", path)
    old_map, new_map = key_map(before), key_map(after)
    removed: set[str] = set()
    added: set[str] = set()
    n_rem = n_add = 0
    for m in _HUNK.finditer(diff):
        os_, oc, ns, nc = int(m[1]), int(m[2] or 1), int(m[3]), int(m[4] or 1)
        for i in range(os_, os_ + oc):
            removed.add(old_map.get(i, "<eof>"))
        for i in range(ns, ns + nc):
            added.add(new_map.get(i, "<eof>"))
        n_rem += oc
        n_add += nc
    return removed, added, n_rem, n_add


# -- the run -------------------------------------------------------------------


class Run:
    def __init__(self, root: Path, http: Http) -> None:
        self.root = root
        self.http = http
        self.failures = 0

    def report(self, ok: bool, label: str, *notes: str) -> bool:
        print(f"  [{'ok' if ok else 'FAIL'}] {label}")
        for n in notes:
            print(f"         {n}")
        self.failures += not ok
        return ok

    def text(self, path: str) -> str:
        return (self.root / path).read_bytes().decode("utf-8-sig")

    def types(self) -> list[dict]:
        return self.http("GET", "/space")[1]["types"]

    def type_named(self, name: str) -> dict | None:
        return next((t for t in self.types() if t["name"].lower() == name.lower()), None)

    def obj(self, path: str) -> dict:
        code, o = self.http("GET", "/object", path=path)
        assert code == 200, (path, code, o)
        return o

    def find(self, title: str, type_id: str | None = None) -> dict | None:
        _, objs = self.http("GET", "/objects", type=type_id)
        return next((o for o in objs if o["title"] == title), None)

    def save_type(self, t: dict, confirm: bool | None = None) -> tuple[int, Any]:
        payload: dict[str, Any] = {"type": t, "baseRevision": t.get("revision", "")}
        if confirm is not None:
            payload["confirm"] = confirm
        return self.http("PUT", f"/types/{t['id']}", payload)


def _def(key: str, name: str, kind: str, options: dict | None = None) -> dict:
    return {"id": uuid.uuid4().hex[:16], "key": key, "name": name, "type": kind, "description": "",
            "icon": None, "visibility": "alwaysShow", "options": options or {}}


def _opt(text: str) -> dict:
    return {"id": uuid.uuid4().hex[:16], "text": text, "color": "blue", "icon": None}


def check_migration(root: Path, original: dict[str, bytes]) -> tuple[Space, list[str]]:
    lines = []
    ok = True
    v1 = [k for k, v in original.items()
          if k.startswith(".object/types/") and k.endswith(".json") and b'"schemaVersion"' not in v]
    space = Space(root)
    status = git(root, "status", "--porcelain", "-uall")
    md_changed = [l for l in status.splitlines() if l.endswith(".md") or l.endswith('.md"')]
    if md_changed:
        ok = False
        lines.append(f".md files changed by opening: {md_changed}")
    types_dir = root / ".object" / "types"
    not_v2 = [f.name for f in types_dir.glob("*.json") if json.loads(f.read_text("utf-8")).get("schemaVersion") != 2]
    if not_v2:
        ok = False
        lines.append(f"type files not v2: {not_v2}")
    backup = root / ".object" / "backup" / "types-v1"
    missing = [k for k in v1 if not (backup / PurePosixPath(k).name).is_file()
               or (backup / PurePosixPath(k).name).read_bytes() != original[k]]
    if missing:
        ok = False
        lines.append(f"v1 files without an exact backup: {missing}")
    lines.append(f"{len(list(types_dir.glob('*.json')))} type files (v2), {len(v1)} v1 backups, "
                 f"{len(md_changed)} .md changed")
    commit(root, "opened")
    first = snapshot(root)
    space = Space(root)
    second = changed_paths(first, snapshot(root))
    if second:
        ok = False
        lines.append(f"second open changed: {second}")
    return space,(["ok" if ok else "FAIL"] + lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m2-acceptance-"))
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
        print("\n1. Migration and first open")
        run.report(mig[0] == "ok", "types migrated, objects untouched, second open writes nothing", *mig[1:])

        check_properties(run)
        check_rename(run)
        check_change_type(run)
        check_templates_and_trash(run)
        check_tags(run)
        check_label_options(run)
        check_type_rename_and_delete(run)
        check_no_edit(run)
        check_names_and_icons(run, space)
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


# -- 2. property kinds ------------------------------------------------------------


def probe_object(run: Run) -> tuple[dict, str]:
    """The Project type (created when missing) with a definition per kind, and "Object app"."""
    t = run.type_named("Project")
    if t is None:
        code, t = run.http("POST", "/types", {"name": "Project", "pluralName": "Projects"})
        assert code == 201, (code, t)
    o = run.find("Object app", t["id"])
    if o is None:
        code, res = run.http("POST", "/objects", {"typeId": t["id"], "title": "Object app", "templateId": "none"})
        assert code == 201, (code, res)
        path = res["path"]
        commit(run.root, "probe object")
    else:
        path = o["path"]
    t = run.type_named("Project")
    have = {d["key"]: d for d in t["propertyDefinitions"]}
    wanted = [
        _def("budget", "Budget", "number"),
        _def("progress", "Progress", "number"),
        _def("done", "Done", "boolean"),
        _def("site", "Site", "url"),
        _def("timeFrame", "Time frame", "datetime"),
        _def("kickoff", "Kickoff", "datetime"),
        _def("lead", "Lead", "entity", {"isArray": False, "allowedTypes": [], "hasFixedSet": False, "fixedSet": []}),
        _def("members", "Members", "entity", {"isArray": True, "allowedTypes": [], "hasFixedSet": False, "fixedSet": []}),
        _def("notes", "Notes", "text"),
        _def("summary", "Summary", "textBlock"),
        _def("extra", "Extra", "blocks"),
        _def("grid", "Grid", "simpleTableBlock"),
        _def("phase", "Phase", "label", {"isArray": False, "set": [_opt("Plan"), _opt("Build")]}),
        _def("areas", "Areas", "label", {"isArray": True, "set": [_opt("Docs"), _opt("Code")]}),
        _def("due", "Due", "datetimeSimple"),
        {**_def("coverImage", "Cover image", "coverImage"), "id": "coverImage"},
    ]
    defs = list(t["propertyDefinitions"])
    for d in wanted:
        if d["key"] not in have:
            defs.append(d)
    for d in defs:
        if d["key"] == "progress":
            d.setdefault("options", {})["numberFormat"] = {"type": "progress", "options": {"progress": {"steps": 10, "color": "blue"}}}
        if d["key"] == "kickoff":
            d.setdefault("options", {}).setdefault("constraints", {})["resolutionPreference"] = "day"
    t["propertyDefinitions"] = defs
    code, res = run.save_type(t, confirm=True)
    assert code == 200, (code, res)
    commit(run.root, "probe type")
    return run.type_named("Project"), path


def check_properties(run: Run) -> None:
    print("\n2. One property of each kind")
    t, path = probe_object(run)
    alpha = run.find("Alpha", None)
    ada = run.find("Ada Lovelace")
    ref = lambda o: {"target": o["title"], "path": o["path"]}  # noqa: E731
    cover = "Attachments/cover.png"
    if not (run.root / cover).is_file():
        code, res = run.http("GET", "/images")
        cover = res[0]["path"] if res else cover
    edits: list[tuple[str, Any, str]] = [  # key, value, mode (line | span)
        ("budget", 99.25, "line"),
        ("progress", 5, "line"),
        ("done", True, "line"),
        ("site", "https://example.test/next", "line"),
        ("timeFrame", {"start": "2026-11-01", "end": "2027-01-31", "resolution": "day"}, "line"),
        ("kickoff", {"start": "2026-04-01", "end": "2026-04-02", "resolution": "day"}, "line"),
        ("lead", [ref(alpha)] if alpha else [{"target": "Alpha", "path": None}], "line"),
        ("members", [ref(ada)] if ada else [{"target": "Ada Lovelace", "path": None}], "line"),
        ("notes", "Plain text", "line"),
        ("summary", "Some *inline* text", "line"),
        ("extra", "First line\n\n- an item\n- another", "span"),
        ("grid", "| a | b |\n| --- | --- |\n| 1 | 2 |", "span"),
        ("phase", ["Build"], "line"),
        ("areas", ["Docs", "Code"], "line"),
        ("due", {"start": "2026-10-30", "resolution": "day"}, "line"),
        ("tags", ["Docs"], "line"),
        ("aliases", ["OA"], "line"),
        ("icon", {"type": "iconify", "val": "ph-rocket"}, "line"),
        ("description", "A local app", "line"),
        ("coverImage", cover, "line"),
        # second edits of multi-line values: only lines inside the key's span change
        ("extra", "First line, edited\n\n- an item\n- another", "span"),
        ("grid", "| a | b |\n| --- | --- |\n| 1 | 3 |", "span"),
    ]
    original_members = run.obj(path)["frontmatter"].get("members")
    for key, value, mode in edits:
        o = run.obj(path)
        before = run.text(path)
        absent = key not in o["frontmatter"]
        code, res = run.http("PUT", "/object/properties",
                             {"path": path, "updates": {key: value}, "baseVersion": o["version"]})
        if code != 200:
            run.report(False, f"{key}: PUT {code}", str(res))
            continue
        after = run.text(path)
        removed, added, n_rem, n_add = hunk_keys(run.root, path, before, after)
        allowed = {key, "lastUpdated", "id"}
        notes = [f"removed keys {sorted(removed)} ({n_rem}), added keys {sorted(added)} ({n_add})"]
        ok = removed <= allowed and added <= allowed and key in (removed | added)
        if absent:
            ok = ok and removed <= {"lastUpdated"}
            notes[0] += " [absent key]"
        if mode == "line" and not absent:
            key_lines_old = [i for i, k in key_map(before).items() if k == key]
            ok = ok and len(key_lines_old) == 1
        if key == "kickoff":
            line = next(l for l in after.split("\n") if l.startswith("kickoff:"))
            form = "T00:00:00.000Z" in line or absent
            ok = ok and form
            notes.append(f"line: {line.strip()}")
        run.report(ok, f"{key}", *notes)
        commit(run.root, f"edit {key}")
    if original_members is not None:  # put `members` back for the rename check
        o = run.obj(path)
        restore = [{"target": re.sub(r"^\[\[|\]\]$", "", m), "path": None} for m in original_members]
        code, _ = run.http("PUT", "/object/properties",
                           {"path": path, "updates": {"members": restore}, "baseVersion": o["version"]})
        ok = code == 200 and "members: ['[[Ada Lovelace]]', '[[Alpha]]']" in run.text(path)
        run.report(ok, "members restored in the same flow-list form")
        commit(run.root, "restore members")


# -- 3. rename with relink ----------------------------------------------------------


def check_rename(run: Run) -> None:
    print("\n3. Rename 'Ada Lovelace' to 'Ada King'")
    ada = run.find("Ada Lovelace")
    if ada is None:
        run.report(False, "no object titled 'Ada Lovelace'")
        return
    o = run.obj(ada["path"])
    code, res = run.http("POST", "/object/rename",
                         {"path": ada["path"], "title": "Ada King", "baseVersion": o["version"]})
    if not run.report(code == 200, f"POST /object/rename {code}", f"-> {res.get('path') if code == 200 else res}"):
        return
    git(run.root, "add", "-A")
    names = git(run.root, "diff", "--cached", "--name-status", "-M").splitlines()
    link_only: set[str] = set()
    other: list[str] = []
    for line in names:
        parts = line.split("\t")
        status, p = parts[0], parts[-1]
        if p in (res["path"], ada["path"]) or status.startswith("R"):
            continue
        diff = git(run.root, "diff", "--cached", "-U0", "--", p)
        rem = [l[1:] for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]
        add = [l[1:] for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++")]
        if rem and len(rem) == len(add) and all(
            re.sub(r"\[\[Ada Lovelace(?=[\]|#])", "[[Ada King", r) == a for r, a in zip(rem, add)
        ):
            link_only.add(p)
        else:
            other.append(p)
    relinked = set(res["relinked"])
    run.report(relinked == link_only and not other,
               f"relinked ({len(relinked)}) equals the files with only link-text changes",
               f"relinked: {sorted(relinked)}", f"link-only: {sorted(link_only)}",
               *( [f"other changed files: {other}"] if other else []))
    proj = run.find("Object app")
    text = run.text(proj["path"]) if proj is not None else ""
    if "|Ada L]]" in text:  # the space-sample fixture (a probe object made by this run has no body)
        run.report("members: ['[[Ada King]]', '[[Alpha]]']" in text
                   and "`[[Ada Lovelace]]`" in text and "[[Ada King|Ada L]]" in text,
                   "members reads ['[[Ada King]]', '[[Alpha]]']; alias kept; inline code untouched")
    git(run.root, "commit", "-q", "--allow-empty", "-m", "rename")


# -- 4. change type -----------------------------------------------------------------


def check_change_type(run: Run) -> None:
    print("\n4. Change Pages/Notes.md to Task")
    path = "Pages/Notes.md"
    if not (run.root / path).is_file():
        run.report(False, f"{path} missing")
        return
    o = run.obj(path)
    had_id = o["frontmatter"].get("id")
    task = run.type_named("Task")
    code, rows = run.http("GET", "/object/change-type", path=path, typeId=task["id"])
    run.report(code == 200, f"GET /object/change-type {code}", f"rows: {rows}")
    code, res = run.http("POST", "/object/change-type",
                         {"path": path, "typeId": task["id"], "mapping": {}, "baseVersion": o["version"]})
    if not run.report(code == 200, f"POST /object/change-type {code}", str(res)):
        return
    new = res["path"]
    moved = new == "Tasks/Meeting notes.md" and not (run.root / path).exists()
    fm = run.obj(new)["frontmatter"]
    ok = moved and bool(fm.get("id")) and not had_id and fm.get("type") in ("Task", task["name"])
    run.report(ok, f"moved to {new} with a new id {fm.get('id')}")
    code, r = run.http("GET", "/resolve", link="Meeting notes")
    run.report(code == 200 and r["path"] == new, f"[[Meeting notes]] resolves to {r}")
    commit(run.root, "change type")


# -- 5. templates, create, delete, restore, empty trash -----------------------------


def check_templates_and_trash(run: Run) -> None:
    print("\n5. Default template, create, delete, restore, empty Trash")
    task = run.type_named("Task")
    code, tpls = run.http("GET", f"/types/{task['id']}/templates")
    tpl = next((s for s in tpls if s.get("template") == "Bug report"), None)
    if tpl is None:
        code, res = run.http("POST", f"/types/{task['id']}/templates", {"name": "Bug report"})
        assert code == 201, (code, res)
        o = run.obj(res["path"])
        run.http("PUT", "/object/body", {"path": res["path"], "body": "\n- [ ] Steps to reproduce\n",
                                          "baseVersion": o["version"]})
        _, tpls = run.http("GET", f"/types/{task['id']}/templates")
        tpl = next(s for s in tpls if s["path"] == res["path"])
        commit(run.root, "template")
    task = run.type_named("Task")
    task["templates"] = {**task.get("templates", {}), "defaultTemplateId": tpl["id"]}
    code, res = run.save_type(task)
    run.report(code == 200, f"Task's default template set to {tpl['path']} ({code})")
    tpl_body = run.obj(tpl["path"])["body"]
    code, res = run.http("POST", "/objects", {"typeId": task["id"], "templateId": None})
    if not run.report(code == 201, f"POST /objects {code}", str(res)):
        return
    created = run.obj(res["path"])
    checklist = [l for l in tpl_body.split("\n") if l.strip().startswith("- [ ]")]
    expect_title = f"Bug {date.today():%Y-%m-%d}" if "{date:" in str(run.obj(tpl["path"])["frontmatter"].get("title")) else None
    ok = all(l in created["body"] for l in checklist) and "template" not in created["frontmatter"]
    if expect_title:
        ok = ok and created["summary"]["title"] == expect_title
    run.report(ok, f"created {res['path']} from the template", f"title: {created['summary']['title']!r}")
    commit(run.root, "create")
    before = (run.root / res["path"]).read_bytes()
    code, d = run.http("DELETE", "/object", path=res["path"])
    gone = code == 200 and not (run.root / res["path"]).exists()
    _, trash = run.http("GET", "/trash")
    run.report(gone and any(i["id"] == d["trashId"] for i in trash), f"deleted to the Trash ({code})")
    code, r = run.http("POST", f"/trash/{d['trashId']}/restore")
    back = code == 200 and (run.root / res["path"]).is_file() and (run.root / res["path"]).read_bytes() == before
    run.report(back, f"restored {r.get('paths') if code == 200 else r} with the same bytes")
    code, d = run.http("DELETE", "/object", path=res["path"])
    code, p = run.http("DELETE", "/trash")
    _, trash = run.http("GET", "/trash")
    run.report(code == 200 and p["purged"] >= 1 and trash == [], f"Empty Trash purged {p.get('purged')}")
    commit(run.root, "trash")


# -- 6. tags --------------------------------------------------------------------------


def tag_lines(run: Run) -> dict[str, str]:
    out = {}
    for f in run.root.rglob("*.md"):
        rel = f.relative_to(run.root).as_posix()
        if rel.startswith((".git/", ".object")) or "/." in "/" + rel:
            continue
        for line in f.read_bytes().decode("utf-8", "replace").split("\n"):
            if line.startswith("tags:"):
                out[rel] = line.rstrip("\r")
    return out


def check_tags(run: Run) -> None:
    print("\n6. Ensure the tag 'Math' and rename it")
    code, res = run.http("POST", "/tags/ensure", {"name": "Math"})
    if not run.report(code == 200, f"POST /tags/ensure {code}", str(res)):
        return
    code2, res2 = run.http("POST", "/tags/ensure", {"name": "Math"})
    run.report(code2 == 200 and res2["created"] is False and res2["path"] == res["path"], "a second ensure finds it")
    before = tag_lines(run)
    had = {p for p, l in before.items() if re.search(r"[\[, ]'?Math'?[\],]", l)}
    commit(run.root, "tag")
    o = run.obj(res["path"])
    code, r = run.http("POST", "/object/rename", {"path": res["path"], "title": "Mathematics", "baseVersion": o["version"]})
    if not run.report(code == 200, f"rename tag {code}", str(r)):
        return
    after = tag_lines(run)
    changed = {p for p in after if before.get(p) != after[p]}
    ok = changed == had and all("Mathematics" in after[p] for p in had)
    run.report(ok, f"tags: lines rewritten in {sorted(changed)}", *[f"{p}: {after[p]}" for p in sorted(changed)])
    commit(run.root, "tag rename")


# -- 7. label options -------------------------------------------------------------------


def check_label_options(run: Run) -> None:
    print("\n7. Task's status options")
    task = run.type_named("Task")
    status = next((d for d in task["propertyDefinitions"] if d["key"] == "status"), None)
    if status is None:
        run.report(False, "Task has no status property")
        return
    opts = status["options"]["set"]
    ns = next((o for o in opts if o["text"] == "Not Started"), None)
    if ns is None:
        run.report(False, "no 'Not Started' option", str([o["text"] for o in opts]))
        return
    users = [p for p, _ in _status_users(run, "Not Started")]
    ns["text"] = "To do"
    code, res = run.save_type(task)
    ok = code == 200 and all(_status_line(run, p) == "status: To do" for p in users)
    run.report(ok, f"rename 'Not Started' -> 'To do' without confirm: {code}",
               f"rewritten: {res.get('rewritten') if code == 200 else res}")
    commit(run.root, "option rename")
    task = run.type_named("Task")
    status = next(d for d in task["propertyDefinitions"] if d["key"] == "status")
    in_use = next((o for o in status["options"]["set"] if _status_users(run, o["text"])), None)
    if in_use is None:
        run.report(False, "no option in use")
        return
    status["options"]["set"] = [o for o in status["options"]["set"] if o is not in_use]
    code, res = run.save_type(task)
    run.report(code == 428 and res.get("affected", 0) >= 1, f"delete in-use '{in_use['text']}': {code}", str(res))
    code, res = run.save_type(task, confirm=True)
    left = _status_users(run, in_use["text"])
    run.report(code == 200 and not left, f"with confirm: {code}", f"rewritten: {res.get('rewritten') if code == 200 else res}")
    commit(run.root, "option delete")


def _status_line(run: Run, path: str) -> str | None:
    return next((l.rstrip("\r") for l in run.text(path).split("\n") if l.startswith("status:")), None)


def _status_users(run: Run, text: str) -> list[tuple[str, str]]:
    _, objs = run.http("GET", "/objects", type=run.type_named("Task")["id"])
    out = []
    for o in objs:
        line = _status_line(run, o["path"]) if not o["readOnly"] else None
        if line and line.split(":", 1)[1].strip().strip("'\"") == text:
            out.append((o["path"], line))
    return out


# -- 8. type rename and delete/restore ----------------------------------------------------


def check_type_rename_and_delete(run: Run) -> None:
    print("\n8. Rename type Server to Machine; delete and restore a type")
    server = run.type_named("Server")
    if server is None:
        run.report(False, "no Server type")
    else:
        _, objs = run.http("GET", "/objects", type=server["id"])
        paths = [o["path"] for o in objs if not o["readOnly"]]
        server["name"] = "Machine"
        code, res = run.save_type(server)
        lines = {p: next(l.rstrip("\r") for l in run.text(p).split("\n") if l.startswith("type:")) for p in paths}
        ok = code == 200 and all(re.fullmatch(r"type: (['\"]?)Machine\1", l) for l in lines.values())
        t = run.type_named("Machine")
        ok = ok and t is not None and "Server" in t.get("formerNames", [])
        run.report(ok, f"PUT /types/{server['id']} {code}", *[f"{p}: {l}" for p, l in lines.items()])
        _, still = run.http("GET", "/objects", type=server["id"])
        run.report(len(still) == len(objs), f"{len(still)} objects still attached")
        commit(run.root, "type rename")

    victim = run.type_named("Project") or run.type_named("Person")
    before = snapshot(run.root, skip_trash=True)
    code, res = run.http("DELETE", f"/types/{victim['id']}")
    run.report(code == 428, f"DELETE /types/{victim['id']} without confirm: {code}", str(res))
    code, res = run.http("DELETE", f"/types/{victim['id']}", confirm="true")
    if not run.report(code == 200, f"with confirm: {code}", str(res)):
        return
    gone = run.type_named(victim["name"]) is None
    code, r = run.http("POST", f"/trash/{res['trashId']}/restore")
    after = snapshot(run.root, skip_trash=True)
    diff = changed_paths(before, after)
    run.report(gone and code == 200 and not diff,
               f"restored {victim['name']}: {len(r.get('paths', []))} files; byte-identical",
               *([f"differs: {diff}"] if diff else []))
    commit(run.root, "type delete/restore")


# -- 9. M1 no-edit pass ------------------------------------------------------------------------


def check_no_edit(run: Run) -> None:
    print("\n9. M1 no-edit pass")
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


# -- 10. names and icons -------------------------------------------------------------------------


def _icon_ids(value: Any) -> list[str]:
    if isinstance(value, dict):
        if value.get("type") == "iconify" and isinstance(value.get("val"), str):
            return [value["val"]]
        return []
    if isinstance(value, str) and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*[:-][a-z0-9][\w:-]*", value, re.I):
        return [value]
    return []


def _unbundled(icon_id: str) -> bool:
    if any(icon_id.startswith(p + "-") or icon_id.startswith(p + ":") for p in BUNDLED_ICON_PREFIXES):
        return False
    return ":" in icon_id


def check_names_and_icons(run: Run, space: Space) -> None:
    print("\n10. File names and icon sets")
    _, objs = run.http("GET", "/objects")
    names = [f"{o['path']} (title {o['title']!r} -> {safe_filename(o['title'])!r})"
             for o in objs if not o["readOnly"] and PurePosixPath(o["path"]).stem != safe_filename(o["title"])]
    icons: list[str] = []
    for o in objs:
        icons += [f"{o['path']}: {i}" for i in _icon_ids(o.get("icon")) if _unbundled(i)]
    for t in run.types():
        icons += [f"type {t['name']}: {i}" for i in _icon_ids(t.get("icon")) if _unbundled(i)]
        for d in t["propertyDefinitions"]:
            icons += [f"{t['name']}.{d['key']}: {i}" for i in _icon_ids(d.get("icon")) if _unbundled(i)]
            for opt in (d.get("options") or {}).get("set") or []:
                icons += [f"{t['name']}.{d['key']}={opt.get('text')}: {i}"
                          for i in _icon_ids(opt.get("icon")) if _unbundled(i)]
    run.report(not names, f"stems that differ from safe_filename(title): {len(names)}", *names)
    run.report(not icons, f"icon ids with an unbundled Iconify prefix: {len(icons)}", *icons)


if __name__ == "__main__":
    sys.exit(main())
