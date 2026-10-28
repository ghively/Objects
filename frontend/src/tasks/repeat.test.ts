import { describe, expect, test } from 'vitest'
import { describeRepeat, formatRepeat, nextDay, ordinal, parseRepeat, presetOn, stepAfter } from './repeat'

// The shared table from the M4 plan's Global Constraints, row for row (backend: test_taskmodel.py).
const REPEAT_VALID: [string, object, string][] = [
  ['every day', { every: 1, unit: 'day', mode: 'dueDate' }, 'every day'],
  ['Every  2 Weeks', { every: 2, unit: 'week', mode: 'dueDate' }, 'every 2 weeks'],
  ['every weekday', { every: 1, unit: 'weekday', mode: 'dueDate' }, 'every weekday'],
  ['every month after completion', { every: 1, unit: 'month', mode: 'completionDate' }, 'every month after completion'],
  ['every 3 months until 2027-06-30', { every: 3, unit: 'month', mode: 'dueDate', until: '2027-06-30' }, 'every 3 months until 2027-06-30'],
]
const REPEAT_INVALID = [
  'every 0 days',
  'every -1 week',
  'weekly',
  'every 2 fortnights',
  'every 2 weekdays',
  'every weekday after completion',
  'every day until 2027-13-01',
]

describe('repeat', () => {
  test('test repeat vectors', () => {
    for (const [text, parsed, canonical] of REPEAT_VALID) {
      const rule = parseRepeat(text)
      expect(rule, text).toEqual(parsed)
      expect(formatRepeat(rule!)).toBe(canonical)
    }
    for (const text of REPEAT_INVALID) expect(parseRepeat(text), text).toBeNull()
    expect(parseRepeat(null)).toBeNull()
    expect(parseRepeat('')).toBeNull()
  })

  test('test describeRepeat presets', () => {
    // 2026-10-30 is a Friday.
    expect(describeRepeat(parseRepeat('every week'), '2026-10-30')).toBe('Weekly on Friday')
    expect(describeRepeat(parseRepeat('every month'), '2026-10-31')).toBe('Monthly on day 31')
    expect(describeRepeat(parseRepeat('every weekday'), '2026-10-30')).toBe('Every weekday')
    expect(describeRepeat(parseRepeat('every 2 weeks'), '2026-10-30')).toBe('Custom')
    expect(describeRepeat(parseRepeat('every day'), '2026-10-30')).toBe('Daily')
    expect(describeRepeat(parseRepeat('every year'), '2026-10-30')).toBe('Yearly on October 30')
    expect(describeRepeat(parseRepeat('every day after completion'), '2026-10-30')).toBe('Custom')
    expect(describeRepeat(null, '2026-10-30')).toBe('No repeat')
  })
})

// M8: the shared vectors of the M8 plan's Global Constraints ("repeat grammar, extended"),
// copied row for row from the backend's table (backend/tests/test_recurrence_m8.py).
const TODAY = '2026-10-27' // a Tuesday
const M8_VECTORS: [string, object, string, [string, string] | null][] = [
  ['every week on mon, fri', { every: 1, unit: 'week', mode: 'dueDate', on: { weekdays: ['mon', 'fri'] } }, 'every week on mon, fri', ['2026-10-23', '2026-10-30']],
  ['Every 2 Weeks On Friday, Monday', { every: 2, unit: 'week', mode: 'dueDate', on: { weekdays: ['mon', 'fri'] } }, 'every 2 weeks on mon, fri', null],
  ['every month on the 31st', { every: 1, unit: 'month', mode: 'dueDate', on: { monthDay: 31 } }, 'every month on the 31st', ['2026-08-31', '2026-10-31']],
  ['every month on the last day', { every: 1, unit: 'month', mode: 'dueDate', on: { monthDay: 'last' } }, 'every month on the last day', ['2026-09-30', '2026-10-31']],
  ['every month on the 2nd tuesday', { every: 1, unit: 'month', mode: 'dueDate', on: { weekdayPos: 2, weekday: 'tue' } }, 'every month on the 2nd tuesday', ['2026-10-13', '2026-11-10']],
  ['every month on the last friday', { every: 1, unit: 'month', mode: 'dueDate', on: { weekdayPos: 'last', weekday: 'fri' } }, 'every month on the last friday', ['2026-09-25', '2026-10-30']],
  ['every year on march 15', { every: 1, unit: 'year', mode: 'dueDate', on: { month: 3, monthDay: 15 } }, 'every year on march 15', ['2026-03-15', '2027-03-15']],
  ['every year on the 2nd tuesday of march', { every: 1, unit: 'year', mode: 'dueDate', on: { month: 3, weekdayPos: 2, weekday: 'tue' } }, 'every year on the 2nd tuesday of march', ['2026-03-10', '2027-03-09']],
]
const M8_INVALID = [
  'every week on mon after completion',
  'every month on the 5th tuesday',
  'every month on the 32nd',
  'every day on mon',
  'every year on february 30',
  'every week on',
  'every weekday on mon',
  'every month on march 15',
  'every year on the 15th',
  'every week on mon,, fri',
]

describe('repeat (M8 custom rules)', () => {
  test('test custom rule vectors match the backend table', () => {
    for (const [text, parsed, canonical, next] of M8_VECTORS) {
      const rule = parseRepeat(text)
      expect(rule, text).toEqual(parsed)
      expect(formatRepeat(rule!), text).toBe(canonical)
      expect(parseRepeat(canonical), canonical).toEqual(parsed)
      if (next) expect(nextDay(rule!, next[0], TODAY), text).toBe(next[1])
    }
    for (const text of M8_INVALID) expect(parseRepeat(text), text).toBeNull()
    // M4's rules keep M4's shape (no `on` key).
    expect(parseRepeat('every week')).not.toHaveProperty('on')
  })

  test('other custom forms round trip and step', () => {
    for (const t of ['every year on the last day of february', 'every 3 months on the last friday until 2027-06-30', 'every week on tue, sun'])
      expect(formatRepeat(parseRepeat(t)!)).toBe(t)
    expect(parseRepeat('every week on Sunday, monday')).toEqual({ every: 1, unit: 'week', mode: 'dueDate', on: { weekdays: ['mon', 'sun'] } })
    // a sunday week start orders the list's periods from sunday
    const r = parseRepeat('every 2 weeks on mon, sun')!
    expect(stepAfter(r, '2026-10-26', 'monday')).toBe('2026-11-01')
    expect(stepAfter(r, '2026-10-26', 'sunday')).toBe('2026-11-08')
    // until ends it; plain rules step as M4
    expect(nextDay(parseRepeat('every month on the 31st until 2026-10-30')!, '2026-08-31', TODAY)).toBeNull()
    expect(nextDay(parseRepeat('every day')!, '2026-10-20', TODAY)).toBe('2026-10-27')
    expect(stepAfter(parseRepeat('every month')!, '2026-01-31')).toBe('2026-02-28')
    expect(ordinal(1) + ordinal(2) + ordinal(3) + ordinal(11) + ordinal(12) + ordinal(13) + ordinal(22) + ordinal(31)).toBe('1st2nd3rd11th12th13th22nd31st')
  })

  test('presets name anchored rules that match the date', () => {
    // 2026-10-30 is a Friday.
    expect(describeRepeat(parseRepeat('every week on fri'), '2026-10-30')).toBe('Weekly on Friday')
    expect(describeRepeat(parseRepeat('every week on mon'), '2026-10-30')).toBe('Custom')
    expect(describeRepeat(parseRepeat('every month on the 30th'), '2026-10-30')).toBe('Monthly on day 30')
    expect(describeRepeat(parseRepeat('every month on the last day'), '2026-10-31')).toBe('Custom')
    expect(describeRepeat(parseRepeat('every year on october 30'), '2026-10-30')).toBe('Yearly on October 30')
    const d = new Date(2026, 9, 30)
    expect(formatRepeat({ every: 1, unit: 'week', mode: 'dueDate', on: presetOn('week', d) })).toBe('every week on fri')
    expect(formatRepeat({ every: 1, unit: 'month', mode: 'dueDate', on: presetOn('month', d) })).toBe('every month on the 30th')
    expect(formatRepeat({ every: 1, unit: 'year', mode: 'dueDate', on: presetOn('year', d) })).toBe('every year on october 30')
  })
})
