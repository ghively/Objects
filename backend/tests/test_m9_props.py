"""M9 Task 4: template date variables, per-object layout keys and ``workspaceOrder``.

- ``{creation:day|week|month|year}`` on a ``datetime`` property (Capacities'
  ``DatetimeProperty.variable``, "Set only on templates") is accepted only on a template.
- ``wideLayoutMode`` / ``wideCoverImage`` (bool) and ``coverImageOffset`` (0-100) are
  per-object frontmatter keys (``ComponentData``); ``null`` removes the key, and a new
  ``coverImage`` drops the offset in the same write (``RenderCoverImage``).
- ``PUT /api/ui`` takes ``workspaceOrder`` (``RootSpace.workspaceOrder``).
"""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.typemodel import PropertyDefinition, type_revision

NOW = datetime(2026, 10, 28, 12, 30, 0, tzinfo=UTC)
STAMP = "2026-10-28T12:30:00.000Z"


def _client(root: Path):
    space = Space(root)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    return space, TestClient(app)


def _put(c: TestClient, space: Space, path: str, updates: dict, remove: list | None = None):
    return c.put(
        "/api/object/properties",
        json={
            "path": path,
            "updates": updates,
            "remove": remove or [],
            "baseVersion": space.cached_version(path),
        },
    )


def _meeting(space: Space) -> None:
    space.create_type("Meeting", "Meetings")
    t = copy.deepcopy(space.type_by_id("meeting"))
    t.propertyDefinitions += [
        PropertyDefinition.from_json({"id": "when", "key": "when", "name": "When", "type": "datetime"}),
        PropertyDefinition.from_json({"id": "due", "key": "due", "name": "Due", "type": "datetimeSimple"}),
    ]
    space.save_type(t, type_revision(space.root, "meeting"))


# --- template date variables -------------------------------------------------------------


def test_creation_variable_accepted_on_template_only(space_dir: Path):
    space, c = _client(space_dir)
    _meeting(space)
    with c:
        tmpl = c.post("/api/types/meeting/templates", json={"name": "Weekly"}).json()["path"]
        obj = c.post("/api/objects", json={"typeId": "meeting", "title": "Sync", "templateId": "none"})
        obj = obj.json()["path"]
        before = (space_dir / tmpl).read_bytes()

        r = _put(c, space, tmpl, {"when": "{creation:week}"})
        assert r.status_code == 200, r.text
        after = (space_dir / tmpl).read_bytes()
        assert after.startswith(before.split(b"---\n", 2)[0] + b"---\n")
        assert b"\nwhen: '{creation:week}'\n" in after
        assert r.json()["frontmatter"]["when"] == "{creation:week}"

        # Not on an object, and not on a datetimeSimple property.
        obj_before = (space_dir / obj).read_bytes()
        r = _put(c, space, obj, {"when": "{creation:week}"})
        assert r.status_code == 422
        assert (space_dir / obj).read_bytes() == obj_before
        tmpl_before = (space_dir / tmpl).read_bytes()
        assert _put(c, space, tmpl, {"due": "{creation:day}"}).status_code == 422
        assert (space_dir / tmpl).read_bytes() == tmpl_before
        r = c.post(
            "/api/objects",
            json={"typeId": "meeting", "title": "X", "templateId": "none",
                  "values": {"when": "{creation:day}"}},
        )  # fmt: skip
        assert r.status_code == 422

        # A new object from the template gets the week around its creation day.
        tid = space.get(tmpl).id
        made = c.post("/api/objects", json={"typeId": "meeting", "title": "Week", "templateId": tid})
        text = (space_dir / made.json()["path"]).read_text("utf-8")
        assert "when: 2026-10-26 -> 2026-11-01\n" in text

        # A date replaces the variable; null clears it.
        r = _put(c, space, tmpl, {"when": {"start": "2026-11-02", "resolution": "day"}})
        assert r.status_code == 200, r.text
        assert b"\nwhen: 2026-11-02\n" in (space_dir / tmpl).read_bytes()


def test_unknown_creation_variable_422(space_dir: Path):
    space, c = _client(space_dir)
    _meeting(space)
    with c:
        tmpl = c.post("/api/types/meeting/templates", json={"name": "Weekly"}).json()["path"]
        before = (space_dir / tmpl).read_bytes()
        for bad in ("{creation:decade}", "{creation:}", "{creation:Week}"):
            r = _put(c, space, tmpl, {"when": bad})
            assert r.status_code == 422, bad
        assert (space_dir / tmpl).read_bytes() == before


# --- per-object layout keys -----------------------------------------------------------------


ALPHA = "Pages/Alpha.md"
ALPHA_LINES = [
    "---\n",
    "type: 'Page'\n",
    "title: Alpha\n",
    "createdAt: 2026-04-01T08:00:00.000Z\n",
    "lastUpdated: 2026-04-01T08:00:00.000Z\n",
    "---\n",
    "\n",
    "A page whose title collides with the server.\n",
]


def test_layout_keys_shape_422(space_dir: Path):
    space, c = _client(space_dir)
    with c:
        before = (space_dir / ALPHA).read_bytes()
        for updates in (
            {"wideLayoutMode": "yes"},
            {"wideLayoutMode": 1},
            {"wideCoverImage": "true"},
            {"coverImageOffset": 101},
            {"coverImageOffset": -1},
            {"coverImageOffset": "50"},
            {"coverImageOffset": True},
            {"coverImageOffset": [50]},
        ):
            r = _put(c, space, ALPHA, updates)
            assert r.status_code == 422, (updates, r.text)
        assert (space_dir / ALPHA).read_bytes() == before

        r = _put(c, space, ALPHA, {"wideLayoutMode": True, "wideCoverImage": False, "coverImageOffset": 37.5})
        assert r.status_code == 200, r.text
    lines = (space_dir / ALPHA).read_text("utf-8").splitlines(keepends=True)
    # The stamped write puts a new id first; the keys are appended; nothing else moves.
    assert lines[0] == "---\n" and lines[1].startswith("id: ")
    assert lines[2:] == [
        *ALPHA_LINES[1:4],
        f"lastUpdated: {STAMP}\n",
        "wideLayoutMode: true\n",
        "wideCoverImage: false\n",
        "coverImageOffset: 37.5\n",
        *ALPHA_LINES[5:],
    ]
    for edge in (0, 100):
        with c:
            assert _put(c, space, ALPHA, {"coverImageOffset": edge}).status_code == 200
        assert f"\ncoverImageOffset: {edge}\n" in (space_dir / ALPHA).read_text("utf-8")


def test_null_removes_layout_key_only_that_line(space_dir: Path):
    page = space_dir / "Pages" / "Layout.md"
    page.write_bytes(
        b"---\r\nid: 01JBLAYOUT0000000000000001\r\ntype: 'Page'\r\ntitle: Layout\r\n"
        b"wideLayoutMode: true\r\nwideCoverImage: true # kept\r\ncoverImageOffset: 30\r\n"
        b"lastUpdated: 2026-01-01T00:00:00.000Z\r\n---\r\nBody.\r\n"
    )
    space, c = _client(space_dir)
    with c:
        r = _put(c, space, "Pages/Layout.md", {"wideLayoutMode": None, "coverImageOffset": None})
        assert r.status_code == 200, r.text
        assert "wideLayoutMode" not in r.json()["frontmatter"]
    assert page.read_bytes() == (
        b"---\r\nid: 01JBLAYOUT0000000000000001\r\ntype: 'Page'\r\ntitle: Layout\r\n"
        b"wideCoverImage: true # kept\r\n"
        b"lastUpdated: " + STAMP.encode() + b"\r\n---\r\nBody.\r\n"
    )
    # Removing an absent key writes nothing.
    before = page.read_bytes()
    with c:
        r = _put(c, space, "Pages/Layout.md", {"wideLayoutMode": None})
        assert r.status_code == 200
    assert page.read_bytes() == before


def test_setting_cover_image_drops_offset_same_write(space_dir: Path):
    page = space_dir / "Pages" / "Cover.md"
    page.write_bytes(
        b"---\nid: 01JBCOVER00000000000000001\ntype: 'Page'\ntitle: Cover\n"
        b"coverImage: Attachments/a.png\ncoverImageOffset: 30\n"
        b"lastUpdated: 2026-01-01T00:00:00.000Z\n---\nBody.\n"
    )
    space, c = _client(space_dir)
    with c:
        # The same image keeps the offset (only a changed image drops it).
        r = _put(c, space, "Pages/Cover.md", {"coverImage": "Attachments/a.png"})
        assert r.status_code == 200
        assert b"coverImageOffset: 30\n" in page.read_bytes()
        r = _put(c, space, "Pages/Cover.md", {"coverImage": "Attachments/b.png"})
        assert r.status_code == 200, r.text
    assert page.read_bytes() == (
        b"---\nid: 01JBCOVER00000000000000001\ntype: 'Page'\ntitle: Cover\n"
        b"coverImage: Attachments/b.png\n"
        b"lastUpdated: " + STAMP.encode() + b"\n---\nBody.\n"
    )
    # A new image and a new offset in one write: the offset given wins.
    with c:
        r = _put(c, space, "Pages/Cover.md", {"coverImage": "Attachments/c.png", "coverImageOffset": 80})
        assert r.status_code == 200
        assert r.json()["frontmatter"]["coverImageOffset"] == 80
        r = _put(c, space, "Pages/Cover.md", {"coverImage": None})
        assert r.status_code == 200
        assert "coverImageOffset" not in r.json()["frontmatter"]


def test_layout_keys_not_inferred_as_properties(tmp_path: Path):
    root = tmp_path / "space"
    (root / "Gadgets").mkdir(parents=True)
    (root / "Gadgets" / "One.md").write_text(
        "---\ntype: 'Gadget'\ntitle: One\nwideLayoutMode: true\nwideCoverImage: false\n"
        "coverImageOffset: 40\nweight: 3\n---\n",
        "utf-8",
    )
    space = Space(root)
    t = space.type_by_id("gadget")
    assert t is not None
    keys = {p.key for p in t.propertyDefinitions}
    assert "weight" in keys
    assert not keys & {"wideLayoutMode", "wideCoverImage", "coverImageOffset"}
    # Nor can a new property take one of these keys.
    from objectapp.typedefs import SYSTEM_KEYS

    assert {"wideLayoutMode", "wideCoverImage", "coverImageOffset"} <= SYSTEM_KEYS


# --- workspaceOrder -----------------------------------------------------------------------


def test_ui_workspace_order_roundtrip_and_422(space_dir: Path):
    _space, c = _client(space_dir)
    with c:
        rev = c.get("/api/ui").json()["revision"]
        order = ["pinned", "objects", "sec-1"]
        r = c.put("/api/ui", json={"patch": {"workspaceOrder": order}, "baseRevision": rev})
        assert r.status_code == 200, r.text
        assert r.json()["ui"]["workspaceOrder"] == order
        got = c.get("/api/ui").json()
        assert got["ui"]["workspaceOrder"] == order
        rev = got["revision"]
        for bad in ("objects", ["objects", 3], ["objects", "objects"], {"a": 1}, None):
            r = c.put("/api/ui", json={"patch": {"workspaceOrder": bad}, "baseRevision": rev})
            assert r.status_code == 422, bad
        assert c.get("/api/ui").json()["revision"] == rev
        r = c.put("/api/ui", json={"patch": {"workspaceOrder": []}, "baseRevision": rev})
        assert r.status_code == 200
