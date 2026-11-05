"""The "Import report" object (contract "Import report"; every string here is ours).

One ``Page`` object titled "Import report" (`` (2)`` when taken), written last into the target
space's Page folder. Its body: the source path, kind and time; the counts (objects, types,
attachments, tags); then the sections "Skipped", "Renamed", "Unresolved links" and "Values not
converted", each a Markdown list capped at `MAX_LINES` lines with "…and N more". Links in it
are ``[[…]]`` to the imported objects where one exists; source texts are code spans, so a link
written in the source never becomes one here.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

from .model import SkippedItem

__all__ = ["MAX_LINES", "REPORT_TITLE", "build_report"]

REPORT_TITLE = "Import report"
MAX_LINES = 5000

KIND_NAMES = {"notion": "Notion", "obsidian": "Obsidian", "anytype": "Anytype"}
REASON_TEXT = {
    "unsafePath": "Unsafe path, not read",
    "symlink": "Link, not followed",
    "encrypted": "Encrypted",
    "tooLarge": "Too large",
    "damaged": "Damaged or unreadable",
    "nestedArchive": "Zip inside a zip",
    "unsupported": "Not imported",
    "appSettings": "App setting, dropped",
    "notUtf8": "Not UTF-8, bad bytes replaced",
    "missingAttachment": "Missing file",
    "unresolvedLink": "Unresolved link",
    "databaseLink": "Link to a database, kept as text",
    "valueNotConverted": "Value not converted",
    "userSkipped": "Left out in the mapping",
    "emptyFile": "Empty file",
}


def code(text: str) -> str:
    """``text`` as an inline code span (on one line), whatever backticks it holds."""
    t = " ".join(str(text).split())
    if not t:
        return "``"
    ticks = "`"
    while ticks in t:
        ticks += "`"
    pad = " " if t.startswith("`") or t.endswith("`") else ""
    return f"{ticks}{pad}{t}{pad}{ticks}"


def _section(title: str, lines: list[str]) -> list[str]:
    out = [f"## {title}", ""]
    if not lines:
        out.append("None.")
    else:
        out.extend(lines[:MAX_LINES])
        if len(lines) > MAX_LINES:
            out.append(f"- …and {len(lines) - MAX_LINES:,} more")
    out.append("")
    return out


def build_report(
    *,
    title: str,
    source_path: str,
    kind: str,
    when: str,
    counts: dict[str, int],
    skipped: Iterable[SkippedItem],
    renamed: Iterable[tuple[str, str]],
    unresolved: Iterable[tuple[str, str]],
    not_converted: Iterable[tuple[str, str, str, str]],
    link_for: Callable[[str], str | None],
    stopped: str | None = None,
    warnings: Iterable[str] = (),
) -> str:
    """The report's body. ``link_for(source path)`` is the ``[[…]]`` of the object imported
    from it (None when there is none); ``stopped`` says why the import stopped early."""

    def obj(src: str) -> str:
        link = link_for(src)
        return f"{link} ({code(src)})" if link else code(src)

    lines = [f"# {title}", ""]
    lines.append(f"- Source: {code(source_path)}")
    lines.append(f"- Exported from: {KIND_NAMES.get(kind, kind)}")
    lines.append(f"- Imported: {when}")
    if stopped:
        lines.append(f"- **The import stopped early:** {stopped}. Everything listed below as imported was written.")
    lines.append("")
    lines.append(
        f"Imported {counts.get('objects', 0):,} objects, {counts.get('types', 0):,} types, "
        f"{counts.get('attachments', 0):,} attachments and {counts.get('tags', 0):,} tags."
    )
    lines.append("")
    warnings = list(warnings)
    if warnings:
        lines += _section("Warnings", [f"- {w}" for w in warnings])
    lines += _section(
        "Skipped",
        [
            f"- {obj(s.path)}: {REASON_TEXT.get(s.reason, s.reason)}" + (f" — {code(s.detail)}" if s.detail else "")
            for s in skipped
            if s.reason not in ("unresolvedLink", "valueNotConverted")
        ],
    )
    lines += _section("Renamed", [f"- {code(t)} was written as [[{path[:-3]}]]" for t, path in renamed])
    lines += _section("Unresolved links", [f"- {obj(src)}: {code(raw)}" for src, raw in unresolved])
    lines += _section(
        "Values not converted",
        [f"- {code(t)} › {code(p)}, {obj(src)}: {code(v)}" for t, p, src, v in not_converted],
    )
    return "\n".join(lines).rstrip("\n") + "\n"
