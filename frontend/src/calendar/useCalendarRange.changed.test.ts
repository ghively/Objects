// Audit 2026-11-01: a `changed` event reloads the range only when it concerns the shown days: the
// object is among them, today is shown (its Updated list), or the saved object's dates or
// recurrence put it there now (read from its row, one small call, not the whole range).
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent } from '@/api/types'
import { calendarDay, calendarRange, objectSummary, row } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useSettings } from '@/settings/useSettings'
import { concernsRange, RANGE_RELOAD_MS, useCalendarRange } from './useCalendarRange'

const mocked = vi.mocked(api)
let listeners: ((e: ChangeEvent) => void)[] = []
const emit = (kind: ChangeEvent['kind'], path: string) =>
  act(() => {
    for (const l of listeners) l({ kind, path, version: null, origin: 'other' })
  })
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RANGE_RELOAD_MS + 10)
  })
}

// A past week; today (2026-10-23) is outside it.
const RANGE = { from: '2026-10-05', to: '2026-10-11' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 23, 12, 0))
  listeners = []
  mocked.calendar.mockReset()
  mocked.calendar.mockImplementation(async (from, to) =>
    calendarRange({ from, to, today: '2026-10-23', summaries: { 'Tasks/Shown.md': objectSummary({ path: 'Tasks/Shown.md', type: 'task' }) } }),
  )
  mocked.rows.mockReset()
  mocked.rows.mockResolvedValue([])
  mocked.onChange.mockReset()
  mocked.onChange.mockImplementation((cb) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useCalendarRange on a changed event', () => {
  test('an object listed only under Created (no summary) of a shown day reloads', async () => {
    mocked.calendar.mockImplementation(async (from, to) =>
      calendarRange({ from, to, today: '2026-10-23', summaries: {}, days: { '2026-10-07': calendarDay({ created: ['Pages/Made.md'] }) } }),
    )
    renderHook(() => useCalendarRange(RANGE))
    await act(async () => {})
    expect(mocked.calendar).toHaveBeenCalledTimes(1)
    emit('changed', 'Pages/Made.md')
    await settle()
    expect(mocked.calendar).toHaveBeenCalledTimes(2)
    expect(mocked.rows).not.toHaveBeenCalled()
  })

  test('an object among the shown days reloads; one elsewhere with no date in range does not', async () => {
    renderHook(() => useCalendarRange(RANGE))
    await act(async () => {})
    expect(mocked.calendar).toHaveBeenCalledTimes(1)

    emit('changed', 'Tasks/Shown.md')
    await settle()
    expect(mocked.calendar).toHaveBeenCalledTimes(2)
    expect(mocked.rows).not.toHaveBeenCalled()

    // A body save of some other page: its row is asked for, the range is not.
    mocked.rows.mockResolvedValueOnce([row({ path: 'Pages/Other.md', values: { date: null } })])
    emit('changed', 'Pages/Other.md')
    await settle()
    expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Pages/Other.md'], preview: false })
    expect(mocked.calendar).toHaveBeenCalledTimes(2)
  })

  test('an object whose date moved into the range, or that recurs, reloads', async () => {
    renderHook(() => useCalendarRange(RANGE))
    await act(async () => {})
    mocked.rows.mockResolvedValueOnce([row({ path: 'Tasks/Moved.md', values: { date: { start: '2026-10-07T09:00', resolution: 'time' } } })])
    emit('changed', 'Tasks/Moved.md')
    await settle()
    expect(mocked.calendar).toHaveBeenCalledTimes(2)

    mocked.rows.mockResolvedValueOnce([row({ path: 'Tasks/Daily.md', values: { date: { start: '2020-01-01', resolution: 'day' }, repeat: 'every day' } })])
    emit('changed', 'Tasks/Daily.md')
    await settle()
    expect(mocked.calendar).toHaveBeenCalledTimes(3)

    // A range spanning the date (end after `from`) counts too; one ending before it does not.
    mocked.rows.mockResolvedValueOnce([row({ path: 'Pages/Span.md', values: { when: { start: '2026-10-01', end: '2026-10-05', resolution: 'day' } } })])
    emit('changed', 'Pages/Span.md')
    await settle()
    expect(mocked.calendar).toHaveBeenCalledTimes(4)
    mocked.rows.mockResolvedValueOnce([row({ path: 'Pages/Before.md', values: { when: { start: '2026-10-01', end: '2026-10-04', resolution: 'day' } } })])
    emit('changed', 'Pages/Before.md')
    await settle()
    expect(mocked.calendar).toHaveBeenCalledTimes(4)
  })

  test('with today among the shown days, every change reloads (the Updated list takes every save)', async () => {
    renderHook(() => useCalendarRange({ from: '2026-10-20', to: '2026-10-26' }))
    await act(async () => {})
    emit('changed', 'Pages/Other.md')
    await settle()
    expect(mocked.calendar).toHaveBeenCalledTimes(2)
    expect(mocked.rows).not.toHaveBeenCalled()
  })

  // Audit 2026-11-07 #16: a timed value's day is its day in the shown time zone, not its UTC day.
  test('a timed date late in the zone day counts for that day, not the next UTC day', async () => {
    const before = useSettings.getState().settings
    useSettings.setState({ settings: { ...before, timeZone: 'America/New_York' } })
    try {
      // 2026-10-07 23:30 in New York is 2026-10-08T03:30Z
      const values = { date: { start: '2026-10-08T03:30:00.000Z', resolution: 'time' } }
      mocked.rows.mockResolvedValue([row({ path: 'Tasks/Late.md', values })])
      expect(await concernsRange('Tasks/Late.md', '2026-10-07', '2026-10-07')).toBe(true)
      expect(await concernsRange('Tasks/Late.md', '2026-10-08', '2026-10-08')).toBe(false)
    } finally {
      useSettings.setState({ settings: before })
    }
  })

  test('created, deleted, renamed and types always reload', async () => {
    renderHook(() => useCalendarRange(RANGE))
    await act(async () => {})
    for (const kind of ['created', 'deleted', 'renamed', 'types'] as const) {
      const before = mocked.calendar.mock.calls.length
      emit(kind, 'Pages/Other.md')
      await settle()
      expect(mocked.calendar).toHaveBeenCalledTimes(before + 1)
    }
    expect(mocked.rows).not.toHaveBeenCalled()
  })
})
