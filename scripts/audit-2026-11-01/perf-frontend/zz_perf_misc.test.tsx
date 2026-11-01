// Perf audit scratch: property panel (40 props), backlinks (500), graph (5,000 nodes), calendar day (500 tasks).
import { writeFileSync } from 'node:fs'
import { Profiler } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
afterEach(() => writeFileSync('/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/perf-misc.txt', results.join('\n')))
import type { BacklinkEntry, GraphData, ObjectSummary, Row } from '@/api/types'
import { calendarDay, calendarRange, objectSummary, propertyDef, references, row, taskEntry, typeDef } from '@/test/mockApi'
vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('sigma', async () => (await import('@/graph/testSigma')).sigmaModule())
let fa2Starts = 0
vi.mock('graphology-layout-forceatlas2/worker', () => ({
  default: class { start() { fa2Starts++ } stop() {} kill() {} isRunning() { return false } },
}))
import { api } from '@/api/client'
import { useLinkIndex } from '@/links/linkIndex'
import { PropertyPanel } from '@/object/PropertyPanel'
import { BacklinksPanel } from '@/references/BacklinksPanel'
import { GraphCanvas } from '@/graph/GraphCanvas'
import { filterGraph } from '@/graph/filterGraph'
import { sigmaInstances } from '@/graph/testSigma'
import { DayView } from '@/calendar/DayView'
import { MonthView } from '@/calendar/MonthView'

const mocked = vi.mocked(api)
const results: string[] = []
const ms = (x: number) => Math.round(x * 10) / 10
const log = (w: string, v: number | string) => results.push(`${w}: ${typeof v === 'number' ? ms(v) : v}`)

test('perf: property panel 40 properties', () => {
  const kinds = ['text', 'number', 'boolean', 'datetime', 'label', 'url', 'entity', 'entity_tags'] as const
  const defs = Array.from({ length: 40 }, (_, i) =>
    propertyDef({ id: `p${i}`, name: `Prop ${i}`, type: kinds[i % kinds.length], options: kinds[i % kinds.length] === 'label' ? { isArray: true, set: [{ id: 'a', text: 'A', color: 'gray', icon: null }] } : {} }),
  )
  const type = typeDef({ id: 'page', propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' }), ...defs] })
  const fm: Record<string, unknown> = {}
  defs.forEach((d, i) => { fm[d.key] = d.type === 'number' ? i : d.type === 'boolean' ? true : d.type === 'datetime' ? '2026-01-01' : d.type === 'label' ? ['A'] : d.type === 'entity' ? ['[[X]]'] : d.type === 'entity_tags' ? ['t'] : `value ${i}` })
  useLinkIndex.setState({ types: [type], objects: [], loaded: true, revision: 1 })
  const summary = objectSummary({ path: 'Pages/X.md' })
  let dur = 0
  const el = (fmx: Record<string, unknown>) => (
    <Profiler id="pp" onRender={(_i, _p, a) => (dur += a)}>
      <PropertyPanel type={type} frontmatter={fmx} links={{}} summary={summary} backlinks={[]} readOnly={false} onChange={() => {}} />
    </Profiler>
  )
  const t0 = performance.now()
  const r = render(el(fm))
  log('PropertyPanel 40 props mount wall ms', performance.now() - t0)
  log('PropertyPanel 40 props mount profiler ms', dur)
  dur = 0
  const t1 = performance.now()
  act(() => r.rerender(el({ ...fm, p0: 'changed' })))
  log('PropertyPanel one value change rerender wall ms', performance.now() - t1)
  log('PropertyPanel one value change profiler ms', dur)
  r.unmount()
})

test('perf: backlinks panel 500 references', async () => {
  const summaries: Record<string, ObjectSummary> = {}
  const backlinks: BacklinkEntry[] = []
  for (let i = 0; i < 500; i++) {
    const p = `Pages/Ref ${i}.md`
    summaries[p] = objectSummary({ path: p, title: `Ref ${i}` })
    backlinks.push({ path: p, contexts: [{ context: `This block links to [[X]] from ${i}`, start: 20, end: 25 }], properties: [] })
  }
  mocked.references.mockResolvedValue(references({ backlinks, summaries }))
  let dur = 0
  const t0 = performance.now()
  const r = render(
    <Profiler id="bl" onRender={(_i, _p, a) => (dur += a)}>
      <BacklinksPanel path="Pages/X.md" />
    </Profiler>,
  )
  await waitFor(() => expect(r.container.querySelectorAll('[data-reference-path]').length).toBeGreaterThanOrEqual(1), { timeout: 20000 })
  log('Backlinks 500 wall ms to first paint', performance.now() - t0)
  log('Backlinks 500 profiler ms', dur)
  log('Backlinks entries in DOM', r.container.querySelectorAll('[data-reference-path]').length)
  // linkIndex refresh (every SSE event) → EntryHeader subscribes to revision.
  dur = 0
  const t1 = performance.now()
  act(() => useLinkIndex.setState((s) => ({ revision: s.revision + 1 })))
  log('Backlinks 500: linkIndex revision bump rerender wall ms', performance.now() - t1)
  log('Backlinks 500: linkIndex revision bump profiler ms', dur)
  r.unmount()
}, 60_000)

test('perf: graph 5000 nodes', async () => {
  const N = 5000
  const nodes: GraphData['nodes'] = Array.from({ length: N }, (_, i) => ({ path: `P/N${i}.md`, title: `Node ${i}`, type: i % 10 === 0 ? 'tag' : 'page', icon: null, degree: 4, tag: i % 10 === 0, daily: false, done: false }))
  const links: number[] = []
  for (let i = 0; i < N * 2; i++) { const a = (i * 7919) % N; const b = (a + 1 + (i % 50)) % N; links.push(Math.min(a, b), Math.max(a, b)) }
  const data: GraphData = { nodes, links, tagged: [] }
  const objects = nodes.map((n) => objectSummary({ path: n.path, type: n.type, title: n.title, color: n.tag ? 'bg-red' : null }))
  const types = [typeDef({ id: 'page' }), typeDef({ id: 'tag' })]
  useLinkIndex.setState({ types, objects, loaded: true, revision: 1 })
  let best = Infinity
  let visible = filterGraph(data, {}, { kind: 'global' })
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); visible = filterGraph(data, {}, { kind: 'global' }); best = Math.min(best, performance.now() - t0) }
  log('filterGraph 5000 nodes / 10000 links best-of-3 ms', best)
  log('visible nodes / links', `${visible.nodes.length} / ${visible.links.length}`)
  let dur = 0
  const t0 = performance.now()
  const r = render(
    <Profiler id="g" onRender={(_i, _p, a) => (dur += a)}>
      <GraphCanvas data={data} visible={visible} custom={{}} onNodeClick={() => {}} />
    </Profiler>,
  )
  await waitFor(() => expect(sigmaInstances.length).toBe(1))
  log('GraphCanvas 5000 mount wall ms (graph build + seed, layout in worker)', performance.now() - t0)
  log('fa2 layouts started after mount', fa2Starts)
  // The linkIndex refetch (every SSE event) hands the canvas a new objects array.
  const before = fa2Starts
  const t1 = performance.now()
  act(() => useLinkIndex.setState({ objects: objects.slice(), revision: 2 }))
  await new Promise((res) => setTimeout(res, 20))
  log('GraphCanvas: linkIndex objects refresh (same data) rerender wall ms', performance.now() - t1)
  log('GraphCanvas: layouts restarted by that refresh', fa2Starts - before)
  r.unmount()
}, 60_000)

test('perf: calendar day with 500 tasks and month with 31 notes', async () => {
  const day = '2026-10-01'
  const tasks = Array.from({ length: 500 }, (_, i) => taskEntry({ path: `Tasks/Task ${i}.md`, day }))
  const summaries: Record<string, ObjectSummary> = {}
  const rows: Row[] = []
  for (const t of tasks) { summaries[t.path] = objectSummary({ path: t.path, type: 'task' }); rows.push(row({ summary: summaries[t.path] })) }
  for (let d = 1; d <= 31; d++) { const p = `Daily/2026-10-${String(d).padStart(2, '0')}.md`; summaries[p] = objectSummary({ path: p, type: 'dailyNote' }); rows.push(row({ summary: summaries[p] })) }
  useLinkIndex.setState({ types: [typeDef({ id: 'task' }), typeDef({ id: 'dailyNote' })], objects: Object.values(summaries), loaded: true, revision: 1 })
  mocked.calendar.mockImplementation(async (from: string, to: string) => {
    const days: Record<string, ReturnType<typeof calendarDay>> = {}
    for (let d = 1; d <= 31; d++) { const k = `2026-10-${String(d).padStart(2, '0')}`; days[k] = calendarDay({ dailyNote: { path: `Daily/${k}.md`, reviewed: false }, tasks: k === day ? tasks : [] }) }
    return calendarRange({ from, to, today: day, days, summaries })
  })
  mocked.rows.mockImplementation(async (scope: { paths?: string[] }) => rows.filter((r) => !scope.paths || scope.paths.includes(r.summary.path)))
  let dur = 0
  const t0 = performance.now()
  const r = render(
    <Profiler id="d" onRender={(_i, _p, a) => (dur += a)}>
      <DayView day={day} />
    </Profiler>,
  )
  await waitFor(() => expect(r.container.querySelectorAll('[data-path]').length).toBeGreaterThanOrEqual(50), { timeout: 20000 })
  log('DayView 500 tasks wall ms to rows', performance.now() - t0)
  log('DayView 500 tasks profiler ms', dur)
  log('DayView rows in DOM', r.container.querySelectorAll('[data-path]').length)
  r.unmount()
  dur = 0
  const t1 = performance.now()
  const m = render(
    <Profiler id="m" onRender={(_i, _p, a) => (dur += a)}>
      <MonthView anchor={day} weekStart="sunday" />
    </Profiler>,
  )
  await waitFor(() => expect(m.container.querySelectorAll('[data-path]').length).toBeGreaterThanOrEqual(31), { timeout: 20000 })
  log('MonthView 31 notes wall ms to cards', performance.now() - t1)
  log('MonthView profiler ms', dur)
  m.unmount()
  writeFileSync('/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/perf-misc.txt', results.join('\n'))
}, 60_000)
