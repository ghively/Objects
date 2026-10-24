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
