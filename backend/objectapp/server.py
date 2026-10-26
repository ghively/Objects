"""The HTTP API over a `Space`, plus the built front end as static files.

Routes (all JSON):

- ``GET /api/space`` -> ``{name, root, types}``
- ``GET /api/objects?type=`` -> ``ObjectSummary[]``
- ``GET /api/object?path=`` -> ``{summary, frontmatter, body, version, links}``
  (``links``: each entity value resolved from this file, ``null`` when dangling)
- ``PUT /api/object/body`` ``{path, body, baseVersion, clientId?}`` -> ``200 {version}``,
  ``409 {currentVersion}`` or ``423 {reason}``. A save that writes announces a
  ``changed`` event with ``origin: clientId``.
- ``PUT /api/object/properties`` ``{path, updates, remove?, baseVersion, clientId?}`` ->
  ``{version, frontmatter, links, synced, skipped}``; ``409 {currentVersion}``,
  ``423 {reason}``, ``422 {detail}``, ``404``. Announces ``changed`` for the
  object (when written) and for each synced object.
- ``POST /api/object/ensure-id`` ``{path, clientId?}`` -> ``{id, version}``; ``423``, ``404``.
- ``POST /api/object/rename`` ``{path, title, baseVersion, clientId?}`` ->
  ``{path, version, relinked, skipped}``; ``409 {currentVersion}``, ``423``, ``422 {detail}``
  (empty title, daily note), ``404``. Announces ``renamed`` (with ``oldPath``) when the
  file moved, else ``changed`` when written, and ``changed`` for each relinked object.
- ``GET /api/object/change-type?path=&typeId=`` -> ``{rows: [{fromKey, toKey, lossy}]}``
  (the suggested mapping); ``422`` when the type can't change (or be changed to), ``404``.
- ``POST /api/object/change-type`` ``{path, typeId, mapping, baseVersion, clientId?}`` ->
  ``{path, version, relinked, skipped}``; ``409 {currentVersion}``, ``423``, ``422 {detail}``,
  ``404``. Announces ``renamed`` (with ``oldPath``) when the file moved, ``changed`` for each
  relinked object, and ``types`` when the target type's JSON was written.
- ``POST /api/objects`` ``{typeId, title?, templateId?, clientId?}`` -> ``201 {path, version, typeIds}``;
  ``404`` for an unknown type. Announces ``created`` (and ``types`` when an
  inferred type was saved for the first time).
- ``DELETE /api/object?path=&baseVersion=&clientId=`` -> ``{trashId, typeIds}``; ``404``,
  ``409 {currentVersion}``. Moves the file to the trash; announces ``deleted``.
- ``GET /api/trash`` -> ``TrashItem[]``; ``POST /api/trash/{id}/restore?clientId=`` ->
  ``{paths, typeIds}`` (announces ``created`` per path and ``types`` per type); ``422`` when a
  saved type now has the trashed type's id or name;
  ``DELETE /api/trash/{id}`` and ``DELETE /api/trash`` -> ``{purged}``; ``404``.
- ``POST /api/types`` ``{name, pluralName, icon?, color?, clientId?}`` -> ``201 TypeDef``;
  ``422``. Announces ``types``.
- ``PUT /api/types/{id}`` ``{type, baseRevision, confirm?, clientId?}`` ->
  ``{type, rewritten, skipped}`` (``type.revision`` is the new revision);
  ``409 {currentRevision}``, ``422 {detail}``, ``423``, ``428 {detail, affected}``, ``404``.
  Announces ``types`` and ``changed`` for each rewritten file.
- ``POST /api/types/{id}/properties/{pid}/change-kind`` ``{toType, baseRevision, clientId?}``
  -> ``{type, newPropertyId, rewritten, skipped, lossy}``; ``409 {currentRevision}``,
  ``422 {detail}``, ``423``, ``404``. Announces ``types`` and ``changed`` per rewritten file.
- ``POST /api/types/{id}/properties/{pid}/sync``
  ``{targetPropertyId, createName?, baseRevision, clientId?}`` -> ``{types, rewritten, skipped}``;
  ``409 {currentRevision}``, ``422 {detail}``, ``423``, ``404``. Announces ``types`` per
  changed type and ``changed`` per backfilled object.
- ``DELETE /api/types/{id}?confirm=true&clientId=`` -> ``{trashId, paths, typeIds}``; ``422``,
  ``428 {detail, affected}``, ``404``. Announces ``types`` (this type and each type
  whose relations stopped allowing it) and ``deleted`` per object and template.
- ``GET /api/types/{id}/templates`` -> ``ObjectSummary[]`` (``templates.ids`` order, then
  discovered ones); ``404``. ``POST /api/types/{id}/templates`` ``{name?, clientId?}`` ->
  ``201 {path, version}``; ``422`` (a type without templates), ``423``, ``404``. Announces
  ``created`` and ``types``.
- ``POST /api/object/apply-template`` ``{path, templateId, baseVersion, clientId?}`` ->
  ``{version}``; ``409 {currentVersion}``, ``422 {detail}`` ("Could not apply the template"),
  ``423``, ``404``. Announces ``changed``. ``POST /api/objects`` applies the type's default
  template unless ``templateId`` is ``"none"``; ``DELETE /api/object`` on a template also
  drops it from its type's ``templates`` (announcing ``types``).
- ``POST /api/tags/ensure`` ``{name, clientId?}`` -> ``{path, created}`` (the Tag object
  named so, case-insensitively, created in ``Tags/`` when missing); ``422`` for an empty
  name. Announces ``created`` when it created one. Renaming a Tag (``/api/object/rename``)
  also renames it in every ``tags:`` list; those files are in ``relinked``.
- ``GET /api/images`` -> ``{path}[]`` (image files outside dot-folders);
  ``POST /api/images?name=`` (raw bytes) -> ``201 {path}`` (``Attachments/<safe name>``),
  ``415`` for a name without an image extension. ``GET /api/file?path=`` -> the image's
  bytes; ``415`` for a non-image extension, ``404`` when missing, in a dot-folder or
  outside the space.
- ``GET /api/resolve?link=&from=`` -> ``{path}`` or ``404``
- ``POST /api/reveal`` ``{path}`` -> ``200 {ok}``: show the file in the OS file manager
- ``GET /api/events`` -> Server-Sent Events; event ``change`` with a
  `ChangeEvent` as JSON data (``{kind, path, version, origin}``)

Errors: a path outside the space or not an object is ``400``; a missing object is ``404``;
a file the OS refused to write (locked by another program, say) is ``503 {detail}``.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import subprocess
import sys
import threading
from collections.abc import AsyncIterator
from dataclasses import asdict
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette import EventSourceResponse, ServerSentEvent

from .media import NotAnImage, image_media_type, image_path, import_image, list_images
from .propvalues import InvalidValue
from .space import ConfirmRequired, Conflict, ReadOnly, Space
from .typedefs import has_undecodable
from .typemodel import RevisionConflict, TypeDefinition, TypeReadOnly, type_revision
from .watcher import ChangeEvent, SpaceWatcher

__all__ = ["EventHub", "create_app"]


class EventHub:
    """Fans `ChangeEvent`s out to every connected SSE client (one queue each)."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[ChangeEvent | None]] = set()
        self._lock = threading.Lock()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.closed = False

    def publish(self, event: ChangeEvent) -> None:
        """Deliver `event` to all subscribers. Call on the hub's event loop."""
        with self._lock:
            subscribers = list(self._subscribers)
        for q in subscribers:
            q.put_nowait(event)

    def close(self) -> None:
        """End every open stream. Safe to call from any thread."""
        self.closed = True
        with self._lock:
            subscribers = list(self._subscribers)
        loop = self.loop
        for q in subscribers:
            if loop is not None and loop.is_running():
                loop.call_soon_threadsafe(q.put_nowait, None)
            else:
                q.put_nowait(None)

    async def subscribe(self) -> AsyncIterator[ChangeEvent]:
        q: asyncio.Queue[ChangeEvent | None] = asyncio.Queue()
        with self._lock:
            self._subscribers.add(q)
        try:
            while not self.closed:
                event = await q.get()
                if event is None:
                    return
                yield event
        finally:
            with self._lock:
                self._subscribers.discard(q)


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
    clientId: str | None = None


class CreateTemplateRequest(BaseModel):
    name: str | None = None
    clientId: str | None = None


class ApplyTemplateRequest(BaseModel):
    path: str
    templateId: str
    baseVersion: str
    clientId: str | None = None


class CreateTypeRequest(BaseModel):
    name: str = ""
    pluralName: str = ""
    icon: Any = None
    color: str | None = None
    clientId: str | None = None


class SaveTypeRequest(BaseModel):
    type: dict[str, Any]
    baseRevision: str = ""
    confirm: bool = False
    clientId: str | None = None


class ChangeKindRequest(BaseModel):
    toType: str
    baseRevision: str = ""
    clientId: str | None = None


class EnsureTagRequest(BaseModel):
    name: str = ""
    clientId: str | None = None


class SyncRequest(BaseModel):
    targetPropertyId: str | None = None
    createName: str | None = None
    baseRevision: str = ""
    clientId: str | None = None


def _display_safe(value):
    """`value` with undecodable bytes (surrogate escapes) shown as U+FFFD, so it can be JSON."""
    if isinstance(value, str):
        if has_undecodable(value):
            return value.encode("utf-8", errors="surrogateescape").decode("utf-8", errors="replace")
        return value
    if isinstance(value, dict):
        return {_display_safe(k): _display_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_display_safe(v) for v in value]
    return value


class RevealRequest(BaseModel):
    path: str


def reveal_in_file_manager(path: Path) -> None:
    """Show `path` in Explorer (selected), Finder, or the desktop's file manager."""
    if sys.platform == "win32":
        subprocess.Popen(["explorer", f"/select,{os.path.normpath(path)}"])  # noqa: S603, S607
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(path)])  # noqa: S603, S607
    else:
        subprocess.Popen(["xdg-open", str(path.parent)])  # noqa: S603, S607


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def create_app(space: Space, static_dir: Path | None = None, watch: bool = True) -> FastAPI:
    """The app for `space`. With `watch`, a `SpaceWatcher` runs for the app's lifespan."""
    hub = EventHub()

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI):
        hub.loop = asyncio.get_running_loop()
        hub.closed = False
        if not watch:
            yield
            hub.close()
            return
        watcher = SpaceWatcher(space, hub.loop)
        watcher.start()

        async def pump() -> None:
            while True:
                hub.publish(await watcher.events.get())

        task = asyncio.create_task(pump())
        try:
            yield
        finally:
            hub.close()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            await asyncio.to_thread(watcher.stop)

    app = FastAPI(
        title="Object", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.space = space
    app.state.hub = hub

    @app.exception_handler(OSError)
    async def os_error(_request: Request, exc: OSError) -> JSONResponse:
        # A file locked by another program (Windows sharing violations) or a
        # transient file-system failure: report it as JSON the client can show
        # and retry, never as a bare 500.
        if isinstance(exc, PermissionError):
            detail = "A file is in use by another program. Try again in a moment."
        else:
            detail = f"The file system refused the change: {exc.strerror or exc}"
        return JSONResponse({"detail": detail, "reason": detail}, status_code=503)
    api = APIRouter(prefix="/api")

    @api.get("/space")
    def get_space():
        return {
            "name": space.name,
            "root": str(space.root),
            "types": [t.to_api(rev) for t, rev in space.types_with_revisions()],
        }

    @api.get("/objects")
    def list_objects(type: str | None = Query(default=None)):
        return _display_safe([asdict(s) for s in space.list(type or None)])

    @api.get("/object")
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
            return _error(404, f"No object at {path!r}")
        # A file that isn't valid UTF-8 opens read-only (see `read_raw`), so this
        # lossy display copy can never be saved back over the original bytes.
        return _display_safe(
            {
                "summary": asdict(summary),
                "frontmatter": fm,
                "body": of.body,
                "version": version,
                "links": space.links_of(path, fm),
            }
        )

    def announce(event: ChangeEvent) -> None:
        """Publish `event` to the SSE clients from a worker thread."""
        loop = hub.loop
        if loop is not None and loop.is_running() and not hub.closed:
            loop.call_soon_threadsafe(hub.publish, event)

    @api.put("/object/body")
    def put_body(req: SaveBodyRequest):
        try:
            version = space.save_body(req.path, req.body, req.baseVersion)
            if version != req.baseVersion:
                # The watcher suppresses the app's own writes; tell every other
                # window (and view) about the new version here instead.
                rel = PurePosixPath(req.path.replace("\\", "/")).as_posix()
                announce(ChangeEvent("changed", rel, version, origin=req.clientId))
        except Conflict as exc:
            return JSONResponse({"currentVersion": exc.current_version}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason}, status_code=423)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No object at {req.path!r}")
        return {"version": version}

    def _norm(path: str) -> str:
        return PurePosixPath(path.replace("\\", "/")).as_posix()

    @api.put("/object/properties")
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
            return _error(404, f"No object at {req.path!r}")
        rel = _norm(req.path)
        if result.version != req.baseVersion:
            announce(ChangeEvent("changed", rel, result.version, origin=req.clientId))
        for path in result.synced:
            announce(
                ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId)
            )
        return _display_safe(
            {
                "version": result.version,
                "frontmatter": result.frontmatter,
                "links": result.links,
                "synced": result.synced,
                "skipped": [asdict(s) for s in result.skipped],
            }
        )

    @api.post("/object/ensure-id")
    def ensure_id(req: EnsureIdRequest):
        try:
            before = space.cached_version(req.path)
            object_id, version = space.ensure_id(req.path)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No object at {req.path!r}")
        if version != before:
            announce(ChangeEvent("changed", _norm(req.path), version, origin=req.clientId))
        return {"id": object_id, "version": version}

    @api.post("/object/rename")
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
            return _error(404, f"No object at {req.path!r}")
        rel = _norm(req.path)
        if result.path != rel:
            renamed = ChangeEvent(
                "renamed", result.path, result.version, origin=req.clientId, oldPath=rel
            )
            announce(renamed)
        elif result.version != req.baseVersion:
            announce(ChangeEvent("changed", rel, result.version, origin=req.clientId))
        for path in result.relinked:
            announce(
                ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId)
            )
        return _display_safe(result.to_api())

    @api.get("/object/change-type")
    def suggest_change_type(path: str, typeId: str):
        try:
            rows = space.suggest_change_type(path, typeId)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No object at {path!r} or no object type {typeId!r}")
        return {"rows": [r.to_api() for r in rows]}

    @api.post("/object/change-type")
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
            return _error(404, f"No object at {req.path!r} or no object type {req.typeId!r}")
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
        for path in result.relinked:
            announce(
                ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId)
            )
        return _display_safe(result.to_api())

    def announce_template_ids(before: dict[str, str], client_id: str | None) -> None:
        """Announce ``changed`` for each template that got an ``id`` since ``before``."""
        for path, version in space.template_versions().items():
            if path in before and before[path] != version:
                announce(ChangeEvent("changed", path, version, origin=client_id))

    @api.post("/objects", status_code=201)
    def create_object(req: CreateObjectRequest):
        t = space.type_by_id(req.typeId)
        had_file = bool(type_revision(space.root, req.typeId)) if t is not None else False
        templates_before = space.template_versions()
        try:
            path, version = space.create_object(req.typeId, req.title or "", req.templateId)
        except InvalidValue as exc:
            announce_template_ids(templates_before, req.clientId)
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f"No object type {req.typeId!r}")
        type_ids = []
        if t is not None and not had_file and type_revision(space.root, req.typeId):
            announce(ChangeEvent("types", req.typeId, None, origin=req.clientId))
            type_ids.append(req.typeId)
        announce_template_ids(templates_before, req.clientId)
        announce(ChangeEvent("created", path, version, origin=req.clientId))
        return JSONResponse(
            {"path": path, "version": version, "typeIds": type_ids}, status_code=201
        )

    @api.delete("/object")
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
            return _error(404, f"No object at {path!r}")
        type_ids = []
        if before is not None and space.type_by_id(before.id) is not before:
            announce(ChangeEvent("types", before.id, None, origin=clientId))
            type_ids.append(before.id)
        announce(ChangeEvent("deleted", item.originalPath, None, origin=clientId))
        return {"trashId": item.id, "typeIds": type_ids}

    @api.get("/types/{type_id}/templates")
    def list_templates(type_id: str):
        try:
            return _display_safe([asdict(s) for s in space.list_templates(type_id)])
        except KeyError:
            return _error(404, f"No object type {type_id!r}")

    @api.post("/types/{type_id}/templates", status_code=201)
    def create_template(type_id: str, req: CreateTemplateRequest):
        try:
            path, version = space.create_template(type_id, req.name or "New template")
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f"No object type {type_id!r}")
        announce(ChangeEvent("types", type_id, None, origin=req.clientId))
        announce(ChangeEvent("created", path, version, origin=req.clientId))
        return JSONResponse({"path": path, "version": version}, status_code=201)

    @api.post("/object/apply-template")
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
            return _error(404, f"No object at {req.path!r}")
        finally:
            announce_template_ids(templates_before, req.clientId)
        if version != req.baseVersion:
            announce(ChangeEvent("changed", _norm(req.path), version, origin=req.clientId))
        return {"version": version}

    @api.get("/trash")
    def list_trash():
        return _display_safe([i.to_api() for i in space.list_trash()])

    @api.post("/trash/{trash_id}/restore")
    def restore_trash(trash_id: str, clientId: str | None = Query(default=None)):
        try:
            result = space.restore(trash_id)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f"No trash entry {trash_id!r}")
        for type_id in result["typeIds"]:
            announce(ChangeEvent("types", type_id, None, origin=clientId))
        for path in result["paths"]:
            announce(ChangeEvent("created", path, space.cached_version(path), origin=clientId))
        return result

    @api.delete("/trash/{trash_id}")
    def purge_trash(trash_id: str, clientId: str | None = Query(default=None)):
        del clientId  # purging touches no visible file
        try:
            return {"purged": space.purge(trash_id)}
        except KeyError:
            return _error(404, f"No trash entry {trash_id!r}")

    @api.delete("/trash")
    def empty_trash(clientId: str | None = Query(default=None)):
        del clientId
        return {"purged": space.empty_trash()}

    @api.post("/types", status_code=201)
    def create_type(req: CreateTypeRequest):
        try:
            t = space.create_type(req.name, req.pluralName, icon=req.icon, color=req.color)
        except InvalidValue as exc:
            return _error(422, str(exc))
        announce(ChangeEvent("types", t.id, None, origin=req.clientId))
        return JSONResponse(t.to_api(type_revision(space.root, t.id)), status_code=201)

    @api.put("/types/{type_id}")
    def save_type(type_id: str, req: SaveTypeRequest):
        data = {**req.type, "id": type_id}
        data.setdefault("schemaVersion", 2)
        for field in ("name", "pluralName"):
            # `from_json` would fill these in; an edit that clears them is refused.
            if not isinstance(data.get(field), str) or not data[field].strip():
                return _error(422, "An object type needs a name and a plural name")
        try:
            t = TypeDefinition.from_json(data, fallback_id=type_id)
            result = space.save_type(t, req.baseRevision, confirm=req.confirm)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except ConfirmRequired as exc:
            return JSONResponse({"detail": exc.detail, "affected": exc.affected}, status_code=428)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f"No object type {type_id!r}")
        announce(ChangeEvent("types", type_id, None, origin=req.clientId))
        for path in result.rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        return _display_safe(result.to_api())

    @api.post("/types/{type_id}/properties/{pid}/change-kind")
    def change_kind(type_id: str, pid: str, req: ChangeKindRequest):
        try:
            result = space.change_property_kind(type_id, pid, req.toType, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f"No property {pid!r} on object type {type_id!r}")
        announce(ChangeEvent("types", type_id, None, origin=req.clientId))
        for path in result.rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        return _display_safe(result.to_api())

    @api.post("/types/{type_id}/properties/{pid}/sync")
    def sync_property(type_id: str, pid: str, req: SyncRequest):
        try:
            result = space.set_property_sync(
                type_id,
                pid,
                req.targetPropertyId,
                create_name=req.createName,
                base_revision=req.baseRevision,
            )
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f"No property {pid!r} on object type {type_id!r}")
        for t in result.types:
            announce(ChangeEvent("types", t.id, None, origin=req.clientId))
        for path in result.rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        return _display_safe(result.to_api())

    @api.delete("/types/{type_id}")
    def delete_type(
        type_id: str,
        confirm: bool = Query(default=False),
        clientId: str | None = Query(default=None),
    ):
        try:
            item = space.delete_type(type_id, confirm=confirm)
        except ConfirmRequired as exc:
            return JSONResponse({"detail": exc.detail, "affected": exc.affected}, status_code=428)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f"No object type {type_id!r}")
        manifest = space.trash.manifest(item.id) or {}
        type_ids = [type_id]
        for ref in manifest.get("allowedTypesRefs") or []:
            other = str(ref.get("typeId"))
            if other not in type_ids:
                type_ids.append(other)
        for tid in type_ids:
            announce(ChangeEvent("types", tid, None, origin=clientId))
        paths = [str(p) for p in manifest.get("templates") or []]
        for oid in manifest.get("objectTrashIds") or []:
            meta = space.trash.object_meta(oid)
            if meta is not None:
                paths.append(str(meta.get("originalPath", "")))
        for path in paths:
            announce(ChangeEvent("deleted", path, None, origin=clientId))
        # The window that deleted can't list these itself: tell it what changed.
        return {"trashId": item.id, "paths": paths, "typeIds": type_ids}

    @api.post("/tags/ensure")
    def ensure_tag(req: EnsureTagRequest):
        try:
            path, created = space.ensure_tag(req.name)
        except InvalidValue as exc:
            return _error(422, str(exc))
        if created:
            announce(ChangeEvent("created", path, space.cached_version(path), origin=req.clientId))
        return {"path": path, "created": created}

    @api.get("/images")
    def get_images():
        return _display_safe(list_images(space.root))

    @api.post("/images", status_code=201)
    async def post_image(request: Request, name: str = Query(default="")):
        data = await request.body()
        try:
            path = await asyncio.to_thread(import_image, space.root, name, data)
        except NotAnImage:
            return _error(415, "Only png, jpg, jpeg, gif, webp and svg images can be added")
        return JSONResponse({"path": path}, status_code=201)

    @api.get("/file")
    def get_file(path: str):
        try:
            full = image_path(space.root, path)
        except NotAnImage:
            return _error(415, "Only image files can be served")
        except (FileNotFoundError, OSError):
            return _error(404, f"No image at {path!r}")
        # An SVG can carry script: never let a served image run anything.
        headers = {
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            "X-Content-Type-Options": "nosniff",
        }
        return FileResponse(full, media_type=image_media_type(full.name), headers=headers)

    @api.get("/resolve")
    def resolve(link: str, from_: str | None = Query(default=None, alias="from")):
        path = space.resolve(link, from_ or None)
        if path is None:
            return _error(404, f"No object matches {link!r}")
        return {"path": path}

    @api.post("/reveal")
    def reveal(req: RevealRequest):
        try:
            full = space.abspath(req.path)
        except ValueError as exc:
            return _error(400, str(exc))
        if not full.is_file():
            return _error(404, f"No object at {req.path!r}")
        reveal_in_file_manager(full)
        return {"ok": True}

    @api.get("/events")
    async def events():
        async def stream():
            async for event in hub.subscribe():
                yield ServerSentEvent(event="change", data=json.dumps(asdict(event)))

        return EventSourceResponse(stream(), ping=15)

    app.include_router(api)

    if static_dir is not None and Path(static_dir).is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app
