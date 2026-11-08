// Date helpers for filters and sorts: relative ranges against an injected `now`, and the
// day-level interval of a date value. Pure functions; weeks start on the "Start of the week"
// setting's day (`WeekStart`, passed in by the caller; Monday when not given).
import type { DateRelative, DateValue } from '@/api/types'
import type { WeekStart } from '@/calendar/dates'
import { fromWallClock, wallClock, zonedInstant, zonedParts, zonedStartOfDay } from '@/lib/zonedTime'

/** The relative options in menu order, with their labels ("Specific date" is the exact-date pick). */
export const DATE_RELATIVE_OPTIONS: { key: DateRelative | 'exactDate'; label: string }[] = [
  { key: 'overdue', label: 'overdue' },
  { key: 'today', label: 'today' },
  { key: 'yesterday', label: 'yesterday' },
  { key: 'tomorrow', label: 'tomorrow' },
  { key: 'thisWeek', label: 'this week' },
  { key: 'thisMonth', label: 'this month' },
  { key: 'thisYear', label: 'this year' },
  { key: 'oneWeekAgo', label: 'one week ago' },
  { key: 'inOneWeek', label: 'in one week' },
  { key: 'oneMonthAgo', label: 'one month ago' },
  { key: 'inOneMonth', label: 'in one month' },
  { key: 'exactDate', label: 'Specific date' },
]

// Days are the "Time zone" setting's days (`lib/zonedTime`): calendar arithmetic runs on
// wall-clock carriers and every boundary is turned back into an instant in that zone.

/** The first instant of `d`'s day in the time-zone setting. */
export const startOfDay = (d: Date) => zonedStartOfDay(d)
/** The last millisecond of `d`'s day in the time-zone setting. */
export const endOfDay = (d: Date) => {
  const w = wallClock(d)
  return new Date(fromWallClock(new Date(w.getFullYear(), w.getMonth(), w.getDate() + 1)).getTime() - 1)
}
// On carriers: a day `n` days on, at midnight.
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

export type { WeekStart }

/** The first day of `d`'s week on wall-clock carriers: the Sunday or Monday on or before it, as the setting says. */
export function weekStartOf(d: Date, weekStart: WeekStart = 'monday'): Date {
  const back = weekStart === 'sunday' ? d.getDay() : (d.getDay() + 6) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back)
}

/** Calendar-month arithmetic that clamps the day (Mar 31 minus one month is Feb 28). */
function addMonths(d: Date, n: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last))
}

/** The start of the day a `YYYY-MM-DD` string names, in the time-zone setting. */
export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? zonedInstant(+m[1], +m[2], +m[3]) : null
}

/**
 * An inclusive range of the time-zone setting's days. `overdue` starts at the earliest
 * representable date; `thisWeek` starts on the "Start of the week" setting's day (Monday by default).
 */
export function resolveRelative(rel: DateRelative, now: Date, weekStart: WeekStart = 'monday'): { start: Date; end: Date } {
  const w = wallClock(now)
  // Carrier days in, instants out.
  const startOfDay = (c: Date) => fromWallClock(new Date(c.getFullYear(), c.getMonth(), c.getDate()))
  const endOfDay = (c: Date) => new Date(startOfDay(addDays(c, 1)).getTime() - 1)
  const today = new Date(w.getFullYear(), w.getMonth(), w.getDate())
  const day = (d: Date) => ({ start: startOfDay(d), end: endOfDay(d) })
  switch (rel) {
    case 'overdue':
      return { start: new Date(-8.64e15), end: endOfDay(addDays(today, -1)) }
    case 'today':
      return day(today)
    case 'yesterday':
      return day(addDays(today, -1))
    case 'tomorrow':
      return day(addDays(today, 1))
    case 'thisWeek': {
      const first = weekStartOf(today, weekStart)
      return { start: startOfDay(first), end: endOfDay(addDays(first, 6)) }
    }
    case 'thisMonth':
      return {
        start: startOfDay(new Date(today.getFullYear(), today.getMonth(), 1)),
        end: endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      }
    case 'thisYear':
      return {
        start: startOfDay(new Date(today.getFullYear(), 0, 1)),
        end: endOfDay(new Date(today.getFullYear(), 11, 31)),
      }
    case 'oneWeekAgo':
      return day(addDays(today, -7))
    case 'inOneWeek':
      return day(addDays(today, 7))
    case 'oneMonthAgo':
      return day(addMonths(today, -1))
    case 'inOneMonth':
      return day(addMonths(today, 1))
  }
}

export interface DateSpan {
  /** The start (a day: its first instant in the time-zone setting). */
  start: Date
  /** The end; null when the value has none. */
  end: Date | null
  resolution: 'day' | 'time'
}

function parsePoint(iso: string | null | undefined, resolution: 'day' | 'time'): Date | null {
  if (!iso) return null
  if (resolution === 'day') return parseDay(iso)
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** A date value as instants; null when it has no usable start. */
export function dateSpan(v: DateValue | null | undefined): DateSpan | null {
  if (!v || typeof v !== 'object') return null
  const resolution = v.resolution === 'time' ? 'time' : 'day'
  const start = parsePoint(v.start, resolution)
  if (!start) return null
  return { start, end: parsePoint(v.end, resolution), resolution }
}

// Filters and groups compare days, so they read a value's days as `YYYY-MM-DD` strings (which
// compare as dates) instead of building its instants: a day-resolution value is its text, a
// time-resolution one is one `zonedParts` call, memoized per instant for the duration of a call
// (`dayReader`), as the zone's days never change inside one call.

const DAY_RE = /^(\d{4}-\d{2}-\d{2})/

/** The time-zone setting's day of an ISO instant (`YYYY-MM-DD`), or null when it doesn't parse. */
export function dayOfInstant(iso: string): string | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : zonedParts(d).date
}

/** A `dayOfInstant` that remembers its answers; make one per filter or grouping pass. */
export function dayReader(): (iso: string) => string | null {
  const seen = new Map<string, string | null>()
  return (iso) => {
    let day = seen.get(iso)
    if (day === undefined) {
      day = dayOfInstant(iso)
      seen.set(iso, day)
    }
    return day
  }
}

export interface DaySpan {
  /** `YYYY-MM-DD` of the start, in the time-zone setting. */
  start: string
  /** The end's day; null when the value has none. */
  end: string | null
  resolution: 'day' | 'time'
}

function dayPoint(iso: string | null | undefined, resolution: 'day' | 'time', dayOf: (iso: string) => string | null): string | null {
  if (!iso) return null
  if (resolution === 'day') return DAY_RE.exec(iso)?.[1] ?? null
  return dayOf(iso)
}

/** `dateSpan` as days: the same values are usable (a day text must start with `YYYY-MM-DD`). */
export function daySpan(v: DateValue | null | undefined, dayOf: (iso: string) => string | null = dayOfInstant): DaySpan | null {
  if (!v || typeof v !== 'object') return null
  const resolution = v.resolution === 'time' ? 'time' : 'day'
  const start = dayPoint(v.start, resolution, dayOf)
  if (!start) return null
  return { start, end: dayPoint(v.end, resolution, dayOf), resolution }
}

/** An inclusive range of days, for `resolveRelative`'s result or an exact date; `''` starts at the earliest date. */
export interface DayRange {
  start: string
  end: string
}

/** The days of an instant range (`resolveRelative`); `overdue`'s open start becomes `''`. */
export function dayRange(range: { start: Date; end: Date }): DayRange {
  return { start: range.start.getTime() <= -8.64e15 ? '' : zonedParts(range.start).date, end: zonedParts(range.end).date }
}

/**
 * A date value's start as a wall-clock carrier (`lib/zonedTime` `wallClock`) for grouping: a
 * day-resolution value is its calendar day at local midnight with no zone arithmetic; a
 * time-resolution one is `wallClock`. Null without a usable start.
 */
export function wallStart(v: DateValue | null | undefined): Date | null {
  if (!v || typeof v !== 'object' || !v.start) return null
  if (v.resolution === 'time') {
    const d = new Date(v.start)
    return Number.isNaN(d.getTime()) ? null : wallClock(d)
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.start)
  if (!m) return null
  const out = new Date(+m[1], +m[2] - 1, +m[3])
  if (+m[1] < 100) out.setFullYear(+m[1])
  return out
}
