"""Audit probe 2: crashes from malformed files, and performance of the storage core.

Run: uv run python scripts/audit-2026-11-01/backend-core/probe2_crash_perf.py [perf]
"""
from __future__ import annotations

import shutil
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[3] / "backend"))
sys.path.insert(0, str(HERE.parents[3] / "backend/tests"))

from objectapp.frontmatter import FrontmatterError, parse_fm, rename_key, set_keys, _rt_yaml, _plain_yaml  # noqa: E402
from objectapp.space import Space, version_of  # noqa: E402
from objectapp.typedefs import read_raw  # noqa: E402

FIX = HERE.parents[3] / "backend/tests/fixtures/space-sample"
SCRATCH = Path("/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/core/p2")


def fresh(name="s") -> Path:
    d = SCRATCH / name
    if d.exists():
        shutil.rmtree(d)
    shutil.copytree(FIX, d)
    return d


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  -- {detail}" if detail else ""))


def t_deep_nesting_open():
    root = fresh()
    for depth in (100, 500, 1000, 3000):
        (root / "Pages" / f"deep{depth}.md").write_bytes(b"---\na: " + b"[" * depth + b"]" * depth + b"\n---\n")
        try:
            t0 = time.perf_counter()
            Space(root)
            print(f"INFO depth {depth}: space opened in {time.perf_counter()-t0:.2f}s")
        except RecursionError:
            check(f"deep nesting {depth}: Space(root) opens", False, "RecursionError escapes Space.__init__ (space can't be opened)")
        except Exception as exc:  # noqa: BLE001
            check(f"deep nesting {depth}: Space(root) opens", False, f"{type(exc).__name__}: {exc}")
        (root / "Pages" / f"deep{depth}.md").unlink()
    # and via rescan_file (the watcher's path) / read()
    sp = Space(root)
    (root / "Pages" / "deep.md").write_bytes(b"---\na: " + b"[" * 3000 + b"]" * 3000 + b"\n---\n")
    for name, fn in (("rescan_file", lambda: sp.rescan_file("Pages/deep.md")), ("read", lambda: sp.read("Pages/deep.md"))):
        try:
            fn()
            check(f"deep nesting via {name}: no crash", True)
        except RecursionError:
            check(f"deep nesting via {name}: no crash", False, "RecursionError")


def t_anchor_bomb():
    root = fresh()
    bomb = "---\n" + "a: &a [x, x, x, x, x, x, x, x, x, x]\n"
    prev = "a"
    for ch in "bcdefg":
        bomb += f"{ch}: &{ch} [" + ", ".join(f"*{prev}" for _ in range(10)) + "]\n"
        prev = ch
    bomb += "---\n"
    (root / "Pages" / "bomb.md").write_text(bomb, encoding="utf-8")
    t0 = time.perf_counter()
    try:
        sp = Space(root)
        dt = time.perf_counter() - t0
        check("anchor bomb (10^7 items) opens quickly", dt < 5, f"{dt:.1f}s")
        t0 = time.perf_counter()
        sp.list()
        sp.get("Pages/bomb.md")
        print(f"INFO list/get after bomb {time.perf_counter()-t0:.2f}s")
    except MemoryError:
        check("anchor bomb opens", False, "MemoryError")


def t_merge_key_file():
    root = fresh()
    (root / "Pages" / "merge.md").write_text("---\nbase: &b\n  x: 1\n<<: *b\ntitle: Merge\n---\nbody\n", encoding="utf-8")
    sp = Space(root)
    raw = read_raw(root, "Pages/merge.md")
    print(f"INFO merge-key file readOnly={raw.readOnly} fm={raw.fm}")
    _, _, v = sp.read("Pages/merge.md")
    try:
        sp.save_body("Pages/merge.md", "new\n", v)
        check("merge-key file: save works", True)
    except Exception as exc:  # noqa: BLE001
        check("merge-key file: save gives ReadOnly/FrontmatterError, not KeyError (-> 404)", type(exc).__name__ in ("ReadOnly", "FrontmatterError"), f"{type(exc).__name__}: {exc}")


def t_explicit_key_rename():
    src = "? status\n: Done\ntitle: T\n"
    out = rename_key(src, "status", "state")
    try:
        after = parse_fm(out)
        check("rename_key on an explicit '? key' form keeps YAML valid", after.get("state") == "Done", repr(out))
    except FrontmatterError as exc:
        check("rename_key on an explicit '? key' form keeps YAML valid", False, f"output {out!r} is unreadable: {str(exc)[:50]}")


def t_rename_key_quoted():
    for src, old in [("'a b': 1\nc: 2\n", "a b"), ('"a\\tb": 1\nc: 2\n', "a\tb"), ("'it''s': 1\nc: 2\n", "it's")]:
        out = rename_key(src, old, "z")
        after = parse_fm(out)
        check(f"rename_key quoted {src.splitlines()[0]!r}", after.get("z") == 1 and after.get("c") == 2 and len(after) == 2, repr(out))


def t_yaml_costs():
    n = 200
    t0 = time.perf_counter()
    for _ in range(n):
        _rt_yaml()
    rt = (time.perf_counter() - t0) / n * 1000
    t0 = time.perf_counter()
    for _ in range(n):
        _plain_yaml()
    pl = (time.perf_counter() - t0) / n * 1000
    src = "id: 01HXYZ\ntype: 'Task'\ntitle: Write docs\nicon: ph-pencil\ncreatedAt: 2026-03-01T09:00:00.000Z\nlastUpdated: 2026-03-02T10:00:00.000Z\ntags: [Docs, Other]\nstatus: Not Started\ndescription: null\nowner: '[[Ada Lovelace]]'\n"
    t0 = time.perf_counter()
    for _ in range(n):
        parse_fm(src)
    pf = (time.perf_counter() - t0) / n * 1000
    t0 = time.perf_counter()
    for _ in range(n):
        set_keys(src, {"lastUpdated": "2026-03-02T10:00:00.000Z", "status": "Done"})
    sk = (time.perf_counter() - t0) / n * 1000
    print(f"INFO YAML() rt construct {rt:.2f} ms, safe-pure construct {pl:.2f} ms, parse_fm(10 keys) {pf:.2f} ms, set_keys(2 keys) {sk:.2f} ms")


def t_bigspace():
    from bigspace import make_big_space
    root = SCRATCH / "big"
    if not root.exists():
        t0 = time.perf_counter()
        make_big_space(root)
        print(f"INFO bigspace written in {time.perf_counter()-t0:.1f}s")
    t0 = time.perf_counter()
    sp = Space(root)
    print(f"INFO Space(5000 objects) open: {time.perf_counter()-t0:.2f}s")
    t0 = time.perf_counter()
    for _ in range(20):
        sp.list()
    print(f"INFO list() x20: {(time.perf_counter()-t0)/20*1000:.1f} ms each")
    t0 = time.perf_counter()
    sp.backlinks("Pages/Object 00001.md")
    print(f"INFO first backlinks (index build): {time.perf_counter()-t0:.2f}s")
    t0 = time.perf_counter()
    sp.backlinks("Pages/Object 00002.md")
    print(f"INFO second backlinks (warm): {(time.perf_counter()-t0)*1000:.1f} ms")
    # a save that changes no names
    _, _, v = sp.read("Pages/Object 00001.md")
    t0 = time.perf_counter()
    sp.save_body("Pages/Object 00001.md", "edited body [[Object 00002]]\n", v)
    print(f"INFO save_body on big space: {(time.perf_counter()-t0)*1000:.1f} ms")
    t0 = time.perf_counter()
    sp.backlinks("Pages/Object 00002.md")
    print(f"INFO backlinks after a body save: {(time.perf_counter()-t0)*1000:.1f} ms")
    # a create changes names -> index re-resolves everything on next read
    t0 = time.perf_counter()
    sp.create_object("page", "Brand new page")
    print(f"INFO create_object on big space: {(time.perf_counter()-t0)*1000:.1f} ms")
    t0 = time.perf_counter()
    sp.backlinks("Pages/Object 00002.md")
    print(f"INFO backlinks after a create (names changed): {(time.perf_counter()-t0)*1000:.1f} ms")
    # a property update
    proj = sp.list("project")[0].path
    _, _, v = sp.read(proj)
    t0 = time.perf_counter()
    sp.update_properties(proj, {"summary": "x"}, v)
    print(f"INFO update_properties on big space: {(time.perf_counter()-t0)*1000:.1f} ms")
    # rename a popular object
    s = sp.list("page")[2]
    _, _, v = sp.read(s.path)
    refs = len(sp.backlinks(s.path))
    t0 = time.perf_counter()
    res = sp.rename_object(s.path, "Object 00005 renamed", v)
    print(f"INFO rename with {refs} backlinks: {(time.perf_counter()-t0)*1000:.0f} ms, relinked={len(res.relinked)} skipped={len(res.skipped)}")
    # rename a tag used by many
    tags = [x for x in sp.list("tag")]
    tagp = tags[0].path
    holders = len(sp.links.tagged(tagp))
    _, _, v = sp.read(tagp)
    t0 = time.perf_counter()
    res = sp.rename_object(tagp, tags[0].title + " renamed", v)
    print(f"INFO rename tag with {holders} holders: {(time.perf_counter()-t0)*1000:.0f} ms, relinked={len(res.relinked)}")
    # rows (all)
    t0 = time.perf_counter()
    rows = sp.rows()
    print(f"INFO rows() all: {time.perf_counter()-t0:.2f}s ({len(rows)} rows)")
    t0 = time.perf_counter()
    sp.types_with_revisions()
    print(f"INFO types_with_revisions: {(time.perf_counter()-t0)*1000:.1f} ms")
    # a template with an unknown type -> every rescan infers over all files?
    (root / "Templates").mkdir(exist_ok=True)
    (root / "Templates" / "Ghost.md").write_text("---\ntype: 'GhostType'\ntemplate: Ghost\n---\n", encoding="utf-8")
    sp.rescan_file("Templates/Ghost.md")
    t0 = time.perf_counter()
    for _ in range(5):
        sp.rescan_file("Templates/Ghost.md")
    print(f"INFO rescan of a template whose type is unknown: {(time.perf_counter()-t0)/5*1000:.0f} ms each")
    t0 = time.perf_counter()
    for _ in range(5):
        sp.rescan_file(sp.list("page")[5].path)
    print(f"INFO rescan of a normal file: {(time.perf_counter()-t0)/5*1000:.1f} ms each")
    # pending growth without reads
    n0 = len(sp.links._pending)
    for i, s_ in enumerate(sp.list("page")[10:60]):
        p = s_.path
        _, _, v = sp.read(p)
        sp.save_body(p, f"body {i}\n", v)
    print(f"INFO link-index pending after 50 saves and no reads: {len(sp.links._pending)-n0} entries")


if __name__ == "__main__":
    only_perf = len(sys.argv) > 1 and sys.argv[1] == "perf"
    tests = [t_bigspace] if only_perf else [t_deep_nesting_open, t_anchor_bomb, t_merge_key_file, t_explicit_key_rename, t_rename_key_quoted, t_yaml_costs]
    for fn in tests:
        print(f"--- {fn.__name__}")
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {fn.__name__} raised {type(exc).__name__}: {exc}")
            traceback.print_exc(limit=4)
