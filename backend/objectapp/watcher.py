"""Watch a space folder and turn file changes into `ChangeEvent`s.

watchdog delivers file-system events on its own thread. Each object path is
debounced (150 ms of quiet) by one worker thread that keeps a pending set, then
re-read in batches: the `Space` summary is refreshed and a `ChangeEvent` per path
is put on `SpaceWatcher.events` (an asyncio queue on the given loop); a batch of
more than `RESYNC_AFTER` object events (a ``git checkout``) is sent as one resync
(``types`` at ``*``) instead. Nothing is emitted for:

- dot-folders (``.object``, ``.object-cache``, ``.git``…), dot-files and
  non-``.md`` files;
- writes the app makes itself (`Space._write` and the definition stores record them in
  ``own_writes``)
  and files it moves to the trash (``own_deletes``): the server announces those
  itself, tagged with the saving client's id;
- events that leave the file bytes as the space already knows them.

The JSON definitions ``.object/{collections,queries,views,automations}/<id>.json`` and
``.object/ui.json`` are watched too (kinds ``collections``, ``queries``, ``views``,
``automations``, ``ui``); every other file under a dot-folder stays ignored. The watcher only
rescans: an edit it sees never reaches `Space.after_write`, so it never runs an automation.

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
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Literal

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from .space import Space, version_of
from .typedefs import is_ignored
from .whiteboardfile import sidecar_owner

__all__ = [
    "DEBOUNCE_SECONDS",
    "FLUSH_SLICE",
    "RESYNC_AFTER",
    "RESYNC_PATH",
    "SLICE_GAP",
    "ChangeEvent",
    "SpaceWatcher",
]

DEBOUNCE_SECONDS = 0.150
FLUSH_SLICE = 0.025
"""How long (seconds) one acquisition of the space's lock keeps refreshing due paths."""
SLICE_GAP = 0.002
"""Seconds the flush sleeps between slices so a waiting reader can take the lock."""
RESYNC_AFTER = 100
"""More object events than this in one flush (a ``git checkout``) are sent as one resync."""
RESYNC_PATH = "*"
"""``types`` with this path: "everything may have changed" (the client's ``RESYNC_PATH``)."""
_OBJECT_KINDS = frozenset({"created", "changed", "deleted", "renamed", "whiteboard"})
_DEFINITION_FOLDERS = ("collections", "queries", "views", "automations")


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
        "automations",
        "automationRuns",
        "agents",
        "agentChats",
    ]
    path: str
    """Space-relative POSIX path of the object file (for ``types``: the type id; for
    ``collections``, ``queries``, ``views`` and ``automations``: the definition id; for ``ui``:
    ``ui.json``; for ``automationRuns``: the rule id, or ``catch-up``;
    for ``whiteboard``: the board's ``.md``, whose canvas or ink file changed; M17: for
    ``agents`` the agent id, or ``trash``; for ``agentChats`` the agent id)."""
    version: str | None
    """The new file version (sha256 of its bytes); ``None`` when deleted."""
    origin: str | None = None
    """For a write made through the API: the writing client's id (its ``clientId``)."""
    oldPath: str | None = None
    """For ``renamed``: the object's path before the move."""


def _collapsed(events: list[ChangeEvent]) -> list[ChangeEvent]:
    """``events``, with more than `RESYNC_AFTER` object events replaced by one resync.

    A branch switch touching thousands of files would otherwise send one event per file,
    each making every window refetch; the resync (``types`` at `RESYNC_PATH`, no origin)
    makes every client reload everything once, as after a dropped event stream. The
    definition events (``collections``, ``queries``, ``views``, ``ui``) are kept.
    """
    objects = [e for e in events if e.kind in _OBJECT_KINDS]
    if len(objects) <= RESYNC_AFTER:
        return events
    rest = [e for e in events if e.kind not in _OBJECT_KINDS]
    return [ChangeEvent(kind="types", path=RESYNC_PATH, version=None), *rest]


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
        self._pending: dict[str, tuple[float, str | None]] = {}
        """Debounce key -> (deadline, the raw path to resolve at flush time, or None for a
        key that already is the space-relative path)."""
        self._cond = threading.Condition()
        self._worker: threading.Thread | None = None
        self._observer = None
        self._stopped = False

    # -- lifecycle ----------------------------------------------------------

    def start(self) -> None:
        if self._observer is not None:
            return
        with self._cond:
            self._stopped = False
        observer = Observer()
        observer.schedule(_Handler(self), str(self.space.root), recursive=True)
        observer.daemon = True
        observer.start()
        self._observer = observer

    def stop(self) -> None:
        with self._cond:
            self._stopped = True
            self._pending.clear()
            worker, self._worker = self._worker, None
            self._cond.notify_all()
        if worker is not None and worker is not threading.current_thread():
            worker.join(timeout=5)
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
        """The space-relative path when `path` is a watched ``.object`` JSON definition."""
        rel = self._space_rel(path)
        if rel is None:
            return None
        parts = rel.parts
        if rel.suffix != ".json" or parts[0] != ".object":
            return None
        if len(parts) == 2 and parts[1] == "ui.json":
            return rel.as_posix()
        if len(parts) == 3 and parts[1] in _DEFINITION_FOLDERS and not parts[2].startswith("."):
            return rel.as_posix()
        return None

    def _quick_rel(self, path: str) -> str | None:
        """A lexical space-relative path for `path`, without touching the file system.

        It drops what can't be an object or watched definition (dot-folders, dot-files,
        other suffixes) and keys the debounce; the exact path (`resolve()`, which opens
        the file on Windows) is worked out at flush time, under the space's lock. A
        path that can't be placed lexically (a symlinked root) is kept as it is.
        """
        try:
            rel = PurePosixPath(Path(os.path.abspath(path)).relative_to(self.space.root).as_posix())
        except ValueError:
            return path
        if not rel.parts:
            return None
        if rel.parts[0] == ".object":
            return rel.as_posix() if rel.suffix == ".json" else None
        if is_ignored(rel) or rel.name.startswith("."):
            return None
        if rel.suffix.lower() != ".md" and not sidecar_owner(rel.as_posix()):
            return None
        return rel.as_posix()

    def _touch(self, path: str) -> None:
        key = self._quick_rel(path)
        if key is not None:
            self._schedule(key, path)

    def _touch_folder(self, path: str) -> None:
        """A folder moved or vanished: re-check every known object beneath it, templates included."""
        with self.space._lock:
            rel = self._space_rel(path)
            if rel is None:
                return
            prefix = rel.as_posix() + "/"
            # `space.list()` leaves templates out; the summaries hold every known file.
            beneath = [p for p in self.space._summaries if p.startswith(prefix)]
        for p in beneath:
            self._schedule(p)

    def _schedule(self, key: str, path: str | None = None) -> None:
        """Debounce `key` (a space-relative path, or `path`'s lexical stand-in): it is
        refreshed once `DEBOUNCE_SECONDS` pass with no further event for it."""
        with self._cond:
            if self._stopped:
                return
            idle = not self._pending
            self._pending[key] = (time.monotonic() + DEBOUNCE_SECONDS, path)
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._run, name="watcher-debounce", daemon=True)
                self._worker.start()
            if idle:
                # A new deadline is never earlier than the ones pending, so the worker
                # only needs waking from its idle wait (a burst of events is one wake).
                self._cond.notify()

    # -- debounced handling (the one worker thread) ----------------------------

    def _run(self) -> None:
        """Wait for the earliest deadline, take every due path, flush them as one batch."""
        while True:
            with self._cond:
                while not self._stopped:
                    now = time.monotonic()
                    due = [k for k, (deadline, _p) in self._pending.items() if deadline <= now]
                    if due:
                        break
                    if self._pending:
                        self._cond.wait(min(d for d, _p in self._pending.values()) - now)
                    else:
                        self._cond.wait()
                if self._stopped:
                    return
                batch = [(k, self._pending.pop(k)[1]) for k in due]
            self._flush(batch)

    def _fire(self, rel: str) -> None:
        """Refresh one space-relative path now (what the worker does for each due path)."""
        self._flush([(rel, None)])

    def _flush(self, batch: list[tuple[str, str | None]]) -> None:
        """Refresh the due paths in slices under the space's lock; emit their events at once.

        One lock acquisition per slice (not per path) keeps a 1,000-file change from
        contending with readers 1,000 times, while a slice is short enough (`FLUSH_SLICE`)
        that a save or a list never waits long. The events keep their per-path shape; the
        loop receives the whole batch in one callback.
        """
        events: list[ChangeEvent] = []
        i = 0
        while i < len(batch):
            # Read under the space's lock: an open read handle (no FILE_SHARE_DELETE
            # on Windows) would make a concurrent save's replace fail.
            with self.space._lock:
                started = time.monotonic()
                first = i
                while i < len(batch) and (i == first or time.monotonic() - started < FLUSH_SLICE):
                    key, path = batch[i]
                    i += 1
                    if self._stopped:
                        return
                    try:
                        rel = key if path is None else (self._relpath(path) or self._definition_rel(path))
                        event = self._refresh(rel) if rel is not None else None
                    except Exception:  # never let a bad file kill the watcher thread
                        event = None
                    if event is not None:
                        events.append(event)
            # Let a waiting reader or save in before the next slice: the lock is not fair,
            # and re-taking it at once starved readers for up to 0.9 s on a 1,000-file change.
            if i < len(batch):
                time.sleep(SLICE_GAP)
        events = _collapsed(events)
        if events and not self._stopped:
            try:
                self.loop.call_soon_threadsafe(self._emit, events)
            except RuntimeError:  # loop closed
                pass

    def _emit(self, events: list[ChangeEvent]) -> None:
        for event in events:
            self.events.put_nowait(event)

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
        if rel.startswith(".object/"):
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
