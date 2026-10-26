import { describe, expect, test } from 'vitest'
import type { Resolution } from '@/api/types'
import { formatRemind, parseRemind } from './remind'

// The shared table from the M4 plan's Global Constraints, row for row (backend: test_taskmodel.py).
const REMIND_VALID: [string, Resolution, object, string][] = [
  ['at time', 'time', { minutesBefore: 0, daysBefore: 0 }, 'at time'],
  ['15 minutes before', 'time', { minutesBefore: 15, daysBefore: 0 }, '15 minutes before'],
  ['1 hour before', 'time', { minutesBefore: 60, daysBefore: 0 }, '1 hour before'],
  ['on the day at 09:00', 'day', { minutesBefore: 0, daysBefore: 0, timeOfDay: '09:00' }, 'on the day at 09:00'],
  ['1 day before at 18:30', 'day', { minutesBefore: 0, daysBefore: 1, timeOfDay: '18:30' }, '1 day before at 18:30'],
  ['3 days before at 08:00', 'day', { minutesBefore: 0, daysBefore: 3, timeOfDay: '08:00' }, '3 days before at 08:00'],
]
const REMIND_INVALID = ['on the day', '2 days before', 'at 9:00', '15 minutes before at 09:00', '0 minutes before', 'on the day at 25:00']

describe('remind', () => {
  test('test remind vectors', () => {
    for (const [text, res, parsed, canonical] of REMIND_VALID) {
      const rule = parseRemind(text, res)
      expect(rule, text).toEqual(parsed)
      expect(formatRemind(rule!, res)).toBe(canonical)
      expect(parseRemind(text)).toEqual(parsed)
    }
    for (const text of REMIND_INVALID) {
      expect(parseRemind(text, 'day'), text).toBeNull()
      expect(parseRemind(text, 'time'), text).toBeNull()
      expect(parseRemind(text), text).toBeNull()
    }
  })

  test('a reminder must fit the date resolution', () => {
    expect(parseRemind('15 minutes before', 'day')).toBeNull()
    expect(parseRemind('on the day at 09:00', 'time')).toBeNull()
    expect(formatRemind({ minutesBefore: 120, daysBefore: 0 })).toBe('2 hours before')
    expect(formatRemind({ minutesBefore: 90, daysBefore: 0 })).toBe('90 minutes before')
    expect(parseRemind('2 Hours  before', 'time')).toEqual({ minutesBefore: 120, daysBefore: 0 })
  })
})
