"""What the routers (M5 `api_search`, `api_references`, `api_graph`; M8 `api_tasks`,
`api_history`, `api_blocks`, `api_merge`, `api_spaces_m8`) get from `create_app`."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

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
    settings_changed: Callable[[dict[str, Any]], None] = lambda _settings: None
    """Apply merged device settings to the running app (M8: ``timeZone`` sets ``space.tz``).

    `create_app` passes its own; ``PUT /api/settings`` calls it after every successful write.
    """
