// The Task `remind` text form (mirrors backend/objectapp/taskmodel.py). A reminder only applies
// to the Task `date`, and only when it fits the date's resolution:
//
//   time dates: at time | N minutes before | N hours before
//   day dates:  on the day at HH:mm | N day[s] before at HH:mm
import type { ReminderRule, Resolution } from '@/api/types'

const AT_TIME = /^at time$/
const MINUTES = /^(\d+)\s+(minute|hour)s?\s+before$/
const ON_DAY = /^on the day at (\d{2}:\d{2})$/
const DAYS = /^(\d+)\s+days?\s+before at (\d{2}:\d{2})$/

const norm = (text: unknown): string | null => (typeof text === 'string' ? text.split(/\s+/).filter(Boolean).join(' ').toLowerCase() : null)

function validHhmm(t: string): boolean {
  const [h, m] = t.split(':').map(Number)
  return h >= 0 && h <= 23 && m >= 0 && m <= 59
}

function parseTime(s: string): ReminderRule | null {
  if (AT_TIME.test(s)) return { minutesBefore: 0, daysBefore: 0 }
  const m = MINUTES.exec(s)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (n < 1) return null
  return { minutesBefore: m[2] === 'hour' ? n * 60 : n, daysBefore: 0 }
}

function parseDayForm(s: string): ReminderRule | null {
  const on = ON_DAY.exec(s)
  if (on) return validHhmm(on[1]) ? { minutesBefore: 0, daysBefore: 0, timeOfDay: on[1] } : null
  const m = DAYS.exec(s)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (n < 1 || !validHhmm(m[2])) return null
  return { minutesBefore: 0, daysBefore: n, timeOfDay: m[2] }
}

/**
 * The rule a `remind` text names; null when it isn't valid. With a `resolution` only the forms
 * that fit it are read (a time form on a day date is null); without one, either form.
 */
export function parseRemind(text: unknown, resolution?: Resolution): ReminderRule | null {
  const s = norm(text)
  if (!s) return null
  if (resolution === 'time') return parseTime(s)
  if (resolution === 'day') return parseDayForm(s)
  return parseTime(s) ?? parseDayForm(s)
}

/** The resolution a rule fits: a time of day means a day date. */
export const remindResolution = (rule: ReminderRule): Resolution => (rule.timeOfDay !== undefined ? 'day' : 'time')

/** The canonical text of a rule; `resolution` defaults to the one the rule fits. Throws on a misfit. */
export function formatRemind(rule: ReminderRule, resolution: Resolution = remindResolution(rule)): string {
  if (resolution === 'time') {
    if (rule.timeOfDay !== undefined) throw new Error('a day reminder does not fit a time date')
    const n = rule.minutesBefore
    if (n === 0) return 'at time'
    if (n < 60 || n % 60) return n === 1 ? '1 minute before' : `${n} minutes before`
    const h = n / 60
    return h === 1 ? '1 hour before' : `${h} hours before`
  }
  if (rule.timeOfDay === undefined) throw new Error('a time reminder does not fit a day date')
  if (rule.daysBefore === 0) return `on the day at ${rule.timeOfDay}`
  if (rule.daysBefore === 1) return `1 day before at ${rule.timeOfDay}`
  return `${rule.daysBefore} days before at ${rule.timeOfDay}`
}
