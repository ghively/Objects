"""Daily notes (M4): which day a note stands for, and the per-day index.

Pure helpers; `Space` (``daily_note_day``, ``daily_notes``, ``create_daily_note``)
supplies the in-memory objects and does the one write.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import date, datetime
from pathlib import PurePosixPath
from typing import Any

_DAY_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_DAY_PREFIX_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:$|[T ]| -> )")

DAILY_NOTE_EXISTS = "There is already a daily note for this day."  # our string
FILE_NAME_TAKEN = "A file with that name already exists."  # our string


class DailyNoteExists(Exception):
    """A note for the day exists (or its file name is taken); the API answers 409 with ``path``."""

    def __init__(self, path: str, detail: str = DAILY_NOTE_EXISTS) -> None:
        super().__init__(detail)
        self.path = path
        self.detail = detail


def parse_day(text: Any) -> str | None:
    """``text`` when it is a real calendar day written ``YYYY-MM-DD``, else None."""
    if isinstance(text, datetime):
        return text.date().isoformat()
    if isinstance(text, date):
        return text.isoformat()
    if not isinstance(text, str):
        return None
    m = _DAY_RE.match(text.strip())
    if m is None:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None


def _day_of_date_value(value: Any) -> str | None:
    """The day of a ``date`` value: a day, or the day part of a datetime or range start."""
    if isinstance(value, (date, datetime)):
        return parse_day(value)
    if not isinstance(value, str):
        return None
    m = _DAY_PREFIX_RE.match(value.strip())
    return parse_day(m[1]) if m else None


def day_of(fm: dict, path: str) -> str | None:
    """A daily note's day: its ``date``, else its ``title``, else its file stem (``YYYY-MM-DD``)."""
    return (
        _day_of_date_value(fm.get("date"))
        or parse_day(fm.get("title"))
        or parse_day(PurePosixPath(path).stem)
    )


def path_order(path: str) -> tuple[str, ...]:
    """The sort key for "first by path": the path's parts, the last without ``.md``."""
    p = PurePosixPath(path)
    return (*p.parent.parts, p.stem if p.suffix.lower() == ".md" else p.name)


def build_index(
    notes: Iterable[tuple[str, str | None]],
) -> tuple[dict[str, str], list[tuple[str, list[str]]]]:
    """``(path, day)`` pairs -> ``{day: path}`` (first by path wins) and ``[(day, other paths)]``.

    "By path" compares folder by folder with the ``.md`` dropped, as a file list
    shows them, so ``2026-10-23.md`` comes before ``2026-10-23 copy.md``.
    """
    first: dict[str, str] = {}
    others: dict[str, list[str]] = {}
    for path, day in sorted(notes, key=lambda pd: path_order(pd[0])):
        if day is None:
            continue
        if day in first:
            others.setdefault(day, []).append(path)
        else:
            first[day] = path
    return first, sorted(others.items())
