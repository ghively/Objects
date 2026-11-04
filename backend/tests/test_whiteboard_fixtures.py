"""M6 Task 1: the synthetic `space-whiteboard` fixture and its support module."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from objectapp.space import Space
from wb_support import FIXTURE, copy_whiteboard_space, tree_hashes

ALL_SHAPES = {
    "rectangle", "roundedRectangle", "ellipse", "diamond", "triangle", "triangleDown",
    "star", "parallelogram", "bubble", "blockArrow", "blockArrowLeft", "heart",
}
GATE_LABELS = {"NOT", "AND", "NAND", "OR", "NOR", "XOR", "XNOR", "HIGH", "LOW"}


@pytest.fixture
def wb_dir(tmp_path: Path) -> Path:
    return copy_whiteboard_space(tmp_path)


def _board(name: str) -> dict:
    return json.loads((FIXTURE / "Whiteboards" / f"{name}.whiteboard.json").read_text("utf-8"))


def test_every_md_has_frontmatter_and_unique_paths():
    mds = sorted(FIXTURE.rglob("*.md"))
    assert mds
    ids = []
    for p in mds:
        text = p.read_text("utf-8")
        assert text.startswith("---\n"), p
        head = text.split("---\n", 2)[1]
        m = re.search(r"^id: (\S+)$", head, re.M)
        assert m, p
        ids.append(m.group(1))
        assert re.search(r"^type: '\w+'$", head, re.M), p
        assert re.search(r"^title: .+$", head, re.M), p
    assert len(set(ids)) == len(ids)
    lowered = [p.relative_to(FIXTURE).as_posix().lower() for p in mds]
    assert len(set(lowered)) == len(lowered)


def test_space_opens_without_writing(wb_dir):
    before = tree_hashes(wb_dir)
    Space(wb_dir)
    Space(wb_dir)
    assert tree_hashes(wb_dir) == before


def test_tree_hashes_includes_dot_folders(wb_dir):
    hashes = tree_hashes(wb_dir)
    assert ".object/types/whiteboard.json" in hashes
    assert "Whiteboards/Network map.whiteboard.json" in hashes


def test_expected_inventory():
    board = _board("Network map")
    nodes, edges, blocks = board["nodes"], board["edges"], board["blocks"]
    assert board["version"] == 1
    assert {n["shape"] for n in nodes.values() if n["kind"] == "shape"} == ALL_SHAPES
    texts = {
        blocks[n["blockId"]]["markdown"]
        for n in nodes.values()
        if n["kind"] == "shape" and n.get("shape") == "rectangle" and "blockId" in n
    }
    assert GATE_LABELS <= texts
    kinds = {n["kind"] for n in nodes.values()}
    assert kinds == {"block", "shape", "point", "frame"}
    assert sum(1 for n in nodes.values() if n["kind"] == "point") == 2
    frames = sorted(n.get("title") for n in nodes.values() if n["kind"] == "frame")
    assert frames == ["Core", "Frame 1"]
    entity_links = {b["link"] for b in blocks.values() if b["type"] == "entity"}
    assert entity_links == {"[[Router A]]", "[[Router B]]"}
    assert any(b.get("align") == "center" for b in blocks.values() if b["type"] == "text")
    shape_nodes = [n for n in nodes.values() if n["kind"] == "shape"]
    for key in ("fillColor", "borderColor", "rotation", "flipX", "flipY"):
        assert any(key in n for n in shape_nodes), key
    assert any(n.get("textVerticalAlign") == "top" for n in shape_nodes)
    assert {e.get("connection") for e in edges.values()} >= {"straight", "cornered", "curved", None}
    assert {e.get("line") for e in edges.values()} >= {"solid", "dashed", "dotted"}
    markers = {e.get(k) for e in edges.values() for k in ("markerStart", "markerEnd")}
    assert markers >= {"none", "arrow", "arrowClosed", "dot", "double"}
    assert any("color" in e for e in edges.values())
    assert any("label" in e for e in edges.values())
    assert any("blockId" in e and e["blockId"] in blocks for e in edges.values())
    assert "viewport" in board and "readingOrder" in board
    assert board["x-future"] == 1
    assert any(n.get("x-future") == 1 for n in nodes.values())
    assert any(e.get("x-future") == 1 for e in edges.values())
    for n in nodes.values():
        if "blockId" in n:
            assert n["blockId"] in blocks
    for e in edges.values():
        assert e["source"] in nodes and e["target"] in nodes

    ink = (FIXTURE / "Whiteboards" / "Network map.ink.svg").read_text("utf-8")
    paths = re.findall(r"<path [^>]*/>", ink)
    assert len(paths) == 4
    assert sum('data-tool="pen"' in p for p in paths) == 3
    assert sum('data-tool="highlighter"' in p for p in paths) == 1
    pressures = set(re.findall(r",(0\.\d+|1)(?= |\")", " ".join(re.findall(r'data-points="([^"]*)"', ink))))
    assert len(pressures) >= 4

    w = FIXTURE / "Whiteboards"
    with pytest.raises(json.JSONDecodeError):
        json.loads((w / "Broken board.whiteboard.json").read_text("utf-8"))
    assert _board("Future board")["version"] == 2
    assert _board("Foreign ink")["version"] == 1
    assert "<rect" in (w / "Foreign ink.ink.svg").read_text("utf-8")
    assert _board("Dotted v1.2 plan")["version"] == 1
    assert (w / "Orphan (2).whiteboard.json").is_file()
    assert not (w / "Orphan (2).md").exists()
    assert (w / "Empty board.md").is_file()
    assert not list(w.glob("Empty board.*.*"))
    assert not (FIXTURE / ".object" / "ui.json").exists()

    wtype = json.loads((FIXTURE / ".object/types/whiteboard.json").read_text("utf-8"))
    assert wtype["id"] == "whiteboard"
    assert wtype["name"] == "Whiteboard"
    assert wtype["pluralName"] == "Whiteboards"
    assert wtype["folder"] == "Whiteboards"
    assert wtype["icon"] == {"type": "iconify", "val": "ph-presentation"}
    assert wtype["color"] == "gray"
    assert wtype["basic"] is True
    assert wtype["schemaVersion"] == 2


def test_sidecars_are_not_objects(wb_dir):
    """Regression guard (green from the start once the files exist)."""
    paths = [s.path for s in Space(wb_dir).list()]
    assert paths
    assert all(p.endswith(".md") for p in paths)
    assert "Whiteboards/Network map.md" in paths
    by_path = {s.path: s for s in Space(wb_dir).list()}
    assert by_path["Whiteboards/Network map.md"].type == "whiteboard"
