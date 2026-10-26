import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CustomRepeatDialog } from './CustomRepeatDialog'
import { formatRepeat } from './repeat'

describe('CustomRepeatDialog', () => {
  it('test custom repeat dialog saves every N unit, based on, ends', async () => {
    const onSave = vi.fn()
    render(<CustomRepeatDialog initial={null} day="2026-10-30" onSave={onSave} onCancel={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Custom repeat' })).toBeInTheDocument()
    for (const s of ['Every', 'Based on', 'Ends', 'Never', 'On date (inclusive)', 'Cancel', 'Save']) expect(screen.getByText(s)).toBeInTheDocument()
    expect(screen.getByText('Scheduled date').closest('label')).toHaveAttribute(
      'title',
      'Repeats on a fixed schedule relative to the due date, regardless of when you complete the task.',
    )
    expect(screen.getByText('Completed date').closest('label')).toHaveAttribute(
      'title',
      'The next occurrence is scheduled relative to when you actually complete the task.',
    )
    const every = screen.getByLabelText('Every')
    await userEvent.clear(every)
    await userEvent.type(every, '2')
    expect(screen.getByRole('option', { name: 'Weeks' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'week')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({ every: 2, unit: 'week', mode: 'dueDate' })
    expect(formatRepeat(onSave.mock.calls[0][0])).toBe('every 2 weeks')
  })

  it('test completed date writes "after completion"; on date writes "until"', async () => {
    const onSave = vi.fn()
    render(<CustomRepeatDialog initial={null} day="2026-10-30" onSave={onSave} onCancel={() => {}} />)
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'month')
    await userEvent.click(screen.getByLabelText('Completed date'))
    await userEvent.click(screen.getByLabelText('On date (inclusive)'))
    const end = screen.getByLabelText('End date')
    await userEvent.clear(end)
    await userEvent.type(end, '2027-06-30')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const rule = onSave.mock.calls[0][0]
    expect(formatRepeat(rule)).toBe('every month after completion until 2027-06-30')
  })

  it('starts from the current rule; Cancel saves nothing; N must be at least 1', async () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(
      <CustomRepeatDialog
        initial={{ every: 3, unit: 'year', mode: 'completionDate', until: '2030-01-01' }}
        day="2026-10-30"
        onSave={onSave}
        onCancel={onCancel}
      />,
    )
    expect(screen.getByLabelText('Every')).toHaveValue(3)
    expect(screen.getByLabelText('Unit')).toHaveValue('year')
    expect(screen.getByLabelText('Completed date')).toBeChecked()
    expect(screen.getByLabelText('End date')).toHaveValue('2030-01-01')
    await userEvent.clear(screen.getByLabelText('Every'))
    await userEvent.type(screen.getByLabelText('Every'), '0')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
