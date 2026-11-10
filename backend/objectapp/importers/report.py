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

KIND_NAMES = {"notion": "Notion", "obsidian": "Obsidian", "anytype": "Anytype", "files": "Files"}
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


def _count(n: int, word: str) -> str:
    """``1 object``, ``2 objects`` (every word here takes an ``s``)."""
    return f"{n:,} {word}" if n == 1 else f"{n:,} {word}s"


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
    not_written: int = 0,
    warnings: Iterable[str] = (),
    extra: dict | None = None,
) -> str:
    """The report's body. ``link_for(source path)`` is the ``[[…]]`` of the object imported
    from it (None when there is none); ``stopped`` says why the import stopped early and
    ``not_written`` how many planned objects it didn't write (links to them stay unresolved)."""

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
        f"Imported {_count(counts.get('objects', 0), 'object')}, {_count(counts.get('types', 0), 'type')}, "
        f"{_count(counts.get('attachments', 0), 'attachment')} and {_count(counts.get('tags', 0), 'tag')}."
    )
    lines.append("")
    if extra and extra.get("counts"):
        lines += _counts_section(extra["counts"])
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
    unresolved_lines = [f"- {obj(src)}: {code(raw)}" for src, raw in unresolved]
    if stopped and not_written:
        unresolved_lines.insert(0, "- Links to objects that weren't imported stay unresolved.")
    lines += _section("Unresolved links", unresolved_lines)
    lines += _section(
        "Values not converted",
        [f"- {code(t)} › {code(p)}, {obj(src)}: {code(v)}" for t, p, src, v in not_converted],
    )
    if extra:
        lines += _extra_sections(extra, obj)
    return "\n".join(lines).rstrip("\n") + "\n"


def _counts_section(c: dict[str, int]) -> list[str]:
    """The counts that reconcile (design section 10)."""
    parts = [
        ("Imported", c.get("imported", 0)),
        ("Updated", c.get("updated", 0)),
        ("Unchanged", c.get("unchanged", 0)),
        ("Changed in both", c.get("changedInBoth", 0)),
        ("Left out", c.get("leftOut", 0)),
        ("Failed", c.get("failed", 0)),
    ]
    total = sum(n for _, n in parts)
    lines = ["## Counts", "", f"- Source items: {c.get('sourceItems', 0):,}"]
    lines += [f"- {name}: {n:,}" for name, n in parts]
    ok = total == c.get("sourceItems", 0)
    lines.append(f"- Check: {total:,} accounted for of {c.get('sourceItems', 0):,}" + ("" if ok else " (does not add up)"))
    if c.get("notWritten"):
        lines.append(f"- Failed includes {c['notWritten']:,} not written because the import stopped")
    if c.get("removed"):
        lines.append(f"- Removed at source (not counted above, still in the space): {c['removed']:,}")
    lines.append("")
    return lines


def _extra_sections(extra: dict, obj: Callable[[str], str]) -> list[str]:
    out: list[str] = []
    if extra.get("batch"):
        out += [f"Batch: {code(extra['batch'])}", ""]
    moved = extra.get("movedFrom") or []
    if moved:
        was = " and ".join(code(p) for p in moved)
        out += [(f"Source moved: it was imported before from {was}; the objects made then were found by their "
                 "source ids, so none was made twice."), ""]
    kept = extra.get("originals", 0)
    large = extra.get("originalsLarge") or []
    images = extra.get("images", 0)
    if kept or large or images:
        how = "File objects" if extra.get("keep") == "fileObjects" else "attachments"
        lines = [f"- Kept {_count(kept, 'original')} in Attachments/Originals ({how})."] if kept or large else []
        if images:  # AC-2: an image is an Image object whose source is its original
            lines.append("- 1 image became an Image object." if images == 1 else f"- {images:,} images became Image objects.")
        lines += [f"- {obj(p)}: over 100 MB, the original was not copied" for p in large]
        out += _section("Originals", lines)
    git = extra.get("git")
    if isinstance(git, dict) and git.get("commit"):
        # M31: a source folder in a git repository (our strings).
        lines = [f"- Imported at commit {code(git['commit'])}."]
        lines += [f"- {obj(p)}: has changes not committed to git; imported as it is on disk"
                  for p in git.get("uncommitted") or []]
        out += _section("Git", lines)
    losses = extra.get("losses") or []
    if losses:
        out += _section("Conversion notes", [f"- {obj(s)}: {code(n)}" for s, n in losses])
    conflicts = extra.get("conflicts") or []
    if conflicts or extra.get("counts", {}).get("changedInBoth"):
        out += _section(
            "Changed in both",
            [f"- {link}: changed at the source and edited in Object; choose Take source or Keep mine" for link, _p in conflicts],
        )
    scanned = extra.get("scan") or {}
    if scanned.get("leftOut") or scanned.get("excluded"):
        lines = [f"- {code(f)}: left out, not read or imported" for f in scanned.get("leftOut", [])]
        lines += [f"- {code(f)}: imported, excluded from AI (the scan flagged it)" for f in scanned.get("excluded", [])]
        out += _section("Sensitive content scan", lines)
    removed = extra.get("removed") or []
    if removed or extra.get("counts", {}).get("removed"):
        out += _section(
            "Removed at source",
            [f"- [[{p[:-3]}]]: no longer in the source; left in the space" for _t, p in removed],
        )
    return out
