import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REMINDER_NOTICE, ReminderMenu } from './ReminderMenu'

beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* no storage */
  }
})

describe('ReminderMenu', () => {
  it('day dates: presets carry the Time field; a suggestion changes the time', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<ReminderMenu value={null} resolution="day" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reminder: No reminder' }))
    await userEvent.click(screen.getByRole('button', { name: 'Evening' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'On the day' }))
    expect(onChange).toHaveBeenLastCalledWith('on the day at 18:00')
    rerender(<ReminderMenu value="on the day at 18:00" resolution="day" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Reminder: On the day' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Morning' }))
    expect(onChange).toHaveBeenLastCalledWith('on the day at 09:00')
  })

  it('time dates: minutes and hours before', async () => {
    const onChange = vi.fn()
    render(<ReminderMenu value="1 hour before" resolution="time" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reminder: 1 hour before' }))
    expect(screen.getByRole('menuitemradio', { name: '1 hour before' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('menuitemradio', { name: '15 minutes before' }))
    expect(onChange).toHaveBeenLastCalledWith('15 minutes before')
  })

  it('test first reminder shows the one-time notice once', async () => {
    const onChange = vi.fn()
    const first = render(<ReminderMenu value={null} resolution="time" onChange={onChange} />)
    expect(screen.queryByText(REMINDER_NOTICE)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Reminder: No reminder' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'At time of event' }))
    expect(onChange).toHaveBeenLastCalledWith('at time')
    expect(screen.getByRole('status')).toHaveTextContent(REMINDER_NOTICE)
    first.unmount()

    render(<ReminderMenu value={null} resolution="time" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reminder: No reminder' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: '5 minutes before' }))
    expect(screen.queryByText(REMINDER_NOTICE)).toBeNull()
  })
})
