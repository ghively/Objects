import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row, TypeDef, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { DataView } from '../DataView'
import { emptyFilterGroup } from '../model'

const mocked = vi.mocked(api)

const PAGE = typeDef({
  id: 'page',
  name: 'Page',
  pluralName: 'Pages',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({ id: 'note', type: 'text', name: 'Note' }),
    propertyDef({
      id: 'amount',
      type: 'number',
      name: 'Amount',
      options: { numberFormat: { type: 'number', options: { separators: { isGroupingThousands: true }, decimals: { min: 0, max: 2 } } } },
    }),
  ],
})
const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks' })

const mk = (path: string, values: Row['values'] = {}, version = 'v1'): Row =>
  row({ summary: objectSummary({ path, type: 'page' }), values, version })

const ROWS = [mk('Pages/Alpha.md', { note: 'first', amount: 1200 }, 'v7'), mk('Pages/Beta.md', { note: 'second', amount: 3000 })]

const base = (patch: Partial<ViewState['viewDefinition']> = {}): ViewState => ({
  viewDefinition: { dataViewLayout: 'table', ...patch },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
})

function Harness({
  init = base(),
  types = [PAGE],
  rows = ROWS,
  onState,
  patchRow,
}: {
  init?: ViewState
  types?: TypeDef[]
  rows?: Row[]
  onState?: (s: ViewState) => void
  patchRow?: (p: string, r: Row) => void
}) {
  const [state, setState] = useState(init)
  return (
    <DataView
      rows={rows}
      types={types}
      scope={{ typeIds: types.map((t) => t.id) }}
      state={state}
      onState={(s) => {
        setState(s)
        onState?.(s)
      }}
      layouts={['list', 'table']}
      patchRow={patchRow}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TableLayout', () => {
  test('renders one column per property with rows', () => {
    render(<Harness />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Title', 'Note', 'Amount'])
    expect(screen.getAllByLabelText('Title').map((i) => (i as HTMLInputElement).value)).toEqual(['Alpha', 'Beta'])
  })

  test('multiple types shows refusal text', () => {
    render(<Harness types={[PAGE, TASK]} />)
    expect(screen.getByText('Table cannot be displayed for multiple object types.')).toBeInTheDocument()
  })

  test('drag resize saves colWidth in rem on release', () => {
    const onState = vi.fn()
    render(<Harness onState={onState} />)
    const handle = screen.getByLabelText('Resize Note')
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 164 })
    // A live preview, nothing saved yet.
    expect(screen.getByText('Note').closest('[role="columnheader"]')).toHaveStyle({ width: '272px' })
    expect(onState).not.toHaveBeenCalled()
    fireEvent.mouseUp(document)
    expect(onState).toHaveBeenCalledTimes(1)
    const saved = onState.mock.calls[0][0] as ViewState
    const note = saved.viewDefinition.tableConfigs?.page.properties.find((c) => c.id === 'note')
    expect(note?.colWidth).toBe(17)
  })

  test('pinned column is sticky', () => {
    const cfg = {
      wrapAllContent: true,
      pinnedColumnIndex: 1,
      properties: [
        { id: 'title', type: 'entity_title', isHidden: false, wrapContent: false, colWidth: 10 },
        { id: 'note', type: 'text', isHidden: false, wrapContent: false, colWidth: 13 },
        { id: 'amount', type: 'number', isHidden: false, wrapContent: false, colWidth: 12 },
      ],
    }
    render(<Harness init={base({ tableConfigs: { page: cfg } })} />)
    const [title, note, amount] = screen.getAllByRole('columnheader')
    expect(title).toHaveStyle({ position: 'sticky', left: '0px' })
    expect(note).toHaveStyle({ position: 'sticky', left: '160px' })
    expect(amount).not.toHaveStyle({ position: 'sticky' })
  })

  test('Hide removes column and Show all in table restores', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Note'))
    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByRole('columnheader', { name: /Note/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Customize view' }))
    await user.click(screen.getByRole('button', { name: /^Table/ }))
    expect(screen.getByText('Hidden in table')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all in table' }))
    expect(screen.getAllByRole('columnheader')).toHaveLength(3)
  })

  test('Wrap none truncates cells', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(document.querySelector('[role="cell"][data-col="note"]')).toHaveAttribute('data-wrap', 'wrap')
    await user.click(screen.getByRole('button', { name: 'Customize view' }))
    await user.click(screen.getByRole('button', { name: /^Table/ }))
    await user.click(screen.getByRole('button', { name: 'Wrap none' }))
    expect(document.querySelector('[role="cell"][data-col="note"]')).toHaveAttribute('data-wrap', 'nowrap')
    expect(document.querySelector('[role="cell"][data-col="note"]')?.className).toMatch(/overflow-hidden/)
  })

  test('column menu Wrap Text and Pin Columns', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    render(<Harness onState={onState} />)
    await user.click(screen.getByText('Note'))
    expect(screen.getByRole('button', { name: 'Unwrap Text' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pin Columns' }))
    expect(onState.mock.calls.at(-1)?.[0].viewDefinition.tableConfigs.page.pinnedColumnIndex).toBe(1)
    await user.click(screen.getByText('Note'))
    expect(screen.getByRole('button', { name: 'Unpin cClumns' })).toBeInTheDocument()
  })

  test('calc footer shows Sum with number format', () => {
    render(<Harness init={base({ calculations: [{ propertyId: 'amount', structureId: 'page', kind: 'sum' }] })} />)
    const cell = screen.getByTestId('calc-amount')
    expect(within(cell).getByText('Sum')).toBeInTheDocument()
    expect(within(cell).getByText('4,200')).toBeInTheDocument()
  })

  test('an empty column offers Calculate and sets a calculation', async () => {
    const user = userEvent.setup()
    const onState = vi.fn()
    render(<Harness onState={onState} />)
    await user.click(screen.getByTestId('calc-amount'))
    await user.click(screen.getByRole('button', { name: 'Average' }))
    expect(onState.mock.calls.at(-1)?.[0].viewDefinition.calculations).toEqual([
      { propertyId: 'amount', structureId: 'page', kind: 'average' },
    ])
  })

  test('cell edit sends row version and patches row', async () => {
    const user = userEvent.setup()
    const patchRow = vi.fn()
    render(<Harness patchRow={patchRow} />)
    const input = screen.getAllByLabelText('Note')[0]
    await user.clear(input)
    await user.type(input, 'changed')
    await user.tab()
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith('Pages/Alpha.md', { note: 'changed' }, 'v7'))
    await waitFor(() => expect(patchRow).toHaveBeenCalled())
    const [path, next] = patchRow.mock.calls[0] as [string, Row]
    expect(path).toBe('Pages/Alpha.md')
    expect(next.version).toBe('v7+1')
    expect(next.values.note).toBe('changed')
  })

  test('a second edit to the same row carries the first write version (audit #14)', async () => {
    const user = userEvent.setup()
    const patchRow = vi.fn()
    render(<Harness patchRow={patchRow} />)
    const note = screen.getAllByLabelText('Note')[0]
    await user.clear(note)
    await user.type(note, 'changed')
    await user.tab()
    await waitFor(() => expect(patchRow).toHaveBeenCalledTimes(1))
    const again = screen.getAllByLabelText('Note')[0]
    await user.clear(again)
    await user.type(again, 'twice')
    await user.tab()
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(2))
    expect(mocked.updateProperties).toHaveBeenLastCalledWith('Pages/Alpha.md', { note: 'twice' }, 'v7+1')
    await waitFor(() => expect(patchRow).toHaveBeenCalledTimes(2))
    expect((patchRow.mock.calls[1] as [string, Row])[1].version).toBe('v7+1+1')
  })

  test('409 on cell edit reloads row without retry', async () => {
    const user = userEvent.setup()
    const patchRow = vi.fn()
    const fresh = mk('Pages/Alpha.md', { note: 'theirs' }, 'v9')
    mocked.updateProperties.mockRejectedValueOnce(new ConflictError('v9' as never))
    mocked.rows.mockResolvedValueOnce([fresh])
    render(<Harness patchRow={patchRow} />)
    const input = screen.getAllByLabelText('Note')[0]
    await user.clear(input)
    await user.type(input, 'mine')
    await user.tab()
    await waitFor(() => expect(patchRow).toHaveBeenCalledWith('Pages/Alpha.md', fresh))
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Pages/Alpha.md'] })
    expect(screen.getByTestId('table-notice')).toHaveTextContent('Changed elsewhere. Reloaded.')
  })

  test('title cell rename calls renameObject', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getAllByLabelText('Title')[0]
    await user.clear(input)
    await user.type(input, 'Omega')
    await user.tab()
    await waitFor(() => expect(mocked.renameObject).toHaveBeenCalledWith('Pages/Alpha.md', 'Omega', 'v7'))
  })

  test('read-only row renders read-only cells', () => {
    const ro = row({ summary: objectSummary({ path: 'Pages/Locked.md', readOnly: true }), values: { note: 'x' } })
    render(<Harness rows={[ro]} />)
    expect(screen.getByLabelText('Note')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Title')).toHaveAttribute('readonly')
  })
})
