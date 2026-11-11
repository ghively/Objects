// M32 (notes first), item 13: a typed date and Enter set the date and close the cell's picker.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DateValue, PropertyDef } from '@/api/types'
import { DATE_TEXT } from '../DatePicker'
import { DateCell } from './DateCell'

function def(extra: Partial<PropertyDef> = {}): PropertyDef {
  return { id: 'due', key: 'due', name: 'Due', type: 'datetime', description: '', icon: null, visibility: 'alwaysShow', options: {}, ...extra }
}

/** The weekday (0 = Sunday) of a `YYYY-MM-DD` day. */
const weekday = (day: string) => new Date(`${day}T12:00:00`).getDay()

describe('DateCell typed dates (M32)', () => {
  it('test typing friday and Enter sets the date and closes the picker', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(v: DateValue | null) => void>()
    render(<DateCell def={def()} value={{ start: '2026-10-30', resolution: 'day' }} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Edit Due' }))
    const input = screen.getByRole('textbox', { name: 'Starts' })
    await user.clear(input)
    await user.type(input, 'friday{Enter}')
    expect(onChange).toHaveBeenCalledTimes(1)
    const set = onChange.mock.calls[0][0]!
    expect(set.resolution).toBe('day')
    expect(weekday(set.start)).toBe(5)
    expect(screen.queryByTestId('date-picker')).toBeNull()
  })

  it('test an unreadable date keeps the picker open with a message', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateCell def={def()} value={{ start: '2026-10-30', resolution: 'day' }} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Edit Due' }))
    const input = screen.getByRole('textbox', { name: 'Starts' })
    await user.clear(input)
    await user.type(input, 'whenever{Enter}')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('date-picker')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(DATE_TEXT.unreadable)
  })

  it('test Enter on the Task date writes the typed date once and closes', async () => {
    const user = userEvent.setup()
    const onChangeMany = vi.fn()
    const taskDate = def({
      id: 'date',
      key: 'date',
      name: 'Date',
      options: { constraints: { resolutionPreference: 'day', endTimeSettings: 'notAllowed', supportsReminders: true } },
    })
    render(
      <DateCell
        def={taskDate}
        value={{ start: '2026-10-30', resolution: 'day' }}
        typeId="task"
        frontmatter={{ type: 'Task', date: '2026-10-30' }}
        onChange={() => {}}
        onChangeMany={onChangeMany}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Edit Date' }))
    const input = screen.getByRole('textbox', { name: 'Starts' })
    await user.clear(input)
    await user.type(input, 'friday{Enter}')
    expect(screen.queryByTestId('date-picker')).toBeNull()
    expect(onChangeMany).toHaveBeenCalledTimes(1)
    const [updates, remove] = onChangeMany.mock.calls[0]
    expect(Object.keys(updates)).toEqual(['date'])
    expect(weekday(updates.date.start)).toBe(5)
    expect(remove).toBeUndefined()
  })
})
