// A type page's saved views follow the SSE stream: another window's save of this type's views,
// and the resync after the stream reconnected (review fix 2026-11-01 #3).
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent } from '@/api/types'
import { defaultViews } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useTypeViews } from './useTypeViews'

const mocked = vi.mocked(api)
let listeners: ((e: ChangeEvent) => void)[] = []

beforeEach(() => {
  listeners = []
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.views.mockResolvedValue({ views: { ...defaultViews(), activeTab: 'overview' }, revision: 'r0' })
  mocked.onChange.mockImplementation((cb) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
})

const emit = (e: ChangeEvent) =>
  act(() => {
    for (const cb of [...listeners]) cb(e)
  })

describe('useTypeViews', () => {
  test("a 'views' event for this type reloads; one for another type does not", async () => {
    const { result } = renderHook(() => useTypeViews('task'))
    await waitFor(() => expect(result.current.views?.activeTab).toBe('overview'))
    mocked.views.mockResolvedValue({ views: { ...defaultViews(), activeTab: 'all' }, revision: 'r1' })
    emit({ kind: 'views', path: 'page', version: 'x', origin: null })
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.views?.activeTab).toBe('overview')
    emit({ kind: 'views', path: 'task', version: 'r1', origin: null })
    await waitFor(() => expect(result.current.views?.activeTab).toBe('all'))
  })

  test('the resync after the stream reconnected reloads the views too', async () => {
    const { result } = renderHook(() => useTypeViews('task'))
    await waitFor(() => expect(result.current.views?.activeTab).toBe('overview'))
    mocked.views.mockResolvedValue({ views: { ...defaultViews(), activeTab: 'all' }, revision: 'r1' })
    emit({ kind: 'views', path: '*', version: null, origin: null })
    await waitFor(() => expect(result.current.views?.activeTab).toBe('all'))
  })
})
