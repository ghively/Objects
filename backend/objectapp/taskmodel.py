"""The Task `repeat` and `remind` text forms (pure, no I/O).

repeat:  every [N] (day|week|month|year)[s] [after completion] [until YYYY-MM-DD]
         every weekday [until YYYY-MM-DD]
remind:  time dates: at time | N minutes before | N hours before
         day dates:  on the day at HH:mm | N day[s] before at HH:mm

Case and spacing are forgiven on read; `format_*` writes the canonical form.
Parsers return None for anything that is not valid and never raise.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

Unit = Literal["day", "week", "weekday", "month", "year"]
Mode = Literal["dueDate", "completionDate"]
Resolution = Literal["day", "time"]


class _DictLike:
    """Rules compare equal to their API-contract dicts and allow `rule[key]`."""

    def to_dict(self) -> dict[str, Any]:  # pragma: no cover - overridden
        raise NotImplementedError

    def __getitem__(self, key: str) -> Any:
        data = self.to_dict()
        if key not in data:
            raise KeyError(key)
        return data[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.to_dict().get(key, default)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, dict):
            return self.to_dict() == other
        if type(other) is type(self):
            return self.to_dict() == other.to_dict()  # type: ignore[attr-defined]
        return NotImplemented

    def __hash__(self) -> int:
        return hash(tuple(sorted(self.to_dict().items())))


@dataclass(frozen=True, eq=False)
class RepeatRule(_DictLike):
    """`{every, unit, mode, until?}` as in the M4 API contract."""

    every: int
    unit: Unit
    mode: Mode = "dueDate"
    until: str | None = None  # 'YYYY-MM-DD', inclusive

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"every": self.every, "unit": self.unit, "mode": self.mode}
        if self.until is not None:
            out["until"] = self.until
        return out

    @property
    def until_date(self) -> date | None:
        return date.fromisoformat(self.until) if self.until else None


@dataclass(frozen=True, eq=False)
class ReminderRule(_DictLike):
    """`{minutesBefore, daysBefore, timeOfDay?}` as in the M4 API contract."""

    minutesBefore: int = 0
    daysBefore: int = 0
    timeOfDay: str | None = None  # 'HH:mm', day dates only

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"minutesBefore": self.minutesBefore, "daysBefore": self.daysBefore}
        if self.timeOfDay is not None:
            out["timeOfDay"] = self.timeOfDay
        return out

    # snake_case aliases for Python callers
    @property
    def minutes_before(self) -> int:
        return self.minutesBefore

    @property
    def days_before(self) -> int:
        return self.daysBefore

    @property
    def time_of_day(self) -> str | None:
        return self.timeOfDay

    @property
    def resolution(self) -> Resolution:
        return "day" if self.timeOfDay is not None else "time"


_REPEAT = re.compile(
    r"every(?:\s+(?P<n>\d+))?\s+(?P<unit>day|week|month|year|weekday)(?P<plural>s)?"
    r"(?P<after>\s+after\s+completion)?"
    r"(?:\s+until\s+(?P<until>\d{4}-\d{2}-\d{2}))?"
)


def _norm(text: object) -> str | None:
    if not isinstance(text, str):
        return None
    return " ".join(text.split()).lower()


def parse_repeat(text: object) -> RepeatRule | None:
    s = _norm(text)
    if not s:
        return None
    m = _REPEAT.fullmatch(s)
    if not m:
        return None
    unit = m["unit"]
    until = m["until"]
    if until is not None:
        try:
            date.fromisoformat(until)
        except ValueError:
            return None
    if unit == "weekday":
        if m["n"] is not None or m["plural"] or m["after"]:
            return None
        return RepeatRule(every=1, unit="weekday", mode="dueDate", until=until)
    every = int(m["n"]) if m["n"] is not None else 1
    if every < 1:
        return None
    mode: Mode = "completionDate" if m["after"] else "dueDate"
    return RepeatRule(every=every, unit=unit, mode=mode, until=until)  # type: ignore[arg-type]


def format_repeat(rule: RepeatRule) -> str:
    if rule.unit == "weekday":
        out = "every weekday"
    elif rule.every == 1:
        out = f"every {rule.unit}"
    else:
        out = f"every {rule.every} {rule.unit}s"
    if rule.mode == "completionDate" and rule.unit != "weekday":
        out += " after completion"
    if rule.until:
        out += f" until {rule.until}"
    return out


_AT_TIME = re.compile(r"at time")
_MINUTES = re.compile(r"(?P<n>\d+)\s+(?P<unit>minute|hour)s?\s+before")
_ON_DAY = re.compile(r"on the day at (?P<t>\d{2}:\d{2})")
_DAYS = re.compile(r"(?P<n>\d+)\s+days?\s+before at (?P<t>\d{2}:\d{2})")


def _valid_hhmm(t: str) -> bool:
    h, m = t.split(":")
    return 0 <= int(h) <= 23 and 0 <= int(m) <= 59


def parse_remind(text: object, resolution: Resolution) -> ReminderRule | None:
    s = _norm(text)
    if not s or resolution not in ("day", "time"):
        return None
    if resolution == "time":
        if _AT_TIME.fullmatch(s):
            return ReminderRule(minutesBefore=0, daysBefore=0)
        m = _MINUTES.fullmatch(s)
        if not m:
            return None
        n = int(m["n"])
        if n < 1:
            return None
        return ReminderRule(minutesBefore=n * 60 if m["unit"] == "hour" else n, daysBefore=0)
    m = _ON_DAY.fullmatch(s)
    if m:
        return ReminderRule(minutesBefore=0, daysBefore=0, timeOfDay=m["t"]) if _valid_hhmm(m["t"]) else None
    m = _DAYS.fullmatch(s)
    if not m:
        return None
    n = int(m["n"])
    if n < 1 or not _valid_hhmm(m["t"]):
        return None
    return ReminderRule(minutesBefore=0, daysBefore=n, timeOfDay=m["t"])


def format_remind(rule: ReminderRule, resolution: Resolution) -> str:
    if resolution == "time":
        if rule.timeOfDay is not None:
            raise ValueError("a day reminder does not fit a time date")
        n = rule.minutesBefore
        if n == 0:
            return "at time"
        if n < 60 or n % 60:
            return f"{n} minute before" if n == 1 else f"{n} minutes before"
        h = n // 60
        return "1 hour before" if h == 1 else f"{h} hours before"
    if resolution == "day":
        if rule.timeOfDay is None:
            raise ValueError("a time reminder does not fit a day date")
        if rule.daysBefore == 0:
            return f"on the day at {rule.timeOfDay}"
        if rule.daysBefore == 1:
            return f"1 day before at {rule.timeOfDay}"
        return f"{rule.daysBefore} days before at {rule.timeOfDay}"
    raise ValueError(f"unknown resolution {resolution!r}")
