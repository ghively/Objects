"""The common writer: a `Planned` import written into a space, only ever adding files.

Phases (contract "Import API"): ``preparing`` (the source re-opened and its fingerprint
checked), ``types`` (new types made with `Space.create_type`; properties and label options
added with `Space.save_type`; Tag objects made or reused with `Space.ensure_tag`),
``attachments`` (each copied to its planned ``Attachments/`` name with `create_new`, the next
free `` (n)`` name if it was taken meanwhile), ``objects`` (each source file read again and
converted with the plan's link table, then placed with `Space.place_new`, which never
overwrites) and ``report`` (the "Import report" `Page`).

Nothing written is ever removed: a cancel stops after the file being written and a failure
stops where it happened; the report is still written. A file that can't be written (a name
the file system refuses, permissions) is skipped and listed; the import goes on. New files
are LF without a BOM, as `Space.create_object` writes them; no template is applied.

M30 "Keep pages as Sources" (`WriteState.keep_as_sources`, recorded in ``batch.json``): the types
phase ensures the Source type (`sources.ensure_source_type`); each page is written as a Source
whose body is the page's own bytes after its frontmatter (BOM and line endings kept; nothing
converted or linked), with its Category and System. A re-run updates an imported Source inside
``Space.source_writes()``, keeping the previous bytes in version history.

Nothing is announced per object or type: an import can write thousands of files, so the
caller announces one resync when the job ends (`WriteState.wrote_anything`).
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
import logging
import os
import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any

from ..frontmatter import FlowList, set_keys
from ..ids import new_ulid
from ..media import (
    MAX_ATTACHMENT_BYTES,
    _safe_attachment_name,
    attachment_media_type,
    kind_of,
)
from ..objfile import ObjectFile, join_object, split_object
from ..space import InvalidValue, now_stamp, safe_filename, unique_path, yaml_single_quoted
from ..textfile import atomic_write, create_new
from ..whiteboardfile import BOARD_SUFFIX, INK_SUFFIX
from . import batches, markdown, provenance
from .files import FilePage, file_page
from .model import ImportResult, SkippedItem
from .notion import page_heading, split_property_lines
from .planner import SOURCE_KEY, Planned
from .readmodel import read_page_text
from .report import REPORT_TITLE, build_report
from .sources import SOURCE_TYPE_ID, category_for, ensure_source_type, is_imported_source, system_label
from .source import (
    MAX_TEXT_FILE,
    LimitExceeded,
    NotASource,
    Source,
    SourceDamaged,
    SourceMissing,
    TextBudget,
    open_source,
)

if TYPE_CHECKING:
    from ..space import Space

__all__ = ["Cancelled", "SourceChanged", "WriteState", "open_checked", "write_import"]

_log = logging.getLogger(__name__)


class Cancelled(Exception):
    pass


class SourceChanged(Exception):
    """The source's fingerprint no longer matches the preview's (409), or it can't be read."""


@dataclass
class WriteState:
    """Progress and what was written so far (read by the job)."""

    progress: Callable[[str, int, int, str | None], None] = lambda *_a: None
    cancelled: Callable[[], bool] = lambda: False
    done: int = 0
    total: int = 0
    objects: int = 0
    types: int = 0
    attachments: int = 0
    tags: int = 0
    skipped: list[SkippedItem] = field(default_factory=list)
    written: dict[str, str] = field(default_factory=dict)
    """Object source path -> the space path it was written to."""
    attachment_paths: dict[str, str] = field(default_factory=dict)
    type_names: dict[str, str] = field(default_factory=dict)
    """Plan type key -> the name of the type its objects got."""
    stopped: str | None = None
    report_path: str | None = None
    # -- M25: provenance, originals, re-runs, batch records --
    keep_originals: str = "attachments"
    """``attachments`` or ``fileObjects`` (design section 2)."""
    batch: str = ""
    imported_at: str = ""
    prior: batches.Prior = field(default_factory=batches.Prior)
    moved_from: list[str] = field(default_factory=list)
    """Paths the source had before it moved, found on the objects this run matched (`_moved_sources`)."""
    items: list[dict[str, Any]] = field(default_factory=list)
    """The batch records' per-item entries."""
    updated: int = 0
    unchanged: int = 0
    processed: int = 0
    failed_objects: list[str] = field(default_factory=list)
    conflicts: list[dict[str, Any]] = field(default_factory=list)
    removed: list[dict[str, Any]] = field(default_factory=list)
    losses: list[tuple[str, str]] = field(default_factory=list)
    """(source path, what the conversion lost or couldn't do)."""
    originals_kept: int = 0
    originals_large: list[str] = field(default_factory=list)
    attachment_records: dict[str, dict[str, str]] = field(default_factory=dict)
    pending: dict[str, bytes] = field(default_factory=dict)
    taken: dict[str, set[str]] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)
    report_body: str = ""
    # -- M27: the scan's choices --
    file_index: Any = None
    """Provenance index of the space for File objects (made on first use)."""
    exclude_ai: set[str] = field(default_factory=set)
    """Source paths written with ``excludeFromAI: true``."""
    left_out_files: list[str] = field(default_factory=list)
    """Source paths left out (by pattern or by choice): never read or imported."""
    images: int = 0
    """Image objects this run created (AC-2)."""
    # -- M30: Keep pages as Sources --
    keep_as_sources: bool = False
    """The option's resolved value (`sources.keep_as_sources`), recorded in ``batch.json``."""

    @property
    def wrote_anything(self) -> bool:
        """Whether any file was written (an object, a type, an attachment, a tag, the report)."""
        return bool(self.objects or self.types or self.attachments or self.tags or self.report_path or self.updated)


def _check(state: WriteState) -> None:
    if state.cancelled():
        raise Cancelled()


def _step(state: WriteState, phase: str, current: str | None) -> None:
    state.done += 1
    state.progress(phase, state.done, state.total, current)


def open_checked(planned: Planned) -> Source:
    """The source opened again, still what was previewed; raises `SourceChanged` otherwise
    (call it before making anything, so a source gone meanwhile leaves nothing behind)."""
    try:
        src = open_source(planned.plan.sourcePath)
    except (SourceMissing, NotASource, LimitExceeded) as exc:
        raise SourceChanged("The source can't be read any more. Preview it again.") from exc
    if src.fingerprint != planned.plan.fingerprint:
        src.close()
        raise SourceChanged("The source changed since the preview. Preview it again.")
    return src


def _moved_sources(planned: Planned, space: Space) -> list[str]:
    """The sources recorded on the objects this run matched that are not the run's source: the
    source folder or zip moved there from (Gene, 2026-11-08; `provenance.source_moved`), in the
    order met. Their batches are this source's too, and the report says the source moved."""
    here = planned.plan.sourcePath
    out: list[str] = []
    for w in planned.writes:
        if not w.existing:
            continue
        with space._lock:
            raw = space._raw.get(w.existing)
        block = provenance.read_block(raw.fm) if raw is not None else None
        there = block.get("source") if block is not None else None
        if isinstance(there, str) and there not in out and provenance.source_moved(there, here):
            out.append(there)
    return out


def write_import(planned: Planned, space: Space, state: WriteState, src: Source | None = None) -> ImportResult:
    """Write ``planned`` into ``space`` from ``src`` (`open_checked`; opened here when None,
    raising `SourceChanged` before writing anything) and close it; always writes the report
    and answers the result."""
    state.total = len(planned.plan.attachments) + len(planned.writes) + 1
    state.progress("preparing", 0, state.total, None)
    if src is None:
        src = open_checked(planned)
    state.batch = state.batch or new_ulid()
    state.imported_at = now_stamp()
    started = state.imported_at
    state.moved_from = _moved_sources(planned, space)
    state.prior = batches.load_prior(space.root, planned.plan.sourcePath, also=state.moved_from)
    try:
        try:
            _types(planned, space, state)
            _attachments(planned, space, state, src)
            _objects(planned, space, state, src)
            if not state.stopped:
                _removed_at_source(planned, space, state)
        except Cancelled:
            state.stopped = "it was stopped"
        except Exception as exc:  # noqa: BLE001 - the report says what was written
            _log.exception("Import into %s failed", space.root)
            state.stopped = f"an error occurred ({type(exc).__name__}: {str(exc)[:200]})"
    finally:
        src.close()
    state.progress("report", state.done, state.total, None)
    _count(planned, state)
    try:
        _report(planned, space, state)
    except Exception:  # noqa: BLE001
        _log.exception("Could not write the import report")
    try:
        _records(planned, space, state, started)
    except Exception:  # noqa: BLE001
        _log.exception("Could not write the batch records")
    state.done = state.total
    c = state.counts
    return ImportResult(
        targetPath=str(space.root),
        spaceName=space.name,
        objects=state.objects,
        types=state.types,
        attachments=state.attachments,
        tags=state.tags,
        skipped=len(planned.plan.skipped) + len(state.skipped),
        reportPath=state.report_path,
        cancelled=state.stopped == "it was stopped",
        batch=state.batch,
        updated=state.updated,
        unchanged=state.unchanged,
        changedInBoth=len(state.conflicts),
        removed=len(state.removed),
        leftOut=c.get("leftOut", 0),
        failed=c.get("failed", 0),
        notWritten=c.get("notWritten", 0) if state.stopped else 0,
        originals=state.originals_kept,
        sourceItems=c.get("sourceItems", 0),
    )


# -- types and tags --------------------------------------------------------------------


def _types(planned: Planned, space: Space, state: WriteState) -> None:
    state.progress("types", state.done, state.total, None)
    used = {w.obj.typeKey for w in planned.writes}
    databases = {pt.key for pt in planned.plan.types if pt.origin == "database"}
    for pt in planned.plan.types:
        _check(state)
        if pt.skip or (pt.key not in used and pt.key not in databases):
            continue
        tw = planned.type_writes[pt.key]
        if pt.key == SOURCE_KEY:  # M30: the space's Source type, made once when it has none
            had = space.type_by_id(SOURCE_TYPE_ID) is not None
            st = space.type_by_id(ensure_source_type(space))
            state.type_names[pt.key] = st.name if st is not None else tw.name
            state.types += 0 if had else 1
            continue
        if tw.existingTypeId is None and tw.basic:
            state.type_names[pt.key] = tw.name  # the space's own Page type
            continue
        if tw.existingTypeId is None:
            name, n = tw.name, 2
            while True:
                try:
                    t = space.create_type(name, tw.pluralName)
                    break
                except Exception as exc:  # InvalidValue: the name was taken meanwhile
                    if "already exists" not in str(exc) or n > 100:
                        raise
                    name, n = f"{tw.name} ({n})", n + 1
            state.types += 1
            state.type_names[pt.key] = t.name
            if tw.new_props:
                _save_props(space, t.id, tw.new_props, {})
            continue
        t = space.type_by_id(tw.existingTypeId)
        if t is None:
            raise KeyError(tw.existingTypeId)
        state.type_names[pt.key] = t.name
        if (tw.new_props or tw.add_options) and not t.basic:
            _save_props(space, t.id, tw.new_props, _option_pdefs(planned, pt.key))
            state.types += 1
    for tag in planned.tags:
        _check(state)
        try:
            _path, created = space.ensure_tag(tag)
        except Exception:  # noqa: BLE001 - a tag that can't be made is listed
            state.skipped.append(SkippedItem(path=tag, reason="damaged", detail="The tag couldn't be made"))
            continue
        if created:
            state.tags += 1


def _option_pdefs(planned: Planned, type_key: str) -> dict[str, Any]:
    tw = planned.type_writes[type_key]
    out: dict[str, Any] = {}
    for key in tw.add_options:
        pdef = planned.pdefs.get((type_key, key))
        if pdef is not None:
            out[key] = pdef
    return out


def _save_props(space: Space, type_id: str, new_props: list[Any], replace: dict[str, Any]) -> None:
    current, revision = space.refresh_type(type_id)
    if current is None:
        raise KeyError(type_id)
    edited = copy.deepcopy(current)
    have = {p.key for p in edited.propertyDefinitions}
    defs = []
    for p in edited.propertyDefinitions:
        defs.append(copy.deepcopy(replace[p.key]) if p.key in replace else p)
    for p in new_props:
        if p.key not in have:
            defs.append(copy.deepcopy(p))
    edited.propertyDefinitions = defs
    space.save_type(edited, revision)


# -- attachments -----------------------------------------------------------------------


def _names_in(folder: os.PathLike[str] | str) -> set[str]:
    """The lower-cased names in ``folder`` (empty when it doesn't exist yet)."""
    try:
        return {n.lower() for n in os.listdir(folder)}
    except FileNotFoundError:
        return set()


def _put(state: WriteState, folder: Path, name: str, data: bytes) -> str:
    """Write ``data`` into ``folder`` as ``name`` (the next free `` (n)`` name when it is taken);
    never overwrites. Returns the name written. Raises `OSError` when it can't be written."""
    folder.mkdir(parents=True, exist_ok=True)
    taken = state.taken.get(str(folder))
    if taken is None:
        taken = state.taken[str(folder)] = _names_in(folder)  # listed once; a name taken meanwhile fails `create_new`
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    n = 1
    while n <= 10_000:
        candidate = name if n == 1 else (f"{stem} ({n}).{ext}" if ext else f"{stem} ({n})")
        n += 1
        if candidate.lower() in taken:
            continue
        taken.add(candidate.lower())
        try:
            create_new(folder / candidate, data)
        except FileExistsError:
            continue
        return candidate
    raise OSError("No free file name")


def _put_once(state: WriteState, folder: Path, name: str, data: bytes) -> tuple[str, bool]:
    """Like `_put`, but a file of the same name family (``name``, ``name (2)``...) with exactly these
    bytes is reused instead of written again. Returns (name, written)."""
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    family = re.compile(re.escape(stem) + r"(?: \(\d+\))?" + (r"\." + re.escape(ext) if ext else "") + r"$", re.I)
    try:
        existing = sorted(n for n in os.listdir(folder) if family.match(n))
    except FileNotFoundError:
        existing = []
    for n in existing:
        full = folder / n
        try:
            if full.is_file() and full.stat().st_size == len(data) and full.read_bytes() == data:
                return n, False
        except OSError:
            continue
    return _put(state, folder, name, data), True


def _attachments(planned: Planned, space: Space, state: WriteState, src: Source) -> None:
    state.progress("attachments", state.done, state.total, None)
    folder = space.root / "Attachments"
    for sp, att in planned.plan.attachments.items():
        _check(state)
        try:
            data = src.read(sp, MAX_ATTACHMENT_BYTES)
        except (SourceDamaged, KeyError) as exc:
            state.skipped.append(SkippedItem(path=sp, reason="damaged", detail=str(exc)[:200]))
            _step(state, "attachments", sp)
            continue
        digest = provenance.hash_bytes(data)
        before = state.prior.attachments.get(sp)
        if before and before.get("hash") == digest and (space.root / str(before.get("path", ""))).is_file():
            # A re-run: the same bytes are already in the space (M25 design section 5).
            state.attachment_paths[sp] = str(before["path"])
            state.attachment_records[sp] = dict(before)
            _step(state, "attachments", sp)
            continue
        name = att.targetName.split("/", 1)[1]
        try:
            written = _put(state, folder, name, data)
        except OSError as exc:
            state.skipped.append(SkippedItem(path=sp, reason="damaged", detail=f"Couldn't be written: {exc}"[:200]))
            _step(state, "attachments", sp)
            continue
        state.attachment_paths[sp] = f"Attachments/{written}"
        state.attachment_records[sp] = {"path": f"Attachments/{written}", "hash": digest}
        state.attachments += 1
        _step(state, "attachments", sp)


# -- originals and the readable page of a file -------------------------------------------------

ORIGINALS = "Attachments/Originals"
_MEDIA_TYPE_NAMES = {"image": "Image", "pdf": "PDF", "audio": "Audio", "video": "Video", "file": "File"}
_MEDIA_PLURALS = {"Image": "Images", "PDF": "PDFs", "Audio": "Audio", "Video": "Videos", "File": "Files"}


def _keep_original(space: Space, state: WriteState, sp: str, data: bytes) -> str | None:
    """The original's bytes into ``Attachments/Originals/`` (design section 2): its space path, or
    None when it is over the attachment limit (listed in the report) or can't be written."""
    name = PurePosixPath(sp).name
    if len(data) > MAX_ATTACHMENT_BYTES:
        state.originals_large.append(sp)
        return None
    if not data:
        return None
    try:
        stem, ext = _safe_attachment_name(name)
    except ValueError:
        stem, ext = "Original", PurePosixPath(name).suffix.lower()
    if f"{stem}{ext}".lower().endswith((BOARD_SUFFIX, INK_SUFFIX)):
        stem += " file"
    try:
        written, _new = _put_once(state, space.root / ORIGINALS, f"{stem}{ext}", data)  # the same bytes: kept already
    except OSError as exc:
        state.skipped.append(SkippedItem(path=sp, reason="damaged", detail=f"The original couldn't be kept: {exc}"[:200]))
        return None
    state.originals_kept += 1
    return f"{ORIGINALS}/{written}"


def _media_block(path: str) -> str:
    enc = markdown.encode_markdown_path(path)
    return f"![]({enc})" if kind_of(path) == "image" else f"![[{path}]]"


def _place_unique(space: Space, rel: str, title: str, data: bytes) -> str | None:
    """Place a new object file at ``rel`` (another free name when taken); its path, or None."""
    folder = rel.rpartition("/")[0]
    if space.place_new(rel, data):
        return rel
    for _attempt in range(100):
        rel = unique_path(space.root, folder, safe_filename(title))
        if space.place_new(rel, data):
            return rel
    return None


def _media_type(space: Space, state: WriteState, type_name: str) -> Any:
    """The space's media type ``type_name`` (Image, PDF, Audio, Video, File), made when it has none,
    as the basic media type (AC-2 for Image; fix pass H for the others): its media fields are
    read-only system fields, not loose External properties. A name with no basic media type
    (none today) falls back to a custom type."""
    t = space.type_by_id(space._type_id(type_name))
    if t is None:
        try:
            t = space.create_media_type(type_name)
        except InvalidValue:
            t = space.create_type(type_name, _MEDIA_PLURALS[type_name])
        state.types += 1
    return t


KEPT_AS_PAGE = "Kept as a Page: an earlier import made it before images became Image objects"


def _is_image_object(space: Space, fm: dict[str, Any]) -> bool:
    t = space.type_by_id(space._type_id("Image"))
    name = fm.get("type")
    return t is not None and isinstance(name, str) and space._type_id(name) == t.id


def _image_size(data: bytes) -> tuple[int, int] | None:
    """(width, height) from the image's header, or None (SVG, or a format Pillow can't open)."""
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as im:
            w, h = im.size
        return (int(w), int(h)) if w > 0 and h > 0 else None
    except Exception:  # noqa: BLE001 - any undecodable image: no size
        return None


def _image_fields(name: str, data: bytes | None, size: int, orig_rel: str | None) -> dict[str, Any]:
    """An Image object's system fields (media type Image: mimeType, fileSize, width, height, source)."""
    out: dict[str, Any] = {"mimeType": attachment_media_type(name), "fileSize": size}
    dims = _image_size(data) if data is not None else None
    if dims is not None:
        out["width"], out["height"] = dims
    if orig_rel:
        out["source"] = orig_rel
    return out


def _image_body(state: WriteState, sp: str, title: str, orig_rel: str | None) -> str:
    if orig_rel:
        line = _media_block(orig_rel)
    elif sp in state.originals_large:
        line = "The original is larger than 100 MB and was not copied."
    else:
        line = "The original could not be kept."
    return f"# {title}\n\n{line}\n"


def _file_object(space: Space, state: WriteState, sp: str, orig_rel: str, size: int, scope: str | None,
                 chash: str) -> str | None:
    """"Keep originals as File objects": a File/PDF/Image object for the original (its ``source`` is
    the kept file). Its space path, or None. It carries an ``importSource`` block (system ``files``,
    id ``<source path>#original``), so a re-run finds it again and updates it instead of adding another."""
    name = PurePosixPath(orig_rel).name
    ident_ = f"{sp}#original"
    values = {"system": "files", "id": ident_, "source": scope, "original": orig_rel, "contentHash": chash,
              "batch": state.batch, "importedAt": state.imported_at}
    blk = {k: v for k, v in values.items() if v not in (None, "")}
    if state.file_index is None:
        state.file_index = provenance.index_space(space)
    ex = next((e for e in state.file_index.get(("files", ident_), [])
               if e.block.get("source") in (None, scope)), None)
    if ex is not None:
        with space._lock:
            raw = space._raw.get(ex.path)
        if raw is not None:
            if ex.block.get("contentHash") == chash and raw.fm.get("source") == orig_rel:
                state.items.append({"sourcePath": f"{sp}#original", "title": name, "path": ex.path, "action": "unchanged",
                                    "system": "files", "id": ident_, "contentHash": chash})
                return ex.path

            def edit(of: Any, _fm: Any) -> Any:
                from dataclasses import replace

                src = set_keys(of.frontmatter_src or "", {"source": orig_rel, "fileSize": size, "lastUpdated": now_stamp(),
                                                          provenance.BLOCK_KEY: blk})
                return replace(of, frontmatter_src=src)

            batches.snapshot(space, ex.path, (space.root / ex.path).read_bytes())
            space._write(ex.path, None, edit, stamp=False, history=False)
            state.items.append({"sourcePath": f"{sp}#original", "title": name, "path": ex.path, "action": "updated",
                                "system": "files", "id": ident_, "contentHash": chash})
            return ex.path
    type_name = _MEDIA_TYPE_NAMES[kind_of(name)]
    t = _media_type(space, state, type_name)
    folder = (t.folder or "").strip("/") or _MEDIA_PLURALS[type_name]
    stamp = now_stamp()
    fm = set_keys(
        f"type: {yaml_single_quoted(t.name)}\n",
        {
            "title": name,
            "mimeType": attachment_media_type(name),
            "fileSize": size,
            "source": orig_rel,
            "createdAt": stamp,
            "lastUpdated": stamp,
            provenance.BLOCK_KEY: blk,
        },
        insert_first={"id": new_ulid()},
    )
    data = join_object(ObjectFile(fm, f"# {name}\n", True, None)).encode("utf-8")
    rel = _place_unique(space, unique_path(space.root, folder, safe_filename(name)), name, data)
    if rel is None:
        return None
    state.items.append(
        {"sourcePath": f"{sp}#original", "title": name, "path": rel, "action": "created", "system": "files", "id": ident_,
         "contentHash": chash}
    )
    return rel


def _place_images(space: Space, state: WriteState, md: str, images: list[Any], sp: str) -> str:
    """The reader's images written to ``Attachments/``; ``![](NAME)`` in ``md`` pointed at them."""
    folder = space.root / "Attachments"
    for img in images:
        name = str(getattr(img, "name", "") or "image")
        data = getattr(img, "data", b"")
        if not data:
            continue
        try:
            stem, ext = _safe_attachment_name(name)
        except ValueError:
            stem, ext = "image", PurePosixPath(name).suffix.lower()
        try:
            written, new = _put_once(state, folder, f"{stem}{ext}", data)
        except OSError as exc:
            state.skipped.append(SkippedItem(path=sp, reason="damaged", detail=f"An image couldn't be kept: {exc}"[:200]))
            continue
        state.attachments += 1 if new else 0
        final = markdown.encode_markdown_path(f"Attachments/{written}")
        pattern = r"(!\[[^\]]*\]\()\s*<?" + re.escape(name) + r">?(\s*(?:\"[^\"]*\")?\))"
        md = re.sub(pattern, lambda m, f=final: m.group(1) + f + m.group(2), md)
    return md


def _native_body(
    space: Space, state: WriteState, w: Any, page: FilePage, orig_rel: str | None, file_obj: str | None
) -> str:
    sp = w.read.sourcePath
    title = w.obj.title
    media = _media_block(orig_rel) if orig_rel else None
    notes = list(page.notes)
    if page.original_only or not page.markdown.strip():
        notes = [n for n in notes if n != "Original only"]  # the line below says it once
        lines = [f"# {title}", ""]
        if media:
            lines.append(media)
        elif sp in state.originals_large:
            lines.append("The original is larger than 100 MB and was not copied.")
        else:
            lines.append("The original could not be kept.")
        state.losses.append((sp, "Original only: no readable page could be made"))
        out = "\n".join(lines) + "\n"
    else:
        md = _place_images(space, state, page.markdown.replace("\r\n", "\n"), page.images, sp)
        if page_heading(md) is None:
            md = f"# {title}\n\n{md.lstrip(chr(10))}"
        if media and PurePosixPath(sp).suffix.lower() == ".pdf":
            first, _, rest = md.partition("\n")
            md = f"{first}\n\n{media}\n{rest}" if first.startswith("#") else f"{media}\n\n{md}"
        out = md if md.endswith("\n") else md + "\n"
    for note in dict.fromkeys(notes):
        state.losses.append((sp, note))
    if file_obj:
        out += f"\nOriginal: [[{file_obj[:-3]}]]\n"
    return out


# -- objects ---------------------------------------------------------------------------


def _frontmatter(w: Any, type_name: str, block: dict[str, Any] | None = None, keep_id: str | None = None,
                 created: str | None = None, exclude_ai: bool = False, source: dict[str, Any] | None = None) -> str:
    fm = set_keys(
        f"type: {yaml_single_quoted(type_name)}\n",
        {"title": w.obj.title},
        insert_first={"id": keep_id or new_ulid()},
    )
    values: dict[str, Any] = {k: v for k, v in (source or {}).items() if v is not None}  # M30: Category, System
    for k, v in w.values:
        values[k] = v
    if w.tags:
        values["tags"] = FlowList(w.tags)
    if w.aliases:
        values["aliases"] = FlowList(w.aliases)
    if w.description:
        values["description"] = w.description
    values["createdAt"] = created or w.createdAt
    values["lastUpdated"] = w.lastUpdated
    if exclude_ai:
        values["excludeFromAI"] = True
    if block:
        values[provenance.BLOCK_KEY] = block
    return set_keys(fm, values)


def _body(planned: Planned, w: Any, src: Source, budget: TextBudget, state: WriteState) -> str:
    o = w.read
    title = w.obj.title
    if not o.hasBody:
        return f"# {title}\n"
    text = read_page_text(src, o.sourcePath, budget, None)
    if text is None:
        state.skipped.append(SkippedItem(path=o.sourcePath, reason="damaged", detail="Could not be read again; written with an empty body"))
        return f"# {title}\n"
    of = split_object(text)
    body = of.body
    if o.badFrontmatter is not None:
        fence = "```"
        while fence in o.badFrontmatter:
            fence += "`"
        body = f"{fence}yaml\n{o.badFrontmatter}{fence}\n\n{body}"
    if o.stripKeys:
        _props, body = split_property_lines(body, o.stripKeys)

    def attachment_path(sp: str) -> str | None:
        return state.attachment_paths.get(sp)

    hooks = markdown.Hooks(planned.resolve_href, planned.resolve_wiki, planned.object_link, attachment_path)
    out = markdown.convert(body, o.sourcePath, hooks, notion_callouts=planned.plan.kind == "notion").text
    if page_heading(out) is None:
        rest = out.lstrip("\n")
        out = f"# {title}\n" + (f"\n{rest}" if rest.strip() else "")
    if not out.endswith("\n"):
        out += "\n"
    return out


def _edited_since_import(space: Space, rel: str, state: WriteState, block: dict[str, Any]) -> bool:
    """Whether the object's file changed after the import wrote it (our call 5): its bytes differ
    from what the last batch wrote there; without such a record, its modification time is after
    ``importedAt``."""
    from ..space import version_of

    full = space.root / rel
    try:
        current = version_of(full.read_bytes())
    except OSError:
        return False
    recorded = state.prior.versions.get(rel)
    if recorded:
        return current != recorded
    try:
        at = datetime.fromisoformat(str(block.get("importedAt", "")).replace("Z", "+00:00"))
        return full.stat().st_mtime > at.timestamp() + 2.0
    except (ValueError, OSError):
        return True  # can't tell: treat as edited, never overwrite


def _record(state: WriteState, w: Any, system: str, ident_: str, action: str, **extra: Any) -> None:
    state.items.append(
        {"sourcePath": w.read.sourcePath, "system": system, "id": ident_, "title": w.obj.title, "path": extra.pop("path", None),
         "action": action, **extra}
    )


def _objects(planned: Planned, space: Space, state: WriteState, src: Source) -> None:
    state.progress("objects", state.done, state.total, None)
    budget = TextBudget(limit=1 << 62)
    for sp, (dup_id, first, _n) in provenance.duplicates(planned.read).items():
        state.losses.append((sp, f"Has the same id ({dup_id}) as {first} in this source; kept as a separate object"))
    for w in planned.writes:
        _check(state)
        sp = w.read.sourcePath
        try:
            _write_one(planned, space, state, src, budget, w)
        except Cancelled:
            raise
        except (OSError, SourceDamaged, KeyError) as exc:  # a name the file system refuses, permissions, a damaged entry
            state.skipped.append(SkippedItem(path=sp, reason="damaged", detail=f"Couldn't be written: {exc}"[:200]))
            state.failed_objects.append(sp)
            system, ident_ = provenance.ident(planned.read, w.read)
            _record(state, w, system, ident_, "failed")
        state.processed += 1
        _step(state, "objects", sp)


def _write_one(planned: Planned, space: Space, state: WriteState, src: Source, budget: TextBudget, w: Any) -> None:
    from ..space import version_of

    o = w.read
    sp = o.sourcePath
    system, ident_ = provenance.ident(planned.read, o)
    entry = src.files.get(sp)
    data: bytes | None = None
    if o.native:
        assert entry is not None
        if entry.size <= MAX_ATTACHMENT_BYTES:
            data = src.read(sp, MAX_ATTACHMENT_BYTES)
    elif entry is not None:
        data = src.read(sp, MAX_TEXT_FILE)
    else:  # a Notion database row with no page of its own
        data = json.dumps(o.fields, sort_keys=True, default=str).encode("utf-8")
    if data is not None:
        chash = provenance.hash_bytes(data)
    else:
        assert entry is not None
        chash = f"stat:{entry.size}:{int(entry.mtime * 1000)}"

    # A re-run: the same source item, matched by (system, id) before planning.
    ex_raw = None
    if w.existing:
        with space._lock:
            ex_raw = space._raw.get(w.existing)
    ex_block = provenance.read_block(ex_raw.fm) if ex_raw is not None else None
    # M30: a page kept as a Source, and a Source an earlier batch of this source made (it stays one).
    ex_source = ex_raw is not None and is_imported_source(space._type_id(ex_raw.typeName), ex_raw.fm)
    as_source = ex_source or (w.obj.typeKey == SOURCE_KEY and ex_raw is None)
    # AC-2: an image becomes an Image object, but one an earlier import made into a Page stays that
    # Page (matched by (system, id); never duplicated, never migrated silently).
    as_image = w.media == "image"
    if as_image and ex_raw is not None and not _is_image_object(space, ex_raw.fm):
        as_image = False
        state.losses.append((sp, KEPT_AS_PAGE))
    if ex_raw is not None and ex_block is not None and ex_block.get("contentHash") == chash:
        state.unchanged += 1
        state.written[sp] = w.existing
        extra: dict[str, Any] = {}
        if ex_block.get("source") in state.moved_from:
            with _source_writes(space, ex_source):  # the run's own Source: only its block line
                version = _restamp_source(space, state, w.existing, ex_block, provenance.scope(planned.read, o))
            if version is not None:
                extra["version"] = version
        _record(state, w, system, ident_, "unchanged", path=w.existing, contentHash=chash, **extra)
        return

    type_name = state.type_names.get(w.obj.typeKey, w.typeName)
    page: FilePage | None = None
    orig_rel: str | None = None
    file_obj: str | None = None
    extra_fm: dict[str, Any] = {}
    source_text: tuple[bool, str, bytes] | None = None
    if as_source and not as_image and not o.native and o.hasBody and entry is not None and data is not None:
        source_text = _source_text(data)  # M30: the page's text exactly as imported
        body = source_text[2].decode("utf-8", errors="surrogateescape").replace("\r\n", "\n")
    elif as_image:
        name = PurePosixPath(sp).name
        if data is not None:
            page = file_page(name, data)  # its EXIF date fills importSource.created
            orig_rel = _keep_original(space, state, sp, data)
        else:
            state.originals_large.append(sp)
        type_name = _media_type(space, state, "Image").name
        extra_fm = _image_fields(name, data, entry.size if entry is not None else 0, orig_rel)
        body = _image_body(state, sp, w.obj.title, orig_rel)
    elif o.native:
        name = PurePosixPath(sp).name
        if data is not None:
            page = file_page(name, data)
            orig_rel = _keep_original(space, state, sp, data)
            if orig_rel and state.keep_originals == "fileObjects":
                file_obj = _file_object(space, state, sp, orig_rel, len(data), provenance.scope(planned.read, o), chash)
        else:
            page = FilePage(markdown="", original_only=True)
            state.originals_large.append(sp)
        body = _native_body(space, state, w, page, orig_rel, file_obj)
    else:
        body = _body(planned, w, src, budget, state)
    prov = provenance.prov_for(planned.read, o, data, orig_rel)
    prov.contentHash = chash
    if page is not None:
        prov.author = prov.author or page.author
        prov.created = prov.created or page.created
        prov.modified = prov.modified or page.modified
    blk = provenance.block(prov, state.batch, state.imported_at)

    keep_id = created = None
    if ex_raw is not None:
        keep_id = ex_raw.fm.get("id") if isinstance(ex_raw.fm.get("id"), str) else None
        created = ex_raw.fm.get("createdAt") if isinstance(ex_raw.fm.get("createdAt"), str) else None
    # A re-run never drops the flag: once an object is excluded from AI it stays so.
    kept_flag = ex_raw is not None and ex_raw.fm.get("excludeFromAI") is True
    source_fields: dict[str, Any] | None = None
    if as_source:
        source_fields = {"category": category_for(blk, sp), "system": system_label(blk)}
        if ex_raw is not None:  # a re-run keeps the Source's type, Category and System
            if isinstance(ex_raw.fm.get("type"), str):
                type_name = ex_raw.fm["type"]
            for key in ("category", "system"):
                if ex_raw.fm.get(key) is not None:
                    source_fields[key] = ex_raw.fm[key]
    fm = _frontmatter(w, type_name, blk, keep_id, created, exclude_ai=sp in state.exclude_ai or kept_flag,
                      source=source_fields)
    if extra_fm:
        fm = set_keys(fm, extra_fm)
    new_of = ObjectFile(fm, body, True, None)
    if source_text is not None:
        out = _source_bytes(fm, source_text)
    else:
        out = join_object(new_of).encode("utf-8")

    if ex_raw is not None and ex_block is not None:
        from ..space import Conflict

        rel = w.existing

        def changed_in_both() -> None:
            name = f"{len(state.pending) + 1}.md"
            state.pending[name] = out
            state.conflicts.append({"path": rel, "title": w.obj.title, "sourcePath": sp})
            state.written[sp] = rel
            _record(state, w, system, ident_, "conflict", path=rel, contentHash=chash, pending=f"pending/{name}")

        cur = (space.root / rel).read_bytes()
        # M30: a Source can't be edited in the app (a hand-edit outside it is in version history),
        # so it is updated whatever its bytes, keeping the previous text in version history.
        if not ex_source and _edited_since_import(space, rel, state, ex_block):
            changed_in_both()
            return
        batches.snapshot(space, rel, cur)
        if ex_source:
            # M30: the Source is the new source's bytes exactly (its own line endings and BOM, not the
            # old file's), at the version checked, the previous bytes kept in version history.
            with space.source_writes():
                if not space._write_exact(rel, version_of(cur), out):
                    changed_in_both()
                    return
        else:
            try:
                # at the version checked: a save made since is never overwritten
                space._write(rel, version_of(cur), lambda _of, _fm, o2=new_of: o2, stamp=False, history=False)
            except Conflict:
                changed_in_both()
                return
        state.updated += 1
        state.written[sp] = rel
        _record(state, w, system, ident_, "updated", path=rel, contentHash=chash,
                version=version_of((space.root / rel).read_bytes()), original=orig_rel)
        return

    rel = _place_unique(space, w.obj.targetPath, w.obj.title, out)
    if rel is None:
        state.skipped.append(SkippedItem(path=sp, reason="damaged", detail="No free file name"))
        state.failed_objects.append(sp)
        _record(state, w, system, ident_, "failed")
        return
    state.written[sp] = rel
    state.objects += 1
    state.images += 1 if as_image else 0
    _record(state, w, system, ident_, "created", path=rel, contentHash=chash, version=version_of(out), original=orig_rel)


@contextlib.contextmanager
def _source_writes(space: Space, on: bool) -> Iterator[None]:
    """`Space.source_writes` when ``on`` (the object written is the run's own imported Source)."""
    if not on:
        yield
        return
    with space.source_writes():
        yield


def _source_text(data: bytes) -> tuple[bool, str, bytes]:
    """M30: (BOM, line ending, the bytes after the page's own frontmatter) of a page's file: a
    Source's body is these bytes, byte for byte (its fields are its frontmatter keys)."""
    from ..textfile import BOM, decode

    tf = decode(data)
    raw = data[len(BOM) :] if tf.bom else data
    of = split_object(tf.text)
    if of.frontmatter_src is None:
        return tf.bom, tf.eol, raw
    if not of.closing_fence_newline:
        return tf.bom, tf.eol, b""
    pos = 0
    for _line in range(2 + of.frontmatter_src.count("\n")):  # both fences and the lines between
        pos = raw.index(b"\n", pos) + 1
    return tf.bom, tf.eol, raw[pos:]


def _source_bytes(fm: str, text: tuple[bool, str, bytes]) -> bytes:
    """A new Source's file: its frontmatter in the page's line ending (and BOM), then the page's bytes."""
    from ..textfile import BOM

    bom, eol, body = text
    head = f"---\n{fm}---\n"
    if eol == "\r\n":
        head = head.replace("\n", "\r\n")
    return (BOM if bom else b"") + head.encode("utf-8") + body


def _restamp_source(space: Space, state: WriteState, rel: str, block: dict[str, Any], here: str | None) -> str | None:
    """Write the run's source into the ``importSource`` block of an unchanged object the source moved
    from, so later runs match it directly and another source with the same ids stays apart. Only an
    object not edited in Object (the version this records must never hide an edit); the frontmatter
    line alone changes. Answers the version written, or None when it was left as it is."""
    from ..space import Conflict, version_of

    if here is None or block.get("source") == here or _edited_since_import(space, rel, state, block):
        return None
    new_block = {**block, "source": here}

    def edit(of: Any, _fm: Any) -> Any:
        from dataclasses import replace

        return replace(of, frontmatter_src=set_keys(of.frontmatter_src or "", {provenance.BLOCK_KEY: new_block}))

    try:
        cur = (space.root / rel).read_bytes()
        space._write(rel, version_of(cur), edit, stamp=False, history=False)
        return version_of((space.root / rel).read_bytes())
    except (Conflict, OSError, KeyError):
        return None


def _removed_at_source(planned: Planned, space: Space, state: WriteState) -> None:
    """Objects an earlier batch of this source made whose source item is gone: listed, never trashed."""
    seen = {provenance.ident(planned.read, o) for o in planned.read.objects}
    present = {o.sourcePath for o in planned.read.objects}
    for key, it in state.prior.items.items():
        if key in seen:
            continue
        if it.get("entity") is True or key[1].startswith("entity:"):
            continue  # M30: an entity a Write made from the Sources, not an item of the source
        if key[1].endswith("#original") and key[1][: -len("#original")] in present:
            continue  # the File object of an original that is still at the source
        rel = str(it.get("path", ""))
        with space._lock:
            raw = space._raw.get(rel)
        if raw is None or provenance.read_block(raw.fm) is None:
            continue
        state.removed.append({"path": rel, "title": it.get("title") or rel, "system": key[0], "id": key[1]})


_PAGE_FAILS = frozenset({"emptyFile", "damaged", "tooLarge", "unsafePath", "symlink", "encrypted"})


def _count(planned: Planned, state: WriteState) -> None:
    """The reconciling counts (design section 10): source items = imported + updated + unchanged +
    changed in both + left out + failed."""
    plan = planned.plan
    read = planned.read
    objects = {o.sourcePath for o in read.objects}
    kept = {w.read.sourcePath for w in planned.writes}
    unread = {
        s.path
        for s in plan.skipped
        if s.reason in _PAGE_FAILS
        and not s.path.endswith("/")
        and s.path not in objects
        and s.path not in read.files
        and (s.path.lower().endswith(".md") or read.kind == "files")
    }
    left_out = len(objects - kept) + len(state.left_out_files)
    not_written = len(planned.writes) - state.processed
    failed = len(unread) + len(state.failed_objects) + max(not_written, 0)
    state.counts = {
        "sourceItems": len(objects) + len(unread) + len(state.left_out_files),
        "imported": state.objects,
        "updated": state.updated,
        "unchanged": state.unchanged,
        "changedInBoth": len(state.conflicts),
        "leftOut": left_out,
        "failed": failed,
        "notWritten": max(not_written, 0),
        "unreadPages": len(unread),
        "removed": len(state.removed),
        "originals": state.originals_kept,
    }


def _records(planned: Planned, space: Space, state: WriteState, started: str) -> None:
    """The batch records (design section 7) in ``.object/imports/<batch>/``."""
    d = batches.batch_dir(space.root, state.batch)
    src_kind = planned.plan.kind
    system = provenance.system_of(planned.read)
    c = dict(state.counts)
    c["pending"] = len(state.conflicts)
    batches.write_json(
        d / "batch.json",
        {
            "id": state.batch,
            "startedAt": started,
            "finishedAt": now_stamp(),
            "source": {"path": planned.plan.sourcePath, "kind": src_kind, "system": system},
            "target": {"kind": planned.target, "path": str(space.root)},
            "mapping": planned.mapping.model_dump(),
            "keepOriginals": state.keep_originals,
            "counts": c,
            "stopped": state.stopped,
            "reportPath": state.report_path,
            "types": state.types,
            "attachments": state.attachments,
            "tags": state.tags,
            "leftOutFiles": sorted(state.left_out_files),
            "excludedFromAi": sorted(state.exclude_ai),
            "movedFrom": list(state.moved_from),
            "keepAsSources": state.keep_as_sources,
        },
    )
    batches.write_json(d / "items.json", state.items)
    batches.write_json(d / "attachments.json", state.attachment_records)
    batches.write_json(d / "removed.json", state.removed)
    if state.report_body:
        atomic_write(d / "report.md", state.report_body.encode("utf-8"))
    for name, data in state.pending.items():
        (d / "pending").mkdir(parents=True, exist_ok=True)
        atomic_write(d / "pending" / name, data)


# -- the report ------------------------------------------------------------------------


def _report(planned: Planned, space: Space, state: WriteState) -> None:
    page = space.type_by_id("page")
    folder = (page.folder.strip("/") if page is not None else "") or "Pages"
    type_name = page.name if page is not None else "Page"
    rel_guess = unique_path(space.root, folder, safe_filename(REPORT_TITLE))
    title = REPORT_TITLE
    stem = rel_guess.rsplit("/", 1)[-1][:-3]
    if stem != REPORT_TITLE:
        title = stem  # "Import report (2)": the title says which one it is

    def link_for(sp: str) -> str | None:
        rel = state.written.get(sp)
        if rel is None:
            return None
        try:
            summary = space.get(rel)
        except (KeyError, ValueError):
            return None
        if space.resolve(summary.title, rel_guess) == rel and not any(c in summary.title for c in "[]|#\n"):
            return f"[[{summary.title}]]"
        return f"[[{rel[:-3]}]]"

    when = space.clock().astimezone(space.tz).strftime("%Y-%m-%d %H:%M")  # the space's zone, as every stamp
    # Planned renames, and files that got another name because theirs was taken meanwhile.
    renamed = [
        (po.title, rel)
        for po in planned.plan.objects
        if (rel := state.written.get(po.sourcePath)) is not None
        and (po.renamedFrom is not None or rel != po.targetPath)
    ]
    def link_for_path(rel: str) -> str:
        try:
            summary = space.get(rel)
        except (KeyError, ValueError):
            return rel
        return f"[[{rel[:-3]}]]" if any(c in summary.title for c in "[]|#\n") else f"[[{summary.title}]]"

    body = build_report(
        title=title,
        source_path=planned.plan.sourcePath,
        kind=planned.plan.kind,
        when=when,
        counts={"objects": state.objects, "types": state.types, "attachments": state.attachments, "tags": state.tags},
        skipped=[*planned.plan.skipped, *state.skipped],
        renamed=renamed,
        unresolved=planned.unresolved,
        not_converted=planned.not_converted,
        link_for=link_for,
        stopped=state.stopped,
        not_written=len(planned.writes) - state.processed if state.stopped else 0,
        warnings=planned.plan.warnings,
        extra={
            "batch": state.batch,
            "counts": state.counts,
            "originals": state.originals_kept,
            "originalsLarge": state.originals_large,
            "images": state.images,
            "keep": state.keep_originals,
            "losses": state.losses,
            "conflicts": [(link_for_path(c["path"]), c["path"]) for c in state.conflicts],
            "removed": [(r["title"], r["path"]) for r in state.removed],
            "scan": {"leftOut": sorted(state.left_out_files), "excluded": sorted(state.exclude_ai)},
            "movedFrom": list(state.moved_from),
        },
    )
    state.report_body = body
    stamp = now_stamp()
    fm = set_keys(
        f"type: {yaml_single_quoted(type_name)}\n",
        {"title": title, "createdAt": stamp, "lastUpdated": stamp},
        insert_first={"id": new_ulid()},
    )
    data = join_object(ObjectFile(fm, body, True, None)).encode("utf-8")
    for _attempt in range(100):
        rel = unique_path(space.root, folder, safe_filename(title))
        if space.place_new(rel, data):
            state.report_path = rel
            return
