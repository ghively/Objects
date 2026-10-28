"""Regression tests for the storage-core findings of the 2026-10-28 audit."""

from pathlib import Path

from objectapp.space import Space

ADA = "People/Ada Lovelace.md"


def _write(path: Path, text: str) -> None:
    path.write_bytes(text.encode("utf-8"))


def _version(space: Space, path: str) -> str:
    return space.read(path)[2]


# -- #2: a rename must not stop halfway ---------------------------------------------


def test_rename_carries_on_past_a_referrer_whose_frontmatter_cannot_be_rewritten(
    full_space_dir: Path, monkeypatch
):
    from objectapp import space as space_mod
    from objectapp.frontmatter import FrontmatterError

    space_dir = full_space_dir

    _write(
        space_dir / "Pages" / "AAA.md",
        "---\ntype: 'Page'\ntitle: AAA\nnote: '[[Ada Lovelace]]'\n---\nbody [[Ada Lovelace]]\n",
    )
    space = Space(space_dir)
    real = space_mod.relink_frontmatter

    def flaky(src, fm, should, new):
        if "title: AAA" in src:
            raise FrontmatterError("cannot rewrite")
        return real(src, fm, should, new)

    monkeypatch.setattr(space_mod, "relink_frontmatter", flaky)
    result = space.rename_object(ADA, "Ada King", _version(space, ADA))

    assert result.path == "People/Ada King.md"
    assert [s.path for s in result.skipped] == ["Pages/AAA.md"]
    # Referrers sorted after the failing one are still relinked.
    for rel in ["Projects/Object app.md", "Servers/Alpha.md", "Tasks/Write docs.md"]:
        text = (space_dir / rel).read_text(encoding="utf-8")
        assert "[[Ada King" in text, rel
        assert rel in result.relinked


# -- #3: U+2028, U+2029 and NEL are not line breaks to the line splicer ------------------


def test_set_keys_with_unicode_line_separators_in_a_value_keeps_other_keys():
    from objectapp.frontmatter import parse_fm, set_keys

    for ch in [" ", " ", "\x85"]:
        src = f"id: x\ntitle: 'a{ch}b'\ndescription: d\nlastUpdated: 2026-01-01\n"
        out = set_keys(src, {"lastUpdated": "2026-02-02"})
        assert out == src.replace("2026-01-01", "2026-02-02"), repr(ch)
        assert parse_fm(out)["description"] == "d"


def test_saving_an_object_titled_with_a_line_separator_keeps_created_at(space_dir: Path):
    space = Space(space_dir)
    page = next(t for t in space.types if t.name == "Page")
    rel, version = space.create_object(page.id, "Line sep")
    space.save_body(rel, "hello\n", version)
    _of, fm, _v = space.read(rel)
    assert "createdAt" in fm and fm["title"] == "Line sep"


# -- #4: a case-only move never replaces another file ---------------------------------


def _case_sensitive(folder: Path) -> None:
    """Make ``folder`` case-sensitive (Windows: per-directory flag), or skip the test."""
    import os
    import shutil
    import subprocess

    import pytest

    if os.name == "nt":
        held = folder.with_name(folder.name + ".held")
        folder.rename(held)
        folder.mkdir()
        ok = subprocess.run(
            ["fsutil.exe", "file", "setCaseSensitiveInfo", str(folder), "enable"],
            capture_output=True,
        ).returncode == 0
        for p in held.iterdir():
            shutil.move(str(p), str(folder / p.name))
        held.rmdir()
        if not ok:
            pytest.skip("cannot make a case-sensitive folder here")
    (folder / "probe.x").write_bytes(b"a")
    (folder / "PROBE.x").write_bytes(b"b")
    distinct = (folder / "probe.x").read_bytes() == b"a"
    for name in {p.name for p in folder.glob("*.x")}:
        (folder / name).unlink()
    if not distinct:
        pytest.skip("the file system is case-insensitive")


def test_change_type_case_only_move_does_not_replace_the_other_spelling(space_dir: Path):
    _case_sensitive(space_dir / "Pages")
    alpha = (space_dir / "Pages" / "Alpha.md").read_bytes()
    _write(
        space_dir / "Pages" / "alpha.md",
        "---\ntype: 'Task'\ntitle: Alpha\nstatus: Not Started\n---\nthe task\n",
    )
    space = Space(space_dir)
    page = next(t for t in space.types if t.name == "Page")
    result = space.change_type("Pages/alpha.md", page.id, {}, _version(space, "Pages/alpha.md"))

    assert (space_dir / "Pages" / "Alpha.md").read_bytes() == alpha
    assert result.path not in ("Pages/Alpha.md", "Pages/alpha.md")
    assert "the task" in (space_dir / result.path).read_text(encoding="utf-8")


def test_whiteboard_case_only_sidecar_move_does_not_replace_the_other_spelling(
    tmp_path: Path, monkeypatch
):
    import os

    import pytest
    from objectapp import whiteboardtrash
    from objectapp.whiteboardtrash import _move_one

    # POSIX rename semantics (replace the destination) everywhere, as on Linux/macOS.
    monkeypatch.setattr(whiteboardtrash.os, "rename", os.replace)
    folder = tmp_path / "Boards"
    folder.mkdir()
    _case_sensitive(folder)
    (folder / "b.board.json").write_bytes(b"mine")
    (folder / "B.board.json").write_bytes(b"other")
    with pytest.raises(FileExistsError):
        _move_one(folder / "b.board.json", folder / "B.board.json")
    assert (folder / "B.board.json").read_bytes() == b"other"
    assert (folder / "b.board.json").read_bytes() == b"mine"
