"""Regression tests for the storage-core items of the 2026-11-01 audit's second fix pass."""

import os
from pathlib import Path

import pytest
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
    for bad in ("../x.md", "/etc/x.md", ".object/x.md", "People/Ada.txt"):
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
