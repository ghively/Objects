import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { propertyDef, typeDef } from '@/test/mockApi'
import { GroupEditor } from './GroupEditor'
import { propertyChoices } from './properties'

const status = propertyDef({
  id: 'status',
  type: 'label',
  name: 'Status',
  options: { isStatus: true, set: [{ id: 's1', text: 'Done', color: null, icon: null, statusCategory: 'done' }] },
})
const choices = propertyChoices([typeDef({ id: 'task', propertyDefinitions: [status, propertyDef({ id: 'date', type: 'datetimeSimple', name: 'Date' })] })])

describe('GroupEditor (M4)', () => {
  test('a status label offers "By category"', () => {
    const onChange = vi.fn()
    render(<GroupEditor groupBy={{ groups: [{ propertyId: 'status', option: 'default' }] }} onChange={onChange} choices={choices} />)
    fireEvent.click(screen.getByRole('button', { name: 'Group option' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'By category' }))
    expect(onChange).toHaveBeenCalledWith({ groups: [{ propertyId: 'status', option: 'statusCategory' }] })
  })

  test('a date offers "Scheduled"', () => {
    render(<GroupEditor groupBy={{ groups: [{ propertyId: 'date', option: 'day' }] }} onChange={() => {}} choices={choices} />)
    fireEvent.click(screen.getByRole('button', { name: 'Group option' }))
    expect(screen.getAllByRole('menuitemradio').map((b) => b.textContent)).toContain('Scheduled')
  })
})
