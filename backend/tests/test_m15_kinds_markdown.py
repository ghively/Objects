"""M15 Lane B: kind guessing, value conversion and the Markdown rewriting rules."""

from __future__ import annotations

import pytest
from objectapp.importers import markdown
from objectapp.importers.kinds import (
    column_decimal_comma,
    convert,
    guess_cells,
    guess_yaml,
    parse_date,
    parse_number,
    relation_items,
)
from objectapp.importers.readmodel import SourceIndex, notion_id, strip_notion_id

# -- kinds ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("cells", "expected"),
    [
        (["Yes", "No", "", "yes"], ("boolean", False)),
        (["1", "2.5", "$3", "40%"], ("number", False)),
        (["1,5", "2,25"], ("number", False)),
        (["November 5, 2026", "2026-01-02", "May 1, 2026 3:00 PM"], ("datetime", False)),
        (["November 5, 2026 → November 7, 2026"], ("datetime", False)),
        (["https://a.example", "http://b.example/x"], ("url", False)),
        (["Dune (Books%20abc/Dune%200123.md)", "A (a.md), B (b.md)"], ("entity", True)),
        (["Sci-fi, Classic", "Classic", "Drama, Sci-fi"], ("label", True)),
        (["Done", "Doing", "Done"], ("label", False)),
        (["one", "two", "three"], ("text", False)),
        (["", "  "], ("text", False)),
    ],
)
def test_guess_cells(cells, expected):
    assert guess_cells(cells) == expected


def test_guess_yaml_uses_the_space_rules():
    assert guess_yaml("rating", [4, 5]) == ("number", False)
    assert guess_yaml("author", ["[[A]]", "[[B]]"]) == ("entity", False)
    assert guess_yaml("tags", [["a", "b"], ["c"]]) == ("label", True)
    assert guess_yaml("status", ["reading", "done"]) == ("label", False)
    assert guess_yaml("when", ["2026-01-02"]) == ("datetime", False)


def test_numbers_and_dates():
    assert column_decimal_comma(["1,5", "2"]) is True
    assert column_decimal_comma(["1.5", "1,234.5"]) is False
    assert parse_number("1.234,5", True) == 1234.5
    assert parse_number("1,234", False) == 1234
    assert parse_number("25%") == 0.25
    assert parse_number("€12") == 12
    assert parse_number("abc") is None
    assert parse_date("November 5, 2026") == {"start": "2026-11-05", "resolution": "day"}
    assert parse_date("2026-02-30") is None
    assert parse_date("2026-11-05 → 2026-11-07") == {"start": "2026-11-05", "end": "2026-11-07", "resolution": "day"}
    assert parse_date("2026-11-05T10:00:00Z")["start"] == "2026-11-05T10:00:00.000Z"


def test_relation_items():
    assert relation_items("Dune (Books%20a/Dune%20b.md), Emma (Emma.md)") == [
        ("Dune", "Books%20a/Dune%20b.md"),
        ("Emma", "Emma.md"),
    ]
    assert relation_items("just text") is None


def test_convert():
    assert convert("5", "number", False, cells=True) == (5, [])
    assert convert("five", "number", False, cells=True) == (None, ["five"])
    assert convert("Yes", "boolean", False, cells=True) == (True, [])
    assert convert("a, b", "label", True, cells=True) == (["a", "b"], [])
    assert convert("a, b", "label", True, cells=False) == (["a, b"], [])
    assert convert(["a", "b"], "label", False, cells=False) == (["a"], ["b"])
    assert convert("x" * 101, "label", False, cells=True) == (None, ["x" * 101])
    assert convert(["x", "y"], "text", False, cells=False) == ("x, y", [])
    assert convert("", "number", False, cells=True) == (None, [])
    assert convert({"a": 1}, "text", False, cells=False)[0] is None


def test_notion_ids():
    assert notion_id("Page 0123456789abcdef0123456789abcdef") == "0123456789abcdef0123456789abcdef"
    assert notion_id("Page 01234567-89ab-cdef-0123-456789abcdef") == "0123456789abcdef0123456789abcdef"
    assert strip_notion_id("Page 0123456789abcdef0123456789abcdef") == "Page"
    assert strip_notion_id("Plain") == "Plain"


# -- markdown ------------------------------------------------------------------------


def _hooks(pages, files, csvs=()):
    index = SourceIndex(list(pages), list(files), list(csvs))
    return markdown.Hooks(
        index.resolve_href,
        index.resolve_wiki,
        lambda target, _from: ({"Books/Dune.md": "Dune", "Home.md": "Home", "Movies/Dune.md": "Movies/Dune"}[target],
                               "Dune" if "Dune" in target else "Home"),
        lambda target: f"Attachments/{target.rsplit('/', 1)[-1]}",
    )


def test_wikilinks_and_embeds():
    hooks = _hooks(["Books/Dune.md", "Home.md", "Movies/Dune.md"], ["img/cover image.png", "docs/manual.pdf"])
    body = (
        "[[Dune]] [[Books/Dune|the book]] [[Dune#Plot]] [[Nowhere]]\n"
        "![[cover image.png|300]]\n"
        "Inline ![[cover image.png|300]] here\n"
        "![[manual.pdf]]\n"
        "`[[Dune]]` stays\n"
    )
    out = markdown.convert(body, "Home.md", hooks)
    assert out.text == (
        "[[Dune]] [[Dune|the book]] [[Dune#Plot]] [[Nowhere]]\n"
        "<!-- block: width=300 -->\n![](Attachments/cover%20image.png)\n"
        "Inline ![](Attachments/cover%20image.png) here\n"
        "![[Attachments/manual.pdf]]\n"
        "`[[Dune]]` stays\n"
    )
    kinds = [(link.kind, link.target) for link in out.links]
    assert ("unresolved", None) in kinds
    assert kinds.count(("object", "Books/Dune.md")) == 3


def test_markdown_links_notion_style():
    hooks = _hooks(["Books/Dune.md", "Home.md"], ["Home/pic.png", "Home/doc.pdf"], ["Books.csv"])
    body = (
        "[Dune](Books/Dune.md) [the novel](Books/Dune.md) [db](Books.csv) [gone](Gone.md)\n"
        "![alt](Home/pic.png)\n"
        "[doc](Home/doc.pdf)\n"
        "see [doc](Home/doc.pdf) inline and [missing](Home/missing.pdf)\n"
        "[web](https://example.com/x.md)\n"
    )
    out = markdown.convert(body, "Home.md", hooks)
    assert out.text == (
        "[[Dune]] [[Dune|the novel]] db gone\n"
        "![alt](Attachments/pic.png)\n"
        "![[Attachments/doc.pdf]]\n"
        "see [doc](Attachments/doc.pdf) inline and missing\n"
        "[web](https://example.com/x.md)\n"
    )


def test_callouts():
    aside = "<aside>\n💡 Water the plants.\n\nTwice.\n</aside>\n"
    out = markdown.convert(aside, "p.md", _hooks([], []), notion_callouts=True).text
    assert out == "<!-- block: quote=standout -->\n> 💡 Water the plants.\n>\n> Twice.\n"
    callout = "> [!warning]- Careful\n> Hot.\n\n> [!tip]\n> Plain.\n"
    out = markdown.convert(callout, "p.md", _hooks([], [])).text
    assert out == (
        "<!-- block: quote=standout -->\n> **Careful**\n> Hot.\n\n"
        "<!-- block: quote=standout -->\n> **Tip**\n> Plain.\n"
    )
    fenced = "```\n> [!note] not a callout\n```\n"
    assert markdown.convert(fenced, "p.md", _hooks([], [])).text == fenced


def test_inline_tags():
    body = "A #tag and #nested/tag, not #123, `#code` or a url.com/#frag\n# Heading\n```\n#fenced\n```\n"
    assert markdown.inline_tags(body) == ["tag", "nested/tag"]
