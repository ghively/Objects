// Column calculations (the table footer): the kinds each property kind offers, with their
// labels, and the calculation itself over a set of rows.
import type { CalcKind, DateValue, EntityRef, PropertyType, Row } from '@/api/types'
import {
  asComputed,
  computedDateResolution,
  computedIsEmpty,
  computedList,
  computedNumberFormat,
  computedText,
} from '@/properties/computed'
import { filePaths } from '@/properties/files'
import { formatDate, formatNumber } from '@/properties/format'
import { wallClock } from '@/lib/zonedTime'
import { dateSpan } from './dates'
import { displayTitle, findDef, rowValue, type FilterCtx } from './filter'

const COMMON: CalcKind[] = ['countAll', 'countValues', 'countUnique', 'countEmpty', 'countNotEmpty', 'percentEmpty', 'percentNotEmpty']

const DATE_KINDS = new Set<PropertyType>(['datetime', 'datetimeSimple', 'entity_createdAt', 'entity_lastUpdated'])
const VALUE_KINDS = new Set<PropertyType>([
  'text',
  'url',
  'entity',
  'label',
  'entity_title',
  'entity_description',
  'entity_tags',
  'entity_collections',
  'entity_aliases',
  'entity_type',
  // M12
  'uniqueId',
  'email',
  'phone',
  'files',
])
const NUMBER_CALCS: CalcKind[] = ['sum', 'average', 'median', 'min', 'max', 'range']
const DATE_CALCS: CalcKind[] = ['earliestDate', 'latestDate', 'dateRange']

/** The calculations a property kind offers, in menu order. Blocks get none. */
export function CALC_KINDS(kind: PropertyType): CalcKind[] {
  if (kind === 'blocks') return []
  if (kind === 'number') return [...COMMON, ...NUMBER_CALCS]
  if (DATE_KINDS.has(kind)) return [...COMMON, ...DATE_CALCS]
  // M12: a formula's or rollup's result type is known per row: the number calculations use its
  // number values and the date ones its date values.
  if (kind === 'formula' || kind === 'rollup') return [...COMMON, ...NUMBER_CALCS, ...DATE_CALCS]
  if (kind === 'boolean') return ['countAll', 'checked', 'unchecked', 'percentChecked', 'percentUnchecked']
  if (VALUE_KINDS.has(kind)) return COMMON
  return ['countAll']
}

export const CALC_LABELS: { full: Record<string, string>; short: Record<string, string> } = {
  full: {
    countAll: 'Count all',
    countValues: 'Count values',
    countUnique: 'Count unique values',
    countEmpty: 'Count empty',
    countNotEmpty: 'Count not empty',
    percentEmpty: 'Percent empty',
    percentNotEmpty: 'Percent not empty',
    checked: 'Checked',
    unchecked: 'Unchecked',
    percentChecked: 'Percent checked',
    percentUnchecked: 'Percent unchecked',
    earliestDate: 'Earliest date',
    latestDate: 'Latest date',
    dateRange: 'Date range',
    sum: 'Sum',
    average: 'Average',
    median: 'Median',
    min: 'Min',
    max: 'Max',
    range: 'Range',
  },
  short: {
    countAll: 'Count',
    countValues: 'Values',
    countUnique: 'Unique',
    countEmpty: 'Empty',
    countNotEmpty: 'Not empty',
    percentEmpty: 'Empty',
    percentNotEmpty: 'Not empty',
    checked: 'Checked',
    unchecked: 'Unchecked',
    percentChecked: 'Checked',
    percentUnchecked: 'Unchecked',
    earliestDate: 'Earliest',
    latestDate: 'Latest',
    dateRange: 'Range',
    sum: 'Sum',
    average: 'Average',
    median: 'Median',
    min: 'Min',
    max: 'Max',
    range: 'Range',
  },
}

interface Cell {
  /** The distinct-able values of the cell: one per item of a multi-value cell. */
  keys: string[]
  value?: number
  endValue?: number
  isDay?: boolean
  /** `value` is a date's time (the date calculations read these cells, the number ones the rest). */
  isDate?: boolean
}

const text = (s: unknown): string[] => (typeof s === 'string' && s.trim() !== '' ? [s] : [])

function cellOf(row: Row, propertyId: string, kind: PropertyType): Cell {
  const v = rowValue(row, propertyId)
  switch (kind) {
    case 'number':
      return typeof v === 'number' && !Number.isNaN(v) ? { keys: [String(v)], value: v } : { keys: [] }
    case 'boolean':
      return { keys: v === true ? ['true'] : [] }
    case 'datetime':
    case 'datetimeSimple':
    case 'entity_createdAt':
    case 'entity_lastUpdated': {
      const dv: DateValue | null = typeof v === 'string' ? (v ? { start: v, resolution: 'time' } : null) : ((v as DateValue | null) ?? null)
      const span = dateSpan(dv)
      if (!span) return { keys: [] }
      return {
        keys: [String(span.start.getTime())],
        value: span.start.getTime(),
        endValue: span.end?.getTime(),
        isDay: span.resolution === 'day',
        isDate: true,
      }
    }
    case 'formula':
    case 'rollup':
      return computedCell(v)
    case 'uniqueId':
      return { keys: typeof v === 'number' ? [String(v)] : text(v) }
    case 'email':
    case 'phone':
      return { keys: text(v) }
    case 'files':
      return { keys: filePaths(v) }
    case 'entity_title':
      return { keys: text(displayTitle(row)) }
    case 'label':
      return { keys: (Array.isArray(v) ? (v as string[]) : []).filter((t) => typeof t === 'string' && t !== '') }
    case 'entity':
      return {
        keys: (Array.isArray(v) ? (v as EntityRef[]) : []).map((r) => r?.path ?? r?.target ?? '').filter((k) => k !== ''),
      }
    case 'entity_type':
      return { keys: text(row.summary.type) }
    case 'entity_tags':
    case 'entity_collections':
    case 'entity_aliases':
      return { keys: (Array.isArray(v) ? (v as string[]) : []).filter((t) => typeof t === 'string' && t !== '') }
    case 'textBlock':
    case 'entity_description':
    case 'text':
    case 'url':
    case 'color':
      return { keys: text(v) }
    default:
      return { keys: [] }
  }
}

/**
 * M12: a formula or rollup value's cell, by its result type: a number and a date carry a value
 * for the number and date calculations; text, a boolean and each list item count as values;
 * empty and errors are empty.
 */
function computedCell(v: unknown): Cell {
  const c = asComputed(v)
  if (!c || computedIsEmpty(c)) return { keys: [] }
  switch (c.type) {
    case 'number': {
      const n = c.value as number
      return { keys: [String(n)], value: n }
    }
    case 'date': {
      const iso = c.value as string
      const span = dateSpan({ start: iso, resolution: computedDateResolution(iso) })
      if (!span) return { keys: [] }
      return { keys: [String(span.start.getTime())], value: span.start.getTime(), isDay: span.resolution === 'day', isDate: true }
    }
    case 'list':
      return { keys: computedList(c) ?? [] }
    default:
      return { keys: [computedText(c)] }
  }
}

const UNITS = [
  { unit: 'year', ms: 365 * 86400000 },
  { unit: 'month', ms: 30 * 86400000 },
  { unit: 'day', ms: 86400000 },
  { unit: 'hour', ms: 3600000 },
  { unit: 'minute', ms: 60000 },
]

/** "{n} year(s)" and so on: the largest unit that fits. */
function duration(ms: number): string {
  const u = UNITS.find((x) => ms >= x.ms) ?? UNITS[UNITS.length - 1]
  const n = Math.round(ms / u.ms)
  return `${n} ${u.unit}${n === 1 ? '' : 's'}`
}

const round10 = (n: number) => Math.round(n * 1e10) / 1e10

function percent(n: number, total: number): { value: number; display: string } {
  const p = total ? Math.round((n / total) * 1000) / 10 : 0
  return { value: p, display: `${p}%` }
}

export interface CalcResult {
  value: number | string | null
  display: string
}

/**
 * One calculation over `rows` for a property. An empty result (no numbers, no dates) is `{null, ''}`.
 * `structureId` is the calculation's own type: its definition is used when that type has the
 * property, else the view's types' (as a filter's `structureId`).
 */
export function calculate(rows: Row[], propertyId: string, kind: CalcKind, ctx: FilterCtx, structureId?: string): CalcResult {
  const total = rows.length
  const none: CalcResult = { value: null, display: '' }
  if (kind === 'countAll') return { value: total, display: String(total) }
  const def =
    (structureId ? findDef(ctx.types, propertyId, structureId) : undefined) ??
    findDef(ctx.types, propertyId, undefined, ctx.viewTypeIds)
  if (!def) return none
  const cells = rows.map((r) => cellOf(r, propertyId, def.type))
  const filled = cells.filter((c) => c.keys.length > 0).length
  const count = (n: number): CalcResult => ({ value: n, display: String(n) })
  switch (kind) {
    case 'countValues':
      return count(cells.reduce((n, c) => n + c.keys.length, 0))
    case 'countUnique':
      return count(new Set(cells.flatMap((c) => c.keys)).size)
    case 'countEmpty':
    case 'unchecked':
      return count(total - filled)
    case 'countNotEmpty':
    case 'checked':
      return count(filled)
    case 'percentEmpty':
    case 'percentUnchecked':
      return percent(total - filled, total)
    case 'percentNotEmpty':
    case 'percentChecked':
      return percent(filled, total)
  }
  // Number calculations read the number values, date calculations the dates (M12: a formula's
  // column may hold both).
  const dateCalc = DATE_CALCS.includes(kind)
  const withValue = cells.filter((c): c is Cell & { value: number } => typeof c.value === 'number' && !!c.isDate === dateCalc)
  if (!withValue.length) return none
  const sorted = withValue.map((c) => c.value).sort((a, b) => a - b)
  const lo = sorted[0]
  const hi = sorted[sorted.length - 1]
  const numberFormat = def.type === 'formula' || def.type === 'rollup' ? computedNumberFormat(def) : def.options.numberFormat
  const asNumber = (n: number): CalcResult => ({ value: n, display: formatNumber(n, numberFormat) })
  const sum = sorted.reduce((a, b) => a + b, 0)
  switch (kind) {
    case 'sum':
      return asNumber(round10(sum))
    case 'average':
      return asNumber(round10(sum / sorted.length))
    case 'median': {
      const mid = Math.floor(sorted.length / 2)
      return asNumber(round10(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2))
    }
    case 'min':
      return asNumber(lo)
    case 'max':
      return asNumber(hi)
    case 'range':
      return asNumber(round10(hi - lo))
  }
  // Dates: the latest is the latest end (or start); the range runs from the earliest start to it.
  const latest = withValue.reduce((a, b) => ((b.endValue ?? b.value) > (a.endValue ?? a.value) ? b : a))
  const latestMs = latest.endValue ?? latest.value
  const fmt = (ms: number, isDay: boolean): string =>
    isDay ? formatLocalDay(ms) : formatDate({ start: new Date(ms).toISOString(), resolution: 'time' })
  switch (kind) {
    case 'earliestDate': {
      const first = withValue.find((c) => c.value === lo)
      // A day value is local midnight; format it from its local calendar date.
      return { value: lo, display: fmt(lo, !!first?.isDay) }
    }
    case 'latestDate':
      return { value: latestMs, display: fmt(latestMs, !!latest.isDay) }
    case 'dateRange':
      return { value: latestMs - lo, display: duration(latestMs - lo) }
  }
  return none
}

function formatLocalDay(ms: number): string {
  const d = wallClock(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return formatDate({ start: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, resolution: 'day' })
}
