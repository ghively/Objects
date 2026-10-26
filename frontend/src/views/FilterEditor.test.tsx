import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { FilterGroup } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { FilterEditor } from './FilterEditor'
import { emptyFilterGroup } from './model'
import { propertyChoices } from './properties'

const PAGE = typeDef({
  id: 'page',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({ id: 'note', type: 'text', name: 'Note' }),
  ],
})
const choices = propertyChoices([PAGE])

function Harness({ init = emptyFilterGroup(), onChange }: { init?: FilterGroup; onChange?: (g: FilterGroup) => void }) {
  const [group, setGroup] = useState(init)
  return (
    <FilterEditor
      group={group}
      onChange={(g) => {
        setGroup(g)
        onChange?.(g)
      }}
      choices={choices}
      types={[PAGE]}
      collections={[]}
    />
  )
}

describe('FilterEditor', () => {
  test('test second row shows and/or dropdown that sets group operator', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '+ Filter' }))
    expect(screen.getByText('where')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Group operator' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Filter' }))
    await user.click(screen.getByRole('button', { name: '+ Filter' }))
    const select = screen.getByRole('combobox', { name: 'Group operator' })
    await user.selectOptions(select, 'or')
    expect((onChange.mock.calls.at(-1)![0] as FilterGroup).operator).toBe('or')
    // The third row shows a static chip with the operator.
    expect(screen.getByTestId('group-operator')).toHaveTextContent('or')
  })

  test('test turn into group then remove last nested filter ungroups', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '+ Filter' }))
    await user.click(screen.getByRole('button', { name: 'Filter options' }))
    await user.click(await screen.findByRole('button', { name: 'Turn into group' }))
    const group = screen.getByTestId('filter-group')
    expect((onChange.mock.calls.at(-1)![0] as FilterGroup).elements[0]).toMatchObject({ type: 'filterGroup' })
    const menus = within(group).getAllByRole('button', { name: 'Filter options' })
    await user.click(menus[menus.length - 1])
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(screen.queryByTestId('filter-group')).not.toBeInTheDocument()
    expect((onChange.mock.calls.at(-1)![0] as FilterGroup).elements).toEqual([])
  })

  test('Ungroup puts the nested filters back in the parent', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const f = { type: 'filter' as const, propertyId: 'title', option: 'isEmpty' }
    render(<Harness onChange={onChange} init={{ type: 'filterGroup', operator: 'and', elements: [{ type: 'filterGroup', operator: 'or', elements: [f, f] }] }} />)
    const group = screen.getByTestId('filter-group')
    await user.click(within(group).getAllByRole('button', { name: 'Filter options' })[0])
    await user.click(await screen.findByRole('button', { name: 'Ungroup' }))
    expect((onChange.mock.calls.at(-1)![0] as FilterGroup).elements).toEqual([f, f])
  })

  test('test invalid filter shown as Will be ignored', () => {
    render(
      <Harness
        init={{
          type: 'filterGroup',
          operator: 'and',
          elements: [{ type: 'filter', propertyId: 'gone', option: 'contains', referenceValue: 'x' }],
        }}
      />,
    )
    expect(screen.getByText('Will be ignored')).toBeInTheDocument()
    expect(screen.getAllByText('Invalid').length).toBeGreaterThan(0)
  })

  test('shows "No eligible properties available" without properties', () => {
    render(<FilterEditor group={emptyFilterGroup()} onChange={() => undefined} choices={[]} types={[]} collections={[]} />)
    expect(screen.getByText('No eligible properties available')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Filter' })).not.toBeInTheDocument()
  })

  test('+ Filter group adds a group of two filters', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '+ Filter group' }))
    const g = (onChange.mock.calls.at(-1)![0] as FilterGroup).elements[0] as FilterGroup
    expect(g.type).toBe('filterGroup')
    expect(g.elements).toHaveLength(2)
  })
})
