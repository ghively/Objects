"""Local time zones: the one place that knows about them.

`SystemTz` is the default `Space.tz`. It asks the OS for the UTC offset of
each instant separately, so a January and a July timestamp each get the
offset in force on their own date (never a fixed offset captured at start-up).
`to_local` and `from_local` convert between aware UTC instants and local wall
clocks for any `tzinfo` (a `SystemTz`, a `zoneinfo.ZoneInfo`, a fixed
`timezone`).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta, tzinfo

OffsetAt = Callable[[datetime, int], timedelta]

_DAY = timedelta(days=1)


def _os_offset_at(naive_local: datetime, fold: int) -> timedelta:
    """The OS's UTC offset for a local wall-clock time (honours `fold`)."""
    offset = naive_local.replace(tzinfo=None, fold=fold).astimezone().utcoffset()
    return offset if offset is not None else timedelta(0)


class SystemTz(tzinfo):
    """A DST-aware zone that delegates to the OS (or `offset_at`) per instant.

    `offset_at(naive_local, fold) -> timedelta` is injectable so tests can
    model a DST rule on any OS.
    """

    def __init__(self, offset_at: OffsetAt | None = None) -> None:
        self._offset_at: OffsetAt = offset_at or _os_offset_at
        self._fake = offset_at is not None

    def _offset(self, naive: datetime, fold: int) -> timedelta:
        return self._offset_at(naive.replace(tzinfo=None, fold=0), fold)

    def utcoffset(self, dt: datetime | None) -> timedelta | None:
        if dt is None:
            return None
        return self._offset(dt, dt.fold)

    def dst(self, dt: datetime | None) -> timedelta | None:
        if dt is None:
            return None
        year = dt.year
        standard = min(
            self._offset(datetime(year, 1, 1, 12), 0),
            self._offset(datetime(year, 7, 1, 12), 0),
        )
        return self._offset(dt, dt.fold) - standard

    def tzname(self, dt: datetime | None) -> str | None:
        if dt is None:
            return None
        if not self._fake:
            try:
                return dt.replace(tzinfo=None, fold=dt.fold).astimezone().tzname()
            except (OverflowError, OSError, ValueError):
                pass
        offset = self._offset(dt, dt.fold)
        return datetime(2000, 1, 1, tzinfo=_fixed(offset)).tzname()

    def fromutc(self, dt: datetime) -> datetime:
        if dt.tzinfo is not self:
            raise ValueError("fromutc: dt.tzinfo is not self")
        utc = dt.replace(tzinfo=None, fold=0)
        candidates = sorted(
            {self._offset(utc + shift, f) for shift in (-_DAY, timedelta(0), _DAY) for f in (0, 1)}
        )
        # fold=0 first: an ambiguous local time's first occurrence; fold=1 only
        # when no fold-0 reading maps back to this instant (the second one).
        for fold in (0, 1):
            for offset in candidates:
                local = utc + offset
                if self._offset(local, fold) == offset:
                    return local.replace(tzinfo=self, fold=fold)
        return (utc + self._offset(utc, 0)).replace(tzinfo=self)

    def __repr__(self) -> str:
        return "SystemTz(fake)" if self._fake else "SystemTz()"


def _fixed(offset: timedelta) -> tzinfo:
    from datetime import timezone

    return timezone(offset)


def to_local(utc_dt: datetime, tz: tzinfo) -> datetime:
    """An aware instant as an aware local datetime in `tz`."""
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=UTC)
    return utc_dt.astimezone(tz)


def from_local(naive: datetime, tz: tzinfo) -> datetime:
    """A local wall-clock time in `tz` as an aware UTC instant.

    A nonexistent time (spring-forward gap) shifts forward by the gap; an
    ambiguous one (fall-back) takes the first occurrence (fold=0).
    """
    naive = naive.replace(tzinfo=None, fold=0)
    offsets: set[timedelta] = set()
    for shift in (timedelta(0), -_DAY, _DAY):
        for fold in (0, 1):
            offset = (naive + shift).replace(tzinfo=tz, fold=fold).utcoffset()
            if offset is not None:
                offsets.add(offset)
    instants = sorted({(naive - offset).replace(tzinfo=UTC) for offset in offsets})
    for instant in instants:  # earliest valid instant = the first occurrence
        if instant.astimezone(tz).replace(tzinfo=None, fold=0) == naive:
            return instant
    # In a gap: the latest candidate reads the wall clock with the offset from
    # before the transition, which lands the gap's length later.
    return instants[-1]
