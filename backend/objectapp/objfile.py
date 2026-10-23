"""Split an object file's text into YAML frontmatter source and body.

Operates on text already normalised to ``\n`` line endings (see `textfile`).
Frontmatter exists only when the text starts with a ``---`` line and a later
line is exactly ``---``. A file that opens a fence but never closes it is
reported with ``fm_ok=False`` and its whole text as the body.
"""

from __future__ import annotations

from dataclasses import dataclass

FENCE = "---"


@dataclass(frozen=True)
class ObjectFile:
    frontmatter_src: str | None
    """Text between the fences, excluding them (each line keeps its newline)."""
    body: str
    """Everything after the closing fence line."""
    fm_ok: bool
    fm_error: str | None
    closing_fence_newline: bool = True
    """False only when the closing ``---`` is the last line with no newline."""


def split_object(text: str) -> ObjectFile:
    if not text.startswith(FENCE + "\n"):
        return ObjectFile(frontmatter_src=None, body=text, fm_ok=True, fm_error=None)

    start = len(FENCE) + 1
    pos = start
    while pos <= len(text):
        nl = text.find("\n", pos)
        line_end = len(text) if nl == -1 else nl
        if text[pos:line_end] == FENCE:
            if nl == -1:
                return ObjectFile(text[start:pos], "", True, None, closing_fence_newline=False)
            return ObjectFile(text[start:pos], text[nl + 1 :], True, None)
        if nl == -1:
            break
        pos = nl + 1

    return ObjectFile(
        frontmatter_src=None,
        body=text,
        fm_ok=False,
        fm_error="Frontmatter is not terminated: no closing '---' line",
    )


def join_object(of: ObjectFile) -> str:
    if of.frontmatter_src is None:
        return of.body
    closing = FENCE + ("\n" if of.body or of.closing_fence_newline else "")
    return FENCE + "\n" + of.frontmatter_src + closing + of.body
