// M9 Task 14: template date variables ({creation:day|week|month|year}) in the date cell.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PropertyDef, PropertyType } from '@/api/types'
import { DateCell } from './DateCell'

function def(type: PropertyType, extra: Partial<PropertyDef> = {}): PropertyDef {
  return { id: 'due', key: 'due', name: 'Due', type, description: '', icon: null, visibility: 'alwaysShow', options: {}, ...extra }
}

const TEMPLATE = { type: 'Page', template: 'Weekly', title: 'Weekly' }

describe('DateCell template variables', () => {
  it('test variable picker only on templates and datetime', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<DateCell def={def('datetime')} value={null} frontmatter={TEMPLATE} onChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Edit Due' }))
    expect(screen.getByRole('button', { name: 'Template variable' })).toHaveTextContent('Select variable')
    unmount()

    // Not a template: no picker.
    const second = render(<DateCell def={def('datetime')} value={null} frontmatter={{ type: 'Page' }} onChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Edit Due' }))
    expect(screen.queryByRole('button', { name: 'Template variable' })).toBeNull()
    second.unmount()

    // A template, but not a `datetime` property: no picker.
    render(<DateCell def={def('datetimeSimple')} value={null} frontmatter={TEMPLATE} onChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Edit Due' }))
    expect(screen.queryByRole('button', { name: 'Template variable' })).toBeNull()
  })

  it('test choosing week writes {creation:week}', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DateCell
        def={def('datetime')}
        value={{ start: '2026-10-30', resolution: 'day' }}
        frontmatter={{ ...TEMPLATE, due: '2026-10-30' }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Edit Due' }))
    await user.click(screen.getByRole('button', { name: 'Template variable' }))
    expect(screen.getAllByRole('menuitemradio').map((b) => b.textContent)).toEqual([
      'Select variable',
      'Day of creation',
      'Week of creation',
      'Month of creation',
      'Year of creation',
    ])
    await user.click(screen.getByRole('menuitemradio', { name: 'Week of creation' }))
    // The variable replaces the date value.
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('{creation:week}')
  })

  it('test select variable clears it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateCell def={def('datetime')} value={null} frontmatter={{ ...TEMPLATE, due: '{creation:month}' }} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Edit Due' }))
    const picker = screen.getByRole('button', { name: 'Template variable' })
    expect(picker).toHaveTextContent('Month of creation')
    await user.click(picker)
    await user.click(screen.getByRole('menuitemradio', { name: 'Select variable' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('test value shows label', () => {
    // Quoted in YAML it is a string; unquoted, YAML reads it as a one-key mapping.
    const { unmount } = render(
      <DateCell def={def('datetime')} value={null} frontmatter={{ ...TEMPLATE, due: '{creation:day}' }} onChange={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Edit Due' })).toHaveTextContent('Day of creation')
    unmount()
    render(<DateCell def={def('datetime')} value={null} frontmatter={{ ...TEMPLATE, due: { 'creation:year': null } }} onChange={() => {}} readOnly />)
    expect(screen.getByText('Year of creation')).toBeInTheDocument()
  })
})
