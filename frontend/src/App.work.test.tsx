// M23 Task 17: the Work target and the item panel are wired into the app.
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
import { resetPinned } from '@/shell/usePinned'
import { useDefs } from '@/types/useDefinitions'
import App from './App'

const mocked = vi.mocked(api)
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, revision: 'r1' })
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
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
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
  test('test a work target renders the Work page with tab title Work', async () => {
    act(() => useTabs.getState().open({ kind: 'work' }))
    render(<App />)
    expect(await screen.findByTestId('work-page')).toHaveTextContent('work page default')
    const strip = screen.getByRole('tablist', { name: 'Tabs' })
    await waitFor(() => expect(within(strip).getByText('Work')).toBeInTheDocument())
    expect(within(strip).getByRole('tab').querySelector('[data-icon="ph-briefcase"]')).not.toBeNull()
    // The sidebar's Work entry is the active one.
    expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-current', 'page')

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
