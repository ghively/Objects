"""Audit 2026-11-01 (minor): `plain_body` skips the regexes a line can't match.

The fast paths must give exactly what running every regex on every line gave
(`_reference_plain_body`, the implementation before them).
"""

from __future__ import annotations

import random
import re
from pathlib import Path

from objectapp import rows as _rows
from objectapp import searchtext
from objectapp.searchtext import plain_body

FIXTURES = Path(__file__).parent / "fixtures"


def _reference_plain_body(body: str) -> str:
    """`plain_body` as it was before the fast paths (every regex on every line)."""
    st = searchtext

    def inline(line: str) -> str:
        line = re.compile(r"(`+)(.+?)\1").sub(lambda m: m.group(2).strip(), line)
        line = _rows._TAG_RE.sub("", line)
        line = re.compile(r"!\[([^\]]*)\]\(([^)\s]*)[^)]*\)").sub(st._link, line)
        line = _rows._WIKI_RE.sub(st._wiki, line)
        line = re.compile(r"\[([^\]]+)\]\(([^)\s]*)[^)]*\)").sub(st._link, line)
        line = _rows._STRONG_RE.sub(r"\2", line)
        line = _rows._EM_STAR_RE.sub(r"\1", line)
        line = _rows._EM_UNDER_RE.sub(r"\1", line)
        line = _rows._STRIKE_RE.sub(r"\1", line)
        return line

    rule = re.compile(r"^\s*(?:[-*_]\s*){3,}$")
    table_sep = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$")
    space = re.compile(r"[ \t]+")
    out: list[str] = []
    fenced = False
    for line in body.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if _rows._FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced:
            if line.strip():
                out.append(line.strip())
            continue
        if rule.match(line) or table_sep.match(line) and "|" in line:
            continue
        if _rows._COMMENT_LINE_RE.match(line) or _rows._MATH_FENCE_RE.match(line):
            continue
        line = _rows._BLOCK_ID_RE.sub("", line)
        stripped = line.strip()
        if stripped.startswith("|"):
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            line = " ".join(c for c in cells if c)
        else:
            line = _rows._HEADING_RE.sub("", line)
            line = _rows._QUOTE_RE.sub("", line)
            line = _rows._LIST_RE.sub("", line)
            line = _rows._TASK_RE.sub("", line)
        line = space.sub(" ", inline(line)).strip()
        if line:
            out.append(line)
    return st.display_safe("\n".join(out))


_PIECES = [
    "word", "Ab", " ", "  ", "\t", " ", "　", "#", "## ", "> ", ">", "- ", "* ", "+ ",
    "1. ", "2) ", "[ ] ", "[x] ", "[", "]", "(", ")", "![", "[[", "]]", "|", "](", "`", "``",
    "```", "~~~", "~~", "**", "__", "*", "_", "<", "<b>", "<!--", "-->", "$$", " ^abc123",
    "---", "-", ":", "\r", "\r\n", "\n", "é", "\udcff", "x_y", "a*b", "٣", "\x0b", "\x1c",
]


def _random_body(rng: random.Random) -> str:
    return "".join(rng.choice(_PIECES) for _ in range(rng.randint(0, 40)))


def test_plain_body_matches_the_reference_on_random_markdown():
    rng = random.Random(20261101)
    for _ in range(30000):
        body = _random_body(rng)
        assert plain_body(body) == _reference_plain_body(body), repr(body)


def test_plain_body_matches_the_reference_on_every_fixture():
    for p in sorted(FIXTURES.rglob("*.md")):
        text = p.read_bytes().decode("utf-8", errors="surrogateescape")
        assert plain_body(text) == _reference_plain_body(text), p


class _Counting:
    def __init__(self, pattern: re.Pattern[str], calls: list[str]) -> None:
        self.pattern, self.calls = pattern, calls

    def __getattr__(self, name: str):
        self.calls.append(self.pattern.pattern)
        return getattr(self.pattern, name)


def test_plain_body_runs_no_regex_on_plain_prose(monkeypatch):
    calls: list[str] = []
    for name in dir(searchtext):
        value = getattr(searchtext, name)
        if name.endswith("_RE") and isinstance(value, re.Pattern):
            monkeypatch.setattr(searchtext, name, _Counting(value, calls))
    body = "A plain paragraph of prose, with commas.\n\nAnother line; still plain. 3.5\n" * 50
    expected = _reference_plain_body(body)
    assert plain_body(body) == expected
    assert calls == []
