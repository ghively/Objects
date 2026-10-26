"""The M2 acceptance fixtures in `space-sample` load as the plan describes (Task 20)."""

from pathlib import Path

from objectapp.propvalues import decode_value
from objectapp.space import Space


def _snapshot(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*.md")}


def test_full_sample_loads_project_tag_and_template(full_space_dir: Path):
    before = _snapshot(full_space_dir)
    space = Space(full_space_dir)

    names = {t.name for t in space.types}
    assert {"Project", "Tag", "Task", "Page"} <= names
    project = next(t for t in space.types if t.name == "Project")
    kinds = {p.key: p.type for p in project.propertyDefinitions}
    assert kinds["budget"] == "number"
    assert kinds["done"] == "boolean"
    assert kinds["site"] == "url"
    assert kinds["timeFrame"] == "datetime"
    assert kinds["lead"] == "entity" and kinds["members"] == "entity"

    paths = [s.path for s in space.list()]
    assert "Projects/Object app.md" in paths
    assert "Tags/Docs.md" in paths
    assert not any(p.startswith("Templates/") for p in paths)

    docs = space.get("Tags/Docs.md")
    assert docs.color == "bg-blue"

    task = next(t for t in space.types if t.name == "Task")
    assert [s.path for s in space.list_templates(task.id)] == ["Templates/Tasks/Bug report.md"]

    # Opening never writes an object file.
    assert _snapshot(full_space_dir) == before


def test_kickoff_export_day_form_decodes_as_day(full_space_dir: Path):
    space = Space(full_space_dir)
    project = next(t for t in space.types if t.name == "Project")
    kickoff = next(p for p in project.propertyDefinitions if p.key == "kickoff")
    kickoff.options.setdefault("constraints", {})["resolutionPreference"] = "day"
    _, fm, _ = space.read("Projects/Object app.md")
    value = decode_value(kickoff, fm["kickoff"], fm)
    assert value["resolution"] == "day"
    assert value["start"] == "2026-03-26"
