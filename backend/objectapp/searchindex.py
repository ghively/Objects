"""The full-text search index (stub; M5 Task 3 replaces this module).

The public names here are the contract Task 3 keeps: `SearchIndex(space,
cache_dir=None)` with `start()`, `stop()`, `ready`, `search(...)`, `reindex()`,
`phrase_candidates(text)` and `similar(path, limit)`.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .space import Space

__all__ = ["SearchIndex"]


class SearchIndex:
    def __init__(self, space: Space, cache_dir: Path | None = None) -> None:
        self.space = space
        self.cache_dir = cache_dir
        self.ready = threading.Event()
        """Set once the start-up sync has finished."""
        self.started = False
        self.stopped = False

    def start(self) -> None:
        self.started = True
        self.ready.set()

    def stop(self) -> None:
        self.stopped = True

    def search(
        self,
        q: str,
        types: tuple[str, ...] | list[str] = (),
        exclude_types: tuple[str, ...] | list[str] = (),
        tag: str | None = None,
        limit: int = 50,
        mode: str = "auto",
    ) -> dict[str, Any]:
        return {"results": [], "partial": True}

    def reindex(self) -> None:
        return None

    def phrase_candidates(self, text: str) -> set[str] | None:
        """The paths whose body may hold ``text``; None means "not available, scan"."""
        return None

    def similar(self, path: str, limit: int) -> list[tuple[str, float]]:
        return []
