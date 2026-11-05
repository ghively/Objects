import { describe, expect, test } from 'vitest'
import { zonedWallToInstant } from '@/lib/zonedShell'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import {
  calendarConfig,
  canDragRow,
  createType,
  daysBetween,
  monthWeeks,
  periodTitle,
  placeRows,
  resolveDateProperty,
  rowDays,
  shiftDateValue,
  stepAnchor,
  weekDays,
} from './calendarModel'

const NOTE = typeDef({ id: 'note', propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' })] })
const EVENT = typeDef({
  id: 'event',
  propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' }), propertyDef({ id: 'when', type: 'datetime' }), propertyDef({ id: 'label', type: 'text' })],
})
const r = (name: string, values: Record<string, unknown>, type = 'event') => row({ summary: objectSummary({ path: `${name}.md`, type }), values })

describe('calendarModel', () => {
  test('config defaults', () => {
    expect(calendarConfig(undefined)).toEqual({ dateProperty: null, mode: 'month' })
    expect(calendarConfig({ dateProperty: 'when', mode: 'week' })).toEqual({ dateProperty: 'when', mode: 'week' })
  })

  test('the date property: saved, else the first view type\'s first date, else createdAt', () => {
    expect(resolveDateProperty({ dateProperty: null, mode: 'month' }, [EVENT])).toBe('when')
    expect(resolveDateProperty({ dateProperty: null, mode: 'month' }, [NOTE, EVENT])).toBe('createdAt')
    expect(resolveDateProperty({ dateProperty: 'lastUpdated', mode: 'month' }, [EVENT])).toBe('lastUpdated')
    // A saved key that is gone, or not a date, falls back to the default.
    expect(resolveDateProperty({ dateProperty: 'gone', mode: 'month' }, [EVENT])).toBe('when')
    expect(resolveDateProperty({ dateProperty: 'label', mode: 'month' }, [EVENT])).toBe('when')
  })

  test('a row\'s days; an end before its start is the start day', () => {
    expect(rowDays(r('a', { when: { start: '2026-11-03', resolution: 'day' } }), 'when')).toEqual({ start: '2026-11-03', end: '2026-11-03' })
    expect(rowDays(r('a', { when: { start: '2026-11-03', end: '2026-11-01', resolution: 'day' } }), 'when')).toEqual({ start: '2026-11-03', end: '2026-11-03' })
    expect(rowDays(r('a', { when: null }), 'when')).toBeNull()
    expect(rowDays(r('a', { when: { start: 'nonsense', resolution: 'day' } }), 'when')).toBeNull()
    const at = zonedWallToInstant('2026-11-03', 23, 30).toISOString()
    expect(rowDays(r('a', { when: { start: at, resolution: 'time' } }), 'when')?.start).toBe('2026-11-03')
    const c = row({ summary: objectSummary({ path: 'c.md', createdAt: zonedWallToInstant('2026-11-04', 8, 0).toISOString() }) })
    expect(rowDays(c, 'createdAt')).toEqual({ start: '2026-11-04', end: '2026-11-04' })
  })

  test('placement clips ranges to the shown days and keeps the view order', () => {
    const rows = [
      r('long', { when: { start: '2026-10-20', end: '2026-11-02', resolution: 'day' } }),
      r('in', { when: { start: '2026-11-01', resolution: 'day' } }),
      r('out', { when: { start: '2026-12-20', resolution: 'day' } }),
      r('none', {}),
    ]
    const p = placeRows(rows, 'when', '2026-11-01', '2026-11-07')
    expect(p.byDay.get('2026-11-01')?.map((x) => x.summary.path)).toEqual(['long.md', 'in.md'])
    expect(p.byDay.get('2026-11-02')?.map((x) => x.summary.path)).toEqual(['long.md'])
    expect(p.byDay.has('2026-11-03')).toBe(false)
    expect(p.undated.map((x) => x.summary.path)).toEqual(['none.md'])
    expect(p.startOf.get('long.md')).toBe('2026-10-20')
    expect(p.startOf.has('out.md')).toBe(false)
  })

  test('a huge range is walked only over the shown days', () => {
    const p = placeRows([r('x', { when: { start: '1900-01-01', end: '2900-01-01', resolution: 'day' } })], 'when', '2026-11-01', '2026-11-03')
    expect([...p.byDay.keys()]).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
  })

  test('shifting a value keeps its keys, length and resolution', () => {
    expect(shiftDateValue({ start: '2026-11-30', resolution: 'day' }, 2)).toEqual({ start: '2026-12-02', resolution: 'day' })
    expect(shiftDateValue({ start: '2026-11-30', end: '2026-12-01', resolution: 'day' }, -30)).toEqual({ start: '2026-10-31', end: '2026-11-01', resolution: 'day' })
    expect(shiftDateValue({ start: '2026-11-30', end: null, resolution: 'day' }, 1)).toEqual({ start: '2026-12-01', end: null, resolution: 'day' })
    // Across the end of daylight saving time (in zones that have it), 09:00 stays 09:00.
    const at = zonedWallToInstant('2026-10-30', 9, 0).toISOString()
    expect(shiftDateValue({ start: at, resolution: 'time' }, 3)).toEqual({ start: zonedWallToInstant('2026-11-02', 9, 0).toISOString(), resolution: 'time' })
  })

  test('days between', () => {
    expect(daysBetween('2026-11-10', '2026-11-13')).toBe(3)
    expect(daysBetween('2026-03-31', '2026-03-01')).toBe(-30)
  })

  test('only a date property of the row\'s own type is draggable', () => {
    const types = { event: EVENT, note: NOTE }
    expect(canDragRow(r('a', {}), 'when', types)).toBe(true)
    expect(canDragRow(r('a', {}, 'note'), 'when', types)).toBe(false)
    expect(canDragRow(r('a', {}), 'label', types)).toBe(false)
    expect(canDragRow(r('a', {}), 'createdAt', types)).toBe(false)
    expect(canDragRow(r('a', {}), 'lastUpdated', types)).toBe(false)
  })

  test('the type a day click creates', () => {
    expect(createType([NOTE, EVENT], 'when')?.id).toBe('event')
    expect(createType([NOTE, EVENT], 'nothing')?.id).toBe('note')
    expect(createType([], 'when')).toBeUndefined()
  })

  test('month weeks follow the week start and hold only the month\'s weeks', () => {
    const sun = monthWeeks('2026-11-17', 'sunday')
    expect(sun).toHaveLength(5)
    expect(sun[0][0]).toBe('2026-11-01')
    const mon = monthWeeks('2026-11-17', 'monday')
    expect(mon).toHaveLength(6)
    expect(mon[0][0]).toBe('2026-10-26')
    expect(mon[5][6]).toBe('2026-12-06')
    expect(weekDays('2026-11-05', 'monday')[0]).toBe('2026-11-02')
  })

  test('paging steps a month from its 1st, or a week', () => {
    expect(stepAnchor('month', '2026-01-31', 1)).toBe('2026-02-01')
    expect(stepAnchor('month', '2026-01-31', -1)).toBe('2025-12-01')
    expect(stepAnchor('week', '2026-12-30', 1)).toBe('2027-01-06')
  })

  test('period titles', () => {
    expect(periodTitle('month', '2026-11-05', 'sunday')).toBe('November 2026')
    expect(periodTitle('week', '2026-11-05', 'sunday')).toBe('Nov 1 – 7, 2026')
    expect(periodTitle('week', '2026-11-01', 'monday')).toBe('Oct 26 – Nov 1, 2026')
    expect(periodTitle('week', '2026-12-31', 'sunday')).toBe('Dec 27, 2026 – Jan 2, 2027')
  })
})
