"""M32 fix pass, finding 10: a refused daily note writes nothing.

In an older space the built-in DailyNote (and Task) type is in memory only; its file is written
with the type's first note. It used to be written before the note was placed, so a daily note
refused because another kind of file holds ``DailyNotes/<day>.md`` (409) still left
``dailynote.json`` behind. The type is now written only once its note is. Synthetic data only.
"""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space

FIXTURES = Path(__file__).parent / "fixtures"
DAY = "2026-11-11"


def snap(root: Path) -> dict[str, tuple[str, int, int]]:
    out: dict[str, tuple[str, int, int]] = {}
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root)
        if ".object-cache" in rel.parts:
            continue
        if p.is_file():
            st = p.stat()
            out[rel.as_posix()] = (hashlib.sha256(p.read_bytes()).hexdigest(), st.st_size, st.st_mtime_ns)
        else:
            out[rel.as_posix() + "/"] = ("dir", 0, 0)
    return out


@pytest.fixture
def older(tmp_path: Path) -> Path:
    """A space from before M32: no Task and no DailyNote type file."""
    root = tmp_path / "older"
    shutil.copytree(FIXTURES / "space-blocks", root, ignore=shutil.ignore_patterns(".object-cache"))
    assert not (root / ".object/types/dailynote.json").exists()
    assert not (root / ".object/types/task.json").exists()
    return root


def _client(root: Path) -> TestClient:
    return TestClient(
        create_app(Space(root), None, watch=False), base_url="http://127.0.0.1", client=("127.0.0.1", 50000)
    )


@pytest.mark.parametrize(
    "text",
    ["---\ntype: 'Page'\ntitle: 'squatter'\n---\nhello\n", "just text, no front matter\n"],
)
def test_a_refused_daily_note_leaves_the_folder_as_it_was(older: Path, text: str):
    (older / "DailyNotes").mkdir()
    (older / "DailyNotes" / f"{DAY}.md").write_text(text, "utf-8", newline="\n")
    with _client(older) as c:
        before = snap(older)
        r = c.post("/api/daily-notes", json={"date": DAY})
        assert r.status_code == 409 and r.json().get("reason") == "nameTaken", r.text
        assert snap(older) == before  # no dailynote.json, nothing else
        # the day beside it is still made, and that is when the type is written
        r = c.post("/api/daily-notes", json={"date": "2026-11-12"})
        assert r.status_code == 201 and r.json()["typeIds"] == ["dailynote"], r.text
        after = snap(older)
        assert sorted(k for k in after.keys() | before.keys() if after.get(k) != before.get(k)) == [
            ".object/types/dailynote.json", "DailyNotes/2026-11-12.md",
        ]


def test_the_first_daily_note_still_writes_its_type(older: Path):
    with _client(older) as c:
        before = snap(older)
        r = c.post("/api/daily-notes", json={"date": DAY})
        assert r.status_code == 201 and r.json()["typeIds"] == ["dailynote"], r.text
        after = snap(older)
        assert sorted(k for k in after if after.get(k) != before.get(k)) == [
            ".object/types/dailynote.json", "DailyNotes/", f"DailyNotes/{DAY}.md",
        ]


def test_a_first_task_that_cannot_be_placed_writes_no_type(older: Path):
    """The same order for the first task: with something that is not a folder where its folder
    should be, the create fails and ``task.json`` is not left behind."""
    (older / "Tasks").write_text("not a folder\n", "utf-8")
    sp = Space(older)
    before = snap(older)
    with pytest.raises(OSError):
        sp.create_object("task", "Buy milk")
    assert snap(older) == before


def test_the_first_task_still_writes_its_type(older: Path):
    with _client(older) as c:
        before = snap(older)
        r = c.post("/api/objects", json={"typeId": "task", "title": "Buy milk"})
        assert r.status_code == 201 and r.json()["typeIds"] == ["task"], r.text
        after = snap(older)
        assert sorted(k for k in after if after.get(k) != before.get(k)) == [
            ".object/types/task.json", "Tasks/", "Tasks/Buy milk.md",
        ]
