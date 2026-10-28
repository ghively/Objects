"""Milestone 6 acceptance run over HTTP (plan Task 13, Step 2).

Usage: ``uv run python scripts/m6_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo, opens it twice and serves it with ``create_app(space, None, watch=True)``
on a free ``127.0.0.1`` port, with ``OBJECT_STATE_DIR`` and ``OBJECT_CACHE_DIR`` pointed at
temporary folders outside the copy. Snapshots skip ``.git`` and ``.object-cache/``.
Boards are created over the API where the space has none. Over HTTP it checks:

 1. ``GET /api/whiteboard`` and ``GET /api/whiteboard/ink`` for every whiteboard (and one
    without sidecars) change no file (``git status`` clean);
 2. ``POST /api/whiteboards`` creates exactly ``Whiteboards/<title>.md`` (plus
    ``.object/types/whiteboard.json`` the first time); no sidecar;
 3. the first ``PUT /api/whiteboard`` (base ``''``) creates only ``<title>.whiteboard.json``;
    the ``.md`` is byte-identical; a second ``PUT`` with the old revision is 409 and the file
    is unchanged;
 4. ``PUT /api/whiteboard/ink`` with pen strokes of varying pressure creates only
    ``<title>.ink.svg``: it parses as XML, has a ``viewBox`` and one ``<path>`` per stroke
    with the pressures in ``data-points``; ``GET`` returns the same strokes;
 5. on a board with every item kind (``Network map`` where it exists, and the board built in
    3): ``GET`` then ``PUT`` of the same board leaves the file byte-identical;
 6. an invalid board is 422 and nothing is written; a save over an unreadable board is 423
    and the file is untouched;
 7. renaming the board moves the ``.md`` and both sidecars, bytes identical;
 8. renaming an object the board links to rewrites only that link in the board JSON;
 9. deleting the board moves all three files out of the space; restoring puts them back
    byte-identical; with the title taken first, the three come back as ``… (2)`` together;
10. purging the trash entry removes its sidecar folder;
11. ``GET /api/images`` does not list the ink file;
12. the M1 no-edit pass: 0 files changed.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath
from typing import Any

import uvicorn

from m2_acceptance import (
    HOST, Http, Run, changed_paths, check_migration, commit, free_port, git, remove_tree, snapshot,
)
from objectapp.server import create_app
from objectapp.space import Space, version_of

BOARD_TITLE = "M6 acceptance board"
BROKEN_TITLE = "M6 acceptance broken"
SVG_NS = "{http://www.w3.org/2000/svg}"


# -- server --------------------------------------------------------------------


class Served:
    """One `Space` served on a free port with the app's lifespan (watcher, search index)."""

    def __init__(self, root: Path) -> None:
        self.space = Space(root)
        port = free_port()
        app = create_app(self.space, None, watch=True)
        self.server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        self.http = Http(f"http://{HOST}:{port}/api")
        for _ in range(200):
            try:
                if self.http("GET", "/space")[0] == 200:
                    break
            except OSError:
                time.sleep(0.05)

    def stop(self) -> None:
        self.server.config.app.state.hub.close()
        self.server.should_exit = True
        self.thread.join(timeout=10)


# -- helpers -------------------------------------------------------------------


def sidecars(md: str) -> tuple[str, str]:
    stem = md[: -len(".md")]
    return f"{stem}.whiteboard.json", f"{stem}.ink.svg"


def whiteboard_type_id(run: Run) -> str | None:
    t = run.type_named("Whiteboard")
    return t["id"] if t else None


def whiteboards(run: Run) -> list[str]:
    tid = whiteboard_type_id(run)
    if tid is None:
        return []
    _, objs = run.http("GET", "/objects", type=tid)
    return sorted(o["path"] for o in objs)


def link_target(run: Run) -> dict | None:
    """An ordinary object (not a whiteboard, not a template) the test board links to."""
    tid = whiteboard_type_id(run)
    locked = {t["id"] for t in run.types() if t["name"].lower() == "dailynote"}  # a date is its title
    _, objs = run.http("GET", "/objects")
    cands = [o for o in objs
             if o["type"] != tid and o["type"] not in locked and not o.get("template") and not o.get("readOnly")
             and o["title"].strip()]
    cands.sort(key=lambda o: o["path"])
    # A title that is unique in the space, so the link resolves to exactly this object.
    titles = [o["title"].casefold() for o in objs]
    for o in cands:
        if titles.count(o["title"].casefold()) == 1 and "[" not in o["title"] and "|" not in o["title"]:
            return o
    return None


def full_board(link_title: str | None) -> dict:
    """A board with every item kind: text, an embedded object, all 12 shapes, the gates, a
    frame, points, and connectors in every connection, line and tip, with a label."""
    blocks: dict[str, Any] = {"b-text": {"type": "text", "markdown": "**M6** acceptance text", "align": "center"}}
    nodes: dict[str, Any] = {
        "n-text": {"id": "n-text", "kind": "block", "blockId": "b-text", "position": {"x": 0, "y": 0},
                   "width": 420, "height": 60, "z": 1},
        "n-frame": {"id": "n-frame", "kind": "frame", "position": {"x": -60, "y": -60}, "width": 1800,
                    "height": 900, "z": 0, "title": "Frame 1"},
        "n-p1": {"id": "n-p1", "kind": "point", "position": {"x": 0, "y": 600}, "width": 0, "height": 0},
        "n-p2": {"id": "n-p2", "kind": "point", "position": {"x": 300, "y": 600}, "width": 0, "height": 0},
    }
    if link_title is not None:
        blocks["b-entity"] = {"type": "entity", "link": f"[[{link_title}]]"}
        nodes["n-entity"] = {"id": "n-entity", "kind": "block", "blockId": "b-entity",
                             "position": {"x": 480, "y": 0}, "width": 360, "height": 240, "z": 2}
    shapes = ["rectangle", "roundedRectangle", "ellipse", "diamond", "triangle", "triangleDown", "star",
              "parallelogram", "bubble", "blockArrow", "blockArrowLeft", "heart"]
    for i, shape in enumerate(shapes):
        nid, bid = f"n-shape-{shape}", f"b-shape-{shape}"
        blocks[bid] = {"type": "text", "markdown": shape}
        nodes[nid] = {"id": nid, "kind": "shape", "shape": shape, "blockId": bid,
                      "position": {"x": 90 * (i % 6) * 1.5, "y": 300 + 120 * (i // 6)}, "width": 90,
                      "height": 90, "z": 3 + i, "fillColor": "bg-blue", "borderColor": "blue",
                      "rotation": 0, "flipX": i % 2 == 0}
    for i, gate in enumerate(["NOT", "AND", "NAND", "OR", "NOR", "XOR", "XNOR", "HIGH", "LOW"]):
        nid, bid = f"n-gate-{gate.lower()}", f"b-gate-{gate.lower()}"
        blocks[bid] = {"type": "text", "markdown": gate}
        nodes[nid] = {"id": nid, "kind": "shape", "shape": "rectangle", "blockId": bid,
                      "position": {"x": 1000 + 120 * (i % 3), "y": 120 * (i // 3)}, "width": 90, "height": 90,
                      "z": 20 + i}
    blocks["b-label"] = {"type": "text", "markdown": "uplink"}
    edges: dict[str, Any] = {}
    styles = [("straight", "solid", "none", "arrow"), ("cornered", "dashed", "dot", "double"),
              ("curved", "dotted", "arrowClosed", "none")]
    ends = [("n-text", "n-shape-rectangle"), ("n-shape-ellipse", "n-gate-and"), ("n-p1", "n-p2")]
    for i, ((conn, line, start, end), (src, dst)) in enumerate(zip(styles, ends, strict=True)):
        eid = f"e-{conn}"
        edges[eid] = {"id": eid, "source": src, "target": dst, "sourceHandle": "right", "targetHandle": "left",
                      "connection": conn, "line": line, "markerStart": start, "markerEnd": end, "color": "red"}
        if i == 0:
            edges[eid]["blockId"] = "b-label"
    return {"version": 1, "nodes": nodes, "edges": edges, "blocks": blocks, "readingOrder": ["n-text"],
            "viewport": {"x": 0, "y": 0, "zoom": 1}, "x-unknown": {"kept": True}}


PEN_STROKES = [
    {"id": "acc-pen-1", "tool": "pen", "color": "#3f80eb", "width": 4,
     "points": [[10, 10, 0.1], [20, 14, 0.35], [30, 20, 0.62], [40, 28, 0.9]],
     "d": "M 10 8 L 40 26 L 40 30 L 10 12 Z"},
    {"id": "acc-pen-2", "tool": "pen", "color": "#5c5959", "width": 8,
     "points": [[100, 50, 0.25], [140, 60, 0.75], [180, 50, 1]],
     "d": "M 100 46 L 180 46 L 180 54 L 100 54 Z"},
    {"id": "acc-hl-1", "tool": "highlighter", "color": "#daaa14", "width": 16,
     "points": [[0, 200, 0.5], [300, 200, 0.5]], "d": "M 0 192 L 300 192 L 300 208 L 0 208 Z"},
]


def diff_since(run: Run, before: dict[str, bytes]) -> list[str]:
    return changed_paths(before, snapshot(run.root))


def get_board(run: Run, md: str) -> dict:
    code, res = run.http("GET", "/whiteboard", path=md)
    assert code == 200, (md, code, res)
    return res


# -- checks --------------------------------------------------------------------


def check_reads(run: Run) -> None:
    print("\n1. Reading boards and ink writes nothing")
    boards = whiteboards(run)
    before = snapshot(run.root)
    bare = [b for b in boards if not any((run.root / s).exists() for s in sidecars(b))]
    codes: dict[int, int] = {}
    for _ in range(2):
        for md in boards:
            for route in ("/whiteboard", "/whiteboard/ink"):
                code, _res = run.http("GET", route, path=md)
                codes[code] = codes.get(code, 0) + 1
    time.sleep(0.4)
    diff = diff_since(run, before)
    status = git(run.root, "status", "--porcelain", "-uall").strip()
    run.report(
        not diff and not status and set(codes) <= {200},
        f"{len(boards)} whiteboards ({len(bare)} without sidecars) read twice, statuses {codes}; "
        f"{len(diff)} files changed",
        *diff, *([status] if status else []),
    )
    if not boards:
        print("         (no whiteboards in this space yet: boards are created over the API below)")


def check_create(run: Run) -> str:
    print("\n2. POST /api/whiteboards")
    had_type_file = (run.root / ".object/types/whiteboard.json").is_file()
    before = snapshot(run.root)
    code, res = run.http("POST", "/whiteboards", {"title": BOARD_TITLE})
    md = res.get("path", "") if isinstance(res, dict) else ""
    time.sleep(0.3)
    diff = diff_since(run, before)
    expected = {md} | (set() if had_type_file else {".object/types/whiteboard.json"})
    no_sidecar = not any((run.root / s).exists() for s in sidecars(md)) if md else False
    run.report(
        code == 201 and md == f"Whiteboards/{BOARD_TITLE}.md" and set(diff) == expected and no_sidecar,
        f"{code} {md}; files added: {diff}; typeIds {res.get('typeIds') if isinstance(res, dict) else res}",
    )
    commit(run.root, "board created")
    return md


def check_first_save(run: Run, md: str, board: dict) -> str:
    print("\n3. The first board save creates only its JSON")
    board_rel, _ink = sidecars(md)
    md_bytes = (run.root / md).read_bytes()
    before = snapshot(run.root)
    code, res = run.http("PUT", "/whiteboard", {"path": md, "board": board, "baseRevision": ""})
    revision = res.get("revision", "") if isinstance(res, dict) else ""
    diff = diff_since(run, before)
    run.report(
        code == 200 and diff == [board_rel] and (run.root / md).read_bytes() == md_bytes
        and revision == version_of((run.root / board_rel).read_bytes()),
        f"{code}; files changed: {diff}; .md byte-identical: {(run.root / md).read_bytes() == md_bytes}",
    )
    saved = (run.root / board_rel).read_bytes()
    changed = copy.deepcopy(board)
    changed["nodes"]["n-text"]["position"]["x"] = 30
    stale = []
    for base in ("", "0" * 64):
        code2, res2 = run.http("PUT", "/whiteboard", {"path": md, "board": changed, "baseRevision": base})
        stale.append((code2, (res2 or {}).get("currentRevision") == revision))
    run.report(
        all(c == 409 and cur for c, cur in stale) and (run.root / board_rel).read_bytes() == saved,
        f"stale saves: {stale}; file unchanged: {(run.root / board_rel).read_bytes() == saved}",
    )
    commit(run.root, "board saved")
    return revision


def check_ink(run: Run, md: str) -> None:
    print("\n4. Ink with pressure")
    _board, ink_rel = sidecars(md)
    md_bytes = (run.root / md).read_bytes()
    before = snapshot(run.root)
    code, res = run.http("PUT", "/whiteboard/ink", {"path": md, "strokes": PEN_STROKES, "baseRevision": ""})
    diff = diff_since(run, before)
    run.report(code == 200 and diff == [ink_rel] and (run.root / md).read_bytes() == md_bytes,
               f"{code}; files changed: {diff}")
    notes: list[str] = []
    ok = False
    try:
        root = ET.fromstring((run.root / ink_rel).read_bytes())
        paths = root.findall(f"{SVG_NS}path")
        pressures = [
            [float(p.split(",")[2]) for p in el.get("data-points", "").split()] for el in paths
        ]
        expected = [[pt[2] for pt in s["points"]] for s in PEN_STROKES]
        ok = (root.tag == f"{SVG_NS}svg" and bool(root.get("viewBox")) and len(paths) == len(PEN_STROKES)
              and pressures == expected and len(set(pressures[0])) > 1)
        notes.append(f"viewBox {root.get('viewBox')!r}, {len(paths)} paths, pressures {pressures}")
    except (ET.ParseError, ValueError, IndexError) as exc:
        notes.append(f"not parsed: {exc}")
    run.report(ok, "the SVG parses, has a viewBox and one <path> per stroke with its pressures", *notes)
    code, res = run.http("GET", "/whiteboard/ink", path=md)
    got = res.get("strokes") if isinstance(res, dict) else None
    keys = ("id", "tool", "color", "width", "points", "d")
    same = got is not None and [{k: s[k] for k in keys} for s in got] == [{k: s[k] for k in keys} for s in PEN_STROKES]
    run.report(code == 200 and same and not res.get("readOnlyReason"), "GET returns the same strokes")
    commit(run.root, "ink saved")


def check_round_trip(run: Run, boards: list[str]) -> None:
    print("\n5. GET then PUT of the same board is byte-identical")
    for md in boards:
        board_rel, _ink = sidecars(md)
        if not (run.root / board_rel).is_file():
            continue
        res = get_board(run, md)
        if res.get("readOnlyReason"):
            continue
        before = (run.root / board_rel).read_bytes()
        code, out = run.http("PUT", "/whiteboard", {"path": md, "board": res["board"], "baseRevision": res["revision"]})
        after = (run.root / board_rel).read_bytes()
        kinds = sorted({n.get("kind") for n in res["board"]["nodes"].values()})
        run.report(code == 200 and after == before and out.get("revision") == res["revision"],
                   f"{md}: {code}, kinds {kinds}, {len(res['board']['nodes'])} nodes, "
                   f"{len(res['board']['edges'])} edges; byte-identical: {after == before}")
    commit(run.root, "round trips")


def check_refusals(run: Run, md: str) -> None:
    print("\n6. Invalid and unreadable boards")
    board_rel, _ink = sidecars(md)
    res = get_board(run, md)
    before = snapshot(run.root)
    bad = copy.deepcopy(res["board"])
    bad["nodes"]["n-text"]["kind"] = "sticker"
    code, out = run.http("PUT", "/whiteboard", {"path": md, "board": bad, "baseRevision": res["revision"]})
    diff = diff_since(run, before)
    run.report(code == 422 and not diff, f"invalid board: {code} {out.get('detail') if isinstance(out, dict) else out}; "
               f"{len(diff)} files changed")
    # A second board whose file was replaced by something that isn't a board.
    code, made = run.http("POST", "/whiteboards", {"title": BROKEN_TITLE})
    broken = made["path"]
    broken_rel, _ = sidecars(broken)
    (run.root / broken_rel).write_bytes(b"{ this is not json\n")
    commit(run.root, "broken board")
    time.sleep(0.3)
    garbage = (run.root / broken_rel).read_bytes()
    got = get_board(run, broken)
    code, out = run.http("PUT", "/whiteboard", {"path": broken, "board": res["board"], "baseRevision": got["revision"]})
    run.report(code == 423 and (run.root / broken_rel).read_bytes() == garbage and bool(got.get("readOnlyReason")),
               f"save over an unreadable board: {code}; opens read-only: {bool(got.get('readOnlyReason'))}; "
               f"file untouched: {(run.root / broken_rel).read_bytes() == garbage}")


def check_rename_board(run: Run, md: str) -> str:
    print("\n7. Renaming the board moves its three files")
    files = [md, *sidecars(md)]
    data = {rel: (run.root / rel).read_bytes() for rel in files}
    new_title = f"{BOARD_TITLE} renamed"
    code, res = run.http("POST", "/object/rename", {"path": md, "title": new_title, "baseVersion": version_of(data[md])})
    new_md = res.get("path", "") if isinstance(res, dict) else ""
    new_files = [new_md, *sidecars(new_md)] if new_md else []
    moved = bool(new_md) and all(not (run.root / f).exists() for f in files) and all(
        (run.root / nf).is_file() for nf in new_files)
    same = moved and all((run.root / nf).read_bytes() == data[f] for f, nf in zip(files[1:], new_files[1:], strict=True))
    run.report(code == 200 and new_md == f"Whiteboards/{new_title}.md" and moved and same,
               f"{code} -> {new_md}; sidecars moved byte-identical: {same}")
    commit(run.root, "board renamed")
    return new_md


def check_relink(run: Run, md: str, target: dict | None) -> None:
    print("\n8. Renaming a linked object rewrites only that link in the board")
    if target is None:
        run.report(False, "no object to link to in this space")
        return
    board_rel, _ink = sidecars(md)
    before_json = json.loads((run.root / board_rel).read_text("utf-8"))
    md_bytes = (run.root / md).read_bytes()
    new_title = f"{target['title']} M6"
    obj = run.obj(target["path"])
    code, res = run.http("POST", "/object/rename", {"path": target["path"], "title": new_title, "baseVersion": obj["version"]})
    after_json = json.loads((run.root / board_rel).read_text("utf-8"))
    expected = copy.deepcopy(before_json)
    expected["blocks"]["b-entity"]["link"] = f"[[{new_title}]]"
    run.report(code == 200 and board_rel in (res.get("relinked") or []) and after_json == expected
               and (run.root / md).read_bytes() == md_bytes,
               f"{code}; {target['title']!r} -> {new_title!r}; board relinked: {board_rel in (res.get('relinked') or [])}; "
               f"only the link changed: {after_json == expected}")
    # Every file written is the renamed object itself or a file reported as relinked.
    allowed = {target["path"], res.get("path"), *(res.get("relinked") or [])}
    status = git(run.root, "status", "--porcelain", "-uall").splitlines()
    written = {p.strip('"') for ln in status for p in ln[3:].split(" -> ")}
    stray = sorted(written - allowed)
    run.report(not stray, f"only reported files written ({len(written)})", *stray)
    commit(run.root, "linked object renamed")


def _delete(run: Run, md: str) -> tuple[int, str]:
    code, res = run.http("DELETE", "/object", path=md, baseVersion=version_of((run.root / md).read_bytes()))
    return code, (res or {}).get("trashId", "") if isinstance(res, dict) else ""


def check_trash(run: Run, md: str) -> None:
    print("\n9. Delete and restore carry the sidecars")
    files = [md, *sidecars(md)]
    data = {rel: (run.root / rel).read_bytes() for rel in files}
    code, trash_id = _delete(run, md)
    gone = all(not (run.root / f).exists() for f in files)
    folder = run.root / ".object/trash/whiteboards" / trash_id
    run.report(code == 200 and gone and folder.is_dir(), f"delete: {code}; all three out of the space: {gone}")
    code, res = run.http("POST", f"/trash/{trash_id}/restore")
    back = all((run.root / f).is_file() and (run.root / f).read_bytes() == data[f] for f in files)
    run.report(code == 200 and back and not folder.exists(), f"restore: {code} {res.get('paths')}; byte-identical: {back}")
    commit(run.root, "restored")
    # With the title taken while it is in the trash, the three come back as "(2)" together.
    code, trash_id = _delete(run, md)
    title = PurePosixPath(md).stem
    code2, made = run.http("POST", "/whiteboards", {"title": title})
    code3, res = run.http("POST", f"/trash/{trash_id}/restore")
    second = f"Whiteboards/{title} (2).md"
    new_files = [second, *sidecars(second)]
    together = (code3 == 200 and res.get("paths") == [second]
                and all((run.root / nf).read_bytes() == data[f] for f, nf in zip(files, new_files, strict=True)))
    run.report(code == 200 and code2 == 201 and made.get("path") == md and together,
               f"title taken: restored as {res.get('paths')}; three files together: {together}")
    commit(run.root, "restored beside")


def check_purge(run: Run, md: str) -> None:
    print("\n10. Purging removes the sidecar folder")
    code, trash_id = _delete(run, md)
    folder = run.root / ".object/trash/whiteboards" / trash_id
    had = folder.is_dir()
    code2, _ = run.http("DELETE", f"/trash/{trash_id}")
    run.report(code == 200 and had and code2 == 200 and not folder.exists(),
               f"delete {code}, folder there {had}; purge {code2}; folder gone: {not folder.exists()}")
    commit(run.root, "purged")


def check_images(run: Run) -> None:
    print("\n11. Ink files are not images")
    _, images = run.http("GET", "/images")
    ink = [i["path"] for i in images if i["path"].endswith(".ink.svg")]
    boards = [s for b in whiteboards(run) for s in sidecars(b)[1:] if (run.root / s).is_file()]
    run.report(not ink and bool(boards), f"{len(images)} images listed, {len(boards)} ink files in the space, "
               f"{len(ink)} listed", *ink)


def check_no_edit(run: Run) -> None:
    print("\n12. M1 no-edit pass")
    before = snapshot(run.root)
    _, objs = run.http("GET", "/objects")
    statuses: dict[int, int] = {}
    for s in objs:
        o = run.obj(s["path"])
        code, _ = run.http("PUT", "/object/body", {"path": s["path"], "body": o["body"], "baseVersion": o["version"]})
        statuses[code] = statuses.get(code, 0) + 1
    diff = changed_paths(before, snapshot(run.root))
    run.report(not diff and set(statuses) <= {200, 423},
               f"{len(objs)} objects, statuses {statuses}, {len(diff)} files changed", *diff)


# -- main ----------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m6-acceptance-"))
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    os.environ["OBJECT_STATE_DIR"] = str(tmp / "state")
    os.environ["OBJECT_CACHE_DIR"] = str(tmp / "cache")
    git(root, "init", "-q")
    commit(root, "base")
    original = snapshot(root)

    served: Served | None = None
    run: Run | None = None
    try:
        _space, mig = check_migration(root, original)
        served = Served(root)
        run = Run(root, served.http)
        print(f"Space copy: {root}")
        print(f"\n0. Opening twice: {mig[0]}", *mig[1:], sep="\n   ")
        run.failures += mig[0] != "ok"

        check_reads(run)
        existing = [b for b in whiteboards(run) if PurePosixPath(b).stem == "Network map"]
        md = check_create(run)
        target = link_target(run)
        board = full_board(target["title"] if target else None)
        check_first_save(run, md, board)
        check_ink(run, md)
        check_round_trip(run, [*existing, md])
        check_refusals(run, md)
        md = check_rename_board(run, md)
        check_relink(run, md, target)
        check_images(run)  # while the board still has its ink (9 and 10 trash it)
        check_trash(run, md)
        check_purge(run, f"Whiteboards/{PurePosixPath(md).stem} (2).md")
        check_no_edit(run)
    finally:
        if served is not None:
            served.stop()
        if args.keep:
            print(f"\nKept: {root}")
        else:
            remove_tree(tmp)

    failures = run.failures if run else 1
    print("\nRESULT:", "PASS" if failures == 0 else f"FAIL ({failures})")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
