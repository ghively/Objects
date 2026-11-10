"""M30: **Keep pages as Sources** (design 2026-11-09, section 5a; plan
``2026-11-09-m30-entity-extraction.md``, Contract and Task 4).

``keepAsSources`` is an option on every import (on by default). On, every page of the batch is
written as a read-only **Source** object: type Source (`SOURCE_TYPE_ID`, M28's
``basicsetup.source_type()``), its Category (`category_for`) and System (`system_label`), the page's
other fields as frontmatter keys the type doesn't declare, its ``importSource`` provenance, and its
text exactly as imported. Off, pages are filed into their mapped types as M25 does.

An **imported Source** (`is_imported_source`) is read-only in the app with the reason
`SOURCE_READ_ONLY`: only the M25 re-run of its source writes it, inside ``Space.source_writes()``.
Move to Trash and Restore stay allowed.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..space import Space

__all__ = [
    "SOURCE_READ_ONLY",
    "SOURCE_TYPE_ID",
    "SYSTEM_LABELS",
    "category_for",
    "ensure_source_type",
    "is_imported_source",
    "is_source_batch",
    "keep_as_sources",
    "system_label",
]

SOURCE_TYPE_ID = "source"
SOURCE_READ_ONLY = "Imported source"
SYSTEM_LABELS = {
    "sharepoint": "SharePoint", "wiki": "Wiki", "notion": "Notion", "obsidian": "Obsidian",
    "anytype": "Anytype", "files": "Files", "markdown": "Markdown",
}  # fmt: skip
"""``importSource.system`` -> the Source type's System option."""


def keep_as_sources(asked: bool | None, require_approved: bool, has_proposal: bool) -> bool:
    """The option's value: ``asked`` when given, else the default rule."""
    raise NotImplementedError


def ensure_source_type(space: Space) -> str:
    """The Source type's id; writes `basicsetup.source_type()` only when the space has no type with that id."""
    raise NotImplementedError


def category_for(block: dict[str, Any], path: str) -> str | None:
    """A Category option for the Source: from the original's format, then the source system."""
    raise NotImplementedError


def system_label(block: dict[str, Any]) -> str | None:
    """The System option for the ``importSource`` block's ``system`` (`SYSTEM_LABELS`)."""
    raise NotImplementedError


def is_imported_source(type_id: str | None, fm: dict[str, Any]) -> bool:
    """Type id `SOURCE_TYPE_ID` and an ``importSource`` block in the frontmatter."""
    raise NotImplementedError


def is_source_batch(root: Path | str, batch: str) -> bool:
    """The batch's ``batch.json`` records ``keepAsSources: true``. Reads only."""
    raise NotImplementedError
