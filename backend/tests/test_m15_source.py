"""M15 Lane B: reading a source in place (zip-slip, links, nested zips, limits, fingerprint)."""

from __future__ import annotations

import os
import stat
import zipfile
from pathlib import Path

import pytest
from m15_helpers import FIXTURES, copy_fixture, snapshot, zip_folder
from objectapp.importers import source as source_mod
from objectapp.importers.source import (
    LimitExceeded,
    NotASource,
    SourceDamaged,
    SourceMissing,
    normalise_entry_name,
    open_source,
)


def _zip(path: Path, entries: dict[str, bytes]) -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in entries.items():
            zf.writestr(zipfile.ZipInfo(name), data)
    return path


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("a/b.md", "a/b.md"),
        ("./a//b.md", "a/b.md"),
        ("a\\b.md", "a/b.md"),
        ("../evil.md", None),
        ("a/../../evil.md", None),
        ("/etc/passwd", None),
        ("C:/Windows/evil.md", None),
        ("C:evil.md", None),
        ("a\x00b.md", None),
        ("bad\udcff.md", None),
    ],
)
def test_entry_names(name, expected):
    assert normalise_entry_name(name) == expected


def test_unsafe_zip_entries_are_skipped_and_never_read(tmp_path):
    z = _zip(
        tmp_path / "evil.zip",
        {"../outside.md": b"# x\n", "/abs.md": b"# y\n", "C:/drive.md": b"# z\n", "ok.md": b"# ok\n"},
    )
    with open_source(z) as src:
        assert set(src.files) == {"ok.md"}
        reasons = {s.path: s.reason for s in src.skipped}
    assert reasons == {"../outside.md": "unsafePath", "/abs.md": "unsafePath", "C:/drive.md": "unsafePath"}


def _mark_encrypted(path: Path, name: bytes) -> None:
    """Set the "encrypted" flag bit of entry ``name`` in its local and central headers."""
    data = bytearray(path.read_bytes())
    for sig, flag_at, name_at in ((b"PK\x03\x04", 6, 30), (b"PK\x01\x02", 8, 46)):
        i = data.find(sig)
        while i != -1:
            if data[i + name_at : i + name_at + len(name)] == name:
                data[i + flag_at] |= 0x1
            i = data.find(sig, i + 4)
    path.write_bytes(bytes(data))


def test_symlink_and_encrypted_zip_entries_are_skipped(tmp_path):
    z = tmp_path / "s.zip"
    with zipfile.ZipFile(z, "w") as zf:
        link = zipfile.ZipInfo("link.md")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        zf.writestr(link, "/etc/passwd")
        zf.writestr("plain.md", "# p\n")
        zf.writestr("secret.md", b"xx")
    _mark_encrypted(z, b"secret.md")
    with open_source(z) as src:
        assert set(src.files) == {"plain.md"}
        assert {s.path: s.reason for s in src.skipped} == {"link.md": "symlink", "secret.md": "encrypted"}


def test_single_top_folder_is_stripped_and_dot_folders_listed_once(tmp_path):
    folder = copy_fixture("import-obsidian", tmp_path / "vault")
    z = zip_folder(folder, tmp_path / "vault.zip", top="My Vault")
    with open_source(z) as src:
        assert src.has_obsidian
        assert "Books/Dune.md" in src.files
        assert not any(p.startswith(".obsidian") for p in src.files)
        assert [s.path for s in src.skipped if s.reason == "appSettings"] == [".obsidian/"]


def test_nested_zips_one_level(tmp_path):
    inner2 = _zip(tmp_path / "deep.zip", {"deep.md": b"# deep\n"})
    part = _zip(tmp_path / "Export-Part-1.zip", {"a.md": b"# a\n", "sub/deeper.zip": inner2.read_bytes()})
    outer = _zip(tmp_path / "Export.zip", {"Export-Part-1.zip": part.read_bytes(), "b.md": b"# b\n"})
    with open_source(outer) as src:
        assert set(src.files) == {"a.md", "b.md"}
        assert src.read("a.md", 100) == b"# a\n"
        assert [s.reason for s in src.skipped] == ["nestedArchive"]


def test_folder_symlinks_are_ignored(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.md").write_text("# secret\n")
    folder = tmp_path / "src"
    folder.mkdir()
    (folder / "ok.md").write_text("# ok\n")
    try:
        os.symlink(outside / "secret.md", folder / "link.md")
        os.symlink(outside, folder / "linkdir")
    except (OSError, NotImplementedError):
        pytest.skip("symlinks not available")
    with open_source(folder) as src:
        assert set(src.files) == {"ok.md"}
        assert {s.path: s.reason for s in src.skipped} == {"link.md": "symlink", "linkdir/": "symlink"}


def test_errors(tmp_path):
    with pytest.raises(SourceMissing):
        open_source(tmp_path / "nope")
    with pytest.raises(SourceMissing):
        open_source("relative/path")
    (tmp_path / "x.txt").write_text("x")
    with pytest.raises(NotASource):
        open_source(tmp_path / "x.txt")
    (tmp_path / "bad.zip").write_bytes(b"not a zip")
    with pytest.raises(NotASource):
        open_source(tmp_path / "bad.zip")


def test_entry_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(source_mod, "MAX_ENTRIES", 3)
    z = _zip(tmp_path / "many.zip", {f"{i}.md": b"# x\n" for i in range(5)})
    with pytest.raises(LimitExceeded):
        open_source(z)


def test_entry_bigger_than_its_header_is_damaged(tmp_path):
    z = _zip(tmp_path / "z.zip", {"a.md": b"# a long body\n"})
    with open_source(z) as src:
        src.files["a.md"].size = 3  # the header says less than the entry holds
        with pytest.raises(SourceDamaged):
            src.read("a.md", 100)


def test_fingerprint_changes_with_the_source(tmp_path):
    folder = copy_fixture("import-anytype", tmp_path / "any")
    with open_source(folder) as src:
        first = src.fingerprint
    with open_source(folder) as src:
        assert src.fingerprint == first
    (folder / "Note.md").write_text("# Note\n\nchanged a lot more text\n")
    with open_source(folder) as src:
        assert src.fingerprint != first


def test_reading_never_writes(tmp_path):
    folder = copy_fixture("import-notion", tmp_path / "n")
    before = snapshot(tmp_path)
    with open_source(folder) as src:
        for rel in src.files:
            src.read(rel, 1 << 20)
    assert snapshot(tmp_path) == before
    assert (FIXTURES / "import-notion").is_dir()
