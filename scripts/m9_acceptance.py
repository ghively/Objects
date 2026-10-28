"""Milestone 9 acceptance run over HTTP (plan Task 22, Step 2).

Usage: ``uv run python scripts/m9_acceptance.py SPACE [--keep] [--skip-roundtrip]``

Copies SPACE to a temporary folder (SPACE itself is never touched). What the checks need and
the space lacks is written into the copy *before* it is committed (the seeds are listed in the
output): two small PNGs under ``Attachments/``, a page that references one of them, a page
with an embedded query carrying a ``localDataViewInfo`` annotation, and (when the space has no
daily note) space-m8's daily note and ``dailynote.json``. Over HTTP it then creates an
"M9 Meeting" type with a ``datetime`` property (Page is basic and can't take one), a template
and an object of it, and a whiteboard. The copy
is committed to a throw-away git repo, opened twice and served with ``create_app`` on a free
``127.0.0.1`` port. ``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR``, ``OBJECT_CLOCK_FILE``
(2026-10-28T12:00:00Z, stepped by the whiteboard check), ``OBJECT_FAKE_NOTIFY_FILE``,
``OBJECT_FAKE_OPEN_FILE`` and ``OBJECT_FAKE_TRASH_FILE`` point at temporary paths outside the
copy. Over HTTP it checks:

 1. starting twice and every read (``/api/object/export`` with and without media,
    ``/api/search``, ``/api/ui``) change no file (``git status`` clean) and create nothing in
    the state dir but M7's ``spaces.json`` (and M4's reminder ledger);
 2. duplicate: exactly one new file, and ``git diff --no-index`` against the source differs
    only in ``id``, ``title``, ``createdAt``/``lastUpdated`` and the ``# Title`` line; a daily
    note, a template and a whiteboard give 422 (and a read-only file, when the space has one);
 3. export: ``media=0`` gives the ``.md`` bytes exactly (``text/markdown``, attachment); the
    ``media=1`` zip holds ``<stem>.md`` plus the referenced image, byte for byte;
 4. layout keys: ``wideLayoutMode``, ``wideCoverImage`` and ``coverImageOffset`` change only
    their own lines (plus ``lastUpdated``); a new ``coverImage`` drops the offset; null removes
    a key; wrong shapes give 422 and change nothing;
 5. template variable: ``{creation:week}`` on a ``datetime`` property is accepted on the
    template and refused on an object of the type; an object created from the template gets the week range;
 6. whiteboard: a board save changes only the ``.md``'s ``lastUpdated`` line (and the
    sidecar); a second save inside 60 s leaves the ``.md`` alone; the Notes body save on the
    returned ``mdVersion`` succeeds;
 7. ``PUT /api/ui`` ``workspaceOrder`` round-trips (only ``.object/ui.json`` changes);
    duplicates are 422;
 8. reindex: ``POST /api/search/reindex`` gives 202 and search reports complete afterwards;
 9. the editor round trip (``OBJECT_ROUNDTRIP_SPACE=<copy> npx vitest run
    src/editor/roundtrip.space.test.ts`` in ``frontend/``) passes, the copy holding a body
    with a ``localDataViewInfo`` embed;
10. the M1 no-edit pass over HTTP: 0 files changed.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any

from m2_acceptance import (
    Http,
    Run,
    _def,
    changed_paths,
    check_migration,
    commit,
    git,
    remove_tree,
    snapshot,
)
from m7_acceptance import PNG, raw
from m8_acceptance import Served, diff_keys, extra_state, fm_of, set_clock, state_files
from objectapp.appstate import state_dir
from objectapp.spaces import Registry

REPO = Path(__file__).resolve().parents[1]
FRONTEND = REPO / "frontend"
SPACE_M8 = REPO / "backend" / "tests" / "fixtures" / "space-m8"

NOW = "2026-10-28T12:00:00Z"
LATER = "2026-10-28T12:05:00Z"  # past the 60 s bump throttle for a board made at NOW
LATER_30S = "2026-10-28T12:05:30Z"  # inside it
WEEK = "2026-10-26 -> 2026-11-01"  # {creation:week} around NOW (Monday to Sunday)

IMG = "Attachments/m9 pixel.png"
IMG2 = "Attachments/m9 pixel two.png"
EXPORT_PAGE = "Pages/M9 export.md"
EMBED_PAGE = "Pages/M9 embed.md"
DATE_KEY = "m9When"

INFO = {
    "viewDefinition": {"dataViewLayout": "wall"},
    "filterGroup": {"type": "filterGroup", "operator": "and",
                    "elements": [{"type": "filter", "propertyId": "title", "option": "contains",
                                  "referenceValue": 'say "hi" --> a\\b'}]},
    "sorts": [{"propertyId": "title", "option": "descending"}],
    "groupBy": None,
}


def annotation_value(value: str) -> str:
    """`annotations.ts` `formatValue` for a quoted option."""
    v = value.replace("\r\n", " ").replace("\r", " ").replace("\n", " ")
    v = "".join("\\" + c if c in '\\"' else c for c in v).replace("-->", "--\\>")
    return f'"{v}"'


def seed_files() -> dict[str, bytes]:
    info = json.dumps(INFO, separators=(",", ":"), ensure_ascii=False)
    return {
        IMG: PNG,
        IMG2: PNG + b"\x00",
        EXPORT_PAGE: (
            b"---\nid: 01JC9M9ACCEPTANCE000000001\ntype: 'Page'\ntitle: M9 export\n"
            b"createdAt: 2026-10-01T08:00:00.000Z\nlastUpdated: 2026-10-01T08:00:00.000Z\n---\n"
            b"# M9 export\n\nA page with an image.\n\n![pixel](Attachments/m9%20pixel.png)\n\n"
            b"Closing paragraph.\n"
        ),
        EMBED_PAGE: (
            "---\nid: 01JC9M9ACCEPTANCE000000002\ntype: 'Page'\ntitle: M9 embed\n"
            "createdAt: 2026-10-01T08:00:00.000Z\nlastUpdated: 2026-10-01T08:00:00.000Z\n---\n"
            "Intro\n\n"
            f"<!-- block: localDataViewInfo={annotation_value(info)} -->\n![[query:m9q1]]\n\n"
            f"<!-- block: details localDataViewInfo={annotation_value(json.dumps({**INFO, 'groupBy': None, 'sorts': []}, separators=(',', ':')))} -->\n"
            "![[collection:m9c1]]\n\nOutro\n"
        ).encode(),
    }


def seed(root: Path) -> list[str]:
    added = []
    for rel, data in seed_files().items():
        dest = root / rel
        if dest.exists():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        added.append(rel)
    if not any((root / "DailyNotes").glob("*.md")):
        rel = "DailyNotes/2026-10-27.md"
        (root / "DailyNotes").mkdir(exist_ok=True)
        shutil.copyfile(SPACE_M8 / rel, root / rel)
        added.append(rel)
        types = root / ".object" / "types"
        if types.is_dir() and not (types / "dailynote.json").exists():
            shutil.copyfile(SPACE_M8 / ".object" / "types" / "dailynote.json", types / "dailynote.json")
            added.append(".object/types/dailynote.json")
    return added


def git_diff_lines(root: Path, a: str, b: str) -> list[str]:
    """The changed lines (``-``/``+``, no headers) of ``git diff --no-index -U0 a b``."""
    proc = subprocess.run(["git", "-c", "core.autocrlf=false", "diff", "--no-index", "-U0", "--no-color", a, b],
                          cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
    out = []
    for ln in proc.stdout.splitlines():
        if ln.startswith(("---", "+++", "@@", "diff ", "index ")):
            continue
        if ln[:1] in "+-":
            out.append(ln)
    return out


class M9:
    def __init__(self, root: Path, run: Run, clock: Path) -> None:
        self.root = root
        self.run = run
        self.clock = clock
        self.page_type: dict | None = None
        self.template: str | None = None
        self.template_id: str | None = None
        self.board: str | None = None
        self.plain: str = ""

    @property
    def http(self) -> Http:
        return self.run.http

    def version(self, rel: str) -> str:
        return self.run.obj(rel)["version"]

    def clean(self) -> bool:
        return not git(self.root, "status", "--porcelain", "-uall").strip()

    # 0 -----------------------------------------------------------------------------------
    def prepare(self) -> None:
        """An "M9 Meeting" type with a datetime property, a template and an object of it, and a whiteboard.

        (Page is a basic type, whose properties can't be edited.)
        """
        notes = []
        t = self.run.type_named("M9 Meeting")
        if t is None:
            code, res = self.http("POST", "/types", {"name": "M9 Meeting", "pluralName": "M9 Meetings"})
            assert code == 201, (code, res)
            t = self.run.type_named("M9 Meeting")
            notes.append(f"type 'M9 Meeting' ({t['id']})")
        if not any(d["key"] == DATE_KEY for d in t["propertyDefinitions"]):
            t["propertyDefinitions"].append(_def(DATE_KEY, "M9 when", "datetime"))
            code, res = self.run.save_type(t, confirm=True)
            assert code == 200, (code, res)
            notes.append(f"added datetime property {DATE_KEY!r}")
        self.page_type = self.run.type_named("M9 Meeting")
        code, res = self.http("POST", "/objects", {"typeId": self.page_type["id"], "title": "M9 plain meeting",
                                                   "templateId": "none"})
        assert code in (200, 201), (code, res)
        self.plain = res["path"]
        notes.append(f"object {self.plain}")
        code, res = self.http("POST", f"/types/{self.page_type['id']}/templates", {"name": "M9 template"})
        assert code == 201, (code, res)
        self.template = res["path"]
        _, listed = self.http("GET", f"/types/{self.page_type['id']}/templates")
        self.template_id = next(s["id"] for s in listed if s["path"] == self.template)
        notes.append(f"template {self.template} (id {self.template_id})")
        code, res = self.http("POST", "/whiteboards", {"title": "M9 board"})
        assert code in (200, 201), (code, res)
        self.board = res["path"]
        notes.append(f"whiteboard {self.board}")
        commit(self.root, "m9 prepared")
        print("   Prepared:", *notes, sep="\n     ")

    # 1 -----------------------------------------------------------------------------------
    def reads(self, label: str, base: str) -> None:
        before = snapshot(self.root)
        state_before = state_files()
        codes: dict[str, set[int]] = {}

        def call(name: str, code: int) -> None:
            codes.setdefault(name, set()).add(code)

        for _ in range(2):
            call("/object/export media=0", raw(base, "GET", "/object/export", path=EXPORT_PAGE, media="0")[0])
            call("/object/export media=1", raw(base, "GET", "/object/export", path=EXPORT_PAGE, media="1")[0])
            call("/search", self.http("GET", "/search", q="pixel")[0])
            call("/search fullText", self.http("GET", "/search", q="paragraph", mode="fullText")[0])
            call("/ui", self.http("GET", "/ui")[0])
            call("/object", self.http("GET", "/object", path=EMBED_PAGE)[0])
        time.sleep(0.4)
        diff = changed_paths(before, snapshot(self.root))
        status = git(self.root, "status", "--porcelain", "-uall").strip()
        names = state_files()
        extra = extra_state(names, {"spaces.json"})
        bad = {k: sorted(v) for k, v in codes.items() if v != {200}}
        self.run.report(not diff and not status and not extra and not bad,
                        f"{label}: {len(codes)} reads twice; statuses {bad or 'all 200'}; {len(diff)} files changed; "
                        f"state dir {state_before} -> {names}", *diff, *([status] if status else []), *extra)

    # 2 -----------------------------------------------------------------------------------
    def duplicate(self) -> None:
        print("\n2. Duplicate")
        allowed = ("id:", "title:", "createdAt:", "lastUpdated:", "# ")
        sources = [EXPORT_PAGE]
        _, objs = self.http("GET", "/objects")
        other = next((o["path"] for o in objs if o["path"] not in sources and not o.get("readOnly")
                      and not o.get("template") and not o["path"].startswith(("DailyNotes/", "Whiteboards/"))
                      and o["path"].startswith(("Pages/", "Tasks/", "People/", "Tags/"))), None)
        if other:
            sources.append(other)
        for src in sources:
            src_bytes = (self.root / src).read_bytes()
            snap = snapshot(self.root)
            code, res = self.http("POST", "/object/duplicate", {"path": src, "clientId": "m9"})
            changed = changed_paths(snap, snapshot(self.root))
            new = res.get("path") if isinstance(res, dict) else None
            title = fm_of(self.root, src).get("title")
            lines = git_diff_lines(self.root, src, new) if new else []
            stray = [ln for ln in lines if not ln[1:].lstrip("﻿").startswith(allowed)]
            new_title = fm_of(self.root, new).get("title") if new else None
            self.run.report(
                code == 201 and changed == [new] and (self.root / src).read_bytes() == src_bytes
                and new_title == f"{title or 'Untitled'} (Copy)" and not stray
                and isinstance(res, dict) and res.get("summary", {}).get("title") == new_title and res.get("version"),
                f"{src}: {code} -> {new} titled {new_title!r}; files changed {changed}; "
                f"diff lines {len(lines)}, outside id/title/stamps/heading {len(stray)}", *stray)
            commit(self.root, f"duplicated {src}")
        refused = []
        daily = next((o["path"] for o in objs if o["path"].startswith("DailyNotes/")), None)
        refused.append(("daily note", daily))
        refused.append(("template", self.template))
        refused.append(("whiteboard", self.board))
        ro = next((o["path"] for o in objs if o.get("readOnly")), None)
        if ro:
            refused.append(("read-only", ro))
        snap = snapshot(self.root)
        got = []
        for what, path in refused:
            code, res = self.http("POST", "/object/duplicate", {"path": path, "clientId": "m9"})
            got.append((what, path, code, res.get("detail") if isinstance(res, dict) else res))
        code404, _ = self.http("POST", "/object/duplicate", {"path": "Pages/No such page.md"})
        changed = changed_paths(snap, snapshot(self.root))
        self.run.report(all(c == 422 for *_x, c, _d in got) and all(p for _w, p, *_y in got) and code404 == 404
                        and not changed,
                        f"refused: {[(w, p, c) for w, p, c, _d in got]}; unknown path {code404}; "
                        f"detail {got[0][3]!r}; nothing changed {not changed}")

    # 3 -----------------------------------------------------------------------------------
    def export(self, base: str) -> None:
        print("\n3. Export")
        snap = snapshot(self.root)
        on_disk = (self.root / EXPORT_PAGE).read_bytes()
        code, h, body = raw(base, "GET", "/object/export", path=EXPORT_PAGE, media="0")
        self.run.report(code == 200 and body == on_disk and h.get("content-type") == "text/markdown; charset=utf-8"
                        and "attachment" in h.get("content-disposition", "")
                        and "M9 export.md" in h.get("content-disposition", ""),
                        f"media=0: {code} {h.get('content-type')}; {h.get('content-disposition')}; "
                        f"bytes identical {body == on_disk}")
        code, h, body = raw(base, "GET", "/object/export", path=EXPORT_PAGE, media="1")
        names: list[str] = []
        ok_bytes = False
        if code == 200:
            with zipfile.ZipFile(io.BytesIO(body)) as zf:
                names = zf.namelist()
                ok_bytes = (zf.read("M9 export.md") == on_disk if "M9 export.md" in names else False) and \
                    (zf.read(IMG) == PNG if IMG in names else False)
        self.run.report(code == 200 and h.get("content-type") == "application/zip" and sorted(names) == sorted(
            ["M9 export.md", IMG]) and ok_bytes and "M9 export.zip" in h.get("content-disposition", ""),
            f"media=1: {code} {h.get('content-type')}; {h.get('content-disposition')}; zip {names}; "
            f"bytes identical {ok_bytes}")
        c404 = raw(base, "GET", "/object/export", path="Pages/No such page.md", media="0")[0]
        c400 = raw(base, "GET", "/object/export", path="../outside.md", media="0")[0]
        self.run.report(c404 == 404 and c400 == 400 and not changed_paths(snap, snapshot(self.root)),
                        f"unknown {c404}, outside {c400}; export wrote nothing")

    # 4 -----------------------------------------------------------------------------------
    def put_props(self, rel: str, updates: dict, remove: list | None = None) -> tuple[int, Any]:
        return self.http("PUT", "/object/properties", {"path": rel, "updates": updates, "remove": remove or [],
                                                      "baseVersion": self.version(rel), "clientId": "m9"})

    def layout(self) -> None:
        print("\n4. Layout keys and cover position")
        rel = EXPORT_PAGE
        layout_keys = {"wideLayoutMode", "wideCoverImage", "coverImageOffset", "lastUpdated"}
        before = (self.root / rel).read_bytes()
        snap = snapshot(self.root)
        code, _res = self.put_props(rel, {"wideLayoutMode": True, "wideCoverImage": False, "coverImageOffset": 37.5})
        after = (self.root / rel).read_bytes()
        removed, added = diff_keys(before, after)
        fm = fm_of(self.root, rel)
        self.run.report(code == 200 and fm.get("wideLayoutMode") is True and fm.get("wideCoverImage") is False
                        and fm.get("coverImageOffset") == 37.5 and removed <= {"lastUpdated"} and added <= layout_keys
                        and changed_paths(snap, snapshot(self.root)) == [rel],
                        f"set three keys: {code}; keys -{sorted(removed)} +{sorted(added)}")
        commit(self.root, "layout keys")

        before = (self.root / rel).read_bytes()
        bad = []
        for updates in ({"wideLayoutMode": "yes"}, {"wideCoverImage": 1}, {"coverImageOffset": 101},
                        {"coverImageOffset": -1}, {"coverImageOffset": "50"}, {"coverImageOffset": True}):
            c, _ = self.put_props(rel, updates)
            if c != 422:
                bad.append(f"{updates}: {c}")
        self.run.report(not bad and (self.root / rel).read_bytes() == before, "six wrong shapes: 422, file unchanged",
                        *bad)

        c1, _ = self.put_props(rel, {"coverImage": IMG, "coverImageOffset": 30})
        fm1 = fm_of(self.root, rel)
        commit(self.root, "cover set")
        before = (self.root / rel).read_bytes()
        c2, _ = self.put_props(rel, {"coverImage": IMG})
        same_kept = fm_of(self.root, rel).get("coverImageOffset") == 30
        c3, _ = self.put_props(rel, {"coverImage": IMG2})
        fm3 = fm_of(self.root, rel)
        removed, added = diff_keys(before, (self.root / rel).read_bytes())
        self.run.report(c1 == c2 == c3 == 200 and fm1.get("coverImageOffset") == 30 and same_kept
                        and "coverImageOffset" not in fm3 and fm3.get("coverImage") == IMG2
                        and removed <= {"coverImage", "coverImageOffset", "lastUpdated"}
                        and added <= {"coverImage", "lastUpdated"},
                        f"cover {c1}/{c2}/{c3}: offset kept for the same image {same_kept}, dropped for a new one "
                        f"{'coverImageOffset' not in fm3}; keys -{sorted(removed)} +{sorted(added)}")
        commit(self.root, "cover changed")

        before = (self.root / rel).read_bytes()
        code, _res = self.put_props(rel, {"wideLayoutMode": None})
        removed, added = diff_keys(before, (self.root / rel).read_bytes())
        self.run.report(code == 200 and "wideLayoutMode" not in fm_of(self.root, rel)
                        and removed <= {"wideLayoutMode", "lastUpdated"} and added <= {"lastUpdated"},
                        f"null removes wideLayoutMode: {code}; keys -{sorted(removed)} +{sorted(added)}")
        commit(self.root, "layout key removed")

    # 5 -----------------------------------------------------------------------------------
    def template_variable(self) -> None:
        print("\n5. Template date variable")
        rel = self.template
        before = (self.root / rel).read_bytes()
        code, res = self.put_props(rel, {DATE_KEY: "{creation:week}"})
        text = (self.root / rel).read_text("utf-8")
        removed, added = diff_keys(before, (self.root / rel).read_bytes())
        self.run.report(code == 200 and f"\n{DATE_KEY}: '{{creation:week}}'\n" in text
                        and removed <= {"lastUpdated"} and added <= {DATE_KEY, "lastUpdated"},
                        f"on the template: {code}; keys -{sorted(removed)} +{sorted(added)}")
        commit(self.root, "template variable")
        page_before = (self.root / self.plain).read_bytes()
        c_page, _ = self.put_props(self.plain, {DATE_KEY: "{creation:week}"})
        c_bad, _ = self.put_props(rel, {DATE_KEY: "{creation:decade}"})
        self.run.report(c_page == 422 and c_bad == 422 and (self.root / self.plain).read_bytes() == page_before,
                        f"on an object of the type (not a template): {c_page}; unknown variable on the template: {c_bad}")
        code, res = self.http("POST", "/objects", {"typeId": self.page_type["id"], "title": "M9 from template",
                                                   "templateId": self.template_id})
        path = res.get("path") if isinstance(res, dict) else None
        made = (self.root / path).read_text("utf-8") if path else ""
        self.run.report(code in (200, 201) and f"\n{DATE_KEY}: {WEEK}\n" in made,
                        f"created from the template: {code} {path}; {DATE_KEY} line "
                        f"{next((ln for ln in made.splitlines() if ln.startswith(DATE_KEY)), None)!r} (want {WEEK!r})")
        commit(self.root, "from template")

    # 6 -----------------------------------------------------------------------------------
    def whiteboard(self) -> None:
        print("\n6. Whiteboard edits bump lastUpdated")
        rel = self.board
        sidecar = str(Path(rel).with_suffix("")) + ".whiteboard.json"
        set_clock(self.clock, LATER)
        _, cur = self.http("GET", "/whiteboard", path=rel)
        board = cur["board"]
        board.setdefault("nodes", {})
        board.setdefault("blocks", {})
        board["blocks"]["m9b"] = {"type": "text", "markdown": "M9 one"}
        board["nodes"]["m9n"] = {"id": "m9n", "kind": "block", "blockId": "m9b", "position": {"x": 10, "y": 20}}
        md_before = (self.root / rel).read_bytes()
        snap = snapshot(self.root)
        code, saved = self.http("PUT", "/whiteboard", {"path": rel, "board": board, "baseRevision": cur["revision"],
                                                      "clientId": "m9"})
        changed = changed_paths(snap, snapshot(self.root))
        md_after = (self.root / rel).read_bytes()
        removed, added = diff_keys(md_before, md_after)
        stamp = fm_of(self.root, rel).get("lastUpdated")
        self.run.report(code == 200 and sorted(changed) == sorted([rel, sidecar]) and removed == {"lastUpdated"}
                        and added == {"lastUpdated"} and str(stamp).startswith("2026-10-28T12:05:00")
                        and isinstance(saved, dict) and saved.get("mdVersion") == self.version(rel),
                        f"first save {code}: files {changed}; .md keys -{sorted(removed)} +{sorted(added)}; "
                        f"lastUpdated {stamp}; mdVersion matches {isinstance(saved, dict) and saved.get('mdVersion') == self.version(rel)}")
        commit(self.root, "board saved")
        set_clock(self.clock, LATER_30S)
        board["blocks"]["m9b"]["markdown"] = "M9 two"
        md_before = (self.root / rel).read_bytes()
        code, saved2 = self.http("PUT", "/whiteboard", {"path": rel, "board": board, "baseRevision": saved["revision"],
                                                       "clientId": "m9"})
        same = (self.root / rel).read_bytes() == md_before
        self.run.report(code == 200 and same and saved2.get("mdVersion") == self.version(rel),
                        f"second save 30 s later {code}: .md unchanged {same}; mdVersion is its current version")
        commit(self.root, "board saved again")
        o = self.run.obj(rel)
        code, _res = self.http("PUT", "/object/body", {"path": rel, "body": o["body"].rstrip("\n") + "\n\nM9 board notes.\n",
                                                     "baseVersion": saved2["mdVersion"], "clientId": "m9"})
        self.run.report(code == 200, f"Notes body save on mdVersion: {code}")
        commit(self.root, "board notes")
        set_clock(self.clock, NOW)

    # 7 -----------------------------------------------------------------------------------
    def ui_order(self) -> None:
        print("\n7. workspaceOrder")
        _, cur = self.http("GET", "/ui")
        order = ["pinned", "objects", "m9-section"]
        snap = snapshot(self.root)
        code, _res = self.http("PUT", "/ui", {"patch": {"workspaceOrder": order}, "baseRevision": cur["revision"]})
        _, got = self.http("GET", "/ui")
        changed = changed_paths(snap, snapshot(self.root))
        code2, _ = self.http("PUT", "/ui", {"patch": {"workspaceOrder": ["objects", "objects"]},
                                           "baseRevision": got["revision"]})
        self.run.report(code == 200 and got["ui"].get("workspaceOrder") == order and changed == [".object/ui.json"]
                        and code2 == 422,
                        f"PUT {code}; read back {got['ui'].get('workspaceOrder')}; files {changed}; duplicates {code2}")
        commit(self.root, "workspace order")

    # 8 -----------------------------------------------------------------------------------
    def reindex(self) -> None:
        print("\n8. Recalculate content index")
        snap = snapshot(self.root)
        code, res = self.http("POST", "/search/reindex", {"clientId": "m9"})
        partial = True
        results: Any = None
        for _ in range(300):
            _, out = self.http("GET", "/search", q="pixel")
            partial = bool(out.get("partial")) if isinstance(out, dict) else True
            results = out
            if not partial:
                break
            time.sleep(0.1)
        hits = [r.get("path") for r in results.get("results", [])] if isinstance(results, dict) else []
        self.run.report(code == 202 and res == {"started": True} and not partial
                        and not changed_paths(snap, snapshot(self.root)),
                        f"reindex {code} {res}; complete {not partial}; 'pixel' finds {hits[:3]}; space unchanged")

    # 9 -----------------------------------------------------------------------------------
    def roundtrip(self) -> None:
        print("\n9. Editor round trip (roundtrip.space.test.ts)")
        has_embed = "localDataViewInfo=" in (self.root / EMBED_PAGE).read_text("utf-8")
        before = snapshot(self.root)
        npx = shutil.which("npx") or "npx"
        proc = subprocess.run(
            [npx, "vitest", "run", "src/editor/roundtrip.space.test.ts"],
            cwd=FRONTEND, env={**os.environ, "OBJECT_ROUNDTRIP_SPACE": str(self.root)},
            capture_output=True, text=True, encoding="utf-8", errors="replace", check=False,
        )
        out = proc.stdout + proc.stderr
        tail = [ln for ln in out.splitlines() if "Tests" in ln or "differ" in ln or "FAIL" in ln][-8:]
        summary = [ln for ln in out.splitlines() if ln.strip().startswith("Tests")]
        ran = bool(summary) and "passed" in summary[-1] and "failed" not in summary[-1] and "skipped" not in summary[-1]
        self.run.report(proc.returncode == 0 and ran and has_embed and not changed_paths(before, snapshot(self.root)),
                        f"vitest exit {proc.returncode}; localDataViewInfo embed in {EMBED_PAGE}: {has_embed}", *tail)

    # 10 ----------------------------------------------------------------------------------
    def no_edit(self) -> None:
        print("\n10. M1 no-edit pass")
        before = snapshot(self.root)
        _, objs = self.http("GET", "/objects")
        statuses: dict[int, int] = {}
        for s in objs:
            o = self.run.obj(s["path"])
            code, _ = self.http("PUT", "/object/body", {"path": s["path"], "body": o["body"], "baseVersion": o["version"]})
            statuses[code] = statuses.get(code, 0) + 1
        diff = changed_paths(before, snapshot(self.root))
        self.run.report(not diff and set(statuses) <= {200, 423},
                        f"{len(objs)} objects, statuses {statuses}, {len(diff)} files changed", *diff)


# -- main ----------------------------------------------------------------------------------

HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE", "OBJECT_FAKE_NOTIFY_FILE",
         "OBJECT_FAKE_OPEN_FILE", "OBJECT_FAKE_TRASH_FILE")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    ap.add_argument("--skip-roundtrip", action="store_true", help="skip check 9 (needs frontend/node_modules)")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m9-acceptance-")).resolve()
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
    seeded = seed(root)
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
        m9 = M9(root, run, clock)
        print(f"Space copy: {root}")
        print(f"Seeded: {len(seeded)} files", *[f"  {s}" for s in seeded], sep="\n   ")
        print(f"\n0. Opening twice: {mig[0]}", *mig[1:], sep="\n   ")
        run.failures += mig[0] != "ok"
        m9.prepare()

        print("\n1. Reading writes nothing")
        m9.reads("first start", served.base)
        served.stop()
        served = Served(root)
        run.http = served.http
        m9.reads("second start", served.base)
        _, cur = run.http("GET", "/settings")
        code, _ = run.http("PUT", "/settings", {"patch": {"timeZone": "UTC"}, "baseRevision": cur["revision"]})
        run.report(code == 200 and m9.clean(), f"time zone set to UTC through PUT /api/settings: {code}; space unchanged")

        m9.duplicate()
        m9.export(served.base)
        m9.layout()
        m9.template_variable()
        m9.whiteboard()
        m9.ui_order()
        m9.reindex()
        if args.skip_roundtrip:
            print("\n9. Editor round trip: skipped (--skip-roundtrip)")
        else:
            m9.roundtrip()
        m9.no_edit()
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
