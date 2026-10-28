// Date helpers for filters and sorts: relative ranges against an injected `now`, and the
// day-level interval of a date value. Pure functions; weeks run Monday to Sunday.
import type { DateRelative, DateValue } from '@/api/types'
import { fromWallClock, wallClock, zonedInstant, zonedStartOfDay } from '@/lib/zonedTime'

/** The relative options in the reference's order, with its labels ("Specific date" is the exact-date pick). */
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

/** An inclusive range of the time-zone setting's days. `overdue` starts at the earliest representable date. */
export function resolveRelative(rel: DateRelative, now: Date): { start: Date; end: Date } {
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
      const monday = addDays(today, -((today.getDay() + 6) % 7))
      return { start: startOfDay(monday), end: endOfDay(addDays(monday, 6)) }
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
