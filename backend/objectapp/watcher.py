"""Watch a space folder and turn file changes into `ChangeEvent`s.

watchdog delivers file-system events on its own thread. Each object path is
debounced (150 ms of quiet), then re-read: the `Space` summary is refreshed and
a `ChangeEvent` is put on `SpaceWatcher.events` (an asyncio queue on the given
loop). Nothing is emitted for:

- dot-folders (``.object``, ``.object-cache``, ``.git``…), dot-files and
  non-``.md`` files;
- writes made by `Space.save_body` (its ``own_writes`` versions);
- events that leave the file bytes as the space already knows them.
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

__all__ = ["DEBOUNCE_SECONDS", "ChangeEvent", "SpaceWatcher"]

DEBOUNCE_SECONDS = 0.150


@dataclass(frozen=True)
class ChangeEvent:
    kind: Literal["created", "changed", "deleted"]
    path: str
    """Space-relative POSIX path of the object file."""
    version: str | None
    """The new file version (sha256 of its bytes); ``None`` when deleted."""


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

    def _relpath(self, path: str) -> str | None:
        """The space-relative object path for `path`, or None if it isn't one."""
        try:
            rel = PurePosixPath(Path(path).resolve().relative_to(self.space.root).as_posix())
        except ValueError:
            return None
        if not rel.parts or is_ignored(rel) or rel.name.startswith("."):
            return None
        if rel.suffix.lower() != ".md":
            return None
        return rel.as_posix()

    def _touch(self, path: str) -> None:
        rel = self._relpath(path)
        if rel is not None:
            self._schedule(rel)

    def _touch_folder(self, path: str) -> None:
        """A folder moved or vanished: re-check every known object beneath it."""
        try:
            prefix = Path(path).resolve().relative_to(self.space.root).as_posix() + "/"
        except ValueError:
            return
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
            event = self._refresh(rel)
        except Exception:  # never let a bad file kill the watcher thread
            return
        if event is not None and not self._stopped:
            try:
                self.loop.call_soon_threadsafe(self.events.put_nowait, event)
            except RuntimeError:  # loop closed
                pass

    def _refresh(self, rel: str) -> ChangeEvent | None:
        space = self.space
        full = space.root / rel
        known = space.cached_version(rel)
        try:
            data = full.read_bytes() if full.is_file() else None
        except OSError:
            data = None

        if data is None:
            if known is None:
                return None
            space.rescan_file(rel)
            space.own_writes.pop(rel, None)
            return ChangeEvent(kind="deleted", path=rel, version=None)

        version = version_of(data)
        own = space.own_writes.get(rel)
        if own is not None and own != version:
            space.own_writes.pop(rel, None)
        if version == known or version == own:
            if version != known:
                space.rescan_file(rel)
            return None
        space.rescan_file(rel)
        kind = "created" if known is None else "changed"
        return ChangeEvent(kind=kind, path=rel, version=version)
