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
