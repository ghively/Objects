import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, CLIENT_ID, ConflictError } from '@/api/client'
import { AUTOSAVE_DELAY_MS, AUTOSAVE_MAX_WAIT_MS, KEEPALIVE_MAX_BYTES, useAutosave } from './useAutosave'

type Call = [path: string, body: string, version: string]

/** `saveBody` that records each call and resolves only when released. */
function deferredSaves() {
  const calls: Call[] = []
  const releases: (() => void)[] = []
  vi.mocked(api.saveBody).mockImplementation((path: string, body: string, version: string) => {
    calls.push([path, body, version])
    const n = calls.length
    return new Promise((res) => releases.push(() => res({ version: 'v' + n } as never)))
  })
  return { calls, release: (i: number) => releases[i]() }
}

const settleMicrotasks = () => act(async () => new Promise((r) => setTimeout(r, 10)))

beforeEach(() => {
  vi.mocked(api.saveBody).mockReset()
})

describe('edits made while a save is in flight', () => {
  test('are saved to the old object after switching to another one', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A1'
    const { result, rerender } = renderHook(
      (p: { path: string }) =>
        useAutosave({ path: p.path, version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
      { initialProps: { path: 'a.md' } },
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    body = 'A2' // more typing while A1 is being saved
    await act(async () => {
      void result.current.flush('a.md') // the editor's cleanup when leaving a.md
    })
    rerender({ path: 'b.md' })
    body = 'B0'
    act(() => result.current.markLoaded('B0', 'w0'))
    await act(async () => {
      saves.release(0)
    })
    await settleMicrotasks()
    expect(saves.calls).toEqual([
      ['a.md', 'A1', 'v0'],
      ['a.md', 'A2', 'v1'],
    ])
    await act(async () => {
      saves.release(1)
      await first
    })
  })

  test('are saved after the editor unmounts', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A1'
    const { result, unmount } = renderHook(() =>
      useAutosave({ path: 'a.md', version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    body = 'A2'
    await act(async () => {
      void result.current.flush('a.md')
    })
    unmount()
    body = null // the editor is destroyed
    await act(async () => {
      saves.release(0)
    })
    await settleMicrotasks()
    expect(saves.calls).toEqual([
      ['a.md', 'A1', 'v0'],
      ['a.md', 'A2', 'v1'],
    ])
    await act(async () => {
      saves.release(1)
      await first
    })
  })

  test('on the same object are saved once the first save ends', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A1'
    const { result } = renderHook(() =>
      useAutosave({ path: 'a.md', version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    body = 'A2'
    await act(async () => {
      void result.current.flush()
    })
    body = 'A3' // typed after the queued flush: the latest text is what gets saved
    await act(async () => {
      saves.release(0)
    })
    await settleMicrotasks()
    expect(saves.calls).toEqual([
      ['a.md', 'A1', 'v0'],
      ['a.md', 'A3', 'v1'],
    ])
    await act(async () => {
      saves.release(1)
      await first
    })
  })
})

describe('a save that fails after the editor left', () => {
  test('keeps the text queued while it was in flight, not the older in-flight text', async () => {
    const { keptUnsaved, resetUnsaved } = await import('./unsaved')
    resetUnsaved()
    let reject!: (e: unknown) => void
    vi.mocked(api.saveBody).mockImplementation(() => new Promise((_res, rej) => (reject = rej)))
    let body: string | null = 'A1'
    const { result, rerender } = renderHook(
      (p: { path: string }) =>
        useAutosave({ path: p.path, version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
      { initialProps: { path: 'a.md' } },
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    body = 'A2'
    await act(async () => {
      void result.current.leave('a.md')
    })
    rerender({ path: 'b.md' })
    body = 'B0'
    await act(async () => {
      reject(new Error('server gone'))
      await first
    })
    expect(keptUnsaved('a.md')).toBe('A2')
    resetUnsaved()
  })
})

describe('saveState (M32 contract)', () => {
  test('test saveState goes saved, unsaved, saving, saved', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A0'
    const { result } = renderHook(() =>
      useAutosave({ path: 'a.md', version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    expect(result.current.saveState).toBe('saved')

    body = 'A1'
    act(() => result.current.schedule())
    expect(result.current.saveState).toBe('unsaved')

    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    expect(result.current.saveState).toBe('saving')

    await act(async () => {
      saves.release(0)
      await first
    })
    expect(result.current.saveState).toBe('saved')
    expect(result.current.saveError).toBeNull()
  })

  test('test saveState stays unsaved when more was typed while the save ran', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A1'
    const { result } = renderHook(() =>
      useAutosave({ path: 'a.md', version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    body = 'A2'
    act(() => result.current.schedule()) // a key during the save: the 1 s wait starts again
    expect(result.current.saveState).toBe('saving')
    await act(async () => {
      saves.release(0)
      await first
    })
    expect(result.current.saveState).toBe('unsaved')
    act(() => result.current.cancel())
  })

  test('test saveState is error while a save has failed, and saved after a load', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(api.saveBody).mockRejectedValue(new Error('server gone'))
    const body: string | null = 'A1'
    const { result } = renderHook(() =>
      useAutosave({ path: 'a.md', version: 'v0', readOnly: false, getBody: () => body, onSaved: () => {} }),
    )
    act(() => result.current.markLoaded('A0', 'v0'))
    await act(async () => {
      await result.current.flush()
    })
    expect(result.current.saveError).not.toBeNull()
    expect(result.current.saveState).toBe('error')
    // A reload from disk: the retry is dropped and what shows is what is saved.
    act(() => result.current.markLoaded('A1', 'v1'))
    expect(result.current.saveState).toBe('saved')
    quiet.mockRestore()
  })
})

// M32 item 1, "saving you can trust": the max wait, the flush triggers, no lost typing, no double save.
describe('saving you can trust (M32)', () => {
  type Opts = { path: string }
  const hook = (getBody: () => string | null, extra: Partial<Parameters<typeof useAutosave>[0]> = {}) =>
    renderHook(
      (p: Opts) => useAutosave({ path: p.path, version: 'v0', readOnly: false, getBody, onSaved: () => {}, ...extra }),
      { initialProps: { path: 'a.md' } },
    )

  /** A `fetch` that records each call and answers when released. */
  function deferredFetch() {
    const calls: { url: string; init: RequestInit }[] = []
    const answers: ((status: number, data: unknown) => void)[] = []
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Promise<Response>((res) =>
        answers.push((status, data) =>
          res({ ok: status >= 200 && status < 300, status, statusText: '', json: async () => data } as Response),
        ),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    return { calls, answer: (i: number, status: number, data: unknown) => answers[i](status, data), fetchMock }
  }

  const setVisibility = (state: 'hidden' | 'visible') =>
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setVisibility('visible')
  })

  test('test max wait saves 3 s after the first unsaved key while typing continues', async () => {
    vi.useFakeTimers()
    const saves = deferredSaves()
    let body: string | null = 'A0'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    // A key every 500 ms: the 1 s wait never runs out.
    for (let i = 1; i <= 5; i++) {
      body = 'A' + i
      act(() => result.current.schedule())
      await act(async () => vi.advanceTimersByTime(500))
    }
    expect(saves.calls).toEqual([]) // 2.5 s in
    body = 'A6'
    act(() => result.current.schedule())
    await act(async () => vi.advanceTimersByTime(AUTOSAVE_MAX_WAIT_MS - 2500))
    expect(saves.calls).toEqual([['a.md', 'A6', 'v0']])
    await act(async () => {
      saves.release(0)
    })
    await act(async () => vi.advanceTimersByTime(5000))
    expect(saves.calls).toHaveLength(1) // nothing typed since: no second save
    expect(result.current.saveState).toBe('saved')
  })

  test('test the max wait starts again with the first key after a save', async () => {
    vi.useFakeTimers()
    vi.mocked(api.saveBody).mockImplementation(async (_p: string, _b: string, v: string) => ({ version: v + '+' }) as never)
    let body: string | null = 'A0'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    for (let i = 1; i <= 13; i++) {
      body = 'A' + i
      act(() => result.current.schedule())
      await act(async () => vi.advanceTimersByTime(500))
    }
    // 6.5 s of typing: saved at 3 s and at 6 s (the second wait starts with the key at 3 s).
    expect(vi.mocked(api.saveBody).mock.calls.map((c) => c[1])).toEqual(['A6', 'A12'])
    act(() => result.current.cancel())
  })

  test('test a pause still saves 1 s after the last key', async () => {
    vi.useFakeTimers()
    const saves = deferredSaves()
    let body: string | null = 'A0'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    act(() => result.current.schedule())
    await act(async () => vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1))
    expect(saves.calls).toEqual([])
    await act(async () => vi.advanceTimersByTime(1))
    expect(saves.calls).toEqual([['a.md', 'A1', 'v0']])
    await act(async () => {
      saves.release(0)
    })
    // The max wait of that burst is spent with it: nothing fires at 3 s.
    await act(async () => vi.advanceTimersByTime(AUTOSAVE_MAX_WAIT_MS))
    expect(saves.calls).toHaveLength(1)
  })

  test('test pagehide saves at once with a keepalive request', async () => {
    const net = deferredFetch()
    const onSaved = vi.fn()
    let body: string | null = 'A0'
    const { result } = hook(() => body, { onSaved })
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    act(() => result.current.schedule())
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(api.saveBody).not.toHaveBeenCalled()
    expect(net.calls).toHaveLength(1)
    expect(net.calls[0].url).toBe('/api/object/body')
    expect(net.calls[0].init).toMatchObject({
      method: 'PUT',
      keepalive: true,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    })
    expect(JSON.parse(String(net.calls[0].init.body))).toEqual({ path: 'a.md', body: 'A1', baseVersion: 'v0', clientId: CLIENT_ID })
    expect(result.current.saveState).toBe('saving')
    expect(result.current.isPending()).toBe(false) // the timed save was dropped: one request, not two
    // The page lived on (a false alarm, or it came back): the answer is taken like any save's.
    await act(async () => {
      net.answer(0, 200, { version: 'v1' })
    })
    await settleMicrotasks()
    expect(onSaved).toHaveBeenCalledWith('v1')
    expect(result.current.saveState).toBe('saved')
    expect(result.current.isDirty()).toBe(false)
    // The next save builds on the version the keepalive save returned.
    const saves = deferredSaves()
    body = 'A2'
    await act(async () => {
      void result.current.flush()
    })
    expect(saves.calls).toEqual([['a.md', 'A2', 'v1']])
  })

  test('test pagehide keeps the unsaved text for the next open until its save lands', async () => {
    const { keptUnsaved } = await import('./unsaved')
    const net = deferredFetch()
    let body: string | null = 'A0'
    const { result } = hook(() => body, { objectId: 'id-a' })
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(keptUnsaved('a.md', 'id-a')).toBe('A1')
    await act(async () => {
      net.answer(0, 200, { version: 'v1' })
    })
    await settleMicrotasks()
    expect(keptUnsaved('a.md', 'id-a')).toBeNull()
  })

  test('test pagehide with a body over the keepalive limit uses the normal request', async () => {
    const net = deferredFetch()
    const saves = deferredSaves()
    const big = 'é'.repeat(KEEPALIVE_MAX_BYTES / 2) // 2 bytes each: the JSON is over the limit
    const body: string | null = big
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(net.calls).toHaveLength(0)
    expect(saves.calls).toEqual([['a.md', big, 'v0']])
  })

  test('test a conflict answered to the pagehide save pauses saving and reports it', async () => {
    const net = deferredFetch()
    const onConflict = vi.fn()
    let body: string | null = 'A0'
    const { result } = hook(() => body, { onConflict })
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await act(async () => {
      net.answer(0, 409, { currentVersion: 'v9' })
    })
    await settleMicrotasks()
    expect(onConflict).toHaveBeenCalledWith('v9')
    expect(result.current.saveState).toBe('unsaved')
    // Paused: nothing more is sent until the conflict is resolved.
    await act(async () => {
      await result.current.flush()
    })
    expect(net.calls).toHaveLength(1)
    expect(api.saveBody).not.toHaveBeenCalled()
  })

  test('test the document becoming hidden saves at once', async () => {
    const net = deferredFetch()
    let body: string | null = 'A0'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    act(() => result.current.schedule())
    // Becoming visible again saves nothing.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(net.calls).toHaveLength(0)
    setVisibility('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(net.calls).toHaveLength(1)
    expect(JSON.parse(String(net.calls[0].init.body))).toMatchObject({ path: 'a.md', body: 'A1', baseVersion: 'v0' })
    // Closing a window says hidden, then pagehide: still one request.
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(net.calls).toHaveLength(1)
    await act(async () => {
      net.answer(0, 200, { version: 'v1' })
    })
    await settleMicrotasks()
    expect(net.calls).toHaveLength(1)
    expect(api.saveBody).not.toHaveBeenCalled()
    expect(result.current.saveState).toBe('saved')
  })

  test('test window blur saves at once', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A0'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    act(() => result.current.schedule())
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(saves.calls).toEqual([['a.md', 'A1', 'v0']])
    expect(result.current.isPending()).toBe(false)
  })

  test('test leaving a note saves it at once under its own path', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A0'
    const { result, rerender } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    act(() => result.current.schedule())
    await act(async () => {
      void result.current.leave('a.md') // the editor's cleanup on a note or tab switch, and on unmount
    })
    rerender({ path: 'b.md' })
    expect(saves.calls).toEqual([['a.md', 'A1', 'v0']])
  })

  test('test a flush with nothing unsaved sends nothing', async () => {
    const net = deferredFetch()
    const saves = deferredSaves()
    const body: string | null = 'A0'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
      window.dispatchEvent(new Event('blur'))
      setVisibility('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      await result.current.flush()
      await result.current.leave('a.md')
    })
    expect(net.calls).toHaveLength(0)
    expect(saves.calls).toHaveLength(0)
    expect(result.current.saveState).toBe('saved')
  })

  test('test a flush trigger before the note has loaded sends nothing', async () => {
    const net = deferredFetch()
    const saves = deferredSaves()
    const { result } = hook(() => '') // an editor not loaded yet reads as empty
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
      window.dispatchEvent(new Event('blur'))
    })
    expect(net.calls).toHaveLength(0)
    expect(saves.calls).toHaveLength(0)
    expect(result.current.saveState).toBe('saved')
  })

  test('test a read-only note is never saved by a flush trigger', async () => {
    const net = deferredFetch()
    const saves = deferredSaves()
    const { result } = hook(() => 'A1', { readOnly: true })
    act(() => result.current.markLoaded('A0', 'v0'))
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
      window.dispatchEvent(new Event('blur'))
    })
    expect(net.calls).toHaveLength(0)
    expect(saves.calls).toHaveLength(0)
  })

  test('test flush triggers while a save is in flight send one more save with the latest text', async () => {
    const net = deferredFetch()
    const saves = deferredSaves()
    let body: string | null = 'A1'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    body = 'A2'
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
      setVisibility('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pagehide'))
    })
    // Nothing is sent beside the save in flight (a second request on the same version would conflict).
    expect(saves.calls).toHaveLength(1)
    expect(net.calls).toHaveLength(0)
    await act(async () => {
      saves.release(0)
    })
    await settleMicrotasks()
    expect(saves.calls).toEqual([
      ['a.md', 'A1', 'v0'],
      ['a.md', 'A2', 'v1'],
    ])
    await act(async () => {
      saves.release(1)
      await first
    })
    await settleMicrotasks()
    expect(saves.calls).toHaveLength(2)
    expect(net.calls).toHaveLength(0)
    expect(result.current.saveState).toBe('saved')
  })

  test('test pagehide while a save is in flight keeps the newer text for the next open', async () => {
    const { keptUnsaved } = await import('./unsaved')
    deferredFetch()
    deferredSaves()
    let body: string | null = 'A1'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    await act(async () => {
      void result.current.flush()
    })
    body = 'A2'
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    // The page may be gone before the save in flight answers: the queued save could never run.
    expect(keptUnsaved('a.md')).toBe('A2')
  })

  test('test a flush trigger with the same text as the save in flight sends nothing more', async () => {
    const saves = deferredSaves()
    const body: string | null = 'A1'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
      void result.current.flush()
    })
    await act(async () => {
      saves.release(0)
      await first
    })
    await settleMicrotasks()
    expect(saves.calls).toEqual([['a.md', 'A1', 'v0']])
  })

  test('test a save queued for a note that was left is not dropped by a flush on the next note', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A1'
    const { result, rerender } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    await act(async () => {
      void result.current.flush() // A1 in flight (slow)
    })
    body = 'A2'
    await act(async () => {
      void result.current.leave('a.md')
    })
    rerender({ path: 'b.md' })
    body = 'B0'
    act(() => result.current.markLoaded('B0', 'w0'))
    body = 'B1'
    await act(async () => {
      window.dispatchEvent(new Event('blur')) // a flush on b.md while a.md is still being saved
    })
    await act(async () => {
      saves.release(0)
    })
    await settleMicrotasks()
    expect(saves.calls).toEqual([
      ['a.md', 'A1', 'v0'],
      ['a.md', 'A2', 'v1'],
    ])
    await act(async () => {
      saves.release(1)
    })
    await settleMicrotasks()
    expect(saves.calls[2]).toEqual(['b.md', 'B1', 'w0'])
    await act(async () => {
      saves.release(2)
    })
    await settleMicrotasks()
    expect(saves.calls).toHaveLength(3)
    expect(result.current.saveState).toBe('saved')
  })

  test('test saveState is unsaved for keys on a note while the note before it is still being saved', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A1'
    const { result, rerender } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    await act(async () => {
      void result.current.leave('a.md')
    })
    rerender({ path: 'b.md' })
    body = 'B0'
    act(() => result.current.markLoaded('B0', 'w0'))
    expect(result.current.saveState).toBe('saved')
    body = 'B1'
    act(() => result.current.schedule())
    expect(result.current.saveState).toBe('unsaved')
    await act(async () => {
      saves.release(0)
    })
    await settleMicrotasks()
    expect(result.current.saveState).toBe('unsaved') // a.md's save ending says nothing about b.md
    act(() => result.current.cancel())
  })

  test('test saveState is saved again when the edit was undone during the save', async () => {
    const saves = deferredSaves()
    let body: string | null = 'A1'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.flush()
    })
    body = 'A2'
    act(() => result.current.schedule())
    body = 'A1' // typed and deleted again while A1 was being saved
    act(() => result.current.schedule())
    await act(async () => {
      saves.release(0)
      await first
    })
    expect(result.current.saveState).toBe('saved')
    act(() => result.current.cancel())
  })

  test('test saveState after a conflict: unsaved while paused, saved once resumed with nothing to write', async () => {
    vi.mocked(api.saveBody).mockRejectedValue(new ConflictError('v9'))
    let body: string | null = 'A1'
    const { result } = hook(() => body, { onConflict: () => {} })
    act(() => result.current.markLoaded('A0', 'v0'))
    await act(async () => {
      await result.current.flush()
    })
    expect(result.current.saveState).toBe('unsaved')
    body = 'A0' // the owner took the other side's text
    act(() => {
      void result.current.resume('v9')
    })
    expect(result.current.saveState).toBe('saved')
  })
})

