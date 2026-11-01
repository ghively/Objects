"""Audit 2026-11-01 B3: the parsed-frontmatter cache and the shared YAML instances.

`OBJECT_CACHE_DIR` points at a per-session folder (conftest), so the cache file lands
there, keyed by the space root, like the search index's.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from objectapp import fmcache, frontmatter, typedefs
from objectapp.frontmatter import FrontmatterError, parse_fm
from objectapp.space import Space
from objectapp.typedefs import iter_object_paths, read_raw


def _snapshot(root: Path) -> dict[str, tuple[bytes, int]]:
    return {
        p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _parsable(root: Path) -> int:
    """How many objects have frontmatter to parse (a broken fence or none at all isn't parsed)."""
    from objectapp.objfile import split_object
    from objectapp.textfile import decode

    count = 0
    for rel in iter_object_paths(root):
        of = split_object(decode((root / rel).read_bytes()).text)
        count += of.fm_ok and of.frontmatter_src is not None
    return count


def _count_parses(monkeypatch) -> list[str]:
    seen: list[str] = []
    real = typedefs.parse_fm

    def counting(src: str):
        seen.append(src)
        return real(src)

    monkeypatch.setattr(typedefs, "parse_fm", counting)
    return seen


def test_cache_file_lives_beside_the_search_index(space_dir: Path):
    from objectapp.searchindex import cache_dir_for

    space = Space(space_dir)
    cache = fmcache.for_root(space.root)
    assert cache.path == cache_dir_for(space) / fmcache.FILE_NAME
    assert cache is fmcache.for_root(space.root)  # one per root per process


def test_warm_open_parses_only_the_files_that_changed(space_dir: Path, monkeypatch):
    Space(space_dir)  # M1's first open writes the inferred types; later opens write nothing
    fmcache._caches.clear()
    fmcache.for_root(space_dir).path.unlink()  # the opening scan wrote it: start cold
    fmcache._caches.clear()
    parses = _count_parses(monkeypatch)
    before = _snapshot(space_dir)
    Space(space_dir)
    cold = len(parses)
    assert cold == _parsable(space_dir) == 9
    assert _snapshot(space_dir) == before  # opening writes nothing in the space
    assert fmcache.for_root(space_dir).path.is_file()  # the opening scan flushed it once

    fmcache._caches.clear()  # a new process: the entries come from the file
    parses.clear()
    Space(space_dir)
    # Only `Pages/Bad yaml.md`, whose frontmatter doesn't parse, is parsed again (never cached).
    assert parses == ["type: Page\ntitle: [unclosed\n"]
    assert _snapshot(space_dir) == before

    target = space_dir / "Pages" / "Alpha.md"
    target.write_bytes(target.read_bytes().replace(b"title: Alpha", b"title: Alpha edited"))
    body_only = space_dir / "Tasks" / "Fix printer.md"
    body_only.write_bytes(body_only.read_bytes() + b"\nmore body\n")
    parses.clear()
    space = Space(space_dir)
    assert len(parses) == 2  # the edited frontmatter and the bad one; the body-only edit hits
    assert space.get("Pages/Alpha.md").title == "Alpha edited"


def test_cached_values_equal_the_parse_and_are_fresh_copies(space_dir: Path):
    Space(space_dir)
    for rel in iter_object_paths(space_dir):
        raw = read_raw(space_dir, rel)
        if raw.of.fm_ok and raw.of.frontmatter_src is not None and not raw.readOnly:
            assert raw.fm == parse_fm(raw.of.frontmatter_src)
    first = read_raw(space_dir, "Tasks/Fix printer.md")
    first.fm.setdefault("tags", []).append("mutated")  # an edit on one read's dict...
    second = read_raw(space_dir, "Tasks/Fix printer.md")
    assert "mutated" not in (second.fm.get("tags") or [])  # ...never reaches the next read


@pytest.mark.parametrize(
    "corrupt",
    [b"not json", b"[]", b'{"v": 1, "entries": "x"}', b'{"v": 99, "entries": {}}'],
    ids=["garbage", "list", "bad-entries", "other-version"],
)
def test_a_corrupt_cache_file_means_parsing(space_dir: Path, monkeypatch, corrupt: bytes):
    Space(space_dir)
    fmcache.flush_all()
    path = fmcache.for_root(space_dir).path
    path.write_bytes(corrupt)
    fmcache._caches.clear()
    parses = _count_parses(monkeypatch)
    space = Space(space_dir)
    assert len(parses) == _parsable(space_dir)
    assert space.get("Pages/Alpha.md").title == "Alpha"


def test_a_stale_or_wrong_entry_is_not_trusted(space_dir: Path, monkeypatch):
    Space(space_dir)
    fmcache.flush_all()
    path = fmcache.for_root(space_dir).path
    data = json.loads(path.read_bytes())
    alpha = data["entries"]["Pages/Alpha.md"]
    alpha[1]["title"] = "Wrong"  # a right hash with a wrong value can only come from a bad file...
    data["entries"]["Tasks/Fix printer.md"][0] = "0" * 40  # ...and a wrong hash is simply stale
    data["entries"]["Pages/Notes.md"] = ["x", "not a dict"]
    path.write_bytes(json.dumps(data).encode())
    fmcache._caches.clear()
    parses = _count_parses(monkeypatch)
    space = Space(space_dir)
    assert len(parses) == 2  # the stale hash and the malformed entry; the rest hits
    assert space.get("Tasks/Fix printer.md").title == "Fix printer"
    assert space.get("Pages/Alpha.md").title == "Wrong"  # a right hash is trusted: the key is the text


def test_unparseable_frontmatter_is_never_cached(space_dir: Path, monkeypatch):
    bad = space_dir / "Pages" / "Bad.md"
    bad.write_bytes(b"---\na: [unclosed\n---\nbody\n")
    Space(space_dir)
    fmcache.flush_all()
    entries = json.loads(fmcache.for_root(space_dir).path.read_bytes())["entries"]
    assert "Pages/Bad.md" not in entries
    assert read_raw(space_dir, "Pages/Bad.md").readOnly


def test_values_that_do_not_survive_json_are_parsed_every_time(tmp_path: Path, monkeypatch):
    (tmp_path / "odd.md").write_bytes(b"---\n1: one\ntitle: Odd\n---\n")
    parses = _count_parses(monkeypatch)
    assert read_raw(tmp_path, "odd.md").fm == {1: "one", "title": "Odd"}
    assert read_raw(tmp_path, "odd.md").fm == {1: "one", "title": "Odd"}
    assert len(parses) == 2


def test_no_cache_under_the_trash(space_dir: Path):
    space = Space(space_dir)
    item = space.delete_object("Pages/Alpha.md")
    (space_dir / ".object" / "trash" / f"{item.id}.json").unlink()
    assert [i.title for i in Space(space_dir).list_trash()] == ["Alpha"]
    fmcache.flush_all()
    assert str(space_dir / ".object" / "trash") not in fmcache._caches
    assert not (space_dir / ".object" / "trash" / ".object-cache").exists()


def test_unwritable_cache_dir_falls_back_to_parsing(space_dir: Path, monkeypatch):
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(space_dir / "Pages" / "Alpha.md"))  # a file, not a dir
    fmcache._caches.clear()
    space = Space(space_dir)
    fmcache.flush_all()  # must not raise
    assert space.get("Pages/Alpha.md").title == "Alpha"


def test_flush_drops_entries_of_files_that_are_gone(space_dir: Path):
    space = Space(space_dir)
    fmcache.flush_all()
    space.delete_object("Pages/Alpha.md")
    fmcache.for_root(space_dir).put("Tasks/Fix printer.md", "title: x\n", {"title": "x"})  # dirty it
    fmcache.flush_all()
    entries = json.loads(fmcache.for_root(space_dir).path.read_bytes())["entries"]
    assert "Pages/Alpha.md" not in entries and "Tasks/Fix printer.md" in entries


# -- one YAML instance per thread ------------------------------------------------------------


def test_yaml_instances_are_reused_per_thread_and_dropped_after_an_error():
    assert frontmatter._plain_yaml() is frontmatter._plain_yaml()
    assert frontmatter._rt_yaml() is frontmatter._rt_yaml()
    seen: list[object] = []
    t = threading.Thread(target=lambda: seen.append(frontmatter._plain_yaml()))
    t.start()
    t.join()
    assert seen[0] is not frontmatter._plain_yaml()  # thread-local, not shared across threads
    # An anchor left behind by a parse that failed must not make a later file fail.
    before = frontmatter._plain_yaml()
    with pytest.raises(FrontmatterError):
        parse_fm("a: &x 1\nb: [\n")
    assert frontmatter._plain_yaml() is not before
    assert parse_fm("a: &x 1\nb: *x\n") == {"a": 1, "b": 1}
    with pytest.raises(FrontmatterError):
        frontmatter.set_keys("a: &x 1\nb: [\n", {"c": 1})
    assert frontmatter.set_keys("a: &x 1\nb: *x\n", {"c": 1}) == "a: &x 1\nb: *x\nc: 1\n"


def test_repeated_dumps_on_the_shared_instance_match_fresh_ones():
    src = "title: 'Quoted'\ntags: [A, B]\nnote: |-\n  two\n  lines\nn: 1\n"
    first = frontmatter.set_keys(src, {"n": 2, "new": ["x", "y"], "desc": None})
    for _ in range(5):
        assert frontmatter.set_keys(src, {"n": 2, "new": ["x", "y"], "desc": None}) == first
    assert parse_fm(first) == {**parse_fm(src), "n": 2, "new": ["x", "y"], "desc": None}


# -- when the cache is written (fix pass 2026-11-01) ---------------------------------------------
#
# `get`/`put` run inside `read_raw`, which `Space._write` calls under the space's lock on
# every save, so neither may flush (a stat per entry, one dump of everything, an fsync).
# The writers are: the delayed timer `put` arms, `Space.__init__` once its scan is done,
# and interpreter exit.


def _spy_writes(monkeypatch) -> list[Path]:
    written: list[Path] = []
    real = fmcache.atomic_write

    def spy(path, data, *args, **kwargs):
        written.append(Path(path))
        return real(path, data, *args, **kwargs)

    monkeypatch.setattr(fmcache, "atomic_write", spy)
    return written


def test_get_and_put_never_write_inline(space_dir: Path, monkeypatch):
    monkeypatch.setattr(fmcache, "_FLUSH_AFTER", 3600.0)
    fmcache._caches.clear()
    written = _spy_writes(monkeypatch)
    cache = fmcache.for_root(space_dir)
    cache.put("Pages/A.md", "title: A\n", {"title": "A"})
    for _ in range(3):
        assert cache.get("Pages/A.md", "title: A\n") == {"title": "A"}
        cache.put("Pages/B.md", "title: B\n", {"title": "B"})
    assert written == [] and not cache.path.exists()
    assert cache._timer is not None and cache._timer.daemon  # one pending delayed flush
    cache.flush()
    assert written == [cache.path] and cache._timer is None


def test_the_timer_flush_writes_after_its_delay_and_coalesces_puts(space_dir: Path, monkeypatch):
    import time

    monkeypatch.setattr(fmcache, "_FLUSH_AFTER", 0.05)
    fmcache._caches.clear()
    written = _spy_writes(monkeypatch)
    cache = fmcache.for_root(space_dir)
    rels = list(iter_object_paths(space_dir))  # a flush keeps only the entries of existing files
    for i, rel in enumerate(rels):
        cache.put(rel, f"title: {i}\n", {"title": str(i)})
    deadline = time.monotonic() + 3
    while not cache.path.is_file() and time.monotonic() < deadline:
        time.sleep(0.01)
    time.sleep(0.15)  # a second timer, had the puts not been coalesced, would fire by now
    assert written == [cache.path]
    assert len(json.loads(cache.path.read_bytes())["entries"]) == len(rels) > 1
    assert cache._timer is None


def test_a_second_start_in_the_same_process_changes_no_byte_or_mtime_of_the_cache(
    space_dir: Path, monkeypatch
):
    monkeypatch.setattr(fmcache, "_FLUSH_AFTER", 3600.0)  # no timer helps the test along
    fmcache._caches.clear()
    Space(space_dir)  # the opening scan flushes once, synchronously
    path = fmcache.for_root(space_dir).path
    assert path.is_file()
    before = (path.read_bytes(), path.stat().st_mtime_ns)
    written = _spy_writes(monkeypatch)
    Space(space_dir)
    fmcache.flush_all()  # nothing is dirty after a start that hit on every file
    assert written == []
    assert (path.read_bytes(), path.stat().st_mtime_ns) == before


def test_save_body_never_flushes_the_cache_under_the_space_lock(space_dir: Path, monkeypatch):
    monkeypatch.setattr(fmcache, "_FLUSH_AFTER", 0.0)  # a flush is always due
    fmcache._caches.clear()
    under_lock: list[bool] = []
    opened: list[Space] = []
    real = fmcache.FrontmatterCache.flush

    def spy(self):
        if opened:  # the opening scan's own flush runs before the space exists
            under_lock.append(opened[0]._lock._is_owned())
        return real(self)

    monkeypatch.setattr(fmcache.FrontmatterCache, "flush", spy)
    space = Space(space_dir)
    opened.append(space)
    rel = "Pages/Alpha.md"
    for i in range(3):
        space.save_body(rel, f"Typing {i}\n", space.cached_version(rel))
        # (Not through the cache: a cached read here would spare the next save its miss.)
        assert read_raw(space_dir, rel, cache=False).of.body == f"Typing {i}\n"
    fmcache.flush_all()
    assert under_lock and not any(under_lock)


def test_many_puts_arm_one_flush_timer(tmp_path: Path, monkeypatch):
    """Re-measured after the fix pass: a timer per `put` cost 3 s on a 5,000-file scan."""
    import threading

    started: list[object] = []
    real_timer = threading.Timer

    class CountingTimer(real_timer):  # type: ignore[misc,valid-type]
        def start(self) -> None:
            started.append(self)
            super().start()

    monkeypatch.setattr(threading, "Timer", CountingTimer)
    cache = fmcache.FrontmatterCache(tmp_path)
    try:
        for i in range(1000):
            cache.put(f"Pages/{i}.md", f"title: {i}\n", {"title": str(i)})
        assert len(started) == 1
    finally:
        cache.flush()  # cancels the timer
