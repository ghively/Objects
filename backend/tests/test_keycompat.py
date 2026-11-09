"""Older key names in ``.object/`` JSON, settings and request bodies (`keycompat`).

A space saved with the older names must load exactly as one saved with today's, and
opening it must not change a single file: the names are renamed in memory only.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import settings
from objectapp.keycompat import upgrade_body, upgrade_keys, upgrade_list_name
from objectapp.server import create_app
from objectapp.space import Space

_GROUP = {"type": "filterGroup", "operator": "and", "elements": []}


def _filter(type_key: str) -> dict:
    return {"type": "filter", "propertyId": "title", "option": "isNotEmpty", type_key: "task"}


def _view_state(type_key: str) -> dict:
    return {
        "viewDefinition": {
            "dataViewLayout": "table",
            "calculations": [{"propertyId": "title", type_key: "task", "kind": "countValues"}],
        },
        "filterGroup": {**_GROUP, "elements": [_filter(type_key)]},
        "sorts": [{"propertyId": "title", "option": "ascending", type_key: "task"}],
        "groupBy": None,
    }


def _definitions(old: bool) -> dict[str, object]:
    """The ``.object/`` files of one space, with the older key names or today's."""
    tid = "structureId" if old else "typeId"
    types = "structures" if old else "types"
    exclude = "excludeStructureIds" if old else "excludeTypeIds"
    query = {
        "schemaVersion": 1,
        "id": "open-pages",
        "name": "Open pages",
        "titleIsCustom": True,
        "icon": None,
        "description": "",
        "definition": {
            types: [{"id": "task"}, {"id": "page"}],
            exclude: ["tag"],
            "filterGroup": {**_GROUP, "elements": [_filter(tid)]},
            "sorts": [{"propertyId": "title", "option": "descending", tid: "task"}],
            "groupBy": {"groups": [{"propertyId": "title", "option": "default", tid: "task"}]},
        },
        "view": {"viewDefinition": {"dataViewLayout": "list"}},
    }
    collection = {
        "schemaVersion": 1,
        "id": "shelf",
        "name": "Shelf",
        "formerNames": [],
        "icon": None,
        "color": None,
        "description": "",
        "typeIds": ["task"],
        "views": {"activeTab": "all", "all": _view_state(tid), "dashboard": {"sections": [], "removedSections": []}},
    }
    views = {"activeTab": "all", "all": _view_state(tid), "dashboard": {"sections": [], "removedSections": []}}
    ui = {"graph": {("filterStructureIds" if old else "filterTypeIds"): ["page"], exclude: ["tag"]}}
    return {
        ".object/queries/open-pages.json": query,
        ".object/collections/shelf.json": collection,
        ".object/views/task.json": views,
        ".object/ui.json": ui,
    }


def _make_space(src: Path, dest: Path, old: bool) -> Path:
    shutil.copytree(src, dest)
    for rel, data in _definitions(old).items():
        p = dest / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
    task = dest / ".object" / "types" / "task.json"
    data = json.loads(task.read_text(encoding="utf-8"))
    data["structureViews" if old else "typeViews"] = {"smallCard": {"properties": []}}
    task.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
    return dest


def _snapshot(root: Path) -> dict[str, tuple[bytes, int]]:
    """Every file outside the rebuildable cache, with its bytes and mtime."""
    return {
        p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
        for p in sorted(root.rglob("*"))
        if p.is_file() and ".object-cache" not in p.relative_to(root).parts
    }


def _no_revisions(value):
    if isinstance(value, dict):
        return {k: _no_revisions(v) for k, v in value.items() if k != "revision"}
    if isinstance(value, list):
        return [_no_revisions(v) for v in value]
    return value


def _read_all(root: Path) -> dict:
    space = Space(root)
    app = create_app(space, None, watch=False)
    with TestClient(app) as c:
        out = {
            "queries": c.get("/api/queries").json(),
            "collections": c.get("/api/collections").json(),
            "views": c.get("/api/views/task").json(),
            "ui": c.get("/api/ui").json(),
            "task": next(t for t in c.get("/api/space").json()["types"] if t["id"] == "task"),
            "rows": c.post("/api/rows", json={"typeIds": ["task"]}).status_code,
        }
    return _no_revisions(out)


@pytest.fixture
def spaces(m8_space_dir: Path, tmp_path: Path) -> tuple[Path, Path]:
    old = _make_space(m8_space_dir, tmp_path / "old", old=True)
    new = _make_space(m8_space_dir, tmp_path / "new", old=False)
    return old, new


def test_an_old_key_space_loads_like_a_new_key_one(spaces):
    old, new = spaces
    got_old, got_new = _read_all(old), _read_all(new)
    assert got_old == got_new
    q = next(q for q in got_new["queries"] if q["id"] == "open-pages")
    assert q["definition"]["types"] == [{"id": "task"}, {"id": "page"}]
    assert q["definition"]["excludeTypeIds"] == ["tag"]
    assert got_new["ui"]["ui"]["graph"]["filterTypeIds"] == ["page"]
    assert got_new["task"]["typeViews"] == {"smallCard": {"properties": []}}
    assert "structureViews" not in json.dumps(got_old)


def test_opening_an_old_key_space_writes_nothing(spaces):
    old, _new = spaces
    before = _snapshot(old)
    _read_all(old)
    _read_all(old)
    assert _snapshot(old) == before


def test_an_old_key_file_gets_new_keys_when_saved_for_another_reason(spaces):
    old, _new = spaces
    space = Space(old)
    app = create_app(space, None, watch=False)
    with TestClient(app) as c:
        q = next(q for q in c.get("/api/queries").json() if q["id"] == "open-pages")
        q["name"] = "Open pages, renamed"
        res = c.put("/api/queries/open-pages", json={"query": q, "baseRevision": q["revision"]})
        assert res.status_code == 200, res.text
    text = (old / ".object" / "queries" / "open-pages.json").read_text(encoding="utf-8")
    assert '"types"' in text and '"typeId"' in text and '"excludeTypeIds"' in text
    assert "tructure" not in text


def test_a_request_body_with_old_keys_is_read_with_new_ones(m8_space_dir: Path):
    space = Space(m8_space_dir)
    app = create_app(space, None, watch=False)
    body = {
        "name": "From an older client",
        "definition": {
            "structures": [{"id": "task"}],
            "filterGroup": {**_GROUP, "elements": [_filter("structureId")]},
            "sorts": [],
            "groupBy": None,
        },
    }
    with TestClient(app) as c:
        res = c.post("/api/queries", json=body)
        assert res.status_code == 201, res.text
        qid = res.json()["id"]
    stored = json.loads((m8_space_dir / ".object" / "queries" / f"{qid}.json").read_text(encoding="utf-8"))
    assert stored["definition"]["types"] == [{"id": "task"}]
    assert stored["definition"]["filterGroup"]["elements"][0]["typeId"] == "task"
    assert "structures" not in stored["definition"]


def test_settings_with_the_old_key(tmp_path: Path, monkeypatch):
    state = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(state))
    state.mkdir()
    path = settings.settings_path()
    path.write_text('{\n  "hideStructureSettings": true\n}\n', encoding="utf-8")
    before = path.read_bytes()
    merged, _rev = settings.read()
    assert merged["hideTypeSettings"] is True
    assert "hideStructureSettings" not in merged
    assert path.read_bytes() == before
    merged, _rev = settings.patch({"zoom": 1.25}, _rev)
    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert on_disk.get("hideTypeSettings") is True and "hideStructureSettings" not in on_disk


def test_upgrade_keys_shapes_and_precedence():
    data = {
        "a": [{"structureId": "x", "propertyId": "p"}],
        "tableConfigs": {"structures": {"properties": []}},  # a type id, not the query list
        "both": {"structureId": "old", "typeId": "new"},
    }
    assert upgrade_keys(data)
    assert data == {
        "a": [{"typeId": "x", "propertyId": "p"}],
        "tableConfigs": {"structures": {"properties": []}},
        "both": {"typeId": "new"},
    }
    assert list(data["a"][0]) == ["typeId", "propertyId"]
    assert not upgrade_keys({"types": [], "typeId": "t"})
    assert upgrade_list_name("structures") == "types"
    assert upgrade_list_name("excludeStructureIds") == "excludeTypeIds"
    assert upgrade_list_name("types") == "types"
    raw = b'{"typeId": "t"}'
    assert upgrade_body(raw) is raw
    assert upgrade_body(b"not json structure") == b"not json structure"
    assert json.loads(upgrade_body(b'{"structureId": "t"}')) == {"typeId": "t"}


def test_upgrade_body_with_a_lone_surrogate_does_not_raise():
    # JSON may spell a lone surrogate (`\ud800`); it can't be encoded as UTF-8 again, so the
    # body goes through unchanged and the route answers its own 4xx instead of a bare 500.
    raw = b'{"structureId": null, "t": "\\ud800"}'
    assert upgrade_body(raw) is raw


def test_a_body_with_a_lone_surrogate_and_an_old_key_is_not_a_500(m8_space_dir: Path):
    app = create_app(Space(m8_space_dir), None, watch=False)
    with TestClient(app, raise_server_exceptions=False) as c:
        ver = c.get("/api/object", params={"path": "People/Ada Lovelace.md"}).json()["version"]
        res = c.put(
            "/api/object/body",
            content=b'{"path": "People/Ada Lovelace.md", "body": "\\ud800 x", "baseVersion": "'
            + ver.encode() + b'", "structureId": null}',
            headers={"content-type": "application/json"},
        )
        assert res.status_code < 500, res.text
        assert "detail" in res.json()


# -- a user's own property keys are not definition keys (sweep 2026-11-08) ------------------


def _structure_props(c: TestClient) -> None:
    """Give the Person type a text property "Structure ID" and a label "Structures"
    (keys ``structureId`` and ``structures``, the older names of ``typeId`` and ``types``)."""
    t = next(t for t in c.get("/api/space").json()["types"] if t["id"] == "person")
    t["propertyDefinitions"] = t.get("propertyDefinitions", []) + [
        # The keys the app derives from the names (`typeEdits.ts` ``camelCase``, `space.camel_key`).
        {"id": "structureId", "key": "structureId", "name": "Structure ID", "type": "text"},
        {
            "id": "structures",
            "key": "structures",
            "name": "Structures",
            "type": "label",
            "options": {"set": [{"id": "a", "text": "a"}, {"id": "b", "text": "b"}]},
        },
    ]
    res = c.put("/api/types/person", json={"type": t, "baseRevision": t["revision"]})
    assert res.status_code == 200, res.text
    page = next(t for t in c.get("/api/space").json()["types"] if t["id"] == "person")
    keys = {p["name"]: p.get("key", p["id"]) for p in page["propertyDefinitions"]}
    assert keys["Structure ID"] == "structureId" and keys["Structures"] == "structures"


def _page(c: TestClient) -> tuple[str, str]:
    page = "People/Ada Lovelace.md"
    return page, c.get("/api/object", params={"path": page}).json()["version"]


def _check_written(c: TestClient, space_dir: Path, page: str, sid: str) -> None:
    fm = (space_dir / page).read_text(encoding="utf-8").split("---")[1]
    assert f"structureId: {sid}" in fm, fm
    assert "structures: a" in fm, fm  # a single label is written as a scalar
    assert "typeId" not in fm and "types:" not in fm, fm
    got = c.get("/api/object", params={"path": page}).json()["frontmatter"]
    assert got["structureId"] == sid and got["structures"] in ("a", ["a"])
    assert "typeId" not in got and "types" not in got


def test_property_values_keep_the_users_own_keys(m8_space_dir: Path):
    space = Space(m8_space_dir)
    app = create_app(space, None, watch=False)
    with TestClient(app) as c:
        _structure_props(c)
        page, ver = _page(c)
        res = c.put(
            "/api/object/properties",
            json={"path": page, "updates": {"structureId": "S-7", "structures": ["a"]}, "baseVersion": ver},
        )
        assert res.status_code == 200, res.text
        _check_written(c, m8_space_dir, page, "S-7")
        rows = c.post("/api/rows", json={"paths": [page]}).json()["rows"][0]["values"]
        assert rows["structureId"] == "S-7" and rows["structures"] == ["a"]


def test_v1_property_values_keep_the_users_own_keys(m8_space_dir: Path, tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    space = Space(m8_space_dir)
    app = create_app(space, None, watch=False)
    with TestClient(app) as c:
        _structure_props(c)
        page, ver = _page(c)
        made = c.post("/api/integrations/tokens", json={"name": "rw", "scope": "read-write"})
        res = c.post(
            "/api/v1/object/properties",
            json={"path": page, "version": ver, "set": {"structureId": "S-8", "structures": ["a"]}},
            headers={"Authorization": f"Bearer {made.json()['secret']}"},
        )
        assert res.status_code == 200, res.text
        _check_written(c, m8_space_dir, page, "S-8")


def test_in_process_tool_call_keeps_the_users_own_keys(m8_space_dir: Path):
    from objectapp.api_v1_tools import _call, _walk

    space = Space(m8_space_dir)
    app = create_app(space, None, watch=False)
    with TestClient(app) as c:
        _structure_props(c)
        page, ver = _page(c)
        route = next(
            r
            for full, r in _walk(app.router.routes, "")
            if full == "/api/object/properties" and "PUT" in (getattr(r, "methods", None) or ())
        )
        status, body = _call(
            route, {"path": page, "updates": {"structureId": "S-9", "structures": ["a"]}, "baseVersion": ver}
        )
        assert status == 200, body
        _check_written(c, m8_space_dir, page, "S-9")


def test_definition_bodies_with_old_keys_still_upgrade():
    def up(body: dict) -> dict:
        return json.loads(upgrade_body(json.dumps(body).encode("utf-8")))

    # Values under the user's maps stay; definition keys around them are renamed.
    assert up({"values": {"structures": ["a"], "structureId": "x"}, "structureId": "page"}) == {
        "values": {"structures": ["a"], "structureId": "x"},
        "typeId": "page",
    }
    assert up({"path": "p", "set": {"structureId": "S"}, "add": {"structures": ["a"]}}) == {
        "path": "p",
        "set": {"structureId": "S"},
        "add": {"structures": ["a"]},
    }
    assert up({"mapping": {"structureId": "other"}}) == {"mapping": {"structureId": "other"}}
    # Query, view, ui and settings bodies.
    assert up({"definition": {"structures": [{"id": "t"}], "excludeStructureIds": []}}) == {
        "definition": {"types": [{"id": "t"}], "excludeTypeIds": []}
    }
    assert up({"views": {"all": {"sorts": [{"propertyId": "title", "structureId": "t"}]}}}) == {
        "views": {"all": {"sorts": [{"propertyId": "title", "typeId": "t"}]}}
    }
    assert up({"patch": {"graph": {"filterStructureIds": ["page"]}}}) == {
        "patch": {"graph": {"filterTypeIds": ["page"]}}
    }
    assert up({"patch": {"hideStructureSettings": True}}) == {"patch": {"hideTypeSettings": True}}
    assert up({"type": {"structureViews": {"smallCard": {}}}}) == {"type": {"typeViews": {"smallCard": {}}}}
