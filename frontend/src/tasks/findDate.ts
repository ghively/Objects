// M32: the date words inside a quick-add line ("Call Pat friday", "Pay rent by nov 20"). The words
// themselves are read by the `/` menu's parser (`editor/slash/parseDate.ts`, which reads a whole
// phrase and nothing around it); this finds the phrase in a longer text. Also read here: "next
// week" (a week ahead, as the date picker's "Next week"). "yesterday" is left as a word: a new
// task is not dated in the past.
import { parseDate } from '@/editor/slash/parseDate'

export interface FoundDate {
  /** The day the words name (`YYYY-MM-DD`). */
  day: string
  /** The words as typed ("next friday"). */
  phrase: string
  /** The text without the words, and without an "on", "by" or "due" just before them. */
  title: string
}

/** The longest date phrase the parser reads ("in 3 days"). */
const MAX_WORDS = 3
/** A word before the date that goes with it ("Pay rent by friday"). */
const LEAD = new Set(['on', 'by', 'due'])
const ISO = /^\d{4}-\d{2}-\d{2}$/

const pad = (n: number) => String(n).padStart(2, '0')

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + n))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** The day `phrase` names seen from `today`, or null. */
function readPhrase(phrase: string, today: string): string | null {
  const t = phrase
    .toLowerCase()
    .replace(/[.,!?;:]+$/, '')
    .trim()
  if (!t || t === 'yesterday') return null
  if (t === 'next week') return ISO.test(today) ? addDays(today, 7) : null
  const day = parseDate(t, today)
  if (!day) return null
  // A month and day read in today's year: one already past means next year's.
  if (day < today && !ISO.test(t)) return parseDate(t, `${Number(today.slice(0, 4)) + 1}-01-01`) ?? day
  return day
}

/**
 * The date words in `text`, seen from `today` (`YYYY-MM-DD`): the last ones when there are several,
 * the longest phrase at that place ("next friday", not "friday"). Null when there are none, or when
 * nothing but the date words would be left for a title.
 */
export function findDatePhrase(text: string, today: string): FoundDate | null {
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }))
  for (let last = words.length - 1; last >= 0; last--) {
    for (let n = Math.min(MAX_WORDS, last + 1); n >= 1; n--) {
      const first = last - n + 1
      const phrase = words
        .slice(first, last + 1)
        .map((w) => w.text)
        .join(' ')
      const day = readPhrase(phrase, today)
      if (!day) continue
      const from = first > 0 && LEAD.has(words[first - 1].text.toLowerCase()) ? first - 1 : first
      const title = `${text.slice(0, words[from].start)} ${text.slice(words[last].end)}`.replace(/\s+/g, ' ').trim()
      return title ? { day, phrase, title } : null
    }
  }
  return null
}
