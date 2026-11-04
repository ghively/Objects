"""The Task `repeat` and `remind` text forms (pure, no I/O).

repeat:  every [N] (day|week|month|year)[s] [ON] [after completion] [until YYYY-MM-DD]
         every weekday [until YYYY-MM-DD]
         ON (by due date only, M8):
           weeks:  on mon[, tue ...]           (full names read too; written in week order)
           months: on the 15th | on the last day | on the 2nd tuesday | on the last friday
           years:  on march 15 | on the 2nd tuesday of march | on the last day of february
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
        return hash(repr(sorted(self.to_dict().items())))


WEEKDAYS: tuple[str, ...] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
MONTHS: tuple[str, ...] = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
)
_MONTH_MAX_DAYS = (31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


@dataclass(frozen=True, eq=False)
class RepeatOn(_DictLike):
    """The `on` part of a custom rule (M8).

    Exactly one shape is set:
    - weeks:  `weekdays` (mon..sun, in week order, no duplicates)
    - months: `monthDay` (1..31 or 'last') or `weekdayPos` (1..4 or 'last') + `weekday`
    - years:  the month shapes plus `month` (1..12)
    """

    weekdays: tuple[str, ...] | None = None
    monthDay: int | str | None = None
    weekdayPos: int | str | None = None
    weekday: str | None = None
    month: int | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if self.weekdays is not None:
            out["weekdays"] = list(self.weekdays)
        if self.month is not None:
            out["month"] = self.month
        if self.monthDay is not None:
            out["monthDay"] = self.monthDay
        if self.weekdayPos is not None:
            out["weekdayPos"] = self.weekdayPos
        if self.weekday is not None:
            out["weekday"] = self.weekday
        return out


@dataclass(frozen=True, eq=False)
class RepeatRule(_DictLike):
    """`{every, unit, mode, until?, on?}`: the M4 API contract plus M8's `on`.

    `to_dict` adds `on` only when present, so M4 rules keep M4's shape.
    """

    every: int
    unit: Unit
    mode: Mode = "dueDate"
    until: str | None = None  # 'YYYY-MM-DD', inclusive
    on: RepeatOn | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"every": self.every, "unit": self.unit, "mode": self.mode}
        if self.until is not None:
            out["until"] = self.until
        if self.on is not None:
            out["on"] = self.on.to_dict()
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
    r"(?:\s+on\b(?P<on>.*?))?"
    r"(?P<after>\s+after\s+completion)?"
    r"(?:\s+until\s+(?P<until>\d{4}-\d{2}-\d{2}))?"
)

_WEEKDAY_NAMES = {
    **{w: w for w in WEEKDAYS},
    "monday": "mon", "tuesday": "tue", "wednesday": "wed", "thursday": "thu",
    "friday": "fri", "saturday": "sat", "sunday": "sun",
}
_MONTH_NAMES = {**{m: i + 1 for i, m in enumerate(MONTHS)}, **{m[:3]: i + 1 for i, m in enumerate(MONTHS)}}
_ORDINAL = r"(?P<pos>\d+)(?:st|nd|rd|th)"
_ON_LAST_DAY = re.compile(r"the last day")
_ON_MONTH_DAY = re.compile(r"the " + _ORDINAL)
_ON_NTH_WEEKDAY = re.compile(r"the (?:" + _ORDINAL + r"|(?P<last>last)) (?P<wd>[a-z]+)")
_ON_YEAR_DATE = re.compile(r"(?P<month>[a-z]+) (?P<day>\d+)")


def _parse_on_weeks(s: str) -> RepeatOn | None:
    names = [part.strip() for part in s.split(",")]
    if not names or any(n not in _WEEKDAY_NAMES for n in names):
        return None
    chosen = {_WEEKDAY_NAMES[n] for n in names}
    return RepeatOn(weekdays=tuple(w for w in WEEKDAYS if w in chosen))


def _parse_on_month_part(s: str, month: int | None) -> RepeatOn | None:
    """`the 15th` | `the last day` | `the 2nd tuesday` | `the last friday`."""
    if _ON_LAST_DAY.fullmatch(s):
        return RepeatOn(monthDay="last", month=month)
    m = _ON_MONTH_DAY.fullmatch(s)
    if m:
        day = int(m["pos"])
        limit = _MONTH_MAX_DAYS[month - 1] if month else 31
        if not 1 <= day <= limit:
            return None
        return RepeatOn(monthDay=day, month=month)
    m = _ON_NTH_WEEKDAY.fullmatch(s)
    if m and m["wd"] in _WEEKDAY_NAMES:
        if m["last"]:
            pos: int | str = "last"
        else:
            pos = int(m["pos"])
            if not 1 <= pos <= 4:
                return None
        return RepeatOn(weekdayPos=pos, weekday=_WEEKDAY_NAMES[m["wd"]], month=month)
    return None


def _parse_on_years(s: str) -> RepeatOn | None:
    m = _ON_YEAR_DATE.fullmatch(s)
    if m:
        month = _MONTH_NAMES.get(m["month"])
        day = int(m["day"])
        if month is None or not 1 <= day <= _MONTH_MAX_DAYS[month - 1]:
            return None
        return RepeatOn(month=month, monthDay=day)
    head, sep, tail = s.rpartition(" of ")
    if not sep or tail not in _MONTH_NAMES:
        return None
    return _parse_on_month_part(head, _MONTH_NAMES[tail])


def _parse_on(unit: str, s: str) -> RepeatOn | None:
    s = s.strip()
    if not s:
        return None
    if unit == "week":
        return _parse_on_weeks(s)
    if unit == "month":
        return _parse_on_month_part(s, None)
    if unit == "year":
        return _parse_on_years(s)
    return None


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def format_on(on: RepeatOn) -> str:
    """The canonical text after `on ` (no leading `on`)."""
    if on.weekdays is not None:
        return ", ".join(on.weekdays)
    if on.weekdayPos is not None:
        pos = "last" if on.weekdayPos == "last" else _ordinal(int(on.weekdayPos))
        out = f"the {pos} {_full_weekday(on.weekday or '')}"
    elif on.monthDay == "last":
        out = "the last day"
    elif on.month is not None:
        return f"{MONTHS[on.month - 1]} {on.monthDay}"
    else:
        out = f"the {_ordinal(int(on.monthDay or 0))}"
    if on.month is not None:
        out += f" of {MONTHS[on.month - 1]}"
    return out


_FULL_WEEKDAY = {v: k for k, v in _WEEKDAY_NAMES.items() if len(k) > 3}


def _full_weekday(wd: str) -> str:
    return _FULL_WEEKDAY.get(wd, wd)


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
        if m["n"] is not None or m["plural"] or m["after"] or m["on"] is not None:
            return None
        return RepeatRule(every=1, unit="weekday", mode="dueDate", until=until)
    every = int(m["n"]) if m["n"] is not None else 1
    if every < 1:
        return None
    on: RepeatOn | None = None
    if m["on"] is not None:
        # by due date only: the completion-date rule has only an interval
        if m["after"]:
            return None
        on = _parse_on(unit, m["on"])
        if on is None:
            return None
    mode: Mode = "completionDate" if m["after"] else "dueDate"
    return RepeatRule(every=every, unit=unit, mode=mode, until=until, on=on)  # type: ignore[arg-type]


def format_repeat(rule: RepeatRule) -> str:
    if rule.unit == "weekday":
        out = "every weekday"
    elif rule.every == 1:
        out = f"every {rule.unit}"
    else:
        out = f"every {rule.every} {rule.unit}s"
    if rule.on is not None:
        out += f" on {format_on(rule.on)}"
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
