"""The link index: wikilink spans, backlinks, property links, tags, freshness (M5 Task 2)."""

import os
import time
from pathlib import Path

from objectapp.linkindex import LinkIndex
from objectapp.relink import code_ranges, wikilink_spans
from objectapp.space import Space

SLACK = float(os.environ.get("OBJECT_PERF_SLACK", "1"))

ADA = "People/Ada Lovelace.md"
BABBAGE = "People/Charles Babbage.md"
ENGINE = "Pages/Analytical Engine.md"
DIFF = "Projects/Difference Engine.md"


def test_wikilink_spans_and_code_ranges():
    text = (
        "See [[A]] and ![[B#Part|label]] and [[C|alias]].\n"
        "```\n[[Not]]\n```\n"
        "Inline `[[Nope]]` then [[D#Heading]].\n"
    )
    spans = wikilink_spans(text)
    assert [t for t, _s, _e in spans] == ["A", "B", "C", "D"]
    for target, s, e in spans:
        piece = text[s:e]
        assert piece.endswith("]]") and target in piece
    b = spans[1]
    assert text[b[1] : b[2]] == "![[B#Part|label]]"
    assert text[spans[0][1] : spans[0][2]] == "[[A]]"
    ranges = code_ranges(text)
    assert [text[s:e] for s, e in ranges] == ["```\n[[Not]]\n```\n", "`[[Nope]]`"]
    assert wikilink_spans("no links") == []


def test_backlinks_distinct_objects(links_space_dir: Path):
    space = Space(links_space_dir)
    back = space.links.backlinks(ADA)
    assert back.count(ENGINE) == 1
    assert len(back) == len(set(back))
    # Title then path.
    titles = [(space._summaries[p].title.casefold(), p) for p in back]
    assert titles == sorted(titles)
    assert set(back) >= {
        ENGINE,
        BABBAGE,
        DIFF,
        "DailyNotes/2026-10-23.md",
        "Pages/Broken.md",
    }


def test_links_in_code_ignored(links_space_dir: Path):
    space = Space(links_space_dir)
    out = space.links.outgoing(ENGINE)
    assert out == {ADA, BABBAGE}
    assert space.links.link_keys(ENGINE, BABBAGE) == (True, [])
    # `[[Not A Link]]` would be dangling anyway; `[[Charles Babbage]]` in inline code adds nothing.
    assert space.links.backlinks(BABBAGE).count(ENGINE) == 1


def test_self_and_dangling_links_ignored(links_space_dir: Path):
    space = Space(links_space_dir)
    assert space.links.outgoing("Pages/Self link.md") == set()
    assert "Pages/Self link.md" not in space.links.backlinks("Pages/Self link.md")
    assert space.links.outgoing("Pages/Dangling.md") == set()
    for a, b in space.links.edges():
        assert a != b


def test_templates_never_sources_or_targets(links_space_dir: Path):
    space = Space(links_space_dir)
    tpl = "Templates/Pages/Linking template.md"
    assert tpl not in space.links.backlinks(ADA)
    assert space.links.outgoing(tpl) == set()
    assert all(tpl not in pair for pair in space.links.edges())
    # A link to the template's title doesn't reach it.
    rel = "Pages/Dangling.md"
    space.save_body(rel, "Points at [[Linking template]].\n", space.cached_version(rel))
    assert space.links.backlinks(tpl) == []


def test_property_and_frontmatter_links_counted(links_space_dir: Path):
    space = Space(links_space_dir)
    assert space.links.link_keys(BABBAGE, ADA) == (False, ["manager"])
    assert space.links.link_keys(DIFF, ADA) == (False, ["members"])
    assert space.links.link_keys(DIFF, BABBAGE) == (False, ["members"])
    assert space.links.link_keys(DIFF, ENGINE) == (False, ["summary"])
    assert DIFF in space.links.backlinks(ENGINE)
    assert space.links.link_keys(ADA, DIFF) == (False, [])


def test_tags_separate_from_links(links_space_dir: Path):
    space = Space(links_space_dir)
    assert space.links.tags_of(ADA) == ["Tags/Mathematics.md", "Tags/Computing.md"]
    assert space.links.tagged("Tags/Computing.md") == {
        ADA,
        BABBAGE,
        DIFF,
        "Tasks/Draft outline.md",
    }
    assert space.links.tagged("Tags/Unused.md") == set()
    tag_paths = {p for p in space._summaries if p.startswith("Tags/")}
    assert all(not (set(pair) & tag_paths) for pair in space.links.edges())
    # Case-insensitive names.
    rel = "Tasks/Loose task.md"
    space.update_properties(rel, {"tags": ["history"]}, space.cached_version(rel))
    assert space.links.tags_of(rel) == ["Tags/History.md"]
    assert rel in space.links.tagged("Tags/History.md")


def test_rename_keeps_backlinks(links_space_dir: Path):
    space = Space(links_space_dir)
    before = set(space.links.backlinks(BABBAGE))
    result = space.rename_object(BABBAGE, "Charles B", space.cached_version(BABBAGE))
    after = set(space.links.backlinks(result.path))
    assert after == before
    assert space.links.backlinks(BABBAGE) == []
    assert result.path in space.links.outgoing(ENGINE)


def test_new_same_title_object_reresolves(links_space_dir: Path):
    space = Space(links_space_dir)
    assert ENGINE in space.links.backlinks(ADA)
    rev = space.links.revision
    # A Page titled "Ada Lovelace" in the linking folder wins resolution from there.
    path, _v = space.create_object("page", "Ada Lovelace")
    assert path.startswith("Pages/")
    assert ENGINE in space.links.backlinks(path)
    assert ENGINE not in space.links.backlinks(ADA)
    assert space.links.revision > rev
    assert space.backlinks(path)[0]["path"] in space.links.backlinks(path)


def test_body_edit_updates_only_that_source(links_space_dir: Path, monkeypatch):
    space = Space(links_space_dir)
    space.links.backlinks(ADA)  # build
    calls: list[str] = []
    real = LinkIndex._extract

    def spy(self, path):
        calls.append(path)
        return real(self, path)

    monkeypatch.setattr(LinkIndex, "_extract", spy)
    rel = "Tasks/Loose task.md"
    space.save_body(rel, "Now links [[Ada Lovelace]].\n", space.cached_version(rel))
    assert rel in space.links.backlinks(ADA)
    assert calls == [rel]
    space.save_body(rel, "No links again.\n", space.cached_version(rel))
    assert rel not in space.links.backlinks(ADA)
    assert calls == [rel, rel]


def test_type_change_reextracts_property_links(links_space_dir: Path):
    space = Space(links_space_dir)
    assert space.links.link_keys(BABBAGE, ADA) == (False, ["manager"])
    t, _rev = space.refresh_type("person")
    assert t is not None
    space.links.backlinks(ADA)
    revision = space.links.revision
    space._types_changed("person")
    # Same definitions: re-extracted, nothing changed.
    assert space.links.link_keys(BABBAGE, ADA) == (False, ["manager"])
    assert space.links.revision == revision


def test_space_backlinks_are_entity_refs(links_space_dir: Path):
    space = Space(links_space_dir)
    refs = space.backlinks(ADA)
    assert {"target": "Analytical Engine", "path": ENGINE} in refs
    assert [r["path"] for r in refs] == space.links.backlinks(ADA)
    assert space.outgoing(ENGINE) == sorted([ADA, BABBAGE])


def test_link_index_5000_objects_50000_links_under_2s(
    big_space_dir: Path, big_space_stats
):
    space = Space(big_space_dir)
    t0 = time.perf_counter()
    edges = list(space.links.edges())
    build = time.perf_counter() - t0
    assert build < 2.0 * SLACK, build
    assert len(edges) == big_space_stats.distinct_pairs
    sample = sorted(space._summaries)[17]
    space.links.backlinks(sample)
    t0 = time.perf_counter()
    for _ in range(100):
        space.links.backlinks(sample)
    per = (time.perf_counter() - t0) / 100
    assert per < 0.001 * SLACK, per


def test_names_change_reresolves_only_the_sources_that_mention_the_name(
    links_space_dir: Path, monkeypatch
):
    # Audit 2026-11-01 P6: a rename re-resolves the links written to the old or new name,
    # not every link in the space.
    for i in range(30):
        (links_space_dir / "Pages" / f"Other {i}.md").write_bytes(
            b"---\ntype: 'Page'\ntitle: Other %d\n---\n\nSee [[Ada Lovelace]].\n" % i
        )
    space = Space(links_space_dir)
    space.links.backlinks(ADA)  # built
    resolved: list[str] = []
    real_one = LinkIndex._resolve_one

    def spy(self, path, tag_paths):
        resolved.append(path)
        return real_one(self, path, tag_paths)

    def never(self):
        raise AssertionError("a full re-resolve")

    monkeypatch.setattr(LinkIndex, "_resolve_one", spy)
    monkeypatch.setattr(LinkIndex, "_resolve_all", never)
    before = set(space.links.backlinks(BABBAGE))
    result = space.rename_object(BABBAGE, "Charles B", space.cached_version(BABBAGE))
    assert set(space.links.backlinks(result.path)) == before
    assert space.links.backlinks(BABBAGE) == []
    assert not any(p.startswith("Pages/Other ") for p in resolved), resolved
    assert len(resolved) < 30
    # A new object taking a linked name re-resolves the linkers of that name only.
    resolved.clear()
    path, _v = space.create_object("page", "Charles B")
    assert ENGINE in space.links.backlinks(path)
    assert ENGINE in resolved and not any(p.startswith("Pages/Other ") for p in resolved)
