"""M32 fix pass, findings 7 and 8: the starter sets added from the type gallery.

7. ``POST /api/space/setup`` ``basic`` when a starter type's file is on disk but not loaded (put
   there by a sync or by hand since the space was opened): that type is left out, as the IT
   operations set already leaves it out, the rest of the set is written and so is the marker; no
   unhandled exception.
8. A repeated starter set writes nothing at all: ``space.json`` is not written again when its
   marker and Work switch are already as wanted (same bytes, same modification time, same file).
Synthetic data only.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space


def snap(root: Path) -> dict[str, tuple[str, int, int, int]]:
    """Every file with its hash, size, modification time and inode."""
    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file() and ".object-cache" not in p.relative_to(root).parts:
            st = p.stat()
            out[p.relative_to(root).as_posix()] = (
                hashlib.sha256(p.read_bytes()).hexdigest(), st.st_size, st.st_mtime_ns, st.st_ino,
            )
    return out


def diff(a: dict, b: dict) -> list[str]:
    return sorted(k for k in a.keys() | b.keys() if a.get(k) != b.get(k))


@pytest.fixture
def app(tmp_path: Path):
    root = create_space("Mine", tmp_path)
    space = Space(root)
    with TestClient(
        create_app(space, None, watch=False), base_url="http://127.0.0.1", client=("127.0.0.1", 50000)
    ) as c:
        c.root = root  # type: ignore[attr-defined]
        c.space = space  # type: ignore[attr-defined]
        yield c


def _old(root: Path) -> None:
    """Age every file, so a rewrite with the same bytes would still show in its date."""
    for p in root.rglob("*"):
        if p.is_file():
            os.utime(p, ns=(1_700_000_000_000_000_000, 1_700_000_000_000_000_000))


def test_basic_skips_a_starter_type_whose_file_is_on_disk_but_not_loaded(app):
    root = app.root
    meeting = root / ".object" / "types" / "meeting.json"
    meeting.write_text(
        json.dumps({"schemaVersion": 2, "id": "meeting", "name": "Meeting", "pluralName": "Meetings",
                    "folder": "Meetings", "propertyDefinitions": []}),
        "utf-8",
    )
    held = meeting.read_bytes()
    before = snap(root)
    r = app.post("/api/space/setup", json={"setup": "basic"})
    assert r.status_code == 200, r.text
    assert meeting.read_bytes() == held  # never replaced
    assert diff(before, snap(root)) == [
        ".object/space.json", ".object/types/book.json", ".object/types/person.json",
        ".object/types/project.json",
    ]
    assert json.loads((root / ".object/space.json").read_text("utf-8"))["setup"] == "basic"
    ids = {t["id"] for t in r.json()["types"]}
    assert {"book", "person", "project"} <= ids
    assert app.get("/api/space").status_code == 200
    # a new open lists the four, the file that was there among them
    assert {"book", "meeting", "person", "project"} <= {t.id for t in Space(root).types}


def test_a_repeated_basic_set_writes_nothing(app):
    root = app.root
    assert app.post("/api/space/setup", json={"setup": "basic"}).status_code == 200
    _old(root)
    before = snap(root)
    r = app.post("/api/space/setup", json={"setup": "basic"})
    assert r.status_code == 200
    assert diff(before, snap(root)) == []  # space.json too: bytes, date and file


def test_a_repeated_it_operations_set_writes_nothing(app):
    root = app.root
    assert app.post("/api/space/setup", json={"setup": "basic"}).status_code == 200
    assert app.post("/api/space/setup", json={"setup": "itops"}).status_code == 200
    config = json.loads((root / ".object/space.json").read_text("utf-8"))
    assert config["setup"] == "itops" and config["workEnabled"] is True
    _old(root)
    before = snap(root)
    assert app.post("/api/space/setup", json={"setup": "itops"}).status_code == 200
    assert diff(before, snap(root)) == []
    # a later basic set keeps the itops marker and writes nothing either
    assert app.post("/api/space/setup", json={"setup": "basic"}).status_code == 200
    assert diff(before, snap(root)) == []


def test_the_it_set_after_the_user_set_the_switch_off_is_stable_too(app):
    root = app.root
    rev = app.get("/api/space").json()["revision"]
    app.put("/api/space", json={"patch": {"workEnabled": False}, "baseRevision": rev})
    r = app.post("/api/space/setup", json={"setup": "itops"})
    assert r.status_code == 200 and r.json()["workOn"] is False
    _old(root)
    before = snap(root)
    assert app.post("/api/space/setup", json={"setup": "itops"}).status_code == 200
    assert diff(before, snap(root)) == []
    assert json.loads((root / ".object/space.json").read_text("utf-8"))["workEnabled"] is False


def test_the_first_set_still_writes_its_marker(app):
    root = app.root
    before = json.loads((root / ".object/space.json").read_text("utf-8"))
    assert before["setup"] == "blank"
    app.post("/api/space/setup", json={"setup": "basic"})
    assert json.loads((root / ".object/space.json").read_text("utf-8"))["setup"] == "basic"
    app.post("/api/space/setup", json={"setup": "itops"})
    after = json.loads((root / ".object/space.json").read_text("utf-8"))
    assert after["setup"] == "itops" and after["workEnabled"] is True
