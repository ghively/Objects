// Audit 2026-11-01 F4: table and list rows are memoized, so patching one row re-renders that row
// only (before: every visible cell and every InlineToken re-rendered per edit).
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

const cellRenders: string[] = []
vi.mock('@/properties/cellFor', async (orig) => {
  const m = await orig<typeof import('@/properties/cellFor')>()
  // One counting wrapper per cell component, so the wrapper itself is a stable component type.
  const wrapped = new Map<unknown, unknown>()
  return {
    ...m,
    cellForDef: (def: never) => {
      const C = m.cellForDef(def) as unknown as ((p: never) => unknown) | null
      if (!C) return C
      let W = wrapped.get(C)
      if (!W) {
        W = (p: { def: { name: string } }) => {
          cellRenders.push(p.def.name)
          return C(p as never)
        }
        wrapped.set(C, W)
      }
      return W
    },
  }
})

let tokenRenders = 0
vi.mock('@/views/cards/InlineToken', async (orig) => {
  const m = await orig<typeof import('@/views/cards/InlineToken')>()
  return {
    ...m,
    InlineToken: (p: Parameters<typeof m.InlineToken>[0]) => {
      tokenRenders++
      return m.InlineToken(p)
    },
  }
})

import { DataView } from './DataView'
import { emptyFilterGroup } from './model'

const PAGE = typeDef({
  id: 'page',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({ id: 'note', type: 'text', name: 'Note' }),
    propertyDef({ id: 'qty', type: 'number', name: 'Qty' }),
  ],
})
const mk = (i: number, note: string): Row =>
  row({ summary: objectSummary({ path: `P/${i}.md`, type: 'page', title: `Row ${i}` }), values: { note, qty: i } })
const ROWS = Array.from({ length: 20 }, (_, i) => mk(i, `n${i}`))
const view = (layout: 'list' | 'table'): ViewState => ({ viewDefinition: { dataViewLayout: layout }, filterGroup: emptyFilterGroup(), sorts: [], groupBy: null })

/** An owner like `useRows`' consumer: a new `patchRow` function per render is the common case. */
const Harness = ({ rows, layout }: { rows: Row[]; layout: 'list' | 'table' }) => (
  <DataView rows={rows} types={[PAGE]} scope={{ typeIds: ['page'] }} state={view(layout)} onState={() => {}} layouts={['list', 'table']} rowActions patchRow={() => {}} />
)

beforeEach(() => {
  cellRenders.length = 0
  tokenRenders = 0
})

describe('row memoization (audit 2026-11-01 F4)', () => {
  test('a one-row patch re-renders only that table row', () => {
    const r = render(<Harness rows={ROWS} layout="table" />)
    expect(cellRenders).toHaveLength(40)
    expect(screen.getAllByLabelText('Note')[3]).toHaveValue('n3')
    cellRenders.length = 0
    const rows2 = ROWS.slice()
    rows2[3] = { ...rows2[3], values: { ...rows2[3].values, note: 'edited' } }
    act(() => r.rerender(<Harness rows={rows2} layout="table" />))
    expect(screen.getAllByLabelText('Note')[3]).toHaveValue('edited')
    // The patched row's two cells (a text cell renders once more to sync its state); no other row.
    expect(cellRenders.length).toBeLessThanOrEqual(4)
    expect(new Set(cellRenders)).toEqual(new Set(['Note', 'Qty']))
  })

  test('a one-row patch re-renders only that list row', () => {
    const r = render(<Harness rows={ROWS} layout="list" />)
    expect(tokenRenders).toBe(20)
    tokenRenders = 0
    const rows2 = ROWS.slice()
    rows2[3] = { ...rows2[3], summary: { ...rows2[3].summary, title: 'Renamed' } }
    act(() => r.rerender(<Harness rows={rows2} layout="list" />))
    expect(screen.getByText('Renamed')).toBeInTheDocument()
    expect(tokenRenders).toBe(1)
  })
})
