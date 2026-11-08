// The SSE stream (`api.onChange`) with a fake `EventSource`: own echoes dropped, bad frames
// ignored, and a resync after the connection dropped and came back (audit 2026-11-01 #15).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent } from './types'

type Listener = (e: unknown) => void

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  listeners = new Map<string, Set<Listener>>()
  onopen: Listener | null = null
  onerror: Listener | null = null
  closed = false
  /** 0 connecting, 1 open, 2 closed (the browser gave up). */
  readyState = 0
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(cb)
  }
  removeEventListener(type: string, cb: Listener) {
    this.listeners.get(type)?.delete(cb)
  }
  dispatch(type: string, data?: string) {
    for (const cb of this.listeners.get(type) ?? []) cb({ data })
    if (type === 'open') this.onopen?.({})
    if (type === 'error') this.onerror?.({})
  }
  close() {
    this.closed = true
  }
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function fresh() {
  const mod = await import('./client')
  const seen: ChangeEvent[] = []
  const off = mod.api.onChange((e) => seen.push(e))
  const es = FakeEventSource.instances[0]
  expect(es).toBeDefined()
  return { ...mod, seen, off, es }
}

describe('api.onChange over SSE', () => {
  test('own-origin echoes and malformed frames are dropped; foreign events pass', async () => {
    const { CLIENT_ID, seen, es } = await fresh()
    es.dispatch('change', JSON.stringify({ kind: 'changed', path: 'a.md', version: 'v2', origin: CLIENT_ID }))
    es.dispatch('change', JSON.stringify({ kind: 'changed', path: 'b.md', version: 'v2', origin: 'other' }))
    es.dispatch('change', 'not json')
    expect(seen).toEqual([{ kind: 'changed', path: 'b.md', version: 'v2', origin: 'other' }])
  })

  test('the first open is not a resync', async () => {
    const { seen, es } = await fresh()
    es.dispatch('open')
    expect(seen).toEqual([])
  })

  test('after the stream dropped and reconnected, every consumer kind gets a synthetic event', async () => {
    const { CLIENT_ID, seen, es } = await fresh()
    // The server restarts (or the laptop sleeps): the browser fires error, then reconnects (open).
    es.dispatch('error')
    expect(seen).toEqual([])
    es.dispatch('open')
    // One event per kind the hooks listen for, from no window of ours, so every consumer reloads.
    const kinds = seen.map((e) => e.kind)
    expect(kinds).toEqual(expect.arrayContaining(['types', 'views', 'ui', 'collections', 'queries']))
    expect(seen.find((e) => e.kind === 'types')?.path).toBe('*')
    // Review fix 2026-11-01 #3: a type page's saved views resync too.
    expect(seen.find((e) => e.kind === 'views')?.path).toBe('*')
    for (const e of seen) {
      expect(e.origin).not.toBe(CLIENT_ID)
      expect(e.version).toBeNull()
    }
    // A reconnect that follows no drop (the first open) and a second open do not repeat it.
    const n = seen.length
    es.dispatch('open')
    expect(seen).toHaveLength(n)
    // A second drop resyncs again.
    es.dispatch('error')
    es.dispatch('open')
    expect(seen).toHaveLength(n * 2)
  })

  test('closing the last subscription closes the stream; the next one reopens it', async () => {
    const { api, es, off } = await fresh()
    off()
    expect(es.closed).toBe(true)
    api.onChange(() => undefined)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  // Audit 2026-11-07 #39: when the browser closes the stream for good (readyState CLOSED), it is
  // made again after a growing wait, and its open resyncs every consumer.
  test('a stream the browser closed is made again with backoff, and its open resyncs', async () => {
    vi.useFakeTimers()
    const { seen, es, off } = await fresh()
    es.readyState = 2
    es.dispatch('error')
    expect(es.closed).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeEventSource.instances).toHaveLength(2)
    // Closed again before it opened: the wait doubles.
    const es2 = FakeEventSource.instances[1]
    es2.readyState = 2
    es2.dispatch('error')
    es2.dispatch('error')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeEventSource.instances).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeEventSource.instances).toHaveLength(3)
    expect(seen).toEqual([])
    // The stream that opens resyncs every consumer, once.
    const es3 = FakeEventSource.instances[2]
    es3.dispatch('open')
    expect(seen.find((e) => e.kind === 'types')?.path).toBe('*')
    const n = seen.length
    expect(n).toBeGreaterThan(0)
    es3.dispatch('open')
    expect(seen).toHaveLength(n)
    // A drop the browser retries itself (not CLOSED) makes no new stream.
    es3.readyState = 0
    es3.dispatch('error')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeEventSource.instances).toHaveLength(3)
    // With no subscriber left, a closed stream is not made again.
    es3.readyState = 2
    es3.dispatch('error')
    off()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeEventSource.instances).toHaveLength(3)
  })
})
