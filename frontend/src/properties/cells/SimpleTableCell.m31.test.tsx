// M31 item 13: the Table property (`simpleTableBlock`): the panel editor adds and removes rows and
// columns, the header row reads as column names, and a table view or card shows "N rows" with the
// table in a peek.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { KIND_TRANSFORMS, type PropertyDef } from '@/api/types'
import { allowedKindChanges } from '../typeEdits'
import { parseGfmTable, serializeGfmTable, SimpleTableCell, tableSummary } from './SimpleTableCell'

const def: PropertyDef = {
  id: 'sizes',
  key: 'sizes',
  name: 'Sizes',
  type: 'simpleTableBlock',
  description: '',
  icon: null,
  visibility: 'alwaysShow',
  options: {},
}

const MD = '| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n| Pear | 5 |'

describe('Table property (M31)', () => {
  test('the header row is styled as column names and marked as headers', () => {
    render(<SimpleTableCell def={def} value={MD} onChange={() => {}} />)
    const name = screen.getByDisplayValue('Name')
    expect(name.closest('th')).not.toBeNull()
    expect(screen.getByDisplayValue('Apple').closest('td')).not.toBeNull()
    expect(screen.getByRole('table', { name: 'Sizes' })).toBeInTheDocument()
  })

  test('Remove row and Remove column save the table at once; the header row has no Remove', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SimpleTableCell def={def} value={MD} onChange={onChange} />)
    expect(screen.queryByRole('button', { name: 'Remove row 1' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Remove row 2' }))
    expect(onChange).toHaveBeenLastCalledWith('| Name | Qty |\n| --- | --- |\n| Pear | 5 |')
    await user.click(screen.getByRole('button', { name: 'Remove column 2' }))
    expect(onChange).toHaveBeenLastCalledWith('| Name |\n| --- |\n| Pear |')
  })

  test('Add row and Add column save the grown table; removing every column clears the value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SimpleTableCell def={def} value={'| A |\n| --- |\n| 1 |'} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Add row' }))
    expect(onChange).toHaveBeenLastCalledWith('| A |\n| --- |\n| 1 |\n|  |')
    await user.click(screen.getByRole('button', { name: 'Add column' }))
    expect(onChange).toHaveBeenLastCalledWith('| A |  |\n| --- | --- |\n| 1 |  |\n|  |  |')
    await user.click(screen.getByRole('button', { name: 'Remove column 2' }))
    await user.click(screen.getByRole('button', { name: 'Remove column 1' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('button', { name: 'Add table' })).toBeInTheDocument()
  })

  test('read-only shows the table without inputs or buttons', () => {
    render(<SimpleTableCell def={def} value={MD} readOnly onChange={() => {}} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull()
    expect(screen.getByRole('cell', { name: 'Apple' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Qty' })).toBeInTheDocument()
  })

  test('in a table view it shows "2 rows", and the peek opens the table to edit', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SimpleTableCell def={def} value={MD} density="table" inTable onChange={onChange} />)
    const pill = screen.getByRole('button', { name: '2 rows' })
    expect(pill).toHaveAttribute('title', 'Name, Qty')
    expect(screen.queryByDisplayValue('Apple')).toBeNull()
    await user.click(pill)
    const peek = await screen.findByRole('dialog', { name: 'Sizes' })
    const cell = within(peek).getByDisplayValue('3')
    await user.clear(cell)
    await user.type(cell, '4')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith('| Name | Qty |\n| --- | --- |\n| Apple | 4 |\n| Pear | 5 |')
  })

  test('a card shows the count only; an empty table cell is blank', () => {
    const { unmount } = render(<SimpleTableCell def={def} value={MD} density="table" readOnly onChange={() => {}} />)
    expect(screen.getByText('2 rows')).toBeInTheDocument()
    unmount()
    const { container } = render(<SimpleTableCell def={def} value={null} density="table" inTable onChange={() => {}} />)
    expect(container).toHaveTextContent('')
    expect(tableSummary([['Name']])).toBe('0 rows')
    expect(tableSummary([['Name'], ['a']])).toBe('1 row')
  })

  test('kind changes: a table to and from Text and Text block', () => {
    expect(KIND_TRANSFORMS.simpleTableBlock).toEqual(['text', 'textBlock'])
    expect(allowedKindChanges('text')).toContain('simpleTableBlock')
    expect(allowedKindChanges('textBlock')).toContain('simpleTableBlock')
    expect(allowedKindChanges('number')).not.toContain('simpleTableBlock')
  })
})

// M31 fix pass, finding 8: only line 2 is the separator; a dash-only cell is escaped on write
// (`\-`, which GFM shows as "-") and read back as typed; `|` and `\` in cells round-trip.
describe('Table cells that look like Markdown (M31 fix)', () => {
  const STEPS = [['Step'], ['Boil'], ['-'], ['Serve']]
  const STEPS_MD = '| Step |\n| --- |\n| Boil |\n| \\- |\n| Serve |'

  test('a dash-only cell is escaped on write and kept on read, also with CRLF and a BOM', () => {
    expect(serializeGfmTable(STEPS)).toBe(STEPS_MD)
    expect(parseGfmTable(STEPS_MD)).toEqual(STEPS)
    expect(parseGfmTable(STEPS_MD.replace(/\n/g, '\r\n'))).toEqual(STEPS)
    expect(parseGfmTable('\uFEFF' + STEPS_MD.replace(/\n/g, '\r\n'))).toEqual(STEPS)
    const rows = [
      ['A', 'B'],
      ['---', ':-:'],
      [':--', '--:'],
    ]
    const md = serializeGfmTable(rows)
    expect(md).toBe('| A | B |\n| --- | --- |\n| \\--- | \\:-: |\n| \\:-- | \\--: |')
    expect(parseGfmTable(md)).toEqual(rows)
    // A hand-written later line of dashes is a row, not a second separator.
    expect(parseGfmTable('| Step |\n|---|\n| Boil |\n| - |\n|:--:|')).toEqual([['Step'], ['Boil'], ['-'], [':--:']])
  })

  test('pipes and backslashes in cells round-trip, as the backend writes them', () => {
    const rows = [
      ['a|b', 'c\\d'],
      ['\\', 'x\\|y'],
      ['|', 'end\\'],
      ['\\-', '\\\\'],
    ]
    const md = serializeGfmTable(rows)
    expect(md).toBe('| a\\|b | c\\\\d |\n| --- | --- |\n| \\\\ | x\\\\\\|y |\n| \\| | end\\\\ |\n| \\\\- | \\\\\\\\ |')
    expect(parseGfmTable(md)).toEqual(rows)
    expect(parseGfmTable(md.replace(/\n/g, '\r\n'))).toEqual(rows)
    expect(parseGfmTable('| Path |\n| --- |\n| C:\\temp |')).toEqual([['Path'], ['C:\\temp']])
  })

  test('typing "-" in a cell saves the escaped table and the row stays', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <SimpleTableCell def={def} value={'| Step |\n| --- |\n| Boil |\n| x |\n| Serve |'} onChange={onChange} />,
    )
    const cell = screen.getByDisplayValue('x')
    await user.clear(cell)
    await user.type(cell, '-')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(STEPS_MD)
    rerender(<SimpleTableCell def={def} value={STEPS_MD} onChange={onChange} />)
    expect(screen.getByDisplayValue('-')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Serve')).toBeInTheDocument()
    rerender(<SimpleTableCell def={def} value={STEPS_MD} density="table" inTable onChange={onChange} />)
    expect(screen.getByRole('button', { name: '3 rows' })).toBeInTheDocument()
  })
})
