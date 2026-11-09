"""What a reader makes of a source before the mapping step: `ReadResult` (Lane B's own shape).

A reader (``notion``, ``obsidian``, ``anytype``) lists every page it will import as a
`ReadObject` with its raw source values, its system fields and the links its body holds
(already resolved to source paths: that doesn't depend on the mapping). The planner turns a
`ReadResult` and a mapping into the contract's `ImportPlan`; the API keeps the latest
`ReadResult` (30 minutes) so a changed mapping re-plans without reading the source again.

`SourceIndex` resolves a link inside the source: a Markdown destination relative to the page
(then to the root), a wikilink as Obsidian does (exact path, the path ignoring case, then the
file name anywhere, shortest path first), an attachment by the ``findAttachment`` short-name
rule, and (Notion) a page by the 32-hex id in its file name.
"""

from __future__ import annotations

import posixpath
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

from .markdown import Resolved
from .model import PlanLink, SkippedItem

__all__ = ["ReadDatabase", "ReadObject", "ReadResult", "SourceIndex", "notion_id", "strip_notion_id"]

_NOTION_ID_RE = re.compile(
    r"\s+([0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"
)


def notion_id(stem: str) -> str | None:
    """The Notion id at the end of a file or folder stem (lowercase, no dashes), or None."""
    m = _NOTION_ID_RE.search(stem)
    return m.group(1).replace("-", "").lower() if m else None


def strip_notion_id(stem: str) -> str:
    """``Page 0123…cdef`` -> ``Page`` (a stem with no id is returned as it is)."""
    m = _NOTION_ID_RE.search(stem)
    return stem[: m.start()] if m else stem


@dataclass
class ReadObject:
    sourcePath: str
    """The Markdown file (source-relative), or ``<csv path>#<row>`` for a CSV row with no page."""
    title: str
    mtime: str | None
    group: str | None = None
    """Notion: the database key (``database:<csv path>``) or None; Obsidian/Anytype: the
    top-level folder holding the file, or None at the root."""
    fields: dict[str, Any] = field(default_factory=dict)
    """Source key (column header or frontmatter key) -> raw value, in source order."""
    cells: bool = False
    """``fields`` are string cells (a Notion CSV or ``Key: value`` lines)."""
    fm: dict[str, Any] = field(default_factory=dict)
    """The whole frontmatter as parsed (Obsidian/Anytype), for "type from a key"."""
    system: dict[str, Any] = field(default_factory=dict)
    """tags, aliases (lists), description, createdAt, lastUpdated (raw), when the source has them."""
    passthrough: dict[str, Any] = field(default_factory=dict)
    """Nested maps and lists of maps: written as they are under their key, never properties."""
    links: list[PlanLink] = field(default_factory=list)
    hasBody: bool = True
    stripKeys: frozenset[str] = frozenset()
    """Notion row pages: the ``Key: value`` lines under the heading to drop (CSV columns)."""
    badFrontmatter: str | None = None
    """Frontmatter that didn't parse: kept in the body as a ``yaml`` code block."""
    native: str | None = None
    """M25 Files kind: ``"file"`` for a source file that isn't Markdown (read by the readers
    when written, original kept); None for a Markdown page."""
    prov: dict[str, Any] = field(default_factory=dict)
    """M25: provenance the source gives beside the file (a manifest line): system, url, id,
    version, author, created, modified."""


@dataclass
class ReadDatabase:
    key: str
    csvPath: str
    name: str
    headers: list[str]
    """Every column but the title column, in order."""
    titleHeader: str


@dataclass
class ReadResult:
    kind: str
    sourcePath: str
    container: str
    fingerprint: str
    suggestedName: str
    detected: str | None
    objects: list[ReadObject]
    index: SourceIndex
    files: dict[str, int]
    """Every file that isn't a page or a CSV: source path -> size (attachment candidates)."""
    skipped: list[SkippedItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    databases: list[ReadDatabase] = field(default_factory=list)
    frontmatterKeys: dict[str, int] = field(default_factory=dict)
    folders: dict[str, int] = field(default_factory=dict)
    defaultTypeSource: str = "folder"
    defaultTypeKey: str | None = None
    entity_items: Callable[[str, str, bool], list[tuple[str | None, str]]] | None = None
    """(cell or value text, the linking page, cells?) -> [(target source path or None, text)]."""
    leave_out: list[str] = field(default_factory=list)
    """M27: the "Leave out" patterns the source was listed with."""
    left_out: list[str] = field(default_factory=list)
    """M27: source files those patterns matched (never listed, never read)."""


class SourceIndex:
    """Link lookup over a source's file list (no reading)."""

    def __init__(self, pages: list[str], files: list[str], csvs: list[str]) -> None:
        self.pages = set(pages)
        self.files = set(files)
        self.csvs = set(csvs)
        self._pages_ci: dict[str, str] = {}
        self._pages_by_stem: dict[str, list[str]] = {}
        self._files_ci: dict[str, str] = {}
        self._files_by_name: dict[str, list[str]] = {}
        self._ids: dict[str, str] = {}
        for p in sorted(pages, key=_shortest):
            self._pages_ci.setdefault(p[:-3].lower(), p)
            self._pages_by_stem.setdefault(PurePosixPath(p).stem.lower(), []).append(p)
            nid = notion_id(PurePosixPath(p).stem)
            if nid:
                self._ids.setdefault(nid, p)
        for f in sorted(files, key=_shortest):
            self._files_ci.setdefault(f.lower(), f)
            self._files_by_name.setdefault(PurePosixPath(f).name.lower(), []).append(f)
        self.csv_ids = {nid for c in csvs if (nid := notion_id(PurePosixPath(c).stem))}

    # -- pages and files --------------------------------------------------------

    def page(self, target: str, from_page: str | None = None) -> str | None:
        """A wikilink target as a page (Obsidian's rule): exact path, the path ignoring case,
        relative to the linking page, then the file name anywhere (shortest path first)."""
        t = target.strip().lstrip("/")
        if t.lower().endswith(".md"):
            t = t[:-3]
        if not t:
            return None
        if f"{t}.md" in self.pages:
            return f"{t}.md"
        found = self._pages_ci.get(t.lower())
        if found:
            return found
        if from_page and "/" in t:
            rel = _join(from_page, f"{t}.md")
            if rel and rel in self.pages:
                return rel
        name = PurePosixPath(t).name.lower()
        candidates = self._pages_by_stem.get(name, [])
        if "/" in t:
            suffix = "/" + t.lower() + ".md"
            candidates = [c for c in candidates if ("/" + c.lower()).endswith(suffix)]
        if from_page and len(candidates) > 1:
            # Several pages share the name (Books/Dune, Movies/Dune): the one nearest the linking
            # page wins (its own folder, then the deepest shared folder), as Obsidian prefers the
            # linking note's folder; shortest path only breaks the remaining ties.
            here = PurePosixPath(from_page).parent.parts
            candidates = sorted(candidates, key=lambda c: -_shared_depth(here, PurePosixPath(c).parent.parts))
        return candidates[0] if candidates else None

    def file(self, target: str, from_page: str | None = None) -> str | None:
        """An attachment by ``findAttachment``'s rule (exact, ignoring case, then a bare file
        name anywhere, shortest path first), also tried relative to the linking page."""
        t = target.strip().lstrip("/")
        if not t:
            return None
        if from_page:
            rel = _join(from_page, t)
            if rel and rel in self.files:
                return rel
        if t in self.files:
            return t
        found = self._files_ci.get(t.lower())
        if found:
            return found
        if "/" in t:
            return None
        hits = self._files_by_name.get(t.lower())
        return hits[0] if hits else None

    def by_id(self, nid: str | None) -> str | None:
        return self._ids.get(nid) if nid else None

    # -- the hooks ------------------------------------------------------------------

    def resolve_href(self, path: str, from_page: str) -> Resolved:
        """A Markdown link destination (decoded) from ``from_page``."""
        candidates = [c for c in (_join(from_page, path), _norm(path)) if c]
        low = path.lower()
        if low.endswith(".csv"):
            return "database", next((c for c in candidates if c in self.csvs), None)
        if low.endswith(".md"):
            for c in candidates:
                if c in self.pages:
                    return "object", c
            hit = self.by_id(notion_id(PurePosixPath(path).stem))
            if hit:
                return "object", hit
            if notion_id(PurePosixPath(path).stem) in self.csv_ids:
                return "database", None
            return "unresolved", None
        for c in candidates:
            if c in self.files:
                return "attachment", c
        if PurePosixPath(path).suffix:
            return "missing", None
        # A folder or an extensionless name: a page with that name, else nothing to do.
        page = self.page(path, from_page)
        return ("object", page) if page else ("unresolved", None)

    def resolve_wiki(self, target: str, from_page: str) -> Resolved:
        t = target.strip()
        suffix = PurePosixPath(t).suffix.lower()
        if suffix and suffix != ".md":
            f = self.file(t, from_page)
            if f:
                return "attachment", f
        page = self.page(t, from_page)
        if page:
            return "object", page
        return "unresolved", None


def _shared_depth(a: tuple[str, ...], b: tuple[str, ...]) -> int:
    """How many leading folders two paths share."""
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


def _shortest(p: str) -> tuple[int, int, str]:
    return (p.count("/"), len(p), p)


def _norm(path: str) -> str | None:
    """A source path from a root-relative text, or None when it leaves the source."""
    text = path.replace("\\", "/").lstrip("/")
    norm = posixpath.normpath(text) if text else ""
    if not norm or norm == "." or norm.startswith("../") or norm == "..":
        return None
    return norm


def _join(from_page: str, path: str) -> str | None:
    folder = posixpath.dirname(from_page)
    return _norm(posixpath.join(folder, path.replace("\\", "/")))


# -- reading a page's text ------------------------------------------------------------


def read_page_text(src: Any, rel: str, budget: Any, skipped: list[SkippedItem] | None) -> str | None:
    """The text of the Markdown or CSV file ``rel`` (BOM and CRLF understood; bytes that aren't
    UTF-8 replaced), or None when it is skipped (``tooLarge``, ``damaged``, ``emptyFile``;
    listed in ``skipped`` when given). ``budget`` is the read's `TextBudget`."""
    from ..textfile import decode
    from ..typedefs import has_undecodable
    from .source import MAX_TEXT_FILE, SourceDamaged

    def skip(reason: str, detail: str = "") -> None:
        if skipped is not None:
            skipped.append(SkippedItem(path=rel, reason=reason, detail=detail))  # type: ignore[arg-type]

    entry = src.files[rel]
    if entry.size > MAX_TEXT_FILE:
        skip("tooLarge", f"{entry.size:,} bytes (Markdown and CSV files can have 20 MiB)")
        return None
    budget.take(entry.size)
    try:
        data = src.read(rel, MAX_TEXT_FILE)
    except SourceDamaged as exc:
        skip("damaged", str(exc)[:200])
        return None
    text = decode(data).text
    if has_undecodable(text):
        text = re.sub("[\udc80-\udcff]", "�", text)
        skip("notUtf8", "Imported with the bytes that aren't UTF-8 replaced")
    if not text.strip():
        skip("emptyFile")
        return None
    return text
