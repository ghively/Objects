import hashlib
from pathlib import Path

import pytest

from objectapp.space import ObjectSummary, Space
from objectapp.typedefs import infer_types_from, iter_object_paths, read_raw
from objectapp.typemodel import load_types


def infer_types(root: Path):
    return infer_types_from(read_raw(root, rel) for rel in iter_object_paths(root))


def _by_name(types):
    return {t.name: t for t in types}


def _hashes(root: Path) -> dict[str, tuple[str, int]]:
    out = {}
    for p in root.rglob("*"):
        if p.is_file():
            out[p.relative_to(root).as_posix()] = (
                hashlib.sha256(p.read_bytes()).hexdigest(),
                p.stat().st_mtime_ns,
            )
    return out


def test_infers_types_from_type_field(space_dir):
    types = _by_name(infer_types(space_dir))
    assert set(types) == {"Task", "Person", "Server", "DailyNote", "Page"}
    assert types["Task"].pluralName == "Tasks" and types["Task"].folder == "Tasks"
    assert types["Person"].pluralName == "People"
    assert types["Server"].pluralName == "Servers"
    assert types["DailyNote"].pluralName == "DailyNotes"
    assert types["Page"].pluralName == "Pages"
    assert types["Task"].id == "task"
    assert types["Task"].icon.val == "ph-check-circle"
    assert types["Person"].icon.val == "ph-user"
    assert types["Server"].icon.val == "ph-hard-drives"
    assert types["DailyNote"].icon.val == "ph-calendar-blank"
    assert types["Page"].icon.val == "ph-file-text"
    colors = [t.color for t in types.values()]
    assert len(set(colors)) == len(colors)
    # ignored folders contribute no types
    assert "Cache" not in types and "Hidden" not in types


def test_property_kinds_inferred(space_dir):
    types = _by_name(infer_types(space_dir))

    def prop(type_name, key):
        return {p.key: p for p in types[type_name].propertyDefinitions}[key]

    assert prop("DailyNote", "reviewed").type == "boolean"
    assert prop("DailyNote", "date").type == "datetime"
    tags = prop("Task", "tags")
    assert tags.type == "entity_tags" and tags.id == "tags" and tags.options["isArray"] is True
    assert prop("Task", "status").type == "label"
    assert prop("Server", "cores").type == "number"
    assert prop("Server", "owner").type == "entity"
    assert prop("Person", "website").type == "url"
    # system keys are system definitions (id == key, an entity_* kind), never plain properties
    for p in types["Task"].propertyDefinitions:
        if p.key in {"title", "icon", "createdAt", "lastUpdated", "description", "aliases"}:
            assert p.type.startswith("entity_") and p.id == p.key
    assert not {p.key for p in types["Task"].propertyDefinitions} & {"id", "type"}


def test_type_files_written_once(space_dir):
    types_dir = space_dir / ".object" / "types"
    assert not types_dir.exists()
    first, unreadable = load_types(space_dir)
    assert unreadable == []
    files = sorted(types_dir.glob("*.json"))
    assert {f.stem for f in files} == {t.id for t in first}
    assert {"page", "tag"} <= {t.id for t in first}
    before = {f.name: f.stat().st_mtime_ns for f in files}
    second, _ = load_types(space_dir)
    after = {f.name: f.stat().st_mtime_ns for f in sorted(types_dir.glob("*.json"))}
    assert before == after
    assert [t.id for t in second] == [t.id for t in first]
    assert second == first


def test_tag_present_and_tags_system_def(space_dir):
    s = Space(space_dir)
    tag = next(t for t in s.types if t.id == "tag")
    assert tag.name == "Tag" and tag.folder == "Tags" and tag.basic is True
    task = next(t for t in s.types if t.id == "task")
    tags = task.prop("tags")
    assert tags is not None and tags.type == "entity_tags" and tags.id == "tags"


def test_no_frontmatter_is_page_readonly_false(space_dir):
    s = Space(space_dir)
    summary = s.get("Pages/Notes.md")
    assert isinstance(summary, ObjectSummary)
    assert summary.type == "page"
    assert summary.readOnly is False


def test_broken_frontmatter_readonly_true(space_dir):
    s = Space(space_dir)
    for path in ("Pages/Broken.md", "Pages/Bad yaml.md"):
        summary = s.get(path)
        assert summary.type == "page"
        assert summary.readOnly is True
        of, fm, _version = s.read(path)
        assert fm == {}


def test_title_fallbacks(space_dir):
    s = Space(space_dir)
    assert s.get("Tasks/Write docs.md").title == "Write docs"
    assert s.get("Pages/Notes.md").title == "Meeting notes"
    assert s.get("Pages/Untitled stem.md").title == "Untitled stem"
    assert s.get("DailyNotes/2026-10-23.md").title == "2026-10-23"


def test_summary_fields(space_dir):
    s = Space(space_dir)
    w = s.get("Tasks/Write docs.md")
    assert w.type == "task"
    assert w.icon == "ph-pencil"
    assert w.tags == ["Docs"]
    assert w.createdAt == "2026-03-01T09:00:00.000Z"
    assert w.lastUpdated == "2026-03-02T10:00:00.000Z"
    assert w.id is None
    assert [o.path for o in s.list("task")] == ["Tasks/Fix printer.md", "Tasks/Write docs.md"]
    all_paths = {o.path for o in s.list(None)}
    assert "Pages/Alpha.md" in all_paths and "Servers/Alpha.md" in all_paths
    assert not any(p.startswith(".") for p in all_paths)
    with pytest.raises(KeyError):
        s.get("Nope/missing.md")


def test_read_returns_version(space_dir):
    s = Space(space_dir)
    of, fm, version = s.read("Tasks/Fix printer.md")
    raw = (space_dir / "Tasks" / "Fix printer.md").read_bytes()
    assert version == hashlib.sha256(raw).hexdigest()
    assert fm["status"] == "In Progress"
    assert "\r" not in of.body


def test_paths_outside_space_rejected(space_dir):
    s = Space(space_dir)
    with pytest.raises((KeyError, ValueError)):
        s.read("../outside.md")


def test_resolve_same_folder_first(space_dir):
    s = Space(space_dir)
    assert s.resolve("Alpha", "Pages/x.md") == "Pages/Alpha.md"
    assert s.resolve("Alpha", "Servers/Other.md") == "Servers/Alpha.md"
    # elsewhere: oldest createdAt wins (the server predates the page)
    assert s.resolve("Alpha", "People/Ada Lovelace.md") == "Servers/Alpha.md"
    assert s.resolve("Alpha", None) == "Servers/Alpha.md"


def test_resolve_alias_and_case_insensitive(space_dir):
    s = Space(space_dir)
    assert s.resolve("Ada", None) == "People/Ada Lovelace.md"
    assert s.resolve("Countess of Lovelace", None) == "People/Ada Lovelace.md"
    assert s.resolve("ada lovelace", None) == "People/Ada Lovelace.md"
    assert s.resolve("[[Ada Lovelace]]", None) == "People/Ada Lovelace.md"
    assert s.resolve("Ada Lovelace|the countess", None) == "People/Ada Lovelace.md"
    assert s.resolve('What if? A/B: "test" <1|2>', None) == "Pages/What if.md"


def test_resolve_unknown_none(space_dir):
    s = Space(space_dir)
    assert s.resolve("Nobody here", None) is None
    assert s.resolve("", None) is None


def test_rescan_file(space_dir):
    s = Space(space_dir)
    p = space_dir / "People" / "Grace Hopper.md"
    p.write_bytes(b"---\ntype: 'Person'\ntitle: Grace Hopper\n---\n")
    s.rescan_file("People/Grace Hopper.md")
    assert s.get("People/Grace Hopper.md").type == "person"
    assert s.resolve("Grace Hopper", None) == "People/Grace Hopper.md"
    p.unlink()
    s.rescan_file("People/Grace Hopper.md")
    with pytest.raises(KeyError):
        s.get("People/Grace Hopper.md")
    assert s.resolve("Grace Hopper", None) is None


def test_open_never_writes(space_dir):
    s = Space(space_dir)  # may create .object/types on first load
    before = _hashes(space_dir)
    s2 = Space(space_dir)
    for summary in s2.list(None):
        s2.read(summary.path)
        s2.get(summary.path)
        s2.resolve(summary.title, summary.path)
    for t in s2.types:
        s2.list(t.id)
    assert _hashes(space_dir) == before
