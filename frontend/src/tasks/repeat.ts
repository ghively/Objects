// The Task `repeat` text form (mirrors backend/objectapp/taskmodel.py; the server owns what
// happens on completion, the client only parses for display and writes the canonical form).
//
//   every [N] (day|week|month|year)[s] [after completion] [until YYYY-MM-DD]
//   every weekday [until YYYY-MM-DD]
import type { RepeatRule } from '@/api/types'

const REPEAT =
  /^every(?:\s+(\d+))?\s+(day|week|month|year|weekday)(s)?(\s+after\s+completion)?(?:\s+until\s+(\d{4}-\d{2}-\d{2}))?$/

const norm = (text: unknown): string | null => (typeof text === 'string' ? text.split(/\s+/).filter(Boolean).join(' ').toLowerCase() : null)

/** A real calendar day `YYYY-MM-DD`. */
export function validDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

/** The rule a `repeat` text names; null when it isn't valid (case and spacing are forgiven). */
export function parseRepeat(text: unknown): RepeatRule | null {
  const s = norm(text)
  if (!s) return null
  const m = REPEAT.exec(s)
  if (!m) return null
  const [, n, unit, plural, after, until] = m
  if (until !== undefined && !validDay(until)) return null
  const withUntil = (r: RepeatRule): RepeatRule => (until ? { ...r, until } : r)
  if (unit === 'weekday') {
    if (n !== undefined || plural || after) return null
    return withUntil({ every: 1, unit: 'weekday', mode: 'dueDate' })
  }
  const every = n !== undefined ? parseInt(n, 10) : 1
  if (every < 1) return null
  return withUntil({ every, unit: unit as RepeatRule['unit'], mode: after ? 'completionDate' : 'dueDate' })
}

/** The canonical text of a rule (`every 2 weeks after completion until 2027-06-30`). */
export function formatRepeat(rule: RepeatRule): string {
  let out =
    rule.unit === 'weekday' ? 'every weekday' : rule.every === 1 ? `every ${rule.unit}` : `every ${rule.every} ${rule.unit}s`
  if (rule.mode === 'completionDate' && rule.unit !== 'weekday') out += ' after completion'
  if (rule.until) out += ` until ${rule.until}`
  return out
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The local calendar day of a date value's start (`YYYY-MM-DD` is a day as written). */
export function localDayOf(start: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  const d = new Date(start)
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * The picker's preset name for a rule (`DatePicker.recurrencePreset.*`): "Daily", "Weekly on
 * {day}", "Monthly on day {date}", "Yearly on {date}", "Every weekday"; anything else (every N > 1,
 * after completion, an end date) is "Custom". `date` is the task's date (its start).
 */
export function describeRepeat(rule: RepeatRule | null, date?: string | Date | null): string {
  if (!rule) return 'No repeat'
  const plain = rule.mode === 'dueDate' && !rule.until && rule.every === 1
  if (!plain) return 'Custom'
  const d = date instanceof Date ? date : date ? localDayOf(date) : null
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
