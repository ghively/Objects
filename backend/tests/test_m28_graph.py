"""M28 Task 6: the graph labels relation edges.

Plan ``docs/superpowers/plans/2026-11-09-m28-itops-starter-and-relations.md``, Task 6 and
"Our calls" 13: ``GraphData.linkLabels`` holds one label per ``links`` pair, the stored names
of the relation properties that make the link (both directions joined by " · ", the pair's
first node's names first), and ``None`` for a pair linked only by body text. Every test runs
on a copy of the ``space-itops`` fixture.
"""

from __future__ import annotations

import copy
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.graphdata import graph_data
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.typemodel import type_revision

FIXTURE = Path(__file__).parent / "fixtures" / "space-itops"

APP01 = "Hosts/APP-TEST-01.md"
INVENTORY = "Applications/Inventory app.md"
SQL = "Software/SQL Server 2019.md"
WEB = "Containers/inventory-web.md"
RACK_NOTES = "Pages/Rack notes.md"


@pytest.fixture
def itops_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    dst = tmp_path / "space-itops"
    shutil.copytree(FIXTURE, dst)
    return dst


def _labels(data: dict) -> dict[tuple[str, str], str | None]:
    """``(path a, path b) -> label`` for each pair, in the pair's own order."""
    nodes = data["nodes"]
    flat = data["links"]
    return {
        (nodes[flat[2 * k]]["path"], nodes[flat[2 * k + 1]]["path"]): data[
            "linkLabels"
        ][k]
        for k in range(len(flat) // 2)
    }


def _label(data: dict, x: str, y: str) -> str | None:
    labels = _labels(data)
    assert (x, y) in labels or (y, x) in labels, (x, y)
    return labels.get((x, y), labels.get((y, x)))


def _snapshot(root: Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def test_graph_labels(itops_dir: Path):
    before = _snapshot(itops_dir)
    data = graph_data(Space(itops_dir))
    assert len(data["linkLabels"]) == len(data["links"]) // 2
    assert _label(data, INVENTORY, APP01) == "Runs on"
    assert _label(data, INVENTORY, SQL) == "Uses"
    # Body link only: the Page's `runsOn` front matter names DB-TEST-01, not APP-TEST-01.
    assert _label(data, RACK_NOTES, APP01) is None
    # The alias link (`[[app01]]`) is labelled like any other.
    assert _label(data, WEB, APP01) == "Runs on"
    # Reading the graph writes nothing.
    assert _snapshot(itops_dir) == before


def test_a_pair_linked_both_ways_joins_both_names(itops_dir: Path):
    # Inventory app also runs on its container, which is part of it: the pair is linked by a
    # relation from each side. Inventory app (Applications/) is the pair's first node.
    p = itops_dir / INVENTORY
    text = p.read_text(encoding="utf-8")
    p.write_text(
        text.replace(
            "runsOn:\n  - '[[APP-TEST-01]]'\n",
            "runsOn:\n  - '[[APP-TEST-01]]'\n  - '[[inventory-web]]'\n",
        ),
        encoding="utf-8",
        newline="\n",
    )
    data = graph_data(Space(itops_dir))
    nodes = data["nodes"]
    labels = _labels(data)
    assert labels[(INVENTORY, WEB)] == "Runs on · Part of"
    assert nodes.index(next(n for n in nodes if n["path"] == INVENTORY)) < nodes.index(
        next(n for n in nodes if n["path"] == WEB)
    )


def test_a_relation_and_a_body_link_keep_the_relation_name(itops_dir: Path):
    # A body link next to a relation in the same direction leaves the label as the relation's.
    p = itops_dir / INVENTORY
    p.write_text(
        p.read_text(encoding="utf-8") + "\nSee [[APP-TEST-01]].\n",
        encoding="utf-8",
        newline="\n",
    )
    data = graph_data(Space(itops_dir))
    assert _label(data, INVENTORY, APP01) == "Runs on"


def test_labels_follow_a_renamed_property(itops_dir: Path):
    space = Space(itops_dir)
    assert _label(graph_data(space), INVENTORY, SQL) == "Uses"
    app = copy.deepcopy(space.type_by_id("application"))
    assert app is not None
    uses = app.prop("uses")
    assert uses is not None
    uses.name = "Depends on"
    space.save_type(app, type_revision(space.root, "application"))
    assert _label(graph_data(space), INVENTORY, SQL) == "Depends on"


def test_api_graph_carries_link_labels(itops_dir: Path):
    client = TestClient(create_app(Space(itops_dir), None, watch=False))
    r = client.get("/api/graph")
    assert r.status_code == 200
    data = r.json()
    assert len(data["linkLabels"]) == len(data["links"]) // 2
    assert _label(data, INVENTORY, APP01) == "Runs on"
    assert _label(data, RACK_NOTES, APP01) is None
