import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, ApiError } from '@/api/client'
import type { ChangeEvent } from '@/api/types'
import { board, node } from './test/boards'
import { mockWhiteboardApi } from './test/mockWhiteboardApi'
import { SAVE_DELAY_MS, useBoard } from './useBoard'
import { useInkDoc } from './ink/useInkDoc'
import type { InkStroke } from './ink/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

const PATH = 'Whiteboards/Board.md'
let listeners: Set<(e: ChangeEvent) => void>

beforeEach(() => {
  listeners = new Set()
  vi.mocked(api).onChange.mockImplementation((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  })
})
afterEach(() => vi.useRealTimers())

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('audit: flush against a failing server', () => {
  test('useBoard: unmount with the server down fires a burst of PUTs with no delay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = mockWhiteboardApi(board([node({ id: 'a', position: { x: 0, y: 0 } })]), 'rev-1')
    const times: number[] = []
    client.saveBoard.mockImplementation(async () => {
      times.push(Date.now())
      throw new ApiError(500, 'boom')
    })
    const hook = renderHook(() => useBoard(PATH, client))
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))
    act(() => hook.result.current.store.getState().actions.nudge(30, 0, ['a']))
    await advance(SAVE_DELAY_MS + 10) // the first (scheduled) save fails
    const before = client.saveBoard.mock.calls.length
    hook.unmount()
    await advance(50)
    const burst = client.saveBoard.mock.calls.length - before
    console.log(`useBoard: saves before unmount=${before}; PUTs within 50 ms of unmount=${burst}; spacing ms=${times.slice(1).map((t, i) => t - times[i])}`)
    expect(burst).toBeLessThanOrEqual(1)
  })

  test('useInkDoc: flush with the server down fires a burst of PUTs with no delay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const s = (id: string): InkStroke => ({ id, tool: 'pen', color: '#5c5959', width: 4, points: [[0, 0, 0.5]], d: 'M 0 0 Z' })
    const client = {
      load: vi.fn(async () => ({ path: PATH, strokes: [] as InkStroke[], revision: 'r1' })),
      save: vi.fn(async () => {
        throw new ApiError(500, 'boom')
      }),
    }
    const hook = renderHook(() => useInkDoc(PATH, client))
    await waitFor(() => expect(hook.result.current.strokes).toEqual([]))
    act(() => hook.result.current.save([s('a')]))
    await advance(410) // first save fails, a retry timer is set
    const before = client.save.mock.calls.length
    await act(async () => {
      await hook.result.current.flush()
    })
    const burst = client.save.mock.calls.length - before
    console.log(`useInkDoc: saves before flush=${before}; PUTs during flush()=${burst}`)
    expect(burst).toBeLessThanOrEqual(1)
  })
})
