import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, ApiError, RevisionConflictError } from '@/api/client'
import type { ChangeEvent } from '@/api/types'
import { useInkDoc } from './useInkDoc'
import type { InkResponse, InkStroke } from './types'

const PATH = 'Whiteboards/Board.md'

function s(id: string): InkStroke {
  return { id, tool: 'pen', color: '#5c5959', width: 4, points: [[0, 0, 0.5]], d: 'M 0 0 Q 0 0 0 0 Z', colorName: 'gray' }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let listeners: ((e: ChangeEvent) => void)[] = []

beforeEach(() => {
  vi.useFakeTimers()
  listeners = []
  vi.spyOn(api, 'onChange').mockImplementation((cb) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Let pending promise callbacks run (fake timers don't advance microtasks by themselves). */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function fakeClient(initial: InkResponse) {
  return {
    load: vi.fn(async (_path: string): Promise<InkResponse> => initial),
    save: vi.fn(async (_path: string, _strokes: InkStroke[], _base: string) => ({ revision: 'r-next' })),
  }
}

describe('useInkDoc', () => {
  test('ink loads without saving', async () => {
    const client = fakeClient({ path: PATH, strokes: [s('a')], revision: 'r1' })
    const { result } = renderHook(() => useInkDoc(PATH, client))
    expect(result.current.strokes).toBeNull()
    await settle()
    expect(result.current.strokes).toEqual([s('a')])
    expect(result.current.readOnlyReason).toBeNull()
    await advance(2000)
    expect(client.load).toHaveBeenCalledTimes(1)
    expect(client.save).not.toHaveBeenCalled()
  })

  test('a read-only ink file reports its reason and never saves', async () => {
    const client = fakeClient({ path: PATH, strokes: [s('a')], revision: 'r1', readOnlyReason: 'foreign' })
    const { result } = renderHook(() => useInkDoc(PATH, client))
    await settle()
    expect(result.current.readOnlyReason).toBe('foreign')
    act(() => result.current.save([s('a'), s('b')]))
    await advance(1000)
    expect(client.save).not.toHaveBeenCalled()
  })

  test('saves are debounced and serialized', async () => {
    const client = fakeClient({ path: PATH, strokes: [], revision: 'r1' })
    const first = deferred<{ revision: string }>()
    client.save.mockImplementationOnce(() => first.promise)
    client.save.mockImplementationOnce(async () => ({ revision: 'r3' }))
    const { result } = renderHook(() => useInkDoc(PATH, client))
    await settle()

    act(() => result.current.save([s('a')]))
    expect(result.current.strokes).toEqual([s('a')])
    await advance(200)
    act(() => result.current.save([s('a'), s('b')]))
    await advance(399)
    expect(client.save).not.toHaveBeenCalled()
    await advance(1)
    expect(client.save).toHaveBeenCalledTimes(1)
    expect(client.save.mock.calls[0]).toEqual([PATH, [s('a'), s('b')], 'r1'])

    // Two more changes while the first save is in flight: only the latest goes, after it.
    act(() => result.current.save([s('a'), s('b'), s('c')]))
    act(() => result.current.save([s('a'), s('b'), s('c'), s('d')]))
    await advance(400)
    expect(client.save).toHaveBeenCalledTimes(1)
    await act(async () => first.resolve({ revision: 'r2' }))
    await settle()
    expect(client.save).toHaveBeenCalledTimes(2)
    expect(client.save.mock.calls[1]).toEqual([PATH, [s('a'), s('b'), s('c'), s('d')], 'r2'])
  })

  test('flush sends a pending save now', async () => {
    const client = fakeClient({ path: PATH, strokes: [], revision: 'r1' })
    const { result } = renderHook(() => useInkDoc(PATH, client))
    await settle()
    act(() => result.current.save([s('a')]))
    await act(async () => {
      await result.current.flush()
    })
    expect(client.save).toHaveBeenCalledTimes(1)
    expect(client.save.mock.calls[0][1]).toEqual([s('a')])
  })

  test('unmount flushes a pending save', async () => {
    const client = fakeClient({ path: PATH, strokes: [], revision: 'r1' })
    const { result, unmount } = renderHook(() => useInkDoc(PATH, client))
    await settle()
    act(() => result.current.save([s('a')]))
    unmount()
    await settle()
    expect(client.save).toHaveBeenCalledTimes(1)
  })

  test('ink 409 merges by stroke id', async () => {
    // Loaded a, b. Locally: b erased, c drawn. Remotely meanwhile: d drawn (revision r5).
    const client = fakeClient({ path: PATH, strokes: [s('a'), s('b')], revision: 'r1' })
    const { result } = renderHook(() => useInkDoc(PATH, client))
    await settle()
    client.save.mockImplementationOnce(async () => {
      throw new RevisionConflictError('r5')
    })
    client.save.mockImplementationOnce(async () => ({ revision: 'r6' }))
    client.load.mockImplementationOnce(async () => ({ path: PATH, strokes: [s('a'), s('b'), s('d')], revision: 'r5' }))

    act(() => result.current.save([s('a'), s('c')]))
    await advance(400)
    await settle()
    expect(client.load).toHaveBeenCalledTimes(2) // the initial load and one reload
    expect(client.save).toHaveBeenCalledTimes(2)
    const [, merged, base] = client.save.mock.calls[1]
    expect(base).toBe('r5')
    expect(merged.map((x) => x.id)).toEqual(['a', 'd', 'c'])
    expect(result.current.strokes!.map((x) => x.id)).toEqual(['a', 'd', 'c'])

    // The next save goes against the merged save's revision.
    act(() => result.current.save([...merged, s('e')]))
    await advance(400)
    await settle()
    expect(client.save.mock.calls[2][2]).toBe('r6')
  })

  test('a failed ink save reports it, keeps the strokes and retries with a growing delay', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const client = fakeClient({ path: PATH, strokes: [], revision: 'r1' })
    const { result } = renderHook(() => useInkDoc(PATH, client))
    await settle()
    client.save.mockRejectedValue(new ApiError(500, 'down'))
    act(() => result.current.save([s('a')]))
    await advance(400)
    await settle()
    expect(client.save).toHaveBeenCalledTimes(1)
    expect(result.current.saveError).toBe('Could not save the ink. down')
    expect(result.current.strokes).toEqual([s('a')])
    // Retries back off and stop; flush gives up instead of spinning.
    await advance(10 * 60_000)
    const calls = client.save.mock.calls.length
    expect(calls).toBeGreaterThan(1)
    expect(calls).toBeLessThanOrEqual(6)
    await act(async () => {
      await result.current.flush()
    })
    // Once the server is back, the next save carries the strokes that failed.
    client.save.mockResolvedValue({ revision: 'r2' })
    act(() => result.current.save([s('a'), s('b')]))
    await advance(400)
    await settle()
    expect(client.save.mock.calls.at(-1)![1]).toEqual([s('a'), s('b')])
    expect(result.current.saveError).toBeNull()
  })

  test('a failed ink save is retried with the same strokes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const client = fakeClient({ path: PATH, strokes: [], revision: 'r1' })
    const { result } = renderHook(() => useInkDoc(PATH, client))
    await settle()
    client.save.mockRejectedValueOnce(new ApiError(500, 'down'))
    act(() => result.current.save([s('a')]))
    await advance(400)
    await settle()
    await advance(60_000)
    await settle()
    expect(client.save).toHaveBeenCalledTimes(2)
    expect(client.save.mock.calls[1]).toEqual([PATH, [s('a')], 'r1'])
  })

  test('strokes drawn before the ink file loads are kept and saved', async () => {
    const client = fakeClient({ path: PATH, strokes: [s('a')], revision: 'r1' })
    const load = deferred<InkResponse>()
    client.load.mockImplementationOnce(() => load.promise)
    const { result } = renderHook(() => useInkDoc(PATH, client))
    act(() => result.current.save([s('b')]))
    expect(result.current.strokes).toEqual([s('b')])
    await act(async () => load.resolve({ path: PATH, strokes: [s('a')], revision: 'r1' }))
    await settle()
    expect(result.current.strokes!.map((x) => x.id)).toEqual(['a', 'b'])
    await advance(400)
    await settle()
    expect(client.save).toHaveBeenCalledTimes(1)
    expect(client.save.mock.calls[0]).toEqual([PATH, [s('a'), s('b')], 'r1'])
  })

  test('a second 409 reloads and keeps the server copy', async () => {
    const client = fakeClient({ path: PATH, strokes: [s('a')], revision: 'r1' })
    const { result } = renderHook(() => useInkDoc(PATH, client))
    await settle()
    client.save.mockImplementation(async () => {
      throw new RevisionConflictError('rX')
    })
    client.load.mockImplementation(async () => ({ path: PATH, strokes: [s('z')], revision: 'r9' }))
    act(() => result.current.save([s('a'), s('b')]))
    await advance(400)
    await settle()
    expect(client.save).toHaveBeenCalledTimes(2)
    expect(client.load).toHaveBeenCalledTimes(3)
    expect(result.current.strokes).toEqual([s('z')])
  })

  test('external whiteboard event reloads when nothing is pending', async () => {
    const client = fakeClient({ path: PATH, strokes: [s('a')], revision: 'r1' })
    const { result } = renderHook(() => useInkDoc(PATH, client))
    await settle()
    expect(listeners).toHaveLength(1)

    // Another board's event, or another kind: ignored.
    client.load.mockImplementation(async () => ({ path: PATH, strokes: [s('a'), s('x')], revision: 'r2' }))
    await act(async () => listeners[0]({ kind: 'whiteboard' as ChangeEvent['kind'], path: 'Whiteboards/Other.md', version: 'q' }))
    await act(async () => listeners[0]({ kind: 'changed', path: PATH, version: 'q' }))
    await settle()
    expect(client.load).toHaveBeenCalledTimes(1)

    await act(async () => listeners[0]({ kind: 'whiteboard' as ChangeEvent['kind'], path: PATH, version: 'r2' }))
    await settle()
    expect(client.load).toHaveBeenCalledTimes(2)
    expect(result.current.strokes!.map((x) => x.id)).toEqual(['a', 'x'])

    // With a save pending, an external event does not reload.
    act(() => result.current.save([s('a'), s('x'), s('y')]))
    await act(async () => listeners[0]({ kind: 'whiteboard' as ChangeEvent['kind'], path: PATH, version: 'r3' }))
    await settle()
    expect(client.load).toHaveBeenCalledTimes(2)
    expect(result.current.strokes!.map((x) => x.id)).toEqual(['a', 'x', 'y'])
  })
})
