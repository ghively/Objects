import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { calendarDay, calendarRange } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetPinned, useUiStore } from '@/shell/usePinned'
import { CalendarSidePanel } from './CalendarSidePanel'
import { todayYmd } from './dates'
import { MiniMonth } from './MiniMonth'
import { useCalendar } from './useCalendar'

const mocked = vi.mocked(api)
const TODAY = '2026-10-23'
const note = (day: string) => calendarDay({ dailyNote: { path: `DailyNotes/${day}.md`, reviewed: false } })

beforeEach(() => {
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.calendar.mockImplementation(async (from, to) =>
    calendarRange({ from, to, today: TODAY, days: { '2026-10-05': note('2026-10-05'), [TODAY]: note(TODAY) } }),
  )
})

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent)
const cell = (day: string) => screen.getByRole('button', { name: day })

describe('MiniMonth', () => {
  test('mini month marks today, selected and daily-note days; outside days muted', async () => {
    render(<MiniMonth anchor="2026-10-12" today={TODAY} weekStart="sunday" onSelect={vi.fn()} />)
    expect(headers()).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'])
    expect(screen.getAllByRole('gridcell')).toHaveLength(42)
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeInTheDocument()
    // One range call for the grid shown (27 Sep to 7 Nov).
    await waitFor(() => expect(mocked.calendar).toHaveBeenCalledWith('2026-09-27', '2026-11-07'))
    expect(mocked.calendar).toHaveBeenCalledTimes(1)

    const today = cell(TODAY)
    expect(today).toHaveAttribute('aria-current', 'date')
    expect(today.className).toContain('bg-today')
    const selected = cell('2026-10-12')
    expect(selected).toHaveAttribute('aria-selected', 'true')
    expect(selected.className).toContain('bg-hover-2')
    expect(selected.className).not.toContain('bg-today')
    expect(cell('2026-09-27')).toHaveAttribute('data-outside', 'true')
    expect(cell('2026-09-27').className).toContain('text-fg-muted')
    expect(cell('2026-10-01')).not.toHaveAttribute('data-outside')

    await waitFor(() => expect(cell('2026-10-05')).toHaveAttribute('data-has-note', 'true'))
    expect(within(cell('2026-10-05')).getByTestId('daily-note-dot')).toBeInTheDocument()
    expect(within(cell(TODAY)).getByTestId('daily-note-dot')).toBeInTheDocument()
    expect(within(cell('2026-10-06')).queryByTestId('daily-note-dot')).toBeNull()
  })

  test('monday week start orders the initials Monday first', () => {
    render(<MiniMonth anchor={TODAY} today={TODAY} weekStart="monday" onSelect={vi.fn()} />)
    expect(headers()).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'])
    expect(screen.getAllByRole('button', { name: /^\d{4}-/ })[0]).toHaveAccessibleName('2026-09-28')
  })

  test('mini month dropdowns and arrows change the shown month; click sets anchor', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MiniMonth anchor={TODAY} today={TODAY} weekStart="sunday" onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: 'Go to previous month' })).toHaveAttribute('title', 'Go to previous month')
    await user.click(screen.getByRole('button', { name: 'Go to next month' }))
    expect(screen.getByRole('grid', { name: 'November 2026' })).toBeInTheDocument()
    await waitFor(() => expect(mocked.calendar).toHaveBeenLastCalledWith('2026-11-01', '2026-12-12'))
    await user.click(screen.getByRole('button', { name: 'Go to previous month' }))
    await user.click(screen.getByRole('button', { name: 'Go to previous month' }))
    expect(screen.getByRole('grid', { name: 'September 2026' })).toBeInTheDocument()

    const month = screen.getByRole('button', { name: 'Month' })
    expect(month).toHaveAttribute('title', 'Jump to')
    await user.click(month)
    const months = await screen.findAllByRole('menuitem')
    expect(months.map((m) => m.textContent)).toHaveLength(12)
    await user.click(screen.getByRole('menuitem', { name: 'March' }))
    expect(screen.getByRole('grid', { name: 'March 2026' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Year' }))
    const years = (await screen.findAllByRole('menuitem')).map((m) => m.textContent)
    expect(years[0]).toBe('1976')
    expect(years[years.length - 1]).toBe('2076')
    await user.click(screen.getByRole('menuitem', { name: '2028' }))
    expect(screen.getByRole('grid', { name: 'March 2028' })).toBeInTheDocument()

    await user.click(cell('2028-03-14'))
    expect(onSelect).toHaveBeenCalledWith('2028-03-14')
  })

  test('side panel click sets the anchor and keeps the view; the shown month follows the anchor', async () => {
    const user = userEvent.setup()
    resetPinned()
    useUiStore.setState({ loaded: true })
    useCalendar.setState({ view: 'week', anchor: todayYmd() })
    const start = useCalendar.getState().anchor
    render(<CalendarSidePanel />)
    const first = screen.getAllByRole('gridcell')[10].querySelector('button')!
    await user.click(first)
    expect(useCalendar.getState().anchor).toBe(first.getAttribute('aria-label'))
    expect(useCalendar.getState().view).toBe('week')
    expect(start).toBeTruthy()
  })
})
