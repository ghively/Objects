// M13 calendar layout: pure helpers. Which date property the view places objects by, which days
// a row covers, the days a month grid or week strip shows, and a date value moved by whole days
// (keeping its resolution, its wall-clock time and its range length). Every label and default here
// is our choice (docs/superpowers/plans/2026-11-05-m13-view-layouts.md, "Calendar").
import type { CalendarViewConfig, DateValue, PropertyType, Row, TypeDef, ViewState } from '@/api/types'
import { addDays, addMonths, formatLong, monthGrid, monthName, parseYmd, startOfMonth, startOfWeek, type Day, type WeekStart } from '@/calendar/dates'
import { zonedWallToInstant } from '@/lib/zonedShell'
import { formatInZone, zonedParts } from '@/lib/zonedTime'
import { useSettings } from '@/settings/useSettings'
import { rowValue } from '../../filter'
import { dayReader, daySpan } from '../../dates'
import { propertyChoices, type PropChoice } from '../../properties'

export type CalendarMode = CalendarViewConfig['mode']

/** Our strings. */
export const CALENDAR_TEXT = {
  more: (n: number) => `+${n} more`,
  noDate: (n: number) => `No date (${n})`,
  noDateHeading: 'No date',
  newOn: (day: Day) => `New object on ${formatLong(day)}`,
  previous: 'Previous',
  next: 'Next',
  today: 'Today',
  month: 'Month',
  week: 'Week',
  mode: 'Calendar mode',
  dateProperty: 'Date property',
  show: 'Show',
  changed: 'Changed elsewhere. Reloaded.',
  saveFailed: 'Could not save.',
}

/** A start time's short clock ("9:00 AM", "09:00"), in the time-zone setting. */
export function chipTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const h24 = useSettings.getState().settings.twentyFourHourTime
  return formatInZone(d, { hour: 'numeric', minute: '2-digit', ...(h24 ? { hourCycle: 'h23' as const } : {}) })
}

export const DEFAULT_CALENDAR_CONFIG: CalendarViewConfig = { dateProperty: null, mode: 'month' }

/** Our choice: chips a day shows before "+N more" (month), and in the taller week strip. */
export const MONTH_DAY_CAP = 4
export const WEEK_DAY_CAP = 12

/** The system dates every object has; they are set by the server, so they can't be dragged. */
export const SYSTEM_DATE_KEYS: ReadonlySet<string> = new Set(['createdAt', 'lastUpdated'])

const DATE_KINDS: ReadonlySet<PropertyType> = new Set<PropertyType>(['datetime', 'datetimeSimple', 'entity_createdAt', 'entity_lastUpdated'])

export const isDateKind = (kind: PropertyType) => DATE_KINDS.has(kind)

/** The saved config with its defaults filled in (a missing key means the defaults). */
export function calendarConfig(saved: Partial<CalendarViewConfig> | null | undefined): CalendarViewConfig {
  return {
    dateProperty: typeof saved?.dateProperty === 'string' && saved.dateProperty ? saved.dateProperty : null,
    mode: saved?.mode === 'week' ? 'week' : 'month',
  }
}

/** `state` with `calendarConfig` changed by `patch` (the other keys kept, defaults filled in). */
export function withCalendarConfig(state: ViewState, patch: Partial<CalendarViewConfig>): ViewState {
  const cfg = calendarConfig(state.viewDefinition.calendarConfig)
  return { ...state, viewDefinition: { ...state.viewDefinition, calendarConfig: { ...cfg, ...patch } } }
}

/** The date properties a calendar can place by: the view types' date properties, then Created at and Last updated. */
export function dateChoices(viewTypes: TypeDef[]): PropChoice[] {
  return propertyChoices(viewTypes).filter((c) => isDateKind(c.kind))
}

/**
 * The property the calendar places by: the saved one while it is still a date property of the
 * view, else the first date property of the first view type, else `createdAt`.
 */
export function resolveDateProperty(config: CalendarViewConfig, viewTypes: TypeDef[]): string {
  const saved = config.dateProperty
  if (saved && (SYSTEM_DATE_KEYS.has(saved) || dateChoices(viewTypes).some((c) => c.key === saved))) return saved
  const first = viewTypes[0]?.propertyDefinitions.find((d) => d.type === 'datetime' || d.type === 'datetimeSimple')
  return first?.key ?? 'createdAt'
}

/** The row's value of `key` as a date value (the system dates are ISO instants). */
export function dateValueOf(row: Row, key: string): DateValue | null {
  const v = rowValue(row, key)
  // A bare string is an instant (the system dates), as the view's filters and groups read it.
  if (typeof v === 'string') return v ? { start: v, resolution: 'time' } : null
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const dv = v as Partial<DateValue>
  return typeof dv.start === 'string' && dv.start ? (dv as DateValue) : null
}

export interface RowDays {
  start: Day
  /** The last day covered (the start's own day when the value has no end, or an end before its start). */
  end: Day
}

/** The days a row's value covers, in the time-zone setting; null without a usable date. */
export function rowDays(row: Row, key: string, dayOf: (iso: string) => string | null = dayReader()): RowDays | null {
  const span = daySpan(dateValueOf(row, key), dayOf)
  if (!span || !parseYmd(span.start)) return null
  const end = span.end && parseYmd(span.end) && span.end > span.start ? span.end : span.start
  return { start: span.start, end }
}

export interface Placement {
  /** Rows by the day they sit on, in the view's order; only days in the shown range. */
  byDay: Map<Day, Row[]>
  /** Rows without a usable date (the "No date" tray), in the view's order. */
  undated: Row[]
  /** Each placed row's first day (by path), where its start time shows. */
  startOf: Map<string, Day>
}

/** Each row on every shown day its value covers (`from`..`to`, inclusive). */
export function placeRows(rows: Row[], key: string, from: Day, to: Day): Placement {
  const byDay = new Map<Day, Row[]>()
  const undated: Row[] = []
  const startOf = new Map<string, Day>()
  const dayOf = dayReader()
  for (const row of rows) {
    const days = rowDays(row, key, dayOf)
    if (!days) {
      undated.push(row)
      continue
    }
    if (days.end < from || days.start > to) continue
    startOf.set(row.summary.path, days.start)
    const last = days.end < to ? days.end : to
    for (let d = days.start > from ? days.start : from; d <= last; d = addDays(d, 1)) {
      const list = byDay.get(d)
      if (list) list.push(row)
      else byDay.set(d, [row])
    }
  }
  return { byDay, undated, startOf }
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: Day, to: Day): number {
  const a = parseYmd(from)
  const b = parseYmd(to)
  if (!a || !b) return 0
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000)
}

/**
 * `v` moved by `delta` whole days: a day value's days (and a range's end, so it keeps its length);
 * a time value's days at the same wall-clock time in the time-zone setting (09:00 stays 09:00
 * across a DST change). Only the keys `v` has are written.
 */
export function shiftDateValue(v: DateValue, delta: number): DateValue {
  if (v.resolution !== 'time' || /^\d{4}-\d{2}-\d{2}$/.test(v.start)) {
    const day = (s: string) => {
      const d = s.slice(0, 10)
      return parseYmd(d) ? addDays(d, delta) : s
    }
    const out: DateValue = { start: day(v.start), resolution: v.resolution }
    if (v.end !== undefined) out.end = v.end ? day(v.end) : v.end
    return out
  }
  const shift = (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const p = zonedParts(d)
    return zonedWallToInstant(addDays(p.date, delta), p.hour, p.minute, p.second, d.getUTCMilliseconds()).toISOString()
  }
  const out: DateValue = { start: shift(v.start), resolution: 'time' }
  if (v.end !== undefined) out.end = v.end ? shift(v.end) : v.end
  return out
}

/** Whether a drop can write `key` on this row: a date property of its own type, a writable file. */
export function canDragRow(row: Row, key: string, typesById: Record<string, TypeDef>): boolean {
  if (row.summary.readOnly || SYSTEM_DATE_KEYS.has(key)) return false
  const def = typesById[row.summary.type]?.propertyDefinitions.find((d) => d.key === key)
  return !!def && (def.type === 'datetime' || def.type === 'datetimeSimple')
}

/** The type a click on a day creates: the first view type that has the property, else the first view type. */
export function createType(viewTypes: TypeDef[], key: string): TypeDef | undefined {
  return viewTypes.find((t) => t.propertyDefinitions.some((d) => d.key === key)) ?? viewTypes[0]
}

/** The weeks a month grid shows: the week-start-aligned rows that hold a day of `anchor`'s month. */
export function monthWeeks(anchor: Day, weekStart: WeekStart): Day[][] {
  const month = anchor.slice(0, 7)
  return monthGrid(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), weekStart).filter((w) => w.some((d) => d.startsWith(month)))
}

/** The seven days of `anchor`'s week. */
export function weekDays(anchor: Day, weekStart: WeekStart): Day[] {
  const from = startOfWeek(anchor, weekStart)
  return Array.from({ length: 7 }, (_, i) => addDays(from, i))
}

/** The days the mode shows, as one list in order. */
export function shownDays(mode: CalendarMode, anchor: Day, weekStart: WeekStart): Day[] {
  return mode === 'week' ? weekDays(anchor, weekStart) : monthWeeks(anchor, weekStart).flat()
}

/** Previous / next: a month (on the 1st, so short months never skip) or a week. */
export function stepAnchor(mode: CalendarMode, anchor: Day, n: number): Day {
  return mode === 'week' ? addDays(anchor, 7 * n) : addMonths(startOfMonth(anchor), n)
}

const short = (day: Day) => `${monthName(Number(day.slice(5, 7))).slice(0, 3)} ${Number(day.slice(8, 10))}`

/** Our strings: "November 2026"; a week "Nov 1 – 7, 2026", "Oct 29 – Nov 4, 2026", "Dec 29, 2026 – Jan 4, 2027". */
export function periodTitle(mode: CalendarMode, anchor: Day, weekStart: WeekStart): string {
  if (mode === 'month') return `${monthName(Number(anchor.slice(5, 7)))} ${anchor.slice(0, 4)}`
  const days = weekDays(anchor, weekStart)
  const [a, b] = [days[0], days[6]]
  if (a.slice(0, 4) !== b.slice(0, 4)) return `${short(a)}, ${a.slice(0, 4)} – ${short(b)}, ${b.slice(0, 4)}`
  if (a.slice(0, 7) === b.slice(0, 7)) return `${short(a)} – ${Number(b.slice(8, 10))}, ${b.slice(0, 4)}`
  return `${short(a)} – ${short(b)}, ${b.slice(0, 4)}`
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** The column headers in week-start order. */
export function weekdayHeaders(weekStart: WeekStart): string[] {
  return weekStart === 'monday' ? WEEKDAY_SHORT : ['Sun', ...WEEKDAY_SHORT.slice(0, 6)]
}
