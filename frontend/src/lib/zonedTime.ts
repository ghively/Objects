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

const partFormatters = new Map<string, Intl.DateTimeFormat>()

/** A cached parts formatter per zone (views read thousands of dates per render). */
function partsFormatter(tz: string | undefined): Intl.DateTimeFormat {
  const key = tz ?? ''
  let fmt = partFormatters.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    })
    // The device's zone can change while the app runs (tests set TZ); cache named zones only.
    if (tz) partFormatters.set(key, fmt)
  }
  return fmt
}

/** The wall-clock parts of `instant` in the zone. */
export function zonedParts(instant: Instant, zone?: string | null): ZonedParts {
  const fmt = partsFormatter(zoneOrUndefined(zone))
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

/** `Date.UTC` for any year (it reads 0–99 as 1900–1999); out-of-range fields roll over. */
function utcMs(year: number, month0: number, day: number, hour: number, minute: number, second: number, ms: number): number {
  // The Gregorian calendar repeats every 400 years, so shift the year out of 0–99 and back.
  const d = new Date(Date.UTC(year + 400, month0, day, hour, minute, second, ms))
  d.setUTCFullYear(d.getUTCFullYear() - 400)
  return d.getTime()
}

/** The zone's offset from UTC at `instant`, in ms (positive east of Greenwich). */
export function zoneOffsetMs(instant: Instant, zone?: string | null): number {
  const t = toDate(instant).getTime()
  const p = zonedParts(t, zone)
  const whole = Math.floor(t / 1000) * 1000
  return utcMs(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0) - whole
}

/**
 * The instant at which the zone's clock reads this wall-clock time (`month` 1–12; out-of-range
 * fields roll over, as `Date.UTC`'s). A time the clocks skip (spring forward) is read with the
 * offset before the change, as `new Date(y, m, d, h)` does; a repeated time gives its first instant.
 */
export function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
  zone?: string | null,
): Date {
  const wall = utcMs(year, month - 1, day, hour, minute, second, ms)
  const o1 = zoneOffsetMs(wall, zone)
  const o2 = zoneOffsetMs(wall - o1, zone)
  const fits = [o1, o2].filter((o) => zoneOffsetMs(wall - o, zone) === o)
  if (fits.length) return new Date(wall - Math.max(...fits))
  return new Date(wall - Math.min(o1, o2))
}

/**
 * A device-local `Date` whose local fields (`getFullYear` … `getMilliseconds`) read the zone's
 * wall clock at `instant`: a carrier for calendar arithmetic with the local `Date` API. Turn it
 * back into an instant with `fromWallClock`.
 */
export function wallClock(instant: Instant, zone?: string | null): Date {
  const d = toDate(instant)
  const p = zonedParts(d, zone)
  const out = new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, ((d.getTime() % 1000) + 1000) % 1000)
  if (p.year < 100) out.setFullYear(p.year)
  return out
}

/** The instant a `wallClock` carrier stands for: its local fields read in the zone. */
export function fromWallClock(wall: Date, zone?: string | null): Date {
  return zonedInstant(
    wall.getFullYear(),
    wall.getMonth() + 1,
    wall.getDate(),
    wall.getHours(),
    wall.getMinutes(),
    wall.getSeconds(),
    wall.getMilliseconds(),
    zone,
  )
}

/** The first instant of `instant`'s day in the zone. */
export function zonedStartOfDay(instant: Instant, zone?: string | null): Date {
  const p = zonedParts(instant, zone)
  return zonedInstant(p.year, p.month, p.day, 0, 0, 0, 0, zone)
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
