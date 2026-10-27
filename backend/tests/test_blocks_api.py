"""M8 Task 27: the block routes, block ids out of previews and search, rename keeps ``#^id``."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.api_blocks import block_markdown, block_reference_ids
from objectapp.rows import body_preview
from objectapp.searchtext import plain_body
from objectapp.server import create_app
from objectapp.space import Space

SOURCE = "Pages/Source note.md"
BLOCKS = "Pages/Blocks M8.md"
CRLF = "Pages/CRLF M8.md"


def _digest(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha1(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


@pytest.fixture
def space(m8_space_dir: Path) -> Space:
    return Space(m8_space_dir)


@pytest.fixture
def client(space: Space):
    with TestClient(create_app(space, watch=False)) as c:
        yield c


def test_block_route_returns_markdown(client: TestClient, space: Space):
    before = _digest(space.root)
    r = client.get("/api/block", params={"path": SOURCE, "id": "ab12cd"})
    assert r.status_code == 200
    data = r.json()
    assert data["path"] == SOURCE
    assert data["id"] == "ab12cd"
    assert data["markdown"] == "The referenced block lives here. ^ab12cd"
    assert data["version"] == space.read(SOURCE)[2]
    item = client.get("/api/block", params={"path": SOURCE, "id": "zz9zz9"}).json()
    assert item["markdown"] == "- A list item with its own id ^zz9zz9"
    crlf = client.get("/api/block", params={"path": CRLF, "id": "cr1f00"}).json()
    assert crlf["markdown"] == "A CRLF block with an id. ^cr1f00"
    assert _digest(space.root) == before  # reads write nothing


def test_block_route_404s(client: TestClient):
    assert client.get("/api/block", params={"path": SOURCE, "id": "nope00"}).status_code == 404
    assert client.get("/api/block", params={"path": "Pages/Missing.md", "id": "ab12cd"}).status_code == 404
    assert client.get("/api/block/references", params={"path": "Pages/Missing.md", "id": "ab12cd"}).status_code == 404
    assert client.get("/api/block", params={"path": "../outside.md", "id": "ab12cd"}).status_code in (400, 404)


def test_block_markdown_shapes():
    body = (
        "# Title ^aaaaaa\n\nFirst line\nsecond line ^bbbbbb\n\n"
        "> quoted\n> more ^cccccc\n\n- item ^dddddd\n  - child\n- next\n\n"
        "```\ncode ^eeeeee\n```\n"
    )
    assert block_markdown(body, "aaaaaa") == "# Title ^aaaaaa"
    assert block_markdown(body, "bbbbbb") == "First line\nsecond line ^bbbbbb"
    assert block_markdown(body, "cccccc") == "> quoted\n> more ^cccccc"
    assert block_markdown(body, "dddddd") == "- item ^dddddd\n  - child"
    assert block_markdown(body, "eeeeee") is None  # code is not searched
    assert block_reference_ids("![[A#^abc123]] and [[B#^xyz789|x]] `[[C#^ccc000]]` [[D#head]]") == [
        ("A", "abc123"),
        ("B", "xyz789"),
    ]


def test_block_references_lists_referrers(client: TestClient, space: Space):
    r = client.get("/api/block/references", params={"path": SOURCE, "id": "ab12cd"})
    assert r.status_code == 200
    assert r.json() == {"paths": [BLOCKS]}
    other = client.get("/api/block/references", params={"path": SOURCE, "id": "zz9zz9"})
    assert other.json() == {"paths": []}
    # An object referencing its own block counts.
    (space.root / "Pages" / "Self ref.md").write_text(
        "---\ntype: 'Page'\ntitle: Self ref\n---\n\nMine. ^self01\n\n![[Self ref#^self01]]\n",
        encoding="utf-8",
    )
    space.rescan_file("Pages/Self ref.md")
    mine = client.get("/api/block/references", params={"path": "Pages/Self ref.md", "id": "self01"})
    assert mine.json() == {"paths": ["Pages/Self ref.md"]}


def test_preview_and_search_drop_block_ids():
    body = "A paragraph with a block id. ^ab12cd\n\n- An item ^zz9zz9\n\n```\nkeep ^cod123\n```\n"
    assert "^ab12cd" not in body_preview(body)
    assert "^zz9zz9" not in body_preview(body)
    assert body_preview(body).startswith("A paragraph with a block id. An item")
    text = plain_body(body)
    assert "^ab12cd" not in text and "^zz9zz9" not in text
    assert "A paragraph with a block id." in text.splitlines()
    assert "keep ^cod123" in text  # code keeps its text
    # Not an id: a caret mid-line, or a different length.
    assert "x^2 here" in plain_body("x^2 here")
    assert "^abc" in plain_body("short ^abc")


def test_rename_keeps_block_reference_suffix(space: Space):
    """Regression guard (green from the start): relinking keeps ``#^id``."""
    version = space.read(SOURCE)[2]
    space.rename_object(SOURCE, "Origin note", version)
    text = (space.root / BLOCKS).read_text(encoding="utf-8")
    assert "![[Origin note#^ab12cd]]" in text
    assert "Source note#^" not in text
