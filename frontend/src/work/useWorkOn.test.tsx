import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { setWorkOn } from '@/test/workOn'
import { isWorkOn, setWorkEnabled, useWorkOn } from './useWorkOn'

const mocked = vi.mocked(api)
const space = (over: Partial<SpaceInfo> = {}): SpaceInfo => ({
  name: 'space',
  root: '/space',
  types: [],
  icon: null,
  description: null,
  hideTaskManagement: false,
  workEnabled: null,
  workOn: false,
  revision: 'r0',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
})

describe('useWorkOn (M32: the Work switch)', () => {
  test('test Work is off until the space says it is on', async () => {
    const { result } = renderHook(() => useWorkOn())
    expect(result.current).toBe(false) // nothing loaded yet
    expect(isWorkOn()).toBe(false)

    mocked.space.mockResolvedValueOnce(space({ workEnabled: null, workOn: false }))
    await act(() => useSpaceInfo.getState().load())
    expect(result.current).toBe(false)

    mocked.space.mockResolvedValueOnce(space({ workEnabled: true, workOn: true }))
    await act(() => useSpaceInfo.getState().load())
    expect(result.current).toBe(true)
    expect(isWorkOn()).toBe(true)
  })

  test('test the effective value is read, not the stored one', async () => {
    // A space that reads as on with nothing stored (lane D's computed default).
    mocked.space.mockResolvedValueOnce(space({ workEnabled: null, workOn: true }))
    const { result } = renderHook(() => useWorkOn())
    await act(() => useSpaceInfo.getState().load())
    expect(result.current).toBe(true)
    // An older server's answer without the keys reads as off.
    mocked.space.mockResolvedValueOnce({ name: 'space', root: '/space', types: [] })
    await act(() => useSpaceInfo.getState().load())
    expect(result.current).toBe(false)
  })

  test('test setWorkEnabled patches workEnabled only and shows it at once', async () => {
    mocked.space.mockResolvedValueOnce(space())
    await act(() => useSpaceInfo.getState().load())
    mocked.patchSpace.mockResolvedValueOnce(space({ workEnabled: true, workOn: true, revision: 'r1' }))
    const { result } = renderHook(() => useWorkOn())

    let done!: Promise<void>
    act(() => {
      done = setWorkEnabled(true)
    })
    expect(result.current).toBe(true) // before the server answers
    await act(() => done)
    expect(mocked.patchSpace).toHaveBeenCalledTimes(1)
    expect(mocked.patchSpace).toHaveBeenCalledWith({ workEnabled: true }, { baseRevision: 'r0' })
    expect(useSpaceInfo.getState().space).toMatchObject({ workEnabled: true, workOn: true, revision: 'r1' })

    mocked.patchSpace.mockResolvedValueOnce(space({ workEnabled: false, workOn: false, revision: 'r2' }))
    await act(() => setWorkEnabled(false))
    expect(mocked.patchSpace).toHaveBeenLastCalledWith({ workEnabled: false }, { baseRevision: 'r1' })
    expect(result.current).toBe(false)
  })

  test('test a refused write shows the stored value again', async () => {
    mocked.space.mockResolvedValueOnce(space())
    await act(() => useSpaceInfo.getState().load())
    mocked.patchSpace.mockRejectedValueOnce(new Error('read-only'))
    mocked.space.mockResolvedValueOnce(space())
    const { result } = renderHook(() => useWorkOn())
    await act(async () => {
      await expect(setWorkEnabled(true)).rejects.toThrow('read-only')
    })
    await waitFor(() => expect(result.current).toBe(false))
  })

  test('test the test helper turns Work on and off without a fetch', () => {
    const { result } = renderHook(() => useWorkOn())
    act(() => setWorkOn(true))
    expect(result.current).toBe(true)
    expect(useSpaceInfo.getState().space).toMatchObject({ workEnabled: true, workOn: true })
    act(() => setWorkOn(false))
    expect(result.current).toBe(false)
    expect(mocked.space).not.toHaveBeenCalled()
  })

  test('test the shared mock space has Work on, so tests of the dashboard need no set-up', async () => {
    const { mockApi } = await import('@/test/mockApi')
    const fresh = mockApi()
    expect(await fresh.space()).toMatchObject({ workEnabled: null, workOn: true })
    expect(await fresh.patchSpace({ workEnabled: false }, { baseRevision: '' })).toMatchObject({
      workEnabled: false,
      workOn: false,
    })
  })
})
