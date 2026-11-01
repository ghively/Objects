// Audit 2026-11-01 F7: a reload that brings the same graph keeps the same `data` object, so the
// canvas neither rebuilds nor re-lays out after a body-only save; a different graph replaces it.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ChangeEvent } from '@/api/types'
import { graphData } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { RELOAD_DELAY_MS, resetGraphData, useGraphData, useGraphDataStore } from './useGraphData'

const mocked = vi.mocked(api)
let listener: ((e: ChangeEvent) => void) | null = null

beforeEach(() => {
  vi.useFakeTimers()
  resetGraphData()
  mocked.graph.mockReset()
  mocked.onChange.mockReset()
  mocked.onChange.mockImplementation((cb) => {
    listener = cb
    return () => {
      listener = null
    }
  })
})
afterEach(() => {
  vi.useRealTimers()
})

const sameNodes = () => graphData({ nodes: [{ path: 'A.md', title: 'A', type: 'page', degree: 1 }, { path: 'B.md', title: 'B', type: 'page', degree: 1 }] as never, links: [0, 1] })

test('an equal payload keeps the data object; a different one replaces it', async () => {
  mocked.graph.mockImplementation(async () => sameNodes())
  const { result } = renderHook(() => useGraphData())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  const first = result.current.data
  expect(first?.nodes).toHaveLength(2)

  // A body-only save elsewhere: the graph is asked again, but nothing in it changed.
  act(() => listener?.({ kind: 'changed', path: 'A.md', version: 'v2', origin: 'other' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS)
  })
  expect(mocked.graph).toHaveBeenCalledTimes(2)
  expect(result.current.data).toBe(first)
  expect(useGraphDataStore.getState().data).toBe(first)

  // A new link: a new object.
  mocked.graph.mockImplementation(async () => graphData({ ...sameNodes(), links: [0, 1], linkDirs: [3] }))
  act(() => listener?.({ kind: 'changed', path: 'B.md', version: 'v3', origin: 'other' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS)
  })
  expect(result.current.data).not.toBe(first)
  expect(result.current.data?.linkDirs).toEqual([3])
})

test('the hook subscribes to the slices it returns, not the whole store', async () => {
  mocked.graph.mockImplementation(async () => sameNodes())
  let renders = 0
  const { result } = renderHook(() => {
    renders++
    return useGraphData()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  const after = renders
  // The same payload again: no new data, no render.
  act(() => listener?.({ kind: 'changed', path: 'A.md', version: 'v2', origin: 'other' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS)
  })
  expect(result.current.loading).toBe(false)
  // `loading` flips true and back once per reload; nothing else re-renders the hook.
  expect(renders - after).toBeLessThanOrEqual(2)
})
