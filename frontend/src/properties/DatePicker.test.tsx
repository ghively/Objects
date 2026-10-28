import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DatePicker, parseDateInput } from './DatePicker'

// Wednesday 21 Oct 2026, 10:30 local time.
const NOW = new Date(2026, 9, 21, 10, 30)

describe('DatePicker', () => {
  it('test DatePicker hides "Range" when endTimeSettings notAllowed and forces time when resolutionConstraint time', async () => {
    const onChange = vi.fn()
    const { unmount } = render(
      <DatePicker value={null} constraints={{ endTimeSettings: 'notAllowed' }} onChange={onChange} now={NOW} />,
    )
    expect(screen.queryByText('Range')).toBeNull()
    expect(screen.getByText('Include Time')).toBeInTheDocument()
    unmount()

    render(<DatePicker value={null} constraints={{ resolutionConstraint: 'time' }} onChange={onChange} now={NOW} />)
    const includeTime = screen.getByRole('switch', { name: 'Include Time' })
    expect(includeTime).toBeChecked()
    expect(includeTime).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Tomorrow' }))
    const v = onChange.mock.calls.at(-1)![0]
    expect(v.resolution).toBe('time')
    expect(new Date(v.start).getDate()).toBe(22)
  })

  it('test DatePicker starts from startTimeDefault and hides delete when hideDeleteOption', () => {
    const start = new Date(2026, 10, 2, 9, 0).toISOString()
    const { unmount } = render(
      <DatePicker
        value={null}
        constraints={{ startTimeDefault: start, hideDeleteOption: true }}
        onChange={() => {}}
        now={NOW}
      />,
    )
    expect(screen.getByRole('textbox', { name: 'Starts' })).toHaveValue('Nov 2, 2026, 9:00 AM')
    expect(screen.queryByRole('button', { name: 'Remove date' })).toBeNull()
    unmount()

    render(<DatePicker value={{ start: '2026-10-30', resolution: 'day' }} onChange={() => {}} now={NOW} />)
    expect(screen.getByRole('button', { name: 'Remove date' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Starts' })).toHaveValue('Oct 30, 2026')
  })

  it('typing a phrase and Enter sets the date; Range adds an end', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <DatePicker value={{ start: '2026-10-30', resolution: 'day' }} onChange={onChange} now={NOW} />,
    )
    const input = screen.getByRole('textbox', { name: 'Starts' })
    await userEvent.clear(input)
    await userEvent.type(input, 'in 3 days{Enter}')
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-10-24', resolution: 'day' })

    rerender(<DatePicker value={{ start: '2026-10-24', resolution: 'day' }} onChange={onChange} now={NOW} />)
    await userEvent.click(screen.getByRole('switch', { name: 'Range' }))
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-10-24', end: '2026-10-24', resolution: 'day' })

    rerender(
      <DatePicker value={{ start: '2026-10-24', end: '2026-10-24', resolution: 'day' }} onChange={onChange} now={NOW} />,
    )
    expect(screen.getByText('Ends')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '1 week' }))
    expect(onChange).toHaveBeenLastCalledWith({ start: '2026-10-24', end: '2026-10-31', resolution: 'day' })
  })

  it('remove clears the value', async () => {
    const onChange = vi.fn()
    render(<DatePicker value={{ start: '2026-10-30', resolution: 'day' }} onChange={onChange} now={NOW} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove date' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('test remove date asks first when the recurring task has history', async () => {
    const onTaskChange = vi.fn()
    const value = { start: '2026-10-30', resolution: 'day' as const }
    const { unmount } = render(
      <DatePicker
        value={value}
        onChange={() => {}}
        now={NOW}
        task={{ repeat: 'every day', remind: null, occurrenceLog: '2026-10-24 completed 2026-10-24T07:55:10Z' }}
        onTaskChange={onTaskChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove date' }))
    expect(onTaskChange).not.toHaveBeenCalled()
    const confirm = screen.getByRole('alertdialog', { name: 'Remove date?' })
    expect(confirm).toHaveTextContent(
      'This recurring task already has completed or skipped occurrences. Removing the date will discard its history.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Keep date' }))
    expect(onTaskChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Remove date' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove date' }))
    expect(onTaskChange).toHaveBeenCalledWith({ date: null, repeat: null, remind: null })
    unmount()

    // Without history it removes at once.
    onTaskChange.mockClear()
    render(
      <DatePicker
        value={value}
        onChange={() => {}}
        now={NOW}
        task={{ repeat: 'every day', remind: null, occurrenceLog: null }}
        onTaskChange={onTaskChange}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove date' }))
    expect(onTaskChange).toHaveBeenCalledWith({ date: null, repeat: null, remind: null })
  })
})

describe('parseDateInput', () => {
  it('test parseDateInput natural phrases', () => {
    expect(parseDateInput('2026-03-14', NOW)).toEqual({ start: '2026-03-14', resolution: 'day' })
    expect(parseDateInput('2026-03-14T13:59:00.000Z', NOW)).toEqual({
      start: '2026-03-14T13:59:00.000Z',
      resolution: 'time',
    })
    expect(parseDateInput('Yesterday', NOW)).toEqual({ start: '2026-10-20', resolution: 'day' })
    expect(parseDateInput('today', NOW)).toEqual({ start: '2026-10-21', resolution: 'day' })
    expect(parseDateInput('Tomorrow', NOW)).toEqual({ start: '2026-10-22', resolution: 'day' })
    expect(parseDateInput('in 3 days', NOW)).toEqual({ start: '2026-10-24', resolution: 'day' })
    expect(parseDateInput('in 2 weeks', NOW)).toEqual({ start: '2026-11-04', resolution: 'day' })
    expect(parseDateInput('in 1 day', NOW)).toEqual({ start: '2026-10-22', resolution: 'day' })
    expect(parseDateInput('March 14th at 1:59 PM', NOW)).toEqual({
      start: new Date(2026, 2, 14, 13, 59).toISOString(),
      resolution: 'time',
    })
    expect(parseDateInput('March 14th', NOW)).toEqual({ start: '2026-03-14', resolution: 'day' })
    expect(parseDateInput('Dec 1 2027', NOW)).toEqual({ start: '2027-12-01', resolution: 'day' })
    expect(parseDateInput('tomorrow at 9 am', NOW)).toEqual({
      start: new Date(2026, 9, 22, 9, 0).toISOString(),
      resolution: 'time',
    })
    expect(parseDateInput('not a date', NOW)).toBeNull()
    expect(parseDateInput('', NOW)).toBeNull()
  })
})

// M4 Task 9: the Task date picker (schedule suggestions, Repeat, Reminder).
describe('DatePicker: the Task date', () => {
  const TASK_C = { resolutionPreference: 'day' as const, endTimeSettings: 'notAllowed' as const, supportsReminders: true }

  it('test reminder presets follow resolution', async () => {
    const { unmount } = render(
      <DatePicker
        value={{ start: '2026-10-30', resolution: 'day' }}
        constraints={TASK_C}
        onChange={() => {}}
        task={{ repeat: null, remind: null }}
        onTaskChange={() => {}}
        now={NOW}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reminder: No reminder' }))
    const dayItems = screen.getAllByRole('menuitemradio').map((b) => b.textContent)
    expect(dayItems).toEqual(['No reminder', 'On the day', '1 day before', '2 days before', '7 days before'])
    expect(screen.getByLabelText('Time')).toHaveValue('09:00')
    for (const s of ['Morning', 'Noon', 'Afternoon', 'Evening', 'Night']) expect(screen.getByRole('button', { name: s })).toBeInTheDocument()
    unmount()

    render(
      <DatePicker
        value={{ start: new Date(2026, 9, 30, 14, 0).toISOString(), resolution: 'time' }}
        constraints={TASK_C}
        onChange={() => {}}
        task={{ repeat: null, remind: null }}
        onTaskChange={() => {}}
        now={NOW}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reminder: No reminder' }))
    const timeItems = screen.getAllByRole('menuitemradio').map((b) => b.textContent)
    expect(timeItems).toEqual(['No reminder', 'At time of event', '5 minutes before', '15 minutes before', '30 minutes before', '1 hour before'])
    expect(screen.queryByLabelText('Time')).toBeNull()
  })

  it('shows the schedule suggestions and the repeat presets named from the date', async () => {
    const onTaskChange = vi.fn()
    render(
      <DatePicker
        value={{ start: '2026-10-30', resolution: 'day' }}
        constraints={TASK_C}
        onChange={() => {}}
        task={{ repeat: null, remind: null }}
        onTaskChange={onTaskChange}
        now={NOW}
      />,
    )
    expect(screen.getByRole('button', { name: 'Next month' })).toHaveAttribute('title', 'Schedule task for the next month')
    expect(screen.queryByRole('button', { name: 'Yesterday' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(onTaskChange).toHaveBeenLastCalledWith({ date: { start: '2026-10-28', resolution: 'day' }, repeat: null, remind: null })
    await userEvent.click(screen.getByRole('button', { name: 'Repeat: No repeat' }))
    expect(screen.getAllByRole('menuitemradio').map((b) => b.textContent)).toEqual([
      'No repeat',
      'Daily',
      'Every weekday',
      'Weekly on Friday',
      'Monthly on day 30',
      'Yearly on October 30',
      'Custom',
    ])
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Monthly on day 30' }))
    expect(onTaskChange).toHaveBeenLastCalledWith({ date: { start: '2026-10-30', resolution: 'day' }, repeat: 'every month on the 30th', remind: null })
  })

  it('the Reminder row needs supportsReminders', () => {
    render(
      <DatePicker
        value={{ start: '2026-10-30', resolution: 'day' }}
        constraints={{ resolutionPreference: 'day', endTimeSettings: 'notAllowed' }}
        onChange={() => {}}
        task={{ repeat: null, remind: null }}
        onTaskChange={() => {}}
        now={NOW}
      />,
    )
    expect(screen.getByRole('button', { name: 'Repeat: No repeat' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Reminder:/ })).toBeNull()
  })

  it('test invalid repeat shown with hint and kept', async () => {
    const onTaskChange = vi.fn()
    render(
      <DatePicker
        value={{ start: '2026-10-30', resolution: 'day' }}
        constraints={TASK_C}
        onChange={() => {}}
        task={{ repeat: 'every 2 fortnights', remind: null }}
        onTaskChange={onTaskChange}
        now={NOW}
      />,
    )
    expect(screen.getByRole('button', { name: 'Repeat: every 2 fortnights' })).toBeInTheDocument()
    expect(screen.getByText('Not a valid repeat.')).toBeInTheDocument()
    // A date change keeps the text as it is.
    await userEvent.click(screen.getByRole('button', { name: 'Tomorrow' }))
    expect(onTaskChange).toHaveBeenLastCalledWith({ date: { start: '2026-10-22', resolution: 'day' }, repeat: 'every 2 fortnights', remind: null })
  })

  it("a reminder that doesn't fit the date is shown with a hint and kept", async () => {
    const onTaskChange = vi.fn()
    render(
      <DatePicker
        value={{ start: '2026-10-30', resolution: 'day' }}
        constraints={TASK_C}
        onChange={() => {}}
        task={{ repeat: null, remind: '15 minutes before' }}
        onTaskChange={onTaskChange}
        now={NOW}
      />,
    )
    expect(screen.getByText("Doesn't fit this date.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tomorrow' }))
    expect(onTaskChange).toHaveBeenLastCalledWith({ date: { start: '2026-10-22', resolution: 'day' }, repeat: null, remind: '15 minutes before' })
  })

  it('Custom opens the Custom repeat panel in place and saves the rule', async () => {
    const onTaskChange = vi.fn()
    render(
      <DatePicker
        value={{ start: '2026-10-30', resolution: 'day' }}
        constraints={TASK_C}
        onChange={() => {}}
        task={{ repeat: null, remind: null }}
        onTaskChange={onTaskChange}
        now={NOW}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Repeat: No repeat' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Custom' }))
    expect(screen.getByRole('dialog', { name: 'Custom repeat' })).toBeInTheDocument()
    const every = screen.getByLabelText('Every')
    await userEvent.clear(every)
    await userEvent.type(every, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onTaskChange).toHaveBeenLastCalledWith({ date: { start: '2026-10-30', resolution: 'day' }, repeat: 'every 3 days', remind: null })
    expect(screen.queryByRole('dialog', { name: 'Custom repeat' })).toBeNull()
  })
})
