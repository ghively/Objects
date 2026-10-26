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
    expect(onChange).toHaveBeenCalledWith('every week')
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
})
