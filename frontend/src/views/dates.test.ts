import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Filter } from '@/api/types'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import { DATE_RELATIVE_OPTIONS, dateSpan, resolveRelative, type WeekStart } from './dates'
import { matchFilter } from './filter'
import { groupRows } from './group'

describe('the Time zone setting', () => {
  // A zone other than the device's: Tokyo, or New York on a machine that is in Tokyo.
  const device = new Intl.DateTimeFormat().resolvedOptions().timeZone
  const zone = device === 'Asia/Tokyo' ? 'America/New_York' : 'Asia/Tokyo'
  const tokyo = zone === 'Asia/Tokyo'
  // 16:00Z on Wed 21 Oct 2026: 01:00 on the 22nd in Tokyo, 12:00 on the 21st in New York.
  const AT = new Date('2026-10-21T16:00:00Z')
  const midnight = tokyo ? '2026-10-21T15:00:00.000Z' : '2026-10-21T04:00:00.000Z'
  beforeEach(() => useSettings.setState({ settings: { ...settingsDefaults, timeZone: zone } }))
  afterEach(() => useSettings.setState({ settings: settingsDefaults }))

  test('relative ranges and days are the zone days', () => {
    const today = resolveRelative('today', AT)
    expect(today.start.toISOString()).toBe(midnight)
    expect(today.end.getTime() - today.start.getTime()).toBe(86400000 - 1)
    expect(dateSpan({ start: tokyo ? '2026-10-22' : '2026-10-21', resolution: 'day' })!.start.toISOString()).toBe(midnight)
  })

  test('filters and day groups read days in the zone', () => {
    const page = typeDef({ id: 'page', propertyDefinitions: [propertyDef({ id: 'due', type: 'datetime' })] })
    const ctx = { types: [page], collections: [], tagIdsToTitles: {}, now: AT }
    // One minute into the zone's today.
    const r = row({
      summary: objectSummary({ path: 'a.md', type: 'page' }),
      values: { due: { start: new Date(new Date(midnight).getTime() + 60000).toISOString(), resolution: 'time' } },
    })
    const isToday: Filter = { type: 'filter', propertyId: 'due', option: 'is', referenceValue: { relative: 'today' } }
    expect(matchFilter(r, isToday, ctx)).toBe(true)
    const { groups } = groupRows([r], { groups: [{ propertyId: 'due', option: 'day' }] }, undefined, ctx)
    expect(groups.map((g) => g.label)).toEqual([tokyo ? 'Oct 22, 2026' : 'Oct 21, 2026'])
    const rel = groupRows([r], { groups: [{ propertyId: 'due', option: 'relative' }] }, undefined, ctx)
    expect(rel.groups.map((g) => g.label)).toEqual(['Today'])
  })
})

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

  test('this week follows the week start: Monday by default, Sunday when the setting says so', () => {
    const sunday = new Date(2026, 9, 25, 9)
    const span = (ws?: WeekStart) => {
      const { start, end } = resolveRelative('thisWeek', sunday, ws)
      return `${ymd(start)}..${ymd(end)}`
    }
    expect(span()).toBe('2026-10-19..2026-10-25')
    expect(span('monday')).toBe('2026-10-19..2026-10-25')
    expect(span('sunday')).toBe('2026-10-25..2026-10-31')
    // A Sunday-start week seen from its Saturday starts on the Sunday before.
    const saturday = new Date(2026, 9, 31, 9)
    expect(ymd(resolveRelative('thisWeek', saturday, 'sunday').start)).toBe('2026-10-25')
    expect(ymd(resolveRelative('thisWeek', saturday, 'monday').start)).toBe('2026-10-26')
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
