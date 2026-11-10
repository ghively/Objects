"""M31 item 14: a type's link view (``defaultViewType`` in its JSON) can be ``page``.

The type model keeps the key as it is (``TypeDefinition.extra``); saving ``page`` writes only that
line, and the type reads back with it.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from objectapp.server import create_app
from objectapp.space import Space

KEY = "defaultViewType"


def _type(c: TestClient, type_id: str) -> dict:
    return next(t for t in c.get("/api/space").json()["types"] if t["id"] == type_id)


def test_the_page_link_view_is_stored_and_read_back(tmp_path: Path):
    root = tmp_path / "space"
    root.mkdir()
    sp = Space(root)
    t = sp.create_type("Machine", "Machines")
    path = root / ".object" / "types" / f"{t.id}.json"
    with TestClient(create_app(sp, None, watch=False)) as c:
        data = _type(c, t.id)
        data[KEY] = "wideCard"
        r = c.put(f"/api/types/{t.id}", json={"type": data, "baseRevision": data["revision"]})
        assert r.status_code == 200, r.text
        before = path.read_text("utf-8")
        data = r.json()["type"]
        data[KEY] = "page"
        r = c.put(f"/api/types/{t.id}", json={"type": data, "baseRevision": data["revision"]})
        assert r.status_code == 200, r.text
        assert r.json()["type"][KEY] == "page"
        assert _type(c, t.id)[KEY] == "page"
    after = path.read_text("utf-8")
    assert json.loads(after)[KEY] == "page"
    # Only the link view's line changed.
    changed = [(a, b) for a, b in zip(before.splitlines(), after.splitlines(), strict=True) if a != b]
    assert changed == [('  "defaultViewType": "wideCard"', '  "defaultViewType": "page"')]
    # A fresh read of the space keeps it.
    assert Space(root).type_by_id(t.id).extra[KEY] == "page"
