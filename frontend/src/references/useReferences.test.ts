import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { references } from '@/test/mockApi'
import { RELOAD_DEBOUNCE_MS, useReferences } from './useReferences'

const mocked = vi.mocked(api)
let listeners: ((e: ChangeEvent) => void)[] = []
const fire = (e: ChangeEvent) => {
  for (const l of listeners) l(e)
}
const ev = (kind: ChangeEvent['kind'], path = 'Pages/Other.md'): ChangeEvent => ({ kind, path, version: 'v' })

beforeEach(() => {
  vi.useFakeTimers()
  listeners = []
  mocked.references.mockReset()
  mocked.references.mockResolvedValue(references())
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

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useReferences', () => {
  test('one references call with the limit', async () => {
    const { result } = renderHook(() => useReferences('Pages/A.md', 20))
    await flush()
    expect(mocked.references).toHaveBeenCalledTimes(1)
    expect(mocked.references).toHaveBeenCalledWith('Pages/A.md', { relatedLimit: 20 })
    expect(result.current.data).not.toBeNull()
    expect(result.current.loading).toBe(false)
  })

  test('reloads once on a burst of change events', async () => {
    renderHook(() => useReferences('Pages/A.md', 20))
    await flush()
    mocked.references.mockClear()
    act(() => {
      fire(ev('changed'))
      fire(ev('created'))
      fire(ev('renamed'))
      fire(ev('deleted'))
      fire(ev('types', 'person'))
    })
    act(() => {
      vi.advanceTimersByTime(RELOAD_DEBOUNCE_MS - 1)
    })
    expect(mocked.references).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    await flush()
    expect(mocked.references).toHaveBeenCalledTimes(1)
  })

  test('ignores event kinds that cannot change references', async () => {
    renderHook(() => useReferences('Pages/A.md', 20))
    await flush()
    mocked.references.mockClear()
    act(() => {
      fire({ kind: 'collections', path: 'c', version: null })
      fire({ kind: 'ui', path: 'ui.json', version: null })
      vi.advanceTimersByTime(RELOAD_DEBOUNCE_MS * 2)
    })
    expect(mocked.references).not.toHaveBeenCalled()
  })

  test('reload with absorb swallows the write’s own change event', async () => {
    const { result } = renderHook(() => useReferences('Pages/A.md', 20))
    await flush()
    mocked.references.mockClear()
    act(() => result.current.reload({ absorb: 'Pages/B.md' }))
    act(() => {
      fire(ev('changed', 'Pages/B.md'))
      vi.advanceTimersByTime(RELOAD_DEBOUNCE_MS * 2)
    })
    await flush()
    expect(mocked.references).toHaveBeenCalledTimes(1)
    // Only once: the next change of that object reloads again.
    act(() => {
      fire(ev('changed', 'Pages/B.md'))
      vi.advanceTimersByTime(RELOAD_DEBOUNCE_MS)
    })
    await flush()
    expect(mocked.references).toHaveBeenCalledTimes(2)
  })

  test('drops a stale reply', async () => {
    let resolveFirst: (v: ReturnType<typeof references>) => void = () => undefined
    mocked.references.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
    mocked.references.mockResolvedValueOnce(references({ tabs: ['all', 'backlinks'] }))
    const { result, rerender } = renderHook(({ limit }) => useReferences('Pages/A.md', limit), {
      initialProps: { limit: 20 },
    })
    rerender({ limit: 40 })
    await flush()
    expect(result.current.data?.tabs).toEqual(['all', 'backlinks'])
    await act(async () => {
      resolveFirst(references({ tabs: [] }))
      await Promise.resolve()
    })
    expect(result.current.data?.tabs).toEqual(['all', 'backlinks'])
  })

  test('unsubscribes and cancels a pending reload on unmount', async () => {
    const { unmount } = renderHook(() => useReferences('Pages/A.md', 20))
    await flush()
    mocked.references.mockClear()
    act(() => fire(ev('changed')))
    unmount()
    expect(listeners).toHaveLength(0)
    act(() => {
      vi.advanceTimersByTime(RELOAD_DEBOUNCE_MS * 2)
    })
    expect(mocked.references).not.toHaveBeenCalled()
  })
})
