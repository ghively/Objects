// Calendar date helpers (pure). A "day" is a local calendar day written `YYYY-MM-DD`; arithmetic is
// done on UTC dates built from the day's numbers, so DST never shifts a day.

export type Day = string
export type WeekStart = 'sunday' | 'monday'
export type CalendarView = 'month' | 'week' | 'rolling' | 'day'

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_DAY = 86_400_000

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** The local calendar day of `date` (default: now). */
export function ymd(date: Date = new Date()): Day {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The viewer's local day. */
export const todayYmd = (): Day => ymd(new Date())

/** `YYYY-MM-DD` as a local-midnight Date; null for a malformed or impossible day. */
export function parseYmd(day: string): Date | null {
  const m = DAY_RE.exec(day)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return date
}

export const isDay = (day: unknown): day is Day => typeof day === 'string' && parseYmd(day) !== null

function parts(day: Day): [number, number, number] {
  const m = DAY_RE.exec(day)
  if (!m) throw new Error(`Not a day: ${day}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

const utc = (day: Day) => {
  const [y, m, d] = parts(day)
  return Date.UTC(y, m - 1, d)
}

const fromUtc = (ms: number): Day => {
  const d = new Date(ms)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(day: Day, n: number): Day {
  return fromUtc(utc(day) + n * MS_DAY)
}

const daysInMonth = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate()

/** Calendar months, clamped to the target month's last day (31 Oct + 1 month = 30 Nov). */
export function addMonths(day: Day, n: number): Day {
  const [y, m, d] = parts(day)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${pad(ny, 4)}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`
}

export const addYears = (day: Day, n: number): Day => addMonths(day, n * 12)

/** ISO weekday: Monday 1 … Sunday 7. */
export function isoWeekday(day: Day): number {
  const w = new Date(utc(day)).getUTCDay()
  return w === 0 ? 7 : w
}

export function startOfWeek(day: Day, weekStart: WeekStart): Day {
  const iso = isoWeekday(day)
  const back = weekStart === 'monday' ? iso - 1 : iso % 7
  return addDays(day, -back)
}

/** The first day of the day's month. */
export const startOfMonth = (day: Day): Day => `${day.slice(0, 7)}-01`

/**
 * The mini month's grid: 6 rows of 7 days starting on the week start, including the muted days of
 * the months before and after. `month` is 1-based (October = 10).
 */
export function monthGrid(year: number, month: number, weekStart: WeekStart): Day[][] {
  const first = startOfWeek(`${pad(year, 4)}-${pad(month)}-01`, weekStart)
  const rows: Day[][] = []
  for (let r = 0; r < 6; r++) {
    const row: Day[] = []
    for (let c = 0; c < 7; c++) row.push(addDays(first, r * 7 + c))
    rows.push(row)
  }
  return rows
}

/**
 * The ISO week number. With `weekStart: 'sunday'` a Sunday belongs to the next ISO week
 * (Capacities' `startWeekOnSunday` rule: the day is moved forward one day first).
 */
export function weekNumber(day: Day, weekStart: WeekStart): number {
  const d = weekStart === 'sunday' ? addDays(day, 1) : day
  // The Thursday of d's ISO week decides the year; week 1 holds January 4th.
  const thursday = addDays(d, 4 - isoWeekday(d))
  const jan1 = Date.UTC(Number(thursday.slice(0, 4)), 0, 1)
  return Math.floor((utc(thursday) - jan1) / MS_DAY / 7) + 1
}

const WEEKDAY_COLORS: Record<number, string> = {
  1: 'text-yellow-500 dark:text-yellow-400',
  2: 'text-pink-500 dark:text-pink-400',
  3: 'text-green-500 dark:text-green-400',
  4: 'text-orange-500 dark:text-orange-400',
  5: 'text-blue-500 dark:text-blue-400',
  6: 'text-purple-500 dark:text-purple-400',
  7: 'text-red-500 dark:text-red-400',
}

/** The weekday name's colour classes by ISO weekday (the 500 shade in light, 400 in dark). */
export function weekdayColor(isoDay: number): string {
  return WEEKDAY_COLORS[isoDay] ?? 'text-fg-muted'
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const monthName = (month1: number): string => MONTHS[month1 - 1] ?? ''
export const weekdayName = (day: Day): string => WEEKDAYS[isoWeekday(day) - 1]

/** "October 23, 2026" */
export function formatLong(day: Day): string {
  const [y, m, d] = parts(day)
  return `${monthName(m)} ${d}, ${y}`
}

/** "Oct 2026" */
export function formatMonthTitle(day: Day): string {
  const [y, m] = parts(day)
  return `${monthName(m).slice(0, 3)} ${y}`
}

export interface DayRange {
  from: Day
  to: Day
  days: Day[]
}

function span(from: Day, to: Day): DayRange {
  const days: Day[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d)
  return { from, to, days }
}

/**
 * The days a view shows: Day the anchor; Three days ("rolling") the anchor with the day before and
 * after; Week the anchor's week; Month the anchor's calendar month.
 */
export function rangeFor(view: CalendarView, anchor: Day, weekStart: WeekStart): DayRange {
  switch (view) {
    case 'day':
      return span(anchor, anchor)
    case 'rolling':
      return span(addDays(anchor, -1), addDays(anchor, 1))
    case 'week': {
      const from = startOfWeek(anchor, weekStart)
      return span(from, addDays(from, 6))
    }
    case 'month': {
      const from = startOfMonth(anchor)
      return span(from, addDays(addMonths(from, 1), -1))
    }
  }
}
