"""Older folder names are renamed once when a space is opened; .md files never change."""

from __future__ import annotations

import json
from pathlib import Path

from objectapp.legacy import has_legacy_metadata, migrate_legacy_folders
from objectapp.space import Space
from objectapp.spaces import _is_space_folder

# folder names used by spaces made before 2026-11-04
OLD_META = ".capacities"
OLD_CACHE = ".capacities-cache"


def _md(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*.md")}


def _old_space(root: Path) -> Path:
    (root / OLD_META / "types").mkdir(parents=True)
    (root / OLD_META / "space.json").write_text(json.dumps({"name": "Old"}), "utf-8")
    (root / OLD_CACHE).mkdir()
    (root / OLD_CACHE / "fm.json").write_text("{}", "utf-8")
    (root / "Pages").mkdir()
    (root / "Pages" / "Note.md").write_bytes(b"\xef\xbb\xbf---\r\ntype: page\r\n---\r\n# Note\r\n")
    return root


def test_old_folders_only_are_renamed(tmp_path: Path):
    root = _old_space(tmp_path)
    md = _md(root)
    assert has_legacy_metadata(root)
    assert sorted(migrate_legacy_folders(root)) == [".object", ".object-cache"]
    assert not (root / OLD_META).exists() and not (root / OLD_CACHE).exists()
    assert json.loads((root / ".object" / "space.json").read_text("utf-8")) == {"name": "Old"}
    assert (root / ".object-cache" / "fm.json").is_file()
    assert _md(root) == md
    assert not has_legacy_metadata(root)
    assert migrate_legacy_folders(root) == []  # once


def test_both_exist_old_is_left_alone(tmp_path: Path):
    root = _old_space(tmp_path)
    (root / ".object").mkdir()
    (root / ".object" / "space.json").write_text(json.dumps({"name": "New"}), "utf-8")
    md = _md(root)
    assert not has_legacy_metadata(root)
    assert migrate_legacy_folders(root) == [".object-cache"]
    assert json.loads((root / OLD_META / "space.json").read_text("utf-8")) == {"name": "Old"}
    assert json.loads((root / ".object" / "space.json").read_text("utf-8")) == {"name": "New"}
    assert _md(root) == md
    assert Space(root).name == "New"
    assert (root / OLD_META / "space.json").is_file()


def test_neither_exists_nothing_happens(tmp_path: Path):
    (tmp_path / "Note.md").write_text("# Note\n", "utf-8")
    assert not has_legacy_metadata(tmp_path)
    assert migrate_legacy_folders(tmp_path) == []
    assert sorted(p.name for p in tmp_path.iterdir()) == ["Note.md"]


def test_opening_a_space_migrates_it(tmp_path: Path):
    root = _old_space(tmp_path)
    md = _md(root)
    space = Space(root)
    assert space.name == "Old"
    assert (root / ".object" / "space.json").is_file()
    assert not (root / OLD_META).exists()
    assert _md(root) == md


def test_an_old_only_folder_counts_as_a_space(tmp_path: Path):
    root = _old_space(tmp_path)
    assert _is_space_folder(root)
    assert not _is_space_folder(tmp_path / "Pages")
