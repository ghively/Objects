// Display formatting for property values: numbers (with Object's number formats and
// separators), dates, emptiness and placeholders.
//
// M8: the "Language" setting picks the locale "Localized" dates use, the "Decimal separator"
// setting (`automatic` follows the language) picks `.` or `,` for every number, and instants show
// in the "Time zone" setting's zone (`lib/zonedTime.ts`). Display only: stored values never change.
import type { DateValue, NumberFormat, PropertyDef, SettingsLanguage } from '@/api/types'
import type { DeviceSettings } from '@/api/types'
import { currentTimeZone, zonedParts } from '@/lib/zonedTime'
import { useSettings } from '@/settings/useSettings'
import { currencySymbol } from './currencies'

/** Digits are laid out in en-US (`1,234.5`) and the separators swapped for a comma radix. */
const LOCALE = 'en-US'

/** The BCP 47 locale of each `DeviceSettings.language` (our mapping). */
export const LANGUAGE_LOCALES: Record<SettingsLanguage, string> = {
  en: 'en-US',
  'en-gb': 'en-GB',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  nl: 'nl-NL',
  'pt-br': 'pt-BR',
  hu: 'hu-HU',
  it: 'it-IT',
}

/** The formatting locale of the "Language" setting (default `en-US`). */
export function formattingLocale(language?: SettingsLanguage): string {
  const lang = language ?? useSettings.getState().settings.language
  return LANGUAGE_LOCALES[lang] ?? LOCALE
}

/** Whether `locale` writes decimals with a comma (`1,5`). */
function localeUsesComma(locale: string): boolean {
  try {
    const dec = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')
    return dec?.value === ','
  } catch {
    return false
  }
}

/**
 * Whether numbers use a comma radix: the "Decimal separator" setting, `automatic` following the
 * language's locale. A number format's own `separators.isRadixComma` forces the comma (our
 * choice: the per-property switch only ever turns the comma on).
 */
export function usesRadixComma(fmt?: NumberFormat | null): boolean {
  if (fmt?.options.separators?.isRadixComma) return true
  const { decimalSeparator, language } = useSettings.getState().settings
  if (decimalSeparator === 'comma') return true
  if (decimalSeparator === 'dot') return false
  return localeUsesComma(formattingLocale(language))
}

function numberParts(v: number, fmt: NumberFormat): Intl.NumberFormatPart[] {
  // Intl throws on digits outside 0–20 or a minimum above the maximum: clamp, the minimum winning.
  const clamp = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(20, Math.max(0, Math.round(n))) : undefined)
  const min = clamp(fmt.options.decimals?.min)
  const max = Math.max(clamp(fmt.options.decimals?.max) ?? 20, min ?? 0)
  const digits = { minimumFractionDigits: min, maximumFractionDigits: max }
  switch (fmt.type) {
    case 'number':
    case 'progress':
      return new Intl.NumberFormat(LOCALE, { style: 'decimal', ...digits }).formatToParts(v)
    case 'currency': {
      if (!fmt.options.currency) return []
      // The sign leads, as Intl's currency style writes it: -$5, not $-5.
      const parts = new Intl.NumberFormat(LOCALE, { style: 'decimal', ...digits }).formatToParts(v)
      const sign = parts[0]?.type === 'minusSign' ? [parts.shift()!] : []
      return [...sign, { type: 'currency', value: currencySymbol(fmt.options.currency) }, ...parts]
    }
    case 'percentage':
      return new Intl.NumberFormat(LOCALE, { style: 'percent', ...digits }).formatToParts(v)
    default:
      return []
  }
}

/**
 * A number as its property shows it. With no format it is the plain number, as in Object.
 * `separators.isGroupingThousands` (default on) keeps the thousands separators; a comma radix
 * (`separators.isRadixComma` or the "Decimal separator" setting) swaps `,` and `.` (`1.234,5`).
 */
export function formatNumber(v: number | null | undefined, fmt?: NumberFormat | null): string {
  if (v === null || v === undefined || typeof v !== 'number' || Number.isNaN(v)) return ''
  const comma = usesRadixComma(fmt)
  const plain = () => (comma ? String(v).replace('.', ',') : String(v))
  if (!fmt) return plain()
  let parts = numberParts(v, fmt)
  if (!parts.length) return plain()
  const sep = fmt.options.separators
  if (!(sep?.isGroupingThousands ?? true)) parts = parts.filter((p) => p.type !== 'group')
  if (comma) {
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
 * number, or `undefined` when it isn't a number (callers ignore it). With a comma radix
 * (`isRadixComma` or the "Decimal separator" setting), `.` groups and `,` is the decimal point
 * (`1.234,5` → 1234.5); otherwise `,` groups.
 */
export function parseNumberInput(s: string, fmt?: NumberFormat | null): number | null | undefined {
  let t = s.replace(/​/g, '').trim()
  if (t === '') return null
  if (usesRadixComma(fmt)) t = t.replace(/\./g, '').replace(/,/g, '.')
  else t = t.replace(/,/g, '')
  t = t.replace(/\s+/g, '')
  // A trailing "%": a percentage cell is edited in percent already; elsewhere it is the fraction.
  const percent = t.endsWith('%')
  if (percent) t = t.slice(0, -1)
  // Plain decimals only: not "Infinity", "0x10" or "0b11", which `Number` would read.
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return undefined
  const n = Number(t)
  if (!Number.isFinite(n)) return undefined
  if (!percent || fmt?.type === 'percentage') return n
  // Shift in decimal (14.3 → 0.143, not 14.3 / 100).
  const [mantissa, exp] = String(n).split('e')
  return Number(`${mantissa}e${Number(exp ?? 0) - 2}`)
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** A cached `Intl.DateTimeFormat`; an unknown zone falls back to the device's (as `zonedTime`). */
function dateFormatter(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(opts)}`
  let f = formatters.get(key)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, opts)
    } catch {
      f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: undefined })
    }
    formatters.set(key, f)
  }
  return f
}

type DateFormatting = DeviceSettings['dateFormatting']

const pad = (n: number) => String(n).padStart(2, '0')

/** A numeric date in the order of `DateAndTimeSettings.dateFormatting.option*`. */
function numericDate(y: number, m: number, d: number, order: Exclude<DateFormatting, 'localized'>): string {
  if (order === 'DMY') return `${pad(d)}-${pad(m)}-${y}`
  if (order === 'MDY') return `${pad(m)}/${pad(d)}/${y}`
  return `${y}-${pad(m)}-${pad(d)}`
}

function formatPoint(iso: string, resolution: DateValue['resolution']): string {
  // Display only: the device settings never change a stored value.
  const { twentyFourHourTime, dateFormatting, language } = useSettings.getState().settings
  const locale = formattingLocale(language)
  const order = dateFormatting === 'DMY' || dateFormatting === 'MDY' || dateFormatting === 'YMD' ? dateFormatting : null
  if (resolution === 'day') {
    // A day is a calendar date, never shifted by the time zone.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
    if (!m) return iso
    if (order) return numericDate(+m[1], +m[2], +m[3], order)
    return dateFormatter(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])))
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // An instant shows in the "Time zone" setting's zone (the device's when unset).
  const zone = { timeZone: currentTimeZone() ?? undefined }
  const hour = twentyFourHourTime ? { hourCycle: 'h23' as const } : {}
  if (order) {
    const p = zonedParts(d)
    const clock = dateFormatter(locale, { timeStyle: 'short', ...hour, ...zone }).format(d)
    return `${numericDate(p.year, p.month, p.day, order)}, ${clock}`
  }
  return dateFormatter(locale, { dateStyle: 'medium', timeStyle: 'short', ...hour, ...zone }).format(d)
}

/**
 * A date value in the language's locale (en-US: `Oct 30, 2026`, `Oct 30, 2026, 2:00 PM`); a range
 * joins with " → ". The device settings switch the time to 24-hour (`14:00`) and the date to a numeric order
 * (`30-10-2026`, `10/30/2026`, `2026-10-30`); "Localized" keeps the output above.
 */
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
 * Whether a property counts as empty (for "Hide when empty"), with Object's quirks: number 0
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
/** An empty value's placeholder: the description, else "Empty"; none in a table cell (blank, as in Object). */
export function placeholderFor(def: Pick<PropertyDef, 'description'>, density?: 'panel' | 'table'): string {
  if (density === 'table') return ''
  return def.description?.trim() || 'Empty'
}
