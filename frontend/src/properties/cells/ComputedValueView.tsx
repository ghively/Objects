import type { ComputedValue, PropertyDef } from '@/api/types'
import { Checkbox } from '@/components/ui/checkbox'
import { useSettings } from '@/settings/useSettings'
import { asComputed, computedDateResolution, computedNumberFormat } from '../computed'
import { formatDate, formatNumber, placeholderFor } from '../format'

/** What an error value shows (our string); the server's message is its tooltip. */
export const COMPUTED_ERROR_TEXT = 'Formula error'

/**
 * A formula or rollup value, read-only, by its result type: text; a number in the property's
 * number format; a boolean as a disabled checkbox; a date as the read-only date cell writes it; a
 * list as chips (comma text in a one-line table cell); empty as the placeholder other cells use;
 * an error as "Formula error" with the message on hover.
 */
export function ComputedValueView({
  def,
  value,
  density,
  inTable,
}: {
  def: PropertyDef
  value: ComputedValue | null | undefined
  density?: 'panel' | 'table'
  inTable?: boolean
}) {
  // Numbers and dates follow the display settings: re-render when they change.
  useSettings((s) => `${s.settings.decimalSeparator}|${s.settings.language}|${s.settings.dateFormatting}|${s.settings.twentyFourHourTime}`)
  const c = asComputed(value)
  const compact = density === 'table'
  const line = `text-[15px] text-fg ${compact ? 'block truncate' : 'block break-words whitespace-pre-wrap'}`
  const empty = <span className="text-[15px] text-fg-muted">{placeholderFor(def, inTable ? 'table' : density)}</span>
  if (!c) return empty
  switch (c.type) {
    case 'error':
      return (
        <span data-computed="error" title={c.error || undefined} className="cursor-help text-[15px] text-destructive">
          {COMPUTED_ERROR_TEXT}
        </span>
      )
    case 'text':
      return typeof c.value === 'string' && c.value !== '' ? (
        <span data-computed="text" className={line}>
          {c.value}
        </span>
      ) : (
        empty
      )
    case 'number':
      return typeof c.value === 'number' && Number.isFinite(c.value) ? (
        <span data-computed="number" className={`${line} tabular-nums`}>
          {formatNumber(c.value, computedNumberFormat(def)) || String(c.value)}
        </span>
      ) : (
        empty
      )
    case 'boolean':
      return (
        <span data-computed="boolean" className="flex items-center">
          <Checkbox aria-label={def.name} checked={c.value === true} disabled />
        </span>
      )
    case 'date': {
      if (typeof c.value !== 'string' || c.value === '') return empty
      const text = formatDate({ start: c.value, resolution: computedDateResolution(c.value) })
      return (
        <span data-computed="date" className={line}>
          {text || c.value}
        </span>
      )
    }
    case 'list': {
      const items = Array.isArray(c.value) ? c.value.map(String).filter((x) => x !== '') : []
      if (!items.length) return empty
      if (compact) {
        return (
          <span data-computed="list" className={line}>
            {items.join(', ')}
          </span>
        )
      }
      return (
        <span data-computed="list" className="flex flex-wrap gap-1">
          {items.map((t, i) => (
            <span key={`${i}:${t}`} className="max-w-full truncate rounded-md bg-hover px-1.5 py-[1px] text-[13px] text-fg">
              {t}
            </span>
          ))}
        </span>
      )
    }
    default:
      return empty
  }
}
