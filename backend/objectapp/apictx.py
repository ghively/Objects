"""What the M5 routers (`api_search`, `api_references`, `api_graph`) get from `create_app`."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .searchindex import SearchIndex
    from .space import Space
    from .watcher import ChangeEvent

__all__ = ["ApiContext"]


@dataclass
class ApiContext:
    space: Space
    announce: Callable[[ChangeEvent], None]
    """Publish a `ChangeEvent` to every SSE client (callable from a worker thread)."""
    search: SearchIndex
