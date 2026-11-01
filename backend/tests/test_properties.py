"""Property updates through the one write engine (Task 3)."""

import difflib
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp import space as space_mod
from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import Conflict, ReadOnly, Skip, Space, version_of
from objectapp.typemodel import PropertyDefinition

_ID_RE = re.compile(r"[0-9A-HJKMNP-TV-Z]{26}")
_STAMP_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z")


def _changed_lines(before: bytes, after: bytes) -> tuple[list[str], list[str]]:
    old = before.decode().splitlines(keepends=True)
    new = after.decode().splitlines(keepends=True)
    diff = [d for d in difflib.ndiff(old, new) if d.startswith(("+ ", "- "))]
    return [d[2:] for d in diff if d.startswith("- ")], [d[2:] for d in diff if d.startswith("+ ")]


def _version(space: Space, path: str) -> str:
    return space.read(path)[2]


# -- basic updates ---------------------------------------------------------------


def test_update_label_changes_one_line(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Write docs.md"
    before = target.read_bytes()

    result = space.update_properties(
        "Tasks/Write docs.md", {"status": ["In Progress"]}, version_of(before)
    )

    after = target.read_bytes()
    removed, added = _changed_lines(before, after)
    assert sorted(removed) == ["lastUpdated: 2026-03-02T10:00:00.000Z\n", "status: Not Started\n"]
    assert sorted(added) == sorted(
        [
            "status: In Progress\n",
            f"lastUpdated: {result.frontmatter['lastUpdated']}\n",
            f"id: {result.frontmatter['id']}\n",
        ]
    )
    assert after.decode().splitlines()[1].startswith("id: ")
    assert result.version == version_of(after)
    assert result.frontmatter["status"] == "In Progress"
    assert result.synced == [] and result.skipped == []
    assert space.get("Tasks/Write docs.md").lastUpdated == result.frontmatter["lastUpdated"]


def test_update_no_frontmatter_creates_fence(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Pages" / "Notes.md"
    before = target.read_bytes()

    space.update_properties("Pages/Notes.md", {"mood": "ok"}, version_of(before))

    text = target.read_bytes().decode()
    text = _ID_RE.sub("<ulid>", text, count=1)
    text = _STAMP_RE.sub("<stamp>", text, count=1)
    assert text == (
        "---\nid: <ulid>\nmood: ok\nlastUpdated: <stamp>\n---\n"
        "# Meeting notes\n\nNo frontmatter here. Mentions [[Alpha]].\n"
    )


def test_update_stale_version_409_no_write(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Write docs.md"
    before = (target.read_bytes(), target.stat().st_mtime_ns)

    with pytest.raises(Conflict) as exc:
        space.update_properties("Tasks/Write docs.md", {"status": ["In Progress"]}, "0" * 64)

    assert exc.value.current_version == version_of(before[0])
    assert (target.read_bytes(), target.stat().st_mtime_ns) == before


def test_update_readonly_423(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Pages" / "Bad yaml.md"
    before = target.read_bytes()
    with pytest.raises(ReadOnly):
        space.update_properties("Pages/Bad yaml.md", {"mood": "ok"}, version_of(before))
    assert target.read_bytes() == before


def test_update_invalid_value_422(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Write docs.md"
    before = target.read_bytes()
    with pytest.raises(InvalidValue):
        space.update_properties("Tasks/Write docs.md", {"status": ["Bogus"]}, version_of(before))
    with pytest.raises(InvalidValue):
        space.update_properties("Tasks/Write docs.md", {"title": "New"}, version_of(before))
    with pytest.raises(InvalidValue):
        space.update_properties("Tasks/Write docs.md", {"type": "Page"}, version_of(before))
    assert target.read_bytes() == before


def test_clear_existing_writes_null(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Write docs.md"
    before = target.read_bytes()
    space.update_properties("Tasks/Write docs.md", {"status": None}, version_of(before))
    removed, added = _changed_lines(before, target.read_bytes())
    assert "status: Not Started\n" in removed
    assert "status: null\n" in added


def test_clear_absent_key_writes_nothing(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Write docs.md"
    before = (target.read_bytes(), target.stat().st_mtime_ns)
    result = space.update_properties(
        "Tasks/Write docs.md", {"aliases": [], "mood": None}, version_of(before[0])
    )
    assert result.version == version_of(before[0])
    assert (target.read_bytes(), target.stat().st_mtime_ns) == before


def test_update_adds_missing_key_at_end(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Write docs.md"
    before = target.read_bytes()
    space.update_properties("Tasks/Write docs.md", {"aliases": ["Docs task"]}, version_of(before))
    fm_lines = target.read_bytes().decode().split("---\n")[1].splitlines()
    assert fm_lines[-1] == "aliases: [Docs task]"
    assert fm_lines[0].startswith("id: ") and fm_lines[5].startswith("lastUpdated: ")


def test_remove_key(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Write docs.md"
    before = target.read_bytes()
    result = space.update_properties(
        "Tasks/Write docs.md", {}, version_of(before), remove=["description"]
    )
    removed, _added = _changed_lines(before, target.read_bytes())
    assert "description: null\n" in removed
    assert "description" not in result.frontmatter


def test_crlf_preserved_on_property_update(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Fix printer.md"
    before = target.read_bytes()
    space.update_properties("Tasks/Fix printer.md", {"status": ["Not Started"]}, version_of(before))
    after = target.read_bytes()
    assert b"status: Not Started\r\n" in after
    assert after.count(b"\n") == after.count(b"\r\n")


def test_key_without_definition_passes_json_scalar(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Write docs.md"
    v = version_of(target.read_bytes())
    v = space.update_properties("Tasks/Write docs.md", {"effort": 3}, v).version
    v = space.update_properties("Tasks/Write docs.md", {"flagged": True}, v).version
    result = space.update_properties("Tasks/Write docs.md", {"note": "a: b"}, v)
    text = target.read_bytes().decode()
    assert "effort: 3\n" in text and "flagged: true\n" in text and "note: 'a: b'\n" in text
    assert result.frontmatter["note"] == "a: b"
    with pytest.raises(InvalidValue):
        space.update_properties("Tasks/Write docs.md", {"bad": {"x": 1}}, result.version)


# -- entity values ---------------------------------------------------------------


def _add_entity_def(space: Space, type_id: str, key: str, **options) -> PropertyDefinition:
    p = PropertyDefinition.from_json(
        {"id": f"{key}-id", "key": key, "name": key.title(), "type": "entity", "options": options}
    )
    space.type_by_id(type_id).propertyDefinitions.append(p)
    return p


def test_entity_write_uses_path_form_for_duplicate_title(space_dir: Path):
    (space_dir / "Notes").mkdir()
    (space_dir / "Pages" / "Untitled.md").write_bytes(b"---\ntype: Page\ntitle: Untitled\n---\n")
    (space_dir / "Notes" / "Untitled.md").write_bytes(b"---\ntype: Page\ntitle: Untitled\n---\n")
    space = Space(space_dir)
    _add_entity_def(space, "page", "related")
    target = space_dir / "Pages" / "Alpha.md"

    result = space.update_properties(
        "Pages/Alpha.md",
        {"related": [{"target": "Untitled", "path": "Notes/Untitled.md"}]},
        version_of(target.read_bytes()),
    )

    assert "related: ['[[Notes/Untitled]]']\n" in target.read_bytes().decode()
    assert result.links["related"] == ["Notes/Untitled.md"]
    assert space.resolve("Notes/Untitled", "Pages/Alpha.md") == "Notes/Untitled.md"
    # A unique title is written as the title.
    result = space.update_properties(
        "Pages/Alpha.md",
        {"related": [{"target": "x", "path": "People/Ada Lovelace.md"}]},
        result.version,
    )
    assert "related: ['[[Ada Lovelace]]']\n" in target.read_bytes().decode()
    assert result.links["related"] == ["People/Ada Lovelace.md"]


def test_fixed_set_rejects_outsider_422(space_dir: Path):
    space = Space(space_dir)
    v = space.ensure_id("People/Ada Lovelace.md")
    ada_id = v[0]
    _add_entity_def(space, "page", "member", hasFixedSet=True, fixedSet=[ada_id])
    target = space_dir / "Pages" / "Alpha.md"
    before = target.read_bytes()

    with pytest.raises(InvalidValue):
        space.update_properties(
            "Pages/Alpha.md",
            {"member": [{"target": "Write docs", "path": None}]},
            version_of(before),
        )
    assert target.read_bytes() == before
    space.update_properties(
        "Pages/Alpha.md", {"member": [{"target": "Ada Lovelace", "path": None}]}, version_of(before)
    )


def test_get_object_returns_links(space_dir: Path):
    space = Space(space_dir)
    client = TestClient(create_app(space, None, watch=False))
    r = client.get("/api/object", params={"path": "Servers/Alpha.md"})
    assert r.status_code == 200
    assert r.json()["links"]["owner"] == ["People/Ada Lovelace.md"]


# -- relation syncing ------------------------------------------------------------


def _synced_space(space_dir: Path) -> Path:
    """Tmp types A and B whose `rel` properties sync with each other; A/A1 and B/B1."""
    types = space_dir / ".object" / "types"
    types.mkdir(parents=True)
    for tid, name, other in (("a", "A", "b"), ("b", "B", "a")):
        data = {
            "schemaVersion": 2,
            "id": tid,
            "name": name,
            "pluralName": name,
            "folder": name,
            "propertyDefinitions": [
                {
                    "id": f"rel-{tid}",
                    "key": "rel",
                    "name": "Rel",
                    "type": "entity",
                    "options": {
                        "isArray": True,
                        "allowedTypes": [other],
                        "hasFixedSet": False,
                        "fixedSet": [],
                        "propertySyncing": {"propertyIds": [f"rel-{other}"]},
                    },
                }
            ],
        }
        (types / f"{tid}.json").write_bytes((json.dumps(data, indent=2) + "\n").encode())
    for folder, title in (("A", "A1"), ("B", "B1")):
        (space_dir / folder).mkdir()
        (space_dir / folder / f"{title}.md").write_bytes(
            f"---\ntype: '{folder}'\ntitle: {title}\nlastUpdated: 2026-01-01T00:00:00.000Z\n---\n"
            .encode()
        )
    return space_dir


def test_relation_sync_adds_and_removes_backlink(space_dir: Path):
    _synced_space(space_dir)
    space = Space(space_dir)
    b1 = space_dir / "B" / "B1.md"

    result = space.update_properties("A/A1.md", {"rel": ["B1"]}, _version(space, "A/A1.md"))

    assert result.synced == ["B/B1.md"]
    assert result.skipped == []
    assert result.links["rel"] == ["B/B1.md"]
    text = b1.read_bytes().decode()
    assert "rel: ['[[A1]]']\n" in text
    assert "lastUpdated: 2026-01-01T00:00:00.000Z" not in text  # stamped

    result = space.update_properties("A/A1.md", {"rel": []}, result.version)
    assert result.synced == ["B/B1.md"]
    assert "[[A1]]" not in b1.read_bytes().decode()


def test_sync_target_missing_is_ignored(space_dir: Path):
    _synced_space(space_dir)
    space = Space(space_dir)
    result = space.update_properties("A/A1.md", {"rel": ["Nowhere"]}, _version(space, "A/A1.md"))
    assert result.synced == [] and result.skipped == []
    assert result.links["rel"] == [None]


def test_sync_target_readonly_reported_in_skipped(space_dir: Path):
    _synced_space(space_dir)
    b1 = space_dir / "B" / "B1.md"
    b1.write_bytes(("---\ntype: 'B'\ntitle: [B1\n---\n").encode())
    space = Space(space_dir)
    before = b1.read_bytes()
    a1 = space_dir / "A" / "A1.md"
    result = space.update_properties(
        "A/A1.md", {"rel": [{"target": "B1", "path": "B/B1.md"}]}, version_of(a1.read_bytes())
    )
    assert "rel: ['[[B1]]']\n" in a1.read_bytes().decode()
    assert len(result.skipped) == 1
    assert result.skipped[0].path == "B/B1.md" and result.skipped[0].reason
    assert result.synced == []
    assert b1.read_bytes() == before


def _external_writes(monkeypatch, target: Path, times: int) -> list[bytes]:
    """Change `target` on disk right before each of the space's next `times` writes to it.

    `_write` syncs a temp file (`_write_temp`) and replaces after a version re-check;
    `_write_exact` goes through `atomic_write`: both entry points are patched.
    """
    written: list[bytes] = []

    def external(path) -> None:
        if Path(path) == target and len(written) < times:
            ext = target.read_bytes() + f"external {len(written)}\n".encode()
            target.write_bytes(ext)
            written.append(ext)

    real_temp, real_atomic = space_mod._write_temp, space_mod.atomic_write

    def temp(path, data, **kw):
        external(path)
        return real_temp(path, data, **kw)

    def atomic(path, data, check=None):
        external(path)
        return real_atomic(path, data, check=check)

    monkeypatch.setattr(space_mod, "_write_temp", temp)
    monkeypatch.setattr(space_mod, "atomic_write", atomic)
    return written


def test_sync_target_conflict_retried_then_skipped(space_dir: Path, monkeypatch):
    _synced_space(space_dir)
    space = Space(space_dir)
    b1 = space_dir / "B" / "B1.md"

    written = _external_writes(monkeypatch, b1, 1)
    result = space.update_properties("A/A1.md", {"rel": ["B1"]}, _version(space, "A/A1.md"))
    assert len(written) == 1
    assert result.synced == ["B/B1.md"] and result.skipped == []
    text = b1.read_bytes().decode()
    assert "external 0\n" in text and "rel: ['[[A1]]']\n" in text

    written = _external_writes(monkeypatch, b1, 2)
    result = space.update_properties("A/A1.md", {"rel": []}, result.version)
    assert len(written) == 2
    assert result.synced == []
    assert [s.path for s in result.skipped] == ["B/B1.md"]
    assert b1.read_bytes() == written[-1]
    # The main write is never undone by a sync failure.
    assert "[[B1]]" not in (space_dir / "A" / "A1.md").read_bytes().decode()


def test_rewrite_other_returns_skip_for_readonly(space_dir: Path):
    space = Space(space_dir)
    out = space._rewrite_other("Pages/Bad yaml.md", lambda of, fm: None)
    assert isinstance(out, Skip) and out.path == "Pages/Bad yaml.md"


# -- ensure-id -------------------------------------------------------------------


def test_ensure_id_inserts_first_unstamped(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / "Tasks" / "Write docs.md"
    before = target.read_bytes()

    new_id, version = space.ensure_id("Tasks/Write docs.md")

    after = target.read_bytes()
    assert _ID_RE.fullmatch(new_id)
    assert after == before.replace(b"---\n", f"---\nid: {new_id}\n".encode(), 1)
    assert version == version_of(after)
    mtime = target.stat().st_mtime_ns
    assert space.ensure_id("Tasks/Write docs.md") == (new_id, version)
    assert target.stat().st_mtime_ns == mtime
    with pytest.raises(ReadOnly):
        space.ensure_id("Pages/Bad yaml.md")


# -- routes ----------------------------------------------------------------------


def test_properties_route_and_events(space_dir: Path):
    import time

    _synced_space(space_dir)
    space = Space(space_dir)
    app = create_app(space, None, watch=False)
    published = []
    app.state.hub.publish = published.append
    with TestClient(app) as c:
        obj = c.get("/api/object", params={"path": "A/A1.md"}).json()
        r = c.put(
            "/api/object/properties",
            json={
                "path": "A/A1.md",
                "updates": {"rel": [{"target": "B1", "path": None}]},
                "baseVersion": obj["version"],
                "clientId": "w1",
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"version", "frontmatter", "links", "synced", "skipped"}
        assert body["synced"] == ["B/B1.md"] and body["skipped"] == []
        deadline = time.monotonic() + 2
        while len(published) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert {(e.kind, e.path, e.origin) for e in published} == {
            ("changed", "A/A1.md", "w1"),
            ("changed", "B/B1.md", "w1"),
        }

        r = c.put(
            "/api/object/properties",
            json={"path": "A/A1.md", "updates": {"rel": []}, "baseVersion": obj["version"]},
        )
        assert r.status_code == 409 and r.json()["currentVersion"] == body["version"]
        r = c.put(
            "/api/object/properties",
            json={"path": "A/A1.md", "updates": {"title": "x"}, "baseVersion": body["version"]},
        )
        assert r.status_code == 422 and r.json()["detail"]
        bad = c.get("/api/object", params={"path": "Pages/Bad yaml.md"}).json()
        r = c.put(
            "/api/object/properties",
            json={"path": "Pages/Bad yaml.md", "updates": {"x": 1}, "baseVersion": bad["version"]},
        )
        assert r.status_code == 423
        r = c.put(
            "/api/object/properties",
            json={"path": "Pages/Nope.md", "updates": {"x": 1}, "baseVersion": "0" * 64},
        )
        assert r.status_code == 404

        published.clear()
        r = c.post("/api/object/ensure-id", json={"path": "Pages/Alpha.md", "clientId": "w2"})
        assert r.status_code == 200, r.text
        assert _ID_RE.fullmatch(r.json()["id"])
        deadline = time.monotonic() + 2
        while not published and time.monotonic() < deadline:
            time.sleep(0.01)
        assert [(e.kind, e.path, e.origin) for e in published] == [
            ("changed", "Pages/Alpha.md", "w2")
        ]
        assert c.post("/api/object/ensure-id", json={"path": "Pages/Nope.md"}).status_code == 404
        assert (
            c.post("/api/object/ensure-id", json={"path": "Pages/Bad yaml.md"}).status_code == 423
        )
