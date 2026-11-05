// M12: the property panel reads formula and rollup values from the object read's `computed` map
// (never from frontmatter) and decodes a files value's wikilinks to paths.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { resetLinkIndex } from '@/links/linkIndex'
import { cellValue, PropertyPanel } from './PropertyPanel'

const total = propertyDef({ id: 'total', key: 'total', name: 'Total', type: 'formula', options: { expression: 'prop("Qty") * 2' } })
const late = propertyDef({ id: 'late', key: 'late', name: 'Late', type: 'formula', visibility: 'hideWhenEmpty', options: { expression: '' } })
const att = propertyDef({ id: 'att', key: 'att', name: 'Attachments', type: 'files', options: { isArray: true } })
const num = propertyDef({ id: 'num', key: 'num', name: 'Number', type: 'uniqueId', options: { prefix: '', nextNumber: 5 } })
const TYPE = typeDef({ id: 'task', name: 'Task', propertyDefinitions: [total, late, att, num] })
const summary = objectSummary({ path: 'Tasks/A.md', type: 'task' })

beforeEach(() => resetLinkIndex())

describe('PropertyPanel: M12 values', () => {
  test('cellValue reads computed kinds from `computed`, files as paths, and a numeric ID as text', () => {
    const fm = { total: 'stale text in the file', att: ['[[Attachments/a.pdf]]', '[[Attachments/b c.png|B]]'], num: 12 }
    const computed = { total: { type: 'number' as const, value: 8 } }
    expect(cellValue(total, fm, {}, summary, [], computed)).toEqual({ type: 'number', value: 8 })
    expect(cellValue(late, fm, {}, summary, [], computed)).toBeNull()
    expect(cellValue(att, fm, {}, summary)).toEqual(['Attachments/a.pdf', 'Attachments/b c.png'])
    expect(cellValue(num, fm, {}, summary)).toBe('12')
  })

  test('the panel shows formula values from `computed` and hides an empty one set to hide when empty', () => {
    render(
      <PropertyPanel
        type={TYPE}
        frontmatter={{ att: ['[[Attachments/a.pdf]]'], num: 'TASK-3' }}
        summary={summary}
        computed={{ total: { type: 'number', value: 8 }, late: { type: 'empty', value: null } }}
        onChange={() => undefined}
      />,
    )
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(document.querySelector('[data-property-row="Late"]')).toBeNull()
    expect(screen.getByText('a.pdf')).toBeInTheDocument()
    expect(screen.getByText('TASK-3')).toBeInTheDocument()
  })

  test('a formula error is shown even when set to hide when empty', () => {
    render(
      <PropertyPanel
        type={TYPE}
        frontmatter={{}}
        summary={summary}
        computed={{ late: { type: 'error', value: null, error: 'Unknown function "foo"' } }}
        onChange={() => undefined}
      />,
    )
    expect(screen.getByText('Formula error')).toHaveAttribute('title', 'Unknown function "foo"')
  })

  test('Delete on a formula deletes it straight away; another kind still asks to type "delete"', async () => {
    const user = userEvent.setup()
    const note = propertyDef({ id: 'note', key: 'note', name: 'Note', type: 'text' })
    const T = typeDef({ id: 'task', name: 'Task', propertyDefinitions: [total, note] })
    const onTypeChange = vi.fn()
    render(
      <PropertyPanel
        type={T}
        frontmatter={{ note: 'hi' }}
        summary={summary}
        computed={{ total: { type: 'number', value: 8 } }}
        onChange={() => undefined}
        onTypeChange={onTypeChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Total property menu' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onTypeChange).toHaveBeenCalledTimes(1)
    expect(onTypeChange.mock.calls[0][0].propertyDefinitions.map((d: { id: string }) => d.id)).toEqual(['note'])

    await user.click(screen.getByRole('button', { name: 'Note property menu' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Type "delete" to confirm' })).toBeInTheDocument()
    expect(onTypeChange).toHaveBeenCalledTimes(1)
  })
})
