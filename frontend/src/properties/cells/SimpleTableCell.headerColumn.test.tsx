// M31 fix pass, finding 13b: the spec's simple table has a header row and column. A Table
// property's "First column is a header" (`options.headerColumn`, our wording) styles the first
// column as header cells in the panel editor, the table view's popover and the Page link view;
// the Markdown table it stores is the same either way.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { PropertyDef, TypeDef } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import { PageCard } from '@/views/cards/PageCard'
import { PropertySettings } from '../PropertySettings'
import { SimpleTableCell } from './SimpleTableCell'

const MD = '| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n| Pear | 5 |'
const PLAIN: PropertyDef = propertyDef({ id: 'sizes', key: 'sizes', name: 'Sizes', type: 'simpleTableBlock' })
const HEADED: PropertyDef = { ...PLAIN, options: { headerColumn: true } }

describe('Table: "First column is a header"', () => {
  test('the panel editor shows the first column as row headers; storage is unchanged', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SimpleTableCell def={HEADED} value={MD} onChange={onChange} />)
    const apple = screen.getByDisplayValue('Apple').closest('th')
    expect(apple).toHaveAttribute('scope', 'row')
    expect(apple).toHaveClass('font-medium')
    expect(screen.getByDisplayValue('3').closest('td')).not.toBeNull()
    expect(screen.getByDisplayValue('Name').closest('th')).toHaveAttribute('scope', 'col')
    const cell = screen.getByDisplayValue('3')
    await user.clear(cell)
    await user.type(cell, '4')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith('| Name | Qty |\n| --- | --- |\n| Apple | 4 |\n| Pear | 5 |')
  })

  test('without the option the first column is ordinary cells', () => {
    render(<SimpleTableCell def={PLAIN} value={MD} readOnly onChange={() => {}} />)
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0)
    expect(screen.getByRole('cell', { name: 'Apple' })).toBeInTheDocument()
  })

  test('read-only and in the table view popover', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<SimpleTableCell def={HEADED} value={MD} readOnly onChange={() => {}} />)
    expect(screen.getAllByRole('rowheader').map((e) => e.textContent)).toEqual(['Apple', 'Pear'])
    unmount()
    render(<SimpleTableCell def={HEADED} value={MD} density="table" inTable onChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: '2 rows' }))
    const peek = await screen.findByRole('dialog', { name: 'Sizes' })
    expect(within(peek).getByDisplayValue('Pear').closest('th')).toHaveAttribute('scope', 'row')
  })

  test('the Page link view shows the table read-only, the first column as headers', () => {
    const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
    const FRUIT = typeDef({ id: 'fruit', name: 'Fruit', propertyDefinitions: [TITLE, HEADED] })
    const APPLE = row({
      summary: objectSummary({ path: 'Fruits/Apple.md', type: 'fruit', title: 'Apple' }),
      values: { sizes: MD },
    })
    render(<PageCard row={APPLE} type={FRUIT} />)
    const card = screen.getByTestId('page-card')
    const table = within(card).getByRole('table', { name: 'Sizes' })
    expect(within(table).getAllByRole('rowheader').map((e) => e.textContent)).toEqual(['Apple', 'Pear'])
    expect(within(table).getByRole('columnheader', { name: 'Qty' })).toBeInTheDocument()
    expect(within(table).queryByRole('textbox')).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Add row' })).toBeNull()
  })
})

describe('Property settings: "First column is a header"', () => {
  const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
  const NOTE = propertyDef({ id: 'note', key: 'note', name: 'Note', type: 'text' })
  const FRUIT: TypeDef = typeDef({ id: 'fruit', name: 'Fruit', revision: 'r1', propertyDefinitions: [TITLE, PLAIN, NOTE] })
  const saved = (id: string) =>
    (vi.mocked(api.saveType).mock.calls.at(-1)![0] as TypeDef).propertyDefinitions.find((d) => d.id === id)

  beforeEach(() => {
    vi.mocked(api.saveType).mockReset()
    vi.mocked(api.saveType).mockImplementation(async (t: TypeDef) => ({ type: { ...t, revision: 'r2' }, rewritten: [], skipped: [] }))
    useLinkIndex.setState({ types: [FRUIT], objects: [], loaded: true })
  })

  test('the switch sets options.headerColumn; off removes it', async () => {
    const user = userEvent.setup()
    render(<PropertySettings typeId="fruit" propertyId="sizes" open onOpenChange={() => {}} onOpenProperty={() => {}} />)
    const sw = screen.getByRole('switch', { name: 'First column is a header' })
    expect(sw).not.toBeChecked()
    await user.click(sw)
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(saved('sizes')?.options.headerColumn).toBe(true)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'First column is a header' })).toBeChecked())
    await user.click(screen.getByRole('switch', { name: 'First column is a header' }))
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(2))
    expect(saved('sizes')?.options).not.toHaveProperty('headerColumn')
  })

  test('only a Table property has the switch', () => {
    render(<PropertySettings typeId="fruit" propertyId="note" open onOpenChange={() => {}} onOpenProperty={() => {}} />)
    expect(screen.queryByRole('switch', { name: 'First column is a header' })).toBeNull()
  })
})
