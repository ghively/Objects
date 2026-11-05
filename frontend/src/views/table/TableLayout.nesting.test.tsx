// M13: nested rows in the table layout with the view's `subItemsConfig`.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { DataView } from '../DataView'
import { emptyFilterGroup, LOAD_PAGE } from '../model'

const STORY = typeDef({
  id: 'story',
  name: 'Story',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({
      id: 'stage',
      type: 'label',
      name: 'Stage',
      options: { isArray: false, set: [{ id: 'o1', text: 'Open', color: 'gray', icon: null }] },
    }),
    propertyDef({ id: 'parent', type: 'entity', name: 'Parent item', options: { isArray: false } }),
    propertyDef({ id: 'children', type: 'entity', name: 'Sub-items' }),
  ],
})

const mk = (title: string, parent?: string): Row =>
  row({
    summary: objectSummary({ path: `Stories/${title}.md`, type: 'story', title }),
    values: { stage: ['Open'] },
    links: parent ? { parent: [`Stories/${parent}.md`] } : {},
  })

const SUB = { parentPropertyId: 'parent', childrenPropertyId: 'children' }
const view = (patch: Partial<ViewState> = {}, sub: typeof SUB | null = SUB): ViewState => ({
  viewDefinition: { dataViewLayout: 'table', ...(sub ? { subItemsConfig: sub } : {}) },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
  ...patch,
})

function Harness({ rows, init }: { rows: Row[]; init: ViewState }) {
  const [state, setState] = useState(init)
  return <DataView rows={rows} types={[STORY]} scope={{ typeIds: ['story'] }} state={state} onState={setState} layouts={['table']} />
}

const bodyRows = () =>
  screen
    .getAllByRole('row')
    .filter((r) => r.hasAttribute('data-path'))
    .map((r) => `${r.getAttribute('data-depth') ?? '-'}:${r.getAttribute('data-path')?.replace(/^Stories\/|\.md$/g, '')}`)

beforeEach(() => vi.clearAllMocks())

describe('table nesting', () => {
  test('rows nest under their parent in the view, each once; sorting stays among siblings', () => {
    const rows = [mk('B2', 'A'), mk('A'), mk('C', 'Gone'), mk('B1', 'A'), mk('D', 'B1')]
    render(<Harness rows={rows} init={view()} />)
    expect(bodyRows()).toEqual(['0:A', '1:B2', '1:B1', '2:D', '0:C'])
    // The row numbers follow the drawn order.
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['1', '2', '3', '4', '5'])
  })

  test('a parent toggles its sub-items (open by default); a row without children has no toggle', async () => {
    render(<Harness rows={[mk('A'), mk('B', 'A'), mk('C', 'B'), mk('E')]} init={view()} />)
    expect(screen.getByRole('button', { name: 'Hide sub-items of A' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByRole('button', { name: /sub-items of E/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Hide sub-items of A' }))
    expect(bodyRows()).toEqual(['0:A', '0:E'])
    await userEvent.click(screen.getByRole('button', { name: 'Show sub-items of A' }))
    expect(bodyRows()).toEqual(['0:A', '1:B', '2:C', '0:E'])
  })

  test('a parent whose children are all filtered out shows no toggle', () => {
    // B (A's child) isn't among the view's rows.
    render(<Harness rows={[mk('A'), mk('C')]} init={view()} />)
    expect(screen.queryByRole('button', { name: /sub-items of/ })).toBeNull()
    expect(bodyRows()).toEqual(['0:A', '0:C'])
  })

  test('a cycle is drawn at the top level', () => {
    render(<Harness rows={[mk('X', 'Y'), mk('Y', 'X'), mk('Z', 'X')]} init={view()} />)
    expect(bodyRows()).toEqual(['0:X', '1:Z', '0:Y'])
  })

  test('grouping turns nesting off', () => {
    const init = view({ groupBy: { groups: [{ propertyId: 'stage', option: 'default' }] } })
    render(<Harness rows={[mk('A'), mk('B', 'A')]} init={init} />)
    expect(bodyRows()).toEqual(['-:A', '-:B'])
    expect(screen.queryByRole('button', { name: /sub-items of/ })).toBeNull()
  })

  test('without the setting the table is flat', () => {
    render(<Harness rows={[mk('B', 'A'), mk('A')]} init={view({}, null)} />)
    expect(bodyRows()).toEqual(['-:B', '-:A'])
  })

  test('paging takes the first rows of the tree; "Load more" brings the rest, none lost or repeated', async () => {
    const rows: Row[] = []
    for (let i = 0; i < 40; i++) rows.push(mk(`P${i}`))
    for (let i = 0; i < 40; i++) rows.push(mk(`K${i}`, `P${i}`))
    render(<Harness rows={rows} init={view()} />)
    const first = bodyRows()
    expect(first).toHaveLength(LOAD_PAGE)
    expect(first.slice(0, 2)).toEqual(['0:P0', '1:K0'])
    await userEvent.click(screen.getByRole('button', { name: /Load more/ }))
    const all = bodyRows()
    expect(all).toHaveLength(80)
    expect(new Set(all).size).toBe(80)
  })
})
