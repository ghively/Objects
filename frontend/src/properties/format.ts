// Display formatting for property values: numbers (with Capacities' number formats and
// separators), dates, emptiness and placeholders.
import type { DateValue, NumberFormat, PropertyDef } from '@/api/types'
import { currencySymbol } from './currencies'

const LOCALE = 'en-US'

function numberParts(v: number, fmt: NumberFormat): Intl.NumberFormatPart[] {
  const digits = {
    minimumFractionDigits: fmt.options.decimals?.min,
    maximumFractionDigits: fmt.options.decimals?.max ?? 20,
  }
  switch (fmt.type) {
    case 'number':
    case 'progress':
      return new Intl.NumberFormat(LOCALE, { style: 'decimal', ...digits }).formatToParts(v)
    case 'currency':
      if (!fmt.options.currency) return []
      return [
        { type: 'currency', value: currencySymbol(fmt.options.currency) },
        ...new Intl.NumberFormat(LOCALE, { style: 'decimal', ...digits }).formatToParts(v),
      ]
    case 'percentage':
      return new Intl.NumberFormat(LOCALE, { style: 'percent', ...digits }).formatToParts(v)
    default:
      return []
  }
}

/**
 * A number as its property shows it. With no format it is the plain number, as in Capacities.
 * `separators.isGroupingThousands` (default on) keeps the thousands separators;
 * `separators.isRadixComma` swaps `,` and `.` (`1.234,5`).
 */
export function formatNumber(v: number | null | undefined, fmt?: NumberFormat | null): string {
  if (v === null || v === undefined || typeof v !== 'number' || Number.isNaN(v)) return ''
  if (!fmt) return String(v)
  let parts = numberParts(v, fmt)
  if (!parts.length) return String(v)
  const sep = fmt.options.separators
  if (!(sep?.isGroupingThousands ?? true)) parts = parts.filter((p) => p.type !== 'group')
  if (sep?.isRadixComma) {
    parts = parts.map((p) =>
      p.type === 'group' ? { ...p, value: '.' } : p.type === 'decimal' ? { ...p, value: ',' } : p,
    )
  }
  return parts.map((p) => p.value).join('')
}

/** A progress value (steps done) as a fraction of its steps, clamped to [0, 1]. */
export function progressFraction(v: number | null | undefined, fmt?: NumberFormat | null): number {
  const steps = fmt?.options.progress?.steps ?? 0
  if (typeof v !== 'number' || Number.isNaN(v) || !(steps > 0)) return 0
  return Math.min(1, Math.max(0, v / steps))
}

/**
 * What the user typed into a number cell: `null` for an empty input (clear the value), the
 * number, or `undefined` when it isn't a number (callers ignore it). With `isRadixComma`, `.`
 * groups and `,` is the decimal point (`1.234,5` → 1234.5); otherwise `,` groups.
 */
export function parseNumberInput(s: string, fmt?: NumberFormat | null): number | null | undefined {
  let t = s.replace(/​/g, '').trim()
  if (t === '') return null
  if (fmt?.options.separators?.isRadixComma) t = t.replace(/\./g, '').replace(/,/g, '.')
  else t = t.replace(/,/g, '')
  t = t.replace(/\s+/g, '')
  if (t === '') return undefined
  const n = Number(t)
  return Number.isNaN(n) ? undefined : n
}

const DAY_FORMAT = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeZone: 'UTC' })
const TIME_FORMAT = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' })

function formatPoint(iso: string, resolution: DateValue['resolution']): string {
  if (resolution === 'day') {
    // A day is a calendar date, never shifted by the time zone.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
    if (!m) return iso
    return DAY_FORMAT.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])))
  }
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : TIME_FORMAT.format(d)
}

/** A date value in en-US (`Oct 30, 2026`, `Oct 30, 2026, 2:00 PM`); a range joins with " → ". */
export function formatDate(v: DateValue | null | undefined): string {
  if (!v || !v.start) return ''
  const start = formatPoint(v.start, v.resolution)
  return v.end ? `${start} → ${formatPoint(v.end, v.resolution)}` : start
}

function blank(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

/**
 * Whether a property counts as empty (for "Hide when empty"), with Capacities' quirks: number 0
 * and boolean false are empty, and created at, last updated and backlinks are always empty.
 */
export function propertyIsEmpty(def: Pick<PropertyDef, 'type'>, value: unknown): boolean {
  switch (def.type) {
    case 'number':
    case 'boolean':
      return !value
    case 'entity_createdAt':
    case 'entity_lastUpdated':
    case 'entity_backlinks':
      return true
    case 'datetime':
    case 'datetimeSimple':
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return blank((value as { start?: unknown }).start)
      }
      return blank(value)
    default:
      return blank(value)
  }
}

/** The text an empty cell shows: the property's description, else "Empty". */
export function placeholderFor(def: Pick<PropertyDef, 'description'>): string {
  return def.description?.trim() || 'Empty'
}
