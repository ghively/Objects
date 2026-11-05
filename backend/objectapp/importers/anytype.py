"""The Anytype Markdown export reader (best effort; unverified against a real export).

Anytype's Markdown export isn't documented in detail and no real export was available when
this was built (2026-11-05), so this reader makes the fewest assumptions: each ``.md`` file is an
object, read with the Obsidian rules (`obsidian.read_markdown_folder`): its YAML frontmatter
keys become properties (kinds guessed as for Obsidian), relative Markdown links to ``.md`` files
and to other files in the export are handled as for Notion (without id suffixes), wikilinks as
for Obsidian. The type comes from a frontmatter key: ``typeSource: 'key'`` with
``typeKey: 'type'`` by default (a file without it is a ``Page``); the user can pick another key,
folders or nothing in the mapping step. Inline ``#tags`` are not read (our choice: Anytype
writes tags as a property). Detection never answers ``anytype``: the user chooses it.
"""

from __future__ import annotations

from .obsidian import read_markdown_folder
from .readmodel import ReadResult
from .source import Source, TextBudget

__all__ = ["DEFAULT_TYPE_KEY", "UNVERIFIED_WARNING", "read_anytype"]

DEFAULT_TYPE_KEY = "type"
UNVERIFIED_WARNING = (  # our string
    "The Anytype reader is best effort: it hasn't been checked against a real Anytype export. "
    "Check the types and properties before importing."
)


def read_anytype(src: Source, *, detected: str | None, suggested: str, budget: TextBudget) -> ReadResult:
    read = read_markdown_folder(
        src, kind="anytype", detected=detected, suggested=suggested, budget=budget, inline_tags=False
    )
    read.defaultTypeSource = "key"
    read.defaultTypeKey = DEFAULT_TYPE_KEY
    read.warnings.insert(0, UNVERIFIED_WARNING)
    return read
