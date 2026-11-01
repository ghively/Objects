"""The references section: tabs, backlinks in context, mentions, related, related tags (M5 Task 4)."""

from __future__ import annotations

import os
import statistics
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import references as refs
from objectapp.references import CONTEXT_MAX, references, tabs_for, unlinked_mentions
from objectapp.searchindex import SearchIndex
from objectapp.server import create_app
from objectapp.space import Space

SLACK = float(os.environ.get("OBJECT_PERF_SLACK", "1"))
ADA = "People/Ada Lovelace.md"
CHARLES = "People/Charles Babbage.md"
ENGINE = "Pages/Analytical Engine.md"
NOTES = "Pages/Notes on mentions.md"
CRLF = "Pages/CRLF mention.md"
DIFF = "Projects/Difference Engine.md"
DAILY = "DailyNotes/2026-10-23.md"
BROKEN = "Pages/Broken.md"
TEMPLATE = "Templates/Pages/Linking template.md"
ARCHIVE_MENTION = "Archive/Mention from archive.md"
LOOSE = "Tasks/Loose task.md"
DRAFT = "Tasks/Draft outline.md"


def _start(root: Path, cache: Path) -> tuple[Space, SearchIndex]:
    space = Space(root)
    idx = SearchIndex(space, cache)
    idx.start()
    assert idx.ready.wait(30), "the start-up sync did not finish"
    return space, idx


@pytest.fixture
def links(links_space_dir: Path, tmp_path: Path):
    space, idx = _start(links_space_dir, tmp_path / "cache")
    yield space, idx
    idx.stop()


def _write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(text.encode("utf-8"))


def _entry(entries: list[dict], path: str) -> dict:
    for e in entries:
        if e["path"] == path:
            return e
    raise AssertionError(f"{path} not in {[e['path'] for e in entries]}")


def _snapshot(root: Path) -> dict[str, tuple[bytes, int]]:
    return {
        p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


# -- tabs ----------------------------------------------------------------------


def test_tabs_per_role(links, links_space_dir: Path):
    space, idx = links
    five = ["all", "backlinks", "related", "mentions", "relatedTags"]
    four = ["all", "backlinks", "related", "mentions"]
    assert references(space, idx, ADA)["tabs"] == five  # a Person with tags
    assert references(space, idx, ENGINE)["tabs"] == four  # a Page without tags
    assert references(space, idx, LOOSE)["tabs"] == four  # a Task without tags
    assert references(space, idx, DRAFT)["tabs"] == five  # a Task with tags
    assert references(space, idx, "Tags/Computing.md")["tabs"] == []
    assert references(space, idx, DAILY)["tabs"] == []
    _write(
        links_space_dir,
        "Videos/Clip.md",
        "---\ntype: 'Video'\ntitle: Clip\n---\n\nAda Lovelace.\n",
    )
    space.rescan_file("Videos/Clip.md")
    clip = references(space, idx, "Videos/Clip.md")
    assert clip == {
        "tabs": [],
        "backlinks": [],
        "mentions": [],
        "related": [],
        "relatedTags": [],
        "summaries": {},
    }
    with space._lock:
        assert tabs_for(space, space._summaries[TEMPLATE]) == []


# -- backlinks -----------------------------------------------------------------


def test_backlink_contexts_and_property_links(links):
    space, idx = links
    data = references(space, idx, ADA)
    backs = data["backlinks"]
    paths = [e["path"] for e in backs]
    assert set(paths) == {ENGINE, CHARLES, DIFF, DAILY, BROKEN}
    assert TEMPLATE not in paths
    engine = _entry(backs, ENGINE)
    assert engine["properties"] == []
    assert len(engine["contexts"]) == 2  # the code-block link adds none
    for c in engine["contexts"]:
        assert c["context"][c["start"] : c["end"]] == "Ada Lovelace"
        assert "[[" not in c["context"]
    assert engine["contexts"][0]["context"] == (
        "Designed with help from Ada Lovelace, who published the first program."
    )
    assert engine["contexts"][1]["context"] == "Notes by Ada Lovelace describe loops."
    assert _entry(backs, CHARLES) == {
        "path": CHARLES,
        "contexts": [],
        "properties": ["manager"],
    }
    assert _entry(backs, DIFF)["properties"] == ["members"]
    assert _entry(backs, DIFF)["contexts"] == []
    assert len(_entry(backs, BROKEN)["contexts"]) == 1
    assert set(data["summaries"]) >= {ADA, *paths}
    assert data["summaries"][ENGINE]["title"] == "Analytical Engine"


def test_backlink_alias_label_and_long_line(links, links_space_dir: Path):
    space, idx = links
    data = references(space, idx, CHARLES)
    engine = _entry(data["backlinks"], ENGINE)
    (ctx,) = engine["contexts"]
    assert ctx["context"] == "The inventor was Babbage."
    assert ctx["context"][ctx["start"] : ctx["end"]] == "Babbage"
    long_line = "word " * 120 + "**see** [[Charles Babbage]] " + "tail " * 120
    _write(
        links_space_dir,
        "Pages/Long.md",
        f"---\ntype: 'Page'\ntitle: Long\n---\n\n{long_line}\n",
    )
    space.rescan_file("Pages/Long.md")
    (c,) = _entry(references(space, idx, CHARLES)["backlinks"], "Pages/Long.md")[
        "contexts"
    ]
    assert len(c["context"]) <= CONTEXT_MAX
    assert c["context"][c["start"] : c["end"]] == "Charles Babbage"
    assert c["context"].startswith("…") and c["context"].endswith("…")
    assert "**" not in c["context"]


# -- mentions ------------------------------------------------------------------


def test_mentions_word_boundaries_and_case(links):
    space, idx = links
    mentions = references(space, idx, ENGINE)["mentions"]
    notes = _entry(mentions, NOTES)
    texts = [o["text"] for o in notes["occurrences"]]
    assert texts == ["Analytical Engine", "analytical engine"]
    with space._lock:
        body = space._raw[NOTES].of.body
    for o in notes["occurrences"]:
        assert body[o["start"] : o["end"]] == o["text"]
        cs = o["contextStart"]
        assert body[cs : cs + len(o["context"])] == o["context"]
        assert o["context"][o["start"] - cs : o["end"] - cs] == o["text"]
    assert (
        notes["occurrences"][0]["context"] == "Analytical Engine was never completed."
    )
    assert notes["version"] == space.cached_version(NOTES)
    # the CRLF object mentions it once; the template never does
    assert len(_entry(mentions, CRLF)["occurrences"]) == 1
    assert TEMPLATE not in [e["path"] for e in mentions]


def test_mentions_exclude_links_code_and_self(links, links_space_dir: Path):
    space, idx = links
    _write(
        links_space_dir,
        "Pages/Mixed.md",
        "---\ntype: 'Page'\ntitle: Mixed\n---\n\n"
        "[[Analytical Engine]] and [[Pages/Analytical Engine|Analytical Engine]]\n"
        "![Analytical Engine](pic.png) [the Analytical Engine site](https://x.invalid)\n"
        "```\nAnalytical Engine\n```\n"
        "``Analytical Engine`` and xAnalytical Engine and Analytical Engine_x\n",
    )
    space.rescan_file("Pages/Mixed.md")
    assert idx.ready.is_set()
    mentions = references(space, idx, ENGINE)["mentions"]
    assert "Pages/Mixed.md" not in [e["path"] for e in mentions]
    assert ENGINE not in [e["path"] for e in mentions]  # its own heading never counts


# -- audit 2026-11-01 B6: one body parse per (path, version); fresh edits via pending paths --


def test_bodies_are_scanned_once_per_version(links, monkeypatch):
    space, idx = links
    refs._scan_cache.clear()
    parsed: list[str] = []
    real = refs.wikilink_spans
    monkeypatch.setattr(refs, "wikilink_spans", lambda body: parsed.append(body) or real(body))
    first = references(space, idx, ENGINE)
    sources = {e["path"] for e in first["backlinks"]} | {e["path"] for e in first["mentions"]}
    assert len(sources) >= 3
    assert len(parsed) == len(set(parsed))  # each body parsed once, backlinks and mentions shared
    parsed.clear()
    assert references(space, idx, ENGINE) == first
    assert parsed == []  # all from the cache
    # An edit (a new version) is parsed again.
    body = space.read(NOTES)[0].body
    space.save_body(NOTES, body + "\nMore about the Analytical Engine.\n", space.read(NOTES)[2])
    again = references(space, idx, ENGINE)
    assert len(parsed) == 1
    assert _entry(again["mentions"], NOTES)["version"] == space.read(NOTES)[2]
    refs._scan_cache.clear()


def test_fresh_edit_is_scanned_before_the_index_applies_it(links, links_space_dir: Path, monkeypatch):
    space, idx = links
    monkeypatch.setattr(idx, "_update_paths", lambda paths: None)  # the index never catches up
    _write(
        links_space_dir,
        "Pages/Fresh.md",
        "---\ntype: 'Page'\ntitle: Fresh\n---\n\nThe Analytical Engine, just written.\n",
    )
    space.rescan_file("Pages/Fresh.md")
    assert "Pages/Fresh.md" in idx.pending_paths()
    assert idx.phrase_candidates("Analytical Engine") is not None
    assert "Pages/Fresh.md" in [e["path"] for e in unlinked_mentions(space, idx, ENGINE)]
    # Once applied, the path leaves the pending set; a change arriving meanwhile keeps it.
    monkeypatch.undo()
    idx._update_paths(["Pages/Fresh.md"])
    assert "Pages/Fresh.md" not in idx.pending_paths()
    idx._pending["Pages/Fresh.md"] = 2
    idx._settle_pending({"Pages/Fresh.md": 1})
    assert "Pages/Fresh.md" in idx.pending_paths()
    idx._settle_pending({"Pages/Fresh.md": 2})
    assert "Pages/Fresh.md" not in idx.pending_paths()


def test_mentions_respect_roles(links, links_space_dir: Path):
    space, idx = links
    # A Tag never mentions (not canBeUnlinkedMention); a DailyNote does.
    _write(
        links_space_dir,
        "Tags/Machines.md",
        "---\ntype: 'Tag'\ntitle: Machines\n---\n\nThe Difference Engine was one.\n",
    )
    space.rescan_file("Tags/Machines.md")
    mentions = references(space, idx, DIFF)["mentions"]
    paths = [e["path"] for e in mentions]
    assert DAILY in paths
    assert "Tags/Machines.md" not in paths
    assert TEMPLATE not in references(space, idx, ENGINE)["mentions"]


def test_mentions_use_aliases_min_length(links, links_space_dir: Path):
    space, idx = links
    engine = _entry(references(space, idx, ADA)["mentions"], ENGINE)
    assert [o["text"] for o in engine["occurrences"]] == ["ada"]
    # A 2-letter alias never matches.
    _write(
        links_space_dir,
        "People/Grace Hopper.md",
        "---\ntype: 'Person'\ntitle: Grace Hopper\naliases:\n  - GH\n---\n\nAdmiral.\n",
    )
    _write(
        links_space_dir,
        "Pages/GH note.md",
        "---\ntype: 'Page'\ntitle: GH note\n---\n\nGH said so.\n",
    )
    space.rescan_file("People/Grace Hopper.md")
    space.rescan_file("Pages/GH note.md")
    assert references(space, idx, "People/Grace Hopper.md")["mentions"] == []


def test_mentions_scan_fallback_before_ready(links, monkeypatch):
    space, idx = links
    with_index = unlinked_mentions(space, idx, ENGINE)
    monkeypatch.setattr(idx, "phrase_candidates", lambda _text: None)
    assert unlinked_mentions(space, idx, ENGINE) == with_index
    assert unlinked_mentions(space, None, ENGINE) == with_index
    assert len(with_index) == 2


def test_mentions_use_the_phrase_prefilter(links, monkeypatch):
    space, idx = links
    calls: list[str] = []
    real = idx.phrase_candidates

    def spy(text: str):
        calls.append(text)
        return real(text)

    monkeypatch.setattr(idx, "phrase_candidates", spy)
    unlinked_mentions(space, idx, ADA)
    assert calls == ["Countess of Lovelace", "Ada Lovelace", "Ada"]  # longest first


# -- related ---------------------------------------------------------------------


def test_related_excludes_self_and_ranks_by_shared_terms(links):
    space, idx = links
    related = references(space, idx, ENGINE)["related"]
    paths = [e["path"] for e in related]
    assert ENGINE not in paths
    assert TEMPLATE not in paths
    assert paths, "something shares words with the Analytical Engine"
    scores = [e["score"] for e in related]
    assert scores == sorted(scores, reverse=True)
    assert all(set(e) == {"path", "score"} for e in related)
    # Objects that share its strongest words outrank one that shares none.
    assert LOOSE not in paths[:3]


def test_related_limit(links):
    space, idx = links
    assert len(references(space, idx, ENGINE, related_limit=2)["related"]) == 2
    assert len(references(space, idx, ENGINE, related_limit=20)["related"]) > 2


# -- related tags ----------------------------------------------------------------


def test_related_tags_cooccurrence(links):
    space, idx = links
    tags = references(space, idx, ADA)["relatedTags"]
    assert tags == [{"name": "History", "path": "Tags/History.md", "count": 2}]
    # Charles (Computing, History): Mathematics on Ada (1); own tags excluded.
    charles = references(space, idx, CHARLES)["relatedTags"]
    assert {"name": "Mathematics", "path": "Tags/Mathematics.md", "count": 1} in charles
    assert all(t["name"] not in ("Computing", "History") for t in charles)
    assert references(space, idx, ENGINE)["relatedTags"] == []


def test_related_tag_without_tag_object(links, links_space_dir: Path):
    space, idx = links
    _write(
        links_space_dir,
        "Pages/Tagged.md",
        "---\ntype: 'Page'\ntitle: Tagged\ntags:\n  - computing\n  - Steam\n---\n\nx\n",
    )
    space.rescan_file("Pages/Tagged.md")
    tags = references(space, idx, ADA)["relatedTags"]
    assert {"name": "Steam", "path": None, "count": 1} in tags


# -- routes ----------------------------------------------------------------------


def _client(root: Path):
    space = Space(root)
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    return space, app, TestClient(app)


def test_references_route_shape_and_errors(links_space_dir: Path):
    _space, app, c = _client(links_space_dir)
    with c:
        assert app.state.search.ready.wait(30)
        r = c.get("/api/references", params={"path": ADA})
        assert r.status_code == 200
        body = r.json()
        assert set(body) == {
            "tabs",
            "backlinks",
            "mentions",
            "related",
            "relatedTags",
            "summaries",
        }
        assert body["summaries"][ADA]["title"] == "Ada Lovelace"
        assert (
            len(
                c.get(
                    "/api/references", params={"path": ENGINE, "relatedLimit": 1}
                ).json()["related"]
            )
            == 1
        )
        assert c.get("/api/references", params={"path": "../x.md"}).status_code == 400
        assert (
            c.get("/api/references", params={"path": "Pages/Nope.md"}).status_code
            == 404
        )
        assert (
            c.get(
                "/api/references", params={"path": ADA, "relatedLimit": 0}
            ).status_code
            == 422
        )
        assert (
            c.get(
                "/api/references", params={"path": ADA, "relatedLimit": 201}
            ).status_code
            == 422
        )


def test_references_get_writes_nothing(links_space_dir: Path):
    before = _snapshot(links_space_dir)
    _space, app, c = _client(links_space_dir)
    with c:
        assert app.state.search.ready.wait(30)
        for rel in sorted(before):
            if rel.endswith(".md"):
                assert c.get("/api/references", params={"path": rel}).status_code == 200
    assert _snapshot(links_space_dir) == before


# -- performance -------------------------------------------------------------------


def test_references_under_150ms_at_5000(
    big_space_dir: Path, big_space_stats, tmp_path: Path
):
    space, idx = _start(big_space_dir, tmp_path / "cache")
    try:
        paths = [
            p for p in sorted(space._summaries) if space._summaries[p].template is None
        ]
        sample = paths[:: max(1, len(paths) // 20)][:20]
        references(space, idx, sample[0])  # warm the link index and resolver
        times = []
        for p in sample:
            t0 = time.perf_counter()
            references(space, idx, p)
            times.append(time.perf_counter() - t0)
        assert statistics.median(times) < 0.150 * SLACK, times
        assert max(times) < 0.150 * SLACK * 2, times
    finally:
        idx.stop()


def test_window_keeps_short_text_whole():
    assert refs._window("abc", 1, 2) == ("abc", 1, 2, 0)
    text = "x" * 500
    ctx, s, e, off = refs._window(text, 250, 255, ellipsis=False)
    assert len(ctx) <= CONTEXT_MAX and text[off : off + len(ctx)] == ctx
    assert ctx[s:e] == text[250:255]
