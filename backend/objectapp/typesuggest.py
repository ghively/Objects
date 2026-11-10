"""Type suggestion and name patterns (M29): which type a create row offers first.

Every create row (``[[`` / ``@``, the palette, "+ New object" without a type, Turn into object,
a relation's picker) lists a suggested type first: the context's type (a relation's allowed
types, else the collection's or query's), then the types whose **name patterns** match the
name, otherwise the type used last in this space. Context and name patterns only: no AI, no
network, no I/O. The front end runs a 1:1 port (``frontend/src/create/typeSuggest.ts``); both
run the parity fixture ``frontend/src/create/__fixtures__/suggest-cases.json`` (plan
``2026-11-09-m29-synced-facts-and-type-suggestion.md``, Contract).

The matching algorithm, precisely (so the port can follow it step by step)
--------------------------------------------------------------------------

**Whitespace** is exactly JavaScript's ``\\s`` set (`WHITESPACE`), in both languages, not
Python's ``str.isspace``. A **character** is a Unicode code point (TypeScript iterates with
``for...of`` / ``Array.from``, not UTF-16 units), and a pattern's length is counted the same way.

**The name** is normalised once: strip `WHITESPACE` from both ends (``trim()``), then lowercase
it (``str.lower()`` / ``toLowerCase()``). Nothing else (inner runs of spaces are kept).

**Validity** is checked on the raw pattern: a string, 1-100 characters, and either exactly one
of `TOKENS` (case-sensitive: ``{IP}`` is invalid) or a glob that contains no ``{`` or ``}``
anywhere (escaped or not) and doesn't end in an unpaired ``\\``.

**Tokens** test the normalised name (``fullmatch``: the whole name; ``[0-9]`` and ``[a-z]`` are
ASCII; ``WS`` is the whitespace class above):

- ``{ip}``: IPv4 ``O(\\.O){3}`` with ``O = 25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9]``; or IPv6: one or
  more of ``[0-9a-f:]`` with at least two ``:``.
- ``{cidr}``: split at the last ``/`` (none: no match); the left part is an IPv4 address (as
  ``{ip}``) and the right ``[0-9]|[12][0-9]|3[0-2]``, or the left is an IPv6 address (as
  ``{ip}``) and the right ``[0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]``.
- ``{fqdn}``: ``(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.){2,}[a-z]{2,63}``.
- ``{version}``: ``[^WS][\\s\\S]*[WS]v?[0-9]+(?:\\.[0-9]+)*[a-z]?`` (a name, whitespace, a version
  token at the end; the Contract's ``\\S.*\\s+...`` written so it can't backtrack badly).

These regexes are linear on any input (no two quantifiers compete for the same characters
except a bounded ``{0,61}``), so they're used as regexes in both languages.

**A glob is never compiled to a backtracking regex**: ``\\S*`` per ``*`` is polynomial (roughly
n^k for k stars: ``*@*@*@*@*@*#`` on 80 characters takes seconds). It is matched by a
state-set (NFA) simulation, linear in the name's length times the pattern's:

1. Tokenise the *lowercased* pattern left to right: ``\\`` + the next character is a literal of
   that character; ``*`` is STAR; ``?`` is ANY (one non-whitespace character); ``#`` is DIGIT
   (``0-9``); ``@`` is LETTER (``a-z``); any other character is a literal of itself. Call the
   tokens ``t[0..m-1]``.
2. A state is an integer ``i`` in ``0..m``: "``t[0..i-1]`` are matched". ``closure(S)``: for
   ``i`` from 0 to ``m-1`` in ascending order, if ``i`` is in ``S`` and ``t[i]`` is STAR, add
   ``i+1`` (a star can match nothing; ascending order follows runs of stars).
3. ``S = closure({0})``. For each character ``c`` of the normalised name: ``S' = {}``; for each
   ``i`` in ``S`` with ``i < m``: if ``t[i]`` is STAR and ``c`` is not whitespace, add ``i``
   (the star eats ``c`` and stays); if ``t[i]`` is ANY and ``c`` is not whitespace, or DIGIT and
   ``c`` is ``0-9``, or LETTER and ``c`` is ``a-z``, or a literal equal to ``c``, add ``i+1``.
   Then ``S = closure(S')``; if ``S`` is empty the name doesn't match (stop early).
4. The name matches when ``m`` is in ``S`` after the last character.

(Here the sets are bit masks over Python ints; the port may use a boolean array: same result.)
"""

from __future__ import annotations

import functools
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from .typemodel import TypeDefinition

__all__ = [
    "MAX_PATTERN",
    "MAX_PATTERNS",
    "TOKENS",
    "WHITESPACE",
    "NamePattern",
    "SuggestContext",
    "compile_pattern",
    "matches",
    "normalize_name",
    "pattern_problems",
    "suggest_type",
]

MAX_PATTERNS = 20
"""Name patterns a type can have (refused on save beyond this)."""
MAX_PATTERN = 100
"""Characters of one name pattern."""
TOKENS = ("{ip}", "{cidr}", "{fqdn}", "{version}")

WHITESPACE = (
    "\t\n\v\f\r              "
    "    　﻿"
)
"""JavaScript's ``\\s`` (and ``trim()``) set, so both ports agree on what a space is."""
_WS = frozenset(WHITESPACE)
_WS_CLASS = re.escape(WHITESPACE).replace("\\ ", " ")

NOT_A_PATTERN = (
    "\"{p}\" isn't a name pattern. Use *, ?, #, @ or one of {{ip}}, {{cidr}}, {{fqdn}}, {{version}}."
)
TOO_MANY = "A type can have at most 20 name patterns."
TOO_LONG = "A name pattern is at most 100 characters."


@dataclass(frozen=True)
class SuggestContext:
    types: Sequence[TypeDefinition]
    """The types this create row offers, in its order."""
    allowed: Sequence[str] = ()
    """A relation property's allowed type ids (empty: any)."""
    scope: Sequence[str] = ()
    """The collection's or query's type ids."""
    last: str | None = None
    """The type used last in this space."""


# -- tokens --------------------------------------------------------------------------------

_OCTET = r"(?:25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])"
_IPV4 = re.compile(rf"{_OCTET}(?:\.{_OCTET}){{3}}")
_IPV6 = re.compile(r"[0-9a-f:]+")
_V4_PREFIX = re.compile(r"[0-9]|[12][0-9]|3[0-2]")
_V6_PREFIX = re.compile(r"[0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]")
_FQDN = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,63}")
_VERSION = re.compile(rf"[^{_WS_CLASS}][\s\S]*[{_WS_CLASS}]v?[0-9]+(?:\.[0-9]+)*[a-z]?")


def _is_ipv4(s: str) -> bool:
    return _IPV4.fullmatch(s) is not None


def _is_ipv6(s: str) -> bool:
    return _IPV6.fullmatch(s) is not None and s.count(":") >= 2


def _ip(s: str) -> bool:
    return _is_ipv4(s) or _is_ipv6(s)


def _cidr(s: str) -> bool:
    addr, sep, prefix = s.rpartition("/")
    if not sep:
        return False
    if _is_ipv4(addr):
        return _V4_PREFIX.fullmatch(prefix) is not None
    if _is_ipv6(addr):
        return _V6_PREFIX.fullmatch(prefix) is not None
    return False


def _fqdn(s: str) -> bool:
    return _FQDN.fullmatch(s) is not None


def _version(s: str) -> bool:
    return _VERSION.fullmatch(s) is not None


_TOKEN_TESTS: dict[str, Callable[[str], bool]] = {
    "{ip}": _ip,
    "{cidr}": _cidr,
    "{fqdn}": _fqdn,
    "{version}": _version,
}


# -- globs ---------------------------------------------------------------------------------

_STAR, _ANY, _DIGIT, _LETTER = "*", "?", "#", "@"


def _glob_tokens(pattern: str) -> list[tuple[str, str]] | None:
    """[(kind, literal)] for a glob, or None when it's invalid (a brace, a trailing ``\\``)."""
    if "{" in pattern or "}" in pattern:
        return None
    out: list[tuple[str, str]] = []
    chars = list(pattern.lower())
    i = 0
    while i < len(chars):
        c = chars[i]
        if c == "\\":
            if i + 1 >= len(chars):
                return None
            out.append(("lit", chars[i + 1]))
            i += 2
            continue
        if c in (_STAR, _ANY, _DIGIT, _LETTER):
            out.append((c, ""))
        else:
            out.append(("lit", c))
        i += 1
    return out


def _glob_matcher(tokens: list[tuple[str, str]]) -> Callable[[str], bool]:
    """The state-set simulation of the module docstring, over bit masks (bit i = state i)."""
    m = len(tokens)
    star = any_ = digit = letter = 0
    lits: dict[str, int] = {}
    for i, (kind, lit) in enumerate(tokens):
        bit = 1 << i
        if kind == _STAR:
            star |= bit
        elif kind == _ANY:
            any_ |= bit
        elif kind == _DIGIT:
            digit |= bit
        elif kind == _LETTER:
            letter |= bit
        else:
            lits[lit] = lits.get(lit, 0) | bit
    final = 1 << m

    def closure(s: int) -> int:
        while True:
            more = ((s & star) << 1) & ~s
            if not more:
                return s
            s |= more

    start = closure(1)

    def test(name: str) -> bool:
        s = start
        for c in name:
            if c in _WS:
                acc, loop = lits.get(c, 0), 0
            else:
                acc = any_ | lits.get(c, 0)
                if "0" <= c <= "9":
                    acc |= digit
                elif "a" <= c <= "z":
                    acc |= letter
                loop = star
            s = closure(((s & acc) << 1) | (s & loop))
            if not s:
                return False
        return bool(s & final)

    return test


# -- the public functions ------------------------------------------------------------------


class NamePattern:
    """A compiled name pattern. `test` takes a name as typed (it is normalised here)."""

    __slots__ = ("_test", "source")

    def __init__(self, source: str, test: Callable[[str], bool]) -> None:
        self.source = source
        self._test = test

    def test(self, name: str) -> bool:
        return self._test(normalize_name(name))

    def test_normalized(self, name: str) -> bool:
        return self._test(name)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"NamePattern({self.source!r})"


def normalize_name(name: str) -> str:
    """The name as patterns see it: `WHITESPACE` stripped from both ends, lowercased."""
    return name.strip(WHITESPACE).lower()


@functools.lru_cache(maxsize=512)
def _compile(pattern: str) -> NamePattern | None:
    if not pattern or len(pattern) > MAX_PATTERN:
        return None
    token = _TOKEN_TESTS.get(pattern)
    if token is not None:
        return NamePattern(pattern, token)
    tokens = _glob_tokens(pattern)
    if tokens is None:
        return None
    return NamePattern(pattern, _glob_matcher(tokens))


def compile_pattern(pattern: str) -> NamePattern | None:
    """The compiled `pattern` (``.test(name) -> bool``), or None when it is invalid.

    Not a ``re.Pattern`` (the Contract's first idea): a glob is matched by the linear state-set
    simulation of the module docstring, never by a backtracking regex."""
    if not isinstance(pattern, str):
        return None
    return _compile(pattern)


def pattern_problems(patterns: Any) -> list[str]:
    """For a type save: [] when `patterns` (``namePatterns``) is absent or valid."""
    if patterns is None:
        return []
    if not isinstance(patterns, list):
        return [NOT_A_PATTERN.format(p=patterns)]
    problems: list[str] = []
    if len(patterns) > MAX_PATTERNS:
        problems.append(TOO_MANY)
    for p in patterns:
        if isinstance(p, str) and len(p) > MAX_PATTERN:
            problems.append(TOO_LONG)
        elif compile_pattern(p) is None:
            problems.append(NOT_A_PATTERN.format(p=p))
    return problems


def matches(name: str, patterns: Sequence[str]) -> bool:
    """Whether `name` matches any valid pattern of `patterns` (invalid ones are ignored)."""
    if not isinstance(patterns, (list, tuple)) or not isinstance(name, str):
        return False
    norm = normalize_name(name)
    for p in patterns:
        compiled = compile_pattern(p)
        if compiled is not None and compiled.test_normalized(norm):
            return True
    return False


def suggest_type(name: str, context: SuggestContext) -> list[str]:
    """The suggested type ids for `name`, best first ([]: no suggestion)."""
    offered = [t.id for t in context.types]
    offered_set = set(offered)
    pattern_ids = _unique(t.id for t in context.types if matches(name, t.namePatterns))
    ctx_ids = _unique(i for i in (context.allowed or context.scope) if i in offered_set)
    if ctx_ids:
        return [i for i in ctx_ids if i in pattern_ids] + [
            i for i in ctx_ids if i not in pattern_ids
        ]
    last = context.last
    tail = [last] if last in offered_set and last not in pattern_ids else []
    return pattern_ids + tail  # type: ignore[list-item]


def _unique(ids: Any) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out
