import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { calendarRange } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useTabs } from '@/nav/tabs'
import { resetPinned, useUiStore } from '@/shell/usePinned'
import { CalendarPage, toggleCalendarSidebar } from './CalendarPage'
import { useCalendar } from './useCalendar'

const mocked = vi.mocked(api)
const TODAY = '2026-10-23'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 10, 0))
  localStorage.clear()
  resetPinned()
  useUiStore.setState((s) => ({ loaded: true, revision: 'u1', ui: { ...s.ui, calendar: { weekStart: 'monday', daily: { hideTasks: true } } } }))
  useTabs.getState().reset()
  useCalendar.setState({ view: 'day', anchor: TODAY })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.calendar.mockImplementation(async (from, to) => calendarRange({ from, to, today: TODAY }))
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.patchUi.mockImplementation(async () => ({ revision: 'u2' }) as never)
})

describe('CalendarPage', () => {
  test('test calendar sidebar lives in the calendar page and writes hideCalendarSidebar', async () => {
    const user = userEvent.setup()
    render(<CalendarPage onOpenTarget={vi.fn()} />)
    // Open by default (no `hideCalendarSidebar`): the mini month sits at the page's right edge.
    const sidebar = screen.getByRole('complementary', { name: 'Calendar sidebar' })
    expect(within(sidebar).getByRole('grid')).toBeInTheDocument()
    // Capacities' `calendarSidebarWidth` default.
    expect(sidebar.className).toContain('w-[26rem]')

    await user.click(screen.getByRole('button', { name: 'Hide calendar sidebar' }))
    expect(screen.queryByRole('complementary', { name: 'Calendar sidebar' })).toBeNull()
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalledTimes(1))
    // The whole calendar object is sent (PUT /api/ui replaces top-level keys).
    expect(mocked.patchUi).toHaveBeenLastCalledWith(
      { calendar: { weekStart: 'monday', daily: { hideTasks: true }, hideCalendarSidebar: true } },
      { baseRevision: 'u1' },
    )

    const show = screen.getByRole('button', { name: 'Show calendar sidebar' })
    expect(show).toHaveAttribute('aria-pressed', 'false')
    await user.click(show)
    expect(screen.getByRole('complementary', { name: 'Calendar sidebar' })).toBeInTheDocument()
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalledTimes(2))
    expect(mocked.patchUi.mock.calls[1][0]).toEqual({
      calendar: { weekStart: 'monday', daily: { hideTasks: true }, hideCalendarSidebar: false },
    })

    // The "Toggle calendar sidebar" shortcut's action.
    await act(() => toggleCalendarSidebar())
    expect(screen.queryByRole('complementary', { name: 'Calendar sidebar' })).toBeNull()
    expect(useUiStore.getState().ui.calendar?.hideCalendarSidebar).toBe(true)
  })

  test.each(['month', 'week', 'rolling'] as const)(
    'the %s view has no calendar sidebar and no switch for it (the Day view\'s only)',
    (view) => {
      useCalendar.setState({ view, anchor: TODAY })
      render(<CalendarPage onOpenTarget={vi.fn()} />)
      expect(screen.queryByRole('complementary', { name: 'Calendar sidebar' })).toBeNull()
      expect(screen.queryByRole('button', { name: /calendar sidebar/i })).toBeNull()
    },
  )

  test('back in the Day view the sidebar and its switch return', () => {
    useCalendar.setState({ view: 'rolling', anchor: TODAY })
    const { rerender } = render(<CalendarPage onOpenTarget={vi.fn()} />)
    expect(screen.queryByRole('complementary', { name: 'Calendar sidebar' })).toBeNull()
    act(() => useCalendar.setState({ view: 'day' }))
    rerender(<CalendarPage onOpenTarget={vi.fn()} />)
    expect(screen.getByRole('complementary', { name: 'Calendar sidebar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide calendar sidebar' })).toBeInTheDocument()
  })

  test('test a saved hidden sidebar stays hidden', () => {
    useUiStore.setState((s) => ({ ui: { ...s.ui, calendar: { weekStart: 'sunday', daily: {}, hideCalendarSidebar: true } } }))
    render(<CalendarPage onOpenTarget={vi.fn()} />)
    expect(screen.queryByRole('complementary', { name: 'Calendar sidebar' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show calendar sidebar' })).toBeInTheDocument()
  })
})
