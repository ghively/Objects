/**
 * Typed dates in the `/` menu (M8; English only, our choice). `parseDate`
 * turns a phrase into a day `YYYY-MM-DD`, relative to `today` (a day):
 *
 *   2026-10-27                 that day (a real calendar date)
 *   today, tomorrow, yesterday
 *   in N days, in N weeks      (`in 1 day`, `in a week` too)
 *   friday, fri                the first such day on or after today
 *   next friday                the first such day after today
 *   march 15, mar 15, 15 march that day in today's year
 *
 * Case and extra spaces are forgiven. Anything else is `null`.
 * `couldBeDate` says whether a phrase may still become one while it is being
 * typed (so the menu stays open on a space).
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const pad = (n: number) => String(n).padStart(2, '0')

function dayOf(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function utc(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
}

function addDays(day: Date, n: number): Date {
  return new Date(day.getTime() + n * 86_400_000)
}

/** A weekday from its full name or a prefix of at least three letters (`tue`, `tues`). */
function weekdayIndex(word: string): number {
  if (word.length < 3) return -1
  return WEEKDAYS.findIndex((w) => w.startsWith(word))
}

/** A month from its full name or a prefix of at least three letters (`sep`, `sept`). */
function monthIndex(word: string): number {
  if (word.length < 3) return -1
  return MONTHS.findIndex((m) => m.startsWith(word))
}

/** The day `text` names, relative to `today` (`YYYY-MM-DD`), or `null`. */
export function parseDate(text: string, today: string): string | null {
  const base = utc(today)
  if (!base) return null
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!t) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = utc(t)
    return d ? dayOf(d) : null
  }
  if (t === 'today') return dayOf(base)
  if (t === 'tomorrow') return dayOf(addDays(base, 1))
  if (t === 'yesterday') return dayOf(addDays(base, -1))

  const rel = /^in (\d{1,4}|a|an|one) (day|days|week|weeks)$/.exec(t)
  if (rel) {
    const n = /^\d+$/.test(rel[1]) ? Number(rel[1]) : 1
    return dayOf(addDays(base, rel[2].startsWith('week') ? n * 7 : n))
  }

  const next = /^(next )?([a-z]+)$/.exec(t)
  if (next) {
    const w = weekdayIndex(next[2])
    if (w >= 0) {
      let diff = (w - base.getUTCDay() + 7) % 7
      if (next[1] && diff === 0) diff = 7
      return dayOf(addDays(base, diff))
    }
    return null
  }

  const md = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?$/.exec(t) ?? null
  const dm = md ? null : /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)$/.exec(t)
  const monthWord = md ? md[1] : dm?.[2]
  const dayNum = md ? md[2] : dm?.[1]
  if (monthWord && dayNum) {
    const m = monthIndex(monthWord)
    if (m < 0) return null
    const d = utc(`${base.getUTCFullYear()}-${pad(m + 1)}-${pad(Number(dayNum))}`)
    return d ? dayOf(d) : null
  }
  return null
}

/** Whether `text` is a date phrase or the start of one (`next`, `in 3`, `march`, `2026-1`). */
export function couldBeDate(text: string, today: string): boolean {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!t) return false
  if (parseDate(t, today)) return true
  if (/^\d{1,4}(?:-\d{0,2}(?:-\d{0,2})?)?$/.test(t)) return true
  if (/^in(?: (?:\d{1,4}|a|an|one)(?: [a-z]*)?)?$/.test(t)) return true
  if (/^next(?: [a-z]*)?$/.test(t)) return true
  const word = /^([a-z]+)(?: \d{0,2})?$/.exec(t)
  if (word && word[1].length >= 3 && monthIndex(word[1]) >= 0) return true
  return false
}
