import { describe, expect, test } from 'vitest'
import { couldBeDate, parseDate } from './parseDate'

const TODAY = '2026-10-27' // a Tuesday

describe('parseDate', () => {
  test('parse date phrases', () => {
    const cases: [string, string | null][] = [
      ['2026-10-30', '2026-10-30'],
      ['2024-02-29', '2024-02-29'],
      ['2026-02-30', null],
      ['today', '2026-10-27'],
      ['Tomorrow', '2026-10-28'],
      [' yesterday ', '2026-10-26'],
      ['in 3 days', '2026-10-30'],
      ['in 1 day', '2026-10-28'],
      ['in a week', '2026-11-03'],
      ['in 2 weeks', '2026-11-10'],
      ['IN  10   DAYS', '2026-11-06'],
      ['friday', '2026-10-30'],
      ['fri', '2026-10-30'],
      ['tuesday', '2026-10-27'],
      ['next tuesday', '2026-11-03'],
      ['next fri', '2026-10-30'],
      ['monday', '2026-11-02'],
      ['march 15', '2026-03-15'],
      ['Mar 15th', '2026-03-15'],
      ['15 march', '2026-03-15'],
      ['dec 31', '2026-12-31'],
      ['february 30', null],
      ['in days', null],
      ['next', null],
      ['fr', null],
      ['someday', null],
      ['', null],
      ['13/10/2026', null],
    ]
    for (const [text, want] of cases) expect(parseDate(text, TODAY), text).toBe(want)
    // Month ends and leap years.
    expect(parseDate('in 5 days', '2026-12-29')).toBe('2027-01-03')
    expect(parseDate('feb 29', '2028-01-01')).toBe('2028-02-29')
    expect(parseDate('today', 'not a day')).toBeNull()
  })

  test('phrases still being typed could be dates', () => {
    for (const t of ['next', 'next ', 'next fr', 'in', 'in 3', 'in 3 d', 'march', 'mar 1', '2026', '2026-1', 'friday']) {
      expect(couldBeDate(t, TODAY), t).toBe(true)
    }
    for (const t of ['hello', 'head', 'ma', 'zzqx', '']) expect(couldBeDate(t, TODAY), t).toBe(false)
  })
})
