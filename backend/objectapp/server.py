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
- M9 ``POST /api/object/duplicate`` ``{path, clientId?}`` -> ``201 {path, version, summary}``
  (``<Title> (Copy)`` beside the source); ``422`` for a daily note, media, template,
  whiteboard or read-only file, ``404``, ``400``. Announces ``created``.
- M9 ``GET /api/object/export?path=&media=0|1`` -> the ``.md`` bytes as on disk
  (``text/markdown``), or with ``media=1`` a zip of ``<stem>.md`` plus the media it
  references (`export`); an ``attachment`` download. ``404``, ``400``. Writes nothing.
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
  (``409`` when that file exists). M22: the built-in Tickets view (``work-tickets``) lists
  with ``builtIn: "tickets"``; deleting it answers ``422`` ("The Tickets view is built in.").
- M22: the work routes (``api_work``: ``/api/work/*``, ``POST /api/types/{id}/work-fields``)
  and the agents' (``api_v1_work``: ``/api/v1/work/*``) share one `WorkService`.
  ``GET /api/space`` also serves ``jiraSite``.
- M23: the Work section's routes (``api_work_section``: ``GET /api/work/board``, ``/focus``
  (and ``PUT``), ``/today``, ``/wins``, ``/alerts`` (``POST /alerts/scan``), ``POST
  /alert-type``, ``/floor/general`` (and ``POST``), ``/agent`` (``PUT /agent/acts``, ``POST
  /agent/retry``), ``/captures`` (and ``POST``), ``/keep-on-top`` (and ``POST``)), over the same
  `WorkService`, the M24 seams (``workseams.build_seams``) and one `AlertWatch` per app (the
  monitoring folder watch; ``workAlertFolder`` / ``workAlertIntervals`` settings). Events
  ``work`` and ``workQueue`` join the resync.
- ``GET /api/trash`` -> ``TrashItem[]``; ``POST /api/trash/{id}/restore?clientId=`` ->
  ``{paths, typeIds, rewritten}`` (plus ``collectionIds``, ``queryIds``, ``skipped`` for a
  collection or query entry; ``rewritten``: other files written back, announced ``changed``;
  announces ``created`` per path and ``types`` per type); ``422`` when a
  saved type now has the trashed type's id or name;
  ``DELETE /api/trash/{id}`` and ``DELETE /api/trash`` -> ``{purged}``; ``404``.
- ``POST /api/types`` ``{name, pluralName, icon?, color?, template?, clientId?}`` -> ``201 TypeDef``
  (``template``: a gallery key, polish item 21; ``GET /api/type-gallery`` lists the gallery);
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
- ``DELETE /api/types/{id}?confirm=true&clientId=`` -> ``{trashId, paths, typeIds, queryIds}``;
  ``422``, ``428 {detail, affected}``, ``404``. Announces ``types`` (this type and each type
  whose relations stopped allowing it), ``deleted`` per object and template, and ``queries``
  per saved query that went to the trash with it or dropped it.
- ``GET /api/types/{id}/templates`` -> ``ObjectSummary[]`` (``templates.ids`` order, then
  discovered ones); ``404``. ``POST /api/types/{id}/templates`` ``{name?, clientId?}`` ->
  ``201 {path, version}``; ``422`` (a type without templates), ``423``, ``404``. Announces
  ``created`` and ``types``.
- ``POST /api/object/apply-template`` ``{path, templateId, baseVersion, clientId?}`` ->
  ``{version}``; ``409 {currentVersion}``, ``422 {detail}`` ("The template couldn't be applied"),
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
  never overwritten); ``413`` over 100 MiB, ``422`` empty or unusable name, ``415`` a
  ``.md`` name (it would become an object).
  ``GET /api/file?path=`` -> the file's bytes with per-kind headers (images: CSP
  ``sandbox``; pdf, audio, video: inline, ranges answered ``206``; any other file:
  ``application/octet-stream`` as an attachment; ``nosniff`` on all); ``415`` for a ``.md``
  file, ``404`` when missing, in a dot-folder, outside the space or a whiteboard sidecar.
  ``POST /api/attachments/open`` ``{path}`` -> ``{ok}`` (opened with the OS default app);
  ``404`` as above, ``415`` for an executable or script (or a ``.md``).
- M7 spaces (the registry is ``<state dir>/spaces.json``; no folder is ever deleted):
  ``GET /api/spaces`` -> ``{spaces: {path, name, icon, current, missing, lastOpened}[]}``
  (registry order, the current space always listed; never writes). ``POST /api/spaces``
  ``{name, location}`` -> ``201 {path}`` (a new folder holding only ``.object/space.json``,
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
  ``{path, board, baseRevision, clientId?}`` -> ``{revision, mdVersion}`` (``409
  {currentRevision}``, ``422``, ``423``); ``GET /api/whiteboard/ink?path=`` -> ``{path,
  strokes, revision, readOnlyReason?}``; ``PUT /api/whiteboard/ink`` ``{path, strokes,
  baseRevision, clientId?}`` -> ``{revision, mdVersion}``; ``POST /api/whiteboards``
  ``{title?, clientId?}`` -> ``201 {path, version, typeIds}``. Board and ink saves announce
  ``whiteboard`` with the board's ``.md`` path; M9: they also stamp the ``.md``'s
  ``lastUpdated`` (at most once a minute), announced ``changed`` with ``mdVersion``. ``PUT /api/ui`` accepts ``whiteboard`` (the canvas display settings).
  Deleting, restoring, purging and renaming a whiteboard carry its sidecar files; a rename
  relinks board files too (their sidecar paths are in ``relinked``, announced ``whiteboard``).
- M8 (plan Task 2): ``POST /api/spaces`` also takes ``setup: 'blank' | 'basic'``; the
  ``timeZone`` device setting sets ``space.tz`` at start-up and after every successful
  ``PUT /api/settings`` (null: the device's zone). The M8 routers (`api_tasks`,
  `api_history`, `api_blocks`, `api_merge`, `api_spaces_m8`) are mounted on ``/api``;
  each module's docstring lists its routes and owner task.
- M15 (`api_import`): ``POST /api/import/preview``, ``POST /api/import/start``,
  ``GET /api/import/jobs/{id}``, ``POST /api/import/jobs/{id}/cancel``; see that module.
- M10: `api_ai` adds the AI assistant: ``GET /api/ai/status``, ``POST /api/ai/chat``
  (Server-Sent Events of `AiEvent`), ``GET /api/ai/chat?path=``, ``POST /api/ai/chat/save``.
- M11: `api_v1` adds the token-protected local API (``/api/v1/*``) and the token routes
  (``/api/integrations/tokens``); its docstring lists them.

Errors: a path outside the space or not an object is ``400``; a missing object is ``404``;
a file the OS refused to write (locked by another program, say) is ``503 {detail}``.
"""

from __future__ import annotations

import asyncio
import contextlib
import copy
import json
import os
import subprocess
import sys
import threading
from collections.abc import AsyncIterator, Callable
from dataclasses import asdict
from pathlib import Path, PurePosixPath
from typing import Any, Literal

from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette import EventSourceResponse, ServerSentEvent
from starlette.background import BackgroundTask
from starlette.middleware.gzip import GZipMiddleware

from . import (
    api_agent_a2a_v1,
    api_agent_v1,
    api_agents,
    api_app,
    api_automations,
    api_ai,
    api_blocks,
    api_captures,
    api_desksync,
    api_graph,
    api_history,
    api_import,
    api_importscan,
    api_learning,
    api_learning_v1,
    api_mcp,
    api_merge,
    api_references,
    api_remote_agents,
    api_schedules_v1,
    api_search,
    api_spaces_m8,
    api_tasks,
    api_v1,
    api_v1_tools,
    delegation,
    api_v1_captures,
    api_v1_desksync,
    api_v1_work,
    api_work,
    api_work_agent,
    api_work_section,
    learnhooks,
    mcpgateway,
    media,
    desksync,
    schedulerun,
    worktools,
)
from .alertwatch import AlertWatch
from .apictx import ApiContext
from .computed import Computer, Obj, has_computed
from .curator import ActivityMiddleware, Curator, IdleClock
from .keycompat import KeyCompatMiddleware
from .appstate import state_dir
from .automations import AutomationEngine
from .collections import CollectionDef
from .export import ExportOptions, content_disposition, export_object_to_file, export_properties
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
from .formula import FormulaError
from .formula import parse as parse_formula
from .propvalues import InvalidValue
from .queries import QueryDef
from .reminders import ReminderScheduler, file_clock
from .reviews import ReviewRunner
from .searchindex import SearchIndex
from .settings import SettingsProblem, time_zone
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
from .spaces import Registry, SpaceNameProblem, create_space, is_full_path, normalize
from .typedefs import has_undecodable
from .typemodel import (
    DATA_VIEW_LAYOUTS,
    DEFAULT_LAYOUT_KEY,
    PropertyDefinition,
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
from .workloop import WorkLoop
from .workseams import build_seams
from .workservice import WorkService
from .workview import api_extra as query_api_extra

__all__ = ["EventHub", "create_app"]


EVENT_QUEUE_MAX = 1000
"""Events held for one SSE client that isn't reading; past this its backlog is dropped."""

RESYNC_EVENTS = tuple(
    ChangeEvent(kind, "*", None)
    for kind in (
        "types", "views", "ui", "collections", "queries", "automations", "agents", "agentChats",
        "agentLearning", "work", "workQueue", "mcpServers",
    )
)
"""What replaces a dropped backlog: the resync the client itself announces after a
reconnect (``api/client.ts`` ``RESYNC_EVENTS``), on which every consumer reloads."""


def _offer(q: asyncio.Queue[ChangeEvent | None], event: ChangeEvent | None) -> None:
    """Queue `event`; on a full queue drop the backlog for the resync (or the end, None)."""
    try:
        q.put_nowait(event)
        return
    except asyncio.QueueFull:
        pass
    while not q.empty():
        q.get_nowait()
    for item in RESYNC_EVENTS if event is not None else (None,):
        q.put_nowait(item)


class EventHub:
    """Fans `ChangeEvent`s out to every connected SSE client (one bounded queue each)."""

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
            _offer(q, event)

    def close(self) -> None:
        """End every open stream. Safe to call from any thread."""
        self.closed = True
        with self._lock:
            subscribers = list(self._subscribers)
        loop = self.loop
        for q in subscribers:
            if loop is not None and loop.is_running():
                loop.call_soon_threadsafe(_offer, q, None)
            else:
                _offer(q, None)

    async def subscribe(self) -> AsyncIterator[ChangeEvent]:
        q: asyncio.Queue[ChangeEvent | None] = asyncio.Queue(EVENT_QUEUE_MAX)
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
    """M14: text added below the body the object gets (its heading or template's)."""
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
    template: str | None = None
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


class NumberExistingRequest(BaseModel):
    baseRevision: str = ""
    clientId: str | None = None


class FormulaPreviewRequest(BaseModel):
    typeId: str
    expression: str
    path: str | None = None
    properties: list[Any] | None = None


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
    #: False leaves ``preview`` empty (a view fetches the visible rows' previews after).
    preview: bool = True


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
    {
        "pinned", "sections", "allNotesLayout", "calendar", "tasks", "reminders", "graph",
        "whiteboard", "workspaceOrder", "objectsSectionSortOption", "workspace",
    }
)  # fmt: skip
# The graph view customisation keys.
_GRAPH_LIST_KEYS = ("filterTypeIds", "excludeTypeIds")
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
        "all",
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
    setup: Literal["blank", "basic"] = "blank"


class SpacePathRequest(BaseModel):
    path: str = ""


class EnsureTagRequest(BaseModel):
    name: str = ""
    clientId: str | None = None


class RelationPairRequest(BaseModel):
    kind: str
    baseRevision: str = ""
    clientId: str | None = None


class SyncRequest(BaseModel):
    targetPropertyId: str | None = None
    createName: str | None = None
    baseRevision: str = ""
    clientId: str | None = None


def _undecodable_in(value) -> bool:
    if isinstance(value, str):
        return has_undecodable(value)
    if isinstance(value, dict):
        return any(_undecodable_in(k) or _undecodable_in(v) for k, v in value.items())
    if isinstance(value, list):
        return any(_undecodable_in(v) for v in value)
    return False


def _display_copy(value):
    if isinstance(value, str):
        if has_undecodable(value):
            return value.encode("utf-8", errors="surrogateescape").decode("utf-8", errors="replace")
        return value
    if isinstance(value, dict):
        return {_display_copy(k): _display_copy(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_display_copy(v) for v in value]
    return value


def _display_safe(value):
    """`value` with undecodable bytes (surrogate escapes) shown as U+FFFD, so it can be JSON.

    Only a name from the disk (a path, a file-stem title) can hold them, so the usual
    answer is `value` itself; a copy is made only when one does.
    """
    return _display_copy(value) if _undecodable_in(value) else value


class SafeJSONResponse(JSONResponse):
    """A `JSONResponse` encoded as it is, through `_display_safe` only when that fails.

    Walking a big answer for surrogates costs as much as encoding it (audit 2026-11-01:
    145 ms on 3 MB of rows), while UTF-8 encoding refuses them anyway: the encode is the check.
    """

    def render(self, content: Any) -> bytes:
        try:
            return super().render(content)
        except UnicodeEncodeError:
            return super().render(_display_safe(content))


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


def _unusable_id(id: str) -> bool:
    """An id no definition file name can hold, so no definition can exist under it.

    `JsonStore.path` checks the id's characters; the length is checked here so an
    over-long id from a URL answers 404 instead of ``ENAMETOOLONG`` from the OS (503).
    """
    return "\x00" in id or len(id.encode("utf-8", errors="surrogateescape")) > 200


# The host names this app answers to. Any other ``Host`` is a DNS-rebinding page
# (a foreign name resolved to 127.0.0.1), refused on every request. The port is not
# checked: the Vite dev server proxies with its own port in ``Host``. Tests add
# Starlette's ``testserver`` in conftest.
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
allowed_hosts: frozenset[str] = LOOPBACK_HOSTS
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# Routes whose body is raw file bytes: they need ``application/octet-stream``, which a
# cross-site page can only send after a CORS preflight this app never grants.
_UPLOAD_ROUTES = frozenset({"/api/images", "/api/attachments"})


def _host_name(host: str) -> str | None:
    """The host name in a ``Host`` header (lower-case, IPv6 without brackets), else None."""
    host = host.strip().lower()
    if host.startswith("["):
        end = host.find("]")
        rest = host[end + 1 :]
        if end < 0 or (rest and not (rest.startswith(":") and rest[1:].isdigit())):
            return None
        return host[1:end]
    name, _sep, port = host.partition(":")
    if port and not port.isdigit():
        return None
    return name or None


def _local_only_problem(scope: dict[str, Any]) -> tuple[int, str] | None:
    """Why `scope` must be refused (status, message), else None. See `LOOPBACK_HOSTS`."""
    headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
    host = headers.get("host", "")
    if _host_name(host) not in allowed_hosts:
        return 403, "Object only answers on 127.0.0.1 or localhost."
    method = scope.get("method", "GET") if scope["type"] == "http" else "GET"
    origin = headers.get("origin")
    if scope["type"] == "websocket" or method not in _SAFE_METHODS:
        # Browsers send Origin on every cross-origin write; it must be this page's.
        if origin is not None and origin.lower() != f"http://{host.strip().lower()}":
            return 403, "Changes are only accepted from Object's own window."
    if method == "POST" and scope.get("path") in _UPLOAD_ROUTES:
        ctype = headers.get("content-type", "").split(";")[0].strip().lower()
        if ctype != "application/octet-stream":
            return 415, "Uploads must be sent as application/octet-stream."
    return None


class LocalOnlyMiddleware:
    """Refuses DNS-rebinding hosts, cross-origin writes and "simple" uploads (pure ASGI,
    so Server-Sent Events stream through untouched)."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] in ("http", "websocket"):
            problem = _local_only_problem(scope)
            if problem is not None:
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                    return
                await _error(*problem)(scope, receive, send)
                return
        await self.app(scope, receive, send)


def _views_problem(views: dict[str, Any]) -> str | None:
    """Why a PUT /api/views body is not a Views object, else None."""
    if "activeTab" in views and not isinstance(views["activeTab"], str):
        return 'The key "activeTab" must be a string.'
    if "all" in views and not isinstance(views["all"], dict):
        return 'The key "all" must be an object.'
    if "dashboard" in views:
        dash = views["dashboard"]
        if not isinstance(dash, dict):
            return 'The key "dashboard" must be an object.'
        sections = dash.get("sections", [])
        if not isinstance(sections, list) or not all(
            isinstance(x, dict) and isinstance(x.get("key"), str) for x in sections
        ):
            return 'The key "dashboard.sections" must be a list of sections with a key.'
        if not isinstance(dash.get("removedSections", []), list):
            return 'The key "dashboard.removedSections" must be a list.'
    return None


def _ui_problem(patch: dict[str, Any]) -> str | None:
    """Why a PUT /api/ui patch has the wrong shape, else None."""
    if "pinned" in patch:
        pinned = patch["pinned"]
        if not isinstance(pinned, list) or not all(
            isinstance(p, dict) and isinstance(p.get("kind"), str) and isinstance(p.get("id"), str)
            for p in pinned
        ):
            return 'The key "pinned" must be a list of {kind, id}.'
    if "sections" in patch:
        sections = patch["sections"]
        if not isinstance(sections, list) or not all(
            isinstance(x, dict) and isinstance(x.get("items", []), list) for x in sections
        ):
            return 'The key "sections" must be a list of sections with a list of items.'
    if "allNotesLayout" in patch and not isinstance(patch["allNotesLayout"], str):
        return 'The key "allNotesLayout" must be a string.'
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
            return 'The key "reminders" must be {enabled: true|false}.'
    if "graph" in patch:
        problem = _graph_ui_problem(patch["graph"])
        if problem:
            return problem
    if "whiteboard" in patch:
        problem = whiteboard_ui_problem(patch["whiteboard"])
        if problem:
            return problem
    if "workspaceOrder" in patch:
        order = patch["workspaceOrder"]
        if not isinstance(order, list) or not all(isinstance(x, str) for x in order):
            return 'The key "workspaceOrder" must be a list of section ids.'
        if len(set(order)) != len(order):
            return 'The key "workspaceOrder" lists a section twice.'
    # The Object Types sort (``ui.json`` ``objectsSectionSortOption``) and its manual order, kept
    # as the `objects` section's ids in ``ui.json`` ``workspace``.
    if "objectsSectionSortOption" in patch and patch["objectsSectionSortOption"] not in (
        "alphabetical",
        "manual",
    ):
        return 'The key "objectsSectionSortOption" must be alphabetical or manual.'
    if "workspace" in patch:
        ws = patch["workspace"]
        if not isinstance(ws, dict):
            return 'The key "workspace" must be an object.'
        unknown = sorted(set(ws) - {"objects"})
        if unknown:
            return f"The UI state has no key named {', '.join(f'workspace.{k}' for k in unknown)}."
        objects = ws.get("objects", {})
        ids = objects.get("ids", []) if isinstance(objects, dict) else None
        if not isinstance(ids, list) or not all(isinstance(x, str) for x in ids):
            return 'The key "workspace.objects.ids" must be a list of ids.'
        if len(set(ids)) != len(ids):
            return 'The key "workspace.objects.ids" lists an id twice.'
    return None


def _graph_ui_problem(graph: Any) -> str | None:
    """Why a ``graph`` ui patch is not a ``GraphViewCustomization``, else None."""
    if not isinstance(graph, dict):
        return 'The key "graph" must be an object.'
    unknown = sorted(set(graph) - set(_GRAPH_LIST_KEYS) - set(_GRAPH_BOOL_KEYS))
    if unknown:
        return f"The UI state has no key named {', '.join(f'graph.{k}' for k in unknown)}."
    for key in _GRAPH_LIST_KEYS:
        if key in graph and not (
            isinstance(graph[key], list) and all(isinstance(x, str) for x in graph[key])
        ):
            return f'The key "graph.{key}" must be a list of type ids.'
    for key in _GRAPH_BOOL_KEYS:
        if key in graph and not isinstance(graph[key], bool):
            return f'The key "graph.{key}" must be true or false.'
    return None


def _calendar_ui_problem(cal: Any) -> str | None:
    """Why a ``calendar`` ui patch is not a ``CalendarUi``, else None."""
    if not isinstance(cal, dict):
        return 'The key "calendar" must be an object.'
    if "weekStart" in cal and cal["weekStart"] not in _WEEK_STARTS:
        return 'The key "calendar.weekStart" must be sunday or monday.'
    if "hideCalendarSidebar" in cal and not isinstance(cal["hideCalendarSidebar"], bool):
        return 'The key "calendar.hideCalendarSidebar" must be true or false.'
    if "daily" in cal:
        daily = cal["daily"]
        if not isinstance(daily, dict):
            return 'The key "calendar.daily" must be an object.'
        for key in _CALENDAR_HIDE_KEYS:
            if key in daily and not isinstance(daily[key], bool):
                return f'The key "calendar.daily.{key}" must be true or false.'
        for key in _CALENDAR_VIEW_KEYS:
            if key in daily and not isinstance(daily[key], dict):
                return f'The key "calendar.daily.{key}" must be a view state object.'
    return None


def _tasks_ui_problem(tasks: Any) -> str | None:
    """Why a ``tasks`` ui patch is not a ``TasksUi``, else None."""
    if not isinstance(tasks, dict):
        return 'The key "tasks" must be an object.'
    if "activeTab" in tasks and tasks["activeTab"] not in _TASK_SECTION_KEYS:
        return 'The key "tasks.activeTab" must be a task section key.'
    if "views" in tasks:
        views = tasks["views"]
        if not isinstance(views, dict) or not all(
            k in _TASK_SECTION_KEYS and isinstance(v, dict) for k, v in views.items()
        ):
            return 'The key "tasks.views" must map task section keys to view state objects.'
    return None


def create_app(
    space: Space,
    static_dir: Path | None = None,
    watch: bool = True,
    on_switch: Callable[[Path], None] | None = None,
    base_url: str | None = None,
) -> FastAPI:
    """The app for `space`. With `watch`, a `SpaceWatcher` runs for the app's lifespan.

    M21: `base_url` is the app's own loopback URL (``__main__.build_server_config`` passes it);
    agent schedule runs give it to the agent as ``OBJECT_API_URL``. Without it (tests) they use
    the last request's base URL the idle clock saw. With the fake notifier, ``POST
    /api/_test/tick`` also answers ``agentJobs`` (queued or running) and ``POST
    /api/_test/agent-schedules/idle`` waits up to 30 s for the agent jobs.

    `on_switch` is the launcher's ``SpaceHost.request_switch``: ``POST
    /api/spaces/switch`` calls it with the new space's folder once the response is
    sent. Without it that route answers 503.

    The reminder scheduler and the M14 automation engine (its trigger worker and its
    schedule thread) run for the app's lifespan either way. Test hooks,
    ignored unless set: ``OBJECT_CLOCK_FILE`` (a file holding an ISO UTC instant
    that `Space.clock` re-reads on every call), ``OBJECT_FAKE_NOTIFY_FILE`` (a
    file-appending notifier instead of the OS one, and ``POST /api/_test/tick``)
    and ``OBJECT_STATE_DIR`` (where the reminder ledger, the automation schedule state and
    run logs live). With the fake notifier, ``POST /api/_test/tick`` also runs one automation
    schedule tick and ``POST /api/_test/automations/idle`` waits for the trigger queue.

    M18: one `ReviewRunner`, `IdleClock` and `Curator` per app (``app.state.reviews``, ``.idle``,
    ``.curator``); `ActivityMiddleware` (inside `LocalOnlyMiddleware`) feeds the idle clock and the
    curator ticks for the app's lifespan. With the fake notifier, ``POST /api/_test/reviews/idle``
    waits for running reviews and ``POST /api/_test/curator/tick`` runs one curator tick.
    """
    hub = EventHub()
    clock_file = os.environ.get("OBJECT_CLOCK_FILE")
    if clock_file:
        space.clock = file_clock(Path(clock_file))
    fake_notify = os.environ.get("OBJECT_FAKE_NOTIFY_FILE")
    notifier = FileNotifier(Path(fake_notify)) if fake_notify else system_notifier()
    scheduler = ReminderScheduler(space, notifier)
    search = SearchIndex(space)

    # M8: the Time zone setting drives `space.tz`; null means the device's zone,
    # which is whatever `space.tz` was when the app was made (tests inject one).
    device_tz = space.tz

    def settings_changed(merged: dict[str, Any]) -> None:
        zone = time_zone(merged)
        space.tz = zone if zone is not None else device_tz

    with contextlib.suppress(ReadOnly):
        settings_changed(read_settings()[0])

    # M18: the learning contributors (idempotent) and the curator's idle clock, on the space's
    # clock so OBJECT_CLOCK_FILE moves it in tests.
    learnhooks.install()
    # M19: the MCP gateway's run contributors, Tools tab groups and secret lookup (idempotent).
    mcpgateway.install()
    # M20: the delegation run contributors (idempotent; filled by the plan's T6).
    delegation.install()
    # M21: the schedule-guidance run contributor (idempotent).
    schedulerun.install()
    idle = IdleClock(lambda: space.clock())

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI):
        hub.loop = asyncio.get_running_loop()
        hub.closed = False
        scheduler.start()
        search.start()
        automations.start()
        work_loop.start()
        alert_watch.start()
        curator.start()
        if not watch:
            try:
                yield
            finally:
                await curator.stop()
                await asyncio.to_thread(work_loop.stop)
                await asyncio.to_thread(automations.stop)
                await asyncio.to_thread(alert_watch.stop)
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
            await curator.stop()
            await asyncio.to_thread(work_loop.stop)
            await asyncio.to_thread(automations.stop)
            await asyncio.to_thread(alert_watch.stop)
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
    # Audit 2026-11-01 F11: gzip the API's JSON and the static bundle (3.4 MB + 4.5 MB
    # of assets; matters over Tailscale). Starlette leaves ``text/event-stream`` alone
    # by default, so /api/events is never buffered; small answers stay as they are.
    # Level 1, not Starlette's 9: on the 9 MB all-rows answer level 9 cost 465 ms of
    # CPU for 1.5 MB on the wire, level 1 under 40 ms for 1.9 MB.
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=1)
    app.add_middleware(KeyCompatMiddleware)  # request bodies with older key names
    app.add_middleware(ActivityMiddleware, idle=idle)  # M18: inside LocalOnlyMiddleware
    app.add_middleware(LocalOnlyMiddleware)  # added last: the outermost, so it checks first
    app.state.space = space
    app.state.hub = hub
    app.state.reminders = scheduler
    app.state.search = search

    @app.exception_handler(OSError)
    async def os_error(_request: Request, exc: OSError) -> JSONResponse:
        # A file locked by another program (a Windows sharing violation, winerror
        # 32) or a transient file-system failure: report it as JSON the client can
        # show and retry, never as a bare 500. A plain `PermissionError` (EACCES on
        # macOS/Linux, a read-only file on Windows) is not a lock, so it gets the
        # OS's own words.
        if isinstance(exc, PermissionError) and getattr(exc, "winerror", None) == 32:
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
            "jiraSite": fields["jiraSite"],
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
        settings_changed(data)
        return {"settings": data, "revision": revision}

    # -- spaces (M7): the registry in the state dir; folders are never deleted --

    def registry() -> Registry:
        return Registry(state_dir())

    @api.get("/spaces")
    def list_spaces():
        return {"spaces": [asdict(e) for e in registry().list(current=space.root)]}

    @api.post("/spaces", status_code=201)
    def post_space(req: CreateSpaceRequest):
        # Blank, or relative (it would be read against the server's working folder).
        if not is_full_path(req.location):
            return _error(404, "Choose a folder for the new space.")
        try:
            path = create_space(req.name, req.location, setup=req.setup)
        except SpaceNameProblem as exc:
            return _error(422, exc.message)
        except (NotADirectoryError, FileNotFoundError):
            return _error(404, f'"{req.location}" is not a folder.')
        except FileExistsError:
            return _error(409, "A folder with that name already exists here.")
        except NotImplementedError as exc:  # M8 Task 2: `basic` until Task 8 fills it
            return _error(501, str(exc))
        registry().register(path, touch=False)
        return JSONResponse({"path": str(path)}, status_code=201)

    def _folder(raw: str) -> Path | None | JSONResponse:
        """The folder `raw` names, None when there is none, or the 404 for a path that
        is not a full one (it would be read against the server's working folder)."""
        if not raw.strip():
            return None
        if not is_full_path(raw):
            return _error(404, "Choose a folder by its full path.")
        try:
            path = normalize(raw)
            return path if path.is_dir() else None
        except (ValueError, OSError):  # a NUL, or a path too long for the OS to stat
            return None

    @api.post("/spaces/open")
    def open_space(req: SpacePathRequest):
        path = _folder(req.path)
        if isinstance(path, JSONResponse):
            return path
        if path is None:
            return _error(404, f'"{req.path}" is not a folder.')
        registry().register(path, touch=False)
        return {"path": str(path)}

    @api.delete("/spaces")
    def remove_space(path: str = Query(default="")):
        if not path.strip():
            return _error(404, "No space given.")
        try:
            target = normalize(path)
        except ValueError:
            return _error(404, f'"{path[:60]}" is not a folder.')
        if os.path.normcase(str(target)) == os.path.normcase(str(space.root)):
            return _error(409, "This space is open. Switch to another space first.")
        registry().remove(target)
        return {"ok": True}

    @api.post("/spaces/switch", status_code=202)
    def switch_space(req: SpacePathRequest):
        if on_switch is None:
            return _error(503, "Switching spaces needs the Object launcher.")
        path = _folder(req.path)
        if isinstance(path, JSONResponse):
            return path
        if path is None:
            return _error(404, f'"{req.path}" is not a folder.')
        return JSONResponse(
            {"path": str(path)}, status_code=202, background=BackgroundTask(on_switch, path)
        )

    @api.get("/objects")
    def list_objects(type: str | None = Query(default=None)):
        # A JSONResponse is encoded here, on the worker thread; a plain return would run
        # FastAPI's per-value `jsonable_encoder` on the event loop (audit 2026-11-01 B2:
        # 120 ms per request at 5,000 objects, stalling SSE and every other request).
        return SafeJSONResponse([asdict(s) for s in space.list(type or None)])

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
            return _error(404, f'There is no object at "{path}".')
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
                "computed": computed_of(summary, fm),
            }
        )

    def computed_of(summary: Any, fm: dict) -> dict[str, Any]:
        """M12: the object's formula and rollup values (``{}`` when it has none)."""
        t = space.type_by_id(summary.type)
        if not has_computed(t):
            return {}
        return Computer(space).values(Obj(summary.path, fm, summary, t))

    def announce(event: ChangeEvent) -> None:
        """Publish `event` to the SSE clients from a worker thread."""
        loop = hub.loop
        if loop is not None and loop.is_running() and not hub.closed:
            loop.call_soon_threadsafe(hub.publish, event)

    # M14: rules run on the engine's worker after the request returns; every write notice of
    # the space goes to it (it drops an automation's own writes: the loop guard).
    automations = AutomationEngine(space, announce, notifier, base_url=lambda: base_url or idle.base_url)
    space.after_write = automations.on_write
    app.state.automations = automations

    # M23: the monitoring folder watch, one per app; it re-reads the settings on every poll
    # and announces its own writes (the scan thread is no request).
    def alert_folder() -> Path | None:
        try:
            value = read_settings()[0].get("workAlertFolder")
        except (ReadOnly, OSError, ValueError):
            return None
        return Path(value) if isinstance(value, str) and value else None

    def alert_intervals() -> dict[str, int]:
        try:
            value = read_settings()[0].get("workAlertIntervals")
        except (ReadOnly, OSError, ValueError):
            return {}
        return dict(value) if isinstance(value, dict) else {}

    alert_watch = AlertWatch(space, folder=alert_folder, intervals=alert_intervals, announce=announce)
    app.state.alert_watch = alert_watch

    # M18: background reviews and the curator, one each per app.
    def claude_path() -> str | None:
        from . import ai

        try:
            setting = read_settings()[0].get("claudePath")
        except (ReadOnly, OSError, ValueError):
            setting = None
        return ai.find_claude(setting)

    reviews = ReviewRunner(announce, space.root, space.name)
    curator = Curator(announce, idle, reviews, space.root, space.name, lambda: space.clock(), claude_path)
    app.state.reviews = reviews
    app.state.idle = idle
    app.state.curator = curator

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
            return _error(404, f'There is no object at "{req.path}".')
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
            return _error(404, f'There is no object at "{req.path}".')
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
            return _error(404, f'There is no object at "{req.path}".')
        if version != before:
            announce(ChangeEvent("changed", _norm(req.path), version, origin=req.clientId))
        return {"id": object_id, "version": version}

    @api.post("/object/duplicate", status_code=201)
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
            _display_safe({"path": path, "version": version, "summary": asdict(summary)}),
            status_code=201,
        )

    @api.get("/object/export/properties")
    def export_props(path: str):
        try:
            return export_properties(space, path)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{path}".')

    @api.get("/object/export")
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
            out = export_object_to_file(space, path, opts.media, opts)
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
            return _error(404, f'There is no object at "{path}" or no object type "{typeId}".')
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
        return _display_safe(result.to_api())

    def announce_template_ids(before: dict[str, str], client_id: str | None) -> None:
        """Announce ``changed`` for each template that got an ``id`` since ``before``."""
        for path, version in space.template_versions().items():
            if path in before and before[path] != version:
                announce(ChangeEvent("changed", path, version, origin=client_id))

    @api.post("/objects", status_code=201)
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

    @api.post("/daily-notes", status_code=201)
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
            return _error(404, f'There is no object at "{path}".')
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
            return _error(404, f'There is no object type "{type_id}".')

    @api.post("/types/{type_id}/templates", status_code=201)
    def create_template(type_id: str, req: CreateTemplateRequest):
        try:
            path, version = space.create_template(type_id, req.name or "New template")
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no object type "{type_id}".')
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
            return _error(404, f'There is no object at "{req.path}".')
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
            return _error(404, f'There is no Trash entry "{trash_id}".')
        rewritten = result.setdefault("rewritten", [])
        for type_id in result["typeIds"]:
            announce(ChangeEvent("types", type_id, None, origin=clientId))
        for collection_id in result.get("collectionIds", []):
            announce(ChangeEvent("collections", collection_id, None, origin=clientId))
        for query_id in result.get("queryIds", []):
            announce(ChangeEvent("queries", query_id, None, origin=clientId))
        for rule_id in result.get("automationIds", []):
            announce(ChangeEvent("automations", rule_id, None, origin=clientId))
        if result.get("automationIds"):
            automations.rules_changed()
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
            return _error(404, f'There is no Trash entry "{trash_id}".')

    @api.delete("/trash")
    def empty_trash(clientId: str | None = Query(default=None)):
        del clientId
        return {"purged": space.empty_trash()}

    @api.get("/calendar")
    def get_calendar(from_: str | None = Query(default=None, alias="from"), to: str | None = None):
        if not from_ or not to:
            return _error(422, "A calendar range needs from and to (YYYY-MM-DD).")
        try:
            return SafeJSONResponse(space.calendar(from_, to))  # see `list_objects`
        except InvalidValue as exc:
            return _error(422, str(exc))

    @api.post("/rows")
    def post_rows(req: RowsRequest):
        search = (req.search.terms, req.search.mode) if req.search is not None else None
        try:
            rows = space.rows(req.typeIds, req.collectionIds, req.paths, search, req.preview)
        except InvalidValue as exc:
            return _error(422, str(exc))
        return SafeJSONResponse({"rows": [asdict(r) for r in rows]})  # see `list_objects`

    @api.get("/views/{type_id}")
    def get_views(type_id: str):
        t = space.type_by_id(type_id)
        if t is None:
            return _error(404, f'There is no object type "{type_id}".')
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
            return _error(404, f'There is no object type "{type_id}".')
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
            return _error(422, f"The UI state has no key named {', '.join(unknown)}.")
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
        # One read of each collection file: its definition and revision together.
        return _display_safe([c.to_api(rev) for c, rev in space.collections_with_revisions()])

    @api.post("/collections", status_code=201)
    def create_collection(req: CreateCollectionRequest):
        try:
            c = space.create_collection(req.name, req.typeIds, req.icon)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError:  # `JsonStore.path` refused the id made from the name
            return _error(422, "This name can't be used as a file name. Try a different name.")
        announce(ChangeEvent("collections", c.id, None, origin=req.clientId))
        return JSONResponse(_display_safe(c.to_api(space.collection_revision(c.id))), status_code=201)

    @api.put("/collections/{collection_id}")
    def save_collection(collection_id: str, req: SaveCollectionRequest):
        if collection_id not in space.collections:
            return _error(404, f'There is no collection "{collection_id}".')
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
            return _error(404, f'There is no collection "{collection_id}".')
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
            return _error(404, f'There is no collection "{collection_id}".')
        announce(ChangeEvent("collections", collection_id, None, origin=clientId))
        for path in result.deleted:
            announce(ChangeEvent("deleted", path, None, origin=clientId))
        for path in result.removed_from:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=clientId))
        return _display_safe(result.to_api())

    @api.get("/queries")
    def get_queries():
        return _display_safe([
            {**q.to_api(space.query_revision(q.id)), **query_api_extra(q)}
            for q in space.list_queries()
        ])

    @api.post("/queries", status_code=201)
    def create_query(req: CreateQueryRequest):
        try:
            q = space.create_query(req.name, req.definition, req.view)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError:  # `JsonStore.path` refused the id made from the name
            return _error(422, "This name can't be used as a file name. Try a different name.")
        announce(ChangeEvent("queries", q.id, None, origin=req.clientId))
        return JSONResponse(_display_safe(q.to_api(space.query_revision(q.id))), status_code=201)

    @api.put("/queries/{query_id}")
    def save_query(query_id: str, req: SaveQueryRequest):
        if _unusable_id(query_id):
            return _error(404, f'There is no query "{query_id[:60]}".')
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
            return _error(404, f'There is no query "{query_id}".')
        announce(ChangeEvent("queries", query_id, revision, origin=req.clientId))
        return _display_safe({"query": {**q.to_api(revision), **query_api_extra(q)}})

    @api.delete("/queries/{query_id}")
    def delete_query(query_id: str, clientId: str | None = Query(default=None)):
        if _unusable_id(query_id):
            return _error(404, f'There is no query "{query_id[:60]}".')
        try:
            trash_id = space.delete_query(query_id)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:  # M22: the built-in Tickets view (before ValueError's 404)
            return _error(422, str(exc))
        except (KeyError, ValueError):
            return _error(404, f'There is no query "{query_id}".')
        announce(ChangeEvent("queries", query_id, None, origin=clientId))
        return {"trashId": trash_id}

    @api.get("/type-gallery")
    def type_gallery():
        from .typetemplates import template_catalog

        return template_catalog(list(space.types))

    @api.post("/types", status_code=201)
    def create_type(req: CreateTypeRequest):
        try:
            t = space.create_type(
                req.name, req.pluralName, icon=req.icon, color=req.color, template=req.template
            )
        except InvalidValue as exc:
            return _error(422, str(exc))
        announce(ChangeEvent("types", t.id, None, origin=req.clientId))
        if req.template:
            # The template's saved query: no origin, so the creating window reloads its queries too.
            announce(ChangeEvent("queries", "*", None))
        return JSONResponse(t.to_api(type_revision(space.root, t.id)), status_code=201)

    @api.put("/types/{type_id}")
    def save_type(type_id: str, req: SaveTypeRequest):
        data = {**req.type, "id": type_id}
        data.setdefault("schemaVersion", 2)
        for field in ("name", "pluralName"):
            # `from_json` would fill these in; an edit that clears them is refused.
            if not isinstance(data.get(field), str) or not data[field].strip():
                return _error(422, "An object type needs a name and a plural name.")
        if data.get("propertyDefinitions") is not None and not isinstance(
            data["propertyDefinitions"], list
        ):
            return _error(422, 'The field "propertyDefinitions" must be a list.')
        if DEFAULT_LAYOUT_KEY in data:
            if data[DEFAULT_LAYOUT_KEY] is None:
                # null unsets it: the file then has no line for it.
                del data[DEFAULT_LAYOUT_KEY]
            else:
                # Only a changed value is checked, so a stored unknown one never blocks
                # saving the type's other settings.
                current = space.type_by_id(type_id)
                stored = current.extra.get(DEFAULT_LAYOUT_KEY) if current is not None else None
                layout = data[DEFAULT_LAYOUT_KEY]
                if layout != stored and layout not in DATA_VIEW_LAYOUTS:
                    return _error(422, f'"{layout}" is not a list view layout.')
        for entry in data.get("propertyDefinitions") or []:
            if isinstance(entry, dict) and "options" in entry:
                bad = option_shape_problems(entry["options"])
                if bad:
                    name = entry.get("name") or entry.get("key") or "a property"
                    return _error(422, f"The options of {name} are not valid: {', '.join(bad)}.")
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
            return _error(404, f'There is no object type "{type_id}".')
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
            return _error(404, f'There is no property "{pid}" on object type "{type_id}".')
        announce(ChangeEvent("types", type_id, None, origin=req.clientId))
        for path in result.rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        return _display_safe(result.to_api())

    @api.post("/types/{type_id}/properties/{pid}/number-existing")
    def number_existing(type_id: str, pid: str, req: NumberExistingRequest):
        try:
            result = space.number_existing(type_id, pid, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no property "{pid}" on object type "{type_id}".')
        announce(ChangeEvent("types", type_id, None, origin=req.clientId))
        for path in result.rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        return _display_safe(result.to_api())

    @api.post("/formula/preview")
    def formula_preview(req: FormulaPreviewRequest):
        """M12: parse (and with ``path``, evaluate) an expression. Writes nothing."""
        t = space.type_by_id(req.typeId)
        if t is None:
            return _error(404, f'There is no object type "{req.typeId}".')
        try:
            parse_formula(req.expression) if req.expression.strip() else None
        except FormulaError as exc:
            return {"value": None, "error": str(exc)}
        if not req.path:
            return {"value": None, "error": None}
        if req.properties is not None:
            t = copy.deepcopy(t)
            defs = []
            for entry in req.properties:
                try:
                    defs.append(PropertyDefinition.from_json(entry))
                except (ValueError, TypeError, AttributeError):
                    continue
            t.propertyDefinitions = defs
        try:
            _of, fm, _version = space.read(req.path)
            summary = space.get(req.path)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        value = Computer(space, types={t.id: t}).evaluate(Obj(summary.path, fm, summary, t), req.expression)
        return _display_safe(
            {"value": value, "error": value.get("error") if value["type"] == "error" else None}
        )

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
            return _error(404, f'There is no property "{pid}" on object type "{type_id}".')
        for t in result.types:
            announce(ChangeEvent("types", t.id, None, origin=req.clientId))
        for path in result.rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        return _display_safe(result.to_api())

    @api.post("/types/{type_id}/relation-pair")
    def relation_pair(type_id: str, req: RelationPairRequest):
        """M13: add (or reuse) the sub-items or dependencies pair; rewrites no object."""
        try:
            result = space.create_relation_pair(type_id, req.kind, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no object type "{type_id}".')
        if result.changed:
            announce(ChangeEvent("types", type_id, None, origin=req.clientId))
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
            return _error(404, f'There is no object type "{type_id}".')
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
        # The saved queries that went to the trash with the type, or dropped it.
        query_ids = [str(q) for q in manifest.get("queries") or []]
        for ref in manifest.get("queryRefs") or []:
            if str(ref.get("queryId")) not in query_ids:
                query_ids.append(str(ref.get("queryId")))
        for query_id in query_ids:
            announce(ChangeEvent("queries", query_id, None, origin=clientId))
        # The window that deleted can't list these itself: tell it what changed.
        return {"trashId": item.id, "paths": paths, "typeIds": type_ids, "queryIds": query_ids}

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

    async def _upload_body(request: Request) -> bytes | None:
        """The uploaded bytes, or None once they exceed the 100 MiB limit (413)."""
        limit = media.MAX_ATTACHMENT_BYTES
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > limit:
            return None
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                return None
            chunks.append(chunk)
        return b"".join(chunks)

    @api.post("/images", status_code=201)
    async def post_image(request: Request, name: str = Query(default="")):
        too_large = _error(413, media.UPLOAD_LIMIT_DETAIL)
        data = await _upload_body(request)
        if data is None:
            return too_large
        try:
            path = await asyncio.to_thread(import_image, space.root, name, data)
        except NotAnImage:
            return _error(415, "Only png, jpg, jpeg, gif, webp and svg images can be added.")
        except media.SidecarUpload:
            return _error(415, media.SIDECAR_UPLOAD_DETAIL)
        except TooLarge:
            return too_large
        except ValueError as exc:
            return _error(422, str(exc))
        return JSONResponse({"path": path}, status_code=201)

    @api.get("/attachments")
    def get_attachments():
        return _display_safe(list_attachments(space.root))

    @api.post("/attachments", status_code=201)
    async def post_attachment(request: Request, name: str = Query(default="")):
        too_large = _error(413, media.UPLOAD_LIMIT_DETAIL)
        data = await _upload_body(request)
        if data is None:
            return too_large
        try:
            path, kind = await asyncio.to_thread(import_attachment, space.root, name, data)
        except TooLarge:
            return too_large
        except media.MarkdownUpload:
            return _error(415, media.MARKDOWN_UPLOAD_DETAIL)
        except media.SidecarUpload:
            return _error(415, media.SIDECAR_UPLOAD_DETAIL)
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
            return _error(404, f'There is no file at "{req.path}".')
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
            return _error(404, f'There is no file at "{path}".')
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
            return _error(404, f'No object matches "{link}".')
        return {"path": path}

    @api.post("/reveal")
    def reveal(req: RevealRequest):
        try:
            full = space.abspath(req.path)
        except ValueError as exc:
            return _error(400, str(exc))
        if not full.is_file():
            return _error(404, f'There is no object at "{req.path}".')
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
            """Run one reminder check and one automation schedule tick at the clock's instant
            (test hook only)."""
            now = space.clock()
            fired = scheduler.tick(now)
            runs = automations.scheduler.tick(now)
            return {
                "fired": [
                    {"path": d.path, "title": d.title, "body": d.body, "trigger": d.trigger.isoformat()}
                    for d in fired
                ],
                "automationRuns": runs,
                "agentJobs": automations.agent_jobs.pending(),
            }

        @api.post("/_test/agent-schedules/idle")
        def test_agent_schedules_idle():
            """Wait up to 30 s until no agent schedule job is queued or running (M21 test hook)."""
            return {"idle": automations.agent_jobs.wait_idle(30.0)}

        @api.post("/_test/automations/idle")
        def test_automations_idle():
            """Wait up to 10 s until the automation trigger queue is empty (test hook only)."""
            return {"idle": automations.wait_idle(10.0)}

        @api.post("/_test/reviews/idle")
        def test_reviews_idle():
            """Wait up to 10 s until no background review runs (M18 test hook only)."""
            return {"idle": reviews.wait_idle(10.0)}

        @api.post("/_test/curator/tick")
        async def test_curator_tick():
            """Run one curator tick at the clock's instant (M18 test hook only)."""
            return {"agents": await curator.tick()}

    ctx = ApiContext(space, announce, search, settings_changed)
    api.include_router(api_app.router())  # GET /api/app: the version (Settings footer)
    api.include_router(api_search.router(ctx))
    api.include_router(api_references.router(ctx))
    api.include_router(api_graph.router(ctx))
    # M8: each router is filled by its own task (see the plan's "Shared files").
    for module in (api_tasks, api_history, api_blocks, api_merge, api_spaces_m8):
        api.include_router(module.router(ctx))
    # M15: the import routes (`api_import`; the importers are in `importers/`).
    imports = api_import.router(ctx)
    api.include_router(imports)
    api.include_router(api_importscan.router(ctx))  # M26: the sensitive-content scan
    api.include_router(api_automations.router(ctx, automations))
    # M11: the local API for agents and scripts (Bearer tokens) and its token routes.
    api.include_router(api_v1.router(ctx))
    # M17: the v1 routes behind the expanded objectapp-mcp, an agent's own v1 routes and the
    # agent routes (filled by the plan's T5, T6 and T7).
    api.include_router(api_v1_tools.router(ctx, automations, imports))
    api.include_router(api_agent_v1.router(ctx))
    # M18: the agent tools' learning routes, beside M17's agent v1 routes.
    api.include_router(api_learning_v1.router(ctx))
    # M21: the agent tools' schedule routes (filled by the plan's T4).
    api.include_router(api_schedules_v1.router(ctx, automations))
    # M20: the agent tools' A2A and delegation routes (filled by the plan's T6).
    api.include_router(api_agent_a2a_v1.router(ctx))
    # M22: one work service per app; the app's work routes and the agents' (filled by T9).
    def jira_site() -> str | None:
        # `space_fields` checks the address (http(s) only), so a hand-edited value never
        # becomes a ticket link.
        site = space_fields(space.root)["jiraSite"]
        return site if isinstance(site, str) and site else None

    def activity_name() -> str:
        try:
            name = read_settings()[0].get("activityName")
        except (ReadOnly, OSError, ValueError):
            name = None
        return name if isinstance(name, str) and name.strip() else "Gene"

    work = WorkService(space, jira_site=jira_site, user_name=activity_name)
    app.state.work = work
    api.include_router(api_work.router(ctx, work))
    api.include_router(api_v1_work.router(ctx, work))
    # M24: one work loop per app beside the work service, made before M23's seams are built
    # (`build_seams` finds it with `workloop.loop_for`); the queue, captures and Desk sync routes.
    work_loop = WorkLoop(space, work, announce=announce, base_url=lambda: base_url or idle.base_url)
    worktools.install(work_loop, work)
    schedulerun.PURPOSE_FOR = desksync.purpose_for
    api.include_router(api_work_agent.router(ctx, work_loop, work))
    api.include_router(api_captures.router(ctx, work_loop, work))
    api.include_router(api_desksync.router(ctx, work_loop, work, automations))
    api.include_router(api_v1_captures.router(ctx, work_loop, work))
    api.include_router(api_v1_desksync.router(ctx, work_loop, work))
    # M23: the Work section's routes, over the same service, the M24 seams and the alert watch.
    api.include_router(api_work_section.router(ctx, work, build_seams(space, work), alert_watch))
    # M18: the learning routes go before api_agents, whose GET /agents/{id}/chats/{chatId} would
    # otherwise take /agents/{id}/chats/search for a chat id.
    api.include_router(api_learning.router(ctx, reviews=reviews, curator=curator))
    # M19: the MCP server, secret and tool-refresh routes (filled by the plan's T6).
    api.include_router(api_mcp.router(ctx))
    # M20: the remote-agent routes, before api_agents (filled by the plan's T5).
    api.include_router(api_remote_agents.router(ctx))
    api.include_router(api_agents.router(ctx))
    # M10: the AI assistant (status, a chat turn over SSE, saved AI chats).
    api.include_router(api_ai.router(ctx, reviews=reviews, curator=curator))
    app.include_router(api)
    # M6: the whiteboard routes carry their own /api prefix.
    app.include_router(whiteboard_router(space, announce_whiteboard))

    if static_dir is not None and Path(static_dir).is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app
