"""Bulk rows: decoded values, links, previews, scope and search (M3 Task 2)."""

import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.rows import body_preview
from objectapp.server import create_app
from objectapp.space import Space


def _write(space_dir: Path, rel: str, text: str) -> None:
    p = space_dir / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(text.encode())


def _hashes(root: Path) -> dict[str, str]:
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in root.rglob("*")
        if p.is_file()
    }


def _by_path(rows):
    return {r.summary.path: r for r in rows}


def test_rows_values_per_kind(space_dir):
    space = Space(space_dir)
    row = _by_path(space.rows())["Tasks/Write docs.md"]
    assert row.values["status"] == ["Not Started"]
    assert isinstance(row.values["tags"], list)
    assert row.values["createdAt"] == "2026-03-01T09:00:00.000Z"
    assert row.values["description"] is None
    assert row.values["title"] == "Write docs"


def test_rows_entity_paths_resolved(space_dir):
    space = Space(space_dir)
    t = space.type_by_id("task")
    from objectapp.typemodel import PropertyDefinition

    t.propertyDefinitions.append(
        PropertyDefinition(id="lead", key="lead", name="Lead", type="entity", options={})
    )
    _write(space_dir, "Tasks/Led.md", "---\ntype: 'Task'\ntitle: Led\nlead: '[[Ada Lovelace]]'\n---\n")
    space.rescan_file("Tasks/Led.md")
    row = _by_path(space.rows())["Tasks/Led.md"]
    assert row.values["lead"] == [{"target": "Ada Lovelace", "path": "People/Ada Lovelace.md"}]
    assert row.links["lead"] == ["People/Ada Lovelace.md"]


def test_rows_version_matches_read(space_dir):
    space = Space(space_dir)
    rows = space.rows()
    assert rows
    for r in rows:
        assert r.version == space.read(r.summary.path)[2]


def test_rows_scope_types_collections_paths(space_dir):
    space = Space(space_dir)
    assert {r.summary.type for r in space.rows(type_ids=["task"])} == {"task"}
    p = "Tasks/Write docs.md"
    assert [r.summary.path for r in space.rows(paths=[p])] == [p]
    space.store("collections").write(
        "tooling", {"id": "tooling", "name": "Tooling", "formerNames": ["Tools"]}, ""
    )
    space.reload_collection("tooling")
    _write(space_dir, "Pages/In.md", "---\ntype: 'Page'\ntitle: In\ncollections: [Tooling]\n---\n")
    _write(space_dir, "Pages/Old.md", "---\ntype: 'Page'\ntitle: Old\ncollections: [tools]\n---\n")
    _write(space_dir, "Pages/Out.md", "---\ntype: 'Page'\ntitle: Out\ncollections: [Nope]\n---\n")
    for rel in ("Pages/In.md", "Pages/Old.md", "Pages/Out.md"):
        space.rescan_file(rel)
    got = {r.summary.path for r in space.rows(collection_ids=["tooling"])}
    assert got == {"Pages/In.md", "Pages/Old.md"}
    assert space.rows(collection_ids=["missing"]) == []


def test_rows_search_title_mode_vs_auto(space_dir):
    space = Space(space_dir)
    _write(space_dir, "Pages/Body.md", "---\ntype: 'Page'\ntitle: Plain\n---\n\nthe zzbody word\n")
    space.rescan_file("Pages/Body.md")
    auto = {r.summary.path for r in space.rows(search=(["zzbody"], "auto"))}
    title = {r.summary.path for r in space.rows(search=(["zzbody"], "title"))}
    assert auto == {"Pages/Body.md"}
    assert title == set()
    client = TestClient(create_app(space, watch=False))
    res = client.post("/api/rows", json={"search": {"terms": ["a"], "mode": "auto"}})
    assert res.status_code == 422
    res = client.post("/api/rows", json={"search": {"terms": ["zzbody"], "mode": "auto"}})
    assert [r["summary"]["path"] for r in res.json()["rows"]] == ["Pages/Body.md"]


def test_rows_search_terms_or(space_dir):
    space = Space(space_dir)
    _write(space_dir, "Pages/A.md", "---\ntype: 'Page'\ntitle: Alpha one\n---\n\nnothing\n")
    _write(space_dir, "Pages/B.md", "---\ntype: 'Page'\ntitle: Beta\n---\n\nhas zzbody\n")
    space.rescan_file("Pages/A.md")
    space.rescan_file("Pages/B.md")
    auto = {r.summary.path for r in space.rows(search=(["alpha one", "zzbody"], "auto"))}
    assert {"Pages/A.md", "Pages/B.md"} <= auto
    title = {r.summary.path for r in space.rows(search=(["alpha one", "zzbody"], "title"))}
    assert "Pages/A.md" in title and "Pages/B.md" not in title
    with_miss = {r.summary.path for r in space.rows(search=(["alpha one", "qqqqnothing"], "title"))}
    assert "Pages/A.md" in with_miss


def test_body_preview_strips_markdown():
    assert body_preview("# T\n\n## Head\n- [x] **done** [[A|b]]\n") == "Head done b"
    assert body_preview("") == ""
    assert body_preview("[[A]] and <b>x</b>\n```\ncode\n```\n| a | b |\n> quote") == "A and x quote"
    long = body_preview("word " * 200)
    assert len(long) <= 280 and long.endswith("…") and " …" not in long


def test_rows_exclude_templates_include_readonly(full_space_dir):
    space = Space(full_space_dir)
    paths = {r.summary.path for r in space.rows()}
    assert paths == {s.path for s in space.list()}
    assert not any(p.startswith("Templates/") for p in paths)
    assert any(s.readOnly for s in space.list())
    assert any(r.summary.readOnly for r in space.rows())


def test_summary_collections_raw_names(space_dir):
    space = Space(space_dir)
    _write(
        space_dir,
        "Pages/C.md",
        "---\ntype: 'Page'\ntitle: C\ncollections: [Tooling, 'Reading list']\n---\n",
    )
    space.rescan_file("Pages/C.md")
    assert space.get("Pages/C.md").collections == ["Tooling", "Reading list"]
    assert space.get("Pages/Notes.md").collections == []


def test_rows_never_write(space_dir):
    space = Space(space_dir)
    client = TestClient(create_app(space, watch=False))
    before = _hashes(space_dir)
    res = client.post("/api/rows", json={})
    assert res.status_code == 200
    assert len(res.json()["rows"]) == len(space.list())
    assert _hashes(space_dir) == before


def test_rows_carry_backlinks(links_space_dir):
    """M5 Task 2: the `entity_backlinks` definition's key holds the live backlinks."""
    space = Space(links_space_dir)
    rows = _by_path(space.rows())
    ada = rows["People/Ada Lovelace.md"]
    assert ada.values["backlinks"] == space.backlinks("People/Ada Lovelace.md")
    assert {"target": "Charles Babbage", "path": "People/Charles Babbage.md"} in ada.values[
        "backlinks"
    ]
    assert all(set(r) == {"target", "path"} for r in ada.values["backlinks"])
    assert rows["People/Charles Babbage.md"].values["backlinks"] == space.backlinks(
        "People/Charles Babbage.md"
    )
    # Page has no backlinks definition: its rows still carry the system id `backlinks`
    # (M5 Task 13), so "No backlinks" and the Task "Context" section work on every type.
    page_type = space.type_by_id("page")
    assert not any(p.type == "entity_backlinks" for p in page_type.propertyDefinitions)
    engine = "Pages/Analytical Engine.md"
    assert rows[engine].values["backlinks"] == space.backlinks(engine)
    assert rows[engine].values["backlinks"]
    task_type = space.type_by_id("task")
    assert not any(p.type == "entity_backlinks" for p in task_type.propertyDefinitions)
    assert rows["Tasks/Draft outline.md"].values["backlinks"] == space.backlinks(
        "Tasks/Draft outline.md"
    )
    # Through the route too.
    client = TestClient(create_app(space, watch=False))
    res = client.post("/api/rows", json={"typeIds": ["project"]})
    (diff,) = res.json()["rows"]
    assert diff["values"]["backlinks"] == [
        {"target": "Draft outline", "path": "Tasks/Draft outline.md"}
    ]
