"""M33 choice 5: notes that begin with a heading repeating their title.

``GET /api/space/title-headings`` counts them (reads only), and ``POST
/api/space/title-headings/remove`` takes that one line (and one blank line after it) out of
each, through the ordinary body write.

The rule (`titleheadings.title_line`): the note's title is in its front matter, and the first
line of its text that is not blank is the ``# <title>`` heading `Space.rename_object` keeps in
step with the title (`space.title_heading`, the same code). Left out: a note whose title comes
from the heading itself (no ``title`` in the front matter), an AI chat (its format writes that
line), a daily note (its title is its date and can't be renamed), a whiteboard, a template, an
imported Source and a file that opens read-only. Synthetic notes only.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp import titleheadings
from objectapp.history import HistoryStore
from objectapp.server import create_app
from objectapp.space import Space, title_heading, version_of
from objectapp.spaces import create_space

NOW = datetime(2026, 11, 12, 9, 30, 0, tzinfo=UTC)
STAMP = "2026-11-12T09:30:00.000Z"
OLD = "2026-01-05T08:00:00.000Z"


def _ulid(n: int) -> str:
    return f"01JD{n:022d}"


def _note(title_line: str | None, body: str, n: int = 1, type_name: str = "Page", extra: str = "") -> str:
    """A note file's text (LF): id, type, the title line as given, extra lines, the stamps."""
    lines = [f"id: {_ulid(n)}", f"type: '{type_name}'"]
    if title_line is not None:
        lines.append(title_line)
    if extra:
        lines.append(extra)
    lines += [f"createdAt: '{OLD}'", f"lastUpdated: '{OLD}'"]
    return "---\n" + "\n".join(lines) + "\n---\n" + body


def _put(root: Path, rel: str, text: str, *, crlf: bool = False, bom: bool = False) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    data = text.replace("\n", "\r\n").encode("utf-8") if crlf else text.encode("utf-8")
    path.write_bytes((b"\xef\xbb\xbf" if bom else b"") + data)
    return path


def _stamped(*roots: Path) -> dict[str, tuple[str, int, int]]:
    """Every file under the folders with its hash, size and modification time."""
    out = {}
    for root in roots:
        if not root.exists():
            continue
        for p in sorted(root.rglob("*")):
            if p.is_file():
                st = p.stat()
                out[str(p)] = (hashlib.sha256(p.read_bytes()).hexdigest(), st.st_size, st.st_mtime_ns)
    return out


@pytest.fixture
def root(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    made = create_space("Notes", tmp_path)
    # A space that has been used: it has its id (a new one gets it with the first version kept,
    # which adds a key to `.object/space.json`; `test_a_new_space_gets_only_its_id` shows that).
    HistoryStore(made).migrate()
    return made


class App:
    def __init__(self, root: Path) -> None:
        self.space = Space(root)
        self.space.clock = lambda: NOW
        self.app = create_app(self.space, None, watch=False)
        self.events: list[tuple[str, str, str | None, str | None]] = []
        real = self.app.state.hub.publish
        self.app.state.hub.publish = lambda e: (self.events.append((e.kind, e.path, e.version, e.origin)), real(e))[1]
        self._ctx = TestClient(self.app)
        self.c = self._ctx.__enter__()

    def close(self) -> None:
        self._ctx.__exit__(None, None, None)

    def count(self) -> int:
        r = self.c.get("/api/space/title-headings")
        assert r.status_code == 200, r.text
        assert set(r.json()) == {"count"}
        return r.json()["count"]

    def remove(self) -> int:
        r = self.c.post("/api/space/title-headings/remove")
        assert r.status_code == 200, r.text
        assert set(r.json()) == {"changed"}
        return r.json()["changed"]


@pytest.fixture
def app(root: Path):
    made: list[App] = []

    def make() -> App:
        made.append(App(root))
        return made[-1]

    yield make
    for a in made:
        a.close()


# -- the rule -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("title", "body", "left"),
    [
        ("Groceries", "# Groceries\n\nMilk.\n", "Milk.\n"),
        ("Groceries", "# Groceries\nMilk.\n", "Milk.\n"),  # no blank line under it: only the line
        ("Groceries", "# Groceries\n\n\nMilk.\n", "\nMilk.\n"),  # at most one blank line goes
        ("Groceries", "# Groceries\n \t\nMilk.\n", "Milk.\n"),  # a line of blanks is a blank line
        ("Groceries", "# Groceries\n", ""),
        ("Groceries", "# Groceries", ""),  # no newline at the end of the file
        ("Groceries", "\n\n# Groceries\n\nMilk.\n", "\n\nMilk.\n"),  # blank lines above stay
        # as `rename_object` reads a heading: blanks after the `#`, at the end, a closing `#`
        ("Groceries", "#   Groceries  \n\nMilk.\n", "Milk.\n"),
        ("Groceries", "#\tGroceries\n\nMilk.\n", "Milk.\n"),
        ("Groceries", "# Groceries #\n\nMilk.\n", "Milk.\n"),
        # Markdown characters in the title are compared as written
        ("*Stars* & [brackets] (v2) `code` _x_", "# *Stars* & [brackets] (v2) `code` _x_\n\nText.\n", "Text.\n"),
        ("100% [[linked]] | piped", "# 100% [[linked]] | piped\nText.\n", "Text.\n"),
        ("Groceries", "# Groceries\n\n# Groceries\n\nMilk.\n", "# Groceries\n\nMilk.\n"),  # one line only
    ],
)
def test_a_first_heading_that_repeats_the_title_is_the_line(title: str, body: str, left: str) -> None:
    span = titleheadings.title_line(body, title)
    assert span is not None
    assert body[: span[0]] + body[span[1] :] == left
    assert titleheadings.without_title_line(body, title) == left
    # the heading is the one a rename keeps in step
    m = title_heading(body, title)
    assert m is not None and m.start() == span[0]


@pytest.mark.parametrize(
    ("title", "body"),
    [
        ("Groceries", ""),
        ("Groceries", "Milk.\n"),
        ("Groceries", "# groceries\n\nMilk.\n"),  # another case: not the title
        ("Groceries", "# Groceries list\n\nMilk.\n"),
        ("Groceries", "## Groceries\n\nMilk.\n"),  # a second-level heading
        ("Groceries", "#Groceries\n\nMilk.\n"),  # no heading without the blank
        ("Groceries", " # Groceries\n\nMilk.\n"),  # indented: `rename_object` does not read it
        ("Groceries", "Intro.\n\n# Groceries\n\nMilk.\n"),  # text first: the note does not begin with it
        ("Groceries", "## Intro\n\n# Groceries\n\nMilk.\n"),  # another heading first
        ("Groceries", "```\n# Groceries\n```\n\nMilk.\n"),  # inside a code fence
        ("Groceries", "```\ncode\n```\n\n# Groceries\n\nMilk.\n"),  # a fence first
        ("Groceries", "~~~\n# Groceries\n~~~\n"),
        ("C#", "# C#\n\nText.\n"),  # the closing `#` is not part of a heading's text, so a rename skips it too
        ("", "# Something\n\nText.\n"),  # no title: nothing to repeat
        ("Groceries", "Groceries\n=========\n\nMilk.\n"),  # the other heading form is not read
    ],
)
def test_other_first_lines_are_left_alone(title: str, body: str) -> None:
    assert titleheadings.title_line(body, title) is None
    assert titleheadings.without_title_line(body, title) is None


def test_a_rename_uses_the_same_heading_rule(root: Path) -> None:
    """`rename_object` and the count read one function: what counts is what a rename rewrites
    (and a rename also rewrites a matching heading lower down, which is not counted)."""
    _put(root, "Pages/Top.md", _note("title: Top", "#   Top  \n\nText.\n", 1))
    _put(root, "Pages/Low.md", _note("title: Low", "Intro.\n\n# Low\n", 2))
    _put(root, "Pages/Fenced.md", _note("title: Fenced", "```\n# Fenced\n```\n# Fenced\n", 3))
    space = Space(root)
    assert titleheadings.paths(space) == ["Pages/Top.md"]
    for rel, new, body in (
        ("Pages/Top.md", "Top two", "# Top two\n\nText.\n"),
        ("Pages/Low.md", "Low two", "Intro.\n\n# Low two\n"),
        ("Pages/Fenced.md", "Fenced two", "```\n# Fenced\n```\n# Fenced two\n"),
    ):
        result = space.rename_object(rel, new, space.read(rel)[2])
        assert space.read(result.path)[0].body == body
    assert titleheadings.paths(space) == ["Pages/Top two.md"]


# -- the count ------------------------------------------------------------------------------


def _mixed(root: Path) -> dict[str, bytes]:
    """Notes that count and notes that do not; the counted ones' bytes by path."""
    counted = {
        "Pages/Groceries.md": _put(root, "Pages/Groceries.md", _note("title: Groceries", "# Groceries\n\nMilk.\n", 1)),
        "Pages/Windows.md": _put(root, "Pages/Windows.md", _note("title: Windows", "# Windows\n\nLine one.\nLine two.\n", 2), crlf=True),
        "Pages/Marked.md": _put(root, "Pages/Marked.md", _note("title: Marked", "# Marked\n\nText.\n", 3), bom=True),
        "Pages/Both.md": _put(root, "Pages/Both.md", _note("title: Both", "\n# Both\nText.\n", 4), crlf=True, bom=True),
        # two notes of one title, in two folders
        "Pages/Twin.md": _put(root, "Pages/Twin.md", _note("title: Twin", "# Twin\n\nFirst.\n", 5)),
        "Projects/Twin.md": _put(root, "Projects/Twin.md", _note("title: Twin", "# Twin\n\nSecond.\n", 6, "Project")),
        "Tasks/Call.md": _put(root, "Tasks/Call.md", _note("title: 'Call: the bank'", "# Call: the bank\n\n- [ ] dial\n", 7, "Task")),
        "Pages/Only.md": _put(root, "Pages/Only.md", _note("title: Only", "# Only\n", 8)),
    }
    # not counted
    _put(root, "Pages/Plain.md", _note("title: Plain", "Just text.\n", 20))
    _put(root, "Pages/Empty.md", _note("title: Empty", "", 21))
    _put(root, "Pages/Sub.md", _note("title: Sub", "## Sub\n\nText.\n", 22))
    _put(root, "Pages/Case.md", _note("title: Case", "# case\n\nText.\n", 23))
    _put(root, "Pages/Fence.md", _note("title: Fence", "```\n# Fence\n```\n", 24))
    _put(root, "Pages/Later.md", _note("title: Later", "Intro.\n\n# Later\n", 25))
    # its title comes from the heading: taking the line away would rename the note
    _put(root, "Pages/Headed.md", _note(None, "# Headed by its text\n\nText.\n", 26))
    _put(root, "Pages/Blank title.md", _note("title: ''", "# Blank title\n\nText.\n", 27))
    _put(root, "Pages/No front matter.md", "# No front matter\n\nText.\n")
    # kinds whose first line is not a repeat to take away
    _put(root, "Daily Notes/2026-11-10.md", _note("title: 2026-11-10", "# 2026-11-10\n\nDay.\n", 30, "DailyNote", "date: 2026-11-10"))
    _put(root, "AI Chats/Plan.md", _note("title: Plan", "# Plan\n\n## You\n<!-- at: 2026-11-05T12:00:00.000Z -->\n\nHi.\n", 31, "AI Chat"))
    _put(root, "Whiteboards/Sketch.md", _note("title: Sketch", "# Sketch\n\nNotes.\n", 32, "Whiteboard"))
    _put(root, "Templates/Weekly.md", _note("title: Weekly", "# Weekly\n\n## Agenda\n", 33, "Page", "template: 01JDTEMPLATE0000000000000A"))
    _put(root, "Sources/Kept.md", _note("title: Kept", "# Kept\n\nAs imported.\n", 34, "Source",
                                         "importSource: {system: markdown, id: Kept.md, batch: 01JDBATCH, importedAt: '2026-11-01T00:00:00.000Z'}"))
    # opens read-only: the front matter is not valid YAML
    _put(root, "Pages/Broken.md", "---\ntitle: Broken\nbad: [unclosed\n---\n# Broken\n\nText.\n")
    return {rel: p.read_bytes() for rel, p in counted.items()}


def test_the_count_and_which_notes(root: Path, app) -> None:
    counted = _mixed(root)
    a = app()
    assert a.space.get("Sources/Kept.md").readOnly  # an imported Source, as M30 opens it
    assert a.space.get("Pages/Broken.md").readOnly
    assert a.space.get("Pages/Headed.md").title == "Headed by its text"
    assert titleheadings.paths(a.space) == sorted(counted)
    assert a.count() == len(counted) == 8


def test_the_count_writes_nothing(root: Path, app, tmp_path: Path) -> None:
    _mixed(root)
    a = app()
    assert a.c.get("/api/objects").status_code == 200  # the app has opened and listed the space
    before = _stamped(root, tmp_path / "state")
    for _ in range(3):
        assert a.count() == 8
    assert _stamped(root, tmp_path / "state") == before
    assert a.events == []  # nothing is announced for a read


def test_a_note_made_now_is_not_counted(root: Path, app) -> None:
    a = app()
    for req in ({"typeId": "page", "title": "New thing"}, {"typeId": "task", "title": "Buy milk"},
                {"typeId": "page", "title": "With text", "appendBody": "Words."}):
        assert a.c.post("/api/objects", json=req).status_code == 201
    assert a.count() == 0
    # ...and one whose text the person begins with that heading is (it reads twice, as an old one)
    made = a.c.post("/api/objects", json={"typeId": "page", "title": "Typed", "templateId": "none", "body": "# Typed\n\nText.\n"})
    assert made.status_code == 201
    assert a.count() == 1


def test_the_count_follows_a_save(root: Path, app) -> None:
    _put(root, "Pages/Groceries.md", _note("title: Groceries", "# Groceries\n\nMilk.\n", 1))
    a = app()
    assert a.count() == 1
    version = a.c.get("/api/object", params={"path": "Pages/Groceries.md"}).json()["version"]
    r = a.c.put("/api/object/body", json={"path": "Pages/Groceries.md", "body": "Milk.\n", "baseVersion": version})
    assert r.status_code == 200
    assert a.count() == 0


# -- the removal ----------------------------------------------------------------------------


def _expected(before: bytes, line: bytes, stamp: str = STAMP, was: str = OLD) -> bytes:
    """``before`` without ``line`` (the heading and the blank line after it, in the file's own
    bytes) and with ``lastUpdated`` set, as a body save sets it; nothing else differs."""
    assert before.count(line) == 1
    out = before.replace(line, b"", 1)
    old = f"lastUpdated: '{was}'".encode()
    assert out.count(old) == 1
    return out.replace(old, f"lastUpdated: '{stamp}'".encode(), 1)


def test_the_removal_changes_one_line_and_the_stamp(root: Path, app) -> None:
    counted = _mixed(root)
    others = {p: s for p, s in _stamped(root).items() if os.path.relpath(p, root).replace(os.sep, "/") not in counted}
    a = app()
    assert a.remove() == 8
    lines = {
        "Pages/Groceries.md": b"# Groceries\n\n",
        "Pages/Windows.md": b"# Windows\r\n\r\n",
        "Pages/Marked.md": b"# Marked\n\n",
        "Pages/Both.md": b"# Both\r\n",  # no blank line under it; the blank line above stays
        "Pages/Twin.md": b"# Twin\n\n",
        "Projects/Twin.md": b"# Twin\n\n",
        "Tasks/Call.md": b"# Call: the bank\n\n",
        "Pages/Only.md": b"# Only\n",
    }
    for rel, before in counted.items():
        after = (root / rel).read_bytes()
        assert after == _expected(before, lines[rel]), rel
    assert (root / "Pages/Marked.md").read_bytes().startswith(b"\xef\xbb\xbf---\n")
    both = (root / "Pages/Both.md").read_bytes()
    assert both.startswith(b"\xef\xbb\xbf---\r\n") and b"\n" not in both.replace(b"\r\n", b"")  # still CRLF throughout
    assert both.endswith(b"---\r\n\r\nText.\r\n")
    # no other file of the space changed: not a byte, not a modification time
    now = _stamped(root)
    assert {p: s for p, s in now.items() if p in others} == others
    assert set(now) == set(others) | {str(root / rel) for rel in counted}  # and none was added
    assert a.count() == 0


def test_a_new_space_gets_only_its_id(tmp_path: Path, monkeypatch) -> None:
    """A space with no id yet gets one when the first version is kept, as with its first
    ordinary save: `.object/space.json` gains ``spaceId`` and nothing else in `.object` changes."""
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    new = create_space("Fresh", tmp_path)
    config = new / ".object" / "space.json"
    had = json.loads(config.read_text("utf-8"))
    assert "spaceId" not in had
    _put(new, "Pages/Groceries.md", _note("title: Groceries", "# Groceries\n\nMilk.\n", 1))
    before = _stamped(new / ".object")
    a = App(new)
    try:
        assert a.remove() == 1
    finally:
        a.close()
    now = json.loads(config.read_text("utf-8"))
    assert {k: v for k, v in now.items() if k != "spaceId"} == had and now["spaceId"]
    after = _stamped(new / ".object")
    assert {p for p in before.keys() | after.keys() if before.get(p) != after.get(p)} == {str(config)}


def test_the_removal_is_announced_so_open_windows_refresh(root: Path, app) -> None:
    counted = _mixed(root)
    a = app()
    assert a.remove() == 8
    changed = sorted((path, version) for kind, path, version, origin in a.events if kind == "changed" and origin is None)
    assert changed == sorted((rel, version_of((root / rel).read_bytes())) for rel in counted)
    assert {kind for kind, *_ in a.events} == {"changed"}
    # what the app answers for the note now is its new text and version
    got = a.c.get("/api/object", params={"path": "Pages/Groceries.md"}).json()
    assert got["body"] == "Milk.\n" and got["summary"]["lastUpdated"] == STAMP and got["summary"]["title"] == "Groceries"
    found = a.c.get("/api/search", params={"q": "Milk"})
    assert found.status_code == 200


def test_many_notes_are_announced_as_one_resync(root: Path, app) -> None:
    for n in range(titleheadings.RESYNC_AFTER + 1):
        _put(root, f"Pages/N{n}.md", _note(f"title: N{n}", f"# N{n}\n\nText {n}.\n", n))
    a = app()
    assert a.remove() == titleheadings.RESYNC_AFTER + 1
    assert [(kind, path) for kind, path, _v, _o in a.events] == [("types", "*")]


def test_it_is_idempotent(root: Path, app) -> None:
    _mixed(root)
    a = app()
    assert a.remove() == 8
    after = _stamped(root)
    a.events.clear()
    assert a.remove() == 0
    assert a.remove() == 0
    assert _stamped(root) == after and a.events == []


def test_history_keeps_the_earlier_text(root: Path, app) -> None:
    counted = _mixed(root)
    a = app()
    assert a.remove() == 8
    for rel, before in counted.items():
        versions = a.c.get("/api/history", params={"path": rel}).json()["versions"]
        assert len(versions) == 1, rel
        text = a.c.get("/api/history/version", params={"path": rel, "id": versions[0]["id"]}).json()["text"]
        assert text == before.removeprefix(b"\xef\xbb\xbf").decode("utf-8").replace("\r\n", "\n")
    # restoring the version brings the line back, byte for byte but the stamp of the restore
    rel = "Pages/Windows.md"
    version = a.c.get("/api/object", params={"path": rel}).json()["version"]
    vid = a.c.get("/api/history", params={"path": rel}).json()["versions"][0]["id"]
    r = a.c.post("/api/history/restore", json={"path": rel, "id": vid, "baseVersion": version})
    assert r.status_code == 200, r.text
    assert (root / rel).read_bytes().count(b"# Windows\r\n\r\nLine one.\r\nLine two.\r\n") == 1
    assert a.count() == 1


def test_history_keeps_it_also_right_after_another_save(root: Path, app) -> None:
    """An ordinary save keeps no version while the newest one is under five minutes old (a typing
    session is one version). The removal always keeps the text it changes."""
    rel = "Pages/Groceries.md"
    _put(root, rel, _note("title: Groceries", "# Groceries\n\nMilk.\n", 1))
    a = app()
    version = a.c.get("/api/object", params={"path": rel}).json()["version"]
    saved = a.c.put("/api/object/body", json={"path": rel, "body": "# Groceries\n\nMilk.\nEggs, typed a minute ago.\n", "baseVersion": version})
    assert saved.status_code == 200
    typed = (root / rel).read_bytes()
    a.space.clock = lambda: NOW + timedelta(minutes=1)
    assert a.remove() == 1
    versions = a.c.get("/api/history", params={"path": rel}).json()["versions"]
    assert len(versions) == 2
    newest = a.c.get("/api/history/version", params={"path": rel, "id": versions[0]["id"]}).json()["text"]
    assert newest == typed.decode("utf-8") and "Eggs, typed a minute ago." in newest
    assert (root / rel).read_bytes() == _expected(typed, b"# Groceries\n\n", "2026-11-12T09:31:00.000Z", was=STAMP)


def test_a_note_without_id_or_stamp_gets_them_as_a_body_save_gives_them(root: Path, app) -> None:
    rel = "Pages/Bare.md"
    _put(root, rel, "---\ntitle: Bare\n---\n# Bare\n\nText.\n")
    twin = "Pages/Bare twin.md"
    _put(root, twin, "---\ntitle: Bare twin\n---\n# Bare twin\n\nText.\n")
    a = app()
    # the ordinary body save, on the twin
    version = a.c.get("/api/object", params={"path": twin}).json()["version"]
    assert a.c.put("/api/object/body", json={"path": twin, "body": "Text.\n", "baseVersion": version}).status_code == 200
    assert a.remove() == 1
    lines = (root / rel).read_text("utf-8").split("\n")
    twin_lines = (root / twin).read_text("utf-8").split("\n")
    for got, title in ((lines, "Bare"), (twin_lines, "Bare twin")):
        assert got[0] == "---" and got[1].startswith("id: ") and len(got[1]) == len("id: ") + 26
        assert got[2:] == [f"title: {title}", f"lastUpdated: {STAMP}", "---", "Text.", ""]


def test_a_note_changed_on_disk_after_the_count_is_read_again(root: Path, app) -> None:
    kept = _put(root, "Pages/Kept.md", _note("title: Kept", "# Kept\n\nText.\n", 1))
    gone = _put(root, "Pages/Gone.md", _note("title: Gone", "# Gone\n\nText.\n", 2))
    grew = _put(root, "Pages/Grew.md", _note("title: Grew", "# Grew\n\nText.\n", 3))
    a = app()
    assert a.count() == 3
    # Outside the app, with the watcher off: the app's index still holds the old text.
    kept.write_bytes(_note("title: Kept", "My own first line now.\n\n# Kept\n\nText.\n", 1).encode())
    kept_bytes = kept.read_bytes()
    gone.unlink()
    grew.write_bytes(_note("title: Grew", "# Grew\n\nText.\nA line added in another editor.\n", 3).encode())
    grew_before = grew.read_bytes()
    assert a.remove() == 1
    assert kept.read_bytes() == kept_bytes  # it no longer begins with the heading: left as it is
    assert not gone.exists()
    assert grew.read_bytes() == _expected(grew_before, b"# Grew\n\n")  # the line added outside is kept
    # The two it left are still as the index last read them (it is the watcher that tells the
    # app and its windows of a change made outside, so the removal does not read them in quietly).
    assert titleheadings.paths(a.space) == ["Pages/Gone.md", "Pages/Kept.md"]
    for rel in ("Pages/Gone.md", "Pages/Kept.md"):
        a.space.rescan_file(rel)  # the watcher's part
    assert a.count() == 0


def test_a_write_that_lands_between_the_read_and_the_replace_is_not_overwritten(root: Path, app, monkeypatch) -> None:
    rel = "Pages/Racy.md"
    path = _put(root, rel, _note("title: Racy", "# Racy\n\nText.\n", 1))
    a = app()
    theirs = _note("title: Racy", "# Racy\n\nText.\nSaved by another program meanwhile.\n", 1).encode()
    real = titleheadings._keep_version
    calls: list[str] = []

    def keep(space, rel_, raw):
        if not calls:
            path.write_bytes(theirs)  # after the removal read the note, before it writes
        calls.append(rel_)
        return real(space, rel_, raw)

    monkeypatch.setattr(titleheadings, "_keep_version", keep)
    assert a.remove() == 1
    assert calls == [rel, rel]  # read again after the conflict
    assert path.read_bytes() == _expected(theirs, b"# Racy\n\n")
    texts = [a.c.get("/api/history/version", params={"path": rel, "id": v["id"]}).json()["text"]
             for v in a.c.get("/api/history", params={"path": rel}).json()["versions"]]
    assert texts[0] == theirs.decode()  # the text that was replaced is the newest version kept


def test_a_note_that_keeps_changing_is_left_for_the_next_time(root: Path, app, monkeypatch) -> None:
    rel = "Pages/Busy.md"
    path = _put(root, rel, _note("title: Busy", "# Busy\n\nText.\n", 1))
    a = app()
    n = [0]

    def keep(space, rel_, raw):
        n[0] += 1
        path.write_bytes(_note("title: Busy", f"# Busy\n\nText {n[0]}.\n", 1).encode())
        return True

    monkeypatch.setattr(titleheadings, "_keep_version", keep)
    assert a.remove() == 0
    assert path.read_bytes() == _note("title: Busy", "# Busy\n\nText 2.\n", 1).encode()


def test_a_note_whose_version_cannot_be_kept_is_not_changed(root: Path, app, monkeypatch) -> None:
    rel = "Pages/Groceries.md"
    path = _put(root, rel, _note("title: Groceries", "# Groceries\n\nMilk.\n", 1))
    before = _stamped(root)
    a = app()

    def broken(self, *args, **kwargs):
        raise RuntimeError("the version could not be made")

    monkeypatch.setattr("objectapp.history.HistoryStore.snapshot", broken)
    assert a.remove() == 0
    assert _stamped(root) == before and path.exists() and a.count() == 1 and a.events == []

    def refused(self, *args, **kwargs):
        raise PermissionError(13, "Permission denied")

    # the folder that holds the versions refuses the write: the answer of any refused write
    monkeypatch.setattr("objectapp.history.HistoryStore.snapshot", refused)
    r = a.c.post("/api/space/title-headings/remove")
    assert r.status_code == 503 and "Permission denied" in r.json()["detail"]
    assert _stamped(root) == before and a.count() == 1 and a.events == []


@pytest.mark.skipif(os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0), reason="needs a folder the user can't write")
def test_a_folder_that_refuses_writes_answers_as_any_write_does(root: Path, app) -> None:
    rel = "Pages/Groceries.md"
    path = _put(root, rel, _note("title: Groceries", "# Groceries\n\nMilk.\n", 1))
    before = path.read_bytes()
    a = app()
    version = a.c.get("/api/object", params={"path": rel}).json()["version"]
    os.chmod(path.parent, 0o555)
    try:
        usual = a.c.put("/api/object/body", json={"path": rel, "body": "x\n", "baseVersion": version})
        r = a.c.post("/api/space/title-headings/remove")
    finally:
        os.chmod(path.parent, 0o755)
    assert usual.status_code == 503
    assert r.status_code == 503 and r.json()["detail"] == usual.json()["detail"]
    assert path.read_bytes() == before


def test_a_refused_write_answers_as_any_write_does(root: Path, app, monkeypatch) -> None:
    """The same, where the test can't make a folder read-only (it runs as root here): the file
    system's refusal of the temporary file is the 503 every write answers with."""
    import objectapp.space as space_module

    rel = "Pages/Groceries.md"
    path = _put(root, rel, _note("title: Groceries", "# Groceries\n\nMilk.\n", 1))
    _put(root, "Pages/Second.md", _note("title: Second", "# Second\n\nText.\n", 2))
    before = _stamped(root)
    a = app()
    version = a.c.get("/api/object", params={"path": rel}).json()["version"]

    def refuse(*_args, **_kwargs):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(space_module, "_write_temp", refuse)
    usual = a.c.put("/api/object/body", json={"path": rel, "body": "x\n", "baseVersion": version})
    r = a.c.post("/api/space/title-headings/remove")
    assert usual.status_code == 503 and r.status_code == 503
    assert r.json() == usual.json()
    assert _stamped(root) == before and path.exists()
    assert a.events == []


def test_one_file_in_use_does_not_stop_the_others(root: Path, app, monkeypatch) -> None:
    import objectapp.space as space_module

    for n, name in enumerate(("Aa", "Bb", "Cc"), start=1):
        _put(root, f"Pages/{name}.md", _note(f"title: {name}", f"# {name}\n\nText.\n", n))
    locked = (root / "Pages/Bb.md").read_bytes()
    a = app()
    real = space_module._write_temp

    def temp(full, *args, **kwargs):
        if Path(full).name == "Bb.md":
            raise PermissionError(13, "Permission denied")
        return real(full, *args, **kwargs)

    monkeypatch.setattr(space_module, "_write_temp", temp)
    assert a.remove() == 2
    assert (root / "Pages/Bb.md").read_bytes() == locked
    assert a.count() == 1  # it is still there for the next time
    monkeypatch.setattr(space_module, "_write_temp", real)
    assert a.remove() == 1 and a.count() == 0


def test_automations_are_not_run_by_it(root: Path, app) -> None:
    """A body save tells the automations nothing (only a front matter change does); nor does this."""
    _put(root, "Pages/Groceries.md", _note("title: Groceries", "# Groceries\n\nMilk.\n", 1))
    a = app()
    seen: list[object] = []
    real = a.space.after_write
    a.space.after_write = lambda notice: (seen.append(notice), real(notice) if real else None)[1]
    assert a.remove() == 1
    assert seen == []


def test_the_routes_take_no_other_method(root: Path, app) -> None:
    a = app()
    assert a.c.post("/api/space/title-headings").status_code == 405
    assert a.c.get("/api/space/title-headings/remove").status_code == 405
