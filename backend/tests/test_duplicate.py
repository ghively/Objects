"""M9 Task 2: duplicate an object (``POST /api/object/duplicate``).

Object's "Duplicate" (``EntityMenu.duplicateObject``) names the copy
``<Title> (Copy)`` (``general.copy.noun``). The copy is the source's bytes except
for a new ``id``, the ``title``, fresh ``createdAt``/``lastUpdated`` and a first
``# <Title>`` heading; it goes in the same folder under a free name.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space
from wb_support import copy_whiteboard_space

NOW = datetime(2026, 10, 28, 12, 30, 0, tzinfo=UTC)
STAMP = "2026-10-28T12:30:00.000Z"


def _client(root: Path):
    space = Space(root)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    return space, TestClient(app), published


def _tree(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _dup(c: TestClient, path: str, client_id: str | None = None):
    body: dict = {"path": path}
    if client_id:
        body["clientId"] = client_id
    return c.post("/api/object/duplicate", json=body)


def _lines(data: bytes) -> list[bytes]:
    return data.splitlines(keepends=True)


def test_duplicate_copies_bytes_except_id_title_stamps(space_dir: Path):
    space, c, _pub = _client(space_dir)
    src = space_dir / "Tasks" / "Write docs.md"
    original = src.read_bytes()
    with c:
        r = _dup(c, "Tasks/Write docs.md")
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["path"] == "Tasks/Write docs (Copy).md"
    data = (space_dir / out["path"]).read_bytes()
    assert out["version"] == hashlib.sha256(data).hexdigest()
    assert out["summary"]["title"] == "Write docs (Copy)"
    assert out["summary"]["path"] == out["path"]
    assert out["summary"]["type"] == "task"
    assert src.read_bytes() == original

    old, new = _lines(original), _lines(data)
    # The new id goes first (the source had none); every other line keeps its place.
    assert new[1].startswith(b"id: ") and len(new[1].strip()) == len(b"id: ") + 26
    assert new[0] == old[0] and new[2:] == [
        b"type: 'Task'\n",
        b"title: Write docs (Copy)\n",
        b"icon: ph-pencil\n",
        f"createdAt: {STAMP}\n".encode(),
        f"lastUpdated: {STAMP}\n".encode(),
        b"tags: [Docs]\n",
        b"status: Not Started\n",
        b"description: null\n",
        b"---\n",
        b"\n",
        b"Write the user guide. See [[Ada Lovelace]].\n",
    ]
    assert out["summary"]["id"] == new[1].split(b": ")[1].strip().decode()


def test_duplicate_replaces_existing_id_and_heading(space_dir: Path):
    page = space_dir / "Pages" / "Heading page.md"
    page.write_bytes(
        b"---\nid: 01JBDUPLICATESOURCE0000001\ntype: 'Page'\ntitle: Heading page\n"
        b"createdAt: 2026-01-01T00:00:00.000Z\nlastUpdated: 2026-01-02T00:00:00.000Z\n"
        b"custom: kept\n---\n# Heading page\n\nBody with # Heading page inside.\n"
    )
    space, c, _pub = _client(space_dir)
    with c:
        r = _dup(c, "Pages/Heading page.md")
    assert r.status_code == 201, r.text
    data = (space_dir / r.json()["path"]).read_bytes()
    assert b"01JBDUPLICATESOURCE0000001" not in data
    text = data.decode()
    assert text.startswith("---\nid: ")
    assert "\ntype: 'Page'\ntitle: Heading page (Copy)\n" in text
    assert f"createdAt: {STAMP}\nlastUpdated: {STAMP}\ncustom: kept\n---\n" in text
    assert text.endswith("---\n# Heading page (Copy)\n\nBody with # Heading page inside.\n")
    assert space.get(r.json()["path"]).id != "01JBDUPLICATESOURCE0000001"


def test_duplicate_keeps_crlf_bom(space_dir: Path):
    page = space_dir / "Pages" / "Windows.md"
    page.write_bytes(
        b"\xef\xbb\xbf---\r\nid: 01JBDUPLICATECRLF000000001\r\ntype: 'Page'\r\n"
        b"title: Windows\r\ncreatedAt: 2026-01-01T00:00:00.000Z\r\n"
        b"lastUpdated: 2026-01-01T00:00:00.000Z\r\n---\r\n# Windows\r\n\r\nLine.\r\n"
    )
    _space, c, _pub = _client(space_dir)
    with c:
        r = _dup(c, "Pages/Windows.md")
    assert r.status_code == 201, r.text
    data = (space_dir / r.json()["path"]).read_bytes()
    assert data.startswith(b"\xef\xbb\xbf---\r\nid: ")
    assert b"\n" not in data.replace(b"\r\n", b"")
    assert data.endswith(b"---\r\n# Windows (Copy)\r\n\r\nLine.\r\n")
    assert b"title: Windows (Copy)\r\n" in data


def test_duplicate_unique_name_when_copy_exists(space_dir: Path):
    (space_dir / "Pages" / "Alpha (Copy).md").write_bytes(b"---\ntype: 'Page'\n---\nTaken.\n")
    _space, c, _pub = _client(space_dir)
    with c:
        first = _dup(c, "Pages/Alpha.md")
        second = _dup(c, "Pages/Alpha.md")
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["path"] == "Pages/Alpha (Copy) (2).md"
    assert second.json()["path"] == "Pages/Alpha (Copy) (3).md"
    assert (space_dir / "Pages" / "Alpha (Copy).md").read_bytes() == (
        b"---\ntype: 'Page'\n---\nTaken.\n"
    )
    assert first.json()["summary"]["title"] == "Alpha (Copy)"


def test_duplicate_refuses_daily_note_template_whiteboard_422(full_space_dir: Path, tmp_path: Path):
    _space, c, _pub = _client(full_space_dir)
    before = _tree(full_space_dir)
    with c:
        for path in (
            "DailyNotes/2026-10-23.md",
            "Templates/Tasks/Bug report.md",
            "Pages/Bad yaml.md",
        ):
            r = _dup(c, path)
            assert r.status_code == 422, (path, r.text)
            assert r.json()["detail"] == "This object can't be duplicated."
        assert _dup(c, "Pages/Nope.md").status_code == 404
        assert _dup(c, "../outside.md").status_code == 400
    assert _tree(full_space_dir) == before

    wb_root = copy_whiteboard_space(tmp_path)
    _wspace, wc, _wpub = _client(wb_root)
    wb_before = _tree(wb_root)
    with wc:
        r = _dup(wc, "Whiteboards/Network map.md")
    assert r.status_code == 422
    assert r.json()["detail"] == "This object can't be duplicated."
    assert _tree(wb_root) == wb_before


def test_duplicate_changes_no_other_file(full_space_dir: Path):
    _space, c, _pub = _client(full_space_dir)
    before = _tree(full_space_dir)
    with c:
        r = _dup(c, "Pages/Notes.md")
    assert r.status_code == 201, r.text
    after = _tree(full_space_dir)
    assert set(after) - set(before) == {r.json()["path"]}
    assert {k: v for k, v in after.items() if k in before} == before
    # A file without frontmatter gets one; its first heading names the copy.
    text = (full_space_dir / r.json()["path"]).read_text("utf-8")
    assert r.json()["path"] == "Pages/Meeting notes (Copy).md"
    assert text.endswith("---\n# Meeting notes (Copy)\n\nNo frontmatter here. Mentions [[Alpha]].\n")
    assert "title: Meeting notes (Copy)\n" in text


def test_duplicate_announces_created(space_dir: Path):
    _space, c, published = _client(space_dir)
    with c:
        r = _dup(c, "Pages/Alpha.md", client_id="w1")
    assert r.status_code == 201
    out = r.json()
    assert [(e.kind, e.path, e.version, e.origin) for e in published] == [
        ("created", out["path"], out["version"], "w1")
    ]
