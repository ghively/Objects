// Perf audit scratch: App startup with 50 types / 5,000 objects / 100 pins, and one SSE `changed` event.
import { writeFileSync } from 'node:fs'
import { Profiler } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { ChangeEvent } from '@/api/types'
import { objectSummary, typeDef } from '@/test/mockApi'

const listeners = new Set<(e: ChangeEvent) => void>()
const TYPES = Array.from({ length: 50 }, (_, i) => typeDef({ id: i === 0 ? 'page' : `type${i}`, name: i === 0 ? 'Page' : `Type ${i}`, pluralName: i === 0 ? 'Pages' : `Type ${i}s` }))
const OBJECTS = Array.from({ length: 5000 }, (_, i) => {
  const t = TYPES[i % 50]
  return objectSummary({ path: `${t.pluralName}/Object ${i}.md`, type: t.id, title: `Object ${i}`, id: `id${i}`, icon: i < 200 ? '📄' : null, tags: [`tag${i % 40}`], createdAt: '2026-01-01T00:00:00Z' })
})
const PINS = Array.from({ length: 100 }, (_, i) => ({ kind: 'object' as const, id: `id${i}` }))

vi.mock('@/api/client', async (orig) => {
  const o = await orig<typeof import('@/api/client')>()
  const { mockApi } = await import('@/test/mockApi')
  const api = mockApi({
    onChange: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  })
  return { ...o, api }
})
let iconRenders = 0
vi.mock('@/object/ObjectHeader', async (orig) => {
  const m = await orig<typeof import('@/object/ObjectHeader')>()
  return { ...m, ObjectIcon: (p: never) => { iconRenders++; return m.ObjectIcon(p) } }
})

import { api } from '@/api/client'
import App from '@/App'

const mocked = vi.mocked(api)
const results: string[] = []
const ms = (x: number) => Math.round(x * 10) / 10
const log = (w: string, v: number | string) => results.push(`${w}: ${typeof v === 'number' ? ms(v) : v}`)
const calls = () => Object.fromEntries(Object.entries(mocked).filter(([, f]) => vi.isMockFunction(f) && (f as ReturnType<typeof vi.fn>).mock.calls.length > 0).map(([k, f]) => [k, (f as ReturnType<typeof vi.fn>).mock.calls.length]))

test('perf: App with a big space, one changed event', async () => {
  mocked.space.mockImplementation(async () => ({ name: 'Big', root: '/big', types: TYPES, hideTaskManagement: false, revision: '' }) as never)
  mocked.objects.mockImplementation(async () => OBJECTS)
  mocked.ui.mockImplementation(async () => ({ ui: { pinned: PINS, sections: [], allNotesLayout: 'list' }, revision: 'r1' }) as never)
  let dur = 0
  let commits = 0
  const t0 = performance.now()
  render(
    <Profiler id="app" onRender={(_i, _p, a) => { dur += a; commits++ }}>
      <App />
    </Profiler>,
  )
  await waitFor(() => expect(screen.getAllByText('Object 0').length).toBeGreaterThan(0), { timeout: 20000 })
  await waitFor(() => expect(document.querySelectorAll('[data-pin]').length).toBe(100), { timeout: 20000 })
  log('startup wall ms (mock api, jsdom)', performance.now() - t0)
  log('startup profiler ms', dur)
  log('startup commits', commits)
  log('startup api calls', JSON.stringify(calls()))
  log('startup ObjectIcon renders', iconRenders)
  log('startup pins in DOM', document.querySelectorAll('[data-pin]').length)

  // One `changed` for one object from another window.
  for (let k = 0; k < 3; k++) {
    const before = calls()
    dur = 0
    commits = 0
    iconRenders = 0
    const t1 = performance.now()
    await act(async () => {
      for (const cb of listeners) cb({ kind: 'changed', path: 'Pages/Object 50.md', version: 'v2', origin: 'other' })
      await new Promise((r) => setTimeout(r, 200))
    })
    await waitFor(() => expect(mocked.objects.mock.calls.length).toBeGreaterThan(before.objects ?? 0))
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    const after = calls()
    const delta = Object.fromEntries(Object.keys(after).filter((k2) => after[k2] !== before[k2]).map((k2) => [k2, after[k2] - (before[k2] ?? 0)]))
    log(`event#${k} wall ms (incl. 150ms debounce + 50ms settle)`, performance.now() - t1)
    log(`event#${k} profiler ms`, dur)
    log(`event#${k} commits`, commits)
    log(`event#${k} api calls delta`, JSON.stringify(delta))
    log(`event#${k} ObjectIcon (pin row) renders`, iconRenders)
  }
  log('objects payload JSON bytes (5000 summaries)', JSON.stringify(OBJECTS).length)
  log('listeners registered', listeners.size)
  writeFileSync('/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/perf-shell.txt', results.join('\n'))
}, 120_000)
