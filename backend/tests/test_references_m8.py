"""M8 Task 18: backlink contexts carry ``ancestors`` (the parents' first lines, outermost first)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.references import backlink_entries
from objectapp.server import create_app
from objectapp.space import Space

ADA = "People/Ada Lovelace.md"

NESTED = """---
type: page
title: Nested links
---

<!-- toggle open -->
### Project **notes**
- Phase one
  - Ask [[Charles Babbage]] first
    - Then [[Ada Lovelace]] about the engine
<!-- /toggle -->

<!-- indent -->
Parent paragraph line
Second line of the parent
<!-- block: small -->
Child mentions [[Ada Lovelace|the countess]].
<!-- /indent -->

```
<!-- toggle -->
not a container
```

- Top item

  A second paragraph of the item names [[Ada Lovelace]]
"""

TOP = """---
type: page
title: Top level links
---

A paragraph naming [[Ada Lovelace]].

- A top-level item with [[Ada Lovelace]]

<!-- toggle -->
Toggle title mentions [[Ada Lovelace]]
Inside the toggle
<!-- /toggle -->

<!-- group color=bg-gray -->
Grouped [[Ada Lovelace]] line
<!-- /group -->
"""

CRLF = (
    "---\r\ntype: page\r\ntitle: CRLF nested\r\n---\r\n\r\n"
    "- Outer item\r\n  - Inner [[Ada Lovelace]]\r\n"
)


def _write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(text.encode("utf-8"))


def _contexts(space: Space, src: str) -> list[dict]:
    for entry in backlink_entries(space, ADA):
        if entry["path"] == src:
            return entry["contexts"]
    raise AssertionError(f"{src} does not link to {ADA}")


def test_backlink_context_ancestors(links_space_dir: Path) -> None:
    _write(links_space_dir, "Pages/Nested links.md", NESTED)
    _write(links_space_dir, "Pages/CRLF nested.md", CRLF)
    space = Space(links_space_dir)
    ctxs = _contexts(space, "Pages/Nested links.md")
    assert len(ctxs) == 3
    toggle, indent, lazy = ctxs
    assert toggle["context"] == "Then Ada Lovelace about the engine"
    assert toggle["ancestors"] == [
        "Project notes",
        "Phase one",
        "Ask Charles Babbage first",
    ]
    # An indent parent: its first line only; the block-options comment is no block.
    assert indent["ancestors"] == ["Parent paragraph line"]
    # A later paragraph of a list item is its child.
    assert lazy["ancestors"] == ["Top item"]
    crlf = _contexts(space, "Pages/CRLF nested.md")
    assert crlf[0]["ancestors"] == ["Outer item"]


def test_ancestors_absent_at_top_level(links_space_dir: Path) -> None:
    _write(links_space_dir, "Pages/Top level links.md", TOP)
    space = Space(links_space_dir)
    ctxs = _contexts(space, "Pages/Top level links.md")
    assert len(ctxs) == 4
    # Paragraph, top-level item, a toggle's own title, a group (no parent block).
    for ctx in ctxs:
        assert "ancestors" not in ctx, ctx


def test_references_route_passes_ancestors(links_space_dir: Path) -> None:
    _write(links_space_dir, "Pages/Nested links.md", NESTED)
    before = {p: p.read_bytes() for p in links_space_dir.rglob("*.md")}
    with TestClient(create_app(Space(links_space_dir))) as client:
        res = client.get("/api/references", params={"path": ADA})
    assert res.status_code == 200
    entry = next(e for e in res.json()["backlinks"] if e["path"] == "Pages/Nested links.md")
    assert entry["contexts"][0]["ancestors"][0] == "Project notes"
    assert {p: p.read_bytes() for p in links_space_dir.rglob("*.md")} == before
