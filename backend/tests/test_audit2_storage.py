"""Regression tests for the storage-core items of the 2026-11-01 audit's second fix pass."""

import os
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
