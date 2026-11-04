// The Task `repeat` text form (mirrors backend/objectapp/taskmodel.py and recurrence.py; the server
// owns what happens on completion, the client parses for display, writes the canonical form and
// computes the next day for labels such as "Skip to {date}").
//
//   every [N] (day|week|month|year)[s] [ON] [after completion] [until YYYY-MM-DD]
//   every weekday [until YYYY-MM-DD]
//   ON (M8, by due date only):
//     weeks:  on mon[, tue …]           (full names read too; written in week order)
//     months: on the 15th | on the last day | on the 2nd tuesday | on the last friday
//     years:  on march 15 | on the 2nd tuesday of march | on the last day of february
import { zonedDayDate } from '@/lib/zonedShell'
import type { RepeatOn, RepeatRule, Weekday } from './taskContract'

export type { RepeatOn, RepeatRule, Weekday }

export const WEEKDAY_KEYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const MONTH_KEYS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const
const MONTH_MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const WEEKDAY_NAMES: Record<string, Weekday> = {
  mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat', sun: 'sun',
  monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun',
}
const FULL_WEEKDAY: Record<Weekday, string> = {
  mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday',
}
const MONTH_NAMES: Record<string, number> = Object.fromEntries(
  MONTH_KEYS.flatMap((m, i) => [
    [m, i + 1],
    [m.slice(0, 3), i + 1],
  ]),
)

const REPEAT =
  /^every(?:\s+(\d+))?\s+(day|week|month|year|weekday)(s)?(?:\s+on\b(.*?))?(\s+after\s+completion)?(?:\s+until\s+(\d{4}-\d{2}-\d{2}))?$/

const norm = (text: unknown): string | null => (typeof text === 'string' ? text.split(/\s+/).filter(Boolean).join(' ').toLowerCase() : null)

/** A real calendar day `YYYY-MM-DD`. */
export function validDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

function parseOnWeeks(s: string): RepeatOn | null {
  const names = s.split(',').map((p) => p.trim())
  if (names.length === 0 || names.some((n) => !(n in WEEKDAY_NAMES))) return null
  const chosen = new Set(names.map((n) => WEEKDAY_NAMES[n]))
  return { weekdays: WEEKDAY_KEYS.filter((w) => chosen.has(w)) }
}

/** `the 15th` | `the last day` | `the 2nd tuesday` | `the last friday` (with the year's month). */
function parseOnMonthPart(s: string, month: number | null): RepeatOn | null {
  const withMonth = <T extends object>(on: T): T => (month ? { month, ...on } : on)
  if (s === 'the last day') return withMonth({ monthDay: 'last' as const })
  let m = /^the (\d+)(?:st|nd|rd|th)$/.exec(s)
  if (m) {
    const day = parseInt(m[1], 10)
    const limit = month ? MONTH_MAX_DAYS[month - 1] : 31
    if (day < 1 || day > limit) return null
    return withMonth({ monthDay: day })
  }
  m = /^the (?:(\d+)(?:st|nd|rd|th)|(last)) ([a-z]+)$/.exec(s)
  if (m && m[3] in WEEKDAY_NAMES) {
    let pos: 1 | 2 | 3 | 4 | 'last' = 'last'
    if (!m[2]) {
      const n = parseInt(m[1], 10)
      if (n < 1 || n > 4) return null
      pos = n as 1 | 2 | 3 | 4
    }
    return withMonth({ weekdayPos: pos, weekday: WEEKDAY_NAMES[m[3]] })
  }
  return null
}

function parseOnYears(s: string): RepeatOn | null {
  const m = /^([a-z]+) (\d+)$/.exec(s)
  if (m) {
    const month = MONTH_NAMES[m[1]]
    const day = parseInt(m[2], 10)
    if (!month || day < 1 || day > MONTH_MAX_DAYS[month - 1]) return null
    return { month, monthDay: day }
  }
  const at = s.lastIndexOf(' of ')
  if (at < 0) return null
  const month = MONTH_NAMES[s.slice(at + 4)]
  if (!month) return null
  return parseOnMonthPart(s.slice(0, at), month)
}

function parseOn(unit: string, raw: string): RepeatOn | null {
  const s = raw.trim()
  if (!s) return null
  if (unit === 'week') return parseOnWeeks(s)
  if (unit === 'month') return parseOnMonthPart(s, null)
  if (unit === 'year') return parseOnYears(s)
  return null
}

/** The rule a `repeat` text names; null when it isn't valid (case and spacing are forgiven). */
export function parseRepeat(text: unknown): RepeatRule | null {
  const s = norm(text)
  if (!s) return null
  const m = REPEAT.exec(s)
  if (!m) return null
  const [, n, unit, plural, onText, after, until] = m
  if (until !== undefined && !validDay(until)) return null
  const withUntil = (r: RepeatRule): RepeatRule => (until ? { ...r, until } : r)
  if (unit === 'weekday') {
    if (n !== undefined || plural || after || onText !== undefined) return null
    return withUntil({ every: 1, unit: 'weekday', mode: 'dueDate' })
  }
  const every = n !== undefined ? parseInt(n, 10) : 1
  if (every < 1) return null
  let on: RepeatOn | null = null
  if (onText !== undefined) {
    // by due date only: the completion-date rule has only an interval
    if (after) return null
    on = parseOn(unit, onText)
    if (!on) return null
  }
  const rule = withUntil({ every, unit: unit as RepeatRule['unit'], mode: after ? 'completionDate' : 'dueDate' })
  return on ? { ...rule, on } : rule
}

/** `1st`, `2nd`, `3rd`, `4th`, `11th`, `22nd`. */
export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/** The canonical text after `on ` (no leading `on`). */
export function formatOn(on: RepeatOn): string {
  if ('weekdays' in on && on.weekdays) return on.weekdays.join(', ')
  const month = 'month' in on && on.month ? MONTH_KEYS[on.month - 1] : null
  let out: string
  if ('weekdayPos' in on) {
    out = `the ${on.weekdayPos === 'last' ? 'last' : ordinal(on.weekdayPos)} ${FULL_WEEKDAY[on.weekday]}`
  } else if ('monthDay' in on && on.monthDay === 'last') {
    out = 'the last day'
  } else if ('monthDay' in on) {
    if (month) return `${month} ${on.monthDay}`
    out = `the ${ordinal(on.monthDay as number)}`
  } else return ''
  return month ? `${out} of ${month}` : out
}

/** The canonical text of a rule (`every 2 weeks on mon, fri until 2027-06-30`). */
export function formatRepeat(rule: RepeatRule): string {
  let out =
    rule.unit === 'weekday' ? 'every weekday' : rule.every === 1 ? `every ${rule.unit}` : `every ${rule.every} ${rule.unit}s`
  if (rule.on && rule.unit !== 'weekday') out += ` on ${formatOn(rule.on)}`
  if (rule.mode === 'completionDate' && rule.unit !== 'weekday') out += ' after completion'
  if (rule.until) out += ` until ${rule.until}`
  return out
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The display name of a weekday key (`Monday`). */
export const weekdayName = (w: Weekday): string => WEEKDAYS[(WEEKDAY_KEYS.indexOf(w) + 1) % 7]
/** The display name of a month 1…12 (`March`). */
export const monthName = (m: number): string => MONTHS[m - 1]
/** The weekday key of a local date. */
export const weekdayOf = (d: Date): Weekday => WEEKDAY_KEYS[(d.getDay() + 6) % 7]

/**
 * The calendar day of a date value's start, as a local-midnight `Date`: `YYYY-MM-DD` is a day as
 * written, an instant is on its day in the Time zone setting (`lib/zonedTime`).
 */
export function localDayOf(start: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  const d = new Date(start)
  return Number.isNaN(d.getTime()) ? null : zonedDayDate(d)
}

/** The anchored `on` the presets write for `date`: "Weekly on {day}" → `on fri`, and so on. */
export function presetOn(unit: 'week' | 'month' | 'year', d: Date): RepeatOn {
  if (unit === 'week') return { weekdays: [weekdayOf(d)] }
  if (unit === 'month') return { monthDay: d.getDate() }
  return { month: d.getMonth() + 1, monthDay: d.getDate() }
}

const sameOn = (a: RepeatOn | undefined, b: RepeatOn): boolean => !!a && formatOn(a) === formatOn(b)

/**
 * The picker's preset name for a rule: "Daily", "Weekly on
 * {day}", "Monthly on day {date}", "Yearly on {date}", "Every weekday"; anything else (every N > 1,
 * after completion, an end date, an `on` that isn't the date's own) is "Custom". `date` is the
 * task's date (its start). M4's plain `every week` names the same preset as `every week on {day}`.
 */
export function describeRepeat(rule: RepeatRule | null, date?: string | Date | null): string {
  if (!rule) return 'No repeat'
  const plain = rule.mode === 'dueDate' && !rule.until && rule.every === 1
  if (!plain) return 'Custom'
  const d = date instanceof Date ? date : date ? localDayOf(date) : null
  if (rule.on && (!d || rule.unit === 'day' || rule.unit === 'weekday' || !sameOn(rule.on, presetOn(rule.unit, d)))) return 'Custom'
  switch (rule.unit) {
    case 'day':
      return 'Daily'
    case 'weekday':
      return 'Every weekday'
    case 'week':
      return d ? `Weekly on ${WEEKDAYS[d.getDay()]}` : 'Custom'
    case 'month':
      return d ? `Monthly on day ${d.getDate()}` : 'Custom'
    case 'year':
      return d ? `Yearly on ${MONTHS[d.getMonth()]} ${d.getDate()}` : 'Custom'
  }
}

// ---- Next day (by due date, day arithmetic; mirrors recurrence.py) ----

export type WeekStart = 'monday' | 'sunday'

const MAX_PERIODS = 2000
const MAX_STEPS = 100_000

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const daysIn = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate()
/** Monday = 0 … Sunday = 6, as Python's `date.weekday()`. */
const pyWeekday = (d: Date) => (d.getDay() + 6) % 7

function nthWeekday(y: number, m0: number, pos: number | 'last', wd: Weekday): Date | null {
  const target = WEEKDAY_KEYS.indexOf(wd)
  if (pos === 'last') {
    const last = new Date(y, m0, daysIn(y, m0))
    return addDays(last, -((pyWeekday(last) - target + 7) % 7))
  }
  const first = new Date(y, m0, 1)
  const d = addDays(first, ((target - pyWeekday(first) + 7) % 7) + 7 * (pos - 1))
  return d.getMonth() === m0 ? d : null
}

function inMonth(on: RepeatOn, y: number, m0: number): Date[] {
  if ('weekdayPos' in on) {
    const d = nthWeekday(y, m0, on.weekdayPos, on.weekday)
    return d ? [d] : []
  }
  if (!('monthDay' in on)) return []
  const last = daysIn(y, m0)
  if (on.monthDay === 'last') return [new Date(y, m0, last)]
  return on.monthDay >= 1 && on.monthDay <= last ? [new Date(y, m0, on.monthDay)] : []
}

function period(rule: RepeatRule, anchor: Date, k: number, ws: WeekStart): Date[] {
  const on = rule.on!
  if (rule.unit === 'week') {
    const first = ws === 'sunday' ? 6 : 0
    const base = addDays(anchor, -((pyWeekday(anchor) - first + 7) % 7) + 7 * k * rule.every)
    const offsets = (('weekdays' in on && on.weekdays) || []).map((w) => (WEEKDAY_KEYS.indexOf(w) - first + 7) % 7).sort((a, b) => a - b)
    return offsets.map((o) => addDays(base, o))
  }
  if (rule.unit === 'month') {
    const total = anchor.getFullYear() * 12 + anchor.getMonth() + k * rule.every
    return inMonth(on, Math.floor(total / 12), total % 12)
  }
  const month = 'month' in on && on.month ? on.month - 1 : anchor.getMonth()
  return inMonth(on, anchor.getFullYear() + k * rule.every, month)
}

function addMonths(d: Date, months: number): Date {
  const total = d.getFullYear() * 12 + d.getMonth() + months
  const y = Math.floor(total / 12)
  const m0 = total % 12
  return new Date(y, m0, Math.min(d.getDate(), daysIn(y, m0)))
}

/** One step after the day `d` (an `on` rule: the first matching day strictly after it). */
export function stepDay(rule: RepeatRule, d: Date, ws: WeekStart = 'monday'): Date | null {
  if (rule.on && rule.unit !== 'weekday' && rule.unit !== 'day') {
    for (let k = 0; k < MAX_PERIODS; k++) for (const c of period(rule, d, k, ws)) if (c > d) return c
    return null
  }
  switch (rule.unit) {
    case 'day':
      return addDays(d, rule.every)
    case 'week':
      return addDays(d, 7 * rule.every)
    case 'month':
      return addMonths(d, rule.every)
    case 'year':
      return addMonths(d, 12 * rule.every)
    case 'weekday': {
      let n = addDays(d, 1)
      while (pyWeekday(n) >= 5) n = addDays(n, 1)
      return n
    }
  }
}

/**
 * The next scheduled day after `current` that is on or after `today` (M4's rule: one step, then
 * on until today), `YYYY-MM-DD`; null when `until` ends the rule. By due date only.
 */
export function nextDay(rule: RepeatRule, current: string, today: string, ws: WeekStart = 'monday'): string | null {
  let d = localDayOf(current)
  const t = localDayOf(today)
  if (!d || !t) return null
  for (let i = 0; i < MAX_STEPS; i++) {
    const n = stepDay(rule, d, ws)
    if (!n) return null
    d = n
    if (d >= t) break
  }
  const out = ymd(d)
  return rule.until && out > rule.until ? null : out
}

/** `nextDay`'s single step (no catching up to today). */
export function stepAfter(rule: RepeatRule, current: string, ws: WeekStart = 'monday'): string | null {
  const d = localDayOf(current)
  const n = d ? stepDay(rule, d, ws) : null
  if (!n) return null
  const out = ymd(n)
  return rule.until && out > rule.until ? null : out
}
