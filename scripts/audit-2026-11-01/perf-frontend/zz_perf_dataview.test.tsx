// Perf audit scratch: DataView with 5,000 rows (list / table / kanban), one cell edit.
import { writeFileSync } from 'node:fs'
import { Profiler } from 'react'
import { act, render } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { Row, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
let tokenRenders = 0
vi.mock('@/views/cards/InlineToken', async (orig) => {
  const m = await orig<typeof import('@/views/cards/InlineToken')>()
  return { ...m, InlineToken: (p: never) => { tokenRenders++; return m.InlineToken(p) } }
})
let cellRenders = 0
vi.mock('@/properties/cellFor', async (orig) => {
  const m = await orig<typeof import('@/properties/cellFor')>()
  return {
    ...m,
    cellForDef: (def: never) => {
      const C = m.cellForDef(def) as unknown as (p: never) => unknown
      if (!C) return C
      const W = (p: never) => { cellRenders++; return (C as unknown as (p: never) => unknown)(p) }
      return W
    },
  }
})

import { useLinkIndex } from '@/links/linkIndex'
import { DataView } from '@/views/DataView'
import { applyFilters } from '@/views/filter'
import { applySorts } from '@/views/sort'
import { groupRows } from '@/views/group'
import { emptyFilterGroup } from '@/views/model'

const N = 5000
const LABELS = ['Todo', 'Doing', 'Done', 'Blocked', 'Later']
const TYPES = ['page', 'task', 'person', 'project', 'meeting'].map((id, i) =>
  typeDef({
    id,
    propertyDefinitions: [
      propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
      propertyDef({ id: 'status', type: 'label', name: 'Status', options: { isArray: false, set: LABELS.map((t, k) => ({ id: `o${k}`, text: t, color: 'gray', icon: null })) } }),
      propertyDef({ id: 'note', type: 'text', name: 'Note' }),
      propertyDef({ id: 'n', type: 'number', name: 'N' }),
      propertyDef({ id: 'when', type: 'datetime', name: 'When' }),
      propertyDef({ id: 'created', type: 'entity_createdAt', name: 'Created' }),
      propertyDef({ id: 'tags', type: 'entity_tags', name: 'Tags' }),
    ],
    color: ['gray', 'blue', 'green', 'red', 'orange'][i],
  }),
)
function makeRows(n = N, oneType = false): Row[] {
  const out: Row[] = []
  for (let i = 0; i < n; i++) {
    const t = oneType ? TYPES[0] : TYPES[i % TYPES.length]
    const d = new Date(Date.UTC(2024, 0, 1) + i * 3_600_000).toISOString()
    out.push(
      row({
        summary: objectSummary({ path: `${t.pluralName}/Object ${i}.md`, type: t.id, title: `Object ${i} about topic ${i % 97}`, createdAt: d, lastUpdated: d, tags: [`tag${i % 40}`], id: `id${i}` }),
        values: { status: [LABELS[i % 5]], note: `note ${i}`, n: i, when: { start: d.slice(0, 10) } },
      }),
    )
  }
  return out
}
const view = (layout: ViewState['viewDefinition']['dataViewLayout'], extra: Partial<ViewState> = {}): ViewState => ({
  viewDefinition: { dataViewLayout: layout },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
  ...extra,
})
const ms = (x: number) => Math.round(x * 10) / 10
const results: string[] = []
const log = (what: string, v: number | string) => results.push(`${what}: ${typeof v === 'number' ? ms(v) : v}`)

function Harness({ rows, state, onDur }: { rows: Row[]; state: ViewState; onDur: (d: number) => void }) {
  return (
    <Profiler id="dv" onRender={(_id, _phase, actual) => onDur(actual)}>
      <DataView rows={rows} types={TYPES} state={state} onState={() => {}} layouts={['list', 'table', 'kanban', 'grid']} rowActions patchRow={() => {}} />
    </Profiler>
  )
}

test('perf: DataView 5000 rows', async () => {
  const rows = makeRows()
  useLinkIndex.setState({ types: TYPES, objects: rows.map((r) => r.summary), loaded: true, revision: 1 })
  // Pipeline alone.
  const ctx = { types: TYPES, viewTypeIds: TYPES.map((t) => t.id), collections: [], tagIdsToTitles: {}, pathsById: {}, entityTitles: {}, entityCreated: {}, now: new Date() }
  for (const [name, st] of [
    ['plain', view('list')],
    ['sort title', view('list', { sorts: [{ propertyId: 'title', direction: 'asc' }] as never })],
    ['group status + sort created', view('list', { groupBy: 'status', sorts: [{ propertyId: 'created', direction: 'desc' }] as never })],
  ] as const) {
    let best = Infinity
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      const sorted = applySorts(applyFilters(rows, st.filterGroup, ctx as never), st.sorts, ctx as never)
      groupRows(sorted, st.groupBy, undefined, ctx as never)
      best = Math.min(best, performance.now() - t0)
    }
    log(`pipeline(${name}) 5000 rows best-of-5 ms`, best)
  }

  for (const [name, st] of [
    ['list', view('list')],
    ['list grouped by status', view('list', { groupBy: 'status' })],
    ['grid (cards)', view('grid')],
    ['kanban by status', view('kanban', { groupBy: 'status' })],
  ] as const) {
    let dur = 0
    tokenRenders = 0
    const t0 = performance.now()
    const r = render(<Harness rows={rows} state={st} onDur={(d) => (dur += d)} />)
    log(`${name} mount wall ms`, performance.now() - t0)
    log(`${name} mount profiler ms`, dur)
    log(`${name} InlineToken renders at mount`, tokenRenders)
    log(`${name} rows in DOM`, r.container.querySelectorAll('[data-path]').length)
    // One row changed (patchRow): the parent passes a new rows array.
    const rows2 = rows.slice()
    rows2[3] = { ...rows2[3], values: { ...rows2[3].values, note: 'edited' } }
    dur = 0
    tokenRenders = 0
    const t1 = performance.now()
    act(() => r.rerender(<Harness rows={rows2} state={st} onDur={(d) => (dur += d)} />))
    log(`${name} one-row patch rerender wall ms`, performance.now() - t1)
    log(`${name} one-row patch InlineToken renders`, tokenRenders)
    r.unmount()
  }

  // Table: one type, 5000 rows.
  const trows = makeRows(N, true)
  useLinkIndex.setState({ types: TYPES, objects: trows.map((r) => r.summary), loaded: true, revision: 2 })
  {
    let dur = 0
    cellRenders = 0
    const st = view('table')
    const t0 = performance.now()
    const r = render(
      <Profiler id="t" onRender={(_i, _p, a) => (dur += a)}>
        <DataView rows={trows} types={TYPES} scope={{ typeIds: ['page'] }} state={st} onState={() => {}} layouts={['table']} rowActions patchRow={() => {}} />
      </Profiler>,
    )
    log('table mount wall ms', performance.now() - t0)
    log('table rows in DOM', r.container.querySelectorAll('[role=row]').length - 1)
    log('table cell renders at mount', cellRenders)
    const rows2 = trows.slice()
    rows2[3] = { ...rows2[3], values: { ...rows2[3].values, note: 'edited' } }
    cellRenders = 0
    const t1 = performance.now()
    act(() =>
      r.rerender(
        <Profiler id="t" onRender={(_i, _p, a) => (dur += a)}>
          <DataView rows={rows2} types={TYPES} scope={{ typeIds: ['page'] }} state={st} onState={() => {}} layouts={['table']} rowActions patchRow={() => {}} />
        </Profiler>,
      ),
    )
    log('table one-cell patch rerender wall ms', performance.now() - t1)
    log('table one-cell patch cell renders', cellRenders)
    r.unmount()
  }
  // The linkIndex refetch (every SSE event) hands DataView a new `objects` array: cost of that alone.
  {
    let dur = 0
    const st = view('list')
    const r = render(<Harness rows={rows} state={st} onDur={(d) => (dur += d)} />)
    dur = 0
    tokenRenders = 0
    const t0 = performance.now()
    act(() => useLinkIndex.setState({ objects: rows.map((x) => x.summary), revision: 3 }))
    log('list: linkIndex objects refresh (same data, new array) rerender wall ms', performance.now() - t0)
    log('list: linkIndex objects refresh InlineToken renders', tokenRenders)
    r.unmount()
  }
  writeFileSync('/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/perf-dataview.txt', results.join('\n'))
  expect(true).toBe(true)
}, 120_000)
