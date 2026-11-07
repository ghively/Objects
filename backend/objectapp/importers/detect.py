"""Which app a source came from, and reading it with the right reader.

Detection (contract "Sources and detection"), in order:

1. Obsidian: a ``.obsidian/`` folder at the root (or under the zip's single top folder).
2. Notion: at least half of the ``.md`` and ``.csv`` files have a stem ending in a space and
   32 hex digits, or a dashed UUID (our choice to accept both).
3. Files (M25): a ``_manifest.jsonl`` at the root, or no Markdown or CSV file at all.
4. Anytype: never. Its export's layout isn't documented and no real export was available, so
   the user picks it (unverified, see ``anytype``).
5. Anything else with Markdown files: ``None``; it is read with the Obsidian rules and the
   preview warns (`UNKNOWN_SOURCE`).

A chosen kind always wins; `read_source` answers what detection found as ``detected``.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath

from .anytype import read_anytype
from .files import MANIFEST_NAME, read_files
from .notion import read_notion, suggested_name
from .obsidian import read_markdown_folder
from .readmodel import ReadResult, notion_id
from .source import MAX_OBJECTS, LimitExceeded, Source, TextBudget, is_csv, is_markdown

__all__ = ["UNKNOWN_SOURCE", "detect", "read_source"]

UNKNOWN_SOURCE = "Couldn't tell where this export came from; it is read as a Markdown folder."
NO_PAGES = "No Markdown files were found in this source."


def detect(src: Source) -> str | None:
    if src.has_obsidian:
        return "obsidian"
    if MANIFEST_NAME in src.files:
        return "files"  # M25: a manifest beside the files
    stems = [PurePosixPath(r).stem for r in src.files if is_markdown(r) or is_csv(r)]
    if stems:
        with_id = sum(1 for s in stems if notion_id(s.removesuffix("_all")))
        if with_id * 2 >= len(stems):
            return "notion"
    elif any(not is_csv(r) for r in src.files):
        return "files"  # M25: no Markdown at all, only other files
    return None


def read_source(src: Source, kind: str = "auto", budget: TextBudget | None = None) -> ReadResult:
    """Read ``src`` with the reader for ``kind`` (``auto``: detected, else Obsidian's rules)."""
    budget = budget or TextBudget()
    pages = sum(1 for r in src.files if is_markdown(r))
    if pages > MAX_OBJECTS:
        raise LimitExceeded(f"The source has more than {MAX_OBJECTS:,} pages.")
    detected = detect(src)
    chosen = detected if kind == "auto" else kind
    name = Path(src.path).name
    if src.container == "zip" and name.lower().endswith(".zip"):
        name = name[:-4]
    suggested = suggested_name(name) if chosen == "notion" else name
    if chosen == "notion":
        read = read_notion(src, detected=detected, suggested=suggested, budget=budget)
    elif chosen == "files":
        read = read_files(src, detected=detected, suggested=suggested, budget=budget)
    elif chosen == "anytype":
        read = read_anytype(src, detected=detected, suggested=suggested, budget=budget)
    else:
        read = read_markdown_folder(
            src, kind="obsidian", detected=detected, suggested=suggested, budget=budget
        )
        if detected is None and kind == "auto":
            read.warnings.insert(0, UNKNOWN_SOURCE)
    if not read.objects:
        read.warnings.append(NO_PAGES)
    if len(read.objects) > MAX_OBJECTS:
        raise LimitExceeded(f"The source has more than {MAX_OBJECTS:,} objects.")
    return read
