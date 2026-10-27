// M8 Task 3: the `search` target and the `backlinks` side-panel entry are wired into the app.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, UiState } from '@/api/types'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// Stand-ins expose the props App passes, so this test checks App's wiring only.
vi.mock('@/palette/CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('@/search/SearchPage', () => ({
  SearchPage: ({ q, textOnly }: { q?: string; textOnly?: boolean }) => (
    <div data-testid="search-page">
      search page {q ?? ''} {textOnly ? 'text only' : 'all'}
    </div>
  ),
}))
vi.mock('@/references/BacklinksPanel', () => ({
  BacklinksPanel: ({ path }: { path: string | null }) => <div data-testid="backlinks-panel">backlinks of {path ?? 'nothing'}</div>,
}))
vi.mock('@/object/ObjectPage', () => ({
  ObjectPage: ({ path }: { path: string }) => <div>object page {path}</div>,
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { sameTarget, usePeek, useTabs } from '@/nav/tabs'
import { openExtendedSearch } from '@/search/openSearch'
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
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.collections.mockResolvedValue([])
  mocked.queries.mockResolvedValue([])
  mocked.objects.mockResolvedValue([])
  mocked.rows.mockResolvedValue([])
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.ui.mockImplementation(async () => ({ ui: stored, revision: 'u1' }))
})

describe('M8 mounts in the app', () => {
  test('test search target routes to the search page and labels its tab', async () => {
    render(<App />)
    const strip = screen.getByRole('tablist', { name: 'Tabs' })
    act(() => openExtendedSearch('milk', true))
    expect(await screen.findByTestId('search-page')).toHaveTextContent('search page milk text only')
    expect(within(strip).getByText('Search')).toBeInTheDocument()
    await waitFor(() => expect(within(strip).getByRole('tab').querySelector('[data-icon="ph-magnifying-glass"]')).not.toBeNull())

    // The same query again is the same page; another query is a new history entry.
    act(() => openExtendedSearch('milk', true))
    expect(useTabs.getState().tabs[0].history).toHaveLength(1)
    act(() => openExtendedSearch('eggs'))
    expect(await screen.findByText(/search page eggs all/)).toBeInTheDocument()
    expect(useTabs.getState().tabs[0].history).toHaveLength(2)
  })

  test('test search targets compare by query and toggle', () => {
    expect(sameTarget({ kind: 'search', q: 'a' }, { kind: 'search', q: 'a', textOnly: false })).toBe(true)
    expect(sameTarget({ kind: 'search' }, { kind: 'search', q: '' })).toBe(true)
    expect(sameTarget({ kind: 'search', q: 'a' }, { kind: 'search', q: 'a', textOnly: true })).toBe(false)
    expect(sameTarget({ kind: 'search', q: 'a' }, { kind: 'search', q: 'b' })).toBe(false)
    expect(sameTarget({ kind: 'backlinks' }, { kind: 'backlinks' })).toBe(true)
    expect(sameTarget({ kind: 'backlinks' }, { kind: 'localGraph' })).toBe(false)
  })

  test('test backlinks side panel entry renders the panel', async () => {
    act(() => useTabs.getState().open({ kind: 'object', path: 'Pages/A.md' }))
    render(<App />)
    expect(await screen.findByText('object page Pages/A.md')).toBeInTheDocument()
    act(() => useTabs.getState().openInSidepanel({ kind: 'backlinks' }))
    const panel = await screen.findByRole('complementary', { name: 'Side panel' })
    expect(within(panel).getByTestId('backlinks-panel')).toHaveTextContent('backlinks of Pages/A.md')
    // The entry follows the tab's current object.
    act(() => useTabs.getState().open({ kind: 'object', path: 'Pages/B.md' }))
    expect(await within(panel).findByText('backlinks of Pages/B.md')).toBeInTheDocument()
  })
})
