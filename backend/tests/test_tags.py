"""Tags as objects, icons and cover images (Task 10)."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.frontmatter import parse_fm
from objectapp.media import import_image, list_images
from objectapp.objfile import split_object
from objectapp.relink import rewrite_tag_lists
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.typemodel import THEME_COLORS

DOCS_TAG = (
    "---\nid: 01TAGDOCS00000000000000000\ntype: 'Tag'\ntitle: Docs\ncolor: bg-blue\n"
    "createdAt: 2026-03-01T09:00:00.000Z\nlastUpdated: 2026-03-01T09:00:00.000Z\n---\n"
)
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16

OCTET = {"content-type": "application/octet-stream"}


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode())
    return path


def _docs_tag(space_dir: Path) -> Path:
    return _write(space_dir / "Tags" / "Docs.md", DOCS_TAG)


def _fm(space_dir: Path, rel: str) -> dict:
    of = split_object((space_dir / rel).read_text(encoding="utf-8"))
    return parse_fm(of.frontmatter_src or "")


def _changed_lines(before: bytes, after: bytes) -> list[tuple[str, str]]:
    a = before.decode().splitlines()
    b = after.decode().splitlines()
    assert len(a) == len(b)
    return [(x, y) for x, y in zip(a, b, strict=True) if x != y]


# -- ensure_tag -------------------------------------------------------------------


def test_ensure_tag_creates_once(space_dir: Path):
    space = Space(space_dir)
    path, created = space.ensure_tag("Research")
    assert (path, created) == ("Tags/Research.md", True)
    text = (space_dir / path).read_text(encoding="utf-8")
    of = split_object(text)
    fm = parse_fm(of.frontmatter_src or "")
    assert list(fm) == ["id", "type", "title", "color", "createdAt", "lastUpdated"]
    assert fm["type"] == "Tag" and fm["title"] == "Research"
    assert "type: 'Tag'\n" in text
    assert of.body.strip() == ""
    assert space.get(path).type == "tag"
    before = (space_dir / path).read_bytes()
    assert space.ensure_tag("Research") == (path, False)
    assert (space_dir / path).read_bytes() == before
    assert len(list((space_dir / "Tags").iterdir())) == 1


def test_ensure_tag_matches_case_insensitively(space_dir: Path):
    _docs_tag(space_dir)
    space = Space(space_dir)
    assert space.ensure_tag("  docs ") == ("Tags/Docs.md", False)
    assert space.ensure_tag("DOCS") == ("Tags/Docs.md", False)
    assert sorted(p.name for p in (space_dir / "Tags").iterdir()) == ["Docs.md"]


def test_ensure_tag_unsafe_name_and_empty(space_dir: Path):
    space = Space(space_dir)
    path, created = space.ensure_tag("A/B")
    assert created and path == "Tags/A.md"
    assert _fm(space_dir, path)["title"] == "A/B"
    with pytest.raises(ValueError):
        space.ensure_tag("   ")


def test_tag_color_from_palette(space_dir: Path):
    space = Space(space_dir)
    colors = set()
    for i in range(12):
        path, _ = space.ensure_tag(f"T{i}")
        color = _fm(space_dir, path)["color"]
        assert color.startswith("bg-") and color[3:] in THEME_COLORS
        colors.add(color)
    assert len(colors) > 1  # random, not fixed


def test_summary_has_tag_color(space_dir: Path):
    _docs_tag(space_dir)
    space = Space(space_dir)
    summary = space.get("Tags/Docs.md")
    assert summary.color == "bg-blue"
    assert summary.type == "tag"
    assert space.get("Tasks/Write docs.md").color is None


def test_set_tag_color_and_icon(space_dir: Path):
    path = _docs_tag(space_dir)
    space = Space(space_dir)
    version = space.cached_version("Tags/Docs.md")
    result = space.update_properties(
        "Tags/Docs.md",
        {"color": "bg-red", "icon": {"type": "iconify", "val": "ph-star", "color": "red"}},
        version,
    )
    text = path.read_text(encoding="utf-8")
    assert "\ncolor: bg-red\n" in text
    assert "\nicon: ph-star\n" in text
    assert "\niconColor: red\n" in text
    assert result.frontmatter["color"] == "bg-red"
    summary = space.get("Tags/Docs.md")
    assert (summary.color, summary.icon, summary.iconColor) == ("bg-red", "ph-star", "red")


# -- renaming a tag ---------------------------------------------------------------


def test_rewrite_tag_lists_flow_and_block():
    src = "title: X\ntags: [Docs, 'Other one']\n"
    out = rewrite_tag_lists(src, parse_fm(src), "docs", "Documentation")
    assert out == "title: X\ntags: [Documentation, 'Other one']\n"
    block = "tags:\n  - 'Docs'\n  - Other\nx: 1\n"
    out = rewrite_tag_lists(block, parse_fm(block), "Docs", "Documentation")
    assert out == "tags:\n  - 'Documentation'\n  - Other\nx: 1\n"
    untouched = "tags: [Other]\n"
    assert rewrite_tag_lists(untouched, parse_fm(untouched), "Docs", "New") is untouched


def test_rename_tag_rewrites_tags_lists_one_line_each(space_dir: Path):
    _docs_tag(space_dir)
    block = _write(
        space_dir / "Pages" / "Block tags.md",
        "---\r\ntype: 'Page'\r\ntitle: Block tags\r\ntags:\r\n  - Docs\r\n  - Other\r\n"
        "lastUpdated: 2026-01-01T00:00:00.000Z\r\n---\r\nBody\r\n",
    )
    task = space_dir / "Tasks" / "Write docs.md"
    task_before = task.read_bytes()
    block_before = block.read_bytes()
    space = Space(space_dir)
    result = space.rename_object(
        "Tags/Docs.md", "Documentation", space.cached_version("Tags/Docs.md")
    )
    assert result.path == "Tags/Documentation.md"
    assert sorted(result.relinked) == ["Pages/Block tags.md", "Tasks/Write docs.md"]
    assert result.skipped == []
    assert _changed_lines(task_before, task.read_bytes()) == [
        ("tags: [Docs]", "tags: [Documentation]")
    ]
    assert _changed_lines(block_before, block.read_bytes()) == [("  - Docs", "  - Documentation")]
    assert b"\r\n" in block.read_bytes() and b"\n" not in block.read_bytes().replace(b"\r\n", b"")
    assert space.get("Tasks/Write docs.md").tags == ["Documentation"]


def test_rename_tag_route_announces_rewritten(space_dir: Path):
    _docs_tag(space_dir)
    space = Space(space_dir)
    client = TestClient(create_app(space, watch=False))
    res = client.post(
        "/api/object/rename",
        json={
            "path": "Tags/Docs.md",
            "title": "Documentation",
            "baseVersion": space.cached_version("Tags/Docs.md"),
        },
    )
    assert res.status_code == 200
    assert res.json()["relinked"] == ["Tasks/Write docs.md"]


def test_tag_type_listed_when_tags_folder_missing(space_dir: Path):
    assert not (space_dir / "Tags").exists()
    space = Space(space_dir)
    tag = space.type_by_id("tag")
    assert tag is not None and tag.folder == "Tags" and tag.name == "Tag"
    client = TestClient(create_app(space, watch=False))
    types = client.get("/api/space").json()["types"]
    assert any(t["id"] == "tag" and t["folder"] == "Tags" for t in types)
    assert not (space_dir / "Tags").exists()


def test_tags_ensure_route(space_dir: Path):
    client = TestClient(create_app(Space(space_dir), watch=False))
    res = client.post("/api/tags/ensure", json={"name": "Research", "clientId": "c1"})
    assert res.status_code == 200
    assert res.json() == {"path": "Tags/Research.md", "created": True}
    res = client.post("/api/tags/ensure", json={"name": "research"})
    assert res.json() == {"path": "Tags/Research.md", "created": False}
    assert client.post("/api/tags/ensure", json={"name": " "}).status_code == 422
    listed = client.get("/api/objects", params={"type": "tag"}).json()
    assert [o["path"] for o in listed] == ["Tags/Research.md"]
    assert listed[0]["color"].startswith("bg-")


# -- images ----------------------------------------------------------------------


def test_import_image_and_serve(space_dir: Path):
    _write(space_dir / ".hidden" / "x.png", "no")
    _write(space_dir / "Pages" / "pic.JPG", "jpg")
    assert list_images(space_dir) == [{"path": "Pages/pic.JPG"}]
    path = import_image(space_dir, "cover.png", PNG)
    assert path == "Attachments/cover.png"
    assert (space_dir / path).read_bytes() == PNG
    assert import_image(space_dir, "cover.png", PNG) == "Attachments/cover (2).png"
    assert import_image(space_dir, "../evil:name?.webp", PNG) == "Attachments/evil.webp"

    client = TestClient(create_app(Space(space_dir), watch=False))
    res = client.post("/api/images", params={"name": "shot.png"}, content=PNG, headers=OCTET)
    assert res.status_code == 201
    assert res.json() == {"path": "Attachments/shot.png"}
    listed = [i["path"] for i in client.get("/api/images").json()]
    assert "Attachments/shot.png" in listed and "Pages/pic.JPG" in listed
    res = client.get("/api/file", params={"path": "Attachments/shot.png"})
    assert res.status_code == 200
    assert res.content == PNG
    assert res.headers["content-type"] == "image/png"
    assert client.get("/api/file", params={"path": "Attachments/none.png"}).status_code == 404
    assert client.post("/api/images", params={"name": "a.exe"}, content=b"MZ", headers=OCTET).status_code == 415


def test_file_route_refuses_non_image_415(space_dir: Path):
    client = TestClient(create_app(Space(space_dir), watch=False))
    res = client.get("/api/file", params={"path": "Pages/Alpha.md"})
    assert res.status_code == 415


def test_file_route_refuses_outside_space(space_dir: Path):
    outside = space_dir.parent / "outside.png"
    outside.write_bytes(PNG)
    _write(space_dir / ".hidden" / "secret.png", "x")
    client = TestClient(create_app(Space(space_dir), watch=False))
    for path in ("../outside.png", str(outside), ".hidden/secret.png", "Pages/../../outside.png"):
        res = client.get("/api/file", params={"path": path})
        assert res.status_code == 404, path
