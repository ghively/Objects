"""Graph data: nodes, undirected link pairs, tag memberships and node flags (M5 Task 5)."""

import os
import time
from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.graphdata import graph_data
from objectapp.server import create_app
from objectapp.space import Space

SLACK = float(os.environ.get("OBJECT_PERF_SLACK", "1"))

ADA = "People/Ada Lovelace.md"
ENGINE = "Pages/Analytical Engine.md"
LOOSE = "Tasks/Loose task.md"
TAGS = ("Tags/Computing.md", "Tags/History.md", "Tags/Mathematics.md", "Tags/Unused.md")


def _snapshot(root: Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file() and ".git" not in p.relative_to(root).parts
    }


def _pairs(data: dict) -> list[tuple[int, int]]:
    flat = data["links"]
    return list(zip(flat[0::2], flat[1::2], strict=True))


def _by_path(data: dict) -> dict[str, int]:
    return {n["path"]: i for i, n in enumerate(data["nodes"])}


def test_nodes_are_non_template_objects(links_space_dir: Path):
    space = Space(links_space_dir)
    data = graph_data(space)
    paths = [n["path"] for n in data["nodes"]]
    expected = sorted(s.path for s in space._summaries.values() if s.template is None)
    assert paths == expected
    assert not any(p.startswith("Templates/") for p in paths)
    ada = data["nodes"][paths.index(ADA)]
    assert ada["title"] == "Ada Lovelace"
    assert ada["type"] == space._summaries[ADA].type
    assert set(ada) == {
        "path",
        "title",
        "type",
        "icon",
        "degree",
        "tag",
        "daily",
        "done",
    }


def test_links_are_distinct_undirected_pairs(links_space_dir: Path):
    space = Space(links_space_dir)
    data = graph_data(space)
    nodes = data["nodes"]
    pairs = _pairs(data)
    assert all(a < b for a, b in pairs)
    assert len(pairs) == len(set(pairs))
    idx = _by_path(data)
    # Analytical Engine links Ada twice in its body: one pair.
    ada_engine = tuple(sorted((idx[ADA], idx[ENGINE])))
    assert pairs.count(ada_engine) == 1
    as_paths = {(nodes[a]["path"], nodes[b]["path"]) for a, b in pairs}
    assert as_paths == set(space.links.edges())


def test_degree_counts_distinct_neighbours(links_space_dir: Path):
    space = Space(links_space_dir)
    data = graph_data(space)
    neighbours: dict[int, set[int]] = {}
    for a, b in _pairs(data):
        neighbours.setdefault(a, set()).add(b)
        neighbours.setdefault(b, set()).add(a)
    for i, n in enumerate(data["nodes"]):
        assert n["degree"] == len(neighbours.get(i, ())), n["path"]
    idx = _by_path(data)
    assert data["nodes"][idx[LOOSE]]["degree"] == 0
    assert data["nodes"][idx[ADA]]["degree"] >= 2


def test_flags_tag_daily_done(links_space_dir: Path):
    data = graph_data(Space(links_space_dir))
    by = {n["path"]: n for n in data["nodes"]}
    assert by["Tasks/Write paper.md"]["done"] is True
    assert by["Tasks/Draft outline.md"]["done"] is False
    assert by[LOOSE]["done"] is False
    assert by["DailyNotes/2026-10-23.md"]["daily"] is True
    assert by[ADA]["daily"] is False
    assert {p for p, n in by.items() if n["tag"]} == set(TAGS)
    assert not any(n["done"] for p, n in by.items() if not p.startswith("Tasks/"))


def test_tagged_pairs(links_space_dir: Path):
    data = graph_data(Space(links_space_dir))
    nodes = data["nodes"]
    flat = data["tagged"]
    tagged = [
        (nodes[o]["path"], nodes[t]["path"])
        for o, t in zip(flat[0::2], flat[1::2], strict=True)
    ]
    assert len(tagged) == len(set(tagged))
    ada_tags = [t for o, t in tagged if o == ADA]
    assert ada_tags == ["Tags/Mathematics.md", "Tags/Computing.md"]
    assert not any(t == "Tags/Unused.md" for _o, t in tagged)
    assert all(nodes[t]["tag"] for t in flat[1::2])


def test_graph_follows_edits(links_space_dir: Path):
    space = Space(links_space_dir)
    before = graph_data(space)
    idx = _by_path(before)
    pair = tuple(sorted((idx[LOOSE], idx[ADA])))
    assert pair not in _pairs(before)
    _of, _fm, version = space.read(LOOSE)
    space.save_body(LOOSE, "See [[Ada Lovelace]].\n", version)
    after = graph_data(space)
    assert pair in _pairs(after)
    assert after["nodes"][idx[LOOSE]]["degree"] == 1
    assert after["nodes"][idx[ADA]]["degree"] == before["nodes"][idx[ADA]]["degree"] + 1


def test_graph_get_writes_nothing(links_space_dir: Path):
    before = _snapshot(links_space_dir)
    space = Space(links_space_dir)
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    with TestClient(app) as c:
        r = c.get("/api/graph")
        assert r.status_code == 200
        body = r.json()
        assert body == graph_data(space)
        assert set(body) == {"nodes", "links", "tagged"}
    assert _snapshot(links_space_dir) == before


def test_graph_5000_objects_under_300ms(big_space_dir: Path, big_space_stats):
    space = Space(big_space_dir)
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    with TestClient(app) as c:
        warm = c.get("/api/graph")  # builds the link index (its own budget: < 2 s)
        assert warm.status_code == 200
        times = []
        for _ in range(3):
            t0 = time.perf_counter()
            r = c.get("/api/graph")
            times.append(time.perf_counter() - t0)
            assert r.status_code == 200
        body = r.json()
    assert len(body["nodes"]) == big_space_stats.objects
    assert len(body["links"]) // 2 == big_space_stats.distinct_pairs
    assert min(times) < 0.3 * SLACK, times
