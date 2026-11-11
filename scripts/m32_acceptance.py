"""Milestone 32 acceptance run over HTTP (notes first: what the back end can show).

Usage: ``uv run python scripts/m32_acceptance.py [--keep]``

Every space the run touches is a fresh one in a temporary folder (made through
``POST /api/spaces`` as the app's "Create space" dialog calls it, ``setup: 'blank'``) or a copy of
a synthetic fixture (``space-blocks``, which never had a Task or a DailyNote type; ``space-work``,
whose notes carry Ticket IDs; ``space-itops``, made by the IT operations starter before M32). The
fixtures themselves are never touched: their bytes are compared before and after.
``OBJECT_STATE_DIR`` and ``OBJECT_CACHE_DIR`` are temporary paths outside every space, so a
space's folder holds only what the app writes into the space, and "nothing was written" is a
byte comparison of the whole folder (dot folders included). `create_app` is served on a free
``127.0.0.1`` port per space (`m8_acceptance.Served`). No agent runs; no real data, no network.
The checks, by the plan's item numbers (``2026-11-11-m32-notes-first.md``; what only the screen
can show is Gene's hand checks in ``m32-acceptance.md``):

 1. a new space (item 8): ``POST /api/spaces`` ``{name, location, setup: 'blank'}`` makes the
    folder with ``space.json`` and the Page (shown as "Note"), Tag, Task and DailyNote types and
    nothing else; opened, it lists those four, the Task's statuses end in a done one, Work is off
    (``workEnabled`` null, ``workOn`` false), no saved search is listed, and opening, listing and
    reading write nothing; the first note, task and daily note each write only their own file;
 2. an older space without a Task type (item 8; a copy of ``space-blocks``): the built-in Task
    and DailyNote are listed (no file: ``revision`` empty), opening and listing write nothing
    (the whole folder, byte for byte), the first task writes ``task.json`` and its ``.md`` only,
    a second one its ``.md`` only; ticking it with the built-in Done status stamps
    ``completed`` (only ``status``, ``completed`` and ``lastUpdated`` lines change; a space that
    has no ``space.json`` is not given one by an edit);
 3. the Work switch's default (item 10): off on a plain space; on, with nothing stored and
    nothing written, for a space whose notes carry a Ticket ID (``space-work``), for the IT
    starter's space (``space-itops``, and a new space made with ``setup: 'itops'``, which stores
    ``workEnabled: true``), once a type named Capture exists, and from the moment a note gets a
    Ticket ID until it loses it; the default is never stored (``space.json`` gains no
    ``workEnabled``; the first edit of a space adds only its ``spaceId``, as before M32);
 4. the Work switch set by hand (item 10): ``PUT /api/space`` ``{patch: {workEnabled}}`` writes
    only ``.object/space.json``; with Work off the Task lists no ticket or work field without a
    value, keeps the one a task holds a value for (the value is read back), and no "Tickets"
    saved search is listed; with Work on every field and the Tickets search are back and no
    ``.md`` or type file changed; a stale revision is 409 and a value that is no switch is 422,
    both writing nothing;
 5. starter sets after the start (item 12): in a space that already started, ``POST
    /api/space/setup`` ``blank`` is 409; ``basic`` adds only the Person, Meeting, Project and
    Book types; ``itops`` then adds only the types the space lacks (with their templates and
    seed Tags) and turns Work on; nothing that existed is replaced, a repeat writes nothing,
    and a later ``basic`` keeps the ``itops`` marker;
 6. the type gallery (item 12): ``GET /api/type-gallery`` opens with the ``personal`` section
    (Idea, Goal, Habit, Recipe, Trip, Journal entry), ends with the IT operations entries, and
    only those are ``collapsed``; a personal entry makes its type; reading writes nothing;
 7. today's note asked for twice (item 13): ``POST /api/daily-notes`` is 201, then 200 with the
    same path and version and ``existing: true``, nothing written; a file of another kind
    holding the note's name is still 409;
 8. no built-in name (item 13): ``activityName`` is empty by default, the empty string saves,
    and an Activity line reads "You" while it is empty and the name once one is set;
 9. a note's title is in one place (item 13, the integrate step): a titled note, task or linked
    note made through the app's route has no ``# <title>`` line in its body, with or without a
    default template; "New note" then a title typed (a rename) leaves the body empty; a body
    sent with the create is kept as sent;
10. the fixture folders are unchanged.

Each check prints ``[ok]`` or ``[FAIL]``; ends with ``RESULT: PASS`` or exits non-zero.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))
sys.path.insert(0, str(REPO / "scripts"))

from m2_acceptance import Run, remove_tree  # noqa: E402
from m8_acceptance import Served, body_of, diff_keys, fm_of  # noqa: E402

FIXTURES = REPO / "backend" / "tests" / "fixtures"
FIXTURE_NAMES = ("space-blocks", "space-work", "space-itops")
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE")
STARTING_TYPES = ["dailynote", "page", "tag", "task"]
STATUSES = ["Not Started", "Next Up", "In Progress", "On Hold", "Done"]
BASIC_TYPES = ["book", "meeting", "person", "project"]
PERSONAL = ["Idea", "Goal", "Habit", "Recipe", "Trip", "Journal entry"]
TICKETS_ID = "work-tickets"
DAY = "2026-11-11"
SPACE_JSON = ".object/space.json"
READS: tuple[tuple[str, str, Any, dict[str, str]], ...] = (
    ("GET", "/space", None, {}),
    ("GET", "/spaces", None, {}),
    ("GET", "/objects", None, {}),
    ("GET", "/objects", None, {"type": "task"}),
    ("POST", "/rows", {}, {}),
    ("POST", "/rows", {"typeIds": ["task"]}, {}),
    ("GET", "/queries", None, {}),
    ("GET", "/type-gallery", None, {}),
    ("GET", "/calendar", None, {"from": "2026-11-01", "to": "2026-11-30"}),
    ("GET", "/search", None, {"q": "note"}),
    ("GET", "/settings", None, {}),
    ("GET", "/ui", None, {}),
)
"""What Home, Notes, the Tasks page, the calendar and the type gallery read when they open."""


# -- plumbing ------------------------------------------------------------------------------


def tree(root: Path) -> dict[str, str]:
    """Every file under ``root`` (dot folders included) and its hash."""
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*")) if p.is_file()}


def differ(a: dict[str, str], b: dict[str, str]) -> list[str]:
    return sorted(k for k in a.keys() | b.keys() if a.get(k) != b.get(k))


def copy_space(name: str, dest: Path) -> Path:
    shutil.copytree(FIXTURES / name, dest, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    return dest


def config(root: Path) -> dict:
    path = root / SPACE_JSON
    return json.loads(path.read_text("utf-8")) if path.is_file() else {}


def read_all(served: Served) -> list[str]:
    """Run `READS`; the ones that did not answer 200."""
    bad = []
    for method, route, payload, query in READS:
        code, _res = served.http(method, route, payload, **query)
        if code != 200:
            bad.append(f"{method} {route} {code}")
    return bad


def info(served: Served) -> dict:
    code, res = served.http("GET", "/space")
    assert code == 200, (code, res)
    return res


def task_type(served: Served) -> dict:
    return next(t for t in info(served)["types"] if t["id"] == "task")


def work_keys(served: Served) -> set[str]:
    """The ticket and work fields the Task type lists."""
    from objectapp.workfields import FIELD_KEYS

    return {p["key"] for p in task_type(served)["propertyDefinitions"]} & FIELD_KEYS


def queries(served: Served) -> list[str]:
    code, res = served.http("GET", "/queries")
    assert code == 200, (code, res)
    return [q["id"] for q in res]


def switch(served: Served, on: bool) -> tuple[int, Any]:
    return served.http("PUT", "/space", {"patch": {"workEnabled": on}, "baseRevision": info(served)["revision"]})


def create(served: Served, type_id: str, **req: Any) -> dict:
    code, res = served.http("POST", "/objects", {"typeId": type_id, **req})
    assert code == 201, (code, res)
    return res


def set_props(served: Served, path: str, updates: dict, remove: list[str] | None = None) -> tuple[int, Any]:
    code, obj = served.http("GET", "/object", path=path)
    assert code == 200, (code, obj)
    return served.http("PUT", "/object/properties", {"path": path, "updates": updates, "remove": remove or [],
                                                     "baseVersion": obj["version"]})


class Spaces:
    """Makes new spaces the way the app's "Create space" dialog does: ``POST /api/spaces`` on
    the space that is open (here a scratch copy of ``space-blocks``), ``setup: 'blank'``."""

    def __init__(self, tmp: Path) -> None:
        self.location = tmp / "spaces"
        self.location.mkdir()
        self.host = Served(copy_space("space-blocks", tmp / "host"))

    def make(self, name: str, setup: str = "blank") -> tuple[int, Path]:
        code, res = self.host.http("POST", "/spaces", {"name": name, "location": str(self.location), "setup": setup})
        return code, Path(res["path"]) if code == 201 else self.location / name

    def stop(self) -> None:
        self.host.stop()


# -- 1. a new space ------------------------------------------------------------------------


def check_new_space(run: Run, spaces: Spaces) -> None:
    print("\n1. A new space, made as \"Create space\" makes it")
    from objectapp.workfields import FIELD_KEYS

    code, root = spaces.make("My notes")
    files = sorted(tree(root)) if root.is_dir() else []
    run.report(code == 201 and files == [SPACE_JSON, *(f".object/types/{t}.json" for t in STARTING_TYPES)],
               "POST /api/spaces (setup: blank) makes space.json and the Page, Tag, Task and DailyNote types, nothing else",
               f"{code}; {files}")
    run.report(config(root) == {"name": "My notes", "setup": "blank"}, "space.json holds the name and the start; no Work switch",
               f"{config(root)}")
    listed = [e["path"] for e in spaces.host.http("GET", "/spaces")[1]["spaces"]]
    run.report(str(root) in listed, "the new space is in the list of spaces")

    before = tree(root)
    served = Served(root)
    try:
        res = info(served)
        by_id = {t["id"]: t for t in res["types"]}
        names = {i: t["name"] for i, t in by_id.items()}
        run.report(names == {"page": "Page", "tag": "Tag", "task": "Task", "dailynote": "DailyNote"}
                   and res["needsSetup"] is False,
                   "opened, it lists Page (shown as Note), Tag, Task and DailyNote, and asks nothing",
                   f"{names}; needsSetup {res['needsSetup']}")
        status = next(p for p in by_id["task"]["propertyDefinitions"] if p["key"] == "status")
        options = status["options"]["set"]
        run.report([o["text"] for o in options] == STATUSES and options[-1].get("statusCategory") == "done",
                   "the Task's statuses are Not Started, Next Up, In Progress, On Hold, Done (Done is the done one)",
                   f"{[(o['text'], o.get('statusCategory')) for o in options]}")
        keys = {p["key"] for p in by_id["task"]["propertyDefinitions"]}
        run.report(res["workEnabled"] is None and res["workOn"] is False and not keys & FIELD_KEYS,
                   "Work is off (workEnabled null, workOn false) and the Task has no ticket or work field",
                   f"workEnabled {res['workEnabled']!r}, workOn {res['workOn']!r}; {sorted(keys & FIELD_KEYS)}")
        run.report(queries(served) == [], "no saved search is listed (no \"Tickets\")", f"{queries(served)}")
        bad = read_all(served)
        changed = differ(before, tree(root))
        run.report(not bad and not changed, "opening, listing and reading wrote nothing", *bad, *changed)

        # The first note ("New note": no title), task (quick add) and daily note.
        note = create(served, "page")
        after_note = tree(root)
        run.report(differ(before, after_note) == [note["path"]] and note["typeIds"] == [],
                   "the first note writes only its own file", f"{differ(before, after_note)}")
        task = create(served, "task", title="Buy milk", body="")
        after_task = tree(root)
        run.report(differ(after_note, after_task) == [task["path"]] and task["path"] == "Tasks/Buy milk.md",
                   "the first task writes only its own file", f"{differ(after_note, after_task)}")
        code, daily = served.http("POST", "/daily-notes", {"date": DAY})
        after_daily = tree(root)
        run.report(code == 201 and differ(after_task, after_daily) == [f"DailyNotes/{DAY}.md"],
                   "the first daily note writes only its own file", f"{code}; {differ(after_task, after_daily)}")
    finally:
        served.stop()


# -- 2. an older space without a Task type --------------------------------------------------


def check_older_space(run: Run, tmp: Path) -> None:
    print("\n2. An older space without a Task type (a copy of space-blocks)")
    from objectapp.workfields import FIELD_KEYS

    root = copy_space("space-blocks", tmp / "older")
    types_dir = root / ".object" / "types"
    had = sorted(p.stem for p in types_dir.glob("*.json"))
    run.report("task" not in had and "dailynote" not in had, "the copy has no Task and no DailyNote type file", f"{had}")
    before = tree(root)
    served = Served(root)
    try:
        by_id = {t["id"]: t for t in info(served)["types"]}
        task, daily = by_id.get("task"), by_id.get("dailynote")
        run.report(task is not None and task["basic"] is True and task["revision"] == ""
                   and daily is not None and daily["revision"] == "",
                   "the built-in Task and DailyNote are listed, in memory only (no revision)",
                   f"{sorted(by_id)}")
        status = next(p for p in (task or {}).get("propertyDefinitions", []) if p["key"] == "status")
        run.report([o["text"] for o in status["options"]["set"]] == STATUSES, "with the built-in statuses")
        bad = read_all(served)
        changed = differ(before, tree(root))
        run.report(not bad and not changed, "opening, listing and reading wrote nothing (the whole folder, byte for byte)",
                   *bad, *changed)

        made = create(served, "task", title="Buy milk", body="")
        after = tree(root)
        run.report(differ(before, after) == [".object/types/task.json", "Tasks/Buy milk.md"] and made["typeIds"] == ["task"],
                   "the first task writes task.json and its .md only", f"{differ(before, after)}; typeIds {made['typeIds']}")
        stored = json.loads((types_dir / "task.json").read_text("utf-8"))
        run.report(not {p["key"] for p in stored["propertyDefinitions"]} & FIELD_KEYS and body_of(root, made["path"]) == "",
                   "task.json holds no ticket or work field, and the task's body is empty")
        second = create(served, "task", title="Water the plants", body="")
        after2 = tree(root)
        run.report(differ(after, after2) == [second["path"]], "a second task writes only its .md", f"{differ(after, after2)}")
        run.report(not (types_dir / "dailynote.json").exists(), "the DailyNote type is still not written")

        raw_before = (root / made["path"]).read_bytes()
        code, done = set_props(served, made["path"], {"status": ["Done"]})
        raw_after = (root / made["path"]).read_bytes()
        fm = fm_of(root, made["path"])
        removed, added = diff_keys(raw_before, raw_after)
        run.report(code == 200 and fm.get("status") == "Done" and bool(fm.get("completed"))
                   and (done.get("task") or {}).get("completed") is True,
                   "ticking it with the built-in Done status stamps it completed",
                   f"{code}; status {fm.get('status')!r}, completed {fm.get('completed')!r}")
        run.report(added == {"status", "completed", "lastUpdated"} and removed == {"lastUpdated"}
                   and differ(after2, tree(root)) == [made["path"]],
                   "only its status, completed and lastUpdated lines changed",
                   f"removed {sorted(removed)}, added {sorted(added)}; files {differ(after2, tree(root))}")
    finally:
        served.stop()


# -- 3. the Work switch: its default --------------------------------------------------------


def check_work_default(run: Run, spaces: Spaces, tmp: Path) -> None:
    print("\n3. The Work switch: its default")
    from objectapp.workfields import FIELD_KEYS

    # (a) a space whose notes carry Ticket IDs, and (b) one the IT starter made before M32
    for name, why in (("space-work", "notes with a Ticket ID"), ("space-itops", "the IT operations starter's marker")):
        root = copy_space(name, tmp / f"default-{name}")
        before = tree(root)
        served = Served(root)
        try:
            res = info(served)
            bad = read_all(served)
            changed = differ(before, tree(root))
            run.report(res["workEnabled"] is None and res["workOn"] is True and "workEnabled" not in config(root),
                       f"{name} ({why}): Work reads on with no switch stored",
                       f"workEnabled {res['workEnabled']!r}, workOn {res['workOn']!r}")
            if name == "space-work":
                run.report(work_keys(served) == FIELD_KEYS and queries(served) == [TICKETS_ID],
                           f"{name}: the Task has every ticket and work field and \"Tickets\" is listed",
                           f"{len(work_keys(served))}/{len(FIELD_KEYS)} fields; {queries(served)}")
            run.report(not bad and not changed, f"{name}: reading the default wrote nothing", *bad, *changed)
        finally:
            served.stop()

    # (c) a new space made with the IT starter
    code, root = spaces.make("IT desk", "itops")
    run.report(code == 201 and config(root).get("workEnabled") is True and config(root).get("setup") == "itops",
               "a new space made with the IT operations starter stores workEnabled: true", f"{code}; {config(root)}")

    # (d) a type named Capture, and (e) a Ticket ID on a note, in a plain space
    code, root = spaces.make("Plain")
    served = Served(root)
    try:
        run.report(info(served)["workOn"] is False and work_keys(served) == set(), "a plain new space: Work is off")
        note = create(served, "page", title="Printer")
        code, _res = set_props(served, note["path"], {"ticketId": "INC0012345"})
        res = info(served)
        run.report(code == 200 and res["workOn"] is True and res["workEnabled"] is None and work_keys(served) == FIELD_KEYS,
                   "a Ticket ID on a note turns the default on (the Task gains the fields in memory)",
                   f"{code}; workOn {res['workOn']!r}")
        code, _res = set_props(served, note["path"], {}, remove=["ticketId"])
        run.report(code == 200 and info(served)["workOn"] is False and work_keys(served) == set(),
                   "and off again when the last Ticket ID is gone", f"{code}; workOn {info(served)['workOn']!r}")
        code, _res = served.http("POST", "/types", {"name": "Capture", "pluralName": "Captures"})
        res = info(served)
        run.report(code == 201 and res["workOn"] is True and res["workEnabled"] is None,
                   "a type named Capture turns the default on", f"{code}; workOn {res['workOn']!r}")
        stored = {k: v for k, v in config(root).items() if k != "spaceId"}
        run.report(stored == {"name": "Plain", "setup": "blank"},
                   "the default was never stored: space.json holds no workEnabled (the first edit added only the space's id)",
                   f"{sorted(config(root))}")
    finally:
        served.stop()


# -- 4. the Work switch set by hand ----------------------------------------------------------


def check_work_switch(run: Run, spaces: Spaces) -> None:
    print("\n4. The Work switch, set in Settings")
    from objectapp.workfields import FIELD_KEYS

    code, root = spaces.make("Switch")
    assert code == 201, code
    served = Served(root)
    try:
        task = create(served, "task", title="Call Pat", body="")
        other = create(served, "task", title="Plain task", body="")
        # The first edit of a space stores its id in space.json (version history is keyed by
        # it); made here, so the comparisons below see only the switch.
        code, _res = set_props(served, other["path"], {"status": ["Next Up"]})
        assert code == 200 and config(root).get("spaceId"), code
        before = tree(root)

        code, res = switch(served, True)
        on = tree(root)
        run.report(code == 200 and res["workEnabled"] is True and res["workOn"] is True and differ(before, on) == [SPACE_JSON],
                   "PUT /api/space workEnabled: true writes only .object/space.json", f"{code}; {differ(before, on)}")
        run.report(work_keys(served) == FIELD_KEYS and queries(served) == [TICKETS_ID],
                   "with Work on the Task has every ticket and work field and \"Tickets\" is listed",
                   f"{len(work_keys(served))}/{len(FIELD_KEYS)}; {queries(served)}")
        code, _res = set_props(served, task["path"], {"requester": "Pat Example"})
        valued = tree(root)
        run.report(code == 200 and differ(on, valued) == [task["path"]] and fm_of(root, task["path"]).get("requester") == "Pat Example",
                   "a ticket field (Requester) is given a value on one task", f"{code}; {differ(on, valued)}")

        code, res = switch(served, False)
        off = tree(root)
        run.report(code == 200 and res["workEnabled"] is False and res["workOn"] is False and differ(valued, off) == [SPACE_JSON],
                   "PUT /api/space workEnabled: false writes only .object/space.json", f"{code}; {differ(valued, off)}")
        run.report(work_keys(served) == {"requester"},
                   "with Work off the Task lists no empty ticket field and keeps the one that has a value",
                   f"{sorted(work_keys(served))}")
        code, obj = served.http("GET", "/object", path=task["path"])
        run.report(code == 200 and obj["frontmatter"].get("requester") == "Pat Example"
                   and "requester" not in fm_of(root, other["path"]),
                   "the value is still on its task and read back; the other task was not given the field")
        run.report(queries(served) == [], "no \"Tickets\" saved search is listed with Work off", f"{queries(served)}")
        bad = read_all(served)
        run.report(not bad and tree(root) == off, "reading with Work off wrote nothing", *bad, *differ(off, tree(root)))

        # A stale revision and a value that is no switch.
        code, _res = served.http("PUT", "/space", {"patch": {"workEnabled": True}, "baseRevision": "stale"})
        code2, _res = served.http("PUT", "/space", {"patch": {"workEnabled": "yes"}, "baseRevision": info(served)["revision"]})
        run.report(code == 409 and code2 == 422 and tree(root) == off and info(served)["workOn"] is False,
                   "a stale revision is 409 and a value that is no switch is 422; nothing written", f"{code}, {code2}")

        code, res = switch(served, True)
        back = tree(root)
        run.report(code == 200 and work_keys(served) == FIELD_KEYS and queries(served) == [TICKETS_ID],
                   "with Work on again every field and \"Tickets\" are back", f"{code}; {len(work_keys(served))}; {queries(served)}")
        run.report(set(differ(off, back)) == {SPACE_JSON} and differ(valued, back) == [],
                   "turning Work off and on changed no .md and no type file (space.json is as it was while on)",
                   f"{differ(valued, back)}")
    finally:
        served.stop()


# -- 5. starter sets after the start ---------------------------------------------------------


def check_starter_sets(run: Run, spaces: Spaces) -> None:
    print("\n5. Starter sets after the start")
    code, root = spaces.make("Starters")
    assert code == 201, code
    served = Served(root)
    try:
        create(served, "page", title="A note of mine")
        start = tree(root)
        code, _res = served.http("POST", "/space/setup", {"setup": "blank"})
        run.report(code == 409 and tree(root) == start, "the plain start is not offered twice: blank is 409, nothing written", f"{code}")

        code, res = served.http("POST", "/space/setup", {"setup": "basic"})
        basic = tree(root)
        run.report(code == 200 and differ(start, basic) == [SPACE_JSON, *(f".object/types/{t}.json" for t in BASIC_TYPES)]
                   and config(root).get("setup") == "basic",
                   "\"basic\" adds only the Person, Meeting, Project and Book types (and its marker in space.json)",
                   f"{code}; {differ(start, basic)}")
        run.report(res["workOn"] is False and "workEnabled" not in config(root), "Work stays off after the basic set")
        code, _res = served.http("POST", "/space/setup", {"setup": "basic"})
        run.report(code == 200 and tree(root) == basic, "\"basic\" again writes nothing", f"{code}; {differ(basic, tree(root))}")

        code, res = served.http("POST", "/space/setup", {"setup": "itops"})
        itops = tree(root)
        new = differ(basic, itops)
        new_types = sorted(Path(p).stem for p in new if p.startswith(".object/types/"))
        elsewhere = [p for p in new if p != SPACE_JSON and not p.startswith((".object/types/", "Templates/", "Tags/"))]
        replaced = [p for p in new if p in basic and p != SPACE_JSON]
        run.report(code == 200 and "host" in new_types and "incident" in new_types and not replaced and not elsewhere
                   and not set(new_types) & {*STARTING_TYPES, *BASIC_TYPES},
                   "\"itops\" adds only the types the space lacks, with their templates and seed Tags; nothing is replaced",
                   f"{code}; {len(new_types)} new types; replaced {replaced}; elsewhere {elsewhere}")
        cfg = config(root)
        run.report(cfg.get("setup") == "itops" and cfg.get("workEnabled") is True and res["workOn"] is True,
                   "the IT operations set turns Work on for the space (workEnabled: true)", f"{cfg}")
        code, _res = served.http("POST", "/space/setup", {"setup": "itops"})
        run.report(code == 200 and tree(root) == itops, "\"itops\" again writes nothing", f"{code}; {differ(itops, tree(root))}")
        code, _res = served.http("POST", "/space/setup", {"setup": "basic"})
        run.report(code == 200 and tree(root) == itops and config(root).get("setup") == "itops",
                   "a later \"basic\" keeps the itops marker and writes nothing", f"{code}; {differ(itops, tree(root))}")
        code, _res = served.http("POST", "/space/setup", {"setup": "everything"})
        run.report(code == 422 and tree(root) == itops, "an unknown set is 422", f"{code}")
    finally:
        served.stop()


# -- 6. the type gallery ---------------------------------------------------------------------


def check_gallery(run: Run, spaces: Spaces) -> None:
    print("\n6. The type gallery")
    code, root = spaces.make("Gallery")
    assert code == 201, code
    served = Served(root)
    try:
        before = tree(root)
        code, entries = served.http("GET", "/type-gallery")
        sections = []
        for e in entries:
            if not sections or sections[-1] != e["section"]:
                sections.append(e["section"])
        personal = [e["name"] for e in entries if e["section"] == "personal"]
        run.report(code == 200 and sections[0] == "personal" and personal == PERSONAL,
                   "the gallery opens with a personal section: Idea, Goal, Habit, Recipe, Trip, Journal entry",
                   f"{code}; sections {sections}; {personal}")
        collapsed = {e["section"] for e in entries if e.get("collapsed")}
        open_ones = {e["section"] for e in entries if not e.get("collapsed")}
        run.report(sections[-1] == "itOperations" and len(sections) == len(set(sections)) and collapsed == {"itOperations"}
                   and "itOperations" not in open_ones,
                   "IT operations is the last section and the only one marked collapsed",
                   f"collapsed {sorted(collapsed)}")
        project = next(e for e in entries if e["key"] == "project")
        run.report("Ticket ID" not in [p["name"] for p in project["properties"]],
                   "with Work off the gallery's Project lists no ticket field")
        run.report(tree(root) == before, "reading the gallery wrote nothing", *differ(before, tree(root)))

        code, made = served.http("POST", "/types", {"template": "recipe"})
        after = tree(root)
        new = differ(before, after)
        run.report(code == 201 and made.get("name") == "Recipe" and f".object/types/{made.get('id')}.json" in new
                   and not [p for p in new if p in before],
                   "a personal entry (Recipe) makes its type; nothing that existed changed", f"{code}; {new}")
        names = [p["name"] for p in made.get("propertyDefinitions", [])]
        run.report({"Cover image", "Servings", "Prep time", "Source", "Notes"} <= set(names),
                   "with its own few properties (Cover image, Servings, Prep time, Source, Notes)", f"{names}")
    finally:
        served.stop()


# -- 7. today's note asked for twice ---------------------------------------------------------


def check_daily_note(run: Run, spaces: Spaces) -> None:
    print("\n7. Today's note asked for twice")
    code, root = spaces.make("Daily")
    assert code == 201, code
    served = Served(root)
    try:
        code, first = served.http("POST", "/daily-notes", {"date": DAY})
        after = tree(root)
        run.report(code == 201 and first["path"] == f"DailyNotes/{DAY}.md", "the first POST /api/daily-notes is 201",
                   f"{code} {first}")
        code, again = served.http("POST", "/daily-notes", {"date": DAY})
        run.report(code == 200 and again.get("existing") is True and again.get("path") == first["path"]
                   and again.get("version") == first["version"] and again.get("typeIds") == [],
                   "the second is 200 with the same note (path, version, existing: true)", f"{code} {again}")
        run.report(tree(root) == after, "and wrote nothing", *differ(after, tree(root)))

        # A file of another kind that holds a day's name is not that day's note.
        other = root / "DailyNotes" / "2026-11-12.md"
        other.write_text("---\ntype: 'Page'\ntitle: 2026-11-12\n---\nNot a daily note.\n", encoding="utf-8", newline="\n")
        served.space.rescan_file("DailyNotes/2026-11-12.md")
        held = tree(root)
        code, res = served.http("POST", "/daily-notes", {"date": "2026-11-12"})
        run.report(code == 409 and res.get("reason") == "nameTaken" and tree(root) == held,
                   "a file of another kind holding the note's name is still 409 (nameTaken); nothing written",
                   f"{code} {res}")
    finally:
        served.stop()


# -- 8. no built-in name ----------------------------------------------------------------------


def check_activity_name(run: Run, tmp: Path) -> None:
    print("\n8. No built-in name")
    root = copy_space("space-work", tmp / "names")
    served = Served(root)
    path = "Tasks/Order toner.md"

    def note(text: str) -> str:
        code, res = served.http("POST", "/work/note", {"path": path, "kind": "note", "text": text})
        return res.get("activity", "") if code == 200 else f"{code} {res}"

    def name(value: str) -> tuple[int, Any]:
        _c, cur = served.http("GET", "/settings")
        return served.http("PUT", "/settings", {"patch": {"activityName": value}, "baseRevision": cur.get("revision")})

    try:
        _c, cur = served.http("GET", "/settings")
        run.report(cur["settings"].get("activityName") == "", "activityName is empty by default",
                   f"{cur['settings'].get('activityName')!r}")
        line = note("Rang them")
        run.report(line.endswith("You added a note: Rang them"), "with no name an Activity line reads \"You\"", line)
        code, res = name("Pat")
        line = note("Ordered two")
        run.report(code == 200 and line.endswith("Pat added a note: Ordered two"), "a name that is set is the one shown", line)
        code, res = name("")
        line = note("Arrived")
        run.report(code == 200 and res["settings"]["activityName"] == "" and line.endswith("You added a note: Arrived"),
                   "the empty string saves, and the line reads \"You\" again", f"{code}; {line}")
        text = (root / path).read_text("utf-8")
        run.report("Gene" not in text, "no built-in name was written into the note")
    finally:
        served.stop()


# -- 9. a note's title is in one place ---------------------------------------------------------


def check_title_once(run: Run, spaces: Spaces) -> None:
    print("\n9. A note's title is in one place")
    code, root = spaces.make("Titles")
    assert code == 201, code
    served = Served(root)
    try:
        # (a) "New note", then the title typed: a create without a title, then a rename.
        note = create(served, "page")
        code, renamed = served.http("POST", "/object/rename", {"path": note["path"], "title": "Groceries",
                                                               "baseVersion": note["version"]})
        ok = code == 200 and renamed["path"] == "Pages/Groceries.md"
        run.report(ok and body_of(root, renamed["path"]) == "" and fm_of(root, renamed["path"]).get("title") == "Groceries",
                   "New note, then a title typed: the title is in the front matter and the body stays empty",
                   f"{code}; body {body_of(root, renamed['path'])!r}" if ok else f"{code} {renamed}")

        # (b) a titled create with no body: a linked note ([[New thing]]), the palette's create row.
        linked = create(served, "page", title="New thing")
        run.report(body_of(root, linked["path"]) == "" and fm_of(root, linked["path"]).get("title") == "New thing",
                   "a note made with a title (from [[, @ or the palette) has no \"# title\" line in its body",
                   f"body {body_of(root, linked['path'])!r}")
        task = create(served, "task", title="Call the bank", values={"date": {"start": DAY, "resolution": "day"}})
        run.report(body_of(root, task["path"]) == "", "nor has a task made with a title", f"body {body_of(root, task['path'])!r}")
        turned = create(served, "task", title="Pack", appendBody="- socks\n- charger")
        run.report(body_of(root, turned["path"]) == "- socks\n- charger\n",
                   "a line turned into a task keeps its children as the body, with no heading above them",
                   f"body {body_of(root, turned['path'])!r}")
        sent = create(served, "page", title="Pasted", templateId="none", body="# Pasted\n\nKept as sent.\n")
        run.report(body_of(root, sent["path"]) == "# Pasted\n\nKept as sent.\n", "a body sent with the create is kept as sent")

        # (c) a type whose default template has an empty body, then one with text.
        code, tmpl = served.http("POST", "/types/page/templates", {"name": "Plain"})
        assert code == 201, (code, tmpl)
        template_id = fm_of(root, tmpl["path"])["id"]
        page = next(t for t in info(served)["types"] if t["id"] == "page")
        page["templates"] = {**(page.get("templates") or {}), "defaultTemplateId": template_id}
        code, _res = served.http("PUT", "/types/page", {"type": page, "baseRevision": page["revision"]})
        from_empty = create(served, "page", title="From an empty template")
        run.report(code == 200 and body_of(root, from_empty["path"]) == "",
                   "a type whose default template has an empty body: the new note's body is empty",
                   f"{code}; body {body_of(root, from_empty['path'])!r}")
        _obj, _fm, version = served.space.read(tmpl["path"])
        served.space.save_body(tmpl["path"], "## Agenda\n\n- \n", version)
        from_text = create(served, "page", title="From a template with text")
        run.report(body_of(root, from_text["path"]) == "## Agenda\n\n- \n",
                   "a default template with text gives the new note that text, with no heading above it",
                   f"body {body_of(root, from_text['path'])!r}")
    finally:
        served.stop()


# -- main ----------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--keep", action="store_true", help="keep the temporary folder")
    args = ap.parse_args(argv)
    fixtures_before = {n: tree(FIXTURES / n) for n in FIXTURE_NAMES}

    tmp = Path(tempfile.mkdtemp(prefix="m32-acceptance-")).resolve()
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    os.environ.pop("OBJECT_CLOCK_FILE", None)
    os.environ.update({"OBJECT_STATE_DIR": str(tmp / "state"), "OBJECT_CACHE_DIR": str(tmp / "cache")})
    run = Run(tmp, lambda *a, **k: (0, None))
    spaces: Spaces | None = None
    try:
        print(f"Working folder: {tmp}")
        spaces = Spaces(tmp)
        check_new_space(run, spaces)
        check_older_space(run, tmp)
        check_work_default(run, spaces, tmp)
        check_work_switch(run, spaces)
        check_starter_sets(run, spaces)
        check_gallery(run, spaces)
        check_daily_note(run, spaces)
        check_activity_name(run, tmp)
        check_title_once(run, spaces)
        print("\n10. The fixtures")
        run.report(all(tree(FIXTURES / n) == fixtures_before[n] for n in FIXTURE_NAMES), "the fixture folders are unchanged")
    except Exception as exc:  # report a crash as a failure, then clean up
        run.report(False, f"the run stopped: {exc!r}")
        raise
    finally:
        if spaces is not None:
            spaces.stop()
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
