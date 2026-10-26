import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent } from '@/api/types'
import { calendarRange } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { DAY_CHECK_MS, RANGE_RELOAD_MS, useCalendarRange } from './useCalendarRange'

const mocked = vi.mocked(api)
let listeners: ((e: ChangeEvent) => void)[] = []
const emit = (kind: ChangeEvent['kind'], path = 'Pages/A.md') =>
  act(() => {
    for (const l of listeners) l({ kind, path, version: null })
  })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 23, 23, 58))
  listeners = []
  mocked.calendar.mockReset()
  mocked.calendar.mockImplementation(async (from, to) => calendarRange({ from, to, today: '2026-10-23' }))
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

const RANGE = { from: '2026-10-22', to: '2026-10-24' }

describe('useCalendarRange', () => {
  test('loads the range once and returns the days', async () => {
    const { result } = renderHook(() => useCalendarRange(RANGE))
    await act(async () => {})
    expect(mocked.calendar).toHaveBeenCalledTimes(1)
    expect(mocked.calendar).toHaveBeenCalledWith('2026-10-22', '2026-10-24')
    expect(result.current.data?.from).toBe('2026-10-22')
    expect(result.current.loading).toBe(false)
  })

  test('useCalendarRange reloads once on a burst of events and when the day changes', async () => {
    renderHook(() => useCalendarRange(RANGE))
    await act(async () => {})
    expect(mocked.calendar).toHaveBeenCalledTimes(1)

    emit('created')
    emit('changed')
    emit('deleted')
    emit('renamed')
    emit('types', 'page')
    await act(async () => {
      vi.advanceTimersByTime(RANGE_RELOAD_MS - 10)
    })
    expect(mocked.calendar).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(20)
    })
    expect(mocked.calendar).toHaveBeenCalledTimes(2)

    // Not a file change: no reload on the same day.
    emit('ui', 'ui.json')
    await act(async () => {
      vi.advanceTimersByTime(RANGE_RELOAD_MS * 2)
    })
    expect(mocked.calendar).toHaveBeenCalledTimes(2)

    // Midnight passes: the day check reloads once.
    await act(async () => {
      vi.advanceTimersByTime(DAY_CHECK_MS * 3 + RANGE_RELOAD_MS)
    })
    expect(mocked.calendar).toHaveBeenCalledTimes(3)
    await act(async () => {
      vi.advanceTimersByTime(DAY_CHECK_MS * 2)
    })
    expect(mocked.calendar).toHaveBeenCalledTimes(3)
  })

  test('the first event after midnight reloads', async () => {
    renderHook(() => useCalendarRange(RANGE))
    await act(async () => {})
    vi.setSystemTime(new Date(2026, 9, 24, 0, 0, 5))
    emit('ui', 'ui.json')
    await act(async () => {
      vi.advanceTimersByTime(RANGE_RELOAD_MS + 1)
    })
    expect(mocked.calendar).toHaveBeenCalledTimes(2)
  })

  test('a new range loads it and unmount unsubscribes', async () => {
    const { rerender, unmount } = renderHook(({ r }) => useCalendarRange(r), { initialProps: { r: RANGE } })
    await act(async () => {})
    rerender({ r: { from: '2026-10-25', to: '2026-10-25' } })
    await act(async () => {})
    expect(mocked.calendar).toHaveBeenLastCalledWith('2026-10-25', '2026-10-25')
    unmount()
    expect(listeners).toHaveLength(0)
  })
})
