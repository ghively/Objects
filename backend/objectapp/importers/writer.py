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

Nothing is announced per object or type: an import can write thousands of files, so the
caller announces one resync when the job ends (`WriteState.wrote_anything`).
"""

from __future__ import annotations

import copy
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from ..frontmatter import FlowList, set_keys
from ..ids import new_ulid
from ..media import MAX_ATTACHMENT_BYTES
from ..objfile import ObjectFile, join_object, split_object
from ..space import now_stamp, safe_filename, unique_path, yaml_single_quoted
from ..textfile import create_new
from . import markdown
from .model import ImportResult, SkippedItem
from .notion import page_heading, split_property_lines
from .planner import Planned
from .readmodel import read_page_text
from .report import REPORT_TITLE, build_report
from .source import LimitExceeded, NotASource, Source, SourceDamaged, SourceMissing, TextBudget, open_source

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

    @property
    def wrote_anything(self) -> bool:
        """Whether any file was written (an object, a type, an attachment, a tag, the report)."""
        return bool(self.objects or self.types or self.attachments or self.tags or self.report_path)


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


def write_import(planned: Planned, space: Space, state: WriteState, src: Source | None = None) -> ImportResult:
    """Write ``planned`` into ``space`` from ``src`` (`open_checked`; opened here when None,
    raising `SourceChanged` before writing anything) and close it; always writes the report
    and answers the result."""
    state.total = len(planned.plan.attachments) + len(planned.writes) + 1
    state.progress("preparing", 0, state.total, None)
    if src is None:
        src = open_checked(planned)
    try:
        try:
            _types(planned, space, state)
            _attachments(planned, space, state, src)
            _objects(planned, space, state, src)
        except Cancelled:
            state.stopped = "it was stopped"
        except Exception as exc:  # noqa: BLE001 - the report says what was written
            _log.exception("Import into %s failed", space.root)
            state.stopped = f"an error occurred ({type(exc).__name__}: {str(exc)[:200]})"
    finally:
        src.close()
    state.progress("report", state.done, state.total, None)
    try:
        _report(planned, space, state)
    except Exception:  # noqa: BLE001
        _log.exception("Could not write the import report")
    state.done = state.total
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


def _attachments(planned: Planned, space: Space, state: WriteState, src: Source) -> None:
    state.progress("attachments", state.done, state.total, None)
    folder = space.root / "Attachments"
    if planned.plan.attachments:
        folder.mkdir(parents=True, exist_ok=True)
    taken = _names_in(folder)  # listed once; a name taken meanwhile fails `create_new`
    for sp, att in planned.plan.attachments.items():
        _check(state)
        try:
            data = src.read(sp, MAX_ATTACHMENT_BYTES)
        except (SourceDamaged, KeyError) as exc:
            state.skipped.append(SkippedItem(path=sp, reason="damaged", detail=str(exc)[:200]))
            _step(state, "attachments", sp)
            continue
        name = att.targetName.split("/", 1)[1]
        stem, dot, ext = name.rpartition(".")
        if not dot:
            stem, ext = name, ""
        n = 1
        written = None
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
            except OSError as exc:
                state.skipped.append(SkippedItem(path=sp, reason="damaged", detail=f"Couldn't be written: {exc}"[:200]))
                break
            written = candidate
            break
        if written is None:
            _step(state, "attachments", sp)
            continue
        state.attachment_paths[sp] = f"Attachments/{written}"
        state.attachments += 1
        _step(state, "attachments", sp)


# -- objects ---------------------------------------------------------------------------


def _frontmatter(w: Any, type_name: str) -> str:
    fm = set_keys(
        f"type: {yaml_single_quoted(type_name)}\n",
        {"title": w.obj.title},
        insert_first={"id": new_ulid()},
    )
    values: dict[str, Any] = {}
    for k, v in w.values:
        values[k] = v
    if w.tags:
        values["tags"] = FlowList(w.tags)
    if w.aliases:
        values["aliases"] = FlowList(w.aliases)
    if w.description:
        values["description"] = w.description
    values["createdAt"] = w.createdAt
    values["lastUpdated"] = w.lastUpdated
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


def _objects(planned: Planned, space: Space, state: WriteState, src: Source) -> None:
    state.progress("objects", state.done, state.total, None)
    budget = TextBudget(limit=1 << 62)
    for w in planned.writes:
        _check(state)
        type_name = state.type_names.get(w.obj.typeKey, w.typeName)
        fm = _frontmatter(w, type_name)
        body = _body(planned, w, src, budget, state)
        data = join_object(ObjectFile(fm, body, True, None)).encode("utf-8")
        rel = w.obj.targetPath
        folder = rel.rpartition("/")[0]
        try:
            placed = space.place_new(rel, data)
            attempt = 0
            while not placed and attempt < 100:
                attempt += 1
                rel = unique_path(space.root, folder, safe_filename(w.obj.title))
                placed = space.place_new(rel, data)
        except OSError as exc:  # a name the file system refuses, permissions: skip this one
            state.skipped.append(SkippedItem(path=w.obj.sourcePath, reason="damaged", detail=f"Couldn't be written: {exc}"[:200]))
            _step(state, "objects", w.obj.sourcePath)
            continue
        if not placed:
            state.skipped.append(SkippedItem(path=w.obj.sourcePath, reason="damaged", detail="No free file name"))
            _step(state, "objects", w.obj.sourcePath)
            continue
        state.written[w.obj.sourcePath] = rel
        state.objects += 1
        _step(state, "objects", w.obj.sourcePath)


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

    when = datetime.now(UTC).astimezone().strftime("%Y-%m-%d %H:%M")
    # Planned renames, and files that got another name because theirs was taken meanwhile.
    renamed = [
        (po.title, rel)
        for po in planned.plan.objects
        if (rel := state.written.get(po.sourcePath)) is not None
        and (po.renamedFrom is not None or rel != po.targetPath)
    ]
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
        not_written=len(planned.writes) - state.objects if state.stopped else 0,
        warnings=planned.plan.warnings,
    )
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
