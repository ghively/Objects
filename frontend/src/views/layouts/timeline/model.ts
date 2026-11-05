// M13: the timeline layout's pure parts: its settings with their defaults, the time axis (scale,
// range, header cells), where each row's bar sits, and what a drag writes. Days are `YYYY-MM-DD`
// texts or day numbers (days since 1970-01-01, UTC arithmetic, so DST never moves a day).
import type { DataViewDefinition, DateValue, EntityRef, PropertyType, Row, TimelineViewConfig, TimelineZoom, TypeDef } from '@/api/types'
import { addDays, isDay } from '@/calendar/dates'
import { fromWallClock, wallClock } from '@/lib/zonedTime'
import { dayOfInstant } from '../../dates'
import { findDef, rowValue } from '../../filter'
import { propertyChoices, type PropChoice } from '../../properties'

export const DEFAULT_TIMELINE: TimelineViewConfig = {
  startProperty: null,
  endProperty: null,
  zoom: 'week',
  showTable: true,
  tableColumns: [],
  showDependencies: true,
}

const ZOOMS: readonly TimelineZoom[] = ['day', 'week', 'month', 'quarter', 'year']

/** The stored settings over the defaults (a missing or malformed field takes its default). */
export function timelineConfig(def: DataViewDefinition): TimelineViewConfig {
  const c: Partial<TimelineViewConfig> = def.timelineConfig ?? {}
  return {
    startProperty: typeof c.startProperty === 'string' ? c.startProperty : null,
    endProperty: typeof c.endProperty === 'string' ? c.endProperty : null,
    zoom: c.zoom && ZOOMS.includes(c.zoom) ? c.zoom : DEFAULT_TIMELINE.zoom,
    showTable: typeof c.showTable === 'boolean' ? c.showTable : true,
    tableColumns: Array.isArray(c.tableColumns) ? c.tableColumns.filter((k): k is string => typeof k === 'string') : [],
    showDependencies: typeof c.showDependencies === 'boolean' ? c.showDependencies : true,
  }
}

export const DATE_KINDS: ReadonlySet<PropertyType> = new Set<PropertyType>(['datetime', 'datetimeSimple', 'entity_createdAt', 'entity_lastUpdated'])
/** Date kinds a drag can write (Created and Last modified are the app's). */
export const WRITABLE_DATE_KINDS: ReadonlySet<PropertyType> = new Set<PropertyType>(['datetime', 'datetimeSimple'])

/** The view's date properties (its own first, then Created and Last modified). */
export function dateChoices(types: TypeDef[]): PropChoice[] {
  return propertyChoices(types).filter((c) => DATE_KINDS.has(c.kind))
}

/** The start property: the stored one when the view still has it, else the first own date property, else Created. */
export function resolveStart(config: TimelineViewConfig, types: TypeDef[]): string {
  const choices = dateChoices(types)
  if (config.startProperty && choices.some((c) => c.key === config.startProperty)) return config.startProperty
  return choices.find((c) => WRITABLE_DATE_KINDS.has(c.kind))?.key ?? 'createdAt'
}

/** The end property, when the stored one is still a date property of the view (and isn't the start). */
export function resolveEnd(config: TimelineViewConfig, types: TypeDef[], start: string): string | null {
  const key = config.endProperty
  return key && key !== start && dateChoices(types).some((c) => c.key === key) ? key : null
}

// -- days -----------------------------------------------------------------------------------

const MS_DAY = 86_400_000

/** `YYYY-MM-DD` -> its day number. */
export function dayNum(day: string): number {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY)
}

/** A day number -> `YYYY-MM-DD`. */
export function dayText(n: number): string {
  const d = new Date(n * MS_DAY)
  const pad = (x: number, w = 2) => String(x).padStart(w, '0')
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** A row's value for a date key as a date value (Created and Last modified are instants). */
export function dateValueOf(row: Row, key: string): DateValue | null {
  const v = key in row.values ? row.values[key] : rowValue(row, key)
  if (typeof v === 'string' && v) return { start: v, resolution: 'time' }
  if (v && typeof v === 'object' && typeof (v as DateValue).start === 'string' && (v as DateValue).start) return v as DateValue
  return null
}

/** The day (`YYYY-MM-DD`) of a point of a date value. */
function dayOfPoint(point: string | null | undefined, resolution: DateValue['resolution'], dayOf: (iso: string) => string | null): string | null {
  if (!point) return null
  if (resolution !== 'time') return isDay(point.slice(0, 10)) ? point.slice(0, 10) : null
  return dayOf(point)
}

export interface BarSpan {
  /** First and last day (inclusive), as day numbers. */
  start: number
  end: number
}

/**
 * Where a row's bar sits: its start property's day to its end (the end property's day, else the
 * start's own range end, else the same day). An end before the start draws one day. Null without a start.
 */
export function barSpan(row: Row, startKey: string, endKey: string | null, dayOf: (iso: string) => string | null = dayOfInstant): BarSpan | null {
  const sv = dateValueOf(row, startKey)
  const startDay = sv ? dayOfPoint(sv.start, sv.resolution, dayOf) : null
  if (!sv || !startDay) return null
  let endDay: string | null
  if (endKey) {
    const ev = dateValueOf(row, endKey)
    endDay = ev ? (dayOfPoint(ev.end, ev.resolution, dayOf) ?? dayOfPoint(ev.start, ev.resolution, dayOf)) : null
  } else {
    endDay = dayOfPoint(sv.end, sv.resolution, dayOf)
  }
  const start = dayNum(startDay)
  const end = endDay ? dayNum(endDay) : start
  return { start, end: Math.max(start, end) }
}

// -- the axis -------------------------------------------------------------------------------

/** Pixels per day at each zoom (our choice): `day` is one wide column a day, `year` one narrow column a month. */
export const DAY_PX: Record<TimelineZoom, number> = { day: 44, week: 18, month: 6, quarter: 2.5, year: 1.2 }

type Unit = 'day' | 'week' | 'month' | 'quarter' | 'year'

/** The header's two rows at each zoom: [top, bottom] (our choice). */
export const HEADER_UNITS: Record<TimelineZoom, [Unit, Unit]> = {
  day: ['month', 'day'],
  week: ['month', 'week'],
  month: ['year', 'month'],
  quarter: ['year', 'quarter'],
  year: ['year', 'month'],
}

/** Days added on each side of the items (our choice). */
const PAD_DAYS: Record<TimelineZoom, number> = { day: 14, week: 28, month: 92, quarter: 183, year: 366 }
/** The least width of the axis, in px. */
const MIN_AXIS_PX = 1200

const parts = (n: number) => {
  const d = new Date(n * MS_DAY)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() }
}
const fromYmd = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / MS_DAY)

/** The first day of the unit that holds day `n` (weeks start on Monday). */
export function unitStart(unit: Unit, n: number): number {
  const p = parts(n)
  switch (unit) {
    case 'day':
      return n
    case 'week':
      return n - ((p.wd + 6) % 7)
    case 'month':
      return fromYmd(p.y, p.m, 1)
    case 'quarter':
      return fromYmd(p.y, p.m - (p.m % 3), 1)
    case 'year':
      return fromYmd(p.y, 0, 1)
  }
}

/** The first day of the next unit after the one starting at `n`. */
function nextUnit(unit: Unit, n: number): number {
  const p = parts(n)
  switch (unit) {
    case 'day':
      return n + 1
    case 'week':
      return n + 7
    case 'month':
      return fromYmd(p.y, p.m + 1, 1)
    case 'quarter':
      return fromYmd(p.y, p.m + 3, 1)
    case 'year':
      return fromYmd(p.y + 1, 0, 1)
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A header cell's label (our strings). */
function unitLabel(unit: Unit, n: number, zoom: TimelineZoom, top: boolean): string {
  const p = parts(n)
  switch (unit) {
    case 'day':
      return String(p.d)
    case 'week':
      return `${MONTHS[p.m]} ${p.d}`
    case 'month':
      if (top) return `${MONTHS[p.m]} ${p.y}`
      return zoom === 'year' ? MONTHS[p.m].charAt(0) : MONTHS[p.m]
    case 'quarter':
      return `Q${Math.floor(p.m / 3) + 1}`
    case 'year':
      return String(p.y)
  }
}

export interface HeaderCell {
  key: string
  label: string
  /** px from the axis start */
  left: number
  width: number
}

export interface Axis {
  zoom: TimelineZoom
  /** Day number at x = 0. */
  start: number
  /** Day number just past the end. */
  end: number
  px: number
  width: number
  top: HeaderCell[]
  bottom: HeaderCell[]
}

/** The axis around the bars (and today), padded and snapped to the header's top unit. */
export function buildAxis(zoom: TimelineZoom, spans: Iterable<BarSpan>, today: number): Axis {
  let lo = today
  let hi = today
  for (const s of spans) {
    if (s.start < lo) lo = s.start
    if (s.end > hi) hi = s.end
  }
  const px = DAY_PX[zoom]
  const [topUnit, bottomUnit] = HEADER_UNITS[zoom]
  const start = unitStart(topUnit, lo - PAD_DAYS[zoom])
  let end = hi + 1 + PAD_DAYS[zoom]
  end = Math.max(end, start + Math.ceil(MIN_AXIS_PX / px))
  const snapped = unitStart(topUnit, end)
  end = snapped === end ? end : nextUnit(topUnit, snapped)
  const cells = (unit: Unit, top: boolean): HeaderCell[] => {
    const out: HeaderCell[] = []
    for (let n = unitStart(unit, start); n < end; ) {
      const next = nextUnit(unit, n)
      const from = Math.max(n, start)
      out.push({ key: `${unit}${n}`, label: unitLabel(unit, n, zoom, top), left: (from - start) * px, width: (Math.min(next, end) - from) * px })
      n = next
    }
    return out
  }
  return { zoom, start, end, px, width: (end - start) * px, top: cells(topUnit, true), bottom: cells(bottomUnit, false) }
}

/** The day number under x (px from the axis start). */
export const dayAt = (axis: Axis, x: number): number => axis.start + Math.floor(x / axis.px)

// -- writes ---------------------------------------------------------------------------------

export type DragMode = 'move' | 'start' | 'end'

/** The bar after a drag of `delta` days (an edge never passes the other one). */
export function dragSpan(span: BarSpan, mode: DragMode, delta: number): BarSpan {
  switch (mode) {
    case 'move':
      return { start: span.start + delta, end: span.end + delta }
    case 'start':
      return { start: Math.min(span.start + delta, span.end), end: span.end }
    case 'end':
      return { start: span.start, end: Math.max(span.end + delta, span.start) }
  }
}

/** A date value's point moved by `days` days: a day stays a day, a time keeps its time of day. */
export function shiftPoint(point: string, resolution: DateValue['resolution'], days: number): string {
  if (days === 0) return point
  if (resolution !== 'time') return addDays(point.slice(0, 10), days)
  const d = new Date(point)
  if (Number.isNaN(d.getTime())) return point
  const w = wallClock(d)
  w.setDate(w.getDate() + days)
  return fromWallClock(w).toISOString()
}

const sameValue = (a: DateValue | null, b: DateValue) => !!a && a.start === b.start && (a.end ?? null) === (b.end ?? null) && a.resolution === b.resolution

/**
 * The property values a drag from `from` to `to` writes (only the keys that change). Without an
 * end property, the start property's own range carries the end: a one-day result drops it.
 */
export function dragUpdates(row: Row, startKey: string, endKey: string | null, from: BarSpan, to: BarSpan): Record<string, DateValue> {
  const out: Record<string, DateValue> = {}
  const sv = dateValueOf(row, startKey)
  if (!sv) return out
  const dStart = to.start - from.start
  const dEnd = to.end - from.end
  const res = sv.resolution === 'time' ? 'time' : 'day'
  if (!endKey) {
    const start = shiftPoint(sv.start, res, dStart)
    // The end: the value's own end moved, or (a one-day bar made longer) a new one.
    let end: string | null = null
    if (to.end !== to.start) end = sv.end ? shiftPoint(sv.end, res, dEnd) : res === 'time' ? shiftPoint(sv.start, res, to.end - from.start) : dayText(to.end)
    const next: DateValue = { start, ...(end ? { end } : {}), resolution: sv.resolution }
    if (!sameValue(sv, next)) out[startKey] = next
    return out
  }
  if (dStart !== 0) {
    const next: DateValue = {
      start: shiftPoint(sv.start, res, dStart),
      ...(sv.end ? { end: shiftPoint(sv.end, res, dStart) } : {}),
      resolution: sv.resolution,
    }
    out[startKey] = next
  }
  if (dEnd !== 0) {
    const ev = dateValueOf(row, endKey)
    if (ev) {
      const eres = ev.resolution === 'time' ? 'time' : 'day'
      out[endKey] = {
        start: shiftPoint(ev.start, eres, dEnd),
        ...(ev.end ? { end: shiftPoint(ev.end, eres, dEnd) } : {}),
        resolution: ev.resolution,
      }
    } else {
      // No end value yet (the bar ended on its start day): the new end day.
      out[endKey] = { start: dayText(to.end), resolution: 'day' }
    }
  }
  return out
}

/** Whether a drag can write `key` on this row (a date property of its own type, and the file isn't read-only). */
export function canWriteDate(row: Row, key: string, types: TypeDef[]): boolean {
  if (row.summary.readOnly) return false
  const def = findDef(types, key, row.summary.type)
  return !!def && WRITABLE_DATE_KINDS.has(def.type)
}

// -- dependencies ---------------------------------------------------------------------------

/** A relation value as references with their resolved paths (what a write sends back). */
export function relationRefs(row: Row, key: string): EntityRef[] {
  const raw = row.values[key]
  const list = Array.isArray(raw) ? (raw as EntityRef[]) : []
  const links = row.links?.[key] ?? []
  return list.map((r, i) => ({ target: typeof r?.target === 'string' ? r.target : '', path: links[i] ?? r?.path ?? null })).filter((r) => r.target || r.path)
}

/** The paths a row's relation links to (resolved only). */
export function linkedPaths(row: Row, key: string): string[] {
  return (row.links?.[key] ?? []).filter((p): p is string => !!p)
}

/** `target`'s "Blocked by" with `source` added, or null when it is there already (or is itself). */
export function addBlocker(target: Row, source: Row, blockedByKey: string): EntityRef[] | null {
  if (target.summary.path === source.summary.path) return null
  if (linkedPaths(target, blockedByKey).includes(source.summary.path)) return null
  return [...relationRefs(target, blockedByKey), { target: source.summary.title, path: source.summary.path }]
}
