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
    "index_space",
    "read_block",
    "system_of",
]

BLOCK_KEY = "importSource"
SYSTEMS = ("sharepoint", "notion", "wiki", "obsidian", "anytype", "files", "markdown")
_ORDER = ("system", "url", "id", "version", "author", "created", "modified", "original", "contentHash", "batch", "importedAt")


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


def ident(read: ReadResult, o: ReadObject) -> tuple[str, str]:
    """(system, id) of a source item: what a re-run matches on. Needs no file bytes."""
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
    p = Prov(system=system, id=ident_)
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


def index_space(space: Space) -> dict[tuple[str, str], Existing]:
    """Every object of ``space`` that carries an ``importSource`` block, by (system, id).

    Read from the space's in-memory raw objects (no file is read here)."""
    out: dict[tuple[str, str], Existing] = {}
    with space._lock:
        raws = list(space._raw.values())
    for raw in raws:
        b = read_block(raw.fm)
        if b is not None:
            out.setdefault((str(b["system"]), str(b["id"])), Existing(raw.path, dict(b)))
    return out
