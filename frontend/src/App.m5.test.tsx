import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, UiState } from '@/api/types'
import type { OpenOptions, Target } from '@/nav/tabs'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// The M5 components are replaced by later tasks; stand-ins expose the props App passes, so this
// test checks App's wiring only.
type PaletteProps = {
  onOpenTarget: (t: Target, o?: OpenOptions) => void
  onToggleSidebar: () => void
  onToggleRightPanel: () => void
  onShowRightPanel: () => void
}
const seen = vi.hoisted(() => ({
  palette: null as null | PaletteProps,
  graph: null as null | { onOpenTarget: (t: Target, o?: OpenOptions) => void },
}))
vi.mock('@/palette/CommandPalette', () => ({
  CommandPalette: (props: PaletteProps) => {
    seen.palette = props
    return null
  },
}))
vi.mock('@/graph/GraphPage', () => ({
  GraphPage: (props: { onOpenTarget: (t: Target, o?: OpenOptions) => void }) => {
    seen.graph = props
    return <div data-testid="graph-page">global graph</div>
  },
}))
vi.mock('@/graph/LocalGraphPanel', () => ({
  LocalGraphPanel: ({ path }: { path: string }) => <div data-testid="local-graph">local graph of {path}</div>,
}))
vi.mock('@/calendar/CalendarPage', () => ({
  CalendarPage: () => <div>calendar page</div>,
  toggleCalendarSidebar: () => Promise.resolve(),
}))
vi.mock('@/calendar/CalendarSidePanel', () => ({
  CalendarSidePanel: () => <div data-testid="calendar-side-panel">mini month</div>,
}))
vi.mock('@/object/ObjectPage', () => ({
  ObjectPage: ({ path }: { path: string }) => <div>object page {path}</div>,
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
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
  seen.palette = null
  seen.graph = null
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.collections.mockResolvedValue([])
  mocked.queries.mockResolvedValue([])
  mocked.objects.mockResolvedValue([])
  mocked.rows.mockResolvedValue([])
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.ui.mockImplementation(async () => ({ ui: stored, revision: 'u1' }))
})

describe('M5 mounts in the app', () => {
  test('test graph target opens, goes back, dedupes; tab label Graph', async () => {
    const user = userEvent.setup()
    render(<App />)
    const strip = screen.getByRole('tablist', { name: 'Tabs' })
    const nav = screen.getByRole('navigation', { name: /main/i })

    await user.click(within(nav).getByRole('button', { name: 'Graph' }))
    expect(await screen.findByTestId('graph-page')).toBeInTheDocument()
    expect(within(strip).getByText('Graph')).toBeInTheDocument()
    expect(within(strip).getByRole('tab').querySelector('[data-icon="ph-graph"]')).not.toBeNull()
    expect(within(nav).getByRole('button', { name: 'Graph' })).toHaveAttribute('aria-current', 'page')
    await user.click(within(nav).getByRole('button', { name: 'Graph' }))
    expect(useTabs.getState().tabs[0].history).toHaveLength(1)

    // The graph page opens objects through the tabs.
    act(() => seen.graph!.onOpenTarget({ kind: 'object', path: 'Pages/A.md' }))
    expect(await screen.findByText('object page Pages/A.md')).toBeInTheDocument()
    act(() => useTabs.getState().back())
    expect(await screen.findByTestId('graph-page')).toBeInTheDocument()
    act(() => seen.graph!.onOpenTarget({ kind: 'calendar' }, { newTab: true }))
    await waitFor(() => expect(useTabs.getState().tabs).toHaveLength(2))
  })

  test('test Open graph view opens the local graph as a side panel entry that follows the tab', async () => {
    act(() => useTabs.getState().open({ kind: 'object', path: 'Pages/A.md' }))
    render(<App />)
    expect(await screen.findByText('object page Pages/A.md')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Side panel' })).toBeNull()

    act(() => seen.palette!.onShowRightPanel())
    const panel = await screen.findByRole('complementary', { name: 'Side panel' })
    expect(within(panel).getByTestId('local-graph')).toHaveTextContent('local graph of Pages/A.md')
    expect(within(panel).getByText('Graph View')).toBeInTheDocument()
    act(() => seen.palette!.onShowRightPanel()) // reveals, never toggles or duplicates
    expect(screen.getByRole('complementary', { name: 'Side panel' })).toBeInTheDocument()
    expect(useTabs.getState().tabs[0].sidepanel).toHaveLength(1)

    // The entry follows the tab's current object.
    act(() => useTabs.getState().open({ kind: 'object', path: 'Pages/B.md' }))
    expect(await within(panel).findByText('local graph of Pages/B.md')).toBeInTheDocument()

    // Not on an object: the entry says so; the calendar sidebar is never in the side panel.
    act(() => useTabs.getState().open({ kind: 'calendar' }))
    await screen.findByText('calendar page')
    const panel2 = screen.getByRole('complementary', { name: 'Side panel' })
    expect(within(panel2).queryByTestId('local-graph')).toBeNull()
    expect(within(panel2).getByText('Open an object to see its graph.')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-side-panel')).toBeNull()
  })

  test('test command palette is mounted once with working callbacks', async () => {
    render(<App />)
    await waitFor(() => expect(seen.palette).not.toBeNull())
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument()

    act(() => seen.palette!.onToggleSidebar())
    expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull()
    act(() => seen.palette!.onToggleSidebar())
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeInTheDocument()

    act(() => seen.palette!.onToggleRightPanel())
    expect(screen.getByRole('complementary', { name: 'Side panel' })).toBeInTheDocument()
    act(() => seen.palette!.onToggleRightPanel())
    expect(screen.queryByRole('complementary', { name: 'Side panel' })).toBeNull()

    act(() => seen.palette!.onOpenTarget({ kind: 'graph' }))
    expect(await screen.findByTestId('graph-page')).toBeInTheDocument()
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'graph' })
    act(() => seen.palette!.onOpenTarget({ kind: 'tasks' }, { newTab: true }))
    await waitFor(() => expect(useTabs.getState().tabs).toHaveLength(2))
  })
})
