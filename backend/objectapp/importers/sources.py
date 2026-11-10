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

from pathlib import Path, PurePosixPath
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

_BLOCK_KEY = "importSource"
"""`provenance.BLOCK_KEY` (not imported: `space` imports this module)."""

_CATEGORY_BY_EXT: dict[str, str] = {
    **dict.fromkeys((".docx", ".doc", ".odt", ".rtf"), "Document"),
    **dict.fromkeys((".xlsx", ".xls", ".ods", ".csv"), "Spreadsheet"),
    **dict.fromkeys((".pptx", ".ppt", ".odp"), "Presentation"),
    ".pdf": "PDF",
    **dict.fromkeys((".vsdx", ".vsd", ".drawio"), "Diagram"),
    **dict.fromkeys((".eml", ".msg"), "Email"),
    **dict.fromkeys((".html", ".htm", ".aspx"), "Web page"),
    **dict.fromkeys((".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic"), "Image"),
}
"""Category by the original's extension (our table, plan Task 4)."""

_CATEGORY_BY_SYSTEM: dict[str, str] = {
    **dict.fromkeys(("wiki", "notion", "sharepoint"), "Wiki page"),
    **dict.fromkeys(("obsidian", "anytype", "markdown", "files"), "Note"),
}
"""Category by ``importSource.system`` when the extension says nothing. Ticket and Chat are never set."""


def keep_as_sources(asked: bool | None, require_approved: bool, has_proposal: bool) -> bool:
    """The option's value: ``asked`` when given, else the default rule.

    The default is on for every import (Gene, 2026-11-09: the box starts ticked for every import
    into a space); ``require_approved`` and ``has_proposal`` no longer change it."""
    del require_approved, has_proposal
    return True if asked is None else bool(asked)


def ensure_source_type(space: Space) -> str:
    """The Source type's id; writes `basicsetup.source_type()` only when the space has no type with that id.

    The space's type with id `SOURCE_TYPE_ID` is used whatever it holds. When another type already
    has the name "Source", the new one is named "Source (2)" (the next free name); its id stays."""
    if space.type_by_id(SOURCE_TYPE_ID) is not None:
        return SOURCE_TYPE_ID
    from ..basicsetup import source_type

    t = source_type()
    base, n = t.name, 2
    taken = {x.name.casefold() for x in space.types}
    while t.name.casefold() in taken:
        t.name, n = f"{base} ({n})", n + 1
    return space.add_type(t).id


def category_for(block: dict[str, Any], path: str) -> str | None:
    """A Category option for the Source: from the original's format, then the source system."""
    block = block if isinstance(block, dict) else {}
    original = block.get("original")
    name = original if isinstance(original, str) and original else str(path or "")
    ext = PurePosixPath(name.replace("\\", "/")).suffix.lower()
    if ext in _CATEGORY_BY_EXT:
        return _CATEGORY_BY_EXT[ext]
    system = block.get("system")
    return _CATEGORY_BY_SYSTEM.get(system) if isinstance(system, str) else None


def system_label(block: dict[str, Any]) -> str | None:
    """The System option for the ``importSource`` block's ``system`` (`SYSTEM_LABELS`)."""
    system = block.get("system") if isinstance(block, dict) else None
    return SYSTEM_LABELS.get(system) if isinstance(system, str) else None


def is_imported_source(type_id: str | None, fm: dict[str, Any]) -> bool:
    """Type id `SOURCE_TYPE_ID` and an ``importSource`` block in the frontmatter."""
    if type_id != SOURCE_TYPE_ID or not isinstance(fm, dict):
        return False
    b = fm.get(_BLOCK_KEY)
    return isinstance(b, dict) and bool(b)


def is_source_batch(root: Path | str, batch: str) -> bool:
    """The batch's ``batch.json`` records ``keepAsSources: true``. Reads only."""
    from .batches import load_batch

    try:
        data, _items = load_batch(root, batch)
    except KeyError:
        return False
    return data.get("keepAsSources") is True
