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
