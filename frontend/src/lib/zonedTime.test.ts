// M8 Task 3: wall-clock time in the time-zone setting.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { formatInZone, zonedParts, zonedToday } from './zonedTime'

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
})
