"""Audit probe 3: trash round trips, rename/relink, change type, duplicate, watcher.

Run: uv run python scripts/audit-2026-11-01/backend-core/probe3_trash_rename_watcher.py
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[3] / "backend"))

from objectapp.space import Space, version_of  # noqa: E402
from objectapp.typedefs import read_raw  # noqa: E402

FIXTURES = HERE.parents[3] / "backend/tests/fixtures"
SCRATCH = Path("/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/core/p3")


def fresh(fixture="space-sample") -> Path:
    d = SCRATCH / fixture
    if d.exists():
        shutil.rmtree(d)
    shutil.copytree(FIXTURES / fixture, d)
    return d


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  -- {detail}" if detail else ""))


def snap(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): version_of(p.read_bytes()) for p in root.rglob("*") if p.is_file() and ".capacities" not in p.parts}


# --- trash -------------------------------------------------------------------------

def t_object_roundtrip():
    root = fresh()
    sp = Space(root)
    before = snap(root)
    item = sp.delete_object("Tasks/Write docs.md")
    check("deleted file gone", not (root / "Tasks/Write docs.md").exists())
    res = sp.restore(item.id)
    check("restore to original path", res["paths"] == ["Tasks/Write docs.md"], str(res))
    check("restore bytes identical", snap(root) == before)
    check("trash entry removed", sp.list_trash() == [])


def t_template_roundtrip():
    root = fresh()
    sp = Space(root)
    t = sp.type_by_id("task")
    path, _ = sp.create_template("task", "Weekly")
    tid = sp.get(path).id
    sp.save_type  # noqa: B018
    t = sp.type_by_id("task")
    check("template registered", tid in (t.templates.get("ids") or []))
    item = sp.delete_object(path)
    t = sp.type_by_id("task")
    check("template unregistered on delete", tid not in (t.templates.get("ids") or []))
    sp.restore(item.id)
    t = sp.type_by_id("task")
    listed = [s.id for s in sp.list_templates("task")]
    check("restored template listed", tid in listed, str(listed))
    check("restored template re-registered in templates.ids", tid in (t.templates.get("ids") or []), str(t.templates))


def t_type_roundtrip():
    root = fresh()
    sp = Space(root)
    before = snap(root)
    t = sp.type_by_id("task")
    members = sp._type_members("task")
    item = sp.trash_type(t, [m for m in members if not sp.get(m).template])
    check("type gone", sp.type_by_id("task") is None)
    check("no task files left", not any(p.startswith("Tasks/") for p in snap(root)), str([p for p in snap(root) if p.startswith("Tasks/")]))
    res = sp.restore(item.id)
    check("type restore bytes identical", snap(root) == before, str(set(before) ^ set(snap(root))))
    check("type back", sp.type_by_id("task") is not None)
    check("trash empty after type restore", sp.list_trash() == [])


def t_collection_roundtrip():
    root = fresh("space-m8")
    sp = Space(root)
    cols = [c for c in sp.list_collections() if not c.readOnlyReason]
    if not cols:
        print("INFO no collections in space-m8"); return
    c = cols[0]
    before = snap(root)
    members = [s.path for s in sp.list() if any(n.strip().casefold() == c.name.casefold() for n in s.collections)]
    print(f"INFO collection {c.name!r} members={members}")
    res = sp.delete_collection(c.id, confirm=True)
    print(f"INFO deleted={res.deleted} removed_from={res.removed_from} skipped={res.skipped}")
    # edit one shared member meanwhile so the fast byte-restore path can't be used
    if res.removed_from:
        rel = res.removed_from[0]
        _, _, v = sp.read(rel)
        sp.save_body(rel, "edited while the collection was in the trash\n", v)
    out = sp.restore(res.trash_id)
    print(f"INFO restore -> {out}")
    after = snap(root)
    diff = {k for k in set(before) | set(after) if before.get(k) != after.get(k)}
    exp_diff = set(res.removed_from[:1])
    check("collection restore: only the edited member differs", diff == exp_diff, str(diff))
    for rel in res.removed_from:
        fm = read_raw(root, rel).fm
        check(f"{rel} is back in {c.name}", any(n.casefold() == c.name.casefold() for n in (fm.get("collections") or [])), str(fm.get("collections")))
    check("collection back", any(x.id == c.id for x in sp.list_collections()))


def t_whiteboard_roundtrip():
    root = fresh("space-whiteboard")
    sp = Space(root)
    before = snap(root)
    item = sp.delete_object("Whiteboards/Network map.md")
    left = [p for p in snap(root) if p.startswith("Whiteboards/Network map")]
    check("whiteboard and sidecars gone", not left, str(left))
    sp.restore(item.id)
    check("whiteboard restore bytes identical", snap(root) == before, str({k for k in set(before) | set(snap(root)) if before.get(k) != snap(root).get(k)}))
    # rename a whiteboard: sidecars follow
    _, _, v = sp.read("Whiteboards/Network map.md")
    res = sp.rename_object("Whiteboards/Network map.md", "Network Map", v)
    names = sorted(p for p in snap(root) if p.startswith("Whiteboards/Network"))
    check("case-only whiteboard rename moves all three files", names == ["Whiteboards/Network Map.ink.svg", "Whiteboards/Network Map.md", "Whiteboards/Network Map.whiteboard.json"], str(names))
    _, _, v = sp.read(res.path)
    res = sp.rename_object(res.path, "Core map", v)
    names = sorted(p for p in snap(root) if "map" in p.lower() and p.startswith("Whiteboards/"))
    check("whiteboard rename moves sidecars", names == ["Whiteboards/Core map.ink.svg", "Whiteboards/Core map.md", "Whiteboards/Core map.whiteboard.json"], str(names))
    # the ink/board revisions survive
    check("board bytes unchanged by rename", before["Whiteboards/Network map.whiteboard.json"] == snap(root)["Whiteboards/Core map.whiteboard.json"])
    # delete + restore after rename, with a collision at restore time
    item = sp.delete_object("Whiteboards/Core map.md")
    (root / "Whiteboards/Core map.md").write_text("---\ntype: 'Page'\ntitle: squatter\n---\n", encoding="utf-8")
    sp.rescan_file("Whiteboards/Core map.md")
    out = sp.restore(item.id)
    names = sorted(p for p in snap(root) if p.startswith("Whiteboards/Core map"))
    check("whiteboard restore with a squatter uses one free stem for all three", out["paths"] == ["Whiteboards/Core map (2).md"] and "Whiteboards/Core map (2).whiteboard.json" in names and "Whiteboards/Core map (2).ink.svg" in names, str(names))


def t_restore_orphan_meta():
    root = fresh()
    sp = Space(root)
    item = sp.delete_object("Pages/Alpha.md")
    (root / ".capacities/trash" / f"{item.id}.json").unlink()
    sp2 = Space(root)
    items = sp2.list_trash()
    check("orphan trash .md without meta is listed or recoverable", bool(items), f"items={items} orphan .md still at {(root / '.capacities/trash' / (item.id + '.md')).exists()}")


# --- rename / relink ---------------------------------------------------------------

def t_relink_forms():
    root = fresh()
    body = ("Links: [[Alpha]] [[Alpha|the alias]] [[Alpha#Section]] ![[Alpha]] [[alpha]] [[Pages/Alpha]] [[ALPHA|x]]\n"
            "Code: `[[Alpha]]`\n\n```\n[[Alpha]]\n```\n\n[[Alpha ]] [[ Alpha]]\n")
    (root / "Pages/Refs.md").write_text("---\ntype: 'Page'\ntitle: Refs\nrelated: ['[[Alpha]]', '[[Pages/Alpha]]']\nnote: see [[Alpha]] here\n---\n" + body, encoding="utf-8")
    sp = Space(root)
    _, _, v = sp.read("Pages/Alpha.md")
    res = sp.rename_object("Pages/Alpha.md", "Beta", v)
    out = (root / "Pages/Refs.md").read_text(encoding="utf-8")
    print("INFO refs after rename:\n" + out)
    check("plain/alias/heading/embed/case/path links relinked", all(s in out for s in ("[[Beta]] [[Beta|the alias]] [[Beta#Section]] ![[Beta]] [[Beta]] [[Beta]] [[Beta|x]]",)), "")
    check("code spans and fences untouched", "`[[Alpha]]`" in out and "```\n[[Alpha]]\n```" in out)
    check("frontmatter list items relinked", "related: ['[[Beta]]', '[[Beta]]']" in out)
    check("frontmatter text link relinked", "note: see [[Beta]] here" in out)
    check("links with inner spaces relinked ([[Alpha ]] / [[ Alpha]])", "[[Alpha ]]" not in out and "[[ Alpha]]" not in out, out.splitlines()[-1])
    # rename back restores original references
    _, _, v = sp.read(res.path)
    sp.rename_object(res.path, "Alpha", v)
    out2 = (root / "Pages/Refs.md").read_text(encoding="utf-8")
    check("rename back round-trips the referrer", out2.count("[[Alpha") == out.count("[[Beta"), f"{out2.count('[[Alpha')} vs {out.count('[[Beta')}")


def t_rename_to_existing_title():
    root = fresh()
    (root / "Pages/Gamma.md").write_text("---\ntype: 'Page'\ntitle: Gamma\ncreatedAt: 2026-01-01T00:00:00.000Z\n---\n", encoding="utf-8")
    (root / "Pages/Refs.md").write_text("---\ntype: 'Page'\ntitle: Refs\n---\nTo gamma: [[Gamma]]. To alpha: [[Alpha]].\n", encoding="utf-8")
    sp = Space(root)
    _, _, v = sp.read("Pages/Alpha.md")
    res = sp.rename_object("Pages/Alpha.md", "Gamma", v)
    out = (root / "Pages/Refs.md").read_text(encoding="utf-8")
    print(f"INFO renamed to {res.path}; refs: {out.splitlines()[-1]}")
    gamma_ok = sp.resolve("Gamma", "Pages/Refs.md") == "Pages/Gamma.md" or "[[Pages/Gamma]]" in out
    alpha_target = out.split("To alpha: ")[1].strip(". \n")
    check("old [[Gamma]] still reaches the old Gamma", sp.resolve(out.split("To gamma: ")[1].split("]]")[0][2:], "Pages/Refs.md") == "Pages/Gamma.md", out)
    check("[[Alpha]] now reaches the renamed object", sp.resolve(alpha_target[2:-2], "Pages/Refs.md") == res.path, alpha_target)


def t_rename_folder_chars():
    root = fresh()
    (root / "Pages/Refs.md").write_text("---\ntype: 'Page'\n---\n[[Alpha]]\n", encoding="utf-8")
    sp = Space(root)
    for title in ("A/B: C?", "Trailing dot.", "  spaced   out  ", "CON", "x" * 300, "é" * 150, "#hash [br]ackets|pipe"):
        _, _, v = sp.read(sp.resolve("Alpha", None) or "Pages/Alpha.md") if False else (None, None, None)
        cur = [s for s in sp.list() if s.path.startswith("Pages/") and s.path not in ("Pages/Refs.md", "Pages/Notes.md", "Pages/What if.md", "Pages/Untitled stem.md", "Pages/Broken.md", "Pages/Bad yaml.md")][0]
        _, _, v = sp.read(cur.path)
        try:
            res = sp.rename_object(cur.path, title, v)
        except Exception as exc:  # noqa: BLE001
            check(f"rename to {title[:20]!r} clean", isinstance(exc, ValueError), f"{type(exc).__name__}: {exc}")
            continue
        refs = (root / "Pages/Refs.md").read_text(encoding="utf-8").strip().splitlines()[-1]
        target = refs[2:-2]
        ok = sp.resolve(target, "Pages/Refs.md") == res.path
        check(f"rename to {title[:20]!r}: file {res.path!r}, link {refs!r} resolves", ok and (root / res.path).is_file())


def t_change_type_move():
    root = fresh()
    (root / "Pages/Refs.md").write_text("---\ntype: 'Page'\n---\n[[Pages/Alpha]] and [[Alpha]]\n", encoding="utf-8")
    (root / "Tasks/Alpha.md").write_text("---\ntype: 'Task'\ntitle: Alpha task\n---\n", encoding="utf-8")
    sp = Space(root)
    _, _, v = sp.read("Pages/Alpha.md")
    res = sp.change_type("Pages/Alpha.md", "task", {}, v)
    refs = (root / "Pages/Refs.md").read_text(encoding="utf-8").strip().splitlines()[-1]
    fm = read_raw(root, res.path).fm
    check("change type moved to Tasks/ with a free name", res.path == "Tasks/Alpha (2).md", res.path)
    check("type line rewritten", fm.get("type") == "Task", str(fm))
    check("path-form link relinked, title link kept", refs == "[[Tasks/Alpha (2)]] and [[Alpha]]" or sp.resolve("Alpha", "Pages/Refs.md") == res.path, refs)


def t_duplicate_crlf_bom():
    root = fresh()
    p = root / "Pages/Alpha.md"
    p.write_bytes(b"\xef\xbb\xbf---\r\ntype: 'Page'\r\ntitle: Alpha\r\ncreatedAt: 2026-04-01T08:00:00.000Z\r\n---\r\n\r\n# Alpha\r\n\r\nBody.\r\n")
    sp = Space(root)
    path, version, synced = sp.duplicate_object("Pages/Alpha.md")
    data = (root / path).read_bytes()
    check("duplicate keeps BOM and CRLF", data.startswith(b"\xef\xbb\xbf---\r\n") and b"\n" not in data.replace(b"\r\n", b""), repr(data[:60]))
    raw = read_raw(root, path)
    check("duplicate title/heading", raw.fm.get("title") == "Alpha (Copy)" and "# Alpha (Copy)" in raw.of.body and raw.fm.get("id") != read_raw(root, "Pages/Alpha.md").fm.get("id"), str(raw.fm))


# --- watcher -----------------------------------------------------------------------

def t_watcher():
    from objectapp.watcher import SpaceWatcher

    root = fresh()
    sp = Space(root)
    loop = asyncio.new_event_loop()
    w = SpaceWatcher(sp, loop)
    w.start()
    time.sleep(0.5)

    def drain(wait=0.6):
        async def go():
            await asyncio.sleep(wait)
            out = []
            while not w.events.empty():
                out.append(w.events.get_nowait())
            return out
        return loop.run_until_complete(go())

    try:
        drain(0.3)
        # app save -> no event
        _, _, v = sp.read("Pages/Alpha.md")
        sp.save_body("Pages/Alpha.md", "app wrote this\n", v)
        ev = drain()
        check("watcher: app save is quiet", ev == [], str(ev))
        # external edit -> changed
        (root / "Pages/Alpha.md").write_bytes((root / "Pages/Alpha.md").read_bytes() + b"external\n")
        ev = drain()
        check("watcher: external edit reported", [e.kind for e in ev] == ["changed"], str(ev))
        # app delete to trash -> quiet
        item = sp.delete_object("Pages/Alpha.md")
        ev = drain()
        check("watcher: app delete is quiet", ev == [], str(ev))
        # restore -> quiet (server announces)
        sp.restore(item.id)
        ev = drain()
        check("watcher: restore is quiet", ev == [], str(ev))
        # app rename -> quiet
        _, _, v = sp.read("Pages/Alpha.md")
        res = sp.rename_object("Pages/Alpha.md", "Alpha Two", v)
        ev = drain()
        check("watcher: app rename is quiet", ev == [], str(ev))
        # external rename -> deleted + created
        os.rename(root / res.path, root / "Pages/Moved.md")
        ev = drain()
        check("watcher: external rename reported", sorted(e.kind for e in ev) == ["created", "deleted"], str(ev))
        # external folder move with a template inside: index must drop it
        tmpl_before = [s.path for s in sp.list_templates("task")]
        os.rename(root / "Templates", root / "Templates-moved")
        ev = drain(1.0)
        tmpl_after = [s.path for s in sp.list_templates("task")]
        stale = [p for p in tmpl_after if not (root / p).exists()]
        check("watcher: templates in an externally moved folder leave the index", not stale, f"before={tmpl_before} after={tmpl_after} events={[(e.kind, e.path) for e in ev]}")
        objs_stale = [s.path for s in sp.list() if not (root / s.path).exists()]
        check("watcher: objects in an externally moved folder leave the index", not objs_stale, str(objs_stale))
        # external edit that restores the bytes of an earlier own write (fixed in the last audit)
        _, _, v = sp.read("Pages/Moved.md")
        sp.save_body("Pages/Moved.md", "v1\n", v)
        drain()
        v1 = (root / "Pages/Moved.md").read_bytes()
        _, _, v = sp.read("Pages/Moved.md")
        sp.save_body("Pages/Moved.md", "v2\n", v)
        drain()
        (root / "Pages/Moved.md").write_bytes(v1)
        ev = drain()
        check("watcher: external revert to an earlier own write is reported", [e.kind for e in ev] == ["changed"], str(ev))
    finally:
        w.stop()
        loop.close()


if __name__ == "__main__":
    for fn in [t_object_roundtrip, t_template_roundtrip, t_type_roundtrip, t_collection_roundtrip, t_whiteboard_roundtrip,
               t_restore_orphan_meta, t_relink_forms, t_rename_to_existing_title, t_rename_folder_chars, t_change_type_move,
               t_duplicate_crlf_bom, t_watcher]:
        print(f"--- {fn.__name__}")
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {fn.__name__} raised {type(exc).__name__}: {exc}")
            traceback.print_exc(limit=4)
