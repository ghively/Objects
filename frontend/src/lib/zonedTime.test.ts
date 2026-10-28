// M8 Task 3: wall-clock time in the time-zone setting.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { formatInZone, fromWallClock, wallClock, zonedInstant, zoneOffsetMs, zonedParts, zonedStartOfDay, zonedToday } from './zonedTime'

const NOW = new Date('2026-10-27T23:30:00Z')

function setZone(timeZone: string | null) {
  useSettings.setState({ settings: { ...settingsDefaults, timeZone } })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  setZone(null)
})

describe('zonedTime', () => {
  test('test zoned today follows the time zone setting', () => {
    setZone('Europe/Berlin')
    expect(zonedToday()).toBe('2026-10-28')
    setZone('America/Los_Angeles')
    expect(zonedToday()).toBe('2026-10-27')
    // null: the device's zone.
    setZone(null)
    const local = new Date(NOW)
    const device = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
    expect(zonedToday()).toBe(device)
    // An unknown zone falls back to the device's zone.
    setZone('Mars/Base')
    expect(zonedToday()).toBe(device)
  })

  test('zoned parts and formatting use the zone', () => {
    setZone('Europe/Berlin')
    // 23:30Z on 27 October 2026 is 00:30 CET (UTC+1, after the October change) on Wednesday the 28th.
    expect(zonedParts(NOW)).toEqual({ year: 2026, month: 10, day: 28, hour: 0, minute: 30, second: 0, weekday: 3, date: '2026-10-28' })
    expect(formatInZone(NOW, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })).toBe('00:30')
    // An explicit zone overrides the setting.
    expect(zonedParts('2026-10-27T13:30:00Z', 'UTC').hour).toBe(13)
    expect(formatInZone(NOW, { dateStyle: 'medium' }, 'en-US', 'UTC')).toBe('Oct 27, 2026')
  })

  test('wall-clock times become instants in the zone', () => {
    setZone('Asia/Tokyo')
    expect(zonedInstant(2026, 10, 22, 9, 0).toISOString()).toBe('2026-10-22T00:00:00.000Z')
    expect(zoneOffsetMs(NOW)).toBe(9 * 3600000)
    expect(zonedStartOfDay(NOW).toISOString()).toBe('2026-10-27T15:00:00.000Z')
    // A carrier reads the zone's clock and turns back into the same instant.
    const w = wallClock('2026-10-21T16:00:00.123Z')
    expect([w.getDate(), w.getHours(), w.getMilliseconds()]).toEqual([22, 1, 123])
    expect(fromWallClock(w).toISOString()).toBe('2026-10-21T16:00:00.123Z')
    // Fields roll over; a skipped time reads with the offset before it; a repeated one is its first.
    expect(zonedInstant(2026, 2, 29, 0, 0, 0, 0, 'UTC').toISOString()).toBe('2026-03-01T00:00:00.000Z')
    expect(zonedInstant(2026, 3, 8, 2, 30, 0, 0, 'America/New_York').toISOString()).toBe('2026-03-08T07:30:00.000Z')
    expect(zonedInstant(2026, 11, 1, 1, 30, 0, 0, 'America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z')
  })
})
