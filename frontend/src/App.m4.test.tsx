import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, UiState } from '@/api/types'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// The calendar page and its side panel are replaced by later tasks; stand-ins expose the props
// App passes so this test checks App's wiring only.
const calendarProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
vi.mock('@/calendar/CalendarPage', () => ({
  CalendarPage: (props: { rightPanelOpen: boolean; onToggleRightPanel: () => void }) => {
    calendarProps.current = props as unknown as Record<string, unknown>
    return (
      <div>
        <span>calendar page, panel {props.rightPanelOpen ? 'open' : 'closed'}</span>
        <button type="button" onClick={props.onToggleRightPanel}>
          toggle calendar panel
        </button>
      </div>
    )
  },
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
    // The Tasks stub renders its placeholder.
    expect(screen.getByText('Loading results…')).toBeInTheDocument()
  })

  test('test right panel toggle', async () => {
    const user = userEvent.setup()
    act(() => useTabs.getState().open({ kind: 'calendar' }))
    render(<App />)
    expect(await screen.findByText('calendar page, panel closed')).toBeInTheDocument()
    expect(typeof calendarProps.current?.onOpenTarget).toBe('function')
    expect(screen.queryByTestId('calendar-side-panel')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'toggle calendar panel' }))
    expect(screen.getByText('calendar page, panel open')).toBeInTheDocument()
    const panel = screen.getByRole('complementary', { name: 'Right panel' })
    expect(within(panel).getByTestId('calendar-side-panel')).toBeInTheDocument()

    // onOpenTarget opens a target in the tab.
    act(() => (calendarProps.current!.onOpenTarget as (t: unknown) => void)({ kind: 'tasks' }))
    await waitFor(() => expect(screen.queryByText(/calendar page/)).toBeNull())
    // The right panel stays open (App's state) but holds no calendar panel for other targets.
    expect(screen.getByRole('complementary', { name: 'Right panel' })).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-side-panel')).toBeNull()

    act(() => useTabs.getState().back())
    expect(await screen.findByText('calendar page, panel open')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'toggle calendar panel' }))
    expect(screen.queryByRole('complementary', { name: 'Right panel' })).toBeNull()
    expect(screen.queryByTestId('calendar-side-panel')).toBeNull()
  })
})
