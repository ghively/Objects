"""The common writer: a `Planned` import written into a space, only ever adding files.

Phases (contract "Import API"): ``preparing`` (the source re-opened and its fingerprint
checked), ``types`` (new types made with `Space.create_type`; properties and label options
added with `Space.save_type`; Tag objects made or reused with `Space.ensure_tag`),
``attachments`` (each copied to its planned ``Attachments/`` name with `create_new`, the next
free `` (n)`` name if it was taken meanwhile), ``objects`` (each source file read again and
converted with the plan's link table, then placed with `Space._place`, which never
overwrites) and ``report`` (the "Import report" `Page`).

Nothing written is ever removed: a cancel stops after the file being written and a failure
stops where it happened; the report is still written. New files are LF without a BOM, as
`Space.create_object` writes them; no template is applied.
"""

from __future__ import annotations

import copy
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from ..frontmatter import FlowList, set_keys
from ..ids import new_ulid
from ..media import MAX_ATTACHMENT_BYTES
from ..objfile import ObjectFile, join_object, split_object
from ..space import _yaml_single_quoted, now_stamp, safe_filename, unique_path
from ..textfile import create_new
from ..watcher import ChangeEvent
from . import markdown
from .model import ImportResult, SkippedItem
from .notion import page_heading, split_property_lines
from .planner import Planned
from .readmodel import read_page_text
from .report import REPORT_TITLE, build_report
from .source import Source, SourceDamaged, TextBudget, open_source

if TYPE_CHECKING:
    from ..space import Space

__all__ = ["Cancelled", "SourceChanged", "WriteState", "write_import"]

_log = logging.getLogger(__name__)


class Cancelled(Exception):
    pass


class SourceChanged(Exception):
    """The source's fingerprint no longer matches the preview's (409)."""


@dataclass
class WriteState:
    """Progress and what was written so far (read by the job)."""

    progress: Callable[[str, int, int, str | None], None] = lambda *_a: None
    cancelled: Callable[[], bool] = lambda: False
    announce: Callable[[ChangeEvent], None] | None = None
    client_id: str | None = None
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


def _check(state: WriteState) -> None:
    if state.cancelled():
        raise Cancelled()


def _step(state: WriteState, phase: str, current: str | None) -> None:
    state.done += 1
    state.progress(phase, state.done, state.total, current)


def _announce(state: WriteState, kind: str, path: str, version: str | None = None) -> None:
    if state.announce is not None:
        try:
            state.announce(ChangeEvent(kind, path, version, origin=state.client_id))  # type: ignore[arg-type]
        except Exception:  # noqa: BLE001 - an SSE hiccup never stops an import
            _log.warning("Could not announce %s %s", kind, path, exc_info=True)


def write_import(planned: Planned, space: Space, state: WriteState) -> ImportResult:
    """Write ``planned`` into ``space``. Raises `SourceChanged` before writing anything when
    the source changed; otherwise always writes the report and answers the result."""
    state.total = len(planned.plan.attachments) + len(planned.writes) + 1
    state.progress("preparing", 0, state.total, None)
    src = open_source(planned.plan.sourcePath)
    try:
        if src.fingerprint != planned.plan.fingerprint:
            raise SourceChanged("The source changed since the preview.")
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
            _announce(state, "types", t.id)
            continue
        t = space.type_by_id(tw.existingTypeId)
        if t is None:
            raise KeyError(tw.existingTypeId)
        state.type_names[pt.key] = t.name
        if (tw.new_props or tw.add_options) and not t.basic:
            _save_props(space, t.id, tw.new_props, _option_pdefs(planned, pt.key))
            state.types += 1
            _announce(state, "types", t.id)
    for tag in planned.tags:
        _check(state)
        try:
            _path, created = space.ensure_tag(tag)
        except Exception:  # noqa: BLE001 - a tag that can't be made is listed
            state.skipped.append(SkippedItem(path=tag, reason="damaged", detail="The tag couldn't be made"))
            continue
        if created:
            state.tags += 1
            _announce(state, "created", _path, space.cached_version(_path))


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
        folder.mkdir(parents=True, exist_ok=True)
        name = att.targetName.split("/", 1)[1]
        stem, dot, ext = name.rpartition(".")
        if not dot:
            stem, ext = name, ""
        n = 1
        while True:
            candidate = name if n == 1 else (f"{stem} ({n}).{ext}" if ext else f"{stem} ({n})")
            taken = {p.name.lower() for p in folder.iterdir()}
            if candidate.lower() not in taken:
                try:
                    create_new(folder / candidate, data)
                    break
                except FileExistsError:
                    pass
            n += 1
        state.attachment_paths[sp] = f"Attachments/{candidate}"
        state.attachments += 1
        _step(state, "attachments", sp)


# -- objects ---------------------------------------------------------------------------


def _frontmatter(w: Any, type_name: str) -> str:
    fm = set_keys(
        f"type: {_yaml_single_quoted(type_name)}\n",
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
        placed = space._place(rel, data)
        attempt = 0
        while not placed and attempt < 100:
            attempt += 1
            rel = unique_path(space.root, folder, safe_filename(w.obj.title))
            placed = space._place(rel, data)
        if not placed:
            state.skipped.append(SkippedItem(path=w.obj.sourcePath, reason="damaged", detail="No free file name"))
            _step(state, "objects", w.obj.sourcePath)
            continue
        state.written[w.obj.sourcePath] = rel
        state.objects += 1
        _announce(state, "created", rel, space.cached_version(rel))
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
    renamed = [
        (po.title, state.written.get(po.sourcePath, po.targetPath))
        for po in planned.plan.objects
        if po.renamedFrom is not None
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
        warnings=planned.plan.warnings,
    )
    stamp = now_stamp()
    fm = set_keys(
        f"type: {_yaml_single_quoted(type_name)}\n",
        {"title": title, "createdAt": stamp, "lastUpdated": stamp},
        insert_first={"id": new_ulid()},
    )
    data = join_object(ObjectFile(fm, body, True, None)).encode("utf-8")
    for _attempt in range(100):
        rel = unique_path(space.root, folder, safe_filename(title))
        if space._place(rel, data):
            state.report_path = rel
            _announce(state, "created", rel, space.cached_version(rel))
            return
