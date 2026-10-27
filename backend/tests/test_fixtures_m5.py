"""The M5 fixtures: `space-links`, the large-space generator and cache isolation (M5 Task 1)."""

import json
import os
import re
from pathlib import Path

from bigspace import make_big_space
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.space import Space
from objectapp.textfile import decode

INVENTORY = {
    "People/Ada Lovelace.md",
    "People/Charles Babbage.md",
    "Archive/Ada Lovelace.md",
    "Archive/Mention from archive.md",
    "Pages/Analytical Engine.md",
    "Pages/Notes on mentions.md",
    "Pages/CRLF mention.md",
    "Pages/Self link.md",
    "Pages/Dangling.md",
    "Pages/Unicode Café.md",
    "Pages/Broken.md",
    "Projects/Difference Engine.md",
    "Tasks/Write paper.md",
    "Tasks/Draft outline.md",
    "Tasks/Loose task.md",
    "Tags/Computing.md",
    "Tags/History.md",
    "Tags/Mathematics.md",
    "Tags/Unused.md",
    "DailyNotes/2026-10-23.md",
    "Templates/Pages/Linking template.md",
}

_LINK = re.compile(r"\[\[[^\]\n]+\]\]")


def _snapshot(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def _fm(root: Path, rel: str) -> dict:
    of = split_object(decode((root / rel).read_bytes()).text)
    assert of.fm_ok and of.frontmatter_src is not None, rel
    return parse_fm(of.frontmatter_src)


def test_every_md_has_unique_path_and_expected_inventory(links_space_dir: Path):
    root = links_space_dir
    rels = {p.relative_to(root).as_posix() for p in root.rglob("*.md")}
    assert rels == INVENTORY
    assert len({r.lower() for r in rels}) == len(rels)
    assert not (root / ".capacities" / "ui.json").exists()
    types = {p.stem for p in (root / ".capacities" / "types").glob("*.json")}
    assert types == {"page", "tag", "task", "dailynote", "person", "project"}

    crlf = (root / "Pages" / "CRLF mention.md").read_bytes()
    assert crlf.startswith(b"\xef\xbb\xbf---\r\n")
    assert b"\r\n" in crlf and b"\n" not in crlf.replace(b"\r\n", b"")
    assert b"Analytical Engine" in crlf

    space = Space(root)
    broken = space._raw["Pages/Broken.md"]
    assert broken.readOnly
    for rel in INVENTORY - {"Pages/Broken.md"}:
        assert not space._raw[rel].readOnly, rel

    # The pieces the M5 tests rely on.
    person = json.loads((root / ".capacities/types/person.json").read_text("utf-8"))
    pprops = {p["key"]: p for p in person["propertyDefinitions"]}
    assert pprops["manager"]["type"] == "entity"
    assert pprops["manager"]["options"]["allowedTypes"] == ["person"]
    assert pprops["notes"]["isNotSearchable"] is True
    assert pprops["backlinks"]["type"] == "entity_backlinks"
    project = json.loads((root / ".capacities/types/project.json").read_text("utf-8"))
    jprops = {p["key"]: p for p in project["propertyDefinitions"]}
    assert jprops["members"]["options"]["isArray"] is True
    assert jprops["summary"]["type"] == "text"
    assert jprops["backlinks"]["type"] == "entity_backlinks"

    ada = _fm(root, "People/Ada Lovelace.md")
    assert ada["aliases"] == ["Ada", "Countess of Lovelace"]
    assert _fm(root, "People/Charles Babbage.md")["manager"] == "[[Ada Lovelace]]"
    assert _fm(root, "Projects/Difference Engine.md")["members"] == [
        "[[Ada Lovelace]]", "[[Charles Babbage]]"
    ]
    assert _fm(root, "Templates/Pages/Linking template.md")["template"] == "Linking template"
    assert _fm(root, "Tasks/Write paper.md")["status"] == "Done"

    # Resolution order: the People one by oldest createdAt, the Archive one from its folder.
    assert space.resolve("[[Ada Lovelace]]", "Pages/Analytical Engine.md") == "People/Ada Lovelace.md"
    assert space.resolve("[[Ada Lovelace]]", "Archive/Mention from archive.md") == "Archive/Ada Lovelace.md"
    assert space.resolve("[[Nobody Here]]", "Pages/Dangling.md") is None

    engine = decode((root / "Pages/Analytical Engine.md").read_bytes()).text
    assert engine.count("[[Ada Lovelace]]") == 3  # two links, one inside the code block
    assert "```\n[[Not A Link]]" in engine and "`[[Charles Babbage]]`" in engine
    assert "[[Charles Babbage|Babbage]]" in engine and re.search(r"(?<!\w)ada(?!\w)", engine)


def test_space_opens_without_writing(links_space_dir: Path):
    before = _snapshot(links_space_dir)
    Space(links_space_dir)
    Space(links_space_dir)
    assert _snapshot(links_space_dir) == before


def test_big_space_is_deterministic_and_sized(tmp_path: Path):
    a, b = tmp_path / "a", tmp_path / "b"
    stats_a = make_big_space(a)
    stats_b = make_big_space(b)
    assert stats_a == stats_b
    assert _snapshot(a) == _snapshot(b)

    mds = list(a.rglob("*.md"))
    assert len(mds) == stats_a.objects == 5000
    written = sum(len(_LINK.findall(p.read_text("utf-8"))) for p in mds)
    assert written == stats_a.links
    assert abs(written - 50000) <= 500
    assert 0 < stats_a.distinct_pairs <= written
    assert len(stats_a.sample_titles) == 20
    for title in stats_a.sample_titles:
        assert any(a.glob(f"*/{title}.md")), title

    kinds = {p.parent.name for p in mds}
    assert kinds == {"Pages", "People", "Projects", "Tasks", "Tags"}
    tagged = sum(1 for p in mds if "\ntags:\n" in p.read_text("utf-8"))
    assert abs(tagged - 5000 / 3) < 200

    # A different seed gives a different space.
    assert make_big_space(tmp_path / "c", seed=2) != stats_a


def test_big_space_fixture_matches_stats(big_space_dir: Path, big_space_stats):
    assert len(list(big_space_dir.rglob("*.md"))) == big_space_stats.objects


def test_cache_env_points_into_tmp(links_space_dir: Path, tmp_path_factory):
    cache = os.environ.get("OBJECT_CACHE_DIR")
    assert cache
    cache_path = Path(cache).resolve()
    assert cache_path.is_dir()
    assert cache_path.is_relative_to(tmp_path_factory.getbasetemp().resolve())
    assert not cache_path.is_relative_to(links_space_dir.resolve())
    assert not links_space_dir.resolve().is_relative_to(cache_path)
