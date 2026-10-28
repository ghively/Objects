"""The M7 fixture: `space-blocks`, every block form and attachment kind (M7 Task 1)."""

import struct
import wave
from pathlib import Path

from conftest import FIXTURES
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.space import Space
from objectapp.textfile import decode

INVENTORY = {
    "Pages/Every block.md",
    "Pages/Hand written.md",
    "Pages/CRLF BOM blocks.md",
    "Pages/No trailing newline blocks.md",
    "Pages/Embedded target.md",
    "People/Ada Lovelace.md",
}

ATTACHMENTS = {
    "pixel.png", "report.pdf", "clip.wav", "clip.mp4", "data.xlsx",
    "page.html", "tool.exe", "notes.svg",
}

# Lines each body must hold verbatim (each one a whole line of the file).
EVERY_BLOCK_LINES = [
    "<!-- block: color=bg-blue align=center -->",
    "## Rollout notes",
    "<!-- block: small -->",
    "<!-- block: icon=ph-star -->",
    "<!-- block: quote=standout -->",
    "> Measure twice, cut once.",
    "<!-- block: list=alphabetical -->",
    "<!-- block: list=roman -->",
    "   1. Nested beta detail",
    "   1. Nested first detail",
    "<!-- toggle -->",
    "### Closed toggle",
    "<!-- toggle open -->",
    "### Server checklist",
    "<!-- /toggle -->",
    "<!-- group color=bg-gray -->",
    "<!-- /group -->",
    "<!-- columns widths=40,60 -->",
    "<!-- column -->",
    "<!-- /columns -->",
    "<!-- columns layout=grid widths=33,33,34 -->",
    "<!-- block: wrap lock -->",
    "```python",
    "<!-- block: preview=split -->",
    "```mermaid",
    "```markdown",
    "$$",
    "The theorem $a^2+b^2=c^2$ holds; the coffee was $5 and $6 for tea.",
    "---",
    "<!-- block: header-column -->",
    "<!-- block: no-header-row -->",
    '<!-- block: width=120 align=center caption="A \\"tiny\\" pixel" -->',
    "![pixel](Attachments/pixel.png)",
    "<!-- block: height=500 -->",
    "![[Attachments/report.pdf]]",
    "![[Attachments/clip.wav]]",
    "![[Attachments/clip.mp4]]",
    "![[Attachments/data.xlsx]]",
    "<!-- block: bookmark -->",
    "[Example docs](https://example.com/docs)",
    "<!-- block: view=wideCard -->",
    "![[Ada Lovelace]]",
    "![[Embedded target]]",
]

HAND_WRITTEN_LINES = [
    "<!--block:color=bg-red-->",
    "<!--   TOGGLE   open-->",
    "<!-- block: color=text-green foo=bar -->",
    "<!-- block: color=bg-purplish -->",
    "<!-- callout -->",
    "<!-- /callout -->",
    "<!-- toggle -->",
    "<!-- /group -->",
    "<!-- block: color=bg-yellow -->",
    "<!-- TODO: tidy -->",
    "<!-- columns widths=50,50 -->",
    "<!-- column -->",
    "<!-- group color=bg-blue -->",
    "<!-- toggle open -->",
    "<!-- /toggle -->",
    "<!-- /columns -->",
]


def _snapshot(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def _text(root: Path, rel: str) -> str:
    return decode((root / rel).read_bytes()).text


def _lines(root: Path, rel: str) -> list[str]:
    return _text(root, rel).replace("\r\n", "\n").split("\n")


def _body_lines(root: Path, rel: str) -> list[str]:
    of = split_object(_text(root, rel))
    return of.body.replace("\r\n", "\n").split("\n")


def test_every_md_has_frontmatter_and_unique_paths(blocks_space_dir: Path):
    root = blocks_space_dir
    rels = {p.relative_to(root).as_posix() for p in root.rglob("*.md")}
    assert rels == INVENTORY
    assert len({r.lower() for r in rels}) == len(rels)
    ids = set()
    for rel in rels:
        of = split_object(_text(root, rel))
        assert of.fm_ok and of.frontmatter_src is not None, rel
        fm = parse_fm(of.frontmatter_src)
        assert fm["title"] == Path(rel).stem, rel
        assert fm["type"] in {"Page", "Person"}, rel
        ids.add(fm["id"])
    assert len(ids) == len(rels)

    space = Space(root)
    for rel in rels:
        assert not space._raw[rel].readOnly, rel


def test_space_opens_without_writing(blocks_space_dir: Path):
    before = _snapshot(blocks_space_dir)
    Space(blocks_space_dir)
    Space(blocks_space_dir)
    assert _snapshot(blocks_space_dir) == before
    assert not (blocks_space_dir / ".object" / "space.json").exists()
    assert not (blocks_space_dir / ".object" / "ui.json").exists()


def test_expected_inventory(blocks_space_dir: Path):
    root = blocks_space_dir
    caps = root / ".object"
    assert {p.name for p in caps.iterdir()} == {"types"}
    assert {p.stem for p in (caps / "types").glob("*.json")} == {"page", "person", "tag"}
    assert not list(root.rglob(".gitattributes"))
    # The committed fixture holds no executable; `blocks_space_dir` adds tool.exe.
    assert not (FIXTURES / "space-blocks" / "Attachments" / "tool.exe").exists()

    every = _body_lines(root, "Pages/Every block.md")
    for line in EVERY_BLOCK_LINES:
        assert line in every, line
    assert every.count("<!-- column -->") == 3
    assert every.count("<!-- /toggle -->") == 2
    # Leaf annotations sit directly above their block (no blank line between).
    for ann, block in [
        ("<!-- block: color=bg-blue align=center -->", "## Rollout notes"),
        ("<!-- block: quote=standout -->", "> Measure twice, cut once."),
        ("<!-- block: wrap lock -->", "```python"),
        ("<!-- block: preview=split -->", "```mermaid"),
        ("<!-- block: view=wideCard -->", "![[Ada Lovelace]]"),
    ]:
        assert every[every.index(ann) + 1] == block, ann
    # The math block keeps a blank line inside it.
    start = every.index("$$")
    end = every.index("$$", start + 1)
    assert "" in every[start + 1:end] and "E = mc^2" in every[start + 1:end]

    hand = _body_lines(root, "Pages/Hand written.md")
    for line in HAND_WRITTEN_LINES:
        assert line in hand, line
    detached = hand.index("<!-- block: color=bg-yellow -->")
    assert hand[detached + 1] == ""
    # Nesting: a toggle inside a group inside the second column.
    col = hand.index("<!-- column -->")
    assert hand[col + 1:col + 3] == ["<!-- group color=bg-blue -->", "<!-- toggle open -->"]

    crlf = (root / "Pages/CRLF BOM blocks.md").read_bytes()
    assert crlf.startswith(b"\xef\xbb\xbf---\r\n")
    assert b"\n" not in crlf.replace(b"\r\n", b"")
    for line in (b"<!-- toggle open -->", b"<!-- columns widths=40,60 -->", b"$$"):
        assert b"\r\n" + line + b"\r\n" in crlf, line

    tail = (root / "Pages/No trailing newline blocks.md").read_bytes()
    assert tail.endswith(b"\n<!-- /toggle -->")
    assert b"\r" not in tail and not tail.startswith(b"\xef\xbb\xbf")

    att = root / "Attachments"
    assert {p.name for p in att.iterdir()} == ATTACHMENTS
    for name in ATTACHMENTS:
        assert (att / name).stat().st_size > 0, name

    png = (att / "pixel.png").read_bytes()
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert struct.unpack(">II", png[16:24]) == (1, 1)
    pdf = (att / "report.pdf").read_bytes()
    assert pdf.startswith(b"%PDF-") and pdf.rstrip().endswith(b"%%EOF")
    with wave.open(str(att / "clip.wav"), "rb") as w:
        assert abs(w.getnframes() / w.getframerate() - 0.1) < 1e-9
        assert set(w.readframes(w.getnframes())) == {0}
    assert b"<script>" in (att / "page.html").read_bytes()
    assert b"<script>" in (att / "notes.svg").read_bytes()
