"""M30: distillation, the values, summary lines and "From sources" section of an entity built from
every Source that mentions it (design 2026-11-09, section 5a; plan
``2026-11-09-m30-entity-extraction.md``, Contract and Task 5).

- `pick_values`: per property, the value of the most recently modified Source wins (a main page,
  then the smallest path, on a tie); every other value is kept as a ``conflict`` with its Sources.
  Values equal after normalising are one value with several Sources, never a conflict.
- `summary_lines`: the filing pass's lines, merged when equal, main pages first, at most
  `MAX_LINES`.
- The **"From sources" section** sits at the top of the entity's body, between `SECTION_OPEN` and
  its matching `SECTION_CLOSE` (M7's group container, so the editor keeps it as one block)::

      <!-- group from-sources -->
      ## From sources

      - The Payroll server at HQ. ([[Sources/APP01|APP01]])
      - Payroll runs on it. ([[Payroll]])

      Sources disagree:
      - IP address: 10.0.0.5 ([[Sources/APP01|APP01]]) or 10.0.0.6 ([[Old APP01 notes]]); 10.0.0.5 kept, from the newer source.

      Also linked: [[SRV-DB01]] (backs up to)
      <!-- /group -->

  The section is the import's; everything else in the body is Gene's. `replace_section` changes
  only the bytes of the section's span, and refuses (`SectionEdited`) a section whose hash differs
  from the record or whose bounds are broken.
- Per-value citations live in ``.object/distilled/<entity id>.json`` (`DistilledRecord`), never in
  the ``.md`` file::

      {"id", "path", "batch",
       "values": {key: {"value", "setByImport", "sources": [SourceRef], "conflict": [{"value", "sources"}] | null}},
       "section": {"hash": "sha256:...", "cites": {sourcePath: fileVersion}}}
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any, TypedDict

__all__ = [
    "ALSO_LINKED",
    "DISAGREE_HEADING",
    "DISTILLED_DIR",
    "MAX_LINES",
    "SECTION_CLOSE",
    "SECTION_HEADING",
    "SECTION_OPEN",
    "PickedValue",
    "SectionEdited",
    "SourceRef",
    "SummaryLine",
    "build_section",
    "find_section",
    "load_record",
    "pick_values",
    "replace_section",
    "save_record",
    "section_hash",
    "summary_lines",
]

SECTION_OPEN = "<!-- group from-sources -->"
SECTION_CLOSE = "<!-- /group -->"
"""The matching close of the M7 group container (nested groups counted)."""
SECTION_HEADING = "## From sources"
DISAGREE_HEADING = "Sources disagree:"
ALSO_LINKED = "Also linked:"
MAX_LINES = 12
"""Summary lines per entity."""
DISTILLED_DIR = "distilled"
"""``.object/distilled/<entity id>.json``."""


class SectionEdited(Exception):
    """The section differs from its recorded hash, or its bounds are broken: it is left alone."""


class SourceRef(TypedDict):
    path: str
    quote: str
    modified: str | None


class PickedValue(TypedDict):
    value: Any
    sources: list[SourceRef]
    """Every Source that says the winning value."""
    conflict: list[dict[str, Any]] | None
    """``[{"value", "sources": [SourceRef]}]`` for each losing value; None when every Source agrees."""


class SummaryLine(TypedDict):
    text: str
    sources: list[SourceRef]


def pick_values(found: dict[str, list[dict[str, Any]]], main_pages: set[str]) -> dict[str, PickedValue]:
    """Per key, the winning value and its conflicts. ``found``: key -> ``[{"value", "quote", "page",
    "modified"}]``; the newest Source wins, a main page then the smallest path on a tie."""
    raise NotImplementedError


def summary_lines(found: list[dict[str, Any]], main_pages: set[str]) -> list[SummaryLine]:
    """The entity's lines (``found``: ``[{"text", "quote", "page", "modified"}]``), merged by their
    normalised text, main pages first, at most `MAX_LINES`."""
    raise NotImplementedError


def build_section(
    lines: list[SummaryLine],
    picked: dict[str, PickedValue],
    plain: list[dict[str, Any]],
    cite: Callable[[str], str],
    label: Callable[[str], str],
) -> str:
    """The section's text, markers included, with ``"\\n"`` line endings. ``cite(path)`` gives a
    Source's link, ``label(key)`` a property's name; ``plain`` holds the plain links."""
    raise NotImplementedError


def find_section(body: str) -> tuple[int, int] | None:
    """``[start, end)`` of the section in ``body``, markers and one following blank line included;
    None when absent. Raises `SectionEdited` when its bounds are broken."""
    raise NotImplementedError


def replace_section(body: str, section: str, recorded_hash: str | None) -> str:
    """``body`` with ``section`` in place of the current one (at the top when absent); bytes outside
    the span unchanged, line endings kept. Raises `SectionEdited`."""
    raise NotImplementedError


def section_hash(section: str) -> str:
    """``"sha256:<hex>"`` of the section, line endings normalised."""
    raise NotImplementedError


def load_record(root: Path | str, entity_id: str) -> dict[str, Any] | None:
    """The entity's `DistilledRecord`; None when missing or unreadable. Reads only."""
    raise NotImplementedError


def save_record(root: Path | str, entity_id: str, record: dict[str, Any]) -> None:
    """Write the entity's `DistilledRecord` atomically."""
    raise NotImplementedError
