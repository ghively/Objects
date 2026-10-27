"""The text the search index stores (M5 Task 3)."""

from pathlib import Path

from objectapp.searchtext import plain_body, property_text
from objectapp.space import Space


def test_plain_body_strips_markdown_keeps_text():
    body = (
        "# Heading One\n"
        "\n"
        "- [ ] a **bold** task\n"
        "* item with _emphasis_ and ~~gone~~\n"
        "1. numbered [[Ada Lovelace|Ada]] link\n"
        "> quoted [label](https://example.invalid/page)\n"
        "\n"
        "| Col A | Col B |\n"
        "| --- | --- |\n"
        "| cell1 | cell2 |\n"
        "\n"
        "```python\n"
        "print('code text')\n"
        "```\n"
        "inline `snippet` here <span>html</span>\n"
    )
    text = plain_body(body)
    lines = text.split("\n")
    assert "Heading One" in lines
    assert "a bold task" in lines
    assert "item with emphasis and gone" in lines
    assert "numbered Ada Lovelace Ada link" in lines
    assert "quoted label https://example.invalid/page" in lines
    assert "Col A Col B" in lines
    assert "cell1 cell2" in lines
    assert "print('code text')" in lines
    assert "inline snippet here html" in lines
    for gone in ("#", "<span>", "**", "[[", "]]", "```", "|", "---", "- [ ]", ">"):
        assert gone not in text, gone


def test_plain_body_crlf_and_undecodable():
    assert plain_body("one\r\ntwo\r\n") == "one\ntwo"
    bad = b"ok \xff here".decode("utf-8", errors="surrogateescape")
    out = plain_body(bad)
    out.encode("utf-8")  # storable
    assert out == "ok � here"


def test_property_text_skips_not_searchable_and_dates(links_space_dir: Path):
    space = Space(links_space_dir)

    def props(rel: str) -> str:
        raw = space._raw[rel]
        t = space.type_by_id(space._summaries[rel].type)

        def title(target: str) -> str:
            hit = space.resolve(target, rel)
            return space._summaries[hit].title if hit else target

        return property_text(t, raw.fm, title)

    ada = props("People/Ada Lovelace.md")
    assert "Bio: Wrote the first published program for a machine." in ada.split("\n")
    assert "secretword" not in ada  # notes is isNotSearchable
    assert "2026" not in ada  # createdAt is a system date
    assert "Mathematics" not in ada  # tags have their own column

    charles = props("People/Charles Babbage.md").split("\n")
    assert any(line.startswith("Manager: Ada Lovelace") for line in charles)
    assert any("difference" in line for line in charles)

    project = props("Projects/Difference Engine.md").split("\n")
    members = [line for line in project if line.lower().startswith("members")]
    assert members and "Ada Lovelace" in members[0] and "Charles Babbage" in members[0]
    assert any("Successor of" in line for line in project)

    task = props("Tasks/Write paper.md")
    assert "Done" in task  # status is a label: its option text
    for raw_key in ("date", "deadline", "completed"):
        assert f"{raw_key}:" not in task.lower()
    assert property_text(None, {}, lambda t: t) == ""


def test_search_text_skips_annotations_and_math_fences():
    body = (
        "<!--block:color=bg-red-->\r\n"
        "Red paragraph.\r\n"
        "<!-- columns widths=40,60 -->\r\n"
        "Left.\r\n"
        "<!-- column -->\r\n"
        "Right.\r\n"
        "<!-- /columns -->\r\n"
        "<!-- block: caption=\"x > y\" -->\r\n"
        "  $$\r\n"
        "a^2 + b^2 = c^2\r\n"
        "$$  \r\n"
    )
    assert plain_body(body) == "Red paragraph.\nLeft.\nRight.\na^2 + b^2 = c^2"
