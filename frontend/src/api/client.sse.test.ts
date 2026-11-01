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
})
