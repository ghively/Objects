// M12: a formula filter's value editor follows its operator (text, number or date).
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Filter, FilterGroup } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { FilterEditor } from './FilterEditor'
import { propertyChoices } from './properties'

const PAGE = typeDef({
  id: 'page',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({ id: 'calc', type: 'formula', name: 'Calc', options: { expression: '1' } }),
    propertyDef({ id: 'mail', type: 'email', name: 'Mail' }),
  ],
})
const choices = propertyChoices([PAGE])
const one = (filter: Filter): FilterGroup => ({ type: 'filterGroup', operator: 'and', elements: [filter] })
const show = (filter: Filter) =>
  render(<FilterEditor group={one(filter)} onChange={() => {}} choices={choices} types={[PAGE]} collections={[]} />)

describe('FilterEditor: M12 kinds', () => {
  test('a text operator takes text, a number comparison a number, a date comparison a date, empty none', () => {
    const { unmount } = show({ type: 'filter', propertyId: 'calc', option: 'contains', referenceValue: 'abc' })
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveValue('abc')
    unmount()
    const n = show({ type: 'filter', propertyId: 'calc', option: 'greater', referenceValue: 3 })
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveValue('3')
    n.unmount()
    const d = show({ type: 'filter', propertyId: 'calc', option: 'isBefore', referenceValue: { relative: 'today' } })
    expect(screen.getByRole('button', { name: 'Date' })).toBeInTheDocument()
    d.unmount()
    show({ type: 'filter', propertyId: 'calc', option: 'isEmpty' })
    expect(screen.queryByRole('textbox', { name: 'Value' })).toBeNull()
  })

  test('an email filter takes text', () => {
    show({ type: 'filter', propertyId: 'mail', option: 'contains', referenceValue: 'gmail' })
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveValue('gmail')
  })
})
