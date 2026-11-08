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
      'Each repeat is counted from the due date, no matter when you finish the task.',
    )
    expect(screen.getByText('Completed date').closest('label')).toHaveAttribute(
      'title',
      'Each repeat is counted from the day you actually finish the task.',
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

  it('test on row writes canonical rules', async () => {
    // 2026-10-30 is the 5th and last Friday of October (and not its last day).
    const cases: [string, (u: ReturnType<typeof userEvent.setup>) => Promise<void>, string][] = [
      [
        'week',
        async (u) => {
          await u.click(screen.getByRole('button', { name: 'Friday' }))
          await u.click(screen.getByRole('button', { name: 'Monday' }))
        },
        'every week on mon, fri',
      ],
      ['week', async () => {}, 'every week'],
      ['month', async () => {}, 'every month on the 30th'],
      ['month', async (u) => u.selectOptions(screen.getByLabelText('On'), 'Last Friday'), 'every month on the last friday'],
      ['year', async () => {}, 'every year on october 30'],
      ['year', async (u) => u.selectOptions(screen.getByLabelText('On'), 'Last Friday of October'), 'every year on the last friday of october'],
    ]
    for (const [unit, act, text] of cases) {
      const onSave = vi.fn()
      const u = userEvent.setup()
      const { unmount } = render(<CustomRepeatDialog initial={null} day="2026-10-30" onSave={onSave} onCancel={() => {}} />)
      await u.selectOptions(screen.getByLabelText('Unit'), unit)
      await act(u)
      await u.click(screen.getByRole('button', { name: 'Save' }))
      expect(formatRepeat(onSave.mock.calls[0][0]), text).toBe(text)
      unmount()
    }
  })

  it('the on choices follow the day and the expected strings', async () => {
    // 2026-10-13 is the 2nd Tuesday; 2026-09-30 is the last day and the last Wednesday.
    const { unmount } = render(<CustomRepeatDialog initial={null} day="2026-10-13" onSave={() => {}} onCancel={() => {}} />)
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'month')
    expect(screen.getAllByRole('option').map((o) => o.textContent).slice(4)).toEqual(['The 13th', '2nd Tuesday'])
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'year')
    expect(screen.getAllByRole('option').map((o) => o.textContent).slice(4)).toEqual(['October 13', '2nd Tuesday of October'])
    unmount()
    render(<CustomRepeatDialog initial={null} day="2026-09-30" onSave={() => {}} onCancel={() => {}} />)
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'month')
    expect(screen.getAllByRole('option').map((o) => o.textContent).slice(4)).toEqual(['The 30th', 'Last day', 'Last Wednesday'])
    // the On row is by scheduled date only
    await userEvent.click(screen.getByLabelText('Completed date'))
    expect(screen.queryByLabelText('On')).toBeNull()
  })

  it('starts from an anchored rule', async () => {
    const onSave = vi.fn()
    render(
      <CustomRepeatDialog
        initial={{ every: 2, unit: 'week', mode: 'dueDate', on: { weekdays: ['tue', 'thu'] } }}
        day="2026-10-30"
        onSave={onSave}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(formatRepeat(onSave.mock.calls[0][0])).toBe('every 2 weeks on tue, thu')
  })
})
