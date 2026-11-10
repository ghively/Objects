import { afterEach, describe, expect, test } from 'vitest'
import type { Row } from '@/api/types'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import {
  addBlocker,
  AXIS_YEARS,
  axisWindow,
  barSpan,
  buildAxis,
  canWriteDate,
  DAY_PX,
  dayAt,
  dayNum,
  dayText,
  dragSpan,
  dragUpdates,
  resolveEnd,
  resolveStart,
  shiftPoint,
  timelineConfig,
  unitStart,
} from './model'

const TYPE = typeDef({
  id: 'story',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({ id: 'createdAt', type: 'entity_createdAt', name: 'Creation date' }),
    propertyDef({ id: 'due', type: 'datetime', name: 'Due' }),
    propertyDef({ id: 'finish', type: 'datetime', name: 'Finish' }),
    propertyDef({ id: 'blockedBy', type: 'entity', name: 'Blocked by' }),
  ],
})

const mk = (values: Record<string, unknown>, extra: Partial<Row> = {}): Row =>
  row({ summary: objectSummary({ path: 'Stories/A.md', type: 'story', title: 'A' }), values, ...extra })
const day = (s: string) => dayNum(s)
const utcDay = (iso: string) => iso.slice(0, 10)

describe('timeline settings', () => {
  test('missing or malformed fields take the defaults', () => {
    expect(timelineConfig({ dataViewLayout: 'timeline' })).toEqual({
      startProperty: null,
      endProperty: null,
      zoom: 'week',
      showTable: true,
      tableColumns: [],
      showDependencies: true,
    })
    const bad = timelineConfig({ dataViewLayout: 'timeline', timelineConfig: { zoom: 'decade', tableColumns: [1, 'due'] } as never })
    expect(bad.zoom).toBe('week')
    expect(bad.tableColumns).toEqual(['due'])
  })

  test('the start is the first own date property, else Created; a gone property falls back', () => {
    const c = timelineConfig({ dataViewLayout: 'timeline' })
    expect(resolveStart(c, [TYPE])).toBe('due')
    expect(resolveStart({ ...c, startProperty: 'finish' }, [TYPE])).toBe('finish')
    expect(resolveStart({ ...c, startProperty: 'gone' }, [TYPE])).toBe('due')
    const plain = typeDef({ id: 'p', propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' })] })
    expect(resolveStart(c, [plain])).toBe('createdAt')
    expect(resolveEnd({ ...c, endProperty: 'finish' }, [TYPE], 'due')).toBe('finish')
    expect(resolveEnd({ ...c, endProperty: 'due' }, [TYPE], 'due')).toBeNull()
  })
})

describe('bars', () => {
  test('a day, a range, an end property and an end before the start', () => {
    expect(barSpan(mk({ due: { start: '2026-11-03', resolution: 'day' } }), 'due', null)).toEqual({ start: day('2026-11-03'), end: day('2026-11-03') })
    expect(barSpan(mk({ due: { start: '2026-11-03', end: '2026-11-06', resolution: 'day' } }), 'due', null)).toEqual({
      start: day('2026-11-03'),
      end: day('2026-11-06'),
    })
    const both = mk({ due: { start: '2026-11-03', resolution: 'day' }, finish: { start: '2026-11-10', resolution: 'day' } })
    expect(barSpan(both, 'due', 'finish')).toEqual({ start: day('2026-11-03'), end: day('2026-11-10') })
    // The end property empty: the same day (its own range end is ignored then).
    expect(barSpan(mk({ due: { start: '2026-11-03', end: '2026-11-04', resolution: 'day' } }), 'due', 'finish')).toEqual({
      start: day('2026-11-03'),
      end: day('2026-11-03'),
    })
    const backwards = mk({ due: { start: '2026-11-03', resolution: 'day' }, finish: { start: '2026-11-01', resolution: 'day' } })
    expect(barSpan(backwards, 'due', 'finish')).toEqual({ start: day('2026-11-03'), end: day('2026-11-03') })
    expect(barSpan(mk({}), 'due', null)).toBeNull()
  })

  test('Created comes from the summary', () => {
    const r = row({ summary: objectSummary({ path: 'Stories/A.md', type: 'story', createdAt: '2026-11-02T10:00:00.000Z' }) })
    expect(barSpan(r, 'createdAt', null, utcDay)).toEqual({ start: day('2026-11-02'), end: day('2026-11-02') })
    expect(canWriteDate(r, 'createdAt', [TYPE])).toBe(false)
    expect(canWriteDate(r, 'due', [TYPE])).toBe(true)
    expect(canWriteDate({ ...r, summary: { ...r.summary, readOnly: true } }, 'due', [TYPE])).toBe(false)
  })

  test("a synced date can't be written by a drag (M29 review #7)", () => {
    const host = typeDef({ id: 'host', propertyDefinitions: [propertyDef({ id: 'lastBoot', type: 'datetime', synced: { source: 'Inventory script', staleAfterDays: 7 } })] })
    const r = row({ summary: objectSummary({ path: 'Hosts/APP01.md', type: 'host' }) })
    expect(canWriteDate(r, 'lastBoot', [host])).toBe(false)
  })
})

describe('the axis', () => {
  test('day numbers round-trip', () => {
    expect(dayText(dayNum('2026-03-29'))).toBe('2026-03-29')
    expect(dayNum('1970-01-02')).toBe(1)
  })

  test('each zoom has its scale and header units', () => {
    const today = day('2026-11-05')
    const span = [{ start: day('2026-11-02'), end: day('2026-11-20') }]
    const dayZoom = buildAxis('day', span, today)
    expect(dayZoom.px).toBe(DAY_PX.day)
    // Snapped to a month (the top row), each bottom cell one day wide.
    expect(dayText(dayZoom.start)).toBe('2026-10-01')
    expect(dayZoom.bottom.every((c) => c.width === DAY_PX.day)).toBe(true)
    expect(dayZoom.top[0].label).toBe('Oct 2026')
    const year = buildAxis('year', span, today)
    expect(dayText(year.start)).toBe('2025-01-01')
    // Months as narrow columns.
    expect(year.bottom[0].label).toBe('J')
    expect(year.bottom[0].width).toBeCloseTo(31 * DAY_PX.year)
    const week = buildAxis('week', span, today)
    expect(week.bottom[1].width).toBe(7 * DAY_PX.week)
    expect(dayText(unitStart('week', day('2026-11-05')))).toBe('2026-11-02') // a Monday
    expect(buildAxis('quarter', span, today).bottom.some((c) => c.label === 'Q4')).toBe(true)
    // Widths add up to the axis; x maps back to days.
    expect(week.bottom.reduce((n, c) => n + c.width, 0)).toBeCloseTo(week.width)
    expect(dayAt(week, (today - week.start) * week.px + 1)).toBe(today)
  })

  test('an item far from today widens the axis to hold both', () => {
    const axis = buildAxis('month', [{ start: day('2024-02-10'), end: day('2024-02-12') }], day('2026-11-05'))
    expect(axis.start).toBeLessThanOrEqual(day('2024-02-10'))
    expect(axis.end).toBeGreaterThan(day('2026-11-05'))
  })
})

describe('the axis window', () => {
  test('a typo date far away does not stretch the axis; it is outside the window', () => {
    const today = day('2026-11-05')
    const near = [{ start: day('2026-11-02'), end: day('2026-11-20') }, { start: day('2026-12-01'), end: day('2026-12-03') }]
    const typos = [{ start: day('0202-11-03'), end: day('0202-11-03') }, { start: day('2026-11-03'), end: dayNum('9999-11-03') }]
    const axis = buildAxis('day', [...near, ...typos], today)
    expect(axis.width).toBeLessThan(2 * (AXIS_YEARS + 1) * 366 * DAY_PX.day)
    expect(axis.start).toBeGreaterThan(day('2015-01-01'))
    expect(axis.end).toBeLessThan(day('2038-01-01'))
    const w = axisWindow([...near, ...typos], today)
    expect(near.every((s) => s.start >= w.lo && s.end <= w.hi)).toBe(true)
    expect(typos.some((s) => s.start >= w.lo && s.end <= w.hi)).toBe(false)
  })

  test('items years from today keep their own window (around their middle)', () => {
    const old = [{ start: day('1990-03-01'), end: day('1990-03-05') }, { start: day('1991-06-01'), end: day('1991-06-02') }]
    const axis = buildAxis('month', old, day('2026-11-05'))
    expect(axis.start).toBeLessThanOrEqual(old[0].start)
    expect(axis.end).toBeGreaterThan(old[1].end)
    expect(axis.end).toBeLessThan(day('2003-01-01'))
  })
})

describe('drags', () => {
  const s = { start: day('2026-11-03'), end: day('2026-11-06') }
  test('move, start edge, end edge; an edge never passes the other', () => {
    expect(dragSpan(s, 'move', 2)).toEqual({ start: s.start + 2, end: s.end + 2 })
    expect(dragSpan(s, 'start', -1)).toEqual({ start: s.start - 1, end: s.end })
    expect(dragSpan(s, 'start', 9)).toEqual({ start: s.end, end: s.end })
    expect(dragSpan(s, 'end', -9)).toEqual({ start: s.start, end: s.start })
  })

  test('the start property alone: moving a range moves both of its ends', () => {
    const r = mk({ due: { start: '2026-11-03', end: '2026-11-06', resolution: 'day' } })
    expect(dragUpdates(r, 'due', null, s, dragSpan(s, 'move', 2))).toEqual({ due: { start: '2026-11-05', end: '2026-11-08', resolution: 'day' } })
    // Shrunk to one day: the range's end goes.
    expect(dragUpdates(r, 'due', null, s, dragSpan(s, 'end', -3))).toEqual({ due: { start: '2026-11-03', resolution: 'day' } })
  })

  test('a one-day value made longer becomes a range', () => {
    const one = { start: day('2026-11-03'), end: day('2026-11-03') }
    const r = mk({ due: { start: '2026-11-03', resolution: 'day' } })
    expect(dragUpdates(r, 'due', null, one, dragSpan(one, 'end', 2))).toEqual({ due: { start: '2026-11-03', end: '2026-11-05', resolution: 'day' } })
    expect(dragUpdates(r, 'due', null, one, one)).toEqual({})
  })

  test('with an end property each edge writes only its own property', () => {
    const r = mk({ due: { start: '2026-11-03', resolution: 'day' }, finish: { start: '2026-11-06', resolution: 'day' } })
    expect(dragUpdates(r, 'due', 'finish', s, dragSpan(s, 'end', 1))).toEqual({ finish: { start: '2026-11-07', resolution: 'day' } })
    expect(dragUpdates(r, 'due', 'finish', s, dragSpan(s, 'start', -2))).toEqual({ due: { start: '2026-11-01', resolution: 'day' } })
    expect(Object.keys(dragUpdates(r, 'due', 'finish', s, dragSpan(s, 'move', 1))).sort()).toEqual(['due', 'finish'])
    // No end value yet: the new end day.
    const noEnd = mk({ due: { start: '2026-11-03', resolution: 'day' } })
    const one = { start: s.start, end: s.start }
    expect(dragUpdates(noEnd, 'due', 'finish', one, dragSpan(one, 'end', 1))).toEqual({ finish: { start: '2026-11-04', resolution: 'day' } })
  })

  test('the start property alone: a time range within one day keeps its end time', () => {
    const r = mk({ due: { start: '2026-11-05T09:00:00.000Z', end: '2026-11-05T17:00:00.000Z', resolution: 'time' } })
    const one = { start: day('2026-11-05'), end: day('2026-11-05') }
    const out = dragUpdates(r, 'due', null, one, dragSpan(one, 'move', 2))
    expect(out.due.end).toBeDefined()
    expect(new Date(out.due.end as string).getTime() - new Date(out.due.start).getTime()).toBe(8 * 3_600_000)
    expect(out.due.start.slice(0, 10)).toBe('2026-11-07')
  })

  test('the start property alone: a multi-day time range shrunk to one day keeps its end time', () => {
    const r = mk({ due: { start: '2026-11-05T09:00:00.000Z', end: '2026-11-07T17:00:00.000Z', resolution: 'time' } })
    const span = { start: day('2026-11-05'), end: day('2026-11-07') }
    const out = dragUpdates(r, 'due', null, span, dragSpan(span, 'end', -2))
    expect(out.due.start).toBe('2026-11-05T09:00:00.000Z')
    expect(out.due.end).toBeDefined()
    expect(new Date(out.due.end as string).getTime() - new Date(out.due.start).getTime()).toBe(8 * 3_600_000)
    // A day range whose end falls on its start day still drops the end.
    const dr = mk({ due: { start: '2026-11-05', end: '2026-11-07', resolution: 'day' } })
    expect(dragUpdates(dr, 'due', null, span, dragSpan(span, 'end', -2))).toEqual({ due: { start: '2026-11-05', resolution: 'day' } })
  })

  test('with an end property, a move or start-edge drag never creates an end value', () => {
    const r = mk({ due: { start: '2026-11-03', resolution: 'day' } })
    const one = { start: day('2026-11-03'), end: day('2026-11-03') }
    expect(dragUpdates(r, 'due', 'finish', one, dragSpan(one, 'move', 2))).toEqual({ due: { start: '2026-11-05', resolution: 'day' } })
    expect(dragUpdates(r, 'due', 'finish', one, dragSpan(one, 'start', -2))).toEqual({ due: { start: '2026-11-01', resolution: 'day' } })
    // An end-edge drag still creates it.
    expect(dragUpdates(r, 'due', 'finish', one, dragSpan(one, 'end', 1))).toEqual({ finish: { start: '2026-11-04', resolution: 'day' } })
  })

  describe('in the time-zone setting', () => {
    const tz = process.env.TZ
    afterEach(() => {
      process.env.TZ = tz
      useSettings.setState({ settings: { ...settingsDefaults } })
    })
    test("a time moves by days in the app's zone, not the browser's (a browser DST gap moves nothing)", () => {
      // The browser in New York (clocks spring forward 2026-03-08 02:00), the app set to UTC.
      process.env.TZ = 'America/New_York'
      useSettings.setState({ settings: { ...settingsDefaults, timeZone: 'UTC' } })
      expect(shiftPoint('2026-03-07T02:30:00.000Z', 'time', 1)).toBe('2026-03-08T02:30:00.000Z')
      // And across the app zone's own DST change, the wall-clock time stays.
      useSettings.setState({ settings: { ...settingsDefaults, timeZone: 'Europe/Berlin' } })
      process.env.TZ = 'UTC'
      // 09:00 in Berlin on 2026-03-28 (UTC+1) -> 09:00 on 2026-03-30 (UTC+2).
      expect(shiftPoint('2026-03-28T08:00:00.000Z', 'time', 2)).toBe('2026-03-30T07:00:00.000Z')
    })
  })

  test('a time keeps its time of day', () => {
    const t = '2026-11-03T14:30:00.000Z'
    const moved = new Date(shiftPoint(t, 'time', 3))
    const before = new Date(t)
    expect(moved.getUTCHours() * 60 + moved.getUTCMinutes()).toBeGreaterThanOrEqual(0)
    // Three calendar days on in the zone, at the same wall-clock time (24 h apart each, DST aside).
    expect(Math.round((moved.getTime() - before.getTime()) / 3_600_000)).toBeGreaterThanOrEqual(71)
    expect(Math.round((moved.getTime() - before.getTime()) / 3_600_000)).toBeLessThanOrEqual(73)
    expect(shiftPoint('2026-11-03', 'day', -3)).toBe('2026-10-31')
  })
})

describe('dependencies', () => {
  test('adds the source once, keeping the other links', () => {
    const target = row({
      summary: objectSummary({ path: 'Stories/B.md', type: 'story', title: 'B' }),
      values: { blockedBy: [{ target: 'C', path: null }] },
      links: { blockedBy: ['Stories/C.md'] },
    })
    const source = row({ summary: objectSummary({ path: 'Stories/A.md', type: 'story', title: 'A' }) })
    expect(addBlocker(target, source, 'blockedBy')).toEqual([
      { target: 'C', path: 'Stories/C.md' },
      { target: 'A', path: 'Stories/A.md' },
    ])
    expect(addBlocker({ ...target, links: { blockedBy: ['Stories/A.md'] } }, source, 'blockedBy')).toBeNull()
    expect(addBlocker(source, source, 'blockedBy')).toBeNull()
  })
})
