"""Type suggestion and name patterns (M29): which type a create row offers first.

Every create row (``[[`` / ``@``, the palette, "+ New object" without a type, Turn into object,
a relation's picker) lists a suggested type first: the context's type (a relation's allowed
types, else the collection's or query's), then the types whose **name patterns** match the
name, otherwise the type used last in this space. Context and name patterns only: no AI, no
network, no I/O. The front end runs a 1:1 port (``frontend/src/create/typeSuggest.ts``); both
run the parity fixture ``frontend/src/create/__fixtures__/suggest-cases.json`` (plan
``2026-11-09-m29-synced-facts-and-type-suggestion.md``, Contract).

Pattern syntax (the whole name must match, case-insensitive, after ``strip``): a pattern that is
exactly one of `TOKENS`, or a glob where ``*`` is any run of non-space characters, ``?`` one
non-space character, ``#`` one digit, ``@`` one letter ``a-z``, ``\\`` makes the next character
literal and every other character is literal.

Task 1 gives the names and signatures; Task 2 fills the bodies.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from .typemodel import TypeDefinition

__all__ = [
    "MAX_PATTERN",
    "MAX_PATTERNS",
    "TOKENS",
    "SuggestContext",
    "compile_pattern",
    "matches",
    "pattern_problems",
    "suggest_type",
]

MAX_PATTERNS = 20
"""Name patterns a type can have (refused on save beyond this)."""
MAX_PATTERN = 100
"""Characters of one name pattern."""
TOKENS = ("{ip}", "{cidr}", "{fqdn}", "{version}")


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


def compile_pattern(pattern: str) -> re.Pattern[str] | None:
    """The regex `pattern` compiles to, or None when it is invalid."""
    raise NotImplementedError


def pattern_problems(patterns: Any) -> list[str]:
    """For a type save: [] when `patterns` (``namePatterns``) is absent or valid."""
    raise NotImplementedError


def matches(name: str, patterns: Sequence[str]) -> bool:
    """Whether `name` matches any valid pattern of `patterns` (invalid ones are ignored)."""
    raise NotImplementedError


def suggest_type(name: str, context: SuggestContext) -> list[str]:
    """The suggested type ids for `name`, best first ([]: no suggestion)."""
    raise NotImplementedError
