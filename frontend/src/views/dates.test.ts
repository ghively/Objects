import { describe, expect, test } from 'vitest'
import { DATE_RELATIVE_OPTIONS, dateSpan, resolveRelative } from './dates'

const now = new Date(2026, 9, 23, 12, 0) // Friday

const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

describe('dates', () => {
  test('relative option order and labels', () => {
    expect(DATE_RELATIVE_OPTIONS.map((o) => o.label)).toEqual([
      'overdue', 'today', 'yesterday', 'tomorrow', 'this week', 'this month', 'this year',
      'one week ago', 'in one week', 'one month ago', 'in one month', 'Specific date',
    ])
  })

  test('resolveRelative ranges', () => {
    const r = (k: Parameters<typeof resolveRelative>[0]) => {
      const { start, end } = resolveRelative(k, now)
      return `${ymd(start)}..${ymd(end)}`
    }
    expect(r('today')).toBe('2026-10-23..2026-10-23')
    expect(r('yesterday')).toBe('2026-10-22..2026-10-22')
    expect(r('tomorrow')).toBe('2026-10-24..2026-10-24')
    expect(r('thisWeek')).toBe('2026-10-19..2026-10-25')
    expect(r('thisMonth')).toBe('2026-10-1..2026-10-31')
    expect(r('thisYear')).toBe('2026-1-1..2026-12-31')
    expect(r('oneWeekAgo')).toBe('2026-10-16..2026-10-16')
    expect(r('inOneWeek')).toBe('2026-10-30..2026-10-30')
    expect(r('oneMonthAgo')).toBe('2026-9-23..2026-9-23')
    expect(r('inOneMonth')).toBe('2026-11-23..2026-11-23')
    expect(resolveRelative('overdue', now).end.getDate()).toBe(22)
  })

  test('week starts on Monday even when now is a Sunday', () => {
    const sunday = new Date(2026, 9, 25, 9)
    expect(ymd(resolveRelative('thisWeek', sunday).start)).toBe('2026-10-19')
  })

  test('month arithmetic clamps the day', () => {
    const end = new Date(2026, 2, 31, 8)
    expect(ymd(resolveRelative('oneMonthAgo', end).start)).toBe('2026-2-28')
  })

  test('dateSpan reads days and times', () => {
    expect(dateSpan(null)).toBeNull()
    expect(dateSpan({ start: '', resolution: 'day' })).toBeNull()
    const d = dateSpan({ start: '2026-10-30', end: '2026-11-02', resolution: 'day' })!
    expect(ymd(d.start)).toBe('2026-10-30')
    expect(ymd(d.end!)).toBe('2026-11-2')
    expect(dateSpan({ start: '2026-10-30T14:00:00.000Z', resolution: 'time' })!.end).toBeNull()
  })
})
