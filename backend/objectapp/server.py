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
- M28 (T3): ``POST /api/spaces`` and ``POST /api/space/setup`` take ``setup: 'itops'`` (IT
  operations); the IT ops pick announces ``types`` ``*`` and each template and seed Tag as
  ``created``, and ``POST /api/types`` announces the default template an IT ops gallery type gets.
- M33: ``GET /api/space/title-headings`` -> ``{count}`` and ``POST
  /api/space/title-headings/remove`` -> ``{changed}`` (`api_titleheadings`: notes that begin with a
  heading repeating their title; the removal announces ``changed`` per note, or one resync).
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
  Every route this module once defined inline lives in its own `api_*` module now
  (`api_space`, `api_settings`, `api_spaces`, `api_objects`, `api_trash`, `api_calendar`,
  `api_rows`, `api_views`, `api_ui`, `api_collections`, `api_queries`, `api_types`,
  `api_tags`, `api_media`, `api_resolve`, `api_events`, and the ``/_test`` hooks in
  `api_testhooks`); `create_app` below stays the composition root: it builds the app,
  wires the services and middleware, and includes every router on ``/api``.
- M15 (`api_import`): ``POST /api/import/preview``, ``POST /api/import/start``,
  ``GET /api/import/jobs/{id}``, ``POST /api/import/jobs/{id}/cancel``; see that module.
- M10: `api_ai` adds the AI assistant: ``GET /api/ai/status``, ``POST /api/ai/chat``
  (Server-Sent Events of `AiEvent`), ``GET /api/ai/chat?path=``, ``POST /api/ai/chat/save``.
- M11: `api_v1` adds the token-protected local API (``/api/v1/*``) and the token routes
  (``/api/integrations/tokens``); its docstring lists them.
- M29: `api_v1_synced` adds ``POST /api/v1/synced/{typeId}`` (a ``read-write`` or ``sync``
  token fills a type's synced facts, kept in ``.object/synced/<typeId>.json``; see that
  module). ``GET /api/object`` gains ``synced: {refreshedAt, values}`` when the object's type
  has synced properties, and its ``computed`` reads the synced values (``frontmatter`` stays the
  file's own); ``POST /api/rows`` rows carry ``syncedAt``. ``PUT /api/types/{id}`` answers
  ``422`` with the first problem of the type's ``namePatterns`` (`typesuggest.pattern_problems`)
  or of a property's ``synced`` mark (`typemodel.synced_problems`).

Errors: a path outside the space or not an object is ``400``; a missing object is ``404``;
a file the OS refused to write (locked by another program, say) is ``503 {detail}``.
"""

from __future__ import annotations

import logging
import asyncio
import contextlib
import os
import subprocess
import sys
import threading
from collections.abc import AsyncIterator, Callable
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from . import (
    api_agent_a2a_v1,
    api_agent_v1,
    api_agents,
    api_app,
    api_automations,
    api_ai,
    api_blocks,
    api_calendar,
    api_captures,
    api_collections,
    api_desksync,
    api_events,
    api_graph,
    api_history,
    api_fullexport,
    api_import,
    api_importscan,
    api_learning,
    api_learning_v1,
    api_mcp,
    api_media,
    api_merge,
    api_objects,
    api_queries,
    api_references,
    api_remote_agents,
    api_resolve,
    api_rows,
    api_schedules_v1,
    api_search,
    api_settings,
    api_space,
    api_spaces,
    api_spaces_m8,
    api_storage,
    api_tags,
    api_tasks,
    api_testhooks,
    api_titleheadings,
    api_trash,
    api_types,
    api_ui,
    api_v1,
    api_v1_captures,
    api_v1_desksync,
    api_v1_synced,
    api_v1_tools,
    api_v1_work,
    api_vcs,
    api_views,
    api_work,
    api_work_agent,
    api_work_section,
    delegation,
    learnhooks,
    mcpgateway,
    desksync,
    schedulerun,
    worktools,
)
from .agentrun import running_run_pids
from .alertwatch import AlertWatch
from .apictx import ApiContext
from .curator import ActivityMiddleware, Curator, IdleClock
from .keycompat import KeyCompatMiddleware
from .appstate import state_dir
from .automations import AutomationEngine
from .notify import FileNotifier, system_notifier
from .reminders import ReminderScheduler, file_clock
from .reviews import ReviewRunner
from .runfence import RunFenceMiddleware
from .searchindex import SearchIndex
from .settings import ACTIVITY_NAME_FALLBACK, time_zone
from .settings import activity_name as settings_activity_name
from .settings import read as read_settings
from .space import ReadOnly, Space
from .spaces import Registry
from .spaceconfig import space_fields
from .typedefs import has_undecodable
from .uikey import LaunchKey, UiKeyMiddleware
from .vcsservice import VcsService
from .watcher import LINKED_KINDS, ChangeEvent, SpaceWatcher
from .whiteboardapi import whiteboard_router
from .workloop import WorkLoop, wake_for
from .workseams import build_seams
from .workservice import WorkService
from .workview import TICKETS_ID

# `api_objects`' save and export routes and `api_resolve`'s reveal route call these through
# this module at call time (``server.on_change_event``, ``server.export_object_to_file``;
# ``server.reveal_in_file_manager`` is defined below); the tests patch them here.
from .export import export_object_to_file  # noqa: F401
from .workloop import on_change_event  # noqa: F401


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


def event_payload(event: ChangeEvent) -> dict[str, Any]:
    """The SSE ``data`` of `event`: its fields, ``linked`` only when known (`ChangeEvent.linked`)."""
    out = asdict(event)
    if out["linked"] is None:
        del out["linked"]
    else:
        out["linked"] = list(out["linked"])
    return out


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



class _AppFiles(StaticFiles):
    """The built front end. M33: the page itself (`index.html`) is sent with ``Cache-Control:
    no-cache``, so a window that keeps its cache between launches (the desktop window does) asks
    again after the app is rebuilt and never starts on an old page that names scripts which are
    gone. The scripts and styles carry a hash in their names and may be cached as before."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        if response.media_type == "text/html":
            response.headers["Cache-Control"] = "no-cache"
        return response


def create_app(
    space: Space,
    static_dir: Path | None = None,
    watch: bool = True,
    on_switch: Callable[[Path], None] | None = None,
    base_url: str | None = None,
    ui_key: LaunchKey | None = None,
) -> FastAPI:
    """The app for `space`. With `watch`, a `SpaceWatcher` runs for the app's lifespan.

    Decision S6: `ui_key` is the launcher's per-launch key (`uikey.LaunchKey`); with it every
    ``/api`` request (bar ``/api/v1`` with a bearer token) and the page itself need the key
    (`UiKeyMiddleware`), and ``/_open`` hands it to the window. Without it (tests, acceptance
    scripts) there is no key check; the run fence applies either way.

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
        vcs_service.start()
        scheduler.start()
        search.start()
        automations.start()
        work_loop.start()
        alert_watch.start()
        curator.start()
        full_export_auto.start()  # M31: Automated Full Exports
        if not watch:
            try:
                yield
            finally:
                await asyncio.to_thread(full_export_auto.stop)
                await curator.stop()
                await asyncio.to_thread(work_loop.stop)
                await asyncio.to_thread(automations.stop)
                await asyncio.to_thread(alert_watch.stop)
                await asyncio.to_thread(vcs_service.stop)  # the closing commit
                hub.close()
                await asyncio.to_thread(search.stop)
                await asyncio.to_thread(scheduler.stop)
            return
        watcher = SpaceWatcher(space, hub.loop)
        watcher.start()

        async def pump() -> None:
            while True:
                hub.publish(await watcher.events.get())
                if watcher.events.empty():
                    # M32: a change made outside the app can move the Work default too.
                    await asyncio.to_thread(announce_work_moved)

        task = asyncio.create_task(pump())
        try:
            yield
        finally:
            await asyncio.to_thread(full_export_auto.stop)
            await curator.stop()
            await asyncio.to_thread(work_loop.stop)
            await asyncio.to_thread(automations.stop)
            await asyncio.to_thread(alert_watch.stop)
            await asyncio.to_thread(vcs_service.stop)  # the closing commit
            hub.close()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            await asyncio.to_thread(watcher.stop)
            await asyncio.to_thread(search.stop)
            await asyncio.to_thread(scheduler.stop)

    # 2026-11-08: version control. Off until the user turns it on for a space; the worker commits
    # after a quiet spell (app writes reset the wait through the space listener).
    def registered_spaces() -> list[Path]:
        try:
            return [Path(e.path) for e in Registry(state_dir()).list(current=space.root) if not e.missing]
        except (OSError, ValueError):
            return []

    vcs_service = VcsService(space, registered_spaces=registered_spaces)
    space.add_listener(lambda _change: vcs_service.touch())

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
    # 2026-11-08: an agent run (the CLI's process tree) can't use the app's own /api routes;
    # /api/v1 with a bearer token (the MCP servers' path) and the static files stay as they are.
    app.add_middleware(RunFenceMiddleware, run_pids=running_run_pids)
    if ui_key is not None:
        # Decision S6: the launch key, checked before the run fence (its second layer).
        app.add_middleware(UiKeyMiddleware, key=ui_key)
    app.add_middleware(LocalOnlyMiddleware)  # added last: the outermost, so it checks first
    app.state.space = space
    app.state.vcs = vcs_service
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

    def announce(event: ChangeEvent) -> ChangeEvent:
        """Publish `event` to the SSE clients from a worker thread; returns the event as published.

        An object event gets `ChangeEvent.linked` here, the paths whose backlinks the change may
        have altered, read from the link index after the write (every write of one request is
        done by its first announce, so that event carries the lot; the later ones get ``()``).
        The save routes return it so the saving window's own local event can carry the same list.
        """
        if event.kind in LINKED_KINDS and event.linked is None:
            try:
                event = replace(event, linked=space.links.take_linked())
            except Exception:  # the write is done; an index problem must not fail the request
                logging.getLogger(__name__).exception("Reading the links changed by %s failed", event.path)
        publish(event)
        announce_work_moved()
        return event

    def publish(event: ChangeEvent) -> None:
        loop = hub.loop
        if loop is not None and loop.is_running() and not hub.closed:
            loop.call_soon_threadsafe(hub.publish, event)

    work_seen = [(space.work_on(), space.work_listing_rev)]

    def announce_work_moved() -> None:
        """M32 (fix pass): tell the windows when the Work switch's effect moved. The default
        follows the space's data, so any write can flip it (a Ticket ID put on a task, the last
        one removed, a Capture type made, a file changed outside the app), and with Work off a
        value that comes or goes changes which ticket and work fields a type lists. The types
        and the saved searches (Tickets) changed in memory then, with no event of their own:
        every announce (and the watcher's pump) asks here, which compares two values kept in
        memory with the ones last announced. ``PUT /api/space`` announces through it as well."""
        try:
            now = (space.work_on(), space.work_listing_rev)
        except Exception:  # the write is done; this must not fail the request
            logging.getLogger(__name__).exception("Reading the Work switch failed")
            return
        seen = work_seen[0]
        if now == seen:
            return
        work_seen[0] = now
        publish(ChangeEvent("types", "*", None))
        if now[0] != seen[0]:
            publish(ChangeEvent("queries", TICKETS_ID, None))
            wake_for(space)  # what the Work agent left waiting while Work was off

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

    def announce_whiteboard(event: ChangeEvent) -> None:
        """The whiteboard routes' announce: a board save also refreshes the board's links and
        search text (the link index and the search index re-read it on this rescan)."""
        if event.kind == "whiteboard":
            space.rescan_file(event.path)
        announce(event)

    ctx = ApiContext(space, announce, search, settings_changed)
    # The app's own routes, in the order they were once defined inline here, ahead of the
    # routers below; each module's docstring lists its routes.
    api.include_router(api_space.router(ctx, announce_work_moved))
    api.include_router(api_settings.router(ctx))
    api.include_router(api_spaces.router(ctx, on_switch))
    api.include_router(api_objects.router(ctx))
    api.include_router(api_trash.router(ctx, automations))
    api.include_router(api_calendar.router(ctx))
    api.include_router(api_rows.router(ctx))
    api.include_router(api_views.router(ctx))
    api.include_router(api_ui.router(ctx))
    api.include_router(api_collections.router(ctx))
    api.include_router(api_queries.router(ctx))
    api.include_router(api_types.router(ctx))
    api.include_router(api_tags.router(ctx))
    api.include_router(api_media.router(ctx))
    api.include_router(api_resolve.router(ctx))
    api.include_router(api_events.router(hub))
    if fake_notify:  # the ``/_test`` hooks, only under the fake notifier
        api.include_router(api_testhooks.router(space, scheduler, automations, reviews, curator))

    api.include_router(api_app.router())  # GET /api/app: the version (Settings footer)
    api.include_router(api_search.router(ctx))
    api.include_router(api_references.router(ctx))
    api.include_router(api_graph.router(ctx))
    api.include_router(api_storage.router(ctx))  # M31: Offline & Sync's Local Storage, Clear media cache
    # M33: notes that begin with a heading repeating their title (the count, and its removal)
    api.include_router(api_titleheadings.router(ctx))
    # M8: each router is filled by its own task (see the plan's "Shared files").
    for module in (api_tasks, api_history, api_blocks, api_merge, api_spaces_m8):
        api.include_router(module.router(ctx))
    from . import api_definition_history  # M31: restore a definition's version
    api.include_router(api_definition_history.router(ctx))
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
        # M32: no name is built in; an empty ``activityName`` reads as "You".
        try:
            return settings_activity_name(read_settings()[0])
        except (ReadOnly, OSError, ValueError):
            return ACTIVITY_NAME_FALLBACK

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
    # M29: ``POST /api/v1/synced/{typeId}``, a script's or agent's synced facts.
    api.include_router(api_v1_synced.router(ctx))
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
    # 2026-11-08: version control and backup (`vcsservice`); fenced from agent runs like every
    # /api route, and not an MCP tool.
    vcs_service.on_restored = lambda target, changed: api_vcs.reload_after_restore(ctx, target, changed)
    api.include_router(api_vcs.router(ctx, vcs_service))
    # M31: Full Export, manual (background jobs) and automated (started in `lifespan`).
    full_export_auto = api_fullexport.auto_export(space)
    api.include_router(api_fullexport.router(ctx, full_export_auto))
    app.include_router(api)
    # M6: the whiteboard routes carry their own /api prefix.
    app.include_router(whiteboard_router(space, announce_whiteboard))

    if static_dir is not None and Path(static_dir).is_dir():
        app.mount("/", _AppFiles(directory=static_dir, html=True), name="static")

    return app
