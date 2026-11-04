import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, UiState } from '@/api/types'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// The calendar page is replaced by a stand-in exposing the props App passes, so this test checks
// App's wiring only. Since M7 the calendar sidebar lives inside the Calendar page, not in App.
const calendarProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
vi.mock('@/calendar/CalendarPage', () => ({
  CalendarPage: (props: Record<string, unknown>) => {
    calendarProps.current = props
    return <div>calendar page</div>
  },
  toggleCalendarSidebar: () => Promise.resolve(),
}))
vi.mock('@/calendar/CalendarSidePanel', () => ({
  CalendarSidePanel: () => <div data-testid="calendar-side-panel">mini month</div>,
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { resetPinned } from '@/shell/usePinned'
import { useDefs } from '@/types/useDefinitions'
import App from './App'

const mocked = vi.mocked(api)
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, revision: 'r1' })
const stored: UiState = { pinned: [], sections: [], allNotesLayout: 'list' }

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  resetPinned()
  useDefs.setState({ collections: [], queries: [], loaded: false })
  calendarProps.current = null
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.collections.mockResolvedValue([])
  mocked.queries.mockResolvedValue([])
  mocked.objects.mockResolvedValue([])
  mocked.rows.mockResolvedValue([])
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.ui.mockImplementation(async () => ({ ui: stored, revision: 'u1' }))
})

describe('M4 targets in the app', () => {
  test('test tab labels for calendar and tasks', async () => {
    const user = userEvent.setup()
    render(<App />)
    const strip = screen.getByRole('tablist', { name: 'Tabs' })
    const nav = screen.getByRole('navigation', { name: /main/i })

    await user.click(within(nav).getByRole('button', { name: 'Calendar' }))
    await waitFor(() => expect(within(strip).getByText('Calendar')).toBeInTheDocument())
    expect(within(strip).getByRole('tab').querySelector('[data-icon="ph-calendar-blank"]')).not.toBeNull()
    expect(within(nav).getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page')

    await user.click(within(nav).getByRole('button', { name: 'Tasks' }))
    await waitFor(() => expect(within(strip).getByText('Tasks')).toBeInTheDocument())
    expect(within(strip).getByRole('tab').querySelector('[data-icon="ph-check-circle"]')).not.toBeNull()
    expect(within(nav).getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: 'Calendar' })).not.toHaveAttribute('aria-current')
    // The Tasks page (M4 Task 11 replaced the stub) renders its heading.
    expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
  })

  test('test calendar page gets onOpenTarget only; the side panel never holds the calendar sidebar', async () => {
    const user = userEvent.setup()
    act(() => useTabs.getState().open({ kind: 'calendar' }))
    render(<App />)
    expect(await screen.findByText('calendar page')).toBeInTheDocument()
    expect(Object.keys(calendarProps.current!)).toEqual(['onOpenTarget'])
    expect(screen.queryByTestId('calendar-side-panel')).toBeNull()

    // The top-bar toggle shows the tab's side panel (an empty Explore entry), never the mini month.
    await user.click(screen.getByRole('button', { name: /^(Show|Hide) sidepanel$/ }))
    const panel = screen.getByRole('complementary', { name: 'Side panel' })
    expect(within(panel).getByText('Explore')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-side-panel')).toBeNull()

    // onOpenTarget opens a target in the tab.
    act(() => (calendarProps.current!.onOpenTarget as (t: unknown) => void)({ kind: 'tasks' }))
    await waitFor(() => expect(screen.queryByText('calendar page')).toBeNull())
    expect(screen.getByRole('complementary', { name: 'Side panel' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^(Show|Hide) sidepanel$/ }))
    expect(screen.queryByRole('complementary', { name: 'Side panel' })).toBeNull()
  })

  test('test top bar toggle and shortcut hide and show the panel per tab', async () => {
    const user = userEvent.setup()
    act(() => useTabs.getState().open({ kind: 'tasks' }))
    render(<App />)
    await screen.findByRole('heading', { name: 'Tasks' })
    const toggle = screen.getByRole('button', { name: /^(Show|Hide) sidepanel$/ })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)
    expect(screen.getByRole('complementary', { name: 'Side panel' })).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // A second tab has its own (hidden) panel; the first keeps its own.
    const first = useTabs.getState().activeId!
    act(() => useTabs.getState().open({ kind: 'calendar' }, { newTab: true }))
    await screen.findByText('calendar page')
    expect(screen.queryByRole('complementary', { name: 'Side panel' })).toBeNull()
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    // The "Toggle right sidepanel" shortcut (Mod-Shift-ArrowRight).
    const shortcut = () =>
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, shiftKey: true, bubbles: true }))
      })
    shortcut()
    expect(screen.getByRole('complementary', { name: 'Side panel' })).toBeInTheDocument()
    shortcut()
    expect(screen.queryByRole('complementary', { name: 'Side panel' })).toBeNull()

    act(() => useTabs.getState().activate(first))
    expect(await screen.findByRole('complementary', { name: 'Side panel' })).toBeInTheDocument()
  })
})
