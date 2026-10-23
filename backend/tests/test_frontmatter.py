import difflib

import pytest

from objectapp.frontmatter import FrontmatterError, parse_fm, set_keys

# Mirrors the shapes found in a Object Markdown export (synthetic values).
SRC = (
    "type: 'Task'\n"
    "title: Write the docs\n"
    "createdAt: 2026-03-26T09:15:00.000Z\n"
    "lastUpdated: 2026-03-27T10:00:00.000Z\n"
    "tags: [AI, LLM]\n"
    "description: null\n"
    "url: >-\n"
    "  https://example.com/a/very/long/path/that/the/export/folded?with=query&and=more\n"
    "timeFrame: 2026-03-26T00:00:00.000Z -> 2026-03-26T00:00:00.000Z\n"
    "status: Not Started\n"
    "reviewed: false\n"
    "date: 2026-10-23\n"
)

NEW_TS = "2026-10-23T16:41:00.123Z"


def _changed(before: str, after: str) -> list[str]:
    return [
        line
        for line in difflib.ndiff(before.splitlines(), after.splitlines())
        if line[:2] in ("- ", "+ ")
    ]


def test_set_one_key_changes_one_line():
    out = set_keys(SRC, {"lastUpdated": NEW_TS})
    assert _changed(SRC, out) == [
        "- lastUpdated: 2026-03-27T10:00:00.000Z",
        f"+ lastUpdated: {NEW_TS}",
    ]
    assert out.count("\n") == SRC.count("\n")


def test_append_missing_key_last():
    src = SRC.replace("lastUpdated: 2026-03-27T10:00:00.000Z\n", "")
    out = set_keys(src, {"lastUpdated": NEW_TS})
    assert out == src + f"lastUpdated: {NEW_TS}\n"


def test_append_when_src_lacks_trailing_newline():
    assert set_keys("title: A", {"x": 1}) == "title: A\nx: 1\n"


def test_insert_id_first():
    out = set_keys(SRC, {"lastUpdated": NEW_TS}, insert_first={"id": "01JABCDEFGHJKMNPQRSTVWXYZ0"})
    lines = out.splitlines()
    assert lines[0] == "id: 01JABCDEFGHJKMNPQRSTVWXYZ0"
    assert _changed(SRC, out) == [
        "+ id: 01JABCDEFGHJKMNPQRSTVWXYZ0",
        "- lastUpdated: 2026-03-27T10:00:00.000Z",
        f"+ lastUpdated: {NEW_TS}",
    ]


def test_insert_first_into_empty_src():
    assert set_keys("", {"lastUpdated": NEW_TS}, insert_first={"id": "X1"}) == (
        f"id: X1\nlastUpdated: {NEW_TS}\n"
    )


def test_preserves_quotes_nulls_folded_flow():
    out = set_keys(SRC, {"status": "Done"})
    before, after = SRC.splitlines(), out.splitlines()
    assert len(before) == len(after)
    for b, a in zip(before, after):
        if b.startswith("status:"):
            assert a == "status: Done"
        else:
            assert a == b
    # Quotes, null, folded scalar and flow list all survive verbatim.
    assert "type: 'Task'\n" in out
    assert "description: null\n" in out
    assert "url: >-\n  https://example.com/" in out
    assert "tags: [AI, LLM]\n" in out


def test_replace_multiline_value():
    out = set_keys(SRC, {"url": "https://example.com/short"})
    assert "url: https://example.com/short\n" in out
    assert "  https://example.com/a/very" not in out
    assert out.replace("url: https://example.com/short\n", "") == SRC.replace(
        "url: >-\n  https://example.com/a/very/long/path/that/the/export/folded?with=query&and=more\n",
        "",
    )


def test_keeps_original_quote_and_flow_style():
    out = set_keys(SRC, {"type": "Person", "tags": ["AI", "Ops"]})
    assert "type: 'Person'\n" in out
    assert "tags: [AI, Ops]\n" in out


def test_trailing_comment_lines_untouched():
    src = "a: 1\nb: 2\n# trailing comment\n"
    assert set_keys(src, {"b": 3}) == "a: 1\nb: 3\n# trailing comment\n"


def test_noop_updates_return_src_identical():
    assert set_keys(SRC, {}) == SRC


def test_string_that_needs_quoting_is_quoted():
    out = set_keys("a: 1\n", {"title": "Note: with colon"})
    assert parse_fm(out)["title"] == "Note: with colon"


def test_parse_fm_plain_values():
    fm = parse_fm(SRC)
    assert fm == {
        "type": "Task",
        "title": "Write the docs",
        "createdAt": "2026-03-26T09:15:00.000Z",
        "lastUpdated": "2026-03-27T10:00:00.000Z",
        "tags": ["AI", "LLM"],
        "description": None,
        "url": "https://example.com/a/very/long/path/that/the/export/folded?with=query&and=more",
        "timeFrame": "2026-03-26T00:00:00.000Z -> 2026-03-26T00:00:00.000Z",
        "status": "Not Started",
        "reviewed": False,
        "date": "2026-10-23",
    }
    assert type(fm["type"]) is str
    assert type(fm["tags"]) is list and type(fm) is dict


def test_parse_fm_empty():
    assert parse_fm("") == {}
    assert parse_fm("# only a comment\n") == {}


@pytest.mark.parametrize("bad", ["a: [unclosed\n", "- just\n- a list\n", "key: : :\n  bad: indent\n x"])
def test_parse_fm_invalid_raises(bad):
    with pytest.raises(FrontmatterError):
        parse_fm(bad)


def test_set_keys_invalid_raises():
    with pytest.raises(FrontmatterError):
        set_keys("a: [unclosed\n", {"b": 1})


def test_duplicate_keys_are_invalid():
    with pytest.raises(FrontmatterError):
        parse_fm("a: 1\na: 2\n")
    with pytest.raises(FrontmatterError):
        set_keys("a: 1\na: 2\n", {"b": 1})
