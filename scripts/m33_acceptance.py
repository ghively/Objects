"""Milestone 33 acceptance run over HTTP (the back end's part: the two settings, titles written
twice, imports).

Usage: ``uv run python scripts/m33_acceptance.py [--keep]``

Every space the run touches is a fresh one in a temporary folder (made through ``POST
/api/spaces`` as the app's "Create space" dialog calls it) or a copy of a synthetic fixture
(``space-sample``; the import sources ``import-obsidian`` and ``import-notion``). The fixtures are
never touched: their bytes are compared before and after. ``OBJECT_STATE_DIR`` and
``OBJECT_CACHE_DIR`` are temporary paths outside every space, so "nothing was written" is a
comparison of the whole space folder (dot folders included; each file's hash, size and
modification time) and of the state folder. `create_app` is served on a free ``127.0.0.1`` port
per space (`m8_acceptance.Served`, the watcher on). No agent runs; no real data, no network. The
desktop window and its launcher are not started here (``desktop/`` has its own tests).

The checks (the plan is ``2026-11-12-m33-desktop-window-and-choices.md``; what only the screen
can show is Gene's hand checks in ``m33-acceptance.md``):

 1. the two settings (choices 7 and the window's buttons): with no settings file
    ``greaterThanMakes`` reads ``toggle`` and ``windowButtons`` reads ``auto``, and reading makes
    no file; a settings file as the code before M33 wrote it reads those defaults, keeps every
    value it held and is not rewritten (hash, size, modification time); any other value is 422
    and writes nothing; each allowed value saves and reads back, and saving adds only its own
    key to the file;
 2. notes that begin with a heading repeating their title (choice 5): ``GET
    /api/space/title-headings`` counts the notes that do (LF, CRLF, with a BOM, two notes of one
    title, a task) and leaves out the others (a second-level heading, text first, a code fence,
    a note whose title comes from its heading, a daily note, an AI chat, a whiteboard, a
    template); a note made now through the app is not counted; the count, with everything else
    the app reads, writes nothing;
 3. "Remove those headings" (choice 5): ``POST /api/space/title-headings/remove`` changes each
    counted note by the heading line, one blank line after it and its ``lastUpdated`` stamp and
    nothing else (line endings and BOM kept), touches no other file, keeps the earlier text in
    version history, and a second call changes nothing; restoring a version brings the line back;
 4. a fixture space (a copy of ``space-sample``): one note is counted, the note whose title is its
    heading is not; the removal changes that one file and no other;
 5. a new import adds no heading (choice 5): a Markdown folder and the Obsidian fixture, into a
    new space: a page without a first heading of its own has none in Object, a row or an empty
    page has an empty text, a page that opens with its own heading keeps it, and the report
    shows its title once; the sources are only read;
 6. a re-run of an import made before M33 (choice 5): the space as the old code left it (every
    such page with ``# <title>`` on top, the batch's records saying so) is imported again from the
    same sources (a Markdown folder; the Notion fixture as a zip): nothing is imported or
    updated, no file that existed changes (hash, size, modification time) and the only new files
    are the re-run's report and batch records; then one source page changes: that note alone is
    updated, written without the added line, its earlier text in version history; after "Remove
    those headings" another re-run still writes nothing;
 7. the fixture folders are unchanged.

Each check prints ``[ok]`` or ``[FAIL]``; ends with ``RESULT: PASS`` or exits non-zero.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))
sys.path.insert(0, str(REPO / "backend" / "tests"))
sys.path.insert(0, str(REPO / "scripts"))

from m2_acceptance import Run, remove_tree  # noqa: E402
from m8_acceptance import Served, body_of, fm_of, state_tree  # noqa: E402
from m32_acceptance import READS, Spaces, copy_space, differ, stamped, tree  # noqa: E402

FIXTURES = REPO / "backend" / "tests" / "fixtures"
FIXTURE_NAMES = ("space-sample", "space-blocks", "import-obsidian", "import-notion")
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE")
OLD = "2026-01-05T08:00:00.000Z"
BOM = b"\xef\xbb\xbf"

# ``settings.json`` exactly as the code at ``41857f51`` (M32, before the two keys) wrote it for a
# patch of six settings (the same bytes as ``backend/tests/test_m33_settings.py``).
OLD_SETTINGS = (
    b'{\n  "themeMode": "light",\n  "alwaysOpenAsFullPage": false,\n  "toggleStyle": "bullet",\n'
    b'  "zoom": 1.1,\n  "appIcon": "blue",\n  "activityName": "Sam"\n}\n'
)


# -- plumbing ------------------------------------------------------------------------------


def file_stamp(path: Path) -> tuple[str, int, int] | None:
    if not path.is_file():
        return None
    st = path.stat()
    return hashlib.sha256(path.read_bytes()).hexdigest(), st.st_size, st.st_mtime_ns


def note(title_line: str | None, body: str, n: int, type_name: str = "Page", extra: str = "") -> str:
    """A note file's text (LF) as an older version of the app left it."""
    lines = [f"id: 01JD{n:022d}", f"type: '{type_name}'"]
    if title_line is not None:
        lines.append(title_line)
    if extra:
        lines.append(extra)
    lines += [f"createdAt: '{OLD}'", f"lastUpdated: '{OLD}'"]
    return "---\n" + "\n".join(lines) + "\n---\n" + body


def put(root: Path, rel: str, text: str, *, crlf: bool = False, bom: bool = False) -> bytes:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (BOM if bom else b"") + (text.replace("\n", "\r\n") if crlf else text).encode("utf-8")
    path.write_bytes(data)
    return data


def line_diff(before: bytes, after: bytes) -> tuple[list[bytes], list[bytes]]:
    """(the lines only ``before`` has, the lines only ``after`` has), each with its line end."""
    a, b = before.splitlines(keepends=True), after.splitlines(keepends=True)
    gone: list[bytes] = []
    came: list[bytes] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if op != "equal":
            gone += a[i1:i2]
            came += b[j1:j2]
    return gone, came


def only_the_heading_went(before: bytes, after: bytes, heading: list[bytes]) -> bool:
    """``after`` is ``before`` without the ``heading`` lines and with a new ``lastUpdated`` stamp."""
    gone, came = line_diff(before, after)
    stamps = [ln for ln in gone if ln.startswith(b"lastUpdated:")]
    rest = [ln for ln in gone if not ln.startswith(b"lastUpdated:")]
    return (rest == heading and len(stamps) == 1 and len(came) == 1 and came[0].startswith(b"lastUpdated:")
            and came[0] != stamps[0] and came[0].endswith(b"\r\n") == stamps[0].endswith(b"\r\n")
            and after.startswith(BOM) == before.startswith(BOM))


def count(served: Served) -> Any:
    code, res = served.http("GET", "/space/title-headings")
    return res.get("count") if code == 200 and isinstance(res, dict) else (code, res)


def remove(served: Served) -> Any:
    code, res = served.http("POST", "/space/title-headings/remove")
    return res.get("changed") if code == 200 and isinstance(res, dict) else (code, res)


def versions(served: Served, rel: str) -> list[str]:
    """The texts kept in version history for ``rel``, newest first."""
    code, res = served.http("GET", "/history", path=rel)
    if code != 200:
        return []
    out = []
    for v in res["versions"]:
        code, got = served.http("GET", "/history/version", path=rel, id=v["id"])
        out.append(got.get("text") if code == 200 else None)
    return out


def text_of(data: bytes) -> str:
    return data.removeprefix(BOM).decode("utf-8").replace("\r\n", "\n")


def do_import(served: Served, source: Path) -> dict:
    code, preview = served.http("POST", "/import/preview", {"source": {"path": str(source)}, "target": "currentSpace",
                                                            "keepAsSources": False})
    assert code == 200, (code, preview)
    code, started = served.http("POST", "/import/start", {
        "previewId": preview["previewId"], "mapping": preview["mapping"], "target": {"kind": "currentSpace"},
        "keepAsSources": False})
    assert code == 202, (code, started)
    for _ in range(1200):
        _, job = served.http("GET", f"/import/jobs/{started['jobId']}")
        if job["phase"] in ("done", "failed", "cancelled"):
            break
        time.sleep(0.05)
    assert job["phase"] == "done", job
    return job["result"]


def batch_items(root: Path, batch: str) -> list[dict]:
    return json.loads((root / ".object" / "imports" / batch / "items.json").read_text("utf-8"))


def created(root: Path, batch: str) -> dict[str, dict]:
    return {i["path"]: i for i in batch_items(root, batch) if i.get("action") == "created" and i.get("path")}


def used(served: Served) -> None:
    """Make the space one that has been used: its first kept version gives a space its id
    (``spaceId`` in ``.object/space.json``), as since 2026-11-08. Done before anything is
    compared, so the comparisons below hold for every file."""
    code, made = served.http("POST", "/objects", {"typeId": "page", "title": "Scratch"})
    assert code == 201, (code, made)
    code, res = served.http("PUT", "/object/body", {"path": made["path"], "body": "A first line.\n", "baseVersion": made["version"]})
    assert code == 200, (code, res)


def markdown_folder(dest: Path) -> Path:
    """A small Markdown folder: text only, its own heading, another heading, front matter only."""
    dest.mkdir(parents=True)
    (dest / "Plain.md").write_text("Just text.\n\nSecond paragraph.\n", encoding="utf-8")
    (dest / "Alpha.md").write_text("Alpha, version one.\n", encoding="utf-8")
    (dest / "Own.md").write_text("# Own\n\nIts own heading, the same as its name.\n", encoding="utf-8")
    (dest / "Other.md").write_text("# A different heading\n\nText.\n", encoding="utf-8")
    (dest / "Props.md").write_text("---\nstatus: open\n---\n", encoding="utf-8")
    (dest / "Windows.md").write_bytes(b"Line one.\r\nLine two.\r\n")
    return dest


FOLDER_BODIES = {
    "Plain": "Just text.\n\nSecond paragraph.\n",
    "Alpha": "Alpha, version one.\n",
    "Own": "# Own\n\nIts own heading, the same as its name.\n",
    "Other": "# A different heading\n\nText.\n",
    "Props": "",
    "Windows": "Line one.\nLine two.\n",
}


def zip_folder(folder: Path, dest: Path) -> Path:
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(folder.rglob("*")):
            if p.is_file():
                zf.write(p, p.relative_to(folder).as_posix())
    return dest


# -- 1. the two settings -------------------------------------------------------------------


def check_settings(run: Run, spaces: Spaces, tmp: Path) -> None:
    print("\n1. The two settings (what \"> \" makes, the window's buttons)")
    http = spaces.host.http
    path = tmp / "state" / "settings.json"
    code, got = http("GET", "/settings")
    s = got["settings"] if code == 200 else {}
    run.report(code == 200 and s.get("greaterThanMakes") == "toggle" and s.get("windowButtons") == "auto"
               and got["revision"] == "" and not path.exists(),
               "with no settings file: greaterThanMakes is \"toggle\", windowButtons is \"auto\", and reading makes no file",
               f"{code}; {s.get('greaterThanMakes')!r}, {s.get('windowButtons')!r}; file exists: {path.exists()}")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(OLD_SETTINGS)
    before = file_stamp(path)
    code, got = http("GET", "/settings")
    s = got["settings"] if code == 200 else {}
    run.report(code == 200 and s.get("greaterThanMakes") == "toggle" and s.get("windowButtons") == "auto"
               and got["revision"] == hashlib.sha256(OLD_SETTINGS).hexdigest(),
               "a settings file written before M33 reads the two defaults",
               f"{code}; {s.get('greaterThanMakes')!r}, {s.get('windowButtons')!r}")
    kept = (s.get("themeMode"), s.get("alwaysOpenAsFullPage"), s.get("toggleStyle"), s.get("zoom"), s.get("appIcon"), s.get("activityName"))
    run.report(kept == ("light", False, "bullet", 1.1, "blue", "Sam"), "and every value it held", f"{kept}")
    for _ in range(3):
        http("GET", "/settings")
        http("GET", "/space")
    run.report(file_stamp(path) == before and sorted(p.name for p in path.parent.glob("settings*")) == ["settings.json"],
               "reading it does not rewrite it (hash, size, modification time)")

    revision = got["revision"]
    bad = []
    for patch in ({"greaterThanMakes": "blockquote"}, {"greaterThanMakes": True}, {"greaterThanMakes": None},
                  {"windowButtons": "automatic"}, {"windowButtons": ""}, {"windowButtons": 1}):
        code, res = http("PUT", "/settings", {"patch": patch, "baseRevision": revision})
        if code != 422:
            bad.append(f"{patch}: {code} {res}")
    run.report(not bad and file_stamp(path) == before, "any other value is refused (422) and nothing is written", *bad)

    code, res = http("PUT", "/settings", {"patch": {"greaterThanMakes": "quote"}, "baseRevision": revision})
    stored = json.loads(path.read_text("utf-8"))
    run.report(code == 200 and res["settings"]["greaterThanMakes"] == "quote" and res["settings"]["windowButtons"] == "auto"
               and stored == {**json.loads(OLD_SETTINGS), "greaterThanMakes": "quote"},
               "\"quote\" saves; the file gains only that key (windowButtons is not written until it is set)",
               f"{code}; {stored}")
    revision = res["revision"] if code == 200 else revision
    wrong = []
    for key, value in (("windowButtons", "hide"), ("windowButtons", "show"), ("windowButtons", "auto"),
                       ("greaterThanMakes", "toggle"), ("greaterThanMakes", "quote")):
        code, res = http("PUT", "/settings", {"patch": {key: value}, "baseRevision": revision})
        if code != 200 or res["settings"].get(key) != value or http("GET", "/settings")[1]["settings"].get(key) != value:
            wrong.append(f"{key}={value}: {code}")
        else:
            revision = res["revision"]
    stored = json.loads(path.read_text("utf-8"))
    run.report(not wrong and stored == {**json.loads(OLD_SETTINGS), "greaterThanMakes": "quote", "windowButtons": "auto"},
               "each allowed value (toggle, quote; auto, show, hide) saves and reads back; the other keys stay as they were",
               *wrong, f"{stored}")
    path.unlink()  # the checks below run with the defaults


# -- 2 and 3. titles written twice ---------------------------------------------------------


def old_notes(root: Path) -> tuple[dict[str, bytes], dict[str, list[bytes]]]:
    """Notes as older versions left them: (the counted ones' bytes, the heading lines each loses)."""
    counted = {
        "Pages/Groceries.md": put(root, "Pages/Groceries.md", note("title: Groceries", "# Groceries\n\nMilk.\n", 1)),
        "Pages/Windows.md": put(root, "Pages/Windows.md", note("title: Windows", "# Windows\n\nLine one.\nLine two.\n", 2), crlf=True),
        "Pages/Marked.md": put(root, "Pages/Marked.md", note("title: Marked", "# Marked\n\nText.\n", 3), bom=True),
        "Pages/Both.md": put(root, "Pages/Both.md", note("title: Both", "# Both\nNo blank line under it.\n", 4), crlf=True, bom=True),
        "Pages/Twin.md": put(root, "Pages/Twin.md", note("title: Twin", "# Twin\n\nFirst.\n", 5)),
        "Projects/Twin.md": put(root, "Projects/Twin.md", note("title: Twin", "# Twin\n\nSecond.\n", 6, "Project")),
        "Tasks/Call the bank.md": put(root, "Tasks/Call the bank.md", note("title: Call the bank", "#  Call the bank  \n\n- [ ] dial\n", 7, "Task")),
    }
    lines = {
        "Pages/Groceries.md": [b"# Groceries\n", b"\n"],
        "Pages/Windows.md": [b"# Windows\r\n", b"\r\n"],
        "Pages/Marked.md": [b"# Marked\n", b"\n"],
        "Pages/Both.md": [b"# Both\r\n"],
        "Pages/Twin.md": [b"# Twin\n", b"\n"],
        "Projects/Twin.md": [b"# Twin\n", b"\n"],
        "Tasks/Call the bank.md": [b"#  Call the bank  \n", b"\n"],
    }
    put(root, "Pages/Plain.md", note("title: Plain", "Just text.\n", 20))
    put(root, "Pages/Sub.md", note("title: Sub", "## Sub\n\nText.\n", 21))
    put(root, "Pages/Case.md", note("title: Case", "# case\n\nText.\n", 22))
    put(root, "Pages/Fence.md", note("title: Fence", "```\n# Fence\n```\n", 23))
    put(root, "Pages/Later.md", note("title: Later", "Intro.\n\n# Later\n", 24))
    put(root, "Pages/Headed.md", note(None, "# Headed by its text\n\nText.\n", 25))
    put(root, "DailyNotes/2026-11-10.md", note("title: 2026-11-10", "# 2026-11-10\n\nDay.\n", 30, "DailyNote", "date: 2026-11-10"))
    put(root, "AI Chats/Plan.md", note("title: Plan", "# Plan\n\n## You\n<!-- at: 2026-11-05T12:00:00.000Z -->\n\nHi.\n", 31, "AI Chat"))
    put(root, "Whiteboards/Sketch.md", note("title: Sketch", "# Sketch\n\nNotes.\n", 32, "Whiteboard"))
    put(root, "Templates/Weekly.md", note("title: Weekly", "# Weekly\n\n## Agenda\n", 33, "Page", "template: 01JDTEMPLATE0000000000000A"))
    return counted, lines


def check_title_headings(run: Run, spaces: Spaces) -> None:
    print("\n2. Notes that begin with a heading repeating their title: the count")
    code, root = spaces.make("Old notes")
    assert code == 201, code
    counted, lines = old_notes(root)
    served = Served(root)
    try:
        used(served)
        got = count(served)
        run.report(got == len(counted) == 7,
                   "GET /api/space/title-headings counts the seven notes that begin with \"# <their title>\" "
                   "(LF, CRLF, BOM, two of one title, a task)", f"{got}")
        code, objs = served.http("GET", "/objects")
        headed = next((o for o in objs if o["path"] == "Pages/Headed.md"), {})
        run.report(headed.get("title") == "Headed by its text",
                   "left out: a second-level heading, another case, a code fence, text first, a daily note, an AI chat, "
                   "a whiteboard, a template, and the note whose title is that heading", f"{headed.get('title')!r}")
        made = []
        for req in ({"typeId": "page", "title": "Made today"}, {"typeId": "task", "title": "Buy milk", "body": ""},
                    {"typeId": "page", "title": "With text", "appendBody": "Words."}):
            code, res = served.http("POST", "/objects", req)
            made.append((code, body_of(root, res["path"]) if code == 201 else None))
        run.report([c for c, _b in made] == [201, 201, 201] and [b for _c, b in made] == ["", "", "Words.\n"] and count(served) == 7,
                   "a note made now through the app has no such line and is not counted", f"{made}; {count(served)}")

        before, state_before = stamped(root), state_tree()
        answers = [count(served) for _ in range(3)]
        bad = [f"{m} {r} {c}" for m, r, p, q in READS if (c := served.http(m, r, p, **q)[0]) != 200]
        run.report(answers == [7, 7, 7] and not bad and not differ(before, stamped(root)) and state_tree() == state_before,
                   "the count, and everything else the app reads, wrote nothing (the whole folder: hash, size, modification "
                   "time; the state folder)", *bad, *differ(before, stamped(root)))

        print("\n3. \"Remove those headings\"")
        got = remove(served)
        after = stamped(root)
        run.report(got == 7, "POST /api/space/title-headings/remove answers {changed: 7}", f"{got}")
        wrong = [rel for rel, was in counted.items() if not only_the_heading_went(was, (root / rel).read_bytes(), lines[rel])]
        run.report(not wrong, "each note lost the heading line, one blank line after it and its old lastUpdated stamp, "
                              "and nothing else (CRLF and BOM kept)", *wrong)
        run.report(sorted(differ(before, after)) == sorted(counted),
                   "no other file changed: the notes left out, the types, the space's settings", *sorted(set(differ(before, after)) - set(counted)))
        kept = {rel: versions(served, rel) for rel in counted}
        missing = [rel for rel, was in counted.items() if not kept[rel] or kept[rel][0] != text_of(was)]
        run.report(not missing, "each note's earlier text is its newest version in version history", *missing)
        again = remove(served)
        run.report(again == 0 and count(served) == 0 and not differ(after, stamped(root)),
                   "a second call changes nothing (0), and the count is 0", f"{again}; {count(served)}; {differ(after, stamped(root))}")
        # put one back from history
        rel = "Pages/Windows.md"
        code, obj = served.http("GET", "/object", path=rel)
        code, res = served.http("GET", "/history", path=rel)
        code, res = served.http("POST", "/history/restore", {"path": rel, "id": res["versions"][0]["id"], "baseVersion": obj["version"]})
        back = (root / rel).read_bytes()
        run.report(code == 200 and back.count(b"---\r\n# Windows\r\n\r\nLine one.\r\nLine two.\r\n") == 1 and count(served) == 1,
                   "restoring that version brings the line back (and the note is counted again)", f"{code}; {count(served)}")
    finally:
        served.stop()


# -- 4. a fixture space ----------------------------------------------------------------------


def check_fixture_space(run: Run, tmp: Path) -> None:
    print("\n4. A fixture space (a copy of space-sample)")
    root = copy_space("space-sample", tmp / "sample")
    served = Served(root)
    try:
        used(served)
        ada, notes = "People/Ada Lovelace.md", "Pages/Notes.md"
        got = count(served)
        code, objs = served.http("GET", "/objects")
        titles = {o["path"]: o["title"] for o in objs}
        run.report(got == 1 and body_of(root, ada).startswith("\n# Ada Lovelace\n") and titles.get(ada) == "Ada Lovelace"
                   and body_of(root, notes).startswith("# Meeting notes\n") and titles.get(notes) == "Meeting notes",
                   "one note is counted (Ada Lovelace: a blank line, then her name as a heading); \"Meeting notes\", whose title "
                   "is its heading (it has no front matter), is not", f"{got}; {titles.get(ada)!r}, {titles.get(notes)!r}")
        before = stamped(root)
        was = (root / ada).read_bytes()
        changed = remove(served)
        diff = differ(before, stamped(root))
        gone, came = line_diff(was, (root / ada).read_bytes())
        run.report(changed == 1 and diff == [ada] and body_of(root, ada) == "\nWrote the first published algorithm.\n",
                   "the removal changes that one file and no other; the blank line above the heading stays", f"{changed}; {diff}")
        run.report(sorted(ln.split(b":")[0] for ln in gone) == [b"\n", b"# Ada Lovelace\n", b"lastUpdated"]
                   and sorted(ln.split(b":")[0] for ln in came) == [b"id", b"lastUpdated"]
                   and titles.get(notes) == "Meeting notes" and count(served) == 0,
                   "in it: the heading, one blank line and the stamp, and the id a body save gives a note that has none",
                   f"-{gone} +{came}")
    finally:
        served.stop()


# -- 5. a new import -------------------------------------------------------------------------


def check_new_import(run: Run, spaces: Spaces, tmp: Path) -> None:
    print("\n5. A new import adds no heading")
    from objectapp.importers.notion import page_heading
    from objectapp.objfile import split_object

    code, root = spaces.make("Imported")
    assert code == 201, code
    folder = markdown_folder(tmp / "sources" / "Folder")
    vault = tmp / "sources" / "Vault"
    shutil.copytree(FIXTURES / "import-obsidian", vault)
    sources_before = {p: tree(p) for p in (folder, vault)}
    served = Served(root)
    try:
        res = do_import(served, folder)
        made = created(root, res["batch"])
        bodies = {str(fm_of(root, rel)["title"]): body_of(root, rel) for rel in made}
        run.report(bodies == FOLDER_BODIES,
                   "a Markdown folder: each page's text is its own text (no \"# <title>\" above it; front matter only gives an "
                   "empty text; a page's own first heading is kept)", *(f"{t}: {b!r}" for t, b in bodies.items() if FOLDER_BODIES.get(t) != b))
        report = body_of(root, res["reportPath"])
        run.report(report.startswith("- Source: ") and "# Import report" not in report
                   and (root / ".object" / "imports" / res["batch"] / "report.md").read_text("utf-8") == report,
                   "the report shows its title once: its text opens with \"- Source:\" (the batch's report.md is the same text)")
        run.report(count(served) == 1, "afterwards one note is counted: \"Own\", by the heading its page had itself", f"{count(served)}")

        res = do_import(served, vault)
        made = created(root, res["batch"])
        wrong = []
        without = 0
        for rel, item in made.items():
            src = vault / item["sourcePath"]
            own = page_heading(split_object(src.read_text("utf-8-sig").replace("\r\n", "\n")).body) if src.suffix == ".md" and src.is_file() else None
            now = page_heading(body_of(root, rel))
            without += own is None
            if now != own:
                wrong.append(f"{rel}: source heading {own!r}, note heading {now!r}")
        run.report(len(made) == res["objects"] > 3 and without > 3 and not wrong,
                   f"the Obsidian fixture: {without} pages without a first heading of their own have none in Object; a page's own "
                   "heading is kept", *wrong)
        run.report(all(tree(p) == was for p, was in sources_before.items()), "the sources were only read")
    finally:
        served.stop()


# -- 6. a re-run of an import made before M33 -------------------------------------------------


def check_rerun(run: Run, spaces: Spaces, tmp: Path) -> None:
    print("\n6. A re-run of an import made before M33")
    from m33_helpers import as_before_m33
    from objectapp.frontmatter import parse_fm
    from objectapp.objfile import split_object

    code, root = spaces.make("Imported before")
    assert code == 201, code
    folder = markdown_folder(tmp / "sources2" / "Folder")
    notion = tmp / "sources2" / "Notion"
    shutil.copytree(FIXTURES / "import-notion", notion)
    archive = zip_folder(notion, tmp / "sources2" / "Notion.zip")
    served = Served(root)
    try:
        used(served)
        first = [do_import(served, folder), do_import(served, archive)]
    finally:
        served.stop()
    headed = [rel for res in first for rel in as_before_m33(root, res["batch"])]
    paths = {str(fm_of(root, rel)["title"]): rel for rel in created(root, first[0]["batch"])}
    run.report(len(headed) == 7 and body_of(root, paths["Plain"]) == "# Plain\n\nJust text.\n\nSecond paragraph.\n"
               and body_of(root, paths["Props"]) == "# Props\n" and body_of(root, paths["Own"]).startswith("# Own\n\nIts own"),
               "the space as the old code left it: \"# <title>\" on top of the 7 notes it headed (four pages without a heading of "
               "their own, a row, the two reports)", f"{headed}")
    before = stamped(root)

    served = Served(root)
    try:
        was = count(served)
        second = [do_import(served, folder), do_import(served, archive)]
        totals = [(r["objects"], r["updated"], r["changedInBoth"], r["failed"], r["unchanged"]) for r in second]
        run.report(totals == [(0, 0, 0, 0, f["objects"]) for f in first] and was >= 8,
                   f"imported again from the same sources: nothing imported, nothing updated, every item unchanged ({was} notes "
                   "were counted before it)", f"{totals}")
        after = stamped(root)
        changed = sorted(p for p in before if after.get(p) != before[p])
        own = {r["reportPath"] for r in second}
        records = tuple(f".object/imports/{r['batch']}/" for r in second)
        new = sorted(p for p in after if p not in before and p not in own and not p.startswith(records))
        run.report(not changed and not new,
                   "no file that existed changed (hash, size, modification time); the only new files are the re-runs' reports "
                   "and batch records", *changed, *new)
        run.report(body_of(root, paths["Plain"]) == "# Plain\n\nJust text.\n\nSecond paragraph.\n" and count(served) == was,
                   "the old headings are still there (nothing is removed without the click), and the count is the same")

        # one source page changes
        old_alpha = (root / paths["Alpha"]).read_bytes()
        (folder / "Alpha.md").write_text("Alpha, version two.\n", encoding="utf-8")
        before = stamped(root)
        third = do_import(served, folder)
        after = stamped(root)
        changed = sorted(p for p in before if after.get(p) != before[p])
        run.report((third["updated"], third["unchanged"], third["objects"]) == (1, 5, 0) and changed == [paths["Alpha"]]
                   and body_of(root, paths["Alpha"]) == "Alpha, version two.\n",
                   "a source page that changed: that note alone is updated, and written without the added line",
                   f"{(third['updated'], third['unchanged'], third['objects'])}; {changed}; {body_of(root, paths['Alpha'])!r}")
        old_id = parse_fm(split_object(text_of(old_alpha)).frontmatter_src)["id"]
        run.report(text_of(old_alpha) in versions(served, paths["Alpha"]) and fm_of(root, paths["Alpha"])["id"] == old_id,
                   "its earlier text, heading included, is in version history; its id is kept")

        # "Remove those headings", then once more
        left = count(served)
        removed = remove(served)
        before = stamped(root)
        fourth = [do_import(served, folder), do_import(served, archive)]
        after = stamped(root)
        changed = sorted(p for p in before if after.get(p) != before[p])
        run.report(removed == left > 0 and count(served) == 0 and not changed
                   and all((r["objects"], r["updated"], r["changedInBoth"]) == (0, 0, 0) for r in fourth)
                   and body_of(root, paths["Plain"]) == "Just text.\n\nSecond paragraph.\n",
                   f"after \"Remove those headings\" ({removed} notes) another re-run still writes nothing: the headings do not "
                   "come back", f"{removed} of {left}; {changed}")
    finally:
        served.stop()


# -- main ----------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--keep", action="store_true", help="keep the temporary folder")
    args = ap.parse_args(argv)
    fixtures_before = {n: tree(FIXTURES / n) for n in FIXTURE_NAMES}

    tmp = Path(tempfile.mkdtemp(prefix="m33-acceptance-")).resolve()
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    os.environ.pop("OBJECT_CLOCK_FILE", None)
    os.environ.update({"OBJECT_STATE_DIR": str(tmp / "state"), "OBJECT_CACHE_DIR": str(tmp / "cache")})
    run = Run(tmp, lambda *a, **k: (0, None))
    spaces: Spaces | None = None
    try:
        print(f"Working folder: {tmp}")
        spaces = Spaces(tmp)
        check_settings(run, spaces, tmp)
        check_title_headings(run, spaces)
        check_fixture_space(run, tmp)
        check_new_import(run, spaces, tmp)
        check_rerun(run, spaces, tmp)
        print("\n7. The fixtures")
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
