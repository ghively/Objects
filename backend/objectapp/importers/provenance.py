"""Provenance (M25, design section 1): the ``importSource`` frontmatter block every imported
object carries, and the lookup a re-run uses to match source items to earlier imports.

``importSource`` is a nested map in the object's frontmatter (a system field, not a type
property)::

    importSource:
      system: obsidian
      url: file:///.../Vault/Note.md
      id: Note.md
      version: sha256:...
      author: ...
      created: ...
      modified: ...
      original: Attachments/Originals/Runbook.docx
      contentHash: sha256:...
      batch: 01JC...
      importedAt: 2026-11-06T16:00:00.000Z

Nothing here reads or writes a file; the writer places the block and a re-run reads it back.
"""

from __future__ import annotations

import hashlib
import os
from urllib.parse import urlsplit
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any

from .readmodel import ReadObject, ReadResult, notion_id

if TYPE_CHECKING:
    from ..space import Space

__all__ = [
    "BLOCK_KEY",
    "SYSTEMS",
    "Existing",
    "Prov",
    "block",
    "hash_bytes",
    "ident",
    "duplicates",
    "find",
    "index_space",
    "scope",
    "read_block",
    "system_of",
]

BLOCK_KEY = "importSource"
SYSTEMS = ("sharepoint", "notion", "wiki", "obsidian", "anytype", "files", "markdown")
_ORDER = ("system", "url", "id", "source", "version", "author", "created", "modified", "original", "contentHash", "batch", "importedAt")


def hash_bytes(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


@dataclass
class Prov:
    system: str
    id: str
    url: str | None = None
    version: str | None = None
    author: str | None = None
    created: str | None = None
    modified: str | None = None
    original: str | None = None
    contentHash: str | None = None
    source: str | None = None
    """Which source the id belongs to (ids that are paths mean nothing across two sources)."""
    extra: dict[str, Any] = field(default_factory=dict)


def system_of(read: ReadResult, o: ReadObject | None = None) -> str:
    """The ``system`` value for a source: the manifest's own for a Files item, else by kind."""
    if o is not None and o.prov.get("system") in SYSTEMS:
        return str(o.prov["system"])
    if read.kind == "notion":
        return "notion"
    if read.kind == "anytype":
        return "anytype"
    if read.kind == "files":
        return "files"
    return "obsidian" if read.detected == "obsidian" else "markdown"


def _raw_ident(read: ReadResult, o: ReadObject) -> tuple[str, str]:
    system = system_of(read, o)
    manifest_id = o.prov.get("id")
    if manifest_id:
        return system, str(manifest_id)
    if read.kind == "notion":
        nid = notion_id(PurePosixPath(o.sourcePath.split("#", 1)[0]).stem)
        if nid:
            return system, nid
    if read.kind == "anytype":
        oid = o.fm.get("id") or o.fm.get("Id") or o.fm.get("objectId")
        if isinstance(oid, (str, int)) and str(oid).strip():
            return system, str(oid).strip()
    return system, o.sourcePath


def duplicates(read: ReadResult) -> dict[str, tuple[str, str, int]]:
    """Source paths whose id repeats an earlier item's in the same source: path -> (id as the source
    writes it, the path of the first item, its number from 2). Such an item gets ``<id>#<n>`` as its
    id, so each can be matched on a re-run and none collapses into another."""
    cached = read.__dict__.get("_dup_ids")
    if cached is not None and cached[0] == len(read.objects):
        return cached[1]
    first: dict[tuple[str, str], str] = {}
    seen: dict[tuple[str, str], int] = {}
    out: dict[str, tuple[str, str, int]] = {}
    for o in read.objects:
        key = _raw_ident(read, o)
        if key in first:
            seen[key] = seen.get(key, 1) + 1
            out[o.sourcePath] = (key[1], first[key], seen[key])
        else:
            first[key] = o.sourcePath
    read.__dict__["_dup_ids"] = (len(read.objects), out)
    return out


def ident(read: ReadResult, o: ReadObject) -> tuple[str, str]:
    """(system, id) of a source item: what a re-run matches on (with `scope`). Needs no file bytes."""
    system, ident_ = _raw_ident(read, o)
    dup = duplicates(read).get(o.sourcePath)
    if dup is not None:
        ident_ = f"{ident_}#{dup[2]}"
    return system, ident_


def scope(read: ReadResult, o: ReadObject) -> str | None:
    """Which source an item's id belongs to, or None when the id is global (Notion and Anytype ids,
    stable across exports). A manifest id belongs to its site (the url's origin) when it has a url;
    a path-like id to the source folder or zip."""
    if o.prov.get("id"):
        url = str(o.prov.get("url") or "")
        parts = urlsplit(url)
        if parts.scheme in ("http", "https") and parts.netloc:
            return f"{parts.scheme}://{parts.netloc.lower()}"
    elif (read.kind == "notion" and _raw_ident(read, o)[1] != o.sourcePath) or (
        read.kind == "anytype" and _raw_ident(read, o)[1] != o.sourcePath
    ):
        return None
    return os.path.normcase(os.path.normpath(str(read.sourcePath)))


def _file_url(read: ReadResult, rel: str) -> str | None:
    if read.container != "folder":
        return None
    try:
        return (Path(read.sourcePath) / rel).resolve().as_uri()
    except (OSError, ValueError):
        return None


def prov_for(read: ReadResult, o: ReadObject, data: bytes | None, original: str | None = None) -> Prov:
    """The provenance of ``o`` (design section 1's table). ``data`` is the bytes of the source
    file (its hash is ``contentHash``); ``original`` the kept original's space path."""
    system, ident_ = ident(read, o)
    m = o.prov
    p = Prov(system=system, id=ident_, source=scope(read, o))
    p.contentHash = hash_bytes(data) if data is not None else None
    p.url = m.get("url") or None
    p.version = m.get("version") or None
    p.author = m.get("author") or None
    p.created = m.get("created") or None
    p.modified = m.get("modified") or None
    p.original = original
    if read.kind == "notion":
        nid = notion_id(PurePosixPath(o.sourcePath.split("#", 1)[0]).stem)
        if p.url is None and nid and not m:
            p.url = f"https://www.notion.so/{nid}"
        p.created = p.created or _text(o.system.get("createdAt"))
        p.modified = p.modified or _text(o.system.get("lastUpdated"))
    elif read.kind == "anytype":
        p.created = p.created or _text(o.system.get("createdAt")) or _text(o.fm.get("createdAt"))
        p.modified = p.modified or _text(o.system.get("lastUpdated")) or _text(o.fm.get("lastUpdated"))
    else:  # Obsidian, plain Markdown folders, Files
        if p.url is None:
            p.url = _file_url(read, o.sourcePath)
        if p.version is None:
            p.version = p.contentHash
        p.modified = p.modified or o.mtime
        p.created = p.created or _text(o.system.get("createdAt"))
    return p


def _text(v: Any) -> str | None:
    return v.strip() if isinstance(v, str) and v.strip() else None


def block(p: Prov, batch: str, imported_at: str) -> dict[str, Any]:
    """The block as an ordered map (absent values left out)."""
    values = {**p.__dict__, "batch": batch, "importedAt": imported_at}
    out: dict[str, Any] = {}
    for key in _ORDER:
        v = values.get(key)
        if v not in (None, ""):
            out[key] = v
    return out


def read_block(fm: dict[str, Any]) -> dict[str, Any] | None:
    b = fm.get(BLOCK_KEY)
    return b if isinstance(b, dict) and b.get("system") and b.get("id") is not None else None


@dataclass
class Existing:
    path: str
    block: dict[str, Any]


def index_space(space: Space) -> dict[tuple[str, str], list[Existing]]:
    """Every object of ``space`` that carries an ``importSource`` block, by (system, id).

    Several sources can share an id (two vaults with ``Notes/Meeting.md``), so each key keeps all of
    them; `find` picks the one from the right source. Read from the space's in-memory raw objects."""
    out: dict[tuple[str, str], list[Existing]] = {}
    with space._lock:
        raws = sorted(space._raw.values(), key=lambda r: r.path)
    for raw in raws:
        b = read_block(raw.fm)
        if b is not None:
            out.setdefault((str(b["system"]), str(b["id"])), []).append(Existing(raw.path, dict(b)))
    return out


def find(index: dict[tuple[str, str], list[Existing]], read: ReadResult, o: ReadObject) -> Existing | None:
    """The earlier object made from ``o``: same system and id, and the same source (a block with no
    source, written before sources were recorded, or a global id, matches any)."""
    here = scope(read, o)
    for hit in index.get(ident(read, o), []):
        there = hit.block.get("source")
        if here is None or there is None or os.path.normcase(os.path.normpath(str(there))) == here or there == here:
            return hit
    return None
