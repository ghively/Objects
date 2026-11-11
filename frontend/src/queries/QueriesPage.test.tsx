import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { propertyDef, query, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, useTabs } from '@/nav/tabs'
import { Sidebar } from '@/shell/Sidebar'
import { useDefs } from '@/types/useDefinitions'
import { QueriesPage } from './QueriesPage'

const mocked = vi.mocked(api)

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const SERVER = typeDef({ id: 'server', name: 'Server', pluralName: 'Servers', revision: 'r1', propertyDefinitions: [TITLE] })
const QUERIES = [
  query({ id: 'zed', name: 'Zed list', revision: 'a', definition: { types: [{ id: 'server' }], filterGroup: { type: 'filterGroup', operator: 'and', elements: [] }, sorts: [], groupBy: null } }),
  query({ id: 'abc', name: 'Another', revision: 'b' }),
]

beforeEach(() => {
  useTabs.getState().reset()
  resetLinkIndex()
  useDefs.setState({ collections: [], queries: [], loaded: false })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.collections.mockResolvedValue([])
  mocked.queries.mockResolvedValue(QUERIES)
  mocked.onChange.mockReturnValue(() => undefined)
  useLinkIndex.setState({ types: [SERVER], objects: [], loaded: true })
})

describe('QueriesPage', () => {
  test('lists every query by title with its types and the automatic title of a custom one', async () => {
    render(<QueriesPage />)
    const list = await screen.findByRole('list', { name: 'Saved searches' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-query-row'))).toEqual(['abc', 'zed'])
    expect(within(rows[1]).getByText('Zed list')).toBeInTheDocument()
    // The automatic title as subtitle, and the types.
    expect(within(rows[1]).getAllByText('Servers')).toHaveLength(2)
  })

  test('shows the empty state', async () => {
    mocked.queries.mockResolvedValue([])
    render(<QueriesPage />)
    expect(await screen.findByText('No saved searches')).toBeInTheDocument()
    expect(screen.getByText('Searches you save show up here.')).toBeInTheDocument()
  })

  test('test Queries sidebar item opens QueriesPage listing every query; New creates and opens one', async () => {
    const user = userEvent.setup()
    const onOpenTarget = vi.fn((t, o) => useTabs.getState().open(t, o))
    render(
      <>
        <Sidebar types={[SERVER]} onOpenTarget={onOpenTarget} />
        <main>
          <QueriesPage />
        </main>
      </>,
    )
    // The sidebar row sits between the types by name, with no count (M32: "Types", "Saved searches").
    const items = within(screen.getByRole('region', { name: 'Types' })).getAllByRole('listitem')
    expect(items.map((i) => i.textContent)).toEqual(['Saved searches', 'Servers'])
    await user.click(within(items[0]).getByRole('button'))
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'queries' }, { newTab: false })
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'queries' })

    mocked.createQuery.mockResolvedValue(query({ id: 'fresh', name: '', revision: 'n' }))
    await user.click(await within(screen.getByRole('main')).findByRole('button', { name: 'New' }))
    await waitFor(() => expect(mocked.createQuery).toHaveBeenCalled())
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'query', id: 'fresh' }))
  })

  test('the row menu deletes a query', async () => {
    const user = userEvent.setup()
    mocked.deleteQuery.mockResolvedValue({ trashId: 't' })
    render(<QueriesPage />)
    await user.click(await screen.findByRole('button', { name: 'Zed list menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(mocked.deleteQuery).toHaveBeenCalledWith('zed'))
  })
})
