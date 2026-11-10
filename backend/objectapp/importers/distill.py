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

import hashlib
import json
import re
import unicodedata
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypedDict
from urllib.parse import quote

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



# -- values and summary lines ----------------------------------------------------------------------


def _when(modified: str | None) -> float:
    """A Source's modified time as a number; None (or unreadable) is the oldest."""
    if not modified:
        return float("-inf")
    try:
        t = datetime.fromisoformat(str(modified).replace("Z", "+00:00"))
    except ValueError:
        return float("-inf")
    return (t if t.tzinfo else t.replace(tzinfo=UTC)).timestamp()


def _refs(rows: list[dict[str, Any]], main_pages: set[str]) -> list[SourceRef]:
    """One `SourceRef` per page (its first row), main pages first, then by path."""
    seen: dict[str, SourceRef] = {}
    for row in rows:
        page = str(row["page"])
        if page not in seen:
            seen[page] = {"path": page, "quote": str(row.get("quote") or ""), "modified": row.get("modified")}
    return [seen[p] for p in sorted(seen, key=lambda p: (p not in main_pages, p))]


def _best(rows: list[dict[str, Any]], main_pages: set[str]) -> dict[str, Any]:
    """The row a group's spelling comes from: the newest, then a main page's, then the smallest path."""
    return min(rows, key=lambda r: (-_when(r.get("modified")), r["page"] not in main_pages, str(r["page"])))


def pick_values(found: dict[str, list[dict[str, Any]]], main_pages: set[str]) -> dict[str, PickedValue]:
    """Per key, the winning value and its conflicts. ``found``: key -> ``[{"value", "quote", "page",
    "modified"}]``; the newest Source wins, a main page then the smallest path on a tie.

    Values equal by `filing._norm` of their text are one value with every Source that says it
    (one `SourceRef` per page, main pages first, then by path); the others are the ``conflict``."""
    from . import filing  # noqa: PLC0415 (filing pulls in the whole import package)

    out: dict[str, PickedValue] = {}
    for key, rows in found.items():
        if not rows:
            continue
        groups: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            groups.setdefault(filing._norm(str(row["value"])), []).append(row)

        def rank(members: list[dict[str, Any]]) -> tuple[float, bool, str]:
            return (
                -max(_when(m.get("modified")) for m in members),
                not any(m["page"] in main_pages for m in members),
                min(str(m["page"]) for m in members),
            )

        win, *rest = sorted(groups.values(), key=rank)
        out[key] = {
            "value": _best(win, main_pages)["value"],
            "sources": _refs(win, main_pages),
            "conflict": [{"value": _best(g, main_pages)["value"], "sources": _refs(g, main_pages)} for g in rest]
            or None,
        }
    return out


def _norm_text(text: str) -> str:
    """`entities.norm_name`; its documented rule here while that function is still T1's stub."""
    from . import entities  # noqa: PLC0415 (entities imports distill at module level)

    try:
        return entities.norm_name(text)
    except NotImplementedError:
        t = " ".join(unicodedata.normalize("NFKC", text).casefold().split())
        return t.strip(".,;:()[]\"' ")


def summary_lines(found: list[dict[str, Any]], main_pages: set[str]) -> list[SummaryLine]:
    """The entity's lines (``found``: ``[{"text", "quote", "page", "modified"}]``), merged by their
    normalised text, main pages first, then by the newest Source, then text; at most `MAX_LINES`.
    A merged line's text is its newest Source's spelling."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in found:
        text = str(row.get("text") or "").strip()
        if text:
            groups.setdefault(_norm_text(text), []).append(row)

    def rank(item: tuple[str, list[dict[str, Any]]]) -> tuple[bool, float, str]:
        norm, members = item
        return (
            not any(m["page"] in main_pages for m in members),
            -max(_when(m.get("modified")) for m in members),
            norm,
        )

    return [
        {"text": str(_best(members, main_pages)["text"]).strip(), "sources": _refs(members, main_pages)}
        for _norm, members in sorted(groups.items(), key=rank)[:MAX_LINES]
    ]


# -- the section -------------------------------------------------------------------------------------


def _value_text(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(_value_text(v) for v in value)
    if isinstance(value, dict):
        return str(value.get("target") or value.get("title") or value.get("value") or "")
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return " ".join(str(value).split())


def _cites(refs: list[SourceRef], cite: Callable[[str], str]) -> str:
    links = [cite(r["path"]) for r in refs]
    return f" ({', '.join(links)})" if links else ""


def _plain_link(item: dict[str, Any]) -> str:
    link = str(item.get("link") or "").strip()
    if not link:
        link = f"[[{item.get('target') or item.get('title') or ''}]]"
    relation = " ".join(str(item.get("relation") or "").split())
    return f"{link} ({relation})" if relation else link


def build_section(
    lines: list[SummaryLine],
    picked: dict[str, PickedValue],
    plain: list[dict[str, Any]],
    cite: Callable[[str], str],
    label: Callable[[str], str],
) -> str:
    """The section's text, markers included, with ``"\\n"`` line endings. ``cite(path)`` gives a
    Source's link, ``label(key)`` a property's name; ``plain`` holds the plain links, each
    ``{"link": "[[...]]", "relation"}`` (or ``{"target", "relation"}``, linked as ``[[target]]``).

    Blocks (the lines, the disagreements, the plain links) are separated by one blank line; no
    other line inside is empty."""
    blocks: list[list[str]] = []
    said = [f"- {' '.join(ln['text'].split())}{_cites(ln['sources'], cite)}" for ln in lines if ln["text"].strip()]
    if said:
        blocks.append(said)
    disagree = []
    for key, p in picked.items():
        if not p.get("conflict"):
            continue
        kept = _value_text(p["value"])
        options = [f"{kept}{_cites(p['sources'], cite)}"]
        options += [f"{_value_text(c['value'])}{_cites(c['sources'], cite)}" for c in p["conflict"] or []]
        disagree.append(f"- {label(key)}: {' or '.join(options)}; {kept} kept, from the newer source.")
    if disagree:
        blocks.append([DISAGREE_HEADING, *disagree])
    if plain:
        blocks.append([f"{ALSO_LINKED} {', '.join(_plain_link(p) for p in plain)}"])
    out = [SECTION_OPEN, SECTION_HEADING]
    for block in blocks:
        out.append("")
        out.extend(block)
    out.append(SECTION_CLOSE)
    return "\n".join(out) + "\n"


# M7's annotation lines (frontend/src/editor/annotations.ts: up to 3 spaces before, the container
# name in any case, spaces inside); only group containers count for the matching close.
_GROUP_OPEN = re.compile(r"^ {0,3}<!--[ \t]*group(?:[ \t](?:(?!-->).)*)?-->[ \t]*$", re.IGNORECASE)
_GROUP_CLOSE = re.compile(r"^ {0,3}<!--[ \t]*/group[ \t]*-->[ \t]*$", re.IGNORECASE)
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_LINE = re.compile(r"[^\n]*\n|[^\n]+\Z")


def _lines(body: str) -> list[tuple[int, str, str]]:
    """``(offset, line without its ending, line with it)`` per ``\\n``-ended line of ``body``."""
    return [
        (m.start(), m.group(0).removesuffix("\n").removesuffix("\r"), m.group(0))
        for m in _LINE.finditer(body)
    ]


def find_section(body: str) -> tuple[int, int] | None:
    """``[start, end)`` of the section in ``body``, markers and one following blank line included;
    None when absent. Raises `SectionEdited` when its bounds are broken (an open with no matching
    close, counting nested groups, or a second open). Lines inside fenced code are not markers."""
    lines = _lines(body)
    fence: str | None = None
    start: int | None = None
    end: int | None = None
    depth = 0
    for i, (pos, text, full) in enumerate(lines):
        m = _FENCE.match(text)
        if fence is not None:
            mark = m.group(1) if m else ""
            if mark and mark[0] == fence[0] and len(mark) >= len(fence) and not text.strip()[len(mark) :].strip():
                fence = None
            continue
        if m:
            fence = m.group(1)
            continue
        if text.strip() == SECTION_OPEN:
            if start is not None:
                raise SectionEdited("The section's open marker is there twice.")
            start, depth = pos, 1
            continue
        if start is None or end is not None:
            continue
        if _GROUP_OPEN.match(text):
            depth += 1
        elif _GROUP_CLOSE.match(text):
            depth -= 1
            if depth == 0:
                end = pos + len(full)
                if i + 1 < len(lines) and lines[i + 1][2] in ("\n", "\r\n"):
                    end += len(lines[i + 1][2])
    if start is None:
        return None
    if end is None:
        raise SectionEdited("The section has no matching close marker.")
    return start, end


def _eol(text: str) -> str:
    """The text's majority line ending (as `textfile.decode` decides)."""
    crlf = text.count("\r\n")
    return "\r\n" if crlf and crlf >= text.count("\n") - crlf else "\n"


def replace_section(body: str, section: str, recorded_hash: str | None) -> str:
    """``body`` with ``section`` in place of the current one (at the top when absent); bytes outside
    the span unchanged, line endings kept. Raises `SectionEdited` when the current section's hash
    differs from ``recorded_hash`` (Gene edited it) or its bounds are broken.

    A blank line separates the section from what follows. ``section`` may have either ending: it
    is written with the body's (majority) one."""
    eol = _eol(body)
    text = section.replace("\r\n", "\n").rstrip("\n") + "\n"
    if eol == "\r\n":
        text = text.replace("\n", "\r\n")
    span = find_section(body)
    if span is None:
        bom = "﻿" if body.startswith("﻿") else ""
        rest = body[len(bom) :]
        return bom + text + eol + rest if rest else bom + text
    start, end = span
    if recorded_hash is not None and section_hash(body[start:end]) != recorded_hash:
        raise SectionEdited("The section was edited.")
    rest = body[end:]
    had_blank = body[start:end].endswith(("\n\n", "\n\r\n"))
    return body[:start] + text + (eol if had_blank or rest else "") + rest


def section_hash(section: str) -> str:
    """``"sha256:<hex>"`` of the section, line endings normalised (trailing blank lines ignored, so
    a span read back with its following blank line hashes as the section written)."""
    text = section.replace("\r\n", "\n").rstrip("\n") + "\n"
    return "sha256:" + hashlib.sha256(text.encode("utf-8", errors="surrogateescape")).hexdigest()


# -- records --------------------------------------------------------------------------------------------


def _record_path(root: Path | str, entity_id: str) -> Path:
    """``.object/distilled/<entity id>.json``. An id that isn't a plain file name (``host:app01``,
    a space, a slash) is percent-encoded, so it stays one file inside the folder on every system."""
    name = quote(str(entity_id), safe="-_.~")
    if not name or set(name) <= {"."}:
        raise ValueError(f"{entity_id!r} isn't an entity id.")
    return Path(root) / ".object" / DISTILLED_DIR / f"{name}.json"


def load_record(root: Path | str, entity_id: str) -> dict[str, Any] | None:
    """The entity's `DistilledRecord`; None when missing or unreadable. Reads only."""
    try:
        data = json.loads(_record_path(root, entity_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def save_record(root: Path | str, entity_id: str, record: dict[str, Any]) -> None:
    """Write the entity's `DistilledRecord` atomically."""
    from . import batches  # noqa: PLC0415

    batches.write_json(_record_path(root, entity_id), record)
