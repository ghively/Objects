import { describe, expect, test } from 'vitest'
import { describeRepeat, formatRepeat, parseRepeat } from './repeat'

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
