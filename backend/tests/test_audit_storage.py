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
