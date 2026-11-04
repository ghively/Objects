"""The M8 fixture: `space-m8`, every M8 syntax and file the later tasks need (M8 Task 2)."""

import json
import struct
import wave
from pathlib import Path

from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.space import Space
from objectapp.textfile import decode

INVENTORY = {
    "Tasks/Water plants.md",
    "Tasks/Weekly review.md",
    "Tasks/Pay rent.md",
    "Tasks/Board meeting.md",
    "Tasks/Anniversary.md",
    "Tasks/Stretch.md",
    "Tasks/Submit report.md",
    "Tasks/Broken log.md",
    "Pages/Blocks M8.md",
    "Pages/Source note.md",
    "Pages/CRLF M8.md",
    "Pages/Malformed M8.md",
    "Pages/Merge source.md",
    "Pages/Merge target.md",
    "Pages/Refers to source.md",
    "Pages/Day links.md",
    "Pages/Timed meeting.md",
    "Tags/Old tag.md",
    "Tags/New tag.md",
    "People/Ada Lovelace.md",
    "DailyNotes/2026-10-27.md",
    "Whiteboards/Media board.md",
}

TYPE_OF_FOLDER = {
    "Tasks": "Task",
    "Pages": "Page",
    "Tags": "Tag",
    "People": "Person",
    "DailyNotes": "DailyNote",
    "Whiteboards": "Whiteboard",
}

# Frontmatter lines each file must hold verbatim (whole lines).
FM_LINES = {
    "Tasks/Water plants.md": [
        "repeat: every day",
        "date: 2026-10-24",
        "occurrenceLog: |-",
        "  2026-10-21 completed 2026-10-21T07:55:10Z",
        "  2026-10-22 skipped 2026-10-23T06:30:00Z",
        "  2026-10-23 completed 2026-10-23T08:10:00Z",
    ],
    "Tasks/Weekly review.md": ["repeat: every week on mon, fri"],
    "Tasks/Pay rent.md": ["repeat: every month on the last day"],
    "Tasks/Board meeting.md": ["repeat: every month on the 2nd tuesday"],
    "Tasks/Anniversary.md": ["repeat: every year on march 15"],
    "Tasks/Stretch.md": ["repeat: every day after completion"],
    "Tasks/Submit report.md": ["deadline: 2026-10-29", "reminders:", "  deadline: 1 day before at 09:00"],
    "Tasks/Broken log.md": ["occurrenceLog: |-", "  not a log line at all"],
    "Pages/Refers to source.md": ['related: ["[[Merge source]]"]'],
    "Pages/Timed meeting.md": ["when: 2026-10-27T13:30:00Z"],
    "People/Ada Lovelace.md": ["tags: [Old tag]"],
}

# Body lines each file must hold verbatim (whole lines).
BODY_LINES = {
    "Pages/Blocks M8.md": [
        (
            'Inline <span data-color="text-red">red text</span> and '
            '<mark data-color="bg-yellow">a yellow highlight</mark>.'
        ),
        "A bare <mark>marked phrase</mark> reads as yellow.",
        "A paragraph with a block id. ^ab12cd",
        "<!-- indent -->",
        "<!-- /indent -->",
        "- Blue item <!-- item: color=text-blue -->",
        "| Total | =SUM(B2:B3) |",
        "| Ratio | =A1/0 |",
        "```python",
        "```js",
        'Due <time datetime="2026-10-27">2026-10-27</time>.',
        "![[collection:reading-list]]",
        "![[query:open-tasks]]",
        "![[Source note#^ab12cd]]",
    ],
    "Pages/Source note.md": [
        "The referenced block lives here. ^ab12cd",
        "- A list item with its own id ^zz9zz9",
    ],
    "Pages/Malformed M8.md": [
        'An unclosed <span data-color="text-red">span runs on.',
        'A mark with <mark data-color="bg-nope">an unknown colour</mark>.',
        "An id that is too long. ^TOOLONG1",
        "![[collection:]]",
        "<!-- /indent -->",
    ],
    "Pages/Refers to source.md": ["See [[Merge source]] for details."],
    "Pages/Day links.md": ["Planned for [[2026-10-27]]."],
}


def _snapshot(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def _text(root: Path, rel: str) -> str:
    return decode((root / rel).read_bytes()).text


def _split(root: Path, rel: str):
    return split_object(_text(root, rel))


def _fm_lines(root: Path, rel: str) -> list[str]:
    return (_split(root, rel).frontmatter_src or "").replace("\r\n", "\n").split("\n")


def _body_lines(root: Path, rel: str) -> list[str]:
    return _split(root, rel).body.replace("\r\n", "\n").split("\n")


def test_every_md_has_frontmatter(m8_space_dir: Path):
    root = m8_space_dir
    rels = {p.relative_to(root).as_posix() for p in root.rglob("*.md")}
    assert rels == INVENTORY
    ids = set()
    for rel in rels:
        of = _split(root, rel)
        assert of.fm_ok and of.frontmatter_src is not None, rel
        fm = parse_fm(of.frontmatter_src)
        assert fm["title"] == Path(rel).stem, rel
        assert fm["type"] == TYPE_OF_FOLDER[rel.split("/")[0]], rel
        ids.add(fm["id"])
    assert len(ids) == len(rels)

    space = Space(root)
    for rel in rels:
        assert not space._raw[rel].readOnly, rel


def test_m8_space_opens_without_writing(m8_space_dir: Path):
    before = _snapshot(m8_space_dir)
    Space(m8_space_dir)
    Space(m8_space_dir)
    assert _snapshot(m8_space_dir) == before
    assert not (m8_space_dir / ".object" / "space.json").exists()
    assert not (m8_space_dir / ".object" / "ui.json").exists()


def test_expected_inventory(m8_space_dir: Path):
    root = m8_space_dir
    caps = root / ".object"
    assert {p.name for p in caps.iterdir()} == {"types", "collections", "queries"}
    assert {p.stem for p in (caps / "types").glob("*.json")} == {
        "page", "task", "person", "tag", "dailynote", "whiteboard",
    }
    assert [p.name for p in (caps / "collections").iterdir()] == ["reading-list.json"]
    assert [p.name for p in (caps / "queries").iterdir()] == ["open-tasks.json"]

    task = json.loads((caps / "types" / "task.json").read_text(encoding="utf-8"))
    props = {p["key"]: p for p in task["propertyDefinitions"]}
    status = props["status"]["options"]["set"]
    assert any(o.get("statusCategory") == "done" for o in status)
    assert props["date"]["options"]["constraints"]["supportsReminders"] is True
    assert props["deadline"]["options"]["constraints"]["supportsReminders"] is True

    for rel, lines in FM_LINES.items():
        fm = _fm_lines(root, rel)
        for line in lines:
            assert line in fm, (rel, line)
    for rel, lines in BODY_LINES.items():
        body = _body_lines(root, rel)
        for line in lines:
            assert line in body, (rel, line)

    # The frontmatter values parse as the later tasks expect.
    water = parse_fm(_split(root, "Tasks/Water plants.md").frontmatter_src)
    assert water["occurrenceLog"].split("\n") == [
        "2026-10-21 completed 2026-10-21T07:55:10Z",
        "2026-10-22 skipped 2026-10-23T06:30:00Z",
        "2026-10-23 completed 2026-10-23T08:10:00Z",
    ]
    report = parse_fm(_split(root, "Tasks/Submit report.md").frontmatter_src)
    assert report["reminders"] == {"deadline": "1 day before at 09:00"}
    broken = parse_fm(_split(root, "Tasks/Broken log.md").frontmatter_src)
    assert len(broken["occurrenceLog"].split("\n")) == 3

    # Merge source and target overlap in single and list properties; both have bodies.
    src = parse_fm(_split(root, "Pages/Merge source.md").frontmatter_src)
    dst = parse_fm(_split(root, "Pages/Merge target.md").frontmatter_src)
    for key in ("description", "tags", "aliases", "related"):
        assert src[key] and dst[key] and src[key] != dst[key], key
    assert "when" in src and "when" not in dst
    assert _split(root, "Pages/Merge source.md").body.strip()
    assert _split(root, "Pages/Merge target.md").body.strip()

    # The indent container in Blocks M8 opens and closes.
    blocks = _body_lines(root, "Pages/Blocks M8.md")
    assert blocks.index("<!-- indent -->") < blocks.index("<!-- /indent -->")

    # CRLF M8: CRLF throughout with a BOM, holding a span, a block id and an indent container.
    crlf = (root / "Pages/CRLF M8.md").read_bytes()
    assert crlf.startswith(b"\xef\xbb\xbf---\r\n")
    assert b"\n" not in crlf.replace(b"\r\n", b"")
    for needle in (b'<span data-color="text-green">', b" ^cr1f00\r\n", b"\r\n<!-- indent -->\r\n",
                   b"\r\n<!-- /indent -->\r\n"):
        assert needle in crlf, needle
    for rel in INVENTORY - {"Pages/CRLF M8.md"}:
        raw = (root / rel).read_bytes()
        assert b"\r" not in raw and not raw.startswith(b"\xef\xbb\xbf"), rel

    # The media board: two media blocks, a web link, a locked node, three ordered frames.
    board = json.loads((root / "Whiteboards/Media board.whiteboard.json").read_text(encoding="utf-8"))
    blocks_by_type: dict[str, list[dict]] = {}
    for b in board["blocks"].values():
        blocks_by_type.setdefault(b["type"], []).append(b)
    assert sorted(b["path"] for b in blocks_by_type["media"]) == [
        "Attachments/pixel.png", "Attachments/report.pdf",
    ]
    assert [b["url"] for b in blocks_by_type["weblink"]] == ["https://example.com/guide"]
    assert any(b.get("x-future") == 1 for b in board["blocks"].values())
    assert any(n.get("locked") is True for n in board["nodes"].values())
    frames = [nid for nid, n in board["nodes"].items() if n["kind"] == "frame"]
    assert len(frames) == 3 and board["readingOrder"] == frames
    for n in board["nodes"].values():
        if "blockId" in n:
            assert n["blockId"] in board["blocks"]
    ink = (root / "Whiteboards/Media board.ink.svg").read_text(encoding="utf-8")
    assert ink.count("<path ") == 2

    att = root / "Attachments"
    assert {p.name for p in att.iterdir()} == {"pixel.png", "report.pdf", "clip.wav"}
    png = (att / "pixel.png").read_bytes()
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert struct.unpack(">II", png[16:24]) == (1, 1)
    pdf = (att / "report.pdf").read_bytes()
    assert pdf.startswith(b"%PDF-") and pdf.rstrip().endswith(b"%%EOF")
    with wave.open(str(att / "clip.wav"), "rb") as w:
        assert w.getnframes() > 0
