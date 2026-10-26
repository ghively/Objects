import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { calendarDay, calendarRange } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useTabs } from '@/nav/tabs'
import { resetPinned, useUiStore } from '@/shell/usePinned'
import { CalendarPage } from './CalendarPage'
import { useCalendar } from './useCalendar'

const mocked = vi.mocked(api)
const TODAY = '2026-10-23'

function renderPage(props: Partial<Parameters<typeof CalendarPage>[0]> = {}) {
  const p = { rightPanelOpen: false, onToggleRightPanel: vi.fn(), onOpenTarget: vi.fn(), ...props }
  const r = render(<CalendarPage {...p} />)
  return { ...p, ...r }
}

const anchor = () => useCalendar.getState().anchor
const view = () => useCalendar.getState().view

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 10, 0))
  localStorage.clear()
  resetPinned()
  useUiStore.setState({ loaded: true })
  useTabs.getState().reset()
  useTabs.getState().open({ kind: 'calendar' })
  useCalendar.setState({ view: 'day', anchor: TODAY })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.calendar.mockImplementation(async (from, to) => calendarRange({ from, to, today: TODAY }))
  mocked.onChange.mockReturnValue(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('CalendarChrome', () => {
  test('chrome labels, tooltips and active pill', async () => {
    const user = userEvent.setup()
    renderPage()
    const group = screen.getByRole('group', { name: 'Calendar view' })
    const buttons = Array.from(group.querySelectorAll('button'))
    expect(buttons.map((b) => b.textContent)).toEqual(['Month', 'Week', 'Three days', 'Day'])
    expect(buttons.map((b) => b.title)).toEqual([
      'Go to monthly view',
      'Go to weekly view',
      'Go to 3 days rolling view',
      'Go to daily view',
    ])
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Go to previous day, week, or month' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to next day, week, or month' })).toBeInTheDocument()
    const today = screen.getByRole('button', { name: 'Today' })
    expect(today).toHaveAttribute('title', 'Set active date to today')
    expect(today.className).toContain('font-semibold')
    // Day view: no period title.
    expect(screen.getByTestId('calendar-period-title')).toHaveTextContent('')

    await user.click(screen.getByRole('button', { name: 'Three days' }))
    expect(view()).toBe('rolling')
    expect(screen.getByRole('button', { name: 'Three days' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('calendar-period-title')).toHaveTextContent('Oct 2026')
    await user.click(screen.getByRole('button', { name: 'Week' }))
    expect(screen.getByTestId('calendar-period-title')).toHaveTextContent('Week 43')
    await user.click(screen.getByRole('button', { name: 'Month' }))
    expect(screen.getByTestId('calendar-period-title')).toHaveTextContent('Oct 2026')

    await user.click(screen.getByRole('button', { name: 'Go to next day, week, or month' }))
    expect(anchor()).toBe('2026-11-23')
    expect(screen.getByRole('button', { name: 'Today' }).className).toContain('font-normal')
    expect(screen.getByTestId('calendar-period-title')).toHaveTextContent('Nov 2026')
    await user.click(screen.getByRole('button', { name: 'Go to previous day, week, or month' }))
    await user.click(screen.getByRole('button', { name: 'Go to previous day, week, or month' }))
    expect(anchor()).toBe('2026-09-23')
    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(anchor()).toBe(TODAY)
  })

  test('the page shows the view placeholder over the view range', () => {
    useCalendar.setState({ view: 'week' })
    const { container } = renderPage()
    const pending = container.querySelector('[data-view="week"]')!
    expect(pending).toHaveTextContent('Loading results…')
    expect(pending).toHaveAttribute('data-from', '2026-10-18')
    expect(pending).toHaveAttribute('data-to', '2026-10-24')
  })

  test('week start comes from ui.calendar.weekStart', () => {
    useUiStore.setState((s) => ({ ui: { ...s.ui, calendar: { weekStart: 'monday', daily: {} } } }))
    useCalendar.setState({ view: 'week', anchor: '2026-10-25' })
    const { container } = renderPage()
    expect(container.querySelector('[data-view="week"]')).toHaveAttribute('data-from', '2026-10-19')
    expect(screen.getByTestId('calendar-period-title')).toHaveTextContent('Week 43')
  })

  test('right panel toggle uses Task 7 props and the sidebar tooltips', async () => {
    const user = userEvent.setup()
    const { onToggleRightPanel, rerender, onOpenTarget } = renderPage({ rightPanelOpen: false })
    const show = screen.getByRole('button', { name: 'Show calendar sidebar' })
    expect(show).toHaveAttribute('title', 'Show calendar sidebar')
    await user.click(show)
    expect(onToggleRightPanel).toHaveBeenCalledTimes(1)
    rerender(<CalendarPage rightPanelOpen onToggleRightPanel={onToggleRightPanel} onOpenTarget={onOpenTarget} />)
    const hide = screen.getByRole('button', { name: 'Hide calendar sidebar' })
    expect(hide).toHaveAttribute('aria-pressed', 'true')
    await user.click(hide)
    expect(onToggleRightPanel).toHaveBeenCalledTimes(2)
  })

  test("shift+today opens today's daily note", async () => {
    mocked.calendar.mockImplementation(async (from, to) =>
      calendarRange({
        from,
        to,
        today: TODAY,
        days: { [TODAY]: calendarDay({ dailyNote: { path: 'DailyNotes/2026-10-23.md', reviewed: false } }) },
      }),
    )
    const { onOpenTarget } = renderPage()
    useCalendar.setState({ anchor: '2026-10-01' })
    // Shift-click.
    fireEvent.click(screen.getByRole('button', { name: 'Today' }), { shiftKey: true })
    expect(anchor()).toBe(TODAY)
    await waitFor(() => expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'object', path: 'DailyNotes/2026-10-23.md' }))
    expect(mocked.calendar).toHaveBeenCalledWith(TODAY, TODAY)
    // Shift plus the Today key.
    act(() => useCalendar.setState({ anchor: '2026-10-01' }))
    fireEvent.keyDown(window, { key: 'T', shiftKey: true })
    expect(anchor()).toBe(TODAY)
    await waitFor(() => expect(onOpenTarget).toHaveBeenCalledTimes(2))
    // A plain click (or T) only moves the anchor. (In the Week view: the Day view itself loads
    // today's range, Task 13.)
    act(() => useCalendar.setState({ view: 'week', anchor: '2026-10-01' }))
    mocked.calendar.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    fireEvent.keyDown(window, { key: 't' })
    expect(anchor()).toBe(TODAY)
    expect(mocked.calendar).not.toHaveBeenCalledWith(TODAY, TODAY)
  })

  test("shift+today without today's note only goes to today", async () => {
    const { onOpenTarget } = renderPage()
    useCalendar.setState({ anchor: '2026-10-01' })
    fireEvent.click(screen.getByRole('button', { name: 'Today' }), { shiftKey: true })
    expect(anchor()).toBe(TODAY)
    await waitFor(() => expect(mocked.calendar).toHaveBeenCalledWith(TODAY, TODAY))
    await act(async () => {})
    expect(onOpenTarget).not.toHaveBeenCalled()
  })

  test('arrow keys step by view', () => {
    renderPage()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(anchor()).toBe('2026-10-24')
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(anchor()).toBe('2026-10-17')
    act(() => useCalendar.setState({ view: 'month', anchor: TODAY }))
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(anchor()).toBe('2027-10-23')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(anchor()).toBe('2027-09-23')
  })

  test('arrow keys ignored while an input has focus', () => {
    renderPage()
    const input = document.createElement('input')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.append(input, editable)
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    fireEvent.keyDown(input, { key: 'm' })
    expect(anchor()).toBe(TODAY)
    expect(view()).toBe('day')
    fireEvent.keyDown(editable, { key: 'ArrowLeft' })
    expect(anchor()).toBe(TODAY)
    input.remove()
    editable.remove()
  })

  test('view shortcuts switch views only when calendar is active and not typing', () => {
    renderPage()
    fireEvent.keyDown(window, { key: 'm' })
    expect(view()).toBe('month')
    fireEvent.keyDown(window, { key: 'w' })
    expect(view()).toBe('week')
    fireEvent.keyDown(window, { key: 'r' })
    expect(view()).toBe('rolling')
    fireEvent.keyDown(window, { key: 'd' })
    expect(view()).toBe('day')
    // With a modifier (Ctrl+D and the like belong to others) nothing happens.
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    expect(view()).toBe('day')
    // Typing.
    const ta = document.createElement('textarea')
    document.body.append(ta)
    ta.focus()
    fireEvent.keyDown(ta, { key: 'w' })
    expect(view()).toBe('day')
    ta.remove()
    // Another target is active.
    act(() => useTabs.getState().open({ kind: 'tasks' }))
    fireEvent.keyDown(window, { key: 'w' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(view()).toBe('day')
    expect(anchor()).toBe(TODAY)
  })
})
