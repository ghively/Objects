// M12: reading formula and rollup values (`ComputedValue`), shared by their cells and the view
// engines (filters, sorts, groups, calculations). Values are computed by the server; the client
// only unwraps them by their result `type`.
import type { ComputedType, ComputedValue, NumberFormat, PropertyDef } from '@/api/types'

const COMPUTED_TYPES: ReadonlySet<string> = new Set<ComputedType>(['text', 'number', 'boolean', 'date', 'list', 'empty', 'error'])

/** The value as a `ComputedValue`, or null when it isn't one (missing, or an unexpected shape). */
export function asComputed(v: unknown): ComputedValue | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const t = (v as { type?: unknown }).type
  return typeof t === 'string' && COMPUTED_TYPES.has(t) ? (v as ComputedValue) : null
}

/** Whether a computed value is empty: missing, `empty`, an error, a blank text or an empty list. */
export function computedIsEmpty(v: unknown, opts: { errorIsEmpty?: boolean } = {}): boolean {
  const c = asComputed(v)
  if (!c) return true
  switch (c.type) {
    case 'empty':
      return true
    case 'error':
      return opts.errorIsEmpty ?? true
    case 'text':
    case 'date':
      return typeof c.value !== 'string' || c.value.trim() === ''
    case 'number':
      return typeof c.value !== 'number' || !Number.isFinite(c.value)
    case 'boolean':
      return typeof c.value !== 'boolean'
    case 'list':
      return !Array.isArray(c.value) || c.value.length === 0
  }
  return true
}

/** A computed number, or undefined when the value isn't a finite number. */
export function computedNumber(v: unknown): number | undefined {
  const c = asComputed(v)
  return c?.type === 'number' && typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : undefined
}

/** A computed date's ISO text (`YYYY-MM-DD` or an instant), or undefined. */
export function computedDate(v: unknown): string | undefined {
  const c = asComputed(v)
  return c?.type === 'date' && typeof c.value === 'string' && c.value.trim() !== '' ? c.value : undefined
}

/** A computed list's items (as text), or undefined when the value isn't a list. */
export function computedList(v: unknown): string[] | undefined {
  const c = asComputed(v)
  if (c?.type !== 'list' || !Array.isArray(c.value)) return undefined
  return c.value.filter((x) => x !== null && x !== undefined).map(String)
}

/**
 * A computed value as plain text (filters and groups): text as is, a number as written, a boolean
 * as `true`/`false`, a date as its ISO text, a list joined with ", ", and empty or error as "".
 */
export function computedText(v: unknown): string {
  const c = asComputed(v)
  if (!c) return ''
  switch (c.type) {
    case 'text':
    case 'date':
      return typeof c.value === 'string' ? c.value : ''
    case 'number':
      return typeof c.value === 'number' && Number.isFinite(c.value) ? String(c.value) : ''
    case 'boolean':
      return typeof c.value === 'boolean' ? String(c.value) : ''
    case 'list':
      return (computedList(c) ?? []).join(', ')
    default:
      return ''
  }
}

const PERCENT_FORMAT: NumberFormat = { type: 'percentage', options: {} }

/**
 * The number format a computed number shows with: the property's own `numberFormat`, else for a
 * rollup's "Percent empty"/"Percent not empty" (a fraction 0–1) a percentage (our choice).
 */
export function computedNumberFormat(def: Pick<PropertyDef, 'type' | 'options'>): NumberFormat | null {
  if (def.options.numberFormat) return def.options.numberFormat
  if (def.type === 'rollup' && (def.options.calc === 'percentEmpty' || def.options.calc === 'percentNotEmpty')) return PERCENT_FORMAT
  return null
}

/** The resolution a computed date shows at: a day for `YYYY-MM-DD`, else the time. */
export const computedDateResolution = (iso: string): 'day' | 'time' => (/T/.test(iso) ? 'time' : 'day')
