"""The Obsidian vault reader (also a plain Markdown folder's, and Anytype's: see `anytype`).

Each ``.md`` file is an object. Its frontmatter fills the system fields (``title``,
``tags``/``tag``, ``aliases``/``alias``, ``description``, in any case: ``Tags:`` too); the display-only keys
(``cssclasses``, ``cssclass``, ``publish``, ``permalink``) are dropped and listed once each
(``appSettings``); nested maps and lists of maps are kept as they are under their key; every
other key is a property of the object's type. Inline ``#tags`` outside code also become tags
(the text stays as written). The title is frontmatter ``title``, else the file stem. Links and
embeds are resolved here (``markdown.convert``, the source's `SourceIndex`); the mapping step
decides the types (top-level folders by default). ``.canvas`` files are skipped
(``unsupported``).

M31 (remodelling a space): when the folder is an Object space (`Source.is_space`) each page's
``type`` names its type (``typeSource: key``, ``typeKey: type``, as for Anytype), ``createdAt`` and
``lastUpdated`` are its dates, and Object's own ``id``, ``template`` and ``importSource`` are left out
(the new space gives each object its own id and provenance). Every other key is read as above.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any

from ..frontmatter import FrontmatterError, parse_fm
from ..objfile import split_object
from . import markdown
from .model import SkippedItem
from .readmodel import ReadObject, ReadResult, SourceIndex, read_page_text
from .source import Source, TextBudget, is_markdown

__all__ = ["DISPLAY_KEYS", "HTML_WARNING", "read_markdown_folder", "split_list"]

DISPLAY_KEYS = ("cssclasses", "cssclass", "publish", "permalink")
HTML_WARNING = "Some pages hold HTML (toggles, tables); it is imported as written."
NESTED_WARNING = "Some frontmatter values are nested lists or maps; they are kept as written and don't become properties."

SPACE_DROPPED = ("id", "template", "importSource")
"""M31: an Object space's own bookkeeping keys, not carried into the space it is remodelled into."""
SPACE_DATES = ("createdAt", "lastUpdated")

_SYSTEM_SOURCES = {
    "title": "title",
    "tags": "tags",
    "tag": "tags",
    "aliases": "aliases",
    "alias": "aliases",
    "description": "description",
}


def split_list(value: Any, strip_hash: bool = False) -> list[str]:
    """A list or a comma-separated text as clean texts (``#`` dropped for tags)."""
    items = value if isinstance(value, list) else [value]
    out: list[str] = []
    for item in items:
        if item is None or isinstance(item, (dict, list)):
            continue
        for part in str(item).split(","):
            text = " ".join(part.split())
            if strip_hash:
                text = text.lstrip("#").strip()
            if text and text not in out:
                out.append(text)
    return out


_MAX_TYPE_FILE = 1 << 20


def space_plurals(root: Path) -> dict[str, str]:
    """M31: an Object space's type names (casefolded) -> plural names, read from its
    ``.object/types/*.json`` (read only; a file that isn't a type, a link, or one over 1 MiB is
    passed over)."""
    out: dict[str, str] = {}
    folder = root / ".object" / "types"
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        return out
    for name in names:
        p = folder / name
        try:
            if not name.endswith(".json") or p.is_symlink() or not p.is_file() or p.stat().st_size > _MAX_TYPE_FILE:
                continue
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and isinstance(data.get("name"), str) and isinstance(data.get("pluralName"), str):
            if data["name"].strip() and data["pluralName"].strip():
                out.setdefault(data["name"].strip().casefold(), data["pluralName"].strip())
    return out


def _nested(value: Any) -> bool:
    return isinstance(value, dict) or (isinstance(value, list) and any(isinstance(v, (dict, list)) for v in value))


def read_markdown_folder(
    src: Source,
    *,
    kind: str,
    detected: str | None,
    suggested: str,
    budget: TextBudget,
    inline_tags: bool = True,
) -> ReadResult:
    """Read every Markdown file of ``src`` (Obsidian's rules)."""
    space = bool(getattr(src, "is_space", False))
    pages = [rel for rel in src.files if is_markdown(rel)]
    others = [rel for rel in src.files if not is_markdown(rel)]
    skipped: list[SkippedItem] = list(src.skipped)
    files: dict[str, int] = {}
    for rel in others:
        if PurePosixPath(rel).suffix.lower() == ".canvas":
            skipped.append(SkippedItem(path=rel, reason="unsupported", detail="Canvas"))
            continue
        files[rel] = src.files[rel].size
    index = SourceIndex(pages, list(files), [])
    hooks = markdown.Hooks(index.resolve_href, index.resolve_wiki)
    objects: list[ReadObject] = []
    fm_keys: Counter[str] = Counter()
    folders: Counter[str] = Counter()
    display: dict[str, list[str]] = {}
    warnings: list[str] = []
    html = nested = False
    for rel in sorted(pages, key=lambda p: (p.lower(), p)):
        text = read_page_text(src, rel, budget, skipped)
        if text is None:
            continue
        of = split_object(text)
        fm: dict[str, Any] = {}
        bad: str | None = None
        body = of.body
        if of.frontmatter_src is not None:
            try:
                fm = parse_fm(of.frontmatter_src)
            except FrontmatterError:
                bad = of.frontmatter_src
        elif not of.fm_ok:
            skipped.append(SkippedItem(path=rel, reason="damaged", detail="The frontmatter has no closing ---; it is kept in the body"))
        system: dict[str, Any] = {}
        fields: dict[str, Any] = {}
        passthrough: dict[str, Any] = {}
        for key, value in fm.items():
            if not isinstance(key, str):
                key = str(key)
            if space and key in SPACE_DROPPED:
                continue
            if space and key in SPACE_DATES:
                if isinstance(value, str) and value.strip():
                    system[key] = value.strip()
                continue
            fm_keys[key] += 1
            low = key.lower()
            if low in DISPLAY_KEYS:
                display.setdefault(key, []).append(rel)
                continue
            target = _SYSTEM_SOURCES.get(low)  # Obsidian reads these names ignoring case
            if target == "title":
                if isinstance(value, (str, int, float)) and str(value).strip():
                    system["title"] = " ".join(str(value).split())
                continue
            if target in ("tags", "aliases"):
                system.setdefault(target, [])
                for t in split_list(value, strip_hash=target == "tags"):
                    if t not in system[target]:
                        system[target].append(t)
                continue
            if target == "description":
                if value is not None and not isinstance(value, (dict, list)):
                    system["description"] = str(value)
                continue
            if _nested(value):
                passthrough[key] = value
                nested = True
                continue
            fields[key] = value
        conv = markdown.convert(body, rel, hooks)
        html = html or conv.html
        if inline_tags:
            for t in markdown.inline_tags(body):
                tags = system.setdefault("tags", [])
                if t not in tags:
                    tags.append(t)
        parts = rel.split("/")
        group = parts[0] if len(parts) > 1 else None
        if group:
            folders[group] += 1
        title = system.pop("title", None) or PurePosixPath(rel).stem
        objects.append(
            ReadObject(
                sourcePath=rel,
                title=title,
                mtime=src.files[rel].mtime_iso,
                group=group,
                fields=fields,
                cells=False,
                fm=fm,
                system=system,
                passthrough=passthrough,
                links=conv.links,
                badFrontmatter=bad,
            )
        )
    for key, used in display.items():
        skipped.append(
            SkippedItem(
                path=used[0],
                reason="appSettings",
                detail=f"{key}: a display setting, dropped from {len(used)} file{'s' if len(used) != 1 else ''}",
            )
        )
    if html:
        warnings.append(HTML_WARNING)
    if nested:
        warnings.append(NESTED_WARNING)

    def entity_items(text: str, page: str, cells: bool) -> list[tuple[str | None, str]]:
        t = text.strip()
        if t.startswith("[[") and t.endswith("]]"):
            inner = t[2:-2]
            target, _, _alias = inner.partition("|")
            target = target.split("#", 1)[0].strip()
            return [(index.page(target, page), target)]
        return [(None, t)]

    return ReadResult(
        kind=kind,
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
        frontmatterKeys=dict(fm_keys),
        folders=dict(folders),
        defaultTypeSource="key" if space else "folder",
        defaultTypeKey="type" if space else None,
        entity_items=entity_items,
        space_plurals=space_plurals(Path(src.path)) if space else None,
    )
