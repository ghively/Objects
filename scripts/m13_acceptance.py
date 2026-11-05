"""Milestone 13 acceptance run over HTTP (calendar, timeline and chart layouts, relation pairs).

Usage: ``uv run python scripts/m13_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo, opens it twice and serves it with ``create_app`` on a free ``127.0.0.1``
port. ``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR``, ``OBJECT_CLOCK_FILE`` and the fake
notify/open/trash files point at temporary paths outside the copy. Over HTTP it first creates
an "M13 Story" type with a ``datetime`` property ``m13Due`` and three objects of it (Page and
Task are basic types, which can't take the pairs), and commits that. Then it checks:

 1. reading writes nothing: the type, its views, ``POST /api/rows`` and the objects leave
    ``git status`` clean, on the first start and on a second one;
 2. views: saving the type's views with each new layout (``calendar``, ``timeline``, ``chart``)
    and its settings key, plus ``subItemsConfig`` and ``dependenciesConfig``, round-trips
    through ``PUT``/``GET /api/views/{typeId}`` (only ``.object/views/<typeId>.json`` changes);
 3. relation pairs: ``POST /api/types/{typeId}/relation-pair`` adds "Parent item"/"Sub-items"
    and "Blocked by"/"Blocking" (self-targeting entity relations linked by property syncing),
    changing only the type file; a second call reuses them (``created: false``, same ids,
    same revision) and changes nothing; a stale revision answers 409 and changes nothing;
    ``git status`` shows no ``.md`` file touched;
 4. syncing: setting A's "Blocked by" to B fills B's "Blocking" with A, and in each file only
    that line and ``lastUpdated`` change (the clock is stepped before each write, so the stamp
    shows); "Parent item" on C fills A's "Sub-items";
 5. a timeline drag's write (a date range moved by two days) changes only that date line and
    ``lastUpdated``;
 6. reading again (rows, views, objects) leaves ``git status`` clean.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from m2_acceptance import (
    Run,
    _def,
    changed_paths,
    check_migration,
    commit,
    git,
    remove_tree,
    snapshot,
)
from m8_acceptance import Served, diff_keys, fm_of, set_clock
from objectapp.appstate import state_dir
from objectapp.spaces import Registry

NOW = "2026-11-05T12:00:00Z"
TYPE_NAME = "M13 Story"
DUE = "m13Due"
TITLES = ("M13 Alpha", "M13 Beta", "M13 Gamma")
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE", "OBJECT_FAKE_NOTIFY_FILE",
         "OBJECT_FAKE_OPEN_FILE", "OBJECT_FAKE_TRASH_FILE")

PAIRS = {
    "subItems": (("Parent item", False), ("Sub-items", True)),
    "dependencies": (("Blocked by", True), ("Blocking", True)),
}


def view_state(layout: str, extra: dict[str, Any]) -> dict[str, Any]:
    return {
        "viewDefinition": {"dataViewLayout": layout, **extra},
        "filterGroup": {"type": "filterGroup", "operator": "and", "elements": []},
        "sorts": [],
        "groupBy": None,
    }


LAYOUT_CONFIGS: dict[str, dict[str, Any]] = {
    "calendar": {"calendarConfig": {"dateProperty": DUE, "mode": "week"}},
    "timeline": {
        "timelineConfig": {"startProperty": DUE, "endProperty": None, "zoom": "month", "showTable": True,
                           "tableColumns": ["tags"], "showDependencies": False},
        "subItemsConfig": {"parentPropertyId": "parentItem", "childrenPropertyId": "subItems"},
        "dependenciesConfig": {"blockedByPropertyId": "blockedBy", "blockingPropertyId": "blocking"},
    },
    "chart": {"chartConfig": {"kind": "horizontalBar", "xProperty": "tags", "xDateBucket": "week", "yCalc": "countAll",
                              "yProperty": None, "splitBy": None, "cumulative": False, "sort": "yDescending",
                              "hideEmptyGroups": False, "showLegend": True, "showValues": True}},
}


class M13:
    def __init__(self, root: Path, run: Run, clock: Path) -> None:
        self.root = root
        self.run = run
        self.clock = clock
        self.minutes = 0
        self.type_id = ""
        self.paths: list[str] = []

    @property
    def http(self):
        return self.run.http

    def clean(self) -> bool:
        return not git(self.root, "status", "--porcelain", "-uall").strip()

    def status(self) -> list[str]:
        return [ln for ln in git(self.root, "status", "--porcelain", "-uall").splitlines() if ln.strip()]

    def type(self) -> dict:
        t = next((x for x in self.run.types() if x["id"] == self.type_id), None)
        assert t is not None, self.type_id
        return t

    def tick(self) -> None:
        """Step the clock a few minutes, so each write stamps a new ``lastUpdated``."""
        self.minutes += 5
        set_clock(self.clock, f"2026-11-05T12:{self.minutes:02d}:00Z")

    def put_props(self, rel: str, updates: dict) -> tuple[int, Any]:
        self.tick()
        return self.http("PUT", "/object/properties", {"path": rel, "updates": updates, "remove": [],
                                                      "baseVersion": self.run.obj(rel)["version"], "clientId": "m13"})

    # 0 -----------------------------------------------------------------------------------
    def prepare(self) -> None:
        notes = []
        t = self.run.type_named(TYPE_NAME)
        if t is None:
            code, res = self.http("POST", "/types", {"name": TYPE_NAME, "pluralName": "M13 Stories"})
            assert code == 201, (code, res)
            t = self.run.type_named(TYPE_NAME)
            notes.append(f"type {TYPE_NAME!r} ({t['id']})")
        if not any(d["key"] == DUE for d in t["propertyDefinitions"]):
            t["propertyDefinitions"].append(_def(DUE, "M13 due", "datetime"))
            code, res = self.run.save_type(t, confirm=True)
            assert code == 200, (code, res)
            notes.append(f"datetime property {DUE!r}")
        self.type_id = t["id"]
        for title in TITLES:
            code, res = self.http("POST", "/objects", {"typeId": self.type_id, "title": title, "templateId": "none"})
            assert code in (200, 201), (code, res)
            self.paths.append(res["path"])
            notes.append(f"object {res['path']}")
        # Give A a date range (the timeline's bar) and commit, so later diffs show only the checks' writes.
        code, res = self.put_props(self.paths[0], {DUE: {"start": "2026-11-02", "end": "2026-11-04", "resolution": "day"}})
        assert code == 200, (code, res)
        time.sleep(0.3)
        commit(self.root, "m13 prepared")
        print("   Prepared:", *notes, sep="\n     ")

    # 1, 6 ----------------------------------------------------------------------------------
    def reads(self, label: str) -> None:
        codes: dict[str, set[int]] = {}

        def call(name: str, code: int) -> None:
            codes.setdefault(name, set()).add(code)

        for _ in range(2):
            call("/space", self.http("GET", "/space")[0])
            call("/views", self.http("GET", f"/views/{self.type_id}")[0])
            call("/rows", self.http("POST", "/rows", {"typeIds": [self.type_id]})[0])
            for p in self.paths:
                call("/object", self.http("GET", "/object", path=p)[0])
        time.sleep(0.4)
        status = self.status()
        self.run.report(not status and all(c == {200} for c in codes.values()),
                        f"{label}: {sorted(codes)} answered {sorted({c for v in codes.values() for c in v})}; "
                        f"git status clean {not status}", *status)

    # 2 -----------------------------------------------------------------------------------
    def views(self) -> None:
        print("\n2. Views store the new layouts and their settings")
        for layout, extra in LAYOUT_CONFIGS.items():
            code, cur = self.http("GET", f"/views/{self.type_id}")
            views = dict(cur["views"])
            views["all"] = view_state(layout, extra)
            before = snapshot(self.root)
            code, _res = self.http("PUT", f"/views/{self.type_id}",
                                  {"views": views, "baseRevision": cur["revision"], "clientId": "m13"})
            changed = changed_paths(before, snapshot(self.root))
            _, back = self.http("GET", f"/views/{self.type_id}")
            vd = back["views"]["all"]["viewDefinition"]
            same = vd == {"dataViewLayout": layout, **extra}
            self.run.report(code == 200 and same and changed == [f".object/views/{self.type_id}.json"],
                            f"{layout}: PUT {code}; read back equal {same}; changed {changed}")
        commit(self.root, "m13 views")

    # 3 -----------------------------------------------------------------------------------
    def pairs(self) -> None:
        print("\n3. Relation pairs")
        type_file = f".object/types/{self.type_id}.json"
        self.ids: dict[str, tuple[str, str]] = {}
        for kind, ((first, first_list), (second, second_list)) in PAIRS.items():
            before = snapshot(self.root)
            t = self.type()
            code, res = self.http("POST", f"/types/{self.type_id}/relation-pair",
                                  {"kind": kind, "baseRevision": t["revision"], "clientId": "m13"})
            changed = changed_paths(before, snapshot(self.root))
            ok = code == 200 and res.get("created") is True
            if ok:
                defs = {d["id"]: d for d in res["type"]["propertyDefinitions"]}
                a, b = defs.get(res["firstId"], {}), defs.get(res["secondId"], {})
                ok = (a.get("name"), b.get("name")) == (first, second) and all(
                    d.get("type") == "entity" and d["options"].get("allowedTypes") == [self.type_id]
                    for d in (a, b)
                ) and (a["options"].get("isArray"), b["options"].get("isArray")) == (first_list, second_list) and \
                    a["options"].get("propertySyncing") == {"propertyIds": [b["id"]]} and \
                    b["options"].get("propertySyncing") == {"propertyIds": [a["id"]]} and \
                    res["type"]["revision"] == self.type()["revision"]
                self.ids[kind] = (a.get("key", ""), b.get("key", ""))
            self.run.report(ok and changed == [type_file],
                            f"{kind}: {code}, created {res.get('created') if isinstance(res, dict) else res}; "
                            f"keys {self.ids.get(kind)}; changed {changed}")
            # Again: reused, nothing written.
            before = snapshot(self.root)
            rev = self.type()["revision"]
            code2, res2 = self.http("POST", f"/types/{self.type_id}/relation-pair",
                                    {"kind": kind, "baseRevision": rev, "clientId": "m13"})
            changed = changed_paths(before, snapshot(self.root))
            self.run.report(code2 == 200 and res2.get("created") is False
                            and (res2.get("firstId"), res2.get("secondId")) == (res.get("firstId"), res.get("secondId"))
                            and res2["type"]["revision"] == rev and not changed,
                            f"{kind} again: {code2}, created {res2.get('created')}; same ids; changed {changed}")
        # Stale revision.
        before = snapshot(self.root)
        code, res = self.http("POST", f"/types/{self.type_id}/relation-pair",
                              {"kind": "subItems", "baseRevision": "stale", "clientId": "m13"})
        changed = changed_paths(before, snapshot(self.root))
        self.run.report(code == 409 and isinstance(res, dict) and res.get("currentRevision") == self.type()["revision"]
                        and not changed, f"stale revision: {code} {res}; changed {changed}")
        md = [ln for ln in self.status() if ".md" in ln]
        self.run.report(not md, f"no object rewritten (git status: {self.status()})")
        commit(self.root, "m13 pairs")

    # 4 -----------------------------------------------------------------------------------
    def syncing(self) -> None:
        print("\n4. Syncing fills the other side")
        blocked_by, blocking = self.ids["dependencies"]
        parent, children = self.ids["subItems"]
        a, b, c = self.paths
        before = {p: (self.root / p).read_bytes() for p in self.paths}
        title_b = fm_of(self.root, b).get("title")
        code, res = self.put_props(a, {blocked_by: [{"target": title_b, "path": b}]})
        time.sleep(0.2)
        after = {p: (self.root / p).read_bytes() for p in self.paths}
        ka = diff_keys(before[a], after[a])
        kb = diff_keys(before[b], after[b])
        fm_b = fm_of(self.root, b)
        title_a = fm_of(self.root, a).get("title")
        self.run.report(code == 200 and res.get("synced") == [b] and str(fm_b.get(blocking)) == str([f"[[{title_a}]]"])
                        and ka[0] <= {"lastUpdated"} and ka[1] == {blocked_by, "lastUpdated"}
                        and kb[0] <= {"lastUpdated"} and kb[1] == {blocking, "lastUpdated"}
                        and after[c] == before[c],
                        f"A blocked by B: {code}, synced {res.get('synced')}; A lines {sorted(ka[1])}, "
                        f"B lines {sorted(kb[1])}; B {blocking} = {fm_b.get(blocking)}; C untouched {after[c] == before[c]}")
        commit(self.root, "m13 dependency")
        before = {p: (self.root / p).read_bytes() for p in self.paths}
        code, res = self.put_props(c, {parent: [{"target": title_a, "path": a}]})
        time.sleep(0.2)
        after = {p: (self.root / p).read_bytes() for p in self.paths}
        kc = diff_keys(before[c], after[c])
        ka = diff_keys(before[a], after[a])
        fm_a = fm_of(self.root, a)
        title_c = fm_of(self.root, c).get("title")
        self.run.report(code == 200 and res.get("synced") == [a] and str(fm_a.get(children)) == str([f"[[{title_c}]]"])
                        and fm_of(self.root, c).get(parent) == f"[[{title_a}]]"
                        and kc[1] == {parent, "lastUpdated"} and ka[1] == {children, "lastUpdated"}
                        and after[b] == before[b],
                        f"C's parent is A: {code}, synced {res.get('synced')}; C lines {sorted(kc[1])}, "
                        f"A lines {sorted(ka[1])}; A {children} = {fm_a.get(children)}")
        commit(self.root, "m13 parent")

    # 5 -----------------------------------------------------------------------------------
    def drag_write(self) -> None:
        print("\n5. A timeline drag's write")
        a = self.paths[0]
        before = (self.root / a).read_bytes()
        code, _res = self.put_props(a, {DUE: {"start": "2026-11-04", "end": "2026-11-06", "resolution": "day"}})
        time.sleep(0.2)
        after = (self.root / a).read_bytes()
        removed, added = diff_keys(before, after)
        changed = self.status()
        self.run.report(code == 200 and removed == {DUE, "lastUpdated"} and added == {DUE, "lastUpdated"}
                        and fm_of(self.root, a).get(DUE) == "2026-11-04 -> 2026-11-06" and len(changed) == 1,
                        f"moved by two days: {code}; lines {sorted(added)}; {DUE} = {fm_of(self.root, a).get(DUE)!r}; "
                        f"files changed {changed}")
        commit(self.root, "m13 drag")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m13-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    clock = tmp / "clock.txt"
    os.environ.update({
        "OBJECT_STATE_DIR": str(tmp / "state"),
        "OBJECT_CACHE_DIR": str(tmp / "cache"),
        "OBJECT_CLOCK_FILE": str(clock),
        "OBJECT_FAKE_NOTIFY_FILE": str(tmp / "notifications.jsonl"),
        "OBJECT_FAKE_OPEN_FILE": str(tmp / "opened.txt"),
        "OBJECT_FAKE_TRASH_FILE": str(tmp / "trashed.txt"),
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
        m13 = M13(root, run, clock)
        print(f"Space copy: {root}")
        print(f"\n0. Opening twice: {mig[0]}", *mig[1:], sep="\n   ")
        run.failures += mig[0] != "ok"
        m13.prepare()

        print("\n1. Reading writes nothing")
        m13.reads("first start")
        served.stop()
        served = Served(root)
        run.http = served.http
        m13.reads("second start")

        m13.views()
        m13.pairs()
        m13.syncing()
        m13.drag_write()

        print("\n6. Reading again writes nothing")
        m13.reads("after the writes")
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
