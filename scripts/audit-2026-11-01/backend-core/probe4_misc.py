"""Audit probe 4: ui.json race, watcher folder-move path, lock held during fsync, template default.

Run: uv run python scripts/audit-2026-11-01/backend-core/probe4_misc.py
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
import threading
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[3] / "backend"))

from objectapp import textfile, uistate  # noqa: E402
from objectapp.space import Space  # noqa: E402

FIXTURES = HERE.parents[3] / "backend/tests/fixtures"
SCRATCH = Path("/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/core/p4")


def fresh(fixture="space-sample") -> Path:
    d = SCRATCH / fixture
    if d.exists():
        shutil.rmtree(d)
    shutil.copytree(FIXTURES / fixture, d)
    return d


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  -- {detail}" if detail else ""))


def t_ui_patch_race():
    root = fresh()
    sp = Space(root)
    ui_path = root / ".object/ui.json"
    uistate.patch_ui(sp, {"pinned": ["a"]}, None)
    orig = uistate.atomic_write

    def racy(path, data, check=None):
        if Path(path).name == "ui.json":
            Path(path).write_text('{"pinned": ["external"], "sections": ["ext"]}', encoding="utf-8")
        return orig(path, data, check)

    uistate.atomic_write = racy
    try:
        uistate.patch_ui(sp, {"allNotesLayout": "grid"}, None)
    finally:
        uistate.atomic_write = orig
    after = ui_path.read_text(encoding="utf-8")
    check("ui.json patch re-checks the file before replacing it", "ext" in after, after.replace("\n", " "))


def t_touch_folder_templates():
    """Windows gives one event for a moved folder: `_touch_folder` must cover templates too."""
    from objectapp.watcher import SpaceWatcher

    root = fresh()
    sp = Space(root)
    loop = asyncio.new_event_loop()
    w = SpaceWatcher(sp, loop)  # not started: we call the folder handler directly
    before = [s.path for s in sp.list_templates("task")]
    os.rename(root / "Templates", root / "Templates-moved")
    w._touch_folder(str(root / "Templates"))
    time.sleep(0.5)
    after = [s.path for s in sp.list_templates("task")]
    stale = [p for p in after if not (root / p).exists()]
    check("_touch_folder rescans templates under a moved folder", not stale, f"before={before} after={after} (stale entries stay in the index)")
    loop.close()


def t_lock_blocks_reads_during_fsync():
    root = fresh()
    sp = Space(root)
    real_fsync = os.fsync

    def slow_fsync(fd):
        time.sleep(0.2)  # a slow disk / network share
        real_fsync(fd)

    os.fsync = slow_fsync
    try:
        _, _, v = sp.read("Pages/Alpha.md")
        waited = []

        def reader():
            time.sleep(0.05)
            t0 = time.perf_counter()
            sp.list()
            waited.append(time.perf_counter() - t0)

        th = threading.Thread(target=reader)
        th.start()
        sp.save_body("Pages/Alpha.md", "slow\n", v)
        th.join()
    finally:
        os.fsync = real_fsync
    check("a read (list) is not blocked by a save's fsync", waited[0] < 0.05, f"list() waited {waited[0]*1000:.0f} ms behind one save")


def t_default_template_lost():
    root = fresh()
    sp = Space(root)
    path, _ = sp.create_template("task", "Weekly")
    tid = sp.get(path).id
    t = sp.type_by_id("task")
    sp._save_templates_field(t, {**t.templates, "defaultTemplateId": tid})
    item = sp.delete_object(path)
    sp.restore(item.id)
    t = sp.type_by_id("task")
    check("a restored template is the default again", t.templates.get("defaultTemplateId") == tid, str(t.templates))


def t_yaml_instance_reuse():
    from ruamel.yaml import YAML
    from objectapp.frontmatter import _PlainConstructor
    src = "id: 01HXYZ\ntype: 'Task'\ntitle: Write docs\nicon: ph-pencil\ncreatedAt: 2026-03-01T09:00:00.000Z\nlastUpdated: 2026-03-02T10:00:00.000Z\ntags: [Docs, Other]\nstatus: Not Started\ndescription: null\nowner: '[[Ada Lovelace]]'\n"
    n = 300
    t0 = time.perf_counter()
    for _ in range(n):
        y = YAML(typ="safe", pure=True); y.Constructor = _PlainConstructor; y.load(src)
    fresh_t = (time.perf_counter() - t0) / n * 1000
    y = YAML(typ="safe", pure=True); y.Constructor = _PlainConstructor
    t0 = time.perf_counter()
    for _ in range(n):
        y.load(src)
    reuse_t = (time.perf_counter() - t0) / n * 1000
    print(f"INFO parse with a fresh YAML() each time: {fresh_t:.2f} ms; reusing one instance: {reuse_t:.2f} ms")


if __name__ == "__main__":
    for fn in [t_ui_patch_race, t_touch_folder_templates, t_lock_blocks_reads_during_fsync, t_default_template_lost, t_yaml_instance_reuse]:
        print(f"--- {fn.__name__}")
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {fn.__name__} raised {type(exc).__name__}: {exc}")
            traceback.print_exc(limit=4)
