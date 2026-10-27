"""The HTTP API over a `Space`, plus the built front end as static files.

Routes (all JSON):

- ``GET /api/space`` -> ``{name, root, types}``
- ``GET /api/objects?type=`` -> ``ObjectSummary[]``
- ``POST /api/rows`` ``{typeIds?, collectionIds?, paths?, search?: {terms, mode}}`` ->
  ``{rows: [{summary, version, values, links, preview}]}``; ``422`` for a bad search.
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
- ``DELETE /api/collections/{id}?confirm=true&clientId=`` -> ``{trashId, removedFrom, skipped, deleted}``
  (``deleted``: the sole members moved to the trash);
  ``404``, ``428 {detail, affected}``, ``423``. ``POST /api/trash/{id}/restore`` of a collection
  entry also answers ``409`` (name taken, or its id is used by another definition).
- ``GET /api/queries`` -> ``Query[]``; ``POST /api/queries`` ``{name?, definition?, view?, clientId?}``
  -> ``201 Query`` (``422``); ``PUT /api/queries/{id}`` ``{query, baseRevision, clientId?}`` ->
  ``{query}`` (``404``, ``409 {currentRevision}``, ``422``, ``423``);
  ``DELETE /api/queries/{id}?clientId=`` -> ``{trashId}`` (restorable; ``404``, ``423``).
  Announces ``queries``. Restoring one re-creates its file under the original id
  (``409`` when that file exists).
- ``GET /api/trash`` -> ``TrashItem[]``; ``POST /api/trash/{id}/restore?clientId=`` ->
  ``{paths, typeIds, rewritten}`` (plus ``collectionIds``, ``queryIds``, ``skipped`` for a
  collection or query entry; ``rewritten``: other files written back, announced ``changed``;
  announces ``created`` per path and ``types`` per type); ``422`` when a
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
  ``415`` for a name without an image extension (kept for M2's cover-image picker).
- M7 attachments: ``GET /api/attachments`` -> ``{path, kind, size}[]`` (files outside
  dot-folders whose kind isn't ``file``, plus everything under ``Attachments/``; never
  objects or whiteboard sidecars), sorted by path. ``POST /api/attachments?name=`` (raw
  bytes) -> ``201 {path, kind}`` (``Attachments/<safe name>.<ext>``, `` (2)`` when taken,
  never overwritten); ``413`` over 100 MiB, ``422`` empty or unusable name.
  ``GET /api/file?path=`` -> the file's bytes with per-kind headers (images: CSP
  ``sandbox``; pdf, audio, video: inline, ranges answered ``206``; any other file:
  ``application/octet-stream`` as an attachment; ``nosniff`` on all); ``415`` for a ``.md``
  file, ``404`` when missing, in a dot-folder, outside the space or a whiteboard sidecar.
  ``POST /api/attachments/open`` ``{path}`` -> ``{ok}`` (opened with the OS default app);
  ``404`` as above, ``415`` for an executable or script (or a ``.md``).
- M7 spaces (the registry is ``<state dir>/spaces.json``; no folder is ever deleted):
  ``GET /api/spaces`` -> ``{spaces: {path, name, icon, current, missing, lastOpened}[]}``
  (registry order, the current space always listed; never writes). ``POST /api/spaces``
  ``{name, location}`` -> ``201 {path}`` (a new folder holding only ``.capacities/space.json``,
  registered); ``409`` the folder exists, ``422`` bad name, ``404`` not a folder.
  ``POST /api/spaces/open`` ``{path}`` -> ``{path}`` (registers an existing folder; ``404``).
  ``DELETE /api/spaces?path=`` -> ``{ok}`` (registry only; ``409`` for the current space).
  ``POST /api/spaces/switch`` ``{path}`` -> ``202 {path}``, then the launcher restarts the
  server on that folder on the same port; ``404`` not a folder, ``503`` without the launcher.
- ``GET /api/resolve?link=&from=`` -> ``{path}`` or ``404``
- ``POST /api/reveal`` ``{path}`` -> ``200 {ok}``: show the file in the OS file manager
- ``GET /api/events`` -> Server-Sent Events; event ``change`` with a
  `ChangeEvent` as JSON data (``{kind, path, version, origin}``)
- M6 whiteboards (`whiteboardapi.whiteboard_router`): ``GET /api/whiteboard?path=`` ->
  ``{path, board, revision, readOnlyReason?}``; ``PUT /api/whiteboard``
  ``{path, board, baseRevision, clientId?}`` -> ``{revision}`` (``409 {currentRevision}``,
  ``422``, ``423``); ``GET /api/whiteboard/ink?path=`` -> ``{path, strokes, revision,
  readOnlyReason?}``; ``PUT /api/whiteboard/ink`` ``{path, strokes, baseRevision, clientId?}``
  -> ``{revision}``; ``POST /api/whiteboards`` ``{title?, clientId?}`` ->
  ``201 {path, version, typeIds}``. Board and ink saves announce ``whiteboard`` with the
  board's ``.md`` path. ``PUT /api/ui`` accepts ``whiteboard`` (the canvas display settings).
  Deleting, restoring, purging and renaming a whiteboard carry its sidecar files; a rename
  relinks board files too (their sidecar paths are in ``relinked``, announced ``whiteboard``).

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
from collections.abc import AsyncIterator, Callable
from dataclasses import asdict
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette import EventSourceResponse, ServerSentEvent

from . import api_graph, api_references, api_search, media
from .apictx import ApiContext
from .appstate import state_dir
from .collections import CollectionDef
from .jsonstore import (
    DefinitionUnreadable,
    default_views,
    json_revision,
    normalize_views,
)
from .media import (
    NotAnImage,
    NotServed,
    RefusedToOpen,
    TooLarge,
    attachment_media_type,
    attachment_path,
    import_attachment,
    import_image,
    kind_of,
    list_attachments,
    list_images,
    open_with_system,
    serve_headers,
)
from .notify import FileNotifier, system_notifier
from .propvalues import InvalidValue
from .queries import QueryDef
from .reminders import ReminderScheduler, file_clock
from .searchindex import SearchIndex
from .settings import SettingsProblem
from .settings import patch as patch_settings
from .settings import read as read_settings
from .space import (
    ConfirmRequired,
    Conflict,
    DailyNoteExists,
    ReadOnly,
    RestoreConflict,
    Space,
)
from .spaceconfig import SpaceConfigProblem, space_fields
from .spaceconfig import patch as patch_space_config
from .spaces import Registry, SpaceNameProblem, create_space, normalize
from .typedefs import has_undecodable
from .typemodel import (
    RevisionConflict,
    TypeDefinition,
    TypeReadOnly,
    option_shape_problems,
    type_revision,
)
from .uistate import patch_ui, read_ui, ui_read_only_reason, ui_with_defaults
from .watcher import ChangeEvent, SpaceWatcher
from .whiteboardapi import whiteboard_router
from .whiteboardfile import sidecar_owner
from .whiteboardstore import whiteboard_ui_problem

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
    values: dict[str, Any] | None = None
    clientId: str | None = None


class CreateDailyNoteRequest(BaseModel):
    date: str
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


class SaveViewsRequest(BaseModel):
    views: dict[str, Any]
    baseRevision: str = ""
    clientId: str | None = None


class RowsSearch(BaseModel):
    terms: list[str] = []
    mode: str = "auto"


class RowsRequest(BaseModel):
    typeIds: list[str] | None = None
    collectionIds: list[str] | None = None
    paths: list[str] | None = None
    search: RowsSearch | None = None


class PatchUiRequest(BaseModel):
    patch: dict[str, Any]
    baseRevision: str = ""
    clientId: str | None = None


class CreateCollectionRequest(BaseModel):
    name: str = ""
    typeIds: list[str] = []
    icon: Any = None
    clientId: str | None = None


class SaveCollectionRequest(BaseModel):
    collection: dict[str, Any]
    baseRevision: str = ""
    clientId: str | None = None


class CreateQueryRequest(BaseModel):
    name: str | None = None
    definition: dict[str, Any] | None = None
    view: dict[str, Any] | None = None
    clientId: str | None = None


class SaveQueryRequest(BaseModel):
    query: dict[str, Any]
    baseRevision: str = ""
    clientId: str | None = None


_UI_PATCH_KEYS = frozenset(
    {"pinned", "sections", "allNotesLayout", "calendar", "tasks", "reminders", "graph", "whiteboard"}
)
# RootSpace.model.ts `GraphViewCustomization`, verbatim.
_GRAPH_LIST_KEYS = ("filterStructureIds", "excludeStructureIds")
_GRAPH_BOOL_KEYS = (
    "showCompletedTasks",
    "showMinimalNodes",
    "hideLargeNodes",
    "hideDates",
    "hideIndirectLinks",
    "showTagsNetwork",
    "showSpaceTagsNetwork",
)
_WEEK_STARTS = ("sunday", "monday")
_CALENDAR_HIDE_KEYS = (
    "hideDailyNote",
    "hideTasks",
    "hideDated",
    "hideCreatedOnDay",
    "hideUpdated",
    "hideCreateObjects",
)
_CALENDAR_VIEW_KEYS = ("tasksView", "createdView", "updatedView", "datedView")
_TASK_SECTION_KEYS = frozenset(
    {
        "status",
        "today",
        "inbox",
        "open",
        "deadline",
        "scheduled",
        "recurring",
        "reminders",
        "tags",
        "completed",
        "source",
    }
)


class PatchSpaceRequest(BaseModel):
    patch: dict[str, Any]
    baseRevision: str = ""
    clientId: str | None = None


class PatchSettingsRequest(BaseModel):
    patch: dict[str, Any]
    baseRevision: str = ""


class CreateSpaceRequest(BaseModel):
    name: str = ""
    location: str = ""


class SpacePathRequest(BaseModel):
    path: str = ""


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


class OpenAttachmentRequest(BaseModel):
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


def _views_problem(views: dict[str, Any]) -> str | None:
    """Why a PUT /api/views body is not a Views object, else None."""
    if "activeTab" in views and not isinstance(views["activeTab"], str):
        return "activeTab must be a string."
    if "all" in views and not isinstance(views["all"], dict):
        return "all must be an object."
    if "dashboard" in views:
        dash = views["dashboard"]
        if not isinstance(dash, dict):
            return "dashboard must be an object."
        sections = dash.get("sections", [])
        if not isinstance(sections, list) or not all(
            isinstance(x, dict) and isinstance(x.get("key"), str) for x in sections
        ):
            return "dashboard.sections must be a list of sections with a key."
        if not isinstance(dash.get("removedSections", []), list):
            return "dashboard.removedSections must be a list."
    return None


def _ui_problem(patch: dict[str, Any]) -> str | None:
    """Why a PUT /api/ui patch has the wrong shape, else None."""
    if "pinned" in patch:
        pinned = patch["pinned"]
        if not isinstance(pinned, list) or not all(
            isinstance(p, dict) and isinstance(p.get("kind"), str) and isinstance(p.get("id"), str)
            for p in pinned
        ):
            return "pinned must be a list of {kind, id}."
    if "sections" in patch:
        sections = patch["sections"]
        if not isinstance(sections, list) or not all(
            isinstance(x, dict) and isinstance(x.get("items", []), list) for x in sections
        ):
            return "sections must be a list of sections with a list of items."
    if "allNotesLayout" in patch and not isinstance(patch["allNotesLayout"], str):
        return "allNotesLayout must be a string."
    if "calendar" in patch:
        problem = _calendar_ui_problem(patch["calendar"])
        if problem:
            return problem
    if "tasks" in patch:
        problem = _tasks_ui_problem(patch["tasks"])
        if problem:
            return problem
    if "reminders" in patch:
        reminders = patch["reminders"]
        if not isinstance(reminders, dict) or not isinstance(reminders.get("enabled"), bool):
            return "reminders must be {enabled: true|false}."
    if "graph" in patch:
        problem = _graph_ui_problem(patch["graph"])
        if problem:
            return problem
    if "whiteboard" in patch:
        problem = whiteboard_ui_problem(patch["whiteboard"])
        if problem:
            return problem
    return None


def _graph_ui_problem(graph: Any) -> str | None:
    """Why a ``graph`` ui patch is not a ``GraphViewCustomization``, else None."""
    if not isinstance(graph, dict):
        return "graph must be an object."
    unknown = sorted(set(graph) - set(_GRAPH_LIST_KEYS) - set(_GRAPH_BOOL_KEYS))
    if unknown:
        return f"Cannot patch: {', '.join(f'graph.{k}' for k in unknown)}"
    for key in _GRAPH_LIST_KEYS:
        if key in graph and not (
            isinstance(graph[key], list) and all(isinstance(x, str) for x in graph[key])
        ):
            return f"graph.{key} must be a list of type ids."
    for key in _GRAPH_BOOL_KEYS:
        if key in graph and not isinstance(graph[key], bool):
            return f"graph.{key} must be true or false."
    return None


def _calendar_ui_problem(cal: Any) -> str | None:
    """Why a ``calendar`` ui patch is not a ``CalendarUi``, else None."""
    if not isinstance(cal, dict):
        return "calendar must be an object."
    if "weekStart" in cal and cal["weekStart"] not in _WEEK_STARTS:
        return "calendar.weekStart must be 'sunday' or 'monday'."
    if "hideCalendarSidebar" in cal and not isinstance(cal["hideCalendarSidebar"], bool):
        return "calendar.hideCalendarSidebar must be true or false."
    if "daily" in cal:
        daily = cal["daily"]
        if not isinstance(daily, dict):
            return "calendar.daily must be an object."
        for key in _CALENDAR_HIDE_KEYS:
            if key in daily and not isinstance(daily[key], bool):
                return f"calendar.daily.{key} must be true or false."
        for key in _CALENDAR_VIEW_KEYS:
            if key in daily and not isinstance(daily[key], dict):
                return f"calendar.daily.{key} must be a view state object."
    return None


def _tasks_ui_problem(tasks: Any) -> str | None:
    """Why a ``tasks`` ui patch is not a ``TasksUi``, else None."""
    if not isinstance(tasks, dict):
        return "tasks must be an object."
    if "activeTab" in tasks and tasks["activeTab"] not in _TASK_SECTION_KEYS:
        return "tasks.activeTab must be a task section key."
    if "views" in tasks:
        views = tasks["views"]
        if not isinstance(views, dict) or not all(
            k in _TASK_SECTION_KEYS and isinstance(v, dict) for k, v in views.items()
        ):
            return "tasks.views must map task section keys to view state objects."
    return None


def create_app(
    space: Space,
    static_dir: Path | None = None,
    watch: bool = True,
    on_switch: Callable[[Path], None] | None = None,
) -> FastAPI:
    """The app for `space`. With `watch`, a `SpaceWatcher` runs for the app's lifespan.

    `on_switch` is the launcher's ``SpaceHost.request_switch``: ``POST
    /api/spaces/switch`` calls it with the new space's folder once the response is
    sent. Without it that route answers 503.

    The reminder scheduler runs for the app's lifespan either way. Test hooks,
    ignored unless set: ``OBJECT_CLOCK_FILE`` (a file holding an ISO UTC instant
    that `Space.clock` re-reads on every call), ``OBJECT_FAKE_NOTIFY_FILE`` (a
    file-appending notifier instead of the OS one, and ``POST /api/_test/tick``)
    and ``OBJECT_STATE_DIR`` (where the reminder ledger lives; read by `reminders`).
    """
    hub = EventHub()
    clock_file = os.environ.get("OBJECT_CLOCK_FILE")
    if clock_file:
        space.clock = file_clock(Path(clock_file))
    fake_notify = os.environ.get("OBJECT_FAKE_NOTIFY_FILE")
    notifier = FileNotifier(Path(fake_notify)) if fake_notify else system_notifier()
    scheduler = ReminderScheduler(space, notifier)
    search = SearchIndex(space)

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI):
        hub.loop = asyncio.get_running_loop()
        hub.closed = False
        scheduler.start()
        search.start()
        if not watch:
            try:
                yield
            finally:
                hub.close()
                await asyncio.to_thread(search.stop)
                await asyncio.to_thread(scheduler.stop)
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
            await asyncio.to_thread(search.stop)
            await asyncio.to_thread(scheduler.stop)

    app = FastAPI(
        title="Object", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.space = space
    app.state.hub = hub
    app.state.reminders = scheduler
    app.state.search = search

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

    def space_info() -> dict[str, Any]:
        fields = space_fields(space.root)
        return {
            "name": fields["name"],
            "root": str(space.root),
            "types": [t.to_api(rev) for t, rev in space.types_with_revisions()],
            "icon": fields["icon"],
            "description": fields["description"],
            "hideTaskManagement": fields["hideTaskManagement"],
            "revision": fields["revision"],
        }

    @api.get("/space")
    def get_space():
        return space_info()

    @api.put("/space")
    def put_space(req: PatchSpaceRequest):
        try:
            patch_space_config(space.root, req.patch, req.baseRevision)
        except SpaceConfigProblem as exc:
            return _error(422, exc.message)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        return space_info()

    @api.get("/settings")
    def get_settings():
        try:
            data, revision = read_settings()
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        return {"settings": data, "revision": revision}

    @api.put("/settings")
    def put_settings(req: PatchSettingsRequest):
        try:
            data, revision = patch_settings(req.patch, req.baseRevision)
        except SettingsProblem as exc:
            return _error(422, exc.message)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        return {"settings": data, "revision": revision}

    # -- spaces (M7): the registry in the state dir; folders are never deleted --

    def registry() -> Registry:
        return Registry(state_dir())

    @api.get("/spaces")
    def list_spaces():
        return {"spaces": [asdict(e) for e in registry().list(current=space.root)]}

    @api.post("/spaces", status_code=201)
    def post_space(req: CreateSpaceRequest):
        if not req.location.strip():
            return _error(404, "Choose a folder for the new space.")
        try:
            path = create_space(req.name, req.location)
        except SpaceNameProblem as exc:
            return _error(422, exc.message)
        except (NotADirectoryError, FileNotFoundError):
            return _error(404, f"Not a folder: {req.location}")
        except FileExistsError:
            return _error(409, "A folder with that name already exists here.")
        registry().register(path)
        return JSONResponse({"path": str(path)}, status_code=201)

    def _folder(raw: str) -> Path | None:
        if not raw.strip():
            return None
        path = normalize(raw)
        return path if path.is_dir() else None

    @api.post("/spaces/open")
    def open_space(req: SpacePathRequest):
        path = _folder(req.path)
        if path is None:
            return _error(404, f"Not a folder: {req.path}")
        registry().register(path)
        return {"path": str(path)}

    @api.delete("/spaces")
    def remove_space(path: str = Query(default="")):
        if not path.strip():
            return _error(404, "No space given.")
        target = normalize(path)
        if os.path.normcase(str(target)) == os.path.normcase(str(space.root)):
            return _error(409, "This space is open. Switch to another space first.")
        registry().remove(target)
        return {"ok": True}

    @api.post("/spaces/switch", status_code=202)
    def switch_space(req: SpacePathRequest):
        if on_switch is None:
            return _error(503, "Switching spaces needs the Object launcher.")
        path = _folder(req.path)
        if path is None:
            return _error(404, f"Not a folder: {req.path}")
        return JSONResponse(
            {"path": str(path)}, status_code=202, background=BackgroundTask(on_switch, path)
        )

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
                "backlinks": space.backlinks(summary.path),
            }
        )

    def announce(event: ChangeEvent) -> None:
        """Publish `event` to the SSE clients from a worker thread."""
        loop = hub.loop
        if loop is not None and loop.is_running() and not hub.closed:
            loop.call_soon_threadsafe(hub.publish, event)

    def announce_relinked(paths: list[str], client_id: str | None) -> None:
        """``changed`` per relinked object; ``whiteboard`` (its .md) per relinked board file."""
        for path in paths:
            owner = sidecar_owner(path)
            if owner is not None:
                announce(ChangeEvent("whiteboard", owner, None, origin=client_id))
            else:
                announce(ChangeEvent("changed", path, space.cached_version(path), origin=client_id))

    def announce_whiteboard(event: ChangeEvent) -> None:
        """The whiteboard routes' announce: a board save also refreshes the board's links and
        search text (the link index and the search index re-read it on this rescan)."""
        if event.kind == "whiteboard":
            space.rescan_file(event.path)
        announce(event)

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
        out = {
            "version": result.version,
            "frontmatter": result.frontmatter,
            "links": result.links,
            "synced": result.synced,
            "skipped": [asdict(s) for s in result.skipped],
        }
        if result.task is not None:  # only when a Task's status changed category
            out["task"] = result.task.to_api()
        return _display_safe(out)

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
        announce_relinked(result.relinked, req.clientId)
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
        announce_relinked(result.relinked, req.clientId)
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
            path, version = space.create_object(
                req.typeId, req.title or "", req.templateId, req.values
            )
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

    @api.post("/daily-notes", status_code=201)
    def create_daily_note(req: CreateDailyNoteRequest):
        before = space.daily_note_type()
        type_id = before.id if before is not None else "dailynote"
        had_file = bool(type_revision(space.root, type_id))
        templates_before = space.template_versions()
        try:
            path, version = space.create_daily_note(req.date, req.templateId)
        except DailyNoteExists as exc:
            announce_template_ids(templates_before, req.clientId)
            return JSONResponse(
                {"detail": exc.detail, "path": exc.path, "reason": exc.reason}, status_code=409
            )
        except InvalidValue as exc:
            announce_template_ids(templates_before, req.clientId)
            return _error(422, str(exc))
        type_ids = []
        if not had_file and type_revision(space.root, type_id):
            announce(ChangeEvent("types", type_id, None, origin=req.clientId))
            type_ids.append(type_id)
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
        except RestoreConflict as exc:
            return _error(409, exc.detail)
        except KeyError:
            return _error(404, f"No trash entry {trash_id!r}")
        rewritten = result.setdefault("rewritten", [])
        for type_id in result["typeIds"]:
            announce(ChangeEvent("types", type_id, None, origin=clientId))
        for collection_id in result.get("collectionIds", []):
            announce(ChangeEvent("collections", collection_id, None, origin=clientId))
        for query_id in result.get("queryIds", []):
            announce(ChangeEvent("queries", query_id, None, origin=clientId))
        for path in result["paths"]:
            announce(ChangeEvent("created", path, space.cached_version(path), origin=clientId))
        for path in rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=clientId))
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

    @api.get("/calendar")
    def get_calendar(from_: str | None = Query(default=None, alias="from"), to: str | None = None):
        if not from_ or not to:
            return _error(422, "A calendar range needs from and to (YYYY-MM-DD).")
        try:
            return _display_safe(space.calendar(from_, to))
        except InvalidValue as exc:
            return _error(422, str(exc))

    @api.post("/rows")
    def post_rows(req: RowsRequest):
        search = (req.search.terms, req.search.mode) if req.search is not None else None
        try:
            rows = space.rows(req.typeIds, req.collectionIds, req.paths, search)
        except InvalidValue as exc:
            return _error(422, str(exc))
        return _display_safe({"rows": [asdict(r) for r in rows]})

    @api.get("/views/{type_id}")
    def get_views(type_id: str):
        t = space.type_by_id(type_id)
        if t is None:
            return _error(404, f"No object type {type_id!r}")
        store = space.store("views")
        try:
            data, revision = store.read(type_id)
        except DefinitionUnreadable as exc:
            revision = json_revision(store.path(type_id))
            return {"views": default_views(t), "revision": revision, "readOnlyReason": exc.error}
        except ValueError:
            # An id no file name can hold (e.g. with a space): its views can't be stored.
            return {
                "views": default_views(t),
                "revision": "",
                "readOnlyReason": "This type's id can't be used as a file name, so its views can't be saved.",
            }
        return {"views": normalize_views(data, default_views(t)), "revision": revision}

    @api.put("/views/{type_id}")
    def put_views(type_id: str, req: SaveViewsRequest):
        if space.type_by_id(type_id) is None:
            return _error(404, f"No object type {type_id!r}")
        problem = _views_problem(req.views)
        if problem:
            return _error(422, problem)
        try:
            revision = space.store("views").write(type_id, req.views, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except ValueError:
            return _error(422, "This type's id can't be used as a file name, so its views can't be saved.")
        announce(ChangeEvent("views", type_id, revision, origin=req.clientId))
        return {"revision": revision}

    @api.get("/ui")
    def get_ui():
        data, revision = read_ui(space.root)
        out: dict[str, Any] = {"ui": ui_with_defaults(data), "revision": revision}
        reason = ui_read_only_reason(space.root)
        if reason:
            out["readOnlyReason"] = reason
        return out

    @api.put("/ui")
    def put_ui(req: PatchUiRequest):
        unknown = sorted(set(req.patch) - _UI_PATCH_KEYS)
        if unknown:
            return _error(422, f"Cannot patch: {', '.join(unknown)}")
        problem = _ui_problem(req.patch)
        if problem:
            return _error(422, problem)
        try:
            data, revision = patch_ui(space, req.patch, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        announce(ChangeEvent("ui", "ui.json", revision, origin=req.clientId))
        return {"ui": ui_with_defaults(data), "revision": revision}

    @api.get("/collections")
    def get_collections():
        space.reload_collections()
        return _display_safe(
            [c.to_api(space.collection_revision(c.id)) for c in space.list_collections()]
        )

    @api.post("/collections", status_code=201)
    def create_collection(req: CreateCollectionRequest):
        try:
            c = space.create_collection(req.name, req.typeIds, req.icon)
        except InvalidValue as exc:
            return _error(422, str(exc))
        announce(ChangeEvent("collections", c.id, None, origin=req.clientId))
        return JSONResponse(_display_safe(c.to_api(space.collection_revision(c.id))), status_code=201)

    @api.put("/collections/{collection_id}")
    def save_collection(collection_id: str, req: SaveCollectionRequest):
        if collection_id not in space.collections:
            return _error(404, f"No collection {collection_id!r}")
        c = CollectionDef.from_json(req.collection, fallback_id=collection_id)
        c.id = collection_id
        try:
            result = space.save_collection(c, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f"No collection {collection_id!r}")
        announce(ChangeEvent("collections", collection_id, result.revision, origin=req.clientId))
        for path in result.rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        return _display_safe(result.to_api())

    @api.delete("/collections/{collection_id}")
    def delete_collection(
        collection_id: str,
        confirm: bool = Query(default=False),
        clientId: str | None = Query(default=None),
    ):
        try:
            result = space.delete_collection(collection_id, confirm=confirm)
        except ConfirmRequired as exc:
            return JSONResponse({"detail": exc.detail, "affected": exc.affected}, status_code=428)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except KeyError:
            return _error(404, f"No collection {collection_id!r}")
        announce(ChangeEvent("collections", collection_id, None, origin=clientId))
        for path in result.deleted:
            announce(ChangeEvent("deleted", path, None, origin=clientId))
        for path in result.removed_from:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=clientId))
        return _display_safe(result.to_api())

    @api.get("/queries")
    def get_queries():
        return _display_safe([q.to_api(space.query_revision(q.id)) for q in space.list_queries()])

    @api.post("/queries", status_code=201)
    def create_query(req: CreateQueryRequest):
        try:
            q = space.create_query(req.name, req.definition, req.view)
        except InvalidValue as exc:
            return _error(422, str(exc))
        announce(ChangeEvent("queries", q.id, None, origin=req.clientId))
        return JSONResponse(_display_safe(q.to_api(space.query_revision(q.id))), status_code=201)

    @api.put("/queries/{query_id}")
    def save_query(query_id: str, req: SaveQueryRequest):
        q = QueryDef.from_json(req.query, fallback_id=query_id)
        q.id = query_id
        try:
            q, revision = space.save_query(q, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except (KeyError, ValueError):
            return _error(404, f"No query {query_id!r}")
        announce(ChangeEvent("queries", query_id, revision, origin=req.clientId))
        return _display_safe({"query": q.to_api(revision)})

    @api.delete("/queries/{query_id}")
    def delete_query(query_id: str, clientId: str | None = Query(default=None)):
        try:
            trash_id = space.delete_query(query_id)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except (KeyError, ValueError):
            return _error(404, f"No query {query_id!r}")
        announce(ChangeEvent("queries", query_id, None, origin=clientId))
        return {"trashId": trash_id}

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
        for entry in data.get("propertyDefinitions") or []:
            if isinstance(entry, dict) and "options" in entry:
                bad = option_shape_problems(entry["options"])
                if bad:
                    name = entry.get("name") or entry.get("key") or "a property"
                    return _error(422, f"Invalid options for {name}: {', '.join(bad)}")
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

    @api.get("/attachments")
    def get_attachments():
        return _display_safe(list_attachments(space.root))

    @api.post("/attachments", status_code=201)
    async def post_attachment(request: Request, name: str = Query(default="")):
        limit = media.MAX_ATTACHMENT_BYTES
        too_large = _error(413, media.UPLOAD_LIMIT_DETAIL)
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > limit:
            return too_large
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                return too_large
            chunks.append(chunk)
        data = b"".join(chunks)
        try:
            path, kind = await asyncio.to_thread(import_attachment, space.root, name, data)
        except TooLarge:
            return too_large
        except ValueError as exc:
            return _error(422, str(exc))
        return JSONResponse({"path": path, "kind": kind}, status_code=201)

    @api.post("/attachments/open")
    def open_attachment(req: OpenAttachmentRequest):
        try:
            full = attachment_path(space.root, req.path)
        except NotServed:
            return _error(415, "Objects are opened in Object, not with another app.")
        except (FileNotFoundError, OSError):
            return _error(404, f"No file at {req.path!r}")
        try:
            open_with_system(full)
        except RefusedToOpen:
            return _error(415, media.REFUSED_OPEN_DETAIL)
        return {"ok": True}

    @api.get("/file")
    def get_file(path: str):
        try:
            full = attachment_path(space.root, path)
        except NotServed:
            return _error(415, "Objects are opened, not served.")
        except (FileNotFoundError, OSError):
            return _error(404, f"No file at {path!r}")
        kind = kind_of(full.name)
        return FileResponse(
            full,
            media_type=attachment_media_type(full.name),
            headers=serve_headers(kind, full.name),
        )

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

    if fake_notify:

        @api.post("/_test/tick")
        def test_tick():
            """Run one reminder check at the clock's instant (test hook only)."""
            fired = scheduler.tick(space.clock())
            return {
                "fired": [
                    {"path": d.path, "title": d.title, "body": d.body, "trigger": d.trigger.isoformat()}
                    for d in fired
                ]
            }

    ctx = ApiContext(space, announce, search)
    api.include_router(api_search.router(ctx))
    api.include_router(api_references.router(ctx))
    api.include_router(api_graph.router(ctx))
    app.include_router(api)
    # M6: the whiteboard routes carry their own /api prefix.
    app.include_router(whiteboard_router(space, announce_whiteboard))

    if static_dir is not None and Path(static_dir).is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app
