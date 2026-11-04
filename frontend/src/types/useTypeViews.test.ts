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

// Polish item 20: the type's "Default list view" opens a type page that has no saved views.
describe('useTypeViews default layout', () => {
  test('with no saved views (revision ""), the All view opens in the default layout', async () => {
    mocked.views.mockResolvedValue({ views: defaultViews(), revision: '' })
    const { result } = renderHook(() => useTypeViews('task', 'table'))
    await waitFor(() => expect(result.current.views?.all.viewDefinition.dataViewLayout).toBe('table'))
  })

  test('saved views win over the default layout', async () => {
    const saved = defaultViews()
    saved.all = { ...saved.all, viewDefinition: { dataViewLayout: 'wall' } }
    mocked.views.mockResolvedValue({ views: saved, revision: 'r3' })
    const { result } = renderHook(() => useTypeViews('task', 'table'))
    await waitFor(() => expect(result.current.views).not.toBeNull())
    expect(result.current.views?.all.viewDefinition.dataViewLayout).toBe('wall')
  })

  test('no default layout keeps the built-in one; an unknown one is ignored', async () => {
    mocked.views.mockResolvedValue({ views: defaultViews(), revision: '' })
    const plain = renderHook(() => useTypeViews('task'))
    await waitFor(() => expect(plain.result.current.views).not.toBeNull())
    expect(plain.result.current.views?.all.viewDefinition.dataViewLayout).toBe('list')
    const odd = renderHook(() => useTypeViews('task', 'spiral'))
    await waitFor(() => expect(odd.result.current.views).not.toBeNull())
    expect(odd.result.current.views?.all.viewDefinition.dataViewLayout).toBe('list')
  })

  test('changing the setting while nothing is saved re-applies it; an edit then saves that layout', async () => {
    mocked.views.mockResolvedValue({ views: defaultViews(), revision: '' })
    mocked.saveViews.mockResolvedValue({ revision: 'r1' })
    const { result, rerender } = renderHook(({ d }: { d?: string }) => useTypeViews('task', d), {
      initialProps: { d: 'table' } as { d?: string },
    })
    await waitFor(() => expect(result.current.views?.all.viewDefinition.dataViewLayout).toBe('table'))
    rerender({ d: 'wall' })
    await waitFor(() => expect(result.current.views?.all.viewDefinition.dataViewLayout).toBe('wall'))
    act(() => result.current.update((v) => ({ ...v, activeTab: 'overview' })))
    await waitFor(() => expect(mocked.saveViews).toHaveBeenCalled())
    expect(mocked.saveViews.mock.calls[0][1].all.viewDefinition.dataViewLayout).toBe('wall')
  })
})
