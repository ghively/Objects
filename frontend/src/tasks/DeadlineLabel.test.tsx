import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useSettings } from '@/settings/useSettings'
import { DeadlineLabel, deadlineText } from './DeadlineLabel'

const day = (s: string) => ({ start: s, resolution: 'day' as const })
const TODAY = new Date(2026, 9, 26)

describe('DeadlineLabel', () => {
  test('test deadline label counts days, months, years; Missed', () => {
    expect(deadlineText(day('2026-10-27'), TODAY)).toBe('1 day left')
    expect(deadlineText(day('2026-10-30'), TODAY)).toBe('4 days left')
    expect(deadlineText(day('2026-10-26'), TODAY)).toBe('0 days left')
    expect(deadlineText(day('2026-11-26'), TODAY)).toBe('1 month left')
    expect(deadlineText(day('2027-02-01'), TODAY)).toBe('3 months left')
    expect(deadlineText(day('2027-10-26'), TODAY)).toBe('1 year left')
    expect(deadlineText(day('2029-01-01'), TODAY)).toBe('2 years left')
    expect(deadlineText(day('2026-10-25'), TODAY)).toBe('Missed')
    expect(deadlineText(null, TODAY)).toBeNull()
  })

  test('shows "Planned past the deadline" when the date is after the deadline', () => {
    render(<DeadlineLabel deadline={day('2026-10-30')} date={day('2026-11-02')} today={TODAY} />)
    expect(screen.getByText('4 days left')).toBeInTheDocument()
    expect(screen.getByText('Planned past the deadline')).toBeInTheDocument()
  })

  test('renders nothing without a deadline', () => {
    const { container } = render(<DeadlineLabel deadline={null} today={TODAY} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('DeadlineLabel in the Time zone setting', () => {
  test('counts days from today in the Time zone setting', () => {
    const settings = useSettings.getState().settings
    useSettings.setState({ settings: { ...settings, timeZone: 'Pacific/Auckland' } })
    vi.useFakeTimers({ toFake: ['Date'] })
    // 2026-10-29T01:00Z is 29 Oct 14:00 in Auckland (still the 28th west of UTC).
    vi.setSystemTime(new Date('2026-10-29T01:00:00Z'))
    try {
      expect(deadlineText(day('2026-10-29'))).toBe('0 days left')
      expect(deadlineText(day('2026-10-28'))).toBe('Missed')
    } finally {
      vi.useRealTimers()
      useSettings.setState({ settings })
    }
  })
})
