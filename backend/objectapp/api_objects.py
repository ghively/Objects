"""The object routes, mounted on ``/api`` (once inline in `server.py`); `server`'s module
docstring lists every answer shape. Reading and writing one object, creating objects and
daily notes, duplication, export, rename and type change, counterpart edits, id stamps,
template application and deletion:

- ``GET /api/objects?type=`` and ``GET /api/object?path=``
- ``PUT /api/object/body`` and ``PUT /api/object/properties`` (Gene's own edit also reaches
  the Work loop, decision S3: `gene_edited` calls ``server.on_change_event``)
- ``POST /api/object/counterpart``, ``/ensure-id``, ``/duplicate``, ``/rename``,
  ``/change-type`` (and its ``GET``), ``/api/objects``, ``/api/daily-notes``,
  ``DELETE /api/object``, ``POST /api/object/apply-template``
- ``GET /api/object/export`` and ``/export/properties`` (the export itself is called as
  ``server.export_object_to_file``, which tests patch)"""

from __future__ import annotations

import logging
from dataclasses import asdict
from pathlib import PurePosixPath
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel
from starlette.background import BackgroundTask

from .apictx import ApiContext
from .computed import Computer, Obj, has_computed
from .counterparts import CounterpartEditRequest
from .export import ExportOptions, content_disposition, export_properties
from .propvalues import InvalidValue, decode_value
from .space import Conflict, DailyNoteExists, ReadOnly
from .synced import synced_props
from .typemodel import TypeReadOnly, type_revision
from .watcher import ChangeEvent
from .whiteboardfile import sidecar_owner

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def _safe(value: Any) -> Any:
    from .server import _display_safe  # lazy: server.py imports this module

    return _display_safe(value)


class SaveBodyRequest(BaseModel):
    path: str
    body: str
    baseVersion: str
    clientId: str | None = None
    """The saving window's id, echoed as ``origin`` on the change event the save announces."""


class UpdatePropertiesRequest(BaseModel):
    path: str
    updates: dict[str, Any] = {}
    remove: list[str] = []
    baseVersion: str
    clientId: str | None = None


class EnsureIdRequest(BaseModel):
    path: str
    clientId: str | None = None


class DuplicateRequest(BaseModel):
    path: str
    clientId: str | None = None


class RenameRequest(BaseModel):
    path: str
    title: str
    baseVersion: str
    clientId: str | None = None


class ChangeTypeRequest(BaseModel):
    path: str
    typeId: str
    mapping: dict[str, str | None] = {}
    baseVersion: str
    clientId: str | None = None


class CreateObjectRequest(BaseModel):
    typeId: str
    title: str | None = None
    templateId: str | None = None
    values: dict[str, Any] | None = None
    body: str | None = None
    """M14: the new object's body, written in the creating write (replaces the template's)."""
    appendBody: str | None = None
    """M14: text added below the body the object gets (its template's; alone when that is empty)."""
    clientId: str | None = None


class CreateDailyNoteRequest(BaseModel):
    date: str
    templateId: str | None = None
    clientId: str | None = None


class ApplyTemplateRequest(BaseModel):
    path: str
    templateId: str
    baseVersion: str
    clientId: str | None = None


def router(ctx: ApiContext) -> APIRouter:
    """The object routes over ``ctx.space``."""
    from .server import SafeJSONResponse  # lazy: server.py imports this module
    space = ctx.space
    announce = ctx.announce

    r = APIRouter()

    @r.get("/objects")
    def list_objects(type: str | None = Query(default=None)):
        # A JSONResponse is encoded here, on the worker thread; a plain return would run
        # FastAPI's per-value `jsonable_encoder` on the event loop (audit 2026-11-01 B2:
        # 120 ms per request at 5,000 objects, stalling SSE and every other request).
        out = [asdict(s) for s in space.list(type or None)]
        times = space.file_times
        if times:
            # M32: a note with no stamp of its own (put in by hand) reads its file's time.
            for item in out:
                if not item["lastUpdated"] and not item["createdAt"]:
                    item["lastUpdated"] = times.get(item["path"])
        return SafeJSONResponse(out)

    def summary_out(summary: Any) -> dict[str, Any]:
        """A summary as the app's lists read it: ``lastUpdated`` is the file's modification
        time (`Space.file_times`) for a note whose front matter has neither ``lastUpdated``
        nor ``createdAt``, as in `list_objects`. Nothing is written for it."""
        out = asdict(summary)
        if not out["lastUpdated"] and not out["createdAt"]:
            out["lastUpdated"] = space.file_times.get(out["path"])
        return out

    @r.get("/object")
    def get_object(path: str):
        try:
            of, fm, version = space.read(path)
            try:
                summary = space.get(path)
            except KeyError:
                space.rescan_file(path)
                summary = space.get(path)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{path}".')
        # A file that isn't valid UTF-8 opens read-only (see `read_raw`), so this
        # lossy display copy can never be saved back over the original bytes.
        return _safe(
            {
                "summary": summary_out(summary),
                "frontmatter": fm,
                "body": of.body,
                "version": version,
                "links": space.links_of(path, fm),
                "backlinks": space.backlinks(summary.path),
                "computed": computed_of(summary, space.synced_fm(summary, fm)),
                "counterparts": space.counterparts(summary.path),  # M28: computed, never stored
                **synced_of(summary, fm),
            }
        )

    def synced_of(summary: Any, fm: dict) -> dict[str, Any]:
        """M29: ``{"synced": {refreshedAt, values}}`` when the object's type has synced
        properties (``{}`` otherwise): the store's values, decoded as the rows decode them."""
        t = space.type_by_id(summary.type)
        props = synced_props(t)
        if t is None or not props:
            return {}
        overlaid = space.synced.overlay(t, fm)
        entry = space.synced.entry(t.id, summary.id)
        return {
            "synced": {
                "refreshedAt": (entry.refreshedAt or None) if entry is not None else None,
                "values": {p.key: decode_value(p, overlaid.get(p.key), overlaid) for p in props},
            }
        }

    def computed_of(summary: Any, fm: dict) -> dict[str, Any]:
        """M12: the object's formula and rollup values (``{}`` when it has none)."""
        t = space.type_by_id(summary.type)
        if not has_computed(t):
            return {}
        return Computer(space).values(Obj(summary.path, fm, summary, t))

    def gene_edited(event: ChangeEvent) -> None:
        """Decision S3 (fix pass 2026-11-09): Gene's own edit of a work item, a body save or a
        property set from his window (the event's origin is its client id), starts the item's
        auto-run count again (`workloop.on_change_event`). Only the object he edited: the
        relation-synced, relinked or retyped objects other routes announce are not his action.
        M32: only while Work is on for the space; with Work off the loop is told nothing."""
        from . import server  # tests patch `objectapp.server.on_change_event`

        try:
            if not space.work_on():
                return
            server.on_change_event(space, event)
        except Exception:  # the write is done; the loop's bookkeeping must not fail the request
            logging.getLogger(__name__).exception("Telling the Work loop about an edit of %s failed", event.path)

    def announce_relinked(paths: list[str], client_id: str | None) -> None:
        """``changed`` per relinked object; ``whiteboard`` (its .md) per relinked board file."""
        for path in paths:
            owner = sidecar_owner(path)
            if owner is not None:
                announce(ChangeEvent("whiteboard", owner, None, origin=client_id))
            else:
                announce(ChangeEvent("changed", path, space.cached_version(path), origin=client_id))

    @r.put("/object/body")
    def put_body(req: SaveBodyRequest):
        try:
            version = space.save_body(req.path, req.body, req.baseVersion)
            linked: tuple[str, ...] | None = None
            if version != req.baseVersion:
                # The watcher suppresses the app's own writes; tell every other
                # window (and view) about the new version here instead. The saving window
                # gets no echo, so the response carries `linked` for its local event.
                rel = PurePosixPath(req.path.replace("\\", "/")).as_posix()
                event = announce(ChangeEvent("changed", rel, version, origin=req.clientId))
                linked = event.linked
                gene_edited(event)
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason}, status_code=423)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        out: dict[str, Any] = {"version": version}
        if linked is not None:
            out["linked"] = list(linked)
        return out

    def _norm(path: str) -> str:
        return PurePosixPath(path.replace("\\", "/")).as_posix()

    @r.put("/object/properties")
    def put_properties(req: UpdatePropertiesRequest):
        try:
            result = space.update_properties(
                req.path, req.updates, req.baseVersion, remove=req.remove
            )
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        rel = _norm(req.path)
        linked: tuple[str, ...] | None = None
        if result.version != req.baseVersion:
            # As in `put_body`: the saving window's local event needs `linked` too.
            event = announce(ChangeEvent("changed", rel, result.version, origin=req.clientId))
            linked = event.linked
            gene_edited(event)
        for path in result.synced:
            announce(
                ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId)
            )
        out = {
            "version": result.version,
            "frontmatter": result.frontmatter,
            "links": result.links,
            "synced": result.synced,
            "skipped": [asdict(s) for s in result.skipped],
        }
        if linked is not None:
            out["linked"] = list(linked)
        if result.task is not None:  # only when a Task's status changed category
            out["task"] = result.task.to_api()
        return _safe(out)

    @r.post("/object/counterpart")
    def post_counterpart(req: CounterpartEditRequest):
        """M28: add or remove other objects on a computed other side; each is written on its
        stored side (`Space.edit_counterpart`), the object at ``path`` never."""
        try:
            result = space.edit_counterpart(
                req.path, req.key, req.sourceTypeId, add=req.add, remove=req.remove
            )
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        for path, version in result.written:
            # The first event carries `linked` (the target among them: its counterparts changed).
            announce(ChangeEvent("changed", path, version, origin=req.clientId))
        return _safe(
            {
                "counterparts": result.counterparts,
                "written": [{"path": p, "version": v} for p, v in result.written],
                "skipped": [asdict(s) for s in result.skipped],
            }
        )

    @r.post("/object/ensure-id")
    def ensure_id(req: EnsureIdRequest):
        try:
            before = space.cached_version(req.path)
            object_id, version = space.ensure_id(req.path)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        if version != before:
            announce(ChangeEvent("changed", _norm(req.path), version, origin=req.clientId))
        return {"id": object_id, "version": version}

    @r.post("/object/duplicate", status_code=201)
    def duplicate_object(req: DuplicateRequest):
        try:
            source = space.get(req.path) if req.path else None
        except (KeyError, ValueError):
            source = None
        type_id = source.type if source is not None else None
        rev_before = type_revision(space.root, type_id) if type_id else ""
        try:
            path, version, synced = space.duplicate_object(req.path)
            summary = space.get(path)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        if type_id and type_revision(space.root, type_id) != rev_before:
            # M12: the copy's ID number moved the type's `nextNumber` on (no origin: the
            # duplicating window has no other way to learn the type's new revision).
            announce(ChangeEvent("types", type_id, None))
        announce(ChangeEvent("created", path, version, origin=req.clientId))
        for synced_path in synced:
            announce(
                ChangeEvent("changed", synced_path, space.cached_version(synced_path), origin=req.clientId)
            )
        return JSONResponse(
            _safe({"path": path, "version": version, "summary": asdict(summary)}),
            status_code=201,
        )

    @r.get("/object/export/properties")
    def export_props(path: str):
        try:
            return export_properties(space, path)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{path}".')

    @r.get("/object/export")
    def export(
        path: str,
        media: str = Query(default="0"),
        format: str = Query(default="md"),
        subpages: str = Query(default="0"),
        titleH1: str = Query(default="0"),
        wikilinks: str = Query(default="1"),
        style: str = Query(default="notes"),
        paper: str = Query(default="A4"),
        embedded: str = Query(default="1"),
        outline: str = Query(default="0"),
        hideEmpty: str = Query(default="1"),
        typeLabels: str = Query(default="0"),
        hide: str = Query(default=""),
    ):
        from . import server  # tests patch `objectapp.server.export_object_to_file`

        opts = ExportOptions(
            format=format,
            media=media == "1",
            subpages=subpages == "1",
            title_h1=titleH1 == "1",
            wikilinks=wikilinks != "0",
            style=style if style in ("notes", "essay", "academic") else "notes",
            paper="Letter" if paper.lower() == "letter" else "A4",
            embedded=embedded != "0",
            outline=outline == "1",
            hide_empty=hideEmpty != "0",
            type_labels=typeLabels == "1",
            hidden=frozenset(k for k in hide.split(",") if k),
        )
        try:
            out = server.export_object_to_file(space, path, opts.media, opts)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{path}".')
        if opts.format == "html":
            # The PDF: a page the dialog prints in a frame. Shown, not downloaded; no scripts.
            return Response(
                out.data,
                media_type=out.media_type,
                headers={
                    "X-Content-Type-Options": "nosniff",
                    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
                    "Cache-Control": "no-store",
                },
            )
        headers = {
            "Content-Disposition": content_disposition(out.filename),
            "X-Content-Type-Options": "nosniff",
        }
        if out.file is not None:
            # The zip was streamed to a temp file outside the space; removed once sent.
            return FileResponse(
                out.file, media_type=out.media_type, headers=headers, background=BackgroundTask(out.cleanup)
            )
        return Response(out.data, media_type=out.media_type, headers=headers)

    @r.post("/object/rename")
    def rename_object(req: RenameRequest):
        try:
            result = space.rename_object(req.path, req.title, req.baseVersion)
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        rel = _norm(req.path)
        if result.path != rel:
            renamed = ChangeEvent(
                "renamed", result.path, result.version, origin=req.clientId, oldPath=rel
            )
            announce(renamed)
        elif result.version != req.baseVersion:
            announce(ChangeEvent("changed", rel, result.version, origin=req.clientId))
        announce_relinked(result.relinked, req.clientId)
        return _safe(result.to_api())

    @r.get("/object/change-type")
    def suggest_change_type(path: str, typeId: str):
        try:
            rows = space.suggest_change_type(path, typeId)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{path}" or no object type "{typeId}".')
        return {"rows": [r.to_api() for r in rows]}

    @r.post("/object/change-type")
    def change_type(req: ChangeTypeRequest):
        try:
            result = space.change_type(req.path, req.typeId, req.mapping, req.baseVersion)
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except (ReadOnly, TypeReadOnly) as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}" or no object type "{req.typeId}".')
        rel = _norm(req.path)
        if result.typeWritten:
            announce(ChangeEvent("types", req.typeId, None, origin=req.clientId))
        if result.path != rel:
            announce(
                ChangeEvent(
                    "renamed", result.path, result.version, origin=req.clientId, oldPath=rel
                )
            )
        elif result.version != req.baseVersion:
            announce(ChangeEvent("changed", rel, result.version, origin=req.clientId))
        announce_relinked(result.relinked, req.clientId)
        return _safe(result.to_api())

    def announce_template_ids(before: dict[str, str], client_id: str | None) -> None:
        """Announce ``changed`` for each template that got an ``id`` since ``before``."""
        for path, version in space.template_versions().items():
            if path in before and before[path] != version:
                announce(ChangeEvent("changed", path, version, origin=client_id))

    @r.post("/objects", status_code=201)
    def create_object(req: CreateObjectRequest):
        t = space.type_by_id(req.typeId)
        rev_before = type_revision(space.root, req.typeId) if t is not None else ""
        had_file = bool(rev_before)
        templates_before = space.template_versions()
        try:
            path, version = space.create_object(
                req.typeId, req.title or "", req.templateId, req.values,
                body=req.body, append_body=req.appendBody,
            )
        except InvalidValue as exc:
            announce_template_ids(templates_before, req.clientId)
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no object type "{req.typeId}".')
        type_ids = []
        rev_after = type_revision(space.root, req.typeId) if t is not None else ""
        if t is not None and rev_after and (not had_file or rev_after != rev_before):
            # Written the first time, or M12's ID numbering moved `nextNumber` on.
            announce(ChangeEvent("types", req.typeId, None, origin=req.clientId))
            type_ids.append(req.typeId)
        announce_template_ids(templates_before, req.clientId)
        announce(ChangeEvent("created", path, version, origin=req.clientId))
        return JSONResponse(
            {"path": path, "version": version, "typeIds": type_ids}, status_code=201
        )

    @r.post("/daily-notes", status_code=201)
    def create_daily_note(req: CreateDailyNoteRequest):
        before = space.daily_note_type()
        type_id = before.id if before is not None else "dailynote"
        rev_before = type_revision(space.root, type_id)
        had_file = bool(rev_before)
        templates_before = space.template_versions()
        try:
            path, version = space.create_daily_note(req.date, req.templateId)
        except DailyNoteExists as exc:
            announce_template_ids(templates_before, req.clientId)
            if exc.reason == "exists":
                # M32: the day already has its note, so that note is the answer (200, nothing
                # written, ``existing: true``), not an error. A file of another kind holding
                # the note's name is still 409.
                return JSONResponse(
                    {"path": exc.path, "version": space.cached_version(exc.path),
                     "typeIds": [], "existing": True},
                    status_code=200,
                )  # fmt: skip
            return JSONResponse(
                {"detail": exc.detail, "path": exc.path, "reason": exc.reason}, status_code=409
            )
        except InvalidValue as exc:
            announce_template_ids(templates_before, req.clientId)
            return _error(422, str(exc))
        type_ids = []
        rev_after = type_revision(space.root, type_id)
        if rev_after and (not had_file or rev_after != rev_before):
            announce(ChangeEvent("types", type_id, None, origin=req.clientId))
            type_ids.append(type_id)
        announce_template_ids(templates_before, req.clientId)
        announce(ChangeEvent("created", path, version, origin=req.clientId))
        return JSONResponse(
            {"path": path, "version": version, "typeIds": type_ids}, status_code=201
        )

    @r.delete("/object")
    def delete_object(
        path: str,
        baseVersion: str | None = Query(default=None),
        clientId: str | None = Query(default=None),
    ):
        try:
            summary = space.get(path)
        except (KeyError, ValueError):
            summary = None
        before = space.type_by_id(summary.type) if summary and summary.template else None
        try:
            item = space.delete_object(path, base_version=baseVersion or None)
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{path}".')
        type_ids = []
        if before is not None and space.type_by_id(before.id) is not before:
            announce(ChangeEvent("types", before.id, None, origin=clientId))
            type_ids.append(before.id)
        announce(ChangeEvent("deleted", item.originalPath, None, origin=clientId))
        return {"trashId": item.id, "typeIds": type_ids}

    @r.post("/object/apply-template")
    def apply_template(req: ApplyTemplateRequest):
        templates_before = space.template_versions()
        try:
            version = space.apply_template(req.path, req.templateId, req.baseVersion)
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        finally:
            announce_template_ids(templates_before, req.clientId)
        if version != req.baseVersion:
            announce(ChangeEvent("changed", _norm(req.path), version, origin=req.clientId))
        return {"version": version}


    return r
