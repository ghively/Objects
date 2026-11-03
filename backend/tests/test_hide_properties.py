"""Polish item 17: the per-object ``hideProperties`` flag (Object's ``ComponentData.hideProperties``).

The object page's and peek's property-pane toggle saves it like the M9 layout keys: a bool,
``null`` removes the key, it is never inferred as a property and never a new property's key.
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.typedefs import SYSTEM_KEYS


def _client(root: Path):
    space = Space(root)
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    return space, TestClient(app)


def _put(c: TestClient, space: Space, path: str, updates: dict):
    return c.put(
        "/api/object/properties",
        json={"path": path, "updates": updates, "remove": [], "baseVersion": space.cached_version(path)},
    )


def test_hide_properties_round_trips_and_null_removes(space_dir: Path):
    page = space_dir / "Pages" / "Pane.md"
    page.write_bytes(b"---\r\nid: 01JBPANE000000000000000001\r\ntype: 'Page'\r\ntitle: Pane\r\n---\r\nBody.\r\n")
    space, c = _client(space_dir)
    with c:
        assert _put(c, space, "Pages/Pane.md", {"hideProperties": "yes"}).status_code == 422
        r = _put(c, space, "Pages/Pane.md", {"hideProperties": True})
        assert r.status_code == 200, r.text
        assert r.json()["frontmatter"]["hideProperties"] is True
        assert b"\r\nhideProperties: true\r\n" in page.read_bytes()
        r = _put(c, space, "Pages/Pane.md", {"hideProperties": None})
        assert r.status_code == 200, r.text
        assert "hideProperties" not in r.json()["frontmatter"]
    assert b"hideProperties" not in page.read_bytes()
    assert page.read_bytes().endswith(b"---\r\nBody.\r\n")


def test_hide_properties_not_inferred_as_a_property(tmp_path: Path):
    root = tmp_path / "space"
    (root / "Gadgets").mkdir(parents=True)
    (root / "Gadgets" / "One.md").write_text(
        "---\ntype: 'Gadget'\ntitle: One\nhideProperties: true\nweight: 3\n---\n", "utf-8"
    )
    t = Space(root).type_by_id("gadget")
    assert t is not None
    keys = {p.key for p in t.propertyDefinitions}
    assert "weight" in keys and "hideProperties" not in keys
    assert "hideProperties" in SYSTEM_KEYS
