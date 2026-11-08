"""Templates: title placeholders and creation-date variables.

A template is an object file with a ``template: <name>`` key; it belongs to the
type its ``type:`` key names (see `Space.list_templates`). When a template is
applied, its title may hold ``{date:FMT}`` placeholders (a dayjs format
subset), and a ``datetime`` property may hold ``{creation:day|week|month|year}``,
which becomes the object's creation day or the week (Monday to Sunday), month
or year around it.
"""

from __future__ import annotations

import calendar
import re
from datetime import date, datetime, timedelta
from typing import Any

from .propvalues import InvalidValue

__all__ = [
    "TEMPLATE_FAILED",
    "TemplateError",
    "creation_variable",
    "expand_title",
    "format_date",
    "resolve_date_variable",
]

TEMPLATE_FAILED = "The template couldn't be applied"

_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]  # fmt: skip  (en-US, independent of the process locale)
_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
# Longest first, so `YYYY` wins over `YY` and `MMMM` over `MM`.
_TOKENS = ("YYYY", "MMMM", "dddd", "MMM", "ddd", "YY", "MM", "DD", "HH", "mm", "M", "D")
_DATE_PLACEHOLDER_RE = re.compile(r"\{date:([^{}]*)\}")
_CREATION_RE = re.compile(r"^\{creation:([A-Za-z]+)\}$")


class TemplateError(InvalidValue):
    """A template can't be applied (the API answers 422 "The template couldn't be applied")."""

    def __init__(self, reason: str = "") -> None:
        super().__init__(TEMPLATE_FAILED)
        self.reason = reason
        """Why, for logs and tests (the API shows only `TEMPLATE_FAILED`)."""


def _token(tok: str, dt: datetime) -> str:
    match tok:
        case "YYYY":
            return f"{dt.year:04d}"
        case "YY":
            return f"{dt.year % 100:02d}"
        case "MMMM":
            return _MONTHS[dt.month - 1]
        case "MMM":
            return _MONTHS[dt.month - 1][:3]
        case "MM":
            return f"{dt.month:02d}"
        case "M":
            return str(dt.month)
        case "DD":
            return f"{dt.day:02d}"
        case "D":
            return str(dt.day)
        case "dddd":
            return _DAYS[dt.weekday()]
        case "ddd":
            return _DAYS[dt.weekday()][:3]
        case "HH":
            return f"{dt.hour:02d}"
        case "mm":
            return f"{dt.minute:02d}"
    raise TemplateError(f"Unknown date token {tok!r}")


def format_date(fmt: str, dt: datetime) -> str:
    """Format ``dt`` with the dayjs subset ``YYYY YY MMMM MMM MM M DD D dddd ddd HH mm``.

    Other characters are kept; any other letter raises `TemplateError`.
    """
    out: list[str] = []
    i = 0
    while i < len(fmt):
        tok = next((t for t in _TOKENS if fmt.startswith(t, i)), None)
        if tok is not None:
            out.append(_token(tok, dt))
            i += len(tok)
            continue
        ch = fmt[i]
        if ch.isalpha():
            raise TemplateError(f"Unknown date format letter {ch!r} in {fmt!r}")
        out.append(ch)
        i += 1
    return "".join(out)


def expand_title(title: str, created: datetime) -> str:
    """``title`` with each ``{date:FMT}`` replaced by ``created`` formatted (see `format_date`)."""
    return _DATE_PLACEHOLDER_RE.sub(lambda m: format_date(m.group(1), created), title)


def resolve_date_variable(var: str, created: datetime | date) -> str:
    """The value of ``{creation:<var>}``: a day, or a ``start -> end`` range of days."""
    day = created.date() if isinstance(created, datetime) else created
    match var:
        case "day":
            return day.isoformat()
        case "week":
            start = day - timedelta(days=day.weekday())
            end = start + timedelta(days=6)
        case "month":
            start = day.replace(day=1)
            end = day.replace(day=calendar.monthrange(day.year, day.month)[1])
        case "year":
            start = day.replace(month=1, day=1)
            end = day.replace(month=12, day=31)
        case _:
            raise TemplateError(f"Unknown date variable {var!r}")
    return f"{start.isoformat()} -> {end.isoformat()}"


def creation_variable(raw: Any) -> str | None:
    """The variable name when ``raw`` is a ``{creation:<var>}`` value, else None.

    Quoted it is a string; unquoted, YAML reads it as a one-key flow mapping.
    """
    if isinstance(raw, str):
        m = _CREATION_RE.match(raw.strip())
        return m.group(1) if m else None
    if isinstance(raw, dict) and len(raw) == 1:
        (key, value), = raw.items()
        if value is None and isinstance(key, str) and key.startswith("creation:"):
            var = key[len("creation:"):].strip()
            return var if var.isalpha() else None
    return None
