"""The Files source kind (M25, design sections 3-4): a folder of mixed files, such as an export
or a synced library, with an optional ``_manifest.jsonl`` beside them.

Markdown pages are read with the Obsidian rules (links, attachments, frontmatter); every other
file is one object (``ReadObject.native == "file"``) whose readable page the writer makes when
it writes (`file_page`): through ``objectapp.readers.read_file`` when that module exists, else,
or when the reader fails or says ``original_only``, an "Original only" page with the original as
a media/file block. The original is always kept (`writer`), so nothing is lost.

The manifest has one JSON object per line::

    {"path": "Runbooks/DNS.docx", "system": "sharepoint", "url": "...", "id": "...", "version": "7.0",
     "author": "...", "created": "...", "modified": "...", "fields": {"Owner": "...", "Environment": "Prod"}}

``fields`` are read like frontmatter (each becomes a planned property the mapping step can name,
type or skip); the other keys fill ``importSource``. Lines that aren't JSON objects, or name a
file that isn't in the source, are listed as warnings.
"""

from __future__ import annotations

import json
import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from .obsidian import read_markdown_folder
from .readmodel import ReadObject, ReadResult
from .source import Source, TextBudget, is_markdown

__all__ = ["MANIFEST_NAME", "FilePage", "file_page", "read_files", "read_manifest"]

_log = logging.getLogger(__name__)

MANIFEST_NAME = "_manifest.jsonl"
_PROV_KEYS = ("system", "url", "id", "version", "author", "created", "modified")
TEXT_SUFFIXES = (".txt",)
MAX_MANIFEST = 20 * 1024 * 1024


def read_manifest(src: Source) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """(path -> entry, warnings) from the root ``_manifest.jsonl`` (empty when there is none)."""
    entry = src.files.get(MANIFEST_NAME)
    if entry is None:
        return {}, []
    out: dict[str, dict[str, Any]] = {}
    warnings: list[str] = []
    try:
        data = src.read(MANIFEST_NAME, MAX_MANIFEST)
    except OSError as exc:
        return {}, [f"The manifest couldn't be read: {str(exc)[:200]}"]
    bad = unknown = 0
    for line in data.decode("utf-8", "replace").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except ValueError:
            bad += 1
            continue
        path = item.get("path") if isinstance(item, dict) else None
        if not isinstance(path, str) or not path.strip():
            bad += 1
            continue
        out[path.replace("\\", "/").lstrip("/")] = item
    if bad:
        warnings.append(f"{bad} manifest line{'s' if bad != 1 else ''} couldn't be read and were ignored.")
    for p in out:
        if p not in src.files:
            unknown += 1
    if unknown:
        warnings.append(f"{unknown} manifest entr{'ies name' if unknown != 1 else 'y names'} a file that isn't in the source.")
    return out, warnings


def _prov_of(item: dict[str, Any]) -> dict[str, Any]:
    return {k: str(item[k]).strip() for k in _PROV_KEYS if item.get(k) not in (None, "") and str(item[k]).strip()}


def _fields_of(item: dict[str, Any]) -> dict[str, Any]:
    f = item.get("fields")
    if not isinstance(f, dict):
        return {}
    out: dict[str, Any] = {}
    for k, v in f.items():
        if not isinstance(k, str) or not k.strip() or isinstance(v, (dict, list)) or v is None:
            continue
        out[k] = v if isinstance(v, str) else str(v)
    return out


def read_files(src: Source, *, detected: str | None, suggested: str, budget: TextBudget) -> ReadResult:
    manifest, warnings = read_manifest(src)
    read = read_markdown_folder(
        src, kind="files", detected=detected, suggested=suggested, budget=budget, inline_tags=False
    )
    read.defaultTypeSource = "none"
    read.warnings.extend(warnings)
    read.files.pop(MANIFEST_NAME, None)
    for o in read.objects:  # Markdown pages: the manifest adds provenance and fields
        item = manifest.get(o.sourcePath)
        if item is not None:
            o.prov = _prov_of(item)
            for k, v in _fields_of(item).items():
                o.fields.setdefault(k, v)
    pages = {o.sourcePath for o in read.objects}
    for rel in sorted(read.files, key=lambda p: (p.lower(), p)):
        if rel in pages:
            continue
        item = manifest.get(rel, {})
        prov = _prov_of(item)
        system: dict[str, Any] = {}
        if prov.get("created"):
            system["createdAt"] = prov["created"]
        if prov.get("modified"):
            system["lastUpdated"] = prov["modified"]
        parts = rel.split("/")
        read.objects.append(
            ReadObject(
                sourcePath=rel,
                title=PurePosixPath(rel).stem or rel,
                mtime=src.files[rel].mtime_iso,
                group=parts[0] if len(parts) > 1 else None,
                fields=_fields_of(item),
                cells=True,
                system=system,
                native="file",
                prov=prov,
            )
        )
    read.objects.sort(key=lambda o: (o.sourcePath.lower(), o.sourcePath))
    return read


# -- the readable page of one file (called by the writer) --------------------------------------


@dataclass
class FilePage:
    markdown: str
    """The page body (images already pointing at ``image_names`` placeholders)."""
    images: list[Any] = field(default_factory=list)
    """Objects with ``.name`` and ``.data`` (the reader's extracted images)."""
    notes: list[str] = field(default_factory=list)
    original_only: bool = False
    created: str | None = None
    modified: str | None = None
    author: str | None = None
    title: str | None = None


def _load_readers() -> Any:
    try:
        import importlib

        return importlib.import_module("objectapp.readers")  # M26; absent until it lands
    except Exception:  # noqa: BLE001 - any import failure means "no readers"
        return None


def file_page(name: str, data: bytes) -> FilePage:
    """What the readers make of the file ``name`` with these bytes; an "Original only" result
    when there is no reader, it fails, or it says so."""
    suffix = PurePosixPath(name).suffix.lower()
    if suffix in TEXT_SUFFIXES:
        from ..textfile import decode

        return FilePage(markdown=decode(data).text)
    readers = _load_readers()
    if readers is None:
        return FilePage(markdown="", original_only=True, notes=["No reader for this format: original only"])
    safe = "file" + suffix
    try:
        with tempfile.TemporaryDirectory(prefix="object-import-") as tmp:
            path = Path(tmp) / safe
            path.write_bytes(data)
            r = readers.read_file(path)
    except Exception as exc:  # noqa: BLE001 - a reader may fail on any bytes
        _log.info("Reader failed for %s: %s", name, exc)
        return FilePage(markdown="", original_only=True, notes=[f"Couldn't be read ({type(exc).__name__}): original only"])
    if getattr(r, "original_only", False):
        return FilePage(
            markdown="", original_only=True, notes=[*list(getattr(r, "notes", []) or []), "Original only"],
            created=getattr(r, "created", None), modified=getattr(r, "modified", None), author=getattr(r, "author", None),
        )
    return FilePage(
        markdown=str(getattr(r, "markdown", "") or ""),
        images=list(getattr(r, "images", []) or []),
        notes=[str(n) for n in (getattr(r, "notes", []) or [])],
        created=getattr(r, "created", None),
        modified=getattr(r, "modified", None),
        author=getattr(r, "author", None),
        title=getattr(r, "title", None) or None,
    )


def is_native(rel: str) -> bool:
    return not is_markdown(rel)
