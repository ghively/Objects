"""Regression tests for the storage-core items of the 2026-11-01 audit's second fix pass."""

import os
from itertools import pairwise
from pathlib import Path

import pytest
from objectapp import space as space_mod
from objectapp.space import Space

ADA = "People/Ada Lovelace.md"


def _write(path: Path, text: str) -> None:
    path.write_bytes(text.encode("utf-8"))


# -- 1: `_rel` resolves a known path once, not per call ----------------------------


def _count_resolves(monkeypatch) -> list[Path]:
    calls: list[Path] = []
    real = Path.resolve

    def counting(self, *args, **kwargs):
        calls.append(self)
        return real(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", counting)
    return calls


def test_rel_skips_resolve_for_a_known_checked_path(space_dir: Path, monkeypatch):
    space = Space(space_dir)
    space._rel(ADA)  # the first check is in full
    calls = _count_resolves(monkeypatch)
    for _ in range(50):
        assert space._rel(ADA) == ADA
        space.get(ADA)
    assert calls == []


def test_rel_still_checks_unknown_and_unnormalised_paths(space_dir: Path, monkeypatch):
    space = Space(space_dir)
    space._rel(ADA)
    calls = _count_resolves(monkeypatch)
    assert space._rel("People//Ada Lovelace.md") == ADA  # another spelling: checked in full
    assert space._rel("Pages/Not yet.md") == "Pages/Not yet.md"
    assert len(calls) == 2
    for bad in ("../x.md", "/etc/x.md", ".capacities/x.md", "People/Ada.txt"):
        with pytest.raises(ValueError):
            space._rel(bad)


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_rel_checks_again_after_the_file_is_replaced_by_a_symlink_out(
    space_dir: Path, tmp_path: Path
):
    space = Space(space_dir)
    assert space._rel(ADA) == ADA
    outside = tmp_path / "outside.md"
    _write(outside, "---\ntitle: Secret\n---\n")
    (space_dir / ADA).unlink()
    (space_dir / ADA).symlink_to(outside)
    with pytest.raises(ValueError):
        space.rescan_file(ADA)  # the watcher's refresh
    with pytest.raises(ValueError):
        space._rel(ADA)
    with pytest.raises(ValueError):
        space.read(ADA)


def test_rel_cache_forgets_deleted_paths(space_dir: Path):
    space = Space(space_dir)
    space._rel(ADA)
    assert ADA in space._checked_rels
    (space_dir / ADA).unlink()
    space.rescan_file(ADA)
    assert ADA not in space._checked_rels and ADA not in space._summaries


# -- 2: `_type_id` is a dict lookup, rebuilt only when the types change ---------------


def test_type_id_is_a_lookup_built_once_per_change_of_types(space_dir: Path, monkeypatch):
    from objectapp.typemodel import TypeDefinition

    space = Space(space_dir)
    assert space._type_id("Person") == "person" and space._type_id("PERSON") == "person"
    built = []
    real_reversed = reversed

    def counting(seq):
        if seq is space.types:
            built.append(1)
        return real_reversed(seq)

    monkeypatch.setattr("builtins.reversed", counting)
    for _ in range(100):
        assert space._type_id("person") == "person"
        assert space._type_id("No such type") == "no-such-type"
    assert built == []

    # In place, by assignment and by `_types_changed`: each drops the lookup.
    space.types.append(
        TypeDefinition.from_json({"id": "gadget", "name": "Gadget", "formerNames": ["Widget"]})
    )
    assert space._type_id("widget") == "gadget"
    space.types = [t for t in space.types if t.id != "gadget"]
    assert space._type_id("widget") == "widget"
    space.types[0].formerNames.append("Old name")
    space._types_changed(space.types[0].id)
    assert space._type_id("old name") == space.types[0].id


def test_type_id_keeps_name_then_id_then_former_name_order(space_dir: Path):
    from objectapp.typemodel import TypeDefinition

    space = Space(space_dir)
    space.types = [
        TypeDefinition.from_json({"id": "a", "name": "Shared", "formerNames": ["b"]}),
        TypeDefinition.from_json({"id": "shared", "name": "B"}),
        TypeDefinition.from_json({"id": "c", "name": "C", "formerNames": ["Older"]}),
        TypeDefinition.from_json({"id": "d", "name": "D", "formerNames": ["older"]}),
    ]
    assert space._type_id("shared") == "a"  # a name beats an id
    assert space._type_id("b") == "shared"  # a name beats a former name
    assert space._type_id("OLDER") == "c"  # the first type wins within one kind


# -- 3: a template of an unknown type doesn't re-infer every file per rescan ---------


def test_rescanning_a_template_of_an_unknown_type_infers_nothing(space_dir: Path, monkeypatch):
    rel = "Templates/Gizmo template.md"
    (space_dir / "Templates").mkdir(exist_ok=True)
    _write(space_dir / rel, "---\ntype: Gizmo\ntemplate: 'Gizmo'\ntitle: Gizmo template\n---\n")
    space = Space(space_dir)
    assert space._type_id("Gizmo") not in {t.id for t in space.types}
    calls = []
    real = space_mod.infer_types_from
    monkeypatch.setattr(
        space_mod, "infer_types_from", lambda objs: calls.append(1) or real(objs)
    )
    for i in range(3):
        _write(
            space_dir / rel,
            f"---\ntype: Gizmo\ntemplate: 'Gizmo'\ntitle: Gizmo template\n---\nEdit {i}\n",
        )
        space.rescan_file(rel)
    assert calls == []
    # An ordinary object of a new type is still inferred (once).
    _write(space_dir / "Pages/A gizmo.md", "---\ntype: Gizmo\ntitle: A gizmo\n---\n")
    space.rescan_file("Pages/A gizmo.md")
    space.rescan_file("Pages/A gizmo.md")
    assert len(calls) == 1
    assert space.get("Pages/A gizmo.md").type in {t.id for t in space.types}


# -- 4: the link index's pending changes are bounded --------------------------------


def test_link_index_pending_collapses_to_a_full_rebuild(space_dir: Path, monkeypatch):
    from objectapp import linkindex

    monkeypatch.setattr(linkindex, "_MAX_PENDING", 5)
    space = Space(space_dir)
    assert "Pages/Notes.md" in space.links.backlinks("Pages/Alpha.md")
    for i in range(200):
        _write(space_dir / "Pages/Notes.md", f"Mentions [[Alpha]] {i}.\n")
        space.rescan_file("Pages/Notes.md")
    assert len(space.links._pending) <= max(5, len(space._raw)) + 1
    _write(space_dir / "Pages/Notes.md", "No links any more.\n")
    space.rescan_file("Pages/Notes.md")
    assert "Pages/Notes.md" not in space.links.backlinks("Pages/Alpha.md")
    assert space.links._pending == [] and not space.links._overflow


# -- 5: a media export is streamed through a temporary file outside the space --------


def test_media_export_goes_to_a_temp_file_in_the_state_dir(full_space_dir: Path, monkeypatch):
    import io
    import zipfile

    from objectapp import export
    from objectapp.appstate import state_dir

    root = full_space_dir
    big = root / "Attachments" / "big.bin"
    big.write_bytes(os.urandom(256) * 4096)  # 1 MB
    _write(root / "Pages/With media.md", "---\ntitle: With media\n---\n![[Attachments/big.bin]]\n")
    space = Space(root)
    before = {p.relative_to(root) for p in root.rglob("*")}

    held = []
    real_bytesio = io.BytesIO
    monkeypatch.setattr(export.io, "BytesIO", lambda *a: held.append(1) or real_bytesio(*a))
    out = export.export_object_to_file(space, "Pages/With media.md", True)
    assert held == []  # no in-memory zip
    assert out.data == b"" and out.file is not None and out.filename == "With media.zip"
    assert out.file.parent == state_dir() / "exports"
    assert not out.file.is_relative_to(root)
    with zipfile.ZipFile(out.file) as zf:
        assert sorted(zf.namelist()) == ["Attachments/big.bin", "With media.md"]
        assert zf.read("Attachments/big.bin") == big.read_bytes()
    out.cleanup()
    out.cleanup()  # idempotent
    assert not out.file.exists()
    assert {p.relative_to(root) for p in root.rglob("*")} == before  # nothing in the space

    # Without media it is the file's bytes, no temp file.
    md = export.export_object_to_file(space, "Pages/With media.md", False)
    assert md.file is None and md.data == (root / "Pages/With media.md").read_bytes()
    with pytest.raises(KeyError):
        export.export_object_to_file(space, "Pages/Nope.md", True)
    assert list((state_dir() / "exports").iterdir()) == []


def test_media_export_sweeps_stale_files_and_cleans_up_on_failure(
    full_space_dir: Path, monkeypatch
):
    import time

    from objectapp import export

    space = Space(full_space_dir)
    folder = export.export_dir()
    folder.mkdir(parents=True)
    stale, fresh = folder / "export-old.zip", folder / "export-new.zip"
    stale.write_bytes(b"x")
    fresh.write_bytes(b"x")
    old = time.time() - 2 * 3600
    os.utime(stale, (old, old))

    def boom(*_a):
        raise OSError("disk full")

    monkeypatch.setattr(export, "_write_zip", boom)
    with pytest.raises(OSError):
        export.export_object_to_file(space, ADA, True)
    assert sorted(p.name for p in folder.iterdir()) == ["export-new.zip"]


# -- 6: `Space.name` is read once per change of space.json ----------------------------


def test_space_name_is_cached_until_space_json_changes(space_dir: Path, monkeypatch):
    from objectapp import spaceconfig

    space = Space(space_dir)
    assert space.name == space_dir.name
    reads = []
    real = spaceconfig.read
    monkeypatch.setattr(spaceconfig, "read", lambda root: reads.append(1) or real(root))
    for _ in range(20):
        assert space.name == space_dir.name
    assert reads == []
    cfg = space_dir / ".capacities" / "space.json"
    cfg.parent.mkdir(exist_ok=True)
    cfg.write_text('{"name": "Work"}', encoding="utf-8")
    assert space.name == "Work"
    assert space.name == "Work"
    assert len(reads) == 1
    cfg.write_text('{"name": "Home"}', encoding="utf-8")  # same size, edited in place
    assert space.name == "Home"
    cfg.unlink()
    assert space.name == space_dir.name


# -- 7: reloading collections parses only the files that changed ----------------------


def test_reload_collections_parses_only_changed_files(space_dir: Path, monkeypatch):
    from objectapp import jsonstore

    folder = space_dir / ".capacities" / "collections"
    folder.mkdir(parents=True)
    for cid in ("one", "two", "three"):
        (folder / f"{cid}.json").write_text(
            f'{{"id": "{cid}", "name": "{cid.title()}", "typeIds": []}}\n', encoding="utf-8"
        )
    space = Space(space_dir)
    parses = []
    real = jsonstore.parse_json_object
    monkeypatch.setattr(jsonstore, "parse_json_object", lambda d: parses.append(d) or real(d))
    for _ in range(5):
        space.reload_collections()
    assert parses == []
    assert [c.name for c in space.list_collections()] == ["One", "Three", "Two"]

    (folder / "two.json").write_text('{"id": "two", "name": "Second", "typeIds": []}\n')
    (folder / "four.json").write_text('{"id": "four", "name": "Four", "typeIds": []}\n')
    (folder / "one.json").unlink()
    (folder / "three.json").write_text("{not json")
    pairs = space.collections_with_revisions()
    assert len(parses) == 3  # two.json, three.json (unreadable now) and four.json
    by_id = {c.id: (c, rev) for c, rev in pairs}
    assert sorted(by_id) == ["four", "three", "two"]
    assert by_id["two"][0].name == "Second"
    assert by_id["three"][0].readOnlyReason
    assert by_id["two"][1] == space.collection_revision("two")

    # A definition the app replaced in memory is re-read from its file.
    space.collections["four"] = space._load_collection("four", {"name": "Stale"}, None)
    space.reload_collections()
    assert space.collections["four"].name == "Four"


# -- 9: unconfirmed storage items --------------------------------------------------------


def test_an_upper_case_md_suffix_is_listed_from_the_start(space_dir: Path):
    from objectapp.typedefs import iter_object_paths

    _write(space_dir / "Pages/Shout.MD", "---\ntitle: Shout\n---\nLoud.\n")
    _write(space_dir / "Pages/Mixed.Md", "---\ntitle: Mixed\n---\n")
    (space_dir / ".dotfolder").mkdir()
    _write(space_dir / ".dotfolder/In dot folder.md", "x\n")
    _write(space_dir / "Pages/.dotfile.md", "x\n")
    _write(space_dir / "Pages/Not an object.mdx", "x\n")
    paths = list(iter_object_paths(space_dir))
    assert "Pages/Shout.MD" in paths and "Pages/Mixed.Md" in paths
    assert not any(p.startswith(".") or "/." in p or p.endswith(".mdx") for p in paths)
    assert paths == sorted(paths)
    space = Space(space_dir)
    assert space.get("Pages/Shout.MD").title == "Shout"
    assert "Pages/Shout.MD" in {s.path for s in space.list()}


def test_safe_filename_replaces_a_lone_surrogate(space_dir: Path):
    from objectapp.space import safe_filename

    for title in ("A\udc80B", "\ud800", "x\udfff\udfffy"):
        stem = safe_filename(title)
        stem.encode("utf-8")  # a UTF-8 file name
        assert "�" in stem
    assert safe_filename("A\udc80B") == "A�B"
    space = Space(space_dir)
    _of, _fm, version = space.read("Pages/Alpha.md")
    try:
        res = space.rename_object("Pages/Alpha.md", "Alpha \udc80", version)
    except ValueError:
        pass  # refused cleanly
    else:
        res.path.encode("utf-8")
        assert (space_dir / res.path).is_file()
    assert all(p.encode("utf-8") for p in os.listdir(space_dir / "Pages"))


def test_history_index_write_is_checked_against_a_concurrent_writer(tmp_path: Path, monkeypatch):
    import json
    from datetime import UTC, datetime, timedelta

    from objectapp import history

    root = tmp_path / "space"
    (root / "Pages").mkdir(parents=True)
    rel = "Pages/A.md"
    data = b"---\nid: 01JC8M80000000000000000099\ntitle: A\n---\nBody.\n"
    (root / rel).write_bytes(data)
    store = history.HistoryStore(root)
    t0 = datetime(2026, 11, 1, 10, 0, tzinfo=UTC)
    store.snapshot(rel, data, t0)
    index_path = store.dir / "01JC8M80000000000000000099" / "index.json"

    real = history.atomic_write
    raced = []

    def racing(path, payload, check=None):
        if Path(path).name == "index.json" and not raced:
            # Another app on the same space adds a version between the read and the replace.
            others = json.loads(index_path.read_bytes())
            others.append({"id": "other", "at": "2026-11-01T10:07:00.000Z", "rel": rel, "files": []})
            index_path.write_bytes(json.dumps(others).encode())
            raced.append(1)
        return real(path, payload, check=check)

    monkeypatch.setattr(history, "atomic_write", racing)
    vid = store.snapshot(rel, data + b"more\n", t0 + timedelta(minutes=10))
    ids = [e["id"] for e in json.loads(index_path.read_bytes())]
    assert raced and "other" in ids and vid in ids and len(ids) == 3


def test_frontmatter_cache_flushes_a_lone_surrogate_value(space_dir: Path):
    """Found with the surrogate title above: the cache's flush raised and dropped the cache."""
    from objectapp import fmcache

    _write(space_dir / "Pages/Odd.md", '---\ntitle: "Odd \\uDC80"\n---\n')
    space = Space(space_dir)  # the opening scan flushes the cache
    assert space.get("Pages/Odd.md").title == "Odd \udc80"
    cache = fmcache.for_root(space_dir)
    assert cache.path.is_file()
    cache._entries = None  # read it back from the file
    src = "title: \"Odd \\uDC80\"\n"
    assert cache.get("Pages/Odd.md", src) == {"title": "Odd \udc80"}


# -- 12: `_rel`'s component cap counts what the file system counts ---------------------


def test_component_cap_counts_utf16_units_on_windows_and_bytes_elsewhere(monkeypatch):
    cjk = "漢" * 200 + ".md"  # 203 UTF-16 units, 603 UTF-8 bytes
    emoji = "\U0001f600" * 127 + ".md"  # 257 UTF-16 units (surrogate pairs), 511 bytes
    exact = "é" * 252 + ".md"  # 255 UTF-16 units, 507 bytes

    monkeypatch.setattr(space_mod.os, "name", "nt")
    assert not space_mod._component_too_long(cjk)
    assert space_mod._component_too_long(emoji)
    assert not space_mod._component_too_long(exact)
    assert space_mod._component_too_long("a" * 253 + ".md")
    monkeypatch.undo()

    monkeypatch.setattr(space_mod.os, "name", "posix")
    assert space_mod._component_too_long(cjk)
    assert space_mod._component_too_long(emoji)
    assert space_mod._component_too_long(exact)
    assert not space_mod._component_too_long("a" * 252 + ".md")
    assert space_mod._component_too_long("a" * 253 + ".md")


@pytest.mark.skipif(os.name == "nt", reason="the POSIX branch")
def test_rel_refuses_a_component_over_255_bytes(space_dir: Path):
    space = Space(space_dir)
    with pytest.raises(ValueError, match="too long"):
        space._rel("Pages/" + "漢" * 100 + ".md")  # 303 bytes
    assert space._rel("Pages/" + "漢" * 80 + ".md")  # 243 bytes


# -- 10: a flush of many paths (a git checkout) is one resync -------------------------


def _flushed(space: Space, paths: list[str]) -> list:
    import asyncio

    from objectapp.watcher import SpaceWatcher

    loop = asyncio.new_event_loop()
    try:
        watcher = SpaceWatcher(space, loop)  # not started: the batch is flushed by hand
        watcher._flush([(p, None) for p in paths])
        loop.run_until_complete(asyncio.sleep(0.05))
        out = []
        while not watcher.events.empty():
            out.append(watcher.events.get_nowait())
        return out
    finally:
        loop.close()


def test_a_big_watcher_batch_is_one_resync_event(space_dir: Path):
    from objectapp.watcher import RESYNC_AFTER

    space = Space(space_dir)
    new = [f"Pages/Checked out {i:03d}.md" for i in range(RESYNC_AFTER + 1)]
    for rel in new:
        _write(space_dir / rel, f"---\ntitle: {rel}\n---\n")
    folder = space_dir / ".capacities" / "collections"
    folder.mkdir(parents=True)
    _write(folder / "reading.json", '{"id": "reading", "name": "Reading", "typeIds": []}\n')
    events = _flushed(space, [*new, ".capacities/collections/reading.json"])
    assert [(e.kind, e.path, e.origin) for e in events] == [
        ("types", "*", None),
        ("collections", "reading", None),
    ]
    assert all(rel in space._summaries for rel in new)  # every file was still rescanned


def test_a_small_watcher_batch_keeps_one_event_per_path(space_dir: Path):
    from objectapp.watcher import RESYNC_AFTER

    space = Space(space_dir)
    new = [f"Pages/Small {i:03d}.md" for i in range(RESYNC_AFTER)]
    for rel in new:
        _write(space_dir / rel, f"---\ntitle: {rel}\n---\n")
    events = _flushed(space, new)
    assert sorted((e.kind, e.path) for e in events) == [("created", rel) for rel in new]


# -- 11: a type rename rewrites each file with one YAML parse --------------------------

_ONE_LINE_CASES = [
    "type: 'Book'\ntitle: A\n",
    'type: "Book"\ntitle: A\n',
    "type: Book\ntitle: A\n",
    "title: A\ntype: Book # a comment\n",
    "title: A\ntype:   'Book'   \n",
    "type: [Book, Other]\n",
    "type: 'Bo''ok'\n",
    "type: Book\n  continued\n",
    "type: |\n  Book\n",
    "type:\n  - Book\n",
    'a: "x\ntype: Book"\ntype: Book\n',
    "type: 'Book\n  more'\n",
    "type: &a Book\nother: *a\n",
    "type: Book\nlist:\n  - [[x]]\n",
]


@pytest.mark.parametrize("src", _ONE_LINE_CASES)
def test_replace_in_value_with_parsed_matches_the_round_trip_path(src: str):
    from objectapp import frontmatter

    def fn(v: str) -> str:
        return "Volume: two" if v in ("Book", "Bo'ok") else v

    fm = frontmatter.parse_fm(src)
    slow = frontmatter.replace_in_value(src, "type", fn)
    fast = frontmatter.replace_in_value(src, "type", fn, parsed=fm)
    assert fast == slow
    if fast != src:
        assert frontmatter.take_parsed(fast) == frontmatter.parse_fm(fast)


def test_a_write_leaves_its_new_frontmatter_in_the_cache(space_dir: Path, monkeypatch):
    """Re-measured: a second type rename parsed every file again in `read_raw` (a cache miss)."""
    from objectapp import typedefs
    from objectapp.typedefs import read_raw

    space = Space(space_dir)
    space.update_properties(ADA, {"description": "Changed"}, space.read(ADA)[2])
    space.save_body(ADA, "A new body.\n", space.read(ADA)[2])  # a stamped body save
    parses = []
    real = typedefs.parse_fm
    monkeypatch.setattr(typedefs, "parse_fm", lambda s: parses.append(s) or real(s))
    raw = read_raw(space_dir, ADA)
    assert parses == []
    assert raw.fm == real(raw.of.frontmatter_src)
    assert raw.fm["description"] == "Changed"


def test_type_rename_parses_each_rewritten_file_once(space_dir: Path, monkeypatch):
    import copy

    from objectapp import frontmatter

    space = Space(space_dir)
    members = space._type_members("person")
    for i in range(4):
        _write(
            space_dir / f"People/Extra {i}.md",
            f"---\ntype: 'Person'\ntitle: Extra {i}\nrole: 'x'\n---\nBody {i}.\n",
        )
        space.rescan_file(f"People/Extra {i}.md")
    members = space._type_members("person")
    t, rev = space.refresh_type("person")
    new = copy.deepcopy(t)
    new.name, new.pluralName = "Human", "Humans"
    parses, rt = [], []
    real_parse, real_rt = frontmatter.parse_fm, frontmatter._load_rt
    monkeypatch.setattr(frontmatter, "parse_fm", lambda s: parses.append(s) or real_parse(s))
    monkeypatch.setattr(frontmatter, "_load_rt", lambda s: rt.append(s) or real_rt(s))
    res = space.save_type(new, rev, confirm=True)
    assert sorted(res.rewritten) == sorted(members) and len(members) >= 5
    assert rt == []
    assert len(parses) == len(members)  # the check of each result, handed on to the rescan
    for rel in members:
        text = (space_dir / rel).read_text(encoding="utf-8")
        assert "type: 'Human'" in text
        assert space.get(rel).type == "person"
        assert space._raw[rel].fm["type"] == "Human"


# -- 8: history snapshots are deltas or gzip, not whole copies --------------------------


def _store(tmp_path: Path):
    from datetime import UTC, datetime

    from objectapp.history import HistoryStore

    root = tmp_path / "space"
    (root / "Pages").mkdir(parents=True)
    return HistoryStore(root), datetime(2026, 11, 1, 10, 0, tzinfo=UTC)


def _page(i: int, body: str = "") -> bytes:
    text = "Lorem ipsum dolor sit amet, a long enough body for a delta. " * 40
    return (
        f"---\nid: 01JC8M80000000000000000077\ntitle: Page {i}\n---\n{text}{body}\n"
    ).encode()


def test_a_small_change_is_kept_as_a_delta_with_no_file(tmp_path: Path):
    import json
    from datetime import timedelta

    store, t0 = _store(tmp_path)
    rel = "Pages/P.md"
    datas = [_page(i) for i in range(5)]
    vids = [store.snapshot(rel, d, t0 + timedelta(minutes=6 * i)) for i, d in enumerate(datas)]
    folder = store.dir / "01JC8M80000000000000000077"
    index = json.loads((folder / "index.json").read_bytes())
    assert index[0]["files"] == [vids[0] + ".md.gz"]
    assert all(e["files"] == [] and e["delta"]["base"] == p["id"] for p, e in pairwise(index))
    assert sorted(p.name for p in folder.iterdir()) == sorted([vids[0] + ".md.gz", "index.json"])
    stored = sum(p.stat().st_size for p in folder.iterdir())
    assert stored < len(datas[0])  # five versions in less than one plain copy
    (store.root / rel).write_bytes(datas[-1])  # the object's id is read from its file
    for vid, data in zip(vids, datas):
        assert store.content(rel, vid)["text"] == data.decode()
    assert [v["size"] for v in store.versions(rel)] == [len(d) for d in reversed(datas)]
    assert [v["title"] for v in store.versions(rel)] == [f"Page {i}" for i in range(4, -1, -1)]


def test_a_big_change_and_a_long_chain_store_the_version_whole(tmp_path: Path):
    import json
    from datetime import timedelta

    from objectapp import history

    store, t0 = _store(tmp_path)
    rel = "Pages/P.md"
    vids = [store.snapshot(rel, _page(i), t0 + timedelta(minutes=6 * i)) for i in range(40)]
    index = json.loads((store.dir / "01JC8M80000000000000000077" / "index.json").read_bytes())
    whole = [i for i, e in enumerate(index) if "delta" not in e]
    assert whole == list(range(0, 40, history._MAX_CHAIN))
    other = b"---\nid: 01JC8M80000000000000000077\n---\n" + b"completely different\n" * 200
    vid = store.snapshot(rel, other, t0 + timedelta(hours=10))
    index = json.loads((store.dir / "01JC8M80000000000000000077" / "index.json").read_bytes())
    assert index[-1]["id"] == vid and index[-1]["files"] == [vid + ".md.gz"]
    (store.root / rel).write_bytes(other)
    assert store.content(rel, vid)["text"] == other.decode()
    assert store.content(rel, vids[37])["text"] == _page(37).decode()


def test_legacy_plain_versions_still_read_and_a_corrupt_delta_is_not_found(tmp_path: Path):
    import json
    from datetime import timedelta

    from objectapp.history import VersionNotFound

    store, t0 = _store(tmp_path)
    rel = "Pages/P.md"
    folder = store.dir / "01JC8M80000000000000000077"
    folder.mkdir(parents=True)
    (folder / "20261101T090000000Z.md").write_bytes(_page(0))
    (folder / "index.json").write_text(json.dumps([
        {"id": "20261101T090000000Z", "at": "2026-11-01T09:00:00.000Z", "rel": rel,
         "kind": "object", "files": ["20261101T090000000Z.md"]},
    ]))
    vid = store.snapshot(rel, _page(1), t0 + timedelta(minutes=6))
    (store.root / rel).write_bytes(_page(2))
    index = json.loads((folder / "index.json").read_bytes())
    assert index[-1]["delta"]["base"] == "20261101T090000000Z"
    assert store.content(rel, "20261101T090000000Z")["text"] == _page(0).decode()
    assert store.content(rel, vid)["text"] == _page(1).decode()
    index[-1]["delta"]["mid"] = "QUJD"  # "ABC": the sha1 no longer matches
    (folder / "index.json").write_text(json.dumps(index))
    with pytest.raises(VersionNotFound):
        store.content(rel, vid)


def test_hub_rename_history_growth_is_small(links_space_dir: Path):
    from datetime import timedelta

    from fastapi.testclient import TestClient
    from objectapp.appstate import state_dir
    from objectapp.server import create_app

    space = Space(links_space_dir)
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    clock = [space.clock()]
    space.clock = lambda: clock[0]
    with TestClient(app) as c:
        target = next(p for p in space._summaries if space.links.backlinks(p))
        referrers = len(space.links.backlinks(target))

        def size() -> tuple[int, int]:
            files = [p for p in (state_dir() / "history").rglob("*") if p.is_file()]
            return sum(p.stat().st_size for p in files), len(files)

        sizes = [size() if (state_dir() / "history").exists() else (0, 0)]
        for title in ("Renamed once", "Renamed twice"):
            clock[0] += timedelta(minutes=10)
            r = c.post(
                "/api/object/rename",
                json={"path": target, "title": title, "baseVersion": space.read(target)[2]},
            )
            assert r.status_code == 200, r.text
            target = r.json()["path"]
            sizes.append(size())
        # The second rename's snapshots are deltas: no new files, a few hundred bytes each.
        assert sizes[2][1] == sizes[1][1]
        assert sizes[2][0] - sizes[1][0] < 600 * (referrers + 1)
