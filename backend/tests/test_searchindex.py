"""The FTS5 search index in `.object-cache/` (M5 Task 3)."""

from __future__ import annotations

import gc
import hashlib
import os
import shutil
import sqlite3
import statistics
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest
from objectapp import searchindex as si
from objectapp.searchindex import INDEX_FORMAT, SearchIndex, build_match, cache_dir_for
from objectapp.space import Space, version_of

FIXTURES = Path(__file__).parent / "fixtures"
SLACK = float(os.environ.get("OBJECT_PERF_SLACK", "1"))
OPEN, CLOSE = "\u0002", "\u0003"
ADA = "People/Ada Lovelace.md"
CHARLES = "People/Charles Babbage.md"
ENGINE = "Pages/Analytical Engine.md"
DIFF = "Projects/Difference Engine.md"
CAFE = "Pages/Unicode Café.md"
LOOSE = "Tasks/Loose task.md"


def _wait(pred, timeout: float = 2.0, step: float = 0.02) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pred():
            return True
        time.sleep(step)
    return bool(pred())


def _start(
    root: Path, cache: Path | None, space: Space | None = None
) -> tuple[Space, SearchIndex]:
    space = space or Space(root)
    idx = SearchIndex(space, cache)
    idx.start()
    assert idx.ready.wait(30), "the start-up sync did not finish"
    return space, idx


@pytest.fixture
def links(links_space_dir: Path, tmp_path: Path):
    space, idx = _start(links_space_dir, tmp_path / "cache")
    yield space, idx
    idx.stop()


def _paths(res: dict) -> list[str]:
    return [r["path"] for r in res["results"]]


def _hit(res: dict, path: str) -> dict:
    for r in res["results"]:
        if r["path"] == path:
            return r
    raise AssertionError(f"{path} not in {_paths(res)}")


def _snapshot(root: Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file() and ".git" not in p.relative_to(root).parts
    }


# -- query building ------------------------------------------------------------


def test_build_match_quotes_every_token():
    assert build_match("ada love") == '"ada"* AND "love"*'
    assert build_match("a b") is None  # 1-char tokens feed only the title matcher
    assert build_match('say "hi"') == '"say"* AND """hi"""*'
    assert build_match("NEAR OR") == '"NEAR"* AND "OR"*'
    assert build_match("-- **") is None


# -- results -------------------------------------------------------------------


def test_body_word_found_with_snippet(links):
    _space, idx = links
    res = idx.search("difference")
    assert res["partial"] is False
    charles = _hit(res, CHARLES)
    fields = {h["field"]: h["snippets"] for h in charles["highlights"]}
    assert "properties" in fields
    snippet = fields["properties"][0]
    assert f"{OPEN}difference{CLOSE}" in snippet
    diff = _hit(res, DIFF)
    assert diff["titleMatches"] == [[0, 10]]
    assert diff["type"] == "project"
    assert diff["title"] == "Difference Engine"
    assert sorted(diff["tags"]) == ["Computing", "History"]
    assert _paths(res).index(DIFF) < _paths(res).index(CHARLES)
    for r in res["results"]:
        assert set(r) == {
            "path",
            "title",
            "type",
            "icon",
            "tags",
            "score",
            "titleMatches",
            "highlights",
        }


def test_diacritics_and_prefix(links):
    _space, idx = links
    assert CAFE in _paths(idx.search("cafe"))
    hit = _hit(idx.search("cré"), CAFE)
    assert any(h["field"] == "blocksContent" for h in hit["highlights"])
    assert CAFE in _paths(idx.search("brulee"))


def test_title_matches_rank_first(links):
    _space, idx = links
    res = idx.search("engine")
    paths = _paths(res)
    titled = [r for r in res["results"] if r["titleMatches"]]
    assert {r["path"] for r in titled} >= {ENGINE, DIFF}
    # Every title match comes before every full-text-only hit.
    last_title = max(paths.index(r["path"]) for r in titled)
    first_text = min(
        (i for i, r in enumerate(res["results"]) if not r["titleMatches"]),
        default=len(paths),
    )
    assert last_title < first_text
    assert ADA in paths[first_text:]  # "notes on the engine" in Ada's body
    scores = [r["score"] for r in titled]
    assert scores == sorted(scores, reverse=True)


def test_alias_match_found(links):
    _space, idx = links
    res = idx.search("Countess")
    hit = _hit(res, ADA)
    assert hit["titleMatches"] == []
    assert any(h["field"] == "aliases" for h in hit["highlights"])
    assert _paths(res)[0] == ADA


def test_type_exclude_and_tag_filters(links):
    _space, idx = links
    assert _paths(idx.search("engine", types=["project"])) == [DIFF]
    without = _paths(idx.search("engine", exclude_types=["project"]))
    assert DIFF not in without and ENGINE in without
    history = _paths(idx.search("engine", tag="history"))
    assert history == [
        DIFF,
        CHARLES,
    ]  # Charles by "engineer" (prefix), after the title match
    assert idx.search("engine", tag="Unused")["results"] == []
    # exclude wins over include
    assert (
        idx.search("engine", types=["project"], exclude_types=["project"])["results"]
        == []
    )


def test_title_mode_skips_full_text(links):
    _space, idx = links
    res = idx.search("difference", mode="title")
    assert _paths(res) == [DIFF]
    assert res["results"][0]["highlights"] == []
    assert idx.search("secretword", mode="title")["results"] == []


def test_query_syntax_is_neutralised(links):
    _space, idx = links
    for q in [
        '"',
        "*",
        "NEAR",
        "NEAR(ada",
        "-ada",
        "ada:",
        "title:ada",
        "OR",
        "ada OR",
        "AND NOT",
        '"unbalanced',
        "(",
        ")",
        "^",
        "ada*",
        "a b c",
        "''",
        "{x}",
    ]:
        res = idx.search(q)
        assert isinstance(res["results"], list), q
    assert ADA in _paths(idx.search("-ada"))  # the quoted term still matches the word
    assert idx.search("")["results"] == []
    assert idx.search("   ")["results"] == []


def test_not_searchable_property_not_indexed(links):
    _space, idx = links
    assert idx.search("secretword")["results"] == []


def test_templates_and_unreadable_files_excluded_or_readonly_indexed(links):
    space, idx = links
    templates = {p for p, s in space._summaries.items() if s.template is not None}
    assert templates
    for q in ("Linking template", "Linking", "Analytical"):
        assert not templates & set(_paths(idx.search(q))), q
    assert "Pages/Broken.md" in _paths(idx.search("closing fence"))


def test_limit_caps_results(links):
    _space, idx = links
    assert len(idx.search("e", limit=2)["results"]) <= 2
    assert len(idx.search("ada", limit=1)["results"]) == 1


# -- freshness -----------------------------------------------------------------


def test_index_follows_write_rename_delete_restore(links):
    space, idx = links
    version = version_of(space._raw[LOOSE].data)
    space.save_body(LOOSE, "Now mentions zephyrquill.\n", version)
    assert _wait(lambda: LOOSE in _paths(idx.search("zephyrquill")))

    version = version_of(space._raw[LOOSE].data)
    renamed = space.rename_object(LOOSE, "Quokka chores", version)
    new = renamed.path
    assert new != LOOSE
    assert _wait(lambda: new in _paths(idx.search("zephyrquill")))
    assert _wait(lambda: LOOSE not in _paths(idx.search("zephyrquill")))
    assert new in _paths(idx.search("Quokka chores"))

    item = space.delete_object(new)
    assert _wait(lambda: idx.search("zephyrquill")["results"] == [])
    assert idx.search("Quokka", mode="title")["results"] == []

    space.restore(item.id)
    assert _wait(lambda: new in _paths(idx.search("zephyrquill")))


def test_external_change_reindexed(links):
    space, idx = links
    path = links[0].root / CAFE
    data = path.read_bytes().replace(b"Cr\xc3\xa8me", b"Pistachio")
    path.write_bytes(data)
    space.rescan_file(CAFE)
    assert _wait(lambda: CAFE in _paths(idx.search("pistachio")))
    assert CAFE not in _paths(idx.search("creme"))


def test_type_change_reindexes_props(links):
    space, idx = links
    t = space.type_by_id("person")
    assert CHARLES in _paths(idx.search("difference"))
    # Marking bio not searchable drops it from props on the next sync.
    bio = next(p for p in t.propertyDefinitions if p.key == "bio")
    bio.extra["isNotSearchable"] = True
    idx._on_change(si.SpaceChange("types", None))
    assert _wait(lambda: CHARLES not in _paths(idx.search("difference")))


def test_type_change_documents_only_the_types_members(links, monkeypatch):
    """Audit 2026-11-01 P5: a type change re-documented all 5,001 objects (7 s); only the
    changed type's members (and an object whose stored type is stale) are looked at."""
    space, idx = links
    documented: list[str] = []
    real = idx._document
    monkeypatch.setattr(idx, "_document", lambda p: documented.append(p) or real(p))
    t = space.type_by_id("person")
    bio = next(p for p in t.propertyDefinitions if p.key == "bio")
    bio.extra["isNotSearchable"] = True
    idx._sync_types()
    people = {s.path for s in space._summaries.values() if s.type == "person" and s.template is None}
    assert people and set(documented) == people
    assert CHARLES not in _paths(idx.search("difference"))
    # Nothing to do when the types are unchanged.
    documented.clear()
    idx._sync_types()
    assert documented == []
    # An object whose stored type column is stale is re-documented even if its type
    # didn't change (its type name resolved differently after the change).
    stale = next(p for p, s in space._summaries.items() if s.type == "page" and s.template is None)
    with idx._db_lock:
        idx._conn.execute(
            "UPDATE fts SET type = 'gone' WHERE rowid = (SELECT rowid FROM meta WHERE path = ?)", (stale,)
        )
        idx._conn.commit()
    bio.extra["isNotSearchable"] = False
    documented.clear()
    idx._sync_types()
    assert set(documented) == people | {stale}
    with idx._db_lock:
        row = idx._conn.execute(
            "SELECT type FROM fts WHERE rowid = (SELECT rowid FROM meta WHERE path = ?)", (stale,)
        ).fetchone()
    assert row == ("page",)
    assert CHARLES in _paths(idx.search("difference"))


def test_changed_types_fingerprint_diff():
    before = '{"page":"a","task":"b"}'
    assert SearchIndex._changed_types(before, '{"page":"a","task":"c"}') == {"task"}
    assert SearchIndex._changed_types(before, '{"page":"a","task":"b","tag":"d"}') == {"tag"}
    assert SearchIndex._changed_types(before, '{"page":"a"}') == {"task"}
    assert SearchIndex._changed_types("deadbeef", '{"page":"a"}') is None  # the old one-hash format
    assert SearchIndex._changed_types(None, '{"page":"a"}') is None


def test_partial_until_initial_sync(links_space_dir: Path, tmp_path: Path):
    space = Space(links_space_dir)
    idx = SearchIndex(space, tmp_path / "cache")
    idx.sync_gate = threading.Event()
    idx.start()
    try:
        res = idx.search("Ada Lovelace")
        assert res["partial"] is True
        assert ADA in _paths(res)  # title matches still come back
        assert idx.phrase_candidates("Analytical Engine") is None
        assert idx.similar(ENGINE, 5) == []
        idx.sync_gate.set()
        assert idx.ready.wait(10)
        res = idx.search("Ada Lovelace")
        assert res["partial"] is False
    finally:
        idx.stop()


# -- the cache on disk -----------------------------------------------------------


def test_index_writes_only_cache_dir(links_space_dir: Path, monkeypatch):
    monkeypatch.delenv("OBJECT_CACHE_DIR", raising=False)
    before = _snapshot(links_space_dir)
    space = Space(links_space_dir)
    assert cache_dir_for(space) == links_space_dir / ".object-cache"
    _space, idx = _start(links_space_dir, None, space)
    assert idx.in_memory is False
    assert ADA in _paths(idx.search("Ada"))
    idx.stop()
    after = _snapshot(links_space_dir)
    new = set(after) - set(before)
    # Since the 2026-11-01 audit the scan also writes the parsed-frontmatter cache there.
    assert new == {
        ".object-cache/search.sqlite",
        ".object-cache/.gitignore",
        ".object-cache/frontmatter.json",
    }
    assert after[".object-cache/.gitignore"] == b"*\n"
    assert {k: v for k, v in after.items() if k in before} == before


def test_index_keeps_foreign_cache_files(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("OBJECT_CACHE_DIR", raising=False)
    root = tmp_path / "space"
    shutil.copytree(FIXTURES / "space-v1", root)
    ignored = root / ".object-cache" / "ignored.md"
    data = ignored.read_bytes()
    stat = ignored.stat()
    space = Space(root)  # space-v1 migrates its v1 types on the first open
    before = _snapshot(root)
    space, idx = _start(root, None, space)
    idx.search("Alpha")
    idx.stop()
    assert ignored.read_bytes() == data
    assert ignored.stat().st_mtime_ns == stat.st_mtime_ns
    after = _snapshot(root)
    # The opening scan already wrote the cache's `.gitignore` (with the frontmatter cache).
    assert before[".object-cache/.gitignore"] == b"*\n"
    assert set(after) - set(before) == {".object-cache/search.sqlite"}
    assert {k: v for k, v in after.items() if k in before} == before
    assert not any(p.startswith(".object-cache") for p in Space(root)._raw)


@pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")
def test_cache_gitignore_hides_everything(links_space_dir: Path, monkeypatch):
    monkeypatch.delenv("OBJECT_CACHE_DIR", raising=False)
    root = links_space_dir
    env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "HOME": str(root.parent)}

    def git(*args: str) -> str:
        return subprocess.run(
            [
                "git",
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@example.invalid",
                "-c",
                "commit.gpgsign=false",
                *args,
            ],
            cwd=root,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        ).stdout

    git("init", "-q")
    git("add", "-A")
    git("commit", "-q", "-m", "fixture")
    assert git("status", "--porcelain", "-uall") == ""
    _space, idx = _start(root, None)
    idx.search("Ada")
    idx.stop()
    assert (root / ".object-cache" / "search.sqlite").exists()
    assert git("status", "--porcelain", "-uall") == ""


def test_cache_dir_env_override(links_space_dir: Path, tmp_path: Path, monkeypatch):
    override = tmp_path / "override"
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(override))
    before = _snapshot(links_space_dir)
    space = Space(links_space_dir)
    digest = hashlib.sha256(str(space.root).encode("utf-8")).hexdigest()[:16]
    assert cache_dir_for(space) == override / digest
    _space, idx = _start(links_space_dir, None, space)
    idx.search("Ada")
    idx.stop()
    assert (override / digest / "search.sqlite").is_file()
    assert not (links_space_dir / ".object-cache").exists()
    assert _snapshot(links_space_dir) == before


def _cache_state(cache: Path) -> dict[str, tuple[bytes, int]]:
    return {
        p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in sorted(cache.iterdir())
    }


def test_second_start_unchanged_space_writes_nothing(
    links_space_dir: Path, tmp_path: Path
):
    cache = tmp_path / "cache"
    _space, idx = _start(links_space_dir, cache)
    idx.stop()
    first = _cache_state(cache)
    assert set(first) == {
        "search.sqlite"
    }  # outside the space: no .gitignore, no journal left
    time.sleep(0.05)
    _space, idx = _start(links_space_dir, cache)
    assert ADA in _paths(idx.search("Ada"))
    idx.stop()
    assert _cache_state(cache) == first


def test_only_changed_paths_reindexed_on_start(links_space_dir: Path, tmp_path: Path):
    cache = tmp_path / "cache"
    _space, idx = _start(links_space_dir, cache)
    idx.stop()
    path = links_space_dir / CAFE
    path.write_bytes(path.read_bytes().replace(b"recipe", b"rhubarbword"))
    space = Space(links_space_dir)
    idx = SearchIndex(space, cache)
    put = idx._put
    seen: list[str] = []

    def spy(conn, p, version, doc):
        seen.append(p)
        return put(conn, p, version, doc)

    idx._put = spy
    idx.start()
    assert idx.ready.wait(30)
    try:
        assert seen == [CAFE]
        assert CAFE in _paths(idx.search("rhubarbword"))
    finally:
        idx.stop()


def test_corrupt_cache_rebuilt(links_space_dir: Path, tmp_path: Path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "search.sqlite").write_bytes(b"this is not a database " * 200)
    _space, idx = _start(links_space_dir, cache)
    try:
        assert idx.in_memory is False
        assert ADA in _paths(idx.search("Countess"))
    finally:
        idx.stop()
    conn = sqlite3.connect(cache / "search.sqlite")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == INDEX_FORMAT
    conn.close()


def test_format_bump_rebuilds(links_space_dir: Path, tmp_path: Path):
    cache = tmp_path / "cache"
    _space, idx = _start(links_space_dir, cache)
    idx.stop()
    conn = sqlite3.connect(cache / "search.sqlite")
    conn.execute(f"PRAGMA user_version = {INDEX_FORMAT + 41}")
    conn.execute("DELETE FROM meta")
    conn.commit()
    conn.close()
    _space, idx = _start(links_space_dir, cache)
    try:
        assert idx.in_memory is False
        assert ADA in _paths(idx.search("Countess"))
    finally:
        idx.stop()
    conn = sqlite3.connect(cache / "search.sqlite")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == INDEX_FORMAT
    assert conn.execute("SELECT count(*) FROM meta").fetchone()[0] > 10
    conn.close()


def test_unwritable_cache_falls_back_to_memory(links_space_dir: Path, tmp_path: Path):
    # A cache folder that can't be created (a file sits where its parent should be).
    blocker = tmp_path / "blocker"
    blocker.write_bytes(b"")
    _space, idx = _start(links_space_dir, blocker / "cache")
    try:
        assert idx.in_memory is True
        assert ADA in _paths(idx.search("Countess"))
    finally:
        idx.stop()


@pytest.mark.skipif(
    sys.platform == "win32" or (hasattr(os, "geteuid") and os.geteuid() == 0),
    reason="needs a folder whose write permission can be dropped (not Windows, not root)",
)
def test_unwritable_cache_folder_permissions(links_space_dir: Path, tmp_path: Path):
    cache = tmp_path / "cache"
    cache.mkdir()
    cache.chmod(0o555)
    try:
        _space, idx = _start(links_space_dir, cache)
        try:
            assert idx.in_memory is True
            assert ADA in _paths(idx.search("Countess"))
        finally:
            idx.stop()
        assert list(cache.iterdir()) == []
    finally:
        cache.chmod(0o755)


def test_locked_cache_falls_back_to_memory(links_space_dir: Path, tmp_path: Path):
    cache = tmp_path / "cache"
    _space, idx = _start(links_space_dir, cache)
    idx.stop()
    holder = sqlite3.connect(cache / "search.sqlite", isolation_level=None)
    holder.execute("BEGIN EXCLUSIVE")
    try:
        _space, idx = _start(links_space_dir, cache)
        try:
            assert idx.in_memory is True
            assert ADA in _paths(idx.search("Countess"))
        finally:
            idx.stop()
    finally:
        holder.execute("ROLLBACK")
        holder.close()


def test_reindex_rebuilds(links):
    _space, idx = links
    idx.reindex()
    assert idx.search("Countess")["partial"] is True or idx.ready.is_set()
    assert idx.ready.wait(10)
    assert _wait(lambda: ADA in _paths(idx.search("Countess")))


def test_reindex_recreates_deleted_cache_file(links_space_dir: Path, tmp_path: Path):
    """M5 Task 13: deleting search.sqlite while running, then reindex, rebuilds the file.

    Windows refuses to delete a file another handle has open, so there nobody can
    delete the cache while the app runs: the delete is refused and reindex still
    rebuilds the file in place.
    """
    cache = tmp_path / "cache"
    _space, idx = _start(links_space_dir, cache)
    try:
        if sys.platform == "win32":
            with pytest.raises(PermissionError):
                (cache / "search.sqlite").unlink()
        else:
            (cache / "search.sqlite").unlink()
        idx.reindex()
        assert _wait(lambda: idx.ready.is_set() and ADA in _paths(idx.search("Countess")), 10)
        assert idx.in_memory is False
        assert (cache / "search.sqlite").read_bytes()[:16] == b"SQLite format 3\x00"
    finally:
        idx.stop()


# -- references helpers ------------------------------------------------------------


def test_phrase_candidates_and_similar(links_space_dir: Path, tmp_path: Path):
    pages = links_space_dir / "Pages"
    docs = {
        "Quokka one": "quokka wombat platypus numbat bilby quokka wombat platypus",
        "Quokka two": "quokka wombat platypus numbat and some other words",
        "Quokka three": "only a quokka here among unrelated words",
        "Unrelated": "nothing in common at all with those animals",
    }
    for title, body in docs.items():
        (pages / f"{title}.md").write_text(
            f"---\ntype: 'Page'\ntitle: {title}\n---\n\n{body}\n", encoding="utf-8"
        )
    space = Space(links_space_dir)
    idx = SearchIndex(space, tmp_path / "cache")
    assert idx.phrase_candidates("Analytical Engine") is None
    assert idx.similar(ENGINE, 5) == []
    idx.start()
    assert idx.ready.wait(30)
    try:
        cands = idx.phrase_candidates("Analytical Engine")
        assert {"Pages/Notes on mentions.md", "Pages/CRLF mention.md"} <= cands
        assert "Archive/Mention from archive.md" not in cands
        assert "People/Ada Lovelace.md" not in cands
        assert idx.phrase_candidates("!!") == set()

        similar = idx.similar("Pages/Quokka one.md", 10)
        paths = [p for p, _s in similar]
        assert "Pages/Quokka one.md" not in paths
        assert paths[0] == "Pages/Quokka two.md"
        assert "Pages/Quokka three.md" in paths
        assert paths.index("Pages/Quokka two.md") < paths.index("Pages/Quokka three.md")
        assert "Pages/Unrelated.md" not in paths
        scores = [s for _p, s in similar]
        assert scores == sorted(scores, reverse=True)
        assert idx.similar("Pages/Nope.md", 5) == []
        assert len(idx.similar("Pages/Quokka one.md", 1)) == 1
    finally:
        idx.stop()


# -- performance (5,000 objects / 50,000 links) ---------------------------------------


@pytest.fixture(scope="module")
def big_index(big_space_dir: Path, tmp_path_factory):
    cache = tmp_path_factory.mktemp("big-cache")
    space = Space(big_space_dir)
    idx = SearchIndex(space, cache)
    t0 = time.perf_counter()
    idx.start()
    assert idx.ready.wait(120)
    build = time.perf_counter() - t0
    yield space, idx, cache, build
    idx.stop()


def test_full_build_under_30s_at_5000(big_index):
    space, _idx, _cache, build = big_index
    assert len(space._raw) >= 5000
    assert build < 30 * SLACK, f"full build took {build:.1f}s"


def test_search_p95_under_50ms_at_5000(big_index):
    _space, idx, _cache, _build = big_index
    queries = [
        "Object 00042",
        "aurora",
        "cobalt dune",
        "obj",
        "ember",
        "fjord glacier",
        "harbor",
        "basalt",
        "Object 04999",
        "summary",
        "meeting notes",
        "draft review",
        "00123",
        "glac",
        "au",
        "Object",
        "plan idea",
        "thread step",
        "o",
        "record value",
    ]
    for q in queries[:3]:
        idx.search(q)  # warm up
    times = []
    # Time the search, not a full garbage collection of everything earlier tests left behind.
    gc.collect()
    gc.disable()
    try:
        for q in queries:
            t0 = time.perf_counter()
            res = idx.search(q)
            times.append(time.perf_counter() - t0)
            assert res["partial"] is False
    finally:
        gc.enable()
    p95 = statistics.quantiles(times, n=20)[-1]
    assert p95 < 0.05 * SLACK, f"search p95 {p95 * 1000:.1f} ms"
    assert idx.search("Object 00042")["results"][0]["title"] == "Object 00042"


def test_second_start_sync_under_2s(big_index, big_space_dir: Path):
    space, _idx, cache, _build = big_index
    before = _cache_state(cache)
    second = SearchIndex(space, cache)
    t0 = time.perf_counter()
    second.start()
    assert second.ready.wait(60)
    took = time.perf_counter() - t0
    second.stop()
    assert took < 2 * SLACK, f"second start sync took {took:.2f}s"
    assert _cache_state(cache) == before
