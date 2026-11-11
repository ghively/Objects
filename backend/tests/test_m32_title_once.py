"""M32 (integrate): a note's title is in one place.

`Space.create_object` used to give a titled object the body ``# <title>``. The app shows the
title above the body, so every note made with a title (from ``[[``, ``@``, the palette, a line
turned into a task, a CSV import, an agent's ``create_object``) showed its title twice, and a
type whose default template had an empty body got the heading too. The body of a new object is
now empty unless a template or the caller gives it text; the title is in the front matter.

Notes that already open with ``# <title>`` are not rewritten, and a rename still keeps that
line in step with the title.
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space


def _body(root: Path, rel: str) -> str:
    return split_object((root / rel).read_text(encoding="utf-8")).body


def _fm(root: Path, rel: str) -> dict:
    return parse_fm(split_object((root / rel).read_text(encoding="utf-8")).frontmatter_src or "")


def _default_template(space: Space, type_id: str, body: str) -> str:
    """A template of the type with ``body``, made the type's default; its path."""
    path, _version = space.create_template(type_id, "Plain", body=body, default=True)
    assert space.type_by_id(type_id).templates["defaultTemplateId"] == _fm(space.root, path)["id"]
    return path


def test_a_titled_note_has_its_title_in_the_front_matter_only(tmp_path: Path):
    root = create_space("Notes", tmp_path)
    space = Space(root)
    for type_id, title in (("page", "Groceries"), ("task", "Call the bank")):
        path, _version = space.create_object(type_id, title)
        assert _fm(root, path)["title"] == title
        assert _body(root, path) == ""
    # The title still names the note everywhere it is read.
    assert space.resolve("Groceries", None) == "Pages/Groceries.md"
    assert space.get("Pages/Groceries.md").title == "Groceries"


def test_new_note_then_a_title_typed_leaves_the_body_empty(tmp_path: Path):
    """"New note" makes an untitled note; typing its title is a rename."""
    root = create_space("Notes", tmp_path)
    with TestClient(create_app(Space(root), None, watch=False)) as c:
        made = c.post("/api/objects", json={"typeId": "page"})
        assert made.status_code == 201, made.text
        assert _body(root, made.json()["path"]) == ""
        renamed = c.post("/api/object/rename", json={
            "path": made.json()["path"], "title": "Groceries", "baseVersion": made.json()["version"],
        })
        assert renamed.status_code == 200, renamed.text
        path = renamed.json()["path"]
        assert path == "Pages/Groceries.md"
        assert _fm(root, path)["title"] == "Groceries" and _body(root, path) == ""


def test_the_apps_titled_creates_write_no_heading(tmp_path: Path):
    """What ``[[``, the palette's create row, quick add and "Make this line a task" send."""
    root = create_space("Notes", tmp_path)
    with TestClient(create_app(Space(root), None, watch=False)) as c:

        def create(**req) -> str:
            res = c.post("/api/objects", json=req)
            assert res.status_code == 201, res.text
            return res.json()["path"]

        assert _body(root, create(typeId="page", title="New thing")) == ""
        assert _body(root, create(typeId="task", title="Buy milk", body="")) == ""
        # A line turned into a task: its children are the body, with nothing above them.
        assert _body(root, create(typeId="task", title="Pack", appendBody="- socks")) == "- socks\n"
        # A body the caller sends is kept as sent, a heading of its own included.
        sent = create(typeId="page", title="Pasted", templateId="none", body="# Pasted\n\nText.\n")
        assert _body(root, sent) == "# Pasted\n\nText.\n"


def test_a_default_template_with_an_empty_body_gives_an_empty_body(tmp_path: Path):
    root = create_space("Notes", tmp_path)
    space = Space(root)
    _default_template(space, "page", "")
    path, _version = space.create_object("page", "From a plain template")
    assert _body(root, path) == ""
    assert "template" not in _fm(root, path)


def test_a_default_template_with_text_gives_that_text(tmp_path: Path):
    root = create_space("Notes", tmp_path)
    space = Space(root)
    _default_template(space, "page", "## Agenda\n\n- \n")
    path, _version = space.create_object("page", "Weekly")
    assert _body(root, path) == "## Agenda\n\n- \n"
    # append_body goes below the template's text (after one blank line).
    path, _version = space.create_object("page", "Weekly two", append_body="Notes from the call.")
    assert _body(root, path) == "## Agenda\n\n-\n\nNotes from the call.\n"


def test_the_api_route_an_agent_uses_writes_no_heading(tmp_path: Path):
    """``POST /api/v1/objects`` (MCP ``create_object`` and ``create_task``): the same fault,
    so the same answer. The body is what the caller sent, or empty."""
    root = create_space("Notes", tmp_path)
    with TestClient(create_app(Space(root), None, watch=False)) as c:
        token = c.post("/api/integrations/tokens", json={"name": "agent", "scope": "read-write"})
        assert token.status_code == 201, token.text
        hdr = {"Authorization": f"Bearer {token.json()['secret']}"}
        bare = c.post("/api/v1/objects", headers=hdr, json={"type": "Page", "title": "From an agent"})
        assert bare.status_code == 201, bare.text
        assert _body(root, bare.json()["path"]) == ""
        with_body = c.post("/api/v1/objects", headers=hdr, json={
            "type": "Page", "title": "With text", "body": "## Ideas\n\n- one\n"})
        assert with_body.status_code == 201, with_body.text
        assert _body(root, with_body.json()["path"]) == "## Ideas\n\n- one\n"


def test_a_note_that_already_has_the_heading_keeps_it_and_a_rename_follows(tmp_path: Path):
    root = create_space("Notes", tmp_path)
    (root / "Pages").mkdir()
    old = root / "Pages" / "Older.md"
    old.write_text(
        "---\nid: 01JC0000000000000000000001\ntype: 'Page'\ntitle: Older\n---\n# Older\n\nText.\n",
        encoding="utf-8", newline="\n",
    )
    before = old.read_bytes()
    space = Space(root)
    assert space.get("Pages/Older.md").title == "Older"
    assert old.read_bytes() == before  # opening rewrites nothing
    _of, _fm_now, version = space.read("Pages/Older.md")
    result = space.rename_object("Pages/Older.md", "Newer", version)
    assert result.path == "Pages/Newer.md"
    assert _body(root, result.path) == "# Newer\n\nText.\n"
