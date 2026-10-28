"""The recurring Task's occurrence log (M8): the `occurrenceLog` text (pure, no I/O).

One entry per line, oldest first::

    <scheduled> <action> <actionInstant>

`scheduled` is a day ``YYYY-MM-DD`` or a UTC instant ``YYYY-MM-DDTHH:MM:SSZ``
(time-resolution dates); `action` is ``completed``, ``skipped`` or
``excused``; `actionInstant` is the UTC instant of the action. A line that
does not parse is kept as written and ignored (our choice). The value is
written as a YAML literal block (``occurrenceLog: |-``) so each entry is its
own line in the file and appending changes only the block's end.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, tzinfo
from typing import Any, Literal

from ruamel.yaml.scalarstring import LiteralScalarString

from .localtime import to_local

__all__ = [
    "ACTIONS",
    "LOG_KEY",
    "LogEntry",
    "append_entries",
    "entry_day",
    "format_entry",
    "format_instant",
    "format_scheduled",
    "log_lines",
    "log_value",
    "parse_entry",
    "parse_log",
]

LOG_KEY = "occurrenceLog"
Action = Literal["completed", "skipped", "excused"]
ACTIONS: tuple[str, ...] = ("completed", "skipped", "excused")

_DAY = r"\d{4}-\d{2}-\d{2}"
_INSTANT = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z"
_LINE = re.compile(
    rf"(?P<scheduled>{_INSTANT}|{_DAY})\s+(?P<action>completed|skipped|excused)\s+(?P<at>{_INSTANT})"
)


@dataclass(frozen=True)
class LogEntry:
    scheduled: str
    """A day ``YYYY-MM-DD`` or a UTC instant ``…Z``, as written."""
    action: Action
    at: str
    """The action's UTC instant, as written."""

    def to_api(self) -> dict[str, Any]:
        """`OccurrenceLogEntry` (``scheduled`` as a `DateValue`)."""
        resolution = "day" if len(self.scheduled) == 10 else "time"
        return {
            "scheduled": {"start": self.scheduled, "resolution": resolution},
            "action": self.action,
            "at": self.at,
        }


def _valid(scheduled: str, at: str) -> bool:
    try:
        if len(scheduled) == 10:
            date.fromisoformat(scheduled)
        else:
            datetime.fromisoformat(scheduled)
        datetime.fromisoformat(at)
    except ValueError:
        return False
    return True


def parse_entry(line: str) -> LogEntry | None:
    """One log line as an entry, or None when it doesn't parse (never raises)."""
    m = _LINE.fullmatch(line.strip())
    if not m or not _valid(m["scheduled"], m["at"]):
        return None
    return LogEntry(m["scheduled"], m["action"], m["at"])  # type: ignore[arg-type]


def log_lines(raw: Any) -> list[str]:
    """The log's lines as written (a frontmatter value; anything not text reads leniently)."""
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return [str(item) for item in raw if item is not None]
    lines = str(raw).replace("\r\n", "\n").split("\n")
    while lines and not lines[-1].strip():  # a literal block's trailing newline(s)
        lines.pop()
    return lines


def parse_log(raw: Any) -> list[LogEntry]:
    """The valid entries of a log value, in file order; garbage lines are skipped."""
    return [e for e in (parse_entry(line) for line in log_lines(raw)) if e is not None]


def format_instant(instant: datetime) -> str:
    """An aware instant as ``YYYY-MM-DDTHH:MM:SSZ`` (UTC, whole seconds)."""
    return instant.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def format_scheduled(d: date | datetime) -> str:
    """A scheduled date as the log writes it: a day, or a UTC instant."""
    if isinstance(d, datetime):
        return format_instant(d)
    return d.isoformat()


def entry_day(scheduled: str, tz: tzinfo) -> date:
    """The local day of a logged scheduled value."""
    if len(scheduled) == 10:
        return date.fromisoformat(scheduled)
    return to_local(datetime.fromisoformat(scheduled), tz).date()


def format_entry(scheduled: date | datetime | str, action: str, at: datetime | str) -> str:
    """One log line."""
    if action not in ACTIONS:
        raise ValueError(f"unknown occurrence action {action!r}")
    s = scheduled if isinstance(scheduled, str) else format_scheduled(scheduled)
    a = at if isinstance(at, str) else format_instant(at)
    return f"{s} {action} {a}"


def append_entries(raw: Any, lines: list[str]) -> str:
    """The log text with ``lines`` appended; every existing line (garbage too) is kept."""
    return "\n".join([*log_lines(raw), *lines])


def log_value(raw: Any, lines: list[str]) -> LiteralScalarString:
    """What `set_keys` writes for the log after appending ``lines`` (a literal block)."""
    return LiteralScalarString(append_entries(raw, lines))
