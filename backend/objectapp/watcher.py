"""Watch a space folder and turn file changes into `ChangeEvent`s.

watchdog delivers file-system events on its own thread. Each object path is
debounced (150 ms of quiet), then re-read: the `Space` summary is refreshed and
a `ChangeEvent` is put on `SpaceWatcher.events` (an asyncio queue on the given
loop). Nothing is emitted for:

- dot-folders (``.capacities``, ``.capacities-cache``, ``.git``…), dot-files and
  non-``.md`` files;
- writes the app makes itself (`Space._write` and the definition stores record them in
  ``own_writes``)
  and files it moves to the trash (``own_deletes``): the server announces those
  itself, tagged with the saving client's id;
- events that leave the file bytes as the space already knows them.

The JSON definitions ``.capacities/{collections,queries,views}/<id>.json`` and
``.capacities/ui.json`` are watched too (kinds ``collections``, ``queries``, ``views``,
``ui``); every other file under a dot-folder stays ignored.

A whiteboard's sidecars (``<stem>.whiteboard.json``, ``<stem>.ink.svg``, M6) are watched as
well: a change made outside the app announces ``whiteboard`` with the board's ``.md`` path
(only when that ``.md`` is a whiteboard), and re-scans the ``.md`` so the link index and
search re-read the board. The app's own sidecar writes and moves stay quiet.

Files are only opened (read, or resolved) while holding the space's lock, so a
read never overlaps one of the app's own replaces (Windows refuses to replace a
file another handle has open).
"""

from __future__ import annotations

import asyncio
import os
import threading
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Literal

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from .space import Space, version_of
from .typedefs import is_ignored
from .whiteboardfile import sidecar_owner

__all__ = ["DEBOUNCE_SECONDS", "ChangeEvent", "SpaceWatcher"]

DEBOUNCE_SECONDS = 0.150
_DEFINITION_FOLDERS = ("collections", "queries", "views")


@dataclass(frozen=True)
class ChangeEvent:
    kind: Literal[
        "created",
        "changed",
        "deleted",
        "renamed",
        "types",
        "collections",
        "queries",
        "views",
        "ui",
        "whiteboard",
    ]
    path: str
    """Space-relative POSIX path of the object file (for ``types``: the type id; for
    ``collections``, ``queries`` and ``views``: the definition id; for ``ui``: ``ui.json``;
    for ``whiteboard``: the board's ``.md``, whose canvas or ink file changed)."""
    version: str | None
    """The new file version (sha256 of its bytes); ``None`` when deleted."""
    origin: str | None = None
    """For a write made through the API: the writing client's id (its ``clientId``)."""
    oldPath: str | None = None
    """For ``renamed``: the object's path before the move."""


def _has_exact_name(full: Path) -> bool:
    """True when the folder holds ``full``'s name with exactly this spelling (case included)."""
    try:
        return full.name in os.listdir(full.parent)
    except OSError:
        return False


class _Handler(FileSystemEventHandler):
    def __init__(self, watcher: SpaceWatcher) -> None:
        self._watcher = watcher

    def on_any_event(self, event: FileSystemEvent) -> None:
        if event.event_type in ("opened", "closed_no_write"):
            return
        for raw in (event.src_path, getattr(event, "dest_path", "")):
            if not raw:
                continue
            path = os.fsdecode(raw)
            if event.is_directory:
                if event.event_type in ("moved", "deleted"):
                    self._watcher._touch_folder(path)
                continue
            self._watcher._touch(path)


class SpaceWatcher:
    """Watches `space.root`; emits debounced `ChangeEvent`s onto `events`."""

    def __init__(self, space: Space, loop: asyncio.AbstractEventLoop) -> None:
        self.space = space
        self.loop = loop
        self.events: asyncio.Queue[ChangeEvent] = asyncio.Queue()
        self._timers: dict[str, threading.Timer] = {}
        self._lock = threading.Lock()
        self._observer = None
        self._stopped = False

    # -- lifecycle ----------------------------------------------------------

    def start(self) -> None:
        if self._observer is not None:
            return
        self._stopped = False
        observer = Observer()
        observer.schedule(_Handler(self), str(self.space.root), recursive=True)
        observer.daemon = True
        observer.start()
        self._observer = observer

    def stop(self) -> None:
        self._stopped = True
        with self._lock:
            timers = list(self._timers.values())
            self._timers.clear()
        for t in timers:
            t.cancel()
        observer, self._observer = self._observer, None
        if observer is not None:
            observer.stop()
            observer.join(timeout=5)

    # -- event intake (watchdog thread) ---------------------------------------

    def _space_rel(self, path: str) -> PurePosixPath | None:
        """`path` relative to the space root, or None when it lies outside it.

        A path whose folder was just removed (emptying the Trash deletes a type's
        folder while watchdog still reports the files in it) can make
        ``resolve()`` raise OSError on Windows; fall back to the plain absolute
        path rather than let the watcher thread die.
        """
        try:
            full = Path(path).resolve()
        except OSError:
            full = Path(os.path.abspath(path))
        try:
            return PurePosixPath(full.relative_to(self.space.root).as_posix())
        except ValueError:
            return None

    def _relpath(self, path: str) -> str | None:
        """The space-relative object path for `path`, or None if it isn't one."""
        rel = self._space_rel(path)
        if rel is None:
            return None
        if not rel.parts or is_ignored(rel) or rel.name.startswith("."):
            return None
        if rel.suffix.lower() != ".md":
            # A whiteboard sidecar is reported under its own path (see `_refresh_sidecar`).
            return rel.as_posix() if sidecar_owner(rel.as_posix()) else None
        return rel.as_posix()

    def _definition_rel(self, path: str) -> str | None:
        """The space-relative path when `path` is a watched ``.capacities`` JSON definition."""
        rel = self._space_rel(path)
        if rel is None:
            return None
        parts = rel.parts
        if rel.suffix != ".json" or parts[0] != ".capacities":
            return None
        if len(parts) == 2 and parts[1] == "ui.json":
            return rel.as_posix()
        if len(parts) == 3 and parts[1] in _DEFINITION_FOLDERS and not parts[2].startswith("."):
            return rel.as_posix()
        return None

    def _touch(self, path: str) -> None:
        # `resolve()` opens the file on Windows; doing that while the app
        # replaces it would make the replace fail, so wait for the space's lock.
        with self.space._lock:
            rel = self._relpath(path)
            if rel is None:
                rel = self._definition_rel(path)
        if rel is not None:
            self._schedule(rel)

    def _touch_folder(self, path: str) -> None:
        """A folder moved or vanished: re-check every known object beneath it."""
        with self.space._lock:
            rel = self._space_rel(path)
        if rel is None:
            return
        prefix = rel.as_posix() + "/"
        for s in self.space.list():
            if s.path.startswith(prefix):
                self._schedule(s.path)

    def _schedule(self, rel: str) -> None:
        if self._stopped:
            return
        timer = threading.Timer(DEBOUNCE_SECONDS, self._fire, args=(rel,))
        timer.daemon = True
        with self._lock:
            old = self._timers.pop(rel, None)
            self._timers[rel] = timer
        if old is not None:
            old.cancel()
        timer.start()

    # -- debounced handling (timer thread) ----------------------------------

    def _fire(self, rel: str) -> None:
        with self._lock:
            if self._timers.get(rel) is threading.current_thread():
                del self._timers[rel]
        if self._stopped:
            return
        try:
            # Read under the space's lock: an open read handle (no FILE_SHARE_DELETE
            # on Windows) would make a concurrent save's replace fail.
            with self.space._lock:
                event = self._refresh(rel)
        except Exception:  # never let a bad file kill the watcher thread
            return
        if event is not None and not self._stopped:
            try:
                self.loop.call_soon_threadsafe(self.events.put_nowait, event)
            except RuntimeError:  # loop closed
                pass

    def _refresh_definition(self, rel: str) -> ChangeEvent | None:
        """A JSON definition changed: an event unless it is the app's own write."""
        space = self.space
        try:
            data = (space.root / rel).read_bytes()
        except (FileNotFoundError, NotADirectoryError, OSError):
            data = None
        version = None if data is None else version_of(data)
        parts = PurePosixPath(rel).parts
        if len(parts) == 3 and parts[1] == "collections":
            # Name resolution must see an external edit before any client reloads.
            space.reload_collection(PurePosixPath(rel).stem)
        own = space.own_writes.get(rel)
        if own is not None:
            if own == (version or ""):
                if version is None:
                    space.own_writes.pop(rel, None)
                return None
            space.own_writes.pop(rel, None)
        if len(parts) == 2:
            return ChangeEvent(kind="ui", path="ui.json", version=version)
        return ChangeEvent(kind=parts[1], path=PurePosixPath(rel).stem, version=version)

    def _refresh_sidecar(self, rel: str, owner: str) -> ChangeEvent | None:
        """A whiteboard sidecar changed: ``whiteboard`` for its board unless the app did it."""
        from .whiteboardtrash import sidecar_event_owner

        space = self.space
        try:
            data = (space.root / rel).read_bytes()
        except OSError:
            data = None
        version = None if data is None else version_of(data)
        if data is None:
            if space.own_deletes.pop(rel, None) is not None:
                space.own_writes.pop(rel, None)
                return None
        else:
            space.own_deletes.pop(rel, None)
            own = space.own_writes.get(rel)
            if own is not None:
                if own == version:
                    return None
                space.own_writes.pop(rel, None)
        if sidecar_event_owner(space, rel) != owner:
            return None
        space.rescan_file(owner)  # writes nothing; the indexes re-read the board
        return ChangeEvent(kind="whiteboard", path=owner, version=version)

    def _refresh(self, rel: str) -> ChangeEvent | None:
        if rel.startswith(".capacities/"):
            return self._refresh_definition(rel)
        owner = sidecar_owner(rel)
        if owner is not None:
            return self._refresh_sidecar(rel, owner)
        space = self.space
        full = space.root / rel
        known = space.cached_version(rel)
        try:
            data = full.read_bytes() if full.is_file() else None
        except OSError:
            data = None

        if data is None:
            if space.own_deletes.pop(rel, None) is not None:
                # The app moved it away itself (to the trash) and announced it.
                space.rescan_file(rel)
                space.own_writes.pop(rel, None)
                return None
            if known is None:
                return None
            space.rescan_file(rel)
            space.own_writes.pop(rel, None)
            return ChangeEvent(kind="deleted", path=rel, version=None)

        if known is None and not _has_exact_name(full):
            # Another spelling of a file the space knows under its real name (a
            # case-insensitive file system), e.g. the old name after a case-only
            # rename: not a new object.
            space.own_deletes.pop(rel, None)
            space.own_writes.pop(rel, None)
            return None
        version = version_of(data)
        # The file is back (restored or re-created): a pending own delete is stale.
        space.own_deletes.pop(rel, None)
        # An own write is matched once, then forgotten (`known` keeps a repeat event
        # for it quiet): a later external edit back to the same bytes is news.
        own = space.own_writes.pop(rel, None)
        if version == known or version == own:
            if version != known:
                space.rescan_file(rel)
            return None
        space.rescan_file(rel)
        kind = "created" if known is None else "changed"
        return ChangeEvent(kind=kind, path=rel, version=version)
