"""The monitoring folder watch (M23): every ``*.json`` in the alert folder becomes Alert objects.

T1 stub: the Contract's names and signatures; `AlertWatch` does nothing yet (``start`` and
``stop`` are no-ops, ``scan_once`` reports nothing, ``sources`` is empty) and
`read_alert_file` reads no file. Plan Task 5 fills it.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .space import Space
    from .watcher import ChangeEvent

__all__ = [
    "DEFAULT_INTERVAL_MIN",
    "MAX_ALERTS_PER_FILE",
    "MAX_FIELD",
    "POLL_SECONDS",
    "AlertScanReport",
    "AlertWatch",
    "is_stale",
    "read_alert_file",
]

POLL_SECONDS = 60.0
DEFAULT_INTERVAL_MIN = 1440
MAX_ALERTS_PER_FILE = 200
MAX_FIELD = 1200


@dataclass
class AlertScanReport:
    files: int = 0
    created: int = 0
    updated: int = 0
    cleared: int = 0
    unchanged: int = 0
    errors: list[str] = field(default_factory=list)


class AlertWatch:
    """Scans the alert folder every `poll_seconds` on a daemon thread (T5); idle without a folder."""

    def __init__(
        self,
        space: Space,
        *,
        folder: Callable[[], Path | None],
        intervals: Callable[[], dict[str, int]],
        announce: Callable[[ChangeEvent], None] = lambda _e: None,
        poll_seconds: float = POLL_SECONDS,
    ) -> None:
        self.space = space
        self.folder = folder
        self.intervals = intervals
        self.announce = announce
        self.poll_seconds = poll_seconds

    def start(self) -> None:
        """T1 stub: nothing runs yet."""

    def stop(self) -> None:
        """T1 stub: nothing to stop."""

    def scan_once(self) -> AlertScanReport:
        """T1 stub: an empty report."""
        return AlertScanReport()

    def sources(self) -> list[dict]:
        """T1 stub: no sources."""
        return []


def read_alert_file(path: Path) -> dict:
    """The ported monitoring-file reader (T5). T1 stub: the file's stem as its source, no alerts."""
    return {"source": Path(path).stem, "generated": None, "ok": False, "error": None, "alerts": []}


def is_stale(generated: datetime | None, interval_min: int, now: datetime) -> bool:
    """True when nothing was generated or it is older than twice the interval."""
    return generated is None or now - generated > timedelta(minutes=2 * interval_min)
