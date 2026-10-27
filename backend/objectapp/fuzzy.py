"""The search palette's title matcher (M5; our scorer, Capacities' is not in the reference).

`score(query, text)` ranks a title or alias against what was typed:
exact 1000, prefix 800, every query word a word-prefix 600, substring 400,
an in-order subsequence 100-300 by contiguity, None otherwise. Case and
diacritics are ignored; the spans index into ``text``.
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

__all__ = [
    "ALIAS_PENALTY",
    "EXACT",
    "PREFIX",
    "SUBSTRING",
    "WORD_PREFIX",
    "fold",
    "score",
]

EXACT = 1000
PREFIX = 800
WORD_PREFIX = 600
SUBSTRING = 400
SUBSEQUENCE_MIN = 100
SUBSEQUENCE_MAX = 300
ALIAS_PENALTY = 50
"""An alias match scores this much less than the same title match."""

_WORD_RE = re.compile(r"[^\W_]+")


@lru_cache(maxsize=4096)
def _fold_char(c: str) -> str:
    base = unicodedata.normalize("NFD", c)[0].lower()
    return base[0] if base else c


@lru_cache(maxsize=65536)
def fold(text: str) -> str:
    """``text`` lowercased without diacritics, one character per character (spans stay valid)."""
    if text.isascii():
        return text.lower()
    return "".join(_fold_char(c) for c in text)


def _subsequence_spans(q: str, t: str) -> list[tuple[int, int]] | None:
    """Greedy in-order match of ``q``'s characters in ``t``, as runs."""
    spans: list[tuple[int, int]] = []
    pos = 0
    for ch in q:
        i = t.find(ch, pos)
        if i < 0:
            return None
        if spans and spans[-1][1] == i:
            spans[-1] = (spans[-1][0], i + 1)
        else:
            spans.append((i, i + 1))
        pos = i + 1
    return spans


@lru_cache(maxsize=65536)
def _text_words(t: str) -> tuple[tuple[int, str], ...]:
    return tuple((m.start(), m.group()) for m in _WORD_RE.finditer(t))


@lru_cache(maxsize=1024)
def _query_parts(q: str) -> tuple[list[str], str, frozenset[str]]:
    """The query's words, its characters without spaces, and the set of its word characters."""
    compact = q.replace(" ", "")
    words = _WORD_RE.findall(q)
    return words, compact, frozenset("".join(words))


def _word_prefix_spans(words: list[str], t: str) -> list[tuple[int, int]] | None:
    text_words = _text_words(t)
    used: set[int] = set()
    spans: list[tuple[int, int]] = []
    for w in words:
        for idx, (start, tw) in enumerate(text_words):
            if idx not in used and tw.startswith(w):
                used.add(idx)
                spans.append((start, start + len(w)))
                break
        else:
            return None
    return sorted(spans)


def score(query: str, text: str) -> tuple[int, list[tuple[int, int]]] | None:
    """How well ``text`` matches ``query`` (see the module doc), with matched spans."""
    q = " ".join(fold(query).split())
    if not q or not text:
        return None
    t = fold(text)
    words, compact, letters = _query_parts(q)
    # Every tier needs every letter of the query somewhere in the text: a cheap reject.
    for ch in letters:
        if ch not in t:
            return None
    if t.strip() == q:
        start = len(t) - len(t.lstrip())
        return EXACT, [(start, start + len(q))]
    if t.startswith(q):
        return PREFIX, [(0, len(q))]
    if words:
        spans = _word_prefix_spans(words, t)
        if spans is not None:
            return WORD_PREFIX, spans
    i = t.find(q)
    if i >= 0:
        return SUBSTRING, [(i, i + len(q))]
    spans = _subsequence_spans(compact, t)
    if spans is None:
        return None
    runs = len(spans)
    n = len(compact)
    if n <= 1:
        ratio = 1.0
    else:
        ratio = (n - runs) / (n - 1)
    value = SUBSEQUENCE_MIN + round((SUBSEQUENCE_MAX - SUBSEQUENCE_MIN) * ratio)
    return min(max(value, SUBSEQUENCE_MIN), SUBSEQUENCE_MAX), spans
