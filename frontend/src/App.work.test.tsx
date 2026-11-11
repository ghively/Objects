// M23 Task 17: the Work target and the item panel are wired into the app.
// M32: the Work page shows only while Work is on for the space (`workOn` in `GET /api/space`);
// the `tasks` target is the plain Tasks page and an empty tab is Home.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, SpaceInfo, UiState } from '@/api/types'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// Stand-ins expose the props App passes, so this test checks App's wiring only.
vi.mock('@/palette/CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('@/work/page/WorkPage', () => ({
  WorkPage: ({ view }: { view?: string }) => <div data-testid="work-page">work page {view ?? 'default'}</div>,
}))
vi.mock('@/tasks/TasksPage', async (orig) => ({
  ...(await orig<typeof import('@/tasks/TasksPage')>()),
  TasksPage: () => <div data-testid="tasks-page">tasks page</div>,
}))
vi.mock('@/object/ObjectPage', () => ({
  ObjectPage: ({ path, workHeader }: { path: string; workHeader?: boolean }) => (
    <div data-testid="object-page">
      object page {path} {workHeader ? 'with the work header' : 'plain'}
    </div>
  ),
}))
vi.mock('@/work/state/WorkToasts.tsx', () => ({ WorkToasts: () => <div data-testid="work-toasts" /> }))
vi.mock('@/work/session/WorkOverlays', () => ({ WorkOverlays: () => <div data-testid="work-overlays" /> }))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { resetPinned } from '@/shell/usePinned'
import { useDefs } from '@/types/useDefinitions'
import App from './App'

const mocked = vi.mocked(api)
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, revision: 'r1' })
/** A space with Work on, and the same space as a new one reads (nothing stored: off). */
const SPACE_WORK_ON = { name: 's', root: '/s', types: [PAGE], workEnabled: true, workOn: true } satisfies SpaceInfo
const SPACE_WORK_OFF = { name: 's', root: '/s', types: [PAGE], workEnabled: null, workOn: false } satisfies SpaceInfo
const stored: UiState = { pinned: [], sections: [], allNotesLayout: 'list' }
const OLD = 'Requests/Printer jams on line 3.md'
const NEW = 'Requests/Printer jams on line 4.md'

let listeners: ((e: ChangeEvent) => void)[] = []

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  resetPinned()
  listeners = []
  useDefs.setState({ collections: [], queries: [], loaded: false })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  resetSpaceInfo()
  mocked.space.mockResolvedValue(SPACE_WORK_ON)
  mocked.collections.mockResolvedValue([])
  mocked.queries.mockResolvedValue([])
  mocked.objects.mockResolvedValue([])
  mocked.rows.mockResolvedValue([])
  mocked.onChange.mockImplementation((cb: (e: ChangeEvent) => void) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
  mocked.ui.mockImplementation(async () => ({ ui: stored, revision: 'u1' }))
})

describe('M23 Work wiring', () => {
  test('test a work target renders the Tasks dashboard with tab title Tasks', async () => {
    act(() => useTabs.getState().open({ kind: 'work' }))
    render(<App />)
    expect(await screen.findByTestId('work-page')).toHaveTextContent('work page default')
    const strip = screen.getByRole('tablist', { name: 'Tabs' })
    await waitFor(() => expect(within(strip).getByText('Tasks')).toBeInTheDocument())
    expect(within(strip).getByRole('tab').querySelector('[data-icon="ph-check-circle"]')).not.toBeNull()
    // The sidebar's Tasks entry is the active one (Gene's redesign: the dashboard is Tasks).
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    act(() => useTabs.getState().open({ kind: 'work', view: 'flow' }))
    expect(await screen.findByText('work page flow')).toBeInTheDocument()
  })

  test('test the item panel renders the object page with the work header; renaming keeps work', async () => {
    act(() => useTabs.getState().open({ kind: 'object', path: 'Pages/A.md' }))
    render(<App />)
    expect(await screen.findByText('object page Pages/A.md plain')).toBeInTheDocument()
    act(() => useTabs.getState().openInSidepanel({ kind: 'object', path: OLD, work: true }))
    const panel = await screen.findByRole('complementary', { name: 'Side panel' })
    expect(await within(panel).findByText(`object page ${OLD} with the work header`)).toBeInTheDocument()

    // The file moves (a rename): the panel follows it and is still the item panel.
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
    act(() => {
      for (const l of [...listeners]) l({ kind: 'renamed', path: NEW, oldPath: OLD, version: 'v2' } as ChangeEvent)
    })
    expect(await within(panel).findByText(`object page ${NEW} with the work header`)).toBeInTheDocument()
    const entry = useTabs.getState().tabs[0].sidepanel?.find((e) => e.target?.kind === 'object')
    expect(entry?.target).toEqual({ kind: 'object', path: NEW, work: true })
    expect(entry?.history).toEqual([{ kind: 'object', path: NEW, work: true }])
  })

  test('test WorkToasts and WorkOverlays mount once', async () => {
    act(() => useTabs.getState().open({ kind: 'work' }))
    render(<App />)
    await screen.findByTestId('work-page')
    expect(screen.getAllByTestId('work-toasts')).toHaveLength(1)
    expect(screen.getAllByTestId('work-overlays')).toHaveLength(1)
  })
})

describe('M32 contract wiring: Tasks, Work off, Home', () => {
  test('test the tasks target renders the Tasks page, not the dashboard, with Work on', async () => {
    act(() => useTabs.getState().open({ kind: 'tasks' }))
    render(<App />)
    expect(await screen.findByTestId('tasks-page')).toBeInTheDocument()
    expect(screen.queryByTestId('work-page')).toBeNull()
    const strip = screen.getByRole('tablist', { name: 'Tabs' })
    await waitFor(() => expect(within(strip).getByText('Tasks')).toBeInTheDocument())
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // Work is on: its toasts and overlays are there on every page.
    expect(screen.getAllByTestId('work-toasts')).toHaveLength(1)
    expect(screen.getAllByTestId('work-overlays')).toHaveLength(1)
  })

  test('test with Work off a work target shows the Tasks page and no toasts or overlays mount', async () => {
    mocked.space.mockResolvedValue(SPACE_WORK_OFF)
    act(() => useTabs.getState().open({ kind: 'work', view: 'flow' }))
    render(<App />)
    expect(await screen.findByTestId('tasks-page')).toBeInTheDocument()
    expect(screen.queryByTestId('work-page')).toBeNull()
    expect(screen.queryByTestId('work-toasts')).toBeNull()
    expect(screen.queryByTestId('work-overlays')).toBeNull()
    // The tab keeps its target: turning Work on later shows the dashboard there.
    expect(useTabs.getState().tabs[0].history.at(-1)).toEqual({ kind: 'work', view: 'flow' })
  })

  test('test a space that does not say (an older answer) reads as Work off', async () => {
    mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
    act(() => useTabs.getState().open({ kind: 'work' }))
    render(<App />)
    expect(await screen.findByTestId('tasks-page')).toBeInTheDocument()
    expect(screen.queryByTestId('work-toasts')).toBeNull()
  })

  test('test the sidebar Tasks entry opens the tasks target', async () => {
    act(() => useTabs.getState().open({ kind: 'object', path: 'Pages/A.md' }))
    render(<App />)
    await screen.findByText('object page Pages/A.md plain')
    const tasks = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tasks' })
    act(() => tasks.click())
    expect(await screen.findByTestId('tasks-page')).toBeInTheDocument()
    expect(useTabs.getState().tabs[0].history.at(-1)).toEqual({ kind: 'tasks' })
  })

  test('test an empty tab shows Home with New note and Today’s note', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: 'New note' })).toBeInTheDocument()
    // Home's own "Today's note", beside the top bar's.
    const home = screen.getByRole('region', { name: 'Home' })
    expect(within(home).getByRole('button', { name: "Today's note" })).toBeInTheDocument()
    expect(screen.queryByText('Pick an object type')).toBeNull()
    // Showing Home makes nothing.
    expect(mocked.createObject).not.toHaveBeenCalled()
    expect(mocked.createDailyNote).not.toHaveBeenCalled()
  })
})
