"""Milestone 31 acceptance run over HTTP (completion: everything specified and not yet built).

Usage: ``uv run python scripts/m31_acceptance.py [--keep]``

Copies the synthetic fixture spaces it needs (``space-sample``, ``space-whiteboard``,
``space-itops``, ``space-m8``) to a temporary folder (the fixtures themselves are never touched:
their bytes are compared before and after), sets ``OBJECT_STATE_DIR`` and ``OBJECT_CACHE_DIR`` to
temporary paths outside every copy and serves ``create_app`` on a free ``127.0.0.1`` port for
each part (`m8_acceptance.Served`). No agent runs, so the fake ``claude`` is not needed; the
synthetic git repository and the import sources are written by this script. No real data, no
network. The checks, by the plan's item numbers (``2026-11-10-m31-completion.md``; the items
with no back-end behaviour are Gene's hand checks in ``m31-acceptance.md``):

 1. Full Export: ``POST /api/full-export`` of the open space into a temporary folder with each
    option (Include media; Links as wikilinks; Add the title as a top heading): every object's
    file holds the bytes the single-object Markdown export gives it (``GET /api/object/export``
    with the same options; with wikilinks off, `export._markdown` at the object's own path, as
    the full export places it), the media copied only with Include media; "Export All Spaces"
    (``scope: all``) holds one folder per registered space; a folder inside a space (and a
    missing or relative one) is refused 422; nothing is written in either space; the automated
    export, on the ``OBJECT_CLOCK_FILE`` clock: on at server start it runs once, a restart 23
    hours on does not run again, one 24 hours on does, ``GET /api/full-export/status`` says
    ``lastRun`` and ``nextRun``, and a folder inside a space is ``blocked``;
 2. saved queries with search text, tags (any of, all of, left out), excluded types and
    collection rules: ``POST /api/v1/queries/{id}/run`` lists the titles the app lists (its own
    two steps: ``POST /api/rows`` with the query's scope, then `queryeval.run_query`), in its
    order, an object excluded from AI aside;
 3. the import conventions in a space not set up as IT operations (``space-sample``, no setup):
    a type with Project's properties is refused with the offer "Use Project, with a category" while
    one with two properties named like Server's is not (the M31 fix pass's tuning), a tag name is a
    category, a relation to a type that is neither in the space nor proposed stays a plain link; and an
    Incident (a new IT ops space's, and the type gallery's) has one Resolved;
 4. an import from a synthetic git repository: each object's ``importSource`` has the commit,
    the GitHub link at that commit, the last commit's author and date; a changed and an
    untracked file are ``uncommitted`` and in the report's Git section; the repository is
    unchanged;
 5. remodel: importing the open space's own folder (``space-itops``) into a new space keeps its
    types (every one, those with no object included, with their plurals, icons, colours,
    properties and options) and objects (each at its path, its type and links kept); the original
    space is byte for byte the same;
 9. definition history: a collection, a saved query and a type, each edited and restored
    through ``POST /api/history/definition/restore``; a stale revision is 409 and writes
    nothing;
13. the Table property: added to a type, a table written with ``PUT /api/object/properties``
    (only its own lines and ``lastUpdated`` change) and read back; a value that is not a table
    is 422 and writes nothing; a kind change from Table to Number is refused with the catalog's
    words;
14. a type's link view ``page`` saves (only that line of the type file changes) and reads back;
15. ``GET /api/storage`` writes nothing; ``POST /api/storage/clear-media-cache`` removes only the
    cache's media parts.

Each check prints ``[ok]`` or ``[FAIL]``; ends with ``RESULT: PASS`` or exits non-zero.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))
sys.path.insert(0, str(REPO / "scripts"))

from m2_acceptance import Run, _def, remove_tree  # noqa: E402
from m7_acceptance import raw  # noqa: E402
from m8_acceptance import Served, diff_keys  # noqa: E402

FIXTURES = REPO / "backend" / "tests" / "fixtures"
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE")
NO_TRANSFORMATIONS = (
    "This property type cannot be changed. If you need to change it, please add a ticket "
    "to our feedback board including the types you need."
)
TABLE = "| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n| Pear \\| green | 5 |"
OFFER = "Use Project, with a category"
LOOKALIKE = "It has the same properties as Project."
PROJECT_PROPS = [*({"name": n, "kind": k, "share": 1.0} for n, k in (
    ("Budget", "number"), ("Progress", "number"), ("Done", "boolean"), ("Site", "url"), ("Time Frame", "datetime"),
    ("Kickoff", "datetime"))), *({"name": n, "kind": "entity", "target": "Person", "share": 1.0} for n in ("Lead", "Members"))]
"""Every specific property of space-sample's Project (by name and kind): a real look-alike."""
AUTHOR = "Ada Example"
DATE = "2026-10-01T09:30:00+00:00"
REMOTE = "git@github.com:acme/ops-wiki.git"


# -- plumbing ------------------------------------------------------------------------------


def tree(root: Path) -> dict[str, str]:
    """Every file under ``root`` (dot folders included, ``.git`` aside) and its hash."""
    out = {}
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root)
        if p.is_file() and rel.parts[0] != ".git":
            out[rel.as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def differ(a: dict[str, str], b: dict[str, str]) -> list[str]:
    return sorted(k for k in a.keys() | b.keys() if a.get(k) != b.get(k))


def files_under(folder: Path) -> dict[str, bytes]:
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


def bearer(base: str, token: str, method: str, route: str, payload: Any = None) -> tuple[int, Any]:
    """One ``/api/v1`` call with the token, as an agent's own HTTP makes it."""
    body = json.dumps(payload).encode() if payload is not None else None
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    code, _h, data = raw(base, method, route, body, headers)
    try:
        return code, json.loads(data or b"null")
    except ValueError:
        return code, data.decode(errors="replace")


def token(served: Served, scope: str) -> str:
    code, tok = served.http("POST", "/integrations/tokens", {"name": f"M31 {scope}", "scope": scope})
    assert code == 201, (code, tok)
    return tok["secret"]


def wait_job(served: Served, route: str, key: str, finished: tuple[str, ...], timeout: float = 60) -> dict:
    end = time.monotonic() + timeout
    while True:
        code, job = served.http("GET", route)
        if code == 200 and job.get(key) in finished:
            return job
        if time.monotonic() > end:
            raise SystemExit(f"{route} still {job}")
        time.sleep(0.05)


def put_settings(served: Served, patch: dict) -> tuple[int, Any]:
    _c, cur = served.http("GET", "/settings")
    return served.http("PUT", "/settings", {"patch": patch, "baseRevision": cur.get("revision")})


def import_folder(served: Served, source: Path, target: Any = "currentSpace", **extra: Any) -> tuple[dict, dict]:
    """(preview, finished job) of M25's import of ``source``."""
    code, pv = served.http("POST", "/import/preview", {"source": {"path": str(source)}, "target":
                                                       target if isinstance(target, str) else target["kind"], **extra})
    assert code == 200, (code, pv)
    body = {"previewId": pv["previewId"], "mapping": pv["mapping"],
            "target": {"kind": "currentSpace"} if target == "currentSpace" else target, **extra}
    code, res = served.http("POST", "/import/start", body)
    assert code == 202, (code, res)
    job = wait_job(served, f"/import/jobs/{res['jobId']}", "phase", ("done", "failed", "cancelled"))
    return pv, job


def fm(path: Path) -> dict:
    from objectapp.frontmatter import parse_fm

    text = path.read_bytes().decode("utf-8-sig").replace("\r\n", "\n")
    return parse_fm(text.split("---\n", 2)[1]) if text.startswith("---\n") else {}


def copy_space(name: str, dest: Path) -> Path:
    shutil.copytree(FIXTURES / name, dest, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    return dest


# -- 1. Full Export --------------------------------------------------------------------------


class FullExport:
    def __init__(self, run: Run, tmp: Path) -> None:
        self.run, self.tmp = run, tmp

    def export(self, served: Served, **req: Any) -> tuple[int, dict]:
        code, res = served.http("POST", "/full-export", req)
        if code != 202:
            return code, res
        job = wait_job(served, f"/full-export/jobs/{res['job']['id']}", "state", ("done", "failed"))
        return code, job

    def check(self) -> None:
        print("\n1. Full Export")
        from objectapp import export as single
        from objectapp.appstate import state_dir
        from objectapp.export import ExportOptions
        from objectapp.spaces import Registry

        one = copy_space("space-sample", self.tmp / "spaces" / "One")
        two = copy_space("space-whiteboard", self.tmp / "spaces" / "Two")
        reg = Registry(state_dir())
        reg.register(one)
        reg.register(two)
        served = Served(one)
        try:
            name = served.space.name
            objects = sorted(s.path for s in served.space.list())
            before = (tree(one), tree(two))

            # (a) each option, the open space
            cases = [
                ("Include media on, Links as wikilinks on", dict(media=True, wikilinks=True, titleHeading=False)),
                ("Add the title as a top heading on", dict(media=False, wikilinks=True, titleHeading=True)),
                ("Links as wikilinks off", dict(media=False, wikilinks=False, titleHeading=False)),
            ]
            for label, opts in cases:
                dest = self.tmp / f"export-{len(label)}"
                dest.mkdir()
                code, job = self.export(served, scope="current", folder=str(dest), **opts)
                result = job.get("result") or {}
                top = Path(result.get("folder", dest / "missing"))
                out = top / name
                got = files_under(out) if out.is_dir() else {}
                md = {p: b for p, b in got.items() if p in objects}
                media = sorted(p for p in got if p not in objects)
                ok = (code == 202 and job.get("state") == "done" and top.parent == dest.resolve()
                      and top.name.startswith(f"Object export {name} ") and sorted(md) == objects)
                self.run.report(ok, f"{label}: a dated folder holds every object of {name!r}",
                                f"{code} {job.get('state')} {job.get('error')}; {top.name}; {len(md)}/{len(objects)} objects")
                bad, changed = [], 0
                for rel in objects:
                    if opts["wikilinks"]:
                        c, _h, want = raw(served.base, "GET", "/object/export", path=rel, wikilinks="1",
                                          titleH1="1" if opts["titleHeading"] else "0")
                        if c != 200:
                            bad.append(f"{rel}: export {c}")
                            continue
                    else:
                        want = single._markdown(served.space, rel, ExportOptions(wikilinks=False), rel)
                    if md.get(rel) != want:
                        bad.append(rel)
                    changed += md.get(rel) != (one / rel).read_bytes()
                how = ("GET /api/object/export with the same options" if opts["wikilinks"]
                       else "the single-object export's rules at the object's own path")
                self.run.report(not bad and (changed > 0) == (opts["titleHeading"] or not opts["wikilinks"]),
                                f"{label}: each file's bytes are {how}",
                                f"{changed} files differ from the space's own bytes", *(f"differs: {b}" for b in bad[:5]))
                if opts["media"]:
                    self.run.report("Attachments/cover.png" in media and result.get("media", 0) >= 1,
                                    "Include media copies the attachments", f"media {media}")
                else:
                    self.run.report(media == [] and result.get("media") == 0, "without Include media no media is copied",
                                    f"media {media}")

            # (b) Export All Spaces
            dest = self.tmp / "export-all"
            dest.mkdir()
            code, job = self.export(served, scope="all", folder=str(dest), media=False)
            top = Path((job.get("result") or {}).get("folder", dest / "missing"))
            names = sorted(e["name"] for e in served.http("GET", "/spaces")[1]["spaces"])
            inside = sorted(p.name for p in top.iterdir()) if top.is_dir() else []
            self.run.report(job.get("state") == "done" and top.name.startswith("Object export All Spaces ")
                            and inside == names and len(names) == 2,
                            "Export All Spaces: one folder per registered space",
                            f"{job.get('state')}; {top.name}; {inside} (registered {names})")

            # (c) refusals
            res = []
            for folder, words in (
                (str(one / "Pages"), "outside your spaces"),
                (str(two), "outside your spaces"),
                (str(self.tmp / "missing"), "isn't there"),
                ("relative", "Pick a folder (a full path)."),
            ):
                c, r = served.http("POST", "/full-export", {"scope": "current", "folder": folder})
                if c != 422 or words not in str(r.get("detail") if isinstance(r, dict) else r):
                    res.append(f"{folder}: {c} {r}")
            self.run.report(not res, "a folder inside a space (and a missing or relative one) is refused 422", *res)
            self.run.report(not (one / "Pages" / f"Object export {name}").exists()
                            and not any(p.name.startswith("Object export") for p in (*one.rglob("*"), *two.rglob("*"))),
                            "no export folder appears inside a space")
            after = (tree(one), tree(two))
            self.run.report(after == before, "nothing is written in either space",
                            *(f"changed: {p}" for p in differ(before[0], after[0]) + differ(before[1], after[1])))

            # (d) the automated export's settings, then a server start on a moved clock
            auto_dest = self.tmp / "auto-export"
            auto_dest.mkdir()
            c1, _ = put_settings(served, {"fullExportAuto": True, "fullExportFolder": str(one / "Pages"),
                                          "fullExportInterval": "daily", "fullExportScope": "current"})
            blocked = served.http("GET", "/full-export/status")[1]["auto"].get("blocked") or ""
            self.run.report(c1 == 200 and "outside your spaces" in blocked,
                            "an automated export into a folder inside a space is blocked", f"{c1} {blocked!r}")
            c2, _ = put_settings(served, {"fullExportFolder": str(auto_dest)})
        finally:
            served.stop()
        self.automated(one, auto_dest, name, c2 == 200)

    def automated(self, one: Path, dest: Path, name: str, set_ok: bool) -> None:
        clock = self.tmp / "clock.txt"
        t0 = datetime(2026, 11, 10, 9, 5, tzinfo=UTC)
        os.environ["OBJECT_CLOCK_FILE"] = str(clock)

        def start_at(when: datetime, want_last: str | None, last: bool = False) -> dict:
            """Start the app at ``when``; wait for ``lastRun`` to read ``want_last`` (a few
            seconds when no run is expected); with ``last``, turn the automated export off."""
            clock.write_text(when.isoformat().replace("+00:00", "Z"), "utf-8")
            served = Served(one)
            try:
                end = time.monotonic() + (15 if want_last else 3)
                while True:
                    auto = served.http("GET", "/full-export/status")[1]["auto"]
                    done = want_last and auto.get("lastRun") == want_last and not auto.get("running")
                    if done or time.monotonic() > end:
                        break
                    time.sleep(0.1)
                if last:
                    put_settings(served, {"fullExportAuto": False})
                return auto
            finally:
                served.stop()

        try:
            before = tree(one)
            auto = start_at(t0, "2026-11-10T09:05:00Z")
            runs = sorted(p.name for p in dest.iterdir())
            self.run.report(set_ok and len(runs) == 1 and runs[0].startswith(f"Object export {name} ")
                            and auto.get("nextRun") == "2026-11-11T09:05:00Z",
                            "Automated Full Exports (daily, on): a server start runs one export",
                            f"{runs}; lastRun {auto.get('lastRun')}; nextRun {auto.get('nextRun')}; "
                            f"lastError {auto.get('lastError')}")
            auto = start_at(t0 + timedelta(hours=23), None)
            runs = sorted(p.name for p in dest.iterdir())
            self.run.report(len(runs) == 1 and auto.get("lastRun") == "2026-11-10T09:05:00Z",
                            "a start 23 hours later runs none", f"{runs}; lastRun {auto.get('lastRun')}")
            auto = start_at(t0 + timedelta(hours=24), "2026-11-11T09:05:00Z", last=True)
            runs = sorted(p.name for p in dest.iterdir())
            self.run.report(len(runs) == 2 and auto.get("nextRun") == "2026-11-12T09:05:00Z",
                            "a start 24 hours later runs the next one, in its own dated folder",
                            f"{runs}; lastRun {auto.get('lastRun')}; nextRun {auto.get('nextRun')}")
            self.run.report(differ(before, tree(one)) == [], "the automated runs write nothing in the space",
                            *(f"changed: {p}" for p in differ(before, tree(one))))
        finally:
            os.environ.pop("OBJECT_CLOCK_FILE", None)


# -- 2. saved queries over /api/v1 ------------------------------------------------------------


def _md(path: Path, front: dict, body: str = "") -> None:
    lines = ["---"]
    for k, v in front.items():
        if isinstance(v, list):
            lines.append(f"{k}:")
            lines += [f"  - '{x}'" for x in v]
        elif isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        else:
            lines.append(f"{k}: {v}")
    lines += ["---", body, ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


TAGS = {"alpha": "tag-alpha", "beta": "tag-beta", "gamma": "tag-gamma"}
S = lambda *terms, mode="auto": {"searchTerms": [{"text": t} for t in terms], "searchMode": mode}  # noqa: E731
QUERIES = [
    # name, definition, the app's answer (Secret is excluded from AI and never shows)
    ("Search text", {"search": S("quokka")}, ["db", "Both", "Alpha plan"]),
    ("Tags any of", {"tags": {"ids": [TAGS["alpha"], TAGS["beta"]], "operator": "or"}},
     ["web", "Both", "Beta notes", "Alpha plan"]),
    ("Tags all of", {"tags": {"ids": [TAGS["alpha"], TAGS["beta"]], "operator": "and"}}, ["Both"]),
    ("Excluded types", {"tags": {"ids": [TAGS["alpha"]], "operator": "or"}, "excludeTypeIds": ["server"]},
     ["Both", "Alpha plan"]),
    ("Left-out tags", {"tags": {"ids": [TAGS["alpha"], TAGS["gamma"]], "operator": "or"},
                       "excludeTags": {"ids": [TAGS["beta"]]}}, ["db", "web", "Alpha plan"]),
    ("In no collection", {"types": [{"id": "page", "inNoCollection": True}]}, ["Plain", "Beta notes"]),
    ("Not these, and these", {"types": [{"id": "page", "excludeCollectionIds": ["ops"]},
                                        {"id": "server", "collectionIds": ["ops"]}]},
     ["web", "Plain", "Beta notes", "Alpha plan"]),
    ("All together", {"types": [{"id": "page", "excludeCollectionIds": ["ops"]}, {"id": "server"}],
                      "search": S("quokka"), "excludeTags": {"ids": [TAGS["gamma"]]}}, ["Alpha plan"]),
]


def check_queries(run: Run, tmp: Path) -> None:
    print("\n2. Saved queries over /api/v1 list what the app lists")
    from objectapp.queryeval import query_ctx, query_scope, run_query

    root = tmp / "query-space"
    root.mkdir()
    served = Served(root)
    try:
        code, st = served.http("POST", "/types", {"name": "Server", "pluralName": "Servers"})
        st["propertyDefinitions"] = [*st.get("propertyDefinitions", []), _def("estimate", "Estimate", "number")]
        c2, _ = served.http("PUT", f"/types/{st['id']}", {"type": st, "baseRevision": st.get("revision", "")})
        c3 = [served.http("POST", "/collections", {"name": n, "typeIds": []})[0] for n in ("Tooling", "Ops")]
    finally:
        served.stop()
    run.report((code, c2, c3) == (201, 200, [201, 201]), "the Server type and the collections Tooling and Ops are made",
               f"{code} {c2} {c3}")
    for tag, tid in TAGS.items():
        _md(root / "Tags" / f"{tag}.md", {"type": "Tag", "id": tid, "createdAt": "2026-09-01T00:00:00Z"})
    page = {"type": "Page"}
    _md(root / "Pages/Alpha plan.md", {**page, "tags": ["alpha"], "collections": ["Tooling"],
                                       "createdAt": "2026-10-01T00:00:00Z"}, "The quokka plan.")
    _md(root / "Pages/Beta notes.md", {**page, "tags": ["beta"], "createdAt": "2026-10-02T00:00:00Z"}, "Nothing.")
    _md(root / "Pages/Both.md", {**page, "tags": ["alpha", "beta"], "collections": ["Ops"],
                                 "createdAt": "2026-10-03T00:00:00Z"}, "A quokka again.")
    _md(root / "Pages/Secret.md", {**page, "tags": ["alpha"], "excludeFromAI": True,
                                   "createdAt": "2026-10-04T00:00:00Z"}, "A quokka, kept from AI.")
    _md(root / "Pages/Plain.md", {**page, "collections": ["Gone"], "createdAt": "2026-10-05T00:00:00Z"})
    _md(root / "Servers/web.md", {"type": "Server", "tags": ["alpha"], "collections": ["Ops"], "estimate": 3,
                                  "createdAt": "2026-10-06T00:00:00Z"})
    _md(root / "Servers/db.md", {"type": "Server", "tags": ["gamma"], "estimate": 9,
                                 "createdAt": "2026-10-07T00:00:00Z"}, "The quokka database.")
    served = Served(root)
    try:
        secret = token(served, "read")
        space = served.space
        base = {"types": [], "filterGroup": {"type": "filterGroup", "operator": "and", "elements": []},
                "sorts": [], "groupBy": None}
        for name, definition, expected in QUERIES:
            code, made = served.http("POST", "/queries", {"name": name, "definition": {**base, **definition}})
            if code != 201:
                run.report(False, f"{name}: saved", f"{code} {made}")
                continue
            qid = made["id"]
            code, res = bearer(served.base, secret, "POST", f"/v1/queries/{qid}/run", {})
            got = [r["title"] for r in res.get("rows", [])] if code == 200 else []
            # The app's own two steps: the rows the query page asks for, then its pipeline.
            d = next(q for q in space.list_queries() if q.id == qid).definition
            scope = query_scope(d, [t.id for t in space.types])
            _c, rows = served.http("POST", "/rows", {**scope, "preview": False})
            ids = scope.get("typeIds") or list(dict.fromkeys(r["summary"]["type"] for r in rows["rows"]))
            ctx = query_ctx(space, [i for i in ids if space.type_by_id(i)] or [t.id for t in space.types])
            app = [r["summary"]["title"] for r in run_query(d, rows["rows"], ctx).rows if r["summary"]["title"] != "Secret"]
            run.report(code == 200 and got == app == expected and "unsupported" not in res,
                       f"{name}: /api/v1 lists {expected}, the app's list",
                       f"{code}; /api/v1 {got}; the app {app}")
    finally:
        served.stop()


# -- 3. the import conventions in every space; one Resolved on an Incident ----------------------


def check_conventions(run: Run, tmp: Path) -> None:
    print("\n3. The import conventions in a space not set up as IT operations; one Resolved")
    root = copy_space("space-sample", tmp / "plain-space")
    src = tmp / "plain-source"
    (src / "Boxes").mkdir(parents=True)
    (src / "Boxes" / "Box 1.md").write_text("Box 1 has 4 cores.\n", encoding="utf-8")
    served = Served(root)
    try:
        setup = served.space.root / ".object" / "space.json"
        setup_value = json.loads(setup.read_text("utf-8")).get("setup") if setup.is_file() else None
        types = {t["id"] for t in served.http("GET", "/space")[1]["types"]}
        run.report(setup_value is None and "host" not in types and "incident" not in types,
                   "space-sample has no setup and none of the IT ops types", f"setup {setup_value!r}")
        code, res = served.http("POST", "/import/batches", {"path": str(src)})
        if not run.report(code == 200, "POST /api/import/batches makes a draft batch", f"{code} {res}"):
            return
        batch = res["batch"]
        secret = token(served, "read-write")
        items = [
            {"id": "g1", "action": "create", "group": "Box", "name": "Box", "documents": 10,
             "examples": ["Boxes/Box 1.md"], "properties": PROJECT_PROPS},
            {"id": "g4", "action": "create", "group": "Rack", "name": "Rack", "documents": 10,
             "examples": ["Boxes/Box 1.md"], "properties": [{"name": "Cores", "kind": "number", "share": 1.0},
                                                            {"name": "Owner", "kind": "text", "share": 1.0}]},
            {"id": "g2", "action": "create", "group": "Docs", "name": "Docs", "documents": 10,
             "examples": ["Boxes/Box 1.md"], "properties": [{"name": "Memory", "kind": "number", "share": 1.0}]},
            {"id": "g3", "action": "extend", "group": "Servers", "name": "Server", "documents": 10,
             "properties": [{"name": "Owner", "kind": "entity", "target": "Person", "share": 1.0},
                            {"name": "Backs up", "kind": "entity", "target": "Vault", "share": 1.0}]},
        ]
        types_before = {k: v for k, v in tree(root).items() if k.startswith(".object/types/")}
        code, saved = bearer(served.base, secret, "POST", "/v1/import/proposal",
                             {"batch": batch, "proposal": {"summary": "Boxes", "items": items}})
        run.report(code == 200, "the agent's proposal is saved over /api/v1", f"{code} {saved}")
        code, view = served.http("GET", f"/import/batches/{batch}/proposal")
        groups = {g["id"]: g for g in view["proposal"]["groups"]} if code == 200 else {}
        box, docs, ext, rack = (groups.get(k, {}) for k in ("g1", "g2", "g3", "g4"))
        offer = box.get("offer") or {}
        run.report(LOOKALIKE in (box.get("problems") or []) and offer.get("label") == OFFER
                   and offer.get("typeId") == "project" and offer.get("category") == "Box",
                   f'a new "Box" with Project\'s properties: "{LOOKALIKE}" and the offer "{OFFER}"',
                   f"problems {box.get('problems')}; offer {offer}")
        run.report(rack.get("problems") == [] and not rack.get("offer"),
                   'a new "Rack" with two properties named like Server\'s (Cores, Owner) is not a look-alike',
                   f"problems {rack.get('problems')}; offer {rack.get('offer')}")
        run.report("Docs is a category: a property value or a tag, not a type." in (docs.get("problems") or []),
                   'a tag name ("Docs") is a category, not a type', f"{docs.get('problems')}")
        dropped = [d.get("name") for d in ext.get("dropped") or []]
        run.report([p.get("name") for p in ext.get("properties") or []] == ["Owner"] and dropped == ["Backs up"],
                   'a relation to a type neither in the space nor proposed ("Backs up" to Vault) stays a plain link',
                   f"properties {[p.get('name') for p in ext.get('properties') or []]}; dropped {ext.get('dropped')}")
        types_after = {k: v for k, v in tree(root).items() if k.startswith(".object/types/")}
        run.report(types_after == types_before, "the proposal writes no type")

        # One Resolved on an Incident: a new IT ops space's and the type gallery's.
        loc = tmp / "new-ops"
        loc.mkdir()
        code, made = served.http("POST", "/spaces", {"name": "Ops", "location": str(loc), "setup": "itops"})
        incident = (json.loads((Path(made["path"]) / ".object" / "types" / "incident.json").read_text("utf-8"))
                    if code == 201 else {"propertyDefinitions": []})
        props = incident["propertyDefinitions"]
        resolved = [p for p in props if p["name"] == "Resolved"]
        run.report(len(resolved) == 1 and resolved[0]["key"] == "resolved" and resolved[0]["type"] == "datetime"
                   and not any(p["key"] == "deskResolved" for p in props),
                   "a new IT ops space's Incident has one Resolved (its own date and time), no deskResolved",
                   f"{code}; Resolved: {[(p['key'], p['type']) for p in resolved]}")
        _c, gallery = served.http("GET", "/type-gallery")
        g = next((t for t in gallery if t["key"] == "incident"), {"properties": []})
        names = [p["name"] for p in g["properties"]]
        run.report(names.count("Resolved") == 1, "the type gallery's Incident has one Resolved", f"{names}")
    finally:
        served.stop()


# -- 4. git provenance -----------------------------------------------------------------------


def _git(repo: Path, *args: str, date: str = DATE) -> str:
    env = {**os.environ, "GIT_AUTHOR_NAME": AUTHOR, "GIT_AUTHOR_EMAIL": "ada@example.invalid",
           "GIT_COMMITTER_NAME": AUTHOR, "GIT_COMMITTER_EMAIL": "ada@example.invalid",
           "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date}
    return subprocess.run(["git", "-c", "core.autocrlf=false", "-c", "init.defaultBranch=main", *args],
                          cwd=repo, env=env, check=True, capture_output=True, text=True).stdout


def check_git(run: Run, tmp: Path) -> None:
    print("\n4. An import from a git repository")
    from objectapp.spaces import create_space

    repo = tmp / "repo"
    (repo / "docs" / "Hosts").mkdir(parents=True)
    (repo / "README.md").write_text("Top.\n", encoding="utf-8")
    (repo / "docs" / "Home.md").write_text("# Home\n\nSee [[APP01]].\n", encoding="utf-8")
    (repo / "docs" / "Hosts" / "APP01.md").write_text("APP01 runs Payroll.\n", encoding="utf-8")
    (repo / "docs" / "Hosts" / "Old box.md").write_text("Retired.\n", encoding="utf-8")
    _git(repo, "init", "-q")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "first")
    (repo / "docs" / "Hosts" / "APP01.md").write_text("APP01 runs Payroll.\n\nMore.\n", encoding="utf-8")
    _git(repo, "add", "docs/Hosts/APP01.md")
    _git(repo, "commit", "-q", "-m", "second", date="2026-10-05T12:00:00+00:00")
    _git(repo, "remote", "add", "origin", REMOTE)
    (repo / "docs" / "Hosts" / "Old box.md").write_text("Retired in 2026.\n", encoding="utf-8")  # not committed
    (repo / "docs" / "Draft.md").write_text("Not in git yet.\n", encoding="utf-8")  # never committed
    head = _git(repo, "rev-parse", "HEAD").strip()
    status_before = _git(repo, "status", "--porcelain", "--untracked-files=all")
    repo_before = tree(repo)

    (tmp / "git-target").mkdir()
    root = create_space("Imported", tmp / "git-target")
    served = Served(root)
    try:
        _pv, job = import_folder(served, repo / "docs", keepAsSources=False)
    finally:
        served.stop()
    run.report(job.get("phase") == "done", "the import of the repository's docs folder is done", f"{job.get('phase')}")
    blocks = {}
    for p in root.rglob("*.md"):
        if ".object" not in p.parts and isinstance(fm(p).get("importSource"), dict):
            b = fm(p)["importSource"]
            blocks[b["id"]] = b
    home, app01, old, draft = (blocks.get(k, {}) for k in ("Home.md", "Hosts/APP01.md", "Hosts/Old box.md", "Draft.md"))
    web = f"https://github.com/acme/ops-wiki/blob/{head}/docs"
    run.report(home.get("system") == "wiki" and home.get("version") == head and home.get("url") == f"{web}/Home.md"
               and home.get("author") == AUTHOR and str(home.get("modified", "")).startswith("2026-10-01T09:30:00")
               and "uncommitted" not in home,
               "a committed file: the commit, the web link at that commit, the last author and date",
               f"{home}")
    run.report(app01.get("url") == f"{web}/Hosts/APP01.md" and str(app01.get("modified", "")).startswith("2026-10-05T12:00:00"),
               "a file changed in a later commit has that commit's date", f"{app01.get('modified')}")
    run.report(old.get("uncommitted") is True and old.get("version") == head and old.get("url") == f"{web}/Hosts/Old%20box.md",
               "a file changed since the commit is flagged uncommitted (still that commit's link)", f"{old}")
    run.report(draft.get("uncommitted") is True and str(draft.get("version", "")).startswith("sha256:")
               and str(draft.get("url", "")).startswith("file:"),
               "a file never committed is flagged uncommitted, with no commit and no web link", f"{draft}")
    report_path = root / ((job.get("result") or {}).get("reportPath") or "missing")
    report = report_path.read_text(encoding="utf-8") if report_path.is_file() else ""
    run.report("## Git" in report and f"- Imported at commit `{head}`." in report
               and "(`Hosts/Old box.md`): has changes not committed to git" in report
               and "(`Draft.md`): has changes not committed to git" in report
               and "(`Home.md`): has changes" not in report,
               "the import report's Git section names the commit and the two uncommitted files")
    run.report(tree(repo) == repo_before and _git(repo, "status", "--porcelain", "--untracked-files=all") == status_before,
               "the repository is unchanged")


# -- 5. remodel ------------------------------------------------------------------------------


def check_remodel(run: Run, tmp: Path) -> None:
    print("\n5. Remodel this space: the open space's folder imported into a new space")
    root = copy_space("space-itops", tmp / "IT ops test")
    served = Served(root)
    try:
        before = tree(root)
        originals = {o["path"]: o for o in served.http("GET", "/objects")[1]}
        type_ids = {t["id"] for t in served.http("GET", "/space")[1]["types"]}
        used = {o["type"] for o in originals.values()}
        out = tmp / "remodel-out"
        out.mkdir()
        target = {"kind": "newSpace", "name": "IT ops remodel", "location": str(out)}
        pv, job = import_folder(served, root, target, keepAsSources=False)
        run.report(pv["mapping"].get("typeSource") == "key" and pv["mapping"].get("typeKey") == "type",
                   "the preview reads each object's type from its type key", f"{pv['mapping'].get('typeSource')}")
        run.report(job.get("phase") == "done", "the import into the new space is done", f"{job.get('phase')} {job.get('error')}")
        after = tree(root)
    finally:
        served.stop()
    new = out / "IT ops remodel"
    new_types = {p.stem for p in (new / ".object" / "types").glob("*.json")}
    missing_types = sorted(type_ids - new_types)
    empty = sorted(type_ids - used)
    run.report({"command", "meeting", "project", "prompt", "script", "source"} <= set(empty) and not missing_types,
               f"the new space has every type of the space ({len(type_ids)}), the {len(empty)} with no object "
               "included", f"missing {missing_types}", f"with no object: {empty}")
    changed = []
    for tid in sorted(type_ids & new_types - {"page", "tag"}):
        if not (root / ".object" / "types" / f"{tid}.json").is_file():
            # M32: the built-in Task and DailyNote are listed from memory until their first
            # object (no file to compare); the new space was made with its own.
            continue
        a = json.loads((root / ".object" / "types" / f"{tid}.json").read_text("utf-8"))
        b = json.loads((new / ".object" / "types" / f"{tid}.json").read_text("utf-8"))
        props = [(p.get("key"), p.get("name"), p.get("type"), [o.get("text") for o in (p.get("options") or {}).get("set") or []])
                 for p in a.get("propertyDefinitions") or []]
        got = [(p.get("key"), p.get("name"), p.get("type"), [o.get("text") for o in (p.get("options") or {}).get("set") or []])
               for p in b.get("propertyDefinitions") or []]
        if any(a.get(k) != b.get(k) for k in ("name", "pluralName", "icon", "color")) or got != props:
            changed.append(tid)
    run.report(not changed, "each carried type keeps its name, plural, icon, colour, properties and options",
               *(f"differs: {t}" for t in changed))
    missing, wrong = [], []
    for rel, o in originals.items():
        f = new / rel
        if not f.is_file():
            missing.append(rel)
            continue
        if str(fm(f).get("type", "")).lower() != str(fm(root / rel).get("type", "")).lower():
            wrong.append(f"{rel}: {fm(f).get('type')}")
    run.report(not missing and not wrong, f"each of the {len(originals)} objects is at its own path with its type",
               *(f"missing: {m}" for m in missing), *(f"type: {w}" for w in wrong))
    host = fm(new / "Hosts" / "APP-TEST-01.md") if (new / "Hosts" / "APP-TEST-01.md").is_file() else {}
    run.report(host.get("locatedAt") == "[[Rack A]]" and (host.get("importSource") or {}).get("id") == "Hosts/APP-TEST-01.md",
               "a relation is kept (APP-TEST-01 Located at [[Rack A]]) and the object says where it came from",
               f"{host.get('locatedAt')} {host.get('importSource')}")
    run.report(after == before, "the original space is byte for byte the same", *(f"changed: {p}" for p in differ(before, after)))


# -- 9, 13, 14, 15: definitions, the Table property, the Page link view, storage ----------------


def versions(served: Served, rel: str) -> list[dict]:
    code, res = served.http("GET", "/history/definition", path=rel)
    return res["versions"] if code == 200 else []


class Definitions:
    COLLECTION = ".object/collections/reading-list.json"
    QUERY = ".object/queries/open-tasks.json"
    PERSON = ".object/types/person.json"

    def __init__(self, run: Run, served: Served) -> None:
        self.run, self.served, self.http = run, served, served.http

    def collection(self) -> dict:
        return next(x for x in self.http("GET", "/collections")[1] if x["id"] == "reading-list")

    def query(self) -> dict:
        return next(x for x in self.http("GET", "/queries")[1] if x["id"] == "open-tasks")

    def person(self) -> dict:
        return next(t for t in self.http("GET", "/space")[1]["types"] if t["id"] == "person")

    def round_trip(self, label: str, rel: str, read, save, field: str, edited: Any) -> None:
        root = self.served.space.root
        original = read()
        code = save(original, edited)
        n = len(versions(self.served, rel))
        stale = original["revision"]
        on_disk = (root / rel).read_bytes()
        v1 = versions(self.served, rel)[-1]["id"] if n else ""
        c409, r409 = self.http("POST", "/history/definition/restore", {"path": rel, "id": v1, "baseRevision": stale})
        refused = (c409 == 409 and isinstance(r409, dict) and r409.get("currentRevision") == read()["revision"]
                   and (root / rel).read_bytes() == on_disk and len(versions(self.served, rel)) == n)
        self.run.report(code == 200 and n >= 1 and refused,
                        f"{label}: an edit keeps the earlier version; a restore with a stale revision is 409 and writes nothing",
                        f"edit {code}; {n} versions; restore {c409} {r409 if c409 != 409 else ''}")
        c, res = self.http("POST", "/history/definition/restore", {"path": rel, "id": v1, "baseRevision": read()["revision"]})
        back = read()
        vs = versions(self.served, rel)
        self.run.report(c == 200 and back.get(field) == original.get(field) and back["id"] == original["id"]
                        and isinstance(res, dict) and res.get("revision") == back["revision"] and len(vs) == n + 1,
                        f"{label}: the restore puts the earlier version back (the edited one kept as a version)",
                        f"{c}; {field} {back.get(field)!r}; {len(vs)} versions")

    def check_history(self) -> None:
        print("\n9. Definition history: restore a type, a collection and a query")

        def save_collection(col: dict, name: str) -> int:
            return self.http("PUT", "/collections/reading-list",
                             {"collection": {**col, "name": name}, "baseRevision": col["revision"]})[0]

        def save_query(q: dict, desc: str) -> int:
            return self.http("PUT", "/queries/open-tasks", {"query": {**q, "description": desc}, "baseRevision": q["revision"]})[0]

        def save_type(t: dict, desc: str) -> int:
            return self.http("PUT", "/types/person", {"type": {**t, "description": desc}, "baseRevision": t["revision"]})[0]

        self.round_trip("collection", self.COLLECTION, self.collection, save_collection, "name", "Shelf")
        self.round_trip("query", self.QUERY, self.query, save_query, "description", "Only the urgent ones")
        self.round_trip("type", self.PERSON, self.person, save_type, "description", "People I work with")

    def check_table(self) -> None:
        print("\n13. The Table property")
        root = self.served.space.root
        code, t = self.http("POST", "/types", {"name": "Fruit", "pluralName": "Fruits"})
        t["propertyDefinitions"] = [*t["propertyDefinitions"], _def("sizes", "Sizes", "simpleTableBlock"),
                                    _def("note", "Note", "text")]
        c2, saved = self.http("PUT", f"/types/{t['id']}", {"type": t, "baseRevision": t["revision"]})
        stored = json.loads((root / ".object" / "types" / f"{t['id']}.json").read_text("utf-8"))
        self.run.report(code == 201 and c2 == 200 and any(p["key"] == "sizes" and p["type"] == "simpleTableBlock"
                                                          for p in stored["propertyDefinitions"]),
                        "a Table property is added to a type", f"{code} {c2}")
        code, made = self.http("POST", "/objects", {"typeId": t["id"], "title": "Apple", "values": {"note": "ripe"}})
        if not self.run.report(code == 201, "an object of the type is made", f"{code} {made}"):
            return
        path = made["path"]
        before = (root / path).read_bytes()
        c, res = self.http("PUT", "/object/properties", {"path": path, "updates": {"sizes": TABLE}, "remove": [],
                                                         "baseVersion": made["version"]})
        after = (root / path).read_bytes()
        removed, added = diff_keys(before, after)
        text = after.decode("utf-8")
        self.run.report(c == 200 and (removed | added) <= {"sizes", "lastUpdated"} and "sizes" in added
                        and "sizes: |-\n  | Name | Qty |\n  | --- | --- |\n  | Apple | 3 |\n" in text,
                        "PUT /api/object/properties writes the table as a Markdown table, only its own lines and lastUpdated",
                        f"{c}; keys {sorted(removed | added)}")
        _c, rows = self.http("POST", "/rows", {"paths": [path], "preview": False})
        value = rows["rows"][0]["values"].get("sizes") if rows.get("rows") else None
        self.run.report(value == TABLE, "the table reads back as written", f"{value!r}")
        c, res = self.http("PUT", "/object/properties", {"path": path, "updates": {"sizes": "not a table"}, "remove": [],
                                                         "baseVersion": res.get("version") if isinstance(res, dict) else ""})
        self.run.report(c == 422 and (root / path).read_bytes() == after, "a value that is not a table is 422 and writes nothing",
                        f"{c} {res}")
        rev = self.http("GET", "/space")[1]["types"]
        rev = next(x for x in rev if x["id"] == t["id"])["revision"]
        type_file = (root / ".object" / "types" / f"{t['id']}.json").read_bytes()
        sizes_id = next(p["id"] for p in stored["propertyDefinitions"] if p["key"] == "sizes")
        c, res = self.http("POST", f"/types/{t['id']}/properties/{sizes_id}/change-kind",
                           {"toType": "number", "baseRevision": rev})
        detail = res.get("detail") if isinstance(res, dict) else res
        self.run.report(c == 422 and detail == NO_TRANSFORMATIONS
                        and (root / ".object" / "types" / f"{t['id']}.json").read_bytes() == type_file,
                        f'Table to Number is refused: "{NO_TRANSFORMATIONS}"', f"{c} {detail}")
        self.fruit = t["id"]

    def check_link_view(self) -> None:
        print("\n14. The Page link view")
        root = self.served.space.root
        type_id = getattr(self, "fruit", "person")
        path = root / ".object" / "types" / f"{type_id}.json"
        t = next(x for x in self.http("GET", "/space")[1]["types"] if x["id"] == type_id)
        c1, r1 = self.http("PUT", f"/types/{type_id}", {"type": {**t, "defaultViewType": "wideCard"}, "baseRevision": t["revision"]})
        before = path.read_text("utf-8")
        t = r1["type"] if c1 == 200 else t
        c2, r2 = self.http("PUT", f"/types/{type_id}", {"type": {**t, "defaultViewType": "page"}, "baseRevision": t["revision"]})
        after = path.read_text("utf-8")
        a, b = before.splitlines(), after.splitlines()
        changed = [(x, y) for x, y in zip(a, b, strict=False) if x != y] if len(a) == len(b) else ["line count"]
        again = next(x for x in self.http("GET", "/space")[1]["types"] if x["id"] == type_id).get("defaultViewType")
        self.run.report(c1 == 200 and c2 == 200 and again == "page"
                        and changed == [('  "defaultViewType": "wideCard"', '  "defaultViewType": "page"')],
                        'a type\'s link view "page" saves (only that line changes) and reads back', f"{c1} {c2}; {again}; {changed}")

    def check_storage(self, state: Path) -> None:
        print("\n15. Local Storage and Clear media cache")
        root = self.served.space.root
        space_before, state_before = tree(root), tree(state)
        code, body = self.http("GET", "/storage")
        parts_ok = code == 200 and all(isinstance(body.get(k), dict) and body[k].get("bytes", -1) >= 0
                                       for k in ("space", "cache", "state"))
        self.run.report(parts_ok and body.get("total") == sum(body[k]["bytes"] for k in ("space", "cache", "state"))
                        and body["space"]["bytes"] > 0,
                        "GET /api/storage estimates the space, its cache and the app's data for it",
                        f"{code} {body}")
        self.run.report(tree(root) == space_before and tree(state) == state_before, "GET /api/storage writes nothing",
                        *(f"changed: {p}" for p in differ(space_before, tree(root)) + differ(state_before, tree(state))))
        cache = Path(body["cacheFolder"]) if code == 200 else root / "missing"
        (cache / "media").mkdir(parents=True, exist_ok=True)
        (cache / "thumbnails" / "sub").mkdir(parents=True, exist_ok=True)
        (cache / "media" / "a.jpg").write_bytes(b"a" * 300)
        (cache / "thumbnails" / "sub" / "b.png").write_bytes(b"b" * 200)
        (cache / "m31-keep.bin").write_bytes(b"k" * 50)
        others = sorted(p.relative_to(cache).as_posix() for p in cache.rglob("*")
                        if p.is_file() and p.relative_to(cache).parts[0] not in ("media", "thumbnails"))
        space_before = tree(root)
        code, freed = self.http("POST", "/storage/clear-media-cache")
        left = sorted(p.relative_to(cache).as_posix() for p in cache.rglob("*") if p.is_file())
        self.run.report(code == 200 and freed == {"files": 2, "bytes": 500} and not (cache / "media").exists()
                        and not (cache / "thumbnails").exists() and all(o in left for o in others)
                        and (cache / "m31-keep.bin").read_bytes() == b"k" * 50 and tree(root) == space_before,
                        "Clear media cache removes only the cache's media parts (the index, other cache files and the space kept)",
                        f"{code} {freed}; kept {len([o for o in others if o in left])}/{len(others)} other cache files")


def check_definitions(run: Run, tmp: Path) -> None:
    root = copy_space("space-m8", tmp / "space-m8")
    served = Served(root)
    try:
        d = Definitions(run, served)
        d.check_history()
        d.check_table()
        d.check_link_view()
        d.check_storage(Path(os.environ["OBJECT_STATE_DIR"]))
    finally:
        served.stop()


# -- main ----------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--keep", action="store_true", help="keep the temporary folder")
    args = ap.parse_args(argv)
    names = ("space-sample", "space-whiteboard", "space-itops", "space-m8")
    fixtures_before = {n: tree(FIXTURES / n) for n in names}

    tmp = Path(tempfile.mkdtemp(prefix="m31-acceptance-")).resolve()
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    os.environ.pop("OBJECT_CLOCK_FILE", None)
    os.environ.update({"OBJECT_STATE_DIR": str(tmp / "state"), "OBJECT_CACHE_DIR": str(tmp / "cache")})
    run = Run(tmp, lambda *a, **k: (0, None))
    try:
        print(f"Working folder: {tmp}")
        FullExport(run, tmp).check()
        check_queries(run, tmp)
        check_conventions(run, tmp)
        check_git(run, tmp)
        check_remodel(run, tmp)
        check_definitions(run, tmp)
        print("\nThe fixtures")
        run.report(all(tree(FIXTURES / n) == fixtures_before[n] for n in names), "the fixture folders are unchanged")
    except Exception as exc:  # report a crash as a failure, then clean up
        run.report(False, f"the run stopped: {exc!r}")
        raise
    finally:
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        if args.keep:
            print(f"\nKept: {tmp}")
        else:
            remove_tree(tmp)

    print("\nRESULT:", "PASS" if run.failures == 0 else f"FAIL ({run.failures})")
    return 0 if run.failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
