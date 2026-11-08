import difflib

import pytest

from objectapp.frontmatter import (
    FrontmatterError,
    delete_keys,
    parse_fm,
    remove_items,
    rename_key,
    replace_in_value,
    set_keys,
)


def test_remove_items_flow_list_keeps_quotes_and_comment():
    src = "type: Task\nphase: ['Alpha', \"Beta\", Gamma]  # note\nx: 1\n"
    drop = lambda gone: (lambda v: v == gone)  # noqa: E731
    assert remove_items(src, "phase", drop("Gamma")) == (
        "type: Task\nphase: ['Alpha', \"Beta\"]  # note\nx: 1\n"
    )
    assert remove_items(src, "phase", drop("Alpha")) == (
        "type: Task\nphase: [\"Beta\", Gamma]  # note\nx: 1\n"
    )
    assert remove_items(src, "phase", drop("Beta")) == (
        "type: Task\nphase: ['Alpha', Gamma]  # note\nx: 1\n"
    )


def test_remove_items_block_list_keeps_other_lines():
    src = (
        "members:\n"
        "  - '[[Ada Lovelace]]'   # lead dev\n"
        '  - "[[Alpha]]"\n'
        "  - Plain\n"
        "# trailing comment\n"
        "x: 1\n"
    )
    assert remove_items(src, "members", lambda v: v == "[[Alpha]]") == (
        "members:\n"
        "  - '[[Ada Lovelace]]'   # lead dev\n"
        "  - Plain\n"
        "# trailing comment\n"
        "x: 1\n"
    )


def test_remove_items_falls_back_when_it_cannot_splice():
    assert remove_items("a: [x, y]\n", "a", lambda v: True) is None  # everything goes
    assert remove_items("a: x\n", "a", lambda v: True) is None  # not a list
    assert remove_items("{a: [x, y]}\n", "a", lambda v: v == "x") is None  # flow mapping
    assert remove_items("a: [x, y]\n", "a", lambda v: False) == "a: [x, y]\n"

# Mirrors the shapes found in an exported Markdown file (synthetic values).
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


# -- M2: key removal, rename, null, in-place value edits ---------------------------
# These functions work on the frontmatter source between the `---` fences.

FOLDED = "title: X\nurl: >-\n  https://example.org/a\n  /b\ntags: [A]\n"


def test_delete_key_removes_only_its_lines():
    assert delete_keys(FOLDED, ["url"]) == "title: X\ntags: [A]\n"


def test_delete_key_keeps_trailing_comment_and_blank_lines():
    src = "a: 1\nb: 2\n\n# note\nc: 3\n"
    assert delete_keys(src, ["b"]) == "a: 1\n\n# note\nc: 3\n"


def test_delete_several_keys_and_last_key():
    expected = SRC.replace("type: 'Task'\n", "").replace("date: 2026-10-23\n", "")
    assert delete_keys(SRC, ["date", "type"]) == expected


def test_delete_absent_key_noop():
    assert delete_keys(FOLDED, ["nope"]) == FOLDED
    assert delete_keys(FOLDED, []) == FOLDED


def test_rename_key_keeps_value_bytes():
    out = rename_key(SRC, "url", "link")
    assert _changed(SRC, out) == ["- url: >-", "+ link: >-"]
    out = rename_key(SRC, "type", "kind")
    assert out.startswith("kind: 'Task'\n")


def test_rename_key_absent_noop_and_existing_target_raises():
    assert rename_key(SRC, "nope", "other") == SRC
    with pytest.raises(ValueError):
        rename_key(SRC, "url", "title")


def test_rename_key_explicit_key_form_stays_valid_yaml():
    """Audit 2026-11-01: `? status` / `: Done` used to come back as `? state: Done`."""
    src = "? status\n: Done\ntitle: T\n"
    out = rename_key(src, "status", "state")
    assert out == "? state\n: Done\ntitle: T\n"
    assert parse_fm(out) == {"state": "Done", "title": "T"}
    crlf = "? status\r\n: Done\r\ntitle: T\r\n"
    assert parse_fm(rename_key(crlf, "status", "state")) == {"state": "Done", "title": "T"}
    for quoted, old in [("'a b': 1\nc: 2\n", "a b"), ('"a\\tb": 1\nc: 2\n', "a\tb"), ("'it''s': 1\nc: 2\n", "it's")]:
        assert parse_fm(rename_key(quoted, old, "z")) == {"z": 1, "c": 2}


def test_set_none_renders_null():
    assert set_keys("title: X\n", {"k": None}) == "title: X\nk: null\n"
    assert set_keys("k: 5\ntitle: X\n", {"k": None}) == "k: null\ntitle: X\n"


def _a_to_z(text: str) -> str:
    return text.replace("[[A]]", "[[Z]]")


def test_replace_in_value_flow_list_keeps_other_items():
    src = "title: X\nm: ['[[A]]', \"[[B]]\", C]\nn: 1\n"
    assert replace_in_value(src, "m", _a_to_z) == "title: X\nm: ['[[Z]]', \"[[B]]\", C]\nn: 1\n"


def test_replace_in_value_block_list_and_scalar():
    src = "m:\n  - '[[A]]'\n  - '[[B]]'\no: '[[A]]'\n"
    out = replace_in_value(src, "m", _a_to_z)
    assert out == "m:\n  - '[[Z]]'\n  - '[[B]]'\no: '[[A]]'\n"
    assert replace_in_value(out, "o", _a_to_z) == "m:\n  - '[[Z]]'\n  - '[[B]]'\no: '[[Z]]'\n"


def test_replace_in_value_literal_block():
    src = "b: |-\n  see [[A]]\n  and [[B]]\nc: 1\n"
    assert replace_in_value(src, "b", _a_to_z) == "b: |-\n  see [[Z]]\n  and [[B]]\nc: 1\n"


def test_replace_in_value_escapes_quote_and_quotes_plain():
    src = "o: '[[A]]'\nm: [x, C]\n"
    out = replace_in_value(src, "o", lambda t: t.replace("A", "Ada's"))
    assert out == "o: '[[Ada''s]]'\nm: [x, C]\n"
    assert parse_fm(out)["o"] == "[[Ada's]]"
    out = replace_in_value(src, "m", lambda t: "a, b" if t == "C" else t)
    assert out == "o: '[[A]]'\nm: [x, 'a, b']\n"
    assert parse_fm(out)["m"] == ["x", "a, b"]


def test_replace_in_value_double_quotes_escaped():
    src = 'o: "[[A]]"\n'
    out = replace_in_value(src, "o", lambda t: t.replace("A", 'say "hi"'))
    assert out.startswith('o: "')
    assert parse_fm(out)["o"] == '[[say "hi"]]'


def test_replace_in_value_unchanged_and_absent():
    assert replace_in_value(SRC, "tags", lambda t: t) == SRC
    assert replace_in_value(SRC, "nope", _a_to_z) == SRC


def test_replace_in_value_changes_one_item_only():
    out = replace_in_value(SRC, "tags", lambda t: "ML" if t == "LLM" else t)
    assert _changed(SRC, out) == ["- tags: [AI, LLM]", "+ tags: [AI, ML]"]


# -- audit 2026-11-01: a bad file opens read-only; it never crashes the space -------


def test_deeply_nested_yaml_is_a_frontmatter_error(tmp_path):
    from objectapp.typedefs import read_raw

    deep = "a: " + "[" * 3000 + "]" * 3000 + "\n"
    with pytest.raises(FrontmatterError):
        parse_fm(deep)
    with pytest.raises(FrontmatterError):
        set_keys(deep, {"b": 1})
    (tmp_path / "deep.md").write_text("---\n" + deep + "---\nbody\n", encoding="utf-8")
    raw = read_raw(tmp_path, "deep.md")
    assert raw.readOnly and "YAML" in (raw.readOnlyReason or "")


def test_top_level_merge_key_is_a_frontmatter_error(tmp_path):
    from objectapp.typedefs import read_raw

    merged = "base: &b\n  x: 1\n<<: *b\ntitle: Merge\n"
    with pytest.raises(FrontmatterError, match="merge"):
        parse_fm(merged)
    with pytest.raises(FrontmatterError, match="merge"):  # not KeyError from `lc.key`
        set_keys(merged, {"lastUpdated": "2026-01-01T00:00:00.000Z"})
    with pytest.raises(FrontmatterError):
        rename_key(merged, "title", "name")
    (tmp_path / "merge.md").write_text("---\n" + merged + "---\nbody\n", encoding="utf-8")
    raw = read_raw(tmp_path, "merge.md")
    assert raw.readOnly and "merge" in (raw.readOnlyReason or "")
    # A merge key inside a value is ordinary YAML: the file stays editable.
    nested = "base: &b\n  x: 1\nderived:\n  <<: *b\n  y: 2\ntitle: T\n"
    assert parse_fm(nested)["derived"] == {"x": 1, "y": 2}
    assert set_keys(nested, {"title": "U"}) == nested.replace("title: T", "title: U")


# -- bug audit 2026-11-07, finding 1: any frontmatter parse failure is read-only ----------

_SEQUENCE_KEY = "? [a, b]\n: 1\ntitle: Seq\n"
_HUGE_INT = "title: Huge\nn: " + "1" * 4400 + "\n"


@pytest.mark.parametrize(
    "src", [_SEQUENCE_KEY, _HUGE_INT, "meta:\n  ? [a, b]\n  : 1\n"], ids=["seq-key", "huge-int", "nested-seq-key"]
)
def test_unparseable_scalars_and_keys_are_a_frontmatter_error(src):
    with pytest.raises(FrontmatterError):
        parse_fm(src)


@pytest.mark.parametrize("src", [_SEQUENCE_KEY, _HUGE_INT], ids=["seq-key", "huge-int"])
def test_space_with_unparseable_frontmatter_opens_read_only(tmp_path, src):
    from objectapp.space import Space

    (tmp_path / "Bad.md").write_text("---\n" + src + "---\nbody\n", encoding="utf-8")
    (tmp_path / "Good.md").write_text("---\ntitle: Good\n---\nbody\n", encoding="utf-8")
    before = (tmp_path / "Bad.md").read_bytes()
    space = Space(tmp_path)
    listed = {s.path: s for s in space.list()}
    assert set(listed) == {"Bad.md", "Good.md"}
    assert listed["Bad.md"].readOnly and "YAML" in (listed["Bad.md"].readOnlyReason or "")
    assert not listed["Good.md"].readOnly
    assert (tmp_path / "Bad.md").read_bytes() == before


@pytest.mark.parametrize("src", [_SEQUENCE_KEY, _HUGE_INT], ids=["seq-key", "huge-int"])
def test_trashed_md_without_sidecar_and_unparseable_frontmatter(tmp_path, src):
    from objectapp.ids import new_ulid
    from objectapp.space import Space

    trash = tmp_path / ".object" / "trash"
    trash.mkdir(parents=True)
    tid = new_ulid()  # recent, so opening the space (which purges old entries) keeps it
    (trash / f"{tid}.md").write_text("---\n" + src + "---\nbody\n", encoding="utf-8")
    (tmp_path / "Good.md").write_text("---\ntitle: Good\n---\nbody\n", encoding="utf-8")
    space = Space(tmp_path)
    assert [s.path for s in space.list()] == ["Good.md"]
    meta = space.trash.object_meta(tid)
    assert meta is not None and meta["title"] == tid


# -- bug audit 2026-11-07, finding 19: a `...` document-end line stays last -------------


def test_document_end_line_stays_after_every_key():
    src = "title: T\nstatus: open\n... # end\n"
    stamp = "2026-11-07T00:00:00.000Z"
    assert set_keys(src, {"lastUpdated": stamp}, insert_first={"id": "01ABC"}) == (
        f"id: 01ABC\ntitle: T\nstatus: open\nlastUpdated: {stamp}\n... # end\n"
    )
    assert set_keys(src, {"status": "done"}) == "title: T\nstatus: done\n... # end\n"
    assert set_keys(src, {"status": ["a", "b"]}) == (
        "title: T\nstatus:\n  - a\n  - b\n... # end\n"
    )
    assert delete_keys(src, ["status"]) == "title: T\n... # end\n"
    assert rename_key(src, "status", "state") == "title: T\nstate: open\n... # end\n"


def test_property_edit_of_a_file_with_document_end_line(tmp_path):
    from objectapp.space import Space, version_of

    path = tmp_path / "Doc end.md"
    path.write_bytes(b"---\ntitle: Doc end\nstatus: open\n...\n---\nbody\n")
    space = Space(tmp_path)
    space.update_properties("Doc end.md", {"note": "first"}, version_of(path.read_bytes()))
    text = path.read_text(encoding="utf-8")
    fm = text.split("---\n")[1]
    assert fm.endswith("...\n") and "note: first\n" in fm and "lastUpdated: " in fm
    summary = space.get("Doc end.md")
    assert not summary.readOnly
    space.update_properties("Doc end.md", {"note": "second"}, version_of(path.read_bytes()))
    assert "note: second\n" in path.read_text(encoding="utf-8")
