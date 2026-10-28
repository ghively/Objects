"""Regression tests for the storage-core findings of the 2026-10-28 audit."""

from pathlib import Path

from objectapp.relink import wikilink_targets
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


# -- #5: a leading dot never makes a dotfile ---------------------------------------------


def test_safe_filename_strips_leading_dots():
    from objectapp.space import safe_filename

    assert safe_filename(".env") == "env"
    assert safe_filename("..hidden notes") == "hidden notes"
    assert safe_filename(". x") == "x"
    assert safe_filename("...") == "Untitled"


def test_object_titled_with_a_leading_dot_stays_listed(space_dir: Path):
    space = Space(space_dir)
    result = space.rename_object("Pages/Alpha.md", ".env", _version(space, "Pages/Alpha.md"))
    assert result.path == "Pages/env.md"
    assert space.get(result.path).title == ".env"
    assert result.path in [s.path for s in Space(space_dir).list()]


def test_attachment_named_like_a_dotfile_is_listed(space_dir: Path):
    from objectapp.media import attachment_path, import_attachment, list_attachments

    rel, _kind = import_attachment(space_dir, ".env", b"data")
    assert not rel.split("/")[-1].startswith(".")
    assert rel in [a["path"] for a in list_attachments(space_dir)]
    attachment_path(space_dir, rel)


# -- #6: a failure partway through trash_type leaves a restorable entry ------------------


def test_trash_type_failing_partway_leaves_a_restorable_entry(full_space_dir: Path):
    import pytest

    space = Space(full_space_dir)
    task = next(t for t in space.types if t.name == "Task")
    members = space._type_members(task.id, templates=False)
    templates = space._templates_of(task.id)
    assert len(members) >= 2 and templates
    real = space.delete_object
    calls = [0]

    def flaky(rel, **kw):
        calls[0] += 1
        if calls[0] == 2:
            raise PermissionError(13, "locked by another program")
        return real(rel, **kw)

    space.delete_object = flaky
    with pytest.raises(PermissionError):
        space.trash_type(task, members)
    space.delete_object = real

    entries = [i for i in space.list_trash() if i.kind == "type"]
    assert [e.title for e in entries] == ["Task"]
    restored = space.restore(entries[0].id)
    assert (full_space_dir / ".capacities" / "types" / f"{task.id}.json").is_file()
    for rel in templates:
        assert rel in restored["paths"]
        assert (full_space_dir / rel).is_file()
    assert any(p in members for p in restored["paths"])  # the one object that went


# -- a rename never retargets other objects' links ----------------------------------------


def test_rename_keeps_links_to_other_objects_with_the_new_name(space_dir: Path):
    linker = "Pages/Linker.md"
    _write(
        space_dir / linker,
        "---\ntype: 'Page'\ntitle: Linker\n---\nSee [[Notes]] and [[Ada Lovelace]].\n",
    )
    space = Space(space_dir)
    assert space.resolve("Notes", linker) == "Pages/Notes.md"
    assert space.resolve("Ada Lovelace", linker) == ADA

    first = space.rename_object("Pages/Alpha.md", "Notes", _version(space, "Pages/Alpha.md"))
    second = space.rename_object("Pages/What if.md", "Ada Lovelace", _version(space, "Pages/What if.md"))

    assert first.path != "Pages/Notes.md" and second.path == "Pages/Ada Lovelace.md"
    body = space.read(linker)[0].body
    targets = wikilink_targets(body)
    resolved = {space.resolve(t, linker) for t in targets}
    assert resolved == {"Pages/Notes.md", ADA}
    assert linker in first.relinked and linker in second.relinked


# -- frontmatter link rewrite keeps every YAML form's value and bytes ----------------------


def _relink(src: str, new: str = "New Name: x") -> str:
    from objectapp.frontmatter import parse_fm
    from objectapp.relink import relink_frontmatter

    return relink_frontmatter(src, parse_fm(src), lambda t: t == "Old", new)


def test_relink_frontmatter_yaml_forms():
    from objectapp.frontmatter import parse_fm

    # A multi-line plain scalar: rewritten (no error), whatever the new name holds.
    out = _relink("a: first line\n  see [[Old]] here\nb: 1\n")
    assert parse_fm(out) == {"a": "first line see [[New Name: x]] here", "b": 1}
    out = _relink("a: owned by\n  [[Old]] mostly\nb: 1\n", "Ada King")
    assert out == "a: owned by\n  [[Ada King]] mostly\nb: 1\n"
    # A block-list item that is a mapping stays a mapping.
    out = _relink("a:\n  - '[[Old]]'\n  - role: '[[Old]]'\nb: 1\n")
    assert out == "a:\n  - '[[New Name: x]]'\n  - role: '[[New Name: x]]'\nb: 1\n"
    # Multi-line single-quoted: the folded value is kept, line break and all.
    out = _relink("a: '[[Old]]\n  continued'\nb: 1\n")
    assert out == "a: '[[New Name: x]]\n  continued'\nb: 1\n"
    # Double-quoted escapes outside the link are kept as written.
    out = _relink('dq: "\\u00e9 [[Old]]"\nb: 1\n')
    assert out == 'dq: "\\u00e9 [[New Name: x]]"\nb: 1\n'
    # An unquoted link (YAML reads it as a nested list) is rewritten too.
    assert _relink("owner: [[Old]]\nb: 1\n", "Ada King") == "owner: [[Ada King]]\nb: 1\n"
    assert parse_fm(_relink("owner: [[Old|al]]\n")) == {"owner": [["New Name: x|al"]]}


def test_rename_rewrites_unquoted_and_multiline_frontmatter_links(full_space_dir: Path):
    _write(
        full_space_dir / "Pages" / "AAA.md",
        "---\ntype: 'Page'\ntitle: AAA\nowner: [[Ada Lovelace]]\nnote: owned by\n"
        "  see [[Ada Lovelace]] here\nrefs:\n  - role: '[[Ada Lovelace]]'\n---\nbody\n",
    )
    space = Space(full_space_dir)
    result = space.rename_object(ADA, "Ada: King", _version(space, ADA))
    assert "Pages/AAA.md" in result.relinked and not result.skipped
    _of, fm, _v = space.read("Pages/AAA.md")
    assert fm["owner"] == [["Ada: King"]]
    assert fm["note"] == "owned by see [[Ada: King]] here"
    assert fm["refs"] == [{"role": "[[Ada: King]]"}]


# -- long names: capped in bytes, and an existing long name still saves --------------------


def test_safe_filename_caps_the_stem_in_utf8_bytes():
    from objectapp.space import safe_filename

    for title in ["\U0001f600" * 70, "é" * 130, "漢" * 100]:
        stem = safe_filename(title)
        assert 0 < len(stem.encode("utf-8")) <= 200, title[:3]
        assert title.startswith(stem)
    assert safe_filename("a" * 130) == "a" * 120  # the character cap is unchanged


def test_an_existing_249_byte_name_still_saves(space_dir: Path):
    name = "a" * 246 + ".md"
    rel = f"Pages/{name}"
    _write(space_dir / "Pages" / name, "---\ntype: 'Page'\n---\nhi\n")
    space = Space(space_dir)
    space.save_body(rel, "changed\n", _version(space, rel))
    assert (space_dir / "Pages" / name).read_bytes().endswith(b"changed\n")
    assert sorted(p.name for p in (space_dir / "Pages").iterdir() if p.name.startswith(".")) == []


# -- mixed line endings: new lines take the majority ending ---------------------------------


def test_encode_like_uses_the_majority_line_ending():
    from objectapp.textfile import decode, encode_like

    original = b"a\nb\nc\r\nd\n"
    assert decode(original).eol == "\n"
    assert decode(original).text == "a\nb\nc\nd\n"
    assert encode_like(original, "a\nb\nc\nnew\nd\n") == b"a\nb\nc\r\nnew\nd\n"
    crlf = b"a\r\nb\r\nc\nd\r\n"
    assert decode(crlf).eol == "\r\n"
    assert encode_like(crlf, "a\nb\nc\nnew\nd\n") == b"a\r\nb\r\nc\nnew\r\nd\r\n"


def test_property_edit_in_a_mostly_lf_file_adds_lf_lines(space_dir: Path):
    path = space_dir / "Pages" / "Alpha.md"
    data = path.read_bytes().replace(b"\r\n", b"\n")
    assert data.count(b"\n") > 3
    lines = data.split(b"\n")
    lines[-2] += b"\r"  # one CRLF line near the end
    path.write_bytes(b"\n".join(lines))
    space = Space(space_dir)
    space.update_properties("Pages/Alpha.md", {"description": "x"}, _version(space, "Pages/Alpha.md"))
    after = path.read_bytes()
    assert after.count(b"\r\n") == 1
