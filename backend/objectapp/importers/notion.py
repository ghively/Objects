"""The Notion "Markdown & CSV" export reader.

- Id suffixes (a space and 32 hex digits, or a dashed UUID) are stripped from every stem used
  as a title, a type name or a link match; the ids are kept for matching only.
- Each ``.md`` is an object; its first ``# Title`` line is the title (else the stripped stem)
  and stays as the body's heading. Pages in no database are ``Page`` objects.
- Each database CSV (``Name <id>.csv``; ``Name <id>_all.csv`` preferred when both exist) is a
  type named ``Name``; each row is an object titled by the first column. Rows are matched to the
  page files in the folder ``Name <id>/`` by stripped title, in file order for equal titles (our
  choice). A row page's leading ``Key: value`` lines are dropped from its body when the key is a
  column (the CSV's values are used); a row with no page is an object with an empty body; a page
  in the database folder with no row is still an object of the type, its ``Key: value`` lines
  read as values. ``Created time`` / ``Last edited time`` columns fill ``createdAt`` /
  ``lastUpdated``.
- Relations (``Title (Path%20<id>.md)`` items) resolve by path, then by the id.
"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Iterator
from pathlib import PurePosixPath
from urllib.parse import unquote

from . import markdown
from .kinds import relation_items
from .model import SkippedItem
from .obsidian import HTML_WARNING
from .readmodel import (
    ReadDatabase,
    ReadObject,
    ReadResult,
    SourceIndex,
    notion_id,
    read_page_text,
    strip_notion_id,
)
from .source import MAX_OBJECTS, LimitExceeded, Source, TextBudget, is_csv, is_markdown

__all__ = ["CREATED_COLUMNS", "EDITED_COLUMNS", "page_heading", "read_notion", "split_property_lines"]

CREATED_COLUMNS = frozenset({"created time", "created"})
EDITED_COLUMNS = frozenset({"last edited time", "last edited"})
_PROP_LINE_RE = re.compile(r"^([^:\n]{1,100}): (.*)$")
_HEADING_RE = re.compile(r"^#[ \t]+(.+?)[ \t#]*$")
_csv_limit_set = False


def _big_csv_fields() -> None:
    global _csv_limit_set
    if not _csv_limit_set:
        csv.field_size_limit(32 * 1024 * 1024)
        _csv_limit_set = True


def page_heading(body: str) -> str | None:
    """The text of the page's first line when it is a ``# heading``."""
    for line in body.split("\n"):
        if not line.strip():
            continue
        m = _HEADING_RE.match(line)
        return m.group(1).strip() if m else None
    return None


def split_property_lines(body: str, keys: set[str] | frozenset[str]) -> tuple[dict[str, str], str]:
    """The ``Key: value`` lines right under the heading whose key is in ``keys``, and the body
    without them (the blank line after them dropped too)."""
    lines = body.split("\n")
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines) and _HEADING_RE.match(lines[i]):
        i += 1
    else:
        return {}, body
    head_end = i
    while i < len(lines) and not lines[i].strip():
        i += 1
    start = i
    props: dict[str, str] = {}
    while i < len(lines):
        m = _PROP_LINE_RE.match(lines[i])
        if not m or m.group(1).strip() not in keys:
            break
        props[m.group(1).strip()] = m.group(2).strip()
        i += 1
    if not props:
        return {}, body
    while i < len(lines) and not lines[i].strip():
        i += 1
    rest = lines[:head_end] + ([""] if i < len(lines) else []) + lines[i:]
    del start
    return props, "\n".join(rest)


def suggested_name(path: str) -> str:
    name = PurePosixPath(path.replace("\\", "/")).name
    stem = name[:-4] if name.lower().endswith(".zip") else name
    if re.match(r"^Export-[0-9a-fA-F-]{8,}", stem):
        return "Notion import"
    return strip_notion_id(stem) or stem


def _rows(text: str) -> Iterator[list[str]]:
    """The CSV's rows, one at a time (a big CSV is never held as a list of rows)."""
    _big_csv_fields()
    return csv.reader(io.StringIO(text, newline=""))


def _too_many() -> LimitExceeded:
    return LimitExceeded(f"The source has more than {MAX_OBJECTS:,} objects.")


def read_notion(src: Source, *, detected: str | None, suggested: str, budget: TextBudget) -> ReadResult:
    pages = sorted((r for r in src.files if is_markdown(r)), key=lambda p: (p.lower(), p))
    csvs = sorted(r for r in src.files if is_csv(r))
    files = {r: src.files[r].size for r in src.files if not is_markdown(r) and not is_csv(r)}
    skipped: list[SkippedItem] = list(src.skipped)
    index = SourceIndex(pages, list(files), csvs)
    hooks = markdown.Hooks(index.resolve_href, index.resolve_wiki)
    warnings: list[str] = []
    html = False

    # Databases: `_all` preferred; the other twin is ignored.
    chosen: dict[str, str] = {}
    for c in csvs:
        stem = PurePosixPath(c).stem
        base = stem.removesuffix("_all")
        key = str(PurePosixPath(c).parent / base)
        if key not in chosen or stem.endswith("_all"):
            chosen[key] = c
    for c in csvs:
        if c not in chosen.values():
            skipped.append(SkippedItem(path=c, reason="unsupported", detail="The database's _all file is read instead"))

    objects: list[ReadObject] = []
    databases: list[ReadDatabase] = []
    used_pages: set[str] = set()
    texts: dict[str, str] = {}

    def text_of(rel: str) -> str | None:
        if rel not in texts:
            t = read_page_text(src, rel, budget, skipped)
            if t is None:
                return None
            texts[rel] = t
        return texts[rel]

    for folder_key, c in sorted(chosen.items()):
        text = read_page_text(src, c, budget, skipped)
        if text is None:
            continue
        rows = _rows(text)
        del text
        first = next(rows, None)
        if not first:
            skipped.append(SkippedItem(path=c, reason="emptyFile"))
            continue
        header = [h.strip() for h in first]
        title_header = header[0] or "Name"
        headers = header[1:]
        db_key = f"database:{c}"
        name = strip_notion_id(PurePosixPath(folder_key).name) or "Database"
        databases.append(ReadDatabase(db_key, c, name, headers, title_header))
        folder = folder_key  # `Name <id>/` beside the CSV
        in_folder = [p for p in pages if str(PurePosixPath(p).parent) == folder]
        # Rows matched to pages by stripped title, in order.
        by_title: dict[str, list[str]] = {}
        for p in in_folder:
            by_title.setdefault(strip_notion_id(PurePosixPath(p).stem).strip().casefold(), []).append(p)
        column_keys = frozenset(h for h in headers if h)
        for n, row in enumerate(rows, start=1):
            if not any(cell.strip() for cell in row):
                continue
            if len(objects) >= MAX_OBJECTS:
                raise _too_many()
            cells = (row + [""] * len(header))[: len(header)]
            title = " ".join(cells[0].split()) or "Untitled"
            fields: dict[str, str] = {}
            system: dict[str, str] = {}
            for h, cell in zip(headers, cells[1:], strict=False):
                if not h:
                    continue
                low = h.lower()
                if low in CREATED_COLUMNS and cell.strip():
                    system["createdAt"] = cell.strip()
                elif low in EDITED_COLUMNS and cell.strip():
                    system["lastUpdated"] = cell.strip()
                fields[h] = cell
            candidates = by_title.get(title.casefold(), [])
            page = next((p for p in candidates if p not in used_pages), None)
            if page is not None:
                used_pages.add(page)
                body = text_of(page)
                if body is None:
                    page = None
            if page is not None:
                conv = markdown.convert(body or "", page, hooks, notion_callouts=True)
                texts.pop(page, None)  # converted: its text isn't needed again
                html = html or conv.html
                objects.append(
                    ReadObject(
                        sourcePath=page,
                        title=title,
                        mtime=src.files[page].mtime_iso,
                        group=db_key,
                        fields=fields,
                        cells=True,
                        system=system,
                        links=conv.links,
                        stripKeys=column_keys,
                    )
                )
            else:
                objects.append(
                    ReadObject(
                        sourcePath=f"{c}#{n}",
                        title=title,
                        mtime=None,
                        group=db_key,
                        fields=fields,
                        cells=True,
                        system=system,
                        hasBody=False,
                    )
                )
        # Pages in the folder with no row: objects of the type, their `Key: value` lines read.
        for p in in_folder:
            if p in used_pages:
                continue
            body = text_of(p)
            used_pages.add(p)
            texts.pop(p, None)
            if body is None:
                continue
            if len(objects) >= MAX_OBJECTS:
                raise _too_many()
            props, _rest = split_property_lines(body, column_keys)
            system = {}
            for h, v in props.items():
                if h.lower() in CREATED_COLUMNS:
                    system["createdAt"] = v
                elif h.lower() in EDITED_COLUMNS:
                    system["lastUpdated"] = v
            conv = markdown.convert(body, p, hooks, notion_callouts=True)
            html = html or conv.html
            objects.append(
                ReadObject(
                    sourcePath=p,
                    title=page_heading(body) or strip_notion_id(PurePosixPath(p).stem) or "Untitled",
                    mtime=src.files[p].mtime_iso,
                    group=db_key,
                    fields=dict(props),
                    cells=True,
                    system=system,
                    links=conv.links,
                    stripKeys=column_keys,
                )
            )

    for p in pages:
        if p in used_pages:
            continue
        body = text_of(p)
        texts.pop(p, None)
        if body is None:
            continue
        if len(objects) >= MAX_OBJECTS:
            raise _too_many()
        conv = markdown.convert(body, p, hooks, notion_callouts=True)
        html = html or conv.html
        objects.append(
            ReadObject(
                sourcePath=p,
                title=page_heading(body) or strip_notion_id(PurePosixPath(p).stem) or "Untitled",
                mtime=src.files[p].mtime_iso,
                group=None,
                links=conv.links,
            )
        )
    texts.clear()
    if html:
        warnings.append(HTML_WARNING)

    def entity_items(text: str, page: str, cells: bool) -> list[tuple[str | None, str]]:
        items = relation_items(text)
        if items is None:
            return [(None, text.strip())]
        out: list[tuple[str | None, str]] = []
        for title, path in items:
            decoded = unquote(path)
            kind, found = index.resolve_href(decoded, page)
            if kind != "object":
                found = index.by_id(notion_id(PurePosixPath(decoded).stem))
            out.append((found, title or strip_notion_id(PurePosixPath(decoded).stem)))
        return out

    return ReadResult(
        kind="notion",
        sourcePath=str(src.path),
        container=src.container,
        fingerprint=src.fingerprint,
        suggestedName=suggested,
        detected=detected,
        objects=objects,
        index=index,
        files=files,
        skipped=skipped,
        warnings=warnings,
        databases=databases,
        entity_items=entity_items,
    )
