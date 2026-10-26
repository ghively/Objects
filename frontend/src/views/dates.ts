// Date helpers for filters and sorts: relative ranges against an injected `now`, and the
// day-level interval of a date value. Pure functions; weeks run Monday to Sunday.
import type { DateRelative, DateValue } from '@/api/types'

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

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** Calendar-month arithmetic that clamps the day (Mar 31 minus one month is Feb 28). */
function addMonths(d: Date, n: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last))
}

/** The local day a `YYYY-MM-DD` string names. */
export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null
}

/** An inclusive local range. `overdue` starts at the earliest representable date. */
export function resolveRelative(rel: DateRelative, now: Date): { start: Date; end: Date } {
  const today = startOfDay(now)
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
      return { start: monday, end: endOfDay(addDays(monday, 6)) }
    }
    case 'thisMonth':
      return {
        start: new Date(today.getFullYear(), today.getMonth(), 1),
        end: endOfDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      }
    case 'thisYear':
      return {
        start: new Date(today.getFullYear(), 0, 1),
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
  /** The start, local. */
  start: Date
  /** The end, local; null when the value has none. */
  end: Date | null
  resolution: 'day' | 'time'
}

function parsePoint(iso: string | null | undefined, resolution: 'day' | 'time'): Date | null {
  if (!iso) return null
  if (resolution === 'day') return parseDay(iso)
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** A date value as local dates; null when it has no usable start. */
export function dateSpan(v: DateValue | null | undefined): DateSpan | null {
  if (!v || typeof v !== 'object') return null
  const resolution = v.resolution === 'time' ? 'time' : 'day'
  const start = parsePoint(v.start, resolution)
  if (!start) return null
  return { start, end: parsePoint(v.end, resolution), resolution }
}
