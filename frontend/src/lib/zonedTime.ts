/**
 * Wall-clock time in the time-zone setting (M8 `DeviceSettings.timeZone`: an IANA name, or `null`
 * for the device's zone), through `Intl.DateTimeFormat`. The server follows the same setting for
 * `today` (`Space.tz`), so the client's "today" and the server's agree.
 *
 * Every function reads the setting from `useSettings` at call time; `zone` overrides it (`null`
 * is the device's zone). An unknown zone name falls back to the device's zone.
 */
import { useSettings } from '@/settings/useSettings'

export interface ZonedParts {
  year: number
  /** 1–12 */
  month: number
  /** 1–31 */
  day: number
  /** 0–23 */
  hour: number
  minute: number
  second: number
  /** 0 = Sunday … 6 = Saturday (as `Date.getDay`). */
  weekday: number
  /** `YYYY-MM-DD` */
  date: string
}

type Instant = Date | string | number

/** The time-zone setting (`null` = the device's zone). */
export function currentTimeZone(): string | null {
  const tz = useSettings.getState().settings.timeZone
  return typeof tz === 'string' && tz ? tz : null
}

function zoneOrUndefined(zone: string | null | undefined): string | undefined {
  const z = zone === undefined ? currentTimeZone() : zone
  if (!z) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z })
    return z
  } catch {
    return undefined
  }
}

function toDate(instant: Instant): Date {
  return instant instanceof Date ? instant : new Date(instant)
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** The wall-clock parts of `instant` in the zone. */
export function zonedParts(instant: Instant, zone?: string | null): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zoneOrUndefined(zone),
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
  })
  const out: Record<string, string> = {}
  for (const p of fmt.formatToParts(toDate(instant))) out[p.type] = p.value
  const year = Number(out.year)
  const month = Number(out.month)
  const day = Number(out.day)
  // Some engines print midnight as 24 even with h23.
  const hour = Number(out.hour) % 24
  return {
    year,
    month,
    day,
    hour,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday] ?? 0,
    date: `${pad(year, 4)}-${pad(month)}-${pad(day)}`,
  }
}

/** Today (`YYYY-MM-DD`) in the zone. */
export function zonedToday(zone?: string | null): string {
  return zonedParts(Date.now(), zone).date
}

/** `instant` formatted in the zone (`opts` as `Intl.DateTimeFormat`'s; its `timeZone` is replaced). */
export function formatInZone(
  instant: Instant,
  opts: Intl.DateTimeFormatOptions = {},
  locale: string | string[] = 'en-US',
  zone?: string | null,
): string {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: zoneOrUndefined(zone) }).format(toDate(instant))
}
