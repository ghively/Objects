import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { FilterGroup } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { useSettings } from '@/settings/useSettings'
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
    expect(screen.queryByRole('button', { name: 'Group operator' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Filter' }))
    await user.click(screen.getByRole('button', { name: '+ Filter' }))
    await user.click(screen.getByRole('button', { name: 'Group operator' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'or' }))
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

  test('test property and operator are menus: icon + name rows, a check on the current one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '+ Filter' }))
    expect(document.querySelector('select')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Property' }))
    const menu = await screen.findByRole('menu', { name: 'Property' })
    const title = within(menu).getByRole('menuitemradio', { name: 'Title' })
    expect(title).toHaveAttribute('aria-checked', 'true')
    expect(title.querySelector('[data-icon]')).not.toBeNull()
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Note' }))
    expect((onChange.mock.calls.at(-1)![0] as FilterGroup).elements[0]).toMatchObject({ propertyId: 'note' })
    expect(screen.getByRole('button', { name: 'Property' })).toHaveTextContent('Note')
  })

  test('test date filter says Select date until a date is chosen', async () => {
    const user = userEvent.setup()
    const T = typeDef({ id: 'task', propertyDefinitions: [propertyDef({ id: 'due', type: 'datetime', name: 'Due' })] })
    const init: FilterGroup = { type: 'filterGroup', operator: 'and', elements: [{ type: 'filter', propertyId: 'due', option: 'isBefore' }] }
    render(<FilterEditor group={init} onChange={() => undefined} choices={propertyChoices([T])} types={[T]} collections={[]} />)
    expect(screen.getByRole('button', { name: 'Date' })).toHaveTextContent('Select date')
    await user.click(screen.getByRole('button', { name: 'Date' }))
    expect(await screen.findByRole('menu', { name: 'Date' })).toBeInTheDocument()
  })

  test('"Specific date" defaults to today in the Time zone setting, not the UTC day (audit 2026-11-01)', async () => {
    useSettings.setState({ settings: { ...useSettings.getState().settings, timeZone: 'America/Los_Angeles' } })
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-11-01T03:00:00Z') }) // Oct 31, 8 PM in LA
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onChange = vi.fn()
    const T = typeDef({ id: 'task', propertyDefinitions: [propertyDef({ id: 'due', type: 'datetime', name: 'Due' })] })
    const init: FilterGroup = { type: 'filterGroup', operator: 'and', elements: [{ type: 'filter', propertyId: 'due', option: 'is' }] }
    try {
      render(<FilterEditor group={init} onChange={onChange} choices={propertyChoices([T])} types={[T]} collections={[]} />)
      await user.click(screen.getByRole('button', { name: 'Date' }))
      await user.click(await screen.findByRole('menuitemradio', { name: 'Specific date' }))
      expect((onChange.mock.calls[0][0] as FilterGroup).elements[0]).toMatchObject({ referenceValue: { exactDate: '2026-10-31' } })
    } finally {
      vi.useRealTimers()
      useSettings.setState({ settings: { ...useSettings.getState().settings, timeZone: null } })
    }
  })

  test('a percentage filter value is typed in percent and stored as the fraction', () => {
    const T = typeDef({
      id: 'deal',
      propertyDefinitions: [propertyDef({ id: 'odds', type: 'number', name: 'Odds', options: { numberFormat: { type: 'percentage', options: {} } } })],
    })
    const onChange = vi.fn()
    const init: FilterGroup = {
      type: 'filterGroup',
      operator: 'and',
      elements: [{ type: 'filter', propertyId: 'odds', option: 'greater', referenceValue: 0.143 }],
    }
    render(<FilterEditor group={init} onChange={onChange} choices={propertyChoices([T])} types={[T]} collections={[]} />)
    const value = screen.getByRole('textbox', { name: 'Value' })
    expect(value).toHaveValue('14.3')
    fireEvent.change(value, { target: { value: '25' } })
    expect((onChange.mock.calls.at(-1)![0] as FilterGroup).elements[0]).toMatchObject({ referenceValue: 0.25 })
  })

  test('a number being typed (1., -, 1e) keeps the last value; leaving shows the value applied', async () => {
    const T = typeDef({ id: 'deal', propertyDefinitions: [propertyDef({ id: 'amount', type: 'number', name: 'Amount' })] })
    const onChange = vi.fn()
    function H() {
      const [group, setGroup] = useState<FilterGroup>({
        type: 'filterGroup',
        operator: 'and',
        elements: [{ type: 'filter', propertyId: 'amount', option: 'greater', referenceValue: 3 }],
      })
      return (
        <FilterEditor
          group={group}
          onChange={(g) => {
            setGroup(g)
            onChange(g)
          }}
          choices={propertyChoices([T])}
          types={[T]}
          collections={[]}
        />
      )
    }
    const user = userEvent.setup()
    render(<H />)
    const value = screen.getByRole('textbox', { name: 'Value' })
    const ref = () => ((onChange.mock.calls.at(-1)![0] as FilterGroup).elements[0] as { referenceValue?: unknown }).referenceValue
    await user.clear(value)
    await user.type(value, '1.')
    expect(value).toHaveValue('1.')
    expect(ref()).toBe(1)
    await user.type(value, '5')
    expect(ref()).toBe(1.5)
    await user.type(value, '-', { initialSelectionStart: 0, initialSelectionEnd: 3 })
    expect(value).toHaveValue('-')
    // "-" is a number being typed: the filter keeps the last value applied.
    expect(ref()).toBe(1.5)
    await user.type(value, '2e')
    expect(value).toHaveValue('-2e')
    expect(ref()).toBe(-2)
    await user.type(value, '1')
    expect(ref()).toBe(-20)
    await user.type(value, 'e')
    await user.tab()
    expect(value).toHaveValue('-20')
  })

  test('a number filter reads numbers as the number cells do: the decimal comma, "+5", no infinity', () => {
    const T = typeDef({ id: 'deal', propertyDefinitions: [propertyDef({ id: 'amount', type: 'number', name: 'Amount' })] })
    const onChange = vi.fn()
    const init: FilterGroup = {
      type: 'filterGroup',
      operator: 'and',
      elements: [{ type: 'filter', propertyId: 'amount', option: 'greater', referenceValue: 3 }],
    }
    const before = useSettings.getState().settings
    useSettings.setState({ settings: { ...before, decimalSeparator: 'comma' } })
    try {
      render(<FilterEditor group={init} onChange={onChange} choices={propertyChoices([T])} types={[T]} collections={[]} />)
      const value = screen.getByRole('textbox', { name: 'Value' })
      const ref = () => ((onChange.mock.calls.at(-1)![0] as FilterGroup).elements[0] as { referenceValue?: unknown }).referenceValue
      fireEvent.change(value, { target: { value: '1,5' } })
      expect(value).not.toHaveAttribute('aria-invalid')
      expect(ref()).toBe(1.5)
      fireEvent.change(value, { target: { value: '+5' } })
      expect(value).not.toHaveAttribute('aria-invalid')
      expect(ref()).toBe(5)
      const calls = onChange.mock.calls.length
      fireEvent.change(value, { target: { value: '1e400' } })
      expect(onChange.mock.calls.length).toBe(calls) // not applied
      expect(value).toHaveAttribute('aria-invalid', 'true')
    } finally {
      useSettings.setState({ settings: before })
    }
  })

  test('shows "No properties can be filtered here" without properties', () => {
    render(<FilterEditor group={emptyFilterGroup()} onChange={() => undefined} choices={[]} types={[]} collections={[]} />)
    expect(screen.getByText('No properties can be filtered here')).toBeInTheDocument()
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
