/**
 * Shell helpers on top of `lib/zonedTime`: a zoned day as a local-midnight `Date` (for the code that
 * does day arithmetic on `Date`s) and a wall-clock time in the zone back to an instant.
 * `zone` follows `zonedTime`: omitted = the Time zone setting, `null` = the device's zone.
 */
import { zonedParts } from '@/lib/zonedTime'

type Instant = Date | string | number

/** The zone's calendar day of `instant`, as a local-midnight `Date` (default: now). */
export function zonedDayDate(instant: Instant = Date.now(), zone?: string | null): Date {
  const p = zonedParts(instant, zone)
  return new Date(p.year, p.month - 1, p.day)
}

/** The zone's UTC offset (ms) at `t`, to the second. */
function offsetAt(t: number, zone?: string | null): number {
  const p = zonedParts(t, zone)
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wall - (t - (((t % 1000) + 1000) % 1000))
}

/**
 * The instant at which the zone's wall clock reads `day` (`YYYY-MM-DD`) `h:m:s.ms`. A time skipped
 * by a DST change lands on the shifted instant, as `Date`'s local setters do.
 */
export function zonedWallToInstant(day: string, h: number, m: number, s = 0, ms = 0, zone?: string | null): Date {
  const [y, mo, d] = day.split('-').map(Number)
  const wall = Date.UTC(y, mo - 1, d, h, m, s, ms)
  const first = wall - offsetAt(wall, zone)
  const second = wall - offsetAt(first, zone)
  return new Date(second)
}
