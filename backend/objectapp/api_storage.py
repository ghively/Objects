"""Settings > Offline & Sync's local rows (M31, catalog section 1: "Local Storage (size estimate)"
and "Clear media cache").

- ``GET /api/storage`` -> ``{space, cache, state, total, cacheFolder}``: an estimate of the disk
  space this space uses, each part ``{bytes, files}``: the space folder (its notes, files and
  ``.object/``; the cache left out when it sits inside), its rebuildable cache (``.object-cache``,
  or its folder under ``OBJECT_CACHE_DIR``), and the app's own data for it in the state folder
  (saved versions, and the per-space files named with its key: reminders, automations, work
  queue...). The folders are walked in a worker thread (FastAPI runs a plain ``def`` route off the
  event loop); symlinks are never followed; nothing is written.
- ``POST /api/storage/clear-media-cache`` -> ``{files, bytes}``: what it freed.

Object keeps no media cache of its own: images, video, audio and PDFs are read from the space's
files on each request (``GET /api/file``), with no thumbnails. So "Clear media cache" removes only
the cache folder's media parts (``media/`` and ``thumbnails/`` under the cache, where a cache of
media would live; today normally absent, so it frees nothing) and never a note, an attachment or
the search index. The page's media then load again from the files (the front end asks for them
afresh, past the browser's own cache).
"""

from __future__ import annotations

import logging
import os
import stat
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from .apictx import ApiContext
from .appstate import space_key, state_dir
from .searchindex import cache_dir_for

__all__ = ["MEDIA_CACHE_FOLDERS", "clear_media_cache", "router", "storage_estimate"]

_log = logging.getLogger(__name__)

# The cache folder's media parts, the only things "Clear media cache" removes.
MEDIA_CACHE_FOLDERS = ("media", "thumbnails")


def _walk(folder: Path, skip: Path | None = None) -> dict[str, int]:
    """``{bytes, files}`` of the regular files under ``folder`` (no symlink followed; ``skip``
    and everything under it left out; unreadable entries skipped)."""
    total = files = 0
    stack = [folder]
    skip_s = os.path.normcase(str(skip)) if skip is not None else None
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as it:
                entries = list(it)
        except OSError:
            continue
        for e in entries:
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            if stat.S_ISDIR(st.st_mode):
                if skip_s is not None and os.path.normcase(e.path) == skip_s:
                    continue
                stack.append(Path(e.path))
            elif stat.S_ISREG(st.st_mode):
                total += st.st_size
                files += 1
    return {"bytes": total, "files": files}


def _add(a: dict[str, int], b: dict[str, int]) -> dict[str, int]:
    return {"bytes": a["bytes"] + b["bytes"], "files": a["files"] + b["files"]}


def _state_parts(root: Path) -> dict[str, int]:
    """The app's data for the space in the state folder: its saved versions and the files named
    with its key."""
    from .history import HistoryStore

    out = {"bytes": 0, "files": 0}
    history = HistoryStore(root).dir
    if history.is_dir() and not history.is_symlink():
        out = _add(out, _walk(history))
    key = space_key(root)
    try:
        with os.scandir(state_dir()) as it:
            entries = [e for e in it if key in e.name]
    except OSError:
        entries = []
    for e in entries:
        try:
            st = e.stat(follow_symlinks=False)
        except OSError:
            continue
        if stat.S_ISREG(st.st_mode):
            out = _add(out, {"bytes": st.st_size, "files": 1})
        elif stat.S_ISDIR(st.st_mode):
            out = _add(out, _walk(Path(e.path)))
    return out


def storage_estimate(space: Any) -> dict[str, Any]:
    """The space's disk use (see the module docstring). Reads only."""
    root = Path(space.root)
    cache = cache_dir_for(space)
    inside = False
    try:
        cache.resolve().relative_to(root.resolve())
        inside = True
    except ValueError:
        pass
    space_part = _walk(root, skip=cache if inside else None)
    cache_part = _walk(cache) if cache.is_dir() else {"bytes": 0, "files": 0}
    state_part = _state_parts(root)
    return {
        "space": space_part,
        "cache": cache_part,
        "state": state_part,
        "total": space_part["bytes"] + cache_part["bytes"] + state_part["bytes"],
        "cacheFolder": str(cache),
    }


def _remove_tree(folder: Path) -> dict[str, int]:
    """Delete ``folder`` and what it holds, never following a link (a link is removed itself)."""
    freed = {"bytes": 0, "files": 0}
    try:
        st = folder.lstat()
    except OSError:
        return freed
    if not stat.S_ISDIR(st.st_mode):
        folder.unlink()  # a link (or a stray file) where the folder would be
        if stat.S_ISREG(st.st_mode):
            freed = {"bytes": st.st_size, "files": 1}
        return freed
    for dirpath, dirnames, filenames in os.walk(folder, topdown=False, followlinks=False):
        for name in filenames + [d for d in dirnames if os.path.islink(os.path.join(dirpath, d))]:
            p = os.path.join(dirpath, name)
            try:
                lst = os.lstat(p)
                os.unlink(p)
            except OSError:
                _log.warning("Couldn't remove %s from the media cache", p)
                continue
            if stat.S_ISREG(lst.st_mode):
                freed = _add(freed, {"bytes": lst.st_size, "files": 1})
        for name in dirnames:
            p = os.path.join(dirpath, name)
            if not os.path.islink(p):
                try:
                    os.rmdir(p)
                except OSError:
                    pass
    try:
        folder.rmdir()
    except OSError:
        pass
    return freed


def clear_media_cache(cache: Path) -> dict[str, int]:
    """Remove the cache folder's media parts (`MEDIA_CACHE_FOLDERS`); ``{files, bytes}`` freed."""
    freed = {"bytes": 0, "files": 0}
    for name in MEDIA_CACHE_FOLDERS:
        freed = _add(freed, _remove_tree(Path(cache) / name))
    return {"files": freed["files"], "bytes": freed["bytes"]}


def router(ctx: ApiContext) -> APIRouter:
    r = APIRouter()

    @r.get("/storage")
    def get_storage():
        return storage_estimate(ctx.space)

    @r.post("/storage/clear-media-cache")
    def post_clear_media_cache():
        return clear_media_cache(cache_dir_for(ctx.space))

    return r
