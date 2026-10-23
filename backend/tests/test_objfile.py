import re

import pytest

from objectapp.ids import new_ulid
from objectapp.objfile import ObjectFile, join_object, split_object

NORMAL = "---\nid: 01ABC\ntype: 'Task'\ntitle: Write docs\n---\n\n# Write docs\n\nSome text.\n"
NO_FM = "# Just a page\n\nNo frontmatter here.\n"
EMPTY_BODY = "---\ntitle: Empty\n---\n"
CODE_FENCE = (
    "---\ntitle: Code\n---\nIntro\n\n```yaml\n---\nkey: value\n---\n```\n\nOutro\n"
)
FM_ONLY = "---\ntitle: Only\ntags: [a, b]\n---"
EMPTY_FM = "---\n---\nbody\n"
EMPTY_TEXT = ""


@pytest.mark.parametrize(
    "text", [NORMAL, NO_FM, EMPTY_BODY, CODE_FENCE, FM_ONLY, EMPTY_FM, EMPTY_TEXT]
)
def test_split_join_identity(text):
    assert join_object(split_object(text)) == text


def test_split_normal_parts():
    of = split_object(NORMAL)
    assert of.fm_ok is True and of.fm_error is None
    assert of.frontmatter_src == "id: 01ABC\ntype: 'Task'\ntitle: Write docs\n"
    assert of.body == "\n# Write docs\n\nSome text.\n"


def test_split_no_frontmatter():
    of = split_object(NO_FM)
    assert of.frontmatter_src is None
    assert of.body == NO_FM
    assert of.fm_ok is True


def test_split_code_fence_in_body_uses_first_closing_fence():
    of = split_object(CODE_FENCE)
    assert of.frontmatter_src == "title: Code\n"
    assert of.body.startswith("Intro\n")
    assert "```yaml\n---\nkey: value\n---\n```" in of.body


def test_frontmatter_only_file():
    of = split_object(FM_ONLY)
    assert of.fm_ok is True
    assert of.frontmatter_src == "title: Only\ntags: [a, b]\n"
    assert of.body == ""


def test_new_body_on_frontmatter_only_file_starts_on_own_line():
    of = split_object(FM_ONLY)
    new = ObjectFile(of.frontmatter_src, "Hello\n", of.fm_ok, of.fm_error)
    assert join_object(new) == "---\ntitle: Only\ntags: [a, b]\n---\nHello\n"


def test_replace_body_keeps_frontmatter_bytes():
    of = split_object(NORMAL)
    new = ObjectFile(of.frontmatter_src, "changed\n", of.fm_ok, of.fm_error)
    assert join_object(new) == "---\nid: 01ABC\ntype: 'Task'\ntitle: Write docs\n---\nchanged\n"


@pytest.mark.parametrize(
    "text",
    [
        "---\ntitle: Broken\n\n# Never closed\n",
        "---\ntitle: Broken",
        "---\n",
        "---\ntitle: x\n----\nbody\n",
        "---\ntitle: x\n --- \nbody\n",
    ],
)
def test_unterminated_frontmatter(text):
    of = split_object(text)
    assert of.fm_ok is False
    assert of.fm_error
    assert of.frontmatter_src is None
    assert of.body == text
    assert join_object(of) == text


@pytest.mark.parametrize("text", ["----\nx\n---\n", "\n---\nx\n---\n"])
def test_not_frontmatter_unless_starts_with_fence_line(text):
    of = split_object(text)
    assert of.frontmatter_src is None
    assert of.fm_ok is True
    assert of.body == text


@pytest.mark.parametrize("text", ["--- \ntype: Page\n---\nbody\n", "---\t\ntitle: x\n---\n"])
def test_fence_with_trailing_whitespace_is_read_only(text):
    of = split_object(text)
    assert of.fm_ok is False
    assert of.fm_error == "Frontmatter fence has trailing whitespace"
    assert of.frontmatter_src is None
    assert join_object(of) == text


CROCKFORD = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def test_ulid_shape():
    ids = {new_ulid() for _ in range(200)}
    assert len(ids) == 200
    for u in ids:
        assert len(u) == 26
        assert CROCKFORD.match(u), u


def test_ulid_time_prefix_sorts():
    import time

    a = new_ulid()
    time.sleep(0.002)
    b = new_ulid()
    assert a[:10] <= b[:10]
    assert a[0] in "01234567"
