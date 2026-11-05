"""Milestone 12 acceptance run over HTTP (formula, rollup, ID, email, phone and files kinds).

Usage: ``uv run python scripts/m12_acceptance.py SPACE [--keep] [--timing]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo, opens it twice and serves it with ``create_app`` on a free ``127.0.0.1``
port. ``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR`` and ``OBJECT_CLOCK_FILE``
(2026-11-05T12:00:00Z) point at temporary paths outside the copy. Over HTTP it checks:

 1. opening twice changes no ``.md`` file;
 2. two new types (``M12 Member`` with a number, ``M12 Project`` with a number and a relation
    to members) and four objects made through the API (the seed, committed);
 3. adding two formulas and two rollups to ``M12 Project`` (and a formula to an existing
    non-basic type with objects, when the space has one) through ``PUT /api/types/{id}``
    rewrites no object: ``git status`` shows only the type files;
 4. rows (``POST /api/rows``) and object reads (``GET /api/object``) carry the computed values;
    reading changes nothing;
 5. adding an ID (prefix ``M12-``), an email, a phone and a files property rewrites no object;
 6. two creates get ``M12-1`` and ``M12-2``; "Number existing objects" numbers the other two
    oldest first, unstamped (each diff is the one added line), and moves ``nextNumber`` to 5;
    a stale revision is 409, a non-ID property 422;
 7. email, phone and files values are written (files as ``[[Attachments/…]]`` links) and read
    back; bad values and computed keys are 422 and change nothing;
 8. the formula preview parses, evaluates and reports errors, writing nothing;
 9. a cycle and a rollup of a rollup are refused (422, naming the property), changing nothing;
10. renaming ``Budget`` rewrites ``prop("Budget")`` in the formulas and no object;
11. (``--timing``) 5,000 generated objects of ``M12 Project`` with three formulas and two
    rollups: the rows request time, with and without the computed properties.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import json
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
from m8_acceptance import HOOKS, Served, set_clock
from objectapp.appstate import state_dir
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.spaces import Registry
from objectapp.textfile import decode

NOW = "2026-11-05T12:00:00Z"
MEMBER, PROJECT = "M12 Member", "M12 Project"


def status(root: Path) -> list[str]:
    """The changed paths ``git status`` lists (the cache is ignored by its own .gitignore)."""
    out = []
    for line in git(root, "status", "--porcelain", "-uall").splitlines():
        path = line[3:].strip().strip('"')
        out.append(path)
    return out


def fm_of(root: Path, rel: str) -> dict:
    return parse_fm(split_object(decode((root / rel).read_bytes()).text).frontmatter_src)


class M12:
    def __init__(self, root: Path, run: Run) -> None:
        self.root = root
        self.run = run
        self.paths: dict[str, str] = {}
        self.other: dict | None = None

    @property
    def http(self):
        return self.run.http

    def t(self, name: str) -> dict:
        t = self.run.type_named(name)
        assert t is not None, name
        return t

    def prop(self, t: dict, key: str) -> dict:
        return next(p for p in t["propertyDefinitions"] if p["key"] == key)

    def only_types_changed(self, label: str) -> bool:
        changed = status(self.root)
        bad = [p for p in changed if not p.startswith(".object/")]
        ok = self.run.report(not bad, label, f"changed: {changed or 'nothing'}")
        commit(self.root, label)
        return ok

    # 2 ------------------------------------------------------------------------------------
    def seed(self) -> None:
        print("\n2. Seed types and objects through the API")
        for name, plural in ((MEMBER, "M12 Members"), (PROJECT, "M12 Projects")):
            code, t = self.http("POST", "/types", {"name": name, "pluralName": plural})
            assert code == 201, (code, t)
        m = self.t(MEMBER)
        m["propertyDefinitions"].append(_def("hours", "Hours", "number"))
        code, res = self.run.save_type(m)
        assert code == 200, (code, res)
        p = self.t(PROJECT)
        p["propertyDefinitions"] += [
            _def("budget", "Budget", "number"),
            _def("members", "Members", "entity",
                 {"isArray": True, "allowedTypes": [m["id"]], "hasFixedSet": False, "fixedSet": []}),
        ]
        code, res = self.run.save_type(p)
        assert code == 200, (code, res)
        for title, hours in (("Ann", 5), ("Bob", 7.5)):
            code, res = self.http("POST", "/objects", {"typeId": m["id"], "title": f"M12 {title}",
                                                        "templateId": "none", "values": {"hours": hours}})
            assert code == 201, (code, res)
            self.paths[title] = res["path"]
        refs = [{"target": f"M12 {n}", "path": self.paths[n]} for n in ("Ann", "Bob")]
        for title, values in (("Apollo", {"budget": 100, "members": refs}), ("Gemini", {})):
            code, res = self.http("POST", "/objects", {"typeId": p["id"], "title": f"M12 {title}",
                                                        "templateId": "none", "values": values})
            assert code == 201, (code, res)
            self.paths[title] = res["path"]
        commit(self.root, "seeded")
        self.run.report(True, "types and objects made", *[f"{k}: {v}" for k, v in self.paths.items()])

    # 3 ------------------------------------------------------------------------------------
    def add_computed(self) -> None:
        print("\n3. Adding formulas and rollups rewrites no object")
        m, p = self.t(MEMBER), self.t(PROJECT)
        rel = self.prop(p, "members")["id"]
        hours = self.prop(m, "hours")["id"]
        p["propertyDefinitions"] += [
            _def("double", "Double", "formula", {"expression": 'prop("Budget") * 2'}),
            _def("summary", "Summary", "formula",
                 {"expression": 'prop("Title") + ": " + format(prop("Team hours")) + " h"'}),
            _def("teamHours", "Team hours", "rollup",
                 {"relationId": rel, "targetId": hours, "calc": "sum"}),
            _def("team", "Team", "rollup", {"relationId": rel, "targetId": "title", "calc": "showOriginal"}),
        ]
        code, res = self.run.save_type(p)
        self.run.report(code == 200 and res["rewritten"] == [], "PUT with 2 formulas and 2 rollups",
                        f"{code}, rewritten {res.get('rewritten') if isinstance(res, dict) else res}")
        self.only_types_changed("formula and rollup additions change only the type file")
        # An existing type with objects, when there is one.
        _, objs = self.http("GET", "/objects")
        counts: dict[str, int] = {}
        for o in objs:
            counts[o["type"]] = counts.get(o["type"], 0) + 1
        other = next((t for t in self.run.types()
                      if not t.get("basic") and counts.get(t["id"]) and t["name"] not in (MEMBER, PROJECT)
                      and not t.get("readOnlyReason")), None)
        if other is None:
            print("   (no other non-basic type with objects: skipped the existing-type formula)")
            return
        other["propertyDefinitions"].append(
            _def("m12Shout", "M12 Shout", "formula", {"expression": 'upper(prop("Title")) + "!"'}))
        code, res = self.run.save_type(other)
        self.run.report(code == 200 and res["rewritten"] == [],
                        f"PUT a formula on {other['name']} ({counts[other['id']]} objects)", f"{code}")
        self.only_types_changed(f"the {other['name']} formula changes only the type file")
        self.other = self.t(other["name"])

    # 4 ------------------------------------------------------------------------------------
    def computed_reads(self) -> None:
        print("\n4. Rows and object reads carry computed values")
        p = self.t(PROJECT)
        _, res = self.http("POST", "/rows", {"typeIds": [p["id"]], "preview": False})
        rows = {r["summary"]["path"]: r["values"] for r in res["rows"]}
        a, g = rows[self.paths["Apollo"]], rows[self.paths["Gemini"]]
        self.run.report(
            a["double"] == {"type": "number", "value": 200}
            and a["teamHours"] == {"type": "number", "value": 12.5}
            and a["team"] == {"type": "list", "value": ["M12 Ann", "M12 Bob"]}
            and a["summary"] == {"type": "text", "value": "M12 Apollo: 12.5 h"},
            "rows: Apollo", json.dumps({k: a[k] for k in ("double", "teamHours", "team", "summary")}))
        self.run.report(g["double"] == {"type": "empty", "value": None}
                        and g["teamHours"] == {"type": "empty", "value": None},
                        "rows: Gemini (empty)", json.dumps({k: g[k] for k in ("double", "teamHours")}))
        o = self.run.obj(self.paths["Apollo"])
        self.run.report(o["computed"].get("teamHours") == {"type": "number", "value": 12.5}
                        and "double" not in o["frontmatter"], "object read: computed map",
                        json.dumps(o["computed"]))
        self.run.report(self.run.obj(self.paths["Ann"])["computed"] == {}, "no computed properties: {}")
        if self.other is not None:
            _, objs = self.http("GET", "/objects", type=self.other["id"])
            first = next((x for x in objs if not x.get("template")), None)
            if first is not None:
                got = self.run.obj(first["path"])["computed"].get("m12Shout")
                want = (first["title"].upper() + "!") if first["title"] else "!"
                self.run.report(got == {"type": "text", "value": want}, f"{self.other['name']}: {got}")
        self.run.report(status(self.root) == [], "reading changed no file", f"{status(self.root)}")

    # 5 ------------------------------------------------------------------------------------
    def add_kinds(self) -> None:
        print("\n5. Adding ID, email, phone and files properties rewrites no object")
        p = self.t(PROJECT)
        p["propertyDefinitions"] += [
            _def("code", "Code", "uniqueId", {"prefix": "M12-", "nextNumber": 1}),
            _def("mail", "Mail", "email"),
            _def("phone", "Phone", "phone"),
            _def("files", "Files", "files", {"isArray": True}),
        ]
        code, res = self.run.save_type(p)
        self.run.report(code == 200 and res["rewritten"] == [], "PUT with ID, email, phone, files", f"{code}")
        self.only_types_changed("the additions change only the type file")

    # 6 ------------------------------------------------------------------------------------
    def ids(self) -> None:
        print("\n6. IDs at create and Number existing objects")
        p = self.t(PROJECT)
        made = []
        for title in ("M12 One", "M12 Two"):
            code, res = self.http("POST", "/objects", {"typeId": p["id"], "title": title, "templateId": "none"})
            made.append(res["path"])
            self.run.report(code == 201 and res.get("typeIds") == [p["id"]], f"create {title}",
                            f"typeIds {res.get('typeIds')}")
        codes = [fm_of(self.root, x).get("code") for x in made]
        self.run.report(codes == ["M12-1", "M12-2"], "the new objects get M12-1 and M12-2", f"{codes}")
        commit(self.root, "created two")
        p = self.t(PROJECT)
        pid = self.prop(p, "code")["id"]
        url = f"/types/{p['id']}/properties/{pid}/number-existing"
        code, res = self.http("POST", url, {"baseRevision": "stale"})
        self.run.report(code == 409 and res.get("currentRevision") == p["revision"], "stale revision: 409")
        code, res = self.http("POST", f"/types/{p['id']}/properties/{self.prop(p, 'budget')['id']}/number-existing",
                              {"baseRevision": p["revision"]})
        self.run.report(code == 422, "a non-ID property: 422", f"{code} {res}")
        before = {k: (self.root / self.paths[k]).read_bytes() for k in ("Apollo", "Gemini")}
        code, res = self.http("POST", url, {"baseRevision": p["revision"]})
        ok = code == 200 and res["numbered"] == 2 and sorted(res["rewritten"]) == sorted(
            [self.paths["Apollo"], self.paths["Gemini"]])
        self.run.report(ok, "numbered the two without a value", f"{code} {res.get('rewritten')}")
        got = {k: fm_of(self.root, self.paths[k]).get("code") for k in ("Apollo", "Gemini")}
        # Both were created at the same clock instant: the path decides (Apollo first).
        self.run.report(got == {"Apollo": "M12-3", "Gemini": "M12-4"}, "oldest first", f"{got}")
        unstamped = all(
            (self.root / self.paths[k]).read_bytes().replace(f"code: {got[k]}\n".encode(), b"") == before[k]
            for k in ("Apollo", "Gemini")
        )
        self.run.report(unstamped, "unstamped: each diff is the one added line")
        nxt = self.prop(self.t(PROJECT), "code")["options"]["nextNumber"]
        self.run.report(nxt == 5, "nextNumber is 5", f"{nxt}")
        commit(self.root, "numbered")

    # 7 ------------------------------------------------------------------------------------
    def values(self) -> None:
        print("\n7. Email, phone and files values")
        path = self.paths["Apollo"]
        attachments = sorted((self.root / "Attachments").glob("*")) if (self.root / "Attachments").is_dir() else []
        file_rel = f"Attachments/{attachments[0].name}" if attachments else "Attachments/m12-report.pdf"

        def put(updates: dict) -> tuple[int, Any]:
            version = self.run.obj(path)["version"]
            return self.http("PUT", "/object/properties", {"path": path, "updates": updates, "baseVersion": version})

        code, res = put({"mail": "apollo@example.org", "phone": "+1 (555) 010-0199", "files": [file_rel]})
        self.run.report(code == 200, "valid values written", f"{code}")
        text = self.run.text(path)
        self.run.report(f"[[{file_rel}]]" in text and "mail: apollo@example.org" in text,
                        "files written as wikilinks", *[ln for ln in text.splitlines() if ln.startswith("files")])
        _, res = self.http("POST", "/rows", {"paths": [path], "preview": False})
        v = res["rows"][0]["values"]
        self.run.report(v["files"] == [file_rel] and v["mail"] == "apollo@example.org"
                        and v["code"] == "M12-3", "read back", f"{v['files']} {v['mail']} {v['code']}")
        commit(self.root, "values")
        before = (self.root / path).read_bytes()
        codes = [put(u)[0] for u in ({"mail": "not-an-address"}, {"phone": "call me"},
                                     {"files": ["Pages/x.md"]}, {"double": 1}, {"teamHours": 2},
                                     {"code": "M12-99"})]
        self.run.report(codes == [422] * 6 and (self.root / path).read_bytes() == before,
                        "bad values and computed/ID keys: 422, nothing written", f"{codes}")

    # 8 ------------------------------------------------------------------------------------
    def preview(self) -> None:
        print("\n8. Formula preview")
        p = self.t(PROJECT)
        snap = snapshot(self.root)
        code, res = self.http("POST", "/formula/preview", {"typeId": p["id"], "expression": 'prop("Budget") + 1'})
        self.run.report(code == 200 and res == {"value": None, "error": None}, "parse only", f"{res}")
        code, res = self.http("POST", "/formula/preview", {"typeId": p["id"], "expression": "1 +"})
        self.run.report(code == 200 and res["value"] is None and res["error"], "parse error", f"{res}")
        code, res = self.http("POST", "/formula/preview", {"typeId": p["id"], "expression": 'prop("Budget") + 1',
                                                           "path": self.paths["Apollo"]})
        self.run.report(res == {"value": {"type": "number", "value": 101}, "error": None}, "evaluated", f"{res}")
        props = p["propertyDefinitions"]
        props.append(_def("tmp", "Tmp", "formula", {"expression": 'prop("Double") / 4'}))
        code, res = self.http("POST", "/formula/preview", {"typeId": p["id"], "expression": 'prop("Tmp")',
                                                           "path": self.paths["Apollo"], "properties": props})
        self.run.report(res == {"value": {"type": "number", "value": 50}, "error": None},
                        "with unsaved definitions", f"{res}")
        self.run.report(changed_paths(snap, snapshot(self.root)) == [], "the preview wrote nothing")

    # 9 ------------------------------------------------------------------------------------
    def refusals(self) -> None:
        print("\n9. A cycle and a rollup of a rollup are refused")
        snap = snapshot(self.root)
        p = self.t(PROJECT)
        self.prop(p, "double")["options"]["expression"] = 'prop("Summary") + 1'
        self.prop(p, "summary")["options"]["expression"] = 'prop("Double")'
        code, res = self.run.save_type(p)
        self.run.report(code == 422 and "Double" in res["detail"], "cycle: 422", f"{code} {res}")
        m = self.t(MEMBER)
        m["propertyDefinitions"].append(_def("memberRoll", "Member roll", "rollup",
                                             {"relationId": "", "targetId": "", "calc": "countAll"}))
        code, res = self.run.save_type(m)
        assert code == 200, (code, res)
        roll_id = self.prop(self.t(MEMBER), "memberRoll")["id"]
        snap = snapshot(self.root)
        p = self.t(PROJECT)
        self.prop(p, "teamHours")["options"]["targetId"] = roll_id
        code, res = self.run.save_type(p)
        self.run.report(code == 422 and "Team hours" in res["detail"], "rollup of a rollup: 422", f"{code} {res}")
        p = self.t(PROJECT)
        self.prop(p, "double")["options"]["expression"] = 'prop("Budget") *'
        code, res = self.run.save_type(p)
        self.run.report(code == 422 and "Double" in res["detail"], "a formula that doesn't parse: 422",
                        f"{code} {res}")
        self.run.report(changed_paths(snap, snapshot(self.root)) == [], "nothing written by the refusals")
        commit(self.root, "member rollup")

    # 10 -----------------------------------------------------------------------------------
    def rename(self) -> None:
        print("\n10. Renaming a property rewrites the formulas, not the objects")
        p = self.t(PROJECT)
        self.prop(p, "budget")["name"] = "Cost"
        code, res = self.run.save_type(p)
        expr = self.prop(res["type"], "double")["options"]["expression"] if code == 200 else None
        self.run.report(code == 200 and expr == 'prop("Cost") * 2' and res["rewritten"] == [],
                        "prop(\"Budget\") became prop(\"Cost\")", f"{code} {expr}")
        self.only_types_changed("the rename changes only the type file")
        o = self.run.obj(self.paths["Apollo"])
        self.run.report(o["computed"]["double"] == {"type": "number", "value": 200}, "still computes",
                        f"{o['computed']['double']}")

    # 11 -----------------------------------------------------------------------------------
    def timing(self) -> None:
        print("\n11. 5,000 objects with three formulas and two rollups")
        p = self.t(PROJECT)
        folder = self.root / p["folder"]
        refs = ", ".join(f"'[[{n}]]'" for n in ("M12 Ann", "M12 Bob"))
        for i in range(5000):
            (folder / f"Gen {i:05d}.md").write_text(
                f"---\ntype: '{PROJECT}'\ntitle: Gen {i:05d}\nbudget: {i}\nmembers: [{refs}]\n---\nText {i}\n",
                encoding="utf-8")
        p["propertyDefinitions"].append(_def("triple", "Triple", "formula", {"expression": 'prop("Cost") * 3'}))
        code, _ = self.run.save_type(p)
        assert code == 200
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            _, res = self.http("POST", "/rows", {"typeIds": [p["id"]], "preview": False})
            if len(res["rows"]) >= 5004:
                break
            time.sleep(0.5)

        def best(type_ids: list[str]) -> float:
            times = []
            for _ in range(3):
                t0 = time.perf_counter()
                self.http("POST", "/rows", {"typeIds": type_ids, "preview": False})
                times.append(time.perf_counter() - t0)
            return min(times)

        with_computed = best([p["id"]])
        p = self.t(PROJECT)
        p["propertyDefinitions"] = [d for d in p["propertyDefinitions"] if d["type"] not in ("formula", "rollup")]
        code, _ = self.run.save_type(p)
        without = best([p["id"]])
        self.run.report(code == 200, f"rows of {len(res['rows'])} objects: {with_computed * 1000:.0f} ms with "
                        f"3 formulas + 2 rollups, {without * 1000:.0f} ms without")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    ap.add_argument("--timing", action="store_true", help="also time 5,000 generated objects (check 11)")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m12-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    clock = tmp / "clock.txt"
    os.environ.update({
        "OBJECT_STATE_DIR": str(tmp / "state"),
        "OBJECT_CACHE_DIR": str(tmp / "cache"),
        "OBJECT_CLOCK_FILE": str(clock),
    })
    set_clock(clock, NOW)
    git(root, "init", "-q")
    commit(root, "base")
    original = snapshot(root)

    served: Served | None = None
    run: Run | None = None
    try:
        space, mig = check_migration(root, original)
        Registry(state_dir()).register(root)
        served = Served(root, space)
        run = Run(root, served.http)
        print(f"Space copy: {root}")
        print(f"\n1. Opening twice: {mig[0]}", *mig[1:], sep="\n   ")
        run.failures += mig[0] != "ok"
        m12 = M12(root, run)
        m12.seed()
        m12.add_computed()
        m12.computed_reads()
        m12.add_kinds()
        m12.ids()
        m12.values()
        m12.preview()
        m12.refusals()
        m12.rename()
        if args.timing:
            m12.timing()
    except AssertionError as exc:
        print(f"  [FAIL] setup step failed: {exc!r}")
        if run is not None:
            run.failures += 1
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
