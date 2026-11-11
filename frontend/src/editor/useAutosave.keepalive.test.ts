// The M32 review, F2: on a real close the events come as editor blur, window blur, hidden,
// pagehide. The first two used to start a plain request and the keepalive ask of the last two was
// queued behind it and later sent plain too, so the save died with the page. Every body save that
// fits is now a request that outlives the page. These tests run the hook against the real client
// (only `fetch` is a stand-in), so they see what is sent.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_ID, KEEPALIVE_MAX_BYTES } from '@/api/client'
import { keptUnsaved, resetUnsaved, setUnsavedSpace } from './unsaved'
import { useAutosave } from './useAutosave'

type Sent = { url: string; init: RequestInit; json: { path: string; body: string; baseVersion: string; clientId: string } }

/** A `fetch` that records each request and answers when told to. */
function deferredFetch() {
  const sent: Sent[] = []
  const answers: ((status: number, data: unknown) => void)[] = []
  const fails: ((err: Error) => void)[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, init, json: JSON.parse(String(init.body)) })
      return new Promise<Response>((res, rej) => {
        answers.push((status, data) => res(new Response(JSON.stringify(data), { status })))
        fails.push(rej)
      })
    }),
  )
  /** How many requests have no answer yet. */
  let open = 0
  const track = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
    open -= 1
    fn(...a)
  }
  return {
    sent,
    inFlight: () => sent.length + open,
    answer: (i: number, status: number, data: unknown) => track(answers[i])(status, data),
    fail: (i: number, err: Error) => track(fails[i])(err),
  }
}

const tick = () => act(async () => new Promise((r) => setTimeout(r, 10)))
const setVisibility = (state: 'hidden' | 'visible') =>
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })

const hook = (getBody: () => string | null, extra: Partial<Parameters<typeof useAutosave>[0]> = {}) =>
  renderHook(() => useAutosave({ path: 'a.md', version: 'v0', readOnly: false, getBody, onSaved: () => {}, objectId: 'id-a', ...extra }))

beforeEach(() => {
  localStorage.clear()
  setUnsavedSpace('/s')
  resetUnsaved()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setVisibility('visible')
})

describe('every body save that fits outlives the page', () => {
  test.each([
    ['the editor losing focus (a plain flush)', (r: ReturnType<typeof hook>['result']) => void r.current.flush()],
    ['the window losing focus', () => void window.dispatchEvent(new Event('blur'))],
    ['pagehide', () => void window.dispatchEvent(new Event('pagehide'))],
    [
      'the document becoming hidden',
      () => {
        setVisibility('hidden')
        document.dispatchEvent(new Event('visibilitychange'))
      },
    ],
  ])('test the save sent on %s is a keepalive request', async (_name, trigger) => {
    const net = deferredFetch()
    let body: string | null = 'A0'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    await act(async () => trigger(result))
    expect(net.sent).toHaveLength(1)
    expect(net.sent[0].url).toBe('/api/object/body')
    expect(net.sent[0].init).toMatchObject({ method: 'PUT', keepalive: true })
    expect(net.sent[0].json).toEqual({ path: 'a.md', body: 'A1', baseVersion: 'v0', clientId: CLIENT_ID })
  })

  test('test the timed save is a keepalive request too', async () => {
    vi.useFakeTimers()
    try {
      const net = deferredFetch()
      let body: string | null = 'A0'
      const { result } = hook(() => body)
      act(() => result.current.markLoaded('A0', 'v0'))
      body = 'A1'
      act(() => result.current.schedule())
      await act(async () => vi.advanceTimersByTime(1000))
      expect(net.sent).toHaveLength(1)
      expect(net.sent[0].init.keepalive).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  // A real close: editor blur, window blur, hidden, pagehide, with nothing typed in between.
  test('test a close sends the text once, in the request the first event started', async () => {
    const net = deferredFetch()
    let body: string | null = 'A0'
    const onSaved = vi.fn()
    const { result } = hook(() => body, { onSaved })
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    await act(async () => {
      void result.current.flush() // the editor's blur
      window.dispatchEvent(new Event('blur'))
      setVisibility('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pagehide'))
    })
    // One request, already one that outlives the page; nothing waits behind it for an answer
    // the closing page would never read.
    expect(net.sent).toHaveLength(1)
    expect(net.sent[0].init.keepalive).toBe(true)
    expect(net.sent[0].json.body).toBe('A1')
    // Kept for the next open until the answer is read (a page that is gone never reads it).
    expect(keptUnsaved('a.md', 'id-a')).toBe('A1')
    // The page lived on: the answer is taken, nothing more is sent, and the kept text goes.
    await act(async () => net.answer(0, 200, { version: 'v1' }))
    await tick()
    expect(net.sent).toHaveLength(1)
    expect(onSaved).toHaveBeenCalledWith('v1')
    expect(result.current.saveState).toBe('saved')
    expect(keptUnsaved('a.md', 'id-a')).toBeNull()
  })

  // The order the finding names: a save is in flight (the blur's, or the timed one), more is
  // typed, then the page goes.
  test('test blur save in flight, then pagehide: the save queued behind it is a keepalive request with the latest text', async () => {
    const net = deferredFetch()
    let body: string | null = 'A0'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    await act(async () => void window.dispatchEvent(new Event('blur')))
    expect(net.sent).toHaveLength(1)
    body = 'A2'
    await act(async () => {
      setVisibility('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pagehide'))
    })
    // At most one save in flight for the note: a second on the same version would conflict.
    expect(net.sent).toHaveLength(1)
    expect(net.inFlight()).toBe(1)
    // Should the page die before the first answer, the newer text is kept for the next open.
    expect(keptUnsaved('a.md', 'id-a')).toBe('A2')
    await act(async () => net.answer(0, 200, { version: 'v1' }))
    await tick()
    // The first save landing does not forget the newer text: its own save has yet to land.
    expect(keptUnsaved('a.md', 'id-a')).toBe('A2')
    expect(net.sent).toHaveLength(2)
    expect(net.sent[1].init.keepalive).toBe(true)
    expect(net.sent[1].json).toEqual({ path: 'a.md', body: 'A2', baseVersion: 'v1', clientId: CLIENT_ID })
    expect(net.inFlight()).toBe(1)
    await act(async () => net.answer(1, 200, { version: 'v2' }))
    await tick()
    expect(net.sent).toHaveLength(2)
    expect(keptUnsaved('a.md', 'id-a')).toBeNull()
    expect(result.current.saveState).toBe('saved')
  })

  test('test a conflict answered to the queued save keeps the text and reports it', async () => {
    const net = deferredFetch()
    const onConflict = vi.fn()
    let body: string | null = 'A0'
    const { result } = hook(() => body, { onConflict })
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    await act(async () => void window.dispatchEvent(new Event('blur')))
    body = 'A2'
    await act(async () => void window.dispatchEvent(new Event('pagehide')))
    await act(async () => net.answer(0, 200, { version: 'v1' }))
    await tick()
    await act(async () => net.answer(1, 409, { detail: { currentVersion: 'v9' } }))
    await tick()
    expect(onConflict).toHaveBeenCalledWith('v9')
    expect(keptUnsaved('a.md', 'id-a')).toBe('A2')
    expect(result.current.isDirty()).toBe(true)
    expect(result.current.saveState).toBe('unsaved')
    // Paused: nothing more is sent until the conflict is resolved.
    await act(async () => void window.dispatchEvent(new Event('pagehide')))
    expect(net.sent).toHaveLength(2)
  })

  test('test a conflict answered to the first save keeps the newer text', async () => {
    const net = deferredFetch()
    const onConflict = vi.fn()
    let body: string | null = 'A0'
    const { result } = hook(() => body, { onConflict })
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    await act(async () => void window.dispatchEvent(new Event('blur')))
    body = 'A2'
    await act(async () => void window.dispatchEvent(new Event('pagehide')))
    await act(async () => net.answer(0, 409, { detail: { currentVersion: 'v9' } }))
    await tick()
    expect(onConflict).toHaveBeenCalledWith('v9')
    expect(net.sent).toHaveLength(1) // nothing is written over the other side's change
    expect(keptUnsaved('a.md', 'id-a')).toBe('A2')
  })

  test('test a save that fails keeps the text, and the retry is a keepalive request', async () => {
    vi.useFakeTimers()
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const net = deferredFetch()
      let body: string | null = 'A0'
      const { result } = hook(() => body)
      act(() => result.current.markLoaded('A0', 'v0'))
      body = 'A1'
      await act(async () => void window.dispatchEvent(new Event('pagehide')))
      await act(async () => {
        net.fail(0, new TypeError('Failed to fetch'))
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.saveState).toBe('error')
      expect(keptUnsaved('a.md', 'id-a')).toBe('A1')
      await act(async () => vi.advanceTimersByTimeAsync(2000))
      expect(net.sent).toHaveLength(2)
      expect(net.sent[1].init.keepalive).toBe(true)
      expect(net.sent[1].json).toMatchObject({ body: 'A1', baseVersion: 'v0' })
    } finally {
      quiet.mockRestore()
      vi.useRealTimers()
    }
  })

  test('test a note over the keepalive limit goes as a plain request and is kept for the next open', async () => {
    const net = deferredFetch()
    const big = 'é'.repeat(KEEPALIVE_MAX_BYTES / 2) // 2 bytes each: the JSON is over the limit
    let body: string | null = 'A0'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    body = big
    await act(async () => void window.dispatchEvent(new Event('pagehide')))
    expect(net.sent).toHaveLength(1)
    expect(net.sent[0].init.keepalive).toBeUndefined()
    // The page may cut that request off: the text is there for the next open.
    expect(keptUnsaved('a.md', 'id-a')).toBe(big)
    expect(JSON.parse(localStorage.getItem('object.unsaved:/s\na.md') ?? 'null')).toMatchObject({ body: big })
  })

  test('test an edit undone while its save waited leaves nothing kept', async () => {
    const net = deferredFetch()
    let body: string | null = 'A0'
    const { result } = hook(() => body)
    act(() => result.current.markLoaded('A0', 'v0'))
    body = 'A1'
    await act(async () => void window.dispatchEvent(new Event('blur')))
    body = 'A2'
    await act(async () => void window.dispatchEvent(new Event('pagehide')))
    expect(keptUnsaved('a.md', 'id-a')).toBe('A2')
    body = 'A1' // undone before the first save answers
    await act(async () => net.answer(0, 200, { version: 'v1' }))
    await tick()
    // Nothing more to write, and what was kept is not what the note holds: it is not offered.
    expect(net.sent).toHaveLength(1)
    expect(keptUnsaved('a.md', 'id-a')).toBeNull()
  })
})
