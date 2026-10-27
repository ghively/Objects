import { describe, expect, test, vi } from 'vitest'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import {
  addDays,
  addMonths,
  formatLong,
  formatMonthTitle,
  isoWeekday,
  monthGrid,
  parseYmd,
  rangeFor,
  todayYmd,
  startOfWeek,
  weekNumber,
  weekdayColor,
  ymd,
} from './dates'

describe('dates', () => {
  test('week number with Sunday start', () => {
    expect(weekNumber('2026-10-23', 'sunday')).toBe(43)
    expect(weekNumber('2026-10-23', 'monday')).toBe(43)
    expect(weekNumber('2026-10-25', 'sunday')).toBe(44)
    expect(weekNumber('2026-10-25', 'monday')).toBe(43)
    expect(weekNumber('2026-01-01', 'sunday')).toBe(1)
    expect(weekNumber('2026-01-01', 'monday')).toBe(1)
    expect(weekNumber('2025-12-29', 'sunday')).toBe(1)
    expect(weekNumber('2025-12-29', 'monday')).toBe(1)
  })

  test('weekday colours', () => {
    const want = ['yellow', 'pink', 'green', 'orange', 'blue', 'purple', 'red']
    want.forEach((c, i) => {
      expect(weekdayColor(i + 1)).toBe(`text-${c}-500 dark:text-${c}-400`)
    })
    // 2026-10-23 is a Friday (blue in 01-calendar-day.png).
    expect(weekdayColor(isoWeekday('2026-10-23'))).toContain('blue')
  })

  test('long and month title formats', () => {
    expect(formatLong('2026-10-23')).toBe('October 23, 2026')
    expect(formatLong('2026-01-05')).toBe('January 5, 2026')
    expect(formatMonthTitle('2026-10-23')).toBe('Oct 2026')
  })

  test('ymd and parseYmd round trip; invalid days are null', () => {
    expect(ymd(new Date(2026, 9, 23, 23, 59))).toBe('2026-10-23')
    expect(ymd(parseYmd('2026-02-28')!)).toBe('2026-02-28')
    expect(parseYmd('2026-02-30')).toBeNull()
    expect(parseYmd('2026-13-01')).toBeNull()
    expect(parseYmd('23.10.2026')).toBeNull()
  })

  test('day arithmetic', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
    expect(startOfWeek('2026-10-23', 'sunday')).toBe('2026-10-18')
    expect(startOfWeek('2026-10-23', 'monday')).toBe('2026-10-19')
    expect(startOfWeek('2026-10-25', 'monday')).toBe('2026-10-19')
    expect(startOfWeek('2026-10-25', 'sunday')).toBe('2026-10-25')
  })

  test('monthGrid starts on week start and has 42 days', () => {
    const sun = monthGrid(2026, 10, 'sunday')
    expect(sun).toHaveLength(6)
    expect(sun.every((r) => r.length === 7)).toBe(true)
    expect(sun[0][0]).toBe('2026-09-27')
    expect(sun[5][6]).toBe('2026-11-07')
    const mon = monthGrid(2026, 10, 'monday')
    expect(mon[0][0]).toBe('2026-09-28')
    expect(mon.flat()).toHaveLength(42)
  })

  test('rangeFor each view', () => {
    expect(rangeFor('day', '2026-10-23', 'sunday').days).toEqual(['2026-10-23'])
    expect(rangeFor('rolling', '2026-10-23', 'sunday').days).toEqual(['2026-10-22', '2026-10-23', '2026-10-24'])
    const wk = rangeFor('week', '2026-10-23', 'sunday')
    expect(wk.from).toBe('2026-10-18')
    expect(wk.to).toBe('2026-10-24')
    expect(wk.days).toHaveLength(7)
    expect(rangeFor('week', '2026-10-23', 'monday')).toMatchObject({ from: '2026-10-19', to: '2026-10-25' })
    const mo = rangeFor('month', '2026-10-23', 'sunday')
    expect(mo).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    expect(mo.days).toHaveLength(31)
    expect(rangeFor('month', '2026-02-10', 'monday').days).toHaveLength(28)
  })
})

describe('todayYmd (M8)', () => {
  test('test calendar today follows the zone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T23:30:00Z'))
    try {
      useSettings.setState({ settings: { ...settingsDefaults, timeZone: 'Europe/Berlin' } })
      expect(todayYmd()).toBe('2026-10-28')
      useSettings.setState({ settings: { ...settingsDefaults, timeZone: 'America/Los_Angeles' } })
      expect(todayYmd()).toBe('2026-10-27')
      // No setting: the device's local day.
      useSettings.setState({ settings: settingsDefaults })
      expect(todayYmd()).toBe(ymd(new Date()))
    } finally {
      vi.useRealTimers()
      useSettings.setState({ settings: settingsDefaults })
    }
  })
})
