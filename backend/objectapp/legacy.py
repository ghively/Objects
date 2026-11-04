"""Older on-disk folder names, renamed once when a space is opened.

A space made before 2026-11-04 keeps its metadata and cache under older folder
names. Opening it renames each to the current name (``.object/``,
``.object-cache/``) with one atomic rename, but only when the current folder does
not exist yet; when both exist the old one is left alone and ``.object/`` is used.
Only those two folders are ever touched; ``.md`` files never are.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

__all__ = ["LEGACY_FOLDERS", "has_legacy_metadata", "migrate_legacy_folders"]

log = logging.getLogger(__name__)

META_FOLDER = ".object"
CACHE_FOLDER = ".object-cache"

# folder names used by spaces made before 2026-11-04
_LEGACY_META = ".capacities"
_LEGACY_CACHE = ".capacities-cache"

LEGACY_FOLDERS: dict[str, str] = {_LEGACY_META: META_FOLDER, _LEGACY_CACHE: CACHE_FOLDER}
"""Old folder name -> current folder name."""


def _real_dir(path: Path) -> bool:
    try:
        return path.is_dir() and not path.is_symlink()
    except OSError:
        return False


def has_legacy_metadata(root: Path | str) -> bool:
    """True when `root` holds only the old metadata folder (it is a space to migrate)."""
    root = Path(root)
    return _real_dir(root / _LEGACY_META) and not os.path.lexists(root / META_FOLDER)


def migrate_legacy_folders(root: Path | str) -> list[str]:
    """Rename the old folders in `root` to the current names; returns the new names made.

    A folder is renamed only when it is a real directory (no symlink) and the new
    name is free. A failed rename is logged and left as it was.
    """
    root = Path(root)
    renamed: list[str] = []
    for old, new in LEGACY_FOLDERS.items():
        src, dst = root / old, root / new
        if not _real_dir(src) or os.path.lexists(dst):
            continue
        try:
            os.rename(src, dst)
        except OSError as exc:
            log.warning("could not rename %s to %s: %s", src, dst, exc)
            continue
        renamed.append(new)
    return renamed
