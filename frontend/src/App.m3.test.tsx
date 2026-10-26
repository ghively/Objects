import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, UiState } from '@/api/types'
import { collection, query, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { resetPinned } from '@/shell/usePinned'
import { useDefs } from '@/types/useDefinitions'
import App from './App'

const mocked = vi.mocked(api)

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, revision: 'r1' })
let stored: UiState

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  resetPinned()
  useDefs.setState({ collections: [], queries: [], loaded: false })
  stored = { pinned: [], sections: [], allNotesLayout: 'list' }
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.collections.mockResolvedValue([
    collection({ id: 'reading', name: 'Reading list', typeIds: ['page'], icon: { type: 'iconify', val: 'ph-books' } }),
  ])
  mocked.queries.mockResolvedValue([query({ id: 'open', name: 'Open pages' })])
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.ui.mockImplementation(async () => ({ ui: stored, revision: 'u1' }))
  mocked.patchUi.mockImplementation(async (patch) => {
    stored = { ...stored, ...patch }
    return { ui: stored, revision: 'u2' }
  })
})

describe('navigation wiring', () => {
  test('test opening collection, query and allNotes targets renders their pages and tab labels', async () => {
    const user = userEvent.setup()
    render(<App />)
    const strip = screen.getByRole('tablist', { name: 'Tabs' })

    await user.click(await screen.findByRole('button', { name: 'All notes' }))
    await waitFor(() => expect(within(strip).getByText('All notes')).toBeInTheDocument())
    expect(await screen.findByRole('heading', { name: 'All notes' })).toBeInTheDocument()

    useTabs.getState().open({ kind: 'collection', id: 'reading' })
    await waitFor(() => expect(within(strip).getByText('Reading list')).toBeInTheDocument())
    expect(await screen.findByRole('textbox', { name: 'Collection name' })).toHaveValue('Reading list')

    useTabs.getState().open({ kind: 'query', id: 'open' })
    await waitFor(() => expect(within(strip).getByText('Open pages')).toBeInTheDocument())
  })

  test('test pin from TypePage and CollectionPage menus adds a PinRef', async () => {
    const user = userEvent.setup()
    useTabs.getState().open({ kind: 'type', typeId: 'page' })
    render(<App />)
    await screen.findByRole('heading', { name: 'Pages', level: 1 })
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Pin to sidebar' }))
    await waitFor(() => expect(stored.pinned).toEqual([{ kind: 'type', id: 'page' }]))

    useTabs.getState().open({ kind: 'collection', id: 'reading' })
    await screen.findByRole('textbox', { name: 'Collection name' })
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Pin to sidebar' }))
    await waitFor(() =>
      expect(stored.pinned).toEqual([
        { kind: 'type', id: 'page' },
        { kind: 'collection', id: 'reading' },
      ]),
    )
    // The sidebar now lists both.
    await waitFor(() => expect(within(screen.getByRole('complementary', { name: 'Sidebar' })).getAllByText('Reading list').length).toBeGreaterThan(0))
  })
})
