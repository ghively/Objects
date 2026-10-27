import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RepeatMenu } from './RepeatMenu'

describe('RepeatMenu', () => {
  it('lists the presets named from the date and writes their canonical text', async () => {
    const onChange = vi.fn()
    render(<RepeatMenu value={null} date="2026-10-30" onChange={onChange} onCustom={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Repeat: No repeat' }))
    expect(screen.getByRole('menuitemradio', { name: 'No repeat' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Weekly on Friday' }))
    expect(onChange).toHaveBeenCalledWith('every week on fri')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows the current preset, Custom for other rules, and calls onCustom', async () => {
    const onCustom = vi.fn()
    const { rerender } = render(<RepeatMenu value="every weekday" date="2026-10-30" onChange={() => {}} onCustom={onCustom} />)
    expect(screen.getByRole('button', { name: 'Repeat: Every weekday' })).toBeInTheDocument()
    rerender(<RepeatMenu value="every 2 weeks after completion" date="2026-10-30" onChange={() => {}} onCustom={onCustom} />)
    await userEvent.click(screen.getByRole('button', { name: 'Repeat: Custom' }))
    expect(screen.getByRole('menuitemradio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Custom' }))
    expect(onCustom).toHaveBeenCalledTimes(1)
  })

  it('test invalid repeat shown with hint and kept', () => {
    const onChange = vi.fn()
    render(<RepeatMenu value="weekly" date="2026-10-30" onChange={onChange} onCustom={() => {}} />)
    expect(screen.getByRole('button', { name: 'Repeat: weekly' })).toBeInTheDocument()
    expect(screen.getByText('Not a valid repeat.')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('test presets write the anchored on forms', async () => {
    const onChange = vi.fn()
    render(<RepeatMenu value={null} date="2026-10-30" onChange={onChange} onCustom={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Repeat: No repeat' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Monthly on day 30' }))
    expect(onChange).toHaveBeenLastCalledWith('every month on the 30th')
    await userEvent.click(screen.getByRole('button', { name: 'Repeat: No repeat' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Yearly on October 30' }))
    expect(onChange).toHaveBeenLastCalledWith('every year on october 30')
    await userEvent.click(screen.getByRole('button', { name: 'Repeat: No repeat' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Daily' }))
    expect(onChange).toHaveBeenLastCalledWith('every day')
  })

  it('test remove recurrence asks when history exists', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<RepeatMenu value="every day" date="2026-10-30" onChange={onChange} onCustom={() => {}} hasHistory />)
    await userEvent.click(screen.getByRole('button', { name: 'Repeat: Daily' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove recurrence' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Remove recurrence?' })
    expect(confirm).toHaveTextContent(
      'This recurring task already has completed or skipped occurrences. Removing the recurrence will discard its history.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Keep recurrence' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // "No repeat" asks too
    await userEvent.click(screen.getByRole('button', { name: 'Repeat: Daily' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'No repeat' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove recurrence' }))
    expect(onChange).toHaveBeenCalledWith(null)
    // without history it removes at once
    onChange.mockClear()
    rerender(<RepeatMenu value="every day" date="2026-10-30" onChange={onChange} onCustom={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Repeat: Daily' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove recurrence' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
